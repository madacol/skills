---
name: browser-handoff
description: Open a live website in a controllable browser and send the user a private token URL to take over when a page needs human input, such as CAPTCHA, login, MFA, consent, booking confirmation, payment confirmation, or another manual gate.
---

# Browser Handoff

Use the bundled helper when a browsing task reaches a step that is easier or safer with the user directly controlling the live browser. The browser session is the thing being handed off: control changes hands, but the session remains the same session.

For high-sensitivity sites such as government identity portals, tax portals, banking, healthcare, immigration, or any flow involving identity credentials, documents, payments, or other sensitive personal data, do not create a browser handoff until the user has explicitly approved the risk that the session is controlled through a private token URL on an external deployment domain. If that approval is not available or the request is blocked, guide the user through their own browser instead.

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com"
```

Default behavior:

- Uses a desktop Chromium session exposed through VNC/noVNC.
- The embedded noVNC view uses local scaling so the remote desktop fits phone screens; if the embedded view is still constrained by browser chrome, tell the user to tap `Full Screen noVNC`.
- Deploys a private token URL and prints only the user-facing `Control URL`.
- Stops the previously active handoff before creating a new default handoff.
- Self-closes after 30 minutes unless `--ttl-minutes` changes the TTL.
- Persists browser state under `artifacts/browser-handoff/profile`.

For a mobile site or mobile verification flow, use a Playwright device profile:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com" --device "iPhone 14"
```

Send the printed `Control URL` to the user. Say what page is open, what they need to do, and what you will do after they click Continue. Then end the turn.

The helper must not print a `Control URL` unless local preflight confirms the runtime dependencies needed by the deployed service, including Playwright and a usable Chromium executable. If the helper fails before printing the URL, report the concrete preflight error instead of retrying blindly. A missing `latest.json` before the user clicks Continue/Save is normal; it is not evidence by itself that deployment failed.

If Playwright is already installed outside the current workspace, prefer reusing that pinned installation and its already-cached browser revision instead of installing or downloading anything. Pass the Playwright package root or package.json with `--playwright-require-from <path>`; the helper will propagate that path to the deployed service and record it for `resume` commands.

Do not poll, sleep-loop, monitor, or keep the agent turn open while the user has control. Resume only after the user sends a follow-up message such as “continue”, asks for status, or gives new direction. At that point, read `artifacts/browser-handoff/latest.json` in the workspace that launched the helper, then reconnect to the same live Chromium session through the active-state path it records:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs resume inspect \
  --active-state <activeStatePath-from-latest.json>
```

Continue browsing with `resume goto <url>`, `resume click <selector>`, `resume fill <selector> <text>`, `resume press <selector> <key>`, and `resume screenshot [path]`. Every command reconnects to the same live browser and leaves it running.

Outcomes:

- `continue`: reconnect through the recorded active-state path, verify the page reflects the expected result, and continue from the same live browser state.
- `save_later`: keep the session and stay paused.
- `cancel`: stop the task unless the user gives new direction.

Treat the user’s continue signal as a control boundary, not proof that the web action succeeded. Verify the page state before continuing.

## Behavior

- The control UI supports VNC browser control, continue/save, save for later, cancel, and stop.
- Saves write the selected outcome, screenshot, page HTML, current URL, visible links, storage state, and continuity metadata.
- The active-session record lives beside the artifact root and lets a newer handoff invalidate an older one.
- The active-session record contains a loopback-only CDP endpoint used by the `resume` commands; `latest.json` points the next agent to that record.
- The default TTL is enforced by the running handoff process itself; no cron or at-job is required.
- If the live session is lost, treat any restored profile as reduced continuity rather than the exact same session.

## Options

- `--subdomain <name>`: stable deployed subdomain. Defaults to a unique `browser-handoff-*` name.
- `--artifacts-dir <path>`: artifact root. Defaults to `./artifacts/browser-handoff`.
- `--profile-dir <path>`: browser profile directory. Defaults to `<artifacts-dir>/profile`.
- `--ttl-minutes <n>`: auto-close timeout. Defaults to `30`; use `0` to disable.
- `--keep-previous`: create a handoff without replacing the previous active handoff. Concurrent handoffs must use distinct `--artifacts-dir` values; concurrent local handoffs also need distinct `--port` values.
- `--device <name>`: Playwright device profile, such as `iPhone 14` or `Pixel 7`; sets mobile viewport, user agent, touch support, and device scale.
- `--user-agent <value>`, `--is-mobile <0|1>`, `--has-touch <0|1>`, `--device-scale-factor <n>`: explicit browser emulation overrides.
- `--viewport <width>x<height>`: desktop viewport override. Default: `1440x960`.
- `--playwright-require-from <path>`: resolve Playwright from an existing package root or `package.json`, useful when reusing a pinned installation outside the current workspace.
- `--xvfb <path>`, `--x11vnc <path>`, `--novnc-web <path>`: explicit VNC runtime paths. `--novnc-web` must point to a directory containing `vnc.html`.
- `--vnc-display <display>`, `--vnc-port <port>`: VNC backend internals; usually leave unset.
- `--local`: run only a local control server for debugging.

Run `--help` for the full helper interface.
