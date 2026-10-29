// Wurfbewegung → Abwurf-Tempo – rein (kein DOM), damit es sich mit node --test prüfen lässt.
// Bedienung (eigene Festlegung): linke Maustaste drücken = Ziel steht (das Zittern der Hand in diesem Moment zählt),
// dann die Maus zügig nach oben „schnippen“ und dabei loslassen. Gemessen werden die letzten 60 ms vor dem Loslassen:
// – Tempo: zu langsam = Pfeil landet tiefer, zu schnell = höher (echte Flugbahn mit Schwerkraft, physics.js)
// – Richtung: schräg geschnippt = Pfeil geht zur Seite
// – Gleichmäßigkeit: ruckelt die Bewegung (stark gebremst oder beschleunigt), streut der Pfeil mehr
// Dazu eine kleine Grundstreuung. Der Computer streut je nach Stufe nur um sein Ziel (ai.js).
import { idealVelocity } from './physics.js';

export const IDEAL_FLICK = 1400; // px/s nach oben = genau richtig
export const MIN_FLICK = 0.3; // langsamer (Anteil vom Ideal) = kein Wurf
export const MIN_TRAVEL = 20; // px – so weit muss die Maus mindestens nach oben
const WINDOW = 60; // ms vor dem Loslassen
const K_SPEED = 0.15; // 10 % falsches Tempo → 1,5 % Abwurftempo → gut 4 mm höher/tiefer
const K_SIDE = 0.03; // 10° schräg → rund 1 cm zur Seite
const BASE = 0.0025; // m Grundstreuung
const JERK = 0.008; // m Streuung bei ganz ruckeliger Bewegung
const JERK_FREE = 0.25; // so viel Tempo-Unterschied zwischen den Hälften ist normales Beschleunigen
export const TREMOR = 0.003; // m – so weit zittert die Hand beim Zielen (sichtbar am Zielpunkt)

// Lage der Maus zu einer Zeit (zwischen zwei Messpunkten gerade verbunden)
function at(samples, t) {
  if (t <= samples[0].t) return samples[0];
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]];
    if (b.t >= t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { t, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  return samples.at(-1);
}

// samples = [{ t (ms), x, y (px) }] seit dem Drücken, der letzte beim Loslassen.
// Liefert { ratio (Tempo / Ideal), angle (Bogenmaß, + = nach rechts), jerk (0–1), travel (px nach oben) } oder null
export function readFlick(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const end = samples.at(-1);
  const span = Math.min(WINDOW, end.t - samples[0].t);
  if (!(span > 5)) return null;
  const a = at(samples, end.t - span);
  const m = at(samples, end.t - span / 2);
  const up = a.y - end.y;
  const side = end.x - a.x;
  const v1 = (a.y - m.y) / (span / 2);
  const v2 = (m.y - end.y) / (span / 2);
  return {
    ratio: up / (span / 1000) / IDEAL_FLICK,
    angle: Math.atan2(side, Math.max(up, 1)),
    jerk: Math.min(Math.max(Math.abs(v2 - v1) / Math.max(Math.abs(v1), Math.abs(v2), 1e-6) - JERK_FREE, 0) / (1 - JERK_FREE), 1),
    travel: samples[0].y - end.y,
  };
}

export const validFlick = (f) => !!f && f.ratio >= MIN_FLICK && f.travel >= MIN_TRAVEL;

// Normalverteilte Zufallszahl (Box-Muller)
export function gauss(rng = Math.random) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// Abwurf-Tempo für den Menschen: aim = [x, y] auf der Scheibe (mit dem Zittern beim Drücken), flick = readFlick(...)
// solve = (from, ziel) → Tempo, das genau trifft (im Spiel physics.aim, mit Rapier nachgeschärft)
export function throwVelocity(from, aim, flick, rng = Math.random, solve = idealVelocity) {
  const spread = BASE + JERK * flick.jerk;
  const v = solve(from, [aim[0] + gauss(rng) * spread, aim[1] + gauss(rng) * spread]);
  const k = 1 + K_SPEED * (Math.min(Math.max(flick.ratio, MIN_FLICK), 2.2) - 1);
  const psi = Math.max(-0.6, Math.min(0.6, flick.angle)) * K_SIDE;
  const [vx, vy, vz] = v;
  return [(vx * Math.cos(psi) - vz * Math.sin(psi)) * k, vy * k, (vx * Math.sin(psi) + vz * Math.cos(psi)) * k];
}

// Abwurf-Tempo für den Computer: Ziel plus Streuung sigma (m)
export function cpuVelocity(from, aim, sigma, rng = Math.random, solve = idealVelocity) {
  return solve(from, [aim[0] + gauss(rng) * sigma, aim[1] + gauss(rng) * sigma]);
}

// Zittern der Hand zur Zeit t (s): ruhige Überlagerung einiger Schwingungen, höchstens etwa TREMOR
export function tremor(t, seed = 0) {
  const w = (a, b, c) => Math.sin(1.3 * t + a) * 0.55 + Math.sin(2.9 * t + b) * 0.3 + Math.sin(6.1 * t + c) * 0.15;
  return [w(seed, seed * 2 + 1, seed * 3 + 2) * TREMOR, w(seed + 4, seed * 2 + 0.5, seed + 1.7) * TREMOR];
}

// Rückmeldung nach dem Wurf, z. B. „Tempo 108 % · 4° nach rechts“
export function flickText(f) {
  const deg = Math.round((f.angle * 180) / Math.PI);
  const dir = Math.abs(deg) < 2 ? 'gerade' : `${Math.abs(deg)}° nach ${deg > 0 ? 'rechts' : 'links'}`;
  return `Tempo ${Math.round(f.ratio * 100)} % · ${dir}${f.jerk > 0.45 ? ' · ruckelig' : ''}`;
}
