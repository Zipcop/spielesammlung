// Geräusche, per WebAudio erzeugt (keine Audiodateien): kurzes gefiltertes Rauschen + Ton.
// Browser erlauben Ton erst nach einem Klick → unlockAudio() beim ersten Klick aufrufen.

let ctx = null;
let noise = null;
let out = null;

export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    out = ctx.createDynamicsCompressor(); // viele Würfel gleichzeitig sollen nicht übersteuern
    out.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// filter = Klangfarbe des Rauschens, tone = kurzer „Körper“-Ton (Holz klopft, Würfel klackern)
const HITS = {
  die: { filter: 'bandpass', freq: 3400, q: 3, decay: 0.03, gain: 0.7, tone: 2900 },
  wood: { filter: 'bandpass', freq: 1500, q: 2, decay: 0.05, gain: 0.9, tone: 820 },
  felt: { filter: 'lowpass', freq: 600, q: 0.7, decay: 0.045, gain: 0.8, tone: 0 },
  card: { filter: 'bandpass', freq: 2300, q: 0.8, decay: 0.07, gain: 0.55, tone: 0 }, // Karte landet auf Karte/Filz
  swish: { filter: 'lowpass', freq: 1700, q: 0.5, decay: 0.2, gain: 0.45, tone: 0 }, // Karten gleiten zusammen
  ball: { filter: 'bandpass', freq: 2600, q: 2.5, decay: 0.035, gain: 0.85, tone: 2100 }, // Billardkugeln klacken aneinander
  cushion: { filter: 'lowpass', freq: 420, q: 0.8, decay: 0.06, gain: 0.7, tone: 0 }, // Kugel an die Bande, Fall in die Tasche
  cue: { filter: 'bandpass', freq: 1100, q: 1.5, decay: 0.04, gain: 0.8, tone: 600 }, // Queue trifft die Weiße
  puck: { filter: 'bandpass', freq: 1900, q: 1.8, decay: 0.03, gain: 0.85, tone: 1300 }, // Air-Hockey: Schläger trifft den Puck
  rail: { filter: 'bandpass', freq: 950, q: 1.3, decay: 0.045, gain: 0.75, tone: 540 }, // Air-Hockey: Puck an die Bande
  slot: { filter: 'lowpass', freq: 380, q: 1, decay: 0.16, gain: 0.95, tone: 170 }, // Air-Hockey: Puck fällt in den Torschlitz
  dart: { filter: 'bandpass', freq: 700, q: 1.2, decay: 0.06, gain: 1, tone: 240 }, // Darts: Pfeil schlägt in die Sisal-Scheibe
  throw: { filter: 'highpass', freq: 2400, q: 0.6, decay: 0.12, gain: 0.25, tone: 0 }, // Darts: Pfeil verlässt die Hand (Luftzug)
  putt: { filter: 'bandpass', freq: 2100, q: 1.8, decay: 0.03, gain: 0.8, tone: 1450 }, // Minigolf: Schläger trifft den Ball
  clack: { filter: 'bandpass', freq: 850, q: 1.2, decay: 0.05, gain: 0.85, tone: 500 }, // Minigolf: Ball an Bande oder Stein
  rim: { filter: 'bandpass', freq: 2600, q: 4, decay: 0.06, gain: 0.6, tone: 1750 }, // Minigolf: Ball streift den Lochrand
  cup: { filter: 'lowpass', freq: 700, q: 1, decay: 0.12, gain: 0.9, tone: 330 }, // Minigolf: Ball fällt ins Loch
  splash: { filter: 'lowpass', freq: 1400, q: 0.6, decay: 0.26, gain: 0.7, tone: 0 }, // Minigolf: Ball fällt ins Wasser
  pin: { filter: 'bandpass', freq: 1700, q: 1.6, decay: 0.07, gain: 0.85, tone: 1150 }, // Bowling: Pins klappern aneinander
  ballpin: { filter: 'bandpass', freq: 900, q: 1.2, decay: 0.09, gain: 1, tone: 420 }, // Bowling: Kugel kracht in die Pins
  lane: { filter: 'lowpass', freq: 300, q: 0.9, decay: 0.08, gain: 0.8, tone: 110 }, // Bowling: Kugel setzt auf dem Holz auf
  gutter: { filter: 'lowpass', freq: 500, q: 1.4, decay: 0.09, gain: 0.45, tone: 0 }, // Bowling: Kugel rollt in der Rinne
  pit: { filter: 'lowpass', freq: 260, q: 0.8, decay: 0.14, gain: 0.7, tone: 90 }, // Bowling: Kugel/Pin fällt in die Grube
  roll: { filter: 'lowpass', freq: 170, q: 0.7, decay: 0.1, gain: 0.45, tone: 0 }, // Bowling: Grollen der rollenden Kugel
};

// kind: 'die' | 'wood' | 'felt' | 'card' | 'swish' | 'ball' | 'cushion' | 'cue' | … (Schlüssel aus HITS), strength 0–1, delay in Sekunden
export function playHit(kind, strength, delay = 0) {
  if (!ctx || ctx.state !== 'running' || strength < 0.03) return;
  const hit = HITS[kind];
  const t = ctx.currentTime + delay;
  const level = hit.gain * Math.min(strength, 1) ** 1.3;
  const vary = 0.85 + Math.random() * 0.3;

  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = hit.filter;
  filter.frequency.value = hit.freq * vary;
  filter.Q.value = hit.q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(level, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + hit.decay);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * Math.min(0.2, 0.28 - hit.decay)); // Rauschen ist 0,3 s lang
  src.stop(t + hit.decay + 0.02);

  if (!hit.tone) return;
  const osc = ctx.createOscillator();
  osc.frequency.value = hit.tone * vary;
  const toneEnv = ctx.createGain();
  toneEnv.gain.setValueAtTime(level * 0.35, t);
  toneEnv.gain.exponentialRampToValueAtTime(0.0001, t + hit.decay * 0.7);
  osc.connect(toneEnv).connect(out);
  osc.start(t);
  osc.stop(t + hit.decay);
}

// Mischen: schnelles Rattern, während die zwei Hälften ineinanderlaufen, dann ein weiches Zusammenschieben
export function playShuffle() {
  for (let i = 0; i < 34; i++) playHit('card', 0.22 + Math.random() * 0.2, i * 0.019 + Math.random() * 0.006);
  playHit('swish', 0.8, 0.7);
}
