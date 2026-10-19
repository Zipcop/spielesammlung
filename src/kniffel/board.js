// Kniffel-Brett: Würfelschale mit Filz, 5 Würfel, Würfelbecher und Block mit Bleistift. Echte Physik (Rapier) läuft
// nur beim werfenden Spieler; er streamt die Lagen von Würfeln und Becher, beim Mitspieler werden sie nur angezeigt.
// Ein Wurf: Die freien Würfel wandern in den Becher, der Becher wird geschüttelt (von selbst oder mit gedrückter
// linker Maustaste von Hand) und ausgekippt. Der Becher ist ein bewegter Körper mit Wänden – die Würfel klappern darin echt.
// Maße in Zentimetern – die Gruppe ist auf 1/100 skaliert, weil die Szene in Metern rechnet.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { feltOf, diceFaces, woodTexture, blockTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';

const DIE = 2.4; // Kantenlänge
const DIE_R = 0.3; // Rundung der Kanten
const TRAY = { w: 32, d: 22, h: 4, t: 1.6 }; // Innenmaß, Randhöhe, Randstärke
const FLOOR = 0.8; // Dicke des Schalenbodens (Filz liegt auf dieser Höhe)
const STEP = 1 / 120; // Physik-Takt in Sekunden
const SEND_EVERY = 4; // jeden 4. Schritt senden → 30 Updates pro Sekunde
const MAX_STEPS = 8 / STEP; // nach 8 s wird das Ergebnis genommen, wie es liegt
const MOVE_S = 0.4; // Dauer fürs Beiseitelegen / Zurücklegen
const HIT_SPEED = 150; // ab dieser Aufprallgeschwindigkeit (cm/s) volle Lautstärke
const KINDS = ['die', 'wood', 'felt'];

const CUP = { r: 4.6, h: 10.5, wall: 0.5, sides: 14 }; // Würfelbecher: Außenradius, Höhe, Wandstärke, Wandstücke
const SHAKE_Y = FLOOR + 13; // Höhe des Becherbodens beim Schütteln (über der Schale)
const CUP_SPEED = 260; // so schnell folgt der Becher höchstens der Maus (cm/s) – sonst fliegen Würfel durch die Wand
const GATHER_S = 0.35; // Würfel wandern in den Becher
const SHAKE_S = 0.9; // so lange schüttelt der Becher von selbst
const POUR_S = 0.45; // Auskippen
const POUR_HOLD_S = 0.3; // gekippt halten, bis alles herausgefallen ist
const RETURN_S = 0.5; // Becher zurück an seinen Platz
const CUP_LIMIT = { x: TRAY.w / 2 - CUP.r - 0.3, z: TRAY.d / 2 - CUP.r - 0.3 }; // Becher bleibt über der Schale
// Handvoll: die freien Würfel liegen in einem unsichtbaren, geschlossenen Käfig (die Hand), der der Maus folgt
const HAND = { w: 6.6, h: 6.4, wall: 3 }; // Innenmaß (quadratisch), Höhe, Wandstärke – dick, damit beim Schütteln nichts durchrutscht
const HAND_Y = FLOOR + 6.5; // Unterseite der Hand über der Schale (Würfel liegen auf HAND_Y + wall)
const HAND_LIMIT = { x: TRAY.w / 2 - HAND.w / 2 - 0.6, z: TRAY.d / 2 - HAND.w / 2 - 0.6 };
const TOSS_SPIN = 14; // rad/s – beim Loslassen bekommt jeder Würfel Drall mit (wie aus der Hand geworfen)

// Becher steht rechts neben der Schale beim Spieler am Zug
const cupRest = (player) => new THREE.Vector3(side(player) * 24, 0, side(player) * 6);
const smooth = (t) => t * t * (3 - 2 * t);

// Reihenfolge der BoxGeometry-Seiten: +x, -x, +y, -y, +z, -z (Gegenseiten ergeben 7)
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
const UP = new THREE.Vector3(0, 1, 0);

const rand = (a, b) => a + Math.random() * (b - a);
const side = (player) => (player === 0 ? 1 : -1); // Host sitzt auf der +z-Seite
const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Welche Zahl liegt oben? up = 1 heißt: liegt ganz flach
function topFace(q) {
  let best = 0;
  let up = -2;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > up) [best, up] = [i, y];
  });
  return { value: FACE_VALUES[best], up };
}

// Zufällige Lage im Becher bzw. in der Hand: zufällige Zahl oben, in Vierteln gedreht (so passen die Würfel ohne
// Überlappen hinein). Mit fester Lage („1 oben“, „2 oben“ …) blieb die Startseite oft oben – bei 1250 Würfen
// kam die 3 fast dreimal so oft wie die 5.
function randomTurn(player) {
  const value = 1 + Math.floor(Math.random() * 6);
  return upright(value, player).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.floor(Math.random() * 4) * Math.PI / 2));
}

function upright(value, player) {
  const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(value)], UP);
  return q.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, player === 0 ? 0 : Math.PI));
}

// Behaltene Würfel liegen vor dem Spieler am Zug neben der Schale, wartende in der Schale an seiner Seite
const keepSlot = (i, player) => new THREE.Vector3((i - 2) * 3.2, DIE / 2, side(player) * (TRAY.d / 2 + TRAY.t + 3));
const waitSlot = (i, player) => new THREE.Vector3((i - 2) * 3.6, FLOOR + DIE / 2, side(player) * (TRAY.d / 2 - 3));

export function createBoard(parent, { onStream }) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const felt = buildTray(group);
  const deco = buildBlock(group);
  const cup = buildCup(group);

  const faces = diceFaces('weiss');
  const geometry = new RoundedBoxGeometry(DIE, DIE, DIE, 4, DIE_R);
  const dice = [0, 1, 2, 3, 4].map(() => {
    const m = new THREE.Mesh(geometry, FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({
      ...faces[v - 1], bumpScale: 1.5, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25,
    })));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  });

  let state = null; // letzter Spielstand (für die Anordnung)
  let rest = []; // wo jeder Würfel nach dem letzten Wurf liegt
  let moves = []; // laufende Animationen (beiseitelegen usw.)
  let cupMove = null; // Becher gleitet an seinen Platz
  let roll = null; // eigener Wurf mit Physik
  let remote = null; // Wurf des Mitspielers (gestreamte Lagen)
  let hover = -1;
  let releaseEarly = false; // Maus schon losgelassen, während die Physik noch lädt

  // --- Physik (wird erst beim ersten Wurf geladen) ---
  let RAPIER = null;
  let world = null;
  let queue = null;
  const kindOf = new Map(); // Collider-Handle → 'felt' | 'wood' | 'cup' | Würfelnummer
  let loading = null;

  function ready() {
    loading ??= (async () => {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: -981, z: 0 }); // Erdanziehung in cm/s²
      world.timestep = STEP;
      world.lengthUnit = 100; // Zentimeter
      queue = new RAPIER.EventQueue(true);
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const wall = (hx, hy, hz, x, y, z, kind, friction, restitution) => {
        const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
          .setFriction(friction).setRestitution(restitution), fixed);
        kindOf.set(c.handle, kind);
      };
      const H = 20; // unsichtbar höher als der Rand, damit kein Würfel herausfliegt
      wall(TRAY.w / 2, 0.5, TRAY.d / 2, 0, FLOOR - 0.5, 0, 'felt', 0.8, 0.15);
      wall(TRAY.w / 2 + TRAY.t, H, TRAY.t / 2, 0, H, TRAY.d / 2 + TRAY.t / 2, 'wood', 0.3, 0.45);
      wall(TRAY.w / 2 + TRAY.t, H, TRAY.t / 2, 0, H, -TRAY.d / 2 - TRAY.t / 2, 'wood', 0.3, 0.45);
      wall(TRAY.t / 2, H, TRAY.d / 2, TRAY.w / 2 + TRAY.t / 2, H, 0, 'wood', 0.3, 0.45);
      wall(TRAY.t / 2, H, TRAY.d / 2, -TRAY.w / 2 - TRAY.t / 2, H, 0, 'wood', 0.3, 0.45);
      wall(TRAY.w / 2, 0.5, TRAY.d / 2, 0, 2 * H, 0, 'wood', 0.3, 0.3); // Deckel
    })();
    return loading;
  }

  // Eigener Wurf. mode: 'auto' = Becher schüttelt von selbst · 'cup' = Becher von Hand (dragCup/release) ·
  // 'hand' = die freien Würfel als Handvoll, gepackt bei Würfel from (dragCup/release wirft).
  // Liefert die Augenzahlen aller 5 Würfel, sobald alles ruhig liegt.
  async function throwDice(held, player, mode = 'auto', from = -1) {
    releaseEarly = false;
    await ready();
    if (roll) return null;
    const thrown = [0, 1, 2, 3, 4].filter((i) => !held[i]);
    const hand = mode === 'hand';
    const at = dice[from]?.position ?? new THREE.Vector3(side(player) * 4, 0, side(player) * 3);
    const start = hand
      ? new THREE.Vector3(THREE.MathUtils.clamp(at.x, -HAND_LIMIT.x, HAND_LIMIT.x), HAND_Y, THREE.MathUtils.clamp(at.z, -HAND_LIMIT.z, HAND_LIMIT.z))
      : new THREE.Vector3(side(player) * 4, SHAKE_Y, side(player) * 3);
    thrown.forEach((i) => (moves[i] = null));
    if (!hand) cupMove = null;
    return new Promise((resolve) => {
      roll = {
        thrown, player, mode, manual: mode !== 'auto', resolve, start,
        phase: 'gather', t: 0, released: releaseEarly, target: start.clone(),
        from: { cup: cup.position.clone(), dice: thrown.map((i) => ({ pos: dice[i].position.clone(), quat: dice[i].quaternion.clone() })) },
        turns: thrown.map(() => randomTurn(player)), // Lage der Würfel im Becher bzw. in der Hand
        bodies: [], cupBody: null, lid: null,
        acc: 0, steps: 0, freeSteps: 0, still: 0, nudges: 0, hits: [], lastHit: [], speed: [],
      };
    });
  }

  // Platz des k-ten Würfels im Becher (2 + 2 + 1 übereinander)
  function inCup(k, base) {
    const layer = Math.floor(k / 2);
    const a = layer === 1 ? Math.PI / 2 : 0;
    const off = layer === 2 ? 0 : k % 2 ? 1.3 : -1.3;
    return base.clone().add(new THREE.Vector3(Math.cos(a) * off, CUP.wall + DIE / 2 + 0.05 + layer * (DIE + 0.1), Math.sin(a) * off));
  }

  // Platz des k-ten Würfels in der Hand (2 × 2 unten, einer obendrauf)
  function inHand(k, base) {
    const [x, z] = k < 4 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]][k] : [0, 0];
    return base.clone().add(new THREE.Vector3(x * 1.4, HAND.wall + DIE / 2 + 0.05 + (k < 4 ? 0 : DIE + 0.1), z * 1.4));
  }

  // Würfel (und Becher) wandern zum Startpunkt über der Schale – danach beginnt die Physik
  function gatherStep() {
    roll.t += STEP / GATHER_S;
    const k = smooth(Math.min(roll.t, 1));
    const hand = roll.mode === 'hand';
    if (!hand) {
      cup.position.lerpVectors(roll.from.cup, roll.start, k);
      cup.position.y += Math.sin(k * Math.PI) * 4;
      cup.quaternion.identity();
    }
    const slot = (n) => (hand ? inHand(n, roll.start) : inCup(n, cup.position));
    roll.thrown.forEach((i, n) => {
      dice[i].position.lerpVectors(roll.from.dice[n].pos, slot(n), k);
      dice[i].quaternion.slerpQuaternions(roll.from.dice[n].quat, roll.turns[n], k);
    });
    if (roll.t < 1) return;
    if (hand) createHandBody();
    else createCupBody();
    roll.thrown.forEach((i, n) => {
      const p = hand ? inHand(n, roll.start) : inCup(n, roll.start);
      // Zufallsdrall: ein einzelner Würfel auf festem Schüttelweg lief sonst fast vorherbestimmt (die 3 kam nur bei ~11 %).
      // Kein CCD: damit rutschten Würfel durch die schnell bewegte Becher- bzw. Handwand (Prüfung 19.10.2026).
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(dice[i].quaternion)
        .setAngvel({ x: rand(-4, 4), y: rand(-4, 4), z: rand(-4, 4) })
        .setLinearDamping(0.1)
        .setAngularDamping(0.4));
      const half = DIE / 2 - DIE_R;
      const collider = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half, half, half, DIE_R)
        .setDensity(1.2).setFriction(0.45).setRestitution(0.35)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(collider.handle, i);
      roll.bodies[i] = body;
    });
    roll.phase = roll.manual ? 'grab' : 'auto';
    roll.t = 0;
  }

  // Becher als bewegter Körper: Boden, Wand aus schmalen Platten und ein unsichtbarer Deckel (die Hand)
  function createCupBody() {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(roll.start.x, roll.start.y, roll.start.z)
      .setCcdEnabled(true));
    const add = (desc) => {
      const c = world.createCollider(desc.setFriction(0.5).setRestitution(0.2), body);
      kindOf.set(c.handle, 'cup');
      return c;
    };
    add(RAPIER.ColliderDesc.cylinder(CUP.wall / 2, CUP.r).setTranslation(0, CUP.wall / 2, 0));
    const width = 2 * CUP.r * Math.tan(Math.PI / CUP.sides) + 0.2;
    for (let k = 0; k < CUP.sides; k++) {
      const a = (k / CUP.sides) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(UP, -a);
      add(RAPIER.ColliderDesc.cuboid(CUP.wall / 2, CUP.h / 2, width / 2)
        .setTranslation(Math.cos(a) * (CUP.r - CUP.wall / 2), CUP.h / 2, Math.sin(a) * (CUP.r - CUP.wall / 2))
        .setRotation(q));
    }
    roll.lid = add(RAPIER.ColliderDesc.cylinder(0.3, CUP.r).setTranslation(0, CUP.h + 0.3, 0));
    roll.cupBody = body;
  }

  // Hand als bewegter Körper: geschlossener Käfig (Boden, vier Wände, Deckel), unsichtbar – die Würfel klappern darin
  function createHandBody() {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(roll.start.x, roll.start.y, roll.start.z)
      .setCcdEnabled(true));
    const { w, h, wall } = HAND;
    const add = (hx, hy, hz, x, y, z) => {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.5).setRestitution(0.2), body);
      kindOf.set(c.handle, 'cup'); // klingt gedämpft wie der Lederbecher
    };
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, wall / 2, 0); // Handfläche
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, h + wall / 2, 0); // Finger obendrauf
    for (const s of [-1, 1]) {
      add(wall / 2, h / 2, w / 2 + wall, s * (w / 2 + wall / 2), h / 2, 0);
      add(w / 2, h / 2, wall / 2, 0, h / 2, s * (w / 2 + wall / 2));
    }
    roll.cupBody = body;
  }

  // Hand öffnen: Käfig weg, die Würfel fliegen mit ihrem Schwung weiter und bekommen Drall – dann rollen sie aus
  function toss() {
    world.removeRigidBody(roll.cupBody);
    roll.cupBody = null;
    for (const i of roll.thrown) roll.bodies[i].setAngvel({ x: rand(-TOSS_SPIN, TOSS_SPIN), y: rand(-TOSS_SPIN, TOSS_SPIN), z: rand(-TOSS_SPIN, TOSS_SPIN) }, true);
    roll.phase = 'free';
    roll.t = 1; // kein Becher, der erst zurück muss
  }

  // Wohin der Becher in diesem Schritt soll – je nach Phase
  function moveCup() {
    const body = roll.cupBody;
    const now = body.translation();
    const pos = new THREE.Vector3(now.x, now.y, now.z);
    const quat = new THREE.Quaternion();
    if (roll.phase === 'grab' || roll.phase === 'auto') {
      let goal;
      if (roll.phase === 'grab') {
        goal = roll.target.clone();
        if (roll.released && roll.mode === 'hand') return toss();
        if (roll.released) startPour(pos);
      } else {
        roll.t += STEP;
        const t = roll.t;
        goal = roll.start.clone().add(new THREE.Vector3(3.5 * Math.sin(t * 20), 1.4 * Math.sin(t * 25) ** 2, 2.4 * Math.sin(t * 14.5 + 1)));
        if (t >= SHAKE_S) startPour(pos);
      }
      const limit = roll.mode === 'hand' ? HAND_LIMIT : CUP_LIMIT;
      goal.x = THREE.MathUtils.clamp(goal.x, -limit.x, limit.x);
      goal.z = THREE.MathUtils.clamp(goal.z, -limit.z, limit.z);
      const step = goal.sub(pos);
      const max = CUP_SPEED * STEP;
      if (step.length() > max) step.setLength(max);
      pos.add(step);
    }
    if (roll.phase === 'pour') {
      roll.t += STEP;
      const k = smooth(Math.min(roll.t / POUR_S, 1));
      quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -side(roll.player) * 2.1 * k);
      pos.copy(roll.pourFrom).add(new THREE.Vector3(0, -3 * k, -side(roll.player) * 1.5 * k));
      if (roll.t >= POUR_S + POUR_HOLD_S) {
        cup.position.copy(pos);
        cup.quaternion.copy(quat);
        world.removeRigidBody(body); // Becher weg – die Würfel rollen in der Schale aus
        roll.cupBody = null;
        roll.phase = 'free';
        roll.t = 0;
        roll.back = { pos: pos.clone(), quat: quat.clone() };
        return;
      }
    }
    body.setNextKinematicTranslation(pos);
    body.setNextKinematicRotation(quat);
  }

  function startPour(pos) {
    world.removeCollider(roll.lid, true); // Hand weg – oben ist der Becher jetzt offen
    roll.phase = 'pour';
    roll.t = 0;
    roll.pourFrom = pos.clone();
  }

  // Nach dem Auskippen gleitet der Becher zurück an seinen Platz (nur Anzeige)
  function returnCup() {
    roll.t += STEP / RETURN_S;
    const k = smooth(Math.min(roll.t, 1));
    cup.position.lerpVectors(roll.back.pos, cupRest(roll.player), k);
    cup.position.y += Math.sin(k * Math.PI) * 6;
    cup.quaternion.slerpQuaternions(roll.back.quat, new THREE.Quaternion(), k);
  }

  function stepPhysics(dt) {
    roll.acc = Math.min(roll.acc + dt, 8 * STEP);
    while (roll && roll.acc >= STEP) {
      roll.acc -= STEP;
      roll.steps++;
      if (roll.phase === 'gather') {
        gatherStep();
      } else {
        if (roll.cupBody) moveCup();
        else if (roll.mode !== 'hand') returnCup(); // die Handvoll hat den Becher nicht bewegt
        roll.thrown.forEach((i) => (roll.speed[i] = roll.bodies[i].linvel()));
        world.step(queue);
        queue.drainCollisionEvents((h1, h2, started) => started && collide(kindOf.get(h1), kindOf.get(h2)));
        roll.thrown.forEach((i) => {
          dice[i].position.copy(roll.bodies[i].translation());
          dice[i].quaternion.copy(roll.bodies[i].rotation());
        });
        if (roll.cupBody) {
          cup.position.copy(roll.cupBody.translation());
          cup.quaternion.copy(roll.cupBody.rotation());
        }
      }
      if (roll.steps % SEND_EVERY === 0) {
        onStream({ t: 'dice', p: poses(), c: cupPose(), s: roll.hits });
        roll.hits = [];
      }
      if (roll.phase === 'free') {
        roll.freeSteps++;
        checkSettled();
      }
    }
  }

  // Aufprall → Geräusch (lokal sofort, beim Mitspieler über den Stream). Der Lederbecher klingt dumpf wie Filz.
  function collide(a, b) {
    if (typeof a !== 'number') [a, b] = [b, a];
    if (typeof a !== 'number') return;
    const va = roll.speed[a];
    const vb = typeof b === 'number' ? roll.speed[b] : { x: 0, y: 0, z: 0 };
    if (!va || !vb) return;
    if (roll.steps - (roll.lastHit[a] ?? -99) < 4) return; // höchstens ein Klack alle 33 ms pro Würfel
    roll.lastHit[a] = roll.steps;
    const kind = typeof b === 'number' ? 'die' : b === 'cup' ? 'felt' : b;
    const strength = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) / HIT_SPEED;
    playHit(kind, strength);
    roll.hits.push([KINDS.indexOf(kind), round(strength, 2)]);
  }

  function checkSettled() {
    const calm = roll.thrown.every((i) => {
      const v = roll.bodies[i].linvel();
      const w = roll.bodies[i].angvel();
      return Math.hypot(v.x, v.y, v.z) < 0.8 && Math.hypot(w.x, w.y, w.z) < 0.3;
    });
    roll.still = calm ? roll.still + 1 : 0;
    if ((roll.still < 24 || roll.t < 1) && roll.freeSteps < MAX_STEPS) return; // auch der Becher soll erst stehen

    // Schräg angelehnt oder auf einem anderen Würfel? Dann kurz anstupsen (wie am echten Tisch neu werfen).
    const bad = roll.thrown.filter((i) => topFace(dice[i].quaternion).up < 0.98 || dice[i].position.y > FLOOR + DIE / 2 + 0.4);
    if (bad.length && roll.nudges < 5 && roll.freeSteps < MAX_STEPS) {
      roll.nudges++;
      roll.still = 0;
      for (const i of bad) {
        const body = roll.bodies[i];
        const m = body.mass();
        const p = body.translation(); // zur Schalenmitte hin – zufällig seitlich blieb er am Rand oft wieder auf einem anderen liegen
        body.applyImpulse({ x: -Math.sign(p.x) * rand(20, 50) * m, y: 90 * m, z: -Math.sign(p.z) * rand(20, 50) * m }, true);
        body.applyTorqueImpulse({ x: rand(-1, 1) * m, y: rand(-1, 1) * m, z: rand(-1, 1) * m }, true);
      }
      return;
    }
    finishRoll();
  }

  function finishRoll() {
    const { thrown, bodies, resolve, player } = roll;
    for (const i of thrown) {
      rest[i] = { pos: dice[i].position.clone(), quat: dice[i].quaternion.clone() };
      world.removeRigidBody(bodies[i]);
    }
    cup.position.copy(cupRest(player));
    cup.quaternion.identity();
    onStream({ t: 'dice', p: poses(), c: cupPose(), s: roll.hits, final: true });
    roll = null;
    resolve(dice.map((d) => topFace(d.quaternion).value));
  }

  function poses() {
    return dice.flatMap((d) => pose(d));
  }

  const cupPose = () => pose(cup);
  const pose = (m) => [
    round(m.position.x, 2), round(m.position.y, 2), round(m.position.z, 2),
    round(m.quaternion.x, 4), round(m.quaternion.y, 4), round(m.quaternion.z, 4), round(m.quaternion.w, 4),
  ];

  // Von Hand schütteln: Becher (oder Handvoll) folgt der Maus über der Schale
  function dragCup(raycaster) {
    if (roll?.phase !== 'grab' && roll?.phase !== 'gather') return;
    const [base, mid] = roll.mode === 'hand' ? [HAND_Y, HAND.wall + HAND.h / 2] : [SHAKE_Y, CUP.h / 2];
    const height = group.localToWorld(new THREE.Vector3(0, base + mid, 0)).y;
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());
    if (!hit) return;
    const local = group.worldToLocal(hit);
    roll.target.set(local.x, base, local.z);
  }

  // --- Wurf des Mitspielers anzeigen ---
  function applyRemote(msg) {
    const numbers = (list, n) => Array.isArray(list) && list.length === n && list.every(Number.isFinite);
    if (!numbers(msg.p, 35) || (msg.c !== undefined && !numbers(msg.c, 7)) || !Array.isArray(msg.s)) return;
    remote ??= {
      dice: dice.map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })),
      cup: { pos: cup.position.clone(), quat: cup.quaternion.clone() },
    };
    remote.dice.forEach((r, i) => {
      r.pos.fromArray(msg.p, i * 7);
      r.quat.fromArray(msg.p, i * 7 + 3);
    });
    if (msg.c) {
      remote.cup.pos.fromArray(msg.c, 0);
      remote.cup.quat.fromArray(msg.c, 3);
    }
    for (const [kind, strength] of msg.s) playHit(KINDS[kind], strength);
    if (!msg.final) return;
    remote.dice.forEach((r, i) => {
      dice[i].position.copy(r.pos);
      dice[i].quaternion.copy(r.quat);
      moves[i] = null;
      if (!state?.held[i]) rest[i] = { pos: r.pos.clone(), quat: r.quat.clone() };
    });
    cup.position.copy(remote.cup.pos);
    cup.quaternion.copy(remote.cup.quat);
    cupMove = null;
    remote = null;
  }

  // --- Anordnung passend zum Spielstand ---
  function place(i, pos, quat) {
    const d = dice[i];
    const to = moves[i]?.to ?? { pos: d.position, quat: d.quaternion };
    if (to.pos.distanceTo(pos) < 0.01 && to.quat.angleTo(quat) < 0.01) return;
    moves[i] = { from: { pos: d.position.clone(), quat: d.quaternion.clone() }, to: { pos: pos.clone(), quat: quat.clone() }, t: 0 };
  }

  function placeCup(player) {
    const to = cupRest(player);
    if ((cupMove?.to ?? cup.position).distanceTo(to) < 0.01) return;
    cupMove = { from: cup.position.clone(), to, t: 0 };
  }

  function sync(s) {
    state = s;
    if (!s || roll || remote) return;
    s.dice.forEach((value, i) => {
      if (s.held[i]) place(i, keepSlot(i, s.turn), upright(value, s.turn));
      else if (s.rolls === 0 || !rest[i]) place(i, waitSlot(i, s.turn), upright(value, s.turn));
      else place(i, rest[i].pos, rest[i].quat);
    });
    placeCup(s.turn);
    updateLook();
  }

  function updateMoves(dt) {
    moves.forEach((m, i) => {
      if (!m) return;
      m.t = Math.min(m.t + dt / MOVE_S, 1);
      const k = smooth(m.t);
      dice[i].position.lerpVectors(m.from.pos, m.to.pos, k);
      dice[i].position.y += Math.sin(m.t * Math.PI) * 6.5; // im Bogen über den Rand heben
      dice[i].quaternion.slerpQuaternions(m.from.quat, m.to.quat, k);
      if (m.t === 1) moves[i] = null;
    });
    if (cupMove) {
      cupMove.t = Math.min(cupMove.t + dt / RETURN_S, 1);
      cup.position.lerpVectors(cupMove.from, cupMove.to, smooth(cupMove.t));
      cup.position.y += Math.sin(cupMove.t * Math.PI) * 5;
      cup.quaternion.identity();
      if (cupMove.t === 1) cupMove = null;
    }
  }

  function updateLook() {
    dice.forEach((d, i) => {
      const color = state?.held[i] ? 0x7a4e00 : i === hover ? 0x2e2e2e : 0x000000;
      d.material.forEach((m) => m.emissive.setHex(color));
    });
  }

  // Startbild im Spielzimmer: ein Full House liegt in der Schale
  function showIdle() {
    const spots = [[-6, 2, 0.3, 5], [-3, -2.5, 1.2, 5], [1, 1, 2.6, 5], [5, -1, 0.8, 2], [8, 3, 2, 2]];
    spots.forEach(([x, z, yaw, value], i) => {
      moves[i] = null;
      dice[i].position.set(x, FLOOR + DIE / 2, z);
      dice[i].quaternion.copy(upright(value, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
      rest[i] = null;
    });
    cupMove = null;
    cup.position.copy(cupRest(0));
    cup.quaternion.identity();
  }

  function reset() {
    if (roll) {
      roll.thrown.forEach((i) => roll.bodies[i] && world.removeRigidBody(roll.bodies[i]));
      if (roll.cupBody) world.removeRigidBody(roll.cupBody);
      roll = null;
    }
    remote = null;
    state = null;
    hover = -1;
    setGlow('hover', []);
    rest = [];
    moves = [];
    showIdle();
    updateLook();
  }

  reset();

  return {
    group,
    ready,
    sync,
    applyRemote,
    roll: (held, player) => throwDice(held, player, 'auto'),
    // Von Hand: grab startet den Wurf (Promise mit den Augenzahlen), dragCup bewegt, release kippt aus
    grab: (held, player) => throwDice(held, player, 'cup'),
    // Handvoll: alle freien Würfel in die Hand (gepackt bei Würfel from), dragCup bewegt, release wirft
    grabHand: (held, player, from) => throwDice(held, player, 'hand', from),
    dragCup,
    release() {
      if (roll) roll.released = true;
      else releaseEarly = true;
    },
    hitCup: (raycaster) => raycaster.intersectObject(cup, true).length > 0,
    // Teile für den Rundgang (tutorial.js): Punkt in der Welt
    anchor(name) {
      const o = { becher: cup, block: deco[0] }[name];
      if (o) return o.getWorldPosition(new THREE.Vector3());
      if (name !== 'wuerfel') return null;
      const sum = new THREE.Vector3();
      for (const d of dice) sum.add(d.getWorldPosition(new THREE.Vector3()));
      return sum.divideScalar(dice.length);
    },
    loose: () => [...dice, cup, ...deco], // fliegt beim Umwerfen einzeln (tisch.js)
    // Design dieses PCs: Würfelfarbe und Filz (settings.js)
    setDesign(s) {
      const f = diceFaces(s.dice);
      for (const d of dice) d.material.forEach((m, k) => Object.assign(m, f[FACE_VALUES[k] - 1], { needsUpdate: true }));
      felt.map = feltOf(s.felt);
      felt.needsUpdate = true;
    },
    reset,
    update(dt) {
      if (roll) stepPhysics(dt);
      if (remote) {
        const k = 1 - Math.exp(-dt * 30);
        remote.dice.forEach((r, i) => {
          dice[i].position.lerp(r.pos, k);
          dice[i].quaternion.slerp(r.quat, k);
        });
        cup.position.lerp(remote.cup.pos, k);
        cup.quaternion.slerp(remote.cup.quat, k);
      } else {
        updateMoves(dt);
      }
    },
    pickDie(raycaster) {
      const hit = raycaster.intersectObjects(dice, false)[0];
      return hit ? dice.indexOf(hit.object) : -1;
    },
    setHover(i) {
      if (i === hover) return;
      hover = i;
      setGlow('hover', i >= 0 ? [dice[i]] : []);
      updateLook();
    },
  };
}

// Würfelbecher aus Leder: gedrehtes Profil (außen, Rand, innen, Boden) mit Ursprung in der Bodenmitte
function buildCup(group) {
  const { r, h, wall } = CUP;
  const profile = [[0, 0], [r - 0.3, 0], [r, 0.3], [r, h - 0.2], [r - 0.15, h], [r - wall + 0.1, h], [r - wall, h - 0.2], [r - wall, wall], [0, wall]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a2b16, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), leather);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.12, 6, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 0.6 }));
  seam.position.y = h - 1.2;
  cup.add(seam);
  cup.castShadow = cup.receiveShadow = true;
  group.add(cup);
  return cup;
}

function buildTray(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.4 });
  const add = (geometry, material, x, y, z) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const outerW = TRAY.w + 2 * TRAY.t;
  const rimH = FLOOR + TRAY.h;
  add(new THREE.BoxGeometry(TRAY.w, FLOOR, TRAY.d), wood, 0, FLOOR / 2, 0);
  const felt = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  add(new THREE.PlaneGeometry(TRAY.w, TRAY.d).rotateX(-Math.PI / 2), felt, 0, FLOOR + 0.02, 0);
  for (const z of [1, -1]) add(new RoundedBoxGeometry(outerW, rimH, TRAY.t, 2, 0.4), wood, 0, rimH / 2, z * (TRAY.d + TRAY.t) / 2);
  for (const x of [1, -1]) add(new RoundedBoxGeometry(TRAY.t, rimH, TRAY.d + 0.2, 2, 0.4), wood, x * (TRAY.w + TRAY.t) / 2, rimH / 2, 0);
  return felt;
}

// Deko: Kniffel-Block und Bleistift rechts vor dem Host (liegen nur bei Kniffel auf dem Tisch)
function buildBlock(group) {
  const paperSide = new THREE.MeshStandardMaterial({ color: 0xf3ecdc, roughness: 0.9 });
  const top = new THREE.MeshStandardMaterial({ map: blockTexture(), roughness: 0.85 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 14), [paperSide, paperSide, top, paperSide, paperSide, paperSide]);
  block.position.set(36, 0.4, 27);
  block.rotation.y = -0.25;
  const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 16, 6), new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: 0.5 }));
  pencil.position.set(30, 0.4, 31);
  pencil.rotation.set(Math.PI / 2, 0, 0.9);
  for (const m of [block, pencil]) {
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return [block, pencil];
}
