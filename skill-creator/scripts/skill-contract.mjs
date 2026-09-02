const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isSkillName(value) {
  return typeof value === "string" && SKILL_NAME_PATTERN.test(value);
}
