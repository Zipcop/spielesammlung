// Zehntausend: Würfeln mit echter Physik (src/zehntausend/board.js, ohne Browser). Prüft: alle Würfel landen flach in
// der Arena, herausgelegte bleiben liegen, der Mitspieler sieht den Wurf – und die Würfe sind fair (Chi-Quadrat wie
// test/kniffel-wurf.test.js; bei Kniffel lief ein einzelner Würfel mit fester Startlage fast vorherbestimmt).
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
const { createZehntausendBoard } = await import('../src/zehntausend/board.js');

const DT = 1 / 60;
const ALL = Array(6).fill(true);
const ONE = [true, false, false, false, false, false]; // fünf herausgelegt, einer fällt

function setup() {
  const streamed = [];
  const group = new THREE.Group();
  const board = createZehntausendBoard(group, { onStream: (m) => streamed.push(m) });
  return { board, streamed, dice: board.group.children.filter((c) => c.geometry?.parameters?.width === 2.2) };
}

// mode: 'auto' = Würfeln-Knopf · 'cup' = Becher packen, kurz halten, loslassen · 'hand' = Handvoll an Würfel 0
async function throwOnce(board, thrown, seat, mode) {
  let result = null;
  const p = (mode === 'auto' ? board.roll(thrown, seat) : mode === 'cup' ? board.grab(thrown, seat) : board.grabHand(thrown, seat, 0)).then((v) => (result = v));
  await board.ready();
  for (let k = 0; k < 5; k++) await null;
  if (mode !== 'auto') {
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

test('Wurf mit allen sechs: gültige Zahlen, alle flach in der Arena, der andere PC bekommt den Wurf', async () => {
  const { board, streamed, dice } = setup();
  for (const seat of [0, 1, 2, 3]) {
    const values = await throwOnce(board, ALL, seat, 'auto');
    assert.equal(values.length, 6);
    assert.ok(values.every((v) => v >= 1 && v <= 6));
    for (const d of dice) {
      assert.ok(Math.hypot(d.position.x, d.position.z) < 20, `außerhalb: ${d.position.toArray()}`);
      assert.ok(Math.abs(d.position.y - (0.8 + 1.1)) < 0.05, `nicht flach: ${d.position.y}`);
    }
  }
  assert.ok(streamed.length > 10);
  assert.equal(streamed.at(-1).final, true);
  assert.equal(streamed.at(-1).p.length, 42);
  assert.equal(board.busy(), false);
});

test('Herausgelegte Würfel bleiben liegen, nur die freien fallen neu', async () => {
  const { board, dice } = setup();
  await throwOnce(board, ALL, 0, 'auto');
  const before = dice.map((d) => d.position.clone());
  const values = await throwOnce(board, ONE, 0, 'hand');
  assert.ok(values[0] >= 1 && values[0] <= 6);
  for (let i = 1; i < 6; i++) assert.ok(dice[i].position.distanceTo(before[i]) < 1e-6, `Würfel ${i} hat sich bewegt`);
});

// Je Art und Sitz: ein einzelner Würfel ist am anfälligsten für feste Wege
for (const [name, mode, seat] of [['Würfeln-Knopf', 'auto', 0], ['Würfeln-Knopf', 'auto', 3], ['Becher von Hand', 'cup', 2], ['Handvoll', 'hand', 1]]) {
  test(`${name} mit 1 freien Würfel ist fair (Sitz ${seat}): 900 Würfe (Chi-Quadrat)`, async () => {
    const { board } = setup();
    const counts = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 900; n++) counts[(await throwOnce(board, ONE, seat, mode))[0] - 1]++;
    const chi = chiSquare(counts);
    // 5 Freiheitsgrade: über 20,5 nur mit 0,1 % Wahrscheinlichkeit, wenn der Wurf fair ist
    assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
  });
}

test('Alle sechs aus dem Becher sind fair: 300 Würfe = 1800 Würfel (Chi-Quadrat)', async () => {
  const { board } = setup();
  const counts = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 300; n++) for (const v of await throwOnce(board, ALL, n % 4, 'auto')) counts[v - 1]++;
  const chi = chiSquare(counts);
  assert.ok(chi < 20.5, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
});

test('Ablage: nach einem Anschluss liegen alle herausgelegten Würfel auf dem Brettchen (nicht daneben)', async () => {
  const g = await import('../src/zehntausend/game.js');
  const { board, dice } = setup();
  let s = g.setup(g.newGame(), 0, 2, Math.random, 0);
  const pick = (x, idx) => idx.reduce((y, i) => g.toggle(y, 0, i), x);
  s = g.roll(s, 0, [1, 5, 2, 2, 2, 3]);
  s = g.roll(pick(s, [0, 1, 2, 3, 4]), 0, [1, 5, 2, 2, 2, 5]);
  s = g.roll(pick(s, [5]), 0, [1, 1, 5, 4, 6, 3]); // Anschluss: alle sechs neu
  s = g.roll(pick(s, [0, 1, 2]), 0, [1, 1, 5, 1, 5, 5]);
  s = g.bank(pick(s, [3, 4, 5]), 0);
  assert.deepEqual(s.where, Array(6).fill('aside'));
  board.sync(s, 0);
  for (let k = 0; k < 60; k++) board.update(DT);
  for (const d of dice) {
    assert.ok(Math.abs(d.position.z - 29) < 0.5 && Math.abs(d.position.x) < 11.5, `nicht auf der Ablage: ${d.position.toArray().map((n) => n.toFixed(1))}`);
  }
});
