# Software

Use when the user has code, data, tests, logs, PRs, CI, deployments, or product behavior.

| User has | Ask me to | Output |
|---|---|---|
| Failing CI | “Find the failure and verify the fix path.” | Root cause, suspect diff, local reproduction, test evidence. |
| Vague bug report | “Reproduce it and make it testable.” | Minimal repro, failing test, fix or patch plan. |
| Open PR | “Review this with separate lenses.” | Security/correctness/test/UX/maintainability findings by severity. |
| Legacy subsystem | “Migrate this in safe batches.” | Map, batch plan, changed files, regression checks, rollback notes. |
| Release candidate | “Prepare go/no-go.” | Test status, migrations, flags, docs, rollback, approval list. |
| Dependency alert | “Triage real exposure.” | Reachability, affected code, upgrade path, test plan. |
| API/webhook breakage | “Compare payloads, docs, code, tests.” | Contract mismatch, fixture, parser fix, regression check. |
| Data backfill | “Design dry run and validation.” | Script/query plan, counts, rollback, production gate. |
| UI flow | “Drive the browser and capture evidence.” | Screenshots, console/log findings, reproduction steps. |
| LLM behavior | “Build evals.” | Fixtures, scoring rubric, failing cases, repeatable eval command. |
