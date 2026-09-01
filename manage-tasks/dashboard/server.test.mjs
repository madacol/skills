import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startDashboardHubServer } from "./server.mjs";

test("follows project symlinks, serves raw Markdown and referenced image evidence, and rejects writes", async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "manage-tasks-hub-test-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const taskRoot = path.join(temporary, "task-store");
  const projectsRoot = path.join(temporary, "projects");
  const evidenceRoot = path.join(temporary, "chat");
  const evidenceFile = path.join(evidenceRoot, "channel", ".media", "status.jpg");
  const outsideDirectory = path.join(temporary, "outside-channel");
  const linkedEvidenceFile = path.join(evidenceRoot, "linked-channel", ".media", "leak.jpg");
  await mkdir(path.join(taskRoot, "open"), { recursive: true });
  await mkdir(path.join(taskRoot, "closed"));
  await mkdir(projectsRoot);
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await mkdir(path.join(outsideDirectory, ".media"), { recursive: true });
  await writeFile(path.join(outsideDirectory, ".media", "leak.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await symlink(outsideDirectory, path.join(evidenceRoot, "linked-channel"), "dir");
  const taskFile = path.join(taskRoot, "open", "ship-fix.md");
  await writeFile(taskFile, `---\nstatus: todo\n---\n\n# ship-fix\n\n## Outcome\n\nObservable result.\n\n## Evidence\n\n![Status screenshot](${evidenceFile})\n\n![Symlink escape](${linkedEvidenceFile})\n`);
  await writeFile(path.join(taskRoot, "closed", "old-task.md"), "---\nstatus: done\n---\n\n# Old task\n\n## Outcome\n\nAlready finished.\n");
  await symlink(taskRoot, path.join(projectsRoot, "alpha-project"), "dir");
  await mkdir(path.join(projectsRoot, "copied-project"));
  const incompleteRoot = path.join(temporary, "incomplete-store");
  await mkdir(path.join(incompleteRoot, "open"), { recursive: true });
  await symlink(incompleteRoot, path.join(projectsRoot, "incomplete-project"), "dir");

  const server = await startDashboardHubServer(projectsRoot, { port: 0, evidenceRoot });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const index = await fetch(baseUrl);
  assert.match(await index.text(), /href="\/alpha-project\/"/u);
  assert.doesNotMatch(await (await fetch(baseUrl)).text(), /copied-project|incomplete-project/u);

  const redirect = await fetch(`${baseUrl}/alpha-project`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), "/alpha-project/");
  const dashboard = await fetch(`${baseUrl}/alpha-project/`);
  assert.match(await dashboard.text(), /Task ledger/u);
  const head = await fetch(`${baseUrl}/alpha-project/`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const listing = await fetch(`${baseUrl}/alpha-project/task-files`);
  assert.deepEqual(await listing.json(), ["/alpha-project/tasks/open/ship-fix.md"]);

  const first = await fetch(`${baseUrl}/alpha-project/tasks/open/ship-fix.md`);
  assert.equal(first.status, 200);
  assert.match(await first.text(), /# ship-fix/u);

  const evidenceUrl = new URL(`${baseUrl}/alpha-project/evidence/open/ship-fix.md`);
  evidenceUrl.searchParams.set("path", evidenceFile);
  const evidence = await fetch(evidenceUrl);
  assert.equal(evidence.status, 200);
  assert.equal(evidence.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await evidence.arrayBuffer()), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const unreferencedFile = path.join(evidenceRoot, "channel", ".media", "private.jpg");
  await writeFile(unreferencedFile, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const unreferencedUrl = new URL(evidenceUrl);
  unreferencedUrl.searchParams.set("path", unreferencedFile);
  assert.equal((await fetch(unreferencedUrl)).status, 404);

  const outsideUrl = new URL(evidenceUrl);
  outsideUrl.searchParams.set("path", path.join(temporary, "outside.jpg"));
  assert.equal((await fetch(outsideUrl)).status, 404);

  const symlinkEscapeUrl = new URL(evidenceUrl);
  symlinkEscapeUrl.searchParams.set("path", linkedEvidenceFile);
  assert.equal((await fetch(symlinkEscapeUrl)).status, 404);
  assert.equal((await fetch(`${baseUrl}/alpha-project/tasks/closed/old-task.md`)).status, 200);

  await writeFile(taskFile, "---\nstatus: todo\n---\n\n# Updated title\n\n## Outcome\n\nFresh from Markdown.\n");
  const second = await fetch(`${baseUrl}/alpha-project/tasks/open/ship-fix.md`);
  assert.match(await second.text(), /# Updated title/u);

  const writeAttempt = await fetch(`${baseUrl}/alpha-project/tasks/open/ship-fix.md`, { method: "POST" });
  assert.equal(writeAttempt.status, 405);
  assert.equal(writeAttempt.headers.get("allow"), "GET, HEAD");
});
