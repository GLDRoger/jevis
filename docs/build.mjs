#!/usr/bin/env node
/**
 * Builds docs/index.html, the one-page overview, from the canonical sources:
 * the README's opening section, the "What happens at each moment" table in
 * docs/tips.md, and the shipped tips in nudges/. docs/page.html holds only the
 * layout. The output is deterministic (no dates), so a stale page shows up as
 * a diff: `node docs/build.mjs --check` exits 1 when index.html is out of date.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOKS, loadNudges, NUDGES_ROOT } from "../src/nudges.mjs";

const DOCS = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DOCS, "..");
const REPO = "https://github.com/GLDRoger/jevis/blob/main/";
const read = (file) => readFileSync(join(ROOT, file), "utf8").replace(/\r\n/g, "\n");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A relative link in `from` (a repository path) becomes a GitHub URL, so the page works opened from disk. */
function href(url, from) {
  if (/^[a-z]+:/i.test(url) || url.startsWith("#")) return url;
  const [path, hash] = url.split("#");
  const target = posix.normalize(posix.join(posix.dirname(from), path)).replace(/\/$/, "");
  const kind = path.endsWith("/") || !/\.[a-z0-9]+$/i.test(target) ? "tree" : "blob";
  return `${REPO.replace("/blob/", `/${kind}/`)}${target}${hash ? `#${hash}` : ""}`;
}

/** Inline Markdown: code, bold, links. Code spans are cut out first so nothing inside them is touched. */
function inline(text, from) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${esc(href(u.replace(/&amp;/g, "&"), from))}">${t}</a>`);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

/** Block Markdown, enough for these sources: paragraphs, bullet lists, tables, and fenced code. */
function blocks(md, from) {
  const out = [];
  const lines = md.trim().split("\n");
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.startsWith("```")) {
      const body = [];
      for (i += 1; i < lines.length && !lines[i].startsWith("```"); i += 1) body.push(lines[i]);
      i += 1;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
    } else if (line.startsWith("- ")) {
      const items = [];
      for (; i < lines.length && lines[i].startsWith("- "); i += 1) items.push(`<li>${inline(lines[i].slice(2), from)}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith("|"); i += 1) rows.push(lines[i].slice(1, -1).split(" | ").map((c) => c.trim()));
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, from)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, k) => `<td data-label="${esc(head[k])}">${inline(c, from)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(- |\||```)/.test(lines[i]); i += 1) para.push(lines[i]);
      out.push(`<p>${inline(para.join(" "), from)}</p>`);
    }
  }
  return out.join("\n");
}

/** The text of a `## heading` section, up to the next heading of the same or higher level. */
function section(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no "## ${heading}" section`);
  const rest = md.slice(start + heading.length + 5);
  return rest.slice(0, rest.search(/\n## |$/));
}

export function build() {
  const readme = read("README.md");
  // The README's opening: everything between the title and the first ## heading.
  const lead = readme.slice(readme.indexOf("\n") + 1, readme.indexOf("\n## "));
  const moments = section(read("docs/tips.md"), "What happens at each moment");
  const table = moments.slice(moments.indexOf("\n|"), moments.indexOf("\n\n", moments.indexOf("\n|") + 1));
  const { nudges, broken } = loadNudges({ roots: [NUDGES_ROOT] });
  if (broken.length) throw new Error(`broken tips: ${broken.map((b) => b.file).join(", ")}`);
  const family = (n) => (n.family ? `${n.family === "other" ? "other models" : n.family === "gpt" ? "GPT models" : "Claude models"}` : "every model");
  const tips = HOOKS.filter((h) => nudges.some((n) => n.hook === h)).map((hook) => `<section class="hook" aria-labelledby="hook-${hook}">
<h3 id="hook-${hook}"><code>${hook}</code></h3>
<div class="tips">
${nudges.filter((n) => n.hook === hook).map((n) => `<article class="tip">
<p class="tip-meta"><a href="${esc(href(relative(ROOT, n.file).split("\\").join("/"), "README.md"))}">${esc(n.id)}.md</a> <span>${family(n)}</span></p>
${blocks(n.text, "nudges/x.md")}
</article>`).join("\n")}
</div>
</section>`).join("\n");
  const page = readFileSync(join(DOCS, "page.html"), "utf8");
  return page
    .replace("<!--LEAD-->", () => blocks(lead, "README.md"))
    .replace("<!--MOMENTS-->", () => blocks(table, "docs/tips.md"))
    .replace("<!--TIPS-->", () => tips)
    .replace("<!--TIPCOUNT-->", String(nudges.length));
}

// Node resolves import.meta.url through symlinks (including macOS /var -> /private/var).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = build();
  const out = join(DOCS, "index.html");
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(out, "utf8"); } catch { /* missing counts as stale */ }
    if (current !== html) {
      console.error("docs/index.html is stale: run node docs/build.mjs");
      process.exit(1);
    }
    console.log("docs/index.html is current");
  } else {
    writeFileSync(out, html);
    console.log(`docs/index.html, ${html.length >> 10} KB`);
  }
}
