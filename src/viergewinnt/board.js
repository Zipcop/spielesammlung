// Vier-gewinnt-Tisch: aufrecht stehender Rahmen (zwei Lochplatten, Stege, Füße) in der Tischmitte, daneben je ein
// Stapel mit 21 Steinen (Rot rechts vom Host, Gelb rechts vom Gast). Kennt keine Regeln: zeigt einen Spielstand
// (game.js) und spielt die Änderung ab – der Stein fliegt vom Stapel über die Spalte und fällt mit Schwerkraft hinein
// (prallt kurz ab); erwischte Schummel-Steine fliegen oben heraus zurück auf den Stapel. Maße in Zentimetern (1/100).
import * as THREE from 'three';
import { woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { COLS, ROWS, STONES } from './game.js';

const P = 3.4; // Abstand der Löcher
const R = 1.5; // Steinradius
const T = 0.7; // Steindicke
const HOLE = 1.3;
const GAP = 1.0; // Spalt zwischen den Platten
const PT = 0.45; // Plattendicke
const GY = 3.6; // Unterkante der untersten Reihe
const W = COLS * P + 2; // Plattenbreite
const TOP = GY + ROWS * P + 0.6; // Oberkante der Platten
const DROP_Y = TOP + 3; // hier beginnt der Fall
const G = 981; // cm/s²
const BOUNCE = 0.28;
const COLOR_HEX = [0xc8231c, 0xf2c014];
// Stapel je Farbe: 3 Türmchen à 7 Steine, Rot vorn rechts (Host), Gelb hinten links (rechts vom Gast)
const PILE = [new THREE.Vector3(20, 0, 8), new THREE.Vector3(-20, 0, -8)];
const PER_STACK = 7;

const FRAMES = {
  holz: { color: 0xffffff, roughness: 0.5, metalness: 0, clearcoat: 0.35, wood: true },
  marmor: { color: 0xeeeae2, roughness: 0.18, metalness: 0, clearcoat: 1, wood: false },
  metall: { color: 0xc59a3c, roughness: 0.3, metalness: 1, clearcoat: 0.2, wood: false },
};

const cellAt = (c, r) => new THREE.Vector3((c - (COLS - 1) / 2) * P, GY + (r + 0.5) * P, 0);
const UPRIGHT = new THREE.Quaternion(); // Stein steht im Rahmen (Achse = z)
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2); // liegt auf dem Stapel
const pileAt = (color, slot) => {
  const k = Math.floor(slot / PER_STACK);
  const side = color === 0 ? 1 : -1;
  return PILE[color].clone().add(new THREE.Vector3(side * k * (2 * R + 0.5), (slot % PER_STACK + 0.5) * T, 0));
};

// Stein als Drehkörper: flache Scheibe mit gerundeter Kante und erhabenem Ring auf beiden Seiten (Achse = z)
function stoneGeometry() {
  const h = T / 2;
  const pts = [[0, -h + 0.05], [R * 0.6, -h + 0.05], [R * 0.64, -h], [R * 0.78, -h], [R * 0.84, -h + 0.07], [R - 0.12, -h + 0.07],
    [R, -h + 0.2], [R, h - 0.2], [R - 0.12, h - 0.07], [R * 0.84, h - 0.07], [R * 0.78, h], [R * 0.64, h], [R * 0.6, h - 0.05], [0, h - 0.05]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40).rotateX(Math.PI / 2);
}

// Lochplatte: Rechteck mit 42 runden Löchern, PT dick (Mitte bei z = 0)
function panelGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, GY - 0.6).lineTo(W / 2, GY - 0.6).lineTo(W / 2, TOP).lineTo(-W / 2, TOP).closePath();
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = cellAt(c, r);
      const hole = new THREE.Path();
      hole.absarc(p.x, p.y, HOLE, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  return new THREE.ExtrudeGeometry(shape, { depth: PT, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 20 }).translate(0, 0, -PT / 2);
}

export function createVierBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const frame = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: woodTexture({ base: '#8a5a32', boards: 2 }), roughness: 0.5, clearcoat: 0.35 });
  const wood = frame.map;
  buildFrame(group, frame);

  const geometry = stoneGeometry();
  const materials = COLOR_HEX.map((color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
  // Je Farbe 21 Steine; jeder mit eigenem Material-Klon fürs Leuchten der Viererreihe
  const stones = [0, 1].map((color) => Array.from({ length: STONES }, () => {
    const mesh = new THREE.Mesh(geometry, materials[color].clone());
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, color, cell: null, anim: [] };
  }));
  const all = stones.flat();

  // Durchsichtiger Stein über der Spalte unter der Maus
  const ghost = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.45, depthWrite: false }));
  ghost.visible = false;
  group.add(ghost);

  let shown = null;
  let preferred = null; // mit der Hand abgestellter Stein – er kommt in den Rahmen statt des obersten vom Stapel
  let line = []; // Steine der Viererreihe (leuchten)
  let clock = 0;
  const cells = Array.from({ length: COLS }, () => Array(ROWS).fill(null));

  const free = (color) => stones[color].filter((s) => !s.cell);

  // --- Bewegungen: Bogen (arc), Fall mit Schwerkraft (fall), Warten (wait) ---
  function travel(s, to, quat, { dur = 0.45, height = 6, delay = 0 } = {}) {
    const last = s.anim.at(-1);
    const from = last?.to ?? s.mesh.position.clone();
    const q0 = last?.quat ?? s.mesh.quaternion.clone();
    if (delay) s.anim.push({ type: 'wait', t: 0, dur: delay, to: from, quat: q0 });
    s.anim.push({ type: 'arc', t: 0, dur, from, to: to.clone(), q0, quat: quat.clone(), height });
  }

  function fall(s, to) {
    s.anim.push({ type: 'fall', to: to.clone(), quat: UPRIGHT, v: 0 });
  }

  function setNow(s, pos, quat) {
    s.anim = [];
    s.mesh.position.copy(pos);
    s.mesh.quaternion.copy(quat);
  }

  // Stapel neu ordnen: freie Steine liegen lückenlos aufeinander (rutscht einer aus der Mitte weg, fallen die oberen nach)
  function restack(color, animate) {
    free(color).forEach((s, slot) => {
      const at = pileAt(color, slot);
      const goal = s.anim.at(-1)?.to ?? s.mesh.position;
      if (goal.distanceTo(at) < 0.01) return;
      if (animate) travel(s, at, FLAT, { dur: 0.3, height: 1.5, delay: s.anim.length ? 0 : 0.05 });
      else setNow(s, at, FLAT);
    });
  }

  function update(dt) {
    clock += dt;
    for (const s of all) {
      let left = dt;
      while (left > 0 && s.anim.length) {
        const a = s.anim[0];
        if (a.type === 'fall') {
          a.v -= G * left;
          s.mesh.position.y += a.v * left;
          s.mesh.position.x = a.to.x;
          s.mesh.quaternion.copy(a.quat);
          left = 0;
          if (s.mesh.position.y <= a.to.y) {
            s.mesh.position.y = a.to.y;
            playHit('wood', Math.min(1, -a.v / 350));
            a.v = -a.v * BOUNCE;
            if (a.v < 25) s.anim.shift();
          }
          break;
        }
        const use = Math.min(left, (1 - a.t) * a.dur);
        a.t += use / a.dur;
        left -= use;
        if (a.type === 'arc') {
          const k = a.t * a.t * (3 - 2 * a.t);
          s.mesh.position.lerpVectors(a.from, a.to, k);
          s.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
          s.mesh.quaternion.slerpQuaternions(a.q0, a.quat, k);
        }
        if (a.t >= 1 - 1e-9) s.anim.shift();
        else break;
      }
    }
    // Viererreihe pulsiert
    const glow = 0.45 + 0.35 * Math.sin(clock * 5);
    for (const s of all) {
      const on = line.includes(s);
      s.mesh.material.emissive.setHex(on ? s.mesh.material.color.getHex() : 0x000000);
      s.mesh.material.emissiveIntensity = on ? glow : 0;
    }
  }

  const busy = () => all.some((s) => s.anim.length);

  // Stand zeigen. animate: Änderung abspielen (neuer Stein fällt, entfernte fliegen zurück), sonst direkt hinstellen.
  function show(st, animate) {
    const drop = animate ? st.events.find((e) => e.type === 'drop') : null;
    const start = animate && st.events.some((e) => e.type === 'start');
    let wait = 0;
    // Steine, die nicht mehr (oder in anderer Farbe) im Rahmen stehen, kommen heraus
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const s = cells[c][r];
        if (!s || st.board[c][r] === s.color) continue;
        cells[c][r] = null;
        s.cell = null;
        if (animate) {
          // nach oben aus der Spalte heraus, dann zum Stapel (bei der Revanche nacheinander)
          travel(s, new THREE.Vector3((s.anim.at(-1)?.to ?? s.mesh.position).x, DROP_Y, 0), UPRIGHT, { dur: 0.35, height: 0, delay: start ? wait : 0 });
          wait += 0.04;
        }
      }
    }
    // neue Steine
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < st.board[c].length; r++) {
        if (cells[c][r]) continue;
        const color = st.board[c][r];
        const pool = free(color);
        const s = (preferred && pool.includes(preferred) && preferred.color === color ? preferred : null) ?? pool.at(-1);
        if (!s) continue; // mehr Steine als im Kasten (kommt nicht vor)
        cells[c][r] = s;
        s.cell = [c, r];
        const at = cellAt(c, r);
        if (drop && drop.col === c && drop.row === r) {
          travel(s, new THREE.Vector3(at.x, DROP_Y, 0), UPRIGHT, { dur: 0.45, height: 4 });
          fall(s, at);
        } else setNow(s, at, UPRIGHT);
      }
    }
    preferred = null;
    restack(0, animate);
    restack(1, animate);
    line = st.result?.line ? st.result.line.map(([c, r]) => cells[c][r]).filter(Boolean) : [];
    setGlow('vier', line.map((s) => s.mesh)); // Umriss um die Viererreihe (graphics.js)
  }

  function reset() {
    shown = null;
    line = [];
    setGlow('vier', []);
    ghost.visible = false;
    for (const col of cells) col.fill(null);
    for (const s of all) s.cell = null;
    restack(0, false);
    restack(1, false);
  }

  reset();

  return {
    group,
    loose: () => all.map((s) => s.mesh), // Steine fliegen beim Umwerfen einzeln (tisch.js)
    // Rahmen in Holz, Marmor oder Gold – folgt dem Schachfiguren-Design dieses PCs (settings.js)
    setDesign(s) {
      const look = FRAMES[s.chessSet] ?? FRAMES.holz;
      frame.color.setHex(look.color);
      frame.map = look.wood ? wood : null;
      Object.assign(frame, { roughness: look.roughness, metalness: look.metalness, clearcoat: look.clearcoat, envMapIntensity: look.metalness ? 6 : 1 });
      frame.needsUpdate = true;
    },
    update,
    busy,
    reset,
    // s = Spielstand; genau eine neue Aktion (oder die Revanche) wird abgespielt, sonst alles direkt hingestellt
    sync(s) {
      if (!s || s === shown) return;
      show(s, !!shown && (s.seq === shown.seq + 1 || s.events[0]?.type === 'start')); // Revanche: Steine zurück auf die Stapel
      shown = s;
    },
    // Spalte unter der Maus (Strahl trifft die Ebene des Rahmens über oder in ihm), sonst null
    pickColumn(raycaster) {
      group.updateWorldMatrix(true, false);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld), 0);
      plane.constant = -plane.normal.dot(group.getWorldPosition(new THREE.Vector3()));
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!hit) return null;
      const at = group.worldToLocal(hit);
      const c = Math.round(at.x / P + (COLS - 1) / 2);
      return c >= 0 && c < COLS && Math.abs(at.x) <= (COLS * P) / 2 && at.y > GY - 1 && at.y < TOP + 9 ? c : null;
    },
    // Durchsichtiger Stein über Spalte col in Farbe color (col null = weg)
    setGhost(col, color) {
      ghost.visible = col !== null && col !== undefined;
      if (!ghost.visible) return;
      ghost.position.copy(cellAt(col, 0)).setY(DROP_Y);
      ghost.material.color.setHex(COLOR_HEX[color]);
    },
    // Stein zu einem Mesh: { color, inFrame } oder null
    stoneOf(mesh) {
      const s = all.find((x) => x.mesh === mesh);
      return s ? { color: s.color, inFrame: !!s.cell } : null;
    },
    // dieser Stein soll beim nächsten Zug seiner Farbe in den Rahmen
    prefer(mesh) {
      preferred = all.find((x) => x.mesh === mesh) ?? null;
    },
  };
}

// Rahmen: zwei Lochplatten, Stege zwischen den Spalten, Boden im Spalt, zwei Seitenstützen mit Füßen
function buildFrame(group, material) {
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const panel = panelGeometry();
  for (const z of [-1, 1]) add(panel, 0, 0, z * (GAP / 2 + PT / 2));
  const inner = ROWS * P;
  for (let k = 1; k < COLS; k++) add(new THREE.BoxGeometry(0.3, inner, GAP), (k - COLS / 2) * P, GY + inner / 2, 0);
  add(new THREE.BoxGeometry(W, 0.6, GAP), 0, GY - 0.3, 0);
  const span = GAP + 2 * PT;
  for (const x of [-1, 1]) {
    add(new THREE.BoxGeometry(1.2, TOP, span + 0.4), x * (W / 2 + 0.6), TOP / 2, 0);
    add(new THREE.BoxGeometry(2.2, 0.9, 11), x * (W / 2 + 0.6), 0.45, 0);
  }
}
