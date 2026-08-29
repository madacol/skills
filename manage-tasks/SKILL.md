---
name: manage-tasks
description: Use when work needs durable task state across turns or sessions.
---

# Manage tasks

Keep one canonical Markdown file per task:

```text
tasks/
  open/
  closed/
```

Use `tasks/open/<task-id>.md` while work may continue. Move the same file to `tasks/closed/` when it is done or canceled.

Use one source for each fact:

- Filename is the task ID.
- First H1 is the title.
- Frontmatter stores current status, an active decision, an external wait, and task dependencies.
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
2. Create a task for work or evidence that must survive the current turn.
3. Keep its record sufficient for a fresh agent to resume without chat history.
4. Prepare required decision history, wait removal, completion, or cancellation before changing status.
