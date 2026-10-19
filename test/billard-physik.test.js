// Billard-Physik ohne Browser: Anstoß verteilt die Kugeln, gerader Stoß in die Ecke wird gefangen,
// Kugel an der Bande entlang fällt nicht in die Mitteltasche, alles bleibt auf dem Tisch und kommt zur Ruhe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics } from '../src/billard/physics.js';
import { rack, TABLE, R } from '../src/billard/rules.js';

await RAPIER.init();
const onTable = ([x, z]) => Math.abs(x) <= TABLE.L / 2 && Math.abs(z) <= TABLE.W / 2;

test('Anstoß mit voller Kraft: Dreieck geht auseinander, alles liegt nach einigen Sekunden still', () => {
  const physics = createPhysics(RAPIER);
  const start = rack(() => 0.42);
  const out = physics.simulate(start, 0, 0.95);
  assert.ok(out.first !== null, 'die Weiße trifft das Dreieck');
  const moved = Object.entries(out.positions).filter(([n, p]) => Number(n) !== 0 && Math.hypot(p[0] - start[n][0], p[1] - start[n][1]) > 0.15);
  assert.ok(moved.length + out.pocketed.length >= 8, `nur ${moved.length} Kugeln weit bewegt, ${out.pocketed.length} versenkt`);
  for (const p of Object.values(out.positions)) assert.ok(onTable(p));
  assert.ok(out.seconds < 20, `zu lange gerollt: ${out.seconds} s`);
});

test('Gerader Stoß auf eine Kugel vor der Ecktasche: Kugel fällt, Weiße bleibt liegen', () => {
  const physics = createPhysics(RAPIER);
  const corner = [TABLE.L / 2, TABLE.W / 2];
  const dir = [corner[0] - 0.3, corner[1] - 0.15];
  const len = Math.hypot(...dir);
  const ball = [0.3 + (dir[0] / len) * 0.35, 0.15 + (dir[1] / len) * 0.35];
  const cue = [0.3 - (dir[0] / len) * 0.3, 0.15 - (dir[1] / len) * 0.3];
  const angle = Math.atan2(-dir[1], dir[0]);
  const out = physics.simulate({ 0: cue, 5: ball }, angle, 0.45);
  assert.equal(out.first, 5);
  assert.deepEqual(out.pocketed, [5]);
  assert.ok(out.positions[0]);
});

test('Kugel rollt an der Bande entlang an der Mitteltasche vorbei – sie fällt nicht hinein', () => {
  const physics = createPhysics(RAPIER);
  const z = TABLE.W / 2 - R - 0.002;
  const out = physics.simulate({ 0: [-0.5, z] }, 0, 0.18); // rollt über die Mitteltasche hinaus, aber nicht bis zur Ecke
  assert.deepEqual(out.pocketed, [], 'Weiße fiel in eine Tasche');
  assert.ok(out.positions[0][0] > 0.1, `blieb vor der Mitteltasche liegen: x = ${out.positions[0][0]}`);
});

test('Weiße direkt in die Mitteltasche: wird gefangen (Foul-Erkennung)', () => {
  const physics = createPhysics(RAPIER);
  const out = physics.simulate({ 0: [0, 0] }, -Math.PI / 2, 0.4); // −90° = Richtung +z
  assert.deepEqual(out.pocketed, [0]);
  assert.equal(out.first, null);
});

test('Bande wird erkannt: Kugel nach dem Treffen an die Bande', () => {
  const physics = createPhysics(RAPIER);
  const out = physics.simulate({ 0: [-0.5, 0], 3: [-0.2, 0] }, 0, 0.6);
  assert.equal(out.first, 3);
  assert.equal(out.rail, true);
});

test('Knapp vorbei ist nicht getroffen: Weiße rollt 5 mm an einer Kugel vorbei', () => {
  const physics = createPhysics(RAPIER);
  const out = physics.simulate({ 0: [-0.6, 0], 9: [-0.2, 2 * R + 0.005] }, 0, 0.4);
  assert.notEqual(out.first, 9);
  assert.ok(Math.abs(out.positions[9][0] + 0.2) < 1e-3 && Math.abs(out.positions[9][1] - (2 * R + 0.005)) < 1e-3, 'Kugel 9 wurde bewegt');
});

test('Knapp neben der Bande ist keine Bande: Kugel rollt 12 mm daneben aus', () => {
  const physics = createPhysics(RAPIER);
  const z = TABLE.W / 2 - R - 0.012;
  const out = physics.simulate({ 0: [-0.7, z], 3: [-0.55, z] }, 0, 0.12);
  assert.equal(out.first, 3);
  assert.equal(out.rail, false);
  assert.deepEqual(out.pocketed, []);
});
