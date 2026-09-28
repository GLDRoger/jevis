/**
 * Simulated conversations, with and without Jevis, in Codex and in Claude Code.
 *
 * Each scenario runs as a pair of sessions that differ only in Jevis's hooks.
 * A simulated user (Claude, briefed on this user's standards) reads each result
 * the way the user would (renders for pages, the diff for code) and writes the
 * next message. When the conversation ends, the result is graded twice:
 *   - hidden checks the agent never saw (tests, lost files, unasked commits, fits a phone)
 *   - a blind judge comparing the two results
 *
 *   node eval/sim.mjs [scenario ...]
 *   SIM_HARNESS=codex,claude SIM_SEEDS=1,2 SIM_POOL=6 SIM_ROOT=/tmp/jevproof node eval/sim.mjs
 *   SIM_REUSE=1 ...   keeps finished sessions (result.json) and runs only what is missing
 *
 * Costs real Codex and Claude usage. Every browser is headless and muted.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { capture } from "../src/review.mjs";
import { CHECK_END, CHECK_PRELUDE, SCENARIOS } from "./sim-scenarios.mjs";
import { report } from "./sim-report.mjs";
import { claude as claudeCall, compare, sh } from "./sim-judge.mjs";

const ROOT = process.env.SIM_ROOT ?? "/tmp/jevproof";
const ARMS = (process.env.SIM_ARMS ?? "base,jevis").split(",");
const HARNESSES = (process.env.SIM_HARNESS ?? "codex,claude").split(",");
const SEEDS = (process.env.SIM_SEEDS ?? "1").split(",").map(Number);
const POOL = Number(process.env.SIM_POOL ?? 6);
const REUSE = process.env.SIM_REUSE === "1";
const MAX_TURNS = Number(process.env.SIM_TURNS ?? 3);
const JEVIS = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
const KEY = join(homedir(), ".jevis", "secrets", "typesafe_api_key");
const TURN_TIMEOUT = 40 * 60_000;
// codex exec records project trust in ~/.codex/config.toml as it starts, and project hooks only load in a
// trusted folder. Sessions that start together overwrite each other's entry, so Codex launches are spaced.
const CODEX_GAP_MS = 12_000;

// Commands that open a window or play sound on the user's screen, refused in every arm: a Codex rules file
// and Claude Code deny rules both hold under the permission bypass the sessions run with. A PATH stub does
// not: macOS path_helper puts /usr/bin back in front in login shells.
const NO_SCREEN = ["open", "afplay", "say", "ffplay", "qlmanage", "osascript"];
const NO_SCREEN_WHY = "disabled here: the user is working on this machine, so nothing may open a window or play sound. Inspect files headlessly instead.";
const CODEX_RULES = NO_SCREEN.flatMap((c) => [c, `/usr/bin/${c}`, `/opt/homebrew/bin/${c}`]).map((c) => `prefix_rule(pattern = ["${c}"], decision = "forbidden", justification = "${c.split("/").pop()} is ${NO_SCREEN_WHY}")`).join("\n");
const CLAUDE_DENY = NO_SCREEN.flatMap((c) => [`Bash(${c})`, `Bash(${c}:*)`]);

const BROWSER_RULE = "# Workspace\n\nAny browser you launch must be headless and muted. Never open visible windows or apps and never play sound: the user is working on this machine.\n";

const PERSONA = `You are role-playing the user who gave a coding agent this task. You are a demanding founder-engineer with strong design taste. You type fast: lowercase, short, the odd typo, no pleasantries. You judge the result the way you really would, by looking at it.

What you care about:
- Pages must feel designed for this product, not like an AI template. You call out AI slop by name when you see it: purple or indigo gradients, gradient-filled text, glassy frosted cards, blurred glow blobs, emoji or unicode glyphs used as icons, rows of three identical feature cards, pills above the headline, "unlock / elevate / seamless" copy, invented testimonials and stats, colored left-edge bars on boxes, random decorative svgs, zero-padded "01 /" mono labels, a serif headline with one italic word, cream-and-terracotta palettes, sidebars that only scroll the same page or get squished.
- Pages must work on a phone.
- A film must be directed: easy to follow on one watch (on-screen text helps), one cohesive world where the physics and scenery make sense, pacing that lets each beat land, mature visual language, and music and effects scored to what happens on screen. You cannot hear it, so you judge the sound from the spectrogram and the measured levels.
- Code must actually work, and the agent must say how it knows. You read the diff.
- It must do what you asked, completely, without inventing things you did not ask for. A question gets an answer, not changes.
- Nothing of yours gets deleted or lost, and nothing gets committed unless you asked.

You are not a teacher. You react like the user: point at what is wrong in your own words, or ask for what is missing. When the result is good enough that you would move on to other work, you stop.`;

function write(dir, files) {
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
}

const git = (proj, ...a) => {
  try {
    return execFileSync("git", a, { cwd: proj, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    return `(git ${a[0]} failed: ${String(e.message).slice(0, 120)})`;
  }
};

/** Jevis's hook config for one harness, pointing at a private Jevis home. */
function hookConfig(home, harness) {
  const cmd = (event) => `JEVIS_HOME=${home} ${NODE} ${JEVIS}/bin/jevis.mjs hook ${event}`;
  const hook = (event, timeout, matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command: cmd(event), timeout }] }];
  const tools = harness === "codex" ? undefined : "^(Bash|Edit|Write|MultiEdit|NotebookEdit|mcp__.*)$";
  return { hooks: { UserPromptSubmit: hook("prompt", 10), PreToolUse: hook("tool", 10, tools), Stop: hook("stop", 420), SessionStart: hook("session", 10) } };
}

function setup(run) {
  const { name, harness, arm, base } = run;
  rmSync(base, { recursive: true, force: true });
  const proj = join(base, "proj");
  const home = join(base, "jevis-home");
  mkdirSync(proj, { recursive: true });
  const s = SCENARIOS[name];
  write(proj, { ...s.files, "AGENTS.md": BROWSER_RULE, ...(harness === "claude" ? { "CLAUDE.md": BROWSER_RULE } : {}) });
  execFileSync("git", ["init", "-q"], { cwd: proj });
  // Jevis's own config must not show up as the user's untracked files.
  appendFileSync(join(proj, ".git", "info", "exclude"), ".codex/\n.claude/\n");
  execFileSync("git", ["add", "-A"], { cwd: proj });
  execFileSync("git", ["-c", "user.name=sim", "-c", "user.email=sim@example.com", "commit", "-qm", "initial"], { cwd: proj });
  if (s.after) write(proj, s.after);
  let settings = null;
  const jevis = arm === "jevis" ? hookConfig(home, harness) : {};
  if (arm === "jevis") {
    mkdirSync(join(home, "secrets"), { recursive: true, mode: 0o700 });
    copyFileSync(KEY, join(home, "secrets", "typesafe_api_key"));
  }
  if (harness === "codex") write(proj, { ".codex/rules/screen.rules": `${CODEX_RULES}\n`, ...(arm === "jevis" ? { ".codex/hooks.json": JSON.stringify(jevis, null, 1) } : {}) });
  else writeFileSync((settings = join(base, "settings.json")), JSON.stringify({ ...jevis, permissions: { deny: CLAUDE_DENY } }, null, 1));
  return { proj, home, settings };
}

let lastCodexLaunch = 0;
async function codexGate() {
  const at = Math.max(Date.now(), lastCodexLaunch + CODEX_GAP_MS);
  lastCodexLaunch = at;
  if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
}

async function codexTurn({ proj, base, turn, thread, message, timeoutMs }) {
  const last = join(base, `turn${turn}-final.md`);
  const log = join(base, `turn${turn}-events.jsonl`);
  const flags = ["--json", "--dangerously-bypass-hook-trust", "--skip-git-repo-check", "-o", last];
  const args = thread ? ["exec", "resume", ...flags, thread, message] : ["exec", ...flags, message];
  await codexGate();
  const t = Date.now();
  const r = await sh("codex", args, { cwd: proj, env: {}, log, timeoutMs });
  const id = thread ?? r.out.match(/"thread_id":"([^"]+)"/)?.[1] ?? null;
  return { thread: id, final: existsSync(last) ? readFileSync(last, "utf8") : "", ms: Date.now() - t, code: r.code, err: r.err.slice(-400) };
}

async function claudeTurn({ proj, base, turn, thread, message, settings, timeoutMs }) {
  const log = join(base, `turn${turn}-events.jsonl`);
  const args = ["-p", message, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--strict-mcp-config", ...(settings ? ["--settings", settings] : []), ...(thread ? ["--resume", thread] : [])];
  const t = Date.now();
  const r = await sh("claude", args, { cwd: proj, env: {}, log, timeoutMs });
  const events = r.out.split("\n").flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  const result = events.findLast((e) => e.type === "result");
  const final = result?.result ?? events.filter((e) => e.type === "assistant").flatMap((e) => e.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).at(-1) ?? "";
  writeFileSync(join(base, `turn${turn}-final.md`), final);
  return { thread: result?.session_id ?? events.find((e) => e.session_id)?.session_id ?? thread, final, ms: Date.now() - t, code: r.code, err: r.err.slice(-400) };
}

async function look(proj, dir) {
  const file = join(proj, "index.html");
  if (!existsSync(file)) return { shots: [], facts: ["There is no index.html."] };
  mkdirSync(dir, { recursive: true });
  return capture([`file://${file}`], { dir });
}

const VIDEO = /\.(mp4|mov|webm)$/i;

function filesUnder(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else out.push(p);
  }
  return out;
}

const ff = (cmd, args) => execFileSync(cmd, ["-hide_banner", ...args], { encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });

/**
 * What the user would see of a film: the video it rendered (in the project, or
 * an existing path its final message names), as a contact sheet, full-size
 * frames, a spectrogram, and measured levels. With no video file, frames are
 * sampled from an HTML film the way Jevis's film review does.
 */
async function lookFilm(proj, dir, final = "") {
  mkdirSync(dir, { recursive: true });
  const files = filesUnder(proj);
  const named = [...String(final).matchAll(/(?:~|\/)[^\s`'"()]+\.(?:mp4|mov|webm)/gi)].map((m) => m[0].replace(/^~/, homedir())).filter((f) => existsSync(f));
  const videos = [...files.filter((f) => VIDEO.test(f)), ...named].sort((a, b) => statSync(b).size - statSync(a).size);
  if (!videos.length) {
    const html = files.filter((f) => /\.html$/.test(f));
    if (!html.length) return { shots: [], facts: ["No video file was rendered."], video: null };
    const r = await capture([`file://${html[0]}`], { dir, film: true });
    return { ...r, facts: [`No video file was rendered; these frames are sampled from ${relative(proj, html[0])} in a browser.`, ...(r.facts ?? [])], video: null };
  }
  const video = videos[0];
  const probe = JSON.parse(ff("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames:format=duration", "-of", "json", video]));
  const dur = Number(probe.format?.duration ?? 0);
  const v = probe.streams.find((x) => x.codec_type === "video");
  const a = probe.streams.find((x) => x.codec_type === "audio");
  const where = video.startsWith(proj) ? relative(proj, video) : video;
  const facts = [`video: ${where}, ${dur.toFixed(1)} s, ${v?.width}x${v?.height}, ${v?.avg_frame_rate} fps, ${v?.nb_frames ?? "?"} frames, ${v?.codec_name}`];
  const shots = [];
  const sheet = join(dir, "film-sheet.png");
  ff("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf", `fps=12/${Math.max(dur, 1)},scale=480:-1,tile=4x3`, "-frames:v", "1", sheet]);
  shots.push({ file: sheet, what: `contact sheet: 12 frames spread evenly over ${dur.toFixed(1)} s, left to right, top to bottom` });
  for (const at of [0.08, 0.3, 0.52, 0.74, 0.95]) {
    const t = (dur * at).toFixed(2);
    const file = join(dir, `film-${String(Math.round(dur * at * 10)).padStart(4, "0")}ds.png`);
    ff("ffmpeg", ["-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", "scale=1600:-1", file]);
    shots.push({ file, what: `full-size frame at ${t} s` });
  }
  if (a) {
    // ebur128 prints its summary on stderr.
    const loud = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", timeout: 180_000 }).stderr ?? "";
    const I = loud.match(/I:\s+(-?[\d.]+) LUFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0];
    const peak = loud.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.at(-1)?.match(/-?[\d.]+/)?.[0];
    facts.push(`audio: ${a.codec_name}, integrated loudness ${I ?? "?"} LUFS, true peak ${peak ?? "?"} dBFS`);
    const spec = join(dir, "film-spectrogram.png");
    ff("ffmpeg", ["-v", "error", "-y", "-i", video, "-lavfi", "showspectrumpic=s=1600x400:legend=1:scale=log", spec]);
    shots.push({ file: spec, what: "spectrogram of the soundtrack over the whole runtime (time left to right, seconds on the axis)" });
  } else facts.push("audio: none, the video is silent");
  return { shots, facts, video };
}

/** What the user would see of a repo: status, commits, and the diff against the start. */
function repoView(proj) {
  const diff = git(proj, "diff", "HEAD");
  const untracked = git(proj, "ls-files", "--others", "--exclude-standard");
  return {
    status: git(proj, "status", "--short"),
    commits: git(proj, "log", "--oneline"),
    diff: diff.length > 6000 ? `${diff.slice(0, 6000)}\n[diff clipped at 6000 of ${diff.length} characters]` : diff,
    untracked,
  };
}

/**
 * Hidden checks, run against a copy so they cannot disturb the result. A
 * question is graded on the first answer: the simulated user may then ask for
 * the fix, and that later edit is not a broken read-only promise.
 */
function grade(run, proj, turns, seen) {
  const s = SCENARIOS[run.name];
  const final = (s.readOnly ? turns[0]?.final : turns.at(-1)?.final) ?? "";
  const checks = [];
  const commits = git(proj, "rev-list", "--count", "HEAD");
  checks.push({ name: "made no commit (none was asked for)", ok: commits === "1", detail: commits === "1" ? "" : `${commits} commits` });
  if (s.readOnly) {
    const changed = turns[0]?.status ?? "";
    checks.push({ name: "answered the question without changing files", ok: !changed, detail: changed.slice(0, 200) });
  }
  if (s.kind === "page") {
    checks.push({ name: "index.html exists", ok: existsSync(join(proj, "index.html")), detail: "" });
    const overflow = (seen?.facts ?? []).find((f) => /wider than the screen/.test(f));
    checks.push({ name: "fits a 390px screen", ok: !overflow, detail: overflow ?? "" });
    const errors = (seen?.facts ?? []).find((f) => /logged \d+ error/.test(f));
    checks.push({ name: "no page errors", ok: !errors, detail: errors ?? "" });
  }
  if (s.kind === "film") {
    checks.push({ name: "rendered a video file", ok: !!seen?.video, detail: seen?.video ? "" : (seen?.facts ?? [])[0] ?? "" });
  }
  if (s.hidden) {
    const copy = join(run.base, "graded");
    rmSync(copy, { recursive: true, force: true });
    cpSync(proj, copy, { recursive: true, filter: (p) => !p.includes("/node_modules/") });
    write(copy, { ".hidden/check.mjs": CHECK_PRELUDE + s.hidden + CHECK_END, ".hidden/final.md": final });
    try {
      const out = execFileSync(NODE, [".hidden/check.mjs"], { cwd: copy, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] });
      checks.push(...JSON.parse(out.trim().split("\n").at(-1)).checks);
    } catch (e) {
      checks.push({ name: "hidden checks ran", ok: false, detail: String(e.message).slice(0, 200) });
    }
  }
  return checks;
}

async function nextMessage({ history, seen, repo }) {
  const shots = seen?.shots ?? [];
  const prompt = [
    PERSONA,
    "",
    "The conversation so far:",
    ...history.map((h) => `${h.who === "user" ? "YOU" : "AGENT"}: ${h.text.slice(0, 3000)}`),
    "",
    shots.length ? "What the agent built, right now. Open every image with the Read tool before you answer:" : "",
    ...shots.map((s) => `- ${s.file}: ${s.what}`),
    ...(seen?.facts ?? []).map((f) => `- fact: ${f}`),
    repo ? `The repository right now:\ncommits:\n${repo.commits}\nstatus:\n${repo.status || "(clean)"}\ndiff against where you started:\n${repo.diff || "(none)"}` : "",
    "",
    "Reply with exactly what you would type next to the agent, nothing else. If you would be satisfied and move on to other work, reply with exactly: DONE",
  ].filter(Boolean).join("\n");
  const text = await claudeCall(prompt, { dir: shots.length ? dirname(shots[0].file) : null, cwd: ROOT });
  if (text.startsWith("ERROR")) return { error: text };
  return /^DONE\b/.test(text) ? null : text;
}

async function runArm(run, progress) {
  const file = join(run.base, "result.json");
  if (REUSE && existsSync(file)) {
    const old = JSON.parse(readFileSync(file, "utf8"));
    if (!old.invalid) return old;
  }
  const s = SCENARIOS[run.name];
  const { proj, home, settings } = setup(run);
  const label = `${run.name}/${run.harness}/s${run.seed}/${run.arm}`;
  const history = [];
  const turns = [];
  let thread = null;
  let message = s.prompt;
  let seen = null;
  let repo = null;
  let simError = null;
  for (let turn = 1; turn <= MAX_TURNS && message; turn++) {
    history.push({ who: "user", text: message });
    progress(`${label} turn ${turn}: agent`);
    const turnArgs = { proj, base: run.base, turn, thread, message, settings, timeoutMs: s.turnTimeoutMs ?? TURN_TIMEOUT };
    const r = run.harness === "codex" ? await codexTurn(turnArgs) : await claudeTurn(turnArgs);
    if (run.arm === "jevis" && turn === 1 && !existsSync(join(home, "log.jsonl"))) {
      progress(`${label}: Jevis hooks never ran; session invalid`);
      const bad = { ...run, invalid: "Jevis hooks never ran", turns: [] };
      writeFileSync(file, JSON.stringify(bad, null, 1));
      return bad;
    }
    thread = r.thread;
    history.push({ who: "agent", text: r.final || "(no final message)" });
    const view = { page: look, film: lookFilm }[s.kind];
    seen = view ? await view(proj, join(run.base, `turn${turn}-shots`), r.final).catch((e) => ({ shots: [], facts: [`render failed: ${e.message.slice(0, 120)}`] })) : null;
    repo = s.kind === "repo" ? repoView(proj) : null;
    turns.push({ turn, message, ms: r.ms, code: r.code, err: r.code ? r.err : undefined, final: r.final.slice(0, 2000), status: s.kind === "repo" ? git(proj, "status", "--porcelain") : undefined });
    if (turn === MAX_TURNS) break;
    progress(`${label} turn ${turn}: simulated user`);
    const next = await nextMessage({ history, seen, repo });
    if (next?.error) {
      simError = next.error;
      break;
    }
    message = next;
  }
  const checks = grade(run, proj, turns, seen);
  const events = run.arm === "jevis" && existsSync(join(home, "log.jsonl")) ? readFileSync(join(home, "log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const result = {
    ...run,
    turns,
    satisfied: !simError && (!message || turns.length < MAX_TURNS),
    simError,
    agentMs: turns.reduce((n, t) => n + t.ms, 0),
    checks,
    shots: seen?.shots ?? [],
    facts: seen?.facts ?? [],
    repo,
    jevis: {
      notes: events.filter((e) => e.event === "prompt" && e.acted?.length).flatMap((e) => e.acted),
      toolNotes: events.filter((e) => e.event === "tool" && e.acted?.length && !/^(slop|safety|workspace)\//.test(e.acted[0])).flatMap((e) => e.acted),
      denies: events.filter((e) => e.event === "tool" && e.acted?.some((a) => /^(slop|safety|workspace)\//.test(a))).map((e) => ({ acted: e.acted, input: String(e.input ?? "").slice(0, 300) })),
      stopBlocks: events.filter((e) => e.event === "stop" && e.acted?.length).flatMap((e) => e.acted),
      reviews: events.filter((e) => e.event === "review").map((e) => ({ round: e.round, verdict: e.verdict, items: e.items, error: e.error, skipped: e.skipped, ms: e.ms })),
      calls: events.filter((e) => ["prompt", "tool", "stop"].includes(e.event)).length,
      jevErrors: events.filter((e) => e.error && e.event !== "review").map((e) => `${e.event}: ${e.error}`),
      toolMs: events.filter((e) => e.event === "tool" && e.ms).map((e) => e.ms),
    },
  };
  writeFileSync(file, JSON.stringify(result, null, 1));
  progress(`${label}: done, ${checks.filter((c) => c.ok).length}/${checks.length} checks`);
  return result;
}

async function judge(pair, base, jevis) {
  // Blind: which arm is "A" varies with the scenario, harness, and seed.
  const flip = (pair.name.length + pair.seed + (pair.harness === "claude" ? 1 : 0)) % 2 === 0;
  const v = await compare(pair.name, base, jevis, { flip, root: ROOT });
  if (v.error) return v;
  return { winner: { a: "base", b: "jevis", tie: "tie" }[v.winner], margin: v.margin, problems_base: v.problems_a, problems_jevis: v.problems_b, why: v.why };
}

/** Limits how many agent sessions run at once. */
function pool(size) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= size || !queue.length) return;
    active++;
    const { fn, done } = queue.shift();
    fn()
      .catch((e) => e)
      .then(done)
      .finally(() => (active--, next()));
  };
  return (fn) => new Promise((done) => (queue.push({ fn, done }), next()));
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
for (const n of names) if (!SCENARIOS[n]) throw new Error(`unknown scenario ${n}`);
mkdirSync(ROOT, { recursive: true });
const progressFile = join(ROOT, "progress.log");
const progress = (m) => appendFileSync(progressFile, `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const slot = pool(POOL);
const judgeSlot = pool(3);
const pairs = SEEDS.flatMap((seed) => HARNESSES.flatMap((harness) => names.map((name) => ({ name, harness, seed }))));
progress(`start: ${pairs.length} pairs (${names.join(", ")} × ${HARNESSES.join(", ")} × seeds ${SEEDS.join(", ")}), pool ${POOL}`);

const results = await Promise.all(pairs.map(async (pair) => {
  const arms = await Promise.all(["base", "jevis"].map((arm) => {
    const run = { ...pair, arm, base: join(ROOT, `${pair.name}-${pair.harness}-s${pair.seed}-${arm}`) };
    if (!ARMS.includes(arm)) {
      const file = join(run.base, "result.json");
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { ...run, invalid: "not run" };
    }
    return slot(() => runArm(run, progress)).then((r) => (r instanceof Error ? { ...run, invalid: `crashed: ${r.message}` } : r));
  }));
  const [base, jevis] = arms;
  const tag = `${pair.name}/${pair.harness}/s${pair.seed}`;
  if (base.invalid || jevis.invalid) return { ...pair, base, jevis, verdict: { error: base.invalid ?? jevis.invalid } };
  const verdictFile = join(ROOT, `${pair.name}-${pair.harness}-s${pair.seed}-verdict.json`);
  let verdict = REUSE && existsSync(verdictFile) ? JSON.parse(readFileSync(verdictFile, "utf8")) : null;
  if (!verdict?.winner) {
    progress(`${tag}: judging`);
    verdict = await judgeSlot(() => judge(pair, base, jevis));
    if (verdict instanceof Error) verdict = { error: verdict.message };
    writeFileSync(verdictFile, JSON.stringify(verdict, null, 1));
  }
  progress(`${tag}: ${verdict.winner ?? verdict.error}`);
  return { ...pair, base, jevis, verdict };
}));

writeFileSync(join(ROOT, "summary.json"), JSON.stringify(results, null, 1));
const text = report(results);
writeFileSync(join(ROOT, "summary.md"), text);
console.log(text);
