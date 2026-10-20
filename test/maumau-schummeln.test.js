// Mau-Mau „Ohne Hilfen“ (Nico 20.10.2026): Ein vergessenes „Mau“ bestraft nicht mehr das Spiel, der andere muss es
// erwischen. Allein gegen den Computer schummelt der ab und zu selbst und ruft „Geschummelt!“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, play, draw, pass, accuse, waive, viewFor, MAU_PENALTY, CHEAT_PENALTY } from '../src/maumau/game.js';
import { computerMove } from '../src/maumau/ai.js';
import { cpuCheats, cpuAccuses, rematchBlocked } from '../src/schummeln.js';
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
function setup({ hands, pile, talon, turn = 0, free = true, ...rest }) {
  const used = [...hands.flat(), ...pile];
  return { ...newGame(0, Math.random, { free }), hands, pile, talon: talon ?? makeDeck('7').filter((c) => !used.includes(c)), turn, ...rest };
}

const all = (s) => [...s.hands.flat(), ...s.pile, ...s.talon].sort();

test('ohne Hilfen: vergessenes „Mau“ wird nicht von selbst bestraft und nicht verraten', () => {
  const s = setup({ hands: [['h7', 'hK'], ['sA']], pile: ['h9'], talon: ['d8', 'cA'] });
  const forgot = play(s, 0, { card: 'hK' });
  assert.deepEqual(forgot.hands[0], ['h7']); // keine Strafkarte
  assert.deepEqual(forgot.events.map((e) => e.type), ['play']); // kein „Mau vergessen“
  assert.equal(forgot.turn, 1);
  assert.deepEqual([forgot.cheat.player, forgot.cheat.legal, forgot.cheat.forgot], [0, true, true]);
  assert.deepEqual(viewFor(forgot, 1).cheat, { player: 0 }); // der andere sieht nicht, ob etwas faul ist
  const said = play(s, 0, { card: 'hK', mau: true });
  assert.deepEqual(said.events.map((e) => [e.type, e.said]), [['play', undefined], ['mau', true]]); // „Mau!“ hört man
  assert.equal(said.cheat.forgot, false);
});

test('ohne Hilfen: vergessenes „Mau“ erwischt → 1 Strafkarte, die Karte bleibt liegen; mit „Mau“ → Fehlalarm', () => {
  const s = setup({ hands: [['h7', 'hK'], ['sA']], pile: ['h9'], talon: ['d8', 'cA'] });
  const caught = accuse(play(s, 0, { card: 'hK' }), 1);
  assert.equal(MAU_PENALTY, 1);
  assert.deepEqual(caught.pile, ['h9', 'hK']);
  assert.deepEqual(caught.hands[0], ['h7', 'cA']);
  assert.equal(caught.turn, 1); // der Ankläger bleibt dran
  assert.equal(caught.cheat, null);
  assert.deepEqual(caught.events.map((e) => [e.type, e.why]), [['caught', undefined], ['draw', 'mau']]);
  assert.equal(caught.events[0].mau, true);
  assert.equal(accuse(caught, 1), null); // nur einmal

  const alarm = accuse(play(s, 0, { card: 'hK', mau: true }), 1);
  assert.equal(alarm.events[0].type, 'fehlalarm');
  assert.deepEqual(alarm.hands[0], ['h7']);
  assert.equal(alarm.hands[1].length, 2);
});

test('ohne Hilfen: unpassende Karte und „Mau“ vergessen → wie bisher zurück auf die Hand + 2 Strafkarten', () => {
  const both = play(setup({ hands: [['c9', 'sK'], ['hA']], pile: ['hT'] }), 0, { card: 'c9' });
  assert.deepEqual([both.cheat.legal, both.cheat.forgot], [false, true]);
  const caught = accuse(both, 1);
  assert.deepEqual(caught.pile, ['hT']);
  assert.equal(caught.hands[0].length, 2 + CHEAT_PENALTY);
  assert.equal(caught.turn, 0);
});

test('mit Hilfen: vergessenes „Mau“ kostet wie bisher sofort 1 Karte, nichts anzuprangern', () => {
  const s = setup({ hands: [['h7', 'hK'], ['sA']], pile: ['h9'], talon: ['d8', 'cA'], free: false });
  const forgot = play(s, 0, { card: 'hK' });
  assert.deepEqual(forgot.hands[0], ['h7', 'cA']);
  assert.deepEqual(forgot.events.map((e) => e.type), ['play', 'mau', 'draw']);
  assert.equal(forgot.cheat, null);
  assert.equal(accuse(forgot, 1), null);
});

test('ohne Hilfen: 8 ohne „Mau“, dann gleich die letzte Karte – erwischt zählt der Sieg nicht', () => {
  const s = setup({ hands: [['h8', 'hK'], ['sA', 'c9']], pile: ['h9'], talon: ['d8', 'cA'] });
  const eight = play(s, 0, { card: 'h8' }); // 1 Karte übrig, kein „Mau“, 8 = nochmal dran
  assert.equal(eight.turn, 0);
  const won = play(eight, 0, { card: 'hK' });
  assert.equal(won.winner, 0);
  assert.equal(rematchBlocked(won, 0), true); // das vergessene „Mau“ bleibt anfechtbar
  const caught = accuse(won, 1);
  assert.equal(caught.winner, null);
  assert.deepEqual(caught.hands[0], ['cA']);
  assert.deepEqual(caught.pile, ['h9', 'h8', 'hK']);
  assert.equal(caught.turn, 1); // der Ankläger ist dran
});

test('waive: der Computer lässt den letzten Zug gelten – nur der andere, nur ohne Hilfen, nur bei offener Frist', () => {
  const won = play(setup({ hands: [['c9'], ['hA', 'h8']], pile: ['hT'] }), 0, { card: 'c9' });
  assert.equal(waive(won, 0), null); // nicht der Schummler selbst
  const w = waive(won, 1);
  assert.equal(w.cheat, null);
  assert.equal(w.winner, 0);
  assert.equal(rematchBlocked(w, 0), false); // der Mensch kann Revanche starten
  assert.equal(waive(w, 1), null);
  assert.equal(waive({ ...won, free: false }, 1), null);
});

test('Computer schummelt: statt zu ziehen bzw. weiterzugeben eine unpassende Karte, oder er vergisst „Mau“', () => {
  const move = (s, cheat) => computerMove(viewFor(s, 1), 1, cheat);
  // keine passende Karte (Herz 10 liegt)
  const stuck = setup({ hands: [['sA'], ['c9', 'sK', 'dA']], pile: ['hT'], turn: 1 });
  assert.deepEqual(move(stuck, false), { t: 'draw' });
  const m = move(stuck, true);
  assert.equal(m.t, 'play');
  assert.equal(play(stuck, 1, m.arg).cheat.legal, false);
  // offene 7 ohne eigene 7
  const seven = setup({ hands: [['sA'], ['c9', 'hK', 'dA']], pile: ['h7'], sevens: 1, turn: 1 });
  assert.deepEqual(move(seven, false), { t: 'draw' });
  const dodged = play(seven, 1, move(seven, true).arg);
  assert.deepEqual([dodged.sevens, dodged.cheat.legal], [0, false]);
  // gezogene Karte passt nicht
  const drawn = draw(setup({ hands: [['sA'], ['c9', 'sK']], pile: ['hT'], talon: ['dQ'], turn: 1 }), 1);
  assert.deepEqual(move(drawn, false), { t: 'pass' });
  assert.equal(move(drawn, true).arg.card, 'dQ');
  // vorletzte Karte regelgerecht – aber ohne „Mau“
  const two = setup({ hands: [['sA'], ['hK', 'c9']], pile: ['h9'], turn: 1 });
  assert.deepEqual([move(two, false).arg.card, move(two, false).arg.mau], ['hK', true]);
  const sly = move(two, true);
  assert.deepEqual([sly.arg.card, sly.arg.mau], ['hK', false]);
  assert.equal(play(two, 1, sly.arg).cheat.forgot, true);
  // nichts zu schummeln → normaler Zug
  const plain = setup({ hands: [['sA'], ['hK', 'c9', 'dA']], pile: ['h9'], turn: 1 });
  assert.deepEqual(move(plain, true), move(plain, false));
});

test('allein ohne Hilfen: schummeln und anprangern – nur gültige Aktionen, keine Karte geht verloren, jedes Spiel endet', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seeded(seed);
    let s = newGame(seed % 2, rng, { free: true });
    let steps = 0;
    while (s.winner === null || s.cheat) {
      // wie index.js: bevor der andere handelt (oder nach Spielende) prüft er den offenen Zug einmal
      const c = s.cheat;
      const judge = c && (s.turn !== c.player || s.winner !== null) ? 1 - c.player : null;
      let next;
      if (judge !== null && cpuAccuses(!c.legal || c.forgot, rng)) next = accuse(s, judge, rng);
      else if (judge !== null && s.winner !== null) next = waive(s, judge);
      else {
        const p = s.turn;
        const m = computerMove(viewFor(s, p), p, cpuCheats(rng));
        next = m.t === 'play' ? play(s, p, m.arg) : m.t === 'draw' ? draw(s, p, rng) : pass(s, p);
      }
      assert.ok(next, `Spiel ${seed}, Schritt ${steps} ist ungültig`);
      s = next;
      assert.deepEqual(all(s), makeDeck('7').sort());
      assert.ok(++steps < 3000, `Spiel ${seed} endet nicht`);
    }
    assert.equal(s.hands[s.winner].length, 0);
    assert.equal(rematchBlocked(s, 0) || rematchBlocked(s, 1), false);
  }
});
