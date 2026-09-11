---
status: done
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

## Audit findings

- `qa` and `to-tickets` now place stable, ordered ticket bundles beneath their parent managed task.
- Kept the Wayfinder map because it coordinates several tasks and records questions that are not ready to become tasks. Replaced its child-ticket lifecycle with managed tasks.
- Kept specifications under `.scratch` because they define shared implementation contracts rather than task state.
- Migrated this repository to stable task directories and the manually ordered `tasks/OPEN.md` index while retaining read compatibility for registered legacy stores.

## Resolved decisions

- Question: Should the audit preserve ticket bundles or extend `manage-tasks` so it can replace them without losing workstream planning?
- Answer: Make each managed task a stable directory containing its ordered ticket bundle, and use a manually maintained `tasks/OPEN.md` as the authoritative ordered list of open tasks.
- Rationale: Directory containment supplies task membership, numbered ticket filenames supply order, stable task directories prevent links from changing, and the curated open-task file provides fast discovery without a second generated index.
- Question: Should the existing private dashboard be redeployed with the completed implementation?
- Answer: Yes, redeploy it.
- Rationale: The user explicitly approved updating the live service after reviewing the completed local implementation and verification.

## Completion

Replaced movable task files with stable `tasks/<task-id>/README.md` records, restored ordered ticket bundles beneath their parent tasks, and made the manually maintained `tasks/OPEN.md` list drive dashboard order. The setup command creates the new store, the validator and dashboard share the `OPEN.md` parser, stable task and ticket routes preserve links, and legacy registered stores remain readable during migration. Migrated this repository's 12 records. Task validation reports one open and 11 completed records; all focused tests and the loopback dashboard integration tests pass; syntax checks and `git diff --check` pass; independent Standards and Spec re-reviews report no remaining findings. Redeployed the private dashboard and verified the project index, the `/skills/` page, and the live ordered task feed over HTTPS.
