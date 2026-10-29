// Computer-Gegner beim Minigolf: probiert Schläge in der Physik aus (Probe-Simulation, physics.simulate) und nimmt den,
// nach dem der Ball am nächsten am Loch liegt (Restweg entlang des Laufwegs, course.js toGo) – eingelocht ist am besten,
// draußen am schlechtesten. Erst grob gestreut, dann fein um den besten Versuch. Ausgeführt wird mit Streuung je Stufe.
// Bei der Mühle wählt er auch den Moment (Flügelwinkel), in dem er schlägt.
// Rein (kein three.js) – plan() ist ein Generator: Der Browser rechnet zwischen zwei Bildern ein paar Proben (index.js),
// chooseShot() rechnet alles auf einmal (Tests). Richtung wie physics.js: angle 0 = +x, (cos a, −sin a) in (x, z).
import { COURSE, MILL_PERIOD, R, toGo } from './course.js';
import { ballOf } from './rules.js';

export const LEVELS = [
  { name: 'Anfänger', probes: 6, refine: 2, aim: 0.075, pow: 0.16 },
  { name: 'Fortgeschritten', probes: 18, refine: 10, aim: 0.03, pow: 0.07 },
  { name: 'Profi', probes: 36, refine: 26, aim: 0.008, pow: 0.02 },
];

const angleTo = ([px, , pz], [tx, tz]) => Math.atan2(-(tz - pz), tx - px);
const gauss = (rng) => (rng() + rng() + rng() + rng() - 2) * 0.87; // ≈ Normalverteilung, σ ≈ 1

// Kraft für einen Weg von d Metern auf der Ebene (gemessen: 0,45 → gut 3 m, 1 → gut 9 m)
const powerFor = (d) => Math.min(1, Math.max(0.05, (d / 9.5) ** (1 / 1.3)));

// Nächster Wegpunkt voraus (der Ball liegt zwischen path[i] und path[i + 1])
function nextPoint(hole, [x, , z]) {
  let best = { d: Infinity, i: 0 };
  for (let i = 0; i < hole.path.length - 1; i++) {
    const [ax, az] = hole.path[i];
    const [bx, bz] = hole.path[i + 1];
    const [dx, dz] = [bx - ax, bz - az];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best.d - 1e-9) best = { d, i: t > 0.98 ? i + 1 : i };
  }
  return hole.path[Math.min(best.i + 1, hole.path.length - 1)];
}

// Bewertung eines Probeschlags: kleiner = besser
const scoreOf = (hole, r) => (r.holed ? -10 : r.out ? 50 : toGo(hole, [r.pos[0], r.pos[2]]));

// Generator: liefert nach jeder Probe (yield), gibt am Ende { angle, power, phase } zurück
export function* plan(physics, s, level = 1, rng = Math.random) {
  const L = LEVELS[level] ?? LEVELS[1];
  const hole = COURSE[s.hole];
  const pos = ballOf(s);
  const goal = [hole.cup[0], hole.cup[2]];
  const next = nextPoint(hole, pos);
  const targets = next[0] === goal[0] && next[1] === goal[1] ? [goal] : [next, goal];
  // bergauf (Rampe, Vulkan) braucht es mehr: je cm Höhe etwa 15 cm Weg dazu
  const base = powerFor(toGo(hole, [pos[0], pos[2]]) + 15 * Math.max(0, hole.cup[1] + R - pos[1]));
  const phaseOf = () => (hole.mill ? rng() * MILL_PERIOD : 0);
  let best = null;
  const tryShot = (angle, power, phase) => {
    const r = physics.simulate(s.hole, pos, angle, power, phase);
    const score = scoreOf(hole, r);
    if (!best || score < best.score) best = { angle, power, phase, score };
  };
  for (let i = 0; i < L.probes; i++) {
    const t = targets[i % targets.length];
    const spread = i < targets.length ? 0 : 0.12;
    tryShot(angleTo(pos, t) + gauss(rng) * spread, Math.min(1, base * (0.65 + rng() * 1.1)), phaseOf());
    yield;
    if (best.score === -10 && level === 0) break;
  }
  for (let i = 0; i < L.refine && best.score > -10; i++) {
    const { angle, power, phase } = best;
    tryShot(angle + gauss(rng) * 0.025, Math.min(1, Math.max(0.03, power * (1 + gauss(rng) * 0.07))), hole.mill ? (phase + gauss(rng) * 0.08 + MILL_PERIOD) % MILL_PERIOD : 0);
    yield;
  }
  return { angle: best.angle + gauss(rng) * L.aim, power: Math.min(1, Math.max(0.03, best.power * (1 + gauss(rng) * L.pow))), phase: best.phase };
}

// Alles auf einmal (Tests)
export function chooseShot(physics, s, level = 1, rng = Math.random) {
  const it = plan(physics, s, level, rng);
  for (;;) {
    const { value, done } = it.next();
    if (done) return value;
  }
}

// Schummeln (allein, ohne Hilfen): Ball ein Stück Richtung Loch verlegen, wenn er noch weit weg liegt.
// Liefert die neue Ballmitte oder null (geht nicht – dann trägt er eben später falsch ein).
export function cheatSpot(physics, s, rng = Math.random) {
  const hole = COURSE[s.hole];
  const pos = ballOf(s);
  if (toGo(hole, [pos[0], pos[2]]) < 1.5) return null;
  const [tx, tz] = nextPoint(hole, pos);
  const d = Math.hypot(tx - pos[0], tz - pos[2]);
  const step = Math.min(d - 0.1, 0.5 + rng() * 0.5);
  if (step < 0.3) return null;
  const [x, z] = [pos[0] + ((tx - pos[0]) / d) * step, pos[2] + ((tz - pos[2]) / d) * step];
  const y = physics.floorAt(s.hole, x, z);
  return y === null ? null : [x, y + R, z];
}
