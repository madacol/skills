# Consolidate duplicate architecture skills

## Goal

Keep one discoverable copy of each duplicated skill while preserving the custom architecture-document routing and delegating shared behavior to Matt Pocock's modular skills.

## Outcome

- Consolidated the six duplicated skill names into one canonical copy before the merged repository moved to `.agents/skills`.
- Refactored `improve-codebase-architecture` to delegate vocabulary and interface design to `codebase-design`, interviewing to `grilling`, and documentation maintenance to `domain-modeling`.
- Standardized `domain-modeling` on `CONTEXT.md` as a navigational map whose linked documents own concepts, constraints, and decisions.
- Removed redundant architecture vocabulary, deepening, and interface-design files.
- Converted `grill-me` into a thin wrapper around `grilling`.
- Moved the duplicate `.agents/skills` directories to `/tmp/agents-skills-dedup-backup-20260712`.

## Verification

- `git diff --check` passed.
- Canonical skill references and delegated `codebase-design` files exist.
- Unique Matt Pocock skills remain installed under `.agents/skills`.
- Fresh `codex debug prompt-input` discovery reported 27 skills and no duplicate names.
