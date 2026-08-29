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
  await mkdir(path.join(root, "open"), { recursive: true });
  await mkdir(path.join(root, "closed"), { recursive: true });
  return root;
}

async function record(root, collection, id, frontmatter = "status: todo", extra = "") {
  const file = path.join(root, collection, `${id}.md`);
  await writeFile(file, `---\n${frontmatter}\n---\n\n# ${id}\n\n## Outcome\n\nObservable result.\n${extra}`);
  return file;
}

test("validates open and closed task records", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "ship-fix");
  await record(root, "closed", "shipped-fix", "status: done", "\n## Completion\n\nTests passed.\n");
  assert.deepEqual(await validateTaskStore(root), { open: 1, closed: 1 });
});

test("validates a structured decision and preserves yes and no as string option IDs", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "choose-path", `status: awaiting_decision
decision:
  question: Which path should we take?
  options:
    yes:
      label: Continue
      description: Keep working.
    no:
      label: Stop
      description: Cancel the task.
  recommendation: yes`);
  await validateTaskStore(root);
});

test("rejects duplicate frontmatter keys", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "ship-fix", "status: todo\nstatus: waiting");
  await assert.rejects(validateTaskStore(root), /duplicate frontmatter key/);
});

test("requires waiting_for only while waiting", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "hardware-test", "status: waiting\nwaiting_for: Replacement hardware arrives");
  await validateTaskStore(root);
  await record(root, "open", "hardware-test", "status: in_progress\nwaiting_for: Replacement hardware arrives");
  await assert.rejects(validateTaskStore(root), /waiting_for is allowed only for waiting/);
});

test("rejects missing dependencies and dependency cycles", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "first-task", "status: todo\nblocked_by:\n  - second-task");
  await assert.rejects(validateTaskStore(root), /missing task/);
  await record(root, "open", "second-task", "status: todo\nblocked_by:\n  - first-task");
  await assert.rejects(validateTaskStore(root), /dependency cycle/);
});

test("rejects nested records and status-folder mismatches", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "open", "nested"));
  await assert.rejects(validateTaskStore(root), /must be flat/);
  await rm(path.join(root, "open", "nested"), { recursive: true });
  await record(root, "open", "finished-task", "status: done", "\n## Completion\n\nDone.\n");
  await assert.rejects(validateTaskStore(root), /belongs under closed/);
});

test("requires outcome and completion or cancellation evidence", async (t) => {
  const root = await fixture(t);
  const file = await record(root, "closed", "finished-task", "status: done");
  await assert.rejects(validateTaskStore(root), /Completion/);
  await writeFile(file, "---\nstatus: canceled\n---\n\n# finished-task\n");
  await assert.rejects(validateTaskStore(root), (error) => {
    assert(error instanceof TaskValidationError);
    assert.match(error.message, /Outcome/);
    assert.match(error.message, /Cancellation/);
    return true;
  });
});

test("allows additional frontmatter fields", async (t) => {
  const root = await fixture(t);
  await record(root, "open", "ship-fix", "status: todo\nowner: platform\npriority: high");
  await validateTaskStore(root);
});
