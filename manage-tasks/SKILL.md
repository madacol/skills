---
name: manage-tasks
description: Use when work needs durable task state across turns or sessions.
---

# Manage tasks

Set up and register the task store with this idempotent command:

```sh
node <skill-directory>/scripts/setup-task-store.mjs <workspace-directory> <project-slug>
```

Dashboard: `https://task.babyjarvis.com/<project-slug>/`

Use `tasks/open/<task-id>.md` while work may continue. Move the same file to `tasks/closed/` when it is done or canceled.

Use one source for each fact:

- Filename is the task ID.
- First H1 is the title.
- Frontmatter stores current status, an active decision, an external wait, and task dependencies.
- Frontmatter `owner` stores the active agent's short Session and agent identity.
- Markdown sections store the outcome, context, evidence, constraints, acceptance criteria, completion, cancellation, and resolved decisions.
- Git history supplies update history.

## Validation

The bundled validator is dependency-free Node.js:

```sh
node <skill-directory>/scripts/validate-tasks.mjs tasks
```

Run it once before ending any turn that created, edited, moved, or closed a task record. It does not need to run after each individual change.

## Statuses

| Status | Use | Folder |
|---|---|---|
| `todo` | Accepted and ready, not started | `open/` |
| `in_progress` | Work can continue now | `open/` |
| `awaiting_decision` | The user must answer one question | `open/` |
| `waiting` | An external event or resource is required | `open/` |
| `done` | Outcome met with completion evidence | `closed/` |
| `canceled` | Stopped without meeting the outcome | `closed/` |

## Active ownership

Before changing implementation or evidence for a task, claim it with an `owner` field while setting or retaining `status: in_progress`:

```yaml
status: in_progress
owner: 8e25a58d/root
```

`owner` combines an eight-character Session fingerprint with the agent's canonical path. Hash the full global Session ID with SHA-256, take the first eight lowercase hexadecimal characters, then append the canonical path supplied by the agent runtime. For Codex, derive the fingerprint from `CODEX_THREAD_ID`. The primary agent is `/root`; a child might be `/root/status_tests`; a nested child might be `/root/status_tests/reviewer`. The resulting owners are `8e25a58d/root`, `8e25a58d/root/status_tests`, and `8e25a58d/root/status_tests/reviewer` when `8e25a58d` is that Session's fingerprint.

Hash the full Session ID instead of copying its literal prefix. Time-ordered IDs can share leading characters. Use the stable global Session ID and canonical agent path, not an Invocation, turn, process, opaque spawn ID, or reusable agent role. Never invent or guess either component.

The validator accepts a bare eight-character owner already written by an active agent during migration. Do not create new owners in that legacy format.

An agent may own multiple active tasks. Different agents in one Session have different owners, including parent and nested subagents. Do not edit a task owned by another agent. A subagent that changes implementation must claim its own task; a read-only helper does not claim its parent's task. If an `in_progress` task has no owner during migration, treat it as potentially active: claim it only when no concurrent work is evident. A stale owner may be replaced only with explicit user direction; never infer that an agent is dead from silence.

Claim with one compare-and-set patch whose context includes the complete current unowned frontmatter. A competing ownership patch should fail after the first patch changes those lines. Check the patch result and re-read the record before touching implementation files. Stop if the patch failed or the re-read names another owner. Do not overwrite ownership with a whole-file write or a patch that omits the unowned frontmatter anchors.

Remove `owner` whenever status changes away from `in_progress`. When completing or canceling owned work, change status, remove owner, add the required terminal evidence, and move the same file in one logical operation.

## Record format

```markdown
---
status: todo
---

# Task title

## Outcome

Observable result.
```

Add body sections only when they carry information needed to resume the task. Record facts, uncertainty, evidence, constraints, acceptance criteria, and relevant history.

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

Before setting the status to `done`, add a non-empty `## Completion` section with verification evidence. Before setting it to `canceled`, add a non-empty `## Cancellation` section with the reason. Reopening preserves that history and moves the same file back to `open/`.

## Workflow

1. Search `open/` and `closed/` before creating a task.
2. Read `CODEX_THREAD_ID` or the equivalent global Session identity and the canonical agent path supplied by the active runtime. Derive the eight-character SHA-256 Session fingerprint and append the path.
3. Claim a task with one contextual patch before editing its implementation surfaces, then re-read the record. Stop if the patch failed or another agent owns the task.
4. Create a task for work or evidence that must survive the current turn.
5. Keep its record sufficient for a fresh agent to resume without chat history.
6. Prepare required decision history, wait removal, owner removal, completion, or cancellation before changing status.
