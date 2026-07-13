# Work Files

Specs, tickets, QA reports, and Wayfinder maps live under `.scratch/`.

## Conventions

- One workstream per directory: `.scratch/<work-slug>/`
- The optional spec is `.scratch/<work-slug>/SPEC.md`
- The ticket index is `.scratch/<work-slug>/README.md`
- Tickets are `.scratch/<work-slug>/tickets/<NN>-<slug>.md`, numbered from `01`
- Comments and conversation history append under a `## Comments` heading in the relevant file

## Write work files

- **Spec**: write `.scratch/<work-slug>/SPEC.md`.
- **Ticket**: write `.scratch/<work-slug>/tickets/<NN>-<slug>.md` and add it to `README.md`.
- **Read a ticket**: open the referenced ticket path.

## Wayfinding operations

Used by `/wayfinder`. The map is one file with one child file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope index.
- **Child ticket**: `.scratch/<effort>/tickets/NN-<slug>.md`, numbered from `01`, with this shape:

  ```markdown
  ---
  type: research
  status: open
  blocked_by: []
  ---

  ## Question

  <the decision or investigation this ticket resolves>
  ```

- **Blocking**: `blocked_by` is an array of quoted ticket numbers such as `["01", "02"]`. A ticket is unblocked when every listed ticket has `status: resolved`.
- **Frontier**: scan `.scratch/<effort>/tickets/` for files with `status: open` that are unblocked and have no matching claim directory; first by number wins.
- **Claim**: ensure `.scratch/<effort>/claims/` exists, then atomically create `.scratch/<effort>/claims/NN` with `mkdir` (without `-p`) before any other work. Only the session whose claim-directory creation succeeds owns the claim. Then set `status: claimed`. A stale claim requires deliberate manual removal before the ticket can return to the frontier.
- **Resolve**: append the answer under `## Answer`, set `status: resolved`, then append a one-line gist linking the ticket to the map's Decisions-so-far.
