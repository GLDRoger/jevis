import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A private home, a scripted Jev, a stub renderer, and a scripted critic: no network, no browser, no CLI.
process.env.JEVIS_HOME = mkdtempSync(join(tmpdir(), "jevis-home-"));
for (const k of ["JEVIS_MODE", "JEVIS_SCOPE", "JEVIS_DISABLE", "JEVIS_CRITIC", "AGENT_CALL_DEPTH", "BROKER_JOB_ID", "BROKER_DEPTH"]) delete process.env[k];
const wikiDir = mkdtempSync(join(tmpdir(), "jevis-wiki-"));
mkdirSync(join(wikiDir, "slop"), { recursive: true });
writeFileSync(join(wikiDir, "slop", "glow.md"), "---\nevent: tool\ntools: [Write]\nask: Does `input` add glow blobs?\nunless: Does `request` ask for glow?\nmin: 0.85\naction: deny\ntitle: Glow blobs\nsource: test\n---\nBlurred orbs behind the hero are filler.\n\nInstead: show the product.\n");
process.env.JEVIS_WIKI = wikiDir;

const { setJevTransport } = await import("../src/jev.mjs");
const { onPrompt, onStop } = await import("../src/hooks.mjs");
const { criticPrompt, findUrls, parseReview, formatReview, setCapture, setCritic, telltales, REVIEW_ROUNDS } = await import("../src/review.mjs");
const { loadSession, readLog } = await import("../src/state.mjs");

let script = {};
setJevTransport(async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: script[k] ?? 0.05 }])) }));
const VISUAL = { "axis.work_requested": 0.95, "axis.visual": 0.95, "axis.film": 0.05 };

let rendered = [];
setCapture(async (targets, { dir, film }) => {
  rendered.push({ targets, film });
  return { shots: [{ file: join(dir, "1-1440-top.png"), what: "first screen" }], facts: ["At 390px the page is 40px wider than the screen (it scrolls sideways)."] };
});
let critic = () => ({ text: "{}" });
let prompts = [];
setCritic(async (prompt) => (prompts.push(prompt), critic(prompt)));

let n = 0;
/** A Claude Code turn that edited index.html, written after the prompt hook as the harness does. */
async function visualTurn(request = "make me a landing page for my pottery studio", file = "index.html") {
  const dir = mkdtempSync(join(tmpdir(), "jevis-review-"));
  writeFileSync(join(dir, file), "<h1>Clay</h1>");
  const transcript = join(dir, ".claude", "projects", "p", "t.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  const id = `r${++n}`;
  await onPrompt({ session_id: id, cwd: dir, prompt: request, transcript_path: transcript, permission_mode: "default" });
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  const rows = [
    { type: "assistant", uuid: "a1", timestamp: at(1), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Write", input: { file_path: join(dir, file) } }] } },
    { type: "user", uuid: "u2", timestamp: at(2), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
    { type: "assistant", uuid: "a2", timestamp: at(3), message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Built the page." }] } },
  ];
  appendFileSync(transcript, rows.map((r) => JSON.stringify(r)).join("\n"));
  return { id, dir, stop: { session_id: id, cwd: dir, transcript_path: transcript, permission_mode: "default" } };
}

const FIX = JSON.stringify({ verdict: "fix", must_fix: [{ now: "A purple gradient hero with three feature cards", instead: "Lead with a photo of the kiln and the class timetable" }], keep: "The type pairing" });

test("findUrls: local URLs from commands and messages, newest first, one per origin", () => {
  const urls = findUrls(["npm run dev -> http://localhost:5173/", "curl http://0.0.0.0:3000/api", "open http://localhost:5173/about.", "see https://example.com"]);
  assert.deepEqual(urls, ["http://localhost:5173/about", "http://localhost:3000/api"]);
});

test("parseReview: takes the JSON out of a chatty reply and caps the list", () => {
  const r = parseReview(`Here you go:\n${JSON.stringify({ verdict: "fix", must_fix: Array.from({ length: 8 }, (_, i) => ({ now: `a${i}`, instead: `x${i}` })) })}\nDone.`);
  assert.equal(r.verdict, "fix");
  assert.equal(r.must_fix.length, 5);
  assert.equal(parseReview("no json here"), null);
  assert.equal(parseReview('{"verdict":"fix","must_fix":[]}').verdict, "ship", "a fix with nothing to fix is a pass");
});

test("review: a visual turn is rendered, judged, and sent back with now/instead items", async () => {
  script = VISUAL;
  rendered = [];
  prompts = [];
  critic = () => ({ text: FIX });
  const { id, stop } = await visualTurn();
  const out = await onStop(stop);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /Jevis design review, round 1 of 2/);
  assert.match(out.reason, /1\. Now: A purple gradient hero[\s\S]*Instead: Lead with a photo of the kiln/);
  assert.match(out.reason, /Keep: The type pairing/);
  assert.equal(rendered.length, 1);
  assert.match(rendered[0].targets[0], /^file:\/\/.*index\.html$/);
  assert.match(prompts[0], /make me a landing page for my pottery studio/);
  assert.match(prompts[0], /Glow blobs: Blurred orbs behind the hero are filler\./, "the critic gets the slop telltales from the wiki");
  assert.match(prompts[0], /40px wider than the screen/);
  assert.equal(loadSession(id).stop.reviews, 1);
});

test("review: at most REVIEW_ROUNDS rounds a turn, and round 2 tells the critic the agent already revised", async () => {
  script = VISUAL;
  prompts = [];
  critic = () => ({ text: FIX });
  const { stop } = await visualTurn();
  for (let i = 0; i < REVIEW_ROUNDS; i++) assert.equal((await onStop(stop)).decision, "block");
  assert.match(prompts[1], /round 2 of 2\. The agent already revised once/);
  assert.equal(await onStop(stop), null, "no third round");
});

test("review: a follow-up turn gets one round; the first reviewed turn gets REVIEW_ROUNDS", async () => {
  script = VISUAL;
  critic = () => ({ text: FIX });
  const { id, dir, stop } = await visualTurn();
  for (let i = 0; i < REVIEW_ROUNDS; i++) assert.equal((await onStop(stop)).decision, "block");
  await onPrompt({ session_id: id, cwd: dir, prompt: "make the header darker", transcript_path: stop.transcript_path, permission_mode: "default" });
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(join(dir, "index.html"), "<h1>Clay, darker</h1>");
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  appendFileSync(stop.transcript_path, "\n" + [
    { type: "assistant", uuid: "b1", timestamp: at(1), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t9", name: "Write", input: { file_path: join(dir, "index.html") } }] } },
    { type: "user", uuid: "b2", timestamp: at(2), message: { content: [{ type: "tool_result", tool_use_id: "t9", content: "ok" }] } },
    { type: "assistant", uuid: "b3", timestamp: at(3), message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Darker header." }] } },
  ].map((r) => JSON.stringify(r)).join("\n"));
  const follow = await onStop(stop);
  assert.match(follow.reason, /round 1 of 1\./);
  assert.match(follow.reason, /This is the last review\./);
  assert.equal(await onStop(stop), null, "no second round on a follow-up");
});

test("review: a ship verdict lets the turn end", async () => {
  script = VISUAL;
  critic = () => ({ text: '{"verdict":"ship","must_fix":[],"keep":"all of it"}' });
  const { stop } = await visualTurn();
  assert.equal(await onStop(stop), null);
});

test("review: fails open when the critic errors or talks nonsense", async () => {
  script = VISUAL;
  critic = () => ({ error: "exit 1: not logged in" });
  assert.equal(await onStop((await visualTurn()).stop), null);
  critic = () => ({ text: "I think it looks nice." });
  assert.equal(await onStop((await visualTurn()).stop), null);
  const last = readLog().filter((e) => e.event === "review").at(-1);
  assert.equal(last.error, "unreadable critic reply");
});

test("review: skipped for non-visual work, for turns that changed no interface file, and in shadow mode", async () => {
  critic = () => ({ text: FIX });
  rendered = [];
  script = { ...VISUAL, "axis.visual": 0.1 };
  assert.equal(await onStop((await visualTurn("add retries to the sender")).stop), null);
  script = VISUAL;
  assert.equal(await onStop((await visualTurn("make me a page", "notes.py")).stop), null);
  process.env.JEVIS_MODE = "shadow";
  try {
    assert.equal(await onStop((await visualTurn()).stop), null);
  } finally {
    delete process.env.JEVIS_MODE;
  }
  assert.equal(rendered.length, 0, "nothing was rendered");
});

test("review: a film request samples frames and says so", async () => {
  script = { ...VISUAL, "axis.film": 0.9 };
  rendered = [];
  critic = () => ({ text: FIX });
  const out = await onStop((await visualTurn("make a 60 second film about the sea")).stop);
  assert.equal(rendered[0].film, true);
  assert.match(out.reason, /Jevis film review/);
});

test("review: a page written by a shell command, with no edit tool in the log, is still reviewed", async () => {
  script = VISUAL;
  rendered = [];
  critic = () => ({ text: FIX });
  const dir = mkdtempSync(join(tmpdir(), "jevis-heredoc-"));
  const transcript = join(dir, ".claude", "projects", "p", "t.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  const id = `r${++n}`;
  await onPrompt({ session_id: id, cwd: dir, prompt: "build me a dashboard", transcript_path: transcript, permission_mode: "default" });
  await new Promise((r) => setTimeout(r, 20));
  writeFileSync(join(dir, "index.html"), "<h1>Orbit</h1>");
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  appendFileSync(transcript, [
    { type: "assistant", uuid: "a1", timestamp: at(1), message: { model: "claude-opus-5-5", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "cat > index.html <<'EOF'\n<h1>Orbit</h1>\nEOF" } }] } },
    { type: "user", uuid: "u2", timestamp: at(2), message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "" }] } },
    { type: "assistant", uuid: "a2", timestamp: at(3), message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Built the dashboard." }] } },
  ].map((r) => JSON.stringify(r)).join("\n"));
  const out = await onStop({ session_id: id, cwd: dir, transcript_path: transcript, permission_mode: "default" });
  assert.equal(out?.decision, "block");
  assert.match(rendered[0].targets[0], /index\.html$/);
  const stop = readLog().filter((e) => e.event === "stop" && e.sessionId === id).at(-1);
  assert.equal(stop.evidence.ui_files, 1);
});

test("criticPrompt: a follow-up is judged with the conversation's first request, and content needs are guarded", () => {
  const base = { kind: "page", targets: ["x"], shots: [], facts: [], telltales: [], lessons: [], round: 1, law: null };
  const follow = criticPrompt({ ...base, request: "the day row is dead weight", firstRequest: "landing page for my pottery studio" });
  assert.match(follow, /The conversation began with:\n"""landing page for my pottery studio"""[\s\S]*The user's latest message:\n"""the day row is dead weight"""/);
  assert.match(follow, /\(email, phone, address, booking link\) stay as one clearly marked placeholder each/);
  assert.match(follow, /may be plausible examples, as long as the final message lists each one for the owner to confirm/);
  assert.match(follow, /When only polish remains .* say "ship"/);
  const first = criticPrompt({ ...base, request: "landing page" });
  assert.match(first, /The user asked:\n"""landing page"""/);
  assert.doesNotMatch(criticPrompt({ ...base, kind: "film", request: "a film" }), /Content: the page/);
});

test("formatReview and telltales read cleanly", () => {
  const text = formatReview({ kind: "page", targets: ["http://localhost:5173/"], shots: ["/h/reviews/s/turn1-round1/a.png"], verdict: parseReview(FIX), backend: "claude" }, 1);
  assert.match(text, /Claude looked at renders of http:\/\/localhost:5173\/ at 1440 and 390 px/);
  assert.match(text, /screenshots are in \/h\/reviews\/s\/turn1-round1/);
  assert.match(text, /Jevis renders the page again at 1440 and 390 px and reviews it, so check only what these points need/, "round 1 spares the agent a full re-check");
  assert.match(text, /Your final message is the user's answer, written as if this review were not there: present the finished work/);
  const last = formatReview({ kind: "page", targets: ["x"], shots: [], verdict: parseReview(FIX), backend: "claude" }, REVIEW_ROUNDS);
  assert.match(last, /This is the last review\. Make these changes, check them with one render, and finish\./);
  assert.deepEqual(telltales(), ["Glow blobs: Blurred orbs behind the hero are filler."]);
});

test("formatReview: a film's last review asks for the video file to be re-rendered", () => {
  const film = (round) => formatReview({ kind: "film", targets: ["film.html"], shots: ["/h/r/f.png"], verdict: parseReview(FIX), backend: "claude" }, round);
  assert.match(film(1), /Jevis samples the film's frames again/);
  assert.doesNotMatch(film(1), /1440 and 390/, "no page wording in a film review");
  assert.match(film(REVIEW_ROUNDS), /re-render the final video file so it carries them/);
  assert.match(film(REVIEW_ROUNDS), /The frames are in \/h\/r/);
});

test("filmSound: a film's soundtrack is measured, and a video older than its source is flagged", async (t) => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { filmSound } = await import("../src/review.mjs");
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return t.skip("no ffmpeg");
  }
  const cwd = mkdtempSync(join(tmpdir(), "jevis-film-"));
  assert.match(filmSound({ cwd, dir: cwd }).facts[0], /No rendered video file/);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=12:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", join(cwd, "film.mp4")]);
  writeFileSync(join(cwd, "film.html"), "<canvas></canvas>");
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(cwd, "film.mp4"), old, old);
  const r = filmSound({ cwd, dir: cwd, files: ["film.html"] });
  assert.match(r.facts.join("\n"), /older than the source changed this turn/);
  assert.match(r.facts.join("\n"), /Soundtrack: -?[\d.]+ LUFS integrated/);
  assert.match(r.shots[0].what, /spectrogram/);
});
