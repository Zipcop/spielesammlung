// Computer für Reversi: Negamax mit Alpha-Beta und iterativer Vertiefung bis zur Zeitgrenze. Bewertung: Feldwerte
// (Ecken viel, die Felder neben einer freien Ecke schlecht), Beweglichkeit (eigene minus gegnerische Zugmöglichkeiten)
// und gegen Ende die Steinzahl. Ist die Suche tief genug, rechnet sie das Ende exakt aus. Stufen: unten zufälliger und
// flacher. Rein (kein DOM) – läuft im Worker (worker.js) und in den Tests.
import { flipsFor, legalMoves, colorOf } from './game.js';

export const LEVELS = [
  { name: 'Anfänger', depth: 1, noise: 0.5 }, // jeder zweite Zug zufällig, sonst nur einen Zug voraus
  { name: 'Mittel', depth: 3, noise: 0.1 },
  { name: 'Stark', depth: 6, ms: 700 },
  { name: 'Meister', depth: 60, ms: 1500 }, // so tief, wie es in 1,5 s geht – am Ende exakt
];

const WIN = 100_000;
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
// Feldwerte (symmetrisch): Ecke 100, Nachbarn der Ecke −20/−50, Ränder gut
const W = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
// Ecke → ihre drei Nachbarn (zählen nicht mehr negativ, sobald die Ecke besetzt ist)
const CORNERS = [[0, [1, 8, 9]], [7, [6, 15, 14]], [56, [57, 48, 49]], [63, [62, 55, 54]]];
const BY_VALUE = [...Array(64).keys()].sort((a, b) => W[b] - W[a]);

// Strahlen ab jedem Feld in die 8 Richtungen (nur solche mit mindestens 2 Feldern – sonst kann nichts eingeschlossen sein)
const RAYS = Array.from({ length: 64 }, (_, k) => {
  const out = [];
  for (const [dr, dc] of DIRS) {
    const ray = [];
    for (let r = (k >> 3) + dr, c = (k & 7) + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) ray.push(r * 8 + c);
    if (ray.length >= 2) out.push(ray);
  }
  return out;
});

// b = Int8Array(64): −1 frei, sonst Farbe
function flipsInto(b, at, me, out) {
  const opp = 1 - me;
  for (const ray of RAYS[at]) {
    let i = 0;
    while (i < ray.length && b[ray[i]] === opp) i++;
    if (i > 0 && i < ray.length && b[ray[i]] === me) for (let j = 0; j < i; j++) out.push(ray[j]);
  }
  return out;
}

function canPlay(b, at, me) {
  const opp = 1 - me;
  for (const ray of RAYS[at]) {
    let i = 0;
    while (i < ray.length && b[ray[i]] === opp) i++;
    if (i > 0 && i < ray.length && b[ray[i]] === me) return true;
  }
  return false;
}

// Züge, die wertvollsten Felder zuerst (bessere Schnitte)
function movesOf(b, me) {
  const out = [];
  for (const k of BY_VALUE) if (b[k] === -1 && canPlay(b, k, me)) out.push(k);
  return out;
}

function mobility(b, me) {
  let n = 0;
  for (let k = 0; k < 64; k++) if (b[k] === -1 && canPlay(b, k, me)) n++;
  return n;
}

// Stellung aus Sicht von me
export function evaluate(b, me) {
  let pos = 0;
  let mine = 0;
  let theirs = 0;
  for (let k = 0; k < 64; k++) {
    if (b[k] === me) {
      pos += W[k];
      mine++;
    } else if (b[k] !== -1) {
      pos -= W[k];
      theirs++;
    }
  }
  for (const [corner, near] of CORNERS) {
    if (b[corner] === -1) continue;
    for (const k of near) if (b[k] !== -1 && W[k] < 0) pos += b[k] === me ? -W[k] : W[k];
  }
  const empty = 64 - mine - theirs;
  const mob = mobility(b, me) - mobility(b, 1 - me);
  return pos + mob * 8 + (empty < 16 ? (mine - theirs) * (16 - empty) : 0);
}

// Partie vorbei: Sieg zählt riesig, dazu der Vorsprung
function final(b, me) {
  let d = 0;
  for (let k = 0; k < 64; k++) if (b[k] !== -1) d += b[k] === me ? 1 : -1;
  return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
}

function play(b, at, me) {
  const flips = flipsInto(b, at, me, []);
  b[at] = me;
  for (const k of flips) b[k] = me;
  return flips;
}

function undo(b, at, me, flips) {
  b[at] = -1;
  for (const k of flips) b[k] = 1 - me;
}

// Negamax: Wert für me am Zug. passed = der andere hat gerade ausgesetzt (kostet keine Tiefe – so reicht Tiefe = freie
// Felder, um das Ende exakt auszurechnen) · empty = freie Felder
function search(b, me, depth, alpha, beta, passed, empty, ctx) {
  if (++ctx.nodes % 1024 === 0 && ctx.deadline && performance.now() > ctx.deadline) throw ctx;
  if (!empty) return final(b, me);
  if (depth <= 0) return evaluate(b, me);
  const moves = movesOf(b, me);
  if (!moves.length) {
    if (passed) return final(b, me);
    return -search(b, 1 - me, depth, -beta, -alpha, true, empty, ctx);
  }
  let best = -Infinity;
  for (const m of moves) {
    const flips = play(b, m, me);
    const v = -search(b, 1 - me, depth - 1, -beta, -alpha, false, empty - 1, ctx);
    undo(b, m, me, flips);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// Wertung jedes Zugs (höher = besser). exact = jeden genau (für den Zufall der unteren Stufen), sonst nur den besten –
// schlechtere bekommen eine obere Schranke unter dem besten (Fenster bis best − 1, die Werte sind ganzzahlig).
function rate(b, me, order, depth, empty, ctx, exact) {
  const out = [];
  let best = -Infinity;
  for (const m of order) {
    const flips = play(b, m, me);
    const v = -search(b, 1 - me, depth - 1, -Infinity, exact ? Infinity : 1 - best, false, empty - 1, ctx);
    undo(b, m, me, flips);
    if (v > best) best = v;
    out.push({ at: m, value: v });
  }
  return out;
}

// Bester Zug für color auf board (game.js-Brett) – Feld oder −1 (muss aussetzen) · rng zum Testen austauschbar
export function chooseMove(board, color, level = 1, rng = Math.random) {
  const lv = LEVELS[level] ?? LEVELS[1];
  const b = Int8Array.from(board, (v) => (v === null ? -1 : v));
  const moves = movesOf(b, color);
  if (moves.length <= 1) return moves[0] ?? -1;
  const ctx = { nodes: 0, deadline: lv.ms ? performance.now() + lv.ms : 0 };
  const empty = b.reduce((n, v) => n + (v === -1), 0);
  let rated = rate(b, color, moves, 1, empty, { nodes: 0, deadline: 0 }, true);
  for (let d = 2; d <= Math.min(lv.depth, empty); d++) {
    const order = [...rated].sort((x, y) => y.value - x.value).map((x) => x.at); // bester Zug der letzten Tiefe zuerst
    try {
      rated = rate(b, color, order, d, empty, ctx, !!lv.noise);
    } catch (e) {
      if (e !== ctx) throw e;
      break;
    }
  }
  if (lv.noise && rng() < lv.noise) return moves[Math.floor(rng() * moves.length)];
  const top = Math.max(...rated.map((x) => x.value));
  const best = rated.filter((x) => x.value === top);
  return best[Math.floor(rng() * best.length)].at;
}

// Allein ohne Hilfen: Schummel-Zug des Computers für Spieler p – { at, flips } – oder null (nichts Lohnendes).
// Entweder eine freie Ecke ohne Einschließen besetzen, oder den geplanten Zug at machen und dabei einen gegnerischen
// Nachbarstein mehr umdrehen, der gar nicht eingeschlossen ist.
export function cheatTurn(s, p, at, rng = Math.random) {
  const color = colorOf(s, p);
  const legal = legalMoves(s.board, color);
  const corners = [0, 7, 56, 63].filter((k) => s.board[k] === null && !legal.includes(k));
  const grab = corners.length ? { at: corners[Math.floor(rng() * corners.length)], flips: [] } : null;
  if (at < 0 || (grab && rng() < 0.5)) return grab;
  const rule = flipsFor(s.board, at, color);
  const extra = RAYS[at].map((ray) => ray[0]).filter((k) => s.board[k] === 1 - color && !rule.includes(k)).sort((x, y) => W[y] - W[x]);
  return extra.length ? { at, flips: [...rule, extra[0]] } : grab;
}
