#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSkillDocument } from "./validate-skill.mjs";
import { isSkillName } from "./skill-contract.mjs";

function titleFor(name) {
  return name.split("-").map((word) => `${word[0].toUpperCase()}${word.slice(1)}`).join(" ");
}

function skillTemplate(name, description) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${titleFor(name)}\n\n<!-- SKILL-CREATOR:TODO Replace this comment with the instructions a fresh-context agent needs. -->\n`;
}

async function existingSkill(source, name, description) {
  const { manifest } = parseSkillDocument(await readFile(source, "utf8"), source);
  if (manifest.name !== name) throw new Error(`${source} declares ${JSON.stringify(manifest.name)}, not ${JSON.stringify(name)}`);
  if (manifest.description !== description) throw new Error(`${source} already exists with a different description`);
  return { created: false, directory: path.dirname(source), source };
}

export async function createSkill(skillsRoot, name, description) {
  if (!isSkillName(name)) throw new Error("Skill name must be lowercase kebab-case");
  if (typeof description !== "string" || !description.trim()) throw new Error("Routing description must be non-empty");
  const root = path.resolve(skillsRoot);
  const directory = path.join(root, name);
  const source = path.join(directory, "SKILL.md");
  await mkdir(root, { recursive: true });
  await mkdir(directory, { recursive: true });
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) throw new Error(`${directory} must be a real directory`);
  const entries = await readdir(directory);
  if (entries.includes("SKILL.md")) return existingSkill(source, name, description.trim());
  const conflictingEntries = entries.filter((entry) => !/^\.SKILL\.md\.\d+\.[0-9a-f-]+\.tmp$/u.test(entry));
  if (conflictingEntries.length) throw new Error(`${directory} exists and is not empty`);
  const temporary = path.join(directory, `.SKILL.md.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, skillTemplate(name, description.trim()), { flag: "wx" });
    await link(temporary, source);
  } catch (error) {
    if (error?.code === "EEXIST") return existingSkill(source, name, description.trim());
    throw error;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  return { created: true, directory, source };
}

function parseArguments(argv) {
  const [skillsRoot, name, flag, description, ...extra] = argv;
  if (!skillsRoot || !name || flag !== "--description" || !description || extra.length) return null;
  return { skillsRoot, name, description };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    process.stderr.write("Usage: node create-skill.mjs <skills-root> <skill-name> --description <routing-description>\n");
    process.exitCode = 2;
  } else {
    try {
      const result = await createSkill(options.skillsRoot, options.name, options.description);
      process.stdout.write(`${result.created ? "Created" : "Already exists"}: ${result.source}\n`);
    } catch (error) {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
