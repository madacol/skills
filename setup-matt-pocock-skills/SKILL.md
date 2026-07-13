---
name: setup-matt-pocock-skills
description: Configure this repo for the engineering skills — set up its work files and context map. Run once before first use of the other engineering skills.
disable-model-invocation: true
---

# Setup Matt Pocock's Skills

Scaffold the per-repo files that the engineering skills assume:

- **Work files** — specs, tickets, and wayfinding maps under `.scratch/`
- **Domain docs** — the `CONTEXT.md` map and its document ownership

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and its linked documents
- `docs/agents/work-files.md` — does this skill's prior output already exist?
- `.scratch/` — what work files already exist?

### 2. Present findings and ask

Summarise what's present and missing, then confirm the work-file layout and context map.

Use `.scratch/<work-slug>/SPEC.md` for the spec, `.scratch/<work-slug>/README.md` for the ticket index, and `.scratch/<work-slug>/tickets/` for tickets. Record the convention in `docs/agents/work-files.md`.

Show what `CONTEXT.md` covers and any ownership gaps. If it does not exist, propose a minimal map and confirm it before writing.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `CLAUDE.md` / `AGENTS.md` is being edited
- The contents of `docs/agents/work-files.md`
- Any proposed changes to `CONTEXT.md`

Let them edit before writing.

### 4. Write

**Pick the file to edit:**

- If `CLAUDE.md` exists, edit it.
- Else if `AGENTS.md` exists, edit it.
- If neither exists, ask the user which one to create — don't pick for them.

Never create `AGENTS.md` when `CLAUDE.md` already exists (or vice versa) — always edit the one that's already there.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Work files

Specs, tickets, QA reports, and Wayfinder maps live as Markdown under `.scratch/`. See `docs/agents/work-files.md`.
```

Write `docs/agents/work-files.md` using [work-files.md](./work-files.md) as the starting point, and update `CONTEXT.md` as confirmed.

### 5. Done

Tell the user the setup is complete and which engineering skills read these files. Mention they can edit `docs/agents/work-files.md` and `CONTEXT.md` directly later; re-run this skill only to repair or deliberately replace those conventions.
