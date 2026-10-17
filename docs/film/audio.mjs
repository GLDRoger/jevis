// Sound for the launch film: a licensed Mixkit track, and ready-made Mixkit sound effects placed on the film's cues.
// Nothing is synthesized. The files are downloaded, not committed: their licenses allow use in a video,
// not redistribution as standalone audio.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MUSIC = {
  title: 'Take this Higher', artist: 'Michael Ramir C.', source: 'https://mixkit.co/free-stock-music/', license: 'Mixkit Stock Music Free License (https://mixkit.co/license/#musicFree)',
  url: 'https://assets.mixkit.co/music/1012/1012.mp3', file: 'music-1012.mp3',
};

// align: seconds into the file where the sound's transient (or a whoosh's peak) sits, measured from each waveform.
export const SFX = {
  typing: { id: 1387, name: 'Fast keyboard typing', align: 0, from: 1.0 },
  click: { id: 1117, name: 'Classic click', align: 0.10 },
  whoosh: { id: 1490, name: 'Fast whoosh transition', align: 0.71 },
  swoosh: { id: 3115, name: 'Fast transitions swoosh', align: 0.10 },
  swell: { id: 1492, name: 'Cinematic whoosh fast transition', align: 1.08 },
  rewind: { id: 1093, name: 'Glitch sci fi rewind transition', align: 0.055 },
  hit: { id: 2299, name: 'Short bass hit', align: 0.065 },
  bighit: { id: 2303, name: 'Futuristic bass hit', align: 0.04 },
  zoom: { id: 772, name: 'Quick zoom impact', align: 0.29 },
  error: { id: 1110, name: 'Click error', align: 0.01 },
  break: { id: 2952, name: 'Break tech impact', align: 0.314 },
  pop: { id: 3005, name: 'Explainer video pops whoosh light pop', align: 0.015 },
  shutter: { id: 1432, name: 'Camera digital shutter', align: 0.294 },
  confirm: { id: 2520, name: 'High tech bleep confirmation', align: 0.125 },
};
const sfxUrl = id => `https://assets.mixkit.co/active_storage/sfx/${id}/${id}-preview.mp3`;

export function fetchAudio(dir) {
  mkdirSync(dir, { recursive: true });
  const get = (url, file) => { const p = join(dir, file); if (!existsSync(p)) execFileSync('curl', ['-sSfL', '-o', p, url]); return p; };
  get(MUSIC.url, MUSIC.file);
  for (const s of Object.values(SFX)) get(sfxUrl(s.id), `sfx-${s.id}.mp3`);
}

// Builds the mix with ffmpeg: music (spliced on a downbeat), every cue at its time, then loudness to about -16 LUFS
// with true peaks under -4 dBFS after AAC encoding, which adds about 1.7 dB of overshoot (so the WAV aims for -6.5).
export function mix({ dir, cues, film, out }) {
  const inputs = ['-i', join(dir, MUSIC.file)];
  const parts = [];
  const { cutFilm, resumeTrack, fadeOut } = film.MUSIC;
  const tail = film.DUR - cutFilm;
  parts.push(`[0:a]atrim=0:${cutFilm.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=out:st=${(cutFilm - 0.012).toFixed(4)}:d=0.012[m1]`);
  parts.push(`[0:a]atrim=${resumeTrack.toFixed(4)}:${(resumeTrack + tail).toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=${(fadeOut[0] - cutFilm).toFixed(3)}:d=${(fadeOut[1] - fadeOut[0]).toFixed(3)}[m2]`);
  parts.push(`[m1][m2]concat=n=2:v=0:a=1,volume=-9dB[music]`);
  const labels = ['[music]'];
  const used = new Map();
  cues.forEach((c, i) => {
    const s = SFX[c.s]; if (!s) throw new Error(`unknown sfx ${c.s}`);
    if (!used.has(c.s)) { used.set(c.s, inputs.length / 2); inputs.push('-i', join(dir, `sfx-${s.id}.mp3`)); }
    const idx = used.get(c.s);
    let start = c.t - s.align, from = 0;
    if (c.s === 'typing') from = s.from + (i * 2.37) % 18; // a different stretch of the typing take each time
    if (start < 0) { from += -start; start = 0; }
    const trim = c.dur ? `atrim=${from.toFixed(3)}:${(from + c.dur + 0.05).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=out:st=${Math.max(0, c.dur - 0.04).toFixed(3)}:d=0.08,` : (from ? `atrim=${from.toFixed(3)},asetpts=PTS-STARTPTS,` : '');
    parts.push(`[${idx}:a]${trim}aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.g}dB,adelay=${Math.round(start * 1000)}:all=1[c${i}]`);
    labels.push(`[c${i}]`);
  });
  // The effects bus ducks the music a few dB while an effect plays, so each effect sits above the bed.
  // Typing is a texture under the narration, so only the accents key the ducker. Both buses run the full length.
  const pad = `volume=-8dB,apad=whole_dur=${film.DUR}`;
  const typing = labels.slice(1).filter((_, i) => cues[i].s === 'typing'), accents = labels.slice(1).filter((_, i) => cues[i].s !== 'typing');
  parts.push(`${typing.join('')}amix=inputs=${typing.length}:normalize=0:dropout_transition=0,${pad}[typing]`);
  parts.push(`${accents.join('')}amix=inputs=${accents.length}:normalize=0:dropout_transition=0,${pad},asplit=2[acc][key]`);
  parts.push(`[music]apad=whole_dur=${film.DUR}[mpad]`, `[mpad][key]sidechaincompress=threshold=0.15:ratio=2.5:attack=2:release=160:makeup=1[duck]`);
  parts.push(`[acc][typing]amix=inputs=2:normalize=0:dropout_transition=0[fx]`);
  // STEM=music or STEM=sfx writes that bus alone (same gains, no limiter) to check the balance.
  const stem = { music: '[duck]', sfx: '[fx]' }[process.env.STEM];
  if (stem) parts.push(`[duck][fx]amix=inputs=2:normalize=0:weights='${stem === '[duck]' ? '1 0' : '0 1'}',atrim=0:${film.DUR},volume=3dB[mix]`);
  else parts.push(`[duck][fx]amix=inputs=2:normalize=0:dropout_transition=0,atrim=0:${film.DUR},volume=4.5dB,alimiter=limit=0.45:attack=3:release=60:level=false[mix]`);
  const graph = join(out, 'mix.graph'); writeFileSync(graph, parts.join(';\n'));
  const raw = join(out, 'mix-raw.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex_script', graph, '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', raw]);
  const meas = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', raw, '-af', 'loudnorm=I=-16:TP=-6.5:LRA=14:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = JSON.parse(/\{[\s\S]*\}/.exec(meas)[0]);
  const wav = join(out, 'mix.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-af',
    `loudnorm=I=-16:TP=-6.5:LRA=14:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
    '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
  return wav;
}

