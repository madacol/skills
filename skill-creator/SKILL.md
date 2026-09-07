---
name: skill-creator
description: Use when creating a standalone skill or turning an agent workflow into reusable skill instructions.
---

# Create a skill

Create `<skills-root>/<skill-name>/SKILL.md` with lowercase kebab-case names and this frontmatter:

```yaml
---
name: skill-name
description: Describe the situations that should trigger this skill.
---
```

Write from the perspective of a fresh-context agent handling one representative main use case. Include only what that agent needs to finish correctly. Check the other intended use cases and add only their required differences.

Inspect nearby skill descriptions to avoid overlap. Add references, scripts, assets, or tests only when the intended use cases require them. Remove background and implementation details that do not change the agent's actions.
