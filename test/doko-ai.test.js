// Doppelkopf-Computer (src/doko/ai.js): nur erlaubte Züge, spielt klar besser als Zufall, Soli bleiben selten,
// Vorausschau schlägt Faustregeln, Schummelzüge sind wirklich regelwidrig
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, reserve, play, announce, announceOptions, legalCards, viewFor, faceOf, knownParties, trickWinner, SOLOS,
} from '../src/doko/game.js';
import { chooseCall, chooseAnnounce, chooseCard, searchCard, cheatCard } from '../src/doko/ai.js';

function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const rule = (v, p) => chooseCard(v, p);
const random = (rng) => (v, p) => {
  const legal = legalCards(v.hands[p], v.trick, v.kind);
  return legal[Math.floor(rng() * legal.length)];
};

// Ein Spiel zu Ende spielen: cards[p] wählt die Karte, calls/announce wie der Computer (oder „gesund“ und still)
function playGame(seed, cards, { ai = false } = {}) {
  let s = newGame({ dealer: seed % 4, humans: [] }, seeded(seed));
  while (s.phase === 'reserve') {
    const call = ai ? chooseCall(viewFor(s, s.turn), s.turn) : 'gesund';
    const next = reserve(s, s.turn, call);
    assert.ok(next, `Spiel ${seed}: Vorbehalt ${call} ungültig`);
    s = next;
  }
  while (s.phase === 'play') {
    const p = s.turn;
    if (ai) {
      const level = chooseAnnounce(viewFor(s, p), p);
      if (level !== null) {
        assert.ok(announceOptions(s, p).includes(level), `Spiel ${seed}: Ansage ${level} nicht erlaubt`);
        assert.ok(s.contract.type !== 'solo' || s.contract.player === p, `Spiel ${seed}: Gegenspieler sagt im Solo an`);
        s = announce(s, p, level);
      }
    }
    const v = viewFor(s, p);
    const card = cards[p](v, p);
    assert.ok(legalCards(s.hands[p], s.trick, s.kind).includes(card), `Spiel ${seed}: Karte ${card} nicht erlaubt`);
    s = play(s, p, card);
  }
  return s;
}

test('Computer: nur erlaubte Vorbehalte, Ansagen und Karten – jedes Spiel endet', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const s = playGame(seed, [rule, rule, rule, rule], { ai: true });
    assert.equal(s.phase, 'over');
    assert.equal(s.result.eyes[0] + s.result.eyes[1], 240);
    kinds.add(s.contract.type);
  }
  assert.ok(kinds.has('normal') && kinds.has('wedding'), [...kinds].join());
  // Vorausschau ebenso (wenige Spiele, kleine Stichprobe)
  const rng = seeded(7);
  const search = (v, p) => searchCard(v, p, { samples: 4, rng });
  for (let seed = 1; seed <= 3; seed++) playGame(seed, [search, rule, search, rule], { ai: true });
});

// Duplikat: dieselbe Verteilung zweimal, die Sitze getauscht – gemessen als Augen der Partei, wenn beide Partner
// derselbe Spieler sind (Normalspiel)
function duel(a, b, seeds) {
  const pure = [];
  let points = 0;
  for (const seed of seeds) {
    for (const swap of [false, true]) {
      const isA = (p) => (p % 2 === 0) !== swap;
      const s = playGame(seed, [0, 1, 2, 3].map((p) => (isA(p) ? a : b)));
      points += [0, 1, 2, 3].filter(isA).reduce((n, p) => n + s.result.points[p], 0) / 2;
      const reA = s.re.filter(isA).length;
      if (s.contract.type === 'normal' && reA !== 1) pure.push(reA === 2 ? s.result.eyes[0] : s.result.eyes[1]);
    }
  }
  return { eyes: pure.reduce((x, y) => x + y, 0) / pure.length, points: points / seeds.length / 2 };
}

test('Faustregeln schlagen Zufall deutlich', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1);
  const { eyes, points } = duel(rule, random(seeded(3)), seeds);
  console.log(`Faustregeln gegen Zufall: ${eyes.toFixed(1)} Augen als reine Partei, ${points.toFixed(2)} Punkte je Spiel`);
  assert.ok(eyes > 135, `nur ${eyes} Augen`);
  assert.ok(points > 0.25, `nur ${points} Punkte`);
});

test('Soli und Hochzeiten in vernünftigem Maß', () => {
  const count = { solo: 0, wedding: 0, deals: 0 };
  for (let seed = 1; seed <= 4000; seed++) {
    const s = newGame({ dealer: seed % 4, humans: [] }, seeded(seed));
    const calls = s.hands.map((h, p) => chooseCall({ ...s, hands: s.hands.map((x, q) => (q === p ? x : x.length)) }, p));
    for (const [p, c] of calls.entries()) {
      assert.ok(c === 'gesund' || c === 'wedding' || SOLOS.includes(c));
      if (c === 'wedding') assert.equal(s.hands[p].filter((x) => faceOf(x) === 'cQ').length, 2);
    }
    count.deals++;
    if (calls.some((c) => SOLOS.includes(c))) count.solo++;
    if (calls.includes('wedding')) count.wedding++;
  }
  const solo = count.solo / count.deals;
  const wedding = count.wedding / count.deals;
  console.log(`Soli in ${(100 * solo).toFixed(1)} % der Spiele, Hochzeit in ${(100 * wedding).toFixed(1)} %`);
  assert.ok(solo > 0.01 && solo < 0.08, `Soli ${solo}`); // gemessen: knapp 6 %, gewonnen in ~80 %
  assert.ok(wedding > 0.12, `Hochzeit ${wedding}`); // beide Kreuz-Damen hat ein Spieler in gut 23 % der Spiele
});

test('Vorausschau spielt besser als die Faustregeln (fester Zufall)', () => {
  // Sitz 0 einmal mit Vorausschau, einmal mit Faustregeln – sonst alles gleich; Punkte von Sitz 0 zusammengezählt
  // (gemessen: in zehn Blöcken zu 20 Spielen jedes Mal vorn, im Mittel +0,57 Punkte je Spiel)
  let gain = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rng = seeded(seed);
    const search = (v, p) => searchCard(v, p, { samples: 6, budgetMs: 1e9, rng });
    gain += playGame(seed, [search, rule, rule, rule]).result.points[0] - playGame(seed, [rule, rule, rule, rule]).result.points[0];
  }
  console.log(`Vorausschau statt Faustregeln auf Sitz 0: ${gain >= 0 ? '+' : ''}${gain} Punkte in 20 Spielen`);
  assert.ok(gain > 0);
});

test('Schummelzug: nur regelwidrige Karten aus der eigenen Hand, und nicht ständig', () => {
  let asked = 0;
  let cheats = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let s = { ...newGame({ dealer: seed % 4, humans: [] }, seeded(seed)), free: true };
    const before = cheats;
    while (s.phase === 'reserve') s = reserve(s, s.turn, 'gesund');
    while (s.phase === 'play') {
      const p = s.turn;
      const v = viewFor(s, p);
      const c = cheatCard(v, p);
      if (s.trick.length) asked++;
      if (c !== null) {
        cheats++;
        const known = knownParties(v, p);
        const lead = trickWinner(s.trick, s.kind);
        assert.ok(known[lead] === null || known[lead] !== known[p], 'schummelt nicht, wenn der Partner vorn liegt');
        assert.ok(s.hands[p].includes(c));
        assert.ok(!legalCards(s.hands[p], s.trick, s.kind).includes(c), `${c} wäre erlaubt`);
      }
      s = play(s, p, c ?? chooseCard(v, p));
      assert.ok(s);
    }
    assert.equal(s.revokes.length, cheats - before); // jeder Schummelzug ist als Nichtbedienen vermerkt
  }
  console.log(`Schummelzug in ${cheats} von ${asked} Zügen möglich`);
  assert.ok(cheats > 0 && cheats < asked / 2);
});
