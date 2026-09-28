import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { ensureDir, jevisHome } from "./state.mjs";
import { redact } from "./redact.mjs";
import { loadWiki } from "./wiki.mjs";

/**
 * The reviewers: when a turn ends on visual work, Jevis renders what the agent
 * made and has Claude judge it as a design director, the eye Codex lacks. A
 * film gets frames sampled across its runtime instead of page screenshots.
 *
 * The review returns "now A, instead X" items that go back to the agent as a
 * stop block, at most REVIEW_ROUNDS times a turn. Rendering is only the
 * critic's eyes: there is no metric gate. Everything fails open.
 *
 * Carried over from an earlier hook system's critic and film review; its QA
 * thresholds are retired.
 */

export const REVIEW_ROUNDS = 2;
/**
 * A follow-up turn is the user's own targeted fix, and the user looks at the
 * result: in 72 simulated sessions (Sep 27 2026), no second round on a
 * follow-up turn sent the agent back (0 of 6), so follow-ups get one.
 */
export const FOLLOW_UP_ROUNDS = 1;
/** Rounds for this turn: the first turn with a review gets REVIEW_ROUNDS, later turns FOLLOW_UP_ROUNDS. */
export const roundsFor = (session) => (session.firstReviewTurn != null && session.firstReviewTurn < session.turn ? FOLLOW_UP_ROUNDS : REVIEW_ROUNDS);
export const CRITIC_TIMEOUT_MS = 240_000;
const MAX_TARGETS = 2;
const PAGE_MAX_HEIGHT = 5000;
const FILM_SAMPLES = 8;
const FILM_MAX_SECONDS = 40;
const STATIC_DIFF = 10;

const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s'"`)<>\]\\]*)?/g;

/** Local URLs named in the turn's commands, tool calls, and final message, most recent first. */
export function findUrls(texts) {
  const seen = new Set();
  const out = [];
  for (const text of [...texts].reverse()) {
    for (const m of String(text).match(LOCAL_URL) ?? []) {
      const url = m.replace("0.0.0.0", "localhost").replace(/[.,;:]+$/, "");
      const origin = url.replace(/^(https?:\/\/[^/]+).*$/, "$1");
      if (seen.has(origin)) continue;
      seen.add(origin);
      out.push(url);
    }
  }
  return out;
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: "follow" });
    return res.status < 500;
  } catch {
    return false;
  }
}

/** Ports whose listening process runs from inside `cwd`: the project's own dev server, not someone else's on the same machine. */
export function projectPorts(cwd) {
  if (!cwd || process.platform === "win32") return [];
  try {
    const listen = execFileSync("lsof", ["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-u", String(process.getuid()), "-Fpn"], { encoding: "utf8", timeout: 2000 });
    const ports = new Map();
    let pid = null;
    for (const line of listen.split("\n")) {
      if (line.startsWith("p")) pid = line.slice(1);
      else if (line.startsWith("n") && pid) {
        const port = line.match(/:(\d+)$/)?.[1];
        if (port) ports.set(port, pid);
      }
    }
    return [...ports].filter(([, p]) => {
      try {
        const where = execFileSync("lsof", ["-a", "-p", p, "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 1000 }).split("\n").find((l) => l.startsWith("n"))?.slice(1);
        return where && (where === cwd || where.startsWith(`${cwd}/`));
      } catch {
        return false;
      }
    }).map(([port]) => Number(port));
  } catch {
    return [];
  }
}

/**
 * What to look at. A page the agent served or opened wins over a file on
 * disk (file:// breaks module scripts and fetches); then a dev server running
 * from this project; then the HTML files the turn changed.
 */
export async function renderTargets({ files = [], cwd, texts = [] }) {
  const urls = [];
  for (const url of findUrls(texts)) if (urls.length < MAX_TARGETS && (await reachable(url))) urls.push(url);
  if (urls.length) return urls;
  for (const port of projectPorts(cwd)) {
    const url = `http://localhost:${port}/`;
    if (urls.length < MAX_TARGETS && (await reachable(url))) urls.push(url);
  }
  if (urls.length) return urls;
  return files.filter((f) => /\.html?$/i.test(f)).map((f) => resolve(cwd ?? ".", f)).filter((f) => existsSync(f)).slice(0, MAX_TARGETS).map((f) => pathToFileURL(f).href);
}

const slug = (url) => url.replace(/^\w+:\/\//, "").replace(/[^\w.-]+/g, "_").slice(-60);

async function launch() {
  const { chromium } = await import("playwright-core");
  // Headless and muted: no window takes focus and nothing plays aloud while the user works.
  return chromium.launch({ channel: "chrome", headless: true, args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

function watch(page, errors) {
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
}

async function shoot(page, file, maxHeight) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
  const width = page.viewportSize().width;
  await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y: 0, width, height: Math.min(height, maxHeight) } });
}

/** Page screenshots: the first screen and the page at 1440, the page at 390, and dark mode when the page has one. */
async function capturePage(browser, url, dir, i) {
  const shots = [];
  const facts = [];
  const errors = [];
  const name = `${i + 1}-${slug(url)}`;
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(desk, errors);
  await desk.goto(url, { waitUntil: "load", timeout: 30_000 });
  await desk.waitForTimeout(1200);
  const top = join(dir, `${name}-1440-top.png`);
  await desk.screenshot({ path: top });
  shots.push({ file: top, what: `${url} at 1440x900, the first screen` });
  const full = join(dir, `${name}-1440-page.png`);
  await shoot(desk, full, PAGE_MAX_HEIGHT);
  shots.push({ file: full, what: `${url} at 1440 wide, the page from the top (up to ${PAGE_MAX_HEIGHT}px)` });
  const dark = await desk.evaluate(() => [...document.styleSheets].some((s) => {
    try {
      return [...s.cssRules].some((r) => r.media && /prefers-color-scheme:\s*dark/.test(r.media.mediaText));
    } catch {
      return false;
    }
  })).catch(() => false);
  if (dark) {
    await desk.emulateMedia({ colorScheme: "dark" });
    await desk.waitForTimeout(300);
    const file = join(dir, `${name}-1440-dark.png`);
    await desk.screenshot({ path: file });
    shots.push({ file, what: `${url} at 1440x900 in dark mode` });
  }
  await desk.close();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  watch(phone, errors);
  await phone.goto(url, { waitUntil: "load", timeout: 30_000 });
  await phone.waitForTimeout(1000);
  // Measured against 390 itself: with mobile emulation, an overflowing page widens the layout viewport instead of scrolling.
  const overflow = await phone.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - 390).catch(() => 0);
  if (overflow > 1) facts.push(`At 390px the page is ${overflow}px wider than the screen (it scrolls sideways).`);
  const file = join(dir, `${name}-390-page.png`);
  await shoot(phone, file, PAGE_MAX_HEIGHT);
  shots.push({ file, what: `${url} at 390 wide (a phone), the page from the top` });
  await phone.close();
  if (errors.length) facts.push(`The page logged ${errors.length} error(s): ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
  return { shots, facts };
}

const START = /^\s*(▶|►)?\s*(play|start|launch|begin|enter|go|watch|run|press)\b|^\s*(▶|►)\s*$/i;

/** Press the piece's start control, or the middle of the screen when it has none. */
async function start(page) {
  const label = await page.evaluate((source) => {
    const re = new RegExp(source, "i");
    const el = [...document.querySelectorAll("button, [role=button], a")].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.disabled && re.test((e.innerText || e.getAttribute("aria-label") || "").trim());
    });
    if (!el) return null;
    el.setAttribute("data-jevis-start", "1");
    return (el.innerText || el.getAttribute("aria-label")).trim().slice(0, 40);
  }, START.source);
  if (label) {
    await page.click("[data-jevis-start]", { timeout: 5000 });
    return `pressed "${label}"`;
  }
  const box = page.viewportSize();
  await page.mouse.click(box.width / 2, box.height / 2);
  return "clicked the middle (no start control found)";
}

/** Mean grey difference between two frames at 48x30, on 0 to 255: under STATIC_DIFF the picture barely moved. */
function frameDiff(page, a, b) {
  return page.evaluate(async ([x, y]) => {
    const grey = async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(48, 30);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 48, 30);
      const d = g.getImageData(0, 0, 48, 30).data;
      const out = new Float32Array(48 * 30);
      for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      return out;
    };
    const [p, q] = await Promise.all([grey(x), grey(y)]);
    let sum = 0;
    for (let i = 0; i < p.length; i++) sum += Math.abs(p[i] - q[i]);
    return Math.round((sum / p.length) * 10) / 10;
  }, [a.toString("base64"), b.toString("base64")]);
}

/**
 * Film frames. A piece that exposes renderAt(t) with FILM_LENGTH (or the
 * canvas-film FILM.draw contract) is sampled as stills across its whole
 * length; anything else plays in real time for up to FILM_MAX_SECONDS.
 */
async function captureFilm(browser, url, dir) {
  const errors = [];
  const facts = [];
  const shots = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(page, errors);
  await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(1200);
  const intro = join(dir, "film-intro.png");
  await page.screenshot({ path: intro });
  shots.push({ file: intro, what: "before pressing play" });
  const frameHooks = () =>
    page.evaluate(() => {
      const F = window.FILM;
      if (typeof window.renderAt !== "function" && F && typeof F.draw === "function" && F.N && F.FPS) {
        window.renderAt = (t) => F.draw(Math.min(F.N - 1, Math.round(t * F.FPS)));
        window.FILM_LENGTH = F.N / F.FPS;
      }
      return { renderAt: typeof window.renderAt === "function", length: Number(window.FILM_LENGTH) || null, contract: !!(F && typeof F.draw === "function") };
    });
  let hooks = await frameHooks();
  let started;
  if (hooks.renderAt && hooks.length) {
    // Seeking stills while the page's own player runs lets the player draw over them. A canvas film is
    // reloaded in its render mode (?render=1 keeps the preview player off) and play is never pressed.
    if (hooks.contract) {
      const u = new URL(url);
      u.searchParams.set("render", "1");
      await page.goto(u.href, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(800);
      hooks = await frameHooks();
    }
    started = "not pressed: frames were drawn directly through renderAt(t)";
  } else started = await start(page).catch((e) => `start failed: ${e.message.slice(0, 120)}`);
  const stills = hooks.renderAt && hooks.length;
  const duration = stills ? hooks.length : Math.min(hooks.length ?? FILM_MAX_SECONDS, FILM_MAX_SECONDS);
  const t0 = Date.now();
  let previous = null;
  const diffs = [];
  for (let i = 1; i <= FILM_SAMPLES; i++) {
    const at = Math.round((duration * i * 10) / (FILM_SAMPLES + 1)) / 10;
    if (stills) {
      await page.evaluate((t) => Promise.resolve(window.renderAt(t)), at);
      await page.waitForTimeout(250);
    } else await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
    const buf = await page.screenshot();
    const file = join(dir, `film-${String(at).padStart(5, "0")}s.png`);
    writeFileSync(file, buf);
    shots.push({ file, what: `${at}s` });
    if (previous) diffs.push({ at, diff: await frameDiff(page, previous, buf) });
    previous = buf;
  }
  await page.close();
  facts.push(stills ? `Sampled as stills over the full ${duration}s through renderAt(t).` : `Played in real time for ${duration}s${hooks.length ? ` of ${hooks.length}s` : ""}; frames after that were not seen.`);
  facts.push(`Start: ${started}.`);
  const still = diffs.filter((d) => d.diff < STATIC_DIFF);
  if (still.length) facts.push(`The picture barely changed going into ${still.map((d) => `${d.at}s`).join(", ")} (mean change under ${STATIC_DIFF}/255).`);
  if (errors.length) facts.push(`The page logged ${errors.length} error(s): ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
  return { shots, facts };
}

const VIDEO = /\.(mp4|mov|webm)$/i;

function newestVideo(cwd, depth = 4) {
  let best = null;
  const walk = (dir, d) => {
    let list = [];
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (d > 0) walk(p, d - 1);
      } else if (VIDEO.test(e.name)) {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.mtime) best = { file: p, mtime: m };
      }
    }
  };
  walk(cwd, depth);
  return best;
}

/**
 * What a film's rendered video adds to the frames: the soundtrack as a
 * spectrogram, its measured levels, and whether the file is older than the
 * source it was rendered from. Nothing when there is no video or no ffmpeg.
 */
export function filmSound({ cwd, dir, files = [] }) {
  const video = newestVideo(cwd);
  if (!video) return { shots: [], facts: ["No rendered video file was found, so the soundtrack was not checked."] };
  const facts = [];
  const shots = [];
  const newestSource = Math.max(0, ...files.filter((f) => !VIDEO.test(f)).map((f) => resolve(cwd, f)).filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs));
  if (newestSource > video.mtime + 1000) facts.push(`The video ${video.file} is older than the source changed this turn: the user would watch a cut without these changes.`);
  try {
    const spec = join(dir, "film-spectrogram.png");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", video.file, "-lavfi", "showspectrumpic=s=1600x400:legend=1:scale=log", spec], { timeout: 120_000, stdio: "ignore" });
    shots.push({ file: spec, what: `spectrogram of the soundtrack of ${video.file} over its whole runtime (seconds along the top)` });
    // ebur128 prints its summary on stderr.
    const loud = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", video.file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", timeout: 120_000 }).stderr ?? "";
    const summary = loud.slice(loud.lastIndexOf("Summary:"));
    const I = summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1];
    const peak = summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1];
    if (I) facts.push(`Soundtrack: ${I} LUFS integrated, ${peak ?? "?"} dBFS true peak.`);
  } catch (e) {
    facts.push(`The soundtrack could not be analysed: ${String(e.message).split("\n")[0].slice(0, 120)}`);
  }
  return { shots, facts };
}

/** Render every target into `dir`. Returns the screenshots with captions and the facts the critic should know. */
export async function capture(targets, { dir, film = false }) {
  const browser = await launch();
  try {
    const out = { shots: [], facts: [] };
    for (const [i, url] of targets.entries()) {
      try {
        const r = film ? await captureFilm(browser, url, dir) : await capturePage(browser, url, dir, i);
        out.shots.push(...r.shots);
        out.facts.push(...r.facts);
      } catch (e) {
        out.facts.push(`Could not render ${url}: ${e.message.split("\n")[0].slice(0, 160)}`);
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

/** The telltales the critic should flag: every slop entry's title and the first line of its "Instead". */
export function telltales(wiki = loadWiki()) {
  return wiki.entries.filter((e) => e.id.startsWith("slop/")).map((e) => `${e.title}: ${e.body.split("\n")[0].replace(/\s+/g, " ").slice(0, 160)}`);
}

/** Design lessons this session already gave the agent, so the critic holds it to them. */
export function lessonsShown(shown, wiki = loadWiki()) {
  return wiki.entries.filter((e) => shown?.[e.id] !== undefined && /^(design|writing)\//.test(e.id)).map((e) => {
    const instead = e.body.match(/Instead:([^\n]+)/)?.[1]?.trim();
    return `${e.title}${instead ? `: ${instead}` : ""}`;
  });
}

/** The user's own design law, when there is one: JEVIS_DESIGN_LAW, else ~/.jevis/design-law.md, ~/.claude/slop.md, or ~/.codex/slop.md. */
export function designLaw() {
  const candidates = [process.env.JEVIS_DESIGN_LAW, join(jevisHome(), "design-law.md"), join(homedir(), ".claude", "slop.md"), join(homedir(), ".codex", "slop.md")].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function criticPrompt({ kind, request, firstRequest = null, targets, shots, facts, files, telltales: tells, lessons, round, of = REVIEW_ROUNDS, law = designLaw() }) {
  const film = kind === "film";
  return [
    film
      ? "You are a film director and editor reviewing a piece another agent just made. You did not make it. Judge it the way a demanding director at a top studio would, against what the user asked."
      : "You are a design director reviewing an interface another agent just built. You did not build it. Judge it the way a demanding senior product designer at a top studio would, against what the user asked.",
    "",
    firstRequest ? `The conversation began with:\n"""${firstRequest}"""\n\nThe user's latest message:` : "The user asked:",
    `"""${request}"""`,
    "",
    `Rendered from: ${targets.join(", ")}`,
    files?.length ? `Files changed this turn: ${files.join(", ")}` : "",
    "",
    "Open every one of these images with the Read tool before you judge anything:",
    ...shots.map((s) => `- ${s.file}: ${s.what}`),
    facts.length ? "\nFacts from rendering it:" : "",
    ...facts.map((f) => `- ${f}`),
    "",
    film
      ? [
          "Judge it as a stranger watching once, the way a seasoned director would:",
          "- Can you say what happens in each beat from the frames and the words on screen alone? A story that needs its maker to explain it is the first thing to fix. When the picture cannot carry it, a short typed line per beat that says what is happening, landing with its event, is the proven fix.",
          "- Continuity: one world changing in place, cuts that land on an action, a character that keeps its size and screen direction. Hard cuts to a new set on a steady clock read as a slideshow.",
          "- Pacing: each beat holds until it reads, the ideas build on each other, and the ending echoes the opening.",
          "- The world obeys its own physics: things rest on, hang from, or fall; cause comes before effect; the scenery places the action instead of repeating one backdrop.",
          "- Character comes from what it does and a design specific to its world, not clip-art smiley faces on objects.",
          "- Sound, from the spectrogram when there is one: the bar is a score that follows the arc (a bed, a build, a riser into the turn, a hit on it, a release) with a sound on each visible action. A looping pattern that ignores the picture, dead gaps, walls of noise, or buzz reaching 20 kHz are problems.",
          "Also judge the opening image, the motion and camera, type on screen, color and light. Frames are samples: judge what they show.",
        ].join("\n")
      : "Judge: hierarchy (what the eye hits first, and whether that is right for the request), typography, spacing rhythm, color roles, whether the copy is specific to this product or could sit on any site, the phone layout, and the states you can confirm by reading the changed source (hover, focus, empty, loading, error). Read the source when a screenshot leaves a question open.",
    "",
    law && !film ? `This user keeps a design law at ${law}. Read the whole file with the Read tool before judging: it names the slop tells (fonts, colors, components, and whole-page layouts such as the default hero stack, the kicker-over-heading section head, and the SaaS page skeleton) and what the premium version looks like. Judge against it; where the user's request conflicts with it, the request wins.` : "",
    "Telltales of generated design. Each one you see is a must-fix unless the user asked for it:",
    ...tells.map((t) => `- ${t}`),
    lessons.length ? "\nLessons this user's past sessions taught, already given to the agent:" : "",
    ...lessons.map((l) => `- ${l}`),
    "",
    film ? "" : "Content: the page must give its visitor what they need to act on it. For a business, that is what it is, when, where, how much, and the next step. Facts the user did not give that a visitor acts on (email, phone, address, booking link) stay as one clearly marked placeholder each. Descriptive details (times, prices, class names) may be plausible examples, as long as the final message lists each one for the owner to confirm; a page made mostly of bracketed placeholders is not a design, and neither is one with the need cut. Never ask the agent to cut useful content just to tighten a layout.",
    "Judge the palette by whether it fits this product, not by how dark or premium it looks: do not push a light page dark.",
    "If the project had a look before this turn, the job was to fit it, not to restyle it.",
    round > 1 ? `This is review round ${round} of ${of}. The agent already revised once after your notes. Ask for more only where something is still clearly wrong.` : `This is review round 1 of ${of}.`,
    "",
    "Reply with JSON only, no prose around it:",
    '{"verdict":"ship"|"fix","must_fix":[{"now":"what is there now, concretely: the element, where, which screenshot","instead":"exactly what to do instead"}],"keep":"the strongest thing to keep"}',
    'At most 5 must_fix items, most consequential first. Send it back only for problems a demanding user would reject the work for; each round costs the user minutes of agent time. When only polish remains (a repeated sentence, a word choice), say "ship". Do not invent problems to have something to say.',
  ].filter((l) => l !== "").join("\n");
}

/** The first JSON object in a reply, validated to the review shape; null when there is none. */
export function parseReview(text) {
  const s = String(text ?? "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const r = JSON.parse(s.slice(a, b + 1));
    if (r.verdict !== "ship" && r.verdict !== "fix") return null;
    const items = (Array.isArray(r.must_fix) ? r.must_fix : []).filter((m) => m && (m.now || m.instead)).slice(0, 5).map((m) => ({ now: String(m.now ?? "").slice(0, 900), instead: String(m.instead ?? "").slice(0, 1200) }));
    return { verdict: r.verdict === "fix" && items.length ? "fix" : "ship", must_fix: items, keep: r.keep ? String(r.keep).slice(0, 800) : null };
  } catch {
    return null;
  }
}

/** Which critic: JEVIS_CRITIC=claude (default), codex, or off. */
export const criticBackend = () => {
  const v = (process.env.JEVIS_CRITIC ?? "claude").toLowerCase();
  return ["claude", "codex", "off"].includes(v) ? v : "claude";
};

function run(cmd, args, { cwd, timeoutMs }) {
  return new Promise((done) => {
    // The critic's own session must not trigger Jevis again.
    const env = { ...process.env, JEVIS_DISABLE: "1" };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      return done({ error: e.message });
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => (clearTimeout(timer), done({ error: e.message })));
    child.on("close", (code) => (clearTimeout(timer), done(code === 0 ? { text: out } : { error: `exit ${code}: ${err.slice(-300) || out.slice(-300)}` })));
  });
}

let criticRunner = null;
/** Tests swap the critic for a scripted one; null restores the real CLI. */
export const setCritic = (fn) => (criticRunner = fn);

export async function runCritic(prompt, { cwd, dir, shots, timeoutMs = CRITIC_TIMEOUT_MS }) {
  if (criticRunner) return criticRunner(prompt, { cwd, dir, shots });
  const backend = criticBackend();
  if (backend === "off") return { error: "critic off" };
  const model = process.env.JEVIS_CRITIC_MODEL;
  if (backend === "codex") {
    return run("codex", ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", ...(model ? ["-m", model] : []), ...shots.flatMap((s) => ["-i", s.file]), prompt], { cwd, timeoutMs });
  }
  const law = designLaw();
  return run("claude", ["-p", prompt, "--allowedTools", "Read", "--add-dir", dir, ...(law ? ["--add-dir", dirname(law)] : []), "--output-format", "text", ...(model ? ["--model", model] : [])], { cwd, timeoutMs });
}

let captureRunner = null;
/** Tests swap rendering for a stub; null restores the browser. */
export const setCapture = (fn) => (captureRunner = fn);

/**
 * One review round: render, ask the critic, and return the verdict with what
 * it looked at. `{ skipped }` when there is nothing to render; `{ error }`
 * when something failed, which the caller treats as a pass.
 */
export async function review({ kind = "page", sessionId, turn, round, of = REVIEW_ROUNDS, cwd, request, firstRequest = null, files, texts, shown }) {
  const targets = await renderTargets({ files, cwd, texts });
  if (!targets.length) return { skipped: "nothing to render" };
  const dir = ensureDir("reviews", String(sessionId ?? "none").replace(/[^\w.-]/g, "_"), `turn${turn}-round${round}`);
  let seen;
  try {
    seen = await (captureRunner ?? capture)(targets, { dir, film: kind === "film" });
  } catch (e) {
    return { error: `render failed: ${e.message.split("\n")[0].slice(0, 200)}`, targets };
  }
  if (!seen.shots.length) return { error: "no screenshots", targets, facts: seen.facts };
  if (kind === "film" && !captureRunner) {
    const sound = filmSound({ cwd, dir, files });
    seen = { shots: [...seen.shots, ...sound.shots], facts: [...seen.facts, ...sound.facts] };
  }
  const wiki = loadWiki();
  // The critic is a model call off this machine: the request passes through the same mask as Jev's state.
  const prompt = redact(criticPrompt({ kind, request, firstRequest, targets, shots: seen.shots, facts: seen.facts, files, telltales: telltales(wiki), lessons: lessonsShown(shown, wiki), round, of }));
  const t = Date.now();
  const reply = await runCritic(prompt, { cwd, dir, shots: seen.shots });
  const ms = Date.now() - t;
  const verdict = reply.text ? parseReview(reply.text) : null;
  const result = { kind, targets, shots: seen.shots.map((s) => s.file), facts: seen.facts, ms, verdict, error: reply.error ?? (verdict ? undefined : "unreadable critic reply"), backend: criticBackend() };
  writeFileSync(join(dir, "review.json"), JSON.stringify({ ...result, prompt, reply: reply.text ?? null }, null, 2), { mode: 0o600 });
  return result;
}

/** The stop block the agent reads: what is there now, what to do instead. */
export function formatReview(r, round, of = REVIEW_ROUNDS) {
  const who = r.backend === "codex" ? "Codex" : "Claude";
  const what = r.kind === "film" ? `frames sampled from ${r.targets.join(", ")}` : `renders of ${r.targets.join(", ")} at 1440 and 390 px`;
  return [
    `Jevis ${r.kind === "film" ? "film" : "design"} review, round ${round} of ${of}. ${who} looked at ${what} and would not ship it yet:`,
    ...r.verdict.must_fix.map((m, i) => `${i + 1}. Now: ${m.now}\n   Instead: ${m.instead}`),
    r.verdict.keep ? `Keep: ${r.verdict.keep}` : "",
    round < of
      ? r.kind === "film"
        ? "Make these changes. When you finish, Jevis samples the film's frames again and reviews it, so check only the frames these points touch; skip a full re-render or a broad sweep of your own until the review ships it."
        : "Make these changes. When you finish, Jevis renders the page again at 1440 and 390 px and reviews it, so check only what these points need; skip a full re-render or a broad sweep of your own."
      : r.kind === "film"
        ? "This is the last review. Make these changes, re-render the final video file so it carries them, check the frames you changed in that file, and finish."
        : "This is the last review. Make these changes, check them with one render, and finish.",
    `Where a point conflicts with what the user asked, the user wins: say so. Your final message is the user's answer, written as if this review were not there: present the finished work (where it is, what it is, what you checked) and answer anything they asked. The ${r.kind === "film" ? "frames" : "screenshots"} are in ${dirOf(r.shots)}.`,
  ].filter(Boolean).join("\n");
}

const dirOf = (files) => (files?.[0] ? files[0].replace(/\/[^/]+$/, "") : "");

/** Screenshot files a round left behind, for `jevis stats` and the docs. */
export const reviewFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")) : []);
