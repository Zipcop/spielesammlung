// Würfelteller mit einem Würfel und echter Physik (Rapier), wie bei Kniffel: Nur wer würfelt, rechnet die Physik
// und streamt die Lage des Würfels 30×/s; beim Mitspieler wird sie nur angezeigt. Maße in cm (Gruppe 1/100).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { feltOf, diceFaces, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';

const DIE = 1.8; // Kantenlänge
const DIE_R = 0.22;
const R_IN = 9; // Innenradius des Tellers
const RIM = 1.2; // Randstärke
const RIM_H = 2.6; // Randhöhe über dem Boden
const FLOOR = 0.6; // Bodendicke (Filz liegt auf dieser Höhe)
const STEP = 1 / 120;
const SEND_EVERY = 4; // 30 Updates pro Sekunde
const MAX_STEPS = 8 / STEP;
const LIFT_S = 0.22; // Würfel aufnehmen
const HIT_SPEED = 120;
const KINDS = ['die', 'wood', 'felt'];

const FACE_VALUES = [2, 5, 1, 6, 3, 4]; // Seiten +x, -x, +y, -y, +z, -z (Gegenseiten ergeben 7)
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
const UP = new THREE.Vector3(0, 1, 0);
// Richtung zum Sitz (0 = +z, 1 = −x, 2 = −z, 3 = +x) – von dort kommt der Wurf
const TOWARD = [[0, 1], [-1, 0], [0, -1], [1, 0]];

// Würfel mit der Hand: er liegt in einem unsichtbaren, geschlossenen Käfig (die Hand) über dem Teller, der der Maus folgt
const HAND = { w: 3.2, h: 3.2, wall: 0.4 }; // Innenmaß (Würfel), Wandstärke
const HAND_Y = FLOOR + 5; // Boden der Hand über dem Teller
const HAND_R = R_IN - HAND.w / 2 - 1; // so weit darf die Hand von der Tellermitte weg
const HAND_SPEED = 220; // cm/s – schneller folgt sie der Maus nicht (sonst rutscht der Würfel durch die Wand)
const TOSS_SPIN = 25; // rad/s Drall beim Loslassen

const rand = (a, b) => a + Math.random() * (b - a);
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Zufällige Lage in der Hand: zufällige Zahl oben, in Vierteln gedreht (feste Startlage machte den Kniffel-Becher unfair)
function randomTurn() {
  const value = 1 + Math.floor(Math.random() * 6);
  const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(value)], UP);
  return q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.floor(Math.random() * 4) * Math.PI / 2));
}

function topFace(q) {
  let best = 0;
  let up = -2;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > up) [best, up] = [i, y];
  });
  return { value: FACE_VALUES[best], up };
}

// center = Mitte des Tellers (cm, in der Gruppe), onStream = Nachricht an den Mitspieler
export function createDice(group, center, { onStream }) {
  const tray = new THREE.Group();
  tray.position.copy(center);
  group.add(tray);
  const felt = buildTray(tray);

  const faces = diceFaces('weiss');
  const die = new THREE.Mesh(new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE_R), FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({
    ...faces[v - 1], bumpScale: 1.2, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25,
  })));
  die.castShadow = die.receiveShadow = true;
  tray.add(die);

  let RAPIER = null;
  let world = null;
  let queue = null;
  let loading = null;
  const kindOf = new Map();
  let roll = null; // eigener Wurf
  let lift = null; // Würfel wird aufgenommen
  let remote = null; // Wurf des Mitspielers
  let releaseEarly = false; // mit der Hand: Maus schon losgelassen, während die Physik noch lädt

  function ready() {
    loading ??= (async () => {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: -981, z: 0 });
      world.timestep = STEP;
      world.lengthUnit = 100;
      queue = new RAPIER.EventQueue(true);
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const add = (desc, kind) => kindOf.set(world.createCollider(desc, fixed).handle, kind);
      add(RAPIER.ColliderDesc.cylinder(0.5, R_IN + RIM).setTranslation(0, FLOOR - 0.5, 0).setFriction(0.8).setRestitution(0.15), 'felt');
      // Rand aus 24 Stücken, unsichtbar höher als sichtbar, damit nichts herausfliegt
      const H = 20;
      const n = 24;
      const half = (R_IN + RIM) * Math.tan(Math.PI / n) * 1.08;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const r = R_IN + RIM / 2;
        const q = new THREE.Quaternion().setFromAxisAngle(UP, -a);
        add(RAPIER.ColliderDesc.cuboid(RIM / 2, H, half).setTranslation(Math.cos(a) * r, H, Math.sin(a) * r)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.3).setRestitution(0.45), 'wood');
      }
      add(RAPIER.ColliderDesc.cylinder(0.5, R_IN + RIM).setTranslation(0, 2 * H, 0), 'wood'); // Deckel
    })();
    return loading;
  }

  // Eigener Wurf vom Platz seat aus. Liefert die Augenzahl, sobald der Würfel ruhig liegt.
  async function throwDie(seat) {
    await ready();
    const [dx, dz] = TOWARD[seat];
    const side = new THREE.Vector3(-dz, 0, dx); // quer zur Wurfrichtung
    const start = new THREE.Vector3(dx, 0, dz).multiplyScalar(R_IN - 2.2).addScaledVector(side, rand(-2.5, 2.5)).setY(FLOOR + 4.5);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 7), rand(0, 7), rand(0, 7)));
    return new Promise((resolve) => {
      lift = { from: { pos: die.position.clone(), quat: die.quaternion.clone() }, to: { pos: start, quat }, t: 0, steps: 0, resolve, seat };
    });
  }

  // Würfel mit der Hand: aufnehmen (in die Hand über dem Teller), schütteln (drag), loslassen (release) = Wurf.
  // Liefert die Augenzahl, sobald er ruhig liegt.
  async function grabDie() {
    releaseEarly = false;
    await ready();
    if (roll || lift) return null;
    const at = die.position.clone().setY(0);
    if (at.length() > HAND_R) at.setLength(HAND_R);
    const start = at.setY(HAND_Y);
    return new Promise((resolve) => {
      lift = { from: { pos: die.position.clone(), quat: die.quaternion.clone() }, to: { pos: start.clone().setY(HAND_Y + HAND.wall + DIE / 2 + 0.05), quat: randomTurn() },
        t: 0, steps: 0, resolve, hand: { start, target: start.clone(), released: releaseEarly } };
    });
  }

  // Hand als bewegter Körper: geschlossener Käfig, der Würfel klappert darin
  function startHand() {
    const { to, resolve, hand } = lift;
    lift = null;
    const cage = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(hand.start.x, hand.start.y, hand.start.z)
      .setCcdEnabled(true));
    const { w, h, wall } = HAND;
    const add = (hx, hy, hz, x, y, z) => kindOf.set(world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
      .setFriction(0.5).setRestitution(0.2), cage).handle, 'felt');
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, wall / 2, 0);
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, h + wall / 2, 0);
    for (const s of [-1, 1]) {
      add(wall / 2, h / 2, w / 2 + wall, s * (w / 2 + wall / 2), h / 2, 0);
      add(w / 2, h / 2, wall / 2, 0, h / 2, s * (w / 2 + wall / 2));
    }
    const body = createBody(to.pos, to.quat, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    roll = { body, resolve, acc: 0, steps: 0, still: 0, nudges: 0, hits: [], lastHit: -99, speed: null, hand: { ...hand, cage } };
  }

  // Hand öffnen: Käfig weg, der Würfel fliegt mit seinem Schwung weiter und bekommt Drall
  function toss() {
    world.removeRigidBody(roll.hand.cage);
    roll.hand = null;
    roll.body.setAngvel({ x: rand(-TOSS_SPIN, TOSS_SPIN), y: rand(-TOSS_SPIN, TOSS_SPIN), z: rand(-TOSS_SPIN, TOSS_SPIN) }, true);
    roll.still = 0;
    roll.steps = 0; // die Höchstdauer zählt ab dem Wurf – sonst würde nach langem Halten sofort ausgewertet
    roll.lastHit = -99;
  }

  function moveHand() {
    const { cage, target } = roll.hand;
    if (roll.hand.released) return toss();
    const now = cage.translation();
    const pos = new THREE.Vector3(now.x, now.y, now.z);
    const goal = target.clone();
    if (goal.clone().setY(0).length() > HAND_R) goal.setY(0).setLength(HAND_R).setY(target.y);
    const step = goal.sub(pos);
    if (step.length() > HAND_SPEED * STEP) step.setLength(HAND_SPEED * STEP);
    cage.setNextKinematicTranslation(pos.add(step));
  }

  // Würfelkörper (dynamisch) – für den Wurf vom Platz aus und für die Hand
  function createBody(pos, quat, linvel, angvel) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(quat)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAngvel(angvel)
      .setLinearDamping(0.1)
      .setAngularDamping(0.4)
      .setCcdEnabled(true));
    const half = DIE / 2 - DIE_R;
    const collider = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half, half, half, DIE_R)
      .setDensity(1.2).setFriction(0.45).setRestitution(0.35)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    kindOf.set(collider.handle, 'die');
    return body;
  }

  // Maus → Ziel der Hand (Ebene in Hand-Höhe über dem Teller)
  function drag(raycaster) {
    const hand = roll?.hand ?? lift?.hand;
    if (!hand) return;
    const height = tray.localToWorld(new THREE.Vector3(0, HAND_Y + HAND.h / 2, 0)).y;
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
    if (!hit) return;
    const local = tray.worldToLocal(hit);
    hand.target.set(local.x, HAND_Y, local.z);
  }

  function release() {
    const hand = roll?.hand ?? lift?.hand;
    if (hand) hand.released = true;
    else releaseEarly = true;
  }

  function startPhysics() {
    if (lift.hand) return startHand();
    const { to, resolve, seat } = lift;
    lift = null;
    const [dx, dz] = TOWARD[seat];
    const speedIn = rand(70, 115);
    const across = rand(-18, 18);
    const body = createBody(to.pos, to.quat,
      { x: -dx * speedIn - dz * across, y: rand(-6, 10), z: -dz * speedIn + dx * across },
      { x: rand(-30, 30), y: rand(-30, 30), z: rand(-30, 30) });
    roll = { body, resolve, acc: 0, steps: 0, still: 0, nudges: 0, hits: [], lastHit: -99, speed: null, hand: null };
  }

  function stepPhysics(dt) {
    roll.acc = Math.min(roll.acc + dt, 8 * STEP);
    while (roll && roll.acc >= STEP) {
      roll.acc -= STEP;
      if (roll.hand) moveHand();
      roll.speed = roll.body.linvel();
      world.step(queue);
      roll.steps++;
      queue.drainCollisionEvents((h1, h2, started) => started && collide(kindOf.get(h1), kindOf.get(h2)));
      die.position.copy(roll.body.translation());
      die.quaternion.copy(roll.body.rotation());
      if (roll.steps % SEND_EVERY === 0) {
        onStream({ t: 'dice', p: pose(), s: roll.hits });
        roll.hits = [];
      }
      if (!roll.hand) checkSettled(); // erst auswerten, wenn die Hand losgelassen hat
    }
  }

  function collide(a, b) {
    if (a !== 'die') [a, b] = [b, a];
    if (a !== 'die' || roll.steps - roll.lastHit < 4) return;
    roll.lastHit = roll.steps;
    const v = roll.speed;
    const strength = Math.hypot(v.x, v.y, v.z) / HIT_SPEED;
    playHit(b === 'felt' ? 'felt' : 'wood', strength);
    playHit('die', strength * 0.5);
    roll.hits.push([KINDS.indexOf(b), round(strength, 2)]);
  }

  function checkSettled() {
    const v = roll.body.linvel();
    const w = roll.body.angvel();
    const calm = Math.hypot(v.x, v.y, v.z) < 0.6 && Math.hypot(w.x, w.y, w.z) < 0.3;
    roll.still = calm ? roll.still + 1 : 0;
    if (roll.still < 24 && roll.steps < MAX_STEPS) return;
    // schräg am Rand angelehnt? kurz anstupsen
    if (topFace(die.quaternion).up < 0.98 && roll.nudges < 5 && roll.steps < MAX_STEPS) {
      roll.nudges++;
      roll.still = 0;
      const m = roll.body.mass();
      roll.body.applyImpulse({ x: -die.position.x * 3 * m, y: 60 * m, z: -die.position.z * 3 * m }, true);
      roll.body.applyTorqueImpulse({ x: rand(-0.5, 0.5) * m, y: rand(-0.5, 0.5) * m, z: rand(-0.5, 0.5) * m }, true);
      return;
    }
    const { body, resolve } = roll;
    world.removeRigidBody(body);
    onStream({ t: 'dice', p: pose(), s: roll.hits, final: true });
    roll = null;
    resolve(topFace(die.quaternion).value);
  }

  const pose = () => [
    round(die.position.x, 2), round(die.position.y, 2), round(die.position.z, 2),
    round(die.quaternion.x, 4), round(die.quaternion.y, 4), round(die.quaternion.z, 4), round(die.quaternion.w, 4),
  ];

  // Wurf des Mitspielers anzeigen (nur Zahlen; falsche Nachrichten werden ignoriert)
  function applyRemote(msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 7 || !msg.p.every(Number.isFinite)) return;
    remote ??= { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    remote.pos.fromArray(msg.p, 0);
    remote.quat.fromArray(msg.p, 3).normalize();
    for (const hit of Array.isArray(msg.s) ? msg.s : []) {
      if (Array.isArray(hit) && Number.isInteger(hit[0]) && KINDS[hit[0]] && Number.isFinite(hit[1])) playHit(KINDS[hit[0]], hit[1]);
    }
    if (!msg.final) return;
    die.position.copy(remote.pos);
    die.quaternion.copy(remote.quat);
    remote = null;
  }

  function reset() {
    if (roll) world.removeRigidBody(roll.body);
    if (roll?.hand) world.removeRigidBody(roll.hand.cage);
    roll = null;
    lift = null;
    remote = null;
    die.position.set(0, FLOOR + DIE / 2, 0);
    die.quaternion.setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(6)], UP); // liegt mit der 6 oben
  }

  reset();

  return {
    tray, // Teller samt Würfel (tisch.js wirft ihn beim Umwerfen als Ganzes)
    // Design dieses PCs: Würfelfarbe und Filz (settings.js)
    setDesign(s) {
      const f = diceFaces(s.dice);
      die.material.forEach((m, k) => Object.assign(m, f[FACE_VALUES[k] - 1], { needsUpdate: true }));
      felt.map = feltOf(s.felt);
      felt.needsUpdate = true;
    },
    ready,
    roll: throwDie,
    grab: grabDie,
    drag,
    release,
    hitDie: (raycaster) => raycaster.intersectObject(die, false).length > 0,
    applyRemote,
    reset,
    busy: () => !!(roll || lift || remote),
    hit: (raycaster) => raycaster.intersectObject(tray, true).length > 0,
    update(dt) {
      if (lift) {
        lift.t = Math.min(lift.t + dt / LIFT_S, 1);
        const k = lift.t * lift.t * (3 - 2 * lift.t);
        die.position.lerpVectors(lift.from.pos, lift.to.pos, k);
        die.position.y += Math.sin(lift.t * Math.PI) * 3;
        die.quaternion.slerpQuaternions(lift.from.quat, lift.to.quat, k);
        if (++lift.steps % 2 === 0) onStream({ t: 'dice', p: pose(), s: [] });
        if (lift.t === 1) startPhysics();
      } else if (roll) {
        stepPhysics(dt);
      } else if (remote) {
        const k = 1 - Math.exp(-dt * 30);
        die.position.lerp(remote.pos, k);
        die.quaternion.slerp(remote.quat, k);
      }
    },
  };
}

function buildTray(tray) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.4 });
  const outer = R_IN + RIM;
  const top = FLOOR + RIM_H;
  // Rand als Drehkörper: außen hoch, oben gerundet, innen hinunter
  const profile = [[outer - 0.1, 0], [outer, 0.1], [outer, top - 0.35], [outer - 0.15, top - 0.08], [outer - 0.45, top],
    [R_IN + 0.45, top], [R_IN + 0.15, top - 0.08], [R_IN, top - 0.35], [R_IN, FLOOR]].map(([r, y]) => new THREE.Vector2(r, y));
  const rim = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), wood);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R_IN + 0.05, R_IN + 0.05, FLOOR, 64), wood);
  floor.position.y = FLOOR / 2;
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const felt = new THREE.Mesh(new THREE.CircleGeometry(R_IN, 64).rotateX(-Math.PI / 2), feltMat);
  felt.position.y = FLOOR + 0.02;
  for (const m of [rim, floor, felt]) {
    m.castShadow = m.receiveShadow = true;
    tray.add(m);
  }
  return feltMat;
}
