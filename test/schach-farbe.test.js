// Schach: Farbwahl am Tisch (Nico: „Weiß oder Schwarz wählen“) – allein bzw. der Host (Spieler 0) wählt, der andere bekommt die andere Farbe
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, whiteFor, move, resign, again, turnOf, colorOf } from '../src/schach/game.js';

test('Weiß gewählt: Spieler 0 hat Weiß und zieht zuerst', () => {
  const s = newGame(whiteFor('w', () => 0.99));
  assert.equal(colorOf(s, 0), 'w');
  assert.equal(colorOf(s, 1), 'b');
  assert.equal(turnOf(s), 0);
});

test('Schwarz gewählt: Spieler 0 hat Schwarz, der andere (Gast/Computer) zieht zuerst', () => {
  const s = newGame(whiteFor('b', () => 0.01));
  assert.equal(colorOf(s, 0), 'b');
  assert.equal(colorOf(s, 1), 'w');
  assert.equal(turnOf(s), 1);
  assert.equal(move(s, 0, 'e7e5'), null); // Spieler 0 darf nicht zuerst
  assert.ok(move(s, 1, 'e2e4'));
});

test('Zufall: beide Farben möglich, je nach Zufallszahl', () => {
  assert.equal(whiteFor('zufall', () => 0.2), 0);
  assert.equal(whiteFor('zufall', () => 0.7), 1);
  assert.equal(whiteFor(undefined, () => 0.7), 1); // unbekannter Wert = Zufall
  const seen = new Set(Array.from({ length: 200 }, () => whiteFor('zufall')));
  assert.deepEqual([...seen].sort(), [0, 1]);
});

test('Revanche tauscht auch nach gewählter Farbe, „Ohne Hilfen“ bleibt', () => {
  for (const color of ['w', 'b']) {
    const first = newGame(whiteFor(color), { free: true });
    const next = again(resign(first, 0));
    assert.equal(colorOf(next, 0), color === 'w' ? 'b' : 'w');
    assert.equal(next.free, true);
    assert.equal(colorOf(again(resign(next, 1)), 0), color); // zweite Revanche: wieder die gewählte Farbe
  }
});
