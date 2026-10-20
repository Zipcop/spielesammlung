// Gespeicherte Partien (src/saves.js): je Spiel die letzte Partie, kaputter Speicher schadet nicht,
// und jeder Spielstand übersteht den Weg durch localStorage (JSON) unverändert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSaves, storeSave, savedAt } from '../src/saves.js';
import * as kniffel from '../src/kniffel/game.js';
import * as schach from '../src/schach/game.js';
import * as maumau from '../src/maumau/game.js';
import * as romme from '../src/romme/game.js';
import * as billard from '../src/billard/rules.js';
import * as maedn from '../src/maedn/rules.js';

function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
}

test('Speichern und Laden: je Spiel die letzte Partie', () => {
  const store = memory();
  assert.deepEqual(loadSaves(store), {});
  storeSave('Schach', { fen: 'a', moves: [] }, store, 1000);
  storeSave('Kniffel', { round: 3 }, store, 2000);
  storeSave('Schach', { fen: 'b', moves: ['e2e4'] }, store, 3000); // neuer Zug ersetzt den alten Stand
  assert.deepEqual(loadSaves(store), {
    Schach: { state: { fen: 'b', moves: ['e2e4'] }, at: 3000 },
    Kniffel: { state: { round: 3 }, at: 2000 },
  });
});

test('Kaputter oder fremder Speicher: leer statt Absturz', () => {
  for (const bad of ['{kaputt', 'null', '42', '"text"', '[]']) {
    const store = memory();
    store.setItem('spielesammlung-spielstaende', bad);
    assert.deepEqual(loadSaves(store), {}, bad);
  }
  const store = memory();
  store.setItem('spielesammlung-spielstaende', JSON.stringify({ Schach: { state: null, at: 1 }, Kniffel: { at: 2 }, Billard: { state: {}, at: 'gestern' }, Rommé: { state: {}, at: 5 } }));
  assert.deepEqual(loadSaves(store), { Rommé: { state: {}, at: 5 } });
  const throwing = { getItem: () => { throw new Error('gesperrt'); }, setItem: () => { throw new Error('voll'); } };
  assert.deepEqual(loadSaves(throwing), {});
  storeSave('Schach', {}, throwing); // wirft nicht
});

test('Zeitpunkt für den Knopf', () => {
  const text = savedAt(new Date(2026, 9, 20, 21, 14).getTime());
  assert.match(text, /20\.10\./);
  assert.match(text, /21:14/);
});

// Die Spiele bekommen beim Fortsetzen genau das zurück, was sie gespeichert haben
const roundTrip = (s) => JSON.parse(JSON.stringify(s));
const STARTS = {
  Kniffel: () => kniffel.newGame(0, { free: true }),
  Schach: () => schach.move(schach.newGame(0, {}), schach.colorOf(schach.newGame(0, {}), 0) === 'w' ? 0 : 1, 'e2e4'),
  'Mau-Mau': () => maumau.newGame(1, Math.random, { free: true }),
  Rommé: () => romme.newGame(0, Math.random, { free: false }),
  Billard: () => billard.newGame({ breaker: 1 }),
  'Mensch ärgere dich nicht': () => maedn.newPick({ players: 2, starter: 2, free: true }),
};

test('Jeder Spielstand übersteht das Speichern (JSON) unverändert', () => {
  for (const [name, start] of Object.entries(STARTS)) {
    const state = start();
    assert.ok(state, name);
    const store = memory();
    storeSave(name, state, store);
    assert.deepEqual(loadSaves(store)[name].state, roundTrip(state), name);
    assert.deepEqual(roundTrip(state), state, `${name}: Stand enthält etwas, das JSON nicht kann`);
  }
});
