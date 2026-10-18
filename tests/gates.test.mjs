import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASH_FACTS } from "../src/bash-facts.mjs";
import { inputMarks } from "../src/context.mjs";
import { evaluate } from "../src/engine.mjs";
import { formatGateReplay, gateReplay } from "../src/gate-replay.mjs";
import { setJevTransport } from "../src/jev.mjs";
import { conditionsHold, factsHold, loadWiki, WIKI_ROOT } from "../src/wiki.mjs";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-gates-"));
for (const key of ["JEVIS_ENABLE", "JEVIS_WIKI", "JEVIS_JEV"]) delete process.env[key];
const marks = (text) => inputMarks(text, { tool: "Bash" });
const wiki = loadWiki([WIKI_ROOT]);

test("Bash facts: git writes, tests/builds and openers, not substrings in read data", () => {
  for (const text of ["git commit -m feat", "git -C repo push origin main", "git tag v1", "git merge feat", "git rebase main", "git reset --hard HEAD"]) assert.equal(marks(text).git_write, true, text);
  for (const text of ["git log --oneline", "git tag --list 'v*'", "echo 'git commit -m x'", "mkdir commit"]) assert.equal(marks(text).git_write, false, text);
  for (const text of ["npm test", "npm run build", "pnpm test:unit", "yarn lint", "npx vitest run", "node --test tests/a.mjs", "pytest tests/", "cargo test", "go test ./..."]) assert.equal(marks(text).runs_tests, true, text);
  for (const text of ["echo npm test", "mkdir build", "cat test-results.txt"]) assert.equal(marks(text).runs_tests, false, text);
  for (const text of ["open -a Safari", "say done", "afplay a.wav", "osascript -e 'beep'", "ffplay a.mp4"]) assert.equal(marks(text).opens_app, true, text);
  for (const text of ["echo open Safari", "mkdir osascript", "cat ffplay-output.txt"]) assert.equal(marks(text).opens_app, false, text);
  assert.equal(marks("chromedriver --version").opens_app, null, "a driver can raise a Gatekeeper window");
});

test("Bash facts: writes, quoting, redirects, heredocs and near misses", () => {
  for (const text of ["echo x > out", "echo x >> out", "echo x 2>error.log", "echo x &> out", "echo x > 'a b.txt'", "echo x > /dev/null >> out", "printf x | tee out", "sed -i 's/a/b/' f", "sed --in-place=.bak 's/a/b/' f", "cp a b", "mv a b", "install a b", "cat <<'EOF' > out\nhello\nEOF\n", "cat > out <<'EOF'\nhello\nEOF\n"]) assert.equal(marks(text).writes_file, true, text);
  for (const text of ["echo x > /dev/null", "echo x 2>&1", "echo x >&2", "echo 'x > file'", "sed -n 1,80p file", "cat < file", "mkdir output"]) assert.equal(marks(text).writes_file, false, text);
  assert.equal(marks("echo x >/dev/null'out'").writes_file, null, "concatenated targets are not /dev/null");
  assert.equal(marks("install --strip-program=unseen a b").opens_app, null);
  assert.equal(marks("install --strip-program=unseen a b").git_write, null);
  assert.equal(marks(`osascript -e 'do shell script "git commit -m x"'`).git_write, null);
  assert.equal(marks(`osascript -e 'do shell script "npm test"'`).runs_tests, null);
  assert.equal(marks("git commit -m x").runs_tests, null, "git hooks can run tests");
  assert.equal(marks("mkdir a && mkdir b;").git_write, false, "a valid chain may end with a semicolon");
});

test("Bash facts: unknown effects keep gates open except strict writes_file", () => {
  for (const text of ["echo 'unfinished", "echo $(unseen)", "echo x > $OUT", "echo x > /dev/null$(unseen)", "git commit…", "ls\\", "cat <<EOF\nx\nEOF\n", "ls <(unseen)", "(git commit)", "mkdir x |", "mkdir x &&", "|| mkdir x", "mkdir x && && rm x"]) {
    const result = marks(text);
    for (const key of BASH_FACTS) assert.equal(result[key], null, `${key}: ${text}`);
    for (const key of BASH_FACTS) {
      assert.equal(factsHold({ [`marks.${key}`]: true }, { event: "tool", state: { marks: result } }), key !== "writes_file");
      assert.equal(conditionsHold({ [`marks.${key}`]: true }, { profile: {}, state: { marks: result } }), key !== "writes_file");
    }
  }
  for (const text of ["sudo git commit -m x", "git alias-that-commits", "node a-script.mjs", "python3 script.py", "npm run custom", "eval 'git commit -m x'"]) assert.equal(marks(text).git_write, null, text);
  assert.equal(marks("cat secret.txt").uses_credentials, null);
  assert.equal(marks("mkdir -p output").uses_credentials, false);
  assert.equal(marks("mkdir ~/.ssh").uses_credentials, null);
  assert.equal(marks("echo x…").em_dash, null);
  assert.equal(inputMarks("Write a.css\nx", { tool: "Write" }).writes_file, true, "Bash-specific gates do not filter edit tools");
  assert.equal(factsHold({ "evidence.edited": true }, { event: "stop", state: {} }), false, "ordinary missing facts stay strict");
});

test("Bash gates: empty pool makes no Jev call; sensitive/unknown code still gets judged", async () => {
  let calls = 0;
  setJevTransport(async (body) => { calls++; return { answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { noul: 0.05 }])) }; });
  const judge = (input) => evaluate({ event: "tool", state: { input }, tool: "Bash", wiki, record: false });
  assert.equal((await judge("mkdir -p build")).skipped, "no entries");
  assert.equal(calls, 0);
  await judge("python3 script.py");
  assert.equal(calls, 1);
  await judge("cat .env");
  assert.equal(calls, 2);
  process.env.JEVIS_ENABLE = "safety";
  try {
    await judge("rm -rf user-data");
    assert.equal(calls, 3, "destructive safety lessons retain model review");
  } finally { delete process.env.JEVIS_ENABLE; }
});

test("gate replay: clipped inputs are unknown, optional fires audited and time reconciled", () => {
  const file = join(process.env.JEVIS_HOME, "replay.jsonl");
  const row = (input, more = {}) => ({ event: "tool", tool: "Bash", input, ms: 500, ...more });
  writeFileSync(file, [row("mkdir -p output"), row("cat .env", { fired: [{ id: "safety/borrowed-credentials" }], acted: ["safety/borrowed-credentials"] }), row("git reset --hard HEAD", { fired: [{ id: "safety/force-push" }] }), row("cat > x <<'EOF'…", { fired: [{ id: "slop/em-dash-copy" }] }), row("ls", { skipped: "no entries" }), { event: "prompt" }].map(JSON.stringify).join("\n") + "\n");
  const r = gateReplay({ file, wiki, recover: null });
  assert.equal(r.judged, 4);
  assert.equal(r.clipped, 1);
  assert.equal(r.assessable, 3);
  assert.equal(r.unauditable, 1);
  assert.equal(r.assessableFires, 2);
  assert.equal(r.unauditableFires, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.skipPercent, 25);
  assert.equal(r.savedMs, 500);
  assert.equal(r.lostFires, 0);
  assert.match(formatGateReplay(r), /Would skip: 1\/4 \(25% overall/);
  assert.match(formatGateReplay(r), /Lost fires: 0/);
  const tightened = { entries: wiki.entries.map((e) => e.id === "safety/borrowed-credentials" ? { ...e, when: { "marks.writes_file": true } } : e) };
  assert.equal(gateReplay({ file, wiki: tightened, recover: null }).lostFires, 1, "the report catches a real lost fire without double-counting acted");
});

test("Bash facts: program-executing abbreviations and all unknown options never prove a negative", () => {
  for (const text of [
    "install -s --strip-prog=sh a.sh b.sh", "install -s --strip-program sh a b", "install --strip-p=sh a b",
    "cp --unknown a b", "mv --future a b", "tee --future out", "touch --future out", "truncate --future out",
    "mkdir --future out", "rmdir --future out", "rm --future out", "chmod --future 600 out", "chown --future owner out",
    "kill --future 123", "pkill --future process", "wait --future", "say --future hi", "afplay --future file",
    "open --future file", "osascript --future file", "xdg-open --future file", "ffplay --future file",
    "ls --future", "cat --future file", "head --future file", "tail --future file", "wc --future file",
    "rg --pre=sh text file", "rg --pr=sh text file", "grep --future text file", "sed --future '1p' file",
    "git --future status", "git status --future", "git log --out=file", "git branch --del main",
    "npm --future test", "node --future --test", "install -Z a b", "cat -Z file",
  ]) {
    const result = marks(text);
    for (const key of BASH_FACTS) assert.equal(result[key], null, `${key}: ${text}`);
    assert.equal(result.plain_read, false, text);
    assert.equal(factsHold({ "marks.git_write": true }, { event: "tool", state: { marks: result } }), true, text);
  }
  assert.equal(marks("install -s --strip-prog=sh a b > out").writes_file, true, "a literal redirect remains a proven write");
  assert.equal(marks("mkdir --parents output").git_write, false);
  assert.equal(marks("mkdir --par output").git_write, null, "even harmless abbreviations are not fully recognized");
  assert.equal(marks("cp -- --strip-prog=sh out").git_write, false, "-- makes subsequent words literal operands");
});

test("gate replay: recover full Claude and Codex inputs by session, timestamp and prefix", () => {
  const root = mkdtempSync(join(tmpdir(), "jevis-recovery-"));
  const claude = join(root, "claude"), codex = join(root, "codex");
  mkdirSync(claude); mkdirSync(codex);
  const at = "2000-01-01T00:00:00Z";
  const input = `printf '%s' '${"a".repeat(250)}'`;
  writeFileSync(join(claude, "synthetic-claude.jsonl"), JSON.stringify({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", name: "Bash", input: { command: input } }] } }) + "\n");
  writeFileSync(join(codex, "rollout-synthetic-codex.jsonl"), JSON.stringify({ type: "event_msg", timestamp: at, payload: { type: "item_completed", started_at_ms: Date.parse(at), item: { type: "CommandExecution", command: ["bash", "-lc", input] } } }) + "\n");
  writeFileSync(join(codex, "rollout-synthetic-call.jsonl"), JSON.stringify({ type: "response_item", timestamp: at, payload: { type: "function_call", name: "functions.exec_command", arguments: JSON.stringify({ cmd: input }) } }) + "\n");
  const file = join(root, "log.jsonl");
  const row = (sessionId, extra = {}) => ({ event: "tool", tool: "Bash", sessionId, at, input: input.slice(0, 200) + "…", ms: 100, ...extra });
  writeFileSync(file, [row("synthetic-claude"), row("synthetic-codex"), row("synthetic-call"), row("synthetic-missing", { fired: ["safety/borrowed-credentials"] }), row("synthetic-claude", { at: "2000-01-02T00:00:00Z" })].map(JSON.stringify).join("\n") + "\n");
  const report = gateReplay({ file, wiki, recovery: { roots: [claude, codex] } });
  assert.equal(report.recovered, 3);
  assert.equal(report.assessable, 3);
  assert.equal(report.unauditable, 2);
  assert.equal(report.unauditableFires, 1);
  assert.equal(report.lostFires, 0);
  assert.equal(report.skipped, 3);
  assert.equal(report.skipPercent, 60);
  assert.equal(report.assessableSkipPercent, 100);
  assert.equal(report.savedMs, 300);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-claude|printf|2000-01/);
  // Distinct full commands with the same clipped prefix cannot be guessed.
  const other = input + " && git commit -m hidden";
  writeFileSync(join(claude, "synthetic-claude.jsonl"), [input, other].map((command) => JSON.stringify({ type: "assistant", timestamp: at, message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } })).join("\n") + "\n");
  assert.equal(gateReplay({ file, wiki, recovery: { roots: [claude, codex] } }).recovered, 2);
});

test("gate replay: recovered trailing operations expose losses rather than hiding behind unknown", () => {
  const file = join(process.env.JEVIS_HOME, "recovered-loss.jsonl");
  writeFileSync(file, JSON.stringify({ event: "tool", tool: "Bash", input: "echo…", fired: ["test/git-write"] }) + "\n");
  const wiki = { entries: [{ id: "test/git-write", event: "tool", tools: ["Bash"], when: { "marks.git_write": false } }] };
  const report = gateReplay({ file, wiki, recover: (rows) => new Map([[rows[0], "echo harmless && git commit -m hidden"]]) });
  assert.equal(report.assessable, 1);
  assert.equal(report.assessableFires, 1);
  assert.equal(report.lostFires, 1);
  assert.equal(report.lostRows, 1);
});

test("Bash glyph gate: unseen or generated file contents cannot prove an absent em dash", () => {
  for (const input of ["cp source.html destination.html", "python3 -c 'make_ui_copy()'", "sed -i 's/title/replacement/' ui.html", "printf '\\u2014' > ui.html"]) {
    const result = marks(input);
    assert.equal(result.em_dash, null, input);
    assert.equal(factsHold({ "marks.em_dash": true }, { event: "tool", state: { marks: result } }), true);
  }
  assert.equal(marks("cat source.html").em_dash, false, "proven read cannot write generated copy");
});
