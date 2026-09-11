import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskValidationError, validateTaskStore } from "./validate-tasks.mjs";

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "manage-tasks-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "tasks");
  await mkdir(root);
  await writeFile(path.join(root, "OPEN.md"), "# Open tasks\n");
  return root;
}

async function writeOpen(root, entries) {
  const lines = entries.map(({ id, title = id }) => `- [${title}](${id}/README.md)`);
  await writeFile(path.join(root, "OPEN.md"), `# Open tasks\n\n${lines.join("\n")}\n`);
}

async function record(root, id, frontmatter = "status: todo", extra = "", title = id) {
  const directory = path.join(root, id);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "README.md");
  await writeFile(file, `---\n${frontmatter}\n---\n\n# ${title}\n\n## Outcome\n\nObservable result.\n${extra}`);
  return file;
}

test("validates stable task directories against the manually maintained open index", async (t) => {
  const root = await fixture(t);
  await record(root, "ship-fix", "status: todo", "", "Ship fix");
  await record(root, "shipped-fix", "status: done", "\n## Completion\n\nTests passed.\n", "Shipped fix");
  await mkdir(path.join(root, "ship-fix", "tickets"));
  await writeFile(path.join(root, "ship-fix", "tickets", "01-update-behavior.md"), "# Update behavior\n");
  await writeOpen(root, [{ id: "ship-fix", title: "Ship fix" }]);
  assert.deepEqual(await validateTaskStore(root), { open: 1, closed: 1 });
});

test("rejects malformed, duplicate, and missing open-task links", async (t) => {
  const root = await fixture(t);
  await record(root, "ship-fix", "status: todo", "", "Ship fix");

  await writeFile(path.join(root, "OPEN.md"), "# Open tasks\n\n- ship-fix\n");
  await assert.rejects(validateTaskStore(root), /expected - \[Task title\]/u);

  await writeFile(path.join(root, "OPEN.md"), "# Open tasks\n\n- [Ship fix](ship-fix/README.md)\n- [Ship fix](ship-fix/README.md)\n");
  await assert.rejects(validateTaskStore(root), /duplicate open task/u);

  await writeOpen(root, [{ id: "missing-task", title: "Missing task" }]);
  await assert.rejects(validateTaskStore(root), /has no task directory/u);

  await writeOpen(root, [{ id: "ship-fix", title: "Old title" }]);
  await validateTaskStore(root);
});

test("requires OPEN.md membership to agree with terminal state", async (t) => {
  const root = await fixture(t);
  await record(root, "ship-fix", "status: todo", "", "Ship fix");
  await assert.rejects(validateTaskStore(root), /must appear in OPEN\.md/u);
  await record(root, "ship-fix", "status: done", "\n## Completion\n\nDone.\n", "Ship fix");
  await writeOpen(root, [{ id: "ship-fix", title: "Ship fix" }]);
  await assert.rejects(validateTaskStore(root), /must not appear in OPEN\.md/u);
});

test("validates ticket filenames and unique numeric positions", async (t) => {
  const root = await fixture(t);
  await record(root, "planned-work", "status: todo", "", "Planned work");
  await writeOpen(root, [{ id: "planned-work", title: "Planned work" }]);
  const tickets = path.join(root, "planned-work", "tickets");
  await mkdir(tickets);
  await writeFile(path.join(tickets, "first.md"), "# First\n");
  await assert.rejects(validateTaskStore(root), /NN-lowercase-slug/u);
  await rm(path.join(tickets, "first.md"));
  await writeFile(path.join(tickets, "01-first.md"), "# First\n");
  await writeFile(path.join(tickets, "01-again.md"), "# Again\n");
  await assert.rejects(validateTaskStore(root), /duplicate ticket position/u);
  await rm(path.join(tickets, "01-first.md"));
  await rm(path.join(tickets, "01-again.md"));
  await writeFile(path.join(tickets, "02-second.md"), "# Second\n");
  await assert.rejects(validateTaskStore(root), /start at 01 and remain contiguous/u);
});

test("validates structured decisions and conditional execution fields", async (t) => {
  const root = await fixture(t);
  await record(root, "choose-path", `status: awaiting_decision
decision:
  question: Which path should we take?
  options:
    yes:
      label: Continue
      description: Keep working.
    no:
      label: Stop
      description: Cancel the task.
  recommendation: yes`, "", "Choose path");
  await writeOpen(root, [{ id: "choose-path", title: "Choose path" }]);
  await validateTaskStore(root);

  await record(root, "choose-path", "status: in_progress\nwaiting_for: Review arrives", "", "Choose path");
  await assert.rejects(validateTaskStore(root), /waiting_for is allowed only for waiting/u);
});

test("validates composite Session and agent ownership only for active work", async (t) => {
  const root = await fixture(t);
  await record(root, "active-task", "status: in_progress\nowner: 8e25a58d/root/status_tests/reviewer", "", "Active task");
  await writeOpen(root, [{ id: "active-task", title: "Active task" }]);
  await validateTaskStore(root);
  await record(root, "active-task", "status: todo\nowner: 8e25a58d/root", "", "Active task");
  await assert.rejects(validateTaskStore(root), /owner is allowed only for in_progress/u);
});

test("rejects missing dependencies and dependency cycles", async (t) => {
  const root = await fixture(t);
  await record(root, "first-task", "status: todo\nblocked_by:\n  - second-task", "", "First task");
  await writeOpen(root, [{ id: "first-task", title: "First task" }]);
  await assert.rejects(validateTaskStore(root), /missing task/u);
  await record(root, "second-task", "status: todo\nblocked_by:\n  - first-task", "", "Second task");
  await writeOpen(root, [{ id: "first-task", title: "First task" }, { id: "second-task", title: "Second task" }]);
  await assert.rejects(validateTaskStore(root), /dependency cycle/u);
});

test("requires outcome and terminal evidence", async (t) => {
  const root = await fixture(t);
  const file = await record(root, "finished-task", "status: done");
  await assert.rejects(validateTaskStore(root), /Completion/u);
  await writeFile(file, "---\nstatus: canceled\n---\n\n# finished-task\n");
  await assert.rejects(validateTaskStore(root), (error) => {
    assert(error instanceof TaskValidationError);
    assert.match(error.message, /Outcome/u);
    assert.match(error.message, /Cancellation/u);
    return true;
  });
});

test("continues to validate legacy open and closed stores", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "manage-tasks-legacy-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, "tasks");
  await mkdir(path.join(root, "open"), { recursive: true });
  await mkdir(path.join(root, "closed"));
  await writeFile(path.join(root, "open", "open-task.md"), "---\nstatus: todo\n---\n\n# Open task\n\n## Outcome\n\nOpen.\n");
  await writeFile(path.join(root, "closed", "done-task.md"), "---\nstatus: done\n---\n\n# Done task\n\n## Outcome\n\nDone.\n\n## Completion\n\nVerified.\n");
  assert.deepEqual(await validateTaskStore(root), { open: 1, closed: 1 });
});
