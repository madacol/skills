import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSkill } from "./create-skill.mjs";
import { SkillValidationError, validateSkill } from "./validate-skill.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-creator-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("creates a skill skeleton without overwriting a completed skill", async (t) => {
  const root = await fixture(t);
  const description = "Use when a release needs a reproducible readiness check.";
  const first = await createSkill(root, "release-check", description);
  assert.equal(first.created, true);
  assert.match(await readFile(first.source, "utf8"), /SKILL-CREATOR:TODO/u);

  const completed = `---\nname: release-check\ndescription: ${JSON.stringify(description)}\n---\n\n# Release check\n\nRun the readiness checks and report failures.\n`;
  await writeFile(first.source, completed);
  assert.equal((await createSkill(root, "release-check", description)).created, false);
  assert.equal(await readFile(first.source, "utf8"), completed);
  assert.equal((await validateSkill(first.directory)).name, "release-check");
});

test("rejects invalid names, changed descriptions, and occupied directories", async (t) => {
  const root = await fixture(t);
  await assert.rejects(createSkill(root, "Bad_Name", "Use when testing."), /lowercase kebab-case/u);
  await createSkill(root, "existing-skill", "Use when the first situation occurs.");
  await assert.rejects(createSkill(root, "existing-skill", "Use when a different situation occurs."), /different description/u);
  await mkdir(path.join(root, "occupied-skill"));
  await writeFile(path.join(root, "occupied-skill", "notes.md"), "existing work\n");
  await assert.rejects(createSkill(root, "occupied-skill", "Use when notes need work."), /not empty/u);
  const outside = await fixture(t);
  await symlink(outside, path.join(root, "linked-skill"), "dir");
  await assert.rejects(createSkill(root, "linked-skill", "Use when links are unsafe."), /real directory/u);
});

test("concurrent identical creation is idempotent", async (t) => {
  const root = await fixture(t);
  const description = "Use when concurrent agents need the same workflow.";
  const results = await Promise.all([
    createSkill(root, "shared-skill", description),
    createSkill(root, "shared-skill", description),
  ]);
  assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
});

test("validator rejects unfinished skills and broken local references", async (t) => {
  const root = await fixture(t);
  const created = await createSkill(root, "reference-skill", "Use when a workflow needs its local reference.");
  await assert.rejects(validateSkill(created.directory), SkillValidationError);

  await writeFile(created.source, "---\nname: reference-skill\ndescription: Use when a workflow needs its local reference.\n---\n\n# Reference skill\n\nRead [the guide](references/guide.md \"Guide\").\n");
  await assert.rejects(validateSkill(created.directory), /missing local reference/u);
  await mkdir(path.join(created.directory, "references"));
  await writeFile(path.join(created.directory, "references", "guide.md"), "# Guide\n\nContinue with [details](details.md).\n");
  await assert.rejects(validateSkill(created.directory), /missing local reference/u);
  await writeFile(path.join(created.directory, "references", "details.md"), "# Details\n");
  await validateSkill(created.directory);
});

test("validator rejects malformed or mismatched manifests", async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, "expected-name");
  await mkdir(directory);
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: another-name\ndescription: First.\ndescription: Second.\n---\n\n# Skill\n\nInstructions.\n");
  await assert.rejects(validateSkill(directory), /duplicate frontmatter key/u);
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: another-name\ndescription: Use when needed.\n---\n\n# Skill\n\nInstructions.\n");
  await assert.rejects(validateSkill(directory), /name must match directory/u);
});

test("validator accepts optional nested metadata", async (t) => {
  const root = await fixture(t);
  const directory = path.join(root, "metadata-skill");
  await mkdir(directory);
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: metadata-skill\ndescription: Use when metadata belongs in a valid skill.\nmetadata:\n  short-description: Metadata example\n---\n\nInstructions can begin without a heading.\n");
  await validateSkill(directory);
});
