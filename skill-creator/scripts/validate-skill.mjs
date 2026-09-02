#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isSkillName } from "./skill-contract.mjs";
const PLACEHOLDER = "SKILL-CREATOR:TODO";

export class SkillValidationError extends Error {}

function fail(source, message) {
  throw new SkillValidationError(`${source}: ${message}`);
}

function parseFrontmatterScalar(raw, source, key) {
  const value = raw.trim();
  if (!value) fail(source, `${key} must be a non-empty single-line value`);
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") fail(source, `${key} must be a string`);
      return parsed;
    } catch (error) {
      if (error instanceof SkillValidationError) throw error;
      fail(source, `${key} has invalid double-quoted YAML`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) fail(source, `${key} has invalid single-quoted YAML`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value.replace(/\s+#.*$/u, "").trimEnd();
}

export function parseSkillDocument(text, source = "SKILL.md") {
  const lines = String(text).split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") fail(source, "expected YAML frontmatter delimited by ---");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) fail(source, "expected YAML frontmatter delimited by ---");
  const manifest = {};
  const keys = new Set();
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#") || /^\s/u.test(line)) continue;
    const match = /^([a-z][a-z0-9_-]*):(?:\s*(.*))?$/u.exec(line);
    if (!match) fail(source, `invalid top-level frontmatter on line ${index + 1}`);
    const [, key, raw = ""] = match;
    if (keys.has(key)) fail(source, `duplicate frontmatter key ${JSON.stringify(key)}`);
    keys.add(key);
    manifest[key] = ["name", "description"].includes(key) ? parseFrontmatterScalar(raw, source, key) : raw.trim();
  }
  for (const key of ["name", "description"]) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) fail(source, `missing non-empty ${key}`);
  }
  return { manifest, body: lines.slice(end + 1).join("\n") };
}

function linkDestination(raw) {
  const value = raw.trim();
  if (value.startsWith("<")) {
    const end = value.indexOf(">");
    return end > 0 ? value.slice(1, end) : value;
  }
  return /^(?:\\.|\S)+/u.exec(value)?.[0] ?? "";
}

function localReferences(body) {
  const withoutFences = body.replace(/```[\s\S]*?```/gu, "");
  const references = [];
  for (const match of withoutFences.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = linkDestination(match[1]).split("#", 1)[0];
    if (!target || target.includes("<") || /^[a-z][a-z0-9+.-]*:/iu.test(target) || path.isAbsolute(target)) continue;
    try {
      references.push(decodeURIComponent(target));
    } catch {
      references.push(target);
    }
  }
  return references;
}

async function validateReferences(skillDirectory, source, body, visited) {
  for (const reference of localReferences(body)) {
    const target = path.resolve(path.dirname(source), reference);
    let targetMetadata;
    try {
      targetMetadata = await stat(target);
    } catch (error) {
      if (error?.code === "ENOENT") fail(source, `missing local reference ${JSON.stringify(reference)}`);
      throw error;
    }
    const relative = path.relative(skillDirectory, target);
    const isSkillLocal = relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    if (!isSkillLocal || !targetMetadata.isFile() || !/\.md(?:own)?$/iu.test(target) || visited.has(target)) continue;
    visited.add(target);
    await validateReferences(skillDirectory, target, await readFile(target, "utf8"), visited);
  }
}

export async function validateSkill(skillDirectory) {
  const directory = path.resolve(skillDirectory);
  const source = path.join(directory, "SKILL.md");
  let metadata;
  try {
    metadata = await stat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") fail(directory, "skill directory does not exist");
    throw error;
  }
  if (!metadata.isDirectory()) fail(directory, "expected a skill directory");
  let text;
  try {
    text = await readFile(source, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") fail(directory, "missing SKILL.md");
    throw error;
  }
  const { manifest, body } = parseSkillDocument(text, source);
  if (!isSkillName(manifest.name)) fail(source, "name must be lowercase kebab-case");
  if (path.basename(directory) !== manifest.name) fail(source, `name must match directory ${JSON.stringify(path.basename(directory))}`);
  if (!manifest.description.trim()) fail(source, "description must not be empty");
  if (!body.trim()) fail(source, "body requires instructions");
  if (body.includes(PLACEHOLDER)) fail(source, "replace the generated instruction placeholder");
  await validateReferences(directory, source, body, new Set([source]));
  return { directory, name: manifest.name, description: manifest.description };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const [skillDirectory] = process.argv.slice(2);
  if (!skillDirectory || process.argv.length !== 3) {
    process.stderr.write("Usage: node validate-skill.mjs <skill-directory>\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await validateSkill(skillDirectory);
      process.stdout.write(`Valid skill: ${result.name}\n`);
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
