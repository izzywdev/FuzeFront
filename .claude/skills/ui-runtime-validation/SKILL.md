---
name: ui-runtime-validation
description: Use when validating any UI work — the mandatory family gate that a change is rendered in a real Chromium via the Chrome DevTools MCP and the console is clean, before any UI agent reports done. Encodes the policy, the runtime gotchas, the MCP capability map, and the DONE-report gate; defers the mechanics to the `chrome-devtools-mcp` plugin's own skills (`chrome-devtools-mcp:chrome-devtools`, `chrome-devtools-mcp:a11y-debugging`). Applies to frontend-engineer (dev-time self-check), frontend-test-engineer (independent QA), and mobile-app-engineer (packaged PWA/native shell).
---

# UI runtime validation — the console-clean gate

A UI that type-checks, passes unit tests, and matches a screenshot can still be **broken at
runtime** — an uncaught exception in an effect, a 404 on a JS chunk, a CSP violation blocking an
inline script, a mixed-content block under TLS, a failed Module-Federation remote load, a
service-worker registration failure in a packaged PWA. **None of those show up in unit tests or a
static frame diff.** The only way to catch them is to render the app in a real browser and read the
console + network panels.

## The rule (non-negotiable)

**No UI work is "done" or "verified" until it has been loaded in a real Chromium via the Chrome
DevTools MCP and the console is clean** — zero errors, or every remaining message understood and
justified. This is a hard gate, not a nice-to-have. It applies to the implementer's own change
(dev-time self-check) *and* to independent QA.

- **`frontend-engineer`** — dev-time **self-validation**: render your own change (desktop and
  small-screen/responsive) and confirm a clean console before you report `SCOPE DONE`.
  `tools: "*"` already grants the MCP.
- **`frontend-test-engineer`** — independent **QA**: the same console/network gate on top of the
  Playwright acceptance + device-conformance run, on both the built app and (post-deploy) the live
  app. A runtime error the implementer missed is a **valid, valuable bug to REPORT and ticket**
  (route to `frontend-engineer` via the `ticket-creator` bug template) — never patched by QA,
  never rounded up to a pass.
- **`mobile-app-engineer`** — validate the **packaged** artifact: the installed PWA / native-shell
  WebView must render with a clean console (service-worker registration + offline path, no CSP or
  mixed-content breakage inside the WebView, native-plugin bridge errors).

These uses are complementary, not duplicate: the implementer catches their own runtime breakage
early; the independent verifier confirms it on the real, rendered app; the packager confirms it
survives the PWA/native shell.

## The MCP + its capabilities (know the full toolset)

The plugin is `chrome-devtools-mcp` (marketplace `chrome-devtools-plugins`); its tools are
`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` and it drives a real Chromium (Puppeteer).
Be familiar with the whole surface and reach for the right tool — not only the console:

| Need | MCP tool | Plugin skill for how-to |
|------|----------|--------------------------|
| Uncaught errors / warnings / CSP / mixed-content | `list_console_messages`, `get_console_message` | `chrome-devtools-mcp:chrome-devtools` |
| Failed / cross-origin / 4xx-5xx requests, chunk & remote loads | `list_network_requests`, `get_network_request` | `chrome-devtools-mcp:chrome-devtools` |
| Drive the app (click/type/navigate/wait) | `click`, `fill`, `fill_form`, `type_text`, `navigate_page`, `wait_for` | `chrome-devtools-mcp:chrome-devtools` |
| Accessibility / DOM tree audit | `take_snapshot`, `lighthouse_audit` | `chrome-devtools-mcp:a11y-debugging` |
| Performance / Core Web Vitals / LCP | `performance_start_trace`, `performance_stop_trace`, `performance_analyze_insight`, `lighthouse_audit` | `debug-optimize-lcp` |
| Mobile / responsive viewport | `emulate`, `resize_page` | `chrome-devtools-mcp:chrome-devtools` |
| Memory leaks / OOM | `take_heapsnapshot` | `memory-leak-debugging` |
| Visual evidence | `take_screenshot` | `chrome-devtools-mcp:chrome-devtools` |
| Server won't connect / no target | — | `troubleshooting` |

All "Plugin skill" entries above ship with the `chrome-devtools-mcp` plugin itself (marketplace
`chrome-devtools-plugins`) — none of them are FuzeSDLC-authored `skills/<name>/SKILL.md` files.
`chrome-devtools-mcp:chrome-devtools` and `chrome-devtools-mcp:a11y-debugging` carry the detailed
mechanics for the two most-cited cases; this skill is the **family policy** that wraps them.

## Procedure

1. **Serve the UI.** Point the browser at the running surface: the ephemeral stack (kind +
   version-pinned base services), the local dev server, the approved static frames
   (`design/frames/<feature>/`), the installed PWA, or — post-deploy — the live app.
2. **Navigate** to every route/state the change touches — including empty, loading, and error
   states, and each frame in a flow sequence; validate desktop **and** a small-screen viewport
   under device emulation.
3. **Read the console** (`list_console_messages`). Enumerate **all** messages.
4. **Read the network panel** (`list_network_requests`) — no failed or unexpectedly cross-origin
   app requests.
5. **Reproduce interactions** — click/type through the primary user actions and **re-check the
   console after each**; many errors only fire on interaction, not initial paint.
6. **Capture evidence** — screenshot + a console/network summary. This is the artifact that backs
   the `SCOPE DONE` claim (and the trace attached to a filed bug).

## Runtime failures to catch

- **CSP violations & mixed-content under TLS.** The family standard is a **same-origin API base**
  under TLS — an absolute `http://` API host, or an inline-script CSP breach, surfaces here as a
  blocked request / console violation. This is the most common runtime regression.
- **Module-Federation remote-load failures** — `ScriptExternalLoadError`, shared-singleton version
  mismatch (two Reacts), a remote 404. The host shell mounts federated remotes; a broken remote is
  a blank panel, not a build error.
- **Framework runtime warnings that are real bugs** — key warnings, invalid DOM nesting, state
  update on an unmounted component, hydration mismatch.
- **Packaged-shell failures (PWA / native)** — service-worker registration/scope errors, offline
  route failures, CSP tightened by the WebView, native-plugin bridge exceptions.

## What counts as a clean pass

- **Zero** `error`-level console messages and **zero** uncaught exceptions / unhandled rejections
  across every route+state exercised.
- **Zero** CSP / mixed-content violations.
- **Zero** failed (4xx/5xx/blocked) or wrongly cross-origin network requests for app-owned resources.
- Any surviving `warn`/`info` message is **explicitly explained** in the report — an unexplained
  warning is a flagged gap, not a pass.

## Reporting (fold into the mandatory DONE report)

- **`frontend-engineer` / `mobile-app-engineer`** → under `SCOPE DONE (verified)`: e.g. "Chrome
  DevTools MCP render of `<routes>` (desktop + small-screen / packaged shell): console clean — 0
  errors, 0 CSP/mixed-content, 0 failed requests" — or list every remaining message with its
  justification.
- **`frontend-test-engineer`** → the console/network inspection result **per acceptance criterion**,
  for both pre-production (built app / approved frames) and post-production (live app), plus the
  **Jira bug key** for any runtime defect found.

Never report a UI slice as verified on the strength of unit tests or a screenshot alone. If the
browser could not be driven (environment blocked), say so and RETURN `BLOCKED:` — a skipped console
check is a flagged gap, **never** a silent pass.
