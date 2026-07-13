# Standardize skill-description routing

## Goal

Rewrite every tracked skill description as concise guidance that tells a fresh agent when the skill should be read or used.

## Acceptance criteria

- Every tracked `SKILL.md` description is framed as an invocation condition rather than a feature summary.
- Descriptions remain concise while preserving the distinctions needed to choose among overlapping skills.
- Only frontmatter descriptions change; skill procedures and behavior remain intact.
- Frontmatter remains valid and every tracked skill retains exactly one description.
- The completed diff passes Standards and Spec review.

## Verification

- Confirmed all 20 tracked descriptions begin with an invocation condition and each tracked skill retains exactly one description.
- Confirmed each skill-file diff changes one description line and no procedure content.
- `git diff --check` passed.
- Standards review passed with no actionable findings.
- Spec review passed after clarifying Wayfinder continuation and the `grill-me` documentation boundary.

## Notes

This was metadata-only documentation work, so there was no executable test seam for a red-green cycle.
