#!/usr/bin/env node

import { createServer } from "node:http";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractMarkdownImageHrefs } from "./markdown-renderer.mjs";

const DASHBOARD_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECTS_ROOT = path.resolve(DASHBOARD_ROOT, "../projects");
const DEFAULT_EVIDENCE_ROOT = "/home/mada/chat";
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const EVIDENCE_TYPES = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const ASSETS = new Map([
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/markdown-renderer.mjs", ["markdown-renderer.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/task-parser.mjs", ["task-parser.mjs", "text/javascript; charset=utf-8"]],
  ["/task-statuses.mjs", ["task-statuses.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor/marked.esm.mjs", ["vendor/marked.esm.mjs", "text/javascript; charset=utf-8"]],
]);

function send(response, status, contentType, body, extraHeaders = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  response.end(response.req?.method === "HEAD" ? undefined : body);
}

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function registeredProjects(projectsRoot) {
  if (!(await isDirectory(projectsRoot))) throw new Error(`Expected projects directory ${projectsRoot}`);
  const registered = new Map();
  const projects = await readdir(projectsRoot, { withFileTypes: true });
  for (const project of projects.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!PROJECT_ID.test(project.name) || !project.isSymbolicLink()) continue;
    const taskRoot = path.join(projectsRoot, project.name);
    if (!(await isDirectory(taskRoot))) continue;
    const collections = ["open", "closed"];
    const directories = collections.map((collection) => path.join(taskRoot, collection));
    if (!(await Promise.all(directories.map(isDirectory))).every(Boolean)) continue;
    registered.set(project.name, { taskRoot, directories });
  }
  return registered;
}

async function projectTaskFiles(projectId, project) {
  const files = new Map();
  const directory = project.directories[0];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const url = `/${encodeURIComponent(projectId)}/tasks/open/${encodeURIComponent(entry.name)}`;
    files.set(url, path.join(directory, entry.name));
  }
  return files;
}

function projectIndex(projectIds) {
  const links = projectIds.map((projectId) => `<li><a href="/${projectId}/">${projectId}</a></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0d1310"><title>Task projects</title><style>body{max-width:42rem;margin:4rem auto;padding:0 1.25rem;background:#0d1310;color:#edf4ef;font:16px system-ui}h1{font:3rem Georgia,serif}a{color:#6fd0a0}li{margin:.75rem 0}</style></head><body><h1>Task projects</h1><ul>${links}</ul></body></html>`;
}

function evidenceFile(candidate, evidenceRoot) {
  if (!candidate || !path.isAbsolute(candidate)) return null;
  const resolved = path.resolve(candidate);
  const relative = path.relative(evidenceRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.length !== 3 || parts[1] !== ".media") return null;
  const contentType = EVIDENCE_TYPES.get(path.extname(resolved).toLowerCase());
  return contentType ? { contentType, path: resolved } : null;
}

async function referencedEvidence(taskPath, candidate, evidenceRoot) {
  const evidence = evidenceFile(candidate, evidenceRoot);
  if (!evidence) return null;
  const taskMarkdown = await readFile(taskPath, "utf8");
  if (!extractMarkdownImageHrefs(taskMarkdown).includes(candidate)) return null;
  const [realEvidenceRoot, realEvidencePath] = await Promise.all([realpath(evidenceRoot), realpath(evidence.path)]);
  const realRelative = path.relative(realEvidenceRoot, realEvidencePath);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) return null;
  const metadata = await lstat(evidence.path);
  return metadata.isFile() ? evidence : null;
}

export function createDashboardHubServer(projectsRoot = DEFAULT_PROJECTS_ROOT, options = {}) {
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  const evidenceRoot = path.resolve(options.evidenceRoot ?? DEFAULT_EVIDENCE_ROOT);
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, "text/plain; charset=utf-8", "This dashboard is read-only.\n", { allow: "GET, HEAD" });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const asset = ASSETS.get(requestUrl.pathname);
      if (asset) {
        const [filename, contentType] = asset;
        send(response, 200, contentType, await readFile(path.join(DASHBOARD_ROOT, filename)));
        return;
      }
      const projects = await registeredProjects(resolvedProjectsRoot);
      if (requestUrl.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", projectIndex([...projects.keys()]));
        return;
      }
      const parts = requestUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
      const projectId = parts[0];
      if (!PROJECT_ID.test(projectId ?? "") || !projects.has(projectId)) {
        send(response, 404, "text/plain; charset=utf-8", "Project not found\n");
        return;
      }
      if (parts.length === 1 && !requestUrl.pathname.endsWith("/")) {
        response.writeHead(308, { location: `/${projectId}/` });
        response.end();
        return;
      }
      if (parts.length === 1) {
        send(response, 200, "text/html; charset=utf-8", await readFile(path.join(DASHBOARD_ROOT, "index.html")));
        return;
      }
      if (parts.length === 2 && parts[1] === "task-files") {
        const files = await projectTaskFiles(projectId, projects.get(projectId));
        send(response, 200, "application/json; charset=utf-8", JSON.stringify([...files.keys()].sort()));
        return;
      }
      if (parts.length === 4 && parts[1] === "evidence" && ["open", "closed"].includes(parts[2])) {
        const filename = parts[3];
        const project = projects.get(projectId);
        const directory = project.directories[parts[2] === "open" ? 0 : 1];
        const taskPath = path.join(directory, filename);
        if (filename.endsWith(".md") && path.basename(filename) === filename && (await lstat(taskPath)).isFile()) {
          const evidence = await referencedEvidence(taskPath, requestUrl.searchParams.get("path"), evidenceRoot);
          if (evidence) {
            send(response, 200, evidence.contentType, await readFile(evidence.path), {
              "content-disposition": "inline",
              "cross-origin-resource-policy": "same-origin",
            });
            return;
          }
        }
      }
      if (parts.length === 4 && parts[1] === "tasks" && ["open", "closed"].includes(parts[2])) {
        const filename = parts[3];
        const project = projects.get(projectId);
        const directory = project.directories[parts[2] === "open" ? 0 : 1];
        const taskPath = path.join(directory, filename);
        if (filename.endsWith(".md") && path.basename(filename) === filename && (await lstat(taskPath)).isFile()) {
          send(response, 200, "text/markdown; charset=utf-8", await readFile(taskPath));
          return;
        }
      }
      send(response, 404, "text/plain; charset=utf-8", "Not found\n");
    } catch (error) {
      if (error?.code === "ENOENT") {
        send(response, 404, "text/plain; charset=utf-8", "Not found\n");
        return;
      }
      process.stderr.write(`task dashboard error: ${error instanceof Error ? error.message : String(error)}\n`);
      send(response, 500, "text/plain; charset=utf-8", "Internal server error\n");
    }
  });
}

export async function startDashboardHubServer(projectsRoot = DEFAULT_PROJECTS_ROOT, options = {}) {
  const server = createDashboardHubServer(projectsRoot, options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? Number(process.env.PORT ?? 4173), options.host ?? "127.0.0.1", resolve);
  });
  return server;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const server = await startDashboardHubServer(process.argv[2] ?? DEFAULT_PROJECTS_ROOT);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : process.env.PORT;
    process.stdout.write(`Task dashboard hub: http://127.0.0.1:${port}\nProjects: ${path.resolve(process.argv[2] ?? DEFAULT_PROJECTS_ROOT)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
