import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compare as compareSample, JUDGE_VERSION, judgePrompt, parseVote, RUBRICS, scoreVote } from "./sim-judge.mjs";
import { acted, balancedEvidence, report } from "./sim-report.mjs";
import { aggregateRuns, balancedVerdict, majority, positiveInt, signTest } from "./sim-stats.mjs";

const compare = (name, a, b, opts) => compareSample(name, a, b, { identity: { harness: "codex", seed: 1, repeat: 1 }, ...opts });

const vote = (winner, margin = "clear") => ({ winner, margin });
const scores = (n, kind = "repo") => Object.fromEntries(RUBRICS[kind].map(({ id }) => [id, n]));
const answer = (a, b, kind = "repo") => ({ scores: { A: scores(a, kind), B: scores(b, kind) }, problems_A: ["problem A"], problems_B: ["problem B"], why: "Evidence here." });
const arm = (final, active = false) => ({ turns: [{ final }], checks: [{ name: "correct", ok: true }], jevis: { calls: 2, notes: active ? ["note"] : [] }, agentMs: 100, satisfied: true });
const pair = (winner, repeat = 1, active = true, seed = 1) => ({ name: "invoice", harness: "codex", seed, repeat, base: arm("BAD"), jevis: arm("GOOD", active), verdict: vote(winner) });
const scratch = (t) => {
  const root = mkdtempSync(join(tmpdir(), "jevis-judge-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test("strict majority is not plurality; ties count in the denominator", () => {
  assert.equal(majority([vote("a"), vote("a"), vote("b")]).winner, "a");
  assert.equal(majority([vote("b"), vote("b"), vote("a")]).winner, "b");
  assert.equal(majority([vote("a"), vote("b"), vote("tie")]).winner, "tie");
  assert.equal(majority([vote("a"), vote("a"), vote("b"), vote("tie")]).winner, "tie");
  assert.equal(majority([vote("tie"), vote("tie"), vote("a")]).winner, "tie");
  assert.equal(majority([vote("a", "slight"), vote("a"), vote("b")]).margin, "slight");
  assert.ok(majority([]).error);
  assert.ok(majority([vote("a"), vote("a"), { error: "timeout" }]).error);
  assert.ok(majority([vote("bogus")]).error);
});

test("wins require both orders, including margins; disagreement is a tie", () => {
  for (const a of ["a", "b", "tie"]) for (const b of ["a", "b", "tie"]) {
    assert.equal(balancedVerdict([vote(a), vote(b)]).winner, a === b ? a : "tie");
  }
  assert.equal(balancedVerdict([vote("a"), vote("a", "slight")]).margin, "slight");
  assert.ok(balancedVerdict([vote("a")]).error);
  assert.ok(balancedVerdict([vote("a"), { error: "missing" }]).error);
});

test("scores map both orders to canonical arms and aggregate independent rubric items", () => {
  const v = answer(4, 1);
  assert.equal(scoreVote(v, RUBRICS.repo).winner, "a");
  const flipped = scoreVote(v, RUBRICS.repo, true);
  assert.equal(flipped.winner, "b");
  assert.deepEqual(flipped.scores_a, v.scores.B);
  assert.deepEqual(flipped.problems_a, v.problems_B);
  assert.equal(scoreVote(answer(3, 3), RUBRICS.repo).winner, "tie");
  const film = answer(2, 2, "film");
  film.scores.A.directing = 3;
  film.scores.B.sound = 4;
  assert.equal(scoreVote(film, RUBRICS.film).winner, "a"); // directing 3 > sound 2
  for (const bad of [null, { winner: "A" }, { ...v, scores: { A: { correctness: 4 }, B: v.scores.B } },
    { ...v, scores: { ...v.scores, A: { ...v.scores.A, scope: 5 } } },
    { ...v, scores: { ...v.scores, A: { ...v.scores.A, scope: 1.5 } } },
    { ...v, problems_B: "oops" }]) assert.ok(scoreVote(bad, RUBRICS.repo).error);
});

test("a judge always choosing display A loses its win after order swapping", () => {
  const ab = scoreVote(answer(4, 0), RUBRICS.repo);
  const ba = scoreVote(answer(4, 0), RUBRICS.repo, true);
  assert.equal(balancedVerdict([majority([ab, ab, ab]), majority([ba, ba, ba])]).winner, "tie");
  const stable = scoreVote(answer(0, 4), RUBRICS.repo, true);
  assert.equal(balancedVerdict([majority([ab, ab, ab]), majority([stable, stable, stable])]).winner, "a");
});

test("env knobs reject zero, fractional, infinite and invalid values", () => {
  assert.equal(positiveInt("3", "votes"), 3);
  for (const n of ["", 0, -1, 1.5, Infinity, "oops"]) assert.throws(() => positiveInt(n, "votes"), /positive integer/);
});

test("exact two-sided sign test excludes ties and matches known small cases", () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(3, 3), 1);
  assert.ok(Math.abs(signTest(5, 1) - 0.21875) < 1e-12);
  assert.ok(Math.abs(signTest(6, 0) - 0.03125) < 1e-12);
  assert.ok(Math.abs(signTest(20, 6) - 0.009355306625366211) < 1e-12);
  assert.equal(signTest(20, 6), signTest(6, 20));
  assert.ok(signTest(600, 600) > 0.999);
  assert.throws(() => signTest(-1, 1));
});

test("repeat aggregation groups by scenario/harness/seed and preserves clean no-op calibration", () => {
  const runs = [pair("jevis", 1), pair("jevis", 2), pair("base", 3), pair("base", 1, false, 2)];
  const grouped = aggregateRuns(runs, acted);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].verdict.winner, "jevis");
  assert.equal(grouped[0].intervention, "acted");
  assert.equal(grouped[1].intervention, "silent");
  assert.equal(aggregateRuns([pair("jevis", 1), pair("base", 2)], acted)[0].verdict.winner, "tie");
  assert.equal(aggregateRuns([pair("jevis", 1), pair("jevis", 2, false)], acted)[0].intervention, "mixed");
  assert.ok(aggregateRuns([pair("jevis"), pair("jevis")], acted)[0].verdict.error);
  const broken = pair("jevis", 2); broken.verdict = { error: "timeout" };
  assert.ok(aggregateRuns([pair("jevis"), broken], acted)[0].verdict.error);
});

test("compare caches six independent votes, swaps prompts, and reuses/extends them without re-calling", async (t) => {
  const root = scratch(t);
  const a = arm("GOOD"); const b = arm("BAD");
  const prompts = [];
  const call = async (prompt) => {
    prompts.push(prompt);
    return JSON.stringify(prompt.indexOf("agent: GOOD") < prompt.indexOf("agent: BAD") ? answer(4, 0) : answer(0, 4));
  };
  const first = await compare("invoice", a, b, { root, votes: 3, call });
  assert.equal(first.winner, "a");
  assert.equal(first.version, JUDGE_VERSION);
  assert.equal(prompts.length, 6);
  assert.notEqual(prompts[0], prompts[3]);
  assert.deepEqual(first.orders.map((o) => o.votes.length), [3, 3]);
  const files = readdirSync(join(root, "judge-votes"));
  assert.equal(files.length, 6);
  const record = JSON.parse(readFileSync(join(root, "judge-votes", files[0]), "utf8"));
  assert.ok(record.raw && record.prompt && record.result.scores_a);
  assert.equal((await compare("invoice", a, b, { root, votes: 3, flip: true, call })).winner, "a");
  assert.equal(prompts.length, 6);
  await compare("invoice", a, b, { root, votes: 4, call });
  assert.equal(prompts.length, 8);
  a.turns[0].final = "changed GOOD";
  await compare("invoice", a, b, { root, votes: 1, call });
  assert.equal(prompts.length, 10);
});

test("identical results still receive separate votes in each order", async (t) => {
  const root = scratch(t); let calls = 0;
  const a = arm("same");
  const call = async () => { calls++; return JSON.stringify(answer(2, 2)); };
  assert.equal((await compare("invoice", a, a, { root, votes: 1, call })).winner, "tie");
  assert.equal(calls, 2);
  await compare("invoice", a, a, { root, votes: 1, call });
  assert.equal(calls, 2);
});

test("judge failures remain recorded errors, not fabricated wins or free retries", async (t) => {
  const root = scratch(t); let calls = 0;
  const call = async () => { calls++; return "ERROR unavailable"; };
  const v = await compare("invoice", arm("A"), arm("B"), { root, votes: 1, call });
  assert.ok(v.error);
  assert.ok(v.orders.every((o) => o.votes[0].error));
  assert.ok((await compare("invoice", arm("A"), arm("B"), { root, votes: 1, call })).error);
  assert.equal(calls, 2);
});

test("rendered bytes changing at a stable path invalidate vote caches", async (t) => {
  const root = scratch(t); const image = join(root, "frame.png");
  writeFileSync(image, "first snapshot");
  const a = { ...arm("A"), shots: [{ file: image, what: "frame" }] }; let calls = 0;
  const call = async () => { calls++; return JSON.stringify(answer(2, 2)); };
  await compare("invoice", a, arm("B"), { root, votes: 1, call });
  writeFileSync(image, "second snapshot");
  await compare("invoice", a, arm("B"), { root, votes: 1, call });
  assert.equal(calls, 4);
});

test("prompt preserves rubric priorities and hidden-check evidence in both orders", () => {
  const a = arm("GOOD"); const b = arm("BAD");
  const prompt = judgePrompt("invoice", a, b);
  assert.match(prompt, /correctness \(weight 1\)/);
  assert.match(prompt, /hidden checks: pass correct/);
  assert.ok(prompt.indexOf("agent: GOOD") < prompt.indexOf("agent: BAD"));
  const reversed = judgePrompt("invoice", a, b, true);
  assert.ok(reversed.indexOf("agent: BAD") < reversed.indexOf("agent: GOOD"));
  assert.match(judgePrompt("film", a, b), /directing \(weight 3\)/);
});

test("offline report CLI supports legacy recordings and separates judge errors from hidden checks", (t) => {
  const root = scratch(t);
  const active = Array.from({ length: 27 }, (_, i) => pair(i < 20 ? "jevis" : i < 26 ? "base" : "tie", 1, true, i + 1));
  const silent = Array.from({ length: 9 }, (_, i) => pair(i < 5 ? "base" : i < 6 ? "jevis" : "tie", 1, false, 100 + i));
  const broken = pair("base", 1, true, 200);
  broken.base.checks[0].ok = false; broken.verdict = { error: "judge unavailable" };
  const results = [...active, ...silent, broken];
  const file = join(root, "summary.json"); writeFileSync(file, JSON.stringify(results));
  const out = execFileSync(process.execPath, ["eval/sim-report.mjs", file], { encoding: "utf8" });
  assert.equal(out.trimEnd(), report(results).trimEnd());
  assert.match(out, /\*\*Jevis acted\*\*.*27.*20 \(20 clear\).*1.*6 \(6 clear\).*0\.0094/);
  assert.match(out, /noise floor.*9.*1 \(1 clear\).*3.*5 \(5 clear\).*0\.2188/);
  assert.match(out, /Legacy or unverified balanced verdicts: 36/);
  assert.match(out, /Repo checks across 37 paired runs: bare 36\/37 passed; Jevis 37\/37 passed/);
  assert.match(out, /Jevis newly passes \(1\)/);
  assert.match(out, /Every Jevis session ran its hooks \| pass \| 37 of 37/);
  assert.match(out, /Every pair has a valid current balanced judge aggregate \| FAIL/);
  assert.equal(out.includes("NaN"), false);
});

test("report does not inflate sample size with repeats or mix no-op/acted calibration", () => {
  const out = report([pair("jevis", 1), pair("jevis", 2), pair("base", 3), pair("base", 1, false, 2), pair("jevis", 2, true, 2)]);
  assert.match(out, /All pairs \| 2/);
  assert.match(out, /\*\*Jevis acted\*\* \(recorded verdicts\) \| 1/);
  assert.match(out, /Jevis silent \(noise floor\) \| 0/);
  assert.match(out, /Mixed intervention across runs \(excluded from calibration\) \| 1/);
  assert.match(out, /aggregate 5 paired runs into 2/);
  assert.doesNotThrow(() => report([]));
});

test("sim processes repeated recorded arms offline, ignoring legacy one-vote verdict caches", async (t) => {
  const root = scratch(t);
  const call = async (prompt) => JSON.stringify(prompt.indexOf("agent: GOOD") < prompt.indexOf("agent: BAD") ? answer(4, 0) : answer(0, 4));
  for (let repeat = 1; repeat <= 3; repeat++) {
    const suffix = repeat === 1 ? "" : `-r${repeat}`;
    const base = arm(`BAD ${repeat}`); const jevis = arm(`GOOD ${repeat}`, true);
    for (const [label, result] of [["base", base], ["jevis", jevis]]) {
      const dir = join(root, `invoice-codex-s1${suffix}-${label}`);
      mkdirSync(dir); writeFileSync(join(dir, "result.json"), JSON.stringify(result));
    }
    await compare("invoice", base, jevis, { root, votes: 1, call, identity: { harness: "codex", seed: 1, repeat } });
    writeFileSync(join(root, `invoice-codex-s1${suffix}-verdict.json`), JSON.stringify(vote("base")));
  }
  // No arms are launched. PATH contains no executables, so an unexpected cache miss
  // cannot call a live model. Only the cached-record orchestration is under test.
  const out = execFileSync(process.execPath, ["eval/sim.mjs", "invoice"], { encoding: "utf8", env: {
    ...process.env, PATH: root, JEVIS_HOME: root, SIM_ROOT: root, SIM_ARMS: "", SIM_HARNESS: "codex", SIM_SEEDS: "1", SIM_RUNS: "3", SIM_JUDGE_VOTES: "1",
  } });
  const summary = JSON.parse(readFileSync(join(root, "summary.json"), "utf8"));
  assert.deepEqual(summary.map((p) => p.repeat), [1, 2, 3]);
  assert.ok(summary.every((p) => p.verdict.winner === "jevis" && p.verdict.orders.length === 2));
  assert.match(out, /All pairs \| 1 \| 1/);
  assert.match(out, /aggregate 3 paired runs into 1/);
});

test("cross-harness report finds repeated paths and reuses the same balanced cached judge", async (t) => {
  const root = scratch(t);
  const call = async () => JSON.stringify(answer(4, 0));
  for (let repeat = 1; repeat <= 2; repeat++) {
    const suffix = repeat === 1 ? "" : `-r${repeat}`;
    const a = arm(`codex bare ${repeat}`); const aj = arm(`codex jevis ${repeat}`, true); const b = arm(`claude bare ${repeat}`);
    for (const [label, result] of [["codex", a], ["codex-jevis", aj], ["claude", b]]) {
      const harness = label === "codex-jevis" ? "codex" : label;
      const side = label === "codex-jevis" ? "jevis" : "base";
      const dir = join(root, `invoice-${harness}-s1${suffix}-${side}`);
      mkdirSync(dir); writeFileSync(join(dir, "result.json"), JSON.stringify(result));
    }
    await compare("invoice", a, b, { root, votes: 1, call, identity: { harness: "codex/base:claude/base", seed: 1, repeat } });
    await compare("invoice", aj, b, { root, votes: 1, call, identity: { harness: "codex/jevis:claude/base", seed: 1, repeat } });
  }
  const out = execFileSync(process.execPath, ["eval/sim-cross.mjs", root, "invoice"], { encoding: "utf8", env: { ...process.env, PATH: root, SIM_JUDGE_VOTES: "1" } });
  const cross = JSON.parse(readFileSync(join(root, "cross.json"), "utf8"));
  assert.equal(cross.length, 4);
  assert.ok(cross.every((p) => p.verdict.winner === "tie")); // always picking display A
  assert.match(out, /ties 1, Claude Code bare wins 0, invalid 0 \(2 paired runs aggregated\)/);
});


test("cache identity separates identical evidence across seeds, harnesses, repeats and scenarios", async (t) => {
  const root = scratch(t);
  let calls = 0;
  const a = arm("same A"), b = arm("same B", true);
  const call = async (prompt) => {
    calls++;
    return JSON.stringify(prompt.indexOf("agent: same A") < prompt.indexOf("agent: same B") ? answer(0, 4) : answer(4, 0));
  };
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    const identity = { harness: "codex", seed, repeat: 1 };
    const verdict = await compare("invoice", a, b, { root, votes: 1, call, identity });
    results.push({ ...pair("jevis", 1, true, seed), verdict: { ...verdict, winner: "jevis" } });
  }
  assert.equal(calls, 12, "six independent pairs need twelve judge calls, not two");
  assert.equal(new Set(results.flatMap((p) => p.verdict.orders.flatMap((o) => o.votes.map((v) => v.cacheFile)))).size, 12);
  assert.match(report(results), /6 balanced pairs; p=0\.0313/);
  await compare("invoice", a, b, { root, votes: 1, call, identity: { harness: "codex", seed: 1, repeat: 1 } });
  assert.equal(calls, 12, "retrying the same sample reuses its own votes");
  for (const identity of [{ harness: "claude", seed: 1, repeat: 1 }, { harness: "codex", seed: 1, repeat: 2 }]) await compare("invoice", a, b, { root, votes: 1, call, identity });
  await compare("cleanup", a, b, { root, votes: 1, call });
  assert.equal(calls, 18);
  await assert.rejects(compareSample("invoice", a, b, { root, votes: 1, call }), /identity/);
  assert.equal(calls, 18);
});

const balancedPair = (seed) => {
  const p = pair("jevis", 1, true, seed);
  const orders = [false, true].map((flip) => {
    const votes = [scoreVote(flip ? answer(4, 0) : answer(0, 4), RUBRICS.repo, flip)];
    return { flip, votes, ...majority(votes) };
  });
  p.verdict = { ...balancedVerdict(orders), winner: "jevis", orders, votesPerOrder: 1, version: JUDGE_VERSION, sample: { name: p.name, harness: p.harness, seed, repeat: 1 } };
  return p;
};

test("legacy-only apparent wins stay visible but cannot pass release gates", () => {
  const legacy = Array.from({ length: 6 }, (_, i) => pair("jevis", 1, true, i + 1));
  const out = report(legacy);
  assert.match(out, /All pairs \| 6 \| 6 \(6 clear\)/);
  assert.match(out, /Current balanced, Jevis acted \(release gates\) \| 0/);
  assert.match(out, /Net good:.*\| FAIL \| 0 Jevis, 0 bare/);
  assert.match(out, /Every pair has a valid current balanced judge aggregate \| FAIL \| 0 of 6/);
  assert.equal(out.includes("All gates pass."), false);
  const balanced = Array.from({ length: 6 }, (_, i) => balancedPair(i + 1));
  assert.ok(balanced.every(balancedEvidence));
  assert.match(report(balanced), /All gates pass/);
  const mixed = report([...balanced, pair("jevis", 1, true, 7)]);
  assert.match(mixed, /of 6 balanced pairs; p=0\.0313/);
  assert.equal(mixed.includes("All gates pass."), false, "legacy evidence cannot hide in a balanced cohort");
});

test("version labels cannot substitute for valid votes in both distinct orders", () => {
  const variants = [
    (p) => { p.verdict.orders.pop(); },
    (p) => { p.verdict.orders[1] = null; },
    (p) => { p.verdict.orders[1].flip = false; },
    (p) => { p.verdict.orders[1].votes = []; },
    (p) => { p.verdict.orders[1].votes[0] = { error: "timeout" }; },
    (p) => { p.verdict.version = "balanced-rubric-v1"; },
    (p) => { p.verdict.sample.seed = 99; },
    (p) => { p.verdict.winner = "base"; },
  ];
  for (const mutate of variants) {
    const p = balancedPair(1); mutate(p);
    assert.equal(balancedEvidence(p), false);
    assert.equal(report([p]).includes("All gates pass."), false);
  }
  const repeated = [balancedPair(1), { ...pair("jevis", 2), verdict: vote("jevis") }];
  assert.match(report(repeated), /current balanced judge aggregate \| FAIL \| 0 of 1/);
});

test("a vote without the optional why still counts; a fenced reply parses", () => {
  const { why, ...noWhy } = answer(4, 0);
  const scored = scoreVote(noWhy, RUBRICS.repo);
  assert.equal(scored.winner, "a");
  assert.equal(scored.why, "");
  assert.ok(scoreVote({ ...noWhy, why: 3 }, RUBRICS.repo).error);
  assert.equal(parseVote("```json\n" + JSON.stringify(noWhy) + "\n```", RUBRICS.repo).winner, "a");
  assert.ok(parseVote("not json", RUBRICS.repo).error);
});

test("cached votes are rescored from their raw reply without a new call", async (t) => {
  const root = scratch(t);
  const a = arm("GOOD"); const b = arm("BAD");
  let calls = 0;
  const call = async (prompt) => {
    calls++;
    return JSON.stringify(prompt.indexOf("agent: GOOD") < prompt.indexOf("agent: BAD") ? answer(4, 0) : answer(0, 4));
  };
  await compare("invoice", a, b, { root, votes: 3, call });
  // Simulate a vote cached under an older, stricter validator.
  const dir = join(root, "judge-votes");
  const file = join(dir, readdirSync(dir)[0]);
  const record = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...record, result: { error: "Invalid rubric scores or explanation" } }));
  const again = await compare("invoice", a, b, { root, votes: 3, call });
  assert.equal(calls, 6);
  assert.equal(again.winner, "a");
});
