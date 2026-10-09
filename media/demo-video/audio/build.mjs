#!/usr/bin/env node
// Soundtrack for the ENCIRRA demo film, after /brag's voice mode: Kokoro narration generated through
// Hyperframes, a music bed that ducks under the voice and lands its re-entry on the outro logo, and CC0
// UI sounds on the recorded clicks, shortcuts and typing. The mix is loudness-normalised to -14 LUFS and
// muxed onto the picture, with a poster frame baked in as frame 0 (the idle thumbnail everywhere).
//
//   node media/demo-video/render.mjs            picture   → out/picture.mp4
//   node media/demo-video/render.mjs cues       cue sheet → out/cues.json
//   node media/demo-video/audio/build.mjs       narration, mix, poster → out/encirra-demo.mp4
//
// Narration lines are cached in audio/voiceover/ and regenerated only when their text, voice or speed
// changes. Generating them needs Python with kokoro-onnx + soundfile: point HYPERFRAMES_PYTHON at it.
// Sound files come from audio/assets/ (copied there from the /brag skill on first use).
// Options: --poster <seconds> (default 23.9) · --stems (also write the voice/music/sfx buses, for level checks)
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../out');
const ASSETS = join(here, 'assets');
const VO_DIR = join(here, 'voiceover');
const RATE = 48000;
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const POSTER_AT = Number(opt('poster', 23.9));
const BRAG = process.env.BRAG_SKILL_DIR ?? join(homedir(), '.claude', 'skills', 'brag');

const MUSIC = 'music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3';
const MUSIC_CUES = 'music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json';
/** music bed level, and its level under narration (linear gain) */
const BED = 0.3;
const BED_UNDER_VOICE = 0.13;

function run(cmd, args, { shell = false } = {}) {
  const r = shell ? spawnSync([cmd, ...args].join(' '), { maxBuffer: 1 << 30, shell: true }) : spawnSync(cmd, args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}):\n${r.stderr?.toString().slice(-2000)}`);
  return r;
}

/** Asset path inside audio/assets/, copied from the /brag skill the first time it is needed. */
function asset(rel) {
  const local = join(ASSETS, rel);
  if (!existsSync(local)) {
    const src = join(BRAG, 'assets', rel);
    if (!existsSync(src)) throw new Error(`missing ${rel}: not in audio/assets/ and no /brag skill at ${BRAG} (set BRAG_SKILL_DIR)`);
    mkdirSync(dirname(local), { recursive: true });
    copyFileSync(src, local);
  }
  return local;
}

/** Any audio file → interleaved stereo float32 at RATE. */
function decode(file) {
  const b = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-']).stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function writeFloatWav(file, data) {
  const n = data.length * 4;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); // IEEE float
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 8, 28);
  b.writeUInt16LE(8, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  Buffer.from(data.buffer, data.byteOffset, n).copy(b, 44);
  writeFileSync(file, b);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

// ------------------------------------------------------------------------------------------ cue sheet

const cuesFile = join(OUT, 'cues.json');
if (!existsSync(cuesFile)) throw new Error('out/cues.json missing — run: node media/demo-video/render.mjs cues');
const cues = JSON.parse(readFileSync(cuesFile, 'utf8'));
const seg = (id) => cues.segments.find((s) => s.id === id);

/** "0.5", "outro+0.5", "twin.clicks.1+0.9", "overview.events.trendFlagged-0.2" → film seconds */
function at(expr) {
  const m = String(expr).replace(/\s+/g, '').match(/^(.*?)([+-]\d+(?:\.\d+)?)?$/);
  const base = m[1];
  const off = Number(m[2] ?? 0);
  if (/^\d+(\.\d+)?$/.test(base)) return Number(base) + off;
  const [head, ...rest] = base.split('.');
  let v = seg(head) ?? cues[head];
  for (const k of rest) v = v?.[k];
  if (v && typeof v === 'object' && 't' in v) v = v.t;
  if (typeof v !== 'number') throw new Error(`cue "${base}" not found in out/cues.json`);
  return v + off;
}

// ------------------------------------------------------------------------------------------ narration

const script = JSON.parse(readFileSync(join(here, 'voiceover.json'), 'utf8'));
mkdirSync(VO_DIR, { recursive: true });

function tts(line, speed) {
  const wav = join(VO_DIR, `${line.id}.wav`);
  const metaFile = join(VO_DIR, `${line.id}.json`);
  const want = JSON.stringify({ text: line.text, voice: script.voice, speed });
  if (existsSync(wav) && existsSync(metaFile) && readFileSync(metaFile, 'utf8') === want) return wav;
  if (!process.env.HYPERFRAMES_PYTHON) console.warn('  (HYPERFRAMES_PYTHON not set; hyperframes tts will look for kokoro-onnx on the system python)');
  const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
  process.stdout.write(`  tts ${line.id} @ ${speed}× … `);
  run('npx', ['--yes', 'hyperframes', 'tts', q(line.text), '--voice', script.voice, '--speed', String(speed), '--output', q(wav), '--json'], { shell: true });
  writeFileSync(metaFile, want);
  console.log('ok');
  return wav;
}

const lines = script.lines.map((l) => ({ ...l, start: at(l.at) })).sort((a, b) => a.start - b.start);
const MAX_SPEED = 1.12;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  const limit = i + 1 < lines.length ? lines[i + 1].start - 0.2 : cues.duration - 0.8;
  let speed = l.speed ?? 1;
  let pcm = decode(tts(l, speed));
  let dur = pcm.length / 2 / RATE;
  if (l.start + dur > limit) {
    // too long for its slot: speak it slightly faster (never past MAX_SPEED; beyond that, shorten the line)
    const need = (speed * dur) / (limit - l.start);
    if (need > MAX_SPEED) throw new Error(`line ${l.id} needs ${dur.toFixed(2)} s but has ${(limit - l.start).toFixed(2)} s — shorten it`);
    speed = Math.ceil(need * 100) / 100;
    pcm = decode(tts(l, speed));
    dur = pcm.length / 2 / RATE;
  }
  Object.assign(l, { pcm, dur, end: l.start + dur, speed });
}

// ------------------------------------------------------------------------------------------ mix

const N = Math.round(cues.duration * RATE);
const voice = new Float32Array(N * 2);
const music = new Float32Array(N * 2);
const sfx = new Float32Array(N * 2);

function place(bus, pcm, t, gain) {
  const s0 = Math.round(t * RATE) * 2;
  for (let i = 0; i < pcm.length; i++) {
    const k = s0 + i;
    if (k >= 0 && k < bus.length) bus[k] += pcm[i] * gain;
  }
}

for (const l of lines) place(voice, l.pcm, l.start, 1);

// music: the track's section re-entry (a strong cue after a quiet stretch) lands on the outro logo
const musicPcm = decode(asset(MUSIC));
const cueMeta = JSON.parse(readFileSync(asset(MUSIC_CUES), 'utf8'));
const logoAt = cues.outro + 0.55;
const strong = cueMeta.strongCues.map((c) => c.time).sort((a, b) => a - b);
const reentry = strong.find((c, i) => i > 0 && c - strong[i - 1] >= 4 && c >= logoAt && c - logoAt <= 12);
const offset = reentry !== undefined ? reentry - logoAt : 0;

// narration ducks the bed; lines closer than 1.6 s share one duck so the music doesn't pump between them
const regions = [];
for (const l of lines) {
  const last = regions[regions.length - 1];
  if (last && l.start - last[1] < 1.6) last[1] = Math.max(last[1], l.end);
  else regions.push([l.start, l.end]);
}
const duckAt = (t) => {
  let d = 0;
  for (const [a, b] of regions) {
    if (t < a - 0.3 || t > b + 0.6) continue;
    d = Math.max(d, t < a ? smooth((t - (a - 0.3)) / 0.3) : t > b ? 1 - smooth((t - b) / 0.6) : 1);
  }
  return d;
};
for (let n = 0; n < N; n++) {
  const t = n / RATE;
  const src = Math.round((t + offset) * RATE) * 2;
  if (src + 1 >= musicPcm.length) break;
  const env = smooth(t / 1.6) * (1 - smooth((t - (cues.duration - 1.9)) / 1.85));
  const g = env * (BED + (BED_UNDER_VOICE - BED) * duckAt(t));
  music[n * 2] = musicPcm[src] * g;
  music[n * 2 + 1] = musicPcm[src + 1] * g;
}

// sound effects: one coherent, quiet palette (Kenney CC0 + a CC0 keyboard set)
const cue = [];
cue.push(['sfx/impact/impactSoft_medium_001.ogg', 0.1, 0.55, 'title logo']);
const cutFx = ['000', '002', '003', '004', '000'];
cues.segments.slice(1).forEach((s, i) => cue.push([`sfx/impact/impactSoft_medium_${cutFx[i % cutFx.length]}.ogg`, s.start - 0.05, 0.3, `cut → ${s.id}`]));
const clickFx = ['sfx/interface/click_003.ogg', 'sfx/interface/click_002.ogg', 'sfx/interface/click_005.ogg'];
let ci = 0;
for (const s of cues.segments) for (const t of s.clicks) cue.push([clickFx[ci++ % clickFx.length], t, 0.5, `click (${s.id})`]);
for (const s of cues.segments)
  for (const k of s.keys) cue.push([k.label === '↵' ? 'sfx/keyboard/keypress-012.wav' : 'sfx/keyboard/keypress-005.wav', k.t, 0.6, `key ${k.label}`]);
const rnd = mulberry32(7);
for (const s of cues.segments)
  for (const t of s.typed) cue.push([`sfx/keyboard/keypress-${String(1 + Math.floor(rnd() * 32)).padStart(3, '0')}.wav`, t, s.id === 'overview' ? 0.34 : 0.26, 'typing']);
const ov = seg('overview');
const ins = seg('insights');
const rp = seg('replay');
if (ov?.events.trendFlagged != null) cue.push(['sfx/ui/rollover2.ogg', ov.events.trendFlagged + 0.12, 0.4, 'trend flagged']);
if (ov?.events.incidentOpened != null) cue.push(['sfx/interface/bong_001.ogg', ov.events.incidentOpened + 0.25, 0.55, 'incident opened']);
if (ins?.events.validated != null) cue.push(['sfx/impact/impactBell_heavy_000.ogg', ins.events.validated, 0.4, 'observation validated']);
if (rp?.clicks.length) cue.push(['sfx/casino/card-slide-1.ogg', rp.clicks[0] + 0.05, 0.32, 'replay scrub']);
cue.push(['sfx/impact/impactBell_heavy_003.ogg', logoAt, 0.5, 'outro logo (on the music re-entry)']);
const decoded = new Map();
for (const [rel, t, gain] of cue) {
  if (!decoded.has(rel)) decoded.set(rel, decode(asset(rel)));
  place(sfx, decoded.get(rel), t, gain);
}

const mix = new Float32Array(N * 2);
for (let i = 0; i < mix.length; i++) mix[i] = voice[i] + music[i] + sfx[i];
mkdirSync(OUT, { recursive: true });
if (argv.includes('--stems')) for (const [name, bus] of [['voice', voice], ['music', music], ['sfx', sfx]]) writeFloatWav(join(OUT, `stem-${name}.wav`), bus);
const raw = join(OUT, 'mix-raw.wav');
writeFloatWav(raw, mix);

// loudness: two-pass EBU R128 to -14 LUFS integrated, -1.5 dBTP
const measure = (file) => {
  const e = run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr.toString();
  return JSON.parse(e.slice(e.lastIndexOf('{'), e.lastIndexOf('}') + 1));
};
const L = measure(raw);
const mixWav = join(OUT, 'mix.wav');
run('ffmpeg', [
  '-v', 'error', '-y', '-i', raw,
  '-af', `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${L.input_i}:measured_TP=${L.input_tp}:measured_LRA=${L.input_lra}:measured_thresh=${L.input_thresh}:offset=${L.target_offset}:linear=true`,
  '-ar', String(RATE), '-c:a', 'pcm_s24le', mixWav,
]);
const L2 = measure(mixWav);

// ------------------------------------------------------------------------------------------ poster + mux

const picture = join(OUT, 'picture.mp4');
if (!existsSync(picture)) throw new Error('out/picture.mp4 missing — run: node media/demo-video/render.mjs');
const poster = join(OUT, 'poster.jpg');
const baked = join(OUT, 'picture-poster.mp4');
const stampFile = join(OUT, 'picture-poster.json');
const stamp = JSON.stringify({ posterAt: POSTER_AT, picture: statSync(picture).mtimeMs });
if (!existsSync(baked) || !existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stamp) {
  console.log(`  baking the poster (${POSTER_AT} s) into frame 0 …`);
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(POSTER_AT), '-i', picture, '-frames:v', '1', '-q:v', '2', poster]);
  run('ffmpeg', [
    '-v', 'error', '-y', '-i', picture, '-i', poster,
    '-filter_complex', "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]", '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', baked,
  ]);
  writeFileSync(stampFile, stamp);
}
const final = join(OUT, 'encirra-demo.mp4');
run('ffmpeg', ['-v', 'error', '-y', '-i', baked, '-i', mixWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', final]);

// ------------------------------------------------------------------------------------------ report

const fmt = (t) => t.toFixed(2).padStart(6);
console.log('\nnarration (Kokoro af_heart via hyperframes tts)');
for (const l of lines) console.log(`  ${fmt(l.start)} – ${fmt(l.end)}  ${l.speed === 1 ? '     ' : `${l.speed.toFixed(2)}×`}  ${l.text}`);
console.log(`music: ${MUSIC.split('/').pop()} from ${offset.toFixed(2)} s; re-entry at ${reentry?.toFixed(2) ?? '–'} s lands on the outro logo (${logoAt.toFixed(2)} s)`);
console.log(`sfx: ${cue.length} cues (${[...new Set(cue.map((c) => c[0]))].length} files)`);
console.log(`loudness: ${Number(L.input_i).toFixed(1)} LUFS → ${Number(L2.input_i).toFixed(1)} LUFS integrated, peak ${Number(L2.input_tp).toFixed(1)} dBTP`);
console.log(`saved ${final}`);
