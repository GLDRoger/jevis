#!/usr/bin/env node
/** A self-contained plugin source, without history, secrets, tests, or installed dependencies. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out") {
  console.error("usage: node bin/package-plugin.mjs --out <new plugin directory>");
  process.exit(2);
}
const out = resolve(args[1]);
if (existsSync(out)) throw new Error(`Output already exists: ${out}`);
mkdirSync(out, { recursive: true });
for (const file of ["plugin.json", "hooks", "skills", "src", "wiki", "WIKI.md", "README.md", "SECURITY.md", "LICENSE", "package.json", "package-lock.json"]) {
  cpSync(join(root, file), join(out, file), { recursive: true });
}
// The runtime archive omits demo media and contributor tooling; keep those documentation links usable.
const readme = readFileSync(join(out, "README.md"), "utf8")
  .replaceAll('src="docs/media/', 'src="https://raw.githubusercontent.com/GLDRoger/jevis/main/docs/media/')
  .replaceAll("](docs/media/", "](https://github.com/GLDRoger/jevis/blob/main/docs/media/")
  .replaceAll("](CONTRIBUTING.md)", "](https://github.com/GLDRoger/jevis/blob/main/CONTRIBUTING.md)");
writeFileSync(join(out, "README.md"), readme);
mkdirSync(join(out, "bin"));
for (const file of ["jevis.mjs", "install.mjs"]) cpSync(join(root, "bin", file), join(out, "bin", file));
mkdirSync(join(out, ".agents", "plugins"), { recursive: true });
cpSync(join(root, ".agents", "plugins", "marketplace.json"), join(out, ".agents", "plugins", "marketplace.json"));
console.log(`Plugin source: ${out}\nInstall its locked dependencies with npm ci before installing the plugin. See README.md, Native Codex plugin.`);
