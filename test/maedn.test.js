import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, roll, move, again, legalMoves, mayRollThrice, fieldOf, HOUSE, GOAL, LAST, TRACK } from '../src/maedn/rules.js';
import { chooseMove, danger } from '../src/maedn/ai.js';

const H = HOUSE;

// fester Zufall für wiederholbare Tests
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand mit festgelegten Figuren; nicht genannte Sitze haben alle Figuren im Haus
function setup({ pieces = {}, turn = 0, humans = [0], places = [] } = {}) {
  const s = newGame({ humans, starter: turn });
  return { ...s, places, pieces: [0, 1, 2, 3].map((q) => pieces[q] ?? [H, H, H, H]) };
}

// würfeln und – falls es nur einen Zug gibt oder piece genannt ist – ziehen
function rollMove(s, player, value, piece) {
  const r = roll(s, player, value);
  assert.ok(r, `Wurf ${value} von Sitz ${player} muss gehen`);
  assert.equal(r.phase, 'move');
  const m = move(r, player, piece ?? legalMoves(r)[0]);
  assert.ok(m);
  return m;
}

test('Aufbau nach Anleitung: je eine Figur auf dem A-Feld, drei im Haus', () => {
  const s = newGame({ humans: [0, 2], starter: 3 });
  assert.deepEqual(s.pieces, [[0, H, H, H], [0, H, H, H], [0, H, H, H], [0, H, H, H]]);
  assert.equal(s.turn, 3);
  assert.equal(s.phase, 'roll');
  assert.deepEqual(s.humans, [0, 2]);
  assert.deepEqual(s.places, []);
});

test('Laufbahn: A-Felder liegen 10 Felder auseinander, Feld 39 ist das letzte vor dem Ziel', () => {
  assert.deepEqual([0, 1, 2, 3].map((q) => fieldOf(q, 0)), [0, 10, 20, 30]);
  assert.equal(fieldOf(1, 30), 0); // Sitz 1 kommt über das A-Feld von Sitz 0
  assert.equal(fieldOf(0, 39), 39);
  assert.equal(fieldOf(0, H), null);
  assert.equal(fieldOf(0, GOAL), null); // Zielfelder gehören nicht zur Laufbahn – fremde Figuren kommen nie hinein
});

test('ungültige Wünsche → null', () => {
  const s = newGame({ starter: 0 });
  assert.equal(roll(s, 1, 4), null); // nicht dran
  for (const bad of [0, 7, 2.5, '6', null, undefined]) assert.equal(roll(s, 0, bad), null);
  assert.equal(move(s, 0, 0), null); // erst würfeln
  const r = roll(s, 0, 4);
  assert.equal(roll(r, 0, 4), null); // erst ziehen
  assert.equal(move(r, 1, 0), null); // nicht dran
  assert.equal(move(r, 0, 1), null); // Figur im Haus kommt nur mit 6 heraus
  assert.equal(move(r, 0, 9), null);
  assert.deepEqual(r.pieces, s.pieces); // alter Stand bleibt unverändert
});

test('Herauskommen nur mit einer 6, danach nochmal würfeln', () => {
  let s = setup({ pieces: { 0: [H, H, H, H], 1: [5, H, H, H] } });
  const five = roll(s, 0, 5);
  assert.equal(five.phase, 'roll'); // kein Zug – aber dreimal würfeln erlaubt
  assert.equal(five.turn, 0);
  s = roll(five, 0, 6);
  assert.equal(s.phase, 'move');
  assert.deepEqual(legalMoves(s), [0]); // Figuren im Haus sind gleich – nur eine wird angeboten
  s = move(s, 0, 0);
  assert.deepEqual(s.pieces[0], [0, H, H, H]);
  assert.equal(s.turn, 0); // nach der 6 nochmal
  assert.equal(s.phase, 'roll');
  assert.equal(s.tries, 0);
  assert.ok(s.events.some((e) => e.type === 'six'));
});

test('Hausregel: bei einer 6 freie Wahl – neue Figur heraus oder eine andere ziehen', () => {
  const s = roll(setup({ pieces: { 0: [12, H, H, 30] } }), 0, 6);
  assert.deepEqual(legalMoves(s), [0, 1, 3]); // Figuren im Haus sind gleich – nur die erste wird angeboten
  assert.deepEqual(move(s, 0, 0).pieces[0], [18, H, H, 30]);
  assert.deepEqual(move(s, 0, 1).pieces[0], [12, 0, H, 30]);
  assert.equal(move(s, 0, 0).turn, 0); // nach der 6 nochmal, egal was gezogen wurde
});

test('Steht noch eine eigene Figur auf dem A-Feld, muss erst sie mit der 6 weiter', () => {
  const s = roll(setup({ pieces: { 0: [0, H, H, 20] } }), 0, 6);
  assert.deepEqual(legalMoves(s), [0]);
  const m = move(s, 0, 0);
  assert.deepEqual(m.pieces[0], [6, H, H, 20]);
  assert.equal(m.turn, 0); // nochmal würfeln
  assert.deepEqual(legalMoves(roll(m, 0, 6)), [0, 1, 3]); // A-Feld frei → freie Wahl, auch die nächste heraus
});

test('A-Feld räumen, solange Figuren im Haus warten – außer die Figur dort kann nicht ziehen', () => {
  const s = roll(setup({ pieces: { 0: [0, 15, H, H] } }), 0, 3);
  assert.deepEqual(legalMoves(s), [0]);
  const blocked = roll(setup({ pieces: { 0: [0, 3, H, H] } }), 0, 3); // eigene Figur auf Feld 3
  assert.deepEqual(legalMoves(blocked), [1]);
  const free = roll(setup({ pieces: { 0: [0, 15, 22, 30] } }), 0, 3); // niemand mehr im Haus → freie Wahl
  assert.deepEqual(legalMoves(free), [0, 1, 2, 3]);
});

test('Schlagen: fremde Figur auf dem Zielfeld geht zurück ins Haus, eigene sind tabu', () => {
  // Sitz 1 steht auf Feld 17 der Laufbahn = Stand 7 von Sitz 1
  let s = setup({ pieces: { 0: [12, 14, 20, 30], 1: [7, H, H, H] } });
  s = rollMove(s, 0, 5, 0);
  assert.deepEqual(s.pieces[0], [17, 14, 20, 30]);
  assert.deepEqual(s.pieces[1], [H, H, H, H]);
  assert.deepEqual(s.events.find((e) => e.type === 'hit'), { type: 'hit', player: 1, piece: 0, from: 7, by: 0 });
  assert.equal(s.turn, 1);
  // auf eine eigene Figur geht es nicht
  const own = roll(setup({ pieces: { 0: [12, 14, 20, 30] } }), 0, 2);
  assert.deepEqual(legalMoves(own), [1, 2, 3]);
});

test('Herauskommen schlägt eine fremde Figur auf dem eigenen A-Feld', () => {
  let s = setup({ pieces: { 0: [H, H, H, H], 3: [10, H, H, H] } }); // Sitz 3, Stand 10 = Feld 0
  s = rollMove(s, 0, 6);
  assert.deepEqual(s.pieces[0], [0, H, H, H]);
  assert.deepEqual(s.pieces[3], [H, H, H, H]);
});

test('Überspringen ist erlaubt, besetzte Felder zählen mit', () => {
  const s = rollMove(setup({ pieces: { 0: [10, 11, 12, 13], 1: [4, H, H, H] } }), 0, 4, 0); // Sitz 1 auf Feld 14
  assert.equal(s.pieces[0][0], 14);
  assert.deepEqual(s.pieces[1], [H, H, H, H]); // auf Feld 14 geschlagen, über 11–13 hinweg
});

test('Ziel: nur mit passendem Wurf, im Ziel überspringen erlaubt, besetztes Zielfeld tabu', () => {
  const s = setup({ pieces: { 0: [39, 41, 20, 21] } });
  assert.deepEqual(legalMoves(roll(s, 0, 1)), [0, 1, 3]); // 39 → a, 41 → c (20 → 21 ist eigene Figur)
  assert.deepEqual(legalMoves(roll(s, 0, 2)), [1, 2, 3]); // 39 → b besetzt, 41 → d
  assert.deepEqual(legalMoves(roll(s, 0, 3)), [0, 2, 3]); // 39 → c über b hinweg
  assert.deepEqual(legalMoves(roll(s, 0, 5)), [2, 3]); // 39 + 5 wäre hinter d
  const exact = rollMove(setup({ pieces: { 0: [38, 41, 42, 43] } }), 0, 2, 0);
  assert.equal(exact.pieces[0][0], GOAL); // genau auf a
});

test('Kann keine Figur ziehen, verfällt der Zug', () => {
  const s = roll(setup({ pieces: { 0: [39, 41, 42, 43] } }), 0, 6); // 6 passt nicht ins Ziel
  assert.equal(s.turn, 1);
  assert.deepEqual(s.pieces[0], [39, 41, 42, 43]);
  assert.ok(s.events.some((e) => e.type === 'pass'));
});

test('Eine 6, die nicht gezogen werden kann, gibt keinen weiteren Wurf', () => {
  const s = roll(setup({ pieces: { 0: [38, 41, 42, 43] } }), 0, 6);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'roll');
});

test('Dreimal würfeln: ohne Figur auf der Laufbahn bis zu drei Versuche, dann ist der Nächste dran', () => {
  let s = setup({ pieces: { 0: [H, H, H, H] } });
  s = roll(s, 0, 1);
  assert.equal(s.turn, 0);
  assert.equal(s.tries, 1);
  s = roll(s, 0, 2);
  assert.equal(s.turn, 0);
  assert.equal(s.tries, 2);
  s = roll(s, 0, 3);
  assert.equal(s.turn, 1);
  assert.equal(s.tries, 0);
});

test('Dreimal würfeln gilt mit Figuren im Ziel nur, wenn sie nicht mehr vorrücken können', () => {
  assert.ok(mayRollThrice([H, H, H, H]));
  assert.ok(mayRollThrice([LAST, H, H, H])); // auf d
  assert.ok(mayRollThrice([42, 43, H, H])); // c und d
  assert.ok(!mayRollThrice([42, H, H, H])); // Beispiel der Anleitung: auf c, könnte mit 1 vorrücken
  assert.ok(!mayRollThrice([40, 43, H, H])); // a könnte noch nach b oder c
  assert.ok(!mayRollThrice([0, H, H, H])); // Figur auf der Laufbahn
  const s = roll(setup({ pieces: { 0: [42, H, H, H] } }), 0, 2); // 2 passt nicht, kein Versuch mehr
  assert.equal(s.turn, 1);
});

test('6 = nochmal würfeln, auch mehrmals hintereinander', () => {
  let s = setup({ pieces: { 0: [5, 15, 25, 35] } });
  s = rollMove(s, 0, 6, 0);
  assert.equal(s.turn, 0);
  s = rollMove(s, 0, 6, 0);
  assert.equal(s.turn, 0);
  s = rollMove(s, 0, 2, 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.pieces[0], [19, 15, 25, 35]);
});

test('Sieg: wer mit einer 6 die letzte Figur ins Ziel bringt, würfelt nicht nochmal', () => {
  let s = setup({ pieces: { 0: [37, 40, 41, 42], 1: [3, H, H, H] }, humans: [0] });
  s = rollMove(s, 0, 6, 0); // 37 + 6 = d, über a–c hinweg
  assert.deepEqual(s.pieces[0], [43, 40, 41, 42]);
  assert.equal(s.phase, 'over'); // einziger Mensch ist fertig
  assert.deepEqual(s.places, [0]);
  assert.ok(s.events.some((e) => e.type === 'finish' && e.place === 1));
});

test('Plätze: nach dem Ersten wird weitergespielt, bis alle Menschen fertig sind', () => {
  // Sitz 1 (Computer) wird zuerst fertig, Mensch auf Sitz 0 spielt weiter
  let s = setup({ pieces: { 0: [10, H, H, H], 1: [39, 41, 42, 43], 2: [10, H, H, H], 3: [10, H, H, H] }, turn: 1 });
  s = rollMove(s, 1, 1, 0);
  assert.equal(s.phase, 'roll');
  assert.deepEqual(s.places, [1]);
  assert.equal(s.turn, 2);
  // Sitz 1 wird beim Weitergeben übersprungen
  s = rollMove(s, 2, 2);
  s = rollMove(s, 3, 2);
  assert.equal(s.turn, 0);
  s = rollMove(s, 0, 2);
  assert.equal(s.turn, 2);
});

test('Plätze: ist nur noch einer übrig, bekommt er den letzten Platz und das Spiel endet', () => {
  let s = setup({
    pieces: { 0: [10, H, H, H], 1: [40, 41, 42, 43], 2: [39, 41, 42, 43], 3: [40, 41, 42, 43] },
    turn: 2, humans: [0, 2], places: [1, 3],
  });
  s = rollMove(s, 2, 1, 0);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.places, [1, 3, 2, 0]);
  assert.equal(roll(s, 0, 3), null); // vorbei
});

test('Revanche: der Nächste im Uhrzeigersinn fängt an', () => {
  const s = { ...setup({ turn: 3, humans: [0, 2] }), phase: 'over' };
  const r = again(s);
  assert.equal(r.turn, 0);
  assert.equal(r.starter, 0);
  assert.deepEqual(r.humans, [0, 2]);
  assert.equal(again(newGame()), null); // läuft noch
});

test('Computer: hat er zwei Schläge zur Wahl, nimmt er den weiter gekommenen Gegner', () => {
  // Figur 0 schlägt mit 3 auf Feld 13 Sitz 1 (Stand 3), Figur 1 auf Feld 33 Sitz 2 (Stand 13)
  const s = roll(setup({ pieces: { 0: [10, 30, H, H], 1: [3, H, H, H], 2: [13, H, H, H] } }), 0, 3);
  assert.deepEqual(legalMoves(s), [0, 1]);
  assert.equal(chooseMove(s), 1);
});

test('Computer: bringt eine Figur ins Ziel statt sie stehen zu lassen', () => {
  const s = roll(setup({ pieces: { 0: [37, 5, 15, H], 1: [H, H, H, H] } }), 0, 4);
  assert.equal(chooseMove(s), 0);
});

test('Computer: zieht eine bedrohte Figur weg und stellt sich nicht vor Gegner', () => {
  // Figur 0 (Feld 20) hat einen Gegner 2 Felder dahinter, Figur 1 (Feld 5) steht sicher
  const s = roll(setup({ pieces: { 0: [20, 5, 41, 42], 3: [28, H, H, H] } }), 0, 5); // Sitz 3, Stand 28 = Feld 18
  assert.ok(danger(s, 0, 20) > 0);
  assert.equal(chooseMove(s), 0);
});

// Eine Partie nur mit Computern bis zum Ende; prüft nach jedem Schritt, dass der Stand gültig ist
function playOut(rng, pick = (s) => chooseMove(s), humans = []) {
  let s = newGame({ humans, starter: Math.floor(rng() * 4) });
  for (let step = 0; step < 20000; step++) {
    if (s.phase === 'over') return s;
    if (s.phase === 'roll') s = roll(s, s.turn, 1 + Math.floor(rng() * 6));
    else s = move(s, s.turn, pick(s, rng));
    assert.ok(s, 'jede Aktion muss gültig sein');
    checkState(s);
  }
  throw new Error('Partie endet nicht');
}

function checkState(s) {
  const fields = new Set();
  s.pieces.forEach((mine, q) => {
    assert.equal(mine.length, 4);
    for (const p of mine) {
      assert.ok(Number.isInteger(p) && p >= HOUSE && p <= LAST);
      const f = fieldOf(q, p);
      if (f !== null) {
        assert.ok(!fields.has(f), 'zwei Figuren auf einem Feld');
        fields.add(f);
      }
    }
    const inGoal = mine.filter((p) => p >= GOAL);
    assert.equal(new Set(inGoal).size, inGoal.length, 'zwei Figuren auf einem Zielfeld');
  });
  assert.ok(fields.size <= TRACK);
}

test('300 Partien Computer gegen Computer: alle enden, jeder Zug gültig, Plätze stimmen', () => {
  const rng = seeded(7);
  let rolls = 0;
  for (let i = 0; i < 300; i++) {
    const s = playOut(rng);
    assert.equal(s.places.length, 4);
    assert.deepEqual([...s.places].sort(), [0, 1, 2, 3]);
    s.places.slice(0, 3).forEach((q) => assert.ok(s.pieces[q].every((p) => p >= GOAL)));
    rolls += s.seq;
  }
  assert.ok(rolls > 0);
});

test('Partien mit Menschen enden, sobald alle Menschen fertig sind', () => {
  const rng = seeded(11);
  for (let i = 0; i < 100; i++) {
    const humans = i % 2 ? [0] : [0, 2];
    const s = playOut(rng, (st) => chooseMove(st), humans);
    assert.ok(humans.every((h) => s.places.includes(h)));
    const lastHuman = Math.max(...humans.map((h) => s.places.indexOf(h)));
    assert.ok(s.places.length === lastHuman + 1 || s.places.length === 4);
  }
});

// Mit Schlagzwang müssen auch Zufallsspieler immer schlagen – der Abstand ist kleiner als ohne (Simulation: ~42 %).
// 33 % bei 1000 Partien liegt rund 6 Standardabweichungen über Zufall (25 %).
test('Computer spielt klar besser als Zufall (1000 Partien, 1 Computer gegen 3 Zufallsspieler)', () => {
  const rng = seeded(3);
  let wins = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const smart = i % 4;
    const s = playOut(rng, (st) => {
      const options = legalMoves(st);
      return st.turn === smart ? chooseMove(st) : options[Math.floor(rng() * options.length)];
    });
    if (s.places[0] === smart) wins++;
  }
  assert.ok(wins / N > 0.33, `Siegquote ${(100 * wins / N).toFixed(1)} % (Zufall wäre 25 %)`);
});

test('Spielplan: 40 Laufbahn-, 16 Ziel- und 16 Hausfelder, alle verschieden, Laufbahn lückenlos im Kreis', async () => {
  const { TRACK_CELLS, GOAL_CELLS, HOUSE_CELLS, cellOf, pathOf } = await import('../src/maedn/layout.js');
  const all = [...TRACK_CELLS, ...GOAL_CELLS.flat(), ...HOUSE_CELLS.flat()].map(([c, r]) => `${c}/${r}`);
  assert.equal(all.length, 72);
  assert.equal(new Set(all).size, 72);
  const step = ([a, b], [c, d]) => Math.abs(a - c) + Math.abs(b - d);
  TRACK_CELLS.forEach((cell, i) => assert.equal(step(cell, TRACK_CELLS[(i + 1) % 40]), 1, `Lücke nach Feld ${i}`));
  for (let q = 0; q < 4; q++) {
    assert.equal(step(cellOf(q, 39, 0), cellOf(q, GOAL, 0)), 1); // vom letzten Feld direkt ins Ziel
    GOAL_CELLS[q].forEach((cell, k) => k && assert.equal(step(cell, GOAL_CELLS[q][k - 1]), 1));
    assert.deepEqual(GOAL_CELLS[q][3].map((v) => Math.abs(v - 5)).sort(), [0, 1]); // d liegt neben der Mitte
    assert.ok(HOUSE_CELLS[q].every(([c, r]) => (c <= 1 || c >= 9) && (r <= 1 || r >= 9))); // Haus in einer Ecke
  }
  assert.deepEqual(cellOf(0, 0, 0), [4, 10]); // Sitz 0 kommt unten (+z) heraus …
  assert.deepEqual(cellOf(1, 0, 0), [0, 4]); // … Sitz 1 links, Laufrichtung im Uhrzeigersinn
  assert.deepEqual(pathOf(0, 38, 41, 0), [cellOf(0, 39, 0), cellOf(0, 40, 0), cellOf(0, 41, 0)]);
  assert.deepEqual(pathOf(2, HOUSE, 0, 3), [cellOf(2, 0, 3)]);
});

test('6 mit der letzten Figur ins Ziel, Spiel läuft weiter: kein weiterer Wurf, der Nächste ist dran', () => {
  let s = setup({ pieces: { 0: [10, H, H, H], 1: [37, 40, 41, 42], 2: [10, H, H, H], 3: [10, H, H, H] }, turn: 1, humans: [0] });
  s = rollMove(s, 1, 6, 0);
  assert.deepEqual(s.places, [1]);
  assert.equal(s.phase, 'roll');
  assert.equal(s.turn, 2);
});

test('Dreimal würfeln: 6 im zweiten Versuch → Figur heraus, nochmal würfeln, Versuche zurück auf 0', () => {
  let s = roll(setup({ pieces: { 0: [H, H, H, H] } }), 0, 2);
  assert.equal(s.tries, 1);
  s = rollMove(s, 0, 6);
  assert.deepEqual(s.pieces[0], [0, H, H, H]);
  assert.equal(s.turn, 0);
  assert.equal(s.phase, 'roll');
  assert.equal(s.tries, 0);
});

test('Verfallener Zug überspringt Spieler, die schon fertig sind', () => {
  const s = roll(setup({ pieces: { 0: [39, 41, 42, 43], 1: [40, 41, 42, 43], 2: [10, H, H, H] }, places: [1] }), 0, 6);
  assert.equal(s.turn, 2);
});

test('Auslegung: 6, A-Feld mit eigener Figur besetzt, die nicht ziehen kann → freie Wahl (Anleitung regelt das nicht)', () => {
  const s = roll(setup({ pieces: { 0: [0, 6, H, H] } }), 0, 6); // Figur auf A käme auf die eigene Figur auf Feld 6
  assert.deepEqual(legalMoves(s), [1]);
  assert.deepEqual(move(s, 0, 1).pieces[0], [0, 12, H, H]);
});

test('move mit falschem Spieler-Wert → null statt Fehler', () => {
  const s = roll(newGame({ starter: 0 }), 0, 3);
  for (const bad of [undefined, '0', null, 4]) assert.equal(move(s, bad, 0), null);
});

test('Schlagzwang: kann eine Figur schlagen, sind nur Schlag-Züge erlaubt', () => {
  // Figur 0 (Feld 10) schlägt mit 3 auf Feld 13 (Sitz 1, Stand 3); Figur 1 könnte frei ziehen
  const s = roll(setup({ pieces: { 0: [10, 25, H, H], 1: [3, H, H, H] } }), 0, 3);
  assert.deepEqual(legalMoves(s), [0]);
  assert.equal(move(s, 0, 1), null);
  // mehrere Schlagmöglichkeiten → freie Wahl darunter
  const two = roll(setup({ pieces: { 0: [10, 20, H, H], 1: [3, 13, H, H] } }), 0, 3); // Felder 13 und 23
  assert.deepEqual(legalMoves(two), [0, 1]);
});

test('Schlagzwang geht vor: auch vor dem A-Feld-Räumen und vor der Wahl bei der 6', () => {
  // Figur auf dem A-Feld müsste weg, aber Figur 1 kann mit 2 schlagen (Feld 22 = Sitz 2, Stand 2)
  const s = roll(setup({ pieces: { 0: [0, 20, H, H], 2: [2, H, H, H] } }), 0, 2);
  assert.deepEqual(legalMoves(s), [1]);
  // 6: Herauskommen schlägt eine fremde Figur auf dem eigenen A-Feld → nur das ist erlaubt
  const six = roll(setup({ pieces: { 0: [12, H, H, H], 3: [10, H, H, H] } }), 0, 6); // Sitz 3, Stand 10 = Feld 0
  assert.deepEqual(legalMoves(six), [1]);
});

test('Ohne Hilfen: wer einen möglichen Schlag auslässt, kann angeprangert werden – Figur zurück ins Haus', () => {
  const free = { ...setup({ pieces: { 0: [10, 25, H, H], 1: [3, H, H, H] } }), free: true, humans: [0, 2] };
  const r = roll(free, 0, 3);
  const skipped = move(r, 0, { piece: 1, to: 28 }); // genau gewürfelt, aber nicht geschlagen
  assert.equal(skipped.cheat.bad.length, 1);
  const hit = move(r, 0, { piece: 0, to: 13 }); // regelgerecht geschlagen
  assert.deepEqual(hit.cheat.bad, []);
});

test('Farbwahl: Host sitzt vorn, das Brett dreht sich passend, der Gast sitzt bei seiner Farbe', async () => {
  const { seating, newPick, pick } = await import('../src/maedn/rules.js');
  assert.deepEqual(seating(0), { colors: [0, 1, 2, 3], guestSeat: null });
  assert.deepEqual(seating(2, 0), { colors: [2, 3, 0, 1], guestSeat: 2 }); // Rot gegen Gelb: gegenüber
  assert.equal(seating(2, 3).guestSeat, 1); // Schwarz neben Rot: links vom Host
  assert.equal(seating(2, 1).guestSeat, 3); // Grün: rechts vom Host
  let s = newPick({ players: 2, starter: 3, free: true });
  assert.equal(s.phase, 'colors');
  assert.equal(pick(s, 0, 4), null);
  assert.equal(pick(s, 2, 1), null);
  s = pick(s, 0, 2);
  assert.deepEqual(s.picks, [2, null]);
  assert.equal(pick(s, 1, 2), null); // schon vergeben
  s = pick(s, 0, 1); // Host darf umentscheiden, solange der Gast noch wählt
  s = pick(s, 1, 2);
  assert.equal(s.phase, 'roll');
  assert.deepEqual(s.colors, [1, 2, 3, 0]);
  assert.deepEqual(s.humans, [0, 1]);
  assert.equal(s.turn, 3);
  assert.equal(s.free, true);
  assert.deepEqual(again({ ...s, phase: 'over' }).colors, [1, 2, 3, 0]); // Revanche behält die Farben
  assert.deepEqual(pick(newPick(), 0, 3).humans, [0]); // allein
});

test('Schlagzwang-Grenzfälle: Herauskommen mit Schlag und anderer Schlag; Ziel gegen Schlag; dreimal würfeln', () => {
  // 6: Herauskommen schlägt auf dem A-Feld (Sitz 3, Stand 10 = Feld 0), Figur 0 schlägt auf Feld 18 (Sitz 1, Stand 8)
  const both = roll(setup({ pieces: { 0: [12, H, H, H], 1: [8, H, H, H], 3: [10, H, H, H] } }), 0, 6);
  assert.deepEqual(legalMoves(both), [0, 1]);
  // Figur 0 käme mit 4 ins Ziel, Figur 1 schlägt → nur der Schlag
  const goal = roll(setup({ pieces: { 0: [37, 10, H, H], 1: [4, H, H, H] } }), 0, 4); // Feld 14 = Sitz 1, Stand 4
  assert.deepEqual(legalMoves(goal), [1]);
  // Dreimal würfeln: im dritten Versuch eine 6, Herauskommen schlägt, dann nochmal würfeln
  let s = setup({ pieces: { 0: [H, H, H, H], 3: [10, H, H, H] } });
  s = roll(roll(s, 0, 1), 0, 2);
  s = rollMove(s, 0, 6);
  assert.deepEqual(s.pieces[3], [H, H, H, H]);
  assert.equal(s.turn, 0);
  assert.equal(s.tries, 0);
});

test('Ohne Hilfen: 6 gezogen statt heraus ist regelgerecht, A-Feld nicht geräumt ist Schummeln', () => {
  const free = (pieces) => ({ ...setup({ pieces, humans: [0, 2] }), free: true, humans: [0, 2] });
  const six = roll(free({ 0: [12, H, H, H] }), 0, 6);
  assert.deepEqual(move(six, 0, { piece: 0, to: 18 }).cheat.bad, []);
  const start = roll(free({ 0: [0, 12, H, H] }), 0, 3); // A-Feld müsste geräumt werden
  assert.equal(move(start, 0, { piece: 1, to: 15 }).cheat.bad.length, 1);
});

test('Farbwahl: Gast zuerst, vergebene Farbe gesperrt, nach dem Start keine Wahl mehr, kein Zug während der Wahl', async () => {
  const { newPick, pick } = await import('../src/maedn/rules.js');
  let s = pick(newPick({ players: 2, free: true }), 1, 0); // Gast nimmt Gelb
  assert.equal(pick(s, 0, 0), null); // Host kann Gelb nicht mehr nehmen
  assert.equal(move(s, 0, 0), null);
  assert.equal(roll(s, 0, 6), null);
  s = pick(s, 0, 3); // Host Schwarz → Gelb ist die nächste Farbe im Uhrzeigersinn, sitzt also links vom Host
  assert.deepEqual(s.humans, [0, 1]);
  assert.deepEqual(s.colors, [3, 0, 1, 2]);
  assert.equal(pick(s, 0, 2), null); // Spiel läuft schon
});
