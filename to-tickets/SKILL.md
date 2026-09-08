---
name: to-tickets
description: Use to learn how to turn conversations, plans, and specifications into agent-ready tickets.
disable-model-invocation: true
---

# To Tickets

Turn the current conversation, plan, or spec into **Markdown ticket files** under `.scratch/<work-slug>/`.

## Output Location

Write files under:

```text
.scratch/<work-slug>/
```

Use this shape:

```text
.scratch/<work-slug>/README.md
.scratch/<work-slug>/tickets/01-<short-title>.md
.scratch/<work-slug>/tickets/02-<short-title>.md
```

If the work is genuinely one slice, create only `tickets/01-<short-title>.md`. If it needs multiple independently implementable slices, create multiple ticket files in dependency order.

## Process

1. Gather context from the current conversation. If the user passed a spec, ticket, or document path, read it first.
2. Explore the codebase only enough to use the project's real domain vocabulary and avoid stale implementation guesses.
3. Draft agent-ready tickets as vertical slices: each ticket should deliver a complete, verifiable behavior or decision.
4. Show the proposed ticket list to the user before writing when the split is ambiguous.
5. Write the files after the breakdown is clear.

## README Template

```markdown
# <Work title>

<One-line summary of the work. Reference the source conversation/spec when useful.>

Work the frontier: any ticket whose blockers are all done can start.

## Tickets

- [01 - <Ticket title>](tickets/01-<short-title>.md) - Blocked by: None
- [02 - <Ticket title>](tickets/02-<short-title>.md) - Blocked by: 01 - <Ticket title>
```

## Ticket Template

```markdown
# <Ticket title>

## What To Build

The end-to-end behavior or decision this ticket delivers, from the user's perspective.

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked By

None — can start immediately.

## Notes

Relevant context, constraints, or source links. Avoid detailed file paths unless the path is itself part of the requirement.
```

Avoid code snippets unless a prototype or prior decision produced a small snippet that captures the requirement more precisely than prose. Trim snippets to the decision-rich part only.

When the tickets are implementation-ready, work the frontier one ticket at a time with `/implement`.
