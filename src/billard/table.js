// Billardtisch: Holzrahmen, Tuch, Banden, 6 Taschen, 16 Kugeln, Queue und Ziellinie. Die Physik (physics.js, Rapier)
// läuft nur beim stoßenden PC; er streamt die Lagen der Kugeln, beim anderen werden sie nur angezeigt.
// Maße in Metern (echte Größe). Ursprung der Gruppe = Mitte der Spielfläche, das Tuch liegt auf BED_Y.
// Der Tisch hängt am tableTop (der kleine Spieltisch wird während Billard ausgeblendet, room.setFurniture).
import * as THREE from 'three';
import { TABLE, R } from './rules.js';
import { feltOf, woodTexture, canvasTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { createPhysics, BED_Y, STEP, CORNER, SIDE, CUSHION, POCKETS } from './physics.js';

const { L, W } = TABLE;
const SEND_EVERY = 8; // 30 Updates pro Sekunde an den Mitspieler
const RAIL = 0.11; // Holzrahmen
const TRAY = { y: -0.17, z: W / 2 + CUSHION + RAIL + 0.04 }; // Ablage der versenkten Kugeln an der Längsseite
const COLORS = { 1: '#f2c018', 2: '#1c4fbf', 3: '#d42020', 4: '#5b2a86', 5: '#f2701b', 6: '#1c7a3c', 7: '#7a1b1b', 8: '#141414' };
const UP = new THREE.Vector3(0, 1, 0);
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export function createBillardBoard(parent, { onStream }) {
  const group = new THREE.Group();
  parent.add(group);
  const { cloth: felt, cushions } = buildTable(group);

  const ballGeo = new THREE.SphereGeometry(R, 32, 20);
  const balls = Array.from({ length: 16 }, (_, n) => {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshPhysicalMaterial({ map: ballTexture(n), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }));
    m.castShadow = m.receiveShadow = true;
    m.userData.n = n;
    group.add(m);
    return m;
  });
  const cue = buildCue();
  group.add(cue);
  const guide = buildGuide();
  group.add(guide.group);

  let state = null;
  let shot = null; // eigener Stoß mit Physik
  let remote = null; // Stoß des Mitspielers (gestreamte Lagen)
  let aim = null; // { angle, power } – Queue und Ziellinie zeigen
  let placing = null; // [x, z] – Weiße beim „Ball in Hand“ unter der Maus

  // --- Physik (physics.js, wird erst beim ersten Stoß geladen) ---
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

  // Eigener Stoß: angle = Richtung (Bogenmaß um die Hochachse, 0 = +x), power 0–1.
  // Liefert das Ergebnis für die Regeln: { first, rail, pocketed, positions }.
  async function strike(angle, power) {
    await ready();
    if (shot) return null;
    aim = null;
    const rotations = Object.fromEntries(balls.map((b, n) => [n, b.quaternion]));
    const sim = physics.start(state.positions, angle, power, rotations);
    playHit('cue', 0.3 + power * 0.7);
    return new Promise((resolve) => {
      shot = { sim, resolve, acc: 0, hits: [] };
    });
  }

  function stepPhysics(dt) {
    shot.acc = Math.min(shot.acc + dt, 16 * STEP);
    while (shot && shot.acc >= STEP) {
      shot.acc -= STEP;
      const { sounds, sunk } = physics.step(shot.sim);
      for (const [kind, strength] of sounds) {
        playHit(kind, strength);
        shot.hits.push([kind === 'ball' ? 0 : 1, round(strength, 2)]);
      }
      for (const [n, [px, pz]] of sunk) { // in die Tasche fallen lassen
        playHit('cushion', 0.8);
        shot.hits.push([1, 0.8]);
        balls[n].position.set(px, BED_Y - 0.05 - (shot.sim.pocketed.length % 3) * 0.01, pz);
      }
      for (const [n, b] of shot.sim.bodies) {
        balls[n].position.copy(b.translation());
        balls[n].quaternion.copy(b.rotation());
      }
      if (shot.sim.steps % SEND_EVERY === 0) {
        onStream({ t: 'bil', p: poses(), s: shot.hits });
        shot.hits = [];
      }
      if (physics.done(shot.sim)) {
        const report = physics.finish(shot.sim);
        onStream({ t: 'bil', p: poses(), s: shot.hits, final: true });
        const { resolve } = shot;
        shot = null;
        resolve(report);
      }
    }
  }

  // Lage aller Kugeln (versenkte stehen tief im Korb)
  function poses() {
    return balls.flatMap((b) => [
      round(b.position.x, 4), round(b.position.y, 4), round(b.position.z, 4),
      round(b.quaternion.x, 4), round(b.quaternion.y, 4), round(b.quaternion.z, 4), round(b.quaternion.w, 4),
    ]);
  }

  // --- Stoß des Mitspielers anzeigen ---
  function applyRemote(msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 16 * 7 || !msg.p.every(Number.isFinite)) return;
    aim = null;
    remote ??= balls.map(() => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() }));
    remote.forEach((r, n) => {
      r.pos.fromArray(msg.p, n * 7);
      r.quat.fromArray(msg.p, n * 7 + 3);
    });
    for (const [kind, strength] of msg.s ?? []) playHit(kind === 0 ? 'ball' : 'cushion', strength);
    if (!msg.final) return;
    remote.forEach((r, n) => {
      balls[n].position.copy(r.pos);
      balls[n].quaternion.copy(r.quat);
    });
    remote = null;
  }

  // --- Anordnung passend zum Spielstand ---
  function sync(s) {
    state = s;
    if (!s || shot || remote) return;
    balls.forEach((b, n) => {
      const p = s.positions[n];
      b.visible = !!p || s.pocketed.includes(n);
      if (p) b.position.set(p[0], BED_Y + R, p[1]);
    });
    stackPocketed(s);
    drawAim();
  }

  // Versenkte Kugeln in der Rinne an der Kopfseite aufreihen (so sieht man, was schon weg ist)
  function stackPocketed(s) {
    s.pocketed.forEach((n, k) => balls[n].position.set(-L / 2 + 0.15 + k * 2.05 * R, TRAY.y + 0.006 + R, TRAY.z));
  }

  // Queue hinter der Weißen, Ziellinie bis zur ersten Kugel und „Geisterkugel“ an der Trefferstelle
  function drawAim() {
    const p = state?.positions?.[0];
    const show = !!(aim && p && !shot && !remote && !placing);
    cue.visible = show;
    guide.group.visible = show;
    if (!show) return;
    const dir = new THREE.Vector3(Math.cos(aim.angle), 0, -Math.sin(aim.angle));
    const start = new THREE.Vector3(p[0], BED_Y + R, p[1]);
    cue.position.copy(start).addScaledVector(dir, -(R + 0.012 + aim.power * 0.22));
    cue.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().setY(0.09).normalize());
    const hit = firstHit(start, dir);
    guide.set(start, hit.point, hit.ball !== null ? hit.ghost : null, hit.ballDir);
  }

  // Wohin rollt die Weiße zuerst? (Kugel oder Bande, ohne Physik – nur als Zielhilfe)
  function firstHit(start, dir) {
    let best = { t: Infinity, ball: null };
    for (const [key, [x, z]] of Object.entries(state.positions)) {
      const n = Number(key);
      if (n === 0) continue;
      const rel = new THREE.Vector3(x - start.x, 0, z - start.z);
      const along = rel.dot(dir);
      if (along <= 0) continue;
      const off2 = rel.lengthSq() - along * along;
      const reach = (2 * R) ** 2 - off2;
      if (reach < 0) continue;
      const t = along - Math.sqrt(reach);
      if (t < best.t) best = { t, ball: n, x, z };
    }
    const limits = [(L / 2 - R - Math.sign(dir.x) * start.x) / Math.abs(dir.x || 1e-9), (W / 2 - R - Math.sign(dir.z) * start.z) / Math.abs(dir.z || 1e-9)];
    const wall = Math.min(...limits);
    if (best.ball === null || wall < best.t) return { point: start.clone().addScaledVector(dir, wall), ball: null };
    const ghost = start.clone().addScaledVector(dir, best.t);
    const ballDir = new THREE.Vector3(best.x - ghost.x, 0, best.z - ghost.z).normalize();
    return { point: ghost, ball: best.ball, ghost, ballDir };
  }

  function update(dt) {
    if (shot) stepPhysics(dt);
    if (remote) {
      const k = 1 - Math.exp(-dt * 30);
      remote.forEach((r, n) => {
        balls[n].position.lerp(r.pos, k);
        balls[n].quaternion.slerp(r.quat, k);
      });
    }
  }

  function reset() {
    if (shot) {
      physics.finish(shot.sim); // Kugeln aus der Physik nehmen
      shot = null;
    }
    remote = null;
    aim = null;
    placing = null;
    state = null;
    cue.visible = guide.group.visible = false;
    // Startbild: Dreieck aufgebaut
    const positions = initialRack();
    balls.forEach((b, n) => {
      const p = positions[n];
      b.visible = true;
      b.position.set(p[0], BED_Y + R, p[1]);
    });
  }

  reset();

  return {
    group,
    noTisch: true, // der Billardtisch wird nicht umgeworfen (tisch.js)
    ready,
    sync,
    update,
    reset,
    applyRemote,
    strike,
    busy: () => !!(shot || remote),
    anchor: (name) => (name === 'weisse' && balls[0].visible ? balls[0].getWorldPosition(new THREE.Vector3()) : null), // für den Rundgang (tutorial.js)
    // Ziel des Spielers am Zug (auch beim Mitspieler sichtbar); null = ausblenden
    setAim(next) {
      aim = next;
      drawAim();
    },
    // Weiße beim „Ball in Hand“ unter der Maus zeigen (null = wieder an ihren Platz)
    setPlacing(spot) {
      placing = spot;
      if (spot) balls[0].visible = true;
      if (spot) balls[0].position.set(spot[0], BED_Y + R, spot[1]);
      else if (state) sync(state);
      drawAim();
    },
    // Tisch-Koordinaten [x, z] → Punkt in der Welt (auf dem Tuch)
    toWorld: ([x, z]) => group.localToWorld(new THREE.Vector3(x, BED_Y, z)),
    // Punkt auf dem Tuch unter der Maus (Tisch-Koordinaten [x, z]) oder null
    pickBed(raycaster) {
      const height = group.localToWorld(new THREE.Vector3(0, BED_Y + R, 0)).y;
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
      if (!hit) return null;
      const local = group.worldToLocal(hit);
      return [local.x, local.z];
    },
    setDesign(s) {
      felt.map = cushions.map = feltOf(s.felt);
      felt.needsUpdate = cushions.needsUpdate = true;
    },
  };
}

// Startaufstellung ohne Zufall (für das Bild im Zimmer)
function initialRack() {
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  const gap = 2 * R + 0.0005;
  const positions = { 0: [-L / 4, 0] };
  let k = 0;
  for (let row = 0; row < 5; row++) for (let i = 0; i <= row; i++) positions[order[k++]] = [L / 4 + row * gap * Math.sqrt(3) / 2, (i - row / 2) * gap];
  return positions;
}

// Kugel-Textur (Kugelabwicklung): Volle in Farbe, Halbe weiß mit Band, Zahl in weißem Kreis (zweimal)
function ballTexture(n) {
  return canvasTexture(512, 256, (g, w, h) => {
    const color = COLORS[n > 8 ? n - 8 : n] ?? '#f4f1e8';
    g.fillStyle = n === 0 || n > 8 ? '#f4f1e8' : color;
    g.fillRect(0, 0, w, h);
    if (n > 8) {
      g.fillStyle = color;
      g.fillRect(0, h * 0.3, w, h * 0.4);
    }
    if (n === 0) { // Weiße mit kleinem roten Punkt, damit man den Drall sieht
      g.fillStyle = '#c02020';
      for (const x of [w * 0.25, w * 0.75]) {
        g.beginPath();
        g.arc(x, h / 2, 10, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    for (const x of [w * 0.25, w * 0.75]) {
      g.fillStyle = '#f4f1e8';
      g.beginPath();
      g.ellipse(x, h / 2, 34, 30, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151515';
      g.font = 'bold 40px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), x, h / 2 + 2);
    }
  });
}

// Tisch: Tuch, Banden, Holzrahmen mit Diamanten, Taschen, Korpus und Beine. Liefert das Tuch-Material (Design).
function buildTable(group) {
  const cloth = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const cushionMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1, color: 0xb8b8b8 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2410', boards: 2 }), roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#2c150a', boards: 2 }), roughness: 0.5 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 });
  const pearl = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.3 });
  const add = (geometry, material, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = shadow;
    group.add(m);
    return m;
  };
  const outerL = L + 2 * (CUSHION + RAIL);
  const outerW = W + 2 * (CUSHION + RAIL);

  add(new THREE.BoxGeometry(L + 2 * CUSHION, 0.02, W + 2 * CUSHION), cloth, 0, BED_Y - 0.01, 0);
  // Banden (Tuch) zwischen den Taschen
  const ch = 0.04;
  for (const s of [-1, 1]) {
    for (const [x0, x1] of [[-L / 2 + CORNER, -SIDE], [SIDE, L / 2 - CORNER]]) {
      add(new THREE.BoxGeometry(x1 - x0, ch, CUSHION), cushionMat, (x0 + x1) / 2, BED_Y + ch / 2, s * (W / 2 + CUSHION / 2));
    }
    add(new THREE.BoxGeometry(CUSHION, ch, W - 2 * CORNER), cushionMat, s * (L / 2 + CUSHION / 2), BED_Y + ch / 2, 0);
  }
  // Holzrahmen
  const rh = 0.055;
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(outerL, rh, RAIL), wood, 0, BED_Y + rh / 2 - 0.01, s * (W / 2 + CUSHION + RAIL / 2));
    add(new THREE.BoxGeometry(RAIL, rh, W + 2 * CUSHION), wood, s * (L / 2 + CUSHION + RAIL / 2), BED_Y + rh / 2 - 0.01, 0);
    for (let k = 1; k < 8; k++) if (k !== 4) add(new THREE.CylinderGeometry(0.007, 0.007, 0.002, 12), pearl, -L / 2 + (k * L) / 8, BED_Y + rh - 0.009, s * (W / 2 + CUSHION + RAIL / 2), false);
    for (let k = 1; k < 4; k++) add(new THREE.CylinderGeometry(0.007, 0.007, 0.002, 12), pearl, s * (L / 2 + CUSHION + RAIL / 2), BED_Y + rh - 0.009, -W / 2 + (k * W) / 4, false);
  }
  // Taschen: schwarze Mulden mit Lederkante
  for (const [x, z] of POCKETS) {
    add(new THREE.CylinderGeometry(0.06, 0.05, 0.08, 24), hole, x, BED_Y - 0.035, z, false);
    const rim = add(new THREE.TorusGeometry(0.06, 0.008, 8, 24), dark, x, BED_Y + 0.004, z, false);
    rim.rotation.x = Math.PI / 2;
  }
  // Ablage für versenkte Kugeln an der Längsseite (Seite des Hosts)
  add(new THREE.BoxGeometry(16 * 2.05 * R + 0.04, 0.012, 0.07), wood, -L / 2 + 0.13 + 8 * 2.05 * R, TRAY.y, TRAY.z);
  for (const dz of [-0.035, 0.035]) add(new THREE.BoxGeometry(16 * 2.05 * R + 0.04, 0.02, 0.006), wood, -L / 2 + 0.13 + 8 * 2.05 * R, TRAY.y + 0.012, TRAY.z + dz);
  // Korpus und Beine bis zum Boden (Tisch hängt 76 cm über dem Boden am tableTop)
  add(new THREE.BoxGeometry(outerL - 0.04, 0.2, outerW - 0.04), dark, 0, BED_Y - 0.12, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.05, 0.065, 0.58, 16), dark, sx * (L / 2 - 0.05), -0.5, sz * (W / 2 - 0.02));
  }
  return { cloth, cushions: cushionMat };
}

// Queue: Spitze am Ursprung, zeigt in +x (wird hinter der Weißen ausgerichtet)
function buildCue() {
  const cue = new THREE.Group();
  const length = 1.45;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0145, length, 20).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#d9b47a', boards: 1 }), roughness: 0.35 }));
  shaft.position.x = -length / 2;
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0148, 0.5, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a140a, roughness: 0.3 }));
  butt.position.x = -length + 0.25;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.012, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.8 }));
  tip.position.x = -0.006;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0066, 0.0066, 0.022, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }));
  ferrule.position.x = -0.023;
  for (const m of [shaft, butt, tip, ferrule]) {
    m.castShadow = true;
    cue.add(m);
  }
  cue.visible = false;
  return cue;
}

// Ziellinie (weiß, leicht durchsichtig), Geisterkugel und kurze Richtung der getroffenen Kugel
function buildGuide() {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), mat);
  const after = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), mat);
  const ghost = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  group.add(line, after, ghost);
  group.visible = false;
  return {
    group,
    set(from, to, ghostAt, ballDir) {
      line.geometry.setFromPoints([from, to]);
      ghost.visible = after.visible = !!ghostAt;
      if (!ghostAt) return;
      ghost.position.copy(ghostAt).setY(BED_Y + 0.001);
      const ballAt = ghostAt.clone().addScaledVector(ballDir, 2 * R);
      after.geometry.setFromPoints([ballAt, ballAt.clone().addScaledVector(ballDir, 0.18)]);
    },
  };
}
