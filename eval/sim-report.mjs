/**
 * Turns eval/sim.mjs results into the gates that decide whether Jevis is a net good.
 *
 * A pair where Jevis put nothing in front of the agent (no note, refusal, hold,
 * or review sent back) is the same agent run twice: its verdict measures the
 * judge's and the model's noise, not Jevis. Those pairs are reported as the
 * noise floor; the gates read the pairs where Jevis acted.
 *
 *   1. No harm:     hidden checks Jevis newly fails do not outnumber those it newly passes.
 *   2. Net good:    where Jevis acted, the blind judge picks it more often than the bare agent,
 *                   with a two-sided sign-test p < 0.05, at least as many clear wins, and no harness or area goes net negative.
 *   3. Worth it:    the simulated user writes no more follow-ups with Jevis, and the whole
 *                   conversation takes at most 1.5 times the bare agent's time (median).
 *   4. Healthy:     every Jevis session ran its hooks, and Jev errors stay under 5% of calls.
 *
 *   node eval/sim-report.mjs /tmp/jevproof/summary.json [more summaries...]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./sim-scenarios.mjs";
import { JUDGE_VERSION } from "./sim-judge.mjs";
import { aggregateRuns, balancedVerdict, majority, signTest } from "./sim-stats.mjs";

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : 0);
const median = (xs) => pct(xs, 0.5);

function tally(pairs) {
  const t = { jevis: 0, base: 0, tie: 0, error: 0, clearJevis: 0, clearBase: 0 };
  for (const p of pairs) {
    t[p.verdict.winner ?? "error"]++;
    if (p.verdict.margin === "clear" && p.verdict.winner === "jevis") t.clearJevis++;
    if (p.verdict.margin === "clear" && p.verdict.winner === "base") t.clearBase++;
  }
  return t;
}

/** Did Jevis put anything in front of the agent in this session? */
export function acted(r) {
  const j = r?.jevis ?? {};
  return Boolean(j.notes?.length || j.toolNotes?.length || j.denies?.length || j.stopBlocks?.length || j.reviews?.some((v) => v.verdict === "fix"));
}

/** Hidden checks that differ between the arms of one pair. */
function checkDiff(p) {
  const base = new Map((p.base.checks ?? []).map((c) => [c.name, c]));
  const out = { regressions: [], improvements: [] };
  for (const c of p.jevis.checks ?? []) {
    const b = base.get(c.name);
    if (!b) continue;
    if (b.ok && !c.ok) out.regressions.push(`${c.name}${c.detail ? ` (${c.detail})` : ""}`);
    if (!b.ok && c.ok) out.improvements.push(c.name);
  }
  return out;
}

/** Recorded legacy winners stay visible but cannot supply release evidence.
 * Validate actual votes in both distinct orders, not just a version label.
 */
export function balancedEvidence(p) {
  const v = p.verdict;
  if (!v || v.version !== JUDGE_VERSION || !Number.isSafeInteger(v.votesPerOrder) || v.votesPerOrder < 1 ||
    !Array.isArray(v.orders) || v.orders.length !== 2 || !v.orders.some((o) => o?.flip === true) || !v.orders.some((o) => o?.flip === false) ||
    v.sample?.name !== p.name || v.sample?.harness !== p.harness || v.sample?.seed !== p.seed || v.sample?.repeat !== (p.repeat ?? 1)) return false;
  for (const o of v.orders) {
    if (!Array.isArray(o.votes) || o.votes.length !== v.votesPerOrder) return false;
    const expected = majority(o.votes);
    if (expected.error || o.error || o.winner !== expected.winner || o.margin !== expected.margin) return false;
  }
  const expected = balancedVerdict(v.orders);
  return !v.error && !expected.error && v.winner === { a: "base", b: "jevis", tie: "tie" }[expected.winner] && v.margin === expected.margin;
}

export function report(results) {
  const cohorts = aggregateRuns(results, acted);
  const judged = cohorts.filter((p) => !p.verdict.error && ["jevis", "base", "tie"].includes(p.verdict.winner));
  const invalid = cohorts.filter((p) => !judged.includes(p));
  // Operational and deterministic evidence is independent of judge availability.
  const completed = results.filter((p) => !p.base.invalid && !p.jevis.invalid);
  const formatP = (p) => p < 0.0001 ? p.toExponential(3) : p.toFixed(4);
  const lines = [];
  const row = (label, pairs) => {
    const t = tally(pairs);
    return `| ${label} | ${pairs.length} | ${t.jevis} (${t.clearJevis} clear) | ${t.tie} | ${t.base} (${t.clearBase} clear) | ${t.jevis - t.base >= 0 ? "+" : ""}${t.jevis - t.base} | ${formatP(signTest(t.jevis, t.base))} |`;
  };
  const areaOf = (p) => SCENARIOS[p.name]?.area ?? "other";
  const active = judged.filter((p) => p.intervention === "acted");
  const silent = judged.filter((p) => p.intervention === "silent");
  const mixed = judged.filter((p) => p.intervention === "mixed");
  const eligible = judged.filter((p) => p.runs.every(balancedEvidence));
  const gateActive = eligible.filter((p) => p.intervention === "acted");

  lines.push("# Jevis simulation results", "");
  lines.push("## Judge verdicts", "", "| Slice | Pairs | Jevis | Tie | Bare | Net | Sign-test p |", "|---|---|---|---|---|---|---|");
  lines.push(row("All pairs", judged));
  lines.push(row("**Jevis acted** (recorded verdicts)", active));
  lines.push(row("Current balanced, Jevis acted (release gates)", gateActive));
  lines.push(row("Jevis silent (noise floor)", silent));
  if (mixed.length) lines.push(row("Mixed intervention across runs (excluded from calibration)", mixed));
  const slices = [];
  for (const h of [...new Set(active.map((p) => p.harness))]) slices.push([`Acted, harness: ${h}`, active.filter((p) => p.harness === h)]);
  for (const a of [...new Set(active.map(areaOf))]) slices.push([`Acted, area: ${a}`, active.filter((p) => areaOf(p) === a)]);
  for (const [label, pairs] of slices) lines.push(row(label, pairs));
  lines.push("", `Judge counts aggregate ${results.length} paired runs into ${cohorts.length} scenario/harness/seed pairs by strict majority. Invalid aggregates: ${invalid.length}.`,
    "Sign-test p is two-sided exact binomial under equal win odds, excluding ties. It measures directional imbalance, not causality; slices are exploratory, uncorrected comparisons. Silent pairs measure agent variability plus judge noise, not judge noise alone.");
  const legacy = results.filter((p) => p.verdict.winner && !balancedEvidence(p)).length;
  if (legacy) lines.push(`Legacy or unverified balanced verdicts: ${legacy}; displayed as recorded, excluded from release gates, NOT retroactively order-balanced or rejudged.`);
  lines.push("");

  lines.push("## Every pair", "", "| Scenario | Harness | Seed / Run | Jevis acted | Winner | Margin | Checks bare | Checks Jevis | Turns bare / Jevis | Satisfied bare / Jevis | Agent min bare / Jevis |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const p of results) {
    const ok = (r) => (r.checks ? `${r.checks.filter((c) => c.ok).length}/${r.checks.length}` : "-");
    const turns = (r) => r.turns?.length ?? "-";
    const mins = (r) => (r.agentMs ? (r.agentMs / 60000).toFixed(1) : "-");
    lines.push(`| ${p.name} | ${p.harness} | ${p.seed} / ${p.repeat ?? 1} | ${acted(p.jevis) ? "yes" : "no"} | ${p.verdict.winner ?? `invalid: ${p.verdict.error}`} | ${p.verdict.margin ?? ""} | ${ok(p.base)} | ${ok(p.jevis)} | ${turns(p.base)} / ${turns(p.jevis)} | ${p.base.satisfied ?? "-"} / ${p.jevis.satisfied ?? "-"} | ${mins(p.base)} / ${mins(p.jevis)} |`);
  }
  lines.push("");

  const diffs = results.map((p) => ({ p, ...checkDiff(p) }));
  const regressions = diffs.flatMap((d) => d.regressions.map((r) => `${d.p.name}/${d.p.harness}/s${d.p.seed}/r${d.p.repeat ?? 1}: ${r}`));
  const improvements = diffs.flatMap((d) => d.improvements.map((r) => `${d.p.name}/${d.p.harness}/s${d.p.seed}/r${d.p.repeat ?? 1}: ${r}`));
  const repos = results.filter((p) => SCENARIOS[p.name]?.kind === "repo");
  const checks = (arm) => repos.flatMap((p) => p[arm].checks ?? []);
  const allPass = (r) => r.checks?.length > 0 && r.checks.every((c) => c.ok);
  const known = repos.filter((p) => p.base.checks?.length && p.jevis.checks?.length);
  lines.push("## Deterministic hidden checks (independent of judge)", "");
  lines.push(`Repo checks across ${repos.length} paired runs: bare ${checks("base").filter((c) => c.ok).length}/${checks("base").length} passed; Jevis ${checks("jevis").filter((c) => c.ok).length}/${checks("jevis").length} passed. All-check-pass outcomes: Jevis only ${known.filter((p) => allPass(p.jevis) && !allPass(p.base)).length}, bare only ${known.filter((p) => allPass(p.base) && !allPass(p.jevis)).length}, both ${known.filter((p) => allPass(p.base) && allPass(p.jevis)).length}, neither ${known.filter((p) => !allPass(p.base) && !allPass(p.jevis)).length}; ${repos.length - known.length} missing check results.`, "");
  lines.push("### Hidden checks that differ (all kinds, including judge errors)", "");
  lines.push(`Jevis newly passes (${improvements.length}):`, ...improvements.map((x) => `- ${x}`), "");
  lines.push(`Jevis newly fails (${regressions.length}):`, ...regressions.map((x) => `- ${x}`), "");

  const jv = results.map((p) => p.jevis.jevis ?? {});
  const calls = jv.reduce((n, j) => n + (j.calls ?? 0), 0);
  const errors = jv.flatMap((j) => j.jevErrors ?? []);
  const toolMs = jv.flatMap((j) => j.toolMs ?? []);
  const reviews = jv.flatMap((j) => j.reviews ?? []);
  const ratio = completed.filter((p) => p.base.agentMs && p.jevis.agentMs).map((p) => p.jevis.agentMs / p.base.agentMs);
  lines.push("## What Jevis did", "");
  lines.push(`- Hook calls: ${calls}; Jev errors (failed open): ${errors.length}${errors.length ? ` (${[...new Set(errors)].slice(0, 3).join("; ")})` : ""}`);
  lines.push(`- Edit and command checks: median ${median(toolMs)} ms, 95th percentile ${pct(toolMs, 0.95)} ms, max ${Math.max(0, ...toolMs)} ms`);
  lines.push(`- Design and film reviews: ${reviews.length} (${reviews.filter((r) => r.verdict === "fix").length} sent back, ${reviews.filter((r) => r.verdict === "ship").length} passed, ${reviews.filter((r) => r.error).length} failed open)`);
  lines.push(`- Notes shown: ${jv.reduce((n, j) => n + (j.notes?.length ?? 0) + (j.toolNotes?.length ?? 0), 0)}; refusals: ${jv.reduce((n, j) => n + (j.denies?.length ?? 0), 0)}; turn-end holds: ${jv.reduce((n, j) => n + (j.stopBlocks?.length ?? 0), 0)}`);
  lines.push(`- Agent time with Jevis relative to bare, whole conversation: median ×${median(ratio).toFixed(2)}`);
  const sat = (arm) => completed.filter((p) => p[arm].satisfied).length;
  const follow = (arm) => completed.reduce((n, p) => n + Math.max(0, (p[arm].turns?.length ?? 1) - 1), 0);
  lines.push(`- Simulated user satisfied: Jevis ${sat("jevis")} of ${completed.length}, bare ${sat("base")} of ${completed.length}; follow-up messages the user had to write: Jevis ${follow("jevis")}, bare ${follow("base")}`);
  lines.push("");

  const t = tally(gateActive);
  const gateSlices = [
    ...[...new Set(gateActive.map((p) => p.harness))].map((h) => [`harness: ${h}`, gateActive.filter((p) => p.harness === h)]),
    ...[...new Set(gateActive.map(areaOf))].map((a) => [`area: ${a}`, gateActive.filter((p) => areaOf(p) === a)]),
  ];
  const netOk = (pairs) => tally(pairs).jevis >= tally(pairs).base;
  const gates = [
    ["No harm: newly failed hidden checks ≤ newly passed", regressions.length <= improvements.length, `${regressions.length} newly failed, ${improvements.length} newly passed`],
    ["Net good: Jevis acted, more wins and sign-test p < 0.05", t.jevis > t.base && signTest(t.jevis, t.base) < 0.05, `${t.jevis} Jevis, ${t.base} bare, ${t.tie} ties, of ${gateActive.length} balanced pairs; p=${formatP(signTest(t.jevis, t.base))}`],
    ["Clear wins: Jevis's clear wins ≥ bare's", t.clearJevis >= t.clearBase, `${t.clearJevis} clear for Jevis, ${t.clearBase} clear for bare`],
    ["No slice net negative where Jevis acted", gateActive.length > 0 && gateSlices.every(([, pairs]) => netOk(pairs)), gateSlices.filter(([, pairs]) => !netOk(pairs)).map(([l]) => l).join(", ") || (gateActive.length ? "every balanced slice even or ahead" : "no balanced acted pairs")],
    ["Follow-ups: the user writes no more with Jevis", follow("jevis") <= follow("base"), `${follow("jevis")} with Jevis, ${follow("base")} bare`],
    ["Time: whole conversation ≤ 1.5× bare (median)", ratio.length > 0 && median(ratio) <= 1.5, `×${median(ratio).toFixed(2)}`],
    ["Every Jevis session ran its hooks", results.length > 0 && results.every((p) => !p.jevis.invalid && p.jevis.jevis?.calls > 0), `${results.filter((p) => !p.jevis.invalid && p.jevis.jevis?.calls > 0).length} of ${results.length} sessions with recorded hook calls`],
    ["Every pair has a valid current balanced judge aggregate", cohorts.length > 0 && eligible.length === cohorts.length, `${eligible.length} of ${cohorts.length}; legacy, incomplete orders, invalid votes or mismatched sample identities are ineligible`],
    ["Jev errors under 5% of calls", calls > 0 && errors.length / calls < 0.05, `${errors.length} of ${calls}`],
  ];
  lines.push("## Gates", "", "| Gate | Result | Evidence |", "|---|---|---|");
  for (const [name, pass, why] of gates) lines.push(`| ${name} | ${pass ? "pass" : "FAIL"} | ${why} |`);
  lines.push("", `**${gates.every((g) => g[1]) ? "All gates pass." : "Not proven: at least one gate fails."}**`, "");

  lines.push("## Judge notes", "");
  for (const p of results.filter((p) => !p.verdict.error)) {
    lines.push(`### ${p.name} / ${p.harness} / seed ${p.seed} / run ${p.repeat ?? 1}: ${p.verdict.winner} (${p.verdict.margin})`, "", p.verdict.why ?? "", "");
    if (p.verdict.problems_base?.length) lines.push(`Bare: ${p.verdict.problems_base.join("; ")}`, "");
    if (p.verdict.problems_jevis?.length) lines.push(`Jevis: ${p.verdict.problems_jevis.join("; ")}`, "");
  }
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, "utf8")));
  console.log(report(results));
}
