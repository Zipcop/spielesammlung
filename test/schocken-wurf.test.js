// Schocken: Würfeln unter dem Becher mit echter Physik (src/schocken/board.js, ohne Browser). Prüft: gültige Zahlen,
// die Würfel liegen flach unter dem Becher, herausgelegte bleiben liegen, gestreamt wird nur der Becher – und die
// Würfe sind fair (Chi-Quadrat wie test/kniffel-wurf.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

// Texturen (Canvas), Ton und Leuchten gibt es ohne Browser nicht – Stellvertreter aus test-stubs/
const stubs = new URL('../test-stubs/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
const STUBS = { 'textures.js': 'stub-textures.js', 'sound.js': 'stub-sound.js', 'glow.js': 'stub-glow.js' };
export async function resolve(spec, context, next) {
  const name = spec.split('/').pop();
  const mine = /\\/src\\/(zehntausend|schocken)\\/|\\/src\\/wuerfel\\.js$/.test(context.parentURL ?? '');
  if (mine && STUBS[name] && spec.startsWith('.')) return { url: '${stubs}' + STUBS[name], shortCircuit: true };
  return next(spec, context);
}`)}`);
const { createSchockenBoard } = await import('../src/schocken/board.js');

const DT = 1 / 60;
const NONE = [false, false, false];
const TWO_OUT = [true, true, false];
const INSIDE = 4.4 - 0.45 - 1.0;

function setup() {
  const streamed = [];
  const board = createSchockenBoard(new THREE.Group(), { onStream: (m) => streamed.push(m) });
  // die Würfel je Platz: Kinder der Platz-Gruppe mit 2-cm-Würfelgeometrie
  const diceOf = (seat) => board.group.children.filter((c) => c.isGroup)[seat].children.filter((c) => c.geometry?.parameters?.width === 2);
  return { board, streamed, diceOf };
}

async function throwOnce(board, seat, out, hand) {
  let result = null;
  const p = (hand ? board.grab(seat, out) : board.roll(seat, out)).then((v) => (result = v));
  await board.ready();
  for (let k = 0; k < 5; k++) await null;
  if (hand) {
    for (let t = 0; t < 0.6 + Math.random() * 0.6; t += DT) {
      board.update(DT);
      await null;
    }
    board.release();
  }
  for (let k = 0; k < 60 * 20 && !result; k++) {
    board.update(DT);
    await null;
  }
  await p;
  return result;
}

const chiSquare = (counts) => {
  const e = counts.reduce((a, b) => a + b, 0) / 6;
  return counts.reduce((sum, c) => sum + (c - e) ** 2 / e, 0);
};

test('Wurf unter dem Becher: gültige Zahlen, flach unter dem Becher, gestreamt wird nur der Becher', async () => {
  const { board, streamed, diceOf } = setup();
  for (const seat of [0, 1, 2, 3]) {
    const values = await throwOnce(board, seat, NONE, seat % 2 === 1);
    assert.equal(values.length, 3);
    assert.ok(values.every((v) => v >= 1 && v <= 6));
    for (const d of diceOf(seat)) {
      assert.ok(Math.hypot(d.position.x, d.position.z) <= INSIDE + 0.01, `nicht unter dem Becher: ${d.position.toArray()}`);
      assert.ok(Math.abs(d.position.y - (0.25 + 1)) < 0.02, `nicht flach: ${d.position.y}`);
    }
  }
  assert.ok(streamed.some((m) => Number.isInteger(m.start)));
  assert.ok(streamed.every((m) => !m.p && !m.dice), 'keine Würfellagen im Netz');
  assert.equal(streamed.at(-1).final, true);
  assert.equal(board.busy(), false);
});

test('Herausgelegte Würfel bleiben liegen und behalten ihre Zahl', async () => {
  const { board, diceOf } = setup();
  const first = await throwOnce(board, 0, NONE, false);
  const before = diceOf(0).map((d) => d.position.clone());
  const second = await throwOnce(board, 0, TWO_OUT, false);
  assert.deepEqual(second.slice(0, 2), first.slice(0, 2));
  for (const k of [0, 1]) assert.ok(diceOf(0)[k].position.distanceTo(before[k]) < 1e-6);
});

for (const [name, hand, seat] of [['Würfeln-Knopf', false, 0], ['Würfeln-Knopf', false, 3], ['Becher von Hand', true, 2]]) {
  test(`${name} mit 1 freien Würfel ist fair (Sitz ${seat}): 900 Würfe (Chi-Quadrat)`, async () => {
    const { board } = setup();
    const counts = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 900; n++) counts[(await throwOnce(board, seat, TWO_OUT, hand))[2] - 1]++;
    const chi = chiSquare(counts);
    // 5 Freiheitsgrade: über 20,5 nur mit 0,1 % Wahrscheinlichkeit, wenn der Wurf fair ist
    assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
  });
}

test('Alle drei unter dem Becher sind fair: 500 Würfe = 1500 Würfel (Chi-Quadrat)', async () => {
  const { board } = setup();
  const counts = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 500; n++) for (const v of await throwOnce(board, n % 4, NONE, false)) counts[v - 1]++;
  const chi = chiSquare(counts);
  assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
});
