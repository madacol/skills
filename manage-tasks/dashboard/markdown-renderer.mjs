import { Marked, Renderer, lexer, walkTokens } from "./vendor/marked.esm.mjs";

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
const URL_BASE = "https://task.invalid/";

/** @param {unknown} value */
function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** @param {unknown} value */
function escapeHtml(value) {
  return escapeAttribute(value).replaceAll("'", "&#39;");
}

/**
 * @param {unknown} value
 * @param {Set<string>} protocols
 */
function safeUrl(value, protocols) {
  const href = String(value ?? "").trim();
  if (!href || /[\u0000-\u001f\u007f]/u.test(href)) return null;
  try {
    const parsed = new URL(href, URL_BASE);
    return protocols.has(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

/** @typedef {{ resolveImageHref?: (href: string) => string | null }} MarkdownRenderOptions */

/** @param {MarkdownRenderOptions} options */
function safeRenderer(options) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.link = function link({ href, title, tokens }) {
    const content = this.parser.parseInline(tokens);
    const safeHref = safeUrl(href, LINK_PROTOCOLS);
    if (safeHref === null) return content;
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return `<a href="${escapeAttribute(safeHref)}"${titleAttribute}>${content}</a>`;
  };
  renderer.image = function image({ href, title, text, tokens }) {
    const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
    const resolvedHref = options.resolveImageHref ? options.resolveImageHref(href) : href;
    const safeHref = resolvedHref === null ? null : safeUrl(resolvedHref, IMAGE_PROTOCOLS);
    if (safeHref === null) return escapeHtml(alt);
    const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
    return `<img src="${escapeAttribute(safeHref)}" alt="${escapeAttribute(alt)}"${titleAttribute} loading="lazy" decoding="async">`;
  };
  return renderer;
}

/**
 * @param {unknown} markdown
 * @param {MarkdownRenderOptions} [options]
 * @returns {string}
 */
export function renderMarkdown(markdown, options = {}) {
  const renderer = safeRenderer(options);
  const parser = new Marked({ gfm: true, breaks: false, renderer });
  return parser.parse(String(markdown ?? ""));
}

/**
 * @param {unknown} markdown
 * @returns {string[]}
 */
export function extractMarkdownImageHrefs(markdown) {
  const hrefs = [];
  const tokens = lexer(String(markdown ?? ""), { gfm: true });
  walkTokens(tokens, (token) => {
    if (token.type === "image") hrefs.push(token.href);
  });
  return hrefs;
}
