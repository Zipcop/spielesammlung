// Dame-Tisch: Holzbrett 8 × 8 mit 24 Steinen je Farbe. Kennt keine Regeln: zeigt ein Brett (game.js) – jeder Stein hat
// einen Platz: auf einem Feld (unten, oder oben auf einer Dame = Doppelstein), geschlagen neben dem Brett oder im Vorrat
// (Turm neben dem Brett, daraus werden Damen gekrönt). Ändert sich das Brett, hüpfen nur die Steine, deren Platz nicht
// mehr stimmt, auf den nächsten freien Platz – so spielen sich Ziehen, Schlagen, Krönen und das Zurücknehmen nach
// „Geschummelt!“ von selbst ab. Maße in Zentimetern (Gruppe 1/100 skaliert). Spieler 0 (Host) sitzt bei +z.
import * as THREE from 'three';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { PIECES } from './game.js';

const SQ = 4; // Feldgröße
const RIM = 2; // Rahmen
export const BOARD = 8 * SQ + 2 * RIM;
const HALF = BOARD / 2;
const THICK = 1.8;
const R = 1.6; // Steinradius
const H = 0.72; // Steinhöhe
const STONES = 2 * PIECES; // je Farbe: 12 im Spiel + 12 zum Krönen

// Feld k (game.js) → Mitte auf dem Brett (x nach rechts, z zum Host)
export const squareXZ = (k) => [((k & 7) - 3.5) * SQ, ((k >> 3) - 3.5) * SQ];

// Damestein als Drehkörper: flache Scheibe mit Rillen am Rand und leichter Mulde oben
function stoneGeometry() {
  const pts = [[0, 0], [R - 0.12, 0], [R, 0.1], [R, 0.22], [R - 0.08, 0.28], [R, 0.34], [R, 0.44], [R - 0.08, 0.5], [R, 0.56],
    [R, H - 0.1], [R - 0.12, H], [R - 0.35, H], [R - 0.45, H - 0.05], [0.5, H - 0.08], [0, H - 0.08]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40);
}

// Wo ein Stein liegt: Feld k (Ebene lvl 0/1), geschlagen Platz i (liegt beim Schlagenden rechts) oder Vorrat i (Turm)
function spotOf(p, loc) {
  if (loc.kind === 'sq') {
    const [x, z] = squareXZ(loc.k);
    return new THREE.Vector3(x, THICK + loc.lvl * H, z);
  }
  if (loc.kind === 'off') {
    const side = p === 1 ? 1 : -1; // Steine von Spieler 1 nimmt Spieler 0 → liegen rechts von ihm (+x, vorn)
    return new THREE.Vector3(side * (HALF + 2.4 + (loc.i % 2) * 3.5), 0, side * (13 - Math.floor(loc.i / 2) * 3.5));
  }
  const side = p === 0 ? 1 : -1; // Vorrat: links vom Besitzer, vorn
  return new THREE.Vector3(-side * (HALF + 3.2), loc.i * H, side * 12.5);
}
const keyOf = (loc) => (loc.kind === 'sq' ? `sq${loc.k}.${loc.lvl}` : `${loc.kind}${loc.i}`);

const SETS = { // wie die Schachfiguren (Einstellung „Figuren“)
  holz: [{ color: 0xe8cd9b, roughness: 0.42, metalness: 0, clearcoat: 0.5, envMapIntensity: 1 }, { color: 0x2a1a12, roughness: 0.36, metalness: 0, clearcoat: 0.75, envMapIntensity: 1 }],
  marmor: [{ color: 0xf1eee6, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 }, { color: 0x202127, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 }],
  metall: [{ color: 0xd8d9de, roughness: 0.28, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 }, { color: 0xc59a3c, roughness: 0.3, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 }],
};

export function createDameBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const body = buildBoard(group);

  const geometry = stoneGeometry();
  const stones = [0, 1].flatMap((p) => Array.from({ length: STONES }, (_, i) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ clearcoatRoughness: 0.25 }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return { p, mesh, loc: { kind: 'spare', i }, anim: null };
  }));
  const meshes = stones.map((st) => st.mesh);

  // Ringe auf den Feldern: Ziele (gold), Pflicht-Schläger (gold), geschlagen (rot), Maus darüber (weiß)
  const ringGeometry = new THREE.RingGeometry(R * 1.02, R * 1.24, 40).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 64 }, (_, k) => {
    const m = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
    const [x, z] = squareXZ(k);
    m.position.set(x, THICK + 0.04, z);
    m.visible = false;
    group.add(m);
    return m;
  });

  let shown = null;
  let shownBoard = null;
  let look = SETS.holz;
  let white = 0;
  let marks = { targets: [], force: [], took: [], selected: null, hover: null };
  let clock = 0;

  function dress() {
    stones.forEach((st) => {
      const { color, ...rest } = look[st.p === white ? 0 : 1];
      st.mesh.material.color.setHex(color);
      Object.assign(st.mesh.material, rest);
      st.mesh.material.needsUpdate = true;
    });
  }

  // Plätze, die das Brett für Spieler p verlangt: Felder (Damen doppelt), Geschlagene, Rest im Vorrat
  function wanted(board, p) {
    const out = [];
    let pieces = 0;
    board.forEach((x, k) => {
      if (x === null || (x & 1) !== p) return;
      pieces++;
      out.push({ kind: 'sq', k, lvl: 0 });
      if (x >= 2) out.push({ kind: 'sq', k, lvl: 1 });
    });
    const off = PIECES - pieces;
    for (let i = 0; i < off; i++) out.push({ kind: 'off', i });
    for (let i = 0; out.length < STONES; i++) out.push({ kind: 'spare', i });
    return out;
  }

  // Steine auf ihre Plätze: was passt, bleibt liegen; der Rest hüpft zum nächstgelegenen freien Platz
  function arrange(board, animate) {
    for (const p of [0, 1]) {
      const want = new Map(wanted(board, p).map((loc) => [keyOf(loc), loc]));
      const free = [];
      for (const st of stones) {
        if (st.p !== p) continue;
        const key = keyOf(st.loc);
        if (want.has(key)) {
          want.delete(key);
          setLoc(st, st.loc, animate); // nach einer neuen Partie liegt der Stein evtl. noch woanders
        } else free.push(st);
      }
      const slots = [...want.values()];
      // Turm: die unteren Plätze zuerst füllen (sonst schwebt ein Stein)
      const pairs = [];
      free.forEach((st, a) => slots.forEach((loc, b) => pairs.push([st.mesh.position.distanceTo(spotOf(p, loc)) + (loc.kind === 'spare' ? loc.i * 0.01 : 0), a, b])));
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
    const off = loc.kind !== 'sq';
    st.anim = { from, to, t: 0, dur: Math.min(0.8, 0.3 + dist * 0.012), height: off ? 6 : Math.min(4, 1.2 + dist * 0.1) };
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
      const took = marks.took.includes(k);
      const gold = marks.targets.includes(k) || marks.force.includes(k);
      r.visible = !busy() && (took || gold || marks.hover === k);
      r.material.color.setHex(took ? 0xff6a50 : gold ? 0xffd27a : 0xffffff);
      r.material.opacity = marks.hover === k ? 1 : glow;
    });
  }

  const busy = () => stones.some((st) => st.anim);
  const stonesAt = (k) => stones.filter((st) => st.loc.kind === 'sq' && st.loc.k === k);

  function squareNear(local) {
    const c = Math.floor(local.x / SQ + 4);
    const r = Math.floor(local.z / SQ + 4);
    return c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : null;
  }

  function reset() {
    shown = null;
    shownBoard = null;
    white = 0;
    marks = { targets: [], force: [], took: [], selected: null, hover: null };
    setGlow('hover', []);
    setGlow('selected', []);
    stones.forEach((st, n) => setLoc(st, { kind: 'spare', i: n % STONES }, false));
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
    // s = Spielstand (game.js), board = gezeigtes Brett (Vorschau eines angefangenen Zugs, sonst s.board).
    // Änderungen werden abgespielt, ein ganz neuer Stand direkt hingestellt.
    sync(s, board = s?.board) {
      if (!s || (s === shown && board === shownBoard)) return;
      const fresh = !shown || (s !== shown && s.events?.[0]?.type === 'start');
      if (s.white !== white) {
        white = s.white;
        dress();
      }
      if (fresh && shown) stones.forEach((st, n) => (st.loc = { kind: 'spare', i: n % STONES })); // neue Partie: alles neu verteilen
      arrange(board, !!shown);
      shown = s;
      shownBoard = board;
    },
    // targets = Landefelder (gold), force = Steine mit Schlagzwang (gold), took = schon übersprungene Steine (rot),
    // selected = gewählter Stein (Feld), hover = Feld unter der Maus
    setMarks(next) {
      marks = { targets: [], force: [], took: [], selected: null, hover: null, ...next };
      const sel = marks.selected === null ? [] : stonesAt(marks.selected).map((st) => st.mesh);
      setGlow('selected', sel);
      const over = marks.hover === null || marks.hover === marks.selected ? [] : stonesAt(marks.hover).map((st) => st.mesh);
      setGlow('hover', over);
    },
    // Feld unter der Maus (Stein auf dem Brett oder Brettoberseite), sonst null
    pickSquare(raycaster) {
      const onBoard = stones.filter((st) => st.loc.kind === 'sq');
      const hit = raycaster.intersectObjects([...onBoard.map((st) => st.mesh), body], false)[0];
      if (!hit) return null;
      if (hit.object !== body) return onBoard.find((st) => st.mesh === hit.object).loc.k;
      const at = group.worldToLocal(hit.point.clone());
      return Math.abs(at.y - THICK) < 0.1 ? squareNear(at) : null;
    },
    // Wo ein Stein mit der Hand abgestellt wurde (tisch.js): Punkt (Welt) → { square oder null, onBoard }
    squareAt(world) {
      const at = group.worldToLocal(world.clone());
      const onBoard = Math.abs(at.x) <= HALF && Math.abs(at.z) <= HALF;
      return { square: onBoard ? squareNear(at) : null, onBoard };
    },
    // Stein zu einem Mesh: { player, kind: 'sq' | 'off' | 'spare', square } oder null
    stoneOf(mesh) {
      const st = stones.find((x) => x.mesh === mesh);
      return st ? { player: st.p, kind: st.loc.kind, square: st.loc.kind === 'sq' ? st.loc.k : null } : null;
    },
  };
}

function buildBoard(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#6a3c1c', boards: 3 }), roughness: 0.5 });
  const top = new THREE.MeshPhysicalMaterial({ map: boardTexture(), roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.4 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(BOARD, THICK, BOARD), [wood, wood, top, wood, wood, wood]);
  body.position.y = THICK / 2;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return body;
}

// Brettoberseite: Rahmen aus dunklem Holz, helle und dunkle Felder mit Maserung
function boardTexture() {
  const PX = 2048;
  const S = PX / BOARD;
  return canvasTexture(PX, PX, (g) => {
    g.fillStyle = '#5a3216';
    g.fillRect(0, 0, PX, PX);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isDark = (r + c) % 2 === 1;
        const x = (RIM + c * SQ) * S;
        const y = (RIM + r * SQ) * S;
        const grad = g.createLinearGradient(x, y, x + SQ * S, y + SQ * S);
        grad.addColorStop(0, isDark ? '#6b3b1d' : '#e6c897');
        grad.addColorStop(1, isDark ? '#55290f' : '#d7b47c');
        g.fillStyle = grad;
        g.fillRect(x, y, SQ * S, SQ * S);
      }
    }
    // Maserung über alles
    for (let i = 0; i < 320; i++) {
      const y = Math.random() * PX;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '70,35,10' : '250,225,180'},${0.04 + Math.random() * 0.06})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= PX; x += 64) g.lineTo(x, y + Math.sin(x / 280 + i) * 5);
      g.stroke();
    }
    // Einlegekante zwischen Rahmen und Feldern
    g.strokeStyle = '#e9cf9c';
    g.lineWidth = 0.18 * S;
    g.strokeRect(RIM * S, RIM * S, 8 * SQ * S, 8 * SQ * S);
    g.strokeStyle = 'rgba(30,15,5,0.6)';
    g.lineWidth = 0.08 * S;
    g.strokeRect((RIM - 0.5) * S, (RIM - 0.5) * S, (8 * SQ + 1) * S, (8 * SQ + 1) * S);
  });
}
