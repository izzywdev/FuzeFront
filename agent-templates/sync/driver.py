"""Shared session driver: create a session and run a turn with the approval loop.

Used by launch_session.py (single role/coordinator) and orchestration/relay.py
(cross-environment hand-forward chain). Streaming + event shapes per
docs/en/managed-agents/events-and-streaming.
"""
import json
import queue
import threading
import urllib.request

import common


def memory_resource(store_id, access="read_write", instructions=None):
    """A resources[] entry that mounts a memory store into the session sandbox."""
    r = {"type": "memory_store", "memory_store_id": store_id, "access": access}
    if instructions:
        r["instructions"] = instructions
    return r


def create_session(agent_id, version, environment_id, vault_ids=None, title=None, resources=None):
    body = {
        "agent": {"type": "agent", "id": agent_id, "version": version},
        "environment_id": environment_id,
    }
    if vault_ids:
        body["vault_ids"] = vault_ids
    if resources:
        body["resources"] = resources  # e.g. [memory_resource(...)] — attach-at-create only
    if title:
        body["title"] = title
    return common.request("POST", "/v1/sessions", body=body)


def archive_session(session_id):
    """Terminate a session after it hands forward (best-effort)."""
    try:
        common.request("POST", f"/v1/sessions/{session_id}/archive")
    except SystemExit:
        pass  # already gone / not archivable — the relay continues regardless


def _stream_thread(session_id, q):
    url = f"{common.API_BASE}/v1/sessions/{session_id}/events/stream?beta=true"
    req = urllib.request.Request(url, headers=common.headers(accept="text/event-stream"), method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            for raw in resp:
                line = raw.decode(errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[len("data:"):].strip()
                if payload:
                    try:
                        q.put(json.loads(payload))
                    except json.JSONDecodeError:
                        pass
    except Exception as e:  # noqa: BLE001
        q.put({"type": "session.error", "error": {"message": f"stream closed: {e}"}})
    finally:
        q.put(None)


def send_events(session_id, events):
    return common.request("POST", f"/v1/sessions/{session_id}/events", body={"events": events}, query={"beta": "true"})


def send_message(session_id, text):
    send_events(session_id, [{"type": "user.message", "content": [{"type": "text", "text": text}]}])


def run_turn(session_id, prompt, approver, echo=True):
    """Drive one user turn to completion. Returns the accumulated agent text.

    approver(descriptions: dict[id -> str]) -> dict[id -> (result, deny_message)]
    """
    q = queue.Queue()
    threading.Thread(target=_stream_thread, args=(session_id, q), daemon=True).start()
    send_message(session_id, prompt)

    pending, out = {}, []
    while True:
        event = q.get()
        if event is None:
            return "".join(out)
        etype = event.get("type")
        if etype == "agent.message":
            for block in event.get("content", []):
                if block.get("type") == "text":
                    out.append(block["text"])
                    if echo:
                        print(block["text"], end="", flush=True)
        elif etype in ("agent.tool_use", "agent.mcp_tool_use"):
            pending[event.get("id")] = f"{event.get('name', '?')}({json.dumps(event.get('input', {}))[:200]})"
        elif etype == "session.status_idle":
            stop = event.get("stop_reason", {}) or {}
            if stop.get("type") == "requires_action":
                descs = {tid: pending.get(tid, tid) for tid in stop.get("event_ids", [])}
                decisions = approver(descs)
                send_events(session_id, [
                    {"type": "user.tool_confirmation", "tool_use_id": tid,
                     "result": res, **({"deny_message": msg} if msg else {})}
                    for tid, (res, msg) in decisions.items()
                ])
                continue
            return "".join(out)
        elif etype in ("session.error", "session.status_terminated"):
            if echo:
                print(f"\n[error: {json.dumps(event.get('error', {}))}]")
            return "".join(out)


def run_until_block(session_id, prompt=None, echo=False):
    """Run a session until it goes idle OR blocks on an always_ask approval.

    Unlike run_turn this NEVER auto-decides an approval — it returns control so the
    caller (e.g. the handoff MCP server) can surface a prod/3rd-party approval to an
    operator instead of silently allowing it. Returns:
        {"text": str, "status": "idle"|"blocked"|"error",
         "pending": {"event_ids": [...], "tools": {id: desc}} | None}
    """
    q = queue.Queue()
    threading.Thread(target=_stream_thread, args=(session_id, q), daemon=True).start()
    if prompt is not None:
        send_message(session_id, prompt)

    pending, out = {}, []
    while True:
        event = q.get()
        if event is None:
            return {"text": "".join(out), "status": "idle", "pending": None}
        etype = event.get("type")
        if etype == "agent.message":
            for block in event.get("content", []):
                if block.get("type") == "text":
                    out.append(block["text"])
                    if echo:
                        print(block["text"], end="", flush=True)
        elif etype in ("agent.tool_use", "agent.mcp_tool_use"):
            pending[event.get("id")] = f"{event.get('name', '?')}({json.dumps(event.get('input', {}))[:200]})"
        elif etype == "session.status_idle":
            stop = event.get("stop_reason", {}) or {}
            if stop.get("type") == "requires_action":
                ids = stop.get("event_ids", [])
                return {"text": "".join(out), "status": "blocked",
                        "pending": {"event_ids": ids, "tools": {i: pending.get(i, i) for i in ids}}}
            return {"text": "".join(out), "status": "idle", "pending": None}
        elif etype in ("session.error", "session.status_terminated"):
            return {"text": "".join(out), "status": "error", "pending": None}


def confirm_tool(session_id, tool_use_id, allow=True, deny_message=None):
    """Answer a single always_ask pause (used by the handoff server's approve tool)."""
    ev = {"type": "user.tool_confirmation", "tool_use_id": tool_use_id,
          "result": "allow" if allow else "deny"}
    if not allow and deny_message:
        ev["deny_message"] = deny_message
    send_events(session_id, [ev])


def interactive_approver(descriptions):
    out = {}
    for tid, desc in descriptions.items():
        ans = input(f"\nAPPROVE tool call?\n  {desc}\n  [y]allow / [n]deny > ").strip().lower()
        if ans in ("y", "yes", "allow"):
            out[tid] = ("allow", None)
        else:
            out[tid] = ("deny", input("  deny reason > ").strip() or "denied by operator")
    return out


def auto_approver(result):
    msg = None if result == "allow" else "auto-denied (headless)"
    return lambda descriptions: {tid: (result, msg) for tid in descriptions}
