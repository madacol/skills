import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "browser-handoff.mjs");

function run(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, BROWSER_HANDOFF_ACTIVE_STATE: "" }
  });
}

test("resume help describes the agent continuation commands", () => {
  const result = run("resume", "--help");

  assert.equal(result.status, 0);
  assert.match(result.stdout, /resume inspect/);
  assert.match(result.stdout, /resume goto/);
  assert.match(result.stdout, /resume click/);
});

test("resume reports a missing active session before loading Playwright", () => {
  const missingPath = path.join(process.cwd(), ".missing-browser-handoff-active.json");
  const result = run("resume", "inspect", "--active-state", missingPath);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No active browser handoff/);
});
