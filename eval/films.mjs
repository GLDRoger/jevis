/**
 * A local viewer for the films from eval/sim.mjs film sessions: the final video
 * from each arm, side by side, with a blind mode.
 *
 *   node eval/films.mjs [sim root] [out dir]
 *   python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/jevgallery   ->  /films/
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root = "/tmp/jevproof-film", out = "/tmp/jevgallery/films"] = process.argv.slice(2);
const ARMS = [["codex", "base", "Codex"], ["codex", "jevis", "Codex + Jevis"], ["claude", "base", "Claude Code"], ["claude", "jevis", "Claude Code + Jevis"]];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const films = [];
for (const dir of readdirSync(root).filter((d) => existsSync(join(root, d, "result.json")))) {
  const r = read(join(root, dir, "result.json"));
  const arm = ARMS.find(([h, a]) => r.harness === h && r.arm === a);
  const video = r.facts?.[0]?.match(/^video: (\S+?),/)?.[1];
  if (!arm || !video) continue;
  const src = video.startsWith("/") ? video : join(root, dir, "proj", video);
  if (!existsSync(src)) continue;
  const id = `${dir}.mp4`;
  // An earlier run of an arm is kept as "<arm dir>-v1" beside its verdict in old-verdicts/.
  const earlier = /-v\d+$/.test(dir);
  copyFileSync(src, join(out, id));
  const pair = read(join(root, ...(earlier ? ["old-verdicts"] : []), `${r.name}-${r.harness}-s${r.seed}-verdict.json`));
  films.push({
    id, label: earlier ? `${arm[2]} (first run)` : arm[2], order: ARMS.indexOf(arm) + (earlier ? 0.5 : 0), minutes: +(r.agentMs / 60000).toFixed(1), facts: r.facts,
    title: (r.turns.at(-1)?.final ?? "").split("\n").find((l) => l.trim()) ?? "",
    followups: r.turns.slice(1).map((t) => t.message),
    verdict: pair?.winner ? `${pair.winner === r.arm ? "won" : pair.winner === "tie" ? "tied" : "lost"} its pair (${pair.margin}): ${pair.why}` : "",
    mb: (statSync(src).size / 1e6).toFixed(1),
  });
}
films.sort((a, b) => a.order - b.order);
const cards = films.map((f, i) => `<figure data-i="${i}">
  <video src="${esc(f.id)}" controls preload="metadata" playsinline muted></video>
  <figcaption><b class="who" data-real="${esc(f.label)}">${esc(f.label)}</b> <span class="meta">${f.minutes} min of agent time · ${f.mb} MB</span>
  <p class="facts">${f.facts.map(esc).join("<br>")}</p>
  <details><summary>agent's final message</summary><p>${esc(f.title)}</p></details>
  ${f.followups.length ? `<details><summary>simulated user's follow-up</summary><p>${f.followups.map(esc).join("<hr>")}</p></details>` : ""}
  ${f.verdict ? `<p class="verdict">Judge vs same harness: ${esc(f.verdict)}</p>` : ""}</figcaption>
</figure>`).join("\n");
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jevis film test</title>
<style>
:root{color-scheme:dark;font:15px/1.45 ui-sans-serif,system-ui,sans-serif;background:#0d0d0f;color:#e8e6e1}
body{margin:0;padding:20px 24px 60px}
header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:16px}
h1{font-size:18px;margin:0} .hint{color:#8d8a84;font-size:13px}
button{font:inherit;background:#1d1d21;color:inherit;border:1px solid #333;border-radius:6px;padding:6px 12px;cursor:pointer;transition:background .15s}
button:hover{background:#2a2a30} button:focus-visible{outline:2px solid #e8b04b;outline-offset:2px}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,620px),1fr));gap:22px}
figure{margin:0;background:#16161a;border-radius:10px;overflow:hidden}
video{width:100%;display:block;background:#000;aspect-ratio:16/9}
figcaption{padding:12px 14px}
.meta,.facts{color:#8d8a84;font-size:13px} .facts{margin:6px 0}
details p{white-space:pre-wrap;font-size:13px;color:#c9c6bf} summary{cursor:pointer;color:#b8b4ac;font-size:13px}
.verdict{font-size:13px;color:#e8b04b}
body.blind .meta,body.blind .verdict,body.blind details,body.blind .facts{display:none}
</style>
<header><h1>“surprise me” film test</h1><span class="hint">Videos start muted: unmute the one you're watching. B = blind (shuffles and hides who made what), R = reveal.</span>
<button id="blind">Blind</button><button id="reveal">Reveal</button></header>
<main>${cards}</main>
<script>
const main=document.querySelector('main'),figs=[...main.children];
function blind(){document.body.classList.add('blind');const order=figs.map((f,i)=>[((i*7919+13)%97),f]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);order.forEach((f,i)=>{main.appendChild(f);f.querySelector('.who').textContent='Film '+'ABCD'[i]})}
function reveal(){document.body.classList.remove('blind');figs.forEach(f=>{main.appendChild(f);const w=f.querySelector('.who');w.textContent=w.dataset.real})}
document.getElementById('blind').onclick=blind;document.getElementById('reveal').onclick=reveal;
addEventListener('keydown',e=>{if(e.key==='b'||e.key==='B')blind();if(e.key==='r'||e.key==='R')reveal()});
document.addEventListener('play',e=>{for(const v of document.querySelectorAll('video'))if(v!==e.target)v.pause()},true);
</script>`);
console.log(`${films.length} films in ${out}`);
