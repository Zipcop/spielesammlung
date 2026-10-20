// Mühle (src/muehle/game.js): Setzen, Ziehen, Springen, Mühle und Schlagen, Spielende, Remis, „Ohne Hilfen“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, move, take, pass, accuse, waive, again, forGuest, targets, takeTargets, movable, canMove,
  NEIGHBORS, MILLS, QUIET_LIMIT,
} from '../src/muehle/game.js';

// Stellung bauen: w = Punkte von Spieler 0, b = von Spieler 1
function setup({ w = [], b = [], hand = [0, 0], turn = 0, free = false } = {}) {
  const s = newGame({ free });
  const board = Array(24).fill(null);
  for (const i of w) board[i] = 0;
  for (const i of b) board[i] = 1;
  return { ...s, board, hand, turn };
}

test('Brett: 24 Punkte, 16 Mühlen, Nachbarn beidseitig', () => {
  assert.equal(MILLS.length, 16);
  NEIGHBORS.forEach((ns, i) => ns.forEach((j) => assert.ok(NEIGHBORS[j].includes(i), `${i}–${j}`)));
  assert.equal(NEIGHBORS.flat().length / 2, 32); // 32 Linienstücke
  assert.deepEqual(NEIGHBORS[9].sort((a, b) => a - b), [1, 8, 10, 17]); // Mitte oben im mittleren Ring
  assert.deepEqual(NEIGHBORS[0].sort((a, b) => a - b), [1, 7]); // Ecke
});

test('Setzen: abwechselnd, Weiß zuerst, nur auf freie Punkte', () => {
  let s = newGame({ white: 1 });
  assert.equal(s.turn, 1);
  assert.equal(place(s, 0, 0), null); // nicht dran
  s = place(s, 1, 0);
  assert.equal(s.board[0], 1);
  assert.deepEqual(s.hand, [9, 8]);
  assert.equal(s.turn, 0);
  assert.equal(place(s, 0, 0), null); // besetzt
  assert.equal(move(s, 0, 0, 1), null); // fremder Stein
});

test('Mühle beim Setzen: Stein schlagen, nicht aus einer Mühle', () => {
  let s = setup({ w: [0, 1], b: [8, 9, 10, 20], hand: [5, 5] });
  s = place(s, 0, 2);
  assert.equal(s.step, 'take');
  assert.equal(s.turn, 0);
  assert.deepEqual(takeTargets(s, 0), [20]); // 8-9-10 ist eine Mühle
  assert.equal(take(s, 0, 9), null);
  assert.equal(place(s, 0, 3), null); // erst schlagen
  s = take(s, 0, 20);
  assert.equal(s.board[20], null);
  assert.equal(s.turn, 1);
  assert.equal(s.step, 'move');
});

test('Alle in Mühlen: dann darf man aus einer Mühle schlagen', () => {
  let s = setup({ w: [0, 1], b: [8, 9, 10], hand: [5, 6] });
  s = place(s, 0, 2);
  assert.deepEqual(takeTargets(s, 0), [8, 9, 10]);
  assert.ok(take(s, 0, 9));
});

test('Zwei Mühlen auf einmal: trotzdem nur ein Stein', () => {
  let s = setup({ w: [0, 1, 3, 4], b: [16, 17, 18, 20], hand: [3, 3] });
  s = place(s, 0, 2); // 0-1-2 und 2-3-4
  assert.equal(take(s, 0, 16), null); // 16-17-18 ist selbst eine Mühle
  s = take(s, 0, 20);
  assert.equal(s.turn, 1);
  assert.equal(s.step, 'move');
});

test('Ziehen nur auf freie Nachbarpunkte – mit 3 Steinen springen', () => {
  const s = setup({ w: [0, 2, 4, 12], b: [6, 14, 16, 22] });
  assert.deepEqual(targets(s, 0, 0).sort((a, b) => a - b), [1, 7]);
  assert.equal(move(s, 0, 0, 5), null);
  assert.ok(move(s, 0, 0, 1));
  const three = setup({ w: [0, 2, 12], b: [6, 14, 16, 22] });
  assert.equal(targets(three, 0, 0).length, 17);
  assert.ok(move(three, 0, 0, 23)?.last);
  assert.equal(move(setup({ w: [0, 2, 12], b: [6, 14, 16, 22], hand: [1, 0] }), 0, 0, 1), null); // noch Steine in der Hand
});

test('Verloren mit 2 Steinen', () => {
  let s = setup({ w: [0, 1, 20], b: [8, 10, 18], turn: 0 });
  s = move(s, 0, 20, 2); // springen, Mühle 0-1-2
  s = take(s, 0, 8);
  assert.deepEqual(s.result, { winner: 0, reason: 'steine' });
  assert.equal(place(s, 1, 5), null);
});

test('Verloren, wer nicht mehr ziehen kann', () => {
  // Schwarz auf den vier Ecken außen, Weiß auf drei Mitten – zieht Weiß auf die vierte, ist Schwarz eingesperrt
  const s = setup({ w: [1, 3, 5, 15], b: [0, 2, 4, 6] });
  assert.ok(canMove(s, 1));
  const t = move(s, 0, 15, 7);
  assert.deepEqual(t.result, { winner: 0, reason: 'blockiert' });
  // mit 3 Steinen springt man – eingesperrt ist man dann nie
  assert.ok(canMove(setup({ w: [1, 3, 5, 7], b: [0, 2, 4] }), 1));
});

test('Remis: dreimal dieselbe Stellung', () => {
  let s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22] });
  const cycle = [[0, 1], [6, 7], [1, 0], [7, 6]];
  let n = 0;
  while (!s.result && n < 40) {
    const [from, to] = cycle[n % 4];
    s = move(s, s.turn, from, to);
    n++;
  }
  // die Stellung nach dem ersten Halbzug steht nach dem 5. und 9. wieder da
  assert.equal(n, 9);
  assert.deepEqual(s.result, { winner: null, reason: 'wiederholung' });
});

test('Remis: 20 Züge je Seite ohne Schlagen', () => {
  let s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22] });
  const cycle = [[0, 1], [6, 7], [1, 0], [7, 6]];
  let n = 0;
  while (!s.result) {
    const [from, to] = cycle[n % 4];
    s = move({ ...s, positions: [] }, s.turn, from, to); // Wiederholung hier ausgeblendet
    n++;
  }
  assert.equal(n, QUIET_LIMIT);
  assert.equal(s.result.reason, 'zuege');
});

test('Revanche tauscht die Farben', () => {
  const s = { ...setup(), result: { winner: 0, reason: 'steine' } };
  assert.equal(again(s).white, 1);
  assert.equal(again(setup()), null);
});

test('Hilfslisten: movable und takeTargets', () => {
  const s = setup({ w: [0, 9], b: [1, 7, 17] });
  assert.deepEqual(movable(s, 0), [9]);
  assert.deepEqual(takeTargets(s, 0), []);
});

// --- Ohne Hilfen ---

test('Ohne Hilfen: falsch springen geht durch, Erwischt nimmt den Zug zurück', () => {
  const s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22], free: true });
  let t = move(s, 0, 0, 10);
  assert.ok(t);
  assert.equal(t.step, 'take'); // ohne Hilfen: schlagen oder Zug beenden
  t = pass(t, 0);
  assert.equal(t.turn, 1);
  assert.deepEqual(forGuest(t).cheat, { player: 0 }); // der Gast sieht nicht, ob es regelgerecht war
  const u = accuse(t, 1);
  assert.equal(u.verdict.caught, true);
  assert.equal(u.verdict.why, 'gesprungen, obwohl noch mehr als 3 Steine da sind');
  assert.deepEqual(u.board, s.board);
  assert.equal(u.turn, 0);
  assert.deepEqual(u.strikes, [1, 0]);
  assert.equal(u.seq, t.seq + 1);
});

test('Ohne Hilfen: ohne Mühle schlagen und aus einer Mühle schlagen', () => {
  const s = setup({ w: [0, 1, 20], b: [8, 9, 10, 16], hand: [2, 2], free: true });
  let t = place(s, 0, 3);
  t = take(t, 0, 16);
  assert.equal(accuse(t, 1).verdict.why, 'ohne Mühle geschlagen');
  let m = place(s, 0, 2); // echte Mühle
  m = take(m, 0, 9); // aus der Mühle, obwohl 16 frei ist
  assert.equal(accuse(m, 1).verdict.why, 'einen Stein aus einer Mühle geschlagen, obwohl ein anderer frei war');
  const ok = take(place(s, 0, 2), 0, 16);
  const alarm = accuse(ok, 1);
  assert.equal(alarm.verdict.caught, false);
  assert.deepEqual(alarm.strikes, [0, 1]);
  assert.deepEqual(alarm.board, ok.board);
  assert.equal(alarm.cheat, null);
});

test('Ohne Hilfen: zwei Verstöße in einem Zug, Frist endet mit dem eigenen Zug', () => {
  const s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22], free: true });
  let t = take(move(s, 0, 0, 10), 0, 6);
  assert.equal(accuse(t, 1).verdict.why, 'gesprungen, obwohl noch mehr als 3 Steine da sind und ohne Mühle geschlagen');
  assert.equal(accuse(t, 0), null); // nicht gegen sich selbst
  t = pass(move(t, 1, 14, 15), 1);
  assert.equal(t.cheat.player, 1);
  assert.equal(accuse(t, 1), null); // der eigene Zug hat die Frist geschlossen
});

test('Ohne Hilfen: ziehen statt setzen ist Schummeln', () => {
  const s = setup({ w: [0], b: [8], hand: [8, 8], free: true });
  const t = pass(move(s, 0, 0, 1), 0);
  assert.equal(accuse(t, 1).verdict.why, 'gezogen statt einen Stein zu setzen');
});

test('Ohne Hilfen: dritte Verwarnung verliert, waive schließt die Frist nach Spielende', () => {
  let s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22], free: true });
  s = { ...s, strikes: [2, 0] };
  const t = accuse(pass(move(s, 0, 0, 10), 0), 1);
  assert.deepEqual(t.result, { winner: 1, reason: 'schummeln' });
  // Spielende durch den letzten Zug: Ankläger kann noch rufen, waive macht die Frist zu
  let e = setup({ w: [0, 1, 20], b: [8, 10, 18], free: true });
  e = take(move(e, 0, 20, 2), 0, 8);
  assert.equal(e.result.winner, 0);
  assert.equal(waive(e, 1).cheat, null);
  const f = accuse(e, 1);
  assert.equal(f.verdict.caught, false); // Springen mit 3 Steinen ist erlaubt
  assert.equal(f.result.winner, 0);
});

test('Ohne Hilfen: nach Erwischt darf der Schummler regelgerecht neu ziehen', () => {
  const s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22], free: true });
  const u = accuse(pass(move(s, 0, 0, 10), 0), 1);
  const v = pass(move(u, 0, 0, 1), 0);
  assert.equal(v.turn, 1);
  assert.equal(accuse(v, 1).verdict.caught, false);
});

test('Mit Hilfen: kein Schummeln, kein pass', () => {
  const s = setup({ w: [0, 4, 12, 20], b: [6, 14, 18, 22] });
  assert.equal(move(s, 0, 0, 10), null);
  assert.equal(pass(move(s, 0, 0, 1), 0), null);
  assert.equal(accuse(move(s, 0, 0, 1), 1), null);
});

test('Computer-Schummelzug ist nie regelgerecht (alle Steine des anderen in Mühlen)', async () => {
  const { cheatTurn } = await import('../src/muehle/ai.js');
  const s = setup({ w: [0, 1, 2, 8, 9, 10], b: [16, 17], hand: [0, 1], turn: 1, free: true });
  const base = { from: -1, to: 18, take: 9 }; // Mühle 16-17-18, alle weißen Steine stehen in Mühlen → jeder Schlag erlaubt
  for (let k = 0; k < 20; k++) {
    const t = cheatTurn(s, 1, base, () => k / 20);
    if (!t) continue;
    let n = t.from < 0 ? place(s, 1, t.to) : move(s, 1, t.from, t.to);
    n = t.take >= 0 ? take(n, 1, t.take) : pass(n, 1);
    assert.equal(accuse(n, 0).verdict.caught, true, JSON.stringify(t));
  }
});
