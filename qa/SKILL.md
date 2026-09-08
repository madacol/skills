---
name: qa
description: Use to learn how to turn conversational bug reports into durable tickets.
---

# QA Session

Run an interactive QA session. The user describes problems they're encountering. You clarify, explore the codebase for context, and write durable, user-focused ticket files under `.scratch/`.

## For each ticket the user raises

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

This context helps you write a better ticket — but the ticket itself should NOT reference specific files, line numbers, or internal implementation details.

### 3. Assess scope: single ticket or breakdown?

Before filing, decide whether this is a **single ticket** or needs to be **broken down** into multiple tickets.

Break down when:

- The fix spans multiple independent areas (e.g. "the form validation is wrong AND the success message is missing AND the redirect is broken")
- There are clearly separable concerns that different people could work on in parallel
- The user describes something that has multiple distinct failure modes or symptoms

Keep as a single ticket when:

- It's one behavior that's wrong in one place
- The symptoms are all caused by the same root behavior

### 4. File the ticket(s)

Use the convention in `docs/agents/work-files.md`. Update `.scratch/<work-slug>/README.md`, write each ticket to `.scratch/<work-slug>/tickets/<NN>-<slug>.md`, and share the written paths.

Tickets must be **durable** — they should still make sense after major refactors. Write from the user's perspective.

#### For a single ticket

Use this template:

```
## What happened

[Describe the actual behavior the user experienced, in plain language]

## What I expected

[Describe the expected behavior]

## Steps to reproduce

1. [Concrete, numbered steps a developer can follow]
2. [Use domain terms from the codebase, not internal module names]
3. [Include relevant inputs, flags, or configuration]

## Additional context

[Any extra observations from the user or from codebase exploration that help frame the ticket — e.g. "this only happens when using the Docker layer, not the filesystem layer" — use domain language but don't cite files]
```

#### For a breakdown (multiple tickets)

Create tickets in dependency order (blockers first) so you can reference stable ticket identities.

Use this template for each sub-ticket:

```
## Parent ticket

<parent-ticket-reference> (if you created a tracking ticket) or "Reported during QA session"

## What's wrong

[Describe this specific behavior problem — just this slice, not the whole report]

## What I expected

[Expected behavior for this specific slice]

## Steps to reproduce

1. [Steps specific to THIS ticket]

## Blocked by

- <ticket-reference> (if this ticket can't be fixed until another is resolved)

Or "None — can start immediately" if no blockers.

## Additional context

[Any extra observations relevant to this slice]
```

When creating a breakdown:

- **Prefer many thin tickets over few thick ones** — each should be independently fixable and verifiable
- **Mark blocking relationships honestly** — if ticket B genuinely can't be tested until ticket A is fixed, say so. If they're independent, mark both as "None — can start immediately"
- **Create tickets in dependency order** so you can reference stable ticket identities in "Blocked by"
- **Maximize parallelism** — the goal is that multiple people (or agents) can grab different tickets simultaneously

#### Rules for all ticket bodies

- **No file paths or line numbers** — these go stale
- **Use the project's domain language** from the documents reached through `CONTEXT.md`
- **Describe behaviors, not code** — "the sync service fails to apply the patch" not "applyPatch() throws on line 42"
- **Reproduction steps are mandatory** — if you can't determine them, ask the user
- **Keep it concise** — a developer should be able to read the ticket in 30 seconds

After filing, print all ticket references (with blocking relationships summarized) and ask: "Next ticket, or are we done?"

### 5. Continue the session

Keep going until the user says they're done. Each ticket is independent — don't batch them.
