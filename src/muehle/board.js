// Mühle-Tisch: Holzbrett mit eingebrannten Linien und 18 Steinen. Kennt keine Regeln: zeigt einen Spielstand
// (game.js) – jeder Stein hat einen Platz (Punkt auf dem Brett, Hand vor dem Spieler oder geschlagen neben dem Brett).
// Ändert sich der Stand, hüpfen nur die Steine, deren Platz nicht mehr stimmt, auf den nächsten freien Platz –
// so spielt sich Setzen, Ziehen, Schlagen und auch das Zurücknehmen nach „Geschummelt!“ von selbst ab.
// Maße in Zentimetern (Gruppe 1/100 skaliert). Spieler 0 (Host) sitzt bei +z, Spieler 1 gegenüber.
import * as THREE from 'three';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, across } from '../plates.js';
import { STONES, POINTS } from './game.js';

export const BOARD = 32;
const THICK = 1.8;
const UNIT = 4.6; // Abstand der Ringe – außen 3 × UNIT von der Mitte
const R = 1.7; // Steinradius
const H = 0.8; // Steinhöhe
const SLOT = 3.6; // Abstand der Steine in der Hand
const SNAP = 2.3; // so nah an einem Punkt zählt ein Klick oder ein abgestellter Stein für diesen Punkt

// Punkt r * 8 + k (game.js) → Lage auf dem Brett (x nach rechts, z zum Host)
const CORNER = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
export const POINT_XZ = Array.from({ length: POINTS }, (_, i) => {
  const h = (3 - Math.floor(i / 8)) * UNIT;
  const [x, z] = CORNER[i % 8];
  return [x * h, z * h];
});

// Stein als Drehkörper: flache Scheibe mit gerundeter Kante und Mulde oben
function stoneGeometry() {
  const pts = [[0, 0], [R - 0.15, 0], [R, 0.12], [R, H - 0.18], [R - 0.12, H - 0.02], [R - 0.4, H], [R - 0.55, H - 0.06],
    [0.9, H - 0.12], [0, H - 0.14]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40);
}

// Wo ein Stein liegt (Weltmaß cm im Brett): Punkt, Hand-Platz i oder Geschlagen-Platz i von Spieler p
function spotOf(p, loc) {
  if (loc.kind === 'pt') return new THREE.Vector3(POINT_XZ[loc.k][0], THICK, POINT_XZ[loc.k][1]);
  const side = p === 0 ? 1 : -1;
  if (loc.kind === 'hand') return new THREE.Vector3(side * (-14.4 + loc.i * SLOT), 0, side * (BOARD / 2 + 2.8));
  // geschlagen: liegt beim anderen rechts neben dem Brett
  return new THREE.Vector3(-side * (BOARD / 2 + 2.9), 0, -side * (14.4 - loc.i * SLOT));
}

const SETS = { // wie die Schachfiguren (Einstellung „Figuren“)
  holz: [{ color: 0xe8cd9b, roughness: 0.42, metalness: 0, clearcoat: 0.5, envMapIntensity: 1 }, { color: 0x2a1a12, roughness: 0.36, metalness: 0, clearcoat: 0.75, envMapIntensity: 1 }],
  marmor: [{ color: 0xf1eee6, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 }, { color: 0x202127, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 }],
  metall: [{ color: 0xd8d9de, roughness: 0.28, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 }, { color: 0xc59a3c, roughness: 0.3, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 }],
};

export function createMuehleBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const body = buildBoard(group);
  const plates = createPlates(group, 2, { w: 14, h: 3.5 });

  const geometry = stoneGeometry();
  // je Spieler 9 Steine, jeder mit eigenem Material (Aufleuchten)
  const stones = [0, 1].flatMap((p) => Array.from({ length: STONES }, () => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ clearcoatRoughness: 0.25 }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return { p, mesh, loc: { kind: 'hand', i: 0 }, anim: null };
  }));
  const meshes = stones.map((st) => st.mesh);

  // Ringe auf den Punkten: Ziele (gold), schlagbare Steine (rot), Maus darüber (weiß)
  const ringGeometry = new THREE.RingGeometry(R * 0.95, R * 1.25, 40).rotateX(-Math.PI / 2);
  const rings = POINT_XZ.map(([x, z]) => {
    const m = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    m.position.set(x, THICK + 0.04, z);
    m.visible = false;
    group.add(m);
    return m;
  });

  let shown = null;
  let look = SETS.holz;
  let white = 0;
  let marks = { targets: [], takes: [], selected: null, hover: null };
  let clock = 0;
  let preferred = null; // mit der Hand gesetzter Stein aus der Hand: genau er soll aufs Brett (prefer)

  function dress() {
    stones.forEach((st) => {
      const { color, ...rest } = look[st.p === white ? 0 : 1];
      st.mesh.material.color.setHex(color);
      Object.assign(st.mesh.material, rest);
      st.mesh.material.needsUpdate = true;
    });
  }

  // Ziel-Plätze je Spieler aus dem Stand: Punkte, Hand 0..h-1, Geschlagen 0..g-1
  function wanted(s, p) {
    const pts = s.board.flatMap((x, k) => (x === p ? [k] : []));
    const off = STONES - pts.length - s.hand[p];
    return { pts, hand: s.hand[p], off };
  }

  // Steine auf ihre Plätze bringen: was passt, bleibt liegen; der Rest hüpft zum nächstgelegenen freien Platz
  function arrange(s, animate) {
    for (const p of [0, 1]) {
      const want = wanted(s, p);
      const mine = stones.filter((st) => st.p === p);
      const free = [];
      const open = new Set(want.pts);
      const keep = { hand: [], off: [] };
      for (const st of mine) {
        if (st.loc.kind === 'pt' && open.has(st.loc.k)) open.delete(st.loc.k);
        else if (st.loc.kind !== 'pt') keep[st.loc.kind].push(st);
        else free.push(st);
      }
      const slots = [];
      for (const kind of ['hand', 'off']) {
        // zu viele hier: zuerst der mit der Hand gesetzte Stein, dann die hinteren gehen – die übrigen bleiben auf
        // ihrem Platz (Lücken bleiben, nichts rutscht nach)
        const list = keep[kind].sort((a, b) => (b.mesh === preferred) - (a.mesh === preferred) || b.loc.i - a.loc.i);
        while (list.length > want[kind]) free.push(list.shift());
        list.forEach((st) => setLoc(st, st.loc, animate));
        const used = new Set(list.map((st) => st.loc.i));
        for (let i = 0; slots.filter((x) => x.kind === kind).length < want[kind] - list.length; i++) if (!used.has(i)) slots.push({ kind, i });
      }
      for (const k of open) slots.push({ kind: 'pt', k });
      // nächstgelegene Paare zuerst
      const pairs = [];
      free.forEach((st, a) => slots.forEach((loc, b) => pairs.push([st.mesh.position.distanceTo(spotOf(p, loc)), a, b])));
      pairs.sort((x, y) => x[0] - y[0]);
      const usedA = new Set();
      const usedB = new Set();
      for (const [, a, b] of pairs) {
        if (usedA.has(a) || usedB.has(b)) continue;
        usedA.add(a);
        usedB.add(b);
        setLoc(free[a], slots[b], animate);
      }
    }
  }

  function setLoc(st, loc, animate) {
    const to = spotOf(st.p, loc);
    st.loc = loc;
    if (!animate) {
      st.anim = null;
      st.mesh.position.copy(to);
      return;
    }
    if (st.mesh.position.distanceTo(to) < 0.01 && !st.anim) return;
    const from = st.mesh.position.clone();
    const dist = from.distanceTo(to);
    const off = loc.kind === 'off';
    st.anim = { from, to, t: 0, dur: Math.min(0.75, 0.28 + dist * 0.012), height: off ? 7 : Math.min(4, 1 + dist * 0.12) };
  }

  function update(dt) {
    clock += dt;
    for (const st of stones) {
      const a = st.anim;
      if (!a) continue;
      a.t = Math.min(1, a.t + dt / a.dur);
      const k = a.t * a.t * (3 - 2 * a.t);
      st.mesh.position.lerpVectors(a.from, a.to, k);
      st.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
      if (a.t >= 1) {
        st.anim = null;
        playHit('wood', 0.5);
      }
    }
    const glow = 0.55 + 0.3 * Math.sin(clock * 5);
    rings.forEach((r, k) => {
      const take = marks.takes.includes(k);
      const target = marks.targets.includes(k);
      r.visible = !busy() && (take || target || marks.hover === k);
      r.material.color.setHex(take ? 0xff6a50 : target ? 0xffd27a : 0xffffff);
      r.material.opacity = marks.hover === k ? 1 : glow;
    });
  }

  const busy = () => stones.some((st) => st.anim);
  const stoneAt = (k) => stones.find((st) => st.loc.kind === 'pt' && st.loc.k === k);

  function pointNear(local) {
    let best = null;
    let dist = SNAP;
    POINT_XZ.forEach(([x, z], k) => {
      const d = Math.hypot(local.x - x, local.z - z);
      if (d < dist) [best, dist] = [k, d];
    });
    return best;
  }

  function reset() {
    shown = null;
    white = 0;
    marks = { targets: [], takes: [], selected: null, hover: null };
    setGlow('hover', []);
    setGlow('selected', []);
    plates.set([]);
    stones.forEach((st, n) => setLoc(st, { kind: 'hand', i: n % STONES }, false));
    dress();
  }

  reset();

  return {
    group,
    loose: () => meshes, // Steine fliegen beim Umwerfen einzeln (tisch.js)
    update,
    busy,
    reset,
    // Design dieses PCs: Steine wie das Figuren-Set beim Schach (settings.js)
    setDesign(s) {
      look = SETS[s.chessSet] ?? SETS.holz;
      dress();
    },
    // Namensschilder hinter den Steinen in der Hand: labels[spieler] = Text, turn = wer dran ist (oder null), viewer = wer zuschaut
    names: (labels, turn, viewer) => plates.set(labels, { at: (p) => across(p, 0, BOARD / 2 + 7), view: viewer ? Math.PI : 0, turn }),
    // s = Spielstand (game.js) – Änderungen werden abgespielt, ein ganz neuer Stand direkt hingestellt
    sync(s) {
      if (!s || s === shown) return;
      const fresh = !shown || s.events?.[0]?.type === 'start';
      if (s.white !== white) {
        white = s.white;
        dress();
      }
      if (fresh && shown) stones.forEach((st, n) => (st.loc = { kind: 'hand', i: n % STONES })); // neue Partie: alle zurück in die Hand
      arrange(s, !!shown);
      preferred = null;
      shown = s;
    },
    prefer(mesh) {
      preferred = mesh;
    },
    // targets = Punkte (gold), takes = schlagbare Punkte (rot), selected = gewählter Stein (Punkt), hover = Punkt unter der Maus
    setMarks(next) {
      marks = { targets: [], takes: [], selected: null, hover: null, ...next };
      const sel = marks.selected === null ? null : stoneAt(marks.selected);
      setGlow('selected', sel ? [sel.mesh] : []);
      const over = marks.hover === null ? null : stoneAt(marks.hover);
      setGlow('hover', over && over !== sel ? [over.mesh] : []);
    },
    // Punkt unter der Maus (Stein auf dem Brett oder Brettoberseite in Punktnähe), sonst null
    pickPoint(raycaster) {
      const onBoard = stones.filter((st) => st.loc.kind === 'pt');
      const hit = raycaster.intersectObjects([...onBoard.map((st) => st.mesh), body], false)[0];
      if (!hit) return null;
      if (hit.object !== body) return onBoard.find((st) => st.mesh === hit.object).loc.k;
      const at = group.worldToLocal(hit.point.clone());
      return Math.abs(at.y - THICK) < 0.1 ? pointNear(at) : null;
    },
    // Wo ein Stein mit der Hand abgestellt wurde (tisch.js): Punkt (Welt) → { point oder null, onBoard }
    pointAt(world) {
      const at = group.worldToLocal(world.clone());
      return { point: pointNear(at), onBoard: Math.abs(at.x) <= BOARD / 2 && Math.abs(at.z) <= BOARD / 2 };
    },
    // Stein zu einem Mesh: { player, kind: 'pt' | 'hand' | 'off', point } oder null
    stoneOf(mesh) {
      const st = stones.find((x) => x.mesh === mesh);
      return st ? { player: st.p, kind: st.loc.kind, point: st.loc.kind === 'pt' ? st.loc.k : null } : null;
    },
  };
}

function buildBoard(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#7a4824', boards: 3 }), roughness: 0.5 });
  const top = new THREE.MeshPhysicalMaterial({ map: boardTexture(), roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(BOARD, THICK, BOARD), [wood, wood, top, wood, wood, wood]);
  body.position.y = THICK / 2;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return body;
}

// Brettoberseite: helles Holz mit Maserung, drei eingebrannte Quadrate, Querlinien, Punkte als Mulden
function boardTexture() {
  const PX = 2048;
  const S = PX / BOARD;
  const at = ([x, z]) => [(x + BOARD / 2) * S, (z + BOARD / 2) * S];
  return canvasTexture(PX, PX, (g) => {
    const bg = g.createLinearGradient(0, 0, PX, PX);
    bg.addColorStop(0, '#dcb57e');
    bg.addColorStop(1, '#c99a5e');
    g.fillStyle = bg;
    g.fillRect(0, 0, PX, PX);
    // Maserung: feine, leicht gewellte Linien
    for (let i = 0; i < 260; i++) {
      const y = Math.random() * PX;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '110,65,25' : '245,215,170'},${0.05 + Math.random() * 0.08})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= PX; x += 64) g.lineTo(x, y + Math.sin(x / 300 + i) * 6);
      g.stroke();
    }
    // Rahmen
    g.strokeStyle = 'rgba(60,30,10,0.7)';
    g.lineWidth = 0.12 * S;
    g.strokeRect(1 * S, 1 * S, PX - 2 * S, PX - 2 * S);
    // Linien
    g.strokeStyle = '#3a2210';
    g.lineWidth = 0.32 * S;
    g.lineCap = 'square';
    for (let r = 0; r < 3; r++) {
      g.beginPath();
      for (let k = 0; k <= 8; k++) g[k ? 'lineTo' : 'moveTo'](...at(POINT_XZ[r * 8 + (k % 8)]));
      g.closePath();
      g.stroke();
    }
    for (const k of [1, 3, 5, 7]) {
      g.beginPath();
      g.moveTo(...at(POINT_XZ[k]));
      g.lineTo(...at(POINT_XZ[16 + k]));
      g.stroke();
    }
    // Punkte: dunkle Mulde mit hellem Rand
    for (const p of POINT_XZ) {
      const [x, y] = at(p);
      g.fillStyle = '#2a170a';
      g.beginPath();
      g.arc(x, y, 0.62 * S, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(250,225,180,0.45)';
      g.lineWidth = 0.08 * S;
      g.beginPath();
      g.arc(x, y, 0.7 * S, 0, Math.PI * 2);
      g.stroke();
    }
  });
}
