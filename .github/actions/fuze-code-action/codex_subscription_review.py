#!/usr/bin/env python3
"""Run an isolated, subscription-only reviewer; never export or print auth."""
import json
import os
import pathlib
import subprocess
import tempfile
import uuid


def review(auth, prompt, executable="codex"):
    data = json.loads(auth)
    tokens = data.get("tokens") or {}
    if data.get("OPENAI_API_KEY") or not all(tokens.get(k) for k in ("access_token", "refresh_token", "id_token")):
        raise ValueError("a ChatGPT Codex auth cache is required")
    if not prompt.strip():
        raise ValueError("an explicit review prompt is required")
    with tempfile.TemporaryDirectory(prefix="fuze-codex-review-") as tmp:
        root = pathlib.Path(tmp)
        home = root / "codex"
        work = root / "empty"
        home.mkdir(mode=0o700)
        work.mkdir(mode=0o700)
        cache = home / "auth.json"
        cache.write_text(auth)
        cache.chmod(0o600)
        (home / "config.toml").write_text('forced_login_method = "chatgpt"\ncli_auth_credentials_store = "file"\n')
        output = root / "result.txt"
        # No GitHub/provider/job secrets, repository instructions, MCP configuration,
        # or existing user Codex configuration enter this process. Shell tools are
        # disabled; remaining filesystem operations require the read-only OS sandbox.
        # A runner unable to initialize that sandbox fails; never downgrade it.
        env = {k: os.environ[k] for k in ("PATH", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR") if k in os.environ}
        env.update(HOME=str(root), CODEX_HOME=str(home))
        args = [executable, "exec", "--skip-git-repo-check", "--sandbox", "read-only",
                "--disable", "shell_tool", "--disable", "view_image", "--disable", "multi_agent", "--disable", "multi_agent_v2",
                "--disable", "code_mode_host", "--disable", "plugins", "--disable", "apps",
                "-c", "features.code_mode=false", "-c", 'web_search="disabled"', "-c", "approval_policy=\"never\"",
                "--output-last-message", str(output), "-"]
        result = subprocess.run(args, input=prompt, text=True, cwd=work, env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
        if result.returncode != 0 or not output.exists() or not output.read_text().strip():
            raise RuntimeError("Codex review failed or produced no verdict; check auth, quota and sandbox support")
        return output.read_text()


def main():
    try:
        text = review(os.environ.pop("FUZE_CODEX_AUTH_JSON", ""), os.environ.pop("FUZE_REVIEW_PROMPT", ""))
    except (ValueError, RuntimeError, subprocess.TimeoutExpired, OSError):
        print("::error::Codex subscription review did not complete; no review verdict was produced")
        return 1
    delimiter = "FUZE_" + uuid.uuid4().hex
    with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
        fh.write(f"result-text<<{delimiter}\n{text}\n{delimiter}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
