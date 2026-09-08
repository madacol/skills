---
name: domain-modeling
description: Learn how to document domain terminology, ownership, and constraints when they are vague or conflicting, and preserve architectural decisions that are hard to reverse.
---

# Domain Modeling

Read `CONTEXT.md` first. It is the map to the documents that own project concepts, constraints, and decisions. If it does not exist, continue from the codebase and create it only when durable knowledge needs to be recorded.

During the session:

- Challenge vague or conflicting terms with concrete scenarios and code evidence.
- Record each resolved concept or rule in its owning context or area document; keep `CONTEXT.md` navigational.
- Create a new owning document lazily and add it to the map.

Offer an ADR only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Use [ADR-FORMAT.md](./ADR-FORMAT.md).
