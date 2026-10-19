import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, canRoll, toggleHold, applyRoll, scoreField, scores, winner } from '../src/kniffel/game.js';
import { FIELDS } from '../src/kniffel/rules.js';

test('Zug: würfeln, behalten, erneut würfeln', () => {
  let s = newGame(0);
  assert.equal(toggleHold(s, 0, 0), null); // vor dem ersten Wurf gibt es nichts zu behalten
  s = applyRoll(s, 0, [6, 6, 2, 3, 4]);
  assert.equal(s.rolls, 1);
  s = toggleHold(s, 0, 0);
  s = toggleHold(s, 0, 1);
  assert.deepEqual(s.held, [true, true, false, false, false]);
  s = applyRoll(s, 0, [1, 1, 6, 6, 5]);
  assert.deepEqual(s.dice, [6, 6, 6, 6, 5]); // behaltene Würfel bleiben
  s = toggleHold(s, 0, 1);
  assert.deepEqual(s.held, [true, false, false, false, false]); // wieder freigeben geht
});

test('höchstens 3 Würfe, danach kein Behalten mehr', () => {
  let s = newGame(0);
  for (let i = 0; i < 3; i++) s = applyRoll(s, 0, [1, 2, 3, 4, 5]);
  assert.equal(s.rolls, 3);
  assert.equal(applyRoll(s, 0, [1, 2, 3, 4, 5]), null);
  assert.equal(toggleHold(s, 0, 0), null);
});

test('nicht dran → alles ungültig', () => {
  let s = newGame(0);
  assert.equal(applyRoll(s, 1, [1, 2, 3, 4, 5]), null);
  s = applyRoll(s, 0, [1, 2, 3, 4, 5]);
  assert.equal(toggleHold(s, 1, 0), null);
  assert.equal(scoreField(s, 1, 'chance'), null);
});

test('ungültige Würfelwerte werden abgelehnt', () => {
  const s = newGame(0);
  assert.equal(applyRoll(s, 0, [1, 2, 3, 4]), null);
  assert.equal(applyRoll(s, 0, [0, 2, 3, 4, 5]), null);
  assert.equal(applyRoll(s, 0, [1, 2, 3, 4, 7]), null);
  assert.equal(applyRoll(s, 0, [1.5, 2, 3, 4, 5]), null);
  assert.equal(applyRoll(s, 0, 'abc'), null);
});

test('alle Würfel behalten → kein Wurf möglich', () => {
  let s = applyRoll(newGame(0), 0, [2, 2, 2, 2, 2]);
  for (let i = 0; i < 5; i++) s = toggleHold(s, 0, i);
  assert.ok(!canRoll(s, 0));
});

test('Eintragen: erst nach einem Wurf, Feld nur einmal, dann ist der andere dran', () => {
  let s = newGame(0);
  assert.equal(scoreField(s, 0, 'chance'), null);
  s = applyRoll(s, 0, [3, 3, 3, 2, 2]);
  s = toggleHold(s, 0, 0);
  s = scoreField(s, 0, 'fullHouse');
  assert.equal(s.cards[0].fullHouse, 25);
  assert.equal(s.turn, 1);
  assert.equal(s.rolls, 0);
  assert.deepEqual(s.held, [false, false, false, false, false]);
  assert.equal(scoreField(s, 1, 'unbekannt'), null);
  s = applyRoll(s, 1, [1, 1, 1, 1, 6]);
  s = scoreField(s, 1, 'fullHouse');
  assert.equal(s.cards[1].fullHouse, 0); // streichen
  s = applyRoll(s, 0, [3, 3, 3, 2, 2]);
  assert.equal(scoreField(s, 0, 'fullHouse'), null); // schon belegt
});

test('zweiter Kniffel: 50 Zusatzpunkte + Joker', () => {
  let s = newGame(0);
  s = scoreField(applyRoll(s, 0, [5, 5, 5, 5, 5]), 0, 'kniffel');
  s = scoreField(applyRoll(s, 1, [1, 2, 3, 4, 6]), 1, 'chance');
  s = scoreField(applyRoll(s, 0, [2, 2, 2, 2, 2]), 0, 'grosseStrasse');
  assert.equal(s.cards[0].grosseStrasse, 40);
  assert.equal(s.extra[0], 1);
  assert.equal(scores(s)[0], 50 + 40 + 50);
});

test('gestrichener Kniffel gibt keinen Zusatz', () => {
  let s = newGame(1);
  s = scoreField(applyRoll(s, 1, [1, 2, 3, 4, 6]), 1, 'kniffel');
  s = scoreField(applyRoll(s, 0, [1, 2, 3, 4, 6]), 0, 'chance');
  s = scoreField(applyRoll(s, 1, [6, 6, 6, 6, 6]), 1, 'sechser');
  assert.equal(s.cards[1].sechser, 30);
  assert.equal(s.extra[1], 0);
});

test('komplette Partie: 26 Züge, dann Ende und Gewinner', () => {
  let s = newGame(0);
  for (let round = 0; round < 13; round++) {
    for (const p of [0, 1]) {
      assert.ok(!s.over);
      assert.equal(s.turn, p);
      s = applyRoll(s, p, p === 0 ? [6, 6, 6, 6, 5] : [1, 1, 2, 3, 4]);
      s = scoreField(s, p, FIELDS[round]);
    }
  }
  assert.ok(s.over);
  assert.equal(applyRoll(s, 0, [1, 2, 3, 4, 5]), null);
  const [a, b] = scores(s);
  assert.ok(a > b);
  assert.equal(winner(s), 0);
});

test('Gleichstand → kein Gewinner', () => {
  let s = newGame(0);
  for (const field of FIELDS) {
    for (const p of [0, 1]) s = scoreField(applyRoll(s, p, [1, 2, 3, 4, 6]), p, field);
  }
  assert.ok(s.over);
  assert.equal(winner(s), null);
});
