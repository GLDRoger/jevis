import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hash, ROOT } from "./build.mjs";
import { loadWiki, WIKI_ROOT } from "../../src/wiki.mjs";

export const lessonDigest = () =>
  hash(
    JSON.stringify(
      loadWiki([WIKI_ROOT])
        .entries.filter((entry) => ["prompt", "stop"].includes(entry.event))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );

/** Tool gates depend on the full lesson definitions (including when), the
 * fact producers, code predicates, gate evaluation and enabled configuration.
 */
export function toolFingerprint({
  wiki = loadWiki(),
  source = (name) => readFileSync(new URL(`../../src/${name}`, import.meta.url)),
  enable = process.env.JEVIS_ENABLE ?? "",
} = {}) {
  const files = ["bash-facts.mjs", "rules.mjs", "context.mjs", "shell.mjs", "wiki.mjs", "engine.mjs", "axes.mjs"];
  return hash(
    JSON.stringify({
      lessons: wiki.entries.filter((entry) => entry.event === "tool").sort((a, b) => a.id.localeCompare(b.id)),
      gateCode: Object.fromEntries(files.map((name) => [name, hash(source(name))])),
      enable,
    }),
  );
}

/** event=tool checks its own receipt without hiding or resetting the separate
 * known-contaminated stop receipt. The default guard checks both domains.
 */
export function guard(root = ROOT, digest = lessonDigest, { event = "all", fingerprint = toolFingerprint, allowContaminatedTest = false } = {}) {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root)));
  for (const [name, want] of Object.entries(manifest.hashes)) {
    if (hash(readFileSync(new URL(name, root))) !== want) throw new Error(`Frozen split changed: ${name}`);
  }
  const seen = new Map();
  for (const kind of ["stop", "tool"]) {
    for (const split of ["tune", "test"]) {
      for (const line of readFileSync(new URL(`${kind}-${split}.jsonl`, root), "utf8")
        .split("\n")
        .filter(Boolean)) {
        const row = JSON.parse(line),
          old = seen.get(row.sessionId);
        if (old && old !== split) throw new Error("Session leakage between tune and test");
        seen.set(row.sessionId, split);
      }
    }
  }
  const stopReceipt = new URL("test-read-receipt.json", root);
  if (event !== "tool" && existsSync(stopReceipt) && JSON.parse(readFileSync(stopReceipt)).lessonDigest !== digest()) {
    throw new Error("Lessons changed after test read: test results are contaminated. Do not tune against test.");
  }
  const toolReceipt = new URL("tool-test-read-receipt.json", root);
  if (event !== "stop" && existsSync(toolReceipt)) {
    const runs = JSON.parse(readFileSync(toolReceipt)).runs;
    const last = runs.at(-1);
    if (!allowContaminatedTest && (last.fingerprint !== fingerprint() || last.testHash !== manifest.hashes["tool-test.jsonl"])) {
      throw new Error("Tool lessons, gates or test labels changed after test read; explicitly record --allow-contaminated-test to remeasure.");
    }
  }
  return manifest;
}

/** Write before reading any test row, including failed/interrupted runs. A
 * repeat requires the explicit override even if nothing changed; history is
 * appended and never reset by re-freezing corrected labels.
 */
export function toolTestReceipt({
  root = ROOT,
  fingerprint = toolFingerprint(),
  testHash,
  allowContaminatedTest = false,
  now = new Date().toISOString(),
} = {}) {
  const file = new URL("tool-test-read-receipt.json", root);
  const exists = existsSync(file);
  const receipt = exists ? JSON.parse(readFileSync(file)) : { runs: [] };
  const legacyMeasurement = !exists && existsSync(new URL("tool-test-scores.json", root));
  if ((receipt.runs.length || legacyMeasurement) && !allowContaminatedTest)
    throw new Error("Tool test already measured; use --allow-contaminated-test to record an explicitly contaminated repeat.");
  receipt.runs.push({
    at: now,
    fingerprint,
    testHash,
    override: allowContaminatedTest ? "--allow-contaminated-test" : null,
    repeated: receipt.runs.length > 0 || legacyMeasurement,
    previousUnreceiptedMeasurement: legacyMeasurement,
  });
  writeFileSync(file, JSON.stringify(receipt, null, 2), { flag: exists ? "w" : "wx", mode: 0o600 });
  return receipt;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const manifest = guard();
  console.log(`Frozen hashes and global session-disjointness OK; ${Object.keys(manifest.hashes).length} split files.`);
}
