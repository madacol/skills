---
name: setup-matt-pocock-skills
description: Configure this repo for the engineering skills — set up its work tracker and context-map conventions. Run once before first use of the other engineering skills.
disable-model-invocation: true
---

# Setup Matt Pocock's Skills

Scaffold the per-repo configuration that the engineering skills assume:

- **Work tracker** — where specs, tickets, and wayfinding maps live (GitHub by default; local markdown is also supported out of the box)
- **Domain docs** — the `CONTEXT.md` map and its document ownership

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config` — is this a GitHub repo? Which one?
- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and its linked documents
- `docs/agents/` — does this skill's prior output already exist?
- `.scratch/` — sign that a local-markdown work tracker convention is already in use

### 2. Present findings and ask

Summarise what's present and missing. Walk through the work-tracker decision, then confirm the context map.

Assume the user does not know what these terms mean. Each section starts with a short explainer (what it is, why these skills need it, what changes if they pick differently). Then show the choices and the default.

**Section A — Work tracker.**

> Explainer: The "work tracker" is where durable specs, tickets, and wayfinding maps live for this repo. Skills such as `to-spec`, `qa`, and `wayfinder` need to know whether to call a platform's issue commands, write Markdown under `.scratch/`, or follow another workflow you describe. The `to-tickets` skill always creates local Markdown tickets and does not depend on this choice.

Default posture: these skills were designed for GitHub. If a `git remote` points at GitHub, propose that. If a `git remote` points at GitLab (`gitlab.com` or a self-hosted host), propose GitLab. Otherwise (or if the user prefers), offer:

- **GitHub** — work items use the repo's GitHub Issues (uses the `gh` CLI)
- **GitLab** — work items use the repo's GitLab Issues (uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI)
- **Local markdown** — specs and tickets live under `.scratch/<work>/` in this repo (good for solo projects or repos without a remote)
- **Other** (Jira, Linear, etc.) — ask the user to describe the workflow in one paragraph; the skill will record it as freeform prose

**Section B — Context map.**

Show what `CONTEXT.md` covers and any ownership gaps. If it does not exist, propose a minimal map and confirm it before writing.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `CLAUDE.md` / `AGENTS.md` is being edited (see step 4 for selection rules)
- The contents of `docs/agents/issue-tracker.md`
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

### Work tracker

[one-line summary of where specs, tickets, and wayfinding maps are tracked]. See `docs/agents/issue-tracker.md`.
```

Then write the tracker doc using the seed templates in this skill folder as a starting point, and update `CONTEXT.md` as confirmed:

- [issue-tracker-github.md](./issue-tracker-github.md) — GitHub work tracker
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md) — GitLab work tracker
- [issue-tracker-local.md](./issue-tracker-local.md) — local-markdown work tracker

For other work trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description.

### 5. Done

Tell the user the setup is complete and which engineering skills will now read from these files. Mention they can edit the tracker doc and `CONTEXT.md` directly later — re-running this skill is only necessary if they want to switch work trackers or restart from scratch.
