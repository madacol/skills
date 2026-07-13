# Work tracker: Local Markdown

Specs and tickets for this repo live as Markdown files in `.scratch/`.

## Conventions

- One workstream per directory: `.scratch/<work-slug>/`
- The optional spec is `.scratch/<work-slug>/SPEC.md`
- The ticket index is `.scratch/<work-slug>/README.md`
- Tickets are `.scratch/<work-slug>/tickets/<NN>-<slug>.md`, numbered from `01`
- Comments and conversation history append to the bottom of the relevant file under a `## Comments` heading

## When a skill says "publish to the work tracker"

Publish a spec as `.scratch/<work-slug>/SPEC.md`. Publish a ticket under `.scratch/<work-slug>/tickets/` and add it to `README.md`, creating the workstream structure if needed.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the ticket path directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/tickets/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `open`/`claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/tickets/` for files that are open, unblocked, and have neither `Status: claimed` nor a matching claim directory; first by number wins.
- **Claim**: ensure `.scratch/<effort>/claims/` exists, then atomically create `.scratch/<effort>/claims/NN` with `mkdir` (without `-p`) before any other work. Only the session whose claim-directory creation succeeds owns the claim; if it already exists, choose another frontier ticket. Then set `Status: claimed`. A stale claim requires deliberate manual removal before the ticket can return to the frontier.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
