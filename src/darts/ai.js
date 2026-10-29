// Computer-Gegner beim Darts: wählt sein Ziel wie ein Spieler (Treble 20 zum Punkten, auf Checkout-Wegen das passende
// Feld, ohne Checkout ein Feld, das einen guten Rest lässt) und wirft mit einer Streuung je Stufe um dieses Ziel.
// Rein (kein three.js). Ohne Hilfen trägt er seine Aufnahme selbst ein – ab und zu falsch (fakeClaim).
import { checkout, value, ORDER } from './rules.js';

// sigma = Streuung in Metern um den Zielpunkt (je Richtung) – Schnitt ≈ 3-Dart-Average (test/darts.test.js)
export const LEVELS = [
  { name: 'Anfänger', sigma: 0.035 },
  { name: 'Kneipe', sigma: 0.018 },
  { name: 'Verein', sigma: 0.012 },
  { name: 'Profi', sigma: 0.008 },
];

const SINGLES = ORDER.flatMap((n) => [`S${n}`, `T${n}`, `D${n}`]).concat(['25', 'Bull']);

// Wie gut ist dieser Rest für die nächste Aufnahme? (kleiner = besser)
function leaveCost(rest) {
  if (rest < 2) return Infinity;
  for (const k of [1, 2, 3]) if (checkout(rest, k)) return k * 10 + (checkout(rest, k).length === 1 && rest > 40 ? 2 : 0);
  return 40 + rest / 100;
}

// Ziel für den nächsten Pfeil: rest = eigener Rest, darts = übrige Pfeile dieser Aufnahme
export function chooseTarget(rest, darts) {
  const route = checkout(rest, darts);
  if (route) return route[0];
  if (rest > 230) return 'T20';
  // kein Checkout mehr in dieser Aufnahme: so stellen, dass ein guter Rest bleibt (ohne zu überwerfen)
  let best = 'T20';
  let cost = leaveCost(rest - 60) + (rest - 60 < 2 ? Infinity : 0);
  for (const t of SINGLES) {
    const c = leaveCost(rest - value(t)) + (t[0] === 'T' ? 0.5 : t[0] === 'D' || t === 'Bull' ? 1.5 : 0);
    if (c < cost) [cost, best] = [c, t];
  }
  return best;
}

// Ohne Hilfen: falscher Eintrag, der glaubhaft klingt – ein Single als Triple gezählt, oder ein Checkout behauptet.
// truth = { points, bust } der Aufnahme, labels = getroffene Felder, rest = Rest vor der Aufnahme. null = geht nicht.
export function fakeClaim(truth, labels, rest, rng = Math.random) {
  const options = [];
  for (const l of labels) {
    if (l[0] === 'S') options.push(truth.points + 2 * value(l), truth.points + value(l));
  }
  if (truth.bust) options.push(labels.reduce((sum, l) => sum + value(l), 0)); // überworfen, trotzdem gezählt
  if (rest <= 170 && rest - truth.points <= 40) options.push(rest); // Checkout behaupten
  const ok = options.filter((c) => c !== truth.points && c >= 0 && c <= 180 && (rest - c === 0 || rest - c >= 2));
  return ok.length ? ok[Math.floor(rng() * ok.length)] : null;
}
