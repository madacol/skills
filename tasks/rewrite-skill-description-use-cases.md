# Rewrite skill descriptions around use cases

## Goal

Correct the skill descriptions so a fresh agent sees the situations and user needs each skill solves, rather than a capability summary with `Use when` prepended.

## Evidence

The previous pass standardized the grammar but did not consistently change perspective. The user clarified that descriptions should express concrete or compactly generalized use cases: what situation the user or agent is in, what problem needs solving, and enough context to select the right skill.

After the body-level audit, the user requested a grilling session covering every skill. Settle the intended routing use cases one skill at a time before rewriting the descriptions.

## Workflow

Handle one skill at a time: settle its use cases through grilling, rewrite only that description, present it for user verification, commit after approval, then move to the next skill.

## Acceptance criteria

- Audit every tracked skill against its body and identify its actual triggering use cases.
- Describe user situations, problems, or desired outcomes; avoid tautologies based on the skill name or procedure.
- Cover materially different use cases without making descriptions unnecessarily long.
- Preserve clear boundaries between overlapping skills.
- Keep skill procedures unchanged and frontmatter valid.
- Forward-test routing from fresh context and pass Standards and Spec review.

## Verification

- Validate all tracked skill frontmatter.
- Compare every description with the skill's supported use cases.
- Give fresh-context agents raw skill artifacts and evaluate their routing decisions.
- Run the repository's two-axis code review from baseline `8959df2e138d0a7ce6669d7ab057689898be37e7`.

## Notes

This is metadata-only documentation work, so there is no executable red-green test seam.

Two fresh-context agents independently inferred trigger situations from the skill bodies. Their results are working evidence for the grilling questions, not final wording.

## Routing decisions

- **code-review:** Its metadata should automatically route complex changes into an independent Standards-and-Spec review. Keep `complex` deliberately undefined so the agent can judge it from context. Explicit user requests remain direct invocations and do not need to be the description's main routing case.
  - Approved description: `Independent Standards-and-Spec review for complex changes at risk of repository-standard violations, scope drift, or missed spec/ticket requirements.`
  - Committed as `6f0599e` after frontmatter validation and clean Standards and Spec reviews.
- **codebase-design:** Trigger for all non-trivial module design, including new modules and reshaping existing ones; do not wait for architectural friction to appear first. Also trigger when a workflow must choose or dispute a testing seam, because that decision defines the module interface. Do not trigger merely to use an existing, agreed seam, or for architecture assessment/discussion when no interface change is planned.
  - The latest proposal was rejected because it named design activities rather than the underlying situations that make the skill useful. The next wording must route from concrete problems such as a new feature needing a boundary, behavior scattered across callers, interchangeable implementations needing one contract, or tests reaching into internals.
  - Approved use cases: a substantial new feature needs a boundary; behavior is duplicated across callers; one change spreads across callers; multiple implementations need one contract; tests must reach into internals; or several plausible interfaces need comparison.
  - Proposed description: `Use when a new feature with substantial behavior needs a clear module boundary, logic is duplicated or scattered across callers, implementations need a shared contract, tests must reach into internals, or several interfaces could work. Helps shape a simple, testable interface around the behavior.`
  - Committed as `e355512` after frontmatter validation and clean Standards and Spec reviews.
- **deploy-webpage:** Trigger both for explicit deploy/publish/share requests and after building web output that the user needs to inspect through a stable browser URL.
