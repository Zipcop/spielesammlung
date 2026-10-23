// Reversi-Tisch: Holzbrett mit grünem Spielfeld (8 × 8, Beschriftung a–h und 1–8) und 64 Steinen – oben schwarz,
// unten weiß. Jeder Spieler hat rechts neben dem Brett zwei Türmchen mit je 16 Steinen, seine Farbe liegt oben.
// Kennt keine Regeln: zeigt einen Spielstand (game.js) und spielt die Änderung ab – ein neuer Stein fliegt vom Turm
// aufs Feld, danach heben sich die umgedrehten Steine einer nach dem anderen, drehen sich in der Luft und landen.
// Steine, die nicht mehr auf dem Brett liegen (erwischt, Revanche), fliegen zurück auf den Turm.
// Maße in Zentimetern (Gruppe 1/100 skaliert). Spieler 0 (Host) sitzt bei +z, Spieler 1 gegenüber.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, across } from '../plates.js';
import { N } from './game.js';

const S = 3.6; // Feldgröße
const GRID = N * S;
const FIELD = GRID + 3; // grünes Feld mit Rand für die Beschriftung
export const BOARD = FIELD + 3.2; // mit Holzrahmen
const THICK = 1.6;
const R = 1.5; // Steinradius
const T = 0.6; // Steindicke
const PER_TOWER = 16;
const TOWER_X = BOARD / 2 + 3;
const TOWER_Z = [5, 8.8];

const FRAMES = { // Rahmen wie die Schachfiguren dieses PCs (Einstellung „Figuren“)
  holz: { color: 0xffffff, roughness: 0.5, metalness: 0, wood: true },
  marmor: { color: 0xeeeae2, roughness: 0.18, metalness: 0, wood: false },
  metall: { color: 0xc59a3c, roughness: 0.3, metalness: 1, wood: false },
};

const cellAt = (k) => new THREE.Vector3(((k % N) - (N - 1) / 2) * S, THICK + T / 2, (Math.floor(k / N) - (N - 1) / 2) * S);
const BLACK_UP = new THREE.Quaternion();
const WHITE_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const upOf = (color) => (color === 0 ? BLACK_UP : WHITE_UP);
// Turm-Platz slot (0–31) von Spieler p: zwei Türmchen rechts neben dem Brett (vom Spieler aus gesehen)
function towerAt(p, slot) {
  const side = p === 0 ? 1 : -1;
  return new THREE.Vector3(side * TOWER_X, (slot % PER_TOWER + 0.5) * T, side * TOWER_Z[Math.floor(slot / PER_TOWER)]);
}

// Stein: zwei Hälften als Drehkörper mit gerundeter Kante – oben schwarz (Gruppe 0), unten weiß (Gruppe 1)
function discGeometry() {
  const h = T / 2;
  // Umriss von unten nach oben (sonst zeigen die Flächen nach innen): untere Hälfte, obere ist gespiegelt
  const pts = [[0, -h], [R - 0.18, -h], [R - 0.04, 0.06 - h], [R, 0.16 - h], [R, 0]];
  const half = (sign) => new THREE.LatheGeometry((sign > 0 ? pts.map(([r, y]) => [r, -y]).reverse() : pts).map(([r, y]) => new THREE.Vector2(r, y)), 40);
  return mergeGeometries([half(1), half(-1)], true);
}

export function createReversiBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const frame = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: woodTexture({ base: '#6e4122', boards: 3 }), roughness: 0.5, clearcoat: 0.35 });
  const wood = frame.map;
  buildBoard(group, frame);
  const plates = createPlates(group, 2, { w: 14, h: 3.5 });

  const geometry = discGeometry();
  const looks = [
    new THREE.MeshPhysicalMaterial({ color: 0x18181a, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    new THREE.MeshPhysicalMaterial({ color: 0xf2efe6, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
  ];
  // je Spieler 32 Steine auf seinen Türmen
  const discs = [0, 1].flatMap((home) => Array.from({ length: 2 * PER_TOWER }, () => {
    const mesh = new THREE.Mesh(geometry, looks);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, home, cell: null, anim: [] };
  }));
  const meshes = discs.map((d) => d.mesh);

  // Hilfen: Punkte auf den möglichen Zügen, durchsichtiger Stein unter der Maus, roter Punkt auf dem letzten Stein
  const dotGeometry = new THREE.CircleGeometry(0.45, 24).rotateX(-Math.PI / 2);
  const dots = Array.from({ length: N * N }, (_, k) => {
    const m = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: 0x0b2a14, transparent: true, opacity: 0.55, depthWrite: false }));
    m.position.copy(cellAt(k)).setY(THICK + 0.03);
    m.visible = false;
    group.add(m);
    return m;
  });
  const ghost = new THREE.Mesh(geometry, [0x18181a, 0xf2efe6].map((color) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false })));
  ghost.visible = false;
  group.add(ghost);
  const lastDot = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8342a, toneMapped: false }));
  lastDot.visible = false;
  group.add(lastDot);

  let shown = null;
  let starter = 0;
  let preferred = null; // mit der Hand abgestellter Stein – er kommt aufs Feld statt des obersten vom Turm
  let marks = { moves: [], hover: null, ghost: null, last: null, flip: null };
  const cells = Array(N * N).fill(null);

  const free = (home) => discs.filter((d) => d.home === home && d.cell === null);
  const colorOfHome = (home) => (home === starter ? 0 : 1);

  // --- Bewegungen: Bogen (arc) oder Warten (wait) ---
  function travel(d, to, quat, { dur = 0.45, height = 5, delay = 0, sound = 0 } = {}) {
    const last = d.anim.at(-1);
    const from = last?.to ?? d.mesh.position.clone();
    const q0 = last?.quat ?? d.mesh.quaternion.clone();
    if (delay) d.anim.push({ type: 'wait', t: 0, dur: delay, to: from, quat: q0 });
    d.anim.push({ type: 'arc', t: 0, dur, from, to: to.clone(), q0, quat: quat.clone(), height, sound });
  }

  function setNow(d, pos, quat) {
    d.anim = [];
    d.mesh.position.copy(pos);
    d.mesh.quaternion.copy(quat);
  }

  // Umdrehen: anheben, um eine waagrechte Achse quer zur Richtung vom gesetzten Stein drehen, landen
  function turnOver(d, k, color, from, delay) {
    const at = cellAt(k);
    const dir = from === null || from === k ? new THREE.Vector3(1, 0, 0) : at.clone().sub(cellAt(from)).setY(0).normalize();
    const axis = new THREE.Vector3(-dir.z, 0, dir.x);
    const q0 = d.anim.at(-1)?.quat ?? d.mesh.quaternion.clone();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI).multiply(q0);
    // Rundungsfehler: die Seite oben muss genau stimmen – sonst eben direkt in die Ziel-Lage
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat).y > 0;
    travel(d, at, (color === 0) === up ? quat : upOf(color), { dur: 0.38, height: 2.4, delay, sound: 0.35 });
  }

  // Türme neu ordnen: freie Steine liegen lückenlos aufeinander, die eigene Farbe oben
  function restack(home, animate) {
    const up = upOf(colorOfHome(home));
    free(home).forEach((d, slot) => {
      const at = towerAt(home, slot);
      const last = d.anim.at(-1);
      const goal = last?.to ?? d.mesh.position;
      const q = last?.quat ?? d.mesh.quaternion;
      if (goal.distanceTo(at) < 0.01 && q.angleTo(up) < 0.01) return;
      if (animate) travel(d, at, up, { dur: 0.35, height: 2, delay: d.anim.length ? 0 : 0.05 });
      else setNow(d, at, up);
    });
  }

  function update(dt) {
    for (const d of discs) {
      let left = dt;
      while (left > 0 && d.anim.length) {
        const a = d.anim[0];
        const use = Math.min(left, (1 - a.t) * a.dur);
        a.t += use / a.dur;
        left -= use;
        if (a.type === 'arc') {
          const k = a.t * a.t * (3 - 2 * a.t);
          d.mesh.position.lerpVectors(a.from, a.to, k);
          d.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
          d.mesh.quaternion.slerpQuaternions(a.q0, a.quat, k);
        }
        if (a.t < 1 - 1e-9) break;
        d.anim.shift();
        if (a.sound) playHit('wood', a.sound);
      }
    }
    const show = !busy();
    dots.forEach((m, k) => (m.visible = show && marks.moves.includes(k)));
    ghost.visible = show && marks.hover !== null && marks.ghost !== null && cells[marks.hover] === null;
    if (ghost.visible) {
      ghost.position.copy(cellAt(marks.hover)).setY(THICK + T / 2 + 0.4);
      ghost.quaternion.copy(upOf(marks.ghost));
    }
    lastDot.visible = show && marks.last !== null && !!cells[marks.last];
    if (lastDot.visible) lastDot.position.copy(cellAt(marks.last)).setY(THICK + T + 0.02);
  }

  const busy = () => discs.some((d) => d.anim.length);

  // Stand zeigen. animate: Änderung abspielen, sonst direkt hinstellen.
  function show(st, animate) {
    if (st.starter !== starter) starter = st.starter;
    const fresh = st.events?.[0]?.type === 'start';
    // Steine, die nicht mehr auf dem Brett liegen, kommen weg
    for (let k = 0; k < N * N; k++) {
      const d = cells[k];
      if (!d || st.board[k] !== null) continue;
      cells[k] = null;
      d.cell = null;
    }
    // neuer Stein (gesetzt) zuerst – die umgedrehten folgen, wenn er liegt
    const placed = [];
    for (let k = 0; k < N * N; k++) {
      const color = st.board[k];
      if (color === null || cells[k]) continue;
      const home = color === 0 ? st.starter : 1 - st.starter; // wessen Farbe das ist (Schwarz = wer anfängt)
      const pool = free(home).length ? free(home) : free(1 - home);
      const d = (preferred && pool.includes(preferred) ? preferred : null) ?? pool.at(-1);
      if (!d) continue;
      preferred = preferred === d ? null : preferred;
      cells[k] = d;
      d.cell = k;
      placed.push(k);
      if (animate) travel(d, cellAt(k), upOf(color), { dur: 0.5, height: fresh ? 4 : 6, sound: 0.5, delay: fresh ? 0.25 + placed.length * 0.08 : 0 });
      else setNow(d, cellAt(k), upOf(color));
    }
    const from = placed.length === 1 ? placed[0] : (st.open?.at ?? st.last ?? null); // von hier aus drehen sich die Steine
    for (let k = 0; k < N * N; k++) {
      const d = cells[k];
      const color = st.board[k];
      if (!d || placed.includes(k)) continue;
      const q = d.anim.at(-1)?.quat ?? d.mesh.quaternion;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y > 0;
      if ((color === 0) === up) continue;
      if (!animate) {
        setNow(d, cellAt(k), upOf(color));
        continue;
      }
      const far = from === null ? 0 : Math.max(Math.abs((k % N) - (from % N)), Math.abs(Math.floor(k / N) - Math.floor(from / N)));
      turnOver(d, k, color, from, (placed.length ? 0.5 : 0) + Math.max(0, far - 1) * 0.09);
    }
    preferred = null;
    restack(0, animate);
    restack(1, animate);
  }

  function reset() {
    shown = null;
    starter = 0;
    marks = { moves: [], hover: null, ghost: null, last: null, flip: null };
    setGlow('hover', []);
    plates.set([]);
    ghost.visible = false;
    cells.fill(null);
    for (const d of discs) d.cell = null;
    restack(0, false);
    restack(1, false);
  }

  reset();

  // Strahl → Feld (Steine auf dem Brett zuerst, sonst die Brettebene), null = daneben
  function pick(raycaster) {
    const onBoard = discs.filter((d) => d.cell !== null).map((d) => d.mesh);
    const hit = raycaster.intersectObjects(onBoard, false)[0];
    if (hit) return discs.find((d) => d.mesh === hit.object).cell;
    group.updateWorldMatrix(true, false);
    const ray = raycaster.ray.clone().applyMatrix4(group.matrixWorld.clone().invert());
    const at = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -THICK), new THREE.Vector3());
    return at ? squareOf(at) : null;
  }

  return {
    group,
    loose: () => meshes, // Steine fliegen beim Umwerfen einzeln (tisch.js)
    // Rahmen in Holz, Marmor oder Gold – folgt dem Schachfiguren-Design dieses PCs (settings.js)
    setDesign(s) {
      const look = FRAMES[s.chessSet] ?? FRAMES.holz;
      frame.color.setHex(look.color);
      frame.map = look.wood ? wood : null;
      Object.assign(frame, { roughness: look.roughness, metalness: look.metalness, envMapIntensity: look.metalness ? 6 : 1 });
      frame.needsUpdate = true;
    },
    update,
    busy,
    reset,
    // Namensschilder vor dem Brett: labels[spieler] = Text, turn = wer dran ist (oder null), viewer = wer zuschaut
    names: (labels, turn, viewer) => plates.set(labels, { at: (p) => across(p, 0, BOARD / 2 + 4), view: viewer ? Math.PI : 0, turn }),
    // s = Spielstand; eine neue Aktion (oder die Revanche) wird abgespielt, sonst alles direkt hingestellt
    sync(s) {
      if (!s || s === shown) return;
      show(s, !!shown && (s.seq === shown.seq + 1 || s.events?.[0]?.type === 'start'));
      shown = s;
    },
    // moves = Felder mit möglichem Zug (Punkte), hover = Feld unter der Maus, ghost = Farbe des durchsichtigen Steins
    // (null = keiner), last = zuletzt gesetzter Stein (roter Punkt), flip = Stein, der beim Klick umgedreht würde (Umriss)
    setMarks(next) {
      marks = { moves: [], hover: null, ghost: null, last: null, flip: null, ...next };
      setGlow('hover', marks.flip !== null && cells[marks.flip] ? [cells[marks.flip].mesh] : []);
    },
    pick,
    // Wo ein Stein mit der Hand abgestellt wurde (tisch.js): Punkt (Welt) → Feld oder null (neben dem Spielfeld)
    squareAt(world) {
      return squareOf(group.worldToLocal(world.clone()));
    },
    // Stein zu einem Mesh: { cell } (null = liegt auf dem Turm) oder null
    stoneOf(mesh) {
      const d = discs.find((x) => x.mesh === mesh);
      return d ? { cell: d.cell } : null;
    },
    // dieser Stein soll beim nächsten Setzen aufs Feld
    prefer(mesh) {
      preferred = discs.find((x) => x.mesh === mesh) ?? null;
    },
  };
}

// Brettpunkt (lokal) → Feld oder null
function squareOf(at) {
  const c = Math.floor(at.x / S + N / 2);
  const r = Math.floor(at.z / S + N / 2);
  return c >= 0 && c < N && r >= 0 && r < N ? r * N + c : null;
}

// Brett: Holzkörper, darauf das grüne Feld als eigene, ganz leicht erhabene Platte
function buildBoard(group, material) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(BOARD, THICK - 0.05, BOARD), material);
  body.position.y = (THICK - 0.05) / 2;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.85 }));
  felt.position.y = THICK;
  felt.receiveShadow = true;
  group.add(felt);
}

// Spielfeld: Grün mit dunklen Linien, vier Punkte an den Ecken der Mitte, Beschriftung a–h und 1–8 an allen Rändern
function fieldTexture() {
  const PX = 2048;
  const k = PX / FIELD;
  const m = ((FIELD - GRID) / 2) * k;
  return canvasTexture(PX, PX, (g) => {
    const bg = g.createRadialGradient(PX / 2, PX / 2, PX * 0.1, PX / 2, PX / 2, PX * 0.75);
    bg.addColorStop(0, '#1f7a43');
    bg.addColorStop(1, '#155a30');
    g.fillStyle = bg;
    g.fillRect(0, 0, PX, PX);
    // feine Filz-Struktur
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${0.025 + Math.random() * 0.03})`;
      g.fillRect(Math.random() * PX, Math.random() * PX, 2, 2);
    }
    g.strokeStyle = '#0a2613';
    g.lineWidth = 0.09 * k;
    for (let i = 0; i <= N; i++) {
      const p = m + i * S * k;
      g.beginPath();
      g.moveTo(p, m);
      g.lineTo(p, PX - m);
      g.moveTo(m, p);
      g.lineTo(PX - m, p);
      g.stroke();
    }
    g.fillStyle = '#0a2613';
    for (const [x, y] of [[2, 2], [6, 2], [2, 6], [6, 6]]) {
      g.beginPath();
      g.arc(m + x * S * k, m + y * S * k, 0.2 * k, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(235, 225, 190, 0.85)';
    g.font = `bold ${0.95 * k}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Host-Seite (unten, links) aufrecht, Gast-Seite (oben, rechts) gedreht – jeder liest den Rand vor sich
    const label = (text, x, y, turned) => {
      g.save();
      g.translate(x, y);
      if (turned) g.rotate(Math.PI);
      g.fillText(text, 0, 0);
      g.restore();
    };
    for (let i = 0; i < N; i++) {
      const p = m + (i + 0.5) * S * k;
      label('abcdefgh'[i], p, m / 2, true);
      label('abcdefgh'[i], p, PX - m / 2, false);
      label(String(i + 1), m / 2, p, false);
      label(String(i + 1), PX - m / 2, p, true);
    }
  });
}
