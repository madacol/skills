---
name: qa
description: Learn how to turn problems reported by the user into clear, reproducible tasks for fixing them.
---

# QA Session

Run an interactive QA session. The user describes problems they're encountering. You clarify, explore the codebase for context, and create durable, user-focused tasks.

## For each issue the user raises

### 1. Listen and lightly clarify

Let the user describe the problem in their own words. Ask **at most 2-3 short clarifying questions** focused on:

- What they expected vs what actually happened
- Steps to reproduce (if not obvious)
- Whether it's consistent or intermittent

Do NOT over-interview. If the description is clear enough to file, move on.

### 2. Explore the codebase in the background

While talking to the user, start an explorer sub-agent in the background to understand the relevant area. The goal is NOT to find a fix — it's to:

- Learn the domain language used in that area from `CONTEXT.md` and the relevant documents it links
- Understand what the feature is supposed to do
- Identify the user-facing behavior boundary

This context helps you write a better task, but the task itself should not reference specific files, line numbers, or internal implementation details.

### 3. Assess scope: task only or ticket breakdown?

Each reported issue becomes one managed task. Decide whether its implementation is one slice described by the task or needs several tickets beneath it.

Break down when:

- The fix spans multiple independent areas (e.g. "the form validation is wrong AND the success message is missing AND the redirect is broken")
- There are clearly separable concerns that different people could work on in parallel
- The user describes something that has multiple distinct failure modes or symptoms

Keep it as one task when:

- It's one behavior that's wrong in one place
- The symptoms are all caused by the same root behavior

### 4. File the task and any tickets

Read and follow [manage-tasks/SKILL.md](../manage-tasks/SKILL.md) before filing the first task.

Create one managed task for the reported problem. Add numbered tickets beneath it when the problem contains several independently fixable slices.

Tasks must remain useful after major refactors. Write from the user's perspective.

Each task should capture:

- the expected user-facing behavior
- what happened and any conditions that matter
- concrete reproduction steps
- acceptance criteria for the restored behavior

#### For a ticket breakdown

Create thin tickets that different agents could implement independently. Put blockers first and link a ticket under `## Blocked by` only when it genuinely cannot proceed until another ticket finishes.

#### Rules for all task and ticket bodies

- **No file paths or line numbers** — these go stale
- **Use the project's domain language** from the documents reached through `CONTEXT.md`
- **Describe behaviors, not code** — "the sync service fails to apply the patch" not "applyPatch() throws on line 42"
- **Reproduction steps are mandatory** — if you can't determine them, ask the user
- **Keep it concise** — a developer should be able to read the task in 30 seconds

After filing, share the task reference and any ticket references, then ask: "Next issue, or are we done?"

### 5. Continue the session

Keep going until the user says they're done. File each issue before moving to the next one.
