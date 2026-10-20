// Texas Hold'em – Computer (src/poker/ai.js): Gewinnchance, sinnvolle Entscheidungen, nur gültige Züge, Spielertypen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, nextHand, act, viewFor, options, claim, live, BIG } from '../src/poker/game.js';
import { equity, decide, chen, chooseClaim, STYLE } from '../src/poker/ai.js';

function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const hand = (str) => str.split(' ');
const near = (x, want, tol, what) => assert.ok(Math.abs(x - want) < tol, `${what}: ${x.toFixed(3)} statt ~${want}`);

test('Chen-Formel', () => {
  assert.equal(chen(hand('hA dA')), 20);
  assert.equal(chen(hand('hA hK')), 12);
  assert.equal(chen(hand('h7 d2')), -1);
  assert.equal(chen(hand('h2 d2')), 5);
  assert.equal(chen(hand('hT hJ')), 9);
});

test('Gewinnchance stimmt mit bekannten Werten', () => {
  const rng = rngOf(1);
  // AA gegen eine zufällige Hand ≈ 85 %, 72o ≈ 35 %, AKs ≈ 67 % (Standardtabellen, z. B. de.wikipedia „Starthand“)
  near(equity(hand('hA dA'), [], [0], 4000, rng), 0.852, 0.025, 'AA');
  near(equity(hand('h7 d2'), [], [0], 4000, rng), 0.346, 0.025, '72o');
  near(equity(hand('hA hK'), [], [0], 4000, rng), 0.67, 0.025, 'AKs');
  // Nuts auf dem River gewinnen immer
  assert.equal(equity(hand('hA hK'), hand('hQ hJ hT c2 d3'), [0, 0], 200, rng), 1);
  // gegen einen, der erhöht hat, ist ein mittleres Paar schwächer
  const calm = equity(hand('h8 d8'), [], [0], 3000, rng);
  const raised = equity(hand('h8 d8'), [], [2], 3000, rng);
  assert.ok(raised < calm - 0.05, `${raised} vs ${calm}`);
});

// Lage: Sitz 3 ist am Zug (Knopf 0, SB 1, BB 2), feste Karten
function spot(holes3, { raise = null } = {}) {
  let s = newGame({ humans: [0] }, rngOf(3));
  s = { ...s, stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 5 };
  s = nextHand(s, rngOf(4));
  s = { ...s, holes: s.holes.map((h, p) => (p === 3 ? hand(holes3) : h)) };
  if (raise) {
    // Sitz 3 geht mit, Sitz 4 erhöht, alle anderen passen → 3 ist wieder dran
    s = act(s, 3, 'call');
    s = act(s, 4, 'raise', raise);
    for (const p of [5, 0, 1, 2]) s = act(s, p, 'fold');
  }
  return s;
}
const tally = (s, seat, style, n = 200) => {
  const out = { fold: 0, check: 0, call: 0, raise: 0 };
  const players = s.players.map((p, i) => (i === seat ? { ...p, style } : p));
  for (let i = 0; i < n; i++) out[decide(viewFor({ ...s, players }, seat), seat, { rng: rngOf(i + 10), iterations: 150 }).move]++;
  return out;
};

test('Preflop: Asse erhöhen meist, 7-2 passt fast immer', () => {
  for (const style of Object.keys(STYLE)) {
    const aa = tally(spot('hA dA'), 3, style);
    assert.equal(aa.fold, 0, `${style} wirft Asse weg`);
    assert.ok(aa.raise > (style === 'fisch' ? 30 : 100), `${style} erhöht mit Assen nur ${aa.raise}/200`);
    const trash = tally(spot('h7 d2'), 3, style);
    assert.ok(trash.fold > 150, `${style} spielt 7-2 zu oft: ${JSON.stringify(trash)}`);
  }
  // gegen eine große Erhöhung (auf 200) geht Müll nie mit, Asse nie weg
  const big = spot('h9 d4', { raise: 200 });
  assert.equal(big.turn, 3);
  assert.equal(tally(big, 3, 'hai').call + tally(big, 3, 'hai').raise, 0);
  assert.equal(tally(spot('hA dA', { raise: 200 }), 3, 'fels').fold, 0);
});

test('Typen unterscheiden sich: Zocker spielt mehr Hände als Fels', () => {
  const hands = ['hK d9', 'hQ d8', 'h6 h5', 'hJ d7', 'hA d6', 'h9 h7', 'hT d8', 'h4 d4'];
  const played = (style) => hands.reduce((n, h) => n + 200 - tally(spot(h), 3, style).fold, 0);
  assert.ok(played('zocker') > played('fels') * 1.5, `Zocker ${played('zocker')}, Fels ${played('fels')}`);
  assert.ok(played('fisch') > played('hai'));
});

// Zu zweit (0 und 3, Knopf 0), schon auf dem Flop – 3 ist zuerst dran
function headsUp(free = false) {
  let s = newGame({ humans: [0, 1, 2, 3, 4, 5], free }, rngOf(5));
  s = { ...s, players: s.players.map((p) => ({ ...p, style: 'hai' })), stacks: [1000, 0, 0, 1000, 0, 0], button: 3 };
  s = nextHand(s, rngOf(6));
  assert.equal(s.button, 0);
  s = act(s, 0, 'call');
  s = act(s, 3, 'check');
  assert.equal(s.phase, 'flop');
  assert.equal(s.turn, 3);
  return s;
}

test('Pot Odds: billiger Flush-Draw geht mit, teurer Müll nicht', () => {
  // Heads-up auf dem Flop: 3 hat 4 Herz, Gegner 0 setzt
  let s = headsUp();
  s = { ...s, holes: s.holes.map((h, p) => (p === 3 ? hand('hA h9') : p === 0 ? hand('cK dK') : h)), board: hand('h2 h7 cJ') };
  s = act(s, 3, 'check');
  s = act(s, 0, 'raise', 10); // kleiner Einsatz in Pot 20
  assert.equal(s.turn, 3);
  const cheap = tally(s, 3, 'hai', 100);
  assert.ok(cheap.fold < 10, `Draw wirft weg: ${JSON.stringify(cheap)}`);
  s = { ...s, holes: s.holes.map((h, p) => (p === 3 ? hand('c3 d4') : h)) };
  const trash = tally(s, 3, 'fels', 100);
  assert.ok(trash.fold > 70, `Müll geht mit: ${JSON.stringify(trash)}`);
});

test('Computer machen nur gültige Züge, Partien laufen durch', () => {
  const rng = rngOf(9);
  let s = newGame({ humans: [0], chips: { 0: 1000 } }, rng);
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, style: 'hai' } : p)) }; // Sitz 0 spielt hier auch Computer
  const counts = { fold: 0, check: 0, call: 0, raise: 0 };
  for (let h = 0; h < 40; h++) {
    s = nextHand(s, rng) ?? { ...s, stacks: s.stacks.map((x, p) => (p === 0 ? 1000 : x)) };
    while (s.phase !== 'done' && s.phase !== 'wait') {
      const seat = s.turn;
      const d = decide(viewFor(s, seat), seat, { rng, iterations: 120 });
      counts[d.move]++;
      const next = act(s, seat, d.move, d.to);
      assert.ok(next, `ungültig: ${JSON.stringify(d)} bei ${JSON.stringify(options(s, seat))}`);
      s = next;
    }
  }
  assert.ok(counts.raise > 10 && counts.fold > 20 && counts.call > 10, JSON.stringify(counts));
});

test('Ohne Hilfen: Ansage beim Showdown – ehrlich oder eine Stufe über dem Gegner', () => {
  let s = headsUp(true);
  s = { ...s, holes: s.holes.map((h, p) => (p === 3 ? hand('h3 d8') : p === 0 ? hand('hA dA') : h)) };
  while (s.phase !== 'claim') s = act(s, s.turn, 'check');
  s = { ...s, board: hand('c2 s7 h9 dJ cK') };
  assert.equal(chooseClaim(viewFor(s, 3), 3), 0);
  assert.equal(chooseClaim(viewFor(s, 3), 3, true), 2);
  assert.equal(chooseClaim(viewFor(s, 0), 0, true), 1, 'wer vorn liegt, lügt nicht');
  assert.ok(claim(s, 3, 2).cheats.length === 1);
  assert.equal(live(s).length, 2);
  assert.equal(BIG, 10);
});

test('Review: Asse gehen gegen ein Preflop-All-in mit', () => {
  for (const style of Object.keys(STYLE)) {
    const t = tally(spot('hA dA', { raise: 1000 }), 3, style, 60);
    assert.equal(t.fold, 0, `${style} wirft Asse gegen All-in weg: ${JSON.stringify(t)}`);
  }
});
