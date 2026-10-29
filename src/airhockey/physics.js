// Air-Hockey-Physik ohne Grafik (Rapier): Spielfläche mit Banden und Torschlitzen, Puck (CCD) und zwei Schläger.
// Rein – läuft im Browser (Host rechnet verbindlich, der Gast sagt damit voraus) und mit node --test (test/airhockey-physik.test.js).
// Der Tisch liegt flach in der x/z-Ebene, Ursprung = Mitte der Spielfläche. Das Luftkissen trägt den Puck: keine Schwerkraft,
// keine Reibung, nur ein Hauch Luftwiderstand. Die Schläger sind kinematisch: Sie fahren mit begrenztem Tempo zum Ziel (Maus/Computer).
import { TABLE, R, RM, roundCorner } from './rules.js';

const { L, W, GOAL, CORNER } = TABLE;
export const STEP = 1 / 240; // fein, damit der schnelle Puck sauber abprallt
export const MAX_PUCK = 9; // m/s – schneller wird der Puck nicht (echte Profischüsse sind schneller, wären aber nicht spielbar)
export const MAX_MALLET = 6; // m/s – Höchsttempo des Schlägers (Maus)
const DAMPING = 0.08; // je Sekunde – Luft bremst den Puck ein wenig
const H = 0.03; // halbe Höhe der Banden (Puck und Schläger liegen in derselben Ebene)
const POCKET = 0.15; // so tief geht der Schlitz hinter der Torlinie (Puck fällt dort hinein)

// Tor, wenn die Puckmitte ganz hinter der Torlinie im Schlitz ist: liefert den Torschützen (Tor auf +z = Host getroffen → 1)
export const goalOf = (x, z) => (Math.abs(x) < GOAL / 2 && Math.abs(z) > L / 2 + R ? (z > 0 ? 1 : 0) : null);

export function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = STEP;
  const queue = new RAPIER.EventQueue(true);
  const kindOf = new Map(); // Collider-Handle → 'rail' | 0 | 1 (Schläger)
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const box = (hx, hz, x, z) => {
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, H, hz).setTranslation(x, 0, z)
      .setFriction(0).setRestitution(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
    kindOf.set(c.handle, 'rail');
  };
  const T = 0.1; // Dicke der Banden-Körper (dicker als ein Physikschritt des schnellsten Pucks)
  for (const s of [-1, 1]) {
    box(T / 2, L / 2 + POCKET + T, s * (W / 2 + T / 2), 0); // Längsbanden
    const seg = (W / 2 + T - GOAL / 2) / 2; // Stirnbanden links und rechts vom Schlitz (bis in die Ecke)
    for (const sx of [-1, 1]) box(seg, (POCKET + T) / 2, sx * (GOAL / 2 + seg), s * (L / 2 + (POCKET + T) / 2));
    box(GOAL / 2 + 0.01, T / 2, 0, s * (L / 2 + POCKET + T / 2)); // Rückwand hinter dem Schlitz
    for (const sx of [-1, 1]) roundedCorner(sx, s);
  }

  // Gerundete Ecke: Viertelkreis aus 8 konvexen Stücken (Ecke + zwei Bogenpunkte, oben und unten)
  function roundedCorner(sx, sz) {
    const [cx, cz] = [sx * (W / 2 - CORNER), sz * (L / 2 - CORNER)];
    const corner = [sx * (W / 2 + 0.002), sz * (L / 2 + 0.002)];
    const n = 8;
    for (let i = 0; i < n; i++) {
      const pts = [];
      for (const a of [(i / n) * Math.PI / 2, ((i + 1) / n) * Math.PI / 2]) pts.push([cx + sx * Math.cos(a) * CORNER, cz + sz * Math.sin(a) * CORNER]);
      pts.push(corner);
      const flat = new Float32Array(pts.flatMap(([x, z]) => [[x, -H, z], [x, H, z]]).flat());
      const c = world.createCollider(RAPIER.ColliderDesc.convexHull(flat).setFriction(0).setRestitution(0.9)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
      kindOf.set(c.handle, 'rail');
    }
  }

  const puck = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .enabledTranslations(true, false, true)
    .lockRotations()
    .setLinearDamping(DAMPING)
    .setCcdEnabled(true));
  const puckCollider = world.createCollider(RAPIER.ColliderDesc.cylinder(0.003, R).setDensity(1200).setFriction(0).setRestitution(0.9)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), puck);
  kindOf.set(puckCollider.handle, 'puck');

  const mallets = [0, 1].map((p) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, (p === 0 ? 1 : -1) * (L / 2 - 0.2)));
    const c = world.createCollider(RAPIER.ColliderDesc.cylinder(0.02, RM).setFriction(0).setRestitution(0.75)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    kindOf.set(c.handle, p);
    return { body, x: 0, z: body.translation().z, target: [0, body.translation().z], speed: MAX_MALLET, vx: 0, vz: 0 };
  });

  let held = null; // Spieler, der den Puck gerade festhält (Topping, nur ohne Hilfen)
  let parked = false; // Puck liegt im Tor (nach einem Tor bis zum neuen Hinlegen)

  // Puck an eine Stelle legen (ruhend oder mit Tempo)
  function setPuck(x, z, vx = 0, vz = 0) {
    parked = false;
    puck.setTranslation({ x, y: 0, z }, true);
    puck.setLinvel({ x: vx, y: 0, z: vz }, true);
    puckCollider.setEnabled(held === null);
  }

  // Schläger sofort an eine Stelle setzen (Anfang, Vorhersage beim Gast)
  function placeMallet(p, x, z) {
    const m = mallets[p];
    m.body.setTranslation({ x, y: 0, z }, true);
    m.body.setNextKinematicTranslation({ x, y: 0, z });
    Object.assign(m, { x, z, vx: 0, vz: 0, target: [x, z] });
  }

  // Ziel des Schlägers (Maus, Computer, Netz) und sein Höchsttempo
  function setTarget(p, [x, z], speed = MAX_MALLET) {
    mallets[p].target = [x, z];
    mallets[p].speed = speed;
  }

  // Topping an/aus: geht nur, wenn der Schläger den Puck berührt. Loslassen legt den Puck ruhend vor den Schläger.
  function hold(p, on) {
    if (on && held === null && !parked) {
      const q = puck.translation();
      if (Math.hypot(q.x - mallets[p].x, q.z - mallets[p].z) > RM + R + 0.01) return false;
      held = p;
      puckCollider.setEnabled(false);
      return true;
    }
    if (!on && held === p) {
      held = null;
      const m = mallets[p];
      const dir = p === 0 ? -1 : 1; // Richtung zum Tor des anderen
      const z = m.z + dir * (RM + R + 0.003);
      const x = Math.min(Math.max(m.x, -W / 2 + R), W / 2 - R);
      setPuck(x, Math.min(Math.max(z, -L / 2 + R), L / 2 - R));
      return true;
    }
    return false;
  }

  // Ein Schritt. Liefert Geräusche ([Art, Stärke]: 'rail' | 'mallet' | 'goal') und ggf. das Tor (Schütze 0/1)
  function step() {
    for (const [p, m] of mallets.entries()) { // Schläger fährt höchstens mit seinem Tempo zum Ziel
      const dx = m.target[0] - m.x;
      const dz = m.target[1] - m.z;
      const d = Math.hypot(dx, dz);
      const k = d > m.speed * STEP ? (m.speed * STEP) / d : 1;
      m.vx = (dx * k) / STEP;
      m.vz = (dz * k) / STEP;
      m.x += dx * k;
      m.z += dz * k;
      if (held !== p) blocked(m);
      m.body.setNextKinematicTranslation({ x: m.x, y: 0, z: m.z });
      if (held === p) {
        puck.setTranslation({ x: m.x, y: 0, z: m.z }, true);
        puck.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    const before = puck.linvel();
    world.step(queue);
    const sounds = [];
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = kindOf.get(h1);
      const b = kindOf.get(h2);
      const other = a === 'puck' ? b : b === 'puck' ? a : undefined;
      if (other === undefined) return;
      const v = puck.linvel();
      const m = typeof other === 'number' ? mallets[other] : null;
      // Stärke: Tempo, mit dem Puck und Bande bzw. Schläger aufeinandertreffen
      const rel = m ? Math.hypot(before.x - m.vx, before.z - m.vz) : Math.hypot(before.x - v.x, before.z - v.z) / 2;
      sounds.push([m ? 'mallet' : 'rail', Math.min(rel / 5, 1), m ? other : -1]);
    });
    let v = puck.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (speed > MAX_PUCK) puck.setLinvel({ x: (v.x * MAX_PUCK) / speed, y: 0, z: (v.z * MAX_PUCK) / speed }, true);
    keepOnTable();
    if (parked || held !== null) return { sounds, goal: null };
    const q = puck.translation();
    const scorer = goalOf(q.x, q.z);
    if (scorer === null) return { sounds, goal: null };
    parked = true; // Puck fällt in den Schlitz: liegt still, bis er neu hingelegt wird
    puckCollider.setEnabled(false);
    v = puck.linvel();
    sounds.push(['goal', Math.min(Math.hypot(v.x, v.z) / 5 + 0.4, 1), -1]);
    puck.setLinvel({ x: 0, y: 0, z: 0 }, true);
    return { sounds, goal: scorer };
  }

  // Liegt der Puck an einer Bande, kann ihn der Schläger nicht wegdrücken: Er stößt an und bleibt davor stehen
  // (sonst schöbe sich der kinematische Schläger über den eingeklemmten Puck)
  function blocked(m) {
    if (parked || held !== null) return;
    const q = puck.translation();
    const [rx, rz] = roundCorner(q.x, q.z, R + 0.004);
    const atWall = Math.abs(q.x) > W / 2 - R - 0.004 || (Math.abs(q.z) > L / 2 - R - 0.004 && Math.abs(q.x) > GOAL / 2 - R) || rx !== q.x || rz !== q.z;
    const dx = m.x - q.x;
    const dz = m.z - q.z;
    const d = Math.hypot(dx, dz);
    if (!atWall || d >= RM + R - 0.001 || d < 1e-6) return;
    const k = (RM + R - 0.001) / d;
    const before = [m.x, m.z];
    m.x = q.x + dx * k;
    m.z = q.z + dz * k;
    m.vx += (m.x - before[0]) / STEP;
    m.vz += (m.z - before[1]) / STEP;
  }

  // Zwischen Schläger und Bande eingeklemmt, kann der Puck durch die Bande gedrückt werden – dann zurück aufs Feld
  function keepOnTable() {
    const q = puck.translation();
    const inSlot = Math.abs(q.x) < GOAL / 2 - R * 0.2;
    const maxX = W / 2 - R;
    const maxZ = inSlot ? L / 2 + POCKET - R : L / 2 - R;
    if (Math.abs(q.x) <= maxX + 0.002 && Math.abs(q.z) <= maxZ + 0.002) return;
    const v = puck.linvel();
    const x = Math.min(Math.max(q.x, -maxX), maxX);
    const z = Math.min(Math.max(q.z, -maxZ), maxZ);
    puck.setTranslation({ x, y: 0, z }, true);
    puck.setLinvel({ x: x !== q.x ? -v.x * 0.5 : v.x, y: 0, z: z !== q.z ? -v.z * 0.5 : v.z }, true);
  }

  const puckState = () => {
    const q = puck.translation();
    const v = puck.linvel();
    return { x: q.x, z: q.z, vx: v.x, vz: v.z };
  };

  return {
    STEP,
    setPuck,
    placeMallet,
    setTarget,
    hold,
    step,
    puck: puckState,
    mallet: (p) => ({ x: mallets[p].x, z: mallets[p].z, vx: mallets[p].vx, vz: mallets[p].vz }),
    held: () => held,
    parked: () => parked,
    // Puck nach dem Tor aus dem Spiel nehmen (er bleibt im Schlitz liegen)
    park() {
      parked = true;
      puck.setLinvel({ x: 0, y: 0, z: 0 }, true);
      puckCollider.setEnabled(false); // ruhender Puck lässt sich nicht anspielen
    },
    free() {
      queue.free();
      world.free();
    },
  };
}
