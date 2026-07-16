#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const DEFAULT_TTL_MINUTES = 30;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const OUTCOMES = new Set(["continue", "save_later", "cancel"]);
const CONTROL_MODES = new Set(["vnc"]);
const VNC_WEBSOCKET_PATH = "/vnc-ws";
const NO_VNC_WEB_ROOT_CANDIDATES = [
  "/usr/share/novnc",
  "/usr/share/noVNC",
  "/usr/local/share/novnc",
  "/usr/local/share/noVNC",
  "/opt/novnc",
  "/opt/noVNC"
];
const execFileAsync = promisify(execFile);

/** @typedef {{ width: number, height: number }} Viewport */
/** @typedef {{
 * targetUrl: string,
 * host: string,
 * port: number,
 * token: string,
 * cdpEndpoint: string,
 * activeId: string,
 * activeStatePath: string,
 * continuationStatePath: string,
 * keepPrevious: boolean,
 * ttlMinutes: number,
 * ttlMs: number,
 * expiresAt: string,
 * artifactsDir: string,
 * runDir: string,
 * controlMode: "vnc",
 * profileDir: string,
 * storageStatePath: string,
 * latestJsonPath: string,
 * headless: boolean,
 * browserPath: string,
 * viewport: Viewport,
 * viewportWasExplicit: boolean,
 * deviceName: string,
 * userAgent: string,
 * deviceScaleFactor: number | undefined,
 * isMobile: boolean | undefined,
 * hasTouch: boolean | undefined,
 * allowExternalHost: boolean,
 * slowMo: number,
 * mode: "deploy" | "local" | "serve",
 * subdomain: string,
 * siteManager: string,
 * nodePath: string,
 * scriptPath: string,
 * trustProxyToken: boolean,
 * xvfbPath: string,
 * x11vncPath: string,
 * noVncWebRoot: string,
 * vncDisplay: string,
 * vncPort: number
 * }} Options */

function usage() {
  return `Usage:
  browser-handoff.mjs <url> [options]

Default:
  Deploy a token-protected control page and print the user-facing Control URL.

Options:
  --subdomain <name>            Deployed subdomain. Default: browser-handoff-<random>
  --local                       Run only a local server for debugging
  --serve                       Internal service mode used by deployment
  --host <host>                 Bind host in --local/--serve. Default: 127.0.0.1
  --port <port>                 Bind port in --local/--serve. Default: PORT or 8787
  --token <token>               Control-page bearer token. Default: random
  --ttl-minutes <n>             Auto-close timeout. Default: 30. Use 0 to disable
  --expires-at <iso>            Absolute expiration time, used internally by deployed services
  --active-state <path>         Active-session record. Default: <artifacts-parent>/browser-handoff-active.json
  --keep-previous               Do not stop the previous handoff; use distinct artifacts and local port
  --control <vnc>               Control backend. Default: vnc
  --artifacts-dir <path>        Artifact root. Default: ./artifacts/browser-handoff
  --profile-dir <path>          Persistent Chromium profile. Default: <artifacts-dir>/profile
  --storage-state <path>        Storage-state output. Default: <artifacts-dir>/storage-state.json
  --headless <0|1>              Browser headless flag. VNC forces non-headless. Default: 0
  --browser-path <path>         Chromium executable. Default: BROWSER_PATH, /usr/bin/chromium, or Playwright managed
  --device <name>               Playwright device profile, e.g. "iPhone 14" or "Pixel 7"
  --user-agent <value>          Override browser user agent
  --is-mobile <0|1>             Override Playwright mobile mode
  --has-touch <0|1>             Override touch support
  --device-scale-factor <n>     Override device scale factor
  --viewport <width>x<height>   Viewport. Default: 1440x960
  --slow-mo <ms>                Playwright slowMo. Default: 50
  --site-manager <path>         site-manager executable. Default: site-manager
  --node <path>                 Node executable for deployed service. Default: current node
  --xvfb <path>                 Xvfb executable for --control vnc. Default: discovered from PATH
  --x11vnc <path>               x11vnc executable for --control vnc. Default: discovered from PATH
  --novnc-web <path>            noVNC web root containing vnc.html. Default: common system locations
  --vnc-display <display>       X display for --control vnc. Default: random high display number
  --vnc-port <port>             Local VNC TCP port for --control vnc. Default: random high 59xx port
  --allow-external-host         Allow non-loopback bind host in --local/--serve
  --help                       Show this help

Environment mirrors:
  BROWSER_HANDOFF_HOST, BROWSER_HANDOFF_PORT, BROWSER_HANDOFF_TOKEN,
  BROWSER_HANDOFF_CONTROL, BROWSER_HANDOFF_TTL_MINUTES, BROWSER_HANDOFF_EXPIRES_AT,
  BROWSER_HANDOFF_ACTIVE_STATE, BROWSER_HANDOFF_KEEP_PREVIOUS,
  BROWSER_HANDOFF_ARTIFACTS_DIR, BROWSER_HANDOFF_PROFILE_DIR,
  BROWSER_HANDOFF_STORAGE_STATE, BROWSER_HANDOFF_HEADLESS,
  BROWSER_HANDOFF_SUBDOMAIN,
  BROWSER_HANDOFF_SITE_MANAGER, BROWSER_HANDOFF_ALLOW_EXTERNAL_HOST,
  BROWSER_HANDOFF_DEVICE, BROWSER_HANDOFF_USER_AGENT,
  BROWSER_HANDOFF_IS_MOBILE, BROWSER_HANDOFF_HAS_TOUCH,
  BROWSER_HANDOFF_DEVICE_SCALE_FACTOR,
  BROWSER_HANDOFF_XVFB, BROWSER_HANDOFF_X11VNC, BROWSER_HANDOFF_NOVNC_WEB,
  BROWSER_HANDOFF_VNC_DISPLAY, BROWSER_HANDOFF_VNC_PORT,
  BROWSER_PATH, PORT
`;
}

function resumeUsage() {
  return `Usage:
  browser-handoff.mjs resume inspect [--active-state <path>]
  browser-handoff.mjs resume goto <url> [--active-state <path>]
  browser-handoff.mjs resume click <selector> [--active-state <path>]
  browser-handoff.mjs resume fill <selector> <text> [--active-state <path>]
  browser-handoff.mjs resume press <selector> <key> [--active-state <path>]
  browser-handoff.mjs resume screenshot [path] [--active-state <path>]

Connects to the Chromium process recorded by the active browser handoff and
performs one agent action without closing the live browser.
`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (value === true || value === "1" || value === "true" || value === "yes") {
    return true;
  }

  if (value === false || value === "0" || value === "false" || value === "no") {
    return false;
  }

  fail(`Invalid boolean value: ${value}`);
}

function parsePort(value) {
  const port = Number.parseInt(String(value), 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail(`Invalid port: ${value}`);
  }

  return port;
}

function parseControlMode(value) {
  const mode = String(value || "vnc");

  if (!CONTROL_MODES.has(mode)) {
    fail(`Invalid control mode: ${value}. Expected vnc.`);
  }

  return mode;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    fail(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parsePositiveNumber(value, label) {
  const parsed = Number.parseFloat(String(value));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseNonNegativeNumber(value, label) {
  const parsed = Number.parseFloat(String(value));

  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseExpiresAt(value) {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(String(value));

  if (!Number.isFinite(timestamp)) {
    fail(`Invalid expires-at timestamp: ${value}`);
  }

  return new Date(timestamp).toISOString();
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === "") {
    return undefined;
  }

  return parseBoolean(value, false);
}

function parseOptionalPositiveNumber(value, label) {
  if (value === undefined || value === "") {
    return undefined;
  }

  return parsePositiveNumber(value, label);
}

function parseViewport(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/i);

  if (!match) {
    fail(`Invalid viewport. Expected WIDTHxHEIGHT, got: ${value}`);
  }

  return {
    width: parsePositiveInt(match[1], "viewport width"),
    height: parsePositiveInt(match[2], "viewport height")
  };
}

function defaultSubdomain() {
  return `browser-handoff-${crypto.randomBytes(4).toString("hex")}`;
}

function defaultActiveId() {
  return crypto.randomBytes(12).toString("hex");
}

function defaultVncDisplay() {
  return `:${90 + crypto.randomInt(100)}`;
}

function defaultVncPort() {
  return 5900 + crypto.randomInt(100);
}

function parseArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  let targetUrl = "";
  const flags = new Map();
  const booleans = new Set(["allow-external-host", "keep-previous", "local", "serve", "trust-proxy-token"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      if (!targetUrl) {
        targetUrl = arg;
        continue;
      }

      fail(`Unexpected positional argument: ${arg}`);
    }

    const name = arg.slice(2);

    if (booleans.has(name)) {
      flags.set(name, "1");
      continue;
    }

    const value = args[index + 1];

    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${name}`);
    }

    flags.set(name, value);
    index += 1;
  }

  targetUrl = targetUrl || process.env.BROWSER_HANDOFF_TARGET_URL || "";

  if (!targetUrl) {
    console.error(usage());
    fail("Missing target URL.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    fail(`Invalid target URL: ${targetUrl}`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    fail(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  const artifactsDir = path.resolve(
    flags.get("artifacts-dir")
      || process.env.BROWSER_HANDOFF_ARTIFACTS_DIR
      || path.join(process.cwd(), "artifacts", "browser-handoff")
  );
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const runDir = path.join(artifactsDir, "runs", timestamp);
  const profileDir = path.resolve(
    flags.get("profile-dir")
      || process.env.BROWSER_HANDOFF_PROFILE_DIR
      || path.join(artifactsDir, "profile")
  );
  const storageStatePath = path.resolve(
    flags.get("storage-state")
      || process.env.BROWSER_HANDOFF_STORAGE_STATE
      || path.join(artifactsDir, "storage-state.json")
  );
  const activeStatePath = path.resolve(
    flags.get("active-state")
      || process.env.BROWSER_HANDOFF_ACTIVE_STATE
      || path.join(path.dirname(artifactsDir), "browser-handoff-active.json")
  );
  const activeId = flags.get("active-id") || process.env.BROWSER_HANDOFF_ACTIVE_ID || defaultActiveId();
  const continuationId = crypto.createHash("sha256").update(activeId).digest("hex");
  const ttlMinutes = parseNonNegativeNumber(
    flags.get("ttl-minutes") || process.env.BROWSER_HANDOFF_TTL_MINUTES || String(DEFAULT_TTL_MINUTES),
    "TTL minutes"
  );
  const expiresAt = parseExpiresAt(flags.get("expires-at") || process.env.BROWSER_HANDOFF_EXPIRES_AT || "");
  const viewportValue = flags.get("viewport") || process.env.BROWSER_HANDOFF_VIEWPORT || "";
  const controlMode = parseControlMode(flags.get("control") || process.env.BROWSER_HANDOFF_CONTROL || "vnc");
  const mode = flags.has("serve") ? "serve" : flags.has("local") ? "local" : "deploy";
  const host = flags.get("host") || process.env.BROWSER_HANDOFF_HOST || "127.0.0.1";
  const allowExternalHost = flags.has("allow-external-host")
    || parseBoolean(process.env.BROWSER_HANDOFF_ALLOW_EXTERNAL_HOST, false);

  if (mode !== "deploy" && !LOOPBACK_HOSTS.has(host) && !allowExternalHost) {
    fail(`Refusing to bind non-loopback host "${host}" without --allow-external-host.`);
  }

  return {
    targetUrl,
    host,
    port: parsePort(flags.get("port") || process.env.BROWSER_HANDOFF_PORT || process.env.PORT || "8787"),
    token: flags.get("token") || process.env.BROWSER_HANDOFF_TOKEN || crypto.randomBytes(18).toString("hex"),
    cdpEndpoint: "",
    activeId,
    activeStatePath,
    continuationStatePath: path.join(artifactsDir, "sessions", `${continuationId}.json`),
    keepPrevious: flags.has("keep-previous") || parseBoolean(process.env.BROWSER_HANDOFF_KEEP_PREVIOUS, false),
    ttlMinutes,
    ttlMs: Math.round(ttlMinutes * 60_000),
    expiresAt,
    artifactsDir,
    runDir,
    controlMode,
    profileDir,
    storageStatePath,
    latestJsonPath: path.join(artifactsDir, "latest.json"),
    headless: parseBoolean(flags.get("headless") || process.env.BROWSER_HANDOFF_HEADLESS, false),
    browserPath: flags.get("browser-path") || process.env.BROWSER_PATH || "",
    viewport: parseViewport(viewportValue || `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`),
    viewportWasExplicit: Boolean(viewportValue),
    deviceName: flags.get("device") || process.env.BROWSER_HANDOFF_DEVICE || "",
    userAgent: flags.get("user-agent") || process.env.BROWSER_HANDOFF_USER_AGENT || "",
    deviceScaleFactor: parseOptionalPositiveNumber(
      flags.get("device-scale-factor") || process.env.BROWSER_HANDOFF_DEVICE_SCALE_FACTOR,
      "device scale factor"
    ),
    isMobile: parseOptionalBoolean(flags.get("is-mobile") || process.env.BROWSER_HANDOFF_IS_MOBILE),
    hasTouch: parseOptionalBoolean(flags.get("has-touch") || process.env.BROWSER_HANDOFF_HAS_TOUCH),
    allowExternalHost,
    slowMo: Number.parseInt(flags.get("slow-mo") || process.env.BROWSER_HANDOFF_SLOW_MO || "50", 10),
    mode,
    subdomain: flags.get("subdomain") || process.env.BROWSER_HANDOFF_SUBDOMAIN || defaultSubdomain(),
    siteManager: flags.get("site-manager") || process.env.BROWSER_HANDOFF_SITE_MANAGER || "site-manager",
    nodePath: flags.get("node") || process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    trustProxyToken: flags.has("trust-proxy-token"),
    xvfbPath: flags.get("xvfb") || process.env.BROWSER_HANDOFF_XVFB || "",
    x11vncPath: flags.get("x11vnc") || process.env.BROWSER_HANDOFF_X11VNC || "",
    noVncWebRoot: flags.get("novnc-web") || process.env.BROWSER_HANDOFF_NOVNC_WEB || "",
    vncDisplay: flags.get("vnc-display") || process.env.BROWSER_HANDOFF_VNC_DISPLAY || defaultVncDisplay(),
    vncPort: parsePort(flags.get("vnc-port") || process.env.BROWSER_HANDOFF_VNC_PORT || String(defaultVncPort()))
  };
}

function parseResumeArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    console.log(resumeUsage());
    process.exit(0);
  }

  const action = args.shift() || "inspect";
  const positional = [];
  let activeStatePath = process.env.BROWSER_HANDOFF_ACTIVE_STATE || path.resolve(
    process.cwd(),
    "artifacts",
    "browser-handoff-active.json"
  );

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--active-state") {
      const value = args[index + 1];

      if (!value || value.startsWith("--")) {
        fail("Missing value for --active-state");
      }

      activeStatePath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(`Unsupported resume option: ${arg}`);
    }

    positional.push(arg);
  }

  const argumentCounts = new Map([
    ["inspect", [0, 0]],
    ["goto", [1, 1]],
    ["click", [1, 1]],
    ["fill", [2, 2]],
    ["press", [2, 2]],
    ["screenshot", [0, 1]]
  ]);
  const bounds = argumentCounts.get(action);

  if (!bounds) {
    fail(`Unsupported resume action: ${action}\n\n${resumeUsage()}`);
  }

  if (positional.length < bounds[0] || positional.length > bounds[1]) {
    fail(`Invalid arguments for resume ${action}.\n\n${resumeUsage()}`);
  }

  return { action, positional, activeStatePath };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadPlaywright() {
  const candidates = [
    createRequire(path.join(process.cwd(), "package.json")),
    createRequire(import.meta.url)
  ];
  const errors = [];

  for (const requireFrom of candidates) {
    try {
      return requireFrom("playwright");
    } catch (error) {
      if (error?.code !== "MODULE_NOT_FOUND") {
        throw error;
      }

      errors.push(error.message);
    }
  }

  throw new Error(
    `Missing dependency: playwright.\nInstall a pinned version in the current workspace, for example:\n  pnpm add -D playwright@1.60.0\n\n${errors.join("\n")}`
  );
}

async function waitForCdpEndpoint(profileDir, timeoutMs = 8_000) {
  const activePortPath = path.join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const [port] = (await fs.readFile(activePortPath, "utf8")).trim().split(/\r?\n/);

      if (/^\d+$/.test(port)) {
        return `http://127.0.0.1:${port}`;
      }

      lastError = `Invalid DevToolsActivePort contents: ${port}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Chromium CDP endpoint did not become ready. ${lastError}`);
}

async function resolveBrowserPath(explicitPath) {
  if (explicitPath) {
    return explicitPath;
  }

  if (await pathExists("/usr/bin/chromium")) {
    return "/usr/bin/chromium";
  }

  return undefined;
}

async function findExecutable(explicitPath, names) {
  if (explicitPath) {
    return explicitPath;
  }

  for (const name of names) {
    try {
      const { stdout } = await execFileAsync("which", [name], { maxBuffer: 1024 * 64 });
      const resolved = stdout.trim().split("\n")[0];

      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return "";
}

async function resolveNoVncWebRoot(explicitPath) {
  const candidates = explicitPath ? [explicitPath] : NO_VNC_WEB_ROOT_CANDIDATES;

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);

    if (await pathExists(path.join(resolved, "vnc.html"))) {
      return resolved;
    }
  }

  return "";
}

async function resolveVncRuntime(options) {
  const xvfbPath = await findExecutable(options.xvfbPath, ["Xvfb"]);
  const x11vncPath = await findExecutable(options.x11vncPath, ["x11vnc"]);
  const noVncWebRoot = await resolveNoVncWebRoot(options.noVncWebRoot);
  const missing = [];

  if (!xvfbPath) {
    missing.push("Xvfb");
  }

  if (!x11vncPath) {
    missing.push("x11vnc");
  }

  if (!noVncWebRoot) {
    missing.push("noVNC web assets containing vnc.html");
  }

  if (missing.length > 0) {
    throw new Error(
      `VNC control requires missing runtime components: ${missing.join(", ")}. `
      + "Install/provide them. Expected tools: Xvfb, x11vnc, and a noVNC web root passed with --novnc-web."
    );
  }

  options.xvfbPath = xvfbPath;
  options.x11vncPath = x11vncPath;
  options.noVncWebRoot = noVncWebRoot;

  return { xvfbPath, x11vncPath, noVncWebRoot };
}

async function appendLog(logPath, text) {
  await fs.appendFile(logPath, text).catch(() => {});
}

function startLoggedProcess(label, command, args, runDir, options = {}) {
  const logPath = path.join(runDir, `${label}.log`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    void appendLog(logPath, chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk) => {
    void appendLog(logPath, chunk.toString("utf8"));
  });
  child.on("error", (error) => {
    void appendLog(logPath, `[error] ${error.message}\n`);
  });
  child.on("exit", (code, signal) => {
    void appendLog(logPath, `[exit] code=${code ?? ""} signal=${signal ?? ""}\n`);
  });

  return child;
}

async function waitForDisplay(display, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      await execFileAsync("xdpyinfo", ["-display", display], {
        env: { ...process.env, DISPLAY: display },
        maxBuffer: 1024 * 1024 * 4
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`X display ${display} did not become ready. ${lastError}`);
}

async function waitForTcpPort(port, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port }, () => {
          socket.end();
          resolve();
        });

        socket.setTimeout(750);
        socket.on("timeout", () => {
          socket.destroy(new Error("timeout"));
        });
        socket.on("error", reject);
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`TCP port ${port} did not become ready. ${lastError}`);
}

async function stopChildProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function prepareLifecycleOptions(options) {
  if (!options.expiresAt && options.ttlMs > 0) {
    options.expiresAt = new Date(Date.now() + options.ttlMs).toISOString();
  }
}

function buildStopUrl(controlUrl, token) {
  if (!controlUrl) {
    return "";
  }

  const url = new URL(controlUrl);
  url.pathname = "/stop";

  if (!url.searchParams.has("token")) {
    url.searchParams.set("token", token);
  }

  return url.href;
}

async function readActiveSessionRecord(activeStatePath) {
  try {
    return JSON.parse(await fs.readFile(activeStatePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function withRecordLock(recordPath, callback, timeoutMs = 5_000) {
  const lockPath = `${recordPath}.lock`;
  await fs.mkdir(path.dirname(recordPath), { recursive: true, mode: 0o700 });
  const lockProcess = spawn("flock", [
    "-x",
    "-w",
    String(Math.max(1, Math.ceil(timeoutMs / 1_000))),
    lockPath,
    "sh",
    "-c",
    "printf 'locked\\n'; IFS= read -r _"
  ], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  lockProcess.stderr.setEncoding("utf8");
  lockProcess.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await new Promise((resolve, reject) => {
    let stdout = "";

    lockProcess.once("error", reject);
    lockProcess.once("exit", (code) => {
      reject(new Error(
        code === 1
          ? `Timed out waiting for active-session record lock ${lockPath}.`
          : `Failed to acquire active-session record lock ${lockPath}: ${stderr.trim() || `exit ${code}`}`
      ));
    });
    lockProcess.stdout.setEncoding("utf8");
    lockProcess.stdout.on("data", (chunk) => {
      stdout += chunk;

      if (stdout.includes("\n")) {
        resolve();
      }
    });
  });

  await fs.chmod(lockPath, 0o600);

  try {
    return await callback();
  } finally {
    lockProcess.stdin.end("\n");
    await new Promise((resolve) => lockProcess.once("exit", resolve));
  }
}

async function writePrivateRecord(recordPath, value) {
  const temporaryPath = `${recordPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;

  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx"
  });
  await fs.chmod(temporaryPath, 0o600);
  await fs.rename(temporaryPath, recordPath);
  await fs.chmod(recordPath, 0o600);
}

async function replaceSessionRecord(recordPath, options, record) {
  await withRecordLock(recordPath, async () => {
    const existing = await readActiveSessionRecord(recordPath).catch(() => undefined);
    const sameSession = existing?.activeId === options.activeId;

    if (sameSession && existing.status === "stopped" && record.status !== "stopped") {
      throw new Error(`Browser handoff ${options.activeId} stopped before its session record was published.`);
    }

    await writePrivateRecord(recordPath, {
      ...record,
      createdAt: sameSession ? existing.createdAt || record.createdAt : record.createdAt,
      cdpEndpoint: options.cdpEndpoint || (sameSession ? existing.cdpEndpoint : "") || ""
    });
  });
}

async function patchSessionRecord(recordPath, options, patch) {
  await withRecordLock(recordPath, async () => {
    const record = await readActiveSessionRecord(recordPath);

    if (!record || record.activeId !== options.activeId) {
      throw new Error("Active browser handoff changed before its CDP endpoint was recorded.");
    }

    if (record.status === "stopped") {
      throw new Error(`Browser handoff ${options.activeId} has already stopped.`);
    }

    await writePrivateRecord(recordPath, { ...record, ...patch });
  });
}

async function writeActiveSessionRecord(options, controlUrl = "", status = "running") {
  const record = {
    activeId: options.activeId,
    status,
    targetUrl: options.targetUrl,
    controlUrl,
    stopUrl: buildStopUrl(controlUrl, options.token),
    createdAt: new Date().toISOString(),
    expiresAt: options.expiresAt || "",
    artifactsDir: options.artifactsDir,
    runDir: options.runDir,
    profileDir: options.profileDir,
    storageStatePath: options.storageStatePath,
    controlMode: options.controlMode,
    cdpEndpoint: options.cdpEndpoint || "",
    deviceName: options.deviceName || undefined,
    viewport: options.viewport
  };

  await replaceSessionRecord(options.continuationStatePath, options, record);

  if (!options.keepPrevious) {
    await replaceSessionRecord(options.activeStatePath, options, record);
  }
}

async function patchActiveSessionRecord(options, patch) {
  await patchSessionRecord(options.continuationStatePath, options, patch);

  if (!options.keepPrevious) {
    await patchSessionRecord(options.activeStatePath, options, patch);
  }
}

async function clearActiveSessionIfCurrent(options) {
  const markStopped = async (recordPath) => {
    await withRecordLock(recordPath, async () => {
      const record = await readActiveSessionRecord(recordPath).catch(() => undefined);

      if (record?.activeId === options.activeId) {
        await writePrivateRecord(recordPath, {
          ...record,
          status: "stopped",
          stoppedAt: new Date().toISOString(),
          controlUrl: "",
          stopUrl: "",
          cdpEndpoint: ""
        });
      }
    });
  };

  await markStopped(options.continuationStatePath);

  if (!options.keepPrevious) {
    await markStopped(options.activeStatePath);
  }
}

async function stopPreviousActiveSession(options) {
  if (options.keepPrevious || options.mode === "serve") {
    return;
  }

  const record = await readActiveSessionRecord(options.activeStatePath).catch(() => undefined);

  if (!record?.stopUrl || record.activeId === options.activeId) {
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch(record.stopUrl, {
      method: "POST",
      signal: controller.signal
    });
  } catch {
    // Best effort only. The active-session record below still invalidates old handoffs.
  } finally {
    clearTimeout(timer);
  }
}

function expirationReason(options) {
  if (!options.expiresAt) {
    return "";
  }

  return Date.now() >= Date.parse(options.expiresAt) ? "expired" : "";
}

async function inactiveSessionReason(state) {
  const expired = expirationReason(state.options);

  if (expired) {
    return expired;
  }

  if (state.options.keepPrevious) {
    return "";
  }

  const record = await readActiveSessionRecord(state.options.activeStatePath).catch(() => undefined);

  if (record?.activeId && record.activeId !== state.options.activeId) {
    return "replaced";
  }

  return "";
}

function scheduleLifecycle(state) {
  if (state.options.expiresAt) {
    const delay = Math.max(0, Date.parse(state.options.expiresAt) - Date.now());
    state.expirationTimer = setTimeout(() => {
      void closeBrowserAndServer(state);
    }, delay);
    state.expirationTimer.unref?.();
  }

  state.activeCheckTimer = setInterval(async () => {
    if (await inactiveSessionReason(state)) {
      await closeBrowserAndServer(state);
    }
  }, 5_000);
  state.activeCheckTimer.unref?.();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeFilePart(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "page";
}

function normalizeOutcome(value) {
  const outcome = String(value ?? "continue");

  if (!OUTCOMES.has(outcome)) {
    throw new Error(`Unsupported handoff outcome: ${outcome}`);
  }

  return outcome;
}

function isAuthorized(url, options) {
  return options.trustProxyToken || url.searchParams.get("token") === options.token;
}

function getActivePage(context, initialPage) {
  const openPages = context.pages().filter((candidate) => !candidate.isClosed());
  const nonBlankPages = openPages.filter((candidate) => candidate.url() !== "about:blank");

  return nonBlankPages.at(-1) ?? openPages.at(-1) ?? initialPage;
}

async function settlePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(750);
}

async function visibleLinks(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a"))
      .map((link) => {
        const text = (link.textContent ?? "").trim().replace(/\s+/g, " ");
        const href = link.getAttribute("href") ?? "";
        return text || href ? `${text} -> ${href}` : null;
      })
      .filter(Boolean)
      .join("\n")
  );
}

async function saveCurrentSession(state, outcomeInput = "continue") {
  const outcome = normalizeOutcome(outcomeInput);
  const page = getActivePage(state.context, state.initialPage);

  if (page.isClosed()) {
    throw new Error("Cannot save because the active page is closed.");
  }

  await fs.mkdir(state.options.runDir, { recursive: true });
  await fs.mkdir(path.dirname(state.options.storageStatePath), { recursive: true });
  await settlePage(page);

  const urlPart = sanitizeFilePart(page.url());
  const screenshotPath = path.join(state.options.runDir, `page-${urlPart}.png`);
  const htmlPath = path.join(state.options.runDir, `page-${urlPart}.html`);
  const currentUrlPath = path.join(state.options.runDir, "current-url.txt");
  const linksPath = path.join(state.options.runDir, "visible-links.txt");

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    animations: "disabled",
    timeout: 45_000
  });
  await fs.writeFile(htmlPath, await page.content(), "utf8");
  await fs.writeFile(currentUrlPath, `${page.url()}\n`, "utf8");
  await fs.writeFile(linksPath, `${await visibleLinks(page)}\n`, "utf8");
  await state.context.storageState({ path: state.options.storageStatePath });

  state.lastSave = {
    savedAt: new Date().toISOString(),
    outcome,
    continuity: "live_session",
    controlState: outcome === "continue" ? "ready_for_agent" : outcome === "save_later" ? "suspended" : "canceled",
    activeId: state.options.activeId,
    activeStatePath: state.options.continuationStatePath,
    currentUrl: page.url(),
    runDir: state.options.runDir,
    profileDir: state.options.profileDir,
    storageStatePath: state.options.storageStatePath,
    screenshotPath,
    htmlPath,
    currentUrlPath,
    linksPath
  };

  await fs.writeFile(state.options.latestJsonPath, `${JSON.stringify(state.lastSave, null, 2)}\n`, "utf8");

  return state.lastSave;
}

async function connectToActiveBrowser(activeStatePath) {
  const record = await readActiveSessionRecord(activeStatePath);

  if (!record) {
    throw new Error(`No active browser handoff found at ${activeStatePath}.`);
  }

  if (!record.cdpEndpoint) {
    throw new Error(`Active browser handoff ${record.activeId || ""} has no agent continuation endpoint.`);
  }

  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.connectOverCDP(record.cdpEndpoint);
  const context = browser.contexts().at(-1);

  if (!context) {
    throw new Error("The active Chromium session has no browser context.");
  }

  const pages = context.pages().filter((page) => !page.isClosed());
  const page = pages.filter((candidate) => candidate.url() !== "about:blank").at(-1) ?? pages.at(-1);

  if (!page) {
    throw new Error("The active Chromium session has no open page.");
  }

  return { browser, context, page, record };
}

async function inspectResumedPage(page) {
  const text = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
  const links = await page.locator("a").evaluateAll((anchors) =>
    anchors.slice(0, 100).map((anchor) => ({
      text: (anchor.textContent ?? "").trim().replace(/\s+/g, " "),
      href: anchor.href
    }))
  ).catch(() => []);

  return {
    url: page.url(),
    title: await page.title(),
    text: text.slice(0, 20_000),
    links
  };
}

async function runResumeCommand(argv) {
  const options = parseResumeArgs(argv);
  const { page, record } = await connectToActiveBrowser(options.activeStatePath);
  let result;

  switch (options.action) {
    case "inspect":
      result = await inspectResumedPage(page);
      break;
    case "goto":
      await page.goto(options.positional[0], { waitUntil: "domcontentloaded", timeout: 60_000 });
      await settlePage(page);
      result = await inspectResumedPage(page);
      break;
    case "click":
      await page.locator(options.positional[0]).first().click();
      await settlePage(page);
      result = await inspectResumedPage(page);
      break;
    case "fill":
      await page.locator(options.positional[0]).first().fill(options.positional[1]);
      result = await inspectResumedPage(page);
      break;
    case "press":
      await page.locator(options.positional[0]).first().press(options.positional[1]);
      await settlePage(page);
      result = await inspectResumedPage(page);
      break;
    case "screenshot": {
      const screenshotPath = path.resolve(
        options.positional[0] || path.join(record.runDir || process.cwd(), "agent-resume.png")
      );
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
      result = { ...(await inspectResumedPage(page)), screenshotPath };
      break;
    }
    default:
      throw new Error(`Unsupported resume action: ${options.action}`);
  }

  console.log(JSON.stringify({ activeId: record.activeId, action: options.action, ...result }, null, 2));
  process.exit(0);
}

async function gotoUrl(state, destination) {
  let parsed;

  try {
    parsed = new URL(String(destination ?? ""));
  } catch {
    throw new Error(`Invalid URL: ${destination}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const page = getActivePage(state.context, state.initialPage);
  await page.goto(parsed.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await settlePage(page);

  return page.url();
}

function vncControlHtml(options) {
  const vncPath = `vnc-ws?token=${encodeURIComponent(options.token)}`;
  const iframeSrc = `/novnc/vnc.html?autoconnect=1&resize=remote&path=${encodeURIComponent(vncPath)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Handoff VNC</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f1419;
      color: #eef3f7;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      background: #0f1419;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid #273440;
      background: #17212a;
      flex-wrap: wrap;
    }

    button, a {
      height: 32px;
      border: 1px solid #3b4d5c;
      border-radius: 6px;
      padding: 0 10px;
      background: #22313b;
      color: #eef3f7;
      font: inherit;
      font-size: 13px;
      line-height: 30px;
      text-decoration: none;
      cursor: pointer;
    }

    button:hover, a:hover {
      background: #2d3d48;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .status {
      margin-left: auto;
      font-size: 12px;
      color: #9fb0bc;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #050708;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="continueSave" type="button">Continue & Save</button>
    <button id="saveLater" type="button">Save for Later</button>
    <button id="cancel" type="button">Cancel</button>
    <button id="stop" type="button">Stop</button>
    <a href="${iframeSrc}" target="_blank" rel="noopener noreferrer">Open noVNC</a>
    <div id="status" class="status">Connected</div>
  </div>
  <iframe src="${iframeSrc}" title="Remote browser"></iframe>
  <script>
    const token = ${JSON.stringify(options.token)};
    const statusEl = document.getElementById("status");
    const continueSaveButton = document.getElementById("continueSave");
    const saveLaterButton = document.getElementById("saveLater");
    const cancelButton = document.getElementById("cancel");
    const stopButton = document.getElementById("stop");

    async function postJson(path, payload = {}) {
      const response = await fetch(path + "?token=" + encodeURIComponent(token), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const contentType = response.headers.get("content-type") || "";
      const body = contentType.includes("application/json") ? await response.json() : await response.text();

      if (!response.ok) {
        throw new Error(typeof body === "string" ? body : body.error || "Request failed");
      }

      return body;
    }

    function setOutcomeButtonsDisabled(disabled) {
      continueSaveButton.disabled = disabled;
      saveLaterButton.disabled = disabled;
      cancelButton.disabled = disabled;
    }

    async function saveOutcome(outcome, label) {
      setOutcomeButtonsDisabled(true);
      statusEl.textContent = label;
      try {
        const payload = await postJson("/save", { outcome });
        statusEl.textContent = payload.outcome === "continue"
          ? "Saved; agent may continue"
          : payload.outcome === "save_later"
            ? "Saved for later"
            : "Canceled";
      } catch (error) {
        statusEl.textContent = error.message || String(error);
        setOutcomeButtonsDisabled(false);
      }
    }

    continueSaveButton.addEventListener("click", () => saveOutcome("continue", "Saving for continue..."));
    saveLaterButton.addEventListener("click", () => saveOutcome("save_later", "Saving for later..."));
    cancelButton.addEventListener("click", () => saveOutcome("cancel", "Canceling..."));
    stopButton.addEventListener("click", async () => {
      stopButton.disabled = true;
      statusEl.textContent = "Stopping...";
      try {
        await postJson("/stop");
        statusEl.textContent = "Stopped";
      } catch (error) {
        statusEl.textContent = error.message || String(error);
        stopButton.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = new Map([
    [".html", "text/html; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".js", "application/javascript; charset=utf-8"],
    [".mjs", "application/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".svg", "image/svg+xml"],
    [".ico", "image/x-icon"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"]
  ]);

  return types.get(extension) ?? "application/octet-stream";
}

async function serveNoVncAsset(state, url, response) {
  const root = path.resolve(state.options.noVncWebRoot);
  const prefix = "/novnc/";
  const relative = decodeURIComponent(url.pathname.startsWith(prefix)
    ? url.pathname.slice(prefix.length)
    : "vnc.html") || "vnc.html";
  const resolved = path.resolve(root, relative);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    sendText(response, 403, "Forbidden\n");
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    const filePath = stat.isDirectory() ? path.join(resolved, "index.html") : resolved;
    const body = await fs.readFile(filePath);

    response.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "cache-control": "no-store"
    });
    response.end(body);
  } catch {
    sendText(response, 404, "Not found\n");
  }
}

function createServer(state) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!isAuthorized(url, state.options)) {
      sendText(response, 401, "Unauthorized\n");
      return;
    }

    try {
      if (!(request.method === "POST" && url.pathname === "/stop")) {
        const inactiveReason = await inactiveSessionReason(state);

        if (inactiveReason) {
          sendJson(response, 410, { error: `Browser handoff ${inactiveReason}.` });
          setTimeout(() => {
            void closeBrowserAndServer(state);
          }, 50);
          return;
        }
      }

      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(vncControlHtml(state.options));
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/novnc/")) {
        if (state.options.controlMode !== "vnc") {
          sendText(response, 404, "Not found\n");
          return;
        }

        await serveNoVncAsset(state, url, response);
        return;
      }


      if (request.method === "GET" && url.pathname === "/status") {
        const page = getActivePage(state.context, state.initialPage);
        sendJson(response, 200, {
          url: page.isClosed() ? "" : page.url(),
          saved: Boolean(state.lastSave),
          outcome: state.lastSave?.outcome,
          controlState: state.lastSave?.controlState,
          latest: state.lastSave,
          activeId: state.options.activeId,
          expiresAt: state.options.expiresAt || undefined
        });
        return;
      }


      if (request.method === "POST" && url.pathname === "/goto") {
        const payload = await readJsonBody(request);
        const currentUrl = await gotoUrl(state, payload.url);
        sendJson(response, 200, { ok: true, currentUrl });
        return;
      }

      if (request.method === "POST" && url.pathname === "/save") {
        const payload = await readJsonBody(request);
        sendJson(response, 200, await saveCurrentSession(state, payload.outcome));
        return;
      }

      if (request.method === "POST" && url.pathname === "/stop") {
        sendJson(response, 200, { ok: true });
        setTimeout(() => {
          void closeBrowserAndServer(state);
        }, 50);
        return;
      }

      sendText(response, 404, "Not found\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });
}

function encodeWebSocketFrame(payload, opcode = 2) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const length = body.length;
  let header;

  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, body]);
}

function decodeClientWebSocketFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }

      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) {
        break;
      }

      const bigLength = buffer.readBigUInt64BE(offset + 2);

      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large.");
      }

      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;

    if (buffer.length - offset < frameLength) {
      break;
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));

    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);

      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    frames.push({ opcode, payload });
    offset += frameLength;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function rejectUpgrade(socket, statusCode, message) {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function attachVncWebSocketProxy(server, state) {
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname !== VNC_WEBSOCKET_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }

    if (!isAuthorized(url, state.options)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }

    const key = request.headers["sec-websocket-key"];

    if (typeof key !== "string") {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    const vncSocket = net.connect({ host: "127.0.0.1", port: state.options.vncPort });
    let pending = Buffer.from(head);

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n"
      + "Upgrade: websocket\r\n"
      + "Connection: Upgrade\r\n"
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);

      try {
        const decoded = decodeClientWebSocketFrames(pending);
        pending = decoded.remaining;

        for (const frame of decoded.frames) {
          if (frame.opcode === 8) {
            socket.end(encodeWebSocketFrame(frame.payload, 8));
            vncSocket.end();
            return;
          }

          if (frame.opcode === 9) {
            socket.write(encodeWebSocketFrame(frame.payload, 10));
            continue;
          }

          if (frame.opcode === 1 || frame.opcode === 2 || frame.opcode === 0) {
            vncSocket.write(frame.payload);
          }
        }
      } catch {
        socket.destroy();
        vncSocket.destroy();
      }
    });

    vncSocket.on("data", (chunk) => {
      socket.write(encodeWebSocketFrame(chunk, 2));
    });
    vncSocket.on("error", () => {
      socket.destroy();
    });
    vncSocket.on("close", () => {
      socket.end();
    });
    socket.on("error", () => {
      vncSocket.destroy();
    });
    socket.on("close", () => {
      vncSocket.destroy();
    });
  });
}

async function closeBrowserAndServer(state) {
  if (state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  clearTimeout(state.expirationTimer);
  clearInterval(state.activeCheckTimer);
  state.server?.close();
  await state.context?.close().catch(() => {});

  for (const child of [...(state.childProcesses ?? [])].reverse()) {
    await stopChildProcess(child);
  }

  await clearActiveSessionIfCurrent(state.options);
}

function buildServiceCommand(options) {
  const command = [
    options.nodePath,
    options.scriptPath,
    options.targetUrl,
    "--serve",
    "--trust-proxy-token",
    "--host",
    "127.0.0.1",
    "--token",
    options.token,
    "--control",
    options.controlMode,
    "--active-id",
    options.activeId,
    "--active-state",
    options.activeStatePath,
    "--ttl-minutes",
    String(options.ttlMinutes),
    "--artifacts-dir",
    options.artifactsDir,
    "--profile-dir",
    options.profileDir,
    "--storage-state",
    options.storageStatePath,
    "--headless",
    options.headless ? "1" : "0",
    "--slow-mo",
    String(Number.isFinite(options.slowMo) ? options.slowMo : 50)
  ];

  if (options.expiresAt) {
    command.push("--expires-at", options.expiresAt);
  }

  if (options.keepPrevious) {
    command.push("--keep-previous");
  }

  if (options.browserPath) {
    command.push("--browser-path", options.browserPath);
  }

  if (options.xvfbPath) {
    command.push("--xvfb", options.xvfbPath);
  }

  if (options.x11vncPath) {
    command.push("--x11vnc", options.x11vncPath);
  }

  if (options.noVncWebRoot) {
    command.push("--novnc-web", options.noVncWebRoot);
  }

  if (options.vncDisplay) {
    command.push("--vnc-display", options.vncDisplay);
  }

  if (options.vncPort) {
    command.push("--vnc-port", String(options.vncPort));
  }

  if (options.deviceName) {
    command.push("--device", options.deviceName);
  }

  if (options.userAgent) {
    command.push("--user-agent", options.userAgent);
  }

  if (options.deviceScaleFactor !== undefined) {
    command.push("--device-scale-factor", String(options.deviceScaleFactor));
  }

  if (options.isMobile !== undefined) {
    command.push("--is-mobile", options.isMobile ? "1" : "0");
  }

  if (options.hasTouch !== undefined) {
    command.push("--has-touch", options.hasTouch ? "1" : "0");
  }

  if (options.viewportWasExplicit) {
    command.push("--viewport", `${options.viewport.width}x${options.viewport.height}`);
  }

  return command;
}

function findDeviceDescriptor(playwright, deviceName) {
  if (!deviceName) {
    return undefined;
  }

  const descriptor = playwright.devices[deviceName];

  if (descriptor) {
    return descriptor;
  }

  const normalized = deviceName.toLowerCase();
  const suggestions = Object.keys(playwright.devices)
    .filter((name) => name.toLowerCase().includes(normalized))
    .slice(0, 12);
  const suffix = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";

  throw new Error(`Unknown Playwright device: ${deviceName}.${suffix}`);
}

function buildBrowserOptions(playwright, options, executablePath) {
  const device = findDeviceDescriptor(playwright, options.deviceName);
  const browserOptions = {
    headless: options.headless,
    slowMo: Number.isFinite(options.slowMo) ? options.slowMo : 50
  };

  if (device) {
    const { defaultBrowserType, ...deviceOptions } = device;
    Object.assign(browserOptions, deviceOptions);
  }

  if (executablePath) {
    browserOptions.executablePath = executablePath;
  }

  if (options.viewportWasExplicit || !browserOptions.viewport) {
    browserOptions.viewport = options.viewport;
  }

  if (options.userAgent) {
    browserOptions.userAgent = options.userAgent;
  }

  if (options.deviceScaleFactor !== undefined) {
    browserOptions.deviceScaleFactor = options.deviceScaleFactor;
  }

  if (options.isMobile !== undefined) {
    browserOptions.isMobile = options.isMobile;
  }

  if (options.hasTouch !== undefined) {
    browserOptions.hasTouch = options.hasTouch;
  }

  browserOptions.args = [
    ...(browserOptions.args ?? []),
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0"
  ];

  return browserOptions;
}

async function deployControlUrl(options) {
  if (options.controlMode === "vnc") {
    await resolveVncRuntime(options);
  }

  const deployDir = path.join(options.artifactsDir, "deploy", options.subdomain);
  const manifestPath = path.join(deployDir, "website.json");
  const manifest = [
    {
      subdomain: options.subdomain,
      access: { mode: "token" },
      service: {
        command: buildServiceCommand(options),
        workingDirectory: process.cwd()
      }
    }
  ];

  await fs.mkdir(deployDir, { recursive: true });
  await fs.mkdir(options.artifactsDir, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await execFileAsync(options.siteManager, ["deploy", manifestPath], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  const { stdout } = await execFileAsync(options.siteManager, ["link", options.subdomain], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  const controlUrl = stdout.trim();
  const deployment = {
    deployedAt: new Date().toISOString(),
    controlUrl,
    manifestPath,
    subdomain: options.subdomain,
    artifactsDir: options.artifactsDir,
    profileDir: options.profileDir,
    storageStatePath: options.storageStatePath,
    controlMode: options.controlMode,
    deviceName: options.deviceName || undefined,
    viewport: options.viewportWasExplicit ? options.viewport : undefined
  };

  await fs.writeFile(path.join(options.artifactsDir, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`Control URL: ${controlUrl}`);
  console.log(`Artifacts: ${options.artifactsDir}`);
  console.log(`Profile: ${options.profileDir}`);
  console.log(`Storage state: ${options.storageStatePath}`);
  console.log(`Control: ${options.controlMode}`);
  console.log(`Expires: ${options.expiresAt || "disabled"}`);
  if (options.deviceName) {
    console.log(`Device: ${options.deviceName}`);
  } else if (options.viewportWasExplicit) {
    console.log(`Viewport: ${options.viewport.width}x${options.viewport.height}`);
  }
  console.log("After sending the Control URL, end the agent turn. Resume only when the user messages back, then read artifacts/browser-handoff/latest.json.");

  return controlUrl;
}

async function runVncBrowserServer(options) {
  await fs.mkdir(options.runDir, { recursive: true });
  await fs.mkdir(options.profileDir, { recursive: true });
  await resolveVncRuntime(options);

  const playwright = await loadPlaywright();
  const executablePath = await resolveBrowserPath(options.browserPath);
  const browserOptions = buildBrowserOptions(playwright, options, executablePath);
  const childProcesses = [];
  let context;

  browserOptions.headless = false;
  options.viewport = browserOptions.viewport ?? options.viewport;

  try {
    const xvfb = startLoggedProcess(
      "xvfb",
      options.xvfbPath,
      [
        options.vncDisplay,
        "-screen",
        "0",
        `${options.viewport.width}x${options.viewport.height}x24`,
        "-nolisten",
        "tcp"
      ],
      options.runDir
    );
    childProcesses.push(xvfb);
    await waitForDisplay(options.vncDisplay);

    const x11vnc = startLoggedProcess(
      "x11vnc",
      options.x11vncPath,
      [
        "-display",
        options.vncDisplay,
        "-rfbport",
        String(options.vncPort),
        "-localhost",
        "-forever",
        "-shared",
        "-nopw",
        "-quiet"
      ],
      options.runDir,
      { env: { ...process.env, DISPLAY: options.vncDisplay } }
    );
    childProcesses.push(x11vnc);
    await waitForTcpPort(options.vncPort);

    browserOptions.env = { ...process.env, DISPLAY: options.vncDisplay };
    await fs.rm(path.join(options.profileDir, "DevToolsActivePort"), { force: true });
    context = await playwright.chromium.launchPersistentContext(options.profileDir, browserOptions);
    options.cdpEndpoint = await waitForCdpEndpoint(options.profileDir);
    await patchActiveSessionRecord(options, { cdpEndpoint: options.cdpEndpoint });
    const initialPage = getActivePage(context, undefined) ?? await context.newPage();
    const state = {
      options,
      context,
      initialPage,
      server: undefined,
      shuttingDown: false,
      lastSave: undefined,
      childProcesses
    };

    context.on("response", async (browserResponse) => {
      const line = `${browserResponse.status()} ${browserResponse.url()}\n`;
      await fs.appendFile(path.join(options.runDir, "network.log"), line).catch(() => {});
    });

    context.on("page", (page) => {
      page.on("console", async (message) => {
        const line = `[browser:${message.type()}] ${message.text()}\n`;
        await fs.appendFile(path.join(options.runDir, "browser-console.log"), line).catch(() => {});
      });
    });

    initialPage.on("console", async (message) => {
      const line = `[browser:${message.type()}] ${message.text()}\n`;
      await fs.appendFile(path.join(options.runDir, "browser-console.log"), line).catch(() => {});
    });

    await initialPage.goto(options.targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settlePage(initialPage);
    await fs.writeFile(path.join(options.runDir, "initial.html"), await initialPage.content(), "utf8");
    await fs.writeFile(path.join(options.runDir, "initial-url.txt"), `${initialPage.url()}\n`, "utf8");
    await initialPage.screenshot({
      path: path.join(options.runDir, "initial.png"),
      fullPage: true,
      animations: "disabled",
      timeout: 30_000
    }).catch(() => {});

    const server = createServer(state);
    state.server = server;
    attachVncWebSocketProxy(server, state);
    scheduleLifecycle(state);

    server.listen(options.port, options.host, () => {
      const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
      const controlUrl = `http://${displayHost}:${options.port}/?token=${encodeURIComponent(options.token)}`;

      console.log(`Opened: ${options.targetUrl}`);
      console.log(`Control URL: ${controlUrl}`);
      console.log(`Artifacts: ${options.runDir}`);
      console.log(`Profile: ${options.profileDir}`);
      console.log(`Storage state: ${options.storageStatePath}`);
      console.log("Control: vnc");
      console.log(`Expires: ${options.expiresAt || "disabled"}`);
      console.log(`VNC display: ${options.vncDisplay}`);
      console.log(`VNC port: ${options.vncPort}`);
      console.log(`Agent continuation: ${options.cdpEndpoint}`);
      if (options.deviceName) {
        console.log(`Device: ${options.deviceName}`);
      } else if (options.viewportWasExplicit) {
        console.log(`Viewport: ${options.viewport.width}x${options.viewport.height}`);
      }
      console.log("After sending the Control URL, end the agent turn. Resume only when the user messages back.");
      console.log("Press Ctrl+C or click Stop in the browser UI to close the handoff.");

      if (options.mode === "local") {
        void writeActiveSessionRecord(options, controlUrl, "running").catch((error) => {
          console.error(`Failed to write active-session record: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });

    process.on("SIGINT", async () => {
      console.log("\nClosing browser handoff...");
      await closeBrowserAndServer(state);
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await closeBrowserAndServer(state);
      process.exit(0);
    });
  } catch (error) {
    await context?.close().catch(() => {});

    for (const child of [...childProcesses].reverse()) {
      await stopChildProcess(child);
    }

    await clearActiveSessionIfCurrent(options).catch(() => {});
    throw error;
  }
}

async function runBrowserServer(options) {
  await runVncBrowserServer(options);
}

async function main() {
  if (process.argv[2] === "resume") {
    await runResumeCommand(process.argv.slice(3));
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  prepareLifecycleOptions(options);

  if (options.mode === "deploy") {
    await stopPreviousActiveSession(options);
    await writeActiveSessionRecord(options, "", "starting");

    try {
      const controlUrl = await deployControlUrl(options);
      await writeActiveSessionRecord(options, controlUrl, "running");
    } catch (error) {
      await clearActiveSessionIfCurrent(options);
      throw error;
    }

    return;
  }

  if (options.mode === "local") {
    await stopPreviousActiveSession(options);
    await writeActiveSessionRecord(options, "", "starting");
  }

  await runBrowserServer(options);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
