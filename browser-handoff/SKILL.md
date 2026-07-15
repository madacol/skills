---
name: browser-handoff
description: Open a live website in a controllable browser and send the user a private token URL to take over when a page needs human input, such as CAPTCHA, login, MFA, consent, booking confirmation, payment confirmation, or another manual gate.
---

# Browser Handoff

Use the bundled helper when a browsing task reaches a step that is easier or safer with the user directly controlling the live browser. The browser session is the thing being handed off: control changes hands, but the session should remain the same session.

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com"
```

For a mobile site or mobile verification flow, prefer a real Playwright device profile:

```bash
node /home/mada/.agents/skills/browser-handoff/scripts/browser-handoff.mjs "https://example.com" --device "iPhone 14"
```

Send the printed `Control URL` to the user. Say what page is open, what they need to do, and what you will do after they return control. Then end the turn.

Do not poll, sleep-loop, monitor, or keep the agent turn open while the user has control. Do not also drive the browser. Resume only after the user sends a follow-up message such as “continue”, asks for status, or gives new direction. At that point, read `artifacts/browser-handoff/latest.json` in the workspace that launched the helper.

Outcomes:

- `continue`: resume from the same browser state after verifying the page reflects the expected result.
- `save_later`: keep the session and stay paused.
- `cancel`: stop the task unless the user gives new direction.

Treat the user’s continue signal as a control boundary, not proof that the web action succeeded. Verify the page state before continuing.

## Behavior

- The default run deploys the control UI with token access and prints the user-facing URL.
- The browser state is persistent under `artifacts/browser-handoff/profile`.
- Saves write the selected outcome, screenshot, page HTML, current URL, visible links, storage state, and continuity metadata.
- The control UI supports click, drag, scroll, keyboard, text input, reload, navigation, continue/save, save for later, cancel, and stop.
- If the live session is lost, treat any restored profile as reduced continuity rather than the exact same session.

## Options

- `--subdomain <name>`: stable deployed subdomain. Defaults to a unique `browser-handoff-*` name.
- `--artifacts-dir <path>`: artifact root. Defaults to `./artifacts/browser-handoff`.
- `--profile-dir <path>`: browser profile directory. Defaults to `<artifacts-dir>/profile`.
- `--device <name>`: Playwright device profile, such as `iPhone 14` or `Pixel 7`; sets mobile viewport, user agent, touch support, and device scale.
- `--user-agent <value>`, `--is-mobile <0|1>`, `--has-touch <0|1>`, `--device-scale-factor <n>`: explicit browser emulation overrides.
- `--viewport <width>x<height>`: viewport override. Use this for layout size only; use `--device` for real mobile behavior.
- `--headless <0|1>`: browser display mode. Defaults to `1`.
- `--local`: run only a local control server and print a local URL.

Run `--help` for the full helper interface.
