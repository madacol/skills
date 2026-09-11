import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setupTaskStore } from "./setup-task-store.mjs";

async function workspace(t, name) {
  const root = await mkdtemp(path.join(os.tmpdir(), `${name}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("sets up a workspace task store idempotently and rejects slug conflicts", async (t) => {
  const firstWorkspace = await workspace(t, "dashboard-first");
  const secondWorkspace = await workspace(t, "dashboard-second");
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), "dashboard-projects-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));

  const first = await setupTaskStore(firstWorkspace, "first-project", { projectsRoot });
  assert.equal(first.registrationCreated, true);
  assert.equal((await stat(path.join(firstWorkspace, "tasks"))).isDirectory(), true);
  assert.equal(await readFile(path.join(firstWorkspace, "tasks", "OPEN.md"), "utf8"), "# Open tasks\n");
  assert.equal(path.resolve(projectsRoot, await readlink(first.linkPath)), path.join(firstWorkspace, "tasks"));

  const existingTask = path.join(firstWorkspace, "tasks", "keep-me");
  await mkdir(existingTask);
  await writeFile(path.join(existingTask, "README.md"), "existing task\n");
  const repeated = await setupTaskStore(firstWorkspace, "first-project", { projectsRoot });
  assert.equal(repeated.registrationCreated, false);
  assert.deepEqual(repeated.createdDirectories, []);
  assert.deepEqual(repeated.createdFiles, []);
  assert.equal(await readFile(path.join(existingTask, "README.md"), "utf8"), "existing task\n");

  await assert.rejects(setupTaskStore(secondWorkspace, "first-project", { projectsRoot }), /already points/u);
  assert.equal(await readFile(path.join(secondWorkspace, "tasks", "OPEN.md"), "utf8"), "# Open tasks\n");

  const raced = await Promise.all([
    setupTaskStore(firstWorkspace, "race-project", { projectsRoot }),
    setupTaskStore(firstWorkspace, "race-project", { projectsRoot }),
  ]);
  assert.deepEqual(raced.map((result) => result.registrationCreated).sort(), [false, true]);
});

test("registers an existing legacy store without introducing OPEN.md", async (t) => {
  const root = await workspace(t, "dashboard-legacy");
  const projectsRoot = await mkdtemp(path.join(os.tmpdir(), "dashboard-projects-"));
  t.after(() => rm(projectsRoot, { recursive: true, force: true }));
  await mkdir(path.join(root, "tasks", "open"), { recursive: true });
  await mkdir(path.join(root, "tasks", "closed"));

  const result = await setupTaskStore(root, "legacy-project", { projectsRoot });
  assert.deepEqual(result.createdFiles, []);
  await assert.rejects(readFile(path.join(root, "tasks", "OPEN.md")), /ENOENT/u);
});
