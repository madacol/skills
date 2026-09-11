const ENTRY_PATTERN = /^- \[([^\]]+)\]\(([a-z0-9]+(?:-[a-z0-9]+)*)\/README\.md\)$/u;

export class OpenTaskIndexError extends Error {}

export function parseOpenTaskIndex(text, source = "OPEN.md") {
  const lines = text.split(/\r?\n/u);
  const firstContent = lines.findIndex((line) => line.trim());
  if (firstContent < 0 || lines[firstContent].trim() !== "# Open tasks") {
    throw new OpenTaskIndexError(`${source}: first Markdown content must be # Open tasks`);
  }

  const entries = [];
  const seen = new Set();
  for (let index = firstContent + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const match = ENTRY_PATTERN.exec(line);
    if (!match) {
      throw new OpenTaskIndexError(`${source}:${index + 1}: expected - [Task title](task-id/README.md)`);
    }
    const [, title, id] = match;
    if (seen.has(id)) throw new OpenTaskIndexError(`${source}:${index + 1}: duplicate open task ${JSON.stringify(id)}`);
    seen.add(id);
    entries.push({ id, title, href: `${id}/README.md` });
  }
  return entries;
}
