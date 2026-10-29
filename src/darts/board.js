// Dartscheibe an der vorderen Zimmerwand (+z, gegenüber der Rückwand mit Fenster und Bild): Scheibe mit Drähten und
// Zahlenring, schwarzer Auffangring, eigene Scheibenlampe, Abwurflinie am Boden, Pfeile, Zielpunkt und Sieg-Konfetti.
// Die Physik (physics.js, Rapier) läuft nur beim werfenden PC; er streamt die Lage des Pfeils, beim anderen wird sie
// nur angezeigt. Alles hängt in `root` im Maß-System von physics.js (Meter, Scheibe bei z = 0, Bull 1,73 m hoch).
import * as THREE from 'three';
import { ORDER, RING, HANG } from './rules.js';
import { createPhysics, STEP, SURROUND_R, SURROUND_Z } from './physics.js';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { TABLE_TOP } from '../room.js';

export const FACE_Z = 2.94; // Vorderseite der Scheibe in Zimmer-Koordinaten (Wand bei 3, Scheibe 4 cm + 2 cm Abstand)
export const COLORS = [0xc0392b, 0x2f6fd1]; // Flights: Host rot, Gast/Computer blau
const SEND_EVERY = 8; // 60 Lagen pro Sekunde an den Mitspieler
const DEPTH = 0.007; // so tief steckt die Spitze in der Scheibe
const PULL_S = 0.35;
const REMOTE_LOST_MS = 1500; // so lange ohne Flugmeldung des Mitspielers gilt sein Wurf als abgebrochen
const round = (v) => Math.round(v * 100000) / 100000;
const Z = new THREE.Vector3(0, 0, 1);

export function createDartsBoard(parent, { onStream }) {
  const group = new THREE.Group();
  parent.add(group);
  const root = new THREE.Group(); // Maß-System von physics.js → Zimmer: x und z gespiegelt (Blick zur Wand)
  root.position.set(0, -TABLE_TOP, FACE_Z);
  root.rotation.y = Math.PI;
  group.add(root);
  const light = buildScene(root);

  const darts = [0, 1, 2].map(() => buildDart());
  const flying = buildDart();
  for (const d of [...darts, flying]) root.add(d.group);
  const marker = buildMarker();
  root.add(marker.group);
  const confetti = buildConfetti(root);

  let state = null;
  let shot = null; // eigener Wurf mit Physik
  let remote = null; // Wurf des Mitspielers (gestreamte Lagen)
  let pulling = []; // gezogene Pfeile: { dart, t }
  let confettiOn = true;

  // --- Physik (erst beim ersten Wurf geladen) ---
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

  // Eigener Wurf: from = Hand, v = Tempo (m/s). Liefert die Meldung für die Regeln { p, d, on }.
  async function throwDart(from, v, player) {
    await ready();
    if (shot) return null;
    marker.group.visible = false;
    const sim = physics.start(from, v);
    flying.setColor(COLORS[player]);
    pose(flying, from, v);
    flying.group.visible = true;
    playHit('throw', 0.5);
    return new Promise((resolve) => {
      shot = { sim, resolve, acc: 0, player };
    });
  }

  function stepPhysics(dt) {
    shot.acc = Math.min(shot.acc + dt, 24 * STEP);
    while (shot && shot.acc >= STEP) {
      shot.acc -= STEP;
      const { pos, vel, rot, sound } = physics.step(shot.sim);
      const res = shot.sim.result;
      if (res) pose(flying, res.p, res.d, res.on);
      else if (shot.sim.bounced) tumble(flying, pos, rot);
      else pose(flying, pos, vel);
      if (sound) hit(sound);
      if (res || shot.sim.steps % SEND_EVERY === 0 || sound) {
        onStream({ t: 'dart', c: shot.player, p: (res ? res.p : pos).map(round), d: res ? res.d.map(round) : vel.map(round), q: shot.sim.bounced && !res ? [rot.x, rot.y, rot.z, rot.w].map(round) : null, s: sound, on: res?.on ?? null });
      }
      if (res) {
        const { resolve } = shot;
        shot = null;
        resolve({ p: res.p.map(round), d: res.d.map(round), on: res.on });
      }
    }
  }

  function hit(sound) {
    if (sound === 'board') playHit('dart', 0.9);
    else playHit('wood', sound === 'wall' ? 0.6 : 0.4);
  }

  // --- Wurf des Mitspielers anzeigen ---
  function applyRemote(msg) {
    const nums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
    if (!nums(msg.p, 3) || !nums(msg.d, 3) || (msg.q !== null && msg.q !== undefined && !nums(msg.q, 4))) return;
    marker.group.visible = false;
    flying.setColor(COLORS[msg.c === 1 ? 1 : 0]);
    if (!flying.group.visible) pose(flying, msg.p, msg.d); // erste Lage: hinspringen
    flying.group.visible = true;
    remote = { p: new THREE.Vector3(...msg.p), d: msg.d, q: msg.q, on: msg.on, at: performance.now() };
    if (msg.s) hit(msg.s);
    if (msg.on) {
      pose(flying, msg.p, msg.d, msg.on);
      remote = null;
    }
  }

  // --- Anordnung passend zum Spielstand: die Pfeile dieser Aufnahme stecken ---
  function sync(s) {
    const before = state;
    state = s;
    if (!s || shot) return;
    const list = s.darts ?? [];
    // gezogen: was eben noch steckte, fliegt kurz aus der Scheibe
    const stuck = darts.filter((d) => d.group.visible && !pulling.some((p) => p.dart === d));
    if (before && list.length < stuck.length && !remote) {
      pulling.push(...stuck.map((d) => ({ dart: d, t: 0, from: d.group.position.clone() })));
      playHit('dart', 0.35);
    }
    darts.forEach((d, i) => {
      const x = list[i];
      if (pulling.some((p) => p.dart === d)) return;
      d.group.visible = !!x;
      if (!x) return;
      d.setColor(COLORS[s.turn]);
      pose(d, x.p, x.d, x.on);
    });
    if (!remote) flying.group.visible = false;
  }

  function update(dt) {
    if (shot) stepPhysics(dt);
    if (remote && performance.now() - remote.at > REMOTE_LOST_MS) { // letzte Meldung fehlt (z. B. neu verbunden): Flug abbrechen
      remote = null;
      flying.group.visible = false;
      if (state) sync(state);
    }
    if (remote) {
      const k = 1 - Math.exp(-dt * 40);
      flying.group.position.lerp(remote.p, k);
      if (remote.q) flying.group.quaternion.slerp(new THREE.Quaternion(...remote.q), k);
      else flying.group.quaternion.setFromUnitVectors(Z, new THREE.Vector3(...remote.d).normalize().negate());
    }
    const wasPulling = pulling.length > 0;
    pulling = pulling.filter((p) => {
      p.t += dt;
      const k = Math.min(p.t / PULL_S, 1);
      p.dart.group.position.copy(p.from).add(new THREE.Vector3(0, k * 0.05, k * 0.35));
      if (k < 1) return true;
      p.dart.group.visible = false;
      return false;
    });
    if (wasPulling && !pulling.length && state) sync(state); // gezogen: Pfeile des neuen Stands auf die frei gewordenen Plätze
    marker.update(dt);
    if (confetti.mesh.visible) confetti.update(dt);
  }

  function reset() {
    if (shot) {
      physics.cancel(shot.sim);
      shot.resolve(null); // wer auf den Wurf wartet, bekommt „kein Ergebnis“
    }
    shot = remote = null;
    pulling = [];
    state = null;
    for (const d of [...darts, flying]) d.group.visible = false;
    marker.group.visible = false;
    confetti.mesh.visible = false;
  }
  reset();

  return {
    group,
    noTisch: true, // die Scheibe hängt an der Wand (tisch.js)
    ready,
    sync,
    update,
    reset,
    applyRemote,
    throwDart,
    aim: (from, target) => physics.aim(from, target), // Tempo, das genau trifft (erst nach ready())
    busy: () => !!(shot || remote || pulling.length),
    flying: () => !!(shot || remote), // ein Pfeil ist unterwegs (busy zählt auch das Ziehen mit)
    // Zielpunkt auf der Scheibe ([x, y] um das Bull, Spieler) – null = ausblenden
    setAim(at, player = 0) {
      marker.group.visible = !!at && !shot && !remote;
      if (at) marker.set(at, COLORS[player]);
    },
    // Punkt auf der Scheibenebene unter der Maus ([x, y] um das Bull) oder null
    pickBoard(raycaster) {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        root.localToWorld(new THREE.Vector3(0, 0, 1)).sub(root.localToWorld(new THREE.Vector3())).normalize(),
        root.localToWorld(new THREE.Vector3(0, HANG.bull, 0)),
      );
      const hitPoint = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hitPoint) return null;
      const local = root.worldToLocal(hitPoint);
      return [local.x, local.y - HANG.bull];
    },
    // Punkt auf der Scheibe ([x, y] um das Bull) → Welt (z. B. für Bildschirm-Lagen)
    toWorld: ([x, y]) => root.localToWorld(new THREE.Vector3(x, y + HANG.bull, 0)),
    celebrate() {
      if (confettiOn) confetti.burst();
    },
    setDesign(s) {
      confettiOn = s.confetti !== false;
      const cast = s.shadows !== 'off';
      if (light.castShadow !== cast) light.castShadow = cast;
      const size = s.shadows === 'soft' ? 1024 : 512;
      if (light.shadow.mapSize.x !== size) {
        light.shadow.mapSize.set(size, size);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
      light.shadow.radius = s.shadows === 'soft' ? 3 : 1;
    },
  };
}

// Pfeil an seine Lage: p = Spitze, d = Flugrichtung (zeigt in die Scheibe). on gesetzt = steckt (bzw. liegt am Boden)
function pose(dart, p, d, on) {
  const dir = new THREE.Vector3(...d).normalize();
  dart.group.position.set(...p);
  if (on === 'board' || on === 'surround') dart.group.position.addScaledVector(dir, DEPTH);
  if (on === 'floor' && Math.abs(dir.y) < 0.01) dart.group.position.y = 0.004; // liegt flach
  dart.group.quaternion.setFromUnitVectors(Z, dir.negate());
  if (on) dart.group.rotateZ((Math.abs(p[0] * 7919 + p[1] * 104729) % 1) * Math.PI); // jeder Pfeil steckt etwas anders gedreht (auf beiden PCs gleich)
}

// Abgeprallter Pfeil taumelt: Drehung des Rapier-Körpers auf die Flugrichtung beim Abprall
function tumble(dart, p, rot) {
  dart.group.position.set(...p);
  dart.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
}

// Steel-Dart (ca. 15 cm): Spitze am Ursprung, der Rest nach +z; Flights in der Farbe des Spielers
function buildDart() {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.25 });
  const tungsten = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.35 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.9, roughness: 0.5 });
  const shaft = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4 });
  const flight = new THREE.MeshStandardMaterial({ color: COLORS[0], emissive: COLORS[0], emissiveIntensity: 0.35, roughness: 0.55 });
  const along = (geo, z) => geo.rotateX(Math.PI / 2).translate(0, 0, z);
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    group.add(m);
  };
  add(along(new THREE.CylinderGeometry(0.0012, 0.0002, 0.032, 10), 0.016), steel);
  add(along(new THREE.CylinderGeometry(0.0034, 0.0026, 0.05, 18), 0.057), tungsten);
  for (let k = 0; k < 6; k++) add(along(new THREE.CylinderGeometry(0.0036, 0.0036, 0.003, 18), 0.042 + k * 0.006), grip); // Rillen
  add(along(new THREE.CylinderGeometry(0.0022, 0.0028, 0.04, 12), 0.102), shaft);
  // Flight: zwei gekreuzte Flügel (Standardform)
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.016, 0.012);
  shape.lineTo(0.016, 0.036);
  shape.lineTo(0, 0.04);
  const wing = new THREE.ExtrudeGeometry(shape, { depth: 0.0014, bevelEnabled: false }).translate(0, 0, -0.0007); // von hinten sieht man die Kanten (ein farbiges Kreuz)
  for (const r of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const m = new THREE.Mesh(wing.clone().rotateX(Math.PI / 2).rotateZ(r).translate(0, 0, 0.088), flight);
    m.castShadow = true;
    group.add(m);
  }
  group.visible = false;
  return {
    group,
    setColor(c) {
      flight.color.setHex(c);
      flight.emissive.setHex(c);
    },
  };
}

// Zielpunkt: dünner Ring mit Punkt, über allem gezeichnet
function buildMarker() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0055, 0.0075, 32), mat);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 16), mat);
  for (const m of [ring, dot]) {
    m.renderOrder = 10;
    group.add(m);
  }
  group.visible = false;
  let goal = null;
  return {
    group,
    set([x, y], color) {
      mat.color.setHex(color).lerp(new THREE.Color(0xffffff), 0.45);
      goal = new THREE.Vector3(x, y + HANG.bull, 0.002);
      if (!group.visible || group.position.distanceTo(goal) > 0.05) group.position.copy(goal);
    },
    update(dt) {
      if (goal) group.position.lerp(goal, 1 - Math.exp(-dt * 30));
    },
  };
}

// Scheibe, Auffangring, Wandlampe, Abwurflinie. Liefert die Lampe (Schatten je nach Einstellung, setDesign)
function buildScene(root) {
  const add = (geo, mat, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.receiveShadow = shadow;
    root.add(m);
    return m;
  };
  const by = HANG.bull;
  const face = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.95 });
  add(new THREE.CircleGeometry(RING.edge, 128), face, 0, by, 0);
  const side = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  add(new THREE.CylinderGeometry(RING.edge, RING.edge, 0.04, 96, 1, true).rotateX(Math.PI / 2), side, 0, by, -0.02);
  // Drähte: Ringe und Speichen, leicht erhaben
  const wire = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.3 });
  for (const r of [RING.bull, RING.outer, RING.trebleIn, RING.trebleOut, RING.doubleIn, RING.doubleOut]) {
    add(new THREE.TorusGeometry(r, 0.00055, 6, Math.max(32, Math.round(r * 900))), wire, 0, by, 0.0003, false);
  }
  const spokeLen = RING.doubleOut - RING.outer;
  for (let i = 0; i < 20; i++) {
    const a = (i + 0.5) * (Math.PI / 10);
    const r = RING.outer + spokeLen / 2;
    const m = add(new THREE.BoxGeometry(0.0009, spokeLen, 0.0008), wire, r * Math.sin(a), by + r * Math.cos(a), 0.0003, false);
    m.rotation.z = -a;
  }
  // Auffangring (Schaumstoff) um die Scheibe
  const foam = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 });
  add(new THREE.RingGeometry(RING.edge, SURROUND_R, 96), foam, 0, by, SURROUND_Z);
  add(new THREE.CylinderGeometry(SURROUND_R, SURROUND_R, 0.055 + SURROUND_Z, 96, 1, true).rotateX(Math.PI / 2), foam, 0, by, (SURROUND_Z - 0.055) / 2);
  // Abwurflinie (Oche) am Boden: 2,37 m vor der Scheibe
  const oche = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#2a1a0e', boards: 1 }), roughness: 0.5 });
  add(new THREE.BoxGeometry(0.6, 0.012, 0.038), oche, 0.1, 0.006, HANG.oche + 0.019);
  // Scheibenlampe: hängt vorn oben und leuchtet die Scheibe gleichmäßig aus
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 });
  add(new THREE.BoxGeometry(0.04, 0.04, 0.62), lampMat, 0, by + 0.58, 0.28, false);
  add(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 24), lampMat, 0, by + 0.56, 0.6, false);
  const light = new THREE.SpotLight(0xfff2dc, 2.2, 3, 0.6, 0.6, 1.6);
  light.position.set(0, by + 0.54, 0.6);
  light.target.position.set(0, by - 0.02, 0);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = 2;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.001;
  root.add(light, light.target);
  return light;
}

// Scheibe als Bild: Segmente (schwarz/beige, Doppel und Triple rot/grün), Bull, Sisal-Fasern, Zahlenring
function boardTexture() {
  return canvasTexture(2048, 2048, (g, w) => {
    const c = w / 2;
    const k = c / RING.edge; // Pixel je Meter
    const seg = Math.PI / 10;
    g.fillStyle = '#141414';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    const sector = (r0, r1, i, color) => {
      const a0 = i * seg - seg / 2 - Math.PI / 2;
      g.fillStyle = color;
      g.beginPath();
      g.arc(c, c, r1 * k, a0, a0 + seg);
      g.arc(c, c, r0 * k, a0 + seg, a0, true);
      g.closePath();
      g.fill();
    };
    for (let i = 0; i < 20; i++) {
      const dark = i % 2 === 0; // die 20 ist schwarz
      const single = dark ? '#191919' : '#eadcb8';
      const ring = dark ? '#c4232b' : '#1d8a3e';
      sector(RING.outer, RING.trebleIn, i, single);
      sector(RING.trebleIn, RING.trebleOut, i, ring);
      sector(RING.trebleOut, RING.doubleIn, i, single);
      sector(RING.doubleIn, RING.doubleOut, i, ring);
    }
    g.fillStyle = '#1d8a3e';
    g.beginPath();
    g.arc(c, c, RING.outer * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c4232b';
    g.beginPath();
    g.arc(c, c, RING.bull * k, 0, Math.PI * 2);
    g.fill();
    // Sisal: feine helle und dunkle Fasern
    for (let n = 0; n < 26000; n++) {
      const r = Math.sqrt(Math.random()) * RING.doubleOut * k;
      const a = Math.random() * Math.PI * 2;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.12)';
      g.fillRect(c + r * Math.cos(a), c + r * Math.sin(a), 2, 2);
    }
    // Zahlenring
    g.fillStyle = '#f4f1e8';
    g.font = `bold ${Math.round(0.03 * k)}px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ORDER.forEach((n, i) => {
      const a = i * seg;
      const r = ((RING.doubleOut + RING.edge) / 2) * k;
      g.fillText(String(n), c + r * Math.sin(a), c - r * Math.cos(a));
    });
    g.strokeStyle = 'rgba(200, 205, 210, 0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c, c, (RING.edge - 0.004) * k, 0, Math.PI * 2);
    g.stroke();
  });
}

// Sieg-Konfetti: regnet von oben vor die Scheibe (das Zimmer-Konfetti fällt auf den Spieltisch, außer Sicht)
function buildConfetti(root) {
  const N = 160;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.012, 0.018), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), N);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const tint = new THREE.Color();
  const colors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xffffff];
  for (let i = 0; i < N; i++) mesh.setColorAt(i, tint.setHex(colors[i % colors.length]));
  root.add(mesh);
  const dummy = new THREE.Object3D();
  let pieces = [];
  let age = 0;
  const rand = (a, b) => a + Math.random() * (b - a);
  return {
    mesh,
    burst() {
      age = 0;
      mesh.visible = true;
      pieces = Array.from({ length: N }, () => ({
        pos: new THREE.Vector3(rand(-0.7, 0.7), HANG.bull + rand(0.35, 0.8), rand(0.05, 0.9)),
        vel: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.2, 0.6), rand(0, 0.5)),
        rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        spin: rand(3, 9),
      }));
    },
    update(dt) {
      age += dt;
      for (const [i, p] of pieces.entries()) {
        p.vel.y = Math.max(p.vel.y - 3 * dt, -0.7); // flattert langsam herunter
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x += Math.sin(age * 4 + i) * 0.1 * dt;
        p.rot.x += p.spin * dt;
        p.rot.y += p.spin * 0.6 * dt;
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.setScalar(Math.min(1, Math.max(0, 4.5 - age)));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (age > 4.5) mesh.visible = false;
    },
  };
}
