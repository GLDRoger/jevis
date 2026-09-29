import { createHash } from "node:crypto";
import { existsSync, opendirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { AXES } from "./axes.mjs";
import { ensureDir, jevisHome } from "./state.mjs";
import { insideFolder, isQualifiedPath, samePath, splitFolders } from "./paths.mjs";

/**
 * The wiki: one Markdown file per lesson, `wiki/<area>/<name>.md`. The path is
 * the entry's id. WIKI.md is the authoring guide; this file is its parser and
 * its enforcement, so a malformed entry fails `jevis lint` instead of misfiring.
 *
 * Wikis load in order, later ones winning: the shipped one, the user's own
 * (~/.jevis/wiki), which survives updates to the repo, and a project's
 * (<repo>/.jevis/wiki) once the user trusts it. An entry with an earlier
 * entry's id replaces it, and one whose frontmatter is only `off: true` turns
 * it off.
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
  const m = String(text).replaceAll("\r\n", "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
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

/** Past this, a file is not a lesson: a project's lessons are read on every hook, so a huge one would stall them all. */
const MAX_LESSON_BYTES = 256 * 1024;
const MAX_PROJECT_ENTRIES = 1000;
const MAX_PROJECT_DEPTH = 8;

/**
 * Every .md file under `dir`. `strict` (a project's lessons, which arrive
 * with a cloned repository) takes only regular files of lesson size: no
 * symlink out to /dev/zero or a secret, no FIFO that blocks the read.
 */
function walk(dir, { strict = false, budget = { entries: MAX_PROJECT_ENTRIES }, depth = 0 } = {}) {
  let out = [];
  if (strict && (budget.entries <= 0 || depth > MAX_PROJECT_DEPTH)) return out;
  let entries;
  try {
    // A directory stream bounds the work even when one folder has millions of non-lesson entries.
    entries = strict ? opendirSync(dir, { bufferSize: 1 }) : readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  try {
    for (let i = 0; !strict || budget.entries > 0; i += 1) {
      const d = strict ? entries.readSync() : entries[i];
      if (!d) break;
      if (strict) budget.entries -= 1;
      const p = join(dir, d.name);
      if (d.isDirectory()) out = out.concat(walk(p, { strict, budget, depth: depth + 1 }));
      else if (!d.name.endsWith(".md")) continue;
      else if (!strict) out.push(p);
      else if (d.isFile()) {
        try {
          if (statSync(p).size <= MAX_LESSON_BYTES) out.push(p);
        } catch {
          /* gone or unreadable: not a lesson */
        }
      }
    }
  } finally {
    if (strict) entries.closeSync();
  }
  return out.sort();
}

/** The user's own wiki: entries here add to the shipped wiki, or replace or turn off a shipped entry with the same id. */
export const userWiki = () => join(jevisHome(), "wiki");

/** Canonical realpaths keep their exact case: Windows can enable case-sensitive folders. */
export const projectContains = (real, parent, separator = sep) => real.startsWith(`${parent}${separator}`);

/**
 * Project lessons: the nearest <folder>/.jevis/wiki at or above `cwd`, below
 * the home folder (whose .jevis is Jevis's own home). A project's lessons
 * are text the agent reads and can turn off shipped refusals, and a cloned
 * repository could ship either, so they load only once the user trusts them
 * with `jevis trust`. Trust is pinned to the files' contents: any change (a
 * pull, an edit) needs trusting again, as with direnv's `allow`.
 */
export function projectWiki(cwd) {
  if (!cwd) return null;
  const home = homedir();
  const own = resolve(userWiki());
  for (let d = resolve(cwd); d !== dirname(d) && !samePath(d, home); d = dirname(d)) {
    const dir = join(d, ".jevis", "wiki");
    if (!existsSync(dir)) continue;
    try {
      // The real path: a hook's cwd and a terminal's can name one folder two ways (/var and /private/var on macOS), and trust is keyed by path.
      const real = realpathSync(dir);
      if (samePath(real, own) || samePath(dir, own)) continue;
      // A link out of the repository (.jevis -> /) is not the repository's lessons.
      const parent = realpathSync(d);
      return projectContains(real, parent) && statSync(real).isDirectory() ? real : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Trust stays byte-exact: even a CRLF/LF-only edit needs trusting again, although both parse alike. */
function digestFiles(dir, files) {
  const h = createHash("sha256");
  for (const file of files) h.update(`${relative(dir, file)}\0${readFileSync(file)}\0`);
  return h.digest("hex").slice(0, 16);
}
export const wikiDigest = (dir) => digestFiles(dir, walk(dir, { strict: true }));

const trustFile = () => join(jevisHome(), "trusted.json");
const readTrust = () => {
  try {
    const all = JSON.parse(readFileSync(trustFile(), "utf8"));
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
};

/**
 * The project wiki for `cwd`, if any: where it is, and whether it is trusted
 * as it is now. A folder never trusted is not read at all, so an untrusted
 * repository costs a hook only the walk up to find it.
 */
function projectState(cwd) {
  const path = projectWiki(cwd);
  if (!path) return null;
  const record = readTrust()[path];
  if (typeof record?.hash !== "string") return { status: { path, hash: null, trusted: false, changed: false }, files: [] };
  const files = walk(path, { strict: true });
  const hash = digestFiles(path, files);
  return { status: { path, hash, trusted: record.hash === hash, changed: record.hash !== hash }, files };
}
export const projectStatus = (cwd) => projectState(cwd)?.status ?? null;

/** Trust a project wiki as it is now, or (`remove`) forget it. The record is private to this user. */
export function setTrust(path, { remove = false } = {}) {
  const all = readTrust();
  if (remove) delete all[path];
  else all[path] = { hash: wikiDigest(path), at: new Date().toISOString() };
  ensureDir();
  writeFileSync(trustFile(), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  return all[path] ?? null;
}

/**
 * Later roots win. JEVIS_WIKI (platform-separated absolute folders) replaces the
 * defaults; a relative one is ignored, since it would name a different
 * folder, perhaps an untrusted project's, in every directory a hook runs in.
 * A trusted project wiki for `cwd` comes last.
 */
function resolveRoots(cwd, { platform = process.platform, env = process.env } = {}) {
  if (env.JEVIS_WIKI) return { roots: splitFolders(env.JEVIS_WIKI, platform === "win32" ? win32.delimiter : posix.delimiter).filter((r) => isQualifiedPath(r, platform)), project: null };
  let checked = null;
  try {
    checked = cwd ? projectState(cwd) : null;
  } catch {
    /* an unreadable project folder loads the defaults */
  }
  const project = checked?.status.trusted ? checked.status.path : null;
  return { roots: [WIKI_ROOT, userWiki(), ...(project ? [project] : [])], project, files: project ? { [project]: checked.files } : {} };
}
export const wikiRoots = (cwd = null, options = {}) => resolveRoots(cwd, options).roots;

/**
 * What a project wiki changes on top of the defaults, for `jevis trust` and
 * `jevis lint` to show before anyone relies on it: entries it adds, defaults
 * it replaces or turns off, and entries that are broken or refused.
 */
export function projectLessons(path) {
  const base = new Set(loadWiki([WIKI_ROOT, userWiki()]).entries.map((e) => e.id));
  const own = loadWiki([path], { guarded: [path] });
  const broken = loadWiki([WIKI_ROOT, userWiki(), path], { guarded: [path] }).broken.filter((b) => insideFolder(b.file, path));
  const bad = new Set(broken.map((b) => b.id));
  return {
    added: own.entries.filter((e) => !base.has(e.id)),
    replaced: own.entries.filter((e) => base.has(e.id) && !bad.has(e.id)),
    off: own.off.filter((id) => base.has(id) && !bad.has(id)),
    broken,
  };
}

/** The lessons that apply in `cwd`: the defaults, and the project's once trusted, guarded as loadWiki describes. */
export function wikiFor(cwd) {
  const { roots, project, files } = resolveRoots(cwd);
  // Reuse the files just hashed, rather than selecting a second bounded slice of a changing tree.
  return loadWiki(roots, { guarded: project ? [project] : [], files });
}

/**
 * All sound entries, plus what `jevis lint` reports: broken entries, ids a later
 * root replaced, and ids it turned off. A broken replacement leaves the earlier
 * entry in force until it is fixed.
 *
 * A `guarded` root (a project's lessons) can add entries and change any
 * lesson but a safety one: turning off or replacing the check that stops a
 * force push or a machine-wide delete is the user's call, in ~/.jevis/wiki,
 * not something a cloned repository brings along.
 */
export function loadWiki(roots = wikiRoots(), { guarded = [], files = {} } = {}) {
  const byId = new Map();
  const broken = [];
  const replaced = [];
  const off = [];
  for (const root of roots) {
    for (const file of Object.hasOwn(files, root) ? files[root] : walk(root, { strict: guarded.includes(root) })) {
      const id = relative(root, file).split(process.platform === "win32" ? "\\" : "/").join("/").replace(/\.md$/, "");
      try {
        const e = parseEntry(readFileSync(file, "utf8"), id);
        if (guarded.includes(root) && id.startsWith("safety/") && byId.has(id)) {
          broken.push({ id, file, errors: ["a project's lessons cannot turn off or replace a safety entry; do that in ~/.jevis/wiki"] });
          continue;
        }
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

/** An entry can apply to this event, before Jev is asked: event, tool name, model family. */
export function applies(e, { event, tool = null, model = null }) {
  if (e.event !== event) return false;
  if (e.tools && !(tool && e.tools.some((t) => glob(t).test(tool)))) return false;
  const family = familyOf(model);
  return !(e.family && family && e.family !== family);
}

/** The entries to ask about this event: those that apply and are turned on. */
export const candidates = (entries, opts) => entries.filter((e) => enabled(e) && applies(e, opts));

const lookup = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * The facts in `when`, leaving out the axes, hold for this state. Facts are
 * known before Jev is asked, so an entry they rule out is never asked.
 */
export function factsHold(when, { event, state }) {
  const facts = Object.entries(when ?? {}).filter(([key]) => !AXES[event]?.[key]);
  return conditionsHold(Object.fromEntries(facts), { profile: {}, state });
}

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
