---
name: grill-me
description: Learn how to grill the user one question at a time until you reach a shared understanding of their intent.
disable-model-invocation: true
---

Interview the user relentlessly about every aspect of the plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one. Recommend an answer with each question.

The interview builds an implementation-ready task brief as it progresses. Before asking the first question, read and follow [manage-tasks/SKILL.md](../manage-tasks/SKILL.md), then create or select the active task.

Ask one question at a time and wait for feedback before continuing. If you can find a fact by exploring the codebase, look it up. Put decisions to the user.

Update context documents and ADRs only when the user asks. In that mode, read and follow [domain-modeling/SKILL.md](../domain-modeling/SKILL.md).
