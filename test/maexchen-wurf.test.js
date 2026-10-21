// Mäxchen: Würfeln unter dem Becher mit echter Physik (src/maexchen/board.js, ohne Browser) – sind die Würfe fair?
// Mit zufälligen Euler-Winkeln als Startlage kamen von Hand die 3 und die 4 nur bei je ~12 % (Messung 21.10.2026,
// 6000 Würfe je Sitz); Chi-Quadrat wie test/zehntausend-wurf.test.js.
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
  const mine = /\\/src\\/maexchen\\/|\\/src\\/wuerfel\\.js$/.test(context.parentURL ?? '');
  if (mine && STUBS[name] && spec.startsWith('.')) return { url: '${stubs}' + STUBS[name], shortCircuit: true };
  return next(spec, context);
}`)}`);
const { createMaexchenBoard } = await import('../src/maexchen/board.js');

const DT = 1 / 60;

// hand = Becher packen, kurz halten, loslassen (knallen) · sonst Würfeln-Knopf
async function throwOnce(board, seat, hand) {
  let result = null;
  const p = (hand ? board.grab(seat) : board.roll(seat)).then((v) => (result = v));
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

// Von Hand (kaum Schwung) ist am empfindlichsten: die alte Schieflage fällt hier mit 900 Würfen sicher auf (Chi-Quadrat
// im Mittel ~85 statt < 27); der Würfeln-Knopf war auch vorher fair und bleibt als Absicherung.
for (const [name, hand, seat] of [['Becher von Hand', true, 0], ['Würfeln-Knopf', false, 2]]) {
  test(`${name} ist fair (Sitz ${seat}): 900 Würfe = 1800 Würfel (Chi-Quadrat)`, async () => {
    const board = createMaexchenBoard(new THREE.Group());
    const counts = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < 900; n++) {
      const values = await throwOnce(board, seat, hand);
      assert.equal(values.length, 2);
      for (const v of values) counts[v - 1]++;
    }
    const chi = chiSquare(counts);
    // 5 Freiheitsgrade: über 27 nur mit 0,006 % Wahrscheinlichkeit, wenn der Wurf fair ist
    assert.ok(chi < 27, `Chi-Quadrat ${chi.toFixed(1)} bei ${JSON.stringify(counts)}`);
  });
}
