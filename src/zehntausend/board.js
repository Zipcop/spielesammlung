// Zehntausend-Tisch: runde Filz-Arena mit Holzrand in der Mitte, sechs Würfel, ein Lederbecher und vor jedem Platz ein
// Holzbrettchen (Ablage) für die herausgelegten Würfel. Kennt keine Regeln: zeigt die Sicht eines Spielers (sync).
// Würfeln mit echter Physik (Rapier) wie bei Kniffel: Die Würfel wandern in den Becher, er wird geschüttelt (von selbst
// oder mit gedrückter Maustaste) und in die Arena ausgekippt – oder man packt einen Würfel und wirft alle freien als
// Handvoll. Physik rechnet nur, wer würfelt (beim Host auch für die Computer); er streamt die Lagen von Würfeln und
// Becher ('zt'), beim anderen PC werden sie nur angezeigt.
// Sitze wie bei Doppelkopf: 0 = +z (Host), 1 = −x, 2 = −z (Gast), 3 = +x. Maße in cm (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { feltOf, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, seatSide } from '../plates.js';
import { UP, rand, smooth, round, topFace, upright, randomTurn, yawOf, makeDie, restyleDie, pose, isPose } from '../wuerfel.js';

const DIE = 2.2;
const DIE_R = 0.28;
const ARENA = { r: 20, rim: 1.6, h: 3.2 }; // Innenradius, Randstärke, Randhöhe über dem Filz
const FLOOR = 0.8; // Filz liegt auf dieser Höhe
const STEP = 1 / 120;
const SEND_EVERY = 4; // 30 Lagen pro Sekunde
const MAX_STEPS = 8 / STEP;
const MOVE_S = 0.4;
const HIT_SPEED = 150;
const KINDS = ['die', 'wood', 'felt'];
const CUP = { r: 4.6, h: 10.5, wall: 0.5, sides: 14 };
const SHAKE_Y = FLOOR + 13;
const CUP_SPEED = 260; // so schnell folgt der Becher höchstens der Maus – sonst fliegen Würfel durch die Wand
const GATHER_S = 0.4;
const SHAKE_S = 0.9;
const POUR_S = 0.45;
const POUR_HOLD_S = 0.3;
const RETURN_S = 0.5;
const CUP_LIMIT = ARENA.r - CUP.r - 1.2; // Becher bleibt über der Arena
const HAND = { w: 7.4, h: 6.4, wall: 3 }; // unsichtbarer Käfig (die Hand) für die Handvoll
const HAND_Y = FLOOR + 6.5;
const HAND_LIMIT = ARENA.r - HAND.w / 2 - 3.5;
const TOSS_SPIN = 14;
const TRAY = { w: 23, d: 6.5, h: 1, at: 29 }; // Ablage vor dem Platz (at = Abstand von der Mitte)
// Namensschild (quer, Abstand): meins links vor der Ablage (rechts steht der Becher, mittig liegt der Bedienhinweis),
// gegenüber mittig hinter der Ablage, bei den Nachbarn an der Ecke zu mir hin
const PLATE = { mine: [-20, 30.5], front: [0, 36], side: [27, 32] };
const TOWARD = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung +z-Platz → Platz des Sitzes

// Punkt im Blick des Sitzes (x nach rechts, z zum Spieler hin) → Brett
const local = (seat, x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, SIDE[seat]);
const dirOf = (seat) => new THREE.Vector3(TOWARD[seat][0], 0, TOWARD[seat][1]);
const cupRest = (seat) => local(seat, 19.5, 0, 25);
const shakeAt = (seat) => local(seat, 0, SHAKE_Y, 11);
const slot = (seat, k) => local(seat, (k - 2.5) * 3.6, TRAY.h + DIE / 2, TRAY.at);
// Würfel liegen ohne bekannte Lage (z. B. nach dem Fortsetzen) auf festen Plätzen in der Arena
const spot = (i) => new THREE.Vector3(Math.cos(i * 1.05 + 0.4) * 8, FLOOR + DIE / 2, Math.sin(i * 1.05 + 0.4) * 8);
const clampR = (v, r) => {
  const h = Math.hypot(v.x, v.z);
  if (h > r) [v.x, v.z] = [(v.x * r) / h, (v.z * r) / h];
  return v;
};

export function createZehntausendBoard(parent, { onStream = () => {} } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const felt = buildArena(group);
  const trays = [0, 1, 2, 3].map((seat) => buildTray(group, seat));
  const cup = buildCup(group);
  const dice = [0, 1, 2, 3, 4, 5].map(() => {
    const m = makeDie(DIE, DIE_R);
    group.add(m);
    return m;
  });

  const plates = createPlates(group, 4, { w: 12, h: 3 });
  const plateAt = (s) => {
    const [x, z] = s === me ? PLATE.mine : (s - me) % 2 === 0 ? PLATE.front : [seatSide(s, me) * PLATE.side[0], PLATE.side[1]];
    return local(s, x, 0, z);
  };
  let view = null;
  let me = 0;
  let rest = []; // wo jeder Würfel nach dem letzten Wurf in der Arena liegt
  let moves = [];
  let cupMove = null;
  let roll = null; // eigener Wurf mit Physik
  let remote = null; // Wurf eines anderen PCs (gestreamte Lagen)
  let hover = -1;
  let releaseEarly = false;
  let generation = 0; // zählt reset() mit – ein Wurf, der beim Laden der Physik wartet, merkt so das Verlassen

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
      const add = (desc, kind, friction, restitution) => kindOf.set(world.createCollider(desc.setFriction(friction).setRestitution(restitution), fixed).handle, kind);
      add(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, FLOOR - 0.5, 0), 'felt', 0.8, 0.15);
      // Rand: 32 Bretter im Kreis, unsichtbar höher als der Holzrand – kein Würfel fliegt heraus; oben ein Deckel
      const n = 32;
      const H = 20;
      const width = 2 * (ARENA.r + ARENA.rim) * Math.tan(Math.PI / n) + 0.4;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        add(RAPIER.ColliderDesc.cuboid(ARENA.rim / 2, H, width / 2)
          .setTranslation(Math.cos(a) * (ARENA.r + ARENA.rim / 2), FLOOR + H, Math.sin(a) * (ARENA.r + ARENA.rim / 2))
          .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, -a)), 'wood', 0.3, 0.45);
      }
      add(RAPIER.ColliderDesc.cylinder(0.5, ARENA.r + 2).setTranslation(0, FLOOR + 2 * H, 0), 'wood', 0.3, 0.3);
    })();
    return loading;
  }

  // Eigener Wurf. thrown = welche Würfel fallen · mode: 'auto' = Becher schüttelt von selbst · 'cup' = Becher von Hand
  // (drag/release) · 'hand' = Handvoll, gepackt bei Würfel from. Liefert die Augenzahlen aller 6 Würfel.
  async function throwDice(thrown, seat, mode = 'auto', from = -1) {
    releaseEarly = false;
    const at = generation;
    await ready();
    if (roll || at !== generation) return null;
    const list = [0, 1, 2, 3, 4, 5].filter((i) => thrown[i]);
    const hand = mode === 'hand';
    const start = hand
      ? clampR((dice[from]?.position.clone() ?? shakeAt(seat)).setY(HAND_Y), HAND_LIMIT)
      : shakeAt(seat);
    // was gerade noch zur Ablage wandert, kommt sofort an (während der Physik steht es sonst mitten in der Luft)
    moves.forEach((m, i) => {
      if (!m || thrown[i]) return;
      dice[i].position.copy(m.to.pos);
      dice[i].quaternion.copy(m.to.quat);
    });
    moves = [];
    if (!hand) cupMove = null;
    return new Promise((resolve) => {
      roll = {
        list, seat, mode, manual: mode !== 'auto', resolve, start, dir: dirOf(seat),
        phase: 'gather', t: 0, released: releaseEarly, target: start.clone(), wobble: rand(0, 6),
        from: { cup: cup.position.clone(), dice: list.map((i) => ({ pos: dice[i].position.clone(), quat: dice[i].quaternion.clone() })) },
        turns: list.map(() => randomTurn(SIDE[seat])),
        bodies: [], cupBody: null, lid: null,
        acc: 0, steps: 0, freeSteps: 0, still: 0, nudges: 0, hits: [], lastHit: [], speed: [],
      };
    });
  }

  // Platz des k-ten Würfels im Becher (2 + 2 + 2 übereinander, jede Lage um 90° gedreht)
  function inCup(k, base) {
    const layer = Math.floor(k / 2);
    const a = layer % 2 ? Math.PI / 2 : 0;
    const off = k % 2 ? 1.35 : -1.35;
    return base.clone().add(new THREE.Vector3(Math.cos(a) * off, CUP.wall + DIE / 2 + 0.05 + layer * (DIE + 0.1), Math.sin(a) * off));
  }
  // Platz in der Hand (2 × 2 unten, zwei obendrauf)
  function inHand(k, base) {
    const [x, z] = [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]][k];
    return base.clone().add(new THREE.Vector3(x * 1.5, HAND.wall + DIE / 2 + 0.05 + (k < 4 ? 0 : DIE + 0.1), z * 1.5));
  }

  function gatherStep() {
    roll.t += STEP / GATHER_S;
    const k = smooth(Math.min(roll.t, 1));
    const hand = roll.mode === 'hand';
    if (!hand) {
      cup.position.lerpVectors(roll.from.cup, roll.start, k);
      cup.position.y += Math.sin(k * Math.PI) * 4;
      cup.quaternion.identity();
    }
    const place = (n) => (hand ? inHand(n, roll.start) : inCup(n, cup.position));
    roll.list.forEach((i, n) => {
      dice[i].position.lerpVectors(roll.from.dice[n].pos, place(n), k);
      dice[i].position.y += Math.sin(k * Math.PI) * 5;
      dice[i].quaternion.slerpQuaternions(roll.from.dice[n].quat, roll.turns[n], k);
    });
    if (roll.t < 1) return;
    if (hand) createHandBody();
    else createCupBody();
    roll.list.forEach((i, n) => {
      const p = hand ? inHand(n, roll.start) : inCup(n, roll.start);
      // Zufallsdrall und zufällige Lage: ein Würfel auf festem Schüttelweg liefe sonst fast vorherbestimmt
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(dice[i].quaternion)
        .setAngvel({ x: rand(-5, 5), y: rand(-5, 5), z: rand(-5, 5) })
        .setLinearDamping(0.1)
        .setAngularDamping(0.4));
      const half = DIE / 2 - DIE_R;
      const c = world.createCollider(RAPIER.ColliderDesc.roundCuboid(half, half, half, DIE_R).setRotation(randomTurn()) // s. wuerfel.js
        .setDensity(1.2).setFriction(0.45).setRestitution(0.35)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, i);
      roll.bodies[i] = body;
    });
    roll.phase = roll.manual ? 'grab' : 'auto';
    roll.t = 0;
  }

  // Becher als bewegter Körper: Boden, Wand aus schmalen Platten und ein unsichtbarer Deckel (die Hand)
  function createCupBody() {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(roll.start.x, roll.start.y, roll.start.z).setCcdEnabled(true));
    const add = (desc) => {
      const c = world.createCollider(desc.setFriction(0.5).setRestitution(0.2), body);
      kindOf.set(c.handle, 'cup');
      return c;
    };
    add(RAPIER.ColliderDesc.cylinder(CUP.wall / 2, CUP.r).setTranslation(0, CUP.wall / 2, 0));
    const width = 2 * CUP.r * Math.tan(Math.PI / CUP.sides) + 0.2;
    for (let k = 0; k < CUP.sides; k++) {
      const a = (k / CUP.sides) * Math.PI * 2;
      add(RAPIER.ColliderDesc.cuboid(CUP.wall / 2, CUP.h / 2, width / 2)
        .setTranslation(Math.cos(a) * (CUP.r - CUP.wall / 2), CUP.h / 2, Math.sin(a) * (CUP.r - CUP.wall / 2))
        .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, -a)));
    }
    roll.lid = add(RAPIER.ColliderDesc.cylinder(0.3, CUP.r).setTranslation(0, CUP.h + 0.3, 0));
    roll.cupBody = body;
  }

  // Hand: geschlossener, unsichtbarer Käfig – die Würfel klappern darin
  function createHandBody() {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(roll.start.x, roll.start.y, roll.start.z).setCcdEnabled(true));
    const { w, h, wall } = HAND;
    const add = (hx, hy, hz, x, y, z) => {
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.5).setRestitution(0.2), body);
      kindOf.set(c.handle, 'cup');
    };
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, wall / 2, 0);
    add(w / 2 + wall, wall / 2, w / 2 + wall, 0, h + wall / 2, 0);
    for (const s of [-1, 1]) {
      add(wall / 2, h / 2, w / 2 + wall, s * (w / 2 + wall / 2), h / 2, 0);
      add(w / 2, h / 2, wall / 2, 0, h / 2, s * (w / 2 + wall / 2));
    }
    roll.cupBody = body;
  }

  // Hand öffnen: Käfig weg, die Würfel fliegen mit ihrem Schwung weiter und bekommen Drall
  function toss() {
    world.removeRigidBody(roll.cupBody);
    roll.cupBody = null;
    for (const i of roll.list) roll.bodies[i].setAngvel({ x: rand(-TOSS_SPIN, TOSS_SPIN), y: rand(-TOSS_SPIN, TOSS_SPIN), z: rand(-TOSS_SPIN, TOSS_SPIN) }, true);
    roll.phase = 'free';
    roll.t = 1;
  }

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
        const w = roll.wobble;
        goal = roll.start.clone().add(new THREE.Vector3(3.5 * Math.sin(t * 20 + w), 1.4 * Math.sin(t * 25 + w) ** 2, 2.4 * Math.sin(t * 14.5 + 1 + w)));
        if (t >= SHAKE_S) startPour(pos);
      }
      clampR(goal, roll.mode === 'hand' ? HAND_LIMIT : CUP_LIMIT);
      const step = goal.sub(pos);
      const max = CUP_SPEED * STEP;
      if (step.length() > max) step.setLength(max);
      pos.add(step);
    }
    if (roll.phase === 'pour') {
      roll.t += STEP;
      const k = smooth(Math.min(roll.t / POUR_S, 1));
      const d = roll.dir; // Öffnung kippt zur Arenamitte (weg vom Spieler)
      quat.setFromAxisAngle(new THREE.Vector3(d.z, 0, -d.x), -2.1 * k);
      pos.copy(roll.pourFrom).add(new THREE.Vector3(-d.x * 1.5 * k, -3 * k, -d.z * 1.5 * k));
      if (roll.t >= POUR_S + POUR_HOLD_S) {
        cup.position.copy(pos);
        cup.quaternion.copy(quat);
        world.removeRigidBody(body);
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
    world.removeCollider(roll.lid, true);
    roll.phase = 'pour';
    roll.t = 0;
    roll.pourFrom = pos.clone();
  }

  function returnCup() {
    roll.t += STEP / RETURN_S;
    const k = smooth(Math.min(roll.t, 1));
    cup.position.lerpVectors(roll.back.pos, cupRest(roll.seat), k);
    cup.position.y += Math.sin(k * Math.PI) * 6;
    cup.quaternion.slerpQuaternions(roll.back.quat, new THREE.Quaternion(), k);
  }

  function stepPhysics(dt) {
    roll.acc = Math.min(roll.acc + dt, 8 * STEP);
    while (roll && roll.acc >= STEP) {
      roll.acc -= STEP;
      roll.steps++;
      if (roll.phase === 'gather') gatherStep();
      else {
        if (roll.cupBody) moveCup();
        else if (roll.mode !== 'hand') returnCup();
        roll.list.forEach((i) => (roll.speed[i] = roll.bodies[i].linvel()));
        world.step(queue);
        queue.drainCollisionEvents((h1, h2, started) => started && collide(kindOf.get(h1), kindOf.get(h2)));
        roll.list.forEach((i) => {
          dice[i].position.copy(roll.bodies[i].translation());
          dice[i].quaternion.copy(roll.bodies[i].rotation());
        });
        if (roll.cupBody) {
          cup.position.copy(roll.cupBody.translation());
          cup.quaternion.copy(roll.cupBody.rotation());
        }
      }
      if (roll.steps % SEND_EVERY === 0) {
        onStream({ t: 'zt', p: dice.flatMap(pose), c: pose(cup), s: roll.hits });
        roll.hits = [];
      }
      if (roll.phase === 'free') {
        roll.freeSteps++;
        checkSettled();
      }
    }
  }

  function collide(a, b) {
    if (typeof a !== 'number') [a, b] = [b, a];
    if (typeof a !== 'number') return;
    const va = roll.speed[a];
    const vb = typeof b === 'number' ? roll.speed[b] : { x: 0, y: 0, z: 0 };
    if (!va || !vb || roll.steps - (roll.lastHit[a] ?? -99) < 4) return;
    roll.lastHit[a] = roll.steps;
    const kind = typeof b === 'number' ? 'die' : b === 'cup' ? 'felt' : b; // Leder klingt dumpf wie Filz
    const strength = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) / HIT_SPEED;
    playHit(kind, strength);
    roll.hits.push([KINDS.indexOf(kind), round(strength, 2)]);
  }

  function checkSettled() {
    const calm = roll.list.every((i) => {
      const v = roll.bodies[i].linvel();
      const w = roll.bodies[i].angvel();
      return Math.hypot(v.x, v.y, v.z) < 0.8 && Math.hypot(w.x, w.y, w.z) < 0.3;
    });
    roll.still = calm ? roll.still + 1 : 0;
    if ((roll.still < 24 || roll.t < 1) && roll.freeSteps < MAX_STEPS) return;
    // schräg angelehnt oder auf einem anderen Würfel? Kurz zur Mitte hin anstupsen (wie am echten Tisch neu werfen)
    const bad = roll.list.filter((i) => topFace(dice[i].quaternion).up < 0.98 || dice[i].position.y > FLOOR + DIE / 2 + 0.4);
    if (bad.length && roll.nudges < 5 && roll.freeSteps < MAX_STEPS) {
      roll.nudges++;
      roll.still = 0;
      for (const i of bad) {
        const body = roll.bodies[i];
        const m = body.mass();
        const p = body.translation();
        body.applyImpulse({ x: -Math.sign(p.x) * rand(20, 50) * m, y: 90 * m, z: -Math.sign(p.z) * rand(20, 50) * m }, true);
        body.applyTorqueImpulse({ x: rand(-1, 1) * m, y: rand(-1, 1) * m, z: rand(-1, 1) * m }, true);
      }
      return;
    }
    const { list, bodies, resolve, seat } = roll;
    for (const i of list) {
      world.removeRigidBody(bodies[i]);
      // ganz flach hinlegen – und falls doch einer über den Rand kam: zurück in die Arena
      const v = topFace(dice[i].quaternion).value;
      clampR(dice[i].position, ARENA.r - DIE);
      dice[i].position.y = FLOOR + DIE / 2;
      dice[i].quaternion.copy(upright(v, yawOf(dice[i].quaternion)));
      rest[i] = { pos: dice[i].position.clone(), quat: dice[i].quaternion.clone() };
    }
    cup.position.copy(cupRest(seat));
    cup.quaternion.identity();
    onStream({ t: 'zt', p: dice.flatMap(pose), c: pose(cup), s: roll.hits, final: true });
    roll = null;
    resolve(dice.map((d) => topFace(d.quaternion).value));
  }

  // Maus → Ziel des Bechers bzw. der Hand (Ebene in Schüttelhöhe)
  function drag(raycaster) {
    if (roll?.phase !== 'grab' && roll?.phase !== 'gather') return;
    const [base, mid] = roll.mode === 'hand' ? [HAND_Y, HAND.wall + HAND.h / 2] : [SHAKE_Y, CUP.h / 2];
    const height = group.localToWorld(new THREE.Vector3(0, base + mid, 0)).y;
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
    if (!hit) return;
    const p = group.worldToLocal(hit);
    roll.target.set(p.x, base, p.z);
  }

  // --- Wurf eines anderen PCs anzeigen ---
  function applyRemote(msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 42 || !msg.p.every(Number.isFinite) || !isPose(msg.c)) return;
    remote ??= { dice: dice.map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() })), cup: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() } };
    remote.dice.forEach((r, i) => {
      r.pos.fromArray(msg.p, i * 7);
      r.quat.fromArray(msg.p, i * 7 + 3).normalize();
    });
    remote.cup.pos.fromArray(msg.c, 0);
    remote.cup.quat.fromArray(msg.c, 3).normalize();
    for (const hit of Array.isArray(msg.s) ? msg.s : []) {
      if (Array.isArray(hit) && KINDS[hit[0]] && Number.isFinite(hit[1])) playHit(KINDS[hit[0]], hit[1]);
    }
    if (!msg.final) return;
    remote.dice.forEach((r, i) => {
      dice[i].position.copy(r.pos);
      dice[i].quaternion.copy(r.quat);
      moves[i] = null;
      if (Math.hypot(r.pos.x, r.pos.z) < ARENA.r) rest[i] = { pos: r.pos.clone(), quat: r.quat.clone() };
    });
    cup.position.copy(remote.cup.pos);
    cup.quaternion.copy(remote.cup.quat);
    cupMove = null;
    remote = null;
    show();
  }

  // --- Anordnung passend zur Sicht ---
  function place(i, pos, quat) {
    const d = dice[i];
    const to = moves[i]?.to ?? { pos: d.position, quat: d.quaternion };
    if (to.pos.distanceTo(pos) < 0.01 && to.quat.angleTo(quat) < 0.01) return;
    moves[i] = { from: { pos: d.position.clone(), quat: d.quaternion.clone() }, to: { pos: pos.clone(), quat: quat.clone() }, t: 0 };
  }

  function show() {
    const v = view;
    if (!v || roll || remote) return;
    // Ablage: erst das schon Herausgelegte (in der Reihenfolge), dann das gerade Gewählte
    // (nach einem Anschluss kommt derselbe Würfel in mehreren Auswahlen vor – es zählt die letzte)
    const when = new Map();
    v.picks.forEach((p, n) => p.dice.forEach((i) => when.set(i, n)));
    const aside = [0, 1, 2, 3, 4, 5].filter((i) => v.where[i] === 'aside').sort((a, b) => (when.get(a) ?? 9) - (when.get(b) ?? 9) || a - b);
    const marked = [0, 1, 2, 3, 4, 5].filter((i) => v.marked[i]);
    const owner = v.by ?? v.turn ?? 0; // wer zuletzt geworfen hat – vor dem ersten Wurf des Nächsten liegt seine Ablage noch
    [...aside, ...marked].forEach((i, k) => place(i, slot(owner, k), upright(v.dice[i], SIDE[owner])));
    dice.forEach((d, i) => {
      if (v.where[i] === 'aside' || v.marked[i]) return;
      const r = rest[i];
      if (r && topFace(r.quat).value === v.dice[i]) place(i, r.pos, r.quat);
      else if (r) place(i, r.pos, upright(v.dice[i], yawOf(r.quat))); // heimlich gedreht: gleiche Stelle, andere Zahl
      else place(i, spot(i), upright(v.dice[i], i * 0.7));
    });
    const to = cupRest(v.turn ?? 0);
    if ((cupMove?.to ?? cup.position).distanceTo(to) > 0.01) cupMove = { from: cup.position.clone(), to, t: 0 };
    look();
  }

  function sync(v, seat) {
    view = v;
    me = seat;
    show();
  }

  // Gewählte Würfel leuchten golden, der unter der Maus hell
  function look() {
    dice.forEach((d, i) => {
      const color = view?.marked[i] ? 0x7a4e00 : i === hover ? 0x2e2e2e : 0x000000;
      d.material.forEach((m) => m.emissive.setHex(color));
    });
  }

  function updateMoves(dt) {
    moves.forEach((m, i) => {
      if (!m) return;
      m.t = Math.min(m.t + dt / MOVE_S, 1);
      const k = smooth(m.t);
      dice[i].position.lerpVectors(m.from.pos, m.to.pos, k);
      dice[i].position.y += Math.sin(m.t * Math.PI) * 5; // im Bogen über den Rand
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

  function reset() {
    generation++;
    if (roll) {
      roll.list.forEach((i) => roll.bodies[i] && world.removeRigidBody(roll.bodies[i]));
      if (roll.cupBody) world.removeRigidBody(roll.cupBody);
      roll = null;
    }
    remote = null;
    view = null;
    plates.set([]);
    rest = [];
    moves = [];
    cupMove = null;
    hover = -1;
    setGlow('hover', []);
    // Startbild: eine Straße liegt in der Arena
    dice.forEach((d, i) => {
      d.position.copy(spot(i));
      d.quaternion.copy(upright(i + 1, i * 0.7));
    });
    cup.position.copy(cupRest(0));
    cup.quaternion.identity();
    look();
  }

  reset();

  return {
    group,
    ready,
    sync,
    // Namensschilder: labels[sitz] = Text ('' = leerer Platz), turn = wer dran ist (oder null)
    names: (labels, turn = null) => plates.set(labels, { at: plateAt, view: SIDE[me], turn }),
    applyRemote,
    roll: (thrown, seat) => throwDice(thrown, seat, 'auto'),
    // Von Hand: grab startet den Wurf, drag bewegt, release kippt aus · grabHand: Handvoll, release wirft
    grab: (thrown, seat) => throwDice(thrown, seat, 'cup'),
    grabHand: (thrown, seat, from) => throwDice(thrown, seat, 'hand', from),
    drag,
    release() {
      if (roll) roll.released = true;
      else releaseEarly = true;
    },
    hitCup: (raycaster) => raycaster.intersectObject(cup, true).length > 0,
    pickDie(raycaster) {
      const hit = raycaster.intersectObjects(dice, false)[0];
      return hit ? dice.indexOf(hit.object) : -1;
    },
    // Leuchten unter der Maus: Würfel i (−1 = keiner) oder der Becher
    setHover(i, onCup = false) {
      hover = i;
      setGlow('hover', i >= 0 ? [dice[i]] : onCup ? [cup] : []);
      look();
    },
    busy: () => !!(roll || remote || cupMove || moves.some(Boolean)),
    rolling: () => !!roll,
    loose: () => [...dice, cup, ...trays], // fliegt beim Umwerfen einzeln (tisch.js)
    setDesign(s) {
      for (const d of dice) restyleDie(d, s.dice);
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
      } else if (!roll) updateMoves(dt);
    },
  };
}

// Runde Filz-Arena mit Holzrand – hier hinein wird gewürfelt
function buildArena(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.45 });
  const outer = ARENA.r + ARENA.rim;
  const rimH = FLOOR + ARENA.h;
  const shape = new THREE.Shape().absarc(0, 0, outer, 0, Math.PI * 2);
  shape.holes.push(new THREE.Path().absarc(0, 0, ARENA.r, 0, Math.PI * 2, true));
  const rim = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: rimH, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, curveSegments: 64 }).rotateX(-Math.PI / 2), wood);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(ARENA.r + 0.2, ARENA.r + 0.2, FLOOR, 64), wood);
  base.position.y = FLOOR / 2;
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const top = new THREE.Mesh(new THREE.CircleGeometry(ARENA.r, 64).rotateX(-Math.PI / 2), feltMat);
  top.position.y = FLOOR + 0.02;
  for (const m of [rim, base, top]) {
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  return feltMat;
}

// Ablage: flaches Holzbrettchen mit sechs Mulden vor dem Platz
function buildTray(group, seat) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#6b4220', boards: 1 }), roughness: 0.5 });
  const m = new THREE.Mesh(new RoundedBoxGeometry(TRAY.w, TRAY.h, TRAY.d, 2, 0.4), wood);
  m.position.copy(local(seat, 0, TRAY.h / 2, TRAY.at));
  m.rotation.y = SIDE[seat];
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}

// Würfelbecher aus Leder: gedrehtes Profil mit Ursprung in der Bodenmitte (wie bei Kniffel)
function buildCup(group) {
  const { r, h, wall } = CUP;
  const profile = [[0, 0], [r - 0.3, 0], [r, 0.3], [r, h - 0.2], [r - 0.15, h], [r - wall + 0.1, h], [r - wall, h - 0.2], [r - wall, wall], [0, wall]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const leather = new THREE.MeshStandardMaterial({ color: 0x3f2a1a, roughness: 0.7, side: THREE.DoubleSide });
  const cup = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), leather);
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r + 0.02, 0.12, 6, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc89a5a, roughness: 0.6 }));
  seam.position.y = h - 1.2;
  cup.add(seam);
  cup.castShadow = cup.receiveShadow = true;
  group.add(cup);
  return cup;
}
