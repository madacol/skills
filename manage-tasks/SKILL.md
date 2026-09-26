---
name: manage-tasks
description: Learn how to organize work into tasks that agents can coordinate and resume across sessions.
---

# Manage tasks

Set up and register the task store with this idempotent command:

```sh
node <skill-directory>/scripts/setup-task-store.mjs <workspace-directory> <project-slug>
```

Dashboard: `https://task.babyjarvis.com/<project-slug>/`

## Store layout

Keep task paths stable. The task directory name is its ID, `README.md` is its managed record, and any implementation tickets live beneath it:

```text
tasks/
  OPEN.md
  <task-id>/
    README.md
    tickets/
      01-<ticket-slug>.md
      02-<ticket-slug>.md
```

`tasks/OPEN.md` is the manually maintained, authoritative list of open tasks:

```markdown
# Open tasks

- [Task title](task-id/README.md)
```

Use that Markdown link format so the dashboard can load it. The link label can be a short description; it does not need to match the task title.

List each unfinished task once in `OPEN.md`. Remove its link when it is done or canceled. Link order does not matter.

## Tickets

Add `tickets/` when a task needs several implementation slices. Tickets are stable planning artifacts; the parent `README.md` owns execution status, ownership, waits, and aggregate completion evidence.

Number tickets from `01` in intended implementation order. Each ticket should contain one complete, verifiable slice:

```markdown
# Ticket title

## Outcome

The behavior or decision this slice delivers.

## Acceptance criteria

- [ ] Observable criterion

## Blocked by

None, or links to prerequisite tickets in this task.

## Context

Only the constraints and source references needed to implement the slice.
```

## Validation

Run the validator before ending a turn that changes `OPEN.md`, a task record, or tickets. It does not need to run after each individual edit:

```sh
node <skill-directory>/scripts/validate-tasks.mjs tasks
```

The validator checks the task records and the `OPEN.md` link contract consumed by the dashboard. It also accepts the former `open/` and `closed/` layout while existing stores migrate.

## Statuses

| Status | Use | `OPEN.md` |
|---|---|---|
| `todo` | Accepted and ready, not started | Listed |
| `in_progress` | Work can continue now | Listed |
| `awaiting_decision` | The user must answer one question | Listed |
| `waiting` | An external event or resource is required | Listed |
| `done` | Outcome met with completion evidence | Not listed |
| `canceled` | Stopped without meeting the outcome | Not listed |

## Active ownership

Before implementation or evidence changes begin, the coordinating agent claims the task with an `owner` field while setting or retaining `status: in_progress`:

```yaml
status: in_progress
owner: 8e25a58d/root
```

`owner` combines an eight-character Session fingerprint with the agent's canonical path. Hash the full global Session ID with SHA-256, take the first eight lowercase hexadecimal characters, then append the canonical path supplied by the agent runtime. For Codex, derive the fingerprint from `CODEX_THREAD_ID`. The primary agent is `/root`; a child might be `/root/status_tests`; a nested child might be `/root/status_tests/reviewer`.

Use the stable global Session ID and canonical agent path, not an Invocation, turn, process, opaque spawn ID, or reusable agent role. Never invent or guess either component. The validator accepts a bare eight-character owner already written during migration, but do not create new owners in that legacy format.

Each task has one coordinating owner, who may delegate work to multiple subagents. Delegated subagents work under that ownership without claiming separate tasks or replacing the owner. The coordinator maintains the task record and integrates their results. An agent may coordinate multiple active tasks. Do not work on another coordinator's task unless they delegated that work to you. If an `in_progress` task has no owner during migration, treat it as potentially active. A stale owner may be replaced only with explicit user direction.

When another request interrupts a task, record the next step in its task record and keep ownership. At the start of each turn and after compaction, check the tasks linked from `OPEN.md` for your `owner`; return to interrupted work when the detour is finished.

Claim with one compare-and-set patch whose context includes the complete current unowned frontmatter. Check the patch result and re-read the record before touching implementation files. Stop if the patch failed or the re-read names another owner.

Remove `owner` whenever status changes away from `in_progress`. When completing or canceling owned work, update the status, remove the owner, add the required terminal evidence, and remove the task's line from `OPEN.md` in one logical operation.

## Record format

```markdown
---
status: todo
---

# Task title

## Outcome

Observable result.
```

Add body sections only when they carry information needed to resume the task.

## Evidence media

Use standard Markdown image syntax for visual evidence so the task dashboard can display it:

```markdown
![Concise description of the visible evidence](/home/mada/chat/<channel>/.media/<image-file>)
```

## Conditional fields

`awaiting_decision` requires one active decision:

```yaml
status: awaiting_decision
decision:
  question: What should happen?
  options:
    first:
      label: First option
      description: Result of choosing it.
    second:
      label: Second option
      description: Result of choosing it.
  recommendation: first
```

Keep the active question and options only in frontmatter. When resolved, add the question, answer, and rationale once to the body, then remove `decision`.

`waiting` requires one `waiting_for` string. Remove it before changing to another status.

```yaml
status: waiting
waiting_for: The required device becomes available
```

`blocked_by` lists existing task IDs. It is independent of status.

```yaml
blocked_by:
  - prerequisite-task
```

Before setting the status to `done`, add a non-empty `## Completion` section with verification evidence. Before setting it to `canceled`, add a non-empty `## Cancellation` section with the reason. Reopening preserves that history and adds the task's link back to `OPEN.md`.

## Discovered issues

Record actionable issues that need follow-up in the current task if they belong to it; otherwise, create a separate task.

## Workflow

1. Read `tasks/OPEN.md`, then search stable task directories before creating a task.
2. Derive the active owner from the global Session identity and canonical agent path.
3. As coordinator, claim a task with one contextual patch before implementation begins, then re-read the record. Delegated subagents work under the coordinator's claim.
4. Create a stable task directory and add its link to `OPEN.md` when work must survive the current turn.
5. Add numbered tickets beneath the task only when an ordered implementation breakdown is useful.
6. Keep the task and tickets sufficient for a fresh agent to resume without chat history.
7. Prepare required decision history, wait removal, owner removal, completion, cancellation, and `OPEN.md` changes before changing status.
