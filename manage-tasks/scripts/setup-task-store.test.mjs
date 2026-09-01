import assert from "node:assert/strict";
import { mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
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
  assert.equal((await stat(path.join(firstWorkspace, "tasks", "open"))).isDirectory(), true);
  assert.equal((await stat(path.join(firstWorkspace, "tasks", "closed"))).isDirectory(), true);
  assert.equal(path.resolve(projectsRoot, await readlink(first.linkPath)), path.join(firstWorkspace, "tasks"));

  const existingTask = path.join(firstWorkspace, "tasks", "open", "keep-me.md");
  await writeFile(existingTask, "existing task\n");
  const repeated = await setupTaskStore(firstWorkspace, "first-project", { projectsRoot });
  assert.equal(repeated.registrationCreated, false);
  assert.deepEqual(repeated.createdDirectories, []);
  assert.equal(await readFile(existingTask, "utf8"), "existing task\n");

  await assert.rejects(setupTaskStore(secondWorkspace, "first-project", { projectsRoot }), /already points/u);
  assert.equal((await stat(path.join(secondWorkspace, "tasks", "open"))).isDirectory(), true);
  assert.equal((await stat(path.join(secondWorkspace, "tasks", "closed"))).isDirectory(), true);

  const raced = await Promise.all([
    setupTaskStore(firstWorkspace, "race-project", { projectsRoot }),
    setupTaskStore(firstWorkspace, "race-project", { projectsRoot }),
  ]);
  assert.deepEqual(raced.map((result) => result.registrationCreated).sort(), [false, true]);
});
