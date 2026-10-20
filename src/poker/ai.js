// Computer-Gegner für Texas Hold'em (nur beim Host). Sieht nur seine Sicht (viewFor) und entscheidet nach:
// - Handstärke: Gewinnchance per Simulation gegen die Gegner, die noch dabei sind. Wer in dieser Hand schon gesetzt
//   oder erhöht hat, bekommt in der Simulation meist bessere Startkarten (Chen-Formel) – Aggression heißt Stärke.
// - Pot Odds: Mitgehen lohnt, wenn die Gewinnchance größer ist als Einsatz / (Pot + Einsatz).
// - Spielertyp: Fels (eng, passiv), Hai (eng, aggressiv), Zocker (locker, aggressiv, blufft gern), Fisch (spielt viel,
//   geht oft mit). Dazu Zufall in jeder Entscheidung und gelegentlich Slowplay – so ist keiner durchschaubar.
// Quellen: Pot Odds en.wikipedia.org/wiki/Pot_odds, Chen-Formel nach Bill Chen („Hold'em Excellence“, zitiert u. a.
// auf de.wikipedia.org/wiki/Starthand_(Poker)), Spielertypen nach den üblichen Einteilungen tight/loose ×
// passiv/aggressiv (en.wikipedia.org/wiki/Glossary_of_poker_terms). Abgerufen 20.10.2026.
import { makeDeck } from '../karten/cards.js';
import { evaluate, valueOf } from './hand.js';
import { options, live, pot, BIG } from './game.js';

// loose: spielt mehr Hände (verschiebt die eigene Einschätzung), aggr: wie gern er setzt/erhöht statt mitzugehen,
// bluff: Bluff-Neigung, call: geht auch mit etwas zu wenig Chance noch mit
export const STYLE = {
  fels: { loose: -0.12, aggr: 0.3, bluff: 0.03, call: -0.02 },
  hai: { loose: -0.04, aggr: 0.65, bluff: 0.09, call: 0 },
  zocker: { loose: 0.15, aggr: 0.75, bluff: 0.2, call: 0.03 },
  fisch: { loose: 0.22, aggr: 0.15, bluff: 0.04, call: 0.1 },
};

// Chen-Formel: grobe Stärke zweier Startkarten (−1 … 20)
export function chen([a, b]) {
  const pts = (v) => ({ 14: 10, 13: 8, 12: 7, 11: 6 }[v] ?? v / 2);
  const [hi, lo] = [valueOf(a), valueOf(b)].sort((x, y) => y - x);
  let score = pts(hi);
  if (hi === lo) return Math.ceil(Math.max(5, score * 2));
  if (a[0] === b[0]) score += 2;
  const gap = hi - lo - 1;
  score -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

const FULL = makeDeck('2');

// Gewinnchance (Sieg = 1, Teilung = Anteil) gegen die Gegner – raises = je Gegner, wie oft er in dieser Hand gesetzt hat
export function equity(hole, board, raises, iterations = 400, rng = Math.random) {
  const known = new Set([...hole, ...board]);
  const rest = FULL.filter((c) => !known.has(c));
  const need = 5 - board.length;
  let won = 0;
  for (let it = 0; it < iterations; it++) {
    // Teilstapel mischen, so weit nötig (Fisher-Yates von vorn)
    const deck = rest.slice();
    let top = 0;
    const draw = () => {
      const k = top + Math.floor(rng() * (deck.length - top));
      [deck[top], deck[k]] = [deck[k], deck[top]];
      return deck[top++];
    };
    const opp = raises.map((r) => {
      // wer gesetzt hat, hat meist etwas: unpassende Startkarten bis zu 6-mal neu ziehen
      const bar = r ? Math.min(10, 5 + 2 * r) : 0;
      let h = [draw(), draw()];
      for (let tries = 0; bar && chen(h) < bar && tries < 6 && rng() < 0.85; tries++) {
        top -= 2; // die beiden zurück und hinten neu ziehen
        h = [draw(), draw()];
      }
      return h;
    });
    const full = board.slice();
    for (let i = 0; i < need; i++) full.push(draw());
    const mine = evaluate([...hole, ...full]).score;
    let best = 0;
    let ties = 0;
    for (const h of opp) {
      const sc = evaluate([...h, ...full]).score;
      if (sc > best) [best, ties] = [sc, 0];
      if (sc === best) ties++;
    }
    if (mine > best) won += 1;
    else if (mine === best) won += 1 / (ties + 1);
  }
  return won / iterations;
}

// Preflop wiederholen sich die Lagen – merken (Kartenklasse + Gegner)
const cache = new Map();
function preflopEquity(hole, raises, rng) {
  const [a, b] = [...hole].sort((x, y) => valueOf(y) - valueOf(x));
  const key = `${a[1]}${b[1]}${a[0] === b[0] ? 's' : 'o'}|${raises.map((r) => Math.min(r, 2)).sort().join('')}`;
  if (!cache.has(key)) cache.set(key, equity(hole, [], raises, 600, rng));
  return cache.get(key);
}

const roundTo = (x, step = 5) => Math.max(step, Math.round(x / step) * step);

// Entscheidung des Computers auf seat: { move, to? } – passt immer zu options(); known = heimlich gesehene nächste Karte
export function decide(v, seat, { rng = Math.random, known = null, iterations = 400 } = {}) {
  const o = options(v, seat);
  if (!o) return null;
  const st = STYLE[v.players[seat]?.style] ?? STYLE.hai;
  const opp = live(v).filter((p) => p !== seat);
  const raises = opp.map((p) => v.raises[p]);
  const board = known ? [...v.board, known] : v.board;
  const eq = v.phase === 'preflop' && !known ? preflopEquity(v.holes[seat], raises, rng) : equity(v.holes[seat], board, raises, iterations, rng);
  const fair = 1 / (opp.length + 1);
  // 1 = so gut wie ein Durchschnittsblatt; zu zweit zählt ein Durchschnittsblatt etwas mehr (sonst käme man nie über 2)
  const rel = (eq / Math.min(fair, 0.4)) * (1 + st.loose) + (rng() - 0.5) * 0.25;
  const potNow = pot(v);
  const need = o.need;
  const stack = v.stacks[seat];
  const odds = need / (potNow + need);
  const heads = opp.length <= 2;

  // Erhöhen auf: Anteil des Pots (zufällig gestreut), auf 5 gerundet, nicht unter dem Minimum; fast alles → alles
  const raiseTo = (frac) => {
    if (!o.raise) return null;
    const base = v.phase === 'preflop'
      ? (v.current <= BIG ? BIG * (2.5 + rng()) + BIG * opp.filter((p) => v.bet[p] >= BIG).length * 0.5 : v.current * (2.6 + rng() * 0.8))
      : v.current + potNow * frac * (0.85 + rng() * 0.3);
    let to = Math.max(o.raise.min, roundTo(base));
    if (to >= o.raise.max * 0.75) to = o.raise.max;
    return { move: 'raise', to: Math.min(to, o.raise.max) };
  };
  const slow = rel > 2.6 && rng() < 0.15; // Monster versteckt spielen

  if (v.phase === 'preflop') {
    if (o.check) return rel > 1.5 && rng() < st.aggr && !slow ? raiseTo() ?? { move: 'check' } : { move: 'check' };
    const facing = v.current / BIG; // 1 = nur der Big Blind
    if (facing <= 1) {
      if (rel > 1.35 && rng() < 0.4 + st.aggr * 0.6 && !slow) return raiseTo() ?? { move: 'call' };
      if (rel > 1.08 || (rel > 0.8 && rng() < st.bluff * 2)) return { move: 'call' };
      return rng() < st.bluff * 0.5 && heads ? raiseTo() ?? { move: 'fold' } : { move: 'fold' };
    }
    // gegen eine Erhöhung: Chance gegen die (stärkere) Hand des Erhöhers mit den Pot Odds vergleichen; kleine Einsätze
    // dürfen etwas schlechter sein (es kommt später noch Geld dazu)
    const eqA = eq * (1 + st.loose * 0.5);
    if (eqA > Math.max(0.45, fair * 1.6) && rng() < st.aggr * 0.7) return raiseTo() ?? { move: 'call' };
    if (eqA + st.call > odds + (need > stack * 0.3 ? 0.05 : -0.04)) return { move: 'call' };
    return { move: 'fold' };
  }

  // nach dem Flop
  if (o.check) {
    if (rel > 1.5 && !slow && rng() < 0.35 + st.aggr * 0.65) return raiseTo(0.55 + rng() * 0.4) ?? { move: 'check' };
    if (rng() < st.bluff * (heads ? 1.6 : 0.5)) return raiseTo(0.45 + rng() * 0.3) ?? { move: 'check' };
    return { move: 'check' };
  }
  const big = need > stack * 0.5; // es geht um (fast) alles: etwas vorsichtiger
  const margin = big ? 0.06 : 0.02;
  if (rel > 2 && !slow && rng() < st.aggr * 0.8) return raiseTo(0.7 + rng() * 0.4) ?? { move: 'call' };
  if (eq + st.call > odds + margin) return { move: 'call' };
  if (heads && !big && rng() < st.bluff * 0.4) return raiseTo(0.6) ?? { move: 'fold' };
  return { move: 'fold' };
}

// --- „Ohne Hilfen“ (allein): Computer schummeln ab und zu (index.js fragt schummeln.js cpuCheats) ---
// Linsen lohnt sich, wenn ein Einsatz offen ist und die Entscheidung knapp ist
export function wantsPeek(v, seat, rng = Math.random) {
  const o = options(v, seat);
  if (!o || o.check || v.phase === 'river' || v.peek?.[seat]) return false;
  const opp = live(v).filter((p) => p !== seat);
  const eq = equity(v.holes[seat], v.board, opp.map((p) => v.raises[p]), 150, rng);
  const odds = o.need / (pot(v) + o.need);
  return Math.abs(eq - odds) < 0.12;
}

// Ansage beim Showdown ohne Hilfen: die echte Hand – wer lügen will, sagt eine Stufe mehr, wenn er sonst verliert
export function chooseClaim(v, seat, lie = false) {
  const real = evaluate([...v.holes[seat], ...v.board]).cat;
  if (!lie || real >= 8) return real;
  const others = live(v).filter((p) => p !== seat && v.holes[p]?.[0]);
  const best = Math.max(-1, ...others.map((p) => evaluate([...v.holes[p], ...v.board]).cat));
  return best >= real ? Math.min(8, best + 1) : real;
}
