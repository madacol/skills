#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseOpenTaskIndex } from "../dashboard/open-task-index.mjs";
import { parseTaskMarkdown } from "../dashboard/task-parser.mjs";
import { TASK_STATUS_INFO } from "../dashboard/task-statuses.mjs";

const OPEN_STATUSES = new Set(Object.entries(TASK_STATUS_INFO).filter(([, info]) => info.collection === "open").map(([status]) => status));
const CLOSED_STATUSES = new Set(Object.entries(TASK_STATUS_INFO).filter(([, info]) => info.collection === "closed").map(([status]) => status));
const ALL_STATUSES = new Set(Object.keys(TASK_STATUS_INFO));
const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TICKET_FILE_PATTERN = /^([0-9]{2,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const OWNER_PATTERN = /^[0-9a-f]{8}(?:\/root(?:\/[a-z0-9_]+)*)?$/u;

export class TaskValidationError extends Error {}

function fail(source, message) {
  throw new TaskValidationError(`${source}: ${message}`);
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
  if (!TASK_ID_PATTERN.test(record.id)) errors.push(`${record.path}: task ID must be lowercase kebab-case`);
  if (!ALL_STATUSES.has(record.status)) errors.push(`${record.path}: unknown status ${JSON.stringify(record.status)}`);
  else if (record.isOpen && !OPEN_STATUSES.has(record.status)) errors.push(`${record.path}: terminal status ${JSON.stringify(record.status)} must not appear in OPEN.md`);
  else if (!record.isOpen && !CLOSED_STATUSES.has(record.status)) errors.push(`${record.path}: non-terminal status ${JSON.stringify(record.status)} must appear in OPEN.md`);

  const sections = record.sections;
  if (!sections.outcome) errors.push(`${record.path}: Markdown body requires a non-empty ## Outcome section`);
  if (record.status === "done" && !sections.completion) errors.push(`${record.path}: done requires a non-empty ## Completion section`);
  if (record.status === "canceled" && !sections.cancellation) errors.push(`${record.path}: canceled requires a non-empty ## Cancellation section`);

  validateDecision(record, errors);
  const owner = record.metadata.owner;
  if (owner != null) {
    if (record.status !== "in_progress") errors.push(`${record.path}: owner is allowed only for in_progress`);
    if (typeof owner !== "string" || !OWNER_PATTERN.test(owner)) {
      errors.push(`${record.path}: owner must be an eight-character lowercase hexadecimal Session fingerprint, with new owners followed by a canonical agent path such as /root or /root/tests`);
    }
  }
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

async function kind(target) {
  try {
    const metadata = await stat(target);
    if (metadata.isDirectory()) return "directory";
    if (metadata.isFile()) return "file";
    return "other";
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function parseRecord(recordPath, id, isOpen) {
  let parsed;
  try {
    parsed = parseTaskMarkdown(await readFile(recordPath, "utf8"), recordPath);
  } catch (error) {
    throw new TaskValidationError(error instanceof Error ? error.message : String(error));
  }
  if (typeof parsed.metadata.status !== "string") fail(recordPath, "frontmatter status must be a string");
  return { id, status: parsed.metadata.status, path: recordPath, isOpen, metadata: parsed.metadata, body: parsed.body, title: parsed.title, sections: parsed.sections };
}

async function validateTicketDirectory(taskDirectory, errors) {
  const ticketDirectory = path.join(taskDirectory, "tickets");
  const ticketKind = await kind(ticketDirectory);
  if (ticketKind === null) return;
  if (ticketKind !== "directory") {
    errors.push(`${ticketDirectory}: tickets must be a directory`);
    return;
  }
  const positions = new Set();
  for (const entry of await readdir(ticketDirectory, { withFileTypes: true })) {
    if (!entry.isFile()) {
      errors.push(`${ticketDirectory}: tickets must be Markdown files; found ${entry.name}`);
      continue;
    }
    const match = TICKET_FILE_PATTERN.exec(entry.name);
    if (!match) {
      errors.push(`${ticketDirectory}: ticket filename must be NN-lowercase-slug.md; found ${entry.name}`);
      continue;
    }
    const position = Number(match[1]);
    if (position < 1) errors.push(`${ticketDirectory}: ticket numbering starts at 01`);
    if (positions.has(position)) errors.push(`${ticketDirectory}: duplicate ticket position ${match[1]}`);
    positions.add(position);
  }
  const ordered = [...positions].sort((left, right) => left - right);
  const firstGap = ordered.findIndex((position, index) => position !== index + 1);
  if (firstGap >= 0) errors.push(`${ticketDirectory}: ticket positions must start at 01 and remain contiguous`);
}

async function loadStableRecords(root) {
  const indexPath = path.join(root, "OPEN.md");
  let openEntries;
  try {
    openEntries = parseOpenTaskIndex(await readFile(indexPath, "utf8"), indexPath);
  } catch (error) {
    throw new TaskValidationError(error instanceof Error ? error.message : String(error));
  }
  const openById = new Map(openEntries.map((entry) => [entry.id, entry]));
  const records = [];
  const errors = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "OPEN.md") continue;
    if (!entry.isDirectory()) {
      errors.push(`${root}: expected only OPEN.md and task directories; found ${entry.name}`);
      continue;
    }
    if (!TASK_ID_PATTERN.test(entry.name)) {
      errors.push(`${root}: task directory must be lowercase kebab-case; found ${entry.name}/`);
      continue;
    }
    const taskDirectory = path.join(root, entry.name);
    const contents = await readdir(taskDirectory, { withFileTypes: true });
    for (const child of contents) {
      if (child.name === "README.md" && child.isFile()) continue;
      if (child.name === "tickets" && child.isDirectory()) continue;
      errors.push(`${taskDirectory}: expected only README.md and tickets/; found ${child.name}${child.isDirectory() ? "/" : ""}`);
    }
    const recordPath = path.join(taskDirectory, "README.md");
    if (await kind(recordPath) !== "file") {
      errors.push(`${taskDirectory}: task directory requires README.md`);
      continue;
    }
    const record = await parseRecord(recordPath, entry.name, openById.has(entry.name));
    records.push(record);
    await validateTicketDirectory(taskDirectory, errors);
  }
  const recordIds = new Set(records.map((record) => record.id));
  for (const openEntry of openEntries) {
    if (!recordIds.has(openEntry.id)) errors.push(`${indexPath}: open task ${JSON.stringify(openEntry.id)} has no task directory`);
  }
  if (errors.length) throw new TaskValidationError(errors.join("\n"));
  return records;
}

async function loadLegacyRecords(root) {
  const records = [];
  for (const collection of ["open", "closed"]) {
    const directory = path.join(root, collection);
    if (await kind(directory) !== "directory") fail(root, "expected OPEN.md or legacy open/ and closed/ directories");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) fail(directory, `legacy task records must be flat; found ${entry.name}/`);
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      records.push(await parseRecord(path.join(directory, entry.name), entry.name.slice(0, -3), collection === "open"));
    }
  }
  return records;
}

async function loadRecords(root) {
  return await kind(path.join(root, "OPEN.md")) === "file" ? loadStableRecords(root) : loadLegacyRecords(root);
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
    const dependencies = Array.isArray(record.metadata.blocked_by) ? record.metadata.blocked_by.filter((item) => typeof item === "string") : [];
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
  const records = await loadRecords(path.resolve(root));
  const errors = records.flatMap(validateRecord);
  errors.push(...dependencyErrors(records));
  if (errors.length) throw new TaskValidationError(errors.join("\n"));
  return { open: records.filter((record) => record.isOpen).length, closed: records.filter((record) => !record.isOpen).length };
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
