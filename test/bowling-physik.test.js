// Bowling-Physik ohne Browser: Pins stehen von selbst still, Rinnenkugel wirft nichts um, gerader Wurf in die Tasche
// räumt ab, Drall lenkt nach links, Kugel landet in der Grube. Dazu Computer gegen Computer: ganze Partien bis zum Ende.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics, fullPins, speedOf, FOUL_TEMPO, DECK_END } from '../src/bowling/physics.js';
import { newGame, throwBall, totalOf, position } from '../src/bowling/rules.js';
import { plan, LEVELS } from '../src/bowling/ai.js';

await RAPIER.init();
const downCount = (pins) => pins.filter((p) => p === null).length;

// Zufall mit Startwert – Partien sind so wiederholbar
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('Pins stehen still, wenn nichts sie trifft (kein Wackeln, kein Umfallen von selbst)', () => {
  const physics = createPhysics(RAPIER);
  const out = physics.simulate(fullPins(), { x: 0.4, angle: 0.06, speed: 5, hook: 0 }); // schräg in die rechte Rinne
  assert.equal(out.gutter, true);
  assert.equal(downCount(out.pins), 0);
  out.pins.forEach((p, n) => assert.ok(Math.hypot(p[0] - fullPins()[n][0], p[1] - fullPins()[n][1]) < 0.003, `Pin ${n + 1} gerutscht`));
});

test('Gerader Wurf 6 cm rechts der Mitte (Tasche 1–3) mit gutem Tempo: Strike', () => {
  const physics = createPhysics(RAPIER);
  const out = physics.simulate(fullPins(), { x: 0.06, angle: 0, speed: speedOf(0.75), hook: 0 });
  assert.equal(downCount(out.pins), 10);
  assert.ok(out.seconds < 12);
});

test('Drall: gleicher Wurf hakt mit Hook nach links, ohne Hook bleibt er gerade', () => {
  const physics = createPhysics(RAPIER);
  const none = [null, null, null, null, null, null, null, null, null, null];
  const straight = physics.simulate(none, { x: 0.3, angle: 0, speed: speedOf(0.6), hook: 0 });
  const hooked = physics.simulate(none, { x: 0.3, angle: 0, speed: speedOf(0.6), hook: 1 });
  const at = (path, z) => path.find(([, pz]) => pz <= z)[0];
  assert.ok(Math.abs(at(straight.path, -17) - 0.3) < 0.01, 'gerade bleibt gerade');
  assert.ok(Math.abs(at(hooked.path, -9) - 0.3) < 0.1, 'auf dem Öl kaum Haken');
  assert.ok(at(hooked.path, -17) < 0.05, `hinten hakt sie ein: x = ${at(hooked.path, -17)}`);
  assert.ok(straight.path.at(-1)[1] < DECK_END, 'Kugel landet in der Grube');
});

test('Rest umwerfen: einzelner Pin 10 wird gezielt getroffen (Computer, Profi ohne Streuung)', () => {
  const physics = createPhysics(RAPIER);
  const pins = fullPins().map((p, n) => (n === 9 ? p : null));
  const pl = plan(pins, 3, () => 0.25); // rng 0,25 → Streuung 0 (Box-Muller: cos(π/2) = 0)
  const out = physics.simulate(pins, { x: pl.x, angle: pl.angle, speed: speedOf(pl.tempo), hook: pl.hook });
  assert.equal(out.pins[9], null, 'Pin 10 liegt');
});

test('Computer gegen Computer: zwei ganze Partien laufen bis zum Ende, Punkte im üblichen Rahmen', () => {
  const physics = createPhysics(RAPIER);
  for (const [lv, seed] of [[0, 7], [3, 11]]) {
    const rng = seeded(seed);
    let s = newGame({ starter: 0 });
    let balls = 0;
    while (!s.result) {
      const pl = plan(s.pins, lv, rng);
      const out = physics.simulate(s.pins, { x: pl.x, angle: pl.angle, speed: speedOf(pl.tempo), hook: pl.hook });
      const next = throwBall(s, s.turn, { pins: out.pins, foul: pl.tempo >= FOUL_TEMPO, gutter: out.gutter });
      assert.ok(next, 'Meldung der Physik passt zu den Regeln');
      s = next;
      assert.ok(++balls <= 42, 'höchstens 21 Würfe je Spieler');
    }
    assert.ok(position(s.rolls[0]).done && position(s.rolls[1]).done);
    for (const p of [0, 1]) assert.ok(totalOf(s, p) >= 20 && totalOf(s, p) <= 300, `${LEVELS[lv].name}: ${totalOf(s, p)}`);
  }
});
