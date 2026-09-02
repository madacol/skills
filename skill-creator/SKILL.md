---
name: skill-creator
description: Use when creating a new standalone skill or turning an informal agent workflow into a reusable skill directory with clear routing, concise instructions, validation, and tests.
---

# Create a skill

Use this workflow for a standalone skill directory. Creating a plugin bundle, marketplace entry, or plugin manifest belongs to the plugin-creation workflow instead.

Before writing files, inspect nearby skills and settle:

- The concrete situations that should trigger this skill.
- What similar skills already handle and where this skill stops.
- Which behavior belongs in scripts because prose would make every agent reimplement it.

Draft from the perspective of a fresh-context agent handling one representative main use case. Include only the information and actions that agent needs to finish correctly. Check the other intended use cases, then add only the differences they require. Remove background, implementation details, and explanations that do not change what the agent must do.

Choose a lowercase kebab-case name. Write the description as routing guidance based on user situations or agent problems, not as a summary of the skill name.

Scaffold without overwriting existing work:

```sh
node <skill-directory>/scripts/create-skill.mjs <skills-root> <skill-name> --description "<routing description>"
```

Replace the generated placeholder. Keep `SKILL.md` focused on decisions and actions that apply every time. Put conditional detail in linked reference files. Put deterministic or error-prone behavior in tested scripts. Add assets or templates only when agents should reuse them verbatim.

Use relative Markdown links for skill-local resources. Resolve them from the directory containing `SKILL.md`.

Validate the finished skill:

```sh
node <skill-directory>/scripts/validate-skill.mjs <new-skill-directory>
```

Then verify any bundled scripts, test routing with fresh-context scenarios that include both positive and near-miss cases, and confirm the intended runtime discovers the directory from its skill root. Review the diff for unnecessary instructions or overlap. Keep unrelated changes out of the commit.
