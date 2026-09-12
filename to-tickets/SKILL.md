---
name: to-tickets
description: Learn how to break planned work into tickets that agents can implement and verify.
disable-model-invocation: true
---

# To Tickets

Turn the current conversation, plan, or spec into an ordered ticket bundle beneath one managed task. Read and follow [manage-tasks/SKILL.md](../manage-tasks/SKILL.md) before writing it.

## Process

1. Gather context from the current conversation. If the user passed a spec, ticket, or document path, read it first.
2. Explore the codebase only enough to use the project's real domain vocabulary and avoid stale implementation guesses.
3. Create or select the parent task whose outcome the bundle implements.
4. Draft vertical slices. Each ticket should deliver one complete, verifiable behavior or decision.
5. Show the proposed ticket list to the user before writing when the split is ambiguous.
6. Write numbered ticket files under `tasks/<task-id>/tickets/` in intended implementation order. Capture each slice's observable result, acceptance criteria, source context, and real dependencies.

Avoid code snippets unless a prototype or prior decision produced a small snippet that captures the requirement more precisely than prose. Trim snippets to the decision-rich part only.

When the tickets are implementation-ready, work them one at a time. Keep execution status and aggregate completion evidence in the parent task record.
