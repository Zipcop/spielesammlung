// Computer für Vier gewinnt: Negamax mit Alpha-Beta, Zugfolge von der Mitte nach außen, Zugtabelle (Zobrist) und
// iterativer Vertiefung bis zur Zeitgrenze. Bewertung: alle 69 Vierer-Fenster (3 eigene + 1 frei zählt viel,
// 2 + 2 frei wenig) und Steine in der Mitte. Stufen wie bei Schach: unten zufälliger und flacher.
import { COLS, ROWS } from './game.js';

export const LEVELS = [
  { name: 'Anfänger', depth: 2, noise: 0.45 }, // jeder zweite Zug ungefähr zufällig, sieht nur 2 Steine voraus
  { name: 'Mittel', depth: 4, noise: 0.12 },
  { name: 'Stark', depth: 8, noise: 0, ms: 900 },
  { name: 'Meister', depth: 42, noise: 0, ms: 450 }, // so tief, wie es in 0,45 s geht
];

const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;
const CELLS = COLS * ROWS;
const idx = (c, r) => c * ROWS + r;

// Alle Fenster aus vier Feldern (waagrecht, senkrecht, diagonal)
const WINDOWS = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const end = [c + 3 * dc, r + 3 * dr];
      if (end[0] < COLS && end[1] >= 0 && end[1] < ROWS) WINDOWS.push([0, 1, 2, 3].map((k) => idx(c + k * dc, r + k * dr)));
    }
  }
}
const CENTER = [0, 1, 2, 4, 2, 1, 0]; // Wert eines Steins je Spalte

// Zobrist-Schlüssel aus zwei 26-Bit-Hälften (bleibt eine sichere Ganzzahl)
const rand26 = () => Math.floor(Math.random() * 2 ** 26);
const ZOB = [0, 1].map(() => Array.from({ length: CELLS }, () => [rand26(), rand26()]));

// Suchbrett: cells = -1 frei, sonst Farbe · heights = Steine je Spalte
function toSearch(s) {
  const cells = new Int8Array(CELLS).fill(-1);
  const heights = new Int8Array(COLS);
  let hi = 0;
  let lo = 0;
  s.board.forEach((col, c) => col.forEach((color, r) => {
    cells[idx(c, r)] = color;
    hi ^= ZOB[color][idx(c, r)][0];
    lo ^= ZOB[color][idx(c, r)][1];
    heights[c] = r + 1;
  }));
  return { cells, heights, hi, lo, count: s.board.reduce((n, col) => n + col.length, 0) };
}

function wins(b, c, r, color) {
  const at = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS && b.cells[idx(x, y)] === color;
  for (const [dc, dr] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let n = 1;
    for (let x = c + dc, y = r + dr; at(x, y); x += dc, y += dr) n++;
    for (let x = c - dc, y = r - dr; at(x, y); x -= dc, y -= dr) n++;
    if (n >= 4) return true;
  }
  return false;
}

// Gewänne color mit einem Stein in Spalte c?
function winsAt(b, c, color) {
  const k = idx(c, b.heights[c]);
  b.cells[k] = color;
  const w = wins(b, c, b.heights[c], color);
  b.cells[k] = -1;
  return w;
}

function put(b, c, color) {
  const r = b.heights[c]++;
  const k = idx(c, r);
  b.cells[k] = color;
  b.hi ^= ZOB[color][k][0];
  b.lo ^= ZOB[color][k][1];
  b.count++;
  return r;
}

function take(b, c) {
  const r = --b.heights[c];
  const k = idx(c, r);
  const color = b.cells[k];
  b.cells[k] = -1;
  b.hi ^= ZOB[color][k][0];
  b.lo ^= ZOB[color][k][1];
  b.count--;
}

// Stellung aus Sicht von color
export function evaluate(b, color) {
  let score = 0;
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const k of w) {
      const v = b.cells[k];
      if (v === color) mine++;
      else if (v !== -1) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) score += 50;
    else if (mine === 2) score += 6;
    else if (theirs === 3) score -= 55;
    else if (theirs === 2) score -= 6;
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < b.heights[c]; r++) score += (b.cells[idx(c, r)] === color ? 1 : -1) * CENTER[c] * 3;
  }
  return score;
}

// Negamax: Wert für color am Zug. Siege früher = besser (WIN − Tiefe).
function search(b, color, depth, alpha, beta, ply, ctx) {
  if (++ctx.nodes % 2048 === 0 && ctx.deadline && performance.now() > ctx.deadline) throw ctx;
  for (const c of ORDER) if (b.heights[c] < ROWS && winsAt(b, c, color)) return WIN - ply; // sofort gewinnen?
  if (b.count >= CELLS - 1) return 0; // nur noch ein Feld frei und es gewinnt nicht → Remis
  if (depth === 0) return evaluate(b, color);
  const key = b.hi * 2 ** 26 + b.lo + (color ? 0.5 : 0);
  const hit = ctx.table.get(key);
  let first = -1;
  if (hit) {
    if (hit.depth >= depth) {
      if (hit.flag === 0) return hit.value;
      if (hit.flag === 1 && hit.value >= beta) return hit.value;
      if (hit.flag === -1 && hit.value <= alpha) return hit.value;
    }
    first = hit.best;
  }
  const start = alpha;
  let best = -Infinity;
  let bestCol = -1;
  for (const c of first >= 0 ? [first, ...ORDER.filter((x) => x !== first)] : ORDER) {
    if (b.heights[c] >= ROWS) continue;
    put(b, c, color);
    const v = -search(b, 1 - color, depth - 1, -beta, -alpha, ply + 1, ctx);
    take(b, c);
    if (v > best) [best, bestCol] = [v, c];
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  ctx.table.set(key, { depth, value: best, best: bestCol, flag: best <= start ? -1 : best >= beta ? 1 : 0 });
  return best;
}

// Wertung jeder freien Spalte für color (höher = besser) – Tiefe gilt ab dem Zug in diese Spalte.
// exact = jede Spalte genau bewerten (für den Zufall der unteren Stufen); sonst nur, ob sie an die beste herankommt.
function rate(b, color, depth, ctx, exact) {
  const out = [];
  let best = -Infinity;
  for (const c of ORDER) {
    if (b.heights[c] >= ROWS) continue;
    const r = put(b, c, color);
    const v = wins(b, c, r, color) ? WIN : -search(b, 1 - color, depth - 1, -Infinity, exact ? Infinity : -(best - 1), 1, ctx);
    best = Math.max(best, v);
    take(b, c);
    out.push({ col: c, value: v });
  }
  return out;
}

// Bester Stein für color in Stand s (Spalte) · rng zum Testen austauschbar
export function chooseMove(s, color, level = 1, rng = Math.random) {
  const lv = LEVELS[level] ?? LEVELS[1];
  const b = toSearch(s);
  const ctx = { nodes: 0, table: new Map(), deadline: lv.ms ? performance.now() + lv.ms : 0 };
  let rated = rate(b, color, 1, { ...ctx, deadline: 0 }, true);
  // iterative Vertiefung: jede fertige Tiefe gilt, die abgebrochene nicht
  for (let d = 2; d <= Math.min(lv.depth, CELLS - b.count); d++) {
    try {
      rated = rate(b, color, d, ctx, !!lv.noise);
    } catch (e) {
      if (e !== ctx) throw e;
      break;
    }
    if (rated.some((x) => x.value >= WIN - CELLS)) break; // Sieg gefunden
  }
  const top = Math.max(...rated.map((x) => x.value));
  const win = rated.find((x) => x.value === WIN); // Sofortsieg nimmt jede Stufe
  if (win) return win.col;
  // Anfänger/Mittel: ab und zu eine zufällige, nicht sofort verlierende Spalte
  if (lv.noise && rng() < lv.noise) {
    const safe = rated.filter((x) => x.value > -WIN + CELLS);
    const pool = safe.length ? safe : rated;
    return pool[Math.floor(rng() * pool.length)].col;
  }
  const best = rated.filter((x) => x.value === top);
  return best[Math.floor(rng() * best.length)].col;
}

// Allein ohne Hilfen: Schummel-Stein des Computers – entweder nach dem eigenen gleich noch einer ({ twice: true }) oder ein
// Stein in der Farbe des Menschen dorthin, wo er ihm am wenigsten nützt ({ col, color }). null = Brett voll.
export function cheatMove(s, color, rng = Math.random) {
  const b = toSearch(s);
  const open = ORDER.filter((c) => b.heights[c] < ROWS);
  if (!open.length) return null;
  if (rng() < 0.5) return { twice: true };
  const other = 1 - color;
  const scored = open.map((c) => {
    const r = put(b, c, other);
    const v = wins(b, c, r, other) ? Infinity : evaluate(b, other);
    take(b, c);
    return { c, v };
  });
  scored.sort((x, y) => x.v - y.v);
  return { col: scored[0].c, color: other };
}
