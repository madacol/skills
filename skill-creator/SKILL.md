---
name: skill-creator
description: Learn how the user prefers to shape skills.
---

# Create a skill

Identify the reusable method the agent needs to learn, beyond what a capable agent would already infer. Check nearby skills for overlap.

Create `<skills-root>/<skill-name>/SKILL.md` with YAML frontmatter containing `name` and a use-case `description`. Write the shortest instructions that teach a fresh-context agent the common paths covering most requests. Leave simple variations implicit; link to a focused reference file when a complex path needs more detail. Omit one-off facts and background.
