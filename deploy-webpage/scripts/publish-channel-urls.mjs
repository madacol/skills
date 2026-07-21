#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const GET_DESCRIPTION_METHOD = "get_current_channel_description";
const SET_DESCRIPTION_METHOD = "set_current_channel_description";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {string[]} urls
 * @returns {string[]}
 */
function validateUrls(urls) {
  if (urls.length === 0) {
    throw new Error("Provide at least one published HTTP or HTTPS URL.");
  }
  const uniqueUrls = [];
  const seen = new Set();
  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Expected an HTTP or HTTPS URL, received: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Expected an HTTP or HTTPS URL, received: ${url}`);
    }
    if (!seen.has(url)) {
      seen.add(url);
      uniqueUrls.push(url);
    }
  }
  return uniqueUrls;
}

/**
 * Append URLs that are not already present as exact, complete lines.
 * Existing description bytes are preserved as an unchanged prefix.
 *
 * @param {string | null} currentDescription
 * @param {string[]} urls
 * @returns {{description: string, added: string[]}}
 */
export function mergeChannelDescriptionUrls(currentDescription, urls) {
  const uniqueUrls = validateUrls(urls);
  const current = currentDescription ?? "";
  const existingLines = new Set(current.split(/\r?\n/u));
  const added = uniqueUrls.filter((url) => !existingLines.has(url));
  if (added.length === 0) {
    return { description: current, added };
  }
  if (current.length === 0) {
    return { description: added.join("\n"), added };
  }
  const separator = current.endsWith("\n") ? "" : "\n";
  return { description: `${current}${separator}${added.join("\n")}`, added };
}

/**
 * @param {string} method
 * @param {unknown} params
 * @returns {Promise<unknown>}
 */
export async function invokeRuntimeAction(method, params) {
  const rpcScript = process.env.MADABOT_INVOCATION_RPC_SCRIPT;
  if (!rpcScript) {
    throw new Error("MADABOT_INVOCATION_RPC_SCRIPT is unavailable in this invocation.");
  }
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "deploy-webpage-rpc-output-"));
  const stdinPath = path.join(outputDirectory, "stdin");
  const stdoutPath = path.join(outputDirectory, "stdout");
  const stderrPath = path.join(outputDirectory, "stderr");
  /** @type {import("node:fs/promises").FileHandle[]} */
  const openedFiles = [];
  let filesClosed = false;
  try {
    await writeFile(stdinPath, JSON.stringify(params), { mode: 0o600 });
    const stdinFile = await open(stdinPath, "r");
    openedFiles.push(stdinFile);
    const stdoutFile = await open(stdoutPath, "w", 0o600);
    openedFiles.push(stdoutFile);
    const stderrFile = await open(stderrPath, "w", 0o600);
    openedFiles.push(stderrFile);
    const child = spawn(process.execPath, [rpcScript, method], {
      env: process.env,
      stdio: [stdinFile.fd, stdoutFile.fd, stderrFile.fd],
    });
    const [code] = await once(child, "close");
    await Promise.all(openedFiles.map((file) => file.close()));
    filesClosed = true;
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, "utf8"),
      readFile(stderrPath, "utf8"),
    ]);
    if (code !== 0) {
      throw new Error(stderr.trim() || `Channel action ${method} exited with code ${code}.`);
    }
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`Channel action ${method} returned invalid JSON.`);
    }
  } finally {
    if (!filesClosed) {
      await Promise.allSettled(openedFiles.map((file) => file.close()));
    }
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

/**
 * @param {string[]} urls
 * @param {{invoke?: (method: string, params: unknown) => Promise<unknown>}} [options]
 * @returns {Promise<{
 *   status: "updated" | "unchanged",
 *   description: string,
 *   added: string[],
 * }>}
 */
export async function publishChannelUrls(urls, options = {}) {
  const uniqueUrls = validateUrls(urls);
  const invoke = options.invoke ?? invokeRuntimeAction;
  const readResult = await invoke(GET_DESCRIPTION_METHOD, null);
  if (
    !isRecord(readResult)
    || !(typeof readResult.description === "string" || readResult.description === null)
  ) {
    throw new Error("Channel description read returned an invalid result.");
  }
  const merged = mergeChannelDescriptionUrls(readResult.description, uniqueUrls);
  if (merged.added.length === 0) {
    return { status: "unchanged", ...merged };
  }
  const writeResult = await invoke(SET_DESCRIPTION_METHOD, { description: merged.description });
  if (
    !isRecord(writeResult)
    || writeResult.status !== "updated"
    || writeResult.description !== merged.description
  ) {
    throw new Error("Channel description setter returned an invalid result.");
  }
  return { status: "updated", ...merged };
}

const isMain = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isMain) {
  try {
    const result = await publishChannelUrls(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
