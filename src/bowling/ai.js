// Computer-Gegner beim Bowling (rein, ohne Grafik): wählt Standpunkt, Richtung, Tempo und Drall – je Stufe mit mehr
// oder weniger Streuung. Volle Aufstellung: Hook-Wurf in die „Tasche“ zwischen Pin 1 und 3 (wie ein Rechtshänder).
// Rest stehen lassen (Spare): gerade auf den vordersten Pin, von der Gegenseite schräg über die Bahn.
import { RELEASE_Z, FOUL_TEMPO } from './physics.js';
import { SPOTS } from './rules.js';

// sx/sa/st/sh = Streuung (Standardabweichung) von Standpunkt (m), Richtung (Grad), Tempo und Drall
// x/angle = Strike-Linie für Tempo und Drall der Stufe (in Node mit der Physik ausgemessen: so kommt die Kugel 6 cm
// rechts von Pin 1 an, in der Tasche 1–3); Anfänger werfen gerade
export const LEVELS = [
  { name: 'Anfänger', sx: 0.05, sa: 0.75, st: 0.12, sh: 0.25, tempo: 0.58, hook: 0, x: 0.06, angle: 0 },
  { name: 'Freizeit', sx: 0.04, sa: 0.55, st: 0.06, sh: 0.18, tempo: 0.6, hook: 0.35, x: 0.3, angle: -0.006 },
  { name: 'Liga', sx: 0.02, sa: 0.28, st: 0.035, sh: 0.1, tempo: 0.62, hook: 0.5, x: 0.3, angle: -0.0035 },
  { name: 'Profi', sx: 0.008, sa: 0.1, st: 0.02, sh: 0.05, tempo: 0.64, hook: 0.6, x: 0.3, angle: -0.0021 },
];

// Normalverteilte Zufallszahl (Box-Muller)
function gauss(rng) {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const clampX = (x) => Math.max(-0.45, Math.min(x, 0.45));

// Richtung von x0 aus auf den Punkt [x, z] (Bogenmaß, + = nach rechts)
export const angleTo = (x0, [x, z]) => Math.atan2(x - x0, RELEASE_Z - z);

// Plan ohne Streuung: { x, angle, tempo, hook }
export function idealPlan(pins, level = LEVELS[2]) {
  const up = pins.map((p, n) => (p ? { n, p } : null)).filter(Boolean);
  if (up.length === 10 && up.every(({ n, p }) => Math.hypot(p[0] - SPOTS[n][0], p[1] - SPOTS[n][1]) < 0.01)) {
    return { x: level.x, angle: level.angle, tempo: level.tempo, hook: level.hook };
  }
  if (!up.length) return { x: 0, angle: 0, tempo: level.tempo, hook: 0 };
  // Spare: vorderster Pin, etwas zur Mitte der übrigen hin; von der Gegenseite aus schräg
  const front = up.reduce((a, b) => (b.p[1] > a.p[1] ? b : a)).p;
  const mid = up.reduce((t, { p }) => t + p[0], 0) / up.length;
  const target = [front[0] + Math.max(-0.05, Math.min((mid - front[0]) * 0.5, 0.05)), front[1]];
  const x = clampX(-target[0] * 0.8);
  return { x, angle: angleTo(x, target), tempo: Math.min(level.tempo + 0.08, FOUL_TEMPO - 0.05), hook: 0 };
}

// Plan mit Streuung je Stufe; rng zum Testen austauschbar
export function plan(pins, levelIndex, rng = Math.random) {
  const level = LEVELS[levelIndex] ?? LEVELS[1];
  const ideal = idealPlan(pins, level);
  return {
    x: clampX(ideal.x + gauss(rng) * level.sx),
    angle: ideal.angle + (gauss(rng) * level.sa * Math.PI) / 180,
    tempo: Math.max(0.05, Math.min(ideal.tempo + gauss(rng) * level.st, 1)),
    hook: Math.max(-1, Math.min(ideal.hook + gauss(rng) * level.sh, 1)),
  };
}
