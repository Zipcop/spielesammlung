// Kniffel: Würfel als Handvoll packen, schütteln, werfen (src/kniffel/board.js mit echter Physik, ohne Browser).
// Prüft: gültige Augenzahlen, alle Würfel liegen flach in der Schale, behaltene bleiben liegen, der Mitspieler
// bekommt den Wurf gestreamt – und die Handvoll ist fair (jede Augenzahl gleich oft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('../test-stubs/spiel-hooks.mjs', import.meta.url);
const { createBoard } = await import('../src/kniffel/board.js');

const TRAY = { w: 32, d: 22 }; // Innenmaß der Schale in cm (wie in board.js)
const FLOOR = 0.8;
const DIE = 2.4;
const DT = 1 / 60;

function setup() {
  const streamed = [];
  const board = createBoard(new THREE.Group(), { onStream: (m) => streamed.push(m) });
  return { board, streamed };
}

// Mausstrahl senkrecht von oben auf einen Punkt über der Schale (cm, Brett-Koordinaten)
function rayAt(board, x, z) {
  board.group.updateWorldMatrix(true, false);
  const p = board.group.localToWorld(new THREE.Vector3(x, 0, z));
  return new THREE.Raycaster(new THREE.Vector3(p.x, p.y + 2, p.z), new THREE.Vector3(0, -1, 0));
}

// Handvoll bei Würfel from packen, kreisend schütteln, loslassen; liefert die Augenzahlen
async function handThrow(board, held, from = held.indexOf(false)) {
  let result = null;
  board.grabHand(held, 0, from).then((v) => (result = v));
  await board.ready();
  for (let k = 0; k < 5; k++) await null; // Wurf beginnt nach dem Laden
  for (let t = 0; t < 0.9; t += DT) {
    const a = t * 17;
    board.dragCup(rayAt(board, 5 * Math.sin(a), 3 * Math.cos(a * 1.3)));
    board.update(DT);
    await null;
  }
  board.release();
  for (let k = 0; k < 60 * 12 && !result; k++) {
    board.update(DT);
    await null;
  }
  return result;
}

const flatInTray = (d) => Math.abs(d.position.x) < TRAY.w / 2 && Math.abs(d.position.z) < TRAY.d / 2 && Math.abs(d.position.y - (FLOOR + DIE / 2)) < 0.3;

test('Handvoll: alle freien Würfel fliegen in die Schale, liegen flach, Augenzahlen gültig, Mitspieler sieht den Wurf', async () => {
  const { board, streamed } = setup();
  const dice = board.loose().slice(0, 5);
  const values = await handThrow(board, [false, false, false, false, false]);
  assert.equal(values.length, 5);
  assert.ok(values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6), JSON.stringify(values));
  assert.ok(dice.every(flatInTray), dice.map((d) => d.position.toArray().map((n) => n.toFixed(1)).join(',')).join(' | '));
  assert.ok(streamed.length > 10, 'Lagen werden gestreamt');
  assert.equal(streamed.at(-1).final, true);
});

test('Handvoll: behaltene Würfel bleiben, wo sie sind', async () => {
  const { board } = setup();
  const dice = board.loose().slice(0, 5);
  const held = [true, false, true, false, false];
  const before = dice.map((d) => d.position.clone());
  const values = await handThrow(board, held);
  assert.equal(values.length, 5);
  for (const i of [0, 2]) assert.ok(dice[i].position.distanceTo(before[i]) < 1e-6, `Würfel ${i} liegt still`);
});

test('Handvoll ist fair: 250 Würfe, jede Augenzahl etwa gleich oft (Chi-Quadrat)', async () => {
  const { board } = setup();
  const counts = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 250; n++) {
    const values = await handThrow(board, [false, false, false, false, false]);
    for (const v of values) counts[v - 1]++;
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / 6;
  const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  // 5 Freiheitsgrade: über 27 nur mit 0,006 % Wahrscheinlichkeit, wenn der Wurf fair ist (s. test/zehntausend-wurf.test.js)
  assert.ok(chi < 27, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
});
