#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseTaskMarkdown } from "../dashboard/task-parser.mjs";
import { TASK_STATUS_INFO } from "../dashboard/task-statuses.mjs";

const OPEN_STATUSES = new Set(Object.entries(TASK_STATUS_INFO).filter(([, info]) => info.collection === "open").map(([status]) => status));
const CLOSED_STATUSES = new Set(Object.entries(TASK_STATUS_INFO).filter(([, info]) => info.collection === "closed").map(([status]) => status));
const ALL_STATUSES = new Set(Object.keys(TASK_STATUS_INFO));
const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
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
  if (!TASK_ID_PATTERN.test(record.id)) errors.push(`${record.path}: filename must be a lowercase kebab-case task ID`);
  if (!ALL_STATUSES.has(record.status)) errors.push(`${record.path}: unknown status ${JSON.stringify(record.status)}`);
  else if (record.collection === "open" && !OPEN_STATUSES.has(record.status)) errors.push(`${record.path}: status ${JSON.stringify(record.status)} belongs under closed/`);
  else if (record.collection === "closed" && !CLOSED_STATUSES.has(record.status)) errors.push(`${record.path}: status ${JSON.stringify(record.status)} belongs under open/`);

  const sections = record.sections;
  if (!sections.outcome) errors.push(`${record.path}: Markdown body requires a non-empty ## Outcome section`);
  if (record.status === "done" && !sections.completion) errors.push(`${record.path}: done requires a non-empty ## Completion section`);
  if (record.status === "canceled" && !sections.cancellation) errors.push(`${record.path}: canceled requires a non-empty ## Cancellation section`);

  validateDecision(record, errors);
  const owner = record.metadata.owner;
  if (owner != null) {
    if (record.status !== "in_progress") {
      errors.push(`${record.path}: owner is allowed only for in_progress`);
    }
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
      let parsed;
      try {
        parsed = parseTaskMarkdown(raw, recordPath);
      } catch (error) {
        throw new TaskValidationError(error instanceof Error ? error.message : String(error));
      }
      const { metadata, body, title, sections } = parsed;
      if (typeof metadata.status !== "string") fail(recordPath, "frontmatter status must be a string");
      records.push({
        id: entry.name.slice(0, -3),
        status: metadata.status,
        path: recordPath,
        collection,
        metadata,
        body,
        title,
        sections,
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
