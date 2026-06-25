---
name: manage-tasks
description: Maintain durable task tracking files for ongoing work. Use when asked to add, update, clarify, investigate, complete, archive, or review todos/tasks; when managing tasks/todo.md, tasks/done/, task files, evidence files, blockers, acceptance criteria, or durable work notes; or when a task must survive beyond the current chat context.
---

# Manage Tasks

## Purpose

Use task tracking as durable working memory, not as a vague reminder list. The index should stay brief; the linked task file should contain the evidence-backed task brief needed to resume work without chat history.

## Core Workflow

1. Keep the task index brief and scannable. Track only pending, active, and blocked work there.
2. Create or update a task file for any non-trivial task, any ambiguous task, or any task with useful context, evidence, decisions, constraints, blockers, or acceptance criteria.
3. Write the task file in precise, agent-chosen language. Treat user wording as evidence, not authoritative terminology. Infer the intended subject from nearby context.
4. If the subject or owner layer is ambiguous, record the ambiguity and plausible interpretations. Do not implement behavior-changing work until the ambiguity is resolved by evidence or clarification.
5. Preserve high-signal evidence in the task file or linked evidence files. Evidence may be short or long; include whatever materially helps future work, but organize it so the task brief remains usable.
6. Keep task state synchronized: when a task is active, blocked, pending, or complete, update the index and task file together.
7. When complete, remove the task from the index, move its task file under the done area, and add a concise done entry. Do not delete completed task files.

## Task File Requirements

A task file should make these things clear enough for a future agent to continue:

- the inferred subject of the task;
- what is known, what is inferred, and what remains ambiguous;
- the evidence supporting the current understanding;
- constraints, non-goals, owner layer, and safety concerns;
- the next action or blocker;
- acceptance criteria for completion;
- completion notes and verification when archived.

Use headings that fit the task. Prefer clarity and evidence over a rigid template.

## Ambiguity Discipline

Ambiguous tasks may be recorded immediately so they are not lost, but ambiguity must be visible in the task file and must constrain action. If multiple plausible subjects remain, list them with evidence and state what would disambiguate them. Avoid turning a vague task into implementation work by silently choosing a convenient interpretation.

## Evidence Discipline

Include evidence when it changes how the task should be understood or executed. Evidence can include user statements, logs, screenshots, command output, traces, file paths, decisions, failed attempts, or any other useful source. Keep the main task file readable; split large evidence into linked files when that improves scanability.

## Completion Discipline

A completed task should leave enough context to understand what was done and why. Archive the task file instead of deleting it. The done entry should be concise, but the archived task file should retain the durable task brief, important evidence, and verification.
