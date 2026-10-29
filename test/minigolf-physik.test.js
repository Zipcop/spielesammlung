// Minigolf-Physik ohne Browser (src/minigolf/physics.js, Rapier): Ball rollt aus und bleibt liegen, Bande wirft zurück,
// langsam ins Loch = drin, zu schnell = Lip-out, vom Steg ins Wasser = draußen, Mühle dreht, und der Computer spielt
// ganze Partien bis zum Ende (alle Stufen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics, teePos, speedOf, MAX_SPEED } from '../src/minigolf/physics.js';
import { COURSE, FLOOR, R, MILL_PERIOD, inLane, toGo } from '../src/minigolf/course.js';
import { newGame, applyShot, applyClaim, ballOf, total, MAX_SCORE } from '../src/minigolf/rules.js';
import { chooseShot, cheatSpot, LEVELS } from '../src/minigolf/ai.js';

await RAPIER.init();
const physics = createPhysics(RAPIER);
const angleTo = ([px, , pz], [tx, tz]) => Math.atan2(-(tz - pz), tx - px);
let seed = 12345;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('Kraft: gleichmäßig bis zur Höchstgeschwindigkeit, ein schwacher Schlag rollt kurz und bleibt auf der Bahn liegen', () => {
  assert.equal(speedOf(1), MAX_SPEED);
  assert.ok(Math.abs(speedOf(0.5) - MAX_SPEED / 2) < 1e-9);
  const hole = COURSE[1];
  const pos = teePos(1);
  const r = physics.simulate(1, pos, angleTo(pos, hole.path[1]), 0.2);
  assert.equal(r.holed, false);
  assert.equal(r.out, false);
  const moved = Math.hypot(r.pos[0] - pos[0], r.pos[2] - pos[2]);
  assert.ok(moved > 0.5 && moved < 2.5, `rollte ${moved} m`);
  assert.ok(inLane(hole, [r.pos[0], r.pos[2]]));
  assert.ok(Math.abs(r.pos[1] - (FLOOR + R)) < 0.005, 'liegt auf der Platte');
  assert.ok(r.seconds < 6);
});

test('Bande wirft zurück: Schlag nach hinten gegen die Stirnseite prallt ab und bleibt auf der Bahn', () => {
  const hole = COURSE[0];
  const pos = teePos(0);
  const trace = [];
  const r = physics.simulate(0, pos, angleTo(pos, [hole.tee[0] - hole.dir[0], hole.tee[2] - hole.dir[1]]), 0.5, 0, trace); // nach hinten
  assert.equal(r.out, false);
  const along = (p) => (p[0] - pos[0]) * hole.dir[0] + (p[2] - pos[2]) * hole.dir[1];
  assert.ok(Math.min(...trace.map(along)) > -0.62, 'nicht durch die Bande');
  assert.ok(along(r.pos) > Math.min(...trace.map(along)) + 0.15, 'prallt nach vorn zurück');
  assert.ok(inLane(hole, [r.pos[0], r.pos[2]]));
});

test('Loch: langsam darüber = drin, zu schnell = drüber weg (Lip-out oder gestreift)', () => {
  const hole = COURSE[0];
  const [cx, , cz] = hole.cup;
  const start = [cx - hole.dir[0] * 0.6, FLOOR + R, cz - hole.dir[1] * 0.6];
  const a = angleTo(start, [cx, cz]);
  const slow = physics.simulate(0, start, a, 0.2);
  assert.equal(slow.holed, true, 'langsam ins Loch');
  const fast = physics.simulate(0, start, a, 0.7);
  assert.equal(fast.holed, false, 'zu schnell fällt nicht');
  // 3,5 cm neben der Mitte: schnell = Lip-out (abgelenkt), langsam = drin
  const side = [start[0] + hole.side[0] * 0.035, start[1], start[2] + hole.side[1] * 0.035];
  const edge = physics.simulate(0, side, a, 0.5);
  assert.equal(edge.holed, false);
  assert.equal(edge.lips, 1, 'am Rand abgelenkt');
  assert.equal(physics.simulate(0, side, a, 0.25).holed, true, 'langsamer fällt er auch am Rand');
});

test('Brücke: neben den Steg = ins Wasser = draußen, Ball kommt an die Schlagstelle zurück', () => {
  const hole = COURSE[6];
  const pos = [...hole.frame.point(2.2, 0.4)];
  pos[1] = FLOOR + R;
  const r = physics.simulate(6, pos, angleTo(pos, [hole.frame.point(5, 0.4)[0], hole.frame.point(5, 0.4)[2]]), 0.45);
  assert.equal(r.out, true);
  assert.deepEqual(r.pos, pos);
});

test('Mühle: die Flügel drehen und halten den Ball je nach Moment auf', () => {
  const hole = COURSE[5];
  const pos = teePos(5);
  const goal = [hole.cup[0], hole.cup[2]];
  const results = [];
  for (let k = 0; k < 8; k++) results.push(physics.simulate(5, pos, angleTo(pos, goal), 0.62, (k / 8) * MILL_PERIOD));
  const far = results.map((r) => (r.holed ? 0 : toGo(hole, [r.pos[0], r.pos[2]])));
  assert.ok(Math.max(...far) - Math.min(...far) > 1, `Flügel ändern nichts: ${far.map((d) => d.toFixed(2))}`);
});

test('Ball rollt langsam gegen den Tunnel-Riegel und bleibt davor liegen: der Schlag zählt (Meldung gültig)', () => {
  const from = [3.535, 0.1205, -5.7]; // Fall aus der Prüfung: Ruhelage z = −6,1802, Riegel ab −6,2
  const r = physics.simulate(4, from, angleTo(from, [3.425, -6.6]), 0.1826);
  assert.equal(r.holed || r.out, false);
  const s = { ...newGame({ starter: 0 }), hole: 4, ball: from };
  assert.ok(applyShot(s, 0, r), `abgelehnt: ${JSON.stringify(r.pos)}`);
  // langsam auf beide Riegel und die Engstellen-Keile zu: jede Ruhelage gilt
  for (const n of [0, 4]) {
    const hole = COURSE[n];
    for (const v of [-0.45, -0.3, 0.3, 0.45]) {
      for (const d of [3.3, 3.6, 3.9]) {
        const start = [...hole.frame.point(0, v)];
        start[1] = FLOOR + R;
        const res = physics.simulate(n, start, Math.atan2(-hole.dir[1], hole.dir[0]), Math.sqrt(2 * 0.42 * d) / 4.2);
        assert.ok(res.holed || res.out || inLane(hole, [res.pos[0], res.pos[2]]), `${hole.name} v=${v} d=${d}: ${res.pos}`);
      }
    }
  }
});

test('Bergauf: zu schwach rollt die Rampe wieder hinunter', () => {
  const hole = COURSE[3];
  const pos = teePos(3);
  const r = physics.simulate(3, pos, angleTo(pos, [hole.cup[0], hole.cup[2]]), 0.5);
  assert.ok(r.pos[1] < FLOOR + R + 0.01, 'liegt wieder unten');
});

test('Computer schummelt beim Verlegen nur auf die Bahnfläche', () => {
  for (const hole of COURSE) {
    const s = { ...newGame({ free: true }), hole: hole.n };
    const spot = cheatSpot(physics, s, () => 0.5);
    if (!spot) continue;
    assert.ok(inLane(hole, [spot[0], spot[2]]), hole.name);
    assert.ok(toGo(hole, [spot[0], spot[2]]) < toGo(hole, [hole.tee[0], hole.tee[2]]), `${hole.name}: näher am Loch`);
  }
});

// Ganze Partie Computer gegen Computer bis zum Ende
function match(levels, free = false) {
  let s = newGame({ starter: 0, free });
  let shots = 0;
  while (!s.result) {
    const p = s.turn;
    if (s.phase === 'claim') {
      s = applyClaim(s, p, s.claim.truth);
      continue;
    }
    const plan = chooseShot(physics, s, levels[p], rng);
    const r = physics.simulate(s.hole, ballOf(s), plan.angle, plan.power, plan.phase);
    const next = applyShot(s, p, r);
    assert.ok(next, `Meldung abgelehnt: ${JSON.stringify(r)}`);
    s = next;
    shots++;
    assert.ok(shots < 140, 'endet nicht');
  }
  return s;
}

test('Computer gegen Computer: Profi gegen Anfänger spielt 9 Bahnen zu Ende, höchstens 7 je Bahn, Profi besser', () => {
  const s = match([2, 0]);
  for (const row of s.scores) for (const n of row) assert.ok(n >= 1 && n <= MAX_SCORE);
  assert.ok(total(s, 0) <= total(s, 1), `Profi ${total(s, 0)}, Anfänger ${total(s, 1)}`);
  assert.ok(total(s, 0) < 9 * 4, `Profi zu schwach: ${total(s, 0)}`);
});

test('Computer gegen Computer ohne Hilfen (Stufe Fortgeschritten): selbst eingetragen, Ergebnis steht', () => {
  const s = match([1, 1], true);
  assert.ok(s.result);
  assert.equal(LEVELS.length >= 3, true);
});
