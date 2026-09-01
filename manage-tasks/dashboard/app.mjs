import { parseTaskMarkdown } from "./task-parser.mjs";
import { TASK_STATUS_INFO } from "./task-statuses.mjs";

const state = { tasks: [], query: "" };
const projectId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[0] ?? "");

const elements = {
  grid: document.querySelector("#task-grid"),
  empty: document.querySelector("#empty"),
  error: document.querySelector("#error"),
  warnings: document.querySelector("#warnings"),
  refreshed: document.querySelector("#refreshed"),
  refresh: document.querySelector("#refresh"),
  search: document.querySelector("#search"),
  dialog: document.querySelector("#task-dialog"),
  dialogId: document.querySelector("#dialog-id"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogMeta: document.querySelector("#dialog-meta"),
  dialogBody: document.querySelector("#dialog-body"),
};

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function excerpt(value, maxLength = 190) {
  const plain = String(value ?? "")
    .replace(/^#+\s+/gmu, "")
    .replace(/[*_`>[\]]/gu, "")
    .replace(/\[(.*?)\]\([^)]*\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength).trimEnd()}…` : plain;
}

function matches(task) {
  if (!state.query) return true;
  const searchable = [task.id, task.title, task.status, ...Object.values(task.sections), JSON.stringify(task.metadata)].join(" ").toLowerCase();
  return searchable.includes(state.query);
}

function statusPill(task) {
  const pill = textElement("span", `status status-${task.status}`, TASK_STATUS_INFO[task.status]?.label ?? task.status);
  return pill;
}

function taskCard(task) {
  const card = document.createElement("button");
  card.className = "task-card";
  card.type = "button";
  card.dataset.status = task.status;
  card.addEventListener("click", () => showTask(task));

  const top = document.createElement("div");
  top.className = "card-top";
  top.append(statusPill(task), textElement("span", "task-id", task.id));

  const title = textElement("h2", "card-title", task.title);
  const outcome = textElement("p", "outcome", excerpt(task.sections.outcome) || "No outcome recorded.");
  card.append(top, title, outcome);

  const context = document.createElement("div");
  context.className = "card-context";
  if (task.metadata.owner) context.append(contextLine("Owner", task.metadata.owner));
  if (task.metadata.waiting_for) context.append(contextLine("Waiting for", task.metadata.waiting_for));
  if (task.metadata.decision?.question) context.append(contextLine("Question", task.metadata.decision.question));
  if (Array.isArray(task.metadata.blocked_by) && task.metadata.blocked_by.length) {
    context.append(contextLine("Blocked by", task.metadata.blocked_by.join(", ")));
  }
  if (context.childElementCount) card.append(context);

  const footer = document.createElement("div");
  footer.className = "card-footer";
  footer.append(
    textElement("span", "collection", "Open task"),
    textElement("span", "view-link", "View details →"),
  );
  card.append(footer);
  return card;
}

function contextLine(label, value) {
  const row = document.createElement("p");
  row.append(textElement("strong", "", label), document.createTextNode(` ${value}`));
  return row;
}

function render() {
  elements.grid.replaceChildren();
  const visible = state.tasks.filter(matches).sort((left, right) => {
    return (TASK_STATUS_INFO[left.status]?.order ?? 99) - (TASK_STATUS_INFO[right.status]?.order ?? 99) || left.title.localeCompare(right.title);
  });
  elements.grid.append(...visible.map(taskCard));
  elements.empty.hidden = visible.length !== 0;
}

function renderCounts() {
  document.querySelector("#open-count").textContent = state.tasks.length;
  document.querySelector("#active-count").textContent = state.tasks.filter((task) => task.status === "in_progress").length;
  document.querySelector("#attention-count").textContent = state.tasks.filter((task) => TASK_STATUS_INFO[task.status]?.needsAttention).length;
}

function metadataRows(task) {
  const rows = [["Status", TASK_STATUS_INFO[task.status]?.label ?? task.status], ["Collection", task.collection]];
  if (task.metadata.waiting_for) rows.push(["Waiting for", task.metadata.waiting_for]);
  if (Array.isArray(task.metadata.blocked_by)) rows.push(["Blocked by", task.metadata.blocked_by.join(", ")]);
  for (const [key, value] of Object.entries(task.metadata)) {
    if (["status", "waiting_for", "blocked_by", "decision"].includes(key)) continue;
    rows.push([key.replaceAll("_", " "), typeof value === "string" ? value : JSON.stringify(value)]);
  }
  return rows;
}

function showTask(task) {
  elements.dialogId.textContent = task.id;
  elements.dialogTitle.textContent = task.title;
  elements.dialogMeta.replaceChildren();
  for (const [label, value] of metadataRows(task)) {
    const item = document.createElement("div");
    item.append(textElement("span", "", label), textElement("strong", "", value));
    elements.dialogMeta.append(item);
  }
  elements.dialogBody.replaceChildren();
  if (task.metadata.decision) elements.dialogBody.append(decisionSection(task.metadata.decision));
  for (const [name, content] of Object.entries(task.sections)) {
    if (!content) continue;
    const section = document.createElement("section");
    section.append(textElement("h3", "", name.replaceAll("_", " ")));
    for (const paragraph of content.split(/\n\s*\n/gu)) {
      section.append(textElement("p", "", paragraph.replace(/\n/gu, " ")));
    }
    elements.dialogBody.append(section);
  }
  elements.dialog.showModal();
}

function decisionSection(decision) {
  const section = document.createElement("section");
  section.className = "decision";
  section.append(textElement("h3", "", "Active decision"), textElement("p", "decision-question", decision.question));
  const options = document.createElement("div");
  options.className = "decision-options";
  for (const [id, option] of Object.entries(decision.options ?? {})) {
    const item = document.createElement("div");
    const recommended = decision.recommendation === id ? " · Recommended" : "";
    item.append(textElement("strong", "", `${option.label}${recommended}`), textElement("span", "", option.description));
    options.append(item);
  }
  section.append(options);
  return section;
}

async function loadTasks() {
  elements.refresh.disabled = true;
  elements.refresh.classList.add("loading");
  elements.error.hidden = true;
  try {
    const response = await fetch(`task-files?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not list task files. Request failed with ${response.status}.`);
    const files = await response.json();
    const results = await mapWithConcurrency(files, 12, async (file) => {
      const rawResponse = await fetch(`${file}?t=${Date.now()}`, { cache: "no-store" });
      if (!rawResponse.ok) throw new Error(`${file}: request failed with ${rawResponse.status}`);
      const parsed = parseTaskMarkdown(await rawResponse.text(), file);
      const parts = file.split("/");
      return {
        id: decodeURIComponent(parts.at(-1)).replace(/\.md$/u, ""),
        collection: parts.at(-2),
        status: parsed.metadata.status,
        metadata: parsed.metadata,
        title: parsed.title,
        sections: parsed.sections,
      };
    });
    state.tasks = results.filter((result) => result.task).map((result) => result.task);
    const parseErrors = results.filter((result) => result.error).map((result) => result.error.message);
    renderCounts();
    render();
    elements.refreshed.textContent = `Read from disk ${new Date().toLocaleString()}`;
    elements.warnings.hidden = parseErrors.length === 0;
    elements.warnings.textContent = parseErrors.length ? `${parseErrors.length} ${parseErrors.length === 1 ? "file could" : "files could"} not be parsed. ${parseErrors.join(" ")}` : "";
  } catch (error) {
    elements.error.hidden = false;
    elements.error.textContent = error instanceof Error ? error.message : String(error);
    elements.refreshed.textContent = "Could not read task files";
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.classList.remove("loading");
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { task: await mapper(items[index]) };
      } catch (error) {
        results[index] = { error: error instanceof Error ? error : new Error(String(error)) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

elements.refresh.addEventListener("click", loadTasks);
elements.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});
document.querySelector("#close-dialog").addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadTasks();
});

document.querySelector("#project-name").textContent = projectId;
document.title = `${projectId} tasks`;
loadTasks();
