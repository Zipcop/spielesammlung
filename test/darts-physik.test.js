// Darts-Physik ohne Browser (Rapier): ruhiger Wurf trifft genau, zu langsam = tiefer, zu schnell = höher, schräg = seitlich,
// Fehlwurf an die Wand fällt herunter. Dazu Computer gegen Computer bis zum Ende (alle Stufen, ohne und mit Hilfen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { createPhysics, idealVelocity, flyToBoard, RELEASE, SURROUND_R } from '../src/darts/physics.js';
import { readFlick, validFlick, throwVelocity, cpuVelocity, IDEAL_FLICK } from '../src/darts/wurf.js';
import { HANG, centerOf, value } from '../src/darts/rules.js';
import { LEVELS, chooseTarget, fakeClaim } from '../src/darts/ai.js';
import { newGame, setup, throwDart, pull, accuse, nextLegFree, again, judgeVisit, dartsAllowed, average } from '../src/darts/game.js';
import { cpuCheats, cpuAccuses } from '../src/schummeln.js';

await RAPIER.init();
const physics = createPhysics(RAPIER);
const onBoard = (r) => [r.p[0], r.p[1] - HANG.bull];
// Zufall mit Startwert – Tests laufen immer gleich
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('Ruhiger Wurf trifft auf den Millimeter, die Flugbahn fällt durch die Schwerkraft', () => {
  for (const label of ['T20', 'Bull', 'D16', 'S11', 'T3']) {
    const aim = centerOf(label);
    const v = physics.aim(RELEASE, aim);
    assert.ok(v[1] > 0, 'nach oben geworfen, damit er nicht zu tief ankommt');
    assert.ok(Math.abs(v[1] - idealVelocity(RELEASE, aim)[1]) < 0.01, 'Rapier rechnet fast wie flyToBoard');
    const out = physics.simulate(RELEASE, v);
    assert.equal(out.on, 'board');
    const [x, y] = onBoard(out);
    assert.ok(Math.hypot(x - aim[0], y - aim[1]) < 0.001, `${label}: ${(Math.hypot(x - aim[0], y - aim[1]) * 1000).toFixed(2)} mm daneben`);
    assert.ok(out.seconds > 0.12 && out.seconds < 0.25, `Flugzeit ${out.seconds}`);
    assert.ok(out.d[2] < -0.98 && Math.abs(out.d[1]) < 0.15, 'steckt fast gerade in der Scheibe');
  }
  const free = flyToBoard(RELEASE, idealVelocity(RELEASE, [0, 0]));
  assert.ok(Math.abs(free.y - HANG.bull) < 1e-6);
});

test('Wurfbewegung: Tempo verschiebt nach oben/unten, schräg zur Seite, zu sanft = kein Wurf', () => {
  const flick = (px, side = 0, ms = 60) => readFlick([{ t: 0, x: 0, y: 500 }, { t: ms / 2, x: side / 2, y: 500 - px / 2 }, { t: ms, x: side, y: 500 - px }]);
  const ideal = flick((IDEAL_FLICK * 60) / 1000);
  assert.ok(Math.abs(ideal.ratio - 1) < 1e-9);
  assert.ok(ideal.jerk === 0 && Math.abs(ideal.angle) < 1e-9);
  assert.ok(validFlick(ideal));
  assert.equal(validFlick(flick(5)), false);
  const still = () => 0.5; // ohne Zufall: Box-Muller mit 0,5/0,5 ergibt ≈ −1,18 – gleich für alle Würfe
  const land = (f) => onBoard(physics.simulate(RELEASE, throwVelocity(RELEASE, [0, 0], f, still, physics.aim)));
  const [x0, y0] = land(ideal);
  const [, yFast] = land(flick((IDEAL_FLICK * 1.3 * 60) / 1000));
  const [, ySlow] = land(flick((IDEAL_FLICK * 0.7 * 60) / 1000));
  assert.ok(yFast > y0 + 0.008 && ySlow < y0 - 0.008, `schnell ${yFast}, ideal ${y0}, langsam ${ySlow}`);
  const [xRight] = land(flick((IDEAL_FLICK * 60) / 1000, 15));
  assert.ok(xRight > x0 + 0.005, `rechts ${xRight} vs ${x0}`);
  // ruckelig (erst schnell, dann fast stehen) streut mehr
  const jerky = readFlick([{ t: 0, x: 0, y: 500 }, { t: 30, x: 0, y: 420 }, { t: 60, x: 0, y: 416 }]);
  assert.ok(jerky.jerk > 0.8);
});

test('Fehlwurf: an die Wand = fällt herunter, zu kurz = Boden, knapp neben die Scheibe = Auffangring', () => {
  const wall = physics.simulate(RELEASE, idealVelocity(RELEASE, [0.6, 0.2]));
  assert.equal(wall.on, 'floor');
  assert.equal(wall.d[1], 0, 'liegt flach');
  const short = physics.simulate(RELEASE, [0, 0.5, -3]);
  assert.equal(short.on, 'floor');
  const ring = physics.simulate(RELEASE, idealVelocity(RELEASE, [0, -0.28]));
  assert.equal(ring.on, 'surround');
  assert.ok(Math.hypot(...onBoard(ring)) < SURROUND_R);
});

// Ganze Partie Computer gegen Computer mit echter Physik
function cpuMatch({ levels, free = false, mode = 501, bestOf = 3, seed = 1 }) {
  const rng = seeded(seed);
  let s = setup(newGame({ free, starter: 0 }), 0, { mode, bestOf });
  let throws = 0;
  let cheats = 0;
  let caught = 0;
  while (s.phase !== 'over') {
    assert.ok(throws++ < 3000, 'Partie endet');
    const p = s.turn;
    if (s.phase === 'legover') {
      s = (cpuAccuses(!s.cheat?.legal, rng) && accuse(s, 1 - p)) || nextLegFree(s, 1 - p);
      continue;
    }
    const truth = judgeVisit(s.visitStart, s.darts);
    const over = s.darts.length >= dartsAllowed(s, p) || truth.bust || truth.checkout;
    if (s.free ? s.darts.length && over : s.done) {
      let claim = truth.points;
      const fake = s.free && cpuCheats(rng) ? fakeClaim(truth, s.darts.map((d) => d.hit.label), s.visitStart, rng) : null;
      if (fake !== null) [claim, cheats] = [fake, cheats + 1];
      s = pull(s, p, s.free ? claim : undefined);
      assert.ok(s);
      if (s.free && s.cheat && s.phase === 'play' && cpuAccuses(!s.cheat.legal, rng)) {
        const next = accuse(s, 1 - p);
        if (next.verdict.caught) caught++;
        s = next;
      }
      continue;
    }
    const target = chooseTarget(s.free ? s.rest[p] - truth.points : s.rest[p], dartsAllowed(s, p) - s.darts.length);
    const out = physics.simulate(RELEASE, cpuVelocity(RELEASE, centerOf(target), LEVELS[levels[p]].sigma, rng, physics.aim));
    s = throwDart(s, p, out);
    assert.ok(s, 'Meldung der Physik ist gültig');
  }
  return { s, cheats, caught };
}

test('Computer gegen Computer: jede Stufe spielt 501 bis zum Ende, die Stufen sind unterschiedlich stark', () => {
  const avg = LEVELS.map((_, k) => {
    const { s } = cpuMatch({ levels: [k, k], bestOf: 1, seed: 7 + k });
    assert.ok(s.winner === 0 || s.winner === 1);
    assert.equal(s.rest[s.winner], 0);
    return (average(s, 0) + average(s, 1)) / 2;
  });
  if (process.env.DARTS_LOG) console.log('3-Dart-Schnitt je Stufe', avg.map((a) => a.toFixed(1)).join(' / '));
  for (let k = 1; k < avg.length; k++) assert.ok(avg[k] > avg[k - 1], `Schnitt je Stufe: ${avg.map((a) => a.toFixed(1))}`);
  assert.ok(avg[3] > 75, `Profi zu schwach: ${avg[3]}`);
  assert.ok(avg[0] < 45, `Anfänger zu stark: ${avg[0]}`);
  // Profi schlägt Anfänger fast immer
  let pro = 0;
  for (let i = 0; i < 4; i++) if (cpuMatch({ levels: [0, 3], bestOf: 1, seed: 100 + i }).s.winner === 1) pro++;
  assert.ok(pro >= 3);
});

test('Computer gegen Computer ohne Hilfen: Einträge, Schummeln, Anklagen – die Partie endet trotzdem', () => {
  let cheats = 0;
  for (let i = 0; i < 3; i++) {
    const r = cpuMatch({ levels: [2, 2], free: true, mode: 301, bestOf: 3, seed: 40 + i });
    assert.ok(r.s.winner === 0 || r.s.winner === 1);
    cheats += r.cheats;
    assert.ok(again(r.s, 1 - r.s.winner) || r.s.cheat?.player === 1 - r.s.winner);
  }
  assert.ok(cheats > 0, 'der Computer schummelt ab und zu');
});
