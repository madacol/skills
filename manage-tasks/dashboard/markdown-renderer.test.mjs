import assert from "node:assert/strict";
import test from "node:test";
import { extractMarkdownImageHrefs, renderMarkdown } from "./markdown-renderer.mjs";

test("renders CommonMark and GFM structures", () => {
  const html = renderMarkdown([
    "A **strong** paragraph with `code` and [docs](https://example.com/docs).",
    "",
    "- first",
    "- second",
    "",
    "| Name | State |",
    "| --- | --- |",
    "| task | open |",
    "",
    "```js",
    "const ready = true;",
    "```",
  ].join("\n"));

  assert.match(html, /<strong>strong<\/strong>/u);
  assert.match(html, /<code>code<\/code>/u);
  assert.match(html, /<a href="https:\/\/example\.com\/docs">docs<\/a>/u);
  assert.match(html, /<ul>[\s\S]*<li>first<\/li>/u);
  assert.match(html, /<table>/u);
  assert.match(html, /<pre><code class="language-js">const ready = true;/u);
});

test("escapes raw HTML and removes unsafe link and image schemes", () => {
  const html = renderMarkdown([
    "<img src=x onerror=alert(1)>",
    "",
    "[bad](javascript:alert(1))",
    "",
    "![bad](data:image/svg+xml,boom)",
  ].join("\n"));

  assert.doesNotMatch(html, /<img src=x/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /href=/u);
  assert.doesNotMatch(html, /<img/u);
  assert.doesNotMatch(html, /javascript:|data:image/u);
});

test("rewrites local evidence images through the caller and finds their source paths", () => {
  const localPath = "/home/mada/chat/channel/.media/evidence.jpg";
  const markdown = `![Status evidence](${localPath})`;
  const html = renderMarkdown(markdown, {
    resolveImageHref: (href) => href === localPath ? "/madabot/evidence/open/task.md?path=authorized" : null,
  });

  assert.match(html, /<img src="\/madabot\/evidence\/open\/task\.md\?path=authorized" alt="Status evidence" loading="lazy" decoding="async">/u);
  assert.deepEqual(extractMarkdownImageHrefs(markdown), [localPath]);
});
