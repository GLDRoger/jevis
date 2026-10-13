import { posix } from "node:path";
import { segments } from "./shell.mjs";

/** Closed, code-owned predicates: true/false is exact; null needs Jev.
 * Never execute input or decide permission. Unproven inputs and rule errors
 * go to Jev; a Jev failure still lets the agent carry on.
 */
export const RULES = ["destructive_git", "em_dash_copy", "gradient_text", "emoji_icons"];
export function codeDecision(name, state) {
  try {
    if (!RULES.includes(name)) return null;
    return predicates[name](state);
  } catch {
    return null;
  }
}

const sharedBranch = (ref) => /^(?:main|master|trunk|develop|development|release(?:\/.*)?)$/.test(ref.replace(/^refs\/heads\//, ""));

/** A deliberately small getopt grammar. Unknown flags, negations, abbreviations
 * and option operands are NOT positional arguments or short-flag bundles.
 * Only explicitly declared value options consume a following/attached value.
 */
function gitArgs(args, flags = {}, values = {}) {
  const opts = new Set();
  const operands = [];
  let ended = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!ended && arg === "--") { ended = true; continue; }
    if (ended || !arg.startsWith("-")) { operands.push(arg); continue; }
    if (Object.hasOwn(flags, arg)) { opts.add(flags[arg]); continue; }
    const equal = arg.indexOf("=");
    const key = equal < 0 ? arg : arg.slice(0, equal);
    if (Object.hasOwn(values, key)) {
      const value = equal < 0 ? args[++i] : arg.slice(equal + 1);
      if (value === undefined || !value) return null;
      opts.add(values[key]);
      continue;
    }
    if (/^-[^-]/.test(arg)) {
      const valueKey = arg.slice(0, 2);
      if (Object.hasOwn(values, valueKey)) {
        if (!arg.slice(2)) return null;
        opts.add(values[valueKey]);
        continue;
      }
      const short = [...arg.slice(1)].map((ch) => flags[`-${ch}`]);
      if (short.length && short.every(Boolean)) { short.forEach((v) => opts.add(v)); continue; }
    }
    return null;
  }
  return { opts, operands, ended };
}

const QUIET = { "-q": "quiet", "--quiet": "quiet" };
const FORCE = { "-f": "force", "--force": "force" };
const DRY = { "-n": "dry", "--dry-run": "dry" };
const HELP = { "-h": "help", "--help": "help" };
const plainOperands = (xs) => xs.every((x) => x && !x.startsWith("-") && !/[*?\[\]{}]/.test(x));

function gitCommand(words) {
  let i = 1;
  while (words[i] === "-C" || words[i] === "--no-pager") {
    if (words[i++] === "-C") {
      const folder = words[i++];
      if (!folder || !plainOperands([folder])) return null;
    }
  }
  const command = words[i];
  const args = words.slice(i + 1);
  let parsed;
  switch (command) {
    case "reset":
      parsed = gitArgs(args, { ...HELP, "--hard": "hard", "--soft": "soft", "--mixed": "mixed" });
      if (!parsed || !plainOperands(parsed.operands) || parsed.operands.length > 1 || parsed.ended) return null;
      if (parsed.opts.has("help")) return false;
      if (parsed.opts.size !== 1 || !parsed.opts.has("hard")) return null;
      return true;
    case "clean":
      parsed = gitArgs(args, { ...HELP, ...QUIET, ...FORCE, ...DRY, "-d": "dirs", "-x": "ignored", "-X": "onlyIgnored" });
      if (!parsed || !plainOperands(parsed.operands) || parsed.opts.has("ignored") && parsed.opts.has("onlyIgnored")) return null;
      if (parsed.opts.has("help") || parsed.opts.has("dry")) return false;
      // Without -f, clean.requireForce=false can still discard files.
      return parsed.opts.has("force") ? true : null;
    case "push": {
      parsed = gitArgs(args, { ...HELP, ...QUIET, ...FORCE, ...DRY, "-v": "verbose", "--verbose": "verbose", "-u": "upstream", "--set-upstream": "upstream", "--force-with-lease": "lease" });
      if (!parsed || !plainOperands(parsed.operands)) return null;
      const [remote, ...refs] = parsed.operands;
      // Empty-source refspecs delete refs. Unsupported refspec grammars and
      // server push options stay with Jev, even alongside --force/-n.
      if (remote?.startsWith("+") || remote?.startsWith(":")) return null;
      if (remote && !/^[A-Za-z0-9][\w.-]*$/.test(remote)) return null;
      if (refs.some((r) => !/^\+?[^:+\s]+(?::[^:+\s]+)?$/.test(r))) return null;
      if (parsed.opts.has("help") || parsed.opts.has("dry")) return false;
      if (parsed.opts.has("force") || refs.some((r) => r.startsWith("+"))) return true;
      if (parsed.opts.has("lease")) return refs.some((r) => sharedBranch(r.split(":").at(-1))) ? true : null;
      // Without an explicit refspec, remote.*.push can supply a forced one.
      return refs.length ? false : null;
    }
    case "checkout":
    case "switch":
      parsed = gitArgs(args, { ...HELP, ...QUIET, ...FORCE, "--discard-changes": "force" });
      if (!parsed || !plainOperands(parsed.operands)) return null;
      if (parsed.opts.has("help")) return false;
      if (command === "checkout" && parsed.ended && parsed.operands.length) return true;
      if (parsed.operands.length !== 1) return null;
      if (parsed.opts.has("force")) return true;
      return command === "switch" ? false : parsed.operands[0] === "." ? true : null;
    case "restore":
      parsed = gitArgs(args, { ...HELP, ...QUIET, "-S": "staged", "--staged": "staged", "-W": "worktree", "--worktree": "worktree" });
      if (!parsed || !plainOperands(parsed.operands)) return null;
      if (parsed.opts.has("help")) return false;
      if (!parsed.operands.length) return null;
      return !parsed.opts.has("staged") || parsed.opts.has("worktree");
    case "branch":
      parsed = gitArgs(args, { ...HELP, ...QUIET, ...FORCE, "-d": "delete", "--delete": "delete", "-D": "forceDelete", "-l": "list", "--list": "list" });
      if (!parsed || !parsed.opts.has("list") && !plainOperands(parsed.operands)) return null;
      if (parsed.opts.has("help")) return false;
      if (parsed.opts.has("list")) return parsed.opts.has("force") || parsed.opts.has("delete") || parsed.opts.has("forceDelete") ? null : false;
      if (parsed.opts.has("forceDelete") || parsed.opts.has("delete") && parsed.opts.has("force")) return parsed.operands.length ? true : null;
      if (parsed.opts.has("force")) return null; // May replace an existing branch's history.
      if (parsed.opts.has("delete")) return parsed.operands.length ? false : null;
      return parsed.operands.length <= 2 ? false : null;
    case "stash": {
      const action = args[0] ?? "push";
      if (!args.length) return false;
      if (action === "clear") return args.length === 1 ? true : null;
      if (!["push", "pop", "apply", "drop", "list", "show"].includes(action)) return null;
      parsed = gitArgs(args.slice(1), { ...QUIET });
      if (!parsed || !plainOperands(parsed.operands) || parsed.operands.length > 1) return null;
      return action === "drop" ? true : false;
    }
    case "add":
      parsed = gitArgs(args, { ...HELP, "-A": "all", "--all": "all", "-u": "update", "--update": "update" });
      return parsed && plainOperands(parsed.operands) ? false : null;
    case "commit":
      parsed = gitArgs(args, { ...HELP, ...QUIET, "-a": "all", "--all": "all", "--amend": "amend" }, { "-m": "message", "--message": "message" });
      return parsed && plainOperands(parsed.operands) && !parsed.opts.has("amend") ? false : null;
    case "status":
    case "log":
    case "diff":
    case "show":
    case "revert":
      parsed = gitArgs(args, HELP);
      return parsed && plainOperands(parsed.operands) ? false : null;
    default:
      return null;
  }
}

function destructiveGit({ input, tool }) {
  if (tool !== "Bash") return null;
  const commands = segments(input);
  if (!commands?.length || String(input).endsWith("…")) return null;
  if (commands.some((words) => ["false", "exit", "return"].includes(words[0]))) return null;
  let unknown = false;
  let destructive = false;
  let unknownGit = false;
  for (const words of commands) {
    let decision = null;
    if (words[0] === "git") {
      decision = gitCommand(words);
      if (decision === null) unknownGit = true;
    }
    else if (words[0] === "echo" || words[0] === "true" && words.length === 1) decision = false;
    else if (words[0] === "printf" && ["%s", "%s\\n"].includes(words[1])) decision = false;
    else if (words[0] === "cd" && words.length === 2 && plainOperands(words.slice(1))) decision = false;
    if (decision === true) destructive = true;
    if (decision === null) unknown = true;
  }
  return unknownGit ? null : destructive ? true : unknown ? null : false;
}

const UI = /\.(?:html|jsx|tsx|vue|svelte|astro|css|scss)$/i;
const TEST = /(?:\.(?:test|spec|stories)\.|(?:^|\/)(?:__tests__|tests?|__mocks__|e2e)\/)/;
/** Only known edit shapes; shell writes and unfamiliar fragments need Jev. */
function edits({ input, tool }) {
  const text = String(input ?? "");
  if (text.endsWith("…")) return null;
  if (["Write", "Edit", "MultiEdit"].includes(tool)) {
    const m = /^(?:Write|Edit|MultiEdit) (.+)\n([\s\S]*)$/.exec(text);
    return m && text.startsWith(`${tool} `) ? [{ path: m[1], body: m[2], complete: tool === "Write" }] : null;
  }
  if (tool === "apply_patch") {
    const pieces = text.split(/^\*\*\* (Add|Update|Delete) File: (.+)\r?\n/gm);
    if (pieces.length < 3 || pieces[0].trim()) return null;
    const out = [];
    for (let i = 1; i < pieces.length; i += 3) out.push({ path: pieces[i + 1], body: pieces[i + 2], complete: pieces[i] === "Add" });
    return out;
  }
  return null;
}

const stripComments = (body) => body.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Accept literal markup or a simple JSX return, not HTML examples in strings. */
function markup(body) {
  const clean = stripComments(body).trim();
  const m = /^(?:export\s+(?:default\s+)?)?function\s+\w+\([^)]*\)\s*\{\s*return\s+(<[^]*?)\s*;?\s*\}$/.exec(clean);
  const html = clean.startsWith("<") ? clean : m?.[1];
  if (!html) return null;
  // JSX expressions can contain strings naming the pattern. Do not mistake
  // them for emitted markup. A small balanced scan skips expressions, quotes
  // included; malformed or template expressions fall back to Jev.
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (!depth) out += ch;
      if (ch === "\\") { if (!depth) out += html[i + 1] ?? ""; i += 1; }
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      if (!depth) out += ch;
    } else if (ch === "`" && depth) return null;
    else if (ch === "{") { depth += 1; if (depth === 1) out += "{}"; }
    else if (ch === "}") { if (!depth) return null; depth -= 1; }
    else if (!depth) out += ch;
  }
  if (depth || quote) return null;
  out = out.replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, "");
  // Tokenize tag boundaries outside attribute quotes. Global regexes would
  // mistake HTML examples inside data attributes for real tags/attributes.
  const tokens = [];
  for (let i = 0; i < out.length;) {
    if (out[i] !== "<") {
      const end = out.indexOf("<", i);
      const text = out.slice(i, end < 0 ? out.length : end).trim();
      if (text) tokens.push({ text });
      i = end < 0 ? out.length : end;
      continue;
    }
    let j = i + 1;
    let quoted = null;
    for (; j < out.length; j += 1) {
      if (quoted) { if (out[j] === quoted) quoted = null; }
      else if (out[j] === '"' || out[j] === "'") quoted = out[j];
      else if (out[j] === ">") break;
    }
    if (j === out.length) return null;
    const tag = /^<(\/?)([a-z][\w.-]*)([\s\S]*?)\/?\s*>$/i.exec(out.slice(i, j + 1));
    if (!tag) return null;
    const attrs = {};
    const tail = tag[3].trim();
    const attr = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/gy;
    let at = 0;
    while (at < tail.length) {
      attr.lastIndex = at;
      const m = attr.exec(tail);
      if (!m) return null;
      attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
      at = attr.lastIndex;
      while (/\s/.test(tail[at] ?? "") && at < tail.length) at += 1;
    }
    tokens.push({ tag: tag[2].toLowerCase(), close: Boolean(tag[1]), attrs });
    i = j + 1;
  }
  return tokens;
}

// Extensions alone do not establish developer documentation: content/home.md
// and ordinary .txt files can be visible product copy.
const DEV_DOC = /(?:^|\/)(?:docs|wiki)\/|(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|AGENTS|CLAUDE|LICENSE|WIKI)(?:\.(?:md|txt))?$/i;
const onlyComments = (body) => /^(?:\s|<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))*$/.test(body);
function editRule(state, absent, test) {
  const files = edits(state);
  if (!files?.length) return null;
  let unknown = false;
  for (const { path, body, complete } of files) {
    // Added lines are not a lexical unit. They might lie inside an existing
    // comment/string, or combine with unseen declarations. Never guess.
    if (!complete) { unknown = true; continue; }
    if (absent(body)) continue;
    const file = posix.normalize(path.replaceAll("\\", "/"));
    if (TEST.test(file) || /\.(?:md|txt)$/i.test(file) && DEV_DOC.test(file) || onlyComments(body)) continue;
    if (!UI.test(file)) { unknown = true; continue; }
    const result = test(body, file);
    if (result === true) return true;
    if (result === null) unknown = true;
  }
  return unknown ? null : false;
}

function emDash(state) {
  return editRule(state, (s) => !s.includes("—"), (body) => {
    if (!body.includes("—")) return false;
    const tokens = markup(body);
    if (!tokens || tokens.some((t) => ["pre", "code"].includes(t.tag))) return null;
    // A lone table placeholder is not prose; expressions and attributes whose
    // context is unclear stay with Jev. Match literal visible text only.
    if (tokens.some((t) => t.text?.includes("—") && t.text !== "—")) return true;
    for (const t of tokens) for (const key of ["alt", "title", "aria-label", "placeholder"]) {
      if (t.attrs?.[key]?.includes("—") && t.attrs[key].trim() !== "—") return true;
    }
    // Only a literal table placeholder (or this small ternary shape) is
    // proven non-prose. A quoted dash may be concatenated into visible copy.
    const prose = body.replace(/<td\b[^>]*>\s*—\s*<\/td>/gi, "")
      .replace(/<td\b[^>]*>\s*\{[\w$]+\s*\?\s*[\w$.]+\([^{}"'`]*\)\s*:\s*(["'])—\1\s*\}\s*<\/td>/gi, "");
    if (!prose.includes("—")) return false;
    return null;
  });
}

/** A literal gradient and text clipping in one declaration list. */
function literalGradient(declarations) {
  if (/(?:^|;)\s*all\s*:/i.test(declarations)) return null;
  const fills = [...declarations.matchAll(/(?:^|;)\s*(background(?:-image)?)\s*:\s*([^;]*)/gi)];
  const clips = [...declarations.matchAll(/(?:^|;)\s*(?:-webkit-)?background-clip\s*:\s*([^;]*)/gi)];
  const colors = [...declarations.matchAll(/(?:^|;)\s*color\s*:\s*([^;]*)/gi)];
  const textFills = [...declarations.matchAll(/(?:^|;)\s*(?:-webkit-)?text-fill-color\s*:\s*([^;]*)/gi)];
  if (fills.length !== 1 || clips.length !== 1 || colors.length > 1 || textFills.length > 1) return null;
  // A later background shorthand resets background-clip to border-box.
  if (fills[0][1].toLowerCase() === "background" && fills[0].index > clips[0].index) return null;
  const transparent = (v) => /^transparent\s*(?:!important\s*)?$/i.test(v ?? "");
  // A nontransparent text fill overrides color:transparent in WebKit.
  const clearFill = textFills.length ? transparent(textFills[0][1]) : transparent(colors[0]?.[1]);
  return clearFill && /^text\s*(?:!important\s*)?$/i.test(clips[0][1]) && /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(fills[0][2]) ? true : null;
}

function gradientText(state) {
  return editRule(state, (s) => !/bg-clip-text|background-clip\s*:\s*text/i.test(s), (body, path) => {
    if (!/bg-clip-text|background-clip\s*:\s*text/i.test(stripComments(body))) return null;
    if (/\.(?:css|scss)$/i.test(path)) {
      // Both declarations must belong to the same simple rule, not neighboring
      // selectors. Nested CSS/SCSS, variables and incomplete edits need Jev.
      const css = stripComments(body).trim();
      if (/['"`]|\$|#\{/.test(body) || !/^(?:[^{}]+\{[^{}]*\}\s*)+$/.test(css)) return null;
      for (const m of css.matchAll(/[^{}]+\{([^{}]*)\}/g)) {
        if (literalGradient(m[1]) === true) return true;
      }
      return null;
    }
    const tokens = markup(body);
    if (!tokens || tokens.some((t) => ["pre", "code"].includes(t.tag))) return null;
    for (const t of tokens) for (const key of ["class", "className", "style"]) {
      const value = t.attrs?.[key] ?? "";
      if (key !== "style") {
        // An inline style or another text-color utility may override the fill.
        // Typography utilities are known non-painting shapes; everything else
        // text-* stays with Jev rather than guessing Tailwind's cascade.
        if (t.attrs?.style) continue;
        const groups = new Map();
        for (const cls of value.split(/\s+/)) {
          const colon = cls.lastIndexOf(":");
          const condition = cls.slice(0, colon + 1);
          if (!groups.has(condition)) groups.set(condition, []);
          groups.get(condition).push(cls.slice(colon + 1));
        }
        const typeOnly = /^text-(?:xs|sm|base|lg|xl|[2-9]xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty)$/;
        if ([...groups.values()].some((classes) => classes.some((v) => v.startsWith("text-") && v !== "text-transparent" && !typeOnly.test(v)))) continue;
        for (const classes of groups.values()) {
          if (classes.includes("bg-clip-text") && classes.includes("text-transparent") && classes.some((v) => /^bg-gradient-to-(?:r|l|t|b|tr|tl|br|bl)$/.test(v))) return true;
        }
      }
      if (key === "style" && literalGradient(value) === true) return true;
    }
    return null;
  });
}

const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/u;
function emojiIcons(state) {
  // Message content and supplied emoji are not necessarily decoration.
  if (/\b(?:chat|messages?|reactions?)\b/i.test(state.request ?? "") || EMOJI.test(state.request ?? "")) return null;
  return editRule(state, (s) => !EMOJI.test(s), (body) => {
    if (!EMOJI.test(body)) return false;
    const tokens = markup(body);
    if (!tokens || tokens.some((t) => ["pre", "code"].includes(t.tag))) return null;
    for (let i = 0; i + 3 < tokens.length; i += 1) {
      const [open, text, close, heading] = tokens.slice(i, i + 4);
      if (open.tag === "span" && !open.close && close.tag === "span" && close.close && /^h[1-6]$/.test(heading.tag ?? "") && !heading.close && /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D\s]+$/u.test(text.text ?? "") && EMOJI.test(text.text ?? "")) return true;
    }
    return null;
  });
}

const predicates = { destructive_git: destructiveGit, em_dash_copy: emDash, gradient_text: gradientText, emoji_icons: emojiIcons };
