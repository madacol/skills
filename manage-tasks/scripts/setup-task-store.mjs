#!/usr/bin/env node

import { lstat, mkdir, readlink, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PROJECTS_ROOT = path.join(SKILL_ROOT, "projects");
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

async function ensureDirectory(directory) {
  const createdPath = await mkdir(directory, { recursive: true });
  if (!(await stat(directory)).isDirectory()) throw new Error(`Expected directory ${directory}`);
  return createdPath !== undefined;
}

async function existingLinkTarget(linkPath) {
  try {
    const metadata = await lstat(linkPath);
    if (!metadata.isSymbolicLink()) throw new Error(`${linkPath} exists and is not a symlink`);
    return path.resolve(path.dirname(linkPath), await readlink(linkPath));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function setupTaskStore(workspaceRoot, projectId, options = {}) {
  if (!PROJECT_ID.test(projectId)) throw new Error("Project slug must be lowercase kebab-case");
  const workspace = path.resolve(workspaceRoot);
  const taskRoot = path.join(workspace, "tasks");
  const createdDirectories = [];
  for (const collection of ["open", "closed"]) {
    const directory = path.join(taskRoot, collection);
    if (await ensureDirectory(directory)) createdDirectories.push(directory);
  }
  const projectsRoot = path.resolve(options.projectsRoot ?? DEFAULT_PROJECTS_ROOT);
  await mkdir(projectsRoot, { recursive: true });
  const linkPath = path.join(projectsRoot, projectId);
  const currentTarget = await existingLinkTarget(linkPath);
  if (currentTarget !== null) {
    if (currentTarget !== taskRoot) throw new Error(`${projectId} already points to ${currentTarget}`);
    return { createdDirectories, registrationCreated: false, linkPath, taskRoot };
  }
  try {
    await symlink(path.relative(projectsRoot, taskRoot), linkPath, "dir");
    return { createdDirectories, registrationCreated: true, linkPath, taskRoot };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const racedTarget = await existingLinkTarget(linkPath);
    if (racedTarget === taskRoot) return { createdDirectories, registrationCreated: false, linkPath, taskRoot };
    throw new Error(`${projectId} already points to ${racedTarget}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const [workspaceRoot, projectId] = process.argv.slice(2);
  if (!workspaceRoot || !projectId || process.argv.length !== 4) {
    process.stderr.write("Usage: node setup-task-store.mjs <workspace-directory> <project-slug>\n");
    process.exitCode = 2;
  } else {
    try {
      await setupTaskStore(workspaceRoot, projectId);
      process.stdout.write(`Ready: https://task.babyjarvis.com/${projectId}/\n`);
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
