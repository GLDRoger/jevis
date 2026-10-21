import { readFileSync, writeFileSync } from "node:fs";
// Inlines the frozen v1 scenarios.json into page.html; this does not recapture model answers.
const page = readFileSync(new URL("./page.html", import.meta.url), "utf8");
const data = readFileSync(new URL("./scenarios.json", import.meta.url), "utf8").replace(/</g, "\\u003c");
writeFileSync(new URL("./index.html", import.meta.url), page.replace("/*SCENARIOS*/", () => data));
console.log("archive/manual-v1/index.html", (page.length + data.length) >> 10, "KB");
