---
status: in_progress
owner: bb99cfc7/root
---

# Rewrite skill descriptions around use cases

## Outcome

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
  - The central problem is that an agent may try to show browser-rendered output on `localhost`, which the user cannot access. Trigger whenever the agent needs the user to see HTML or a webpage in a browser, even if the user did not explicitly request deployment or sharing.
  - Evidence: user clarification in audio transcript `c82820ab61adf3e838f562397e69be382e90a0d1846c4beb10116f3ea64648d9.ogg` at `/home/mada/whatsapp-llm-bot/.media/`.
  - Scope is webpages only; disregard the tentative suggestion that other browser-viewable output might belong. Evidence: follow-up audio transcript `ff7036e0a4fec0ef59b02bb492fc40770be30a5dbb27eb95a86fe85a0b5c2559.ogg` in the same media directory.
  - Approved description: `Learn how to put a webpage at a URL the user can open when they ask to publish, deploy, or share it, or when you need to show them an HTML page.`
  - Committed in approved wording passes as `7cedf6a`, `d926912`, and `bcc0511`; frontmatter validation and the Standards and Spec reviews passed.
- **domain-modeling:** Teach how to resolve and document vague or conflicting terminology, ownership, and constraints, and how to preserve hard-to-reverse architectural decisions. The description changes only the routing metadata; the skill procedure remains unchanged.
  - Approved description: `Learn how to document domain terminology, ownership, and constraints when they are vague or conflicting, and preserve architectural decisions that are hard to reverse.`
  - Committed as `53881dd` after frontmatter and task-store validation.
- **grill-me:** Teach a one-question-at-a-time grilling process whose goal is aligning with the user's intent. Specifying intended behaviors is one part of that broader goal; the implementation-ready task is an artifact of the interview rather than its purpose.
  - Approved description: `Learn how to grill the user one question at a time until you reach a shared understanding of their intent.`
  - Initial wording was committed as `7853553`; the approved correction supersedes it in `bc2ec11`.
- **handoff:** Teach how to preserve enough context for unfinished work to continue in another agent or session without changing the skill procedure.
  - Approved description: `Learn how to give another agent or session the context needed to continue unfinished work.`
  - Committed as `3a91321` after frontmatter and task-store validation.
- **image-to-svg:** Teach how to reconstruct a pixel-based reference as an editable vector artifact. Keep `raster` because it precisely names the input format; suitability details remain in the procedure rather than the routing description.
  - Approved description: `Learn how to reconstruct suitable raster references as clean, editable SVGs.`
  - Committed as `baeebe6` after frontmatter and task-store validation.
