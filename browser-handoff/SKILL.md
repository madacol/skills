---
name: browser-handoff
description: Open a live website in a controllable browser and send the user a private token URL to take over when a page needs human input, such as CAPTCHA, login, MFA, consent, booking confirmation, payment confirmation, or another manual gate.
---

# Browser Handoff

Use the bundled helper when a browsing task reaches a step that is easier or safer with the user directly controlling the live browser. The normal command is only the target URL:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com"
```

The helper owns the operational defaults: one stable token-protected gateway, VNC/noVNC, a 30-minute session TTL, runtime preflight, temporary browser state, and exact-session agent continuation. Do not pass extra flags during normal use.

For high-sensitivity sites such as government identity portals, tax portals, banking, healthcare, immigration, or any flow involving identity credentials, documents, payments, or other sensitive personal data, do not create a browser handoff until the user has explicitly approved the risk that the session is controlled through a private token URL on an external deployment domain. If that approval is not available or the request is blocked, guide the user through their own browser instead.

Default behavior:

- Uses a desktop Chromium session exposed through VNC/noVNC.
- The embedded noVNC view uses local scaling so the remote desktop fits phone screens. Pinch inside noVNC is passed to the remote browser; pinch on the toolbar or bottom zoom strip changes the local handoff-page zoom for the whole interface.
- Reuses one private gateway URL and prints only the user-facing `Control URL`.
- Allows up to four isolated sessions at once; ending one session does not affect the others.
- Self-closes after 30 minutes unless `--ttl-minutes` changes the TTL.
- Keeps the Chromium profile and control records under `/tmp/browser-handoff` only while the session is live.
- Deletes the session profile, records, locks, and browser processes on Stop, Cancel, TTL, startup failure, or worker exit.

For a mobile site or mobile verification flow, use a Playwright device profile:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com" --device "iPhone 14"
```

Send the printed `Control URL` to the user only after verifying it. Say what page is open, what they need to do, and what you will do after they click Continue. Then end the turn.

The helper must not print a `Control URL` unless local preflight confirms Playwright, Chromium, and the VNC runtime. If it fails, report the concrete error instead of retrying blindly; three rapid worker-start failures open a one-minute circuit breaker.

Do not manually inspect Playwright installs, browser cache revisions, or deployment registry state before normal use. The helper owns those preflight and recovery details. Only pass runtime override flags such as `--playwright-require-from` after the helper reports a concrete failure that requires an override.

Do not poll, sleep-loop, monitor, or keep the agent turn open while the user has control. Resume only after the user sends a follow-up message such as “continue”, asks for status, or gives new direction. Then reconnect through the temporary active-session record. With one live handoff, the helper finds it automatically:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs resume inspect
```

With concurrent handoffs, pass the `Active state` path printed when that handoff was created:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs resume inspect \
  --active-state <path>
```

Continue browsing with `resume goto <url>`, `resume click <selector>`, `resume fill <selector> <text>`, `resume press <selector> <key>`, and `resume screenshot [path]`. Every command reconnects to the same live browser and leaves it running.

Outcomes:

- `continue`: reconnect through the recorded active-state path, verify the page reflects the expected result, and continue from the same live browser state.
- `save_later`: keep the live temporary session and stay paused until its TTL.
- `cancel`: stop the task and delete the temporary session.

Treat the user’s continue signal as a control boundary, not proof that the web action succeeded. Verify the page state before continuing.

## Behavior

- The control UI supports VNC browser control, continue/save, save for later, cancel, and stop.
- Continue/Save returns the outcome, current URL, active ID, and temporary active-record path without writing screenshots, HTML, storage state, or historical logs.
- The active record contains a loopback-only CDP endpoint used by the `resume` commands and disappears with the session.
- The gateway is the only permanent service. It stays idle when no handoff exists and never recreates a terminated session.
- Each session has its own process group, temporary directory, control capability, and continuation record. Cleanup is scoped to that session.
- The default TTL is enforced by the temporary worker itself.
- If the live worker is lost, the session is gone; it is never silently restored or restarted.

## Advanced flags

Use flags only when the user asks for non-default behavior or the helper reports a concrete failure that requires an override.

- `--ttl-minutes <n>`: auto-close timeout from 1 to 60 minutes. Defaults to `30`; gateway sessions cannot disable the TTL.
- `--persist-profile <name>`: explicitly reuse a named Chromium profile across handoffs. Default sessions never persist login state. Profiles are cache-pruned and bounded to three profiles and 512 MB total.
- `--retain-artifacts`: retain bounded diagnostics explicitly. The gateway keeps at most three directories and 50 MB total; browser profiles and session records are still removed.
- `--device <name>`: Playwright device profile, such as `iPhone 14` or `Pixel 7`; sets mobile viewport, user agent, touch support, and device scale.
- `--user-agent <value>`, `--is-mobile <0|1>`, `--has-touch <0|1>`, `--device-scale-factor <n>`: explicit browser emulation overrides.
- `--viewport <width>x<height>`: desktop viewport override. Default: `1440x960`.
- `--playwright-require-from <path>`: resolve Playwright from an existing package root or `package.json`, useful when reusing a pinned installation outside the current workspace.
- `--xvfb <path>`, `--x11vnc <path>`, `--novnc-web <path>`: explicit VNC runtime paths. `--novnc-web` must point to a directory containing `vnc.html`.
- `--vnc-display <display>`, `--vnc-port <port>`: VNC backend internals; usually leave unset.
- `--local`: bypass the gateway and run a local control server for debugging.

Run `--help` for the full helper interface.
