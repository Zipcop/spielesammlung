// Bowling-Physik ohne Grafik (Rapier): Anlauf, Bahn (geölt und trocken), Rinnen, Pin-Deck mit Seitenwänden, Grube
// mit Rückwand, Kugel und 10 Pins. Ein Wurf Schritt für Schritt – läuft im Browser (lane.js zeigt alles) und mit
// node --test (test/bowling-physik.test.js). Maße in Metern: x quer (0 = Bahnmitte, + = rechts), y hoch (Bahn = 0),
// z längs (Foul-Linie 0, zum Werfer +, zu den Pins −). Der Drall kommt aus der Reibung: Die Kugel dreht sich zur Seite,
// rutscht auf dem Öl fast gerade und hakt erst auf dem trockenen hinteren Drittel ein (Hook).
// Die Reibung Kugel–Bahn rechnet dieser Baustein selbst (Coulomb, gegen die Rutschrichtung am Auflagepunkt): Rapier
// begrenzt Reibung je Achse (x und z getrennt) – schräg gerollte Kugeln zögen dann seitlich weg (gemessen).
import { LANE, PIN, BALL, SPOTS } from './rules.js';

export const STEP = 1 / 240;
export const MAX_S = 14; // spätestens dann ist der Wurf vorbei
export const RELEASE_Z = 0.25; // hier verlässt die Kugel die Hand (Mitte, hinter der Foul-Linie)
export const OIL = 12.19; // m geölt (40 ft, übliches Hausmuster), danach trocken
export const DECK_FRONT = -LANE.length + 0.12; // Pin-Deck beginnt knapp vor Kegel 1
export const DECK_END = -LANE.length - 0.98; // Ende des Pin-Decks, dahinter die Grube
export const PIT_Y = -0.38;
export const PIT_END = DECK_END - 0.95; // Rückwand (Vorhang)
export const HALF = LANE.width / 2;
export const GUTTER_Y = -0.048; // Rinnenboden (1,875 in tief)
export const KICK = HALF + LANE.gutter + 0.03; // Seitenwände am Pin-Deck (Kickbacks)
const MU = { approach: 0.1, oil: 0.012, dry: 0.12, deck: 0.2, gutter: 0.2 }; // Reibung Kugel–Boden
export const SPIN = 24; // rad/s Seitendrall bei vollem Hook (≈ 230 U/min um die Laufrichtung)
const ROLL0 = 0.25; // so viel Vorwärtsrollen hat die Kugel beim Loslassen schon
const TILT_DOWN = Math.cos((12 * Math.PI) / 180); // stärker geneigt = gefallen
const SOUND_NEAR = 0.006;

// Profil eines Pins (Halbmesser, Höhe) – Grafik nimmt es für die Drehform, die Physik seine konvexe Hülle
export const PIN_PROFILE = [
  [0, 0], [0.0258, 0], [0.038, 0.012], [0.05, 0.035], [0.058, 0.07], [0.0605, 0.112], [0.059, 0.145], [0.053, 0.185],
  [0.042, 0.222], [0.03, 0.252], [0.0232, 0.272], [0.0228, 0.29], [0.0265, 0.318], [0.032, 0.343], [0.031, 0.36],
  [0.024, 0.373], [0.012, 0.3795], [0, PIN.h],
];
const PIN_COM = 0.145; // Schwerpunkt über dem Boden (unten schwerer)
const FOOT_H = 0.012; // Höhe des Fußes (Zylinder, auf dem der Pin steht)

// Tempo 0–1 → Geschwindigkeit beim Loslassen (m/s): 4,5 (langsam) bis 10 (sehr schnell); üblich sind 7–8,5
export const speedOf = (tempo) => 4.5 + 5.5 * Math.max(0, Math.min(tempo, 1));
export const FOUL_TEMPO = 0.9; // so viel Schwung und mehr: der Werfer rutscht über die Foul-Linie

export function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;
  world.numSolverIterations = 8;
  const queue = new RAPIER.EventQueue(true);
  const kindOf = new Map(); // Collider-Handle → 'ball' | Pin-Nummer 0–9 | 'lane' | 'wall' | 'pit'
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const MIN = RAPIER.CoefficientCombineRule.Min;
  const box = (hx, hy, hz, x, y, z, kind, friction, restitution = 0.1) => {
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
      .setFriction(friction).setFrictionCombineRule(MIN).setRestitution(restitution).setRestitutionCombineRule(MIN)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), fixed);
    kindOf.set(c.handle, kind);
  };
  const T = 0.1; // Dicke der Böden
  const slab = (x0, x1, z0, z1, y, kind, mu, e) => box((x1 - x0) / 2, T / 2, (z0 - z1) / 2, (x0 + x1) / 2, y - T / 2, (z0 + z1) / 2, kind, mu, e);
  // Anlauf, Bahn und Pin-Deck in einem Stück: An Nahtstellen zwischen zwei Quadern springt die Kugel (gemessen) –
  // Öl und trockene Bahn unterscheidet rub(), die Reibung hier gilt nur für Pins
  slab(-HALF, HALF, 6, DECK_END, 0, 'lane', 0.2, 0);
  for (const s of [-1, 1]) {
    slab(s > 0 ? HALF : -HALF - LANE.gutter, s > 0 ? HALF + LANE.gutter : -HALF, 6, 0, 0, 'lane', 0.2); // Anlauf neben der Bahn
    // Rinne: flacher Boden tiefer als die Bahn, außen eine Kante; am Pin-Deck die hohen Seitenwände
    slab(s > 0 ? HALF : -HALF - LANE.gutter, s > 0 ? HALF + LANE.gutter : -HALF, 0, DECK_END, GUTTER_Y, 'gutter', 0.2);
    box(0.02, 0.06, (0 - DECK_FRONT) / 2 + 0.3, s * (HALF + LANE.gutter + 0.02), 0.01, DECK_FRONT / 2, 'wall', 0.2, 0.3);
    box(0.02, (0.75 - PIT_Y) / 2, (DECK_FRONT - PIT_END) / 2 + 0.3, s * (KICK + 0.02), (0.75 + PIT_Y) / 2, (DECK_FRONT + PIT_END) / 2, 'wall', 0.3, 0.45);
  }
  slab(-KICK, KICK, DECK_END, PIT_END, PIT_Y, 'pit', 0.9, 0.05); // Grube
  box(KICK, -PIT_Y / 2, 0.05, 0, PIT_Y / 2, DECK_END - 0.05, 'pit', 0.5, 0.1); // Stirnwand der Grube unter dem Deck
  box(KICK, 0.5, 0.05, 0, PIT_Y + 0.5, PIT_END - 0.05, 'pit', 0.9, 0.05); // Vorhang hinten, schluckt Kugel und Pins

  // Pin-Form einmal als Punktwolke
  // Hülle ohne den Fuß: Auf dem Boden steht der Pin auf einem flachen Zylinder (Hülle auf Quader wackelt in Rapier und
  // wirft stehende Pins von selbst um – gemessen); kippt er, liegt er auf der Hülle
  const hull = new Float32Array(PIN_PROFILE.filter(([r, y]) => r > 0 && y > 0).flatMap(([r, y]) => Array.from({ length: 16 }, (_, k) => {
    const a = (k / 16) * Math.PI * 2;
    return [Math.cos(a) * r, y - PIN_COM, Math.sin(a) * r];
  }).flat()));
  const Ix = PIN.mass * (3 * 0.045 ** 2 + PIN.h ** 2) / 12 + PIN.mass * 0.01 ** 2;
  const Iy = (PIN.mass * 0.045 ** 2) / 2;

  // Neuer Wurf. pins = Aufstellung (10 Einträge, null = liegt nicht mehr da), launch = { x, angle, speed, hook }
  // angle: Bogenmaß, 0 = gerade die Bahn hinunter, + = nach rechts · hook −1–1: + = hakt nach links (Rechtshänder)
  function start(pins, { x, angle, speed, hook }) {
    const ballBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, BALL.r + 0.002, RELEASE_Z).setCcdEnabled(true).setAngularDamping(0.02).setLinearDamping(0.01));
    const bc = world.createCollider(RAPIER.ColliderDesc.ball(BALL.r).setMass(BALL.mass).setFriction(0).setFrictionCombineRule(MIN).setRestitution(0.4)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), ballBody);
    kindOf.set(bc.handle, 'ball');
    const handles = [bc.handle]; // beim Abräumen wieder aus kindOf nehmen
    const d = { x: Math.sin(angle), z: -Math.cos(angle) };
    ballBody.setLinvel({ x: d.x * speed, y: 0, z: d.z * speed }, true);
    // Vorwärtsrollen um (oben × Richtung), Seitendrall um die Gegenrichtung (+ = hakt nach links)
    const roll = (speed / BALL.r) * ROLL0;
    const side = SPIN * Math.max(-1, Math.min(hook, 1));
    ballBody.setAngvel({ x: d.z * roll - d.x * side, y: 0, z: -d.x * roll - d.z * side }, true);
    const bodies = new Map();
    pins.forEach((p, n) => {
      if (!p) return;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p[0], PIN_COM, p[1])
        .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.15));
      const c = world.createCollider(RAPIER.ColliderDesc.convexHull(hull).setFriction(0.3).setFrictionCombineRule(MIN).setRestitution(0.62)
        .setMassProperties(PIN.mass, { x: 0, y: 0, z: 0 }, { x: Ix, y: Iy, z: Ix }, { x: 0, y: 0, z: 0, w: 1 })
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      const foot = world.createCollider(RAPIER.ColliderDesc.cylinder(FOOT_H / 2, PIN_PROFILE[1][0]).setTranslation(0, FOOT_H / 2 - PIN_COM, 0)
        .setDensity(0).setFriction(0.3).setFrictionCombineRule(MIN).setRestitution(0).setRestitutionCombineRule(MIN)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
      kindOf.set(c.handle, n);
      kindOf.set(foot.handle, n);
      handles.push(c.handle, foot.handle);
      bodies.set(n, body);
    });
    return { ball: ballBody, bodies, handles, start: pins, steps: 0, still: 0, gutter: false, reached: false, speed: new Map() };
  }

  // Ein Schritt. Liefert die Geräusche dieses Schritts: [Art, Stärke] mit Art 'pin' | 'ballpin' | 'lane' | 'gutter' | 'pit'
  function step(shot) {
    shot.steps++;
    rub(shot.ball);
    for (const [n, b] of [['ball', shot.ball], ...shot.bodies]) shot.speed.set(n, b.linvel());
    world.step(queue);
    const sounds = [];
    queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      let a = kindOf.get(h1);
      let b = kindOf.get(h2);
      if (typeof b === 'number' || b === 'ball') [a, b] = [b, a];
      const va = shot.speed.get(a) ?? { x: 0, y: 0, z: 0 };
      if (a === 'ball' && typeof b === 'number') sounds.push(['ballpin', Math.hypot(va.x, va.z) / 8]);
      else if (typeof a === 'number' && typeof b === 'number') {
        const vb = shot.speed.get(b) ?? { x: 0, y: 0, z: 0 };
        if (gapPins(shot, a, b) < SOUND_NEAR + 0.12) sounds.push(['pin', Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z) / 3]);
      } else if (typeof a === 'number') sounds.push([b === 'pit' ? 'pit' : 'pin', Math.hypot(va.x, va.y, va.z) / 5]);
      else if (a === 'ball') sounds.push([b === 'gutter' ? 'gutter' : b === 'pit' ? 'pit' : 'lane', Math.hypot(va.x, va.y, va.z) / 8]);
    });
    const p = shot.ball.translation();
    if (!shot.reached && p.z <= DECK_FRONT + 0.1) shot.reached = true;
    if (!shot.reached && Math.abs(p.x) > HALF + 0.01 && p.y < BALL.r - 0.01) shot.gutter = true; // vor den Pins in der Rinne
    return { sounds };
  }

  // Reibung am Auflagepunkt: Rutschen (Kugel dreht sich anders, als sie läuft) bremst gegen die Rutschrichtung –
  // höchstens so viel, bis sie sauber rollt. Kugel mit I = 2/5 m r²: Ein Stoß J ändert das Rutschen um 3,5 J / m.
  function rub(ball) {
    const p = ball.translation();
    const inGutter = Math.abs(p.x) > HALF && p.z > DECK_END;
    const floor = inGutter ? GUTTER_Y : p.z > DECK_END ? 0 : null;
    if (floor === null || p.y > floor + BALL.r + 0.004) return;
    const mu = inGutter ? MU.gutter : p.z > 0 ? MU.approach : p.z > -OIL ? MU.oil : p.z > DECK_FRONT ? MU.dry : MU.deck;
    const v = ball.linvel();
    const w = ball.angvel();
    const sx = v.x + w.z * BALL.r; // Geschwindigkeit des Auflagepunkts: v + ω × (0, −r, 0)
    const sz = v.z - w.x * BALL.r;
    const slip = Math.hypot(sx, sz);
    if (slip < 1e-6) return;
    const j = Math.min(mu * BALL.mass * 9.81 * STEP, (BALL.mass * slip) / 3.5);
    const jx = (-sx / slip) * j;
    const jz = (-sz / slip) * j;
    ball.applyImpulse({ x: jx, y: 0, z: jz }, true);
    ball.applyTorqueImpulse({ x: -BALL.r * jz, y: 0, z: BALL.r * jx }, true);
  }

  const gapPins = (shot, a, b) => {
    const p = shot.bodies.get(a).translation();
    const q = shot.bodies.get(b).translation();
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) - 2 * PIN.r;
  };

  // Ist der Wurf vorbei? Kugel in der Grube oder liegen geblieben, und alle Pins in Ruhe
  function done(shot) {
    const b = shot.ball.translation();
    const v = shot.ball.linvel();
    const ballDone = b.z < DECK_END - 0.15 || b.y < -0.2 || Math.hypot(v.x, v.z) < 0.05;
    const calm = [...shot.bodies.values()].every((body) => {
      const lv = body.linvel();
      const av = body.angvel();
      return Math.hypot(lv.x, lv.y, lv.z) < 0.03 && Math.hypot(av.x, av.y, av.z) < 0.15;
    });
    shot.still = ballDone && calm ? shot.still + 1 : 0;
    return shot.still >= 60 || shot.steps * STEP >= MAX_S;
  }

  // Steht ein Pin noch? Aufrecht (kaum geneigt), nicht abgesackt und auf dem Pin-Deck
  function standing(body) {
    const p = body.translation();
    const q = body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z); // y-Anteil der Pin-Achse
    return upY > TILT_DOWN && p.y > PIN_COM - 0.02 && Math.abs(p.x) < HALF + 0.005 && p.z < DECK_FRONT + 0.1 && p.z > DECK_END + 0.02;
  }

  // Lagen für die Anzeige: Kugel, dann Pins 0–9 (null = nicht im Spiel) – je [x, y, z, qx, qy, qz, qw]
  function poses(shot) {
    const of = (b) => {
      const p = b.translation();
      const q = b.rotation();
      return [p.x, p.y, p.z, q.x, q.y, q.z, q.w];
    };
    return { ball: of(shot.ball), pins: Array.from({ length: 10 }, (_, n) => (shot.bodies.has(n) ? of(shot.bodies.get(n)) : null)) };
  }

  // Wurf beenden: Körper aus der Physik nehmen, Ergebnis für die Regeln: { pins: Lagen der stehenden, gutter }
  function finish(shot) {
    const pins = Array.from({ length: 10 }, (_, n) => {
      const body = shot.bodies.get(n);
      if (!body || !standing(body)) return null;
      const p = body.translation();
      return [Math.round(p.x * 1e4) / 1e4, Math.round(p.z * 1e4) / 1e4];
    });
    for (const body of [shot.ball, ...shot.bodies.values()]) world.removeRigidBody(body);
    shot.bodies.clear();
    for (const h of shot.handles) kindOf.delete(h);
    return { pins, gutter: shot.gutter };
  }

  // Ganzer Wurf in einem Rutsch (Tests, Computer-Partien in Node)
  function simulate(pins, launch) {
    const shot = start(pins, launch);
    let path = [];
    while (!done(shot)) {
      step(shot);
      if (shot.steps % 24 === 0) path.push([shot.ball.translation().x, shot.ball.translation().z]);
    }
    const seconds = shot.steps * STEP;
    return { ...finish(shot), seconds, path };
  }

  return { start, step, done, finish, poses, simulate };
}

export const fullPins = () => SPOTS.map((p) => [...p]);
