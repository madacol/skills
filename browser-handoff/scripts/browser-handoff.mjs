#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const DEFAULT_TTL_MINUTES = 30;
const DEFAULT_STALE_CHROMIUM_GRACE_MINUTES = 60;
const DEFAULT_MAX_SESSION_BYTES = 512 * 1024 * 1024;
const GATEWAY_PROTOCOL_VERSION = 1;
const DEFAULTS_FILE_NAME = "defaults.json";
const PROFILE_MARKER_FILE = ".browser-handoff-profile.json";
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
 * ephemeral: boolean,
 * retainArtifacts: boolean,
 * persistProfile: string,
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
 * playwrightRequireFrom: string,
 * trustProxyToken: boolean,
 * publicPath: string,
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
  Create an isolated temporary browser through the stable token-protected gateway.

Options:
  --local                       Run only a local server for debugging
  --serve                       Internal service mode used by deployment
  --host <host>                 Bind host in --local/--serve. Default: 127.0.0.1
  --port <port>                 Bind port in --local/--serve. Default: PORT or 8787
  --token <token>               Control-page bearer token. Default: random
  --ttl-minutes <n>             Auto-close timeout. Gateway range: 1-60; default: 30. Local debugging may use 0
  --expires-at <iso>            Absolute expiration time, used internally by deployed services
  --active-state <path>         Active-session record; internal except with --local/--serve
  --ephemeral                   Internal gateway worker mode; delete all session state on exit
  --retain-artifacts            Keep bounded diagnostics after the session ends
  --persist-profile <name>      Reuse a named Chromium profile across handoffs
  --control <vnc>               Control backend. Default: vnc
  --artifacts-dir <path>        Artifact root. Default: ./artifacts/browser-handoff
  --profile-dir <path>          Persistent Chromium profile. Default: workspace cached value or <artifacts-dir>/profile
  --storage-state <path>        Storage-state output. Default: workspace cached value or <artifacts-dir>/storage-state.json
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
  --playwright-require-from <path>
                               Resolve Playwright from this package.json or package directory
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
  BROWSER_HANDOFF_PLAYWRIGHT_REQUIRE_FROM,
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
  browser-handoff.mjs resume inspect [--active-state <path>] [--playwright-require-from <path>]
  browser-handoff.mjs resume goto <url> [--active-state <path>] [--playwright-require-from <path>]
  browser-handoff.mjs resume click <selector> [--active-state <path>] [--playwright-require-from <path>]
  browser-handoff.mjs resume fill <selector> <text> [--active-state <path>] [--playwright-require-from <path>]
  browser-handoff.mjs resume press <selector> <key> [--active-state <path>] [--playwright-require-from <path>]
  browser-handoff.mjs resume screenshot [path] [--active-state <path>] [--playwright-require-from <path>]

Connects to the Chromium process recorded by a live browser handoff and performs
one agent action without closing it. With one live session, its temporary record
is discovered automatically. With concurrent sessions, --active-state is required.
`;
}

function gatewayUsage() {
  return `Usage:
  browser-handoff.mjs gateway [options]

Options:
  --host <host>                 Bind host. Default: 127.0.0.1
  --port <port>                 Bind port. Default: PORT or 8787
  --runtime-root <path>         Temporary session root. Default: /tmp/browser-handoff
  --state-dir <path>            Durable gateway configuration root
  --gateway-secret <secret>     Bearer secret for session creation
  --local                       Run the gateway directly for debugging
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

function requirePathFrom(value) {
  if (!value) {
    return "";
  }

  const resolved = path.resolve(String(value));
  return path.basename(resolved) === "package.json" ? resolved : path.join(resolved, "package.json");
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

function readWorkspaceDefaults(artifactsDir) {
  const defaultsPath = path.join(artifactsDir, DEFAULTS_FILE_NAME);

  try {
    return JSON.parse(fsSync.readFileSync(defaultsPath, "utf8"));
  } catch {
    return {};
  }
}

async function writeWorkspaceDefaults(options) {
  if (options.mode === "serve" || options.keepPrevious || options.ephemeral) {
    return;
  }

  const defaultsPath = path.join(options.artifactsDir, DEFAULTS_FILE_NAME);
  const defaults = {
    subdomain: options.subdomain,
    profileDir: options.profileDir,
    storageStatePath: options.storageStatePath
  };

  await fs.mkdir(options.artifactsDir, { recursive: true, mode: 0o700 });
  await writePrivateRecord(defaultsPath, defaults);
}

function defaultString(value) {
  return typeof value === "string" && value ? value : "";
}

function parseArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  let targetUrl = "";
  const flags = new Map();
  const booleans = new Set(["allow-external-host", "ephemeral", "keep-previous", "local", "retain-artifacts", "serve", "trust-proxy-token"]);

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
  const workspaceDefaults = readWorkspaceDefaults(artifactsDir);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const ephemeral = flags.has("ephemeral");
  const runDir = ephemeral ? artifactsDir : path.join(artifactsDir, "runs", timestamp);
  const profileDir = path.resolve(
    flags.get("profile-dir")
      || process.env.BROWSER_HANDOFF_PROFILE_DIR
      || defaultString(workspaceDefaults.profileDir)
      || path.join(artifactsDir, "profile")
  );
  const storageStatePath = path.resolve(
    flags.get("storage-state")
      || process.env.BROWSER_HANDOFF_STORAGE_STATE
      || defaultString(workspaceDefaults.storageStatePath)
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
    ephemeral,
    retainArtifacts: flags.has("retain-artifacts"),
    persistProfile: flags.get("persist-profile") || "",
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
    subdomain: flags.get("subdomain") || process.env.BROWSER_HANDOFF_SUBDOMAIN || defaultString(workspaceDefaults.subdomain) || defaultSubdomain(),
    siteManager: flags.get("site-manager") || process.env.BROWSER_HANDOFF_SITE_MANAGER || "site-manager",
    nodePath: flags.get("node") || process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    playwrightRequireFrom: requirePathFrom(
      flags.get("playwright-require-from") || process.env.BROWSER_HANDOFF_PLAYWRIGHT_REQUIRE_FROM || ""
    ),
    trustProxyToken: flags.has("trust-proxy-token"),
    publicPath: flags.get("public-path") || "",
    xvfbPath: flags.get("xvfb") || process.env.BROWSER_HANDOFF_XVFB || "",
    x11vncPath: flags.get("x11vnc") || process.env.BROWSER_HANDOFF_X11VNC || "",
    noVncWebRoot: flags.get("novnc-web") || process.env.BROWSER_HANDOFF_NOVNC_WEB || "",
    vncDisplay: flags.get("vnc-display") || process.env.BROWSER_HANDOFF_VNC_DISPLAY || defaultVncDisplay(),
    vncPort: parsePort(flags.get("vnc-port") || process.env.BROWSER_HANDOFF_VNC_PORT || String(defaultVncPort()))
  };
}

function parseGatewayArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    console.log(gatewayUsage());
    process.exit(0);
  }

  const flags = new Map();
  const booleans = new Set(["local"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      fail(`Unexpected gateway argument: ${arg}`);
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

  const host = flags.get("host") || process.env.BROWSER_HANDOFF_HOST || "127.0.0.1";

  if (!LOOPBACK_HOSTS.has(host)) {
    fail(`Refusing to bind gateway to non-loopback host "${host}".`);
  }

  return {
    host,
    port: parsePort(flags.get("port") || process.env.PORT || "8787"),
    runtimeRoot: path.resolve(flags.get("runtime-root") || path.join(os.tmpdir(), "browser-handoff")),
    stateDirectory: path.resolve(flags.get("state-dir") || gatewayStateDirectory()),
    secret: flags.get("gateway-secret") || process.env.BROWSER_HANDOFF_GATEWAY_SECRET || "",
    buildId: flags.get("build-id") || ""
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
  let activeStatePath = process.env.BROWSER_HANDOFF_ACTIVE_STATE || "";
  let playwrightRequireFrom = requirePathFrom(process.env.BROWSER_HANDOFF_PLAYWRIGHT_REQUIRE_FROM || "");

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

    if (arg === "--playwright-require-from") {
      const value = args[index + 1];

      if (!value || value.startsWith("--")) {
        fail("Missing value for --playwright-require-from");
      }

      playwrightRequireFrom = requirePathFrom(value);
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

  return { action, positional, activeStatePath, playwrightRequireFrom };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function safeReadDir(dirPath, options = {}) {
  try {
    return await fs.readdir(dirPath, options);
  } catch {
    return [];
  }
}

function compareVersions(left, right) {
  const leftParts = String(left || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = String(right || "0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function defaultPlaywrightBrowserCacheDir() {
  const explicit = process.env.PLAYWRIGHT_BROWSERS_PATH || "";

  if (explicit && explicit !== "0") {
    return path.resolve(explicit);
  }

  return path.join(os.homedir(), ".cache", "ms-playwright");
}

async function hasCachedChromiumRevision(revision) {
  if (!revision) {
    return false;
  }

  const browserCacheDir = defaultPlaywrightBrowserCacheDir();
  const revisionDir = path.join(browserCacheDir, `chromium-${revision}`);

  return (
    await pathExists(path.join(revisionDir, "chrome-linux", "chrome"))
    || await pathExists(path.join(revisionDir, "chrome-linux64", "chrome"))
    || await pathExists(path.join(revisionDir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"))
    || await pathExists(path.join(revisionDir, "chrome-win", "chrome.exe"))
  );
}

async function addPlaywrightPackageCandidate(candidates, packageJsonPath) {
  const resolved = path.resolve(packageJsonPath);

  if (candidates.has(resolved) || !(await pathExists(resolved))) {
    return;
  }

  candidates.add(resolved);
}

async function addPnpmPlaywrightPackageCandidates(candidates, pnpmDir) {
  for (const entry of await safeReadDir(pnpmDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("playwright@")) {
      await addPlaywrightPackageCandidate(
        candidates,
        path.join(pnpmDir, entry.name, "node_modules", "playwright", "package.json")
      );
    }
  }
}

async function discoverPlaywrightPackageCandidates() {
  const candidates = new Set();
  const home = os.homedir();

  await addPlaywrightPackageCandidate(candidates, path.join(process.cwd(), "node_modules", "playwright", "package.json"));
  await addPnpmPlaywrightPackageCandidates(candidates, path.join(process.cwd(), "node_modules", ".pnpm"));

  for (const entry of await safeReadDir(path.join(home, ".npm", "_npx"), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await addPlaywrightPackageCandidate(
        candidates,
        path.join(home, ".npm", "_npx", entry.name, "node_modules", "playwright", "package.json")
      );
    }
  }

  const workspaceRoots = [
    path.join(home, "chat"),
    path.join(home, "chat-workspaces")
  ];

  for (const root of workspaceRoots) {
    for (const workspace of await safeReadDir(root, { withFileTypes: true })) {
      if (!workspace.isDirectory()) {
        continue;
      }

      const workspaceDir = path.join(root, workspace.name);
      const packageRoots = [
        path.join(workspaceDir, "node_modules", "playwright", "package.json"),
        path.join(workspaceDir, "workspace", "node_modules", "playwright", "package.json")
      ];

      for (const packageRoot of packageRoots) {
        await addPlaywrightPackageCandidate(candidates, packageRoot);
      }

      const pnpmDirs = [
        path.join(workspaceDir, "node_modules", ".pnpm"),
        path.join(workspaceDir, "workspace", "node_modules", ".pnpm")
      ];

      for (const pnpmDir of pnpmDirs) {
        await addPnpmPlaywrightPackageCandidates(candidates, pnpmDir);
      }
    }
  }

  return Array.from(candidates);
}

async function inspectPlaywrightPackage(packageJsonPath) {
  const requireFrom = createRequire(packageJsonPath);
  const packageJson = await readJsonFile(packageJsonPath);
  const corePackageJsonPath = requireFrom.resolve("playwright-core/package.json");
  const browsersJsonPath = path.join(path.dirname(corePackageJsonPath), "browsers.json");
  const browsersJson = await readJsonFile(browsersJsonPath);
  const chromium = (browsersJson.browsers || []).find((browser) => browser.name === "chromium");
  const cachedChromium = await hasCachedChromiumRevision(chromium?.revision || "");

  return {
    packageJsonPath,
    version: packageJson.version || "0",
    chromiumRevision: chromium?.revision || "",
    cachedChromium
  };
}

async function readCachedPlaywrightRuntime(artifactsDir) {
  if (!artifactsDir) {
    return "";
  }

  const runtimePath = path.join(artifactsDir, "playwright-runtime.json");

  try {
    const runtime = await readJsonFile(runtimePath);
    const packageJsonPath = requirePathFrom(runtime?.playwrightRequireFrom || "");

    if (packageJsonPath && await pathExists(packageJsonPath)) {
      const inspected = await inspectPlaywrightPackage(packageJsonPath);

      if (inspected.cachedChromium) {
        return packageJsonPath;
      }
    }
  } catch {
    // Ignore stale or incompatible runtime cache entries.
  }

  return "";
}

async function writeCachedPlaywrightRuntime(artifactsDir, inspected) {
  if (!artifactsDir || !inspected?.packageJsonPath) {
    return;
  }

  const runtimePath = path.join(artifactsDir, "playwright-runtime.json");
  const payload = {
    playwrightRequireFrom: inspected.packageJsonPath,
    version: inspected.version,
    chromiumRevision: inspected.chromiumRevision,
    cachedChromium: inspected.cachedChromium,
    resolvedAt: new Date().toISOString()
  };

  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(runtimePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8").catch(() => {});
}

async function resolvePlaywrightRequireFrom(explicitRequireFrom = "", artifactsDir = "") {
  if (explicitRequireFrom) {
    return explicitRequireFrom;
  }

  const cached = await readCachedPlaywrightRuntime(artifactsDir);

  if (cached) {
    return cached;
  }

  const inspected = [];

  for (const packageJsonPath of await discoverPlaywrightPackageCandidates()) {
    try {
      inspected.push(await inspectPlaywrightPackage(packageJsonPath));
    } catch {
      // Ignore incomplete package installs.
    }
  }

  inspected.sort((left, right) => {
    if (left.cachedChromium !== right.cachedChromium) {
      return left.cachedChromium ? -1 : 1;
    }

    return -compareVersions(left.version, right.version);
  });

  const selected = inspected.find((candidate) => candidate.cachedChromium);

  if (!selected) {
    return "";
  }

  await writeCachedPlaywrightRuntime(artifactsDir, selected);
  return selected.packageJsonPath;
}

async function loadPlaywright(explicitRequireFrom = "") {
  const resolvedRequireFrom = await resolvePlaywrightRequireFrom(explicitRequireFrom);
  const candidates = [
    ...(resolvedRequireFrom ? [createRequire(resolvedRequireFrom)] : []),
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

function staleChromiumGraceMs() {
  const minutes = parseNonNegativeNumber(
    process.env.BROWSER_HANDOFF_STALE_CHROMIUM_MINUTES || String(DEFAULT_STALE_CHROMIUM_GRACE_MINUTES),
    "stale Chromium grace minutes"
  );

  return Math.round(minutes * 60_000);
}

function normalizeProfileDir(profileDir) {
  return path.resolve(profileDir);
}

function profileMarkerPath(profileDir) {
  return path.join(normalizeProfileDir(profileDir), PROFILE_MARKER_FILE);
}

function parseTimestampMs(value) {
  const timestamp = Date.parse(value || "");

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestTimestampMs(...values) {
  return Math.max(0, ...values.map(parseTimestampMs));
}

function pathContains(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commandUsesProfile(command, profileDir) {
  const normalized = normalizeProfileDir(profileDir);

  return (
    command.includes(`--user-data-dir=${normalized}`)
    || command.includes(`--user-data-dir ${normalized}`)
    || command.includes(`--user-data-dir="${normalized}"`)
    || command.includes(`--user-data-dir '${normalized}'`)
  );
}

function commandLooksLikeChromium(command) {
  const executable = command.trimStart().replace(/^"/, "");

  return /(^|\/)(chromium|chrome)(\s|$|")/.test(executable);
}

async function listChromiumProcessesForProfile(profileDir) {
  let stdout = "";

  try {
    const result = await execFileAsync("ps", ["-eww", "-o", "pid=,etimes=,args="], {
      maxBuffer: 1024 * 1024 * 8
    });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const processes = [];

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trimStart().match(/^(\d+)\s+(\d+)\s+(.+)$/);

    if (!match) {
      continue;
    }

    const pid = Number.parseInt(match[1], 10);
    const elapsedSeconds = Number.parseInt(match[2], 10);
    const command = match[3];

    if (
      Number.isInteger(pid)
      && pid !== process.pid
      && Number.isInteger(elapsedSeconds)
      && commandLooksLikeChromium(command)
      && commandUsesProfile(command, profileDir)
    ) {
      processes.push({ command, elapsedMs: elapsedSeconds * 1000, pid });
    }
  }

  return processes;
}

async function readProfileMarker(profileDir) {
  return await readJsonFile(profileMarkerPath(profileDir)).catch(() => undefined);
}

async function profileOwnership(options) {
  const marker = await readProfileMarker(options.profileDir);
  const normalizedProfileDir = normalizeProfileDir(options.profileDir);

  if (marker && normalizeProfileDir(marker.profileDir || "") === normalizedProfileDir) {
    return { marker, owned: true };
  }

  if (options.artifactsDir && pathContains(options.artifactsDir, options.profileDir)) {
    return { marker, owned: true };
  }

  return { marker, owned: false };
}

async function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function terminateProcesses(processes, label) {
  if (processes.length === 0) {
    return;
  }

  for (const processInfo of processes) {
    try {
      process.kill(processInfo.pid, "SIGTERM");
    } catch {
      // Process already exited or cannot be signalled.
    }
  }

  await sleep(750);

  for (const processInfo of processes) {
    if (await isProcessAlive(processInfo.pid)) {
      try {
        process.kill(processInfo.pid, "SIGKILL");
      } catch {
        // Process already exited or cannot be signalled.
      }
    }
  }

  console.error(`Cleaned ${processes.length} stale Chromium process(es) for ${label}.`);
}

function sessionRecordIsExpired(record) {
  const expiresAt = parseTimestampMs(record?.expiresAt || "");

  return expiresAt > 0 && expiresAt <= Date.now();
}

async function isCdpEndpointReachable(cdpEndpoint) {
  if (!cdpEndpoint) {
    return false;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let request;

    const finish = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      request?.destroy();
      resolve(value);
    };

    try {
      const url = new URL("/json/version", cdpEndpoint);
      request = http.get(url, (response) => {
        response.resume();
        finish(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 500);
      });
      request.setTimeout(1_000, () => finish(false));
      request.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

function recentRecordActivity(record, graceMs) {
  const lastActivityAt = latestTimestampMs(record?.lastActivityAt, record?.updatedAt, record?.createdAt);

  return lastActivityAt > 0 && Date.now() - lastActivityAt < graceMs;
}

async function runningRecordKeepsProfileActive(record, graceMs) {
  if (!["running", "starting"].includes(record?.status) || sessionRecordIsExpired(record)) {
    return false;
  }

  if (await isCdpEndpointReachable(record.cdpEndpoint || "")) {
    return true;
  }

  return recentRecordActivity(record, graceMs);
}

async function sessionRecordPaths(options) {
  const paths = new Set([options.activeStatePath, options.continuationStatePath].filter(Boolean));
  const sessionsDir = path.join(options.artifactsDir, "sessions");

  for (const entry of await safeReadDir(sessionsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      paths.add(path.join(sessionsDir, entry.name));
    }
  }

  return Array.from(paths);
}

async function sessionRecordsForProfile(options) {
  const normalizedProfileDir = normalizeProfileDir(options.profileDir);
  const records = [];

  for (const recordPath of await sessionRecordPaths(options)) {
    const record = await readActiveSessionRecord(recordPath).catch(() => undefined);

    if (record && normalizeProfileDir(record.profileDir || "") === normalizedProfileDir) {
      records.push({ path: recordPath, record });
    }
  }

  return records;
}

async function profileIsActiveOrRecent(options, graceMs, marker) {
  if (marker && normalizeProfileDir(marker.profileDir || "") === normalizeProfileDir(options.profileDir)) {
    if (await runningRecordKeepsProfileActive(marker, graceMs)) {
      return true;
    }
  }

  for (const { record } of await sessionRecordsForProfile(options)) {
    if (await runningRecordKeepsProfileActive(record, graceMs)) {
      return true;
    }
  }

  return false;
}

async function cleanupStaleChromiumForProfile(options) {
  const graceMs = staleChromiumGraceMs();
  const ownership = await profileOwnership(options);

  if (!ownership.owned) {
    return;
  }

  const processes = await listChromiumProcessesForProfile(options.profileDir);
  const staleProcesses = processes.filter((processInfo) => processInfo.elapsedMs >= graceMs);

  if (staleProcesses.length === 0) {
    return;
  }

  if (await profileIsActiveOrRecent(options, graceMs, ownership.marker)) {
    return;
  }

  await terminateProcesses(staleProcesses, options.profileDir);
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

async function preflightBrowserRuntime(options) {
  if (options.controlMode === "vnc") {
    await resolveVncRuntime(options);
  }

  const playwright = await loadPlaywright(options.playwrightRequireFrom);
  const executablePath = await resolveBrowserPath(options.browserPath);

  if (options.deviceName) {
    findDeviceDescriptor(playwright, options.deviceName);
  }

  if (executablePath) {
    return;
  }

  const managedChromiumPath = playwright.chromium.executablePath();

  if (!(await pathExists(managedChromiumPath))) {
    throw new Error(
      `Chromium executable not found at ${managedChromiumPath}. `
      + "Install the Playwright browser revision for the pinned project version, "
      + "or provide --browser-path to an existing Chromium executable."
    );
  }
}

async function appendLog(logPath, text) {
  await fs.appendFile(logPath, text).catch(() => {});
}

function startLoggedProcess(label, command, args, runDir, options = {}) {
  const logPath = path.join(runDir, `${label}.log`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    stdio: options.ephemeral ? "ignore" : ["ignore", "pipe", "pipe"]
  });

  if (options.ephemeral) {
    return child;
  }

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

async function writeProfileMarker(options, patch = {}) {
  const markerPath = profileMarkerPath(options.profileDir);
  const existing = await readProfileMarker(options.profileDir);
  const sameSession = existing?.activeId === options.activeId;
  const now = new Date().toISOString();
  const marker = {
    kind: "browser-handoff-profile",
    ...existing,
    activeId: options.activeId,
    status: patch.status || existing?.status || "running",
    profileDir: normalizeProfileDir(options.profileDir),
    artifactsDir: options.artifactsDir,
    activeStatePath: options.activeStatePath,
    continuationStatePath: options.continuationStatePath,
    createdAt: sameSession ? existing.createdAt || now : now,
    updatedAt: now,
    lastActivityAt: patch.lastActivityAt || (sameSession ? existing.lastActivityAt : "") || now,
    expiresAt: options.expiresAt || (sameSession ? existing.expiresAt : "") || "",
    cdpEndpoint: options.cdpEndpoint || patch.cdpEndpoint || (sameSession ? existing.cdpEndpoint : "") || "",
    ...patch
  };

  await fs.mkdir(options.profileDir, { recursive: true, mode: 0o700 });
  await writePrivateRecord(markerPath, marker);
}

async function touchSessionActivity(options, patch = {}) {
  const now = new Date().toISOString();
  const activityPatch = {
    status: "running",
    cdpEndpoint: options.cdpEndpoint || patch.cdpEndpoint || "",
    lastActivityAt: now,
    ...patch
  };

  await writeProfileMarker(options, activityPatch);
  await patchActiveSessionRecord(options, {
    lastActivityAt: activityPatch.lastActivityAt,
    updatedAt: activityPatch.lastActivityAt,
    cdpEndpoint: activityPatch.cdpEndpoint || options.cdpEndpoint || ""
  }).catch(() => {});
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
      cdpEndpoint: options.cdpEndpoint || (sameSession ? existing.cdpEndpoint : "") || "",
      updatedAt: record.updatedAt || new Date().toISOString(),
      lastActivityAt: record.lastActivityAt || (sameSession ? existing.lastActivityAt : "") || record.createdAt
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

    await writePrivateRecord(recordPath, {
      ...record,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString()
    });
  });
}

async function writeActiveSessionRecord(options, controlUrl = "", status = "running") {
  const now = new Date().toISOString();
  const record = {
    activeId: options.activeId,
    status,
    targetUrl: options.targetUrl,
    controlUrl,
    stopUrl: buildStopUrl(controlUrl, options.token),
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
    expiresAt: options.expiresAt || "",
    artifactsDir: options.artifactsDir,
    runDir: options.runDir,
    profileDir: options.profileDir,
    storageStatePath: options.storageStatePath,
    controlMode: options.controlMode,
    cdpEndpoint: options.cdpEndpoint || "",
    playwrightRequireFrom: options.playwrightRequireFrom || undefined,
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
    if (!await pathExists(recordPath)) {
      return;
    }

    await withRecordLock(recordPath, async () => {
      const record = await readActiveSessionRecord(recordPath).catch(() => undefined);

      if (record?.activeId === options.activeId) {
        const alreadyStoppedAndSanitized = record.status === "stopped"
          && !record.controlUrl
          && !record.stopUrl
          && !record.cdpEndpoint;

        if (alreadyStoppedAndSanitized) {
          return;
        }

        const wasAlreadyStopped = record.status === "stopped";
        const stoppedAt = wasAlreadyStopped
          ? record.stoppedAt || record.updatedAt || new Date().toISOString()
          : new Date().toISOString();

        await writePrivateRecord(recordPath, {
          ...record,
          status: "stopped",
          stoppedAt,
          updatedAt: wasAlreadyStopped ? record.updatedAt || stoppedAt : stoppedAt,
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

async function inactiveOptionsReason(options) {
  const expired = expirationReason(options);

  if (expired) {
    return expired;
  }

  if (options.keepPrevious) {
    return "";
  }

  const record = await readActiveSessionRecord(options.activeStatePath).catch(() => undefined);

  if (record?.activeId === options.activeId && record.status === "stopped") {
    return "stopped";
  }

  if (record?.activeId && record.activeId !== options.activeId) {
    return "replaced";
  }

  return "";
}

async function inactiveSessionReason(state) {
  return await inactiveOptionsReason(state.options);
}

function scheduleLifecycle(state) {
  if (state.options.expiresAt) {
    const delay = Math.max(0, Date.parse(state.options.expiresAt) - Date.now());
    state.expirationTimer = setTimeout(() => {
      void terminalizeBrowserSession(state, "expired");
    }, delay);
    state.expirationTimer.unref?.();
  }

  state.activeCheckTimer = setInterval(async () => {
    const inactiveReason = await inactiveSessionReason(state);

    if (inactiveReason) {
      await terminalizeBrowserSession(state, inactiveReason);
      return;
    }

    if (state.options.ephemeral) {
      const artifactBytes = await directorySize(state.options.artifactsDir);
      const profileBytes = pathContains(state.options.artifactsDir, state.options.profileDir)
        ? 0
        : await directorySize(state.options.profileDir);

      if (artifactBytes + profileBytes > DEFAULT_MAX_SESSION_BYTES) {
        await terminalizeBrowserSession(state, "resource_limit");
      }
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

  if (state.options.ephemeral && !state.options.retainArtifacts) {
    await settlePage(page);
    const savedAt = new Date().toISOString();

    state.lastSave = {
      savedAt,
      outcome,
      continuity: "live_session",
      controlState: outcome === "continue" ? "ready_for_agent" : outcome === "save_later" ? "suspended" : "canceled",
      activeId: state.options.activeId,
      activeStatePath: state.options.activeStatePath,
      currentUrl: page.url()
    };
    await touchSessionActivity(state.options, {
      lastActivityAt: savedAt,
      status: outcome === "cancel" ? "stopped" : "running"
    });

    if (outcome === "cancel") {
      setTimeout(() => void terminalizeBrowserSession(state, "canceled"), 50);
    }

    return state.lastSave;
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

  const savedAt = new Date().toISOString();

  state.lastSave = {
    savedAt,
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
  await touchSessionActivity(state.options, {
    lastActivityAt: savedAt,
    status: outcome === "cancel" ? "stopped" : "running"
  });

  return state.lastSave;
}

async function resolveResumeActiveStatePath(explicitPath) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const runtimeRoot = path.resolve(
    process.env.BROWSER_HANDOFF_RUNTIME_ROOT || path.join(os.tmpdir(), "browser-handoff")
  );
  const entries = await fs.readdir(runtimeRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(runtimeRoot, entry.name, "active.json");

    if (await pathExists(candidate)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length === 0) {
    throw new Error(`No active browser handoff found under ${runtimeRoot}.`);
  }

  throw new Error(
    `Multiple browser handoffs are active. Pass --active-state with one of:\n${candidates.join("\n")}`
  );
}

async function connectToActiveBrowser(activeStatePath, explicitPlaywrightRequireFrom = "") {
  const record = await readActiveSessionRecord(activeStatePath);

  if (!record) {
    throw new Error(`No active browser handoff found at ${activeStatePath}.`);
  }

  if (!record.cdpEndpoint) {
    throw new Error(`Active browser handoff ${record.activeId || ""} has no agent continuation endpoint.`);
  }

  const playwright = await loadPlaywright(explicitPlaywrightRequireFrom || record.playwrightRequireFrom || "");
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
  options.activeStatePath = await resolveResumeActiveStatePath(options.activeStatePath);
  const { page, record } = await connectToActiveBrowser(options.activeStatePath, options.playwrightRequireFrom);
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

function touchStateActivity(state, patch = {}) {
  const now = Date.now();

  if (state.lastActivityTouchMs && now - state.lastActivityTouchMs < 30_000) {
    return;
  }

  state.lastActivityTouchMs = now;
  void touchSessionActivity(state.options, patch).catch(() => {});
}

function vncControlHtml(options) {
  const publicPath = options.publicPath || "";
  const vncPath = `${publicPath.replace(/^\//, "")}/vnc-ws?token=${encodeURIComponent(options.token)}`;
  const iframeSrc = `${publicPath}/novnc/vnc.html?autoconnect=1&resize=scale&show_dot=1&path=${encodeURIComponent(vncPath)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.5, maximum-scale=5, user-scalable=yes">
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
      min-width: 100vw;
      min-height: 100vh;
      min-height: 100dvh;
      background: #0f1419;
      overflow: auto;
      touch-action: pan-x pan-y pinch-zoom;
    }

    .zoom-surface {
      position: relative;
      width: 100vw;
      min-height: 100vh;
      min-height: 100dvh;
    }

    .stage {
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: #0f1419;
      overflow: clip;
      transform-origin: 0 0;
      will-change: transform;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid #273440;
      background: #17212a;
      flex-wrap: wrap;
      min-width: 0;
      touch-action: pan-x pan-y pinch-zoom;
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
      white-space: nowrap;
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

    .zoom-status {
      font-size: 12px;
      color: #c4d3df;
    }

    .remote-frame-wrap {
      min-width: 0;
      min-height: 0;
      background: #050708;
    }

    iframe {
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      border: 0;
      background: #050708;
      display: block;
    }

    .local-zoom-zone {
      touch-action: pan-x pan-y pinch-zoom;
    }

    .zoom-hint {
      padding: 5px 8px;
      border-top: 1px solid #273440;
      background: #101820;
      color: #9fb0bc;
      font-size: 11px;
      line-height: 1.3;
      text-align: center;
      user-select: none;
    }

    @media (max-width: 700px) {
      .toolbar {
        gap: 6px;
        padding: 6px;
      }

      button, a {
        height: 34px;
        padding: 0 8px;
        font-size: 12px;
        line-height: 32px;
      }

      .status {
        flex-basis: 100%;
        margin-left: 0;
      }

      .zoom-hint {
        font-size: 10px;
        padding: 4px 6px;
      }
    }
  </style>
</head>
<body>
  <div id="zoomSurface" class="zoom-surface">
    <main id="stage" class="stage">
      <div class="toolbar local-zoom-zone">
        <button id="continueSave" type="button">Continue & Save</button>
        <button id="saveLater" type="button">Save for Later</button>
        <button id="cancel" type="button">Cancel</button>
        <button id="stop" type="button">Stop</button>
        <a href="${iframeSrc}" target="_blank" rel="noopener noreferrer">Full Screen noVNC</a>
        <span id="zoomStatus" class="zoom-status">Page zoom 100%</span>
        <div id="status" class="status">Connected</div>
      </div>
      <div class="remote-frame-wrap">
        <iframe src="${iframeSrc}" title="Remote browser" allow="fullscreen"></iframe>
      </div>
      <div class="zoom-hint local-zoom-zone">Pinch here or on the toolbar to zoom the whole handoff page. Pinch inside the remote desktop still goes to the remote browser.</div>
    </main>
  </div>
  <script>
    const token = ${JSON.stringify(options.token)};
    const zoomSurface = document.getElementById("zoomSurface");
    const stage = document.getElementById("stage");
    const statusEl = document.getElementById("status");
    const zoomStatusEl = document.getElementById("zoomStatus");
    const continueSaveButton = document.getElementById("continueSave");
    const saveLaterButton = document.getElementById("saveLater");
    const cancelButton = document.getElementById("cancel");
    const stopButton = document.getElementById("stop");
    const minPageZoom = 0.75;
    const maxPageZoom = 4;
    let pageZoom = 1;
    let localPinch = null;

    function clampZoom(value) {
      return Math.min(maxPageZoom, Math.max(minPageZoom, value));
    }

    function viewportSize() {
      return {
        width: window.innerWidth || document.documentElement.clientWidth || 1,
        height: window.innerHeight || document.documentElement.clientHeight || 1
      };
    }

    function applyPageZoom(nextZoom) {
      pageZoom = clampZoom(nextZoom);
      const size = viewportSize();
      stage.style.width = size.width + "px";
      stage.style.height = size.height + "px";
      stage.style.transform = "scale(" + pageZoom + ")";
      zoomSurface.style.width = Math.ceil(size.width * pageZoom) + "px";
      zoomSurface.style.height = Math.ceil(size.height * pageZoom) + "px";
      zoomStatusEl.textContent = "Page zoom " + Math.round(pageZoom * 100) + "%";
    }

    function touchDistance(touches) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    }

    function touchMidpoint(touches) {
      return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2
      };
    }

    function isLocalZoomTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }

      return Boolean(target.closest(".local-zoom-zone")) && !target.closest(".remote-frame-wrap");
    }

    function startLocalPinch(event) {
      if (event.touches.length !== 2 || !isLocalZoomTarget(event.target)) {
        return;
      }

      const midpoint = touchMidpoint(event.touches);
      localPinch = {
        distance: touchDistance(event.touches),
        zoom: pageZoom,
        midpoint,
        pagePoint: {
          x: (window.scrollX + midpoint.x) / pageZoom,
          y: (window.scrollY + midpoint.y) / pageZoom
        }
      };
    }

    function moveLocalPinch(event) {
      if (!localPinch || event.touches.length !== 2) {
        return;
      }

      event.preventDefault();
      const midpoint = touchMidpoint(event.touches);
      const distance = touchDistance(event.touches);
      const nextZoom = localPinch.zoom * (distance / localPinch.distance);
      applyPageZoom(nextZoom);
      window.scrollTo(
        Math.max(0, (localPinch.pagePoint.x * pageZoom) - midpoint.x),
        Math.max(0, (localPinch.pagePoint.y * pageZoom) - midpoint.y)
      );
    }

    function endLocalPinch(event) {
      if (event.touches.length < 2) {
        localPinch = null;
      }
    }

    window.addEventListener("resize", () => applyPageZoom(pageZoom));
    document.addEventListener("touchstart", startLocalPinch, { passive: true });
    document.addEventListener("touchmove", moveLocalPinch, { passive: false });
    document.addEventListener("touchend", endLocalPinch, { passive: true });
    document.addEventListener("touchcancel", endLocalPinch, { passive: true });
    applyPageZoom(1);

    async function postJson(path, payload = {}) {
      const response = await fetch(${JSON.stringify(publicPath)} + path + "?token=" + encodeURIComponent(token), {
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
      if (state.terminalReason) {
        if (request.method === "POST" && url.pathname === "/stop") {
          sendJson(response, 200, {
            ok: true,
            activeId: state.options.activeId,
            status: "stopped",
            reason: state.terminalReason
          });
          return;
        }

        sendJson(response, 410, terminalHandoffPayload(state.options, state.terminalReason));
        return;
      }

      if (!(request.method === "POST" && url.pathname === "/stop")) {
        const inactiveReason = await inactiveSessionReason(state);

        if (inactiveReason) {
          sendJson(response, 410, terminalHandoffPayload(state.options, inactiveReason));
          setTimeout(() => {
            void terminalizeBrowserSession(state, inactiveReason);
          }, 50);
          return;
        }
      }

      touchStateActivity(state);

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
          void terminalizeBrowserSession(state, "stopped");
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

    if (state.terminalReason) {
      rejectUpgrade(socket, 410, "Gone");
      return;
    }

    const key = request.headers["sec-websocket-key"];

    if (typeof key !== "string") {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }

    touchStateActivity(state);

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

async function stopBrowserRuntime(state) {
  if (state.runtimeStopped) {
    return;
  }

  state.runtimeStopped = true;
  clearTimeout(state.expirationTimer);
  clearInterval(state.activeCheckTimer);
  await state.context?.close().catch(() => {});

  for (const child of [...(state.childProcesses ?? [])].reverse()) {
    await stopChildProcess(child);
  }

  await writeProfileMarker(state.options, {
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    cdpEndpoint: ""
  }).catch(() => {});
  await clearActiveSessionIfCurrent(state.options);
}

async function cleanupEphemeralSession(options) {
  if (!options.ephemeral) {
    return;
  }

  await fs.rm(options.activeStatePath, { force: true });
  if (!options.retainArtifacts) {
    await fs.rm(options.artifactsDir, { force: true, recursive: true });
  }
}

async function terminalizeBrowserSession(state, reason = "stopped") {
  state.terminalReason = state.terminalReason || reason;
  await stopBrowserRuntime(state);

  if (state.options.ephemeral) {
    state.server?.close();
    await cleanupEphemeralSession(state.options);
    setImmediate(() => process.exit(0));
  }
}

async function closeBrowserAndServer(state) {
  if (state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  state.server?.close();
  await stopBrowserRuntime(state);
  await cleanupEphemeralSession(state.options);
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

function terminalHandoffPayload(options, reason) {
  return {
    error: `Browser handoff ${reason}.`,
    activeId: options.activeId,
    status: "stopped",
    reason,
    expiresAt: options.expiresAt || undefined
  };
}

async function runTerminalControlServer(options, reason) {
  await clearActiveSessionIfCurrent(options).catch(() => {});

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!isAuthorized(url, options)) {
      sendText(response, 401, "Unauthorized\n");
      return;
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      sendJson(response, 200, {
        ok: true,
        activeId: options.activeId,
        status: "stopped",
        reason
      });
      return;
    }

    sendJson(response, 410, terminalHandoffPayload(options, reason));
  });

  server.listen(options.port, options.host, () => {
    const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
    const controlUrl = `http://${displayHost}:${options.port}/?token=${encodeURIComponent(options.token)}`;

    console.log(`Browser handoff ${reason}; no browser runtime started.`);
    console.log(`Control URL: ${controlUrl}`);
    console.log(`Active ID: ${options.activeId}`);
    console.log(`Expires: ${options.expiresAt || "disabled"}`);
  });

  process.on("SIGINT", () => {
    server.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.close();
    process.exit(0);
  });
}

async function runVncBrowserServer(options) {
  if (options.mode === "serve") {
    const startupInactiveReason = await inactiveOptionsReason(options);

    if (startupInactiveReason) {
      await cleanupStaleChromiumForProfile(options);
      await runTerminalControlServer(options, startupInactiveReason);
      return;
    }
  }

  await cleanupStaleChromiumForProfile(options);
  await fs.mkdir(options.runDir, { recursive: true });
  await fs.mkdir(options.profileDir, { recursive: true });
  await writeProfileMarker(options, { status: "starting" });
  await resolveVncRuntime(options);

  const playwright = await loadPlaywright(options.playwrightRequireFrom);
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
      options.runDir,
      { ephemeral: options.ephemeral && !options.retainArtifacts }
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
      {
        env: { ...process.env, DISPLAY: options.vncDisplay },
        ephemeral: options.ephemeral && !options.retainArtifacts
      }
    );
    childProcesses.push(x11vnc);
    await waitForTcpPort(options.vncPort);

    browserOptions.env = { ...process.env, DISPLAY: options.vncDisplay };
    await fs.rm(path.join(options.profileDir, "DevToolsActivePort"), { force: true });
    context = await playwright.chromium.launchPersistentContext(options.profileDir, browserOptions);
    options.cdpEndpoint = await waitForCdpEndpoint(options.profileDir);
    await patchActiveSessionRecord(options, { cdpEndpoint: options.cdpEndpoint });
    await writeProfileMarker(options, {
      status: "running",
      cdpEndpoint: options.cdpEndpoint,
      lastActivityAt: new Date().toISOString()
    });
    const initialPage = getActivePage(context, undefined) ?? await context.newPage();
    const state = {
      options,
      context,
      initialPage,
      server: undefined,
      shuttingDown: false,
      runtimeStopped: false,
      terminalReason: "",
      lastSave: undefined,
      childProcesses
    };

    if (!options.ephemeral || options.retainArtifacts) {
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
    }

    await initialPage.goto(options.targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await settlePage(initialPage);
    if (!options.ephemeral || options.retainArtifacts) {
      await fs.writeFile(path.join(options.runDir, "initial.html"), await initialPage.content(), "utf8");
      await fs.writeFile(path.join(options.runDir, "initial-url.txt"), `${initialPage.url()}\n`, "utf8");
      await initialPage.screenshot({
        path: path.join(options.runDir, "initial.png"),
        fullPage: true,
        animations: "disabled",
        timeout: 30_000
      }).catch(() => {});
    }

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
    await cleanupEphemeralSession(options).catch(() => {});
    throw error;
  }
}

async function runBrowserServer(options) {
  await runVncBrowserServer(options);
}

function gatewayAuthorized(request, secret) {
  if (!secret) {
    return false;
  }

  const authorization = request.headers.authorization || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);

  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function validateGatewaySessionRequest(payload) {
  if (payload.protocolVersion !== GATEWAY_PROTOCOL_VERSION) {
    throw new Error(`Unsupported gateway protocol version: ${payload.protocolVersion ?? "missing"}.`);
  }

  let targetUrl;

  try {
    targetUrl = new URL(String(payload.targetUrl || ""));
  } catch {
    throw new Error("Gateway session requires a valid targetUrl.");
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    throw new Error(`Unsupported URL protocol: ${targetUrl.protocol}`);
  }

  const ttlMinutes = Number(payload.ttlMinutes ?? DEFAULT_TTL_MINUTES);

  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 60) {
    throw new Error("Gateway browser sessions require a TTL greater than 0 and no more than 60 minutes.");
  }

  const noVncWebRoot = path.resolve(String(payload.noVncWebRoot || ""));

  if (!payload.xvfbPath || !payload.x11vncPath || !noVncWebRoot
    || !(await pathExists(path.join(noVncWebRoot, "vnc.html")))) {
    throw new Error("Gateway session requires valid Xvfb, x11vnc, and noVNC runtime paths.");
  }
}

async function getFreeLoopbackPort() {
  const server = net.createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));

  if (!port) {
    throw new Error("Could not allocate a browser worker port.");
  }

  return port;
}

async function reserveLoopbackPort(reservedPorts) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await getFreeLoopbackPort();

    if (!reservedPorts.has(port)) {
      reservedPorts.add(port);
      return port;
    }
  }

  throw new Error("Could not reserve a unique browser handoff port.");
}

async function reserveVncDisplay(reservedDisplays) {
  for (let displayNumber = 90; displayNumber < 190; displayNumber += 1) {
    const display = `:${displayNumber}`;

    if (!reservedDisplays.has(display)
      && !await pathExists(path.join(os.tmpdir(), ".X11-unix", `X${displayNumber}`))) {
      reservedDisplays.add(display);
      return display;
    }
  }

  throw new Error("No VNC display is available for a browser handoff.");
}

function validateGatewayRuntimeRoot(runtimeRoot) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(runtimeRoot);

  if (resolved === temporaryRoot
    || !pathContains(temporaryRoot, resolved)
    || !path.basename(resolved).startsWith("browser-handoff")) {
    throw new Error(`Refusing unsafe browser handoff runtime root: ${resolved}`);
  }
}

async function directorySize(root) {
  let total = 0;

  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += await fs.stat(entryPath).then((stat) => stat.size).catch(() => 0);
    }
  }

  return total;
}

async function pruneRetainedArtifacts(root, maximumDirectories = 3, maximumBytes = 50 * 1024 * 1024) {
  const entries = (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  while (entries.length > maximumDirectories) {
    await fs.rm(path.join(root, entries.shift()), { force: true, recursive: true });
  }

  while (entries.length > 0 && await directorySize(root) > maximumBytes) {
    await fs.rm(path.join(root, entries.shift()), { force: true, recursive: true });
  }
}

async function prunePersistentProfile(profileDirectory) {
  const cachePaths = [
    "BrowserMetrics",
    "component_crx_cache",
    "extensions_crx_cache",
    "GraphiteDawnCache",
    "GrShaderCache",
    "ShaderCache",
    path.join("Default", "Cache"),
    path.join("Default", "Code Cache"),
    path.join("Default", "GPUCache"),
    path.join("Default", "Service Worker", "CacheStorage")
  ];

  for (const relativePath of cachePaths) {
    await fs.rm(path.join(profileDirectory, relativePath), { force: true, recursive: true });
  }

  for (const entry of await fs.readdir(profileDirectory, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith("BrowserMetrics-")) {
      await fs.rm(path.join(profileDirectory, entry.name), { force: true, recursive: true });
    }
  }

  if (await directorySize(profileDirectory) > DEFAULT_MAX_SESSION_BYTES) {
    await fs.rm(profileDirectory, { force: true, recursive: true });
  }
}

async function prunePersistentProfiles(root, activeProfiles, maximumProfiles = 3) {
  const profiles = [];

  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) {
      continue;
    }

    const profileDirectory = path.join(root, entry.name);
    const marker = await fs.stat(profileMarkerPath(profileDirectory)).catch(() => undefined);
    const directory = await fs.stat(profileDirectory).catch(() => undefined);
    profiles.push({
      path: profileDirectory,
      key: normalizeProfileDir(profileDirectory),
      updatedAt: marker?.mtimeMs || directory?.mtimeMs || 0
    });
  }

  profiles.sort((left, right) => left.updatedAt - right.updatedAt);
  const removable = () => profiles.findIndex((profile) => !activeProfiles.has(profile.key));

  while (profiles.length > maximumProfiles || await directorySize(root) > DEFAULT_MAX_SESSION_BYTES) {
    const index = removable();

    if (index < 0) {
      break;
    }

    const [profile] = profiles.splice(index, 1);
    await fs.rm(profile.path, { force: true, recursive: true });
  }
}

async function waitForGatewayWorker(session, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (session.child.exitCode !== null || session.child.signalCode !== null) {
      throw new Error(session.stderr.trim() || "Browser worker exited before becoming ready.");
    }

    try {
      const response = await fetch(`http://127.0.0.1:${session.port}/status`);

      if (response.ok) {
        return;
      }
    } catch {
      // The worker is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Browser worker did not become ready before the startup timeout.");
}

function proxyGatewayRequest(request, response, session) {
  const upstream = http.request({
    host: "127.0.0.1",
    port: session.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `127.0.0.1:${session.port}` }
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", (error) => {
    if (!response.headersSent) {
      sendJson(response, 502, { error: error.message });
    } else {
      response.destroy(error);
    }
  });
  request.pipe(upstream);
}

function proxyGatewayUpgrade(request, socket, head, session) {
  const upstream = net.connect({ host: "127.0.0.1", port: session.port }, () => {
    const headers = [];

    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = name.toLowerCase() === "host" ? `127.0.0.1:${session.port}` : request.rawHeaders[index + 1];
      headers.push(`${name}: ${value}`);
    }

    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function gatewaySessionRoute(pathname, sessions) {
  const match = pathname.match(/^\/sessions\/([a-f0-9]{24})(\/.*)?$/);

  if (!match) {
    return undefined;
  }

  const session = sessions.get(match[1]);

  return session
    ? { session, basePath: `/sessions/${match[1]}`, upstreamPath: match[2] || "/" }
    : undefined;
}

function requestCookie(request, name) {
  const encoded = (request.headers.cookie || "").split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  if (!encoded) {
    return "";
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
}

function gatewaySessionCookie(route, handle) {
  return `browser_handoff_session=${encodeURIComponent(handle)}; Path=${route.basePath}/; HttpOnly; Secure; SameSite=Lax`;
}

async function runGateway(argv) {
  const options = parseGatewayArgs(argv);
  const sessions = new Map();
  const recentFailures = [];
  const reservedDisplays = new Set();
  const reservedPorts = new Set();
  const reservedProfiles = new Set();
  const buildId = await currentImplementationBuildId();

  if (options.buildId && options.buildId !== buildId) {
    throw new Error("Browser handoff gateway build identity does not match its script.");
  }

  if (!options.secret) {
    const state = await readJsonFile(path.join(options.stateDirectory, "gateway.json")).catch(() => ({}));
    options.secret = defaultString(state.secret);
  }

  if (!options.secret) {
    throw new Error("Browser handoff gateway has no session-creation secret.");
  }

  validateGatewayRuntimeRoot(options.runtimeRoot);
  await fs.rm(options.runtimeRoot, { force: true, recursive: true });

  const cleanupSession = async (session, terminate = true) => {
    if (!session) {
      return;
    }

    if (session.cleanupPromise) {
      return await session.cleanupPromise;
    }

    session.cleanupPromise = (async () => {
      sessions.delete(session.id);

      if (terminate && session.child && session.child.exitCode === null && session.child.signalCode === null) {
        try {
          process.kill(-session.child.pid, "SIGTERM");
        } catch {
          // The worker already exited.
        }

        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          session.child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }

      if (session.child?.pid) {
        try {
          process.kill(-session.child.pid, "SIGKILL");
        } catch {
          // The process group is already gone.
        }
      }

      if (session.profileDirectory && !pathContains(session.directory, session.profileDirectory)) {
        await prunePersistentProfile(session.profileDirectory);
        const protectedProfiles = new Set(reservedProfiles);
        protectedProfiles.delete(session.profileKey);
        await prunePersistentProfiles(path.join(options.stateDirectory, "profiles"), protectedProfiles);
      }

      if (session.retainArtifacts) {
        await fs.rm(path.join(session.directory, "profile"), { force: true, recursive: true });
        await fs.rm(path.join(session.directory, "sessions"), { force: true, recursive: true });
        await fs.rm(path.join(session.directory, "storage-state.json"), { force: true });
        await fs.rm(path.join(session.directory, "active.json"), { force: true });
        await fs.rm(path.join(session.directory, "active.json.lock"), { force: true });
        await pruneRetainedArtifacts(path.dirname(session.directory));
      } else {
        await fs.rm(session.directory, { force: true, recursive: true });
      }
    })().finally(() => {
      reservedDisplays.delete(session.vncDisplay);
      reservedPorts.delete(session.port);
      reservedPorts.delete(session.vncPort);
      reservedProfiles.delete(session.profileKey);
    });

    return await session.cleanupPromise;
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/gateway/health") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        buildId,
        activeSessions: sessions.size
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/gateway/sessions") {
      if (!gatewayAuthorized(request, options.secret)) {
        sendText(response, 401, "Unauthorized\n");
        return;
      }

      const cutoff = Date.now() - 60_000;

      while (recentFailures.length > 0 && recentFailures[0] < cutoff) {
        recentFailures.shift();
      }

      if (recentFailures.length >= 3) {
        sendJson(response, 503, { error: "Browser session startup circuit breaker is open; retry in one minute." });
        return;
      }

      if (sessions.size >= 4) {
        sendJson(response, 429, { error: "Browser handoff gateway is at its four-session limit." });
        return;
      }

      let startingSession;
      let reservedDisplay = "";
      let reservedProfileKey = "";
      let workerPort = 0;
      let workerVncPort = 0;

      try {
        const payload = await readJsonBody(request);
        await validateGatewaySessionRequest(payload);
        const persistentProfile = String(payload.persistProfile || "");

        if (persistentProfile && !/^[A-Za-z0-9_-]{1,64}$/.test(persistentProfile)) {
          throw new Error("Persistent profile names may contain only letters, numbers, dashes, and underscores.");
        }

        const sessionId = defaultActiveId();
        const sessionHandle = `${sessionId}.${crypto.randomBytes(24).toString("hex")}`;
        const retainArtifacts = payload.retainArtifacts === true;
        const directory = retainArtifacts
          ? path.join(options.stateDirectory, "artifacts", sessionId)
          : path.join(options.runtimeRoot, sessionId);
        const profileDirectory = persistentProfile
          ? path.join(options.stateDirectory, "profiles", persistentProfile)
          : path.join(directory, "profile");
        const profileKey = persistentProfile ? normalizeProfileDir(profileDirectory) : "";

        if (profileKey && reservedProfiles.has(profileKey)) {
          throw new Error(`Persistent browser profile is already in use: ${persistentProfile}`);
        }

        if (profileKey) {
          reservedProfiles.add(profileKey);
          reservedProfileKey = profileKey;
        }

        workerPort = await reserveLoopbackPort(reservedPorts);
        workerVncPort = await reserveLoopbackPort(reservedPorts);
        reservedDisplay = await reserveVncDisplay(reservedDisplays);
        const workerToken = crypto.randomBytes(18).toString("hex");
        const command = [
          fileURLToPath(import.meta.url),
          payload.targetUrl,
          "--local",
          "--ephemeral",
          "--trust-proxy-token",
          "--host",
          "127.0.0.1",
          "--port",
          String(workerPort),
          "--token",
          workerToken,
          "--public-path",
          `/sessions/${sessionId}`,
          "--active-id",
          sessionId,
          "--active-state",
          path.join(directory, "active.json"),
          "--artifacts-dir",
          directory,
          "--profile-dir",
          profileDirectory,
          "--storage-state",
          path.join(directory, "storage-state.json"),
          "--ttl-minutes",
          String(payload.ttlMinutes ?? DEFAULT_TTL_MINUTES),
          "--xvfb",
          payload.xvfbPath,
          "--x11vnc",
          payload.x11vncPath,
          "--novnc-web",
          payload.noVncWebRoot,
          "--vnc-display",
          reservedDisplay,
          "--vnc-port",
          String(workerVncPort)
        ];

        if (retainArtifacts) {
          command.push("--retain-artifacts");
        }
        const optionalArguments = [
          ["--browser-path", payload.browserPath],
          ["--playwright-require-from", payload.playwrightRequireFrom],
          ["--device", payload.deviceName],
          ["--user-agent", payload.userAgent],
          ["--viewport", payload.viewport],
          ["--device-scale-factor", payload.deviceScaleFactor],
          ["--is-mobile", payload.isMobile],
          ["--has-touch", payload.hasTouch]
        ];

        for (const [name, value] of optionalArguments) {
          if (value !== undefined && value !== "") {
            command.push(name, String(value));
          }
        }

        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const child = spawn(process.execPath, command, {
          detached: true,
          env: { ...process.env, BROWSER_HANDOFF_ACTIVE_STATE: "" },
          stdio: ["ignore", "ignore", "pipe"]
        });
        const session = {
          id: sessionId,
          handle: sessionHandle,
          directory,
          profileDirectory,
          retainArtifacts,
          port: workerPort,
          vncPort: workerVncPort,
          vncDisplay: reservedDisplay,
          profileKey,
          child,
          stderr: ""
        };
        startingSession = session;
        sessions.set(sessionId, session);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          session.stderr = `${session.stderr}${chunk}`.slice(-64 * 1024);
        });
        child.once("exit", () => void cleanupSession(session, false));
        await waitForGatewayWorker(session);
        sendJson(response, 201, {
          ok: true,
          activeId: sessionId,
          sessionHandle,
          activeStatePath: path.join(directory, "active.json")
        });
      } catch (error) {
        if (startingSession) {
          recentFailures.push(Date.now());
        } else {
          reservedDisplays.delete(reservedDisplay);
          reservedPorts.delete(workerPort);
          reservedPorts.delete(workerVncPort);
          reservedProfiles.delete(reservedProfileKey);
        }
        await cleanupSession(startingSession);
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    const route = gatewaySessionRoute(url.pathname, sessions);

    if (!route) {
      sendJson(response, 410, { error: "No active browser handoff." });
      return;
    }

    const requestedHandle = url.searchParams.get("handoff") || "";

    if (requestedHandle && request.method === "GET" && route.upstreamPath === "/") {
      if (route.session.handle !== requestedHandle) {
        sendJson(response, 410, { error: "Browser handoff session is unavailable." });
        return;
      }

      response.writeHead(302, {
        location: `${route.basePath}/`,
        "set-cookie": gatewaySessionCookie(route, requestedHandle),
        "cache-control": "no-store"
      });
      response.end();
      return;
    }

    const sessionHandle = requestCookie(request, "browser_handoff_session");

    if (route.session.handle !== sessionHandle) {
      sendJson(response, 410, { error: "No active browser handoff." });
      return;
    }

    request.url = `${route.upstreamPath}${url.search}`;
    proxyGatewayRequest(request, response, route.session);
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const route = gatewaySessionRoute(url.pathname, sessions);
    const sessionHandle = requestCookie(request, "browser_handoff_session");

    if (!route || route.session.handle !== sessionHandle) {
      rejectUpgrade(socket, 410, "Gone");
      return;
    }

    request.url = `${route.upstreamPath}${url.search}`;
    proxyGatewayUpgrade(request, socket, head, route.session);
  });

  const close = async () => {
    server.close();
    await Promise.all([...sessions.values()].map((session) => cleanupSession(session)));
  };

  process.once("SIGINT", () => void close().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
}

function gatewayStateDirectory() {
  return path.join(os.homedir(), ".local", "state", "browser-handoff");
}

async function currentImplementationBuildId() {
  const source = await fs.readFile(fileURLToPath(import.meta.url));
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
}

async function gatewayHealth(controlUrl) {
  try {
    const url = new URL(controlUrl);
    url.pathname = "/gateway/health";
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const result = await response.json();
    return response.ok
      && result.protocolVersion === GATEWAY_PROTOCOL_VERSION
      && result.buildId === await currentImplementationBuildId();
  } catch {
    return false;
  }
}

async function waitForGatewayHealth(controlUrl, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await gatewayHealth(controlUrl)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function ensureGatewayDeployment(options) {
  const stateDirectory = gatewayStateDirectory();
  const statePath = path.join(stateDirectory, "gateway.json");
  const manifestPath = path.join(stateDirectory, "website.json");
  const existing = await readJsonFile(statePath).catch(() => ({}));
  const buildId = await currentImplementationBuildId();
  const state = {
    subdomain: defaultString(existing.subdomain) || "browser-handoff",
    secret: defaultString(existing.secret) || crypto.randomBytes(32).toString("hex")
  };
  let controlUrl = "";

  try {
    const linked = await execFileAsync(options.siteManager, ["link", state.subdomain], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    controlUrl = linked.stdout.trim();
  } catch {
    // The gateway has not been registered yet.
  }

  if (controlUrl && await gatewayHealth(controlUrl)) {
    return { ...state, controlUrl };
  }

  const manifest = [{
    subdomain: state.subdomain,
    access: { mode: "token" },
    service: {
      command: [
        options.nodePath,
        options.scriptPath,
        "gateway",
        "--build-id",
        buildId,
        "--host",
        "127.0.0.1",
        "--runtime-root",
        path.join(os.tmpdir(), "browser-handoff"),
        "--state-dir",
        stateDirectory
      ],
      workingDirectory: process.cwd()
    }
  }];

  await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writePrivateRecord(statePath, state);
  await writePrivateRecord(manifestPath, manifest);
  await execFileAsync(options.siteManager, ["deploy", manifestPath], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  const linked = await execFileAsync(options.siteManager, ["link", state.subdomain], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  controlUrl = linked.stdout.trim();

  if (!await waitForGatewayHealth(controlUrl)) {
    throw new Error("Browser handoff gateway did not become healthy after deployment.");
  }

  return { ...state, controlUrl };
}

async function openGatewaySession(options) {
  const gateway = await ensureGatewayDeployment(options);
  const sessionUrl = new URL(gateway.controlUrl);
  sessionUrl.pathname = "/gateway/sessions";
  const response = await fetch(sessionUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gateway.secret}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      targetUrl: options.targetUrl,
      ttlMinutes: options.ttlMinutes,
      browserPath: options.browserPath,
      playwrightRequireFrom: options.playwrightRequireFrom,
      xvfbPath: options.xvfbPath,
      x11vncPath: options.x11vncPath,
      noVncWebRoot: options.noVncWebRoot,
      deviceName: options.deviceName || undefined,
      userAgent: options.userAgent || undefined,
      viewport: options.viewportWasExplicit ? `${options.viewport.width}x${options.viewport.height}` : undefined,
      deviceScaleFactor: options.deviceScaleFactor,
      isMobile: options.isMobile,
      hasTouch: options.hasTouch,
      retainArtifacts: options.retainArtifacts,
      persistProfile: options.persistProfile || undefined
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `Browser gateway returned ${response.status}.`);
  }

  const controlUrl = new URL(gateway.controlUrl);
  controlUrl.pathname = `/sessions/${result.activeId}/`;
  controlUrl.searchParams.set("handoff", result.sessionHandle);
  console.log(`Control URL: ${controlUrl}`);
  console.log(`Active ID: ${result.activeId}`);
  console.log(`Active state: ${result.activeStatePath}`);
  console.log(`Expires: ${options.expiresAt || `${options.ttlMinutes} minutes after start`}`);
  console.log("After sending the Control URL, end the agent turn. Resume only when the user messages back.");
}

async function main() {
  if (process.argv[2] === "gateway") {
    await runGateway(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === "resume") {
    await runResumeCommand(process.argv.slice(3));
    return;
  }

  const options = parseArgs(process.argv.slice(2));
  prepareLifecycleOptions(options);
  options.playwrightRequireFrom = await resolvePlaywrightRequireFrom(
    options.playwrightRequireFrom,
    options.mode === "deploy" ? "" : options.artifactsDir
  );

  if (options.mode === "deploy") {
    await preflightBrowserRuntime(options);
    await openGatewaySession(options);
    return;
  }

  if (options.mode === "local") {
    await stopPreviousActiveSession(options);
    await cleanupStaleChromiumForProfile(options);
    await writeActiveSessionRecord(options, "", "starting");
    await writeWorkspaceDefaults(options);
  }

  await runBrowserServer(options);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export { gatewaySessionCookie, gatewaySessionRoute, requestCookie };
