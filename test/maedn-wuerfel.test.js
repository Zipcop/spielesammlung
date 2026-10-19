// Mensch ärgere Dich nicht: Würfel mit der Hand packen, schütteln, werfen (src/maedn/dice.js mit echter Physik, ohne
// Browser). Prüft: gültige Augenzahl, Würfel liegt flach im Teller, langes Halten wird nicht in der Luft ausgewertet,
// Loslassen vor dem Laden geht, der Mitspieler sieht den Wurf – und der Wurf aus der Hand ist fair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('../test-stubs/spiel-hooks.mjs', import.meta.url);
const { createDice } = await import('../src/maedn/dice.js');

const R_IN = 9; // Innenradius des Tellers (wie in dice.js)
const FLOOR = 0.6;
const DIE = 1.8;
const DT = 1 / 60;

function setup() {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  const streamed = [];
  const dice = createDice(group, new THREE.Vector3(34.5, 0, 0), { onStream: (m) => streamed.push(m) });
  const die = dice.tray.children.find((c) => c.geometry?.type === 'RoundedBoxGeometry' || c.geometry?.parameters?.width === DIE) ?? dice.tray.children.at(-1);
  return { dice, die, streamed };
}

// Mausstrahl senkrecht von oben auf einen Punkt über dem Teller (cm, Teller-Koordinaten)
function rayAt(dice, x, z) {
  dice.tray.updateWorldMatrix(true, false);
  const p = dice.tray.localToWorld(new THREE.Vector3(x, 0, z));
  return new THREE.Raycaster(new THREE.Vector3(p.x, p.y + 2, p.z), new THREE.Vector3(0, -1, 0));
}

async function handThrow(dice, { hold = 0.8, earlyRelease = false } = {}) {
  let result = null;
  const promise = dice.grab(0).then((v) => (result = v));
  if (earlyRelease) dice.release(); // losgelassen, bevor die Physik geladen ist
  await dice.ready();
  for (let k = 0; k < 5; k++) await null;
  for (let t = 0; !earlyRelease && t < hold; t += DT) {
    dice.drag(rayAt(dice, 4 * Math.sin(t * 15), 3 * Math.cos(t * 11)));
    dice.update(DT);
    await null;
  }
  dice.release();
  for (let k = 0; k < 60 * 15 && result === null; k++) {
    dice.update(DT);
    await null;
  }
  await promise;
  return result;
}

const flatInTray = (die) => Math.hypot(die.position.x, die.position.z) < R_IN && Math.abs(die.position.y - (FLOOR + DIE / 2)) < 0.25;

test('Würfel aus der Hand: landet flach im Teller, gültige Augenzahl, Mitspieler sieht den Wurf', async () => {
  const { dice, die, streamed } = setup();
  const value = await handThrow(dice);
  assert.ok(Number.isInteger(value) && value >= 1 && value <= 6, String(value));
  assert.ok(flatInTray(die), die.position.toArray().map((n) => n.toFixed(2)).join(','));
  assert.ok(streamed.length > 5);
  assert.equal(streamed.at(-1).final, true);
  assert.equal(dice.busy(), false);
});

test('Lange gehalten (12 s): wird erst nach dem Loslassen ausgewertet, nicht in der Luft', async () => {
  const { dice, die } = setup();
  const value = await handThrow(dice, { hold: 12 });
  assert.ok(value >= 1 && value <= 6);
  assert.ok(flatInTray(die), die.position.toArray().map((n) => n.toFixed(2)).join(','));
});

test('Losgelassen, bevor die Physik geladen ist: der Wurf läuft trotzdem durch', async () => {
  const { dice } = setup();
  const value = await handThrow(dice, { earlyRelease: true });
  assert.ok(value >= 1 && value <= 6);
});

test('Wurf aus der Hand ist fair: 600 Würfe, jede Augenzahl etwa gleich oft (Chi-Quadrat)', async () => {
  const { dice } = setup();
  const counts = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 600; n++) counts[(await handThrow(dice, { hold: 0.2 + (n % 5) * 0.2 })) - 1]++;
  const expected = 600 / 6;
  const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  // 5 Freiheitsgrade: über 20,5 nur mit 0,1 % Wahrscheinlichkeit, wenn der Wurf fair ist
  assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
});
