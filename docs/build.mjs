import { readFileSync, writeFileSync } from "node:fs";
// Inlines docs/scenarios.json (from eval/scenarios.mjs) into docs/page.html, producing docs/index.html: one file that opens from disk.
const page = readFileSync(new URL("./page.html", import.meta.url), "utf8");
const data = readFileSync(new URL("./scenarios.json", import.meta.url), "utf8").replace(/</g, "\\u003c");
writeFileSync(new URL("./index.html", import.meta.url), page.replace("/*SCENARIOS*/", () => data));
console.log("docs/index.html", (page.length + data.length) >> 10, "KB");
