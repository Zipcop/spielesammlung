// Mäxchen-Tisch: runde Filzmatte, darauf Bierdeckel mit Lederbecher (umgedreht) und zwei Würfeln darunter, vor jedem
// Platz ein Lebenswürfel (zeigt die Leben). Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor).
// Würfeln mit echter Physik (Rapier) wie bei Kniffel – aber so, wie man Mäxchen spielt: Becher samt Deckel anheben,
// schütteln (von selbst oder mit gedrückter Maustaste), auf den Tisch knallen; die Würfel klappern darin und bleiben
// darunter liegen. Physik rechnet nur, wer würfelt (beim Host auch für die Computer); gestreamt wird nur die Lage des
// Bechers, nie die der Würfel – was unter dem Becher liegt, erfährt ein PC nur aus seiner Sicht vom Host.
// Sitze wie bei Doppelkopf: 0 = +z (Host), 1 = −x, 2 = −z (Gast), 3 = +x. Maße in cm (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { feltOf, diceFaces, woodTexture, canvasTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { randomQuat, randomTurn } from '../wuerfel.js';

const DIE = 2.0; // Kantenlänge der Spielwürfel
const DIE_R = 0.25;
const LIFE = 1.7; // Lebenswürfel
const MAT = { r: 22, h: 0.5 }; // Filzmatte in der Tischmitte (Oberkante = Boden der Physik)
const COASTER = { r: 5.4, h: 0.25 }; // Bierdeckel
const CUP = { r: 4.4, h: 8, wall: 0.45, sides: 14 }; // Lederbecher
const SPOT_R = 12; // so weit steht der Becher von der Mitte zum Spieler am Zug hin
const LIFE_AT = new THREE.Vector3(14.5, 0, 24); // Lebenswürfel: rechts vor dem Platz (aus Sicht des Sitzes auf +z)
const CARD = { w: 5.5, h: 0.15, d: 7 }; // Kärtchen „Leben“ unter dem Lebenswürfel – sonst wirkt er wie ein verlorener Würfel
const LIFE_Y = CARD.h + LIFE / 2;
const TOWARD = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung +z-Platz → Platz des Sitzes
const STEP = 1 / 120;
const SEND_EVERY = 4; // 30 Lagen pro Sekunde
const MAX_STEPS = 6 / STEP;
const LIFT_H = 10; // so hoch wird der Becher zum Schütteln gehoben
const LIFT_S = 0.25;
const SHAKE_S = 0.9;
const SLAM_S = 0.16; // auf den Tisch knallen
const COVER_S = 0.3; // Becher wieder über die Würfel stülpen
const SLIDE_S = 0.5; // Becher zum Nächsten schieben
const CUP_S = 0.35; // Becher anheben / beiseite stellen
const HAND_R = 9; // so weit darf man den Becher beim Schütteln vom Platz wegziehen
const HAND_SPEED = 240; // cm/s
// höchstens so stark beschleunigt der Becher: Ruckte er beim Schütteln mit der Maus von +240 auf −240 cm/s, rutschten
// Würfel durch die Wand (Review 20.10.2026: 6 % bei 5 Hz, mit dieser Grenze 0 von 200)
const ACCEL = 3000; // cm/s²
const INSIDE = CUP.r - CUP.wall - DIE / 2; // so weit darf eine Würfelmitte unter dem Becher von der Mitte weg sein
const HIT_SPEED = 120;
const KINDS = ['die', 'wood', 'felt'];

const FACE_VALUES = [2, 5, 1, 6, 3, 4]; // Seiten +x, −x, +y, −y, +z, −z
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
const UP = new THREE.Vector3(0, 1, 0);
// Würfel unter dem Becher, wenn die echte Lage hier nicht bekannt ist (anderer PC hat gewürfelt)
const DEFAULT_SPOTS = [[-1.25, 0.45, 0.35], [1.2, -0.5, 1.15]]; // x, z, Drehung

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const spotOf = (seat) => new THREE.Vector3(TOWARD[seat][0] * SPOT_R, MAT.h, TOWARD[seat][1] * SPOT_R);
const dirOf = (seat) => new THREE.Vector3(TOWARD[seat][0], 0, TOWARD[seat][1]);

function topFace(q) {
  let best = 0;
  let up = -2;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > up) [best, up] = [i, y];
  });
  return { value: FACE_VALUES[best], up };
}
const upright = (value, yaw = 0) => new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(value)], UP)
  .premultiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));

export function createMaexchenBoard(parent, { onStream = () => {} } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const felt = buildMat(group);

  // Becher-Einheit: Bierdeckel + Becher + Würfel, steht vor dem Spieler am Zug
  const unit = new THREE.Group();
  group.add(unit);
  const coaster = buildCoaster(unit);
  const cup = buildCup(unit);
  const geometry = new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE_R);
  const material = (style) => FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({
    ...diceFaces(style)[v - 1], bumpScale: 1.3, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25,
  }));
  const dice = [0, 1].map(() => {
    const m = new THREE.Mesh(geometry, material('weiss'));
    m.castShadow = m.receiveShadow = true;
    unit.add(m);
    return m;
  });
  const lifeGeometry = new RoundedBoxGeometry(LIFE, LIFE, LIFE, 3, 0.22);
  const cardGeometry = new THREE.BoxGeometry(CARD.w, CARD.h, CARD.d);
  const cardMaterials = lifeCardMaterials();
  // je Platz: Kärtchen mit Würfel, zum Spieler gedreht (der Schriftzug liegt auf seiner Seite)
  const lives = [0, 1, 2, 3].map((seat) => {
    const holder = new THREE.Group();
    holder.position.copy(LIFE_AT).applyAxisAngle(UP, SIDE[seat]);
    holder.rotation.y = SIDE[seat];
    const card = new THREE.Mesh(cardGeometry, cardMaterials);
    card.position.y = CARD.h / 2;
    card.receiveShadow = true;
    const m = new THREE.Mesh(lifeGeometry, material('rot'));
    m.castShadow = m.receiveShadow = true;
    m.position.set(0, LIFE_Y, -1.4);
    holder.add(card, m);
    group.add(holder);
    return { holder, mesh: m, seat, value: null, anim: null };
  });

  let view = null;
  let me = 0;
  let local = null; // echte Lage der Würfel nach eigenem Wurf: { values, poses: [{ pos, quat }] } (unit-lokal)
  let unitMove = null; // Becher-Einheit gleitet zum nächsten Platz
  let cupAnim = null; // Becher hebt sich / stülpt sich
  let cupGoal = 'closed';
  let roll = null; // eigener Wurf mit Physik
  let remote = null; // Wurf eines anderen PCs: { pos, quat }
  let tell = null; // jemand linst – der Becher lupft kurz
  let releaseEarly = false;
  let hover = false;
  let generation = 0; // zählt reset() mit – ein Wurf, der beim Laden der Physik wartet, merkt so das Verlassen
  let stale = null; // ein anderer PC würfelt neu: Nummer (seq) der Sicht, die jetzt veraltet ist – nichts Altes aufdecken

  // --- Physik (wird beim ersten Wurf geladen) ---
  let RAPIER = null;
  let world = null;
  let queue = null;
  let loading = null;
  const kindOf = new Map();

  function ready() {
    loading ??= (async () => {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: -981, z: 0 });
      world.timestep = STEP;
      world.lengthUnit = 100;
      queue = new RAPIER.EventQueue(true);
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      kindOf.set(world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, MAT.h - 0.5, 0)
        .setFriction(0.8).setRestitution(0.2), fixed).handle, 'felt');
    })();
    return loading;
  }

  // Becher + Deckel als geschlossener, bewegter Körper (Ursprung = Unterseite des Deckels, wie unit)
  function createContainer(at) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z));
    const add = (desc, kind) => kindOf.set(world.createCollider(desc.setFriction(0.5).setRestitution(0.25), body).handle, kind);
    add(RAPIER.ColliderDesc.cylinder(COASTER.h / 2 + 0.25, COASTER.r).setTranslation(0, COASTER.h / 2 - 0.25, 0), 'felt'); // Deckel (unten dicker, nichts rutscht durch)
    const r = CUP.r;
    const width = 2 * r * Math.tan(Math.PI / CUP.sides) + 0.2;
    for (let k = 0; k < CUP.sides; k++) {
      const a = (k / CUP.sides) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, -a);
      add(RAPIER.ColliderDesc.cuboid(CUP.wall / 2, CUP.h / 2, width / 2)
        .setTranslation(Math.cos(a) * (r - CUP.wall / 2), COASTER.h + CUP.h / 2, Math.sin(a) * (r - CUP.wall / 2)).setRotation(q), 'felt');
    }
    add(RAPIER.ColliderDesc.cylinder(0.5, r).setTranslation(0, COASTER.h + CUP.h - 0.5, 0), 'felt'); // Becherboden (oben)
    return body;
  }

  // Eigener Wurf für seat. mode 'auto' = schüttelt von selbst · 'hand' = folgt der Maus (drag), release = knallen.
  // Liefert die beiden Augenzahlen, sobald alles ruhig liegt.
  async function throwDice(seat, mode = 'auto') {
    releaseEarly = mode === 'auto';
    const at = generation;
    await ready();
    if (roll || at !== generation) return null; // inzwischen zurückgesetzt (Spiel verlassen) – kein Geister-Wurf
    finishMoves();
    const rest = spotOf(seat);
    return new Promise((resolve) => {
      roll = {
        seat, mode, resolve, rest, phase: cupGoal === 'closed' && cup.position.distanceTo(closedPose().pos) < 0.05 ? 'lift' : 'cover',
        t: 0, released: releaseEarly, target: rest.clone().setY(rest.y + LIFT_H), vel: new THREE.Vector3(),
        body: null, bodies: [], acc: 0, steps: 0, freeSteps: 0, still: 0, nudges: 0, hits: [], lastHit: [], speed: [],
        coverFrom: { pos: cup.position.clone(), quat: cup.quaternion.clone() },
      };
      cupGoal = 'closed';
      cupAnim = null;
      tell = null;
      onStream({ t: 'mx', start: seat });
    });
  }

  function startPhysics() {
    roll.body = createContainer(roll.rest);
    dice.forEach((d, i) => {
      if (d.position.clone().setY(0).length() > INSIDE) d.position.set(DEFAULT_SPOTS[i][0], 0, DEFAULT_SPOTS[i][1]);
      // die Würfel liegen schon unter dem Becher – zufällige Lage, damit der Startwurf nichts vorgibt
      const p = d.position.clone().setY(COASTER.h + DIE / 2 + 0.3).add(roll.rest);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(randomQuat()) // Euler-Winkel waren nicht gleichverteilt: von Hand kamen 3 und 4 nur bei je 12 %
        .setAngvel({ x: rand(-6, 6), y: rand(-6, 6), z: rand(-6, 6) })
        .setLinearDamping(0.1).setAngularDamping(0.4));
      const half = DIE / 2 - DIE_R;
      const c = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half, half, half, DIE_R).setRotation(randomTurn()) // s. wuerfel.js
        .setDensity(1.2).setFriction(0.45).setRestitution(0.35).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, i);
      roll.bodies[i] = body;
    });
    roll.phase = 'lift';
    roll.t = 0;
  }

  // Wohin der Becher in diesem Schritt soll
  function moveContainer() {
    const now = roll.body.translation();
    const pos = new THREE.Vector3(now.x, now.y, now.z);
    const quat = new THREE.Quaternion();
    const top = roll.rest.clone().setY(roll.rest.y + LIFT_H);
    roll.t += STEP;
    if (roll.phase === 'lift') {
      const k = smooth(Math.min(roll.t / LIFT_S, 1));
      pos.lerpVectors(roll.rest, top, k);
      if (k === 1) [roll.phase, roll.t] = [roll.mode === 'auto' ? 'shake' : 'hand', 0];
    } else if (roll.phase === 'shake' || roll.phase === 'hand') {
      let goal;
      if (roll.phase === 'shake') {
        const t = roll.t;
        goal = top.clone().add(new THREE.Vector3(3 * Math.sin(t * 19), 2.2 * Math.sin(t * 26) ** 2, 2.2 * Math.sin(t * 14 + 1)));
        quat.setFromEuler(new THREE.Euler(0.18 * Math.sin(t * 17), 0, 0.18 * Math.sin(t * 21 + 2)));
        if (t >= SHAKE_S) startSlam(pos);
      } else {
        goal = roll.target.clone();
        if (roll.released) startSlam(pos);
      }
      const off = goal.clone().sub(roll.rest).setY(0);
      if (off.length() > HAND_R) goal.sub(off).add(off.setLength(HAND_R));
      // zum Ziel mit begrenzter Beschleunigung (rechtzeitig bremsen statt überschießen)
      const to = goal.sub(pos);
      const want = to.clone().setLength(Math.min(HAND_SPEED, Math.sqrt(2 * ACCEL * to.length()), to.length() / STEP));
      const dv = want.sub(roll.vel);
      if (dv.length() > ACCEL * STEP) dv.setLength(ACCEL * STEP);
      roll.vel.add(dv);
      pos.addScaledVector(roll.vel, STEP);
    }
    if (roll.phase === 'slam') {
      const k = Math.min(roll.t / SLAM_S, 1);
      pos.lerpVectors(roll.slamFrom, roll.rest, k * k); // beschleunigt nach unten
      if (k === 1) {
        roll.phase = 'settle';
        playHit('wood', 0.9);
        roll.hits.push([1, 0.9]);
      }
    }
    roll.body.setNextKinematicTranslation(pos);
    roll.body.setNextKinematicRotation(quat);
  }

  function startSlam(pos) {
    roll.phase = 'slam';
    roll.t = 0;
    roll.slamFrom = pos.clone();
  }

  function stepPhysics(dt) {
    roll.acc = Math.min(roll.acc + dt, 8 * STEP);
    while (roll && roll.acc >= STEP) {
      roll.acc -= STEP;
      roll.steps++;
      if (roll.phase === 'cover') {
        roll.t += STEP / COVER_S;
        const k = smooth(Math.min(roll.t, 1));
        const goal = closedPose();
        cup.position.lerpVectors(roll.coverFrom.pos, goal.pos, k);
        cup.position.y += Math.sin(k * Math.PI) * 5;
        cup.quaternion.slerpQuaternions(roll.coverFrom.quat, goal.quat, k);
        if (roll.t >= 1) startPhysics();
      } else {
        if (!roll.body) startPhysics();
        if (roll.phase !== 'settle') moveContainer();
        roll.bodies.forEach((b, i) => (roll.speed[i] = b.linvel()));
        world.step(queue);
        queue.drainCollisionEvents((h1, h2, started) => started && collide(kindOf.get(h1), kindOf.get(h2)));
        const p = roll.body.translation();
        unit.position.set(p.x, p.y, p.z);
        unit.quaternion.copy(roll.body.rotation());
        const inv = unit.quaternion.clone().invert();
        roll.bodies.forEach((b, i) => {
          const t = b.translation();
          dice[i].position.set(t.x, t.y, t.z).sub(unit.position).applyQuaternion(inv);
          dice[i].quaternion.copy(inv).multiply(new THREE.Quaternion().copy(b.rotation()));
        });
        if (roll.phase === 'settle') {
          roll.freeSteps++;
          checkSettled();
        }
      }
      if (roll && roll.steps % SEND_EVERY === 0) {
        onStream({ t: 'mx', c: pose(unit), s: roll.hits });
        roll.hits = [];
      }
    }
  }

  function collide(a, b) {
    if (typeof a !== 'number') [a, b] = [b, a];
    if (typeof a !== 'number') return;
    const va = roll.speed[a];
    const vb = typeof b === 'number' ? roll.speed[b] : roll.body.linvel();
    if (!va || !vb || roll.steps - (roll.lastHit[a] ?? -99) < 4) return;
    roll.lastHit[a] = roll.steps;
    const kind = typeof b === 'number' ? 'die' : 'felt'; // Leder und Pappe klingen dumpf
    const strength = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) / HIT_SPEED;
    playHit(kind, strength * 0.8);
    roll.hits.push([KINDS.indexOf(kind), round(strength * 0.8, 2)]);
  }

  function checkSettled() {
    const calm = roll.bodies.every((b) => {
      const v = b.linvel();
      const w = b.angvel();
      return Math.hypot(v.x, v.y, v.z) < 0.6 && Math.hypot(w.x, w.y, w.z) < 0.3;
    });
    roll.still = calm ? roll.still + 1 : 0;
    if (roll.still < 24 && roll.freeSteps < MAX_STEPS) return;
    // schräg an der Becherwand oder auf dem anderen Würfel? Kurz anstupsen (wie den Becher nochmal rütteln)
    const bad = dice.filter((d) => topFace(d.quaternion).up < 0.98 || d.position.y > COASTER.h + DIE / 2 + 0.35);
    if (bad.length && roll.nudges < 6 && roll.freeSteps < MAX_STEPS) {
      roll.nudges++;
      roll.still = 0;
      for (const d of bad) {
        const b = roll.bodies[dice.indexOf(d)];
        const m = b.mass();
        b.applyImpulse({ x: -d.position.x * 8 * m, y: 70 * m, z: -d.position.z * 8 * m }, true);
        b.applyTorqueImpulse({ x: rand(-0.6, 0.6) * m, y: rand(-0.6, 0.6) * m, z: rand(-0.6, 0.6) * m }, true);
      }
      return;
    }
    const { resolve, body, bodies } = roll;
    for (const b of [body, ...bodies]) world.removeRigidBody(b);
    unit.quaternion.identity();
    unit.position.copy(roll.rest);
    const values = dice.map((d, i) => {
      const v = topFace(d.quaternion).value;
      // doch herausgerutscht? Dann liegt er wieder unter dem Becher (mit der Zahl, die oben lag)
      if (d.position.clone().setY(0).length() > INSIDE + 0.5) d.position.set(DEFAULT_SPOTS[i][0], 0, DEFAULT_SPOTS[i][1]);
      d.quaternion.copy(upright(v, yawOf(d.quaternion))); // ganz flach hinlegen
      d.position.y = COASTER.h + DIE / 2;
      return v;
    });
    local = { values, poses: dice.map((d) => ({ pos: d.position.clone(), quat: d.quaternion.clone() })) };
    onStream({ t: 'mx', c: pose(unit), s: roll.hits, final: true });
    roll = null;
    resolve(values);
  }

  const pose = (m) => [
    round(m.position.x, 2), round(m.position.y, 2), round(m.position.z, 2),
    round(m.quaternion.x, 4), round(m.quaternion.y, 4), round(m.quaternion.z, 4), round(m.quaternion.w, 4),
  ];

  // Maus → Ziel des Bechers (Ebene in Schüttelhöhe)
  function drag(raycaster) {
    if (!roll) return;
    const height = group.localToWorld(new THREE.Vector3(0, MAT.h + LIFT_H + CUP.h / 2, 0)).y;
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
    if (!hit) return;
    const p = group.worldToLocal(hit);
    roll.target.set(p.x, MAT.h + LIFT_H, p.z);
  }

  // --- Wurf eines anderen PCs: nur der Becher wird gezeigt, die Würfel darunter bleiben unsichtbar ---
  function applyRemote(msg) {
    if (Number.isInteger(msg.tell) && TOWARD[msg.tell]) return startTell(msg.tell);
    if (Number.isInteger(msg.start)) {
      stale = view?.seq ?? -1;
      local = null; // die Würfel hier sind nicht mehr die echten
      dice.forEach((d) => (d.visible = false));
      cupGoal = 'closed';
      cupAnim = { from: { pos: cup.position.clone(), quat: cup.quaternion.clone() }, to: closedPose(), t: 0, arc: 5 };
      return;
    }
    const ok = Array.isArray(msg.c) && msg.c.length === 7 && msg.c.every(Number.isFinite);
    if (!ok) return;
    unitMove = null;
    remote ??= { pos: unit.position.clone(), quat: unit.quaternion.clone() };
    remote.pos.fromArray(msg.c, 0);
    remote.quat.fromArray(msg.c, 3).normalize();
    for (const hit of Array.isArray(msg.s) ? msg.s : []) {
      if (Array.isArray(hit) && KINDS[hit[0]] && Number.isFinite(hit[1])) playHit(KINDS[hit[0]], hit[1]);
    }
    if (!msg.final) return;
    unit.position.copy(remote.pos);
    unit.quaternion.copy(remote.quat);
    remote = null;
    show();
  }

  // --- Anzeige passend zur Sicht ---
  // Becher-Lagen (unit-lokal): zu = auf dem Deckel · gelupft = zur Seite dir angehoben · auf = neben dem Deckel
  const closedPose = () => ({ pos: new THREE.Vector3(0, COASTER.h, 0), quat: new THREE.Quaternion() });
  function tiltPose(dir, angle) {
    const axis = new THREE.Vector3(-dir.z, 0, dir.x);
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const pivot = dir.clone().multiplyScalar(-CUP.r).setY(COASTER.h);
    return { pos: pivot.add(dir.clone().multiplyScalar(CUP.r).applyQuaternion(quat)), quat };
  }
  function openPose() {
    const d = dirOf(view?.turn ?? me);
    return { pos: new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(COASTER.r + CUP.r + 1.5), quat: new THREE.Quaternion() };
  }

  // Was sieht dieser PC gerade unter dem Becher? → { goal, values }
  function look() {
    const v = view;
    if (!v || stale !== null) return { goal: 'closed', values: null };
    if (v.shown) return { goal: 'open', values: v.shown.dice };
    const mine = v.turn === me && v.dice && (v.phase === 'announce' || v.peeked.includes(me));
    return mine ? { goal: 'peek', values: v.dice } : { goal: 'closed', values: null };
  }

  function show() {
    if (roll || remote) return;
    const { goal, values } = look();
    // Würfel: echte Lage, wenn dieser PC gewürfelt hat, sonst feste Plätze – mit den Augen aus der Sicht
    dice.forEach((d, i) => {
      d.visible = !!values;
      if (!values) return;
      if (local && local.values[i] === values[i]) {
        d.position.copy(local.poses[i].pos);
        d.quaternion.copy(local.poses[i].quat);
      } else {
        const [x, z, yaw] = DEFAULT_SPOTS[i];
        d.position.set(x, COASTER.h + DIE / 2, z);
        d.quaternion.copy(upright(values[i], yaw));
      }
    });
    if (goal !== cupGoal) {
      const to = goal === 'open' ? openPose() : goal === 'peek' ? tiltPose(dirOf(me), 1.3) : closedPose();
      cupAnim = { from: { pos: cup.position.clone(), quat: cup.quaternion.clone() }, to, t: 0, arc: goal === 'open' || cupGoal === 'open' ? 6 : 0 };
      cupGoal = goal;
      tell = null;
    }
  }

  function sync(v, seat) {
    view = v;
    if (v?.seq !== stale) stale = null;
    me = seat;
    if (v) {
      v.lives.forEach((n, p) => setLife(p, v.seats.includes(p) ? n : 0));
      const at = v.turn ?? null;
      if (at !== null && !roll && !remote) {
        const to = spotOf(at);
        const goal = unitMove?.to ?? unit.position;
        if (goal.distanceTo(to) > 0.01) unitMove = { from: unit.position.clone(), to, t: 0 };
      }
    }
    show();
  }

  // Lebenswürfel: zeigt die Leben, kippt bei jedem verlorenen auf die neue Zahl; wer draußen ist, dessen Würfel fehlt
  function setLife(seat, n) {
    const l = lives[seat];
    if (l.value === n) return;
    const was = l.value;
    l.value = n;
    l.holder.visible = n > 0;
    if (n <= 0) return;
    const to = upright(n, 0.3);
    if (was === null) l.mesh.quaternion.copy(to);
    else l.anim = { from: l.mesh.quaternion.clone(), to, t: 0 };
  }

  // Jemand linst unter den Becher: kurz anheben (wer hinschaut, sieht es)
  function startTell(seat) {
    if (roll || cupGoal !== 'closed') return;
    tell = { dir: dirOf(seat), t: 0 };
  }

  function finishMoves() {
    if (unitMove) unit.position.copy(unitMove.to);
    unitMove = null;
    if (cupAnim) {
      cup.position.copy(cupAnim.to.pos);
      cup.quaternion.copy(cupAnim.to.quat);
    }
    cupAnim = null;
  }

  function updateAnims(dt) {
    if (unitMove) {
      unitMove.t = Math.min(unitMove.t + dt / SLIDE_S, 1);
      unit.position.lerpVectors(unitMove.from, unitMove.to, smooth(unitMove.t));
      unit.position.y += Math.sin(unitMove.t * Math.PI) * 1.5;
      if (unitMove.t === 1) unitMove = null;
    }
    if (cupAnim) {
      cupAnim.t = Math.min(cupAnim.t + dt / CUP_S, 1);
      const k = smooth(cupAnim.t);
      cup.position.lerpVectors(cupAnim.from.pos, cupAnim.to.pos, k);
      cup.position.y += Math.sin(cupAnim.t * Math.PI) * cupAnim.arc;
      cup.quaternion.slerpQuaternions(cupAnim.from.quat, cupAnim.to.quat, k);
      if (cupAnim.t === 1) cupAnim = null;
    } else if (tell) {
      tell.t += dt / 1.1;
      const k = Math.sin(Math.min(tell.t, 1) * Math.PI);
      const p = tiltPose(tell.dir, 0.2 * k);
      cup.position.copy(p.pos);
      cup.quaternion.copy(p.quat);
      if (tell.t >= 1) tell = null;
    }
    for (const l of lives) {
      if (!l.anim) continue;
      l.anim.t = Math.min(l.anim.t + dt / 0.6, 1);
      l.mesh.quaternion.slerpQuaternions(l.anim.from, l.anim.to, smooth(l.anim.t));
      l.mesh.position.y = LIFE_Y + Math.sin(l.anim.t * Math.PI) * 4;
      if (l.anim.t === 1) l.anim = null;
    }
  }

  function reset() {
    generation++;
    if (roll) {
      for (const b of [roll.body, ...roll.bodies]) if (b) world.removeRigidBody(b);
      roll = null;
    }
    remote = null;
    unitMove = null;
    cupAnim = null;
    tell = null;
    view = null;
    local = null;
    stale = null;
    cupGoal = 'closed';
    unit.position.copy(spotOf(0));
    unit.quaternion.identity();
    const c = closedPose();
    cup.position.copy(c.pos);
    cup.quaternion.copy(c.quat);
    dice.forEach((d, i) => {
      const [x, z, yaw] = DEFAULT_SPOTS[i];
      d.position.set(x, COASTER.h + DIE / 2, z);
      d.quaternion.copy(upright(i ? 1 : 2, yaw));
      d.visible = false;
    });
    lives.forEach((l) => {
      l.value = null;
      l.anim = null;
      l.mesh.position.y = LIFE_Y;
      setLife(l.seat, 6);
    });
    setHover(false);
  }

  function setHover(on) {
    if (on === hover) return;
    hover = on;
    setGlow('hover', on ? [cup.children[0]] : []);
  }

  reset();

  return {
    group,
    ready,
    sync,
    roll: (seat) => throwDice(seat, 'auto'),
    grab: (seat) => throwDice(seat, 'hand'),
    drag,
    release() {
      if (roll) roll.released = true;
      else releaseEarly = true;
    },
    // Linsen: hier kurz lupfen und dem anderen PC Bescheid geben
    tell(seat) {
      startTell(seat);
      onStream({ t: 'mx', tell: seat });
    },
    applyRemote,
    hitCup: (raycaster) => raycaster.intersectObject(unit, true).length > 0,
    setHover,
    busy: () => !!(roll || remote || unitMove || cupAnim),
    rolling: () => !!roll,
    loose: () => [unit, ...lives.map((l) => l.holder)], // Becher samt Deckel und Würfeln fliegt als Ganzes (tisch.js)
    setDesign(s) {
      const f = diceFaces(s.dice);
      for (const d of dice) d.material.forEach((m, k) => Object.assign(m, f[FACE_VALUES[k] - 1], { needsUpdate: true }));
      const lf = diceFaces(s.dice === 'rot' ? 'weiss' : 'rot'); // Lebenswürfel heben sich von den Spielwürfeln ab
      for (const l of lives) l.mesh.material.forEach((m, k) => Object.assign(m, lf[FACE_VALUES[k] - 1], { needsUpdate: true }));
      felt.map = feltOf(s.felt);
      felt.needsUpdate = true;
    },
    reset,
    update(dt) {
      if (roll) stepPhysics(dt);
      else if (remote) {
        const k = 1 - Math.exp(-dt * 30);
        unit.position.lerp(remote.pos, k);
        unit.quaternion.slerp(remote.quat, k);
        updateAnims(dt);
      } else updateAnims(dt);
    },
  };
}

const yawOf = (q) => {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  if (Math.abs(f.y) > 0.7) f.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(-f.z, f.x);
};

// Kärtchen „Leben“: Pappe, oben bedruckt (Schrift zum Spieler hin, der Würfel steht auf dem freien Feld dahinter)
function lifeCardMaterials() {
  const print = canvasTexture(256, 320, (g, w) => {
    g.fillStyle = '#efe4c8';
    g.fillRect(0, 0, w, 320);
    g.strokeStyle = '#8c1d18';
    g.lineWidth = 8;
    g.strokeRect(12, 12, w - 24, 296);
    g.fillStyle = '#8c1d18';
    g.font = 'bold 54px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Leben', w / 2, 262);
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xd9ccaa, roughness: 0.95 });
  return [side, side, new THREE.MeshStandardMaterial({ map: print, roughness: 0.9 }), side, side, side];
}

// Runde Filzmatte mit Holzrand – darauf wird gewürfelt
function buildMat(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.45 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(MAT.r + 1, MAT.r + 1.2, MAT.h, 64), wood);
  rim.position.y = MAT.h / 2;
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const top = new THREE.Mesh(new THREE.CircleGeometry(MAT.r, 64).rotateX(-Math.PI / 2), feltMat);
  top.position.y = MAT.h + 0.02;
  for (const m of [rim, top]) {
    m.receiveShadow = true;
    group.add(m);
  }
  return feltMat;
}

// Bierdeckel: Pappe mit Rand und Schriftzug
function buildCoaster(unit) {
  const print = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#efe4c8';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#8c1d18';
    g.lineWidth = 18;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 30, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 58, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#8c1d18';
    g.font = 'bold 86px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Mäxchen', w / 2, w / 2 - 20);
    g.font = 'italic 46px Georgia, serif';
    g.fillText('2 · 1', w / 2, w / 2 + 62);
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xd9ccaa, roughness: 0.95 });
  const top = new THREE.MeshStandardMaterial({ map: print, roughness: 0.9 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(COASTER.r, COASTER.r, COASTER.h, 48), [side, top, side]);
  m.position.y = COASTER.h / 2;
  m.rotation.y = Math.PI / 2; // Schriftzug lesbar für den Host
  m.castShadow = m.receiveShadow = true;
  unit.add(m);
  return m;
}

// Lederbecher, umgedreht: Ursprung in der Mitte des Rands (unten), oben geschlossen
function buildCup(unit) {
  const { r, h, wall } = CUP;
  const profile = [[0, 0], [r - 0.3, 0], [r, 0.3], [r, h - 0.2], [r - 0.15, h], [r - wall + 0.1, h], [r - wall, h - 0.2], [r - wall, wall], [0, wall]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a2412, roughness: 0.72, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 40).rotateX(Math.PI).translate(0, h, 0), leather);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.12, 6, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 0.6 }));
  seam.position.y = 1.2;
  mesh.castShadow = mesh.receiveShadow = true;
  const cup = new THREE.Group();
  cup.add(mesh, seam);
  unit.add(cup);
  return cup;
}
