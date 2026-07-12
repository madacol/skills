# Simplify domain documentation ownership

## Goal

Use `CONTEXT.md` as the sole project knowledge map and define terminology in the context or area document that owns each concept.

## Outcome

- Removed the separate glossary convention and deleted `domain-modeling/CONTEXT-FORMAT.md`.
- Removed `CONTEXT-MAP.md` and compact glossary compatibility paths.
- Removed the redundant `docs/agents/domain.md` setup template; `CONTEXT.md` carries the routing guidance directly.
- Simplified `domain-modeling` and `improve-codebase-architecture` around owning documents reached through `CONTEXT.md`.
- Updated `grill-with-docs`, `to-spec`, `tdd`, `codebase-design`, and `setup-matt-pocock-skills` to use the same ownership model.
- Kept `codebase-design`'s internal architecture glossary; it is vocabulary within that skill, not a project glossary document.

## Verification

- No active skill references `CONTEXT-MAP.md`, `docs/glossary.md`, or a project/domain glossary.
- A fresh Codex prompt reports 27 discovered skills with no duplicate names.
- Affected standard-format skills pass validation; existing Matt-specific invocation frontmatter remains accepted by Codex discovery.
- `git diff --check` passes.
