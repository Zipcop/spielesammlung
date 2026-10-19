// Billard-Physik ohne Grafik (Rapier): Tisch mit Tuch, Banden und Taschen, Kugeln, ein Stoß Schritt für Schritt.
// Rein – läuft im Browser (table.js zeigt die Kugeln) und mit node --test (test/billard-physik.test.js).
// Maße in Metern, Ursprung = Mitte der Spielfläche, das Tuch liegt auf BED_Y.
import { TABLE, R } from './rules.js';

const { L, W } = TABLE;
export const BED_Y = 0.03;
export const STEP = 1 / 240; // fein, damit schnelle Kugeln sauber abprallen
export const MAX_S = 25; // spätestens dann liegt alles
export const MAX_SPEED = 6.5; // m/s – voller Stoß (Anstoß)
export const CORNER = 0.068; // halbe Öffnung der Ecktaschen entlang der Bande
export const SIDE = 0.064; // halbe Öffnung der Mitteltaschen
export const CUSHION = 0.045; // Breite der Bande
const DECEL = 0.32; // m/s² – Rollwiderstand des Tuchs (dazu eine leichte Dämpfung)
const TOUCH = 0.0015; // m – so nah gilt als Berührung (Treffer, Bande)
const SOUND_NEAR = 0.004; // m – Klang nur, wenn sich wirklich etwas berührt
// Taschen: Mittelpunkt (etwas hinter der Bande) und Fangradius für die Kugelmitte.
// Mitteltaschen fangen enger – sonst fiele eine Kugel, die nur an der Bande vorbeirollt.
export const POCKETS = [
  [-L / 2 - 0.012, -W / 2 - 0.012, 0.055], [0, -W / 2 - 0.022, 0.045], [L / 2 + 0.012, -W / 2 - 0.012, 0.055],
  [-L / 2 - 0.012, W / 2 + 0.012, 0.055], [0, W / 2 + 0.022, 0.045], [L / 2 + 0.012, W / 2 + 0.012, 0.055],
];

// Stoßgeschwindigkeit aus der Kraft 0–1
export const speedOf = (power) => MAX_SPEED * Math.max(0.04, Math.min(power, 1)) ** 1.15;

export function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  // Mehr Löser-Durchläufe: Beim Anstoß muss der Stoß durch alle 5 Reihen des Dreiecks wandern (Standard 4 ist zu weich)
  world.numSolverIterations = 12;
  world.numInternalPgsIterations = 2;
  const queue = new RAPIER.EventQueue(true);
  const kindOf = new Map(); // Collider-Handle → Kugelnummer | 'cushion' | 'bed'
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const box = (hx, hy, hz, x, y, z, kind, friction, restitution) => {
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
      .setFriction(friction).setRestitution(restitution).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
    kindOf.set(c.handle, kind);
  };
  box(L / 2 + 0.2, 0.02, W / 2 + 0.2, 0, BED_Y - 0.02, 0, 'bed', 0.35, 0.3);
  const h = 0.05; // Banden höher als die Kugeln – Stoß immer waagerecht
  const segX = (x0, x1, z) => box((x1 - x0) / 2, h, CUSHION / 2, (x0 + x1) / 2, BED_Y + h, z, 'cushion', 0.1, 0.72);
  for (const s of [-1, 1]) {
    segX(-L / 2 + CORNER, -SIDE, s * (W / 2 + CUSHION / 2));
    segX(SIDE, L / 2 - CORNER, s * (W / 2 + CUSHION / 2));
    box(CUSHION / 2, h, W / 2 - CORNER, s * (L / 2 + CUSHION / 2), BED_Y + h, 0, 'cushion', 0.1, 0.72);
    // Rückwände hinter den Taschen: was nicht gefangen wird, bleibt trotzdem auf dem Tisch
    box(0.02, h, W / 2 + 0.2, s * (L / 2 + 0.09), BED_Y + h, 0, 'cushion', 0.1, 0.4);
    box(L / 2 + 0.2, h, 0.02, 0, BED_Y + h, s * (W / 2 + 0.09), 'cushion', 0.1, 0.4);
  }

  // Neuer Stoß: Kugeln an ihre Plätze, Weiße bekommt Tempo. rotations: Nummer → {x,y,z,w} (nur fürs Aussehen)
  function start(positions, angle, power, rotations = {}) {
    const bodies = new Map();
    for (const [key, [x, z]] of Object.entries(positions)) {
      const n = Number(key);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, BED_Y + R, z)
        .setRotation(rotations[n] ?? { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.15)
        .setAngularDamping(0.6)
        .setCcdEnabled(true));
      const c = world.createCollider(RAPIER.ColliderDesc.ball(R).setDensity(1740).setFriction(0.2).setRestitution(0.93)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, n);
      bodies.set(n, body);
    }
    const speed = speedOf(power);
    bodies.get(0)?.setLinvel({ x: Math.cos(angle) * speed, y: 0, z: -Math.sin(angle) * speed }, true);
    return { bodies, steps: 0, still: 0, first: null, rail: false, pocketed: [], speed: new Map() };
  }

  // Ein Schritt. Liefert die Geräusche dieses Schritts ([Art, Stärke]) und frisch versenkte Kugeln ([n, Tasche])
  function step(shot) {
    shot.steps++;
    for (const [n, b] of shot.bodies) {
      const v = b.linvel();
      shot.speed.set(n, v);
      const flat = Math.hypot(v.x, v.z);
      if (flat > 0) { // Tuch bremst gleichmäßig – so bleiben die Kugeln nach ein paar Sekunden liegen
        const k = Math.max(0, flat - DECEL * STEP) / flat;
        b.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
      }
    }
    world.step(queue);
    // Rapier meldet Kontakte schon kurz vor der Berührung (Vorhersage, schnelle Kugeln). Für die Regeln zählt
    // deshalb nur der echte Abstand nach dem Schritt; die Meldungen dienen nur noch dem Klang.
    const sounds = [];
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      let a = kindOf.get(h1);
      let b = kindOf.get(h2);
      if (typeof a !== 'number') [a, b] = [b, a];
      if (typeof a !== 'number' || b === 'bed' || !shot.bodies.has(a)) return;
      if (typeof b === 'number') {
        if (!shot.bodies.has(b) || gap(shot.bodies.get(a), shot.bodies.get(b)) > SOUND_NEAR) return;
        const va = shot.speed.get(a) ?? { x: 0, z: 0 };
        const vb = shot.speed.get(b) ?? { x: 0, z: 0 };
        sounds.push(['ball', Math.hypot(va.x - vb.x, va.z - vb.z) / 3]);
      } else {
        if (railGap(shot.bodies.get(a)) > SOUND_NEAR) return;
        const v = shot.speed.get(a) ?? { x: 0, z: 0 };
        sounds.push(['cushion', Math.hypot(v.x, v.z) / 3]);
      }
    });
    const cue = shot.bodies.get(0);
    if (shot.first === null && cue) { // erste Kugel, die die Weiße wirklich berührt
      let best = TOUCH;
      for (const [n, b] of shot.bodies) {
        if (n === 0) continue;
        const d = gap(cue, b);
        if (d <= best) [shot.first, best] = [n, d];
      }
    }
    if (shot.first !== null && !shot.rail) { // danach: rollt irgendeine Kugel gegen eine Bande?
      for (const b of shot.bodies.values()) {
        const v = b.linvel();
        if (Math.hypot(v.x, v.z) > 0.02 && railGap(b) <= TOUCH) shot.rail = true;
      }
    }
    const sunk = [];
    for (const [n, b] of shot.bodies) {
      const p = b.translation();
      const pocket = POCKETS.find(([px, pz, r]) => Math.hypot(p.x - px, p.z - pz) < r);
      if (pocket || p.y < BED_Y - 0.1) {
        world.removeRigidBody(b);
        shot.bodies.delete(n);
        shot.pocketed.push(n);
        sunk.push([n, pocket ?? [0, 0]]);
      }
    }
    return { sounds, sunk };
  }

  // Luft zwischen zwei Kugeln (0 = berühren sich)
  function gap(a, b) {
    const p = a.translation();
    const q = b.translation();
    return Math.hypot(p.x - q.x, p.z - q.z) - 2 * R;
  }

  // Luft zwischen Kugel und der nächsten Bande
  function railGap(b) {
    const p = b.translation();
    return Math.min(L / 2 - Math.abs(p.x), W / 2 - Math.abs(p.z)) - R;
  }

  // Liegt alles still (oder ist die Zeit um)?
  function done(shot) {
    const calm = [...shot.bodies.values()].every((b) => {
      const v = b.linvel();
      return Math.hypot(v.x, v.y, v.z) < 0.01;
    });
    shot.still = calm ? shot.still + 1 : 0;
    return shot.still >= 60 || shot.steps * STEP >= MAX_S;
  }

  // Stoß beenden: Kugeln aus der Physik nehmen, Ergebnis für die Regeln
  function finish(shot) {
    const positions = {};
    for (const [n, b] of shot.bodies) {
      const p = b.translation();
      positions[n] = [Math.round(p.x * 10000) / 10000, Math.round(p.z * 10000) / 10000];
      world.removeRigidBody(b);
    }
    shot.bodies.clear();
    return { first: shot.first, rail: shot.rail, pocketed: shot.pocketed, positions };
  }

  // Ganzer Stoß in einem Rutsch (für Tests)
  function simulate(positions, angle, power) {
    const shot = start(positions, angle, power);
    while (!done(shot)) step(shot);
    return { ...finish(shot), seconds: shot.steps * STEP };
  }

  return { start, step, done, finish, simulate };
}
