import { join } from "node:path";
import { inputMarks } from "./context.mjs";
import { jevisHome } from "./state.mjs";
import { recoverToolInputs } from "./tool-recovery.mjs";
import { eachJsonl } from "./transcript.mjs";
import { applies, candidates, factsHold, loadWiki } from "./wiki.mjs";

/** Offline and read-only. No Jev, session/state writes, or raw inputs in the
 * report. Only full original or unambiguously recovered inputs are assessed.
 * Historical permission/history remain unknown, never inferred from fires.
 */
export function gateReplay({ file = join(jevisHome(), "log.jsonl"), wiki = loadWiki(), recover = recoverToolInputs, recovery = {} } = {}) {
  const rows = [];
  eachJsonl(file, (row) => {
    if (row.event === "tool" && row.tool === "Bash" && !row.skipped) rows.push(row);
  });
  const clipped = (row) => typeof row.input !== "string" || row.input.endsWith("…");
  const recovered = recover ? recover(rows.filter(clipped), recovery) : new Map();
  const report = { judged: rows.length, clipped: 0, recovered: 0, assessable: 0, unauditable: 0, assessableFires: 0, unauditableFires: 0, skipped: 0, skipPercent: 0, assessableSkipPercent: 0, savedMs: 0, lostFires: 0, lostRows: 0, missingLessons: {}, losses: [], byLesson: {} };
  const entries = new Map(wiki.entries.map((entry) => [entry.id, entry]));
  for (const row of rows) {
    const wasClipped = clipped(row);
    if (wasClipped) report.clipped++;
    const input = wasClipped ? recovered.get(row) : row.input;
    const fired = [...new Set([...(row.fired ?? []).map((entry) => typeof entry === "string" ? entry : entry.id), ...(row.acted ?? [])])];
    if (typeof input !== "string" || input.endsWith("…")) {
      report.unauditable++;
      report.unauditableFires += fired.length;
      continue;
    }
    report.assessable++;
    report.assessableFires += fired.length;
    if (wasClipped) report.recovered++;
    const state = { tool: "Bash", input, marks: inputMarks(input, { tool: "Bash", ranBefore: true }) };
    const opts = { event: "tool", tool: "Bash", model: row.model ?? (row.harness === "Claude Code" ? "claude-unknown" : null) };
    const pool = candidates(wiki.entries, opts).filter((entry) => factsHold(entry.when, { event: "tool", state }));
    if (!pool.length) {
      report.skipped++;
      report.savedMs += Math.max(0, Number(row.ms) || 0);
    }
    let lost = false;
    for (const id of fired) {
      const entry = entries.get(id);
      if (!entry) { report.missingLessons[id] = (report.missingLessons[id] ?? 0) + 1; continue; }
      // Audit optional lessons even when currently disabled.
      if (applies(entry, opts) && factsHold(entry.when, { event: "tool", state })) continue;
      report.lostFires++;
      report.byLesson[id] = (report.byLesson[id] ?? 0) + 1;
      lost = true;
      // No timestamps/session pointers, command text or marks derived from it.
      if (report.losses.length < 30) report.losses.push({ id, recovered: wasClipped });
    }
    if (lost) report.lostRows++;
  }
  report.skipPercent = report.judged ? Math.round(report.skipped / report.judged * 10_000) / 100 : 0;
  report.assessableSkipPercent = report.assessable ? Math.round(report.skipped / report.assessable * 10_000) / 100 : 0;
  return report;
}

export const formatGateReplay = (report) => [
  `Bash judged: ${report.judged}; originally clipped/unknown: ${report.clipped}; recovered: ${report.recovered}`,
  `Assessable: ${report.assessable} rows / ${report.assessableFires} historical fires; unauditable: ${report.unauditable} rows / ${report.unauditableFires} historical fires`,
  `Would skip: ${report.skipped}/${report.judged} (${report.skipPercent}% overall; ${report.assessableSkipPercent}% of assessable rows)`,
  `Lost fires: ${report.lostFires} (${report.lostRows} assessable rows); no lost-fire claim for unauditable rows; missing lessons: ${JSON.stringify(report.missingLessons)}`,
  `Estimated cumulative hook wait saved: ${report.savedMs} ms (${(report.savedMs / 60_000).toFixed(2)} min); not elapsed session wall time`,
  ...(report.lostFires ? [JSON.stringify(report.byLesson), JSON.stringify(report.losses, null, 2)] : []),
].join("\n");
