#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPEN_STATUSES = new Set(["todo", "in_progress", "awaiting_decision", "waiting"]);
const CLOSED_STATUSES = new Set(["done", "canceled"]);
const ALL_STATUSES = new Set([...OPEN_STATUSES, ...CLOSED_STATUSES]);
const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export class TaskValidationError extends Error {}

function fail(source, message) {
  throw new TaskValidationError(`${source}: ${message}`);
}

function unquote(value, source, lineNumber) {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      fail(source, `invalid quoted value on frontmatter line ${lineNumber}`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      fail(source, `invalid quoted value on frontmatter line ${lineNumber}`);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function stripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && character === "\\") {
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote ?? character;
      continue;
    }
    if (character === "#" && quote === null && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function parseScalar(raw, source, lineNumber) {
  const value = stripComment(raw).trim();
  if (value === "null" || value === "~") return null;
  if (value === "[]") return [];
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) fail(source, `invalid flow sequence on frontmatter line ${lineNumber}`);
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item, source, lineNumber));
  }
  return unquote(value, source, lineNumber);
}

function frontmatterLines(text, source) {
  const lines = text.split(/\r?\n/u);
  if (lines[0]?.trim() !== "---") fail(source, "expected YAML frontmatter delimited by ---");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) fail(source, "expected YAML frontmatter delimited by ---");
  const entries = [];
  for (let index = 1; index < end; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (raw.includes("\t")) fail(source, `tabs are not supported in frontmatter line ${index + 1}`);
    const indent = raw.length - raw.trimStart().length;
    entries.push({ indent, text: raw.trim(), lineNumber: index + 1 });
  }
  return { entries, body: lines.slice(end + 1).join("\n") };
}

function parseYamlSubset(entries, source) {
  let cursor = 0;

  function parseBlock(indent) {
    if (cursor >= entries.length || entries[cursor].indent < indent) return null;
    const sequence = entries[cursor].text.startsWith("-");
    const value = sequence ? [] : {};
    const keys = new Set();

    while (cursor < entries.length && entries[cursor].indent === indent) {
      const entry = entries[cursor];
      if (sequence) {
        if (!entry.text.startsWith("-")) fail(source, `mixed mapping and sequence on frontmatter line ${entry.lineNumber}`);
        const item = entry.text.slice(1).trim();
        cursor += 1;
        if (!item) {
          if (cursor >= entries.length || entries[cursor].indent <= indent) {
            fail(source, `empty sequence item on frontmatter line ${entry.lineNumber}`);
          }
          value.push(parseBlock(entries[cursor].indent));
        } else {
          value.push(parseScalar(item, source, entry.lineNumber));
        }
        continue;
      }

      if (entry.text.startsWith("-")) fail(source, `mixed mapping and sequence on frontmatter line ${entry.lineNumber}`);
      const match = /^([^:#][^:]*):(?:\s*(.*))?$/u.exec(entry.text);
      if (!match) fail(source, `expected a mapping entry on frontmatter line ${entry.lineNumber}`);
      const key = unquote(match[1].trim(), source, entry.lineNumber);
      if (typeof key !== "string" || !key) fail(source, `invalid key on frontmatter line ${entry.lineNumber}`);
      if (keys.has(key)) fail(source, `duplicate frontmatter key ${JSON.stringify(key)}`);
      keys.add(key);
      const rest = match[2] ?? "";
      cursor += 1;
      if (rest) {
        value[key] = parseScalar(rest, source, entry.lineNumber);
      } else if (cursor < entries.length && entries[cursor].indent > indent) {
        value[key] = parseBlock(entries[cursor].indent);
      } else {
        value[key] = null;
      }
    }
    if (cursor < entries.length && entries[cursor].indent > indent) {
      fail(source, `unexpected indentation on frontmatter line ${entries[cursor].lineNumber}`);
    }
    return value;
  }

  if (entries.length === 0) return {};
  if (entries[0].indent !== 0) fail(source, "frontmatter must start at indentation zero");
  const result = parseBlock(0);
  if (cursor !== entries.length) fail(source, `invalid frontmatter near line ${entries[cursor].lineNumber}`);
  if (Array.isArray(result) || result === null || typeof result !== "object") {
    fail(source, "frontmatter must be a mapping");
  }
  return result;
}

function parseSections(body) {
  const sections = new Map();
  let current = null;
  let inFence = false;
  for (const line of body.split(/\r?\n/u)) {
    if (line.startsWith("```")) inFence = !inFence;
    const match = inFence ? null : /^##\s+(.+?)\s*$/u.exec(line);
    if (match) {
      current = match[1].trim().toLowerCase();
      if (!sections.has(current)) sections.set(current, []);
    } else if (current !== null) {
      sections.get(current).push(line);
    }
  }
  return new Map([...sections].map(([name, lines]) => [name, lines.join("\n").trim()]));
}

function parseTitle(body, source) {
  const lines = body.split(/\r?\n/u);
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) fail(source, "Markdown body is empty");
  const title = /^#\s+(.+?)\s*$/u.exec(lines[first]);
  if (!title) fail(source, "the first Markdown content must be one H1 title");
  let inFence = false;
  for (const line of lines.slice(first + 1)) {
    if (line.startsWith("```")) inFence = !inFence;
    else if (!inFence && /^#\s+/u.test(line)) fail(source, "a task record may contain only one H1 title");
  }
  return title[1].trim();
}

function nonemptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function validateDecision(record, errors) {
  const decision = record.metadata.decision;
  if (record.status !== "awaiting_decision") {
    if (decision != null) errors.push(`${record.path}: decision is allowed only for awaiting_decision`);
    return;
  }
  if (decision === null || Array.isArray(decision) || typeof decision !== "object") {
    errors.push(`${record.path}: awaiting_decision requires one decision mapping`);
    return;
  }
  if (!nonemptyString(decision.question)) errors.push(`${record.path}: decision.question must be a non-empty string`);
  else if (record.body.includes(decision.question.trim())) errors.push(`${record.path}: the active decision question is repeated in the Markdown body`);
  const options = decision.options;
  if (options === null || Array.isArray(options) || typeof options !== "object" || Object.keys(options).length < 2) {
    errors.push(`${record.path}: decision.options must map at least two option IDs`);
    return;
  }
  for (const [optionId, option] of Object.entries(options)) {
    if (!TASK_ID_PATTERN.test(optionId)) errors.push(`${record.path}: decision option ID ${JSON.stringify(optionId)} is not a lowercase slug`);
    if (option === null || Array.isArray(option) || typeof option !== "object") {
      errors.push(`${record.path}: decision option ${JSON.stringify(optionId)} must be a mapping`);
      continue;
    }
    if (!nonemptyString(option.label)) errors.push(`${record.path}: decision option ${JSON.stringify(optionId)} requires a label`);
    if (!nonemptyString(option.description)) errors.push(`${record.path}: decision option ${JSON.stringify(optionId)} requires a description`);
  }
  if (decision.recommendation != null && (typeof decision.recommendation !== "string" || !(decision.recommendation in options))) {
    errors.push(`${record.path}: decision.recommendation must name an option ID`);
  }
}

function validateRecord(record) {
  const errors = [];
  if (!TASK_ID_PATTERN.test(record.id)) errors.push(`${record.path}: filename must be a lowercase kebab-case task ID`);
  if (!ALL_STATUSES.has(record.status)) errors.push(`${record.path}: unknown status ${JSON.stringify(record.status)}`);
  else if (record.collection === "open" && !OPEN_STATUSES.has(record.status)) errors.push(`${record.path}: status ${JSON.stringify(record.status)} belongs under closed/`);
  else if (record.collection === "closed" && !CLOSED_STATUSES.has(record.status)) errors.push(`${record.path}: status ${JSON.stringify(record.status)} belongs under open/`);

  const sections = parseSections(record.body);
  if (!sections.get("outcome")) errors.push(`${record.path}: Markdown body requires a non-empty ## Outcome section`);
  if (record.status === "done" && !sections.get("completion")) errors.push(`${record.path}: done requires a non-empty ## Completion section`);
  if (record.status === "canceled" && !sections.get("cancellation")) errors.push(`${record.path}: canceled requires a non-empty ## Cancellation section`);

  validateDecision(record, errors);
  const waitingFor = record.metadata.waiting_for;
  if (record.status === "waiting") {
    if (!nonemptyString(waitingFor)) errors.push(`${record.path}: waiting requires one non-empty waiting_for string`);
  } else if (waitingFor != null) {
    errors.push(`${record.path}: waiting_for is allowed only for waiting`);
  }

  const blockedBy = record.metadata.blocked_by;
  if (blockedBy != null) {
    if (!Array.isArray(blockedBy) || blockedBy.length === 0) {
      errors.push(`${record.path}: blocked_by must be a non-empty list when present`);
    } else {
      const seen = new Set();
      for (const dependency of blockedBy) {
        if (typeof dependency !== "string" || !TASK_ID_PATTERN.test(dependency)) {
          errors.push(`${record.path}: blocked_by entries must be lowercase task IDs`);
          continue;
        }
        if (dependency === record.id) errors.push(`${record.path}: a task cannot block itself`);
        if (seen.has(dependency)) errors.push(`${record.path}: duplicate blocked_by entry ${JSON.stringify(dependency)}`);
        seen.add(dependency);
      }
    }
  }
  return errors;
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function loadRecords(root) {
  const records = [];
  for (const collection of ["open", "closed"]) {
    const directory = path.join(root, collection);
    if (!(await isDirectory(directory))) fail(root, "expected open/ and closed/ directories");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) fail(directory, `task records must be flat; found ${entry.name}/`);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const recordPath = path.join(directory, entry.name);
      const raw = await readFile(recordPath, "utf8");
      const { entries: yamlLines, body } = frontmatterLines(raw, recordPath);
      const metadata = parseYamlSubset(yamlLines, recordPath);
      parseTitle(body, recordPath);
      if (typeof metadata.status !== "string") fail(recordPath, "frontmatter status must be a string");
      records.push({
        id: entry.name.slice(0, -3),
        status: metadata.status,
        path: recordPath,
        collection,
        metadata,
        body,
      });
    }
  }
  return records;
}

function dependencyErrors(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) {
    const duplicate = records.find((record, index) => records.findIndex((candidate) => candidate.id === record.id) !== index);
    return [`duplicate task ID ${JSON.stringify(duplicate.id)}`];
  }
  const errors = [];
  const graph = new Map();
  for (const record of records) {
    const dependencies = Array.isArray(record.metadata.blocked_by)
      ? record.metadata.blocked_by.filter((item) => typeof item === "string")
      : [];
    graph.set(record.id, dependencies);
    for (const dependency of dependencies) {
      if (!byId.has(dependency)) errors.push(`${record.path}: blocked_by references missing task ${JSON.stringify(dependency)}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId, trail) {
    if (visiting.has(taskId)) {
      errors.push(`dependency cycle: ${trail.slice(trail.indexOf(taskId)).join(" -> ")}`);
      return;
    }
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of graph.get(taskId) ?? []) {
      if (byId.has(dependency)) visit(dependency, [...trail, dependency]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  }
  for (const taskId of [...byId.keys()].sort()) visit(taskId, [taskId]);
  return errors;
}

export async function validateTaskStore(root) {
  const resolvedRoot = path.resolve(root);
  const records = await loadRecords(resolvedRoot);
  const errors = records.flatMap(validateRecord);
  errors.push(...dependencyErrors(records));
  if (errors.length) throw new TaskValidationError(errors.join("\n"));
  return {
    open: records.filter((record) => record.collection === "open").length,
    closed: records.filter((record) => record.collection === "closed").length,
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const root = process.argv[2];
  if (!root || process.argv.length !== 3) {
    process.stderr.write("Usage: node validate-tasks.mjs <tasks-directory>\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await validateTaskStore(root);
      process.stdout.write(`valid: ${result.open} open, ${result.closed} closed\n`);
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
