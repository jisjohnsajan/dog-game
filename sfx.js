/* ============================================================================
 * SQUEAK & SEEK — SFX ENGINE 🎺🐭
 * ----------------------------------------------------------------------------
 * 100% synthesized comedy sounds via the Web Audio API. No audio files, no
 * CDN, no loading screens — just pure math making people laugh:
 *
 *   squeak()        chipmunk chirps while the rat scurries
 *   panicSqueak()   frantic HELIUM squeaking when you chase it
 *   bark()          goofy "RUFF RUFF" from the dog companion
 *   boing()         cartoon spring when you CATCH the rat
 *   randomThrowSound()  plays one of the USER'S meme mp3s at random 🎁
 *   splat()         the inevitable landing (thud + dizzy squeaks)
 *   jingle()        silly ta-da! fanfare when you score a yeet
 *   spawnPop()      pop when a new rat spawns
 *
 * Usage: call init() once from a user gesture (button tap) — mobile browsers
 * require that to unlock audio. Everything else no-ops safely before that.
 * ==========================================================================*/

let ctx = null;        // AudioContext
let master = null;     // master gain -> compressor -> speakers
let muted = false;
let noiseBuf = null;   // shared 1s white-noise buffer (splat burst)

/* ------------------------------- lifecycle -------------------------------- */

/** Create/resume the AudioContext. MUST be called from a user gesture. */
export function init() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor(); // glue so nothing clips
    master.connect(comp).connect(ctx.destination);

    // Pre-render 1 second of white noise, reused by every noise-based sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; return muted; }

/** Internal helper: every public sound funnels through this gate. */
function ready() {
  if (!ctx || ctx.state !== 'running') return false;
  return !muted;
}

/* ============================ THE RAT SQUEAKS ============================= */

/**
 * One chipmunk chirp — a fast upward sine gliss with vibrato.
 * `base` shifts pitch (1 = normal, 1.4 = panicked helium rat).
 */
export function squeak(base = 1) {
  if (!ready()) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';

  const f = 1400 * base * (0.85 + Math.random() * 0.3); // vary every squeak
  o.frequency.setValueAtTime(f, t0);
  o.frequency.exponentialRampToValueAtTime(f * 1.9, t0 + 0.06); // UP
  o.frequency.exponentialRampToValueAtTime(f * 1.5, t0 + 0.11); // dip

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);

  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + 0.15);
}

/** Frantic 3-burst HELIUM squeal for a rat that is being chased. */
export function panicSqueak() {
  if (!ready()) return;
  const base = 1.5 + Math.random() * 0.4;
  squeak(base);
  setTimeout(() => squeak(base * 1.1), 70);
  setTimeout(() => squeak(base * 0.95), 145);
}

/** Weak, dizzy "…help me" squeaks after a rough landing. */
function dizzySqueaks() {
  if (!ready()) return;
  setTimeout(() => squeak(0.7), 180);
  setTimeout(() => squeak(0.55), 420);
}

/* ============================== THE DOG BARKS ============================= */

/**
 * Goofy "RUFF! RUFF!" — a sawtooth with a pitch drop, lowpassed so it sounds
 * like a cartoon dog, not a dial-up modem. Two bursts, second one higher
 * like it's REALLY excited about that rat.
 */
export function bark() {
  if (!ready()) return;
  const t0 = ctx.currentTime;

  for (let i = 0; i < 2; i++) {
    const t = t0 + i * 0.19;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);

    o.type = 'sawtooth';
    // Each bark starts with a snap of pitch then falls — like real barks
    const f = 190 + i * 40 + Math.random() * 20;
    o.frequency.setValueAtTime(f * 1.6, t);        // bark onset
    o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.14); // growly tail

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.18);
  }
}

/* ============================ CATCH: THE BOING ============================= */

/** Classic cartoon spring — a wobbling sine that runs out of energy. */
export function boing() {
  if (!ready()) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';

  // Wobble the pitch like a spring: ~14 Hz vibrato that decays
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(16, t0);
  lfo.frequency.exponentialRampToValueAtTime(4, t0 + 0.5);
  lfoGain.gain.setValueAtTime(220, t0);
  lfoGain.gain.exponentialRampToValueAtTime(10, t0 + 0.5);

  o.frequency.setValueAtTime(520, t0);
  o.frequency.exponentialRampToValueAtTime(160, t0 + 0.45);
  lfo.connect(lfoGain).connect(o.frequency);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);

  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.6);
  lfo.start(t0); lfo.stop(t0 + 0.6);
}

/* ======================= YEET: RANDOM MEME THROW ========================== */
/* The user dropped meme mp3s into the project folder — every throw picks one
 * at random, so each yeet is a surprise. Add/remove files in the THROWS
 * list; the file just has to sit next to index.html.                    */

const THROWS = [
  'auughhh.mp3',
  'ayooo-sayip-op.mp3',
  'basil-joseph-laughing-version-1.mp3',
  'cat-laugh-meme-1.mp3',
  'faaah.mp3',
  'malayalam-actor-lal.mp3',
  'movie_1_C2K5NH0.mp3',
  'shivaneee.mp3',
  'yt1s_wU4BGgD.mp3',
];

const throwBuffers = new Map(); // url -> AudioBuffer (lazy-loaded once)
let lastThrowIdx = -1;         // avoid repeating the same clip twice in a row

async function loadThrowSound(url) {
  if (throwBuffers.has(url)) return throwBuffers.get(url);
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  throwBuffers.set(url, audio);
  return audio;
}

/** Pick a random meme (never the same one twice in a row) and play it. */
export async function randomThrowSound() {
  if (!ready()) return;
  let idx = Math.floor(Math.random() * THROWS.length);
  if (idx === lastThrowIdx && THROWS.length > 1) idx = (idx + 1) % THROWS.length;
  lastThrowIdx = idx;
  const url = THROWS[idx];
  try {
    const buf = await loadThrowSound(url);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  } catch (e) {
    console.warn('throw sound failed:', url, e);
  }
}

/* ============================ LANDING: THE SPLAT =========================== */

/** Thud + noise splat + dizzy after-squeaks. Comedy physics needs comedy pain. */
export function splat() {
  if (!ready()) return;
  const t0 = ctx.currentTime;

  // thud body: pitch-dropping sine
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(130, t0);
  o.frequency.exponentialRampToValueAtTime(38, t0 + 0.22);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.7, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.32);

  // splat noise: quick burst of filtered noise
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1400, t0);
  lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.2);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5, t0);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  src.connect(lp).connect(ng).connect(master);
  src.start(t0); src.stop(t0 + 0.25);

  dizzySqueaks();
}

/* ======================= SCORE: THE TA-DA FANFARE ========================= */

/** Silly square-wave fanfare — like a tiny trumpet section celebrating you. */
export function jingle(delay = 0) {
  if (!ready()) return;
  const t0 = ctx.currentTime + delay;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6 — instant ta-da

  notes.forEach((f, i) => {
    const t = t0 + i * 0.09;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square'; // squares = comedy
    o.frequency.value = f;
    const last = i === notes.length - 1;
    const dur = last ? 0.5 : 0.11;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  });
}

/* ============================ UI / SPAWN BLIPS ============================ */

/** Cute pop when a rat spawns from the aether. */
export function spawnPop() {
  if (!ready()) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(880, t0);
  o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.07);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + 0.12);
}

/* ------------------------------ tiny helper ------------------------------- */
