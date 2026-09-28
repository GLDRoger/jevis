import { writeFileSync } from "node:fs";
import { evaluate } from "../src/engine.mjs";
import { loadWiki } from "../src/wiki.mjs";
import { AXES } from "../src/axes.mjs";

/** Real Jev answers for the scenarios the data-flow page shows. The states are written by hand; every answer is a live call. */
const wiki = loadWiki();
const ws = (files, git) => ({ git, files, empty: files.length === 0 });
const S = [
  { id: "prompt-open-page", event: "prompt", label: "New landing page, open brief", model: "gpt-6-sol", state: { request: "make me a landing page for my pottery studio", previous_request: null, attachments: [], workspace: ws([], false), agent: { harness: "Codex", model: "gpt-6-sol", origin: "person" } } },
  { id: "prompt-redesign", event: "prompt", label: "Existing app looks bad", model: "gpt-6-astra", state: { request: "the hero section looks horrible in this app. pleasse design a delightful professional design", previous_request: null, attachments: [], workspace: ws(["app/", "components/", "package.json", "tailwind.config.ts"], true), agent: { harness: "Codex", model: "gpt-6-astra", origin: "person" } } },
  { id: "prompt-question", event: "prompt", label: "A question, no work", model: "claude-opus-5-5", state: { request: "does this library support claude code's subagents too?", previous_request: null, attachments: [], workspace: ws(["src/", "tests/", "README.md", "package.json"], true), agent: { harness: "Claude Code", model: "claude-opus-5-5", origin: "person" } } },
  { id: "tool-reset", event: "tool", tool: "Bash", label: "git reset --hard, unasked", model: "gpt-6-sol", state: { request: "clean up the repo", tool: "Bash", input: "git reset --hard HEAD~2", workspace: ws(["src/", "package.json"], true) } },
  { id: "tool-force-asked", event: "tool", tool: "Bash", label: "Force push the user asked for", model: "gpt-6-sol", state: { request: "squash my last 3 commits and force push the branch", tool: "Bash", input: "git push --force-with-lease origin feature/x", workspace: ws(["src/", "package.json"], true) } },
  { id: "tool-headed", event: "tool", tool: "Bash", label: "Visible Chrome window for QA", model: "gpt-6-astra", state: { request: "run the qa pass on the checkout page", tool: "Bash", input: 'open -a "Google Chrome" http://localhost:5173/checkout', workspace: ws(["src/", "package.json"], true) } },
  { id: "tool-test", event: "tool", tool: "Bash", label: "An ordinary test run", model: "gpt-6-sol", state: { request: "fix the null user crash on the settings page", tool: "Bash", input: "pnpm vitest run src/settings/user.test.ts", workspace: ws(["src/", "package.json"], true) } },
];
// Two turn endings, written to match real ones in shape (the originals came from private client work).
// A deploy reported done on green tests, with no check of the deployed function itself:
S.push({
  id: "stop-deploy", event: "stop", label: "Deployed on green tests", model: "gpt-6-sol",
  next: "downloads now show \"Failed to generate report. Please retry or use a smaller scope\". check the logs and fix it",
  state: {
    request: "the monthly stock report times out for big stores. make it stream and deploy it",
    final_message: "Done. The report now streams rows instead of building the whole file in memory, and I deployed the new version of generate-report. All 48 tests pass.",
    evidence: { edited: true, files_changed: ["functions/generate-report/index.ts", "functions/generate-report/stream.ts", "functions/generate-report/stream.test.ts"], files_changed_count: 3, ui_files_changed: [], actions_after_last_edit: ["exit 0: npm test", "tool deploy_function generate-report"], recent_actions: ["exit 0: cat functions/generate-report/index.ts", "exit 0: npm test", "tool deploy_function generate-report"], commands_run: 14, used_subagents: false },
  },
});
// UI work that was looked at in a browser before the agent said it was done:
S.push({
  id: "stop-checked", event: "stop", label: "UI work, checked in the browser", model: "gpt-6-sol",
  next: "looks good. now add the same filter to the archive page",
  state: {
    request: "add a status filter to the orders page",
    final_message: "Added a status filter above the orders table (All, Open, Shipped, Cancelled). I checked it in a headless browser at 1440 and 390 px: the filter narrows the rows, the empty state shows when nothing matches, and the URL keeps the choice on reload. Lint and typecheck pass.",
    evidence: { edited: true, files_changed: ["src/app/orders/page.tsx", "src/components/status-filter.tsx"], files_changed_count: 2, ui_files_changed: ["src/app/orders/page.tsx", "src/components/status-filter.tsx"], actions_after_last_edit: ["exit 0: pnpm lint && pnpm typecheck", "tool browser screenshot http://localhost:3000/orders at 1440px", "tool browser screenshot http://localhost:3000/orders at 390px"], recent_actions: ["exit 0: pnpm lint && pnpm typecheck", "tool browser screenshot http://localhost:3000/orders at 1440px", "tool browser screenshot http://localhost:3000/orders at 390px"], commands_run: 9, used_subagents: false },
  },
});

const out = [];
for (const s of S) {
  const r = await evaluate({ event: s.event, state: s.state, tool: s.tool ?? null, model: s.model, record: false, wiki, timeoutMs: 10000 });
  const pool = Object.keys(r.scores);
  out.push({
    ...s,
    ms: r.ms,
    profile: r.profile,
    asked: pool.length,
    entries: pool.map((id) => {
      const e = wiki.entries.find((x) => x.id === id);
      return { id, title: e.title, action: e.action, min: e.min, p: r.scores[id], unless: r.unless[id] ?? null, unless_max: e.unless_max ?? null, when: e.when, fired: r.fired.some((f) => f.id === id), body: e.body };
    }).sort((x, y) => y.p - x.p),
  });
  console.log(s.id, r.ms, "ms", r.fired.map((f) => f.id).join(", ") || "-", r.error ?? "");
}
const counts = { entries: wiki.entries.length, byEvent: Object.fromEntries(["prompt", "tool", "stop"].map((e) => [e, wiki.entries.filter((x) => x.event === e).length])), byAction: Object.fromEntries(["context", "deny", "block"].map((a) => [a, wiki.entries.filter((x) => x.action === a).length])) };
const axes = Object.fromEntries(Object.entries(AXES).map(([ev, qs]) => [ev, Object.fromEntries(Object.entries(qs).map(([k, q]) => [k, q.instructions]))]));
writeFileSync(new URL("../docs/scenarios.json", import.meta.url), JSON.stringify({ captured: new Date().toISOString(), counts, axes, scenarios: out }, null, 1));
