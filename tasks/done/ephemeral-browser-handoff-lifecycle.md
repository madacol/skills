# Make browser handoffs ephemeral

## Goal

Replace per-handoff permanent deployments and retained browser artifacts with one stable gateway that owns temporary browser sessions and removes every session resource after completion.

## Agreed design

- Keep one lightweight permanent gateway and stable URL.
- Create each browser session under a unique temporary directory.
- Never restart an individual browser session after exit or failure.
- Kill Chromium, Xvfb, x11vnc, and the worker as one lifecycle unit.
- Retain no screenshots, HTML, network logs, console logs, profiles, tombstones, session manifests, routes, or tokens by default.
- Make cross-handoff login persistence and retained diagnostics explicit opt-ins with limits.
- Validate the session protocol and runtime before starting Chromium.
- Support isolated concurrent sessions, a finite lifetime, bounded temporary state, and a startup-failure circuit breaker.
- Give each session its own unguessable control handle, runtime directory, active record, worker process group, and cleanup path; ending one session must not affect another.
- Treat cleanup behavior as a first-class acceptance requirement.

## Confirmed test seams

- The public helper CLI creates a handoff through the gateway and returns its control URL.
- The gateway HTTP interface exposes the live handoff and its terminal lifecycle operations.
- The resume CLI reconnects to the exact live Chromium session.
- Observable lifecycle effects—session directory and process-group existence—prove cleanup after Stop, Cancel, TTL, startup failure, and forced worker death.

## Constraints

- Keep the `browser-handoff` skill installed.
- Use `pnpm` for Playwright commands; do not install packages or browser revisions.
- Reuse the already installed, pinned Playwright runtime selected by preflight.
- Normal inactive disk use must not grow across sequential sessions.
- A gateway restart must not recreate prior browser sessions.

## Acceptance criteria

- Normal invocation reuses one gateway deployment instead of registering a new manifest, route, service, or token per session.
- Concurrent sessions remain independently controllable and independently disposable.
- Session runtime state is temporary and deleted on Stop, Cancel, TTL, startup failure, and forced worker exit.
- Browser subprocesses terminate with the session.
- Continue still lets a fresh agent drive the exact live Chromium process.
- No historical run directories or persistent Chromium profile are written by default.
- Repeated sessions leave inactive disk use unchanged apart from bounded gateway configuration.
- Focused tests, the full browser-handoff test file, live verification, and independent Standards/Spec reviews pass.

## Baseline

`b72682f17867450228e8c45b0f15d6939115d2ff`

## Evidence

- The removed deployment accumulated about 3.7 GB, including about 3.5 GB of Chromium BrowserMetrics, 51,263 run directories, and thousands of session locks.
- Its systemd service used `Restart=always` and reached roughly 59,434 restarts while failing with `Active browser handoff changed before its CDP endpoint was recorded.`
- The final design keeps one restartable gateway and creates non-restarting browser workers in isolated process groups and temporary directories.
- All 13 automated tests pass, including startup-failure cleanup, circuit breaking, resume discovery, concurrent route/cookie isolation, and existing stale-process lifecycle coverage.
- Live Stop, Cancel, TTL, and forced-worker-death checks removed their complete session directories and browser/VNC process groups.
- In one shared cookie jar, stopping session A left session B reachable and resumable through its exact CDP endpoint.
- Three sequential TTL sessions left durable state unchanged: `gateway.json` remained 117 bytes and `website.json` remained 576 bytes; `/tmp/browser-handoff` returned to empty each time.
- The deployed gateway command contains no session-creation secret and reports zero restarts after the final deployment.
- Independent Standards and Spec reviews were run, their concurrency, safety, lifetime, and verification findings were addressed, and final re-review found no remaining findings.
