# Standardize engineering work files

## Goal

Standardize specs, tickets, QA reports, and Wayfinder maps as Markdown files under `.scratch/`.

## Decisions

- Use `.scratch/<work-slug>/SPEC.md`, `README.md`, and `tickets/NN-<slug>.md` for scoped work.
- Wayfinder efforts add `.scratch/<effort>/map.md` and atomic claims under `.scratch/<effort>/claims/`.
- Record repository conventions in `docs/agents/work-files.md` from one setup template.
- Store Wayfinder ticket control data in YAML front matter using `type`, `status`, and `blocked_by`.
- Write instructions for a fresh-context agent using direct paths and actions.

## Outcome

- Setup now generates one work-file convention and presents one `.scratch/` layout.
- Specification, ticketing, QA, review, and Wayfinder skills use the same file paths and terminology.
- Wayfinder ticket metadata is separated from the question body with YAML front matter.
- Consolidated setup to `setup-matt-pocock-skills/work-files.md`.

## Verification

- `git diff --check` passes.
- Active skill scans contain only the current file paths and actions.
- All active skill files have closing frontmatter delimiters.
- The Wayfinder skill and work-file template agree on `type`, `status`, and `blocked_by`.
- Standards review: no findings after removing one opaque backward reference from the task brief.
- Spec review: no findings after resolving canonical map, spec-location, and conditional-instruction issues.
- No executable tests apply to these instruction-only changes.
- The reviewed state is included in the commit that archives this task.
