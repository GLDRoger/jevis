/**
 * What a shell command can do, decided exactly and conservatively in code.
 *
 * `plainRead` is true only for a command every part of which just reads: a
 * pipeline or chain of known read-only programs (ls, rg, sed -n 1,80p,
 * git log, gh pr view...), with no redirection into a file, no substitution
 * or variable expansion, no heredoc, and nothing that names a credential.
 * Anything it cannot prove is not a plain read, and the command is judged by
 * the decision model as before. A false "no" costs one call; a false "yes"
 * would let a write through unjudged, so every doubt answers "no".
 *
 * What it cannot see, the decision model could not see either: the contents
 * of files, and helpers a repository's own config runs (a git fsmonitor or
 * diff driver in an untrusted clone). A glob into ordinary files is allowed,
 * so a read could still print a credential kept under an innocent name.
 *
 * Entries about what a command changes, runs, opens, or reads from a secret
 * gate on `marks.plain_read: false`, so a plain read asks them nothing. In the
 * maintainer's log, most commands an agent runs are plain reads.
 */

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Anything that names a credential or where one lives, including dumps of
 * the environment (ENVIRON, /proc/<pid>/environ) and shell history: those
 * reads stay with the decision model.
 */
const SECRETISH = /\benv\b|\.env|environ|history|gh\/hosts|\.docker\/config|\.password-store|printenv|secret|token|passw|cred|api[_-]?key|apikey|auth(?!or(?:s|ed|ing|ship)?\b)|bearer|cookie|\.ssh\b|\.aws\b|\.netrc|\.npmrc|\.pypirc|\.pgpass|keychain|\bsecurity\b|private[_-]?key|\bkey\b|[_-]key\b|\.pem\b|\.p12\b|\.pfx\b|id_rsa|id_ed25519|kubeconfig|\.kube\b|\.gnupg/i;

/** A glob that can reach hidden files (.en?, ~/.config/gh/h*): it could expand to a credential no word names. */
const hiddenGlob = (word) => /^\.|\/\./.test(word);

/**
 * Split a command into segments of words, or null when it uses syntax that
 * could write or run something unseen: command or process substitution,
 * variable expansion, a heredoc, a subshell, output redirected anywhere but
 * /dev/null or another descriptor, or a glob into hidden files. Quoting and
 * escapes follow bash, so a word here is the word bash runs.
 */
export function segments(command) {
  const text = String(command ?? "");
  const out = [];
  let words = [];
  let word = null;
  let quote = null;
  let globbed = false;
  let unsafe = false;
  const endWord = () => {
    if (word !== null) {
      if (globbed && hiddenGlob(word)) unsafe = true;
      words.push(word);
    }
    word = null;
    globbed = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote === "'") {
      if (c === "'") quote = null;
      else word += c;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (c === "`" || (c === "$" && next && /[\w({!@#?*$-]/.test(next))) return null;
      // In double quotes a backslash escapes only $ ` " \ and a newline; before anything else it stays.
      else if (c === "\\" && next === "\n") i += 1;
      else if (c === "\\" && next !== undefined && "$`\"\\".includes(next)) word += text[(i += 1)];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      word ??= "";
    } else if (c === "\\") {
      if (next === "\n") i += 1;
      else if (next !== undefined) word = (word ?? "") + text[(i += 1)];
    } else if (c === " " || c === "\t") endWord();
    // A # is not taken as a comment: zsh only has comments in an interactive shell with INTERACTIVE_COMMENTS set,
    // so `ls #; rm x` can run rm. The words after it are checked like any others.
    else if (c === "\n" || c === ";") endSegment();
    else if (c === "&" && next === "&") {
      endSegment();
      i += 1;
    } else if (c === "|") {
      endSegment();
      if (next === "|" || next === "&") i += 1;
    } else if (c === ">" || c === "<" || (c === "&" && next === ">")) {
      // A bare descriptor number before the operator (2>) belongs to it, not to the command.
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      let j = c === "&" ? i + 2 : i + 1;
      if (c === "<") {
        if (next === "<" || next === "(" || next === ">") return null;
      } else {
        if (text[j] === ">") j += 1;
        if (text[j] === "|") j += 1;
        if (text[j] === "(") return null;
        if (text[j] === "&") {
          // Duplicating a descriptor (2>&1, >&2) writes nowhere new.
          const fd = text.slice(j + 1).match(/^\d+|^-/)?.[0];
          if (!fd) return null;
          i = j + fd.length;
          continue;
        }
      }
      while (text[j] === " " || text[j] === "\t") j += 1;
      const target = text.slice(j).match(/^[^\s;&|<>()]+/)?.[0];
      if (!target) return null;
      if (c !== "<" && target !== "/dev/null") return null;
      // bash opens a network connection for /dev/tcp and /dev/udp redirections, and expands a glob target.
      if (/^\/dev\/(tcp|udp)\//.test(target) || /[*?[]/.test(target)) return null;
      i = j + target.length - 1;
    } else if (c === "&") endSegment();
    else if (c === "`" || c === "(" || c === ")" || c === "{" || c === "}") return null;
    else if (c === "$") {
      if (next === undefined || next === " " || next === "\t" || next === "\n") word = (word ?? "") + c;
      else return null;
    } else {
      if (c === "*" || c === "?" || c === "[") globbed = true;
      word = (word ?? "") + c;
    }
  }
  if (quote) return null;
  endSegment();
  return unsafe ? null : out;
}

const positional = (args) => args.filter((a) => !a.startsWith("-"));
/** A short-flag cluster (-uo) or a long flag (--output, --output=x) among the args. */
const hasFlag = (args, short, long = []) =>
  args.some((a) => (short && /^-[^-]/.test(a) && [...a.slice(1)].some((ch) => short.includes(ch))) || long.some((l) => a === l || a.startsWith(`${l}=`)));
const always = () => true;

/**
 * A sed script that only transforms the text it streams: addresses, then
 * p d q Q = n N P D l g G h H x z, or s/// and y///. The s flags that write a
 * file (w) or run a command (e), and the w, W, r, R, e commands, fail it.
 */
export function sedStreamOnly(script) {
  const s = String(script);
  let i = 0;
  const space = () => {
    while (i < s.length && /[ \t]/.test(s[i])) i += 1;
  };
  const until = (d) => {
    while (i < s.length && s[i] !== d) i += s[i] === "\\" ? 2 : 1;
    if (s[i] !== d) return false;
    i += 1;
    return true;
  };
  const address = () => {
    if (/\d/.test(s[i] ?? "")) {
      while (/[\d~]/.test(s[i] ?? "")) i += 1;
      return true;
    }
    if (s[i] === "$") return (i += 1), true;
    if (s[i] === "/") {
      i += 1;
      if (!until("/")) return false;
      if (s[i] === "I" || s[i] === "M") i += 1;
      return true;
    }
    return null;
  };
  for (;;) {
    space();
    if (i >= s.length) return true;
    const a = address();
    if (a === false) return false;
    if (a) {
      space();
      if (s[i] === ",") {
        i += 1;
        space();
        if (s[i] === "+" || s[i] === "~") i += 1;
        if (!address()) return false;
      }
      space();
      if (s[i] === "!") i += 1;
      space();
    }
    const c = s[i++];
    if (c === "s" || c === "y") {
      const d = s[i++];
      if (!d || /[\s\\]/.test(d) || !until(d) || !until(d)) return false;
      if (c === "s") while (/[gpiImM\d]/.test(s[i] ?? "")) i += 1;
    } else if (!c || !"pdqQ=nNPDlgGhHxz".includes(c)) return false;
    space();
    if (i < s.length && s[i] !== ";" && s[i] !== "\n") return false;
    i += 1;
  }
}

function sed(args) {
  const scripts = [];
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "-e" || a === "--expression") scripts.push(args[(i += 1)] ?? "");
    else if (["-n", "--quiet", "--silent", "-E", "-r", "-u", "--regexp-extended"].includes(a) || /^-[nEru]+$/.test(a)) continue;
    else if (a.startsWith("-")) return false;
    else rest.push(a);
  }
  if (!scripts.length) {
    if (!rest.length) return false;
    scripts.push(rest.shift());
  }
  return scripts.every(sedStreamOnly);
}

/** awk with only -F and -v options (gawk's --source, -e, -f, and -i bring in program text this cannot see), and a program that cannot write or run anything. */
function awk(args) {
  let program;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "-F" || a === "-v") i += 1;
    else if (/^-F./.test(a) || /^-v\w+=/.test(a)) continue;
    else if (a.startsWith("-") && a !== "-") return false;
    else {
      program = a;
      break;
    }
  }
  return program !== undefined && !/[>|]|system|getline|close|fflush|@/.test(program);
}

/** Operands, counting `-` (standard input or output): `uniq - out` and `xxd -r - out` write their second one. */
const operands = (args) => args.filter((a) => a === "-" || !a.startsWith("-"));

/** git subcommands that only read the repository, each with the arguments that would make it write. */
const GIT_READS = new Set(["status", "log", "diff", "show", "rev-parse", "ls-files", "ls-tree", "blame", "grep", "shortlog", "describe", "cat-file", "rev-list", "merge-base", "name-rev", "whatchanged", "show-ref", "for-each-ref", "check-ignore", "count-objects", "cherry", "range-diff", "diff-tree", "diff-files", "diff-index", "annotate", "show-branch"]);
const GIT_BRANCH_WRITES = ["-d", "-D", "-m", "-M", "-c", "-C", "-f", "-u", "--delete", "--move", "--copy", "--force", "--set-upstream-to", "--unset-upstream", "--edit-description", "--track", "--no-track", "--create-reflog"];

function git(args) {
  let i = 0;
  // Global options before the subcommand; -c can point a pager or diff driver at any program.
  while (i < args.length && args[i].startsWith("-")) {
    const a = args[i];
    if (a === "-C") i += 2;
    else if (["--no-pager", "-P", "--no-optional-locks", "--literal-pathspecs", "--no-replace-objects"].includes(a) || /^--(git-dir|work-tree)=/.test(a)) i += 1;
    else return false;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  // --ext-diff and --textconv run the diff programs a repository configures.
  // -O<pager> (git grep) runs any program it names, attached or not.
  if (hasFlag(rest, "", ["--output", "--open-files-in-pager", "--ext-diff", "--textconv"]) || rest.some((a) => a.startsWith("-O"))) return false;
  if (GIT_READS.has(sub)) return true;
  switch (sub) {
    case "branch":
      return rest.every((a) => a.startsWith("-") && !GIT_BRANCH_WRITES.some((w) => a === w || a.startsWith(`${w}=`)));
    case "tag":
      return !rest.length || ((rest.includes("-l") || rest.includes("--list")) && !hasFlag(rest, "dasfmu", ["--delete", "--annotate", "--sign", "--force", "--message", "--file"]));
    case "remote":
      return !rest.length || (rest.length === 1 && ["-v", "--verbose"].includes(rest[0])) || ["get-url", "show"].includes(rest[0]);
    case "stash":
      return ["list", "show"].includes(rest[0]);
    case "worktree":
      return rest[0] === "list";
    case "reflog":
      return !["expire", "delete"].includes(rest[0]);
    case "config":
      return rest.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"].includes(a)) && !hasFlag(rest, "e", ["--unset", "--unset-all", "--add", "--replace-all", "--rename-section", "--remove-section", "--edit"]);
    default:
      return false;
  }
}

/** gh reads: viewing and listing, never in a browser window (--web). */
const GH_READS = { pr: ["view", "list", "diff", "checks", "status"], issue: ["view", "list", "status"], run: ["view", "list"], repo: ["view"], release: ["view", "list"], workflow: ["view", "list"], search: ["repos", "issues", "prs", "code", "commits"] };
function gh(args) {
  if (hasFlag(args, "w", ["--web", "--cache"])) return false;
  const [noun, verb] = positional(args);
  if (noun === "api") return !hasFlag(args, "XfF", ["--method", "--field", "--raw-field", "--input"]);
  return GH_READS[noun]?.includes(verb) ?? false;
}

/**
 * Jevis's own dry runs (`jevis ask`, `lint`, `stats`, `replay`) write nothing
 * unless given --record, and the sample they judge is test data, not work:
 * judging it would refuse the very dry runs the Jevis skill asks for.
 */
const JEVIS_READS = ["ask", "lint", "stats", "replay", "doctor", "mine"];
const jevisCli = (args) => JEVIS_READS.includes(args[0]) && !args.includes("--record");
/** This checkout's own CLI: by absolute or ~ path, or bin/jevis.mjs from a Jevis checkout's root. */
const OWN_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "jevis.mjs");
const isOwnCli = (path = "") => ["bin/jevis.mjs", "./bin/jevis.mjs"].includes(path) || resolve(path.replace(/^~(?=\/)/, homedir())) === resolve(OWN_CLI);
const nodeJevis = (args) => isOwnCli(args[0]) && jevisCli(args.slice(1));

/** Read-only programs, each with a check on the arguments that would make it write or run something else. */
const READERS = {
  ls: always, cat: always, head: always, tail: always, wc: always, nl: always, cut: always, tr: always, column: always, paste: always, fold: always, rev: always, comm: always, join: always,
  diff: always, cmp: always, stat: always, du: always, df: always, pwd: always, echo: always, printf: always, which: always, whereis: always, type: always,
  basename: always, dirname: always, realpath: always, readlink: always, whoami: always, id: always, uname: always, true: always, false: always, test: always, "[": always,
  sleep: always, pgrep: always, lsof: always, grep: always, egrep: always, fgrep: always, jq: always, od: always, hexdump: always, strings: always,
  shasum: always, md5: always, md5sum: always, sha1sum: always, sha256sum: always, cd: always, mdls: always, mdfind: always, sw_vers: always, uptime: always, nproc: always,
  // ps e / ps -e (macOS) print each process's environment, API keys and all.
  ps: (a) => !a.some((x) => !x.startsWith("--") && /^-?[a-z]+$/i.test(x) && /e/i.test(x)),
  file: (a) => !hasFlag(a, "C", ["--compile"]),
  sort: (a) => !hasFlag(a, "o", ["--output", "--compress-program"]),
  uniq: (a) => operands(a).length <= 1,
  xxd: (a) => operands(a).length <= 1,
  // tree -R with -H writes an 00Tree.html into every folder.
  tree: (a) => !hasFlag(a, "oR"),
  rg: (a) => !hasFlag(a, "", ["--pre", "--hostname-bin"]),
  fd: (a) => !hasFlag(a, "xX", ["--exec", "--exec-batch"]),
  find: (a) => !a.some((x) => ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(x)),
  sed,
  awk,
  yq: (a) => !hasFlag(a, "is", ["--inplace", "--split-exp"]),
  // Not `sg`: on Linux that name runs a command as another group.
  "ast-grep": (a) => !hasFlag(a, "Ui", ["--update-all", "--interactive"]) && !["new", "lsp", "test"].some((x) => a.includes(x)),
  date: (a) => !hasFlag(a, "s", ["--set"]) && positional(a).every((x) => x.startsWith("+")),
  hostname: (a) => !positional(a).length,
  command: (a) => ["-v", "-V"].includes(a[0]),
  sysctl: (a) => !hasFlag(a, "wpf", ["--write", "--load", "--system"]) && !a.some((x) => x.includes("=")),
  git,
  gh,
  jevis: jevisCli,
  node: nodeJevis,
};

/** True when every part of `command` only reads; false when anything could write, run, open, or touch a credential. */
export function plainRead(command) {
  const text = String(command ?? "").trim();
  if (!text || text.length > 4000 || SECRETISH.test(text)) return false;
  const parts = segments(text);
  if (!parts?.length) return false;
  return parts.every(([program, ...args]) => Object.hasOwn(READERS, program) && READERS[program](args));
}
