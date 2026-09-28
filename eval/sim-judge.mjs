/**
 * The blind judge for simulated sessions, and the process helpers it shares
 * with eval/sim.mjs. `compare` sees two finished conversations for the same
 * request and never learns how either was made.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { SCENARIOS } from "./sim-scenarios.mjs";

export function sh(cmd, args, { cwd, env = {}, timeoutMs = 40 * 60_000, log } = {}) {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => {
      out += d;
      if (log) appendFileSync(log, d);
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => (clearTimeout(timer), done({ code, out, err })));
    child.on("error", (e) => (clearTimeout(timer), done({ code: -1, out, err: e.message })));
  });
}

/** One read-only Claude call with Jevis off, so the judge and the simulated user never trigger it. */
export async function claude(prompt, { dir, cwd }) {
  const r = await sh("claude", ["-p", prompt, "--allowedTools", "Read", "--strict-mcp-config", ...(dir ? ["--add-dir", dir] : []), "--output-format", "text"], { cwd, env: { JEVIS_DISABLE: "1" }, timeoutMs: 8 * 60_000 });
  return r.code === 0 ? r.out.trim() : `ERROR ${r.err.slice(-200)}`;
}

/**
 * Judge result `a` against result `b` for scenario `name`. `flip` shows b as
 * "Result A", so neither side is always first. Returns winner "a", "b", or "tie".
 */
export async function compare(name, a, b, { flip = false, root }) {
  const s = SCENARIOS[name];
  const [first, second] = flip ? [b, a] : [a, b];
  const block = (label, r) => [
    `${label}:`,
    r.turns.length > 1 ? `the user's follow-up messages in this conversation:\n${r.turns.slice(1).map((t, i) => `  ${i + 2}. ${t.message.slice(0, 600)}`).join("\n")}` : "",
    ...(r.shots ?? []).map((x) => `- ${x.file}: ${x.what}`),
    ...(r.facts ?? []).map((f) => `- measured: ${f}`),
    r.repo ? `commits:\n${r.repo.commits}\nstatus:\n${r.repo.status || "(clean)"}\ndiff:\n${r.repo.diff || "(none)"}` : "",
    `hidden checks: ${r.checks.map((c) => `${c.ok ? "pass" : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`,
    `final message from the agent: ${(r.turns.at(-1)?.final ?? "").slice(0, 1500)}`,
  ].filter(Boolean).join("\n");
  const prompt = [
    "You are judging two results for the same request. You do not know how either was made. Open every image with the Read tool first.",
    `The first request: """${s.prompt}"""`,
    "Each result is a conversation: the user may have asked for more after seeing the first answer, and those follow-ups count as requests. A question answered first and then fixed on request is not an unrequested change.",
    block("Result A", first),
    block("Result B", second),
    s.kind === "page"
      ? "Judge like a demanding senior product designer: does it do what was asked, is it specific to this product rather than a generic AI template, does it work on a phone, did it invent anything?"
      : s.kind === "film"
        ? "Judge like a seasoned film director watching once as a stranger. Directing matters most: can you follow what happens in each beat from the frames and the words on screen, without the maker's explanation? Is it one cohesive world with continuity (a character keeps its size, cuts land on actions), or a slideshow of sets cut on a steady clock? Does the pacing let each beat read and build? Do the physics and scenery make sense? Is the visual and written language mature, or clip-art and rough? Then judge the sound from the spectrogram and levels: a score that follows the story's arc, with sounds on the visible actions, beats a looping pattern that ignores the picture. A surprising premise does not make up for a story a viewer cannot follow. Weigh the full-size frames above the contact sheet."
        : "Judge like a careful senior engineer: is it correct and complete, did it stay in scope, did it lose or commit anything the user did not ask for, and is the final message honest about what was verified?",
    'Reply with JSON only: {"winner":"A"|"B"|"tie","margin":"clear"|"slight","problems_A":["specific problems in A"],"problems_B":["..."],"why":"two sentences"}',
  ].join("\n\n");
  const text = await claude(prompt, { dir: root, cwd: root });
  let v = null;
  try {
    v = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return { error: text.slice(0, 300) };
  }
  const winner = v.winner === "tie" ? "tie" : (v.winner === "A") !== flip ? "a" : "b";
  return { winner, margin: v.margin, problems_a: flip ? v.problems_B : v.problems_A, problems_b: flip ? v.problems_A : v.problems_B, why: v.why };
}
