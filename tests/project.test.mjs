import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

// A private home, a project folder, and a scripted Jev: no network, no real state.
const base = realpathSync(mkdtempSync(join(tmpdir(), "jevis-project-")));
process.env.JEVIS_HOME = join(base, ".jevis");
for (const k of ["JEVIS_WIKI", "JEVIS_MODE", "JEVIS_SCOPE", "JEVIS_DISABLE", "JEVIS_ENABLE"]) delete process.env[k];
const { setJevTransport } = await import("../src/jev.mjs");
const { projectLessons, projectStatus, projectWiki, setTrust, wikiFor, wikiRoots, WIKI_ROOT } = await import("../src/wiki.mjs");
const { onPrompt } = await import("../src/hooks.mjs");

const repo = join(base, "repo");
const lessons = join(repo, ".jevis", "wiki");
const put = (id, text) => {
  mkdirSync(join(lessons, id, ".."), { recursive: true });
  writeFileSync(join(lessons, `${id}.md`), text);
};
const TEAM = "---\nevent: prompt\nask: Does `request` ask to change the billing code?\naction: context\ntitle: Billing changes need a second reviewer\nsource: team rule\n---\nAsk for a second reviewer on billing changes.\n";
put("team/billing", TEAM);
put("slop/marquee", "---\noff: true\n---\n");
put("safety/force-push", "---\noff: true\n---\n");
mkdirSync(join(repo, "src", "deep"), { recursive: true });

test("project lessons: the nearest .jevis/wiki is found from inside the repo, never Jevis's own home", () => {
  assert.equal(projectWiki(join(repo, "src", "deep")), lessons);
  // base/.jevis is JEVIS_HOME: its wiki is the user's own, already loaded, not a project's.
  mkdirSync(join(base, ".jevis", "wiki"), { recursive: true });
  assert.equal(projectWiki(base), null);
  assert.equal(projectWiki(null), null);
});

test("project lessons: untrusted ones never load; trusted ones load until a file changes", () => {
  const cwd = join(repo, "src");
  assert.deepEqual(projectStatus(cwd), { path: lessons, hash: projectStatus(cwd).hash, trusted: false, changed: false });
  assert.deepEqual(wikiRoots(cwd), [WIKI_ROOT, join(process.env.JEVIS_HOME, "wiki")]);
  assert.ok(!wikiFor(cwd).entries.some((e) => e.id === "team/billing"), "an untrusted project adds nothing");

  const l = projectLessons(lessons);
  assert.deepEqual(l.added.map((e) => e.id), ["team/billing"]);
  assert.deepEqual(l.off, ["slop/marquee"]);
  assert.deepEqual(l.broken.map((b) => b.id), ["safety/force-push"]);

  setTrust(lessons);
  if (process.platform !== "win32") assert.equal(statSync(join(process.env.JEVIS_HOME, "trusted.json")).mode & 0o777, 0o600);
  const w = wikiFor(cwd);
  const ids = new Set(w.entries.map((e) => e.id));
  assert.ok(ids.has("team/billing"), "a trusted project adds its lessons");
  assert.ok(!ids.has("slop/marquee"), "and can turn off a shipped one");
  assert.ok(ids.has("safety/force-push"), "but not a safety one");
  assert.match(w.broken.find((b) => b.id === "safety/force-push").errors[0], /cannot turn off or replace a safety entry/);

  appendFileSync(join(lessons, "team", "billing.md"), "One more line.\n");
  assert.equal(projectStatus(cwd).changed, true);
  assert.ok(!wikiFor(cwd).entries.some((e) => e.id === "team/billing"), "a changed project needs trusting again");
  setTrust(lessons);
  assert.ok(wikiFor(cwd).entries.some((e) => e.id === "team/billing"));
  setTrust(lessons, { remove: true });
  assert.equal(projectStatus(cwd).trusted, false);
});

test("project lessons: a hostile repository can neither stall a hook nor get around trust", { timeout: 10_000 }, () => {
  const evil = join(base, "evil");
  mkdirSync(join(evil, ".jevis", "wiki", "safety"), { recursive: true });
  writeFileSync(join(evil, ".jevis", "wiki", "safety", "force-push.md"), "---\noff: true\n---\n");
  // Windows has no FIFOs, and unprivileged symlinks need developer mode.
  if (process.platform !== "win32") {
    symlinkSync("/dev/urandom", join(evil, ".jevis", "wiki", "random.md"));
    execFileSync("mkfifo", [join(evil, ".jevis", "wiki", "pipe.md")]);
  }
  // Never trusted: not read at all, so neither the device nor the pipe is opened.
  assert.equal(projectStatus(evil).trusted, false);
  assert.ok(wikiFor(evil).entries.some((e) => e.id === "safety/force-push"));
  // Trusted: the symlink and the pipe are still not lessons, and the safety entry still stands.
  setTrust(projectWiki(evil));
  assert.equal(projectStatus(evil).trusted, true);
  assert.ok(wikiFor(evil).entries.some((e) => e.id === "safety/force-push"));
  setTrust(projectWiki(evil), { remove: true });

  // A relative JEVIS_WIKI would name every folder's .jevis/wiki: it is ignored.
  process.env.JEVIS_WIKI = `${WIKI_ROOT}${delimiter}.jevis/wiki`;
  try {
    assert.deepEqual(wikiRoots(evil), [WIKI_ROOT]);
  } finally {
    delete process.env.JEVIS_WIKI;
  }

  // A .jevis that links out of the repository is not the repository's lessons.
  const elsewhere = join(base, "elsewhere");
  mkdirSync(join(elsewhere, "wiki"), { recursive: true });
  mkdirSync(join(base, "linked"));
  if (process.platform !== "win32") {
    symlinkSync(elsewhere, join(base, "linked", ".jevis"));
    assert.equal(projectWiki(join(base, "linked")), null);
  }

  // A trust file that is valid JSON but not a record of folders is treated as trusting nothing.
  writeFileSync(join(process.env.JEVIS_HOME, "trusted.json"), "null");
  assert.equal(projectStatus(join(repo, "src")).trusted, false);
  assert.ok(wikiFor(join(repo, "src")).entries.length > 0);
});

test("project lessons: a hook in a trusted repo gives the project's note", async () => {
  setTrust(lessons);
  setJevTransport(async (body) => ({ answers: Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: k === "team/billing" ? 0.95 : 0.02 }])) }));
  const out = await onPrompt({ session_id: "p1", cwd: join(repo, "src"), prompt: "change the invoice rounding in billing.ts" });
  assert.match(out?.hookSpecificOutput?.additionalContext ?? "", /Billing changes need a second reviewer/);
  const elsewhere = await onPrompt({ session_id: "p2", cwd: base, prompt: "change the invoice rounding in billing.ts" });
  assert.equal(elsewhere, null, "outside the repo the project's lessons do not apply");
});
