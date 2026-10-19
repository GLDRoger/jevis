import { join } from "node:path";
import { jevisHome } from "./state.mjs";
import { eachJsonl } from "./transcript.mjs";
import { sinceTime } from "./tune.mjs";

const EVENTS = ["prompt", "tool", "stop", "review"];
const METRICS = ["calls", "logCalls", "input_tokens", "output_tokens"];
const tally = () => Object.fromEntries(METRICS.map((key) => [key, 0]));
const bucket = () => ({ ...tally(), events: Object.fromEntries(EVENTS.map((event) => [event, tally()])) });
const nonnegative = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
const price = (text) => text !== undefined && String(text).trim() !== "" && nonnegative(Number(text)) ? Number(text) : null;
const PRICE_HINT = "Set JEVIS_PRICE_IN and JEVIS_PRICE_OUT (USD per million tokens) in ~/.jevis/config.json to see dollars.";

/** Stream both records independently: log calls overlap recorded calls, never add them together. */
export function cost({ since = sinceTime("30d"), home = jevisHome(), now = Date.now() } = {}) {
  const byDay = new Map();
  // The projection reads only the last 24 hours: after a config change, a 3-day window still bills the old setup.
  const lastDay = { date: "last 24h", ...bucket() };
  const add = (row, fromLog) => {
    if (!row || !EVENTS.includes(row.event)) return;
    if (fromLog && (row.event === "review" || !nonnegative(row.ms) || row.ms <= 0 || row.skipped)) return;
    const at = Date.parse(row.at);
    if (!Number.isFinite(at) || at < since) return;
    const date = new Date(at).toISOString().slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, { date, ...bucket() });
    const day = byDay.get(date);
    const metrics = fromLog ? { logCalls: 1 } : {
      calls: 1, input_tokens: nonnegative(row.usage?.input_tokens) ? row.usage.input_tokens : 0,
      output_tokens: nonnegative(row.usage?.output_tokens) ? row.usage.output_tokens : 0,
    };
    for (const target of at >= now - 86_400_000 ? [day, lastDay] : [day]) {
      for (const [key, value] of Object.entries(metrics)) {
        target[key] += value;
        target.events[row.event][key] += value;
      }
    }
  };
  eachJsonl(join(home, "jev", "calls.jsonl"), (row) => add(row, false));
  eachJsonl(join(home, "log.jsonl"), (row) => add(row, true));
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (rows, scale = 1) => {
    const out = bucket();
    for (const row of rows) for (const key of METRICS) {
      out[key] += row[key] * scale;
      for (const event of EVENTS) out.events[event][key] += row.events[event][key] * scale;
    }
    return out;
  };
  const totals = sum(days);
  const projection = { days: 30, basedOn: "last 24 hours", ...sum([lastDay], 30) };
  const input = price(process.env.JEVIS_PRICE_IN);
  const output = price(process.env.JEVIS_PRICE_OUT);
  const prices = input !== null && output !== null ? { input, output } : null;
  for (const row of [...days, totals, projection]) for (const metrics of [row, ...Object.values(row.events)]) {
    metrics.dollars = prices ? (metrics.input_tokens * input + metrics.output_tokens * output) / 1_000_000 : null;
  }
  const averages = Object.fromEntries(EVENTS.map((event) => {
    const row = totals.events[event];
    return [event, { input_tokens: row.calls ? row.input_tokens / row.calls : 0, output_tokens: row.calls ? row.output_tokens / row.calls : 0 }];
  }));
  return { since: new Date(since).toISOString(), days, totals, averages, projection, prices, note: prices ? null : PRICE_HINT };
}

const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/** One row per day: model calls by hook, tokens, dollars when priced. */
export function formatCost(result) {
  const priced = result.prices !== null;
  const head = ["day", "calls", "prompt", "tool", "stop", "review", "tokens in", "out", ...(priced ? ["USD"] : [])];
  // With the call record off, only the decision log counts calls, and it has no tokens.
  const calls = (m) => (m.calls || !m.logCalls ? short(m.calls) : `${short(m.logCalls)}*`);
  const line = (label, row) => [label, calls(row), ...EVENTS.map((e) => calls(row.events[e])), short(row.input_tokens), short(row.output_tokens), ...(priced ? [`$${row.dollars.toFixed(2)}`] : [])];
  const rows = [head, ...result.days.map((d) => line(d.date, d)), line("total", result.totals), line("30d at last 24h", result.projection)];
  const width = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  ");
  const avg = EVENTS.filter((e) => result.totals.events[e].calls).map((e) => `${e} ${short(result.averages[e].input_tokens)} in / ${short(result.averages[e].output_tokens)} out`);
  return [
    `Decision-model calls since ${result.since.slice(0, 10)} (UTC days)`,
    "",
    ...rows.map(fmt),
    "",
    ...(avg.length ? [`Tokens per call: ${avg.join(", ")}`] : []),
    ...(result.days.some((d) => !d.calls && d.logCalls) ? ["* counted from the decision log: the call record was off, so no tokens"] : []),
    ...(result.note ? [result.note] : []),
  ].join("\n");
}
