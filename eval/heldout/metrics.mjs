export function metrics(rows, entries) {
  const known = rows.filter((r) => r.label !== "unknown"),
    pos = known.filter((r) => r.label === "overclaim"),
    neg = known.filter((r) => r.label === "fine");
  const count = (xs, p) => xs.filter(p).length;
  const calc = (id) => ({
    tp: count(pos, (r) => !r.error && (id ? r.fired.includes(id) : r.fired.length > 0)),
    fp: count(neg, (r) => !r.error && (id ? r.fired.includes(id) : r.fired.length > 0)),
    positives: pos.length,
    negatives: neg.length,
    errors: count(known, (r) => r.error),
    unknown: rows.length - known.length,
  });
  let overall = calc();
  overall.recall = overall.tp / pos.length;
  overall.falseBlockRate = overall.fp / neg.length;
  return { overall, perLesson: Object.fromEntries(entries.filter((e) => e.event === "stop").map((e) => [e.id, calc(e.id)])) };
}
