import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, fits, playable, play, draw, pass, again, viewFor, handSize, HAND_SIZE } from '../src/maumau/game.js';
import { computerMove } from '../src/maumau/ai.js';
import { makeDeck } from '../src/karten/cards.js';

// fester Zufall für wiederholbare Tests
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand mit festgelegten Karten; der Rest des Blatts liegt im Nachziehstapel
function setup({ hands, pile, talon, turn = 0, ...rest }) {
  const used = [...hands.flat(), ...pile];
  return {
    ...newGame(0),
    hands,
    pile,
    talon: talon ?? makeDeck('7').filter((c) => !used.includes(c)),
    turn,
    ...rest,
  };
}

const all = (s) => [...s.hands.flat(), ...s.pile, ...s.talon].sort();

test('neues Spiel: je 5 Karten, eine offen, Rest verdeckt, alle 32 genau einmal', () => {
  const s = newGame(1, seeded(1));
  assert.equal(s.hands[0].length, HAND_SIZE);
  assert.equal(s.hands[1].length, HAND_SIZE);
  assert.equal(s.pile.length, 1);
  assert.equal(s.talon.length, 32 - 11);
  assert.deepEqual(all(s), makeDeck('7').sort());
  assert.equal(s.turn, 1);
  assert.equal(s.sevens, 0); // die erste offene Karte wirkt nicht
  assert.equal(s.wish, null);
  assert.deepEqual(s.events, [{ type: 'deal' }]);
});

test('passt: gleiche Farbe oder gleicher Wert, Bube auf alles außer Bube', () => {
  const s = setup({ hands: [[], []], pile: ['h9'] });
  assert.ok(fits(s, 'hK')); // Farbe
  assert.ok(fits(s, 's9')); // Wert
  assert.ok(!fits(s, 'sK'));
  assert.ok(fits(s, 'cJ')); // Bube passt immer …
  assert.ok(!fits(setup({ hands: [[], []], pile: ['hJ'] }), 'cJ')); // … nur nicht auf einen Buben
  assert.ok(fits(setup({ hands: [[], []], pile: ['hJ'] }), 'hA')); // erste offene Karte Bube: ihre Farbe gilt
});

test('ungültige Wünsche → null, alter Stand bleibt unverändert', () => {
  const s = setup({ hands: [['h7', 'sK', 'cJ'], ['d8']], pile: ['h9'] });
  assert.equal(play(s, 1, { card: 'd8' }), null); // nicht dran
  assert.equal(play(s, 0, { card: 'sK' }), null); // passt nicht
  assert.equal(play(s, 0, { card: 'd8' }), null); // nicht auf der Hand
  assert.equal(play(s, 0, { card: 'cJ' }), null); // Bube ohne Wunschfarbe
  assert.equal(play(s, 0, { card: 'cJ', wish: 'x' }), null);
  for (const bad of [null, undefined, 'h7', 42, {}, { card: ['h7'] }]) assert.equal(play(s, 0, bad), null);
  assert.equal(pass(s, 0), null); // nichts gezogen
  assert.equal(again(s), null); // läuft noch
  const next = play(s, 0, { card: 'h7' });
  assert.ok(next);
  assert.deepEqual(s.hands[0], ['h7', 'sK', 'cJ']);
  assert.deepEqual(s.pile, ['h9']);
});

test('7er-Kette: zwei ziehen oder mit 7 weitergeben, danach normaler Zug', () => {
  let s = setup({ hands: [['h7', 'c7', 'sA', 'dK'], ['s7', 'hK', 'd9']], pile: ['h9'] });
  s = play(s, 0, { card: 'h7' });
  assert.equal(s.sevens, 1);
  assert.equal(s.turn, 1);
  assert.deepEqual(playable(s, 1), ['s7']); // nur eine 7 hilft
  assert.equal(play(s, 1, { card: 'hK' }), null);
  s = play(s, 1, { card: 's7' });
  assert.equal(s.sevens, 2);
  assert.equal(s.turn, 0);
  s = play(s, 0, { card: 'c7' });
  assert.equal(s.sevens, 3);
  // Spieler 1 hat keine 7 mehr → zieht 6 Karten und ist danach normal dran
  const before = s.hands[1].length;
  s = draw(s, 1);
  assert.equal(s.hands[1].length, before + 6);
  assert.equal(s.sevens, 0);
  assert.equal(s.turn, 1);
  assert.equal(s.drawn, null);
  assert.deepEqual(s.events.map((e) => [e.type, e.count, e.why]), [['draw', 6, 'sieben']]);
  assert.ok(play(s, 1, { card: 'hK' }) === null); // Kreuz 7 liegt oben, König passt nicht
  assert.ok(draw(s, 1)); // Ziehen geht wie immer
});

test('8: der andere setzt aus – zu zweit ist man gleich nochmal dran', () => {
  let s = setup({ hands: [['h8', 's8', 'sK'], ['hA', 'h2']], pile: ['h9'] });
  s = play(s, 0, { card: 'h8' });
  assert.equal(s.turn, 0);
  assert.deepEqual(s.events.map((e) => e.type), ['play', 'skip']);
  s = play(s, 0, { card: 's8', mau: true });
  assert.equal(s.turn, 0);
  s = play(s, 0, { card: 'sK' });
  assert.equal(s.winner, 0);
});

test('Bube: Wunschfarbe gilt, bis sie bedient wird', () => {
  let s = setup({ hands: [['cJ', 'sK', 's9'], ['hJ', 'd9', 'h9', 'cK']], pile: ['d7'], talon: ['s7', 'dA'] });
  s = play(s, 0, { card: 'cJ', wish: 'h' });
  assert.equal(s.wish, 'h');
  assert.equal(s.turn, 1);
  assert.deepEqual(playable(s, 1), ['h9']); // nicht Karo 9 (Wert passt nicht zum Buben), nicht Bube auf Bube
  // Spieler 1 zieht Karo-Ass: passt nicht zum Wunsch → Spieler 0 ist dran, Wunsch bleibt
  s = draw(s, 1);
  assert.equal(s.turn, 0);
  assert.equal(s.wish, 'h');
  assert.deepEqual(playable(s, 0), []);
  s = draw(s, 0); // Pik 7 passt auch nicht
  s = play(s, 1, { card: 'h9' });
  assert.equal(s.wish, null);
  assert.deepEqual(s.pile, ['d7', 'cJ', 'h9']);
});

test('Bube als letzte Karte: kein Wunsch nötig, gewonnen', () => {
  const s = play(setup({ hands: [['cJ'], ['h2']], pile: ['d7'] }), 0, { card: 'cJ' });
  assert.equal(s.winner, 0);
  assert.equal(s.wish, null);
});

test('Mau vergessen → 1 Strafkarte, angesagt → keine', () => {
  const start = setup({ hands: [['h7', 'hK'], ['s2']], pile: ['h9'], talon: ['d8', 'cA'] });
  const forgot = play(start, 0, { card: 'hK' });
  assert.deepEqual(forgot.hands[0], ['h7', 'cA']);
  assert.deepEqual(forgot.events.map((e) => e.type), ['play', 'mau', 'draw']);
  assert.equal(forgot.events[1].said, false);
  assert.equal(forgot.events[2].why, 'mau');
  assert.equal(forgot.turn, 1);
  const said = play(start, 0, { card: 'hK', mau: true });
  assert.deepEqual(said.hands[0], ['h7']);
  assert.equal(said.events[1].said, true);
  assert.equal(play(start, 0, { card: 'hK', mau: 'ja' }).hands[0].length, 2); // nur true zählt
});

test('Ziehen: passende Karte darf gelegt werden, sonst ist der andere dran', () => {
  const s = setup({ hands: [['sK'], ['s2']], pile: ['h9'], talon: ['c3', 'h5'] });
  const fitsNow = draw(s, 0);
  assert.equal(fitsNow.drawn, 'h5');
  assert.equal(fitsNow.turn, 0);
  assert.deepEqual(playable(fitsNow, 0), ['h5']);
  assert.equal(draw(fitsNow, 0), null); // nur einmal ziehen
  assert.equal(play(fitsNow, 0, { card: 'sK' }), null); // nur die gezogene Karte
  const kept = pass(fitsNow, 0);
  assert.equal(kept.turn, 1);
  assert.equal(kept.drawn, null);
  assert.deepEqual(kept.events, [{ type: 'pass', player: 0, kept: true }]);
  const played = play(fitsNow, 0, { card: 'h5', mau: true });
  assert.equal(played.turn, 1);
  assert.deepEqual(played.hands[0], ['sK']);

  const miss = draw(setup({ hands: [['sK'], ['s2']], pile: ['h9'], talon: ['c3'] }), 0);
  assert.equal(miss.turn, 1); // Kreuz 3 passt nicht → automatisch weiter
  assert.deepEqual(miss.hands[0], ['sK', 'c3']);
  assert.deepEqual(miss.events.map((e) => e.type), ['draw', 'pass']);
});

test('Nachziehstapel leer → Ablage ohne oberste Karte wird neu gemischt', () => {
  const s = setup({ hands: [['sK'], ['s2']], pile: ['c8', 'd8', 'dA', 'h9'], talon: [] });
  const next = draw(s, 0, seeded(3));
  assert.deepEqual(next.pile, ['h9']);
  assert.equal(next.talon.length, 2);
  assert.equal(next.hands[0].length, 2);
  assert.deepEqual([...next.talon, next.hands[0][1]].sort(), ['c8', 'd8', 'dA']);
  assert.deepEqual(next.events.map((e) => e.type).slice(0, 2), ['shuffle', 'draw']);

  // 7er-Strafe größer als der Stapel: erst der Rest, dann mischen, dann weiter
  const seven = setup({ hands: [['sK'], ['s2']], pile: ['c8', 'd8', 'dA', 'h7'], talon: ['cA'], sevens: 2 });
  const after = draw(seven, 0, seeded(4));
  assert.equal(after.hands[0].length, 1 + 4);
  assert.deepEqual(after.events.map((e) => [e.type, e.count]), [['draw', 1], ['shuffle', 3], ['draw', 3]]);
  assert.deepEqual(after.pile, ['h7']);
  assert.equal(after.talon.length, 0);
});

test('gar keine Karte mehr zu ziehen → der andere ist dran', () => {
  const s = setup({ hands: [['sK'], ['s2']], pile: ['h9'], talon: [] });
  const next = draw(s, 0);
  assert.equal(next.turn, 1);
  assert.deepEqual(next.hands[0], ['sK']);
  assert.deepEqual(next.events.map((e) => e.type), ['empty', 'pass']);
  assert.equal(next.events[1].kept, false);
  // offene 7, aber nichts mehr da: Strafe verfällt, normaler Zug
  const seven = draw(setup({ hands: [['sK'], ['s2']], pile: ['h7'], talon: [], sevens: 1 }), 0);
  assert.equal(seven.sevens, 0);
  assert.equal(seven.turn, 0);
  assert.deepEqual(seven.events, [{ type: 'empty', player: 0 }]);
});

test('Spielende: letzte Karte gewinnt, danach geht nichts mehr, Revanche tauscht den Anfang', () => {
  let s = setup({ hands: [['hK'], ['s2']], pile: ['h9'], starter: 0 });
  s = play(s, 0, { card: 'hK' });
  assert.equal(s.winner, 0);
  assert.equal(draw(s, 1), null);
  assert.equal(play(s, 1, { card: 's2' }), null);
  const next = again(s);
  assert.equal(next.starter, 1);
  assert.equal(next.turn, 1);
  assert.equal(next.winner, null);
  assert.equal(next.seq, 0);
});

test('Sicht des Gastes: nur eigene Karten, vom Gegner und Stapel nur die Anzahl', () => {
  const s = draw(setup({ hands: [['sK'], ['s2', 'c3']], pile: ['h9'], talon: ['d4', 'h5'], turn: 1 }), 1);
  assert.equal(s.drawn, 'h5');
  const host = viewFor(s, 0);
  assert.deepEqual(host.hands, [['sK'], 3]);
  assert.equal(host.talon, 1);
  assert.equal(host.drawn, null); // welche Karte der Gast gezogen hat, sieht der Host nicht
  assert.deepEqual(host.events, [{ type: 'draw', player: 1, why: 'zug', count: 1 }]);
  assert.ok(!JSON.stringify(host).includes('h5'));
  assert.ok(!JSON.stringify(host).includes('d4'));
  const guest = viewFor(s, 1);
  assert.deepEqual(guest.hands, [1, ['s2', 'c3', 'h5']]);
  assert.equal(guest.drawn, 'h5');
  assert.deepEqual(guest.events[0].cards, ['h5']);
  assert.equal(handSize(guest, 0), 1);
  assert.equal(handSize(s, 1), 3);
  // die Sicht taugt auch für die Prüfung „passt?“
  assert.deepEqual(playable(guest, 1), ['h5']);
});

test('Computer gegen Computer: nur gültige Züge, keine Karte geht verloren, jedes Spiel endet', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed);
    let s = newGame(seed % 2, rng);
    let steps = 0;
    while (s.winner === null) {
      const p = s.turn;
      const m = computerMove(viewFor(s, p), p);
      const next = m.t === 'play' ? play(s, p, m.arg) : m.t === 'draw' ? draw(s, p, rng) : pass(s, p);
      assert.ok(next, `Spiel ${seed}, Schritt ${steps}: ${JSON.stringify(m)} ist ungültig`);
      s = next;
      assert.deepEqual(all(s), makeDeck('7').sort());
      assert.ok(++steps < 2000, `Spiel ${seed} endet nicht`);
    }
    assert.equal(s.hands[s.winner].length, 0);
  }
});
