// Dame-Computer: Alpha-Beta-Suche (Negamax) mit iterativer Vertiefung, Zugtabelle (Zobrist) und Verlängerung, solange
// geschlagen werden muss (sonst übersieht er Schlagfolgen am Suchhorizont). Bewertung: Material (Dame ≈ 3 Steine),
// Vorrücken, Mitte, bewachte Grundreihe, Damen auf der langen Schräge. Ein Zug ist immer der ganze Zug
// { path, took, crown } wie in game.js. Rein (kein DOM) – läuft im Worker (worker.js) und in den Tests.
import { legalMoves, inspect, keyOf, RAYS, forward } from './game.js';

export const LEVELS = [
  { name: 'Leicht', depth: 2, random: 0.3 },
  { name: 'Mittel', depth: 6, random: 0 },
  { name: 'Schwer', depth: 60, ms: 1500, random: 0 },
];

const WIN = 1_000_000;
const MAN = 100;
const KING = 330;

// Lagewert eines Steins von Spieler 0 auf Feld k – für Spieler 1 gespiegelt (63 − k)
const MAN_AT = Array.from({ length: 64 }, (_, k) => {
  const r = k >> 3;
  const c = k & 7;
  let v = (7 - r) * 4; // vorrücken
  if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 6; // Mitte
  if (c === 0 || c === 7) v -= 3; // Rand
  if (r === 7) v += 9; // Grundreihe bewacht gegen gegnerische Damen
  return v;
});
const KING_AT = Array.from({ length: 64 }, (_, k) => ((k >> 3) + (k & 7) === 7 ? 12 : 0)); // lange Schräge a1–h8

let seed = 2024;
const rand32 = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed >>> 0;
};
const Z = Array.from({ length: 64 }, () => [rand32(), rand32(), rand32(), rand32()]);
const Z_SIDE = rand32();

function hashOf(b, p) {
  let z = p ? Z_SIDE : 0;
  for (let k = 0; k < 64; k++) if (b[k] !== null) z ^= Z[k][b[k]];
  return z >>> 0;
}

// Bewertung aus Sicht von p
export function evaluate(b, p) {
  let score = 0;
  let mine = 0;
  let theirs = 0;
  for (let k = 0; k < 64; k++) {
    const x = b[k];
    if (x === null) continue;
    const q = x & 1;
    const at = q === 0 ? k : 63 - k;
    const v = x >= 2 ? KING + KING_AT[at] : MAN + MAN_AT[at];
    if (q === p) {
      score += v;
      mine += x >= 2 ? 3 : 1;
    } else {
      score -= v;
      theirs += x >= 2 ? 3 : 1;
    }
  }
  // vorn liegend: tauschen lohnt sich (weniger Steine auf dem Brett = Vorsprung zählt mehr)
  if (mine !== theirs) score += Math.sign(mine - theirs) * (36 - mine - theirs) * 4;
  return score;
}

function make(b, m) {
  const from = m.path[0];
  const piece = b[from];
  const caps = m.took.map((t) => b[t]);
  b[from] = null;
  for (const t of m.took) b[t] = null;
  b[m.path[m.path.length - 1]] = m.crown ? piece | 2 : piece;
  return { piece, caps };
}

function unmake(b, m, u) {
  b[m.path[m.path.length - 1]] = null;
  b[m.path[0]] = u.piece;
  m.took.forEach((t, i) => (b[t] = u.caps[i]));
}

const idOf = (m) => m.path.join(',');

class Timeout extends Error {}

// Suche mit eigener Zugtabelle; deadline = Zeitgrenze (ms) oder Infinity
function searcher(now, deadline) {
  const table = new Map();
  let nodes = 0;
  function search(b, p, depth, alpha, beta, ply) {
    if (++nodes % 2048 === 0 && now() > deadline) throw new Timeout();
    const moves = legalMoves(b, p);
    if (!moves.length) return -WIN + ply;
    const jumping = moves[0].took.length > 0;
    if ((depth <= 0 && !jumping) || ply > 80) return evaluate(b, p);
    const key = hashOf(b, p);
    const hit = table.get(key);
    if (hit && hit.depth >= depth) {
      if (hit.flag === 0) return hit.score;
      if (hit.flag < 0 && hit.score <= alpha) return alpha;
      if (hit.flag > 0 && hit.score >= beta) return beta;
    }
    order(moves, hit?.best);
    const start = alpha;
    let best = null;
    for (const m of moves) {
      const u = make(b, m);
      const score = -search(b, 1 - p, depth - 1, -beta, -alpha, ply + 1);
      unmake(b, m, u);
      if (score > alpha) {
        alpha = score;
        best = m;
        if (alpha >= beta) break;
      }
    }
    table.set(key, { depth, score: alpha, flag: alpha <= start ? -1 : alpha >= beta ? 1 : 0, best: best ? idOf(best) : hit?.best });
    return alpha;
  }
  return search;
}

function order(moves, first) {
  const score = (m) => (first && idOf(m) === first ? 1000 : 0) + m.took.length * 10 + (m.crown ? 5 : 0);
  moves.sort((a, b) => score(b) - score(a));
}

// level = Index in LEVELS · s.positions: Stellungen für die Wiederholung (vorn liegend meidet er sie)
export function chooseMove(s, p, { level = 1, rng = Math.random, now = () => Date.now() } = {}) {
  const cfg = LEVELS[level] ?? LEVELS[1];
  const b = s.board.slice();
  const roots = legalMoves(b, p);
  if (!roots.length) return null;
  if (roots.length === 1) return roots[0];
  for (let i = roots.length - 1; i > 0; i--) { // gleich gute Züge: nicht immer derselbe
    const j = Math.floor(rng() * (i + 1));
    [roots[i], roots[j]] = [roots[j], roots[i]];
  }
  if (rng() < cfg.random) return roots[0];

  const search = searcher(now, cfg.ms ? now() + cfg.ms : Infinity);
  const repeated = (m) => {
    if (!s.positions?.length) return false;
    const u = make(b, m);
    const key = keyOf(b, 1 - p);
    unmake(b, m, u);
    return s.positions.filter((k) => k === key).length >= 2;
  };
  let chosen = roots[0];
  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      let alpha = -Infinity;
      let best = null;
      for (const m of roots) {
        let score;
        if (repeated(m)) score = 0;
        else {
          const u = make(b, m);
          score = -search(b, 1 - p, depth - 1, -Infinity, -alpha, 1);
          unmake(b, m, u);
        }
        if (score > alpha) {
          alpha = score;
          best = m;
        }
      }
      chosen = best;
      roots.splice(roots.indexOf(best), 1);
      roots.unshift(best); // bester Zug zuerst in der nächsten Runde
      if (Math.abs(alpha) > WIN / 2) break; // Sieg oder Niederlage sicher
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break; // Zeit um: es gilt der beste Zug der letzten fertigen Tiefe (b ist dann durcheinander, wird nicht mehr gebraucht)
    }
  }
  return chosen;
}

// Allein ohne Hilfen: Schummelzug des Computers – mit einem Stein rückwärts schlagen, den Schlagzwang übergehen oder
// einen Stein rückwärts ziehen. Er nimmt den, der nach kurzer Suche am besten aussieht. null, wenn nichts geht.
export function cheatMove(s, p, rng = Math.random) {
  const b = s.board;
  const back = -forward(p);
  const options = [];
  const forced = legalMoves(b, p).some((m) => m.took.length);
  for (let k = 0; k < 64; k++) {
    const x = b[k];
    if (x === null || (x & 1) !== p) continue;
    const king = x >= 2;
    for (let d = 0; d < 4; d++) {
      const ray = RAYS[k][d];
      if (!ray.length) continue;
      const dr = (ray[0] >> 3) - (k >> 3);
      if (!king && dr === back) {
        // rückwärts schlagen (direkt dahinter) oder rückwärts ziehen
        if (ray.length > 1 && b[ray[0]] !== null && (b[ray[0]] & 1) !== p && b[ray[1]] === null) options.push([k, ray[1]]);
        else if (b[ray[0]] === null) options.push([k, ray[0]]);
      } else if (forced) {
        // Schlagzwang übergehen: einfach ziehen
        for (const to of king ? ray : ray.slice(0, 1)) {
          if (b[to] !== null) break;
          options.push([k, to]);
        }
      }
    }
  }
  const search = searcher(() => 0, Infinity);
  let best = null;
  let bestScore = -Infinity;
  for (const path of options) {
    const c = inspect(b, p, path);
    if (!c || !c.why.length) continue;
    const m = { path, took: c.took, crown: c.crown };
    const work = b.slice();
    make(work, m);
    const score = -search(work, 1 - p, 2, -Infinity, Infinity, 1) + rng() * 20;
    if (score > bestScore) [best, bestScore] = [m, score];
  }
  return best && { path: best.path, crown: best.crown };
}
