// Mühle-Computer: Alpha-Beta-Suche (Negamax) mit iterativer Vertiefung, Zugtabelle (Zobrist) und einfacher
// Stellungsbewertung (Steine, offene Mühlen, Beweglichkeit). Ein „Zug“ ist hier immer der ganze Zug:
// setzen oder ziehen und – wenn dabei eine Mühle zu ist – der geschlagene Stein: { from, to, take } (from/take -1 = keiner).
// Rein (kein DOM) – läuft im Worker (worker.js) und in den Tests.
import { NEIGHBORS, MILLS, phaseOf } from './game.js';

export const LEVELS = [
  { name: 'Leicht', depth: 2, random: 0.3 },
  { name: 'Mittel', depth: 4, random: 0 },
  { name: 'Schwer', depth: 30, ms: 1500, random: 0 },
];

const WIN = 1_000_000;
const MILLS_AT = Array.from({ length: 24 }, (_, i) => MILLS.filter((m) => m.includes(i)));

// Zobrist-Schlüssel: Punkt × Farbe, Steine in der Hand, wer dran ist
let seed = 12345;
const rand32 = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed >>> 0;
};
const Z_POINT = Array.from({ length: 24 }, () => [rand32(), rand32()]);
const Z_HAND = [Array.from({ length: 10 }, rand32), Array.from({ length: 10 }, rand32)];
const Z_SIDE = rand32();

// Arbeitsstand der Suche: b = Brett (-1 leer), h = Hand, c = Steine auf dem Brett
function fromState(s) {
  const b = Int8Array.from(s.board, (x) => (x === null ? -1 : x));
  return { b, h: [...s.hand], c: [0, 1].map((p) => b.filter((x) => x === p).length) };
}

const inMill = (b, i) => b[i] >= 0 && MILLS_AT[i].some((m) => b[m[0]] === b[i] && b[m[1]] === b[i] && b[m[2]] === b[i]);
const allInMills = (b, p) => b.every((x, i) => x !== p || inMill(b, i));

// Alle regelgerechten Züge von p
function turnsOf(pos, p) {
  const { b, h, c } = pos;
  const o = 1 - p;
  const out = [];
  const add = (from, to) => {
    if (from >= 0) b[from] = -1;
    b[to] = p;
    if (inMill(b, to) && c[o] > 0) {
      const all = allInMills(b, o);
      for (let k = 0; k < 24; k++) if (b[k] === o && (all || !inMill(b, k))) out.push({ from, to, take: k });
    } else out.push({ from, to, take: -1 });
    b[to] = -1;
    if (from >= 0) b[from] = p;
  };
  if (h[p] > 0) {
    for (let to = 0; to < 24; to++) if (b[to] < 0) add(-1, to);
  } else if (c[p] === 3) {
    for (let from = 0; from < 24; from++) if (b[from] === p) for (let to = 0; to < 24; to++) if (b[to] < 0) add(from, to);
  } else {
    for (let from = 0; from < 24; from++) if (b[from] === p) for (const to of NEIGHBORS[from]) if (b[to] < 0) add(from, to);
  }
  return out;
}

function apply(pos, p, t) {
  const { b, h, c } = pos;
  if (t.from >= 0) b[t.from] = -1;
  else h[p]--, c[p]++;
  b[t.to] = p;
  if (t.take >= 0) b[t.take] = -1, c[1 - p]--;
}

function undo(pos, p, t) {
  const { b, h, c } = pos;
  if (t.take >= 0) b[t.take] = 1 - p, c[1 - p]++;
  b[t.to] = -1;
  if (t.from >= 0) b[t.from] = p;
  else h[p]++, c[p]--;
}

function hashOf(pos, p) {
  let z = p ? Z_SIDE : 0;
  for (let i = 0; i < 24; i++) if (pos.b[i] >= 0) z ^= Z_POINT[i][pos.b[i]];
  return (z ^ Z_HAND[0][pos.h[0]] ^ Z_HAND[1][pos.h[1]]) >>> 0;
}

// Bewertung aus Sicht von p
function evaluate(pos, p) {
  const { b, h, c } = pos;
  const o = 1 - p;
  let score = 0;
  for (const q of [p, o]) {
    const sign = q === p ? 1 : -1;
    const flying = h[q] === 0 && c[q] === 3;
    let open = 0;
    let mills = 0;
    for (const m of MILLS) {
      let own = 0;
      let empty = -1;
      for (const i of m) {
        if (b[i] === q) own++;
        else if (b[i] < 0) empty = i;
        else own = -9;
      }
      if (own === 3) mills++;
      // offene Mühle: zwei eigene, der dritte Punkt frei und erreichbar (setzen, springen oder ein Nachbarstein)
      else if (own === 2 && empty >= 0 && (h[q] > 0 || flying || NEIGHBORS[empty].some((j) => b[j] === q && !m.includes(j)))) open++;
    }
    let mobile = 0;
    if (h[q] === 0 && !flying) for (let i = 0; i < 24; i++) if (b[i] === q) for (const j of NEIGHBORS[i]) if (b[j] < 0) mobile++;
    score += sign * (300 * (c[q] + h[q]) + 40 * open + 12 * mills + 6 * mobile);
  }
  return score;
}

class Timeout extends Error {}

// level = Index in LEVELS · history = Stellungsschlüssel aus game.js (Wiederholung vermeiden, wenn er vorn liegt)
export function chooseTurn(s, p, { level = 1, rng = Math.random, now = () => Date.now() } = {}) {
  const cfg = LEVELS[level] ?? LEVELS[1];
  const pos = fromState(s);
  const roots = turnsOf(pos, p);
  if (!roots.length) return null;
  for (let i = roots.length - 1; i > 0; i--) { // gleich gute Züge: nicht immer derselbe
    const j = Math.floor(rng() * (i + 1));
    [roots[i], roots[j]] = [roots[j], roots[i]];
  }
  if (rng() < cfg.random) return roots[0];

  const table = new Map(); // Schlüssel → { depth, score, flag, best }
  const deadline = cfg.ms ? now() + cfg.ms : Infinity;
  let nodes = 0;
  const repeated = (t) => {
    if (!s.positions?.length || pos.h[0] || pos.h[1]) return false;
    apply(pos, p, t);
    const key = `${Array.from(pos.b, (x) => (x < 0 ? '.' : x)).join('')}${1 - p}`;
    undo(pos, p, t);
    return s.positions.filter((k) => k === key).length >= 2;
  };

  function search(q, depth, alpha, beta, ply) {
    if (++nodes % 2048 === 0 && now() > deadline) throw new Timeout();
    if (pos.c[q] + pos.h[q] < 3) return -WIN + ply;
    const key = hashOf(pos, q);
    const hit = table.get(key);
    if (hit && hit.depth >= depth) {
      if (hit.flag === 0) return hit.score;
      if (hit.flag < 0 && hit.score <= alpha) return alpha;
      if (hit.flag > 0 && hit.score >= beta) return beta;
    }
    const turns = turnsOf(pos, q);
    if (!turns.length) return -WIN + ply; // eingesperrt
    if (depth <= 0) return evaluate(pos, q);
    order(turns, hit?.best);
    const start = alpha;
    let best = null;
    for (const t of turns) {
      apply(pos, q, t);
      const score = -search(1 - q, depth - 1, -beta, -alpha, ply + 1);
      undo(pos, q, t);
      if (score > alpha) {
        alpha = score;
        best = t;
        if (alpha >= beta) break;
      }
    }
    table.set(key, { depth, score: alpha, flag: alpha <= start ? -1 : alpha >= beta ? 1 : 0, best: best ?? hit?.best });
    return alpha;
  }

  let chosen = roots[0];
  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      let alpha = -Infinity;
      let best = null;
      for (const t of roots) {
        let score;
        if (repeated(t)) score = 0;
        else {
          apply(pos, p, t);
          score = -search(1 - p, depth - 1, -Infinity, -alpha, 1);
          undo(pos, p, t);
        }
        if (score > alpha) {
          alpha = score;
          best = t;
        }
      }
      chosen = best;
      roots.splice(roots.indexOf(best), 1);
      roots.unshift(best); // bester Zug zuerst in der nächsten Runde
      if (Math.abs(alpha) > WIN / 2) break; // Sieg oder Niederlage sicher
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break; // Zeit um: es gilt der beste Zug der letzten fertigen Tiefe (pos wird danach nicht mehr gebraucht)
    }
  }
  return chosen;

  function order(turns, first) {
    turns.sort((a, b) => score(b) - score(a));
    function score(t) {
      if (first && t.from === first.from && t.to === first.to && t.take === first.take) return 1000;
      return t.take >= 0 ? 100 : 0;
    }
  }
}

// Allein ohne Hilfen: Schummelzug des Computers – in eine Mühle springen (obwohl er mehr als 3 Steine hat),
// aus einer Mühle schlagen oder ohne Mühle schlagen. base = sein normaler Zug. null, wenn nichts geht.
export function cheatTurn(s, p, base, rng = Math.random) {
  const pos = fromState(s);
  const { b } = pos;
  const o = 1 - p;
  const options = [];
  const pickFrom = (list) => list[Math.floor(rng() * list.length)];
  if (phaseOf(s, p) === 'move') {
    for (let from = 0; from < 24; from++) {
      if (b[from] !== p) continue;
      for (let to = 0; to < 24; to++) {
        if (b[to] >= 0 || NEIGHBORS[from].includes(to)) continue;
        b[from] = -1;
        b[to] = p;
        const mill = inMill(b, to);
        const victims = mill ? b.reduce((l, x, k) => (x === o ? [...l, k] : l), []) : [];
        b[to] = -1;
        b[from] = p;
        if (victims.length) options.push({ from, to, take: pickFrom(victims) });
      }
    }
  }
  if (base) {
    apply(pos, p, { ...base, take: -1 }); // Stand vor dem Schlagen: nur dann ist ein Stein aus einer Mühle verboten
    const theirs = b.reduce((l, x, k) => (x === o ? [...l, k] : l), []);
    const inMills = theirs.filter((k) => inMill(b, k));
    if (base.take >= 0 && inMills.length && inMills.length < theirs.length) options.push({ ...base, take: pickFrom(inMills) });
    else if (base.take < 0 && theirs.length) options.push({ ...base, take: pickFrom(theirs) });
  }
  return options.length ? pickFrom(options) : null;
}
