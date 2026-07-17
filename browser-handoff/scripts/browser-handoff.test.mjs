import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "browser-handoff.mjs");
const defaultsFile = "defaults.json";
const profileMarkerFile = ".browser-handoff-profile.json";

function run(...args) {
  return runWithEnv({}, ...args);
}

function runWithEnv(env, ...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, BROWSER_HANDOFF_ACTIVE_STATE: "", ...env }
  });
}

function fakeChromiumIsVisible(profileDir) {
  const result = spawnSync("ps", ["-eww", "-o", "args="], { encoding: "utf8" });

  return result.stdout.split(/\r?\n/).some((line) =>
    line.trimStart().startsWith("chromium ")
    && line.includes(`--user-data-dir=${profileDir}`)
  );
}

async function waitFor(condition, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false;
}

async function waitForChildExit(child, timeoutMs = 3_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

function childIsAlive(child) {
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function oldIso() {
  return new Date(Date.now() - 3_600_000).toISOString();
}

function futureIso() {
  return new Date(Date.now() + 3_600_000).toISOString();
}

function pastIso() {
  return new Date(Date.now() - 60_000).toISOString();
}

async function getFreePort() {
  const server = net.createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.close(resolve);
  });

  return port;
}

function spawnFakeChromiumForProfile(profileDir) {
  return spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 300000)", "--", `--user-data-dir=${profileDir}`],
    { argv0: "chromium", stdio: "ignore" }
  );
}

function writeProfileMarker(profileDir, payload = {}) {
  const timestamp = oldIso();

  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(
    path.join(profileDir, profileMarkerFile),
    `${JSON.stringify({
      kind: "browser-handoff-profile",
      activeId: "test-active-id",
      status: "stopped",
      profileDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      ...payload
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

function writeSessionRecord(recordPath, profileDir, payload = {}) {
  const timestamp = oldIso();

  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(
    recordPath,
    `${JSON.stringify({
      activeId: "test-active-id",
      status: "running",
      profileDir,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      expiresAt: futureIso(),
      ...payload
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

function spawnTerminalServe(tmpDir, profileDir, activeStatePath, port, extraArgs = []) {
  return spawn(
    process.execPath,
    [
      scriptPath,
      "http://example.invalid",
      "--serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--token",
      "test-token",
      "--active-id",
      "test-active-id",
      "--active-state",
      activeStatePath,
      "--artifacts-dir",
      path.join(tmpDir, "artifacts"),
      "--profile-dir",
      profileDir,
      "--storage-state",
      path.join(tmpDir, "storage-state.json"),
      ...extraArgs
    ],
    {
      encoding: "utf8",
      env: { ...process.env, BROWSER_HANDOFF_ACTIVE_STATE: "" },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

async function waitForTerminalStatus(port, expectedReason) {
  const deadline = Date.now() + 3_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status?token=test-token`);
      const body = await response.json();

      if (response.status === 410 && body.reason === expectedReason) {
        return body;
      }

      lastError = new Error(`Unexpected terminal response: ${response.status} ${JSON.stringify(body)}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw lastError || new Error("Timed out waiting for terminal handoff status.");
}

function runServeStartup(tmpDir, profileDir, env = {}) {
  return runWithEnv(
    env,
    "http://example.invalid",
    "--serve",
    "--artifacts-dir",
    path.join(tmpDir, "artifacts"),
    "--profile-dir",
    profileDir,
    "--storage-state",
    path.join(tmpDir, "storage-state.json"),
    "--active-state",
    path.join(tmpDir, "active.json"),
    "--active-id",
    "test-active-id",
    "--xvfb",
    "/bin/false",
    "--x11vnc",
    "/bin/false",
    "--novnc-web",
    path.join(tmpDir, "missing-novnc")
  );
}

async function waitUntilProcessIsOldEnough(profileDir) {
  assert.equal(await waitFor(() => fakeChromiumIsVisible(profileDir)), true);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
}

async function startFakeCdpServer(t) {
  const child = spawn(process.execPath, [
    "-e",
    [
      "const http = require('node:http');",
      "const server = http.createServer((request, response) => {",
      "  if (request.url === '/json/version') {",
      "    response.writeHead(200, { 'content-type': 'application/json' });",
      "    response.end('{}\\n');",
      "    return;",
      "  }",
      "  response.writeHead(404);",
      "  response.end();",
      "});",
      "server.listen(0, '127.0.0.1', () => console.log(server.address().port));",
      "setInterval(() => {}, 300000);"
    ].join("\n")
  ], { stdio: ["ignore", "pipe", "ignore"] });

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  });

  const port = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for fake CDP server.")), 3_000);

    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;

      if (stdout.includes("\n")) {
        clearTimeout(timer);
        resolve(stdout.trim().split(/\r?\n/)[0]);
      }
    });
  });

  return `http://127.0.0.1:${port}`;
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

test("startup uses workspace defaults without persisting a TTL override", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-defaults-"));
  const artifactsDir = path.join(tmpDir, "artifacts");
  const profileDir = path.join(tmpDir, "profile-from-defaults");
  const storageStatePath = path.join(tmpDir, "storage-from-defaults.json");
  const activeStatePath = path.join(tmpDir, "browser-handoff-active.json");

  t.after(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, defaultsFile),
    `${JSON.stringify({
      subdomain: "cached-browser-handoff",
      profileDir,
      storageStatePath,
      ttlMinutes: 90
    }, null, 2)}\n`
  );

  const result = runWithEnv(
    { BROWSER_HANDOFF_ARTIFACTS_DIR: artifactsDir },
    "http://example.invalid",
    "--local",
    "--xvfb",
    "/bin/false",
    "--x11vnc",
    "/bin/false",
    "--novnc-web",
    path.join(tmpDir, "missing-novnc")
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /VNC control requires missing runtime components/);

  const record = JSON.parse(fs.readFileSync(activeStatePath, "utf8"));
  const createdAt = Date.parse(record.createdAt);
  const expiresAt = Date.parse(record.expiresAt);

  assert.equal(record.profileDir, profileDir);
  assert.equal(record.storageStatePath, storageStatePath);
  assert.ok(expiresAt - createdAt > 29 * 60_000);
  assert.ok(expiresAt - createdAt < 31 * 60_000);
});

test("startup cleanup terminates a stale Chromium process for the same profile", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-cleanup-"));
  const profileDir = path.join(tmpDir, "profile");
  const child = spawnFakeChromiumForProfile(profileDir);

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  writeProfileMarker(profileDir);
  await waitUntilProcessIsOldEnough(profileDir);

  const result = runServeStartup(tmpDir, profileDir, { BROWSER_HANDOFF_STALE_CHROMIUM_MINUTES: "0.01" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cleaned 1 stale Chromium process/);
  assert.equal(await waitForChildExit(child), true);
});

test("startup cleanup preserves a stale-looking process with recent profile activity", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-cleanup-recent-"));
  const profileDir = path.join(tmpDir, "profile");
  const child = spawnFakeChromiumForProfile(profileDir);

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  await waitUntilProcessIsOldEnough(profileDir);
  writeProfileMarker(profileDir, {
    status: "running",
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString()
  });

  const result = runServeStartup(tmpDir, profileDir, { BROWSER_HANDOFF_STALE_CHROMIUM_MINUTES: "0.01" });

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /Cleaned 1 stale Chromium process/);
  assert.equal(childIsAlive(child), true);
});

test("startup cleanup preserves a stale-looking process with reachable session CDP", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-cleanup-cdp-"));
  const profileDir = path.join(tmpDir, "profile");
  const activeStatePath = path.join(tmpDir, "active.json");
  const child = spawnFakeChromiumForProfile(profileDir);
  const cdpEndpoint = await startFakeCdpServer(t);

  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  writeProfileMarker(profileDir);
  writeSessionRecord(activeStatePath, profileDir, { cdpEndpoint });
  await waitUntilProcessIsOldEnough(profileDir);

  const result = runServeStartup(tmpDir, profileDir, { BROWSER_HANDOFF_STALE_CHROMIUM_MINUTES: "0.01" });

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /Cleaned 1 stale Chromium process/);
  assert.equal(childIsAlive(child), true);
});

test("serve mode keeps an already stopped session terminal without rewriting timestamps", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-terminal-stopped-"));
  const profileDir = path.join(tmpDir, "profile");
  const activeStatePath = path.join(tmpDir, "active.json");
  const port = await getFreePort();
  const timestamp = oldIso();
  const stoppedRecord = {
    activeId: "test-active-id",
    status: "stopped",
    targetUrl: "http://example.invalid",
    controlUrl: "",
    stopUrl: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    stoppedAt: timestamp,
    expiresAt: futureIso(),
    artifactsDir: path.join(tmpDir, "artifacts"),
    runDir: path.join(tmpDir, "artifacts", "runs", "old"),
    profileDir,
    storageStatePath: path.join(tmpDir, "storage-state.json"),
    controlMode: "vnc",
    cdpEndpoint: "",
    viewport: { width: 1440, height: 960 }
  };

  fs.mkdirSync(path.dirname(activeStatePath), { recursive: true });
  fs.writeFileSync(activeStatePath, `${JSON.stringify(stoppedRecord, null, 2)}\n`, { mode: 0o600 });

  const child = spawnTerminalServe(tmpDir, profileDir, activeStatePath, port, ["--expires-at", futureIso()]);

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitForChildExit(child);
    }

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  const body = await waitForTerminalStatus(port, "stopped");
  assert.equal(body.status, "stopped");
  assert.equal(childIsAlive(child), true);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(JSON.parse(fs.readFileSync(activeStatePath, "utf8")), stoppedRecord);
});

test("serve mode marks an expired running session stopped once and remains terminal", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-handoff-terminal-expired-"));
  const profileDir = path.join(tmpDir, "profile");
  const activeStatePath = path.join(tmpDir, "active.json");
  const port = await getFreePort();
  const timestamp = oldIso();

  writeSessionRecord(activeStatePath, profileDir, {
    targetUrl: "http://example.invalid",
    controlUrl: "https://example.invalid/?token=test-token",
    stopUrl: "https://example.invalid/stop?token=test-token",
    updatedAt: timestamp,
    lastActivityAt: timestamp,
    expiresAt: pastIso(),
    cdpEndpoint: "http://127.0.0.1:9"
  });

  const child = spawnTerminalServe(tmpDir, profileDir, activeStatePath, port, ["--expires-at", pastIso()]);

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitForChildExit(child);
    }

    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  const body = await waitForTerminalStatus(port, "expired");
  assert.equal(body.status, "stopped");
  assert.equal(childIsAlive(child), true);

  const stoppedRecord = JSON.parse(fs.readFileSync(activeStatePath, "utf8"));
  assert.equal(stoppedRecord.status, "stopped");
  assert.equal(stoppedRecord.controlUrl, "");
  assert.equal(stoppedRecord.stopUrl, "");
  assert.equal(stoppedRecord.cdpEndpoint, "");
  assert.equal(stoppedRecord.updatedAt, stoppedRecord.stoppedAt);
  assert.notEqual(stoppedRecord.updatedAt, timestamp);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(JSON.parse(fs.readFileSync(activeStatePath, "utf8")), stoppedRecord);
});
