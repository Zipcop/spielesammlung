// Minigolf-Physik ohne Grafik (Rapier): je Bahn eine eigene Welt aus course.js, ein Ball, ein Schlag Schritt für Schritt.
// Rein – läuft im Browser (scene.js zeigt den Ball) und mit node --test (test/minigolf-physik.test.js).
// Rollwiderstand: gleichmäßiges Abbremsen wie beim Billardtuch. Loch: Ist die Ballmitte über dem Loch, fällt er so weit,
// wie die Zeit über der Öffnung reicht (½ g t²) – tief genug = drin, sonst rollt er über den Rand weiter und wird je nach
// Treffer abgelenkt und gebremst (Lip-out). Bleibt er über dem Loch liegen, ist er auch drin.
import { COURSE, FLOOR, R, CUP_R, MILL_SPEED } from './course.js';

export const STEP = 1 / 240;
export const MAX_S = 25; // spätestens dann ist der Schlag vorbei
export const MAX_SPEED = 4.2; // m/s – voller Schlag
const DECEL = 0.42; // m/s² – Rollwiderstand der Bahn
const G = 9.81;
const DROP = R * 0.9; // so tief muss der Ball über dem Loch sinken, dann hält ihn der Rand
const OUT_Y = FLOOR + R - 0.035; // Ballmitte tiefer = von der Bahn gefallen (Rasen, Wassergraben)
const STILL = 0.015; // m/s – darunter gilt der Ball als liegend
const SOUND_EVERY = 0.06; // s – höchstens so oft dasselbe Geräusch

// Schlaggeschwindigkeit aus der Kraft 0–1 (gleichmäßig – kurze Putts lassen sich fein dosieren)
export const speedOf = (power) => MAX_SPEED * Math.max(0.02, Math.min(power, 1));

const yawQuat = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const mul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
// Drehung der Mühlenflügel: erst um die Bahnachse (lokal x), dann in Bahnrichtung gedreht
export const millQuat = (yaw, angle) => mul(yawQuat(yaw), { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) });

export function createPhysics(RAPIER) {
  const worlds = new Map();

  // Welt einer Bahn: Rasen, Bahnplatten, Banden, Hindernisse, Wellen, Keile, Mühle
  function worldOf(n) {
    if (worlds.has(n)) return worlds.get(n);
    const hole = COURSE[n];
    const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    world.timestep = STEP;
    const kindOf = new Map();
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const add = (desc, kind, friction, restitution, body = fixed) => {
      const c = world.createCollider(desc.setFriction(friction).setRestitution(restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, kind);
      return c;
    };
    const [cx, , cz] = hole.tee;
    add(RAPIER.ColliderDesc.cuboid(20, 0.05, 20).setTranslation(cx, -0.05, cz), 'grass', 0.8, 0.2); // Rasen (und Grabensohle)
    for (const f of hole.floors) add(RAPIER.ColliderDesc.cuboid(...f.half).setTranslation(...f.c).setRotation(yawQuat(f.yaw)), 'floor', 0.6, 0.15);
    for (const w of hole.walls) add(RAPIER.ColliderDesc.cuboid(...w.half).setTranslation(...w.c).setRotation(yawQuat(w.yaw)), 'wall', 0.12, 0.62);
    for (const b of hole.blocks) add(RAPIER.ColliderDesc.cuboid(...b.half).setTranslation(...b.c).setRotation(yawQuat(b.yaw)), 'wall', 0.12, 0.62);
    for (const pts of hole.hulls) add(RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flat())), 'floor', 0.6, 0.15);
    for (const { pts } of hole.stones) add(RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flat())), 'wall', 0.12, 0.62);
    for (const w of hole.waves) {
      // Zylinderachse (lokal y) quer über die Bahn legen
      const [ax, az] = w.axis;
      const yaw = Math.atan2(-az, ax);
      const q = mul(yawQuat(yaw), { x: 0, y: 0, z: Math.sin(-Math.PI / 4), w: Math.cos(-Math.PI / 4) });
      add(RAPIER.ColliderDesc.cylinder(w.half, w.r).setTranslation(...w.c).setRotation(q), 'floor', 0.6, 0.15);
    }
    let mill = null;
    if (hole.mill) {
      const m = hole.mill;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...m.c).setRotation(millQuat(m.yaw, 0)));
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2; // Flügel k zeigt im Bahnquerschnitt in Richtung a (0 = nach unten)
        add(RAPIER.ColliderDesc.cuboid(m.thick / 2, m.len / 2, m.width / 2)
          .setTranslation(0, -Math.cos(a) * m.len / 2, Math.sin(a) * m.len / 2)
          .setRotation({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) }), 'mill', 0.2, 0.5, body);
      }
      mill = body;
    }
    const w = { world, kindOf, mill, hole, queue: new RAPIER.EventQueue(true), dirty: true };
    worlds.set(n, w);
    return w;
  }

  // Höhe der Bahnfläche unter (x, z) – null, wenn dort ein Hindernis, eine Bande oder keine Bahn ist
  function floorAt(n, x, z) {
    const w = worldOf(n);
    if (w.dirty) w.world.step(); // Abfragen sehen erst nach einem Schritt den aktuellen Stand
    w.dirty = false;
    const hit = w.world.castRay(new RAPIER.Ray({ x, y: FLOOR + 0.6, z }, { x: 0, y: -1, z: 0 }), 1, true);
    if (!hit || w.kindOf.get(hit.collider.handle) !== 'floor') return null;
    return FLOOR + 0.6 - (hit.timeOfImpact ?? hit.toi);
  }

  // Neuer Schlag auf Bahn n: Ball liegt bei pos ([x, y, z], y = Ballmitte), angle = Richtung (0 = +x, (cos a, −sin a) in x/z),
  // power 0–1, phase = Winkel der Mühlenflügel beim Schlag. rotation = Lage des Balls (nur fürs Aussehen)
  function start(n, pos, angle, power, { phase = 0, rotation } = {}) {
    const w = worldOf(n);
    const body = w.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos[0], pos[1], pos[2])
      .setRotation(rotation ?? { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0)
      .setAngularDamping(0.1)
      .setCcdEnabled(true));
    const collider = w.world.createCollider(RAPIER.ColliderDesc.ball(R).setDensity(1400).setFriction(0.6).setRestitution(0.5)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    w.kindOf.set(collider.handle, 'ball');
    const speed = speedOf(power);
    body.setLinvel({ x: Math.cos(angle) * speed, y: 0, z: -Math.sin(angle) * speed }, true);
    const shot = { n, w, body, collider, start: [...pos], phase, steps: 0, still: 0, holed: false, out: false, lip: false, lips: 0, heard: {}, speed: 0 };
    setMill(shot);
    return shot;
  }

  const millAngle = (shot) => shot.phase + MILL_SPEED * shot.steps * STEP;

  function setMill(shot) {
    const { mill, hole } = shot.w;
    if (!mill) return;
    const q = millQuat(hole.mill.yaw, millAngle(shot));
    if (shot.steps === 0) mill.setRotation(q, true);
    else mill.setNextKinematicRotation(q);
  }

  // Ein Schritt. Liefert Geräusche ([Art, Stärke]) und was passiert ist: 'holed' | 'out' | 'lip' | null
  function step(shot) {
    const { body, w } = shot;
    shot.steps++;
    setMill(shot);
    const v = body.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    shot.speed = sp;
    if (sp > 0 && Math.abs(v.y) < 0.8) { // rollt (fällt nicht): gleichmäßig bremsen
      const k = Math.max(0, sp - DECEL * STEP) / sp;
      body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }
    w.world.step(w.queue);
    const sounds = [];
    w.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = w.kindOf.get(h1);
      const b = w.kindOf.get(h2);
      const other = a === 'ball' ? b : b === 'ball' ? a : null;
      if (!other || other === 'floor' || other === 'grass') return;
      const t = shot.steps * STEP;
      if (t - (shot.heard[other] ?? -1) < SOUND_EVERY) return;
      shot.heard[other] = t;
      sounds.push([other === 'mill' ? 'wood' : 'clack', Math.min(1, shot.speed / 2.5)]);
    });
    const p = body.translation();
    let event = null;
    if (p.y < OUT_Y || !Number.isFinite(p.y)) {
      shot.out = true;
      event = 'out';
      sounds.push([p.y < FLOOR - 0.05 && w.hole.gaps.length ? 'splash' : 'felt', 0.7]);
    } else event = cup(shot, p);
    if (event === 'holed') sounds.push(['cup', 0.8]);
    if (event === 'lip') sounds.push(['rim', 0.6]);
    return { sounds, event };
  }

  // Loch: siehe Kopfkommentar
  function cup(shot, p) {
    const [cx, cy, cz] = shot.w.hole.cup;
    const dx = cx - p.x;
    const dz = cz - p.z;
    const d = Math.hypot(dx, dz);
    if (shot.lip && d > CUP_R + 0.008) shot.lip = false;
    if (shot.lip || d >= CUP_R || Math.abs(p.y - (cy + R)) > 0.02) return null;
    const v = shot.body.linvel();
    const flat = Math.hypot(v.x, v.z);
    if (flat < 0.05) return holeOut(shot);
    const [ux, uz] = [v.x / flat, v.z / flat];
    const along = dx * ux + dz * uz; // wie weit das Lochzentrum noch voraus liegt
    const off2 = Math.max(0, d * d - along * along);
    const rest = along + Math.sqrt(Math.max(0, CUP_R * CUP_R - off2)); // Weg bis zum anderen Rand
    const t = Math.max(0, rest) / flat;
    const drop = 0.5 * G * t * t;
    if (drop >= DROP) return holeOut(shot);
    shot.lip = true;
    const k = drop / DROP;
    if (k < 0.2) return null; // nur gestreift
    // Lip-out: der Rand lenkt vom Lochzentrum weg ab und bremst
    const side = Math.sign(ux * dz - uz * dx) || 1; // Lochzentrum links (+) oder rechts (−) der Laufrichtung
    const turn = -side * 0.9 * k;
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    const slow = flat * (1 - 0.45 * k);
    shot.body.setLinvel({ x: (ux * c - uz * s) * slow, y: v.y, z: (ux * s + uz * c) * slow }, true);
    shot.lips++;
    return 'lip';
  }

  function holeOut(shot) {
    shot.holed = true;
    return 'holed';
  }

  // Liegt der Ball (oder ist er drin/draußen, oder ist die Zeit um)?
  function done(shot) {
    if (shot.holed || shot.out) return true;
    const v = shot.body.linvel();
    shot.still = Math.hypot(v.x, v.y, v.z) < STILL ? shot.still + 1 : 0;
    if (shot.still >= 40) {
      // bleibt über dem Loch liegen = drin (Internationale Spielregeln 8.13)
      const p = shot.body.translation();
      const [cx, cy, cz] = shot.w.hole.cup;
      if (Math.hypot(cx - p.x, cz - p.z) < CUP_R && Math.abs(p.y - (cy + R)) < 0.02) shot.holed = true;
      return true;
    }
    return shot.steps * STEP >= MAX_S;
  }

  // Schlag beenden: Ball aus der Welt nehmen, Ergebnis für die Regeln
  function finish(shot) {
    const p = shot.body.translation();
    const pos = [p.x, p.y, p.z].map((x) => Math.round(x * 10000) / 10000);
    shot.w.world.removeRigidBody(shot.body);
    shot.w.dirty = true;
    shot.body = null;
    return { holed: shot.holed, out: shot.out, pos: shot.holed ? [...shot.w.hole.cup] : shot.out ? [...shot.start] : pos, seconds: Math.round(shot.steps * STEP * 100) / 100 };
  }

  // Ganzer Schlag in einem Rutsch (Tests, Computer). trace: Ballmitte alle 12 Schritte (für die Prüfung)
  function simulate(n, pos, angle, power, phase = 0, trace = null) {
    const shot = start(n, pos, angle, power, { phase });
    while (!done(shot)) {
      step(shot);
      if (trace && shot.steps % 12 === 0) {
        const p = shot.body.translation();
        trace.push([p.x, p.y, p.z]);
      }
    }
    return { ...finish(shot), lips: shot.lips };
  }

  return { start, step, done, finish, simulate, millAngle, floorAt };
}

// Ruhelage des Balls am Abschlag einer Bahn (Ballmitte)
export const teePos = (n) => [COURSE[n].tee[0], FLOOR + R, COURSE[n].tee[2]];
