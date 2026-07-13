# Align engineering skill workflows and terminology

## Goal

Remove the triage workflow and make the remaining engineering skills agree on implementation review, spec and ticket terminology, seams, TDD refactoring, and tracker-neutral wayfinding.

## Decisions

- `/implement` records its starting `HEAD`; `/code-review` accepts workflow-supplied baselines and supports committed or working-tree reviews, including untracked files.
- Matt Pocock's local workflow uses specs and tickets: `SPEC.md`, `README.md`, and `tickets/`.
- Removed `/triage`, its supporting documents, label mapping, and setup surfaces.
- TDD uses `/codebase-design`'s module-relative seam definition and restores the red-green-refactor loop.
- Preserved the user's existing TDD rule about testing retained behavior when features are removed.
- `/to-spec` synthesizes settled context and asks only for one testing-seam confirmation.
- `/wayfinder` is tracker-neutral; tracker adapters own identity, claims, dependencies, and resolution storage.
- Local Wayfinder claims use exclusive per-ticket directories so concurrent sessions cannot claim the same ticket.

## Outcome

- Updated implementation, review, TDD, specification, QA, handoff, setup, and Wayfinder instructions to share the same contracts and terminology.
- Updated GitHub, GitLab, and local work-tracker templates while preserving platform-native `issue` terminology where it names actual platform primitives.
- Deleted the triage skill and its obsolete setup configuration.

## Verification

- `git diff --check` passes.
- Active Markdown contains no stale triage, PRD, local `issues/`, old TDD-loop, or remote-only Wayfinder language; remaining `issue` matches are platform-native.
- All active skill files have closing frontmatter delimiters.
- All directly referenced skill documentation files exist.
- `/code-review` Standards axis: no hard violations; its one local-claim concurrency finding was fixed and the re-review passed.
- `/code-review` Spec axis: no findings.
- Codex catalog-debug validation was attempted but could not create its home state in the read-only sandbox; repository-level discovery lists 20 active local skills and excludes `/triage`.
- No executable tests apply to these instruction-only changes.
- The final reviewed state is included in the commit that archives this task.
