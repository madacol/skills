# Add agent continuation to browser handoff

## Goal

Let a fresh agent reconnect to and continue browsing in the exact Chromium session controlled by the user through noVNC.

## Decisions

- User VNC access may remain active; exclusive control is not required.
- Launch Chromium with a loopback-only CDP endpoint allocated by Chromium.
- Store the endpoint in the active-session record and expose a `browser-handoff.mjs resume` CLI for agent actions.
- On Continue, write `ready_for_agent` and point `latest.json` at the active-session record instead of claiming the agent already resumed.
- Preserve the running Chromium, Xvfb, x11vnc, and control service after Continue.

## Public seams

- Resume CLI: inspect the page and perform browser actions through the existing live session.
- Active-session record: identify the running session and its local CDP endpoint.
- `latest.json`: tell a fresh agent which active record to resume.

## Acceptance criteria

- A fresh process can inspect and navigate the same page after user interaction and Continue.
- Cookies, tabs, form state, and authentication remain in the same live Chromium process.
- VNC remains available while agent continuation works.
- CLI and live integration verification pass.
- Standards and Spec review pass before commit.

## Verification evidence

- Public-seam tests passed for resume help and missing-session handling.
- Live handoff launched Chromium, Xvfb, x11vnc, noVNC, and loopback CDP from the Bot Saca Citas pinned Playwright workspace.
- User-side navigation changed the page to `https://example.org/`; Continue wrote `ready_for_agent` with the active-state path.
- A fresh resume process connected to the same active ID, inspected `example.org`, and navigated the same live browser to `https://example.com/`.
- The VNC status endpoint remained available after agent continuation, and explicit Stop shut down the test session cleanly.
- The active-session record was written with mode `0600`.
- A `--keep-previous` live test wrote a per-session continuation record instead of the shared active record; a fresh process resumed and navigated that exact browser.
- A hostile custom active ID was hashed into a safe session filename, and Stop atomically changed both records to non-resumable `stopped` tombstones.
- Record updates use OS-managed locks that release automatically if a writer dies; a final launch/stop smoke test passed through that path.
- Independent Standards and Spec reviews found no remaining concrete blockers.

## Baseline

`43280766778a405746dfbeb54f9a00d0c5e20a4a`
