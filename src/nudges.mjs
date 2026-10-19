import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clip } from "./context.mjs";
import { jevisHome } from "./state.mjs";
import { familyOf, FAMILIES, parseFrontmatter } from "./wiki.mjs";

export const NUDGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "nudges");
// Tests can replace the shipped root with JEVIS_NUDGES_DIR without touching repository nudges.
const defaultRoots = () => [process.env.JEVIS_NUDGES_DIR || NUDGES_ROOT, join(jevisHome(), "nudges")];
export const HOOKS = ["session", "prompt", "feedback", "feedback-repeat", "ui-edit"];

/** Flat Markdown files, with a later root replacing the same filename entirely. */
export function loadNudges({ roots = defaultRoots() } = {}) {
  const files = new Map();
  const nudges = [], broken = [];
  for (const root of roots) {
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".md")) files.set(entry.name, join(root, entry.name));
      }
    } catch (error) {
      if (error.code !== "ENOENT") broken.push({ file: root, error: error.message });
    }
  }
  for (const [name, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    try {
      const id = name.slice(0, -3);
      const entry = parseFrontmatter(readFileSync(file, "utf8"), id);
      if (entry.off === true) continue;
      if (!HOOKS.includes(entry.hook)) throw new Error(`hook must be one of ${HOOKS.join(", ")}`);
      if (entry.family !== undefined && !FAMILIES.includes(entry.family)) throw new Error("family must be gpt or claude");
      if (entry.off !== undefined && typeof entry.off !== "boolean") throw new Error("off must be true or false");
      if (!entry.body) throw new Error("empty body");
      const text = entry.body.length > 1500 ? clip(entry.body, 1499) : entry.body; // Include clip's ellipsis in the cap.
      nudges.push({ id, hook: entry.hook, family: entry.family, text, file });
    } catch (error) {
      broken.push({ file, error: error.message });
    }
  }
  return { nudges: nudges.sort((a, b) => a.id.localeCompare(b.id)), broken };
}

/** Selection is local code only; unknown models get only family-less nudges. */
export function nudgeText(hook, model, { roots } = {}) {
  if (process.env.JEVIS_NUDGES === "off") return { ids: [], text: "" };
  const family = familyOf(model);
  const matching = loadNudges({ roots }).nudges.filter((n) => n.hook === hook && (n.family === undefined || n.family === family));
  return { ids: matching.map((n) => n.id), text: matching.map((n) => n.text).join("\n\n") };
}
