import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AXES } from "./axes.mjs";
import { jevisHome } from "./state.mjs";

/**
 * The wiki: one Markdown file per lesson, `wiki/<area>/<name>.md`. The path is
 * the entry's id. WIKI.md is the authoring guide; this file is its parser and
 * its enforcement, so a malformed entry fails `jevis lint` instead of misfiring.
 *
 * Two wikis load by default: the shipped one, then the user's own
 * (~/.jevis/wiki), which survives updates to the repo. A user entry with a
 * shipped entry's id replaces it, and one whose frontmatter is only `off: true`
 * turns it off.
 */

export const WIKI_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "wiki");
const EVENTS = ["prompt", "tool", "stop"];
const ACTIONS = { prompt: ["context"], tool: ["context", "deny"], stop: ["block"] };
const REQUIRED = ["event", "ask", "action", "title", "source"];
const KNOWN = new Set([...REQUIRED, "yes", "no", "min", "when", "tools", "family", "unless", "unless_max", "optional", "off"]);
export const DEFAULT_UNLESS_MAX = 0.5;
export const DEFAULT_MIN = 0.75;

/**
 * Lessons can target one model family: the habits they fix are Claude's or
 * GPT's. Any other model (Gemini, Grok, an open model) belongs to neither and
 * gets both families' lessons, as does an unknown model.
 */
export const FAMILIES = ["claude", "gpt"];
export function familyOf(model) {
  const m = String(model ?? "").trim().toLowerCase();
  if (m.startsWith("claude")) return "claude";
  if (/^(gpt|chatgpt|codex|o\d)/.test(m)) return "gpt";
  return null;
}

const unquote = (s) => {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/** A flow value: a list `[a, b]`, a map `{ k: v }`, a number, a boolean, or a string. */
function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) return splitTop(v.slice(1, -1)).map((s) => parseValue(s)).filter((s) => s !== "");
  if (v.startsWith("{") && v.endsWith("}")) {
    return Object.fromEntries(
      splitTop(v.slice(1, -1)).filter(Boolean).map((pair) => {
        const at = pair.search(/:(?=\s|$)/);
        if (at < 0) throw new Error(`bad map entry "${pair}"`);
        return [unquote(pair.slice(0, at)), parseValue(pair.slice(at + 1))];
      }),
    );
  }
  if (v === "true" || v === "false") return v === "true";
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return unquote(v);
}

/** Split on commas outside quotes. */
function splitTop(text) {
  const parts = [];
  let cur = "";
  let quote = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ",") {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function parseEntry(text, id) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${id}: no frontmatter`);
  const entry = { id };
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const at = line.indexOf(":");
    if (at < 0 || /^\s/.test(line)) throw new Error(`${id}: bad line "${line}"`);
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1);
    // A block scalar (`key: |`): the indented lines below it, joined.
    if (/^\s*[|>]\s*$/.test(raw)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[(i += 1)].trim());
      entry[key] = block.join("\n").trim();
      continue;
    }
    entry[key] = ["ask", "yes", "no", "title", "source", "unless"].includes(key) ? unquote(raw) : parseValue(raw);
  }
  entry.body = m[2].trim();
  entry.min = entry.min ?? DEFAULT_MIN;
  entry.when = entry.when ?? {};
  if (entry.unless !== undefined) entry.unless_max = entry.unless_max ?? DEFAULT_UNLESS_MAX;
  return entry;
}

/** Every problem with an entry, empty when it is sound. */
export function validateEntry(e) {
  const errors = [];
  for (const k of REQUIRED) if (e[k] === undefined || e[k] === "") errors.push(`missing ${k}`);
  for (const k of Object.keys(e)) if (!["id", "body"].includes(k) && !KNOWN.has(k)) errors.push(`unknown field ${k}`);
  if (!EVENTS.includes(e.event)) errors.push(`event must be one of ${EVENTS.join(", ")}`);
  else if (!ACTIONS[e.event].includes(e.action)) errors.push(`action on ${e.event} must be ${ACTIONS[e.event].join(" or ")}`);
  if (typeof e.min !== "number" || e.min <= 0 || e.min > 1) errors.push("min must be a number in (0, 1]");
  if (!e.body) errors.push("empty body");
  if (e.body && e.body.length > 900) errors.push(`body is ${e.body.length} characters; keep it under 900`);
  if (e.tools !== undefined && (e.event !== "tool" || !Array.isArray(e.tools))) errors.push("tools is a list, on tool entries only");
  if (e.optional !== undefined && typeof e.optional !== "boolean") errors.push("optional is true or false");
  if (e.family !== undefined && !FAMILIES.includes(e.family)) errors.push(`family is ${FAMILIES.join(" or ")}; leave it out for every model`);
  if (typeof e.when !== "object" || Array.isArray(e.when)) errors.push("when is a map");
  else {
    for (const [k, v] of Object.entries(e.when)) {
      const axis = AXES[e.event]?.[k];
      if (axis && !/^(>=|<=|>|<)\s*(0(\.\d+)?|1(\.0+)?)$/.test(String(v))) errors.push(`when.${k}: an axis takes ">=x" or "<x"`);
      if (!axis && !k.includes(".")) errors.push(`when.${k}: not an axis of ${e.event}; facts are dotted paths like evidence.edited`);
    }
  }
  if (typeof e.ask === "string" && !/`[\w.]+`/.test(e.ask)) errors.push("ask must name the state field it reads, in backticks");
  if (e.unless !== undefined && !/`[\w.]+`/.test(String(e.unless))) errors.push("unless must name the state field it reads, in backticks");
  if (e.action === "deny" && !e.unless) errors.push("a deny needs an unless: the user's own request must be able to stand it down");
  if (e.unless_max !== undefined && (typeof e.unless_max !== "number" || e.unless_max <= 0 || e.unless_max > 1)) errors.push("unless_max must be a number in (0, 1]");
  return errors;
}

function walk(dir) {
  let out = [];
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walk(p));
    else if (d.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

/** The user's own wiki: entries here add to the shipped wiki, or replace or turn off a shipped entry with the same id. */
export const userWiki = () => join(jevisHome(), "wiki");

/** Later roots win. JEVIS_WIKI (colon-separated) replaces the default pair. */
export const wikiRoots = () => (process.env.JEVIS_WIKI ? process.env.JEVIS_WIKI.split(":").filter(Boolean) : [WIKI_ROOT, userWiki()]);

/**
 * All sound entries, plus what `jevis lint` reports: broken entries, ids a later
 * root replaced, and ids it turned off. A broken replacement leaves the earlier
 * entry in force until it is fixed.
 */
export function loadWiki(roots = wikiRoots()) {
  const byId = new Map();
  const broken = [];
  const replaced = [];
  const off = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const id = relative(root, file).replace(/\.md$/, "");
      try {
        const e = parseEntry(readFileSync(file, "utf8"), id);
        if (e.off === true) {
          byId.delete(id);
          off.push(id);
          continue;
        }
        const errors = validateEntry(e);
        if (errors.length) broken.push({ id, file, errors });
        else {
          if (byId.has(id)) replaced.push(id);
          byId.set(id, e);
        }
      } catch (err) {
        broken.push({ id, file, errors: [String(err.message ?? err)] });
      }
    }
  }
  return { entries: [...byId.values()], broken, replaced, off };
}

const glob = (pattern) => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");

/**
 * Optional entries are off unless JEVIS_ENABLE names them: a comma list of
 * ids (`safety/force-push`), areas (`safety`), or `all`.
 */
export function enabled(e, list = process.env.JEVIS_ENABLE) {
  if (!e.optional) return true;
  const on = String(list ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return on.includes("all") || on.includes(e.id) || on.includes(e.id.split("/")[0]);
}

/** Entries that can apply to this event, before Jev is asked: event, tool name, model family. */
export function candidates(entries, { event, tool = null, model = null }) {
  const family = familyOf(model);
  return entries.filter((e) => {
    if (e.event !== event || !enabled(e)) return false;
    if (e.tools && !(tool && e.tools.some((t) => glob(t).test(tool)))) return false;
    if (e.family && family && e.family !== family) return false;
    return true;
  });
}

const lookup = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** `when` holds: axes against the profile, facts against the state. */
export function conditionsHold(when, { profile, state }) {
  for (const [key, want] of Object.entries(when ?? {})) {
    const cmp = typeof want === "string" ? want.match(/^(>=|<=|>|<)\s*([\d.]+)$/) : null;
    const actual = key in profile ? profile[key] : lookup(state, key);
    if (cmp) {
      if (typeof actual !== "number") return false;
      const n = Number(cmp[2]);
      const ok = cmp[1] === ">=" ? actual >= n : cmp[1] === "<=" ? actual <= n : cmp[1] === ">" ? actual > n : actual < n;
      if (!ok) return false;
    } else if (actual !== want) return false;
  }
  return true;
}
