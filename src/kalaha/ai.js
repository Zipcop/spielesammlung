// Computer für Kalaha: Negamax mit Alpha-Beta und iterativer Vertiefung bis zur Zeitgrenze. Ein Zug mit dem letzten
// Stein im eigenen Kalaha (nochmal dran) wechselt die Seite nicht. Bewertung: Vorsprung im Kalaha (zählt viermal) plus
// Steine auf der eigenen Seite. Ist eine Seite leer, wird das Ende genau gezählt. Stufen: unten zufälliger und flacher.
// Rein (kein DOM) – läuft im Worker (worker.js) und in den Tests.
import { sow, STORE, pitsOf, opposite, isStore, ownerOf, planOf } from './game.js';

export const LEVELS = [
  { name: 'Anfänger', depth: 1, noise: 0.4 }, // fast jeder zweite Zug zufällig, sonst nur einen Zug voraus
  { name: 'Mittel', depth: 4, noise: 0.1 },
  { name: 'Stark', depth: 12, ms: 700 },
  { name: 'Meister', depth: 40, ms: 1500 }, // so tief, wie es in 1,5 s geht
];

const WIN = 100_000;
const SIDE = [[0, 1, 2, 3, 4, 5], [7, 8, 9, 10, 11, 12]];

const sideSum = (b, p) => SIDE[p].reduce((a, i) => a + b[i], 0);

// Ende? Eine Seite leer → genaue Wertung für me (Reststeine gehören dem, auf dessen Seite sie liegen), sonst null
function final(b, me) {
  const a = sideSum(b, 0);
  const c = sideSum(b, 1);
  if (a && c) return null;
  const d = (b[STORE[me]] + (me === 0 ? a : c)) - (b[STORE[1 - me]] + (me === 0 ? c : a));
  return d > 0 ? WIN + d : d < 0 ? -WIN + d : 0;
}

export function evaluate(b, me) {
  return 4 * (b[STORE[me]] - b[STORE[1 - me]]) + sideSum(b, me) - sideSum(b, 1 - me);
}

// Züge mit Brett danach, die vielversprechenden zuerst: nochmal dran, dann Fang, dann der Rest (bessere Schnitte)
function movesOf(b, me) {
  const out = [];
  for (const i of SIDE[me]) {
    if (!b[i]) continue;
    const r = sow(b, me, i);
    out.push({ at: i, pits: r.pits, bonus: r.bonus, rank: r.bonus ? 2 : r.capture ? 1 : 0 });
  }
  return out.sort((x, y) => y.rank - x.rank);
}

// Negamax: Wert für me am Zug
function search(b, me, depth, alpha, beta, ctx) {
  if (++ctx.nodes % 1024 === 0 && ctx.deadline && performance.now() > ctx.deadline) throw ctx;
  const end = final(b, me);
  if (end !== null) return end;
  if (depth <= 0) return evaluate(b, me);
  let best = -Infinity;
  for (const { pits, bonus } of movesOf(b, me)) {
    const v = bonus ? search(pits, me, depth - 1, alpha, beta, ctx) : -search(pits, 1 - me, depth - 1, -beta, -alpha, ctx);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

// Wertung jedes Zugs (höher = besser). exact = jeden genau (für den Zufall der unteren Stufen), sonst nur den besten –
// schlechtere bekommen eine obere Schranke unter dem besten (Fenster bis best − 1, die Werte sind ganzzahlig).
function rate(b, me, order, depth, ctx, exact) {
  const out = [];
  let best = -Infinity;
  for (const m of order) {
    const v = m.bonus ? search(m.pits, me, depth - 1, exact ? -Infinity : best - 1, Infinity, ctx)
      : -search(m.pits, 1 - me, depth - 1, -Infinity, exact ? Infinity : 1 - best, ctx);
    if (v > best) best = v;
    out.push({ ...m, value: v });
  }
  return out;
}

// Bester Zug für Spieler p auf pits (game.js) – Mulde · rng zum Testen austauschbar
export function chooseMove(pits, p, level = 1, rng = Math.random) {
  const lv = LEVELS[level] ?? LEVELS[1];
  const b = [...pits];
  const moves = movesOf(b, p);
  if (moves.length <= 1) return moves[0]?.at ?? -1;
  if (lv.noise && rng() < lv.noise) return moves[Math.floor(rng() * moves.length)].at;
  const ctx = { nodes: 0, deadline: lv.ms ? performance.now() + lv.ms : 0 };
  let rated = rate(b, p, moves, 1, { nodes: 0, deadline: 0 }, true);
  for (let d = 2; d <= lv.depth; d++) {
    const order = [...rated].sort((x, y) => y.value - x.value); // bester Zug der letzten Tiefe zuerst
    try {
      rated = rate(b, p, order, d, ctx, !!lv.noise);
    } catch (e) {
      if (e !== ctx) throw e;
      break;
    }
  }
  const top = Math.max(...rated.map((x) => x.value));
  const best = rated.filter((x) => x.value === top);
  return best[Math.floor(rng() * best.length)].at;
}

// Allein ohne Hilfen: Schummel-Zug des Computers für Spieler p – Plan für turnOf – oder null (nichts Lohnendes).
// Entweder fangen, obwohl der letzte Stein in einer nicht leeren eigenen Mulde liegt, oder nach dem richtigen Zug
// einen Stein aus der vollsten Mulde des anderen ins eigene Kalaha schmuggeln.
export function cheatTurn(s, p, from) {
  if (from < 0) return null;
  const plan = planOf(s.pits, p, from);
  const r = sow(s.pits, p, from);
  const last = r.path.at(-1);
  if (!r.capture && !isStore(last) && ownerOf(last) === p && r.pits[opposite(last)] >= 2) return { ...plan, captures: [last] };
  const after = r.pits;
  const rich = pitsOf(1 - p).filter((i) => after[i] > 0).sort((x, y) => after[y] - after[x])[0];
  return rich === undefined ? null : { ...plan, shifts: [[rich, STORE[p]]] };
}
