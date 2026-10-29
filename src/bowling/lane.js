// Bowlingcenter als eigener Ort außerhalb des Zimmers (Gruppe direkt in room.scene, Mitte bei x = 60, z = 0):
// acht Bahnen mit Rinnen, Anlauf, Kugelrücklauf, Pin-Deck, Pinsetter hinter der Maskenblende, Anzeigetafel über der
// eigenen Bahn, Sitzecke, warmes Licht und Neon. Gespielt wird auf Bahn 5; die anderen sind Kulisse.
// Die Physik (physics.js, Rapier) rechnet nur der werfende PC; er streamt Kugel und Pins, beim anderen wird nur gezeigt.
// Koordinaten der Physik: x quer, z längs ab Foul-Linie (Pins bei −18,3) – in der Gruppe liegt die Foul-Linie bei FOUL_Z.
import * as THREE from 'three';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { createPhysics, STEP, RELEASE_Z, PIN_PROFILE, DECK_END, DECK_FRONT, HALF, KICK, PIT_Y, PIT_END } from './physics.js';
import { LANE, PIN, BALL, SPOTS, FRAMES } from './rules.js';

export const CENTER = [60, 0]; // Mitte des Bowlingcenters in der Welt (Minigolf liegt bei x = −60)
export const FOUL_Z = 9.2; // Foul-Linie in der Gruppe – so liegt die Bahn mittig um den Ursprung
const LANES = 8;
const OURS = 4; // Bahn 5 von links (Paar mit Bahn 6, der Kugelrücklauf liegt rechts daneben)
const PITCH = 1.75; // Abstand der Bahnmitten
const SEND_EVERY = 8; // 30 Lagen pro Sekunde an den Mitspieler
const ARM = 0.8; // Pendel des Arms: Schulter bis Kugelmitte
const HAND_BACK = 1.0; // so weit hinter dem Abwurfpunkt steht man vor dem letzten Schritt
const REST = -0.9; // Arm-Winkel beim Zielen: Kugel vor dem Körper
const ROOF = 3.4;
const BACK_Z = -12.2; // Rückwand hinter der Grube
const REAR_Z = 19.5; // Wand hinter der Sitzecke
const DECK_UP = 1.15; // Pinsetter-Tisch oben (hinter der Blende)
const DECK_PICK = PIN.h + 0.02;
const SETTER_S = 3.1;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const UP = new THREE.Vector3(0, 1, 0);
const laneX = (i) => (i - OURS) * PITCH;
const ease = (t) => t * t * (3 - 2 * t);
const span = (t, a, b) => ease(Math.min(Math.max((t - a) / (b - a), 0), 1));

export function createBowlingBoard(scene, { onStream }) {
  const group = new THREE.Group();
  group.position.set(CENTER[0], 0, CENTER[1]);
  scene.add(group);
  const lane = new THREE.Group(); // unsere Bahn: Physik-Koordinaten + FOUL_Z
  lane.position.z = FOUL_Z;
  group.add(lane);

  const look = buildHall(group);
  const { spot } = look;
  const pinGeo = pinGeometry();
  const pinMat = new THREE.MeshPhysicalMaterial({ map: pinTexture(), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 });
  const pins = SPOTS.map(() => {
    const m = new THREE.Mesh(pinGeo, pinMat);
    m.castShadow = m.receiveShadow = true;
    lane.add(m);
    return m;
  });
  const ballGeo = new THREE.SphereGeometry(BALL.r, 40, 24);
  const balls = [['#2a5bd7', '#9fd0ff'], ['#b0242c', '#ffb36b']].map(([a, b]) => {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ map: ballTexture(a, b), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }));
    m.castShadow = true;
    lane.add(m);
    return m;
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
  lane.add(blob);
  const aimLine = buildAim();
  lane.add(aimLine.group);
  const setterParts = buildSetter(lane);
  const monitor = buildMonitor(group);

  let state = null;
  let shot = null; // eigener Wurf mit Physik
  let remote = null; // Wurf des Mitspielers (gestreamte Lagen)
  let hand = null; // { player, x, angle, th, pz, aim } – Kugel in der Hand
  let setter = null; // Pinsetter läuft: { t, lying, keep, full, target }
  let shownSeq = null;
  let active = 0; // wessen Kugel gerade benutzt wird
  let lastPoses = null; // letzte Lagen (für den Pinsetter): Pins [x, y, z, qx, qy, qz, qw] | null

  // --- Physik (wird beim ersten Wurf geladen) ---
  let physics = null;
  let loading = null;
  function ready() {
    loading ??= (async () => {
      const RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      physics = createPhysics(RAPIER);
    })();
    return loading;
  }

  // Eigener Wurf: launch = { x, angle, speed, hook } → Ergebnis { pins, gutter }
  async function throwBall(launch) {
    await ready();
    if (shot || !state) return null;
    hand = null;
    drawHand();
    const sim = physics.start(state.pins, launch);
    playHit('wood', 0.5);
    return new Promise((resolve) => {
      shot = { sim, resolve, acc: 0, hits: [], roll: 0 };
    });
  }

  function stepPhysics(dt) {
    shot.acc = Math.min(shot.acc + dt, 16 * STEP);
    while (shot && shot.acc >= STEP) {
      shot.acc -= STEP;
      const { sounds } = physics.step(shot.sim);
      for (const [kind, strength] of sounds) sound(kind, strength, shot.hits);
      rolling(shot, shot.sim.ball.linvel(), shot.sim.ball.translation(), shot.hits);
      const p = physics.poses(shot.sim);
      show(p);
      if (shot.sim.steps % SEND_EVERY === 0) {
        onStream({ t: 'bowl', p: flat(p), s: shot.hits });
        shot.hits = [];
      }
      if (physics.done(shot.sim)) {
        const report = physics.finish(shot.sim);
        onStream({ t: 'bowl', p: flat(p), s: shot.hits, final: true });
        const { resolve } = shot;
        shot = null;
        resolve(report);
      }
    }
  }

  // Rollgeräusch: alle 70 ms ein leises Grollen, solange die Kugel auf Holz läuft
  function rolling(r, v, p, hits) {
    r.roll += STEP;
    if (r.roll < 0.07) return;
    r.roll = 0;
    const speed = Math.hypot(v.x, v.z);
    if (p.y < BALL.r + 0.01 && p.z > DECK_END && speed > 0.3) sound(Math.abs(p.x) > HALF ? 'gutter' : 'roll', speed / 9, hits);
  }

  const KINDS = ['pin', 'ballpin', 'lane', 'gutter', 'pit', 'roll'];
  function sound(kind, strength, hits) {
    playHit(kind, strength);
    hits?.push([KINDS.indexOf(kind), round(strength, 2)]);
  }

  // Lagen → Meshes. p = { ball: [7], pins: [10 × [7] | null] }
  function show(p) {
    balls[active].visible = true;
    balls[active].position.fromArray(p.ball, 0);
    balls[active].quaternion.fromArray(p.ball, 3);
    p.pins.forEach((q, n) => {
      if (!q) return;
      pins[n].visible = true;
      pins[n].quaternion.fromArray(q, 3);
      pins[n].position.copy(footOf(q, pins[n].quaternion));
    });
    lastPoses = p.pins;
    placeBlob();
  }

  const flat = (p) => [...p.ball.map((v) => round(v)), ...p.pins.flatMap((q) => (q ? q.map((v) => round(v)) : [0, -9, 0, 0, 0, 0, 1]))];
  const unflat = (a) => ({ ball: a.slice(0, 7), pins: Array.from({ length: 10 }, (_, n) => (a[7 + n * 7 + 1] < -5 ? null : a.slice(7 + n * 7, 14 + n * 7))) });

  // --- Wurf des Mitspielers anzeigen ---
  function applyRemote(msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 77 || !msg.p.every(Number.isFinite)) return;
    hand = null;
    drawHand();
    const p = unflat(msg.p);
    if (!remote) remote = { target: p };
    remote.target = p;
    for (const [k, strength] of Array.isArray(msg.s) ? msg.s.slice(0, 40) : []) if (KINDS[k] && Number.isFinite(strength)) playHit(KINDS[k], Math.min(strength, 1));
    if (!msg.final) return;
    show(p);
    remote = null;
  }

  // --- Pinsetter: liegende Pins abräumen, stehende anheben und wieder hinstellen bzw. neu aufstellen ---
  function startSetter(target) {
    const lying = [];
    const keep = [];
    pins.forEach((m, n) => {
      if (!m.visible) return;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion).y > 0.97 && m.position.y < 0.02 && m.position.y > -0.02;
      if (up && target[n]) keep.push(n);
      else lying.push({ n });
    });
    // Neu aufstellen (alle 10): auch Stehengebliebene werden abgeräumt, die Maschine bringt einen frischen Satz
    const full = target.every(Boolean);
    if (full) lying.push(...keep.map((n) => ({ n })));
    setter = { t: 0, lying, keep: full ? [] : keep, full, target, lifted: new Map(keep.map((n) => [n, pins[n].position.clone()])) };
    playHit('wood', 0.25);
  }

  function stepSetter(dt) {
    const s = setter;
    s.t += dt;
    const t = s.t;
    // Tisch: runter (0–0,5), hoch mit den Stehenden (0,5–0,9), runter zum Absetzen (2,0–2,6), wieder hoch (2,6–3,1)
    const deckY = t < 0.5 ? DECK_UP - (DECK_UP - DECK_PICK) * span(t, 0, 0.5)
      : t < 2 ? DECK_PICK + (0.75 - DECK_PICK) * span(t, 0.5, 0.9)
        : t < 2.6 ? 0.75 - (0.75 - DECK_PICK) * span(t, 2, 2.6) : DECK_PICK + (DECK_UP - DECK_PICK) * span(t, 2.6, SETTER_S);
    setterParts.deck.position.y = deckY - DECK_PICK;
    const lift = deckY - DECK_PICK;
    // Rechen: runter (0,6–1,0), nach hinten durchs Deck (1,0–1,8), zurück und hoch (1,8–2,3)
    const sweepY = 1.05 - 1.0 * span(t, 0.6, 1.0) + 1.0 * span(t, 1.9, 2.3);
    const sweepZ = DECK_FRONT + 0.02 - (DECK_FRONT - DECK_END + 0.05) * span(t, 1.0, 1.8) + (DECK_FRONT - DECK_END + 0.05) * span(t, 1.8, 2.2);
    setterParts.sweep.position.set(0, sweepY, sweepZ);
    for (const n of s.keep) {
      if (t < 2.6) pins[n].position.set(s.lifted.get(n).x, Math.max(0, t > 0.5 ? lift : 0), s.lifted.get(n).z);
      pins[n].quaternion.identity();
    }
    for (const l of s.lying) {
      const m = pins[l.n];
      if (!m.visible) continue;
      if (t < 1.0) continue;
      // Der Rechen schiebt alles vor sich her; hinter dem Deck fällt es in die Grube
      const front = sweepZ - 0.07;
      if (m.position.z > front && t < 1.85) m.position.z = front;
      if (m.position.z < DECK_END) {
        m.position.y -= dt * 2.5;
        if (m.position.y < PIT_Y + 0.05) m.visible = false;
      }
      if (t > 1.85 && m.position.z > DECK_END) m.visible = false; // Rest (z. B. in der Rinne) räumt die Maschine weg
    }
    // Neu aufstellen: alle 10 hängen im Tisch und kommen mit ihm herunter
    if (s.full && t >= 2) {
      pins.forEach((m, n) => {
        m.visible = true;
        m.quaternion.identity();
        m.position.set(SPOTS[n][0], Math.max(0, lift), SPOTS[n][1]);
      });
    }
    if (t >= SETTER_S) {
      setter = null;
      placePins(s.target);
    }
  }

  // Pins genau so, wie der Spielstand sie hat (aufrecht an ihrer Stelle)
  function placePins(target) {
    pins.forEach((m, n) => {
      const p = target[n];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p[0], 0, p[1]);
      m.quaternion.identity();
    });
    lastPoses = null;
  }

  // --- Anordnung passend zum Spielstand ---
  function sync(s) {
    const first = state === null;
    state = s;
    if (!s || shot || remote) return;
    if (s.seq !== shownSeq) {
      const changed = !first && shownSeq !== null && (s.events?.some((e) => e.type === 'throw' || e.type === 'caught') || differs(s.pins));
      shownSeq = s.seq;
      if (changed) startSetter(s.pins);
      else if (!setter) placePins(s.pins);
    }
    active = s.turn;
    balls.forEach((_, p) => p !== active && parkBall(p));
    if (!setter && !hand) parkBall(active);
    drawHand();
  }

  const differs = (target) => pins.some((m, n) => m.visible !== !!target[n] || (target[n] && Math.hypot(m.position.x - target[n][0], m.position.z - target[n][1]) > 0.003));

  // Kugel auf dem Rücklauf (zwischen Bahn 5 und 6)
  function parkBall(p) {
    const b = balls[p];
    b.visible = true;
    b.position.set(PITCH / 2 + (p ? 0.11 : -0.11), 0.86 + BALL.r, 3.6);
    b.quaternion.identity();
    if (p === active) placeBlob();
  }

  function placeBlob() {
    const b = balls[active];
    blob.visible = b.visible && b.position.y < 0.6 && b.position.z > DECK_END;
    blob.position.set(b.position.x, Math.abs(b.position.x) > HALF + 0.02 ? -0.045 : 0.002, b.position.z);
    blob.scale.setScalar(1 + Math.max(0, b.position.y - BALL.r) * 1.5);
  }

  // Kugel in der Hand: th = Arm-Winkel (REST vorn … + = ausgeholt, 0 = unten/Abwurf), pz = Schulter längs
  function drawHand() {
    const show = !!(hand && state && !shot && !remote && !setter);
    aimLine.group.visible = show && hand.aim !== false;
    if (!show) return;
    const b = balls[hand.player ?? active];
    b.visible = true;
    const pz = hand.pz ?? RELEASE_Z + HAND_BACK;
    const th = hand.th ?? REST;
    b.position.set(hand.x, BALL.r + ARM - ARM * Math.cos(th), pz + ARM * Math.sin(th));
    b.quaternion.identity();
    if ((hand.player ?? active) === active) placeBlob();
    aimLine.set(hand.x, hand.angle);
  }

  function update(dt) {
    if (shot) stepPhysics(dt);
    if (remote) {
      const k = 1 - Math.exp(-dt * 30);
      const { ball, pins: ps } = remote.target;
      balls[active].visible = true;
      balls[active].position.lerp(new THREE.Vector3().fromArray(ball, 0), k);
      balls[active].quaternion.slerp(new THREE.Quaternion().fromArray(ball, 3), k);
      ps.forEach((q, n) => {
        if (!q) return;
        const quat = new THREE.Quaternion().fromArray(q, 3);
        pins[n].visible = true;
        pins[n].quaternion.slerp(quat, k);
        pins[n].position.lerp(footOf(q, quat), k);
      });
      placeBlob();
    }
    if (setter) {
      stepSetter(dt);
      if (!setter) {
        parkBall(active);
        drawHand();
      }
    }
    // Kugel in der Grube verschwinden lassen (sie kommt über den Rücklauf zurück)
    const b = balls[active];
    if (!shot && !remote && b.position.z < DECK_END - 0.2 && b.position.y < 0.05) b.visible = false;
    monitor.update(dt);
    look.update(dt);
  }

  function reset() {
    if (shot) {
      physics.finish(shot.sim);
      shot = null;
    }
    remote = null;
    hand = null;
    setter = null;
    state = null;
    shownSeq = null;
    active = 0;
    placePins(SPOTS);
    setterParts.deck.position.y = DECK_UP - DECK_PICK;
    setterParts.sweep.position.set(0, 1.05, DECK_FRONT + 0.02);
    parkBall(0);
    parkBall(1);
    aimLine.group.visible = false;
    monitor.draw(null);
    look.party(false);
  }

  reset();

  const toWorld = (x, y, z) => lane.localToWorld(new THREE.Vector3(x, y, z));

  return {
    group,
    noTisch: true, // das Bowlingcenter wird nicht umgeworfen (tisch.js)
    ready,
    sync,
    update,
    reset,
    applyRemote,
    throwBall,
    busy: () => !!(shot || remote || setter),
    // Nach einem abgelehnten Wurf: beim nächsten sync die Pins wieder nach dem Stand aufstellen (Pinsetter)
    resync() {
      shownSeq = -1;
    },
    rolling: () => !!(shot || remote),
    // Kugel in der Hand zeigen (auch beim Mitspieler): { player, x, angle, th, pz, aim } oder null
    setHand(next) {
      hand = next;
      if (!next && state && !shot && !remote && !setter) parkBall(active);
      drawHand();
    },
    // Wo ist die Kugel (Welt)? Für die Kamera
    ballWorld: () => balls[active].getWorldPosition(new THREE.Vector3()),
    toWorld: ([x, z], y = 0) => toWorld(x, y, z),
    // Punkt auf Bahn oder Anlauf unter der Maus: [x, z] in Physik-Koordinaten oder null
    pickFloor(raycaster) {
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -group.position.y), new THREE.Vector3());
      if (!hit) return null;
      const p = lane.worldToLocal(hit);
      return [p.x, p.z];
    },
    // Anzeigetafel: rows = [{ name, frames: [[Zeichen], …], totals: [Zahl|null], total, turn }], text = große Meldung
    setScore(info) {
      monitor.draw(info);
    },
    flash(text) {
      monitor.flash(text);
    },
    celebrate() {
      look.party(true);
      monitor.flash('GEWONNEN!', true);
    },
    setDesign(s) {
      spot.castShadow = s.shadows !== 'off';
      const size = Math.min(s.shadowSize ?? 1024, 2048);
      if (spot.shadow.mapSize.x !== size) {
        spot.shadow.mapSize.set(size, size);
        spot.shadow.map?.dispose();
        spot.shadow.map = null;
      }
      spot.shadow.radius = s.shadows === 'soft' ? 3 : 1;
    },
  };
}

// Mesh-Ursprung = Fuß, Physik = Schwerpunkt (14,5 cm darüber, wie physics.js): entlang der gekippten Achse zurück
const footOf = (q, quat) => new THREE.Vector3(q[0], q[1], q[2]).sub(new THREE.Vector3(0, 0.145, 0).applyQuaternion(quat));

// --- Bauteile ---

// Drehform des Pins aus dem Profil, gleichmäßig nach Höhe abgetastet (dann passt die Textur: v = Höhe)
function pinGeometry() {
  const radiusAt = (y) => {
    for (let i = 1; i < PIN_PROFILE.length; i++) {
      const [r1, y1] = PIN_PROFILE[i];
      const [r0, y0] = PIN_PROFILE[i - 1];
      if (y <= y1 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
    return 0;
  };
  const pts = [new THREE.Vector2(0, 0)];
  for (let k = 0; k <= 48; k++) {
    const y = (k / 48) * PIN.h;
    pts.push(new THREE.Vector2(Math.max(radiusAt(y), k === 48 ? 0 : 0.002), y));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  // v = Höhe / Pinhöhe (LatheGeometry zählt nach Punkten – die erste Spitze unten verschiebt das um einen Punkt)
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / PIN.h);
  return g;
}

// Pin: weiß lackiert, zwei rote Streifen am Hals
function pinTexture() {
  return canvasTexture(32, 512, (g, w, h) => {
    g.fillStyle = '#f7f4ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c8161d';
    const band = (y0, y1) => g.fillRect(0, h * (1 - y1 / PIN.h), w, h * ((y1 - y0) / PIN.h));
    band(0.252, 0.266);
    band(0.276, 0.29);
    g.fillStyle = 'rgba(0, 0, 0, 0.12)'; // Fuß etwas dunkler (abgerieben)
    g.fillRect(0, h * 0.985, w, h * 0.015);
  });
}

// Kugel: marmorierte Schlieren in zwei Farben, drei Grifflöcher
function ballTexture(a, b) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      g.strokeStyle = i % 3 ? `${b}55` : 'rgba(10, 10, 30, 0.35)';
      g.lineWidth = 3 + Math.random() * 10;
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (Math.random() - 0.5) * 120;
        y += (Math.random() - 0.5) * 60;
        g.quadraticCurveTo(x + 30, y - 20, x, y);
      }
      g.stroke();
    }
    g.fillStyle = '#08080c';
    for (const [x, y, r] of [[0.25, 0.3, 9], [0.22, 0.42, 8], [0.29, 0.42, 8]]) {
      g.beginPath();
      g.ellipse(x * w, y * h, r * 1.3, r, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function blobTexture() {
  return canvasTexture(64, 64, (g, w) => {
    const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(0.45, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
  });
}

// Bahn: 39 Bretter, vorn und am Deck Ahorn (hell), dazwischen Kiefer; Zielpfeile (ab 12–16 ft) und Punkte (7 ft)
function laneTexture() {
  const len = -DECK_END; // Foul-Linie bis Ende Pin-Deck
  const tex = canvasTexture(512, 4096, (g, w, h) => {
    const yOf = (z) => (z / len) * h; // z = Abstand von der Foul-Linie (m), Bild oben = Foul-Linie
    const bw = w / LANE.boards;
    for (let b = 0; b < LANE.boards; b++) {
      const tone = Math.random() * 18 - 9;
      for (const [z0, z1, base] of [[0, 4.6, [214, 172, 118]], [4.6, 17.9, [196, 144, 88]], [17.9, len, [218, 178, 124]]]) {
        g.fillStyle = `rgb(${base.map((c) => Math.round(c + tone)).join(',')})`;
        g.fillRect(b * bw, yOf(z0), bw + 0.5, yOf(z1 - z0) + 1);
      }
      g.fillStyle = 'rgba(70, 40, 15, 0.35)';
      g.fillRect(b * bw, 0, 1, h);
    }
    // Maserung längs
    for (let i = 0; i < 1400; i++) {
      g.strokeStyle = `rgba(90, 50, 20, ${0.04 + Math.random() * 0.08})`;
      g.lineWidth = 0.6 + Math.random();
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 3, y + 40 + Math.random() * 160);
      g.stroke();
    }
    // Stöße zwischen Kopfstück, Mittelteil und Deck
    g.fillStyle = 'rgba(60, 35, 12, 0.5)';
    for (const z of [4.6, 17.9]) g.fillRect(0, yOf(z), w, 2);
    const xOf = (board) => w - (board - 0.5) * bw; // Brett 1 = rechts (wie beim Rechtshänder gezählt)
    // Pfeile: Bretter 5, 10, 15, 20, 25, 30, 35 – in V-Form, außen 13,5 ft, Mitte 16 ft
    g.fillStyle = '#3a1d0c';
    for (const board of [5, 10, 15, 20, 25, 30, 35]) {
      const k = Math.abs(board - 20) / 15;
      const z = (16 - 2.5 * k) * 0.3048;
      const x = xOf(board);
      g.beginPath();
      g.moveTo(x, yOf(z));
      g.lineTo(x - bw * 0.55, yOf(z + 0.3));
      g.lineTo(x + bw * 0.55, yOf(z + 0.3));
      g.fill();
    }
    // Führungspunkte bei 7 ft
    for (const board of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
      g.beginPath();
      g.arc(xOf(board), yOf(7 * 0.3048), bw * 0.32, 0, Math.PI * 2);
      g.fill();
    }
  });
  tex.repeat.set(1, -1); // Bild oben = Foul-Linie, die Fläche zeigt mit ihrem oberen Rand zu den Pins
  tex.offset.set(0, 1);
  return tex;
}

// Anlauf je Bahn: helle Dielen, Punkte bei 12 und 15 ft hinter der Foul-Linie und knapp dahinter
function approachTexture() {
  return canvasTexture(512, 1024, (g, w, h) => {
    const len = 5.6; // m Anlauf in der Textur (Foul-Linie oben)
    const bw = w / 39 * (LANE.width / PITCH);
    g.fillStyle = '#d7b07a';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += bw) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,235,200' : '80,45,15'}, ${0.05 + Math.random() * 0.06})`;
      g.fillRect(x, 0, bw, h);
      g.fillStyle = 'rgba(80, 45, 15, 0.3)';
      g.fillRect(x, 0, 1, h);
    }
    g.fillStyle = '#3a1d0c';
    const cx = w / 2;
    for (const d of [0.1, 3.66, 4.57]) {
      for (const board of [-15, -10, -5, 0, 5, 10, 15]) {
        g.beginPath();
        g.arc(cx + board * bw, (d / len) * h, bw * 0.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { repeat: [LANES, 1] });
}

// Teppich der Sitzecke (dunkel mit bunten Kreisen und Sternen, typisch Bowlingcenter)
function carpetTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#1b1430';
    g.fillRect(0, 0, w, h);
    const colors = ['#e0407a', '#38c6d9', '#f2b33d', '#7b5ce0'];
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = colors[i % 4];
      g.globalAlpha = 0.55;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 0, Math.PI * (0.6 + Math.random() * 1.4));
      g.stroke();
    }
    g.globalAlpha = 1;
  }, { repeat: [10, 3] });
}

// Maskenblende über den Pin-Decks: Retro-Muster mit Bahnnummern
function maskingTexture() {
  return canvasTexture(2048, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d1240');
    grad.addColorStop(1, '#3b1950');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const lw = w / LANES;
    for (let i = 0; i < LANES; i++) {
      const x = i * lw;
      g.strokeStyle = i % 2 ? '#38c6d9' : '#e0407a';
      g.lineWidth = 6;
      g.beginPath();
      for (let k = 0; k <= 40; k++) g.lineTo(x + (k / 40) * lw, h * 0.72 + Math.sin(k / 3 + i) * 14);
      g.stroke();
      g.fillStyle = '#f2b33d';
      for (let s = 0; s < 5; s++) star(g, x + 30 + Math.random() * (lw - 60), 25 + Math.random() * 90, 6 + Math.random() * 6);
      g.fillStyle = '#fff4dc';
      g.font = 'bold 86px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(String(i + 1), x + lw / 2, h * 0.52);
    }
  });
}

function star(g, x, y, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

// Halle: Böden, Bahnen, Rinnen, Trennleisten, Pin-Decks, Grube, Blende, Wände, Decke, Sitzecke, Licht.
// Liefert das Licht über unserem Pin-Deck (Schatten) und update/party für den Sieg-Effekt.
function buildHall(group) {
  const add = (geo, mat, x, y, z, { shadow = false, receive = true, parent = group } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  };
  const W = LANES * PITCH + 2.6;
  const midX = laneX((LANES - 1) / 2);
  const laneLen = -DECK_END;

  // Bahnen
  const laneMat = new THREE.MeshPhysicalMaterial({ map: laneTexture(), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04 });
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
  const capMat = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#5a3519', boards: 1 }), roughness: 0.4 });
  const kickMat = new THREE.MeshStandardMaterial({ map: kickTexture(), roughness: 0.6 });
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x050407, roughness: 1 });
  const gutterGeo = new THREE.CylinderGeometry(LANE.gutter / 2, LANE.gutter / 2, laneLen, 20, 1, true, Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
  for (let i = 0; i < LANES; i++) {
    const x = laneX(i);
    const l = add(new THREE.PlaneGeometry(LANE.width, laneLen).rotateX(-Math.PI / 2), laneMat, x, 0, FOUL_Z - laneLen / 2);
    l.receiveShadow = true;
    for (const s of [-1, 1]) {
      const gut = add(gutterGeo, gutterMat, x + s * (HALF + LANE.gutter / 2), 0, FOUL_Z - laneLen / 2);
      gut.scale.y = 0.048 / (LANE.gutter / 2);
      // Kickback (Seitenwand am Pin-Deck)
      add(new THREE.BoxGeometry(0.04, 0.78, DECK_FRONT - PIT_END + 0.3), kickMat, x + s * (KICK + 0.02), 0.36, FOUL_Z + (DECK_FRONT + PIT_END) / 2 - 0.15);
    }
    // Grube und Vorhang
    add(new THREE.BoxGeometry(2 * KICK, 0.02, DECK_END - PIT_END), pitMat, x, PIT_Y, FOUL_Z + (DECK_END + PIT_END) / 2);
    add(new THREE.PlaneGeometry(2 * KICK, 1.2), pitMat, x, 0.2, FOUL_Z + PIT_END);
  }
  // Trennleisten zwischen den Rinnen nebeneinanderliegender Bahnen (Kugelrücklauf zwischen jedem Paar)
  const capW = PITCH - LANE.width - 2 * LANE.gutter;
  for (let i = 0; i <= LANES; i++) {
    const x = laneX(i) - PITCH / 2;
    add(new THREE.BoxGeometry(capW, 0.05, laneLen + 0.3), capMat, x, 0.0, FOUL_Z - laneLen / 2 + 0.15, { shadow: false });
  }
  // Foul-Linie: dunkler Streifen über alle Bahnen, Sensor-Säulchen an den Seiten
  const foulMat = new THREE.MeshStandardMaterial({ color: 0x15080a, roughness: 0.5 });
  add(new THREE.BoxGeometry(W - 2.6, 0.003, 0.0095), foulMat, midX, 0.0015, FOUL_Z);
  for (let i = 0; i <= LANES; i++) add(new THREE.BoxGeometry(0.05, 0.12, 0.05), foulMat, laneX(i) - PITCH / 2, 0.06, FOUL_Z);

  // Anlauf und Teppich
  const appMat = new THREE.MeshStandardMaterial({ map: approachTexture(), roughness: 0.45 });
  const app = add(new THREE.PlaneGeometry(LANES * PITCH, 5.6).rotateX(-Math.PI / 2), appMat, midX, 0, FOUL_Z + 2.8);
  app.receiveShadow = true;
  const carpet = new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 });
  add(new THREE.PlaneGeometry(W, REAR_Z - FOUL_Z - 5.6).rotateX(-Math.PI / 2), carpet, midX, 0, (REAR_Z + FOUL_Z + 5.6) / 2);
  add(new THREE.PlaneGeometry(1.3, FOUL_Z + 5.6 - BACK_Z).rotateX(-Math.PI / 2), carpet, laneX(0) - PITCH / 2 - 0.65, 0, (FOUL_Z + 5.6 + BACK_Z) / 2);
  add(new THREE.PlaneGeometry(1.3, FOUL_Z + 5.6 - BACK_Z).rotateX(-Math.PI / 2), carpet, laneX(LANES - 1) + PITCH / 2 + 0.65, 0, (FOUL_Z + 5.6 + BACK_Z) / 2);

  // Kugelrückläufe zwischen den Paaren: Haube und Schiene mit ein paar Hauskugeln
  const hoodMat = new THREE.MeshPhysicalMaterial({ color: 0x23253a, roughness: 0.3, clearcoat: 0.8 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa4, roughness: 0.3, metalness: 0.9 });
  const houseColors = [0x2e8b57, 0xd98c1f, 0x6b3fa0, 0x1f6fb3, 0xc23b4a];
  for (let i = 0; i < LANES; i += 2) {
    const x = laneX(i) + PITCH / 2;
    add(new THREE.BoxGeometry(0.5, 0.75, 1.5), hoodMat, x, 0.375, FOUL_Z + 3.6, { shadow: true });
    add(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), hoodMat, x, 0.75, FOUL_Z + 2.85, { shadow: true });
    for (const dx of [-0.11, 0.11]) add(new THREE.BoxGeometry(0.03, 0.03, 1.2), railMat, x + dx, 0.82, FOUL_Z + 3.85);
    if (i !== OURS) {
      for (const [k, dz] of [[i, 3.3], [i + 1, 3.95]]) {
        add(new THREE.SphereGeometry(BALL.r, 24, 16), new THREE.MeshPhysicalMaterial({ color: houseColors[k % 5], roughness: 0.2, clearcoat: 1 }), x, 0.86 + BALL.r, FOUL_Z + dz, { shadow: true });
      }
    }
  }

  // Pin-Decks der Nachbarbahnen: Pins als Kulisse (ein paar fehlen hier und da)
  const pinGeo = pinGeometry();
  const others = [];
  for (let i = 0; i < LANES; i++) {
    if (i === OURS) continue;
    const missing = new Set([[], [7, 9], [], [3], [], [1, 2, 4], [6]][i % 7]);
    SPOTS.forEach(([x, z], n) => !missing.has(n) && others.push([laneX(i) + x, FOUL_Z + z]));
  }
  const crowd = new THREE.InstancedMesh(pinGeo, new THREE.MeshPhysicalMaterial({ map: pinTexture(), roughness: 0.3, clearcoat: 1 }), others.length);
  const dummy = new THREE.Object3D();
  others.forEach(([x, z], k) => {
    dummy.position.set(x, 0, z);
    dummy.updateMatrix();
    crowd.setMatrixAt(k, dummy.matrix);
  });
  crowd.castShadow = true;
  group.add(crowd);

  // Maskenblende über allen Decks, darüber dunkle Wand; leuchtende Lichtleiste unter der Blende
  const maskZ = FOUL_Z + DECK_FRONT + 0.55;
  const maskMesh = add(new THREE.PlaneGeometry(LANES * PITCH, 1.5), new THREE.MeshBasicMaterial({ map: maskingTexture() }), midX, 1.7, maskZ);
  maskMesh.material.color.setScalar(0.85);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.78).multiplyScalar(2.4) });
  add(new THREE.BoxGeometry(LANES * PITCH, 0.04, 0.06), glowMat, midX, 0.93, maskZ + 0.02);
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 1 });
  add(new THREE.PlaneGeometry(W, ROOF), dark, midX, ROOF / 2, BACK_Z);
  add(new THREE.PlaneGeometry(LANES * PITCH, ROOF - 2.45), dark, midX, 2.45 + (ROOF - 2.45) / 2, maskZ - 0.01);
  add(new THREE.BoxGeometry(LANES * PITCH, 0.02, maskZ - BACK_Z), dark, midX, 2.45, (maskZ + BACK_Z) / 2); // Decke über den Pinsettern

  // Wände und Decke
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  for (const s of [-1, 1]) {
    const x = midX + s * (W / 2);
    const wall = add(new THREE.PlaneGeometry(REAR_Z - BACK_Z, ROOF), wallMat, x, ROOF / 2, (REAR_Z + BACK_Z) / 2);
    wall.rotation.y = -s * Math.PI / 2;
  }
  const rear = add(new THREE.PlaneGeometry(W, ROOF), wallMat, midX, ROOF / 2, REAR_Z);
  rear.rotation.y = Math.PI;
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x15111c, roughness: 1 });
  const ceil = add(new THREE.PlaneGeometry(W, REAR_Z - BACK_Z), ceilMat, midX, ROOF, (REAR_Z + BACK_Z) / 2);
  ceil.rotation.x = Math.PI / 2;
  // Neonleisten: an beiden Seitenwänden und quer über dem Anlauf (pink, türkis, warmgelb)
  const neon = [
    [new THREE.Color(1, 0.25, 0.55), [0.06, 0.06, REAR_Z - BACK_Z - 1], [midX - W / 2 + 0.05, 2.9, (REAR_Z + BACK_Z) / 2]],
    [new THREE.Color(0.2, 0.85, 1), [0.06, 0.06, REAR_Z - BACK_Z - 1], [midX + W / 2 - 0.05, 2.9, (REAR_Z + BACK_Z) / 2]],
    [new THREE.Color(1, 0.7, 0.3), [W - 0.2, 0.06, 0.06], [midX, ROOF - 0.08, FOUL_Z + 0.4]],
    [new THREE.Color(1, 0.25, 0.55), [W - 0.2, 0.06, 0.06], [midX, ROOF - 0.08, FOUL_Z + 5.4]],
  ];
  const neonMats = neon.map(([color, size, pos]) => {
    const m = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(3) });
    add(new THREE.BoxGeometry(...size), m, ...pos);
    return { m, base: color };
  });
  // Deckenlampen über dem Anlauf (leuchtende Scheiben)
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6).multiplyScalar(2.6) });
  for (let i = 0; i < LANES; i += 2) {
    for (const dz of [1.5, 4.5]) {
      const lamp = add(new THREE.CircleGeometry(0.16, 24), lampMat, laneX(i) + PITCH / 2, ROOF - 0.01, FOUL_Z + dz);
      lamp.rotation.x = Math.PI / 2;
    }
  }

  // Sitzecke hinter dem Anlauf: Bänke (rot gepolstert), Tischchen
  const seatMat = new THREE.MeshPhysicalMaterial({ color: 0x8e1d2c, roughness: 0.45, clearcoat: 0.6 });
  const tableMat = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#3b2414', boards: 2 }), roughness: 0.4 });
  for (let i = 0; i < LANES; i += 2) {
    const x = laneX(i) + PITCH / 2;
    for (const [dz, flip] of [[7.4, 1], [9.6, -1]]) {
      add(new THREE.BoxGeometry(2.4, 0.42, 0.55), seatMat, x, 0.21, FOUL_Z + dz, { shadow: true });
      add(new THREE.BoxGeometry(2.4, 0.5, 0.14), seatMat, x, 0.62, FOUL_Z + dz + flip * 0.24, { shadow: true });
    }
    add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), tableMat, x, 0.7, FOUL_Z + 8.5, { shadow: true });
    add(new THREE.CylinderGeometry(0.04, 0.06, 0.7, 12), railMat, x, 0.35, FOUL_Z + 8.5);
  }

  // Licht: gedämpfte Grundhelle, warme Lampen über Anlauf und Sitzecke, helle Spots auf die Pin-Decks
  const hemi = new THREE.HemisphereLight(0x8c7aa8, 0x2a1c12, 0.55);
  group.add(hemi);
  for (const [x, z, k] of [[0.9, FOUL_Z + 3, 10], [laneX(6), FOUL_Z + 3, 7], [laneX(1), FOUL_Z + 3, 7], [0.9, FOUL_Z + 8.5, 6]]) {
    const p = new THREE.PointLight(0xffc488, k, 14, 1.6);
    p.position.set(x, ROOF - 0.3, z);
    group.add(p);
  }
  const laneLight = new THREE.PointLight(0xffe2c0, 6, 18, 1.4);
  laneLight.position.set(0.9, ROOF - 0.15, FOUL_Z - 9);
  group.add(laneLight);
  const spot = new THREE.SpotLight(0xfff2dc, 40, 9, 0.62, 0.45, 1.2);
  spot.position.set(0, 2.35, FOUL_Z + DECK_FRONT + 0.6);
  spot.target.position.set(0, 0, FOUL_Z - LANE.length - 0.45);
  spot.shadow.camera.near = 0.5;
  spot.shadow.camera.far = 5;
  spot.shadow.bias = -0.0004;
  spot.castShadow = true;
  group.add(spot, spot.target);
  const decks = new THREE.SpotLight(0xfff2dc, 30, 14, 1.2, 0.6, 1.2);
  decks.position.set(midX, 2.4, FOUL_Z + DECK_FRONT + 0.8);
  decks.target.position.set(midX, 0, FOUL_Z - LANE.length - 0.4);
  group.add(decks, decks.target);

  // Sieg: Neon wechselt ein paar Sekunden die Farben
  let party = 0;
  return {
    spot,
    party(on) {
      party = on ? 6 : 0;
      if (!on) neonMats.forEach(({ m, base }) => m.color.copy(base).multiplyScalar(3));
    },
    update(dt) {
      if (party <= 0) return;
      party -= dt;
      const t = performance.now() / 1000;
      neonMats.forEach(({ m, base }, k) => {
        if (party <= 0) return m.color.copy(base).multiplyScalar(3);
        m.color.setHSL((t * 0.5 + k * 0.25) % 1, 1, 0.55).multiplyScalar(3.5);
      });
    },
  };
}

// Kickbacks: dunkles Holz mit hellen Zierstreifen
function kickTexture() {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#20162c';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e0407a';
    g.fillRect(0, h * 0.62, w, 3);
    g.fillStyle = '#38c6d9';
    g.fillRect(0, h * 0.7, w, 3);
  });
}

// Wände: dunkles Violett mit feinen Streifen
function wallTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#271b33';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = 'rgba(255, 255, 255, 0.03)';
      g.fillRect(x, 0, 8, h);
    }
    g.fillStyle = '#150e1d';
    g.fillRect(0, h * 0.7, w, h * 0.3);
  }, { repeat: [12, 1] });
}

// Pinsetter: Tisch (setzt Pins ab und hebt stehende an) und Rechen (räumt liegende in die Grube)
function buildSetter(lane) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c44, roughness: 0.5, metalness: 0.7 });
  const deck = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2 * HALF + 0.1, 0.06, DECK_FRONT - DECK_END + 0.1), metal);
  plate.position.set(0, PIN.h + 0.03, (DECK_FRONT + DECK_END) / 2);
  plate.castShadow = true;
  deck.add(plate);
  lane.add(deck);
  const sweep = new THREE.Mesh(new THREE.BoxGeometry(2 * KICK - 0.02, 0.16, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a8d96, roughness: 0.4, metalness: 0.8 }));
  sweep.castShadow = true;
  lane.add(sweep);
  // deck.position.y = 0: Unterkante des Tischs knapp über stehenden Pins
  return { deck, sweep };
}

// Zielhilfe: Linie vom Abwurfpunkt bis zu den Pfeilen (wie beim echten Zielen auf die Pfeile), Ring an ihrem Ende
function buildAim() {
  const group = new THREE.Group();
  const len = 5.2;
  const mat = new THREE.MeshBasicMaterial({ map: canvasTexture(16, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(255, 220, 150, 0)');
    grad.addColorStop(1, 'rgba(255, 220, 150, 0.85)');
    g.fillStyle = grad;
    for (let y = 0; y < h; y += 24) g.fillRect(0, y, w, 14);
  }), transparent: true, depthWrite: false });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.045, len).rotateX(-Math.PI / 2).translate(0, 0.003, -len / 2), mat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.position.set(0, 0.004, -len);
  const pivot = new THREE.Group();
  pivot.add(strip, ring);
  group.add(pivot);
  group.visible = false;
  return {
    group,
    set(x, angle) {
      pivot.position.set(x, 0, RELEASE_Z);
      pivot.rotation.y = -angle;
    },
  };
}

// Anzeigetafel über der Bahn: beide Spieler mit Frames, Zwischensummen und Gesamt; große Meldungen (Strike, Spare …)
function buildMonitor(group) {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 400;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 0.8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.set(0, 2.4, FOUL_Z - 5.2);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.94, 0.08), new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4, metalness: 0.5 }));
  frame.position.set(0, 2.4, FOUL_Z - 5.25);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, ROOF - 2.89, 8), new THREE.MeshStandardMaterial({ color: 0x444448, metalness: 0.8, roughness: 0.4 }));
  rod.position.set(0, (ROOF + 2.89) / 2, FOUL_Z - 5.25);
  group.add(screen, frame, rod);
  // Nachbarbahnen: Tafeln mit „frei“
  for (let i = 0; i < LANES; i += 1) {
    if (i === OURS) continue;
    const t = canvasTexture(320, 100, (g, w, h) => {
      g.fillStyle = '#081830';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#7fb6ff';
      g.font = 'bold 36px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(`Bahn ${i + 1} · frei`, w / 2, h / 2 + 12);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    m.material.color.setScalar(0.7);
    m.position.set(laneX(i), 2.55, FOUL_Z - 5.2);
    group.add(m);
  }

  const g = c.getContext('2d');
  let info = null;
  let message = null; // { text, t, win }
  let sparks = [];

  function draw(next = info) {
    info = next;
    const { width: w, height: h } = c;
    g.fillStyle = '#06142b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#0f2a52';
    g.fillRect(0, 0, w, 48);
    g.fillStyle = '#9cc8ff';
    g.font = 'bold 30px Arial, sans-serif';
    g.textAlign = 'left';
    g.fillText(`Bahn ${OURS + 1}`, 18, 34);
    if (!info) {
      g.textAlign = 'center';
      g.fillStyle = '#f2b33d';
      g.font = 'bold 70px Arial, sans-serif';
      g.fillText('Willkommen!', w / 2, h / 2 + 40);
    } else {
      g.textAlign = 'right';
      g.fillStyle = '#9cc8ff';
      g.fillText(info.title ?? '', w - 18, 34);
      const nameW = 210;
      const fw = (w - nameW - 150) / 10.6;
      info.rows.forEach((row, r) => {
        const y0 = 64 + r * 166;
        g.fillStyle = row.turn ? '#173f7a' : '#0b1f40';
        g.fillRect(8, y0, w - 16, 150);
        g.fillStyle = row.turn ? '#ffd86b' : '#e8f1ff';
        g.font = 'bold 32px Arial, sans-serif';
        g.textAlign = 'left';
        g.fillText(fit(g, row.name, nameW - 20), 20, y0 + 88);
        for (let f = 0; f < FRAMES; f++) {
          const x = nameW + f * fw;
          const fwid = f === FRAMES - 1 ? fw * 1.6 : fw;
          g.strokeStyle = '#3d6aa8';
          g.lineWidth = 2;
          g.strokeRect(x, y0 + 8, fwid - 4, 134);
          const ms = row.frames[f] ?? [];
          const boxes = f === FRAMES - 1 ? 3 : 2;
          g.font = 'bold 34px Arial, sans-serif';
          g.textAlign = 'center';
          for (let k = 0; k < boxes; k++) {
            const bx = x + fwid - 4 - (boxes - k) * 38;
            g.strokeRect(bx, y0 + 8, 38, 48);
            const mk = ms[k];
            if (!mk) continue;
            g.fillStyle = mk === 'X' ? '#ff5a7a' : mk === '/' ? '#5ad1ff' : mk === 'F' ? '#ffb13d' : '#e8f1ff';
            g.fillText(mk, bx + 19, y0 + 45);
          }
          const tot = row.totals[f];
          if (tot !== null && tot !== undefined) {
            g.fillStyle = '#e8f1ff';
            g.font = 'bold 40px Arial, sans-serif';
            g.fillText(String(tot), x + (fwid - 4) / 2, y0 + 118);
          }
          if (row.current === f) {
            g.fillStyle = 'rgba(255, 216, 107, 0.18)';
            g.fillRect(x + 2, y0 + 10, fwid - 8, 130);
          }
        }
        g.fillStyle = '#ffd86b';
        g.font = 'bold 54px Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText(String(row.total), w - 75, y0 + 98);
      });
    }
    if (message) {
      const a = Math.min(1, message.t * 3, (message.life - message.t) * 2);
      g.fillStyle = `rgba(4, 10, 24, ${0.82 * a})`;
      g.fillRect(0, 0, w, h);
      for (const s of sparks) {
        g.fillStyle = `hsla(${s.hue}, 100%, 60%, ${Math.max(0, 1 - s.age / 1.6) * a})`;
        g.beginPath();
        g.arc(s.x, s.y, 5, 0, Math.PI * 2);
        g.fill();
      }
      const pulse = 1 + Math.sin(message.t * 9) * 0.04;
      g.save();
      g.translate(w / 2, h / 2 + 10);
      g.scale(pulse, pulse);
      g.font = 'bold 150px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = `rgba(255, 216, 107, ${a})`;
      g.strokeStyle = `rgba(224, 64, 122, ${a})`;
      g.lineWidth = 8;
      g.strokeText(message.text, 0, 0);
      g.fillText(message.text, 0, 0);
      g.restore();
      g.textBaseline = 'alphabetic';
    }
    tex.needsUpdate = true;
  }

  let acc = 0;
  return {
    draw,
    flash(text, win = false) {
      message = { text, t: 0, life: win ? 6 : 1.8, win };
      sparks = [];
      draw();
    },
    update(dt) {
      if (!message) return;
      message.t += dt;
      if (message.win && Math.random() < dt * 8) {
        const x = 150 + Math.random() * 980;
        const y = 60 + Math.random() * 200;
        const hue = Math.random() * 360;
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          sparks.push({ x, y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, age: 0, hue });
        }
      }
      for (const s of sparks) {
        s.age += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 160 * dt;
      }
      sparks = sparks.filter((s) => s.age < 1.6);
      if (message.t >= message.life) message = null;
      acc += dt;
      if (acc > 1 / 30 || !message) {
        acc = 0;
        draw();
      }
    },
  };
}

// Text auf Breite kürzen (mit …)
function fit(g, text, max) {
  let t = String(text);
  if (g.measureText(t).width <= max) return t;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

