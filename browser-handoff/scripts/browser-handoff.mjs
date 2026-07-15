#!/usr/bin/env node
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const STREAM_BOUNDARY = "browser-handoff-frame";
const OUTCOMES = new Set(["continue", "save_later", "cancel"]);
const execFileAsync = promisify(execFile);

/** @typedef {{ width: number, height: number }} Viewport */
/** @typedef {{
 * targetUrl: string,
 * host: string,
 * port: number,
 * token: string,
 * artifactsDir: string,
 * runDir: string,
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
 * frameIntervalMs: number,
 * allowExternalHost: boolean,
 * slowMo: number,
 * mode: "deploy" | "local" | "serve",
 * subdomain: string,
 * siteManager: string,
 * nodePath: string,
 * scriptPath: string,
 * trustProxyToken: boolean
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
  --artifacts-dir <path>        Artifact root. Default: ./artifacts/browser-handoff
  --profile-dir <path>          Persistent Chromium profile. Default: <artifacts-dir>/profile
  --storage-state <path>        Storage-state output. Default: <artifacts-dir>/storage-state.json
  --headless <0|1>              Headless Chromium. Default: 1
  --browser-path <path>         Chromium executable. Default: BROWSER_PATH, /usr/bin/chromium, or Playwright managed
  --device <name>               Playwright device profile, e.g. "iPhone 14" or "Pixel 7"
  --user-agent <value>          Override browser user agent
  --is-mobile <0|1>             Override Playwright mobile mode
  --has-touch <0|1>             Override touch support
  --device-scale-factor <n>     Override device scale factor
  --viewport <width>x<height>   Viewport. Default: 1440x960
  --frame-interval-ms <ms>      Screenshot stream interval. Default: 500
  --slow-mo <ms>                Playwright slowMo. Default: 50
  --site-manager <path>         site-manager executable. Default: site-manager
  --node <path>                 Node executable for deployed service. Default: current node
  --allow-external-host         Allow non-loopback bind host in --local/--serve
  --help                       Show this help

Environment mirrors:
  BROWSER_HANDOFF_HOST, BROWSER_HANDOFF_PORT, BROWSER_HANDOFF_TOKEN,
  BROWSER_HANDOFF_ARTIFACTS_DIR, BROWSER_HANDOFF_PROFILE_DIR,
  BROWSER_HANDOFF_STORAGE_STATE, BROWSER_HANDOFF_HEADLESS,
  BROWSER_HANDOFF_FRAME_INTERVAL_MS, BROWSER_HANDOFF_SUBDOMAIN,
  BROWSER_HANDOFF_SITE_MANAGER, BROWSER_HANDOFF_ALLOW_EXTERNAL_HOST,
  BROWSER_HANDOFF_DEVICE, BROWSER_HANDOFF_USER_AGENT,
  BROWSER_HANDOFF_IS_MOBILE, BROWSER_HANDOFF_HAS_TOUCH,
  BROWSER_HANDOFF_DEVICE_SCALE_FACTOR,
  BROWSER_PATH, PORT
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

function parseArgs(argv) {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }

  let targetUrl = "";
  const flags = new Map();
  const booleans = new Set(["allow-external-host", "local", "serve", "trust-proxy-token"]);

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
  const viewportValue = flags.get("viewport") || process.env.BROWSER_HANDOFF_VIEWPORT || "";
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
    artifactsDir,
    runDir,
    profileDir,
    storageStatePath,
    latestJsonPath: path.join(artifactsDir, "latest.json"),
    headless: parseBoolean(flags.get("headless") || process.env.BROWSER_HANDOFF_HEADLESS, true),
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
    frameIntervalMs: parsePositiveInt(
      flags.get("frame-interval-ms") || process.env.BROWSER_HANDOFF_FRAME_INTERVAL_MS || "500",
      "frame interval"
    ),
    allowExternalHost,
    slowMo: Number.parseInt(flags.get("slow-mo") || process.env.BROWSER_HANDOFF_SLOW_MO || "50", 10),
    mode,
    subdomain: flags.get("subdomain") || process.env.BROWSER_HANDOFF_SUBDOMAIN || defaultSubdomain(),
    siteManager: flags.get("site-manager") || process.env.BROWSER_HANDOFF_SITE_MANAGER || "site-manager",
    nodePath: flags.get("node") || process.execPath,
    scriptPath: fileURLToPath(import.meta.url),
    trustProxyToken: flags.has("trust-proxy-token")
  };
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

async function resolveBrowserPath(explicitPath) {
  if (explicitPath) {
    return explicitPath;
  }

  if (await pathExists("/usr/bin/chromium")) {
    return "/usr/bin/chromium";
  }

  return undefined;
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

function normalizeButton(button) {
  if (button === 1 || button === "middle") {
    return "middle";
  }

  if (button === 2 || button === "right") {
    return "right";
  }

  return "left";
}

function normalizeKeyName(input) {
  const key = String(input ?? "");
  const aliases = new Map([
    [" ", "Space"],
    ["Esc", "Escape"],
    ["Del", "Delete"],
    ["Left", "ArrowLeft"],
    ["Right", "ArrowRight"],
    ["Up", "ArrowUp"],
    ["Down", "ArrowDown"]
  ]);

  return aliases.get(key) ?? key;
}

function buildShortcut(payload) {
  const key = normalizeKeyName(payload.key);
  const parts = [];

  if (payload.ctrlKey) {
    parts.push("Control");
  }

  if (payload.altKey) {
    parts.push("Alt");
  }

  if (payload.shiftKey && key.length !== 1) {
    parts.push("Shift");
  }

  if (payload.metaKey) {
    parts.push("Meta");
  }

  parts.push(key.length === 1 ? key.toUpperCase() : key);

  return parts.join("+");
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
    controlState: outcome === "continue" ? "agent_resumed" : outcome === "save_later" ? "suspended" : "canceled",
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

async function captureScreenshot(page) {
  await page.bringToFront().catch(() => {});

  return page.screenshot({
    type: "jpeg",
    quality: 72,
    fullPage: false,
    timeout: 10_000
  });
}

async function sendInput(state, payload) {
  const page = getActivePage(state.context, state.initialPage);
  const x = Number(payload.x);
  const y = Number(payload.y);
  const hasPoint = Number.isFinite(x) && Number.isFinite(y);

  if (page.isClosed()) {
    throw new Error("The browser page is closed.");
  }

  await page.bringToFront().catch(() => {});

  switch (payload.type) {
    case "pointerdown":
      if (!hasPoint) {
        throw new Error("pointerdown requires x and y.");
      }
      await page.mouse.move(x, y);
      await page.mouse.down({ button: normalizeButton(payload.button) });
      break;
    case "pointermove":
      if (!hasPoint) {
        throw new Error("pointermove requires x and y.");
      }
      await page.mouse.move(x, y);
      break;
    case "pointerup":
      if (!hasPoint) {
        throw new Error("pointerup requires x and y.");
      }
      await page.mouse.move(x, y);
      await page.mouse.up({ button: normalizeButton(payload.button) });
      break;
    case "click":
      if (!hasPoint) {
        throw new Error("click requires x and y.");
      }
      await page.mouse.click(x, y, {
        button: normalizeButton(payload.button),
        clickCount: Number(payload.clickCount) || 1,
        delay: 50
      });
      break;
    case "wheel":
      await page.mouse.wheel(Number(payload.deltaX) || 0, Number(payload.deltaY) || 0);
      break;
    case "key": {
      const key = String(payload.key ?? "");

      if (key.length === 1 && !payload.ctrlKey && !payload.altKey && !payload.metaKey) {
        await page.keyboard.type(key);
      } else {
        await page.keyboard.press(buildShortcut(payload));
      }
      break;
    }
    case "text":
      await page.keyboard.type(String(payload.text ?? ""));
      break;
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      break;
    default:
      throw new Error(`Unsupported input type: ${payload.type}`);
  }
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

function remoteControlHtml(options) {
  const viewport = options.viewport;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Browser Handoff</title>
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
      display: grid;
      grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 360px) auto auto auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border-bottom: 1px solid #273440;
      background: #17212a;
    }

    .url {
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 13px;
      color: #bfd0dd;
    }

    button, input {
      height: 32px;
      border: 1px solid #3b4d5c;
      border-radius: 6px;
      padding: 0 10px;
      background: #101820;
      color: #eef3f7;
      font: inherit;
      font-size: 13px;
    }

    button {
      cursor: pointer;
      background: #22313b;
    }

    button:hover {
      background: #2d3d48;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.65;
    }

    .stage {
      min-height: 0;
      display: grid;
      place-items: center;
      overflow: auto;
      background: #080c10;
    }

    #screen {
      display: block;
      width: min(100vw, calc(100vh * ${viewport.width / viewport.height}));
      max-width: 100vw;
      height: auto;
      aspect-ratio: ${viewport.width} / ${viewport.height};
      background: #050708;
      cursor: crosshair;
      user-select: none;
      -webkit-user-drag: none;
    }

    .status {
      font-size: 12px;
      color: #9fb0bc;
    }

    @media (max-width: 900px) {
      .toolbar {
        grid-template-columns: 1fr 1fr;
      }

      .url, #gotoInput, .status {
        grid-column: 1 / -1;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div id="url" class="url">Loading...</div>
    <button id="reload" type="button">Reload</button>
    <input id="gotoInput" type="url" autocomplete="off" placeholder="Go to URL">
    <button id="gotoButton" type="button">Go</button>
    <input id="textInput" type="text" autocomplete="off" placeholder="Text to type">
    <button id="sendText" type="button">Send Text</button>
    <button id="continueSave" type="button">Continue & Save</button>
    <button id="saveLater" type="button">Save for Later</button>
    <button id="cancel" type="button">Cancel</button>
    <button id="stop" type="button">Stop</button>
    <div id="status" class="status">Connected</div>
  </div>
  <main class="stage">
    <img id="screen" alt="Remote browser screen" draggable="false" src="/stream?token=${options.token}">
  </main>
  <script>
    const token = ${JSON.stringify(options.token)};
    const viewport = ${JSON.stringify(options.viewport)};
    const screen = document.getElementById("screen");
    const statusEl = document.getElementById("status");
    const urlEl = document.getElementById("url");
    const reloadButton = document.getElementById("reload");
    const gotoInput = document.getElementById("gotoInput");
    const gotoButton = document.getElementById("gotoButton");
    const textInput = document.getElementById("textInput");
    const sendTextButton = document.getElementById("sendText");
    const continueSaveButton = document.getElementById("continueSave");
    const saveLaterButton = document.getElementById("saveLater");
    const cancelButton = document.getElementById("cancel");
    const stopButton = document.getElementById("stop");
    let pointerIsDown = false;
    let pointerStart = null;
    let dragStarted = false;
    let lastPointerMoveAt = 0;
    let inputQueue = Promise.resolve();

    function pointFromEvent(event) {
      const rect = screen.getBoundingClientRect();
      const x = Math.max(0, Math.min(viewport.width, ((event.clientX - rect.left) / rect.width) * viewport.width));
      const y = Math.max(0, Math.min(viewport.height, ((event.clientY - rect.top) / rect.height) * viewport.height));
      return { x, y };
    }

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

    function reportError(error) {
      statusEl.textContent = error.message || String(error);
    }

    function setOutcomeButtonsDisabled(disabled) {
      continueSaveButton.disabled = disabled;
      saveLaterButton.disabled = disabled;
      cancelButton.disabled = disabled;
    }

    function queueInput(payload) {
      inputQueue = inputQueue
        .catch(() => {})
        .then(() => postJson("/input", payload))
        .catch(reportError);
      return inputQueue;
    }

    screen.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      screen.setPointerCapture(event.pointerId);
      pointerIsDown = true;
      pointerStart = { button: event.button, point: pointFromEvent(event) };
      dragStarted = false;
    });

    screen.addEventListener("pointermove", (event) => {
      if (!pointerIsDown) {
        return;
      }

      const point = pointFromEvent(event);
      const distance = pointerStart
        ? Math.hypot(point.x - pointerStart.point.x, point.y - pointerStart.point.y)
        : 0;

      if (!dragStarted && distance > 5 && pointerStart) {
        dragStarted = true;
        queueInput({ type: "pointerdown", button: pointerStart.button, ...pointerStart.point });
      }

      if (!dragStarted) {
        return;
      }

      const now = Date.now();

      if (now - lastPointerMoveAt < 60) {
        return;
      }

      lastPointerMoveAt = now;
      event.preventDefault();
      queueInput({ type: "pointermove", ...point });
    });

    screen.addEventListener("pointerup", (event) => {
      event.preventDefault();
      pointerIsDown = false;
      const point = pointFromEvent(event);

      if (dragStarted) {
        queueInput({ type: "pointerup", button: pointerStart?.button ?? event.button, ...point });
      } else {
        queueInput({ type: "click", button: pointerStart?.button ?? event.button, ...point });
      }

      pointerStart = null;
      dragStarted = false;
    });

    screen.addEventListener("wheel", async (event) => {
      event.preventDefault();
      try {
        await postJson("/input", { type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY });
      } catch (error) {
        reportError(error);
      }
    }, { passive: false });

    window.addEventListener("keydown", async (event) => {
      if (event.target && ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(event.target.tagName)) {
        return;
      }

      event.preventDefault();
      try {
        await postJson("/input", {
          type: "key",
          key: event.key,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey
        });
      } catch (error) {
        reportError(error);
      }
    });

    reloadButton.addEventListener("click", async () => {
      reloadButton.disabled = true;
      try {
        await postJson("/input", { type: "reload" });
      } catch (error) {
        reportError(error);
      } finally {
        reloadButton.disabled = false;
      }
    });

    gotoButton.addEventListener("click", async () => {
      const url = gotoInput.value.trim();
      if (!url) {
        return;
      }
      gotoButton.disabled = true;
      try {
        const payload = await postJson("/goto", { url });
        urlEl.textContent = payload.currentUrl || url;
        statusEl.textContent = "Navigated";
      } catch (error) {
        reportError(error);
      } finally {
        gotoButton.disabled = false;
      }
    });

    gotoInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        gotoButton.click();
      }
    });

    sendTextButton.addEventListener("click", () => {
      const text = textInput.value;
      if (!text) {
        return;
      }
      queueInput({ type: "text", text });
      textInput.value = "";
      screen.focus();
    });

    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendTextButton.click();
      }
    });

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
        urlEl.textContent = payload.currentUrl || urlEl.textContent;
      } catch (error) {
        reportError(error);
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
        reportError(error);
        stopButton.disabled = false;
      }
    });

    async function refreshStatus() {
      try {
        const response = await fetch("/status?token=" + encodeURIComponent(token));
        const payload = await response.json();
        if (response.ok) {
          urlEl.textContent = payload.url || "about:blank";
          statusEl.textContent = payload.outcome === "continue"
            ? "Saved; agent may continue"
            : payload.outcome === "save_later"
              ? "Saved for later"
              : payload.outcome === "cancel"
                ? "Canceled"
                : "Connected";
        }
      } catch {
      } finally {
        window.setTimeout(refreshStatus, 1500);
      }
    }

    refreshStatus();
  </script>
</body>
</html>`;
}

function createServer(state) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (!isAuthorized(url, state.options)) {
      sendText(response, 401, "Unauthorized\n");
      return;
    }

    try {
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(remoteControlHtml(state.options));
        return;
      }

      if (request.method === "GET" && url.pathname === "/stream") {
        response.writeHead(200, {
          "content-type": `multipart/x-mixed-replace; boundary=${STREAM_BOUNDARY}`,
          "cache-control": "no-store, no-cache, must-revalidate, private",
          "pragma": "no-cache",
          "connection": "close"
        });

        while (!response.destroyed && !state.shuttingDown) {
          const page = getActivePage(state.context, state.initialPage);

          if (page.isClosed()) {
            break;
          }

          const frame = await captureScreenshot(page);
          response.write(`--${STREAM_BOUNDARY}\r\n`);
          response.write("Content-Type: image/jpeg\r\n");
          response.write(`Content-Length: ${frame.length}\r\n\r\n`);
          response.write(frame);
          response.write("\r\n");
          await new Promise((resolve) => setTimeout(resolve, Math.max(state.options.frameIntervalMs, 100)));
        }

        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/status") {
        const page = getActivePage(state.context, state.initialPage);
        sendJson(response, 200, {
          url: page.isClosed() ? "" : page.url(),
          saved: Boolean(state.lastSave),
          outcome: state.lastSave?.outcome,
          controlState: state.lastSave?.controlState,
          latest: state.lastSave
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/input") {
        await sendInput(state, await readJsonBody(request));
        sendJson(response, 200, { ok: true });
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

async function closeBrowserAndServer(state) {
  if (state.shuttingDown) {
    return;
  }

  state.shuttingDown = true;
  state.server?.close();
  await state.context?.close().catch(() => {});
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
    "--artifacts-dir",
    options.artifactsDir,
    "--profile-dir",
    options.profileDir,
    "--storage-state",
    options.storageStatePath,
    "--headless",
    options.headless ? "1" : "0",
    "--frame-interval-ms",
    String(options.frameIntervalMs),
    "--slow-mo",
    String(Number.isFinite(options.slowMo) ? options.slowMo : 50)
  ];

  if (options.browserPath) {
    command.push("--browser-path", options.browserPath);
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

  return browserOptions;
}

async function deployControlUrl(options) {
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
    deviceName: options.deviceName || undefined,
    viewport: options.viewportWasExplicit ? options.viewport : undefined
  };

  await fs.writeFile(path.join(options.artifactsDir, "deployment.json"), `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`Control URL: ${controlUrl}`);
  console.log(`Artifacts: ${options.artifactsDir}`);
  console.log(`Profile: ${options.profileDir}`);
  console.log(`Storage state: ${options.storageStatePath}`);
  if (options.deviceName) {
    console.log(`Device: ${options.deviceName}`);
  } else if (options.viewportWasExplicit) {
    console.log(`Viewport: ${options.viewport.width}x${options.viewport.height}`);
  }
  console.log("After sending the Control URL, end the agent turn. Resume only when the user messages back, then read artifacts/browser-handoff/latest.json.");
}

async function runBrowserServer(options) {
  await fs.mkdir(options.runDir, { recursive: true });
  await fs.mkdir(options.profileDir, { recursive: true });
  const playwright = await loadPlaywright();
  const executablePath = await resolveBrowserPath(options.browserPath);
  const browserOptions = buildBrowserOptions(playwright, options, executablePath);
  options.viewport = browserOptions.viewport ?? options.viewport;
  const context = await playwright.chromium.launchPersistentContext(options.profileDir, browserOptions);
  const initialPage = getActivePage(context, undefined) ?? await context.newPage();
  const state = {
    options,
    context,
    initialPage,
    server: undefined,
    shuttingDown: false,
    lastSave: undefined
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

  server.listen(options.port, options.host, () => {
    const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
    const controlUrl = `http://${displayHost}:${options.port}/?token=${encodeURIComponent(options.token)}`;

    console.log(`Opened: ${options.targetUrl}`);
    console.log(`Control URL: ${controlUrl}`);
    console.log(`Artifacts: ${options.runDir}`);
    console.log(`Profile: ${options.profileDir}`);
    console.log(`Storage state: ${options.storageStatePath}`);
    if (options.deviceName) {
      console.log(`Device: ${options.deviceName}`);
    } else if (options.viewportWasExplicit) {
      console.log(`Viewport: ${options.viewport.width}x${options.viewport.height}`);
    }
    console.log("After sending the Control URL, end the agent turn. Resume only when the user messages back.");
    console.log("Press Ctrl+C or click Stop in the browser UI to close the handoff.");
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
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "deploy") {
    await deployControlUrl(options);
    return;
  }

  await runBrowserServer(options);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
