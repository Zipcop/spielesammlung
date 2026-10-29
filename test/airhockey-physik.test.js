// Air-Hockey-Physik ohne Browser: Tor im Schlitz, Banden halten auch den schnellsten Puck, Schläger schießt,
// Topping hält den Puck fest, und Computer gegen Computer spielt jede Stufe bis 7 Tore durch (Schiedsrichter, 7-Sekunden-Regel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics, STEP, MAX_PUCK } from '../src/airhockey/physics.js';
import { createReferee } from '../src/airhockey/referee.js';
import { createBrain } from '../src/airhockey/ai.js';
import { newGame, accuse, TABLE, R, WIN } from '../src/airhockey/rules.js';

await RAPIER.init();
const { L, W, GOAL } = TABLE;
const run = (physics, seconds, each) => {
  for (let i = 0; i < seconds / STEP; i++) {
    const out = physics.step();
    if (each?.(out) === false) return;
  }
};
// fester Zufall (für wiederholbare Partien)
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('Gerader Schuss ins Tor: Tor für den Schützen, Puck bleibt im Schlitz liegen', () => {
  const physics = createPhysics(RAPIER);
  physics.placeMallet(0, 0.4, 1);
  physics.placeMallet(1, -0.4, -1);
  physics.setPuck(0, 0, 0, -4);
  let scorer = null;
  run(physics, 2, (out) => {
    if (out.goal !== null) scorer = out.goal;
  });
  assert.equal(scorer, 0, 'Tor auf −z = Tor für den Host');
  const p = physics.puck();
  assert.ok(p.z < -L / 2 && Math.hypot(p.vx, p.vz) < 0.01, 'liegt still im Schlitz');
});

test('Banden halten auch den schnellsten Puck – aus allen Richtungen, 20 s lang', () => {
  const physics = createPhysics(RAPIER);
  physics.placeMallet(0, 0, 2); // Schläger aus dem Weg (außerhalb – keine Ziele gesetzt)
  physics.placeMallet(1, 0, -2);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2 + 0.13;
    physics.setPuck(0.1, 0.2, Math.cos(a) * 30, Math.sin(a) * 30); // weit über dem Höchsttempo
    let goal = false;
    run(physics, 2, (out) => {
      const p = physics.puck();
      assert.ok(Math.hypot(p.vx, p.vz) <= MAX_PUCK + 1e-6, 'Tempo begrenzt');
      const inSlot = Math.abs(p.x) < GOAL / 2;
      assert.ok(Math.abs(p.x) <= W / 2 - R + 0.003, `seitlich durch die Bande: ${p.x}`);
      assert.ok(Math.abs(p.z) <= (inSlot ? L / 2 + 0.15 : L / 2 - R + 0.003), `durch die Stirnbande: ${p.z}`);
      if (out.goal !== null) goal = true;
      return !goal;
    });
  }
});

test('Schläger fährt mit begrenztem Tempo und schießt den ruhenden Puck', () => {
  const physics = createPhysics(RAPIER);
  physics.placeMallet(1, 0, -1);
  physics.placeMallet(0, 0, 0.9);
  physics.setPuck(0, 0.5);
  physics.setTarget(0, [0, 0.2], 5);
  let max = 0;
  let fastest = 0;
  let last = physics.mallet(0).z;
  run(physics, 0.15, () => {
    const z = physics.mallet(0).z;
    max = Math.max(max, Math.abs(z - last) / STEP);
    last = z;
    fastest = Math.min(fastest, physics.puck().vz);
  });
  assert.ok(max <= 5 + 1e-6, `Schläger zu schnell: ${max}`);
  assert.ok(fastest < -4, `Puck fliegt zum anderen Tor: ${fastest}`);
});

test('Topping: Puck klebt am Schläger, beim Loslassen liegt er ruhend davor', () => {
  const physics = createPhysics(RAPIER);
  physics.placeMallet(0, 0, 0.6);
  physics.placeMallet(1, 0, -1);
  physics.setPuck(0, 0.5);
  assert.equal(physics.hold(0, true), true);
  physics.setTarget(0, [0.3, 0.8], 3);
  run(physics, 0.5);
  const m = physics.mallet(0);
  let p = physics.puck();
  assert.ok(Math.hypot(p.x - m.x, p.z - m.z) < 0.001, 'Puck unter dem Schläger');
  physics.hold(0, false);
  run(physics, 0.1);
  p = physics.puck();
  assert.ok(p.z < m.z && Math.hypot(p.vx, p.vz) < 0.2, 'liegt vor dem Schläger');
  assert.equal(physics.hold(1, true), false, 'zu weit weg: kein Festhalten');
});

for (const [a, b] of [[0, 0], [1, 2], [3, 3], [0, 3]]) {
  test(`Computer gegen Computer (Stufe ${a + 1} gegen ${b + 1}): Partie geht bis ${WIN} Tore`, () => {
    const physics = createPhysics(RAPIER);
    const ref = createReferee(physics);
    const rng = seeded(7 + a * 13 + b);
    const brains = [createBrain(0, a, rng), createBrain(1, b, rng)];
    physics.placeMallet(0, 0, L / 2 - 0.2);
    physics.placeMallet(1, 0, -L / 2 + 0.2);
    let state = newGame({ starter: 0 });
    let sevens = 0;
    let steps = 0;
    while (state.winner === null && steps < (20 * 60) / STEP) {
      const puck = physics.puck();
      const plans = [0, 1].map((p) => brains[p].think({ puck, mallet: physics.mallet(p) }, STEP));
      const out = ref.tick(state, { targets: plans.map((x) => x.target), speeds: plans.map((x) => x.speed) });
      if (out.changed && out.state.events[0].type === 'sieben') sevens++;
      state = out.state;
      steps++;
    }
    const minutes = (steps * STEP) / 60;
    console.log(`Stufe ${a + 1}–${b + 1}: ${state.score.join(':')} in ${minutes.toFixed(1)} min, ${sevens}× 7 Sekunden`);
    assert.notEqual(state.winner, null, `kein Ende nach 20 min: ${state.score}`);
    assert.equal(Math.max(...state.score), WIN);
  });
}

test('Ohne Hilfen: Fehlalarm kurz vor dem eigenen Tor bremst nichts – das Tor zählt', () => {
  for (const call of [false, true]) {
    const physics = createPhysics(RAPIER);
    const ref = createReferee(physics);
    let s = newGame({ starter: 0, free: true });
    const targets = [[0.4, 1], [-0.45, -1]];
    for (let i = 0; i < 240; i++) s = ref.tick(s, { targets }).state;
    physics.setPuck(0, 0.3, 0, -8); // Schuss aufs Tor des Gasts (−z)
    for (let i = 0; i < 240 * 3; i++) {
      if (call && i === 20) s = accuse(s, 1, ref.clock()); // Gast ruft ohne Grund
      s = ref.tick(s, { targets }).state;
    }
    assert.deepEqual(s.score, [1, 0], call ? 'mit Ruf' : 'ohne Ruf');
    physics.free();
  }
});

test('Verstoß und Tor im selben Schritt: beide Ereignisse kommen im Stand an', () => {
  const physics = createPhysics(RAPIER);
  const ref = createReferee(physics);
  let s = newGame({ starter: 0, free: true });
  s = ref.tick(s, { targets: [[0.3, 0.001], [-0.3, -1]] }).state;
  physics.placeMallet(0, 0.3, 0.001);
  physics.setPuck(0, -L / 2 - R + 0.004, 0, -3);
  const out = ref.tick(s, { targets: [[0.3, -0.05], [-0.3, -1]] });
  assert.deepEqual(out.state.events.map((e) => e.type), ['foul', 'goal']);
  physics.free();
});
