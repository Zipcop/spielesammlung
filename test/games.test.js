// Spieleschrank (src/games.js): jede Schachtel einmal, jedes spielbare Spiel steht im Schrank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHELF, PLAYABLE } from '../src/games.js';

test('Jedes Spiel steht genau einmal im Schrank', () => {
  const all = SHELF.flatMap((c) => c.games);
  assert.equal(new Set(all).size, all.length, 'doppelter Name');
});

test('Jedes spielbare Spiel hat eine Schachtel', () => {
  const all = new Set(SHELF.flatMap((c) => c.games));
  for (const name of PLAYABLE.keys()) assert.ok(all.has(name), `Schachtel fehlt: ${name}`);
});
