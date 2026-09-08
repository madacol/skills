---
status: todo
---

# Consolidate `.scratch` workflows with `manage-tasks`

## Outcome

Skills use `manage-tasks` instead of `.scratch` conventions wherever both serve the same purpose.

## Context

Audit every skill that directs agents to use `.scratch/`, `docs/agents/work-files.md`, or another task and ticket store. Compare each workflow with `manage-tasks`. Keep a separate artifact only when it serves a purpose that `manage-tasks` does not cover.

## Acceptance criteria

- Identify every overlapping skill and the purpose of its stored files.
- Replace redundant task or ticket storage instructions with `manage-tasks`.
- Preserve distinct artifacts, such as specifications or research maps, only when their role differs from durable task state.
- Update affected cross-references and validate the resulting skills and task records.
