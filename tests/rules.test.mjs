import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-rules-"));
delete process.env.JEVIS_JEV;
delete process.env.JEVIS_ENABLE;
const { codeDecision, RULES: ALL_RULES } = await import("../src/rules.mjs");
// Tool-input rules; claim_contradicted reads Stop state and has its own test.
const RULES = ALL_RULES.filter((r) => r !== "claim_contradicted");
const { evaluate, unlessKey } = await import("../src/engine.mjs");
const { HEDGES, setJevTransport } = await import("../src/jev.mjs");
const { tune } = await import("../src/tune.mjs");
const { exportDataset } = await import("../src/export.mjs");
const { inputMarks, toolInput } = await import("../src/context.mjs");
const { loadWiki, parseEntry, validateEntry, WIKI_ROOT } = await import("../src/wiki.mjs");

const bash = (input) => ({ tool: "Bash", input, request: "fix the bug" });
const write = (content, path = "index.html", request = "build the page") => ({ tool: "Write", input: toolInput("Write", { file_path: path, content }), request });

for (const command of [
  "git reset --hard HEAD~2", "git -C /repo reset --hard", "git clean -fd", "git clean -fdx && npm test",
  "git push --force origin main", "git push -f origin feature/x", "git push --force-with-lease origin main",
  "git push --force-with-lease origin HEAD:refs/heads/master", "git push origin +HEAD:main",
  "git checkout -- .", "git checkout -- src/a.ts", "git restore .", "git restore --staged --worktree .",
  "git checkout -f feature/x", "git switch --discard-changes main",
  "git branch -D feature/x", "git branch --delete --force feature/x", "git branch -df feature/x", "git stash drop", "git stash clear",
]) test(`code destructive_git: ${command}`, () => assert.equal(codeDecision("destructive_git", bash(command)), true));

for (const command of [
  "git clean -ndf", "git clean --dry-run -fd",
  "git push origin main", "git push --force --dry-run origin main",
  "git switch feature/x", "git restore --staged .", "git restore -S .",
  "git branch -d feature/x", "git branch --list -- '-D'", "git stash", "git stash pop",
  "git add src/a.ts && git commit -m 'fix: guard null' && git push origin main",
  "echo 'git reset --hard'", "printf '%s' 'git clean -fd'", "git reset --help --hard",
]) test(`code destructive_git near miss: ${command}`, () => assert.equal(codeDecision("destructive_git", bash(command)), false));

test("code destructive_git: unknown shell syntax and published-history judgments stay on Jev", () => {
  for (const command of ["git clean -d", "git reset --hard $REF", "git reset --soft HEAD~2", "git reset --mixed HEAD", "git checkout feature/x", "git checkout HEAD~2 src/a.ts", "git commit --amend", "git clean -fd -e '*'", "git rebase origin/main", "git filter-branch --all", "git push --delete origin main", "git push --force-with-lease", "git push --force-with-lease origin feature/x", "sudo git reset --hard", "git -c alias.wipe='reset --hard' wipe", "node delete-history.js", "git reset --hard…", "false && git reset --hard", "exit 0; git reset --hard"]) {
    assert.equal(codeDecision("destructive_git", bash(command)), null, command);
  }
});

test("code em_dash_copy: literal visible prose and accessible labels", () => {
  for (const text of ["<p>Classes — all clay included.</p>", '<img alt="Hands — shaping clay"/>', '<button aria-label="Next — booking">Next</button>']) {
    assert.equal(codeDecision("em_dash_copy", write(text)), true, text);
  }
});
test("code em_dash_copy: en dash, lone placeholder, comments, tests, docs and removed lines", () => {
  for (const state of [write("<p>Monday – Friday</p>"), write("<td>{selected ? percent(weight) : '—'}</td>"), write("// Retry — gateway drops requests.", "src/api.ts"), write("<!-- copy — example -->"), write("<p>Copy — example</p>", "tests/page.test.tsx"), write("Our API — a guide", "docs/api.md")]) {
    assert.equal(codeDecision("em_dash_copy", state), false, state.input);
  }
  const input = toolInput("apply_patch", { input: "*** Begin Patch\n*** Update File: index.html\n@@\n-<p>Old — copy</p>\n+<p>New copy</p>\n*** End Patch" });
  assert.equal(codeDecision("em_dash_copy", { tool: "apply_patch", input }), null, "an update patch loses surrounding lexical context");
});
test("code em_dash_copy: i18n and expression prose need Jev, never guess their role", () => {
  assert.equal(codeDecision("em_dash_copy", write('export const copy = "Clay — classes";', "copy.ts")), null);
  assert.equal(codeDecision("em_dash_copy", write('<p>{"Clay — classes"}</p>')), null);
  assert.equal(codeDecision("em_dash_copy", write('<p>{"—" + " today"}</p>')), null);
  assert.equal(codeDecision("em_dash_copy", write('<td>—</td>')), false);
});

test("code gradient_text: same class attribute or same CSS declaration block", () => {
  for (const state of [
    write('<h1 className="bg-gradient-to-r from-blue-600 to-cyan-400 bg-clip-text text-transparent">Invoicing</h1>', "src/Hero.tsx"),
    write('<h1 style="background:linear-gradient(90deg,red,blue);-webkit-background-clip:text;color:transparent">Title</h1>'),
    write("h1 { background-image: linear-gradient(90deg, red, blue); background-clip: text; color: transparent; }", "style.css"),
  ]) assert.equal(codeDecision("gradient_text", state), true, state.input);
});
test("code gradient_text: separate selectors, solid color, comments, strings, tests, docs, removals", () => {
  for (const state of [
    write("h1 { background-clip:text; } body { background:linear-gradient(red,blue); }", "style.css"),
    write('<h1 className="bg-clip-text text-transparent bg-red-600">Title</h1>'),
    write('<div>{"<h1 className=\"bg-gradient-to-r bg-clip-text text-transparent\">demo</h1>"}</div>'),
    write('<div data-example=\'className="bg-gradient-to-r bg-clip-text text-transparent"\'>Example</div>'),
    write('<h1 class="not-bg-clip-text not-text-transparent not-bg-gradient-to-r">Title</h1>'),
    write("h1 {background:linear-gradient(red,blue);background-clip:text;background:red}", "style.css"),
    write("h1 {background-clip:text;background:linear-gradient(red,blue)}", "style.css"),
    write('<h1 style="background:linear-gradient(red,blue);background-clip:text;background:red">Title</h1>'),
  ]) assert.equal(codeDecision("gradient_text", state), null, state.input);
  for (const state of [write("/* background-clip:text; background:linear-gradient(red,blue) */", "style.css"), write("background-clip:text", "wiki/pattern.md"), write('<h1 className="bg-clip-text text-transparent bg-gradient-to-r">demo</h1>', "src/Hero.test.tsx"), write('<h1 className="text-red-600">Title</h1>')]) {
    assert.equal(codeDecision("gradient_text", state), false, state.input);
  }
});

test("code emoji_icons: standalone emoji marker immediately before a heading", () => {
  assert.equal(codeDecision("emoji_icons", write('<li><span>🚀</span><h3>Fast invoices</h3></li>', "Features.jsx")), true);
});
test("code emoji_icons: user emoji, messages, ordinary text, comments and doc examples aren't exact icons", () => {
  for (const state of [write('<span>🚀</span><h3>Fast</h3>', "Features.jsx", "use this text: 🚀 Fast"), write('<span>👍</span><h3>Message</h3>', "Message.tsx", "show chat messages"), write("<p>Have a nice day 🚀</p>"), write('<span>{"<span>🚀</span><h3>Fast</h3>"}</span>')]) {
    assert.equal(codeDecision("emoji_icons", state), null, state.input);
  }
  assert.equal(codeDecision("emoji_icons", write('<div title="<span>🚀</span><h3>Fast</h3>">Example</div>')), null);
  for (const state of [write("<!-- 🚀 feature icon -->"), write("🚀 Fast", "docs/examples.md"), write("<h3>Fast</h3>")]) assert.equal(codeDecision("emoji_icons", state), false);
});

test("code rules: shell writes, clipped edits, malformed shapes fall back; thrown rules ask Jev", () => {
  for (const name of RULES.filter((r) => r !== "destructive_git")) {
    const input = "<p>Fast — 🚀</p><h1 class='bg-clip-text text-transparent bg-gradient-to-r'>Title</h1>";
    assert.equal(codeDecision(name, bash(`cat > index.html <<'EOF'\n${input}\nEOF`)), null);
    assert.equal(codeDecision(name, { tool: "Edit", input: "Edit index.html\n" + input + "…" }), null);
    assert.equal(codeDecision(name, { get input() { throw new Error("broken rule input"); } }), null);
  }
});

test("code destructive_git: every unsupported option and history form goes to Jev", () => {
  for (const input of [
    "git push --force -onotification origin main", "git clean -n --no-dry-run -fd",
    "git restore --pathspec-from-file=paths.txt", "git push origin :main",
    "git branch -f main HEAD~2", "git branch --force main HEAD~2", "git update-ref refs/heads/main HEAD~2",
    "git reflog expire --expire=now --all", "git gc --prune=now", "git push -ofoo origin main",
    "git push -o notification origin main", "git push --push-option notification origin main",
    "git push --push-option=notification --force origin main", "git push --force -o notification origin main",
    "git push --force --no-force origin main", "git push --force --mystery origin main",
    "git clean -fd --no-force", "git clean -fd --exclude=keep", "git restore --pathspec-from-file paths.txt",
    "git restore -S --source=HEAD~2 .", "git switch --force --unknown main", "git branch -D --unknown feature",
    "git add --unknown .", "git commit --unknown", "git stash pop --unknown", "git fetch --unknown",
    "git -C * reset --hard", "git -C --no-pager reset --hard", "git push --force-with-lease=main origin main",
    "git push --dry-run origin :main", "git push", "git push origin", "git push 'ext::git reset --hard' main", "git reset --hard && git push --mystery", "git -C", "git", "", "printf -v value '%s' 'git reset --hard'",
  ]) assert.equal(codeDecision("destructive_git", bash(input)), null, input);
  for (const input of ["git push origin main", "git clean -nfd", "git restore --staged -- .", "git branch new-feature HEAD", "git branch --list", "git commit -m '--amend'", "git commit --message='--amend'", "git commit -mfix"]) {
    assert.equal(codeDecision("destructive_git", bash(input)), false, input);
  }
});

test("code rules: errors in every rule defer to Jev, not a false score", () => {
  for (const name of RULES) assert.equal(codeDecision(name, { tool: "Bash", get input() { throw new Error("broken"); } }), null);
});

test("code edit rules: fragments never prove their surrounding lexical context", () => {
  const examples = ["<p>One — two</p>", '<h1 class="bg-gradient-to-r bg-clip-text text-transparent">One</h1>', "<span>🚀</span><h3>Fast</h3>"];
  for (const [i, name] of RULES.slice(1).entries()) {
    const content = examples[i];
    for (const tool of ["Edit", "MultiEdit"]) {
      const input = toolInput(tool, { file_path: "src/Page.tsx", new_string: content });
      assert.equal(codeDecision(name, { tool, input }), null, `${name} ${tool}`);
    }
    for (const context of ["/*\nexample\n*/", "const example = `\nexample\n`;"]) {
      const patch = `*** Begin Patch\n*** Update File: src/Page.tsx\n@@\n ${context.split("\n")[0]}\n+${content}\n ${context.split("\n").at(-1)}\n*** End Patch`;
      assert.equal(codeDecision(name, { tool: "apply_patch", input: toolInput("apply_patch", { input: patch }) }), null, `${name} ${context}`);
      assert.equal(codeDecision(name, write(context.replace("example", content), "src/Page.tsx")), context.startsWith("/*") ? false : null);
    }
    assert.equal(codeDecision(name, { tool: "Edit", input: toolInput("Edit", { file_path: "src/Page.tsx", new_string: "<p>Plain copy</p>" }) }), null);
    const add = `*** Begin Patch\n*** Add File: page.html\n+${content}\n*** End Patch`;
    assert.equal(codeDecision(name, { tool: "apply_patch", input: toolInput("apply_patch", { input: add }) }), true, `${name} complete new file`);
  }
});

test("code gradient_text: opaque fills and mismatched conditions stay with Jev", () => {
  for (const body of [
    "h1{background:linear-gradient(red,blue);background-clip:text;color:black}",
    "h1{background:linear-gradient(red,blue);background-clip:text}",
    "h1{background:linear-gradient(red,blue);background-clip:text;color:transparent;-webkit-text-fill-color:black}",
    "h1{background:linear-gradient(red,blue);background-clip:text;color:transparent;color:black}",
  ]) assert.equal(codeDecision("gradient_text", write(body, "style.css")), null, body);
  for (const cls of ["md:bg-gradient-to-r md:bg-clip-text max-md:text-transparent", "md:bg-gradient-to-r bg-clip-text text-transparent", "bg-gradient-to-r bg-clip-text text-black", "bg-gradient-to-r bg-clip-text text-transparent text-black", "md:bg-gradient-to-r md:bg-clip-text md:text-transparent md:text-red-600"]) {
    assert.equal(codeDecision("gradient_text", write(`<h1 class="${cls}">Title</h1>`)), null, cls);
  }
  assert.equal(codeDecision("gradient_text", write('<h1 style="background:linear-gradient(red,blue);background-clip:text;color:black">Title</h1>')), null);
  for (const cls of ["bg-gradient-to-r bg-clip-text text-transparent", "md:bg-gradient-to-r md:bg-clip-text md:text-transparent"]) {
    assert.equal(codeDecision("gradient_text", write(`<h1 class="${cls}">Title</h1>`)), true, cls);
  }
  assert.equal(codeDecision("gradient_text", write("h1{background:linear-gradient(red,blue);background-clip:text;-webkit-text-fill-color:transparent;color:black}", "style.css")), true);
});

test("code em_dash_copy: markdown and text may be product copy; only known dev docs are excluded", () => {
  for (const path of ["content/home.md", "home.txt", "src/copy.md", "docs/../content/home.md"]) assert.equal(codeDecision("em_dash_copy", write("# Great service — today", path)), null, path);
  for (const path of ["README.md", "CHANGELOG.md", "docs/api.md", "CONTRIBUTING.txt"]) assert.equal(codeDecision("em_dash_copy", write("# API — guide", path)), false, path);
  assert.equal(codeDecision("em_dash_copy", write("# Great service today", "content/home.md")), false);
});

const wiki = loadWiki([WIKI_ROOT]);
const entry = (id) => wiki.entries.find((e) => e.id === id);
const run = (state, entries, opts = {}) => evaluate({ event: "tool", state, tool: state.tool, wiki: { entries }, record: false, ...opts });
let calls = [];
const transport = (permission = 0.1) => setJevTransport(async (body) => {
  calls.push(body);
  return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key.endsWith("#unless") ? permission : 0.1 }])) };
});

test("engine code: false rules don't ask Jev, even with axes enabled", async () => {
  calls = []; transport();
  const r = await run(write("<p>Clay classes</p>"), [entry("slop/gradient-text"), entry("slop/emoji-icons")]);
  assert.equal(r.jevQuestions, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(r.code, { "slop/gradient-text": false, "slop/emoji-icons": false });
});
test("engine: prompt/stop profiles still reach Jev without wiki candidates", async () => {
  calls = []; transport();
  for (const event of ["prompt", "stop"]) {
    const r = await evaluate({ event, state: {}, wiki: { entries: [] }, record: false });
    assert.ok(r.jevQuestions > 0);
    assert.ok(Object.keys(r.profile).length > 0);
  }
  assert.equal(calls.length, 2);
});
test("engine code: positive context rule with no exception or axis gate needs no Jev", async () => {
  calls = []; transport();
  const e = { ...entry("slop/em-dash-copy"), action: "context", unless: undefined };
  const r = await run(write("<p>Clay — classes</p>"), [e]);
  assert.equal(calls.length, 0);
  assert.equal(r.jevQuestions, 0);
  assert.equal(r.fired.length, 1);
});
test("engine code: an axis gate still needs its model answer", async () => {
  calls = []; transport();
  const e = { ...entry("slop/em-dash-copy"), action: "context", unless: undefined, when: { destructive: ">=0.8" } };
  const r = await run(write("<p>Clay — classes</p>"), [e]);
  assert.deepEqual(Object.keys(calls[0].questions), ["axis.destructive"]);
  assert.equal(r.fired.length, 0);
});
test("engine code: exact positive asks only permission, which can stand it down", async () => {
  for (const permission of [0.1, 0.9]) {
    calls = []; transport(permission);
    const r = await run(write("<p>Clay — classes</p>"), [entry("slop/em-dash-copy")], { axes: false });
    assert.equal(calls.length, 1);
    assert.equal(r.scores["slop/em-dash-copy"], 1);
    assert.deepEqual(Object.keys(calls[0].questions), [unlessKey("slop/em-dash-copy")]);
    assert.equal(r.fired.length, permission < 0.5 ? 1 : 0);
  }
});
test("engine code: safety respects opt-in and explicit destructive permission", async () => {
  process.env.JEVIS_ENABLE = "all";
  for (const permission of [0.1, 0.9]) {
    calls = []; transport(permission);
    const r = await run(bash("git clean -fd"), [entry("safety/force-push")], { axes: false });
    assert.equal(calls.length, 1);
    assert.equal(r.code["safety/force-push"], true);
    assert.deepEqual(Object.keys(calls[0].questions), [unlessKey("safety/force-push")]);
    assert.equal(r.fired.length, permission < 0.5 ? 1 : 0);
  }
  delete process.env.JEVIS_ENABLE;
  assert.equal((await run(bash("git clean -fd"), [entry("safety/force-push")])).skipped, "no entries");
});
test("engine code: ambiguous input asks only main below min; failures/missing exceptions fail open", async () => {
  calls = []; transport();
  const e = entry("slop/gradient-text");
  const state = write('className="bg-clip-text text-transparent bg-gradient-to-r"', "Hero.tsx");
  const r = await run(state, [e], { axes: false });
  assert.equal(r.code[e.id], undefined);
  assert.deepEqual(Object.keys(calls[0].questions), [e.id]);
  assert.equal(calls.length, 1);
  setJevTransport(async () => { throw new Error("server unavailable"); });
  const unavailable = await run(write("<p>Clay — classes</p>"), [entry("slop/em-dash-copy")]);
  assert.equal(unavailable.fired.length, 0);
  assert.match(unavailable.error, /server unavailable/);
  setJevTransport(async () => ({ answers: {} }));
  assert.equal((await run(write("<p>Clay — classes</p>"), [entry("slop/em-dash-copy")])).fired.length, 0);
});

test("hedging: only one tail request at 1000 ms", () => {
  assert.deepEqual(HEDGES, [1000]);
});

test("slop gates: neither Bash reads nor proven writes ask slop questions; file edits do", async () => {
  for (const [input, writes] of [["git log --oneline | head -5", null], ["cd x && ls | head", false], ["cat > index.html <<'EOF'\n<h1 class=\"bg-clip-text text-transparent bg-gradient-to-r\">Hi</h1>\nEOF", true]]) {
    assert.equal(inputMarks(input, { tool: "Bash" }).writes_file, writes, input);
    calls = []; transport();
    const r = await run(bash(input), wiki.entries);
    assert.ok(!calls.some((body) => Object.keys(body.questions).some((key) => key.startsWith("slop/"))), input);
    assert.ok(!r.fired.some((e) => e.id.startsWith("slop/")), input);
  }
  calls = []; transport();
  await run(write('<h1 class="bg-clip-text text-transparent bg-gradient-to-r">Hi</h1>'), wiki.entries);
  assert.ok(calls.some((body) => Object.keys(body.questions).some((key) => key.startsWith("slop/"))));
});

test("Bash writes_file: unparsed commands with a proven write still count as writes", () => {
  const marks = (input) => inputMarks(input, { tool: "Bash" }).writes_file;
  for (const input of [
    "cat > a.html <<EOF\n<h1>$TITLE</h1>\nEOF",
    "cat <<EOF > a.html\nx\nEOF",
    "cd /x && python3 - <<'EOF'\np='a.tsx'; s=open(p).read()\nopen(p, 'w').write(s.replace('a', 'b'))\nEOF",
    "python3 - <<'PY'\nfrom pathlib import Path\nPath('a.css').write_text('x')\nPY",
    "node - <<'EOF'\nrequire('fs').writeFileSync('a.html', '<b>x</b>')\nEOF",
  ]) assert.equal(marks(input), true, input);
  for (const input of [
    "cd x && git log --oneline | head -5 2>/dev/null",
    "python3 - <<'EOF'\nprint(open('a.txt').read())\nEOF",
    "cat <<EOF | wc -l\n<div><p>x</p></div>\nEOF",
    "npm test 2>&1 | tail -5",
    "npx eslint src $(cat list) > /tmp/eslint.log 2>&1",
    "python3 - <<'PY'\nimport sys; sys.stdout.write(open('data.json').read())\nPY",
    "python3 - <<'PY'\nopen('/tmp/out.json', 'w').write('{}')\nPY",
  ]) assert.notEqual(marks(input), true, input);
});

test("engine model: only qualifying main answers get a second, exception-only call", async () => {
  const e = { ...entry("slop/gradient-text"), decide: undefined };
  const state = write("<h1>Hi</h1>");
  for (const score of [0.1, e.min, 0.95]) {
    calls = [];
    setJevTransport(async (body) => {
      calls.push(body);
      return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? score : 0.1 }])) };
    });
    const r = await run(state, [e]);
    assert.ok(e.id in calls[0].questions);
    assert.ok(!(unlessKey(e.id) in calls[0].questions));
    assert.equal(calls.length, score >= e.min ? 2 : 1);
    assert.equal(r.fired.length, score >= e.min ? 1 : 0);
    assert.equal(r.jevQuestions, calls.reduce((n, body) => n + Object.keys(body.questions).length, 0));
    if (score >= e.min) {
      assert.deepEqual(Object.keys(calls[1].questions), [unlessKey(e.id)]);
      assert.deepEqual(calls[1].state, calls[0].state);
    }
  }
});

test("engine model: a failed when gate avoids the exception call", async () => {
  const e = { ...entry("slop/gradient-text"), decide: undefined, when: { destructive: ">=0.8" } };
  calls = [];
  setJevTransport(async (body) => {
    calls.push(body);
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? 0.95 : 0.1 }])) };
  });
  const r = await run(write("<h1>Hi</h1>"), [e]);
  assert.equal(calls.length, 1);
  assert.equal(r.fired.length, 0);
});

test("engine model: failed, timed-out or missing exceptions fail open without losing other fires", async () => {
  const e = { ...entry("slop/gradient-text"), decide: undefined };
  const other = { ...e, id: "test/no-exception", unless: undefined, action: "context" };
  for (const failure of [new Error("server unavailable"), Object.assign(new Error("slow"), { name: "TimeoutError" }), null]) {
    calls = [];
    setJevTransport(async (body) => {
      calls.push(body);
      if (calls.length === 2) {
        if (failure) throw failure;
        return { answers: {} };
      }
      return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: 0.95 }])) };
    });
    const r = await run(write("<h1>Hi</h1>"), [e, other], { axes: false });
    assert.equal(calls.length, 2);
    assert.deepEqual(r.fired.map((e) => e.id), [other.id]);
    assert.equal(r.error, undefined);
    assert.equal(r.jevQuestions, 3);
  }
});

test("engine model: both phases share the timeout budget and total timing", async () => {
  const e = { ...entry("slop/gradient-text"), decide: undefined };
  const budgets = [];
  setJevTransport(async (body, timeoutMs) => {
    budgets.push(timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { answers: Object.fromEntries(Object.keys(body.questions).map((key) => [key, { noul: key === e.id ? 0.95 : 0.1 }])) };
  });
  const r = await run(write("<h1>Hi</h1>"), [e], { axes: false, timeoutMs: 500 });
  assert.equal(budgets.length, 2);
  assert.ok(budgets[1] >= 1 && budgets[1] <= budgets[0] - 15, JSON.stringify(budgets));
  assert.ok(r.ms >= 30, `total timing: ${r.ms}`);
  assert.equal(r.fired.length, 1);
});
test("wiki decide: opt-in whitelist is validated and ask/unless stay required", () => {
  assert.deepEqual(wiki.broken, []);
  const e = parseEntry("---\nevent: tool\nask: Does `input` write a gradient?\nunless: Does `request` ask for it?\ndecide: gradient_text\naction: deny\ntitle: Gradient\nsource: tests\n---\nUse solid text.\n", "test/gradient");
  assert.deepEqual(validateEntry(e), []);
  assert.ok(validateEntry({ ...e, decide: "user_javascript" }).some((s) => /decide/.test(s)));
  assert.ok(validateEntry({ ...e, unless: undefined }).some((s) => /unless/.test(s)));
});
test("stats: historical probabilities aren't treated as scores for exact code decisions", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevis-rules-stats-"));
  const qdir = join(dir, "questions");
  mkdirSync(qdir);
  const e = entry("slop/em-dash-copy");
  const questions = { [e.id]: { type: "noul", instructions: e.ask, criteria: { true: e.yes, false: e.no } }, [unlessKey(e.id)]: { type: "noul", instructions: e.unless } };
  writeFileSync(join(qdir, "old.json"), JSON.stringify(questions));
  const file = join(dir, "calls.jsonl");
  const rows = [write("<p>Clay — classes</p>"), write('export const copy = "Clay — classes";', "copy.ts")].map((state) => ({ event: "tool", at: new Date().toISOString(), version: "old", state, answers: { [e.id]: 0.95, [unlessKey(e.id)]: 0.1 } }));
  writeFileSync(file, rows.map(JSON.stringify).join("\n") + "\n");
  const row = tune([e], { file, questionsDir: qdir }).entries[0];
  assert.equal(row.asked, 1, "only the ambiguous i18n input is still judged by Jev");
  assert.equal(row.fires, 1);
});
test("records: code scores never enter Jev answers or exported training labels", async () => {
  calls = []; transport();
  const e = entry("slop/em-dash-copy");
  await run(write("<p>Clay — classes</p>"), [e], { record: true, axes: false });
  const record = JSON.parse(readFileSync(join(process.env.JEVIS_HOME, "jev", "calls.jsonl"), "utf8").trim().split("\n").at(-1));
  assert.equal(record.answers[e.id], undefined);
  assert.equal(record.answers[unlessKey(e.id)], 0.1);
  const questions = JSON.parse(readFileSync(join(process.env.JEVIS_HOME, "jev", "questions", `${record.version}.json`), "utf8"));
  assert.deepEqual(Object.keys(questions), [unlessKey(e.id)]);
  const exported = exportDataset({ out: join(process.env.JEVIS_HOME, "export"), testShare: 0 });
  const row = JSON.parse(gunzipSync(readFileSync(exported.files.train)).toString().trim());
  assert.deepEqual(Object.keys(JSON.parse(row.gold)), [unlessKey(e.id)]);
  assert.deepEqual(Object.keys(JSON.parse(row.questions)), [unlessKey(e.id)]);
});

test("claim_contradicted: a pass claim against a failed latest check, decided by code alone", async () => {
  const stop = (final_message, checks) => ({ final_message, evidence: { edited: true, checks_after_last_edit: checks } });
  const failed = [{ command: "npm test", success: false, exit_code: 1 }];
  const fixed = [{ command: "npm test", success: false, exit_code: 1 }, { command: "npm test", success: true, exit_code: 0 }];
  const mixed = [{ command: "npm test", success: true, exit_code: 0 }, { command: "npm run lint", success: false, exit_code: 2 }];
  const unknown = [{ command: "npm test", success: null, exit_code: null }];
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", failed)), true);
  assert.equal(codeDecision("claim_contradicted", stop("Fixed it.\nThe build is green and lint is clean.", mixed)), true);
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", fixed)), false, "a later passing run of the same check wins");
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", unknown)), false, "no recorded result proves nothing");
  assert.equal(codeDecision("claim_contradicted", stop("Done. All tests pass.", [])), false);
  for (const msg of ["2 tests fail; the rest pass.", "Tests did not pass yet.", "Unit tests pass but lint fails.", "The build isn't green.", "> CI passed, they said", "Done. Rewrote the button."]) {
    assert.equal(codeDecision("claim_contradicted", stop(msg, failed)), false, msg);
  }
  const entry = (await import("../src/wiki.mjs")).loadWiki().entries.find((e) => e.id === "verification/claim-contradicted");
  assert.ok(entry, "shipped as a stop lesson");
  let sent = 0;
  setJevTransport(async () => { sent += 1; return { answers: {} }; });
  try {
    const r = await evaluate({ event: "stop", state: { request: "fix it", ...stop("All tests pass.", failed) }, wiki: { entries: [entry] }, codeOnly: true, axes: false });
    assert.deepEqual(r.fired.map((e) => e.id), [entry.id]);
    const quiet = await evaluate({ event: "stop", state: { request: "fix it", ...stop("All tests pass.", fixed) }, wiki: { entries: [entry] }, codeOnly: true, axes: false });
    assert.equal(quiet.fired.length, 0);
    assert.equal(sent, 0, "never asks the decision model");
  } finally {
    setJevTransport(null);
  }
});
