// Schocken-Tisch: runde Filzmatte, vor jedem Platz ein Bierdeckel mit Lederbecher (umgedreht) und drei Würfeln darunter,
// herausgelegte Würfel liegen offen davor; in der Mitte der Stapel mit 13 Deckeln, die Deckel jedes Spielers links vor
// seinem Platz. Kennt keine Regeln: zeigt die Sicht eines Spielers (sync).
// Würfeln mit echter Physik (Rapier) wie bei Mäxchen: Becher samt Deckel anheben, schütteln (von selbst oder mit
// gedrückter Maustaste), auf den Tisch knallen – die Würfel klappern darin und bleiben darunter liegen. Physik rechnet
// nur, wer würfelt (beim Host auch für die Computer); gestreamt wird nur die Lage des Bechers ('sk'), nie die der
// Würfel – was unter einem fremden Becher liegt, erfährt ein PC erst beim Aufdecken aus seiner Sicht vom Host.
// Sitze wie bei Doppelkopf: 0 = +z (Host), 1 = −x, 2 = −z (Gast), 3 = +x. Maße in cm (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { feltOf, woodTexture, canvasTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, seatSide } from '../plates.js';
import { UP, rand, smooth, round, topFace, upright, randomQuat, randomTurn, yawOf, makeDie, restyleDie, pose, isPose } from '../wuerfel.js';

const DIE = 2.0;
const DIE_R = 0.25;
const MAT = { r: 30, h: 0.5 }; // Filzmatte (Oberkante = Boden der Physik)
const COASTER = { r: 5.4, h: 0.25 }; // Bierdeckel unter dem Becher
const CUP = { r: 4.4, h: 8, wall: 0.45, sides: 14 };
const SPOT_R = 13; // so weit steht der Becher von der Mitte zum Platz hin
const OUT = { x: [-2.5, 0, 2.5], z: 7.4 }; // herausgelegte Würfel: vor dem Becher (Platz-Richtung)
const OPEN_X = 10.5; // aufgedeckt: Becher steht rechts neben dem Deckel
const LID = { r: 4.6, h: 0.32 }; // Strafdeckel
const PILE = [-13, 21]; // Deckel eines Spielers: links vor seinem Platz
const PLATE = [24, 33]; // Namensschild: rechts vor dem Platz, neben der Matte
const TOWARD = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const STEP = 1 / 120;
const SEND_EVERY = 4;
const MAX_STEPS = 6 / STEP;
const LIFT_H = 10;
const LIFT_S = 0.25;
const SHAKE_S = 0.9;
const SLAM_S = 0.16;
const CUP_S = 0.35;
const MOVE_S = 0.4;
const LID_S = 0.6;
const HAND_R = 9;
const HAND_SPEED = 240;
const ACCEL = 3000; // so stark beschleunigt der Becher höchstens – sonst rutschen Würfel durch die Wand (wie Mäxchen)
const INSIDE = CUP.r - CUP.wall - DIE / 2;
const HIT_SPEED = 120;
const KINDS = ['die', 'wood', 'felt'];
// Würfel unter dem Becher, wenn die echte Lage hier nicht bekannt ist: x, z, Drehung
const SPOTS = [[-1.3, -0.75, 0.35], [1.3, -0.65, 1.1], [0.05, 1.45, 0.7]];

const local = (seat, x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, SIDE[seat]);
const seatQuat = (seat) => new THREE.Quaternion().setFromAxisAngle(UP, SIDE[seat]);

export function createSchockenBoard(parent, { onStream = () => {} } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const felt = buildMat(group);
  const coasterMats = coasterMaterials();
  const cupMat = new THREE.MeshStandardMaterial({ color: 0x4a2412, roughness: 0.72, side: THREE.DoubleSide });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 0.6 });
  const units = [0, 1, 2, 3].map((seat) => {
    const unit = new THREE.Group();
    unit.position.copy(local(seat, 0, MAT.h, SPOT_R));
    unit.quaternion.copy(seatQuat(seat));
    const shaker = new THREE.Group(); // Deckel + Becher: das bewegt sich beim Würfeln
    const coaster = new THREE.Mesh(new THREE.CylinderGeometry(COASTER.r, COASTER.r, COASTER.h, 48), coasterMats);
    coaster.position.y = COASTER.h / 2;
    coaster.castShadow = coaster.receiveShadow = true;
    const cup = buildCup(cupMat, seamMat);
    shaker.add(coaster, cup);
    const dice = [0, 1, 2].map(() => makeDie(DIE, DIE_R));
    unit.add(shaker, ...dice);
    group.add(unit);
    return { seat, unit, shaker, cup, dice, local: null, goal: 'closed', anim: null, moves: [] };
  });
  const lidGeo = new THREE.CylinderGeometry(LID.r, LID.r, LID.h, 40);
  const lidMats = lidMaterials();
  const lids = Array.from({ length: 13 }, (_, i) => {
    const m = new THREE.Mesh(lidGeo, lidMats);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return { mesh: m, owner: 'pot', k: i, anim: null };
  });

  const plates = createPlates(group, 4);
  let view = null;
  let me = 0;
  let roll = null; // eigener Wurf mit Physik
  let remote = null; // Wurf eines anderen PCs: { seat, pos, quat } (Lage des Bechers relativ zum Platz)
  let releaseEarly = false;
  let hover = null;
  let generation = 0;

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
      kindOf.set(world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, MAT.h - 0.5, 0)
        .setFriction(0.8).setRestitution(0.2), fixed).handle, 'felt');
    })();
    return loading;
  }

  // Becher + Deckel als geschlossener, bewegter Körper (Ursprung = Unterseite des Deckels)
  function createContainer(at, quat) {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z).setRotation(quat));
    const add = (desc) => kindOf.set(world.createCollider(desc.setFriction(0.5).setRestitution(0.25), body).handle, 'felt');
    add(RAPIER.ColliderDesc.cylinder(COASTER.h / 2 + 0.25, COASTER.r).setTranslation(0, COASTER.h / 2 - 0.25, 0));
    const width = 2 * CUP.r * Math.tan(Math.PI / CUP.sides) + 0.2;
    for (let k = 0; k < CUP.sides; k++) {
      const a = (k / CUP.sides) * Math.PI * 2;
      add(RAPIER.ColliderDesc.cuboid(CUP.wall / 2, CUP.h / 2, width / 2)
        .setTranslation(Math.cos(a) * (CUP.r - CUP.wall / 2), COASTER.h + CUP.h / 2, Math.sin(a) * (CUP.r - CUP.wall / 2))
        .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, -a)));
    }
    add(RAPIER.ColliderDesc.cylinder(0.5, CUP.r).setTranslation(0, COASTER.h + CUP.h - 0.5, 0));
    return body;
  }

  // Eigener Wurf für seat: out = herausgelegte Würfel (bleiben liegen). mode 'auto' = schüttelt von selbst ·
  // 'hand' = folgt der Maus (drag), release = knallen. Liefert die drei Augenzahlen, sobald alles ruhig liegt.
  async function throwDice(seat, out, mode = 'auto') {
    releaseEarly = mode === 'auto';
    const at = generation;
    await ready();
    if (roll || at !== generation) return null;
    const u = units[seat];
    finish(u);
    const rest = u.unit.position.clone();
    return new Promise((resolve) => {
      roll = {
        u, seat, mode, resolve, rest, base: u.unit.quaternion.clone(), list: [0, 1, 2].filter((k) => !out[k]),
        phase: 'cover', t: 0, released: releaseEarly, target: rest.clone().setY(rest.y + LIFT_H), vel: new THREE.Vector3(),
        body: null, bodies: [], acc: 0, steps: 0, freeSteps: 0, still: 0, nudges: 0, hits: [], lastHit: [], speed: [], wobble: rand(0, 6),
        coverFrom: { pos: u.cup.position.clone(), quat: u.cup.quaternion.clone() },
      };
      u.goal = 'closed';
      u.anim = null;
      // freie Würfel zurück unter den Becher (falls einer herausgelegt war)
      for (const k of roll.list) if (u.dice[k].position.clone().setY(0).length() > INSIDE) u.dice[k].position.set(SPOTS[k][0], COASTER.h + DIE / 2, SPOTS[k][1]);
      onStream({ t: 'sk', start: seat });
    });
  }

  const toGroup = (v) => v.clone().applyQuaternion(roll.base).add(roll.rest); // Platz → Brett
  function startPhysics() {
    roll.body = createContainer(roll.rest, roll.base);
    for (const k of roll.list) {
      const p = toGroup(roll.u.dice[k].position.clone().setY(COASTER.h + DIE / 2 + 0.3));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(randomQuat()) // zufällige Lage, damit der Startwurf nichts vorgibt
        .setAngvel({ x: rand(-6, 6), y: rand(-6, 6), z: rand(-6, 6) })
        .setLinearDamping(0.1).setAngularDamping(0.4));
      const half = DIE / 2 - DIE_R;
      const c = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half, half, half, DIE_R).setRotation(randomTurn()) // s. wuerfel.js
        .setDensity(1.2).setFriction(0.45).setRestitution(0.35).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, k);
      roll.bodies[k] = body;
    }
    roll.phase = 'lift';
    roll.t = 0;
  }

  function moveContainer() {
    const now = roll.body.translation();
    const pos = new THREE.Vector3(now.x, now.y, now.z);
    const shake = new THREE.Quaternion();
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
        const w = roll.wobble;
        goal = top.clone().add(new THREE.Vector3(3 * Math.sin(t * 19 + w), 2.2 * Math.sin(t * 26 + w) ** 2, 2.2 * Math.sin(t * 14 + 1 + w)));
        shake.setFromEuler(new THREE.Euler(0.18 * Math.sin(t * 17 + w), 0, 0.18 * Math.sin(t * 21 + 2 + w)));
        if (t >= SHAKE_S) startSlam(pos);
      } else {
        goal = roll.target.clone();
        if (roll.released) startSlam(pos);
      }
      const off = goal.clone().sub(roll.rest).setY(0);
      if (off.length() > HAND_R) goal.sub(off).add(off.setLength(HAND_R));
      const to = goal.sub(pos);
      const want = to.clone().setLength(Math.min(HAND_SPEED, Math.sqrt(2 * ACCEL * to.length()), to.length() / STEP));
      const dv = want.sub(roll.vel);
      if (dv.length() > ACCEL * STEP) dv.setLength(ACCEL * STEP);
      roll.vel.add(dv);
      pos.addScaledVector(roll.vel, STEP);
    }
    if (roll.phase === 'slam') {
      const k = Math.min(roll.t / SLAM_S, 1);
      pos.lerpVectors(roll.slamFrom, roll.rest, k * k);
      if (k === 1) {
        roll.phase = 'settle';
        playHit('wood', 0.9);
        roll.hits.push([1, 0.9]);
      }
    }
    roll.body.setNextKinematicTranslation(pos);
    roll.body.setNextKinematicRotation(roll.base.clone().multiply(shake));
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
      const { u } = roll;
      if (roll.phase === 'cover') {
        // Becher erst wieder über die Würfel stülpen
        roll.t += STEP / 0.3;
        const k = smooth(Math.min(roll.t, 1));
        u.cup.position.lerpVectors(roll.coverFrom.pos, new THREE.Vector3(0, COASTER.h, 0), k);
        u.cup.position.y += Math.sin(k * Math.PI) * 5;
        u.cup.quaternion.slerpQuaternions(roll.coverFrom.quat, new THREE.Quaternion(), k);
        if (roll.t >= 1) startPhysics();
      } else {
        if (roll.phase !== 'settle') moveContainer();
        roll.list.forEach((k) => (roll.speed[k] = roll.bodies[k].linvel()));
        world.step(queue);
        queue.drainCollisionEvents((h1, h2, started) => started && collide(kindOf.get(h1), kindOf.get(h2)));
        const inv = roll.base.clone().invert();
        const p = roll.body.translation();
        u.shaker.position.set(p.x, p.y, p.z).sub(roll.rest).applyQuaternion(inv);
        u.shaker.quaternion.copy(inv).multiply(new THREE.Quaternion().copy(roll.body.rotation()));
        for (const k of roll.list) {
          const t = roll.bodies[k].translation();
          u.dice[k].position.set(t.x, t.y, t.z).sub(roll.rest).applyQuaternion(inv);
          u.dice[k].quaternion.copy(inv).multiply(new THREE.Quaternion().copy(roll.bodies[k].rotation()));
        }
        if (roll.phase === 'settle') {
          roll.freeSteps++;
          checkSettled();
        }
      }
      if (roll && roll.steps % SEND_EVERY === 0) {
        onStream({ t: 'sk', seat: roll.seat, c: pose(u.shaker), s: roll.hits });
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
    const calm = roll.list.every((k) => {
      const v = roll.bodies[k].linvel();
      const w = roll.bodies[k].angvel();
      return Math.hypot(v.x, v.y, v.z) < 0.6 && Math.hypot(w.x, w.y, w.z) < 0.3;
    });
    roll.still = calm ? roll.still + 1 : 0;
    if (roll.still < 24 && roll.freeSteps < MAX_STEPS) return;
    const { u } = roll;
    // schräg an der Becherwand oder auf einem anderen Würfel? Kurz anstupsen (wie den Becher nochmal rütteln)
    const bad = roll.list.filter((k) => topFace(u.dice[k].quaternion).up < 0.98 || u.dice[k].position.y > COASTER.h + DIE / 2 + 0.35);
    if (bad.length && roll.nudges < 6 && roll.freeSteps < MAX_STEPS) {
      roll.nudges++;
      roll.still = 0;
      for (const k of bad) {
        const b = roll.bodies[k];
        const m = b.mass();
        const d = u.dice[k].position.clone().setY(0).applyQuaternion(roll.base);
        b.applyImpulse({ x: -d.x * 8 * m, y: 70 * m, z: -d.z * 8 * m }, true);
        b.applyTorqueImpulse({ x: rand(-0.6, 0.6) * m, y: rand(-0.6, 0.6) * m, z: rand(-0.6, 0.6) * m }, true);
      }
      return;
    }
    const { resolve, body, bodies, list } = roll;
    for (const b of [body, ...list.map((k) => bodies[k])]) world.removeRigidBody(b);
    u.shaker.position.set(0, 0, 0);
    u.shaker.quaternion.identity();
    const values = u.dice.map((d, k) => topFace(d.quaternion).value);
    for (const k of list) {
      const d = u.dice[k];
      if (d.position.clone().setY(0).length() > INSIDE + 0.5) d.position.set(SPOTS[k][0], 0, SPOTS[k][1]); // doch herausgerutscht
      d.quaternion.copy(upright(values[k], yawOf(d.quaternion)));
      d.position.y = COASTER.h + DIE / 2;
    }
    u.local = u.dice.map((d) => ({ pos: d.position.clone(), quat: d.quaternion.clone() }));
    onStream({ t: 'sk', seat: roll.seat, c: pose(u.shaker), s: roll.hits, final: true });
    roll = null;
    resolve(values);
  }

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
    if (Number.isInteger(msg.start) && units[msg.start]) {
      const u = units[msg.start];
      u.local = null; // die Würfel hier sind nicht mehr die echten
      u.dice.forEach((d, k) => !view?.out[u.seat][k] && (d.visible = false));
      u.goal = 'closed';
      u.anim = { from: { pos: u.cup.position.clone(), quat: u.cup.quaternion.clone() }, to: closedPose(), t: 0, arc: 5 };
      return;
    }
    if (!units[msg.seat] || !isPose(msg.c)) return;
    remote ??= { seat: msg.seat, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    remote.seat = msg.seat;
    remote.pos.fromArray(msg.c, 0);
    remote.quat.fromArray(msg.c, 3).normalize();
    for (const hit of Array.isArray(msg.s) ? msg.s : []) {
      if (Array.isArray(hit) && KINDS[hit[0]] && Number.isFinite(hit[1])) playHit(KINDS[hit[0]], hit[1]);
    }
    if (!msg.final) return;
    const u = units[msg.seat];
    u.shaker.position.set(0, 0, 0);
    u.shaker.quaternion.identity();
    remote = null;
    show();
  }

  // --- Anzeige passend zur Sicht ---
  const closedPose = () => ({ pos: new THREE.Vector3(0, COASTER.h, 0), quat: new THREE.Quaternion() });
  // gelupft: zum Spieler hin angehoben (Platz-Richtung = +z im Platz)
  function peekPose() {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -1.3);
    const pivot = new THREE.Vector3(0, COASTER.h, -CUP.r);
    return { pos: pivot.add(new THREE.Vector3(0, 0, CUP.r).applyQuaternion(quat)), quat };
  }
  const openPose = () => ({ pos: new THREE.Vector3(OPEN_X, 0, 0), quat: new THREE.Quaternion() });

  function place(u, k, pos, quat) {
    const d = u.dice[k];
    const to = u.moves[k]?.to ?? { pos: d.position, quat: d.quaternion };
    if (to.pos.distanceTo(pos) < 0.01 && to.quat.angleTo(quat) < 0.01) return;
    u.moves[k] = { from: { pos: d.position.clone(), quat: d.quaternion.clone() }, to: { pos: pos.clone(), quat: quat.clone() }, t: 0 };
  }

  function show() {
    const v = view;
    if (!v) return;
    for (const u of units) {
      const p = u.seat;
      u.unit.visible = v.seats.length ? v.seats.includes(p) : p === 0 || p === 2;
      if (roll?.u === u || remote?.seat === p) continue;
      const shown = v.shown && v.shown.results.some((r) => r.player === p);
      const values = shown ? v.shown.dice[p] : v.dice[p];
      u.dice.forEach((d, k) => {
        const out = !shown && v.out[p][k];
        const value = values[k];
        d.visible = value !== null;
        if (value === null) return;
        if (out) return place(u, k, new THREE.Vector3(OUT.x[k], DIE / 2, OUT.z), upright(value, 0));
        const known = u.local?.[k];
        if (known && known.pos.clone().setY(0).length() <= INSIDE + 0.01 && topFace(known.quat).value === value) place(u, k, known.pos, known.quat);
        else {
          const [x, z, yaw] = SPOTS[k];
          const pos = known && known.pos.clone().setY(0).length() <= INSIDE + 0.01 ? known.pos : new THREE.Vector3(x, COASTER.h + DIE / 2, z);
          place(u, k, pos, upright(value, known ? yawOf(known.quat) : yaw));
        }
      });
      const goal = shown ? 'open' : p === me && v.turn === me && v.rolls > 0 ? 'peek' : 'closed';
      if (goal !== u.goal) {
        const to = goal === 'open' ? openPose() : goal === 'peek' ? peekPose() : closedPose();
        u.anim = { from: { pos: u.cup.position.clone(), quat: u.cup.quaternion.clone() }, to, t: 0, arc: goal === 'open' || u.goal === 'open' ? 6 : 0 };
        u.goal = goal;
      }
    }
    placeLids(v);
  }

  // Deckel: so wenige wie möglich bewegen – wer zu viele hat, gibt die obersten ab, wer zu wenige hat, bekommt sie
  function placeLids(v) {
    const want = { pot: v.pot };
    for (const p of [0, 1, 2, 3]) want[p] = v.stones[p];
    const have = (o) => lids.filter((l) => l.owner === o);
    const free = [];
    for (const o of Object.keys(want)) {
      const mine = have(o === 'pot' ? 'pot' : Number(o)).sort((a, b) => a.k - b.k);
      free.push(...mine.slice(want[o]));
    }
    for (const o of Object.keys(want)) {
      const owner = o === 'pot' ? 'pot' : Number(o);
      let n = have(owner).filter((l) => !free.includes(l)).length;
      while (n < want[o] && free.length) {
        const l = free.shift();
        l.owner = owner;
        l.k = 99 + n; // kommt oben drauf
        n++;
      }
    }
    let delay = 0;
    for (const o of Object.keys(want)) {
      const owner = o === 'pot' ? 'pot' : Number(o);
      have(owner).sort((a, b) => a.k - b.k).forEach((l, k) => {
        l.k = k;
        const to = lidSpot(owner, k);
        const goal = l.anim?.to ?? l.mesh.position;
        if (goal.distanceTo(to) < 0.01) return;
        l.anim = { from: l.mesh.position.clone(), to, t: -delay };
        delay += 0.06;
      });
    }
  }
  const lidSpot = (owner, k) => (owner === 'pot'
    ? new THREE.Vector3(Math.sin(k * 2.1) * 0.25, MAT.h + LID.h / 2 + k * LID.h, Math.cos(k * 1.7) * 0.25)
    : local(owner, PILE[0] + Math.sin(k * 2.1) * 0.25, MAT.h + LID.h / 2 + k * LID.h, PILE[1] + Math.cos(k * 1.7) * 0.25));

  function sync(v, seat) {
    view = v;
    me = seat;
    show();
  }

  function finish(u) {
    if (u.anim) {
      u.cup.position.copy(u.anim.to.pos);
      u.cup.quaternion.copy(u.anim.to.quat);
    }
    u.anim = null;
  }

  function updateAnims(dt) {
    for (const u of units) {
      if (u.anim) {
        u.anim.t = Math.min(u.anim.t + dt / CUP_S, 1);
        const k = smooth(u.anim.t);
        u.cup.position.lerpVectors(u.anim.from.pos, u.anim.to.pos, k);
        u.cup.position.y += Math.sin(u.anim.t * Math.PI) * u.anim.arc;
        u.cup.quaternion.slerpQuaternions(u.anim.from.quat, u.anim.to.quat, k);
        if (u.anim.t === 1) u.anim = null;
      }
      if (roll?.u === u) continue;
      u.moves.forEach((m, k) => {
        if (!m) return;
        m.t = Math.min(m.t + dt / MOVE_S, 1);
        const s = smooth(m.t);
        u.dice[k].position.lerpVectors(m.from.pos, m.to.pos, s);
        u.dice[k].position.y += Math.sin(m.t * Math.PI) * 3;
        u.dice[k].quaternion.slerpQuaternions(m.from.quat, m.to.quat, s);
        if (m.t === 1) u.moves[k] = null;
      });
    }
    for (const l of lids) {
      if (!l.anim) continue;
      l.anim.t = Math.min(l.anim.t + dt / LID_S, 1);
      const k = smooth(Math.max(0, l.anim.t));
      l.mesh.position.lerpVectors(l.anim.from, l.anim.to, k);
      l.mesh.position.y += Math.sin(k * Math.PI) * 8;
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
    view = null;
    plates.set([]);
    for (const u of units) {
      u.local = null;
      u.anim = null;
      u.moves = [];
      u.goal = 'closed';
      u.unit.visible = u.seat === 0 || u.seat === 2;
      u.shaker.position.set(0, 0, 0);
      u.shaker.quaternion.identity();
      const c = closedPose();
      u.cup.position.copy(c.pos);
      u.cup.quaternion.copy(c.quat);
      u.dice.forEach((d, k) => {
        d.position.set(SPOTS[k][0], COASTER.h + DIE / 2, SPOTS[k][1]);
        d.quaternion.copy(upright(1, SPOTS[k][2]));
        d.visible = false;
      });
    }
    lids.forEach((l, k) => {
      l.owner = 'pot';
      l.k = k;
      l.anim = null;
      l.mesh.position.copy(lidSpot('pot', k));
    });
    setHover(null);
  }

  function setHover(seat) {
    if (seat === hover) return;
    hover = seat;
    setGlow('hover', seat === null ? [] : [units[seat].cup.children[0]]);
  }

  reset();

  return {
    group,
    ready,
    sync,
    // Namensschilder: labels[sitz] = Text ('' = leerer Platz), turn = wer dran ist (oder null), out(sitz) = raus (blass)
    names: (labels, turn = null, out = () => false) => plates.set(labels, { at: (s) => local(s, seatSide(s, me) * PLATE[0], 0, PLATE[1]), view: SIDE[me], turn, faded: out }),
    roll: (seat, out) => throwDice(seat, out, 'auto'),
    grab: (seat, out) => throwDice(seat, out, 'hand'),
    drag,
    release() {
      if (roll) roll.released = true;
      else releaseEarly = true;
    },
    applyRemote,
    hitCup: (raycaster, seat) => raycaster.intersectObject(units[seat].shaker, true).length > 0,
    // eigener Würfel unter der Maus (unter dem gelupften Becher oder herausgelegt) → 0–2, sonst −1
    pickDie(raycaster, seat) {
      const hit = raycaster.intersectObjects(units[seat].dice.filter((d) => d.visible), false)[0];
      return hit ? units[seat].dice.indexOf(hit.object) : -1;
    },
    setHover,
    busy: () => !!(roll || remote || units.some((u) => u.anim || u.moves.some(Boolean)) || lids.some((l) => l.anim)),
    rolling: () => !!roll,
    loose: () => [...units.map((u) => u.unit), ...lids.map((l) => l.mesh)], // Becher samt Würfeln fliegt als Ganzes, Deckel einzeln (tisch.js)
    setDesign(s) {
      for (const u of units) for (const d of u.dice) restyleDie(d, s.dice);
      felt.map = feltOf(s.felt);
      felt.needsUpdate = true;
    },
    reset,
    update(dt) {
      if (roll) stepPhysics(dt);
      if (remote) {
        const u = units[remote.seat];
        const k = 1 - Math.exp(-dt * 30);
        u.shaker.position.lerp(remote.pos, k);
        u.shaker.quaternion.slerp(remote.quat, k);
      }
      updateAnims(dt);
    },
  };
}

// Runde Filzmatte mit Holzrand
function buildMat(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.45 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(MAT.r + 1, MAT.r + 1.2, MAT.h, 72), wood);
  rim.position.y = MAT.h / 2;
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const top = new THREE.Mesh(new THREE.CircleGeometry(MAT.r, 72).rotateX(-Math.PI / 2), feltMat);
  top.position.y = MAT.h + 0.02;
  for (const m of [rim, top]) {
    m.receiveShadow = true;
    group.add(m);
  }
  return feltMat;
}

// Bierdeckel unter dem Becher: Pappe mit Rand und Schriftzug
function coasterMaterials() {
  const print = canvasTexture(512, 512, (g, w) => {
    g.fillStyle = '#efe4c8';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#1f4f8a';
    g.lineWidth = 18;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 30, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#1f4f8a';
    g.font = 'bold 84px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Schocken', w / 2, w / 2 - 18);
    g.font = 'italic 46px Georgia, serif';
    g.fillText('1 · 1 · 1', w / 2, w / 2 + 62);
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xd9ccaa, roughness: 0.95 });
  return [side, new THREE.MeshStandardMaterial({ map: print, roughness: 0.9 }), side];
}

// Strafdeckel: rote Pappe mit hellem Ring
function lidMaterials() {
  const print = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#9b2a22';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#f1e2c2';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f1e2c2';
    g.font = 'bold 60px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Prost', w / 2, w / 2 + 4);
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xcdbb94, roughness: 0.95 });
  return [side, new THREE.MeshStandardMaterial({ map: print, roughness: 0.85 }), side];
}

// Lederbecher, umgedreht: Ursprung in der Mitte des Rands (unten), oben geschlossen (wie Mäxchen)
function buildCup(leather, seamMat) {
  const { r, h, wall } = CUP;
  const profile = [[0, 0], [r - 0.3, 0], [r, 0.3], [r, h - 0.2], [r - 0.15, h], [r - wall + 0.1, h], [r - wall, h - 0.2], [r - wall, wall], [0, wall]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 40).rotateX(Math.PI).translate(0, h, 0), leather);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.12, 6, 40).rotateX(Math.PI / 2), seamMat);
  seam.position.y = 1.2;
  mesh.castShadow = mesh.receiveShadow = true;
  const cup = new THREE.Group();
  cup.add(mesh, seam);
  cup.position.y = COASTER.h;
  return cup;
}
