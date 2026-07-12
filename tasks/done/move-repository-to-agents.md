# Move skills repository to .agents

## Outcome

- Merged all user-managed skills into `/home/mada/.agents/skills`.
- Moved the Git repository and preserved its branch, remote, history, index, and dirty worktree.
- Left Codex built-ins under `/home/mada/.codex/skills/.system`.
- Kept the external `send-files` symlink in the merged repository.
- Backed up the original `.agents/skills` tree and Git metadata under `/tmp`.

## Verification

- Git reports `/home/mada/.agents/skills` as the repository root on `master` with the original remote.
- The old `.codex/skills` path is not a Git repository; its visible `.git` entry is an empty sandbox placeholder.
- Fresh Codex discovery reports 27 total skills, 22 user skills, no duplicate names, and no user skills under the old root.
- `git diff --check` passes.
