// Schiffe-versenken-Tisch: je Spieler ein Spielkoffer wie beim echten Spiel – unten flach das eigene Meer mit den Schiffen,
// dahinter aufrecht der Deckel mit dem Zielraster, rechts daneben das Fach mit roten und weißen Steckern. Die Deckel
// stehen Rücken an Rücken in der Tischmitte, der Host sitzt auf +z, der Gast gegenüber.
// Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) – Stecker im Zielraster (weiß = Wasser, rot = Treffer),
// rote Stecker in getroffenen Schiffen, Wasserringe im Meer – und spielt Änderungen ab (der Stecker fliegt vom Fach ins
// Loch). Die Schiffe des anderen bleiben unsichtbar, bis die Partie aus ist. Stecker sind lose Teile (tisch.js), die
// Schiffe gehören zum Koffer – sie zieht das Spiel selbst (index.js). Maße in Zentimetern (1/100).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { N, FLEET, ROWS, shipAt } from './game.js';

const P = 2.4; // Lochabstand
const GX0 = -11; // linke Kante des Rasters (Spalte 1) – links davon stehen die Buchstaben
const GZ0 = 4.5; // hintere Kante des Meeres (Reihe A) – davor die Zahlen
const BASE_H = 1.0; // Oberkante der Meeresplatte
const PLATE = { x0: -14, x1: 15, z0: 1.6, z1: 30.6 };
const LID = { z: 1.0, t: 0.6, y0: 1.0, y1: 31.5 }; // Vorderseite des Deckels bei z = LID.z
const LY0 = 28.5; // Oberkante des Zielrasters (Reihe A)
const TRAY = { x0: 16.5, x1: 25.5, red: [4.5, 12.5], white: [13.5, 28.5] };
const HULL_H = 1.3;
const PEG_IN = 0.55; // so tief steckt ein Stecker im Loch
const TRAY_N = { red: 8, white: 14 }; // so viele liegen mindestens im Fach (verbrauchte kommen nach)
const COLORS = { red: 0xc8231c, white: 0xc4c0b6 };
// Koffer je Design (Schachfiguren-Einstellung): Holz = klassisch blau/rot, Marmor = heller Kunststoff, Metall = Metall.
// colors = Host, Gast
const LOOKS = {
  holz: { colors: [0x3b5f8f, 0x963028], roughness: 0.42, metalness: 0, clearcoat: 0.5 },
  marmor: { colors: [0xe4e9f0, 0xf2e6df], roughness: 0.22, metalness: 0, clearcoat: 1 },
  metall: { colors: [0x7d8590, 0xa08a5c], roughness: 0.32, metalness: 1, clearcoat: 0.2 },
};

const cx = (i) => GX0 + (i + 0.5) * P;
const cz = (j) => GZ0 + (j + 0.5) * P;
const ly = (j) => LY0 - (j + 0.5) * P;
const Q_UP = new THREE.Quaternion();
const Q_LID = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // Stecker zeigt zum Spieler
const Q_LYING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2); // liegt im Fach

// Stecker als Drehkörper (Achse = y): Spitze unten bei 0, oben ein runder Kopf
function pegGeometry() {
  const pts = [[0, 0], [0.24, 0.04], [0.27, 0.2], [0.27, 1.25], [0.45, 1.28], [0.46, 1.46], [0.4, 1.62], [0.24, 1.8], [0, 1.86]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 16);
}

// Schiff k: Rumpf mit Bug (Länge in +x, erstes Feld bei x = 0), Aufbauten zwischen den Löchern, Löcher als eigene Form
function shipGeometries(k) {
  const len = FLEET[k].len;
  const a = -P / 2 + 0.2;
  const b = (len - 0.5) * P - 0.2;
  const w = 0.88;
  const shape = new THREE.Shape();
  shape.moveTo(a + 0.3, -w).lineTo(b - 1.7, -w).quadraticCurveTo(b - 0.4, -w * 0.7, b, 0).quadraticCurveTo(b - 0.4, w * 0.7, b - 1.7, w)
    .lineTo(a + 0.3, w).quadraticCurveTo(a, w, a, w - 0.3).lineTo(a, -w + 0.3).quadraticCurveTo(a, -w, a + 0.3, -w);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: HULL_H, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 10 })
    .rotateX(-Math.PI / 2);
  const parts = [hull];
  const box = (sx, sy, sz, x, y, z) => parts.push(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  if (k === 0) box(1.4, 1.5, 0.5, 1.5 * P, HULL_H + 0.75, -w + 0.3); // Flugzeugträger: Brücke am Rand
  else {
    for (let i = 0; i < len - 1; i++) box(0.75, i === 0 ? 1.3 : 0.8, 0.95, (i + 0.5) * P, HULL_H + (i === 0 ? 0.65 : 0.4), 0);
    if (k === 3) box(0.6, 1.0, 0.6, 0.5 * P, HULL_H + 1.5, 0); // Turm des U-Boots
  }
  const holes = mergeGeometries(Array.from({ length: len }, (_, i) => new THREE.CylinderGeometry(0.33, 0.33, 0.06, 14).translate(i * P, HULL_H + 0.13, 0)));
  return { body: mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), holes };
}

// Meer (Draufsicht): Rand, Wasser mit Raster und Löchern, Buchstaben A–J links, Zahlen oben; misses = Wasserringe
function drawOcean(g, w, h, misses) {
  const s = w / (PLATE.x1 - PLATE.x0);
  const X = (x) => (x - PLATE.x0) * s;
  const Z = (z) => (z - PLATE.z0) * s;
  g.fillStyle = '#56606b';
  g.fillRect(0, 0, w, h);
  const water = g.createLinearGradient(0, Z(GZ0), 0, Z(GZ0 + N * P));
  water.addColorStop(0, '#2a6d9c');
  water.addColorStop(1, '#174a72');
  g.fillStyle = water;
  g.fillRect(X(GX0), Z(GZ0), N * P * s, N * P * s);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  for (let k = 0; k < 40; k++) { // Wellen
    const y = Z(GZ0) + ((k * 37) % (N * P * s));
    const x = X(GX0) + ((k * 53) % (N * P * s * 0.8));
    g.beginPath();
    g.arc(x + 20, y, 14, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
  }
  grid(g, X, Z, (i) => cx(i), (j) => cz(j), s);
  g.fillStyle = '#eef2f5';
  g.font = `bold ${Math.round(1.25 * s)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let j = 0; j < N; j++) g.fillText(ROWS[j], X(GX0 - 1.4), Z(cz(j)));
  for (let i = 0; i < N; i++) g.fillText(String(i + 1), X(cx(i)), Z(GZ0 - 1.3));
  for (const [i, j] of misses) ring(g, X(cx(i)), Z(cz(j)), s, 'rgba(255,255,255,0.95)');
}

// Deckel (Vorderseite): Zielraster mit Löchern, Buchstaben und Zahlen
function drawLid(g, w, h) {
  const s = w / (PLATE.x1 - PLATE.x0);
  const X = (x) => (x - PLATE.x0) * s;
  const Y = (y) => (LID.y1 - y) * s;
  // hell gehalten: der Deckel steht aufrecht, die Lampe streift ihn nur – dunkel war er auf schwachen Bildschirmen kaum lesbar
  g.fillStyle = '#4f6680';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#7f9bb8';
  g.fillRect(X(GX0), Y(LY0), N * P * s, N * P * s);
  grid(g, X, Y, (i) => cx(i), (j) => ly(j), s);
  g.fillStyle = '#e6ecf2';
  g.font = `bold ${Math.round(1.25 * s)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let j = 0; j < N; j++) g.fillText(ROWS[j], X(GX0 - 1.4), Y(ly(j)));
  for (let i = 0; i < N; i++) g.fillText(String(i + 1), X(cx(i)), Y(LY0 + 1.3));
}

function grid(g, X, Y, ax, ay, s) {
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1.5;
  for (let k = 0; k <= N; k++) {
    g.beginPath();
    g.moveTo(X(GX0 + k * P), Y(ay(0) + (ay(0) < ay(1) ? -P / 2 : P / 2)));
    g.lineTo(X(GX0 + k * P), Y(ay(N - 1) + (ay(0) < ay(1) ? P / 2 : -P / 2)));
    g.stroke();
    const yk = ay(0) + (ay(0) < ay(1) ? (k - 0.5) * P : -(k - 0.5) * P);
    g.beginPath();
    g.moveTo(X(GX0), Y(yk));
    g.lineTo(X(GX0 + N * P), Y(yk));
    g.stroke();
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hole = g.createRadialGradient(X(ax(i)), Y(ay(j)) - 2, 1, X(ax(i)), Y(ay(j)), 0.34 * s);
      hole.addColorStop(0, '#05080c');
      hole.addColorStop(1, '#1b232c');
      g.fillStyle = hole;
      g.beginPath();
      g.arc(X(ax(i)), Y(ay(j)), 0.34 * s, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function ring(g, x, y, s, color) {
  g.strokeStyle = color;
  g.lineWidth = 0.17 * s;
  g.beginPath();
  g.arc(x, y, 0.72 * s, 0, Math.PI * 2);
  g.stroke();
}

export function createSchiffeBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);

  const caseMats = LOOKS.holz.colors.map((color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  const shipMat = new THREE.MeshPhysicalMaterial({ color: 0x59616b, roughness: 0.5, clearcoat: 0.25 });
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.9 });
  const pegMats = { red: new THREE.MeshPhysicalMaterial({ color: COLORS.red, roughness: 0.35, clearcoat: 0.6 }), white: new THREE.MeshPhysicalMaterial({ color: COLORS.white, roughness: 0.6, clearcoat: 0.2 }) };
  const pegGeo = pegGeometry();
  const shipGeos = FLEET.map((_, k) => shipGeometries(k));

  // --- je Sitz ein Koffer ---
  const seats = [0, 1].map((seat) => {
    const root = new THREE.Group();
    root.rotation.y = seat === 0 ? 0 : Math.PI;
    group.add(root);
    const mat = caseMats[seat];
    const add = (geo, m, x, y, z) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    };
    const pw = PLATE.x1 - PLATE.x0;
    const pd = PLATE.z1 - PLATE.z0;
    const px = (PLATE.x0 + PLATE.x1) / 2;
    const pz = (PLATE.z0 + PLATE.z1) / 2;
    add(new THREE.BoxGeometry(pw, BASE_H, pd), mat, px, BASE_H / 2, pz);
    for (const [w, d, x, z] of [[pw, 0.5, px, PLATE.z1 - 0.25], [0.5, pd, PLATE.x0 + 0.25, pz], [0.5, pd, PLATE.x1 - 0.25, pz]]) add(new THREE.BoxGeometry(w, 0.5, d), mat, x, BASE_H + 0.25, z);
    // Meer: Textur liegt knapp über der Platte
    const oceanCanvas = { misses: '', tex: null };
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), new THREE.MeshStandardMaterial({ roughness: 0.55 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(px, BASE_H + 0.01, pz);
    ocean.receiveShadow = true;
    root.add(ocean);
    // Deckel mit Zielraster
    const lh = LID.y1 - LID.y0;
    add(new THREE.BoxGeometry(pw, lh, LID.t), mat, px, LID.y0 + lh / 2, LID.z - LID.t / 2);
    // leuchtet etwas selbst (emissiveMap), damit das Zielraster auch nachts und von der Seite lesbar bleibt
    const lidTex = canvasTexture(1024, Math.round((1024 * lh) / pw), drawLid);
    const lidFace = new THREE.Mesh(new THREE.PlaneGeometry(pw, lh), new THREE.MeshStandardMaterial({ map: lidTex, emissive: 0xffffff, emissiveMap: lidTex, emissiveIntensity: 0.35, roughness: 0.5 }));
    lidFace.position.set(px, LID.y0 + lh / 2, LID.z + 0.01);
    lidFace.receiveShadow = true;
    root.add(lidFace);
    // Scharniere
    for (const x of [PLATE.x0 + 4, PLATE.x1 - 4]) add(new THREE.CylinderGeometry(0.45, 0.45, 3, 12).rotateZ(Math.PI / 2), mat, x, BASE_H + 0.2, LID.z + 0.3);
    // Fach für die Stecker (rot hinten, weiß vorn)
    const tw = TRAY.x1 - TRAY.x0;
    const tx = (TRAY.x0 + TRAY.x1) / 2;
    const tz0 = TRAY.red[0] - 0.6;
    const tz1 = TRAY.white[1] + 0.6;
    add(new THREE.BoxGeometry(tw, 0.5, tz1 - tz0), mat, tx, 0.25, (tz0 + tz1) / 2);
    for (const z of [tz0, (TRAY.red[1] + TRAY.white[0]) / 2, tz1]) add(new THREE.BoxGeometry(tw, 1.4, 0.4), mat, tx, 0.7, z);
    for (const x of [TRAY.x0, TRAY.x1]) add(new THREE.BoxGeometry(0.4, 1.4, tz1 - tz0), mat, x, 0.7, (tz0 + tz1) / 2);
    // Schiffe
    const ships = FLEET.map((_, k) => {
      const ship = new THREE.Group();
      const body = new THREE.Mesh(shipGeos[k].body, shipMat);
      const holes = new THREE.Mesh(shipGeos[k].holes, holeMat);
      body.castShadow = body.receiveShadow = true;
      ship.add(body, holes);
      root.add(ship);
      return { group: ship, body, holes, k, at: null, shown: false };
    });
    // offener Schuss: pulsierender Ring im Zielraster
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.13, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.9 }));
    mark.visible = false;
    mark.raycast = () => {};
    root.add(mark);
    return { seat, root, ocean, oceanCanvas, lidFace, ships, mark };
  });

  // Durchsichtiger Stecker im Loch unter der Maus
  const ghost = new THREE.Mesh(pegGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
  ghost.visible = false;
  ghost.raycast = () => {}; // Maus und Tisch greifen durch ihn hindurch

  // --- Stecker ---
  // peg: { mesh, color, seat (Fach), slot (null = im Fach), anim }
  const pegs = [];
  let preferred = null;
  let shown = null; // zuletzt gezeigte Sicht
  let seatMe = 0;
  let clock = 0;

  function newPeg(seat, color) {
    const mesh = new THREE.Mesh(pegGeo, pegMats[color]);
    mesh.castShadow = mesh.receiveShadow = true;
    seats[seat].root.add(mesh);
    const peg = { mesh, color, seat, slot: null, anim: [] };
    pegs.push(peg);
    return peg;
  }

  // Platz im Fach: liegend, zwei Spalten, Lage für Lage
  function trayAt(color, n) {
    const [z0, z1] = TRAY[color];
    const rows = Math.floor((z1 - z0) / 1.0);
    const perLayer = rows * 3;
    const layer = Math.floor(n / perLayer);
    const r = n % perLayer;
    const col = Math.floor(r / rows);
    return new THREE.Vector3(TRAY.x0 + 0.9 + col * 2.5 + (layer % 2) * 0.5, 0.5 + 0.46 + layer * 0.9, z0 + 0.5 + (r % rows) * 1.0);
  }

  function travel(item, to, quat, { dur = 0.5, height = 6, delay = 0 } = {}) {
    const last = item.anim.at(-1);
    const from = last?.to ?? item.mesh.position.clone();
    const q0 = last?.quat ?? item.mesh.quaternion.clone();
    if (delay) item.anim.push({ t: 0, dur: delay, from, to: from, q0, quat: q0, height: 0 });
    item.anim.push({ t: 0, dur, from, to: to.clone(), q0, quat: quat.clone(), height, sound: true });
  }

  function setNow(item, pos, quat) {
    item.anim = [];
    item.mesh.position.copy(pos);
    item.mesh.quaternion.copy(quat);
  }

  // Ort eines Steckers: Zielraster (lid), Meer (sea, auf dem Schiff deck = true) – Spitze im Loch
  function slotPose(slot) {
    if (slot.kind === 'lid') return { pos: new THREE.Vector3(cx(slot.x), ly(slot.y), LID.z - PEG_IN), quat: Q_LID };
    const y = BASE_H + (slot.deck ? HULL_H + 0.15 : 0) - PEG_IN;
    return { pos: new THREE.Vector3(cx(slot.x), y, cz(slot.y)), quat: Q_UP };
  }

  function restack(seat, color, animate) {
    const free = pegs.filter((p) => p.seat === seat && p.color === color && !p.slot);
    while (free.length < TRAY_N[color]) {
      const p = newPeg(seat, color);
      setNow(p, trayAt(color, free.length), Q_LYING);
      free.push(p);
    }
    free.forEach((p, n) => {
      const at = trayAt(color, n);
      const goal = p.anim.at(-1)?.to ?? p.mesh.position;
      if (goal.distanceTo(at) < 0.01) return;
      if (animate) travel(p, at, Q_LYING, { dur: 0.45, height: 4 });
      else setNow(p, at, Q_LYING);
    });
  }

  // Sicht v zeigen. me = wer zuschaut · own = eigene Flotte (beim Aufstellen der Entwurf) · animate = Änderung abspielen
  function show(v, me, own, animate) {
    seatMe = me;
    const fleets = v.fleets.map((f, s) => (s === me ? own : f));
    // Schiffe
    for (const S of seats) {
      const fleet = fleets[S.seat];
      for (const sh of S.ships) {
        const ship = fleet?.[sh.k] ?? null;
        setShip(S, sh, ship);
      }
    }
    // Stecker-Plätze: Zielraster jedes Schützen, rote Stecker in getroffenen Schiffen, Ringe für Wasser
    const want = new Map(); // key → { seat, color, slot }
    const misses = [[], []];
    const marks = [null, null];
    for (const s of [0, 1]) {
      const d = 1 - s;
      for (const t of v.shots[s]) {
        const k = `${s}:lid:${t.x}:${t.y}`;
        const color = t.res === null ? null : t.res === 'wasser' ? 'white' : 'red';
        want.set(k, { seat: s, color, slot: { kind: 'lid', x: t.x, y: t.y } });
        // im Meer des Beschossenen: ist seine Flotte bekannt, zählt sie – sonst die Antwort
        const fleet = fleets[d];
        const hit = fleet ? shipAt(fleet, t.x, t.y) >= 0 : t.res !== null && t.res !== 'wasser';
        if (t.res === null) marks[d] = [t.x, t.y];
        if (t.res === null && !fleet) continue;
        if (hit) want.set(`${d}:sea:${t.x}:${t.y}`, { seat: d, color: 'red', slot: { kind: 'sea', x: t.x, y: t.y, deck: !!fleet } });
        else misses[d].push([t.x, t.y]);
        if (t.res === null) marks[s] = [t.x, t.y];
      }
    }
    for (const S of seats) {
      drawSea(S, misses[S.seat]);
      const m = marks[S.seat];
      S.mark.visible = !!m;
      if (m) {
        // beim Schützen im Zielraster, beim Beschossenen im Meer
        const lid = v.pending?.by === S.seat;
        S.mark.position.copy(lid ? new THREE.Vector3(cx(m[0]), ly(m[1]), LID.z + 0.15) : new THREE.Vector3(cx(m[0]), BASE_H + 0.25, cz(m[1])));
        S.mark.quaternion.copy(lid ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      }
    }
    // vorhandene Stecker behalten, wenn Platz und Farbe passen (offener Schuss: jede Farbe)
    for (const p of pegs) {
      if (!p.slot) continue;
      const w = want.get(p.slot.key);
      if (w && (w.color === null || w.color === p.color)) {
        w.peg = p;
        p.slot = { ...w.slot, key: p.slot.key };
        const pose = slotPose(p.slot);
        if (!p.anim.length && p.mesh.position.distanceTo(pose.pos) > 0.01) setNow(p, pose.pos, pose.quat); // Schiff liegt jetzt anders
      } else p.slot = null; // zurück ins Fach
    }
    let delay = 0;
    for (const [key, w] of want) {
      if (w.peg) continue;
      const color = w.color ?? (preferred && !preferred.slot && preferred.seat === w.seat ? preferred.color : 'white');
      const free = pegs.filter((p) => p.seat === w.seat && p.color === color && !p.slot);
      const p = (preferred && free.includes(preferred) ? preferred : null) ?? free.at(-1) ?? newPeg(w.seat, color);
      if (p === preferred) preferred = null;
      p.slot = { ...w.slot, key };
      const pose = slotPose(p.slot);
      if (animate) {
        travel(p, pose.pos.clone().add(new THREE.Vector3(0, w.slot.kind === 'lid' ? 0 : 1.6, w.slot.kind === 'lid' ? 1.6 : 0)), pose.quat, { dur: 0.5, height: 5, delay });
        travel(p, pose.pos, pose.quat, { dur: 0.12, height: 0 });
        delay += 0.15;
      } else setNow(p, pose.pos, pose.quat);
    }
    preferred = null;
    for (const s of [0, 1]) for (const c of ['red', 'white']) restack(s, c, animate);
  }

  function drawSea(S, misses) {
    const keyStr = JSON.stringify(misses);
    if (S.oceanCanvas.misses === keyStr) return;
    S.oceanCanvas.misses = keyStr;
    const old = S.ocean.material.map;
    S.ocean.material.map = canvasTexture(1024, Math.round((1024 * (PLATE.z1 - PLATE.z0)) / (PLATE.x1 - PLATE.x0)), (g, w, h) => drawOcean(g, w, h, misses));
    S.ocean.material.needsUpdate = true;
    old?.dispose();
  }

  // Schiff hinlegen (ship = { x, y, dir } oder null = unsichtbar) · lift = in der Hand angehoben · bad = passt so nicht
  function setShip(S, sh, ship, { lift = 0, bad = false } = {}) {
    sh.shown = !!ship;
    sh.body.visible = sh.holes.visible = !!ship; // je Mesh: der Tisch und die Maus sehen sonst unsichtbare Teile
    if (!ship) return;
    sh.group.position.set(cx(ship.x), BASE_H + lift, cz(ship.y));
    sh.group.rotation.y = ship.dir === 'h' ? 0 : -Math.PI / 2;
    sh.body.material = bad ? badMat : shipMat;
  }
  const badMat = shipMat.clone();
  badMat.color.setHex(0xc04a3a);
  badMat.transparent = true;
  badMat.opacity = 0.8;

  function update(dt) {
    clock += dt;
    for (const p of pegs) {
      let left = dt;
      while (left > 0 && p.anim.length) {
        const a = p.anim[0];
        const use = Math.min(left, (1 - a.t) * a.dur);
        a.t += use / a.dur;
        left -= use;
        const k = a.t * a.t * (3 - 2 * a.t);
        p.mesh.position.lerpVectors(a.from, a.to, k);
        p.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
        p.mesh.quaternion.slerpQuaternions(a.q0, a.quat, k);
        if (a.t >= 1 - 1e-9) {
          p.anim.shift();
          if (a.sound && a.height === 0) playHit('wood', 0.5); // steckt im Loch
        } else break;
      }
    }
    const pulse = 0.55 + 0.4 * Math.sin(clock * 6);
    for (const S of seats) {
      S.mark.material.opacity = pulse;
      S.mark.scale.setScalar(1 + 0.12 * Math.sin(clock * 6));
    }
  }

  const busy = () => pegs.some((p) => p.anim.length);

  // Strahl → Punkt in der Ebene y bzw. z = const im Koffer eines Sitzes (lokale Koordinaten) oder null
  function localHit(raycaster, seat, normal, value) {
    const S = seats[seat];
    S.root.updateWorldMatrix(true, false);
    const inv = S.root.matrixWorld.clone().invert();
    const ray = raycaster.ray.clone().applyMatrix4(inv);
    const plane = new THREE.Plane(normal, -value);
    return ray.intersectPlane(plane, new THREE.Vector3());
  }

  function reset() {
    shown = null;
    preferred = null;
    ghost.removeFromParent();
    ghost.visible = false;
  ghost.raycast = () => {}; // Maus und Tisch greifen durch ihn hindurch
    for (const p of pegs) p.slot = null;
    for (const S of seats) {
      for (const sh of S.ships) setShip(S, sh, null);
      S.mark.visible = false;
      drawSea(S, []);
    }
    for (const s of [0, 1]) for (const c of ['red', 'white']) restack(s, c, false);
  }

  reset();

  return {
    group,
    loose: () => pegs.map((p) => p.mesh), // Stecker fliegen beim Umwerfen einzeln (tisch.js)
    // Koffer klassisch blau/rot, hell oder aus Metall – folgt dem Schachfiguren-Design dieses PCs (settings.js)
    setDesign(s) {
      const look = LOOKS[s.chessSet] ?? LOOKS.holz;
      caseMats.forEach((m, seat) => {
        m.color.setHex(look.colors[seat]);
        Object.assign(m, { roughness: look.roughness, metalness: look.metalness, clearcoat: look.clearcoat, envMapIntensity: look.metalness ? 5 : 1 });
      });
    },
    update,
    busy,
    reset,
    // v = Sicht (viewFor) · me = wer zuschaut · own = eigene Flotte (Entwurf beim Aufstellen) · eine neue Aktion wird
    // abgespielt (oder die Revanche), sonst steht alles sofort da
    sync(v, me, own) {
      if (!v) return;
      const animate = !!shown && (v.seq === shown.seq + 1 || v.seq === shown.seq || v.events[0]?.type === 'start');
      show(v, me, own, animate);
      shown = v;
    },
    // Schiff k des Sitzes gerade in der Hand: ship = Lage (null = wieder wie im Stand)
    hold(seat, k, ship, bad) {
      const S = seats[seat];
      setShip(S, S.ships[k], ship, { lift: 1.2, bad });
    },
    // Schiff unter der Maus (nur sichtbare des Sitzes) → Nummer oder null
    pickShip(raycaster, seat) {
      const list = seats[seat].ships.filter((sh) => sh.shown);
      const hit = raycaster.intersectObjects(list.map((sh) => sh.body), false)[0];
      return hit ? list.find((sh) => sh.body === hit.object).k : null;
    },
    // Feld im eigenen Meer unter der Maus als Kommazahl { x, y } (auch außerhalb – zum Ziehen) oder null
    seaPoint(raycaster, seat) {
      const p = localHit(raycaster, seat, new THREE.Vector3(0, 1, 0), BASE_H);
      return p ? { x: (p.x - GX0) / P - 0.5, y: (p.z - GZ0) / P - 0.5 } : null;
    },
    // Loch im Zielraster des Sitzes unter der Maus → { x, y } oder null
    lidCell(raycaster, seat) {
      const p = localHit(raycaster, seat, new THREE.Vector3(0, 0, 1), LID.z);
      if (!p) return null;
      const x = Math.floor((p.x - GX0) / P);
      const y = Math.floor((LY0 - p.y) / P);
      return x >= 0 && x < N && y >= 0 && y < N ? { x, y } : null;
    },
    // Durchsichtiger Stecker im Zielraster (cell null = weg)
    setGhost(seat, cell) {
      ghost.visible = !!cell;
      if (!cell) return;
      if (ghost.parent !== seats[seat].root) seats[seat].root.add(ghost);
      const pose = slotPose({ kind: 'lid', ...cell });
      ghost.position.copy(pose.pos);
      ghost.quaternion.copy(pose.quat);
    },
    // Stecker zu einem Mesh: { seat, color, placed } oder null
    pegOf(mesh) {
      const p = pegs.find((x) => x.mesh === mesh);
      return p ? { seat: p.seat, color: p.color, placed: !!p.slot } : null;
    },
    // dieser Stecker soll beim nächsten Schuss ins Loch
    prefer(mesh) {
      preferred = pegs.find((x) => x.mesh === mesh) ?? null;
    },
    seat: () => seatMe,
  };
}
