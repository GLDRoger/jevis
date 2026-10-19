import { plainRead, readOnlyWords, segments } from "./shell.mjs";

/** null means unknown, NEVER a reason to remove a lesson. Unknown executables,
 * scripts, aliases, expansions and clipped commands remain model-reviewed.
 * Positive facts describe explicit operations, not proof that they succeed.
 */
export const BASH_FACTS = ["git_write", "writes_file", "runs_tests", "opens_app", "uses_credentials"];
const unknown = () => Object.fromEntries(BASH_FACTS.map((key) => [key, null]));
const WRITERS = new Set(["tee", "cp", "mv", "install", "touch", "truncate"]);
const OPENERS = new Set(["open", "say", "afplay", "osascript", "ffplay", "xdg-open"]);
const RUNNERS = new Set(["npm", "pnpm", "yarn", "bun", "npx", "pytest", "jest", "vitest", "playwright", "tsc", "eslint", "cargo", "go", "make", "cmake", "ctest", "mvn", "gradle", "dotnet"]);
const checkWords = ([program, ...args]) => RUNNERS.has(program) && args.some((a) => /(?:^|[:/.-])(?:test|tests|spec|check|typecheck|lint|build|jest|vitest|playwright|tsc|eslint)(?:$|[:/.-])/.test(a)) || ["pytest", "jest", "vitest", "playwright", "tsc", "eslint", "ctest"].includes(program) || program === "node" && args.includes("--test");
/** Recognize check runners even with options outside the effect-proof grammar. */
export const isCheckCommand = (command) => !String(command).endsWith("…") && Boolean(segments(String(command))?.some(checkWords));
// These utilities neither execute arbitrary programs nor consume/set
// credentials. Path/option words naming secrets still leave that lesson in.
const LOCAL = new Set(["mkdir", "rmdir", "rm", "chmod", "chown", "kill", "pkill", "wait"]);
const GIT_WRITES = new Set(["commit", "push", "tag", "merge", "rebase", "reset", "add", "checkout", "switch", "restore", "clean", "stash", "branch", "fetch", "pull", "clone", "init", "gc", "update-ref", "reflog", "config", "remote", "worktree", "cherry-pick", "revert", "apply", "am"]);

// Closed option grammar: an abbreviation, an unknown option, or a missing
// option value cannot establish a negative effect. Keep the catalog small;
// unsupported valid options cost review rather than silently suppress it.
const optionSpec = (flags = "", values = "", short = "", shortValues = "") => ({
  flags: new Set(flags.split(" ").filter(Boolean)),
  values: new Set(values.split(" ").filter(Boolean)), short, shortValues,
});
const OPTIONS = {
  mkdir: optionSpec("--parents --verbose --help --version", "--mode", "pv", "m"),
  rmdir: optionSpec("--parents --verbose --ignore-fail-on-non-empty --help --version", "", "pv"),
  rm: optionSpec("--force --recursive --verbose --dir --help --version --one-file-system --preserve-root --no-preserve-root", "", "firdRvIP"),
  chmod: optionSpec("--recursive --verbose --changes --silent --quiet --help --version", "--reference", "Rvcf"),
  chown: optionSpec("--recursive --verbose --changes --silent --quiet --dereference --no-dereference --help --version", "--reference --from", "RvcfhHLP"),
  kill: optionSpec("--list --help --version", "--signal", "l", "s"),
  pkill: optionSpec("--full --exact --newest --oldest --count --help --version", "--signal --parent --uid --euid", "fxnoce", "PUGu"),
  wait: optionSpec("", "", "nf", "p"),
  cp: optionSpec("--recursive --force --interactive --verbose --archive --no-clobber --remove-destination --help --version", "--target-directory --suffix", "afipRrvn", "tS"),
  mv: optionSpec("--force --interactive --verbose --no-clobber --help --version", "--target-directory --suffix", "fivn", "tS"),
  install: optionSpec("--strip --directory --preserve-timestamps --verbose --compare --help --version", "--mode --owner --group --target-directory --suffix", "bcdDpsvC", "mogtS"),
  tee: optionSpec("--append --ignore-interrupts --help --version", "", "ai"),
  touch: optionSpec("--no-create --help --version", "--date --reference --time", "acmh", "drt"),
  truncate: optionSpec("--no-create --help --version", "--size --reference", "co", "sr"),
  say: optionSpec("--help", "--voice --output-file --rate", "", "vor"),
  afplay: optionSpec("--help", "", "", "vtrdq"),
  // These can execute arbitrary programs; no negative effect is derived.
  open: optionSpec("", "", "nRWgjFh", "ab"),
  osascript: optionSpec("", "", "", "els"),
  "xdg-open": optionSpec("--help --version"),
  ffplay: optionSpec(),
  cat: optionSpec("--number --number-nonblank --squeeze-blank --show-all --show-ends --show-tabs --show-nonprinting --help --version", "", "AbEnstTuv"),
  ls: optionSpec("--all --almost-all --directory --recursive --human-readable --help --version", "--color --format --sort --time", "1aAbBcCdFfghHilLmnoOpPqQrRsStTuUvwx@"),
  head: optionSpec("--quiet --silent --verbose --help --version", "--lines --bytes", "qv", "nc"),
  tail: optionSpec("--quiet --silent --verbose --follow --help --version", "--lines --bytes --pid --sleep-interval", "fqvF", "nc"),
  wc: optionSpec("--lines --words --bytes --chars --max-line-length --help --version", "", "clmwL"),
  pwd: optionSpec("--logical --physical --help --version", "", "LP"),
  echo: optionSpec("", "", "neE"),
  printf: optionSpec(),
  sleep: optionSpec("--help --version"),
  true: optionSpec("--help --version"),
  false: optionSpec("--help --version"),
  cd: optionSpec("", "", "LP"),
  which: optionSpec("--all --help --version", "", "as"),
  rg: optionSpec("--files --hidden --line-number --no-line-number --ignore-case --fixed-strings --count --files-with-matches --files-without-match --only-matching --no-heading --heading --json --quiet --no-ignore --multiline --help --version", "--glob --type --max-count --max-columns --context --before-context --after-context --regexp", "nifclLoqUuvhsS", "geABCmt"),
  grep: optionSpec("--recursive --ignore-case --fixed-strings --extended-regexp --line-number --count --files-with-matches --files-without-match --only-matching --quiet --help --version", "--regexp --file --include --exclude --context --before-context --after-context", "rRinEFclLoqvhswxy", "efABCm"),
  sed: optionSpec("--quiet --silent --regexp-extended --unbuffered --in-place", "--expression --in-place", "nErui", "e"),
  node: optionSpec("--test --test-only --test-force-exit --experimental-test-coverage", "--test-name-pattern --test-reporter --test-concurrency", "", "e"),
  // No options is still useful for the less common known readers. Flags
  // outside this catalog deliberately fall back to unknown.
};
const GIT_OPTIONS = {
  status: optionSpec("--short --branch --porcelain --untracked-files --ignored", "", "sbz"),
  log: optionSpec("--oneline --stat --name-only --name-status --all --graph --decorate --no-decorate --no-patch", "--format --pretty --max-count --since --until", "p", "n"),
  diff: optionSpec("--stat --name-only --name-status --cached --staged --check --quiet --exit-code --no-ext-diff --no-textconv", "", "wU", ""),
  show: optionSpec("--stat --name-only --name-status --no-patch", "--format --pretty", "p"),
  branch: optionSpec("--list --all --remotes --verbose --delete --force --move --copy", "--sort", "arvldDmMcCf"),
  tag: optionSpec("--list --delete --force --annotate --sign", "--message --file", "ldfas", "mF"),
  commit: optionSpec("--all --amend --no-edit --quiet --verbose --signoff --no-verify --allow-empty", "--message --file", "aqvs", "mF"),
  push: optionSpec("--force --force-with-lease --delete --tags --all --dry-run --set-upstream --quiet", "", "fduqn"),
  reset: optionSpec("--hard --soft --mixed --keep --merge --quiet", "", "q"),
  add: optionSpec("--all --update --force --dry-run --verbose", "", "Aufnv"),
  merge: optionSpec("--no-ff --ff-only --no-edit --abort", "--message", "", "m"),
  rebase: optionSpec("--continue --abort --skip --interactive", "--onto", "i"),
};

function knownOptions(args, spec = optionSpec(), countOption = false) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") return true;
    if (countOption && /^-\d+$/.test(arg)) continue;
    if (!arg.startsWith("-") || arg === "-") continue;
    if (arg.startsWith("--")) {
      const equal = arg.indexOf("=");
      const name = equal < 0 ? arg : arg.slice(0, equal);
      if (spec.flags.has(name) && equal < 0) continue;
      if (!spec.values.has(name)) return false;
      if (equal < 0 && args[++i] === undefined) return false;
    } else {
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j];
        if (spec.shortValues.includes(ch)) {
          if (j === arg.length - 1 && args[++i] === undefined) return false;
          break;
        }
        if (!spec.short.includes(ch)) return false;
      }
    }
  }
  return true;
}

function gitParts(args) {
  let i = 0;
  while (args[i]?.startsWith("-")) {
    if (["-C", "--git-dir", "--work-tree"].includes(args[i])) {
      if (args[i + 1] === undefined) return null;
      i += 2;
    } else if (["--no-pager", "--no-optional-locks", "--literal-pathspecs", "--no-replace-objects"].includes(args[i]) || /^--(?:git-dir|work-tree)=.+/.test(args[i])) i++;
    else return null;
  }
  const sub = args[i];
  return sub && knownOptions(args.slice(i + 1), GIT_OPTIONS[sub], sub === "log") ? sub : null;
}

// Writing lessons require writes_file === true, so a command the parser
// can't fully prove (an unquoted heredoc, an inline script) still needs a
// positive write signal. Only the command line is searched for a redirect:
// a heredoc body is content, and HTML in it is full of `>`. Only interface
// and copy files count: log and scratch redirects are most Bash writes and
// no writing lesson can apply to them.
const UI_FILE = String.raw`[\w./~$-]*\.(?:html?|css|scss|sass|less|[cm]?[jt]sx?|vue|svelte|astro|mdx?|svg)`;
const REDIRECT = new RegExp(String.raw`(?:^|[^0-9&>])>>?\s*['"]?${UI_FILE}(?=$|[\s'"&|;)])`);
const INLINE_SCRIPT = /\b(?:python3?|node|perl|ruby)\b[^\n]*<</;
const SCRIPT_WRITE = /\.write_text\(|\.write_bytes\(|\bopen\([^)\n]*['"][wa]b?\+?['"]|\.write\(|writeFileSync|appendFileSync|fs\.(?:promises\.)?write|File\.write/;
const SCRIPT_UI_PATH = new RegExp(String.raw`['"]${UI_FILE}['"]`);
export const provenWrite = (text) => {
  const [line, ...rest] = String(text).split("\n");
  const body = rest.join("\n");
  return REDIRECT.test(line) || INLINE_SCRIPT.test(line) && SCRIPT_WRITE.test(body) && SCRIPT_UI_PATH.test(body);
};

export function bashFacts(command) {
  const text = String(command ?? "");
  if (text.endsWith("…")) return unknown();
  const effects = { writes: false };
  const parts = segments(text, { effects });
  if (!parts?.length) return { ...unknown(), writes_file: provenWrite(text) ? true : null };
  const result = Object.fromEntries(BASH_FACTS.map((key) => [key, false]));
  const merge = (key, value) => { if (result[key] !== true) result[key] = value === true ? true : result[key] === null || value === null ? null : false; };
  const read = plainRead(text);
  for (const [program, ...args] of parts) {
    // Check options BEFORE trusting a reader predicate. GNU accepts long
    // abbreviations; unrecognized options may select an execution path.
    const sub = program === "git" ? gitParts(args) : null;
    const known = program === "git" ? sub !== null : knownOptions(args, OPTIONS[program]);
    if (!known) {
      for (const key of BASH_FACTS) merge(key, null);
      continue;
    }
    // Never reconstruct words for this proof: quoting has already been lost.
    if (read) continue;
    const local = LOCAL.has(program);
    const reader = readOnlyWords([program, ...args]);
    const writer = WRITERS.has(program);
    const opener = OPENERS.has(program);
    const canExecute = program === "osascript" || program === "open" || program === "xdg-open" || program === "install" && args.some((a) => a === "--strip" || /^-[^-]*s/.test(a) || a.startsWith("--strip-program"));
    const simpleWriter = writer && !canExecute;
    const simpleOpener = opener && !canExecute;
    const gitWrite = program === "git" && GIT_WRITES.has(sub);
    merge("git_write", gitWrite ? true : local || simpleWriter || simpleOpener || reader ? false : null);
    merge("writes_file", effects.writes || writer || program === "sed" && args.some((a) => a === "-i" || /^--in-place(?:=|$)/.test(a)) ? true : local || simpleOpener || reader ? false : null);
    merge("runs_tests", checkWords([program, ...args]) ? true : local || simpleWriter || simpleOpener || reader ? false : null);
    // Script runners, git hooks, drivers and downloaded binaries can open
    // windows even when the executable's name doesn't look like an opener.
    merge("opens_app", opener ? true : local || reader || simpleWriter ? false : null);
    merge("uses_credentials", local && !/secret|token|passw|cred|api.?key|\.env|keychain|\.ssh|\.aws/i.test(text) ? false : null);
  }
  if (effects.writes || result.writes_file === null && provenWrite(text)) result.writes_file = true;
  return result;
}
