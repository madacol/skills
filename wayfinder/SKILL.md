---
name: wayfinder
description: Learn how to investigate an uncertain route to a goal and resolve the decisions needed to make it clear across sessions.
disable-model-invocation: true
---

# Wayfinder

Use Wayfinder when the destination is clear enough to name but the route requires several sessions of decisions or investigation. Read and follow [manage-tasks/SKILL.md](../manage-tasks/SKILL.md) for every actionable item.

Wayfinder plans by default. Stop when the route to the destination is clear. Do not implement the destination unless the map explicitly includes execution.

## Map

Keep the shared map at `.scratch/<effort>/map.md`:

```markdown
## Destination

<What the effort must produce or decide.>

## Notes

<Relevant domain, skills, and standing constraints.>

## Decisions so far

- [<completed task title>](<managed-task-link>): <one-line result>

## Not yet specified

<In-scope questions that are not precise enough to become tasks.>

## Out of scope

<Work excluded from this effort.>
```

The map indexes decisions but does not duplicate their details. Refer to tasks by linked title in user-facing writing.

## Tasks

Create each precise question or prerequisite as a managed task. Prefix its task ID with `wayfinder-<effort>-<nn>-` so later sessions can find the effort's tasks in order.

Follow the managed task structure. Include the decision or result to produce, a link to the map, and one method:

- `research` for facts from documentation, APIs, or other sources
- `prototype` for a rough artifact that lets the user judge behavior or appearance
- `grilling` for a live `/grill-me` and `/domain-modeling` conversation
- `task` for prerequisite work that must finish before a decision can be made

Store research notes and prototype assets under `.scratch/<effort>/` and link them from the task. Let `manage-tasks` own all task storage and lifecycle details.

Research can proceed independently. Prototyping and grilling require live user participation to resolve the question; never supply the user's answers or judgments yourself. Use grilling by default when the method is unclear.

Prerequisite work belongs in the map because it enables a decision. Do it independently when possible; otherwise give the user a precise checklist. Record what was done and the resulting facts that later decisions depend on.

## Not yet specified and out of scope

Create a task when you can state its question precisely, even if dependencies prevent work from starting. Use `Not yet specified` when you cannot yet formulate the question clearly. Do not divide unclear future work into task-sized pieces prematurely: one unresolved area may eventually produce several tasks or none.

As decisions clarify the route, turn newly precise questions into tasks and remove their corresponding entries from `Not yet specified`. Keep completed decisions, existing tasks, and excluded work out of that section.

The destination defines scope. Record excluded work under `Out of scope`, separately from decisions that advance the route. If an existing task proves out of scope, cancel it through `manage-tasks` and link it there with the reason, rather than adding it to `Decisions so far`. Reconsider excluded work only when the destination changes.

## Chart the map

1. Use `/grill-me` and `/domain-modeling` to name the destination.
2. Explore breadth first. Put precise questions into managed tasks and leave unclear questions under `Not yet specified`.
3. Create the map and all currently visible tasks. Use numeric task prefixes to preserve their intended order.
4. Stop after charting. Do not also resolve a task in the same session.

If the whole route already fits one session, do not create a Wayfinder map.

## Work through the map

Resolve at most one Wayfinder task per session.

1. Read the whole map once per session to orient to the destination. Use `manage-tasks` to find tasks whose IDs start with `wayfinder-<effort>-`; do not load every task body upfront.
2. Choose the first unfinished, unblocked, unclaimed task in numeric order unless the user named another task. Follow `manage-tasks` to claim it before working.
3. Work it through `manage-tasks`, using the method named in its context and the skills listed in the map's Notes. Read related task details only as needed.
4. Add completed decisions to the map with a link to the managed task.
5. Create newly visible tasks and move newly precise questions out of `Not yet specified`. Record dependencies after the related tasks exist. Revise or cancel tasks invalidated by the decision; record out-of-scope cancellations under `Out of scope` with their reasons.

Other sessions may work on different tasks. Follow `manage-tasks` when coordinating with them.
