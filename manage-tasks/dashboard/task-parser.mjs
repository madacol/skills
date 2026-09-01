export class TaskParseError extends Error {}

function fail(source, message) {
  throw new TaskParseError(`${source}: ${message}`);
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
    if (!value.endsWith("'") || value.length < 2) fail(source, `invalid quoted value on frontmatter line ${lineNumber}`);
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
    if (character === "#" && quote === null && (index === 0 || /\s/u.test(value[index - 1]))) return value.slice(0, index).trimEnd();
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
          if (cursor >= entries.length || entries[cursor].indent <= indent) fail(source, `empty sequence item on frontmatter line ${entry.lineNumber}`);
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
      if (rest) value[key] = parseScalar(rest, source, entry.lineNumber);
      else if (cursor < entries.length && entries[cursor].indent > indent) value[key] = parseBlock(entries[cursor].indent);
      else value[key] = null;
    }
    if (cursor < entries.length && entries[cursor].indent > indent) fail(source, `unexpected indentation on frontmatter line ${entries[cursor].lineNumber}`);
    return value;
  }
  if (entries.length === 0) return {};
  if (entries[0].indent !== 0) fail(source, "frontmatter must start at indentation zero");
  const result = parseBlock(0);
  if (cursor !== entries.length) fail(source, `invalid frontmatter near line ${entries[cursor].lineNumber}`);
  if (Array.isArray(result) || result === null || typeof result !== "object") fail(source, "frontmatter must be a mapping");
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
  return Object.fromEntries([...sections].map(([name, lines]) => [name, lines.join("\n").trim()]));
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

export function parseTaskMarkdown(text, source = "task") {
  const { entries, body } = frontmatterLines(text, source);
  return {
    metadata: parseYamlSubset(entries, source),
    body,
    title: parseTitle(body, source),
    sections: parseSections(body),
  };
}
