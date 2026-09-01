import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskMarkdown } from "./task-parser.mjs";

test("browser parser reads the validator task format", () => {
  const parsed = parseTaskMarkdown("---\nstatus: waiting\nwaiting_for: Review arrives\n---\n\n# Wait for review\n\n## Outcome\n\nResume after review.\n", "wait.md");
  assert.equal(parsed.title, "Wait for review");
  assert.deepEqual(parsed.metadata, { status: "waiting", waiting_for: "Review arrives" });
  assert.deepEqual(parsed.sections, { outcome: "Resume after review." });
});
