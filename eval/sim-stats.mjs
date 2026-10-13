/** Pure aggregation shared by the judge and the offline report. */
export function positiveInt(value, name) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Strict majority of ALL requested votes; a split/plurality is a tie. Errors are not votes. */
export function majority(votes, choices = ["a", "b", "tie"]) {
  const counts = Object.fromEntries(choices.map((w) => [w, 0]));
  if (!votes.length || votes.some((v) => v.error || !choices.includes(v.winner))) {
    return { error: "Incomplete or invalid votes", counts };
  }
  for (const v of votes) counts[v.winner]++;
  const winner = choices.find((w) => counts[w] > votes.length / 2) ?? "tie";
  const clear = winner !== "tie" && votes.filter((v) => v.winner === winner && v.margin === "clear").length > votes.length / 2;
  return { winner, margin: clear ? "clear" : "slight", counts };
}

/** Both presentation orders must independently agree on the same non-tie winner. */
export function balancedVerdict(orders) {
  if (orders.length !== 2 || orders.some((o) => o.error || !["a", "b", "tie"].includes(o.winner))) {
    return { error: "Both presentation orders need valid votes" };
  }
  const winner = orders[0].winner === orders[1].winner ? orders[0].winner : "tie";
  return { winner, margin: winner !== "tie" && orders.every((o) => o.margin === "clear") ? "clear" : "slight" };
}

/** Two-sided exact binomial sign test under p=0.5, excluding ties. */
export function signTest(wins, losses) {
  if (![wins, losses].every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("Sign-test counts must be nonnegative integers");
  const n = wins + losses;
  if (!n) return 1;
  let term = -n * Math.log(2);
  let sum = term;
  for (let i = 1; i <= Math.min(wins, losses); i++) {
    term += Math.log(n - i + 1) - Math.log(i);
    const max = Math.max(sum, term);
    sum = max + Math.log(Math.exp(sum - max) + Math.exp(term - max));
  }
  return Math.min(1, 2 * Math.exp(sum));
}

/** Repeated runs are paired by repeat index, not all R² cross-products. */
export function aggregateRuns(results, didAct) {
  const groups = new Map();
  for (const p of results) {
    const key = JSON.stringify([p.name, p.harness, p.seed]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()].map((runs) => {
    const actions = runs.map((p) => didAct(p.jevis));
    const intervention = actions.every(Boolean) ? "acted" : actions.some(Boolean) ? "mixed" : "silent";
    const duplicate = new Set(runs.map((p) => p.repeat ?? 1)).size !== runs.length;
    const verdict = duplicate ? { error: "Duplicate repeat index in input summaries" }
      : runs.length === 1 ? runs[0].verdict : {
        ...majority(runs.map((p) => p.verdict), ["base", "jevis", "tie"]),
        why: `Strict majority across ${runs.length} paired runs; see individual run verdicts below.`,
      };
    return { ...runs[0], runs, intervention, verdict };
  });
}
