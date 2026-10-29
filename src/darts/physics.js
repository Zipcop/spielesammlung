// Darts-Physik ohne Grafik (Rapier): Flug des Pfeils mit Schwerkraft, Einschlag in Scheibe, Auffangring, Wand oder Boden.
// Rein – läuft im Browser (board.js zeigt den Pfeil) und mit node --test (test/darts-physik.test.js).
// Eigenes Maß-System in Metern: x nach rechts (vom Werfer aus), y nach oben ab Fußboden, z von der Scheibe zum Werfer;
// die Vorderseite der Scheibe liegt bei z = 0, das Bullseye bei (0, 1,73, 0). Die Abwurflinie ist bei z = 2,37.
import { RING, HANG } from './rules.js';

export const STEP = 1 / 480; // fein, damit der Treffer auf den Millimeter stimmt
export const GRAVITY = 9.81;
export const FLIGHT_SPEED = 11; // m/s Richtung Scheibe – ein ruhiger Wurf (rund 40 km/h)
export const TIP = 0.0015; // Radius der Spitze (Kollision)
export const SURROUND_R = 0.34; // schwarzer Auffangring um die Scheibe
export const SURROUND_Z = -0.005; // seine Vorderseite liegt knapp hinter der Scheibe
export const WALL_Z = -0.06; // Tapete
export const PANEL = { top: 0.98, z: -0.01 }; // Holzvertäfelung unten an der Wand (bis knapp 1 m hoch)
// Hand beim Loslassen: vor dem rechten Auge, gut 40 cm vor der Abwurflinie (Kamera steht 11,7 cm rechts der Mitte)
export const RELEASE = [0.157, 1.6, HANG.oche - 0.42];
const MAX_S = 3;
const q90x = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // Zylinder (Achse y) quer zur Wand drehen

// Flug ohne Rapier, genau wie dort gerechnet (erst Tempo, dann Lage je Schritt) – bis zur Ebene z = 0.
// Liefert [x, y] dort und die Flugzeit. Nur fürs Zielen.
export function flyToBoard(from, v) {
  let [x, y, z] = from;
  let [vx, vy, vz] = v;
  let t = 0;
  while (t < MAX_S) {
    vy -= GRAVITY * STEP;
    const nz = z + vz * STEP;
    if (nz <= 0) {
      const f = z / (z - nz);
      return { x: x + vx * STEP * f, y: y + vy * STEP * f, t: t + STEP * f };
    }
    [x, y, z] = [x + vx * STEP, y + vy * STEP, nz];
    t += STEP;
  }
  return { x, y, t };
}

// Tempo, mit dem ein Pfeil von `from` genau auf aim = [x, y] (Scheibe, um das Bull) trifft
export function idealVelocity(from, [ax, ay], speed = FLIGHT_SPEED) {
  const goal = [ax, ay + HANG.bull];
  const t0 = from[2] / speed;
  const v = [(goal[0] - from[0]) / t0, (goal[1] - from[1]) / t0 + (GRAVITY * t0) / 2, -speed];
  for (let i = 0; i < 6; i++) {
    const hit = flyToBoard(from, v);
    v[0] += (goal[0] - hit.x) / hit.t;
    v[1] += (goal[1] - hit.y) / hit.t;
  }
  return v;
}

export function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = STEP;
  const queue = new RAPIER.EventQueue(true);
  const kindOf = new Map(); // Collider-Handle → 'board' | 'surround' | 'wall' | 'floor'
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (desc, kind, restitution) => {
    const c = world.createCollider(desc.setFriction(0.9).setRestitution(restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
    kindOf.set(c.handle, kind);
  };
  add(RAPIER.ColliderDesc.cylinder(0.02, RING.edge).setTranslation(0, HANG.bull, -0.02).setRotation(q90x), 'board', 0);
  add(RAPIER.ColliderDesc.cylinder(0.0125, SURROUND_R).setTranslation(0, HANG.bull, SURROUND_Z - 0.0125).setRotation(q90x), 'surround', 0);
  add(RAPIER.ColliderDesc.cuboid(3, 1.3, 0.02).setTranslation(0, 1.3, WALL_Z - 0.02), 'wall', 0.25);
  add(RAPIER.ColliderDesc.cuboid(3, PANEL.top / 2, 0.025).setTranslation(0, PANEL.top / 2, PANEL.z - 0.025), 'wall', 0.25);
  add(RAPIER.ColliderDesc.cuboid(3, 0.05, 3).setTranslation(0, -0.05, 1.5), 'floor', 0.1);

  // Neuer Wurf: Pfeil (nur die Spitze zählt) an der Hand, mit Tempo v
  function start(from, v) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(...from).setLinvel(...v).setAngularDamping(0.4).setCcdEnabled(true));
    const c = world.createCollider(RAPIER.ColliderDesc.ball(TIP).setDensity(2000).setFriction(0.6).setRestitution(0.2)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    return { body, collider: c.handle, steps: 0, bounced: false, result: null };
  }

  // Ein Schritt. Liefert { pos, vel, sound } – sound = 'board' | 'wall' | 'floor' beim Aufprall; danach steht shot.result
  function step(shot) {
    if (shot.result) return { pos: shot.result.p, vel: [0, 0, 0], sound: null };
    shot.steps++;
    // Lage und Tempo vor dem Schritt: in diesem Schritt fliegt der Pfeil gerade mit dem Tempo nach der Schwerkraft
    const p0 = shot.body.translation();
    const v0 = shot.body.linvel();
    const vs = [v0.x, v0.y - GRAVITY * STEP, v0.z];
    world.step(queue);
    let touched = null;
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started || (h1 !== shot.collider && h2 !== shot.collider)) return;
      touched ??= kindOf.get(h1 === shot.collider ? h2 : h1);
    });
    const p = shot.body.translation();
    const v = shot.body.linvel();
    const rot = shot.body.rotation(); // vor finish() lesen – danach ist der Körper weg
    const pos = [p.x, p.y, p.z];
    const vel = [v.x, v.y, v.z];
    let sound = null;
    if ((touched === 'board' || touched === 'surround') && !shot.bounced && vs[2] < 0) {
      // Rapier meldet die Berührung der Spitze (und lässt sie schon abprallen) – die Flugbahn dieses Schritts bis zur
      // Vorderseite verlängern: dort steckt der Pfeil
      const r0 = Math.hypot(p0.x, p0.y - HANG.bull);
      const face = r0 <= RING.edge + 0.003 ? 0 : SURROUND_Z;
      const k = (face - p0.z) / vs[2];
      const hit = [p0.x + vs[0] * k, p0.y + vs[1] * k, face];
      const r = Math.hypot(hit[0], hit[1] - HANG.bull);
      finish(shot, r <= RING.edge ? 'board' : 'surround', [hit[0], hit[1], r <= RING.edge ? 0 : SURROUND_Z], unit(vs));
      sound = 'board';
    } else if (touched === 'wall' && !shot.bounced) {
      shot.bounced = true; // prallt ab und fällt herunter
      shot.body.setAngvel({ x: 9, y: 4, z: -6 }, true);
      sound = 'wall';
    } else if (touched === 'floor' || (touched && shot.bounced && p.y < 0.05)) {
      finish(shot, 'floor', [p.x, 0, p.z], shot.bounced ? flat(rot) : unit(vel));
      sound = 'floor';
    } else if (shot.steps * STEP > MAX_S) finish(shot, 'floor', [p.x, 0, p.z], [1, 0, 0]);
    return { pos, vel, rot, sound };
  }

  function finish(shot, on, p, d) {
    shot.result = { on, p, d };
    world.removeRigidBody(shot.body);
  }

  // Ganzer Wurf in einem Rutsch (für Tests und den Computer ohne Bild)
  function simulate(from, v) {
    const shot = start(from, v);
    while (!shot.result) step(shot);
    return { ...shot.result, seconds: shot.steps * STEP };
  }

  // Wie idealVelocity, aber mit Rapier nachgeschärft: Rapier rechnet etwas anders als flyToBoard (gut 1 mm höher)
  function aim(from, target, speed) {
    const v = idealVelocity(from, target, speed);
    for (let i = 0; i < 2; i++) {
      const out = simulate(from, v);
      if (out.on !== 'board') break;
      v[0] += (target[0] - out.p[0]) / out.seconds;
      v[1] += (target[1] + HANG.bull - out.p[1]) / out.seconds;
    }
    return v;
  }

  // Wurf abbrechen (Spiel verlassen)
  function cancel(shot) {
    if (shot && !shot.result) world.removeRigidBody(shot.body);
  }

  return { start, step, simulate, aim, cancel };
}

function unit([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

// Liegender Pfeil: Richtung flach auf dem Boden aus der Drehung des Körpers
function flat({ x, y, z, w }) {
  const dx = 1 - 2 * (y * y + z * z);
  const dz = 2 * (x * z - w * y);
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, 0, dz / l];
}
