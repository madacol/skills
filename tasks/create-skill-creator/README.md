---
status: done
---

# Create a skill-creator skill

## Outcome

A fresh-context agent can scaffold, author, validate, test, review, and commit a standalone skill through one concise skill workflow.

## Acceptance criteria

- The creator scaffolds a safe standalone skill directory without overwriting existing work.
- Validation covers required frontmatter, directory naming, unfinished placeholders, and broken local references.
- Instructions define routing descriptions, overlap checks, progressive disclosure, verification, and commit boundaries.
- Automated tests cover creation, idempotence, conflicts, and validation failures.

## Completion

Added the standalone skill workflow, atomic scaffolder, shared naming contract, recursive local-reference validator, and six behavioral tests. The validator accepts all current local skills. Standards and Spec review findings were resolved, `git diff --check` passed, and task validation passed.
