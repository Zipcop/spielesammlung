// Kniffel: Würfeln-Knopf (Becher schüttelt von selbst) und Becher nur anklicken mit 1 freien Würfel (src/kniffel/board.js
// mit echter Physik, ohne Browser). Ein einzelner Würfel auf festem Schüttelweg lief fast vorherbestimmt – die 3 kam nur
// bei ~11 % der Würfe (Prüfung 19.10.2026). Mit 5 Würfeln fiel das nicht auf, die Stöße untereinander mischen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('../test-stubs/spiel-hooks.mjs', import.meta.url);
const { createBoard } = await import('../src/kniffel/board.js');

const DT = 1 / 60;
const HELD = [false, true, true, true, true]; // 4 behalten, 1 neu würfeln – der typische Zug auf der Kniffel-Jagd

// cup = Becher packen und ohne Mausbewegung loslassen, sonst Würfeln-Knopf
async function throwOne(board, player, cup) {
  let result = null;
  (cup ? board.grab(HELD, player) : board.roll(HELD, player)).then((v) => (result = v));
  await board.ready();
  for (let k = 0; k < 5; k++) await null;
  if (cup) {
    for (let t = 0; t < 0.5 + Math.random(); t += DT) {
      board.update(DT);
      await null;
    }
    board.release();
  }
  for (let k = 0; k < 60 * 20 && !result; k++) {
    board.update(DT);
    await null;
  }
  return result[0];
}

function chiSquare(counts) {
  const expected = counts.reduce((a, b) => a + b, 0) / 6;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
}

// Je Spieler getrennt: Host und Gast schütteln spiegelverkehrt, ihre Abweichungen heben sich gemischt teilweise auf
for (const [name, cup] of [['Würfeln-Knopf', false], ['Becher anklicken', true]]) {
  for (const player of [0, 1]) {
    test(`${name} mit 1 freien Würfel ist fair (Spieler ${player}): 1200 Würfe (Chi-Quadrat)`, async () => {
      const board = createBoard(new THREE.Group(), { onStream: () => {} });
      const counts = [0, 0, 0, 0, 0, 0];
      for (let n = 0; n < 1200; n++) counts[(await throwOne(board, player, cup)) - 1]++;
      const chi = chiSquare(counts);
      // 5 Freiheitsgrade: über 20,5 nur mit 0,1 % Wahrscheinlichkeit, wenn der Wurf fair ist
      assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
    });
  }
}
