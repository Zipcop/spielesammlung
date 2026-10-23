// Kalaha-Tisch: Holzbrett mit 12 runden Mulden in zwei Reihen und an jedem Ende einem langen Kalaha, dazu 72 bunte
// Glaskugeln (je nach Steinzahl liegen 36–72 auf dem Brett, der Rest ist weggeräumt). Die Kugeln häufen sich in den
// Mulden wie echte: Jede neue rollt in die tiefste freie Mulde des Haufens (berechnet, auf beiden PCs gleich).
// Kennt keine Regeln: zeigt einen Spielstand (game.js) und spielt seine Ereignisse ab – Mulde leeren (die Kugeln heben
// sich in die Hand), Kugel für Kugel säen (Klack), fangen, umlegen, am Ende die Reste ins Kalaha. Passt danach etwas
// nicht zum Stand (Revanche, „Erwischt!“), fliegen die Kugeln dorthin, wo sie hingehören.
// Maße in Zentimetern (Gruppe 1/100 skaliert). Spieler 0 (Host) sitzt bei +z, seine Mulden liegen vorn, sein Kalaha
// rechts (+x); Spieler 1 gegenüber.
import * as THREE from 'three';
import { canvasTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, across } from '../plates.js';
import { isStore } from './game.js';

const STONES = 72;
const R = 0.78; // Kugelradius
const THICK = 3.4;
const PIT_R = 2.65;
const PIT_D = 2.1;
const GAP = 6.3; // Abstand der Mulden
const ROW_Z = 4.3;
const STORE_X = 23.4;
const STORE_A = 2.9; // Kalaha: halbe Breite (x) …
const STORE_B = 7.0; // … halbe Länge (z)
const STORE_D = 2.4;
const BOARD_L = 2 * (STORE_X + STORE_A + 1.7);
const BOARD_W = 2 * (ROW_Z + PIT_R + 1.6);
const HAND_Y = 4.5; // so hoch schweben Kugeln in der Hand über der Mulde …
const HAND_Z = 4; // … etwas zum Spieler hin
const SOW_S = 0.24; // Abstand zwischen zwei gesäten Kugeln
const HAND = 14; // „Mulde“ der Hand

const COLORS = [0x2f6fd6, 0x23a35a, 0xd63a2f, 0xe0a321, 0x8a46c9, 0x1fb3b0, 0xe06a9a, 0xf2efe6];

const FRAMES = { // Holz wie die Schachfiguren dieses PCs (Einstellung „Figuren“)
  holz: { color: 0xffffff, roughness: 0.5, metalness: 0, wood: true },
  marmor: { color: 0xeeeae2, roughness: 0.18, metalness: 0, wood: false },
  metall: { color: 0xc59a3c, roughness: 0.3, metalness: 1, wood: false },
};

// Mitte einer Mulde auf der Brettoberfläche (lokal, cm)
export function centerOf(i) {
  if (i === 6) return new THREE.Vector3(STORE_X, THICK, 0);
  if (i === 13) return new THREE.Vector3(-STORE_X, THICK, 0);
  const k = i < 6 ? i : 12 - i;
  return new THREE.Vector3((k - 2.5) * GAP, THICK, i < 6 ? ROW_Z : -ROW_Z);
}
const shapeOf = (i) => (isStore(i) ? { a: STORE_A, b: STORE_B, d: STORE_D } : { a: PIT_R, b: PIT_R, d: PIT_D });

// Haufen: Plätze für bis zu 72 Kugeln in einer Schale mit den Halbachsen a (x), b (z) und der Tiefe d – relativ zur
// Mitte auf der Brettoberfläche. Jede Kugel kommt auf den tiefsten Platz, an dem sie weder in die Schale noch in eine
// andere Kugel ragt.
function pile({ a, b, d }) {
  const dish = (x, z) => -d * Math.sqrt(Math.max(0, 1 - (x / a) ** 2 - (z / b) ** 2));
  const ring = [[0, 0], ...Array.from({ length: 12 }, (_, k) => [Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)])];
  const cands = [];
  for (let x = -a; x <= a; x += 0.3) {
    for (let z = -b; z <= b; z += 0.3) {
      if ((x / (a - R * 0.8)) ** 2 + (z / (b - R * 0.8)) ** 2 > 1) continue;
      // tiefste Lage über der Schale: über jedem Schalenpunkt unter der Kugel muss sie Abstand R halten
      let floor = -Infinity;
      for (const [cx, cz] of ring) {
        for (const f of [0.45, 0.9]) {
          const dx = cx * R * f;
          const dz = cz * R * f;
          floor = Math.max(floor, dish(x + dx, z + dz) + Math.sqrt(R * R - (dx * dx + dz * dz)));
        }
      }
      cands.push({ x, z, floor, far: Math.hypot(x / a, z / b) });
    }
  }
  const out = [];
  for (let n = 0; n < STONES; n++) {
    let best = null;
    for (const c of cands) {
      let y = c.floor;
      for (const o of out) {
        const dd = (c.x - o.x) ** 2 + (c.z - o.z) ** 2;
        if (dd < 4 * R * R) y = Math.max(y, o.y + Math.sqrt(4 * R * R - dd));
      }
      if (!best || y < best.y - 1e-6 || (Math.abs(y - best.y) <= 1e-6 && c.far < best.far)) best = { x: c.x, y, z: c.z, far: c.far };
    }
    out.push(best);
  }
  return out.map(({ x, y, z }) => new THREE.Vector3(x, y, z));
}

export function createKalahaBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const wood = woodTexture({ base: '#8a5530', boards: 5, repeat: [1 / BOARD_L, 1 / BOARD_L] });
  const frame = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: wood, roughness: 0.5, clearcoat: 0.3 });
  const inner = new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture({ base: '#6a3f22', boards: 3 }), roughness: 0.65, side: THREE.DoubleSide });
  buildBoard(group, frame, inner);
  const plates = createPlates(group, 2, { w: 14, h: 3.5 });

  const slots = { pit: pile(shapeOf(0)), store: pile(shapeOf(6)) };
  const slotOf = (i, k) => {
    if (i === HAND) {
      const from = hand.from ?? 0;
      return centerOf(from).add(slots.pit[k]).add(new THREE.Vector3(0, HAND_Y + PIT_D, from < 7 ? HAND_Z : -HAND_Z));
    }
    return centerOf(i).add((isStore(i) ? slots.store : slots.pit)[k]);
  };

  // Kugeln: bunte Glasmurmeln
  const geometry = new THREE.SphereGeometry(R, 20, 14);
  const looks = COLORS.map((color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, transmission: 0.35, thickness: 1.2, ior: 1.5, envMapIntensity: 1.6 }));
  const stones = Array.from({ length: STONES }, (_, n) => {
    const mesh = new THREE.Mesh(geometry, looks[(n * 5) % COLORS.length]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.quaternion.setFromEuler(new THREE.Euler(n * 1.3, n * 2.1, n * 0.7));
    group.add(mesh);
    return { mesh, pit: null, anim: [] };
  });
  const meshes = stones.map((d) => d.mesh);

  // Zahl je Mulde neben dem Brett (Sprites zeigen immer zur Kamera)
  const labels = Array.from({ length: 14 }, (_, i) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.raycast = () => {}; // nie anklickbar – Sprites brauchen sonst eine Kamera am Strahl
    sprite.scale.setScalar(isStore(i) ? 3.4 : 2.6);
    const at = centerOf(i);
    if (isStore(i)) sprite.position.set(Math.sign(at.x) * (BOARD_L / 2 + 2.2), THICK + 1, 0);
    else sprite.position.set(at.x, THICK + 1, Math.sign(at.z) * (BOARD_W / 2 + 1.6));
    group.add(sprite);
    return { sprite, canvas: c, tex, n: -1 };
  });

  // Ringe am Rand der Mulden: mögliche Züge (schwach), Maus drüber (hell), letzte Kugel (rot)
  const rings = Array.from({ length: 14 }, (_, i) => {
    const { a, b } = shapeOf(i);
    const m = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf0c060, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    m.scale.set(a + 0.15, 1, b + 0.15);
    m.position.copy(centerOf(i)).setY(THICK + 0.04);
    m.visible = false;
    group.add(m);
    return m;
  });

  const lists = Array.from({ length: 15 }, () => []); // Kugeln je Mulde, Index 14 = Hand
  const hand = { from: null };
  let shown = null;
  let preferred = null; // mit der Maus bewegte Kugel – genau sie soll als Nächstes wandern
  let marks = { legal: [], hover: null, last: null };

  // --- Bewegungen: Bogen (arc) oder Warten (wait) ---
  const left = (d) => d.anim.reduce((t, a) => t + (1 - a.t) * a.dur, 0);
  const goalOf = (d) => d.anim.at(-1)?.to ?? d.mesh.position;

  // Kugel d fliegt zur Zeit t0 (Sekunden ab jetzt) nach to
  function fly(d, to, t0, { dur = 0.32, height = 3, sound = 0 } = {}) {
    const wait = t0 - left(d);
    const from = goalOf(d).clone();
    const q0 = d.anim.at(-1)?.quat ?? d.mesh.quaternion.clone();
    if (wait > 0) d.anim.push({ type: 'wait', t: 0, dur: wait, to: from, quat: q0 });
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
    d.anim.push({ type: 'arc', t: 0, dur, from, to: to.clone(), q0, quat: spin.multiply(q0), height, sound });
  }

  function setNow(d, pos) {
    d.anim = [];
    d.mesh.position.copy(pos);
  }

  function update(dt) {
    for (const d of stones) {
      let rest = dt;
      while (rest > 0 && d.anim.length) {
        const a = d.anim[0];
        const use = Math.min(rest, (1 - a.t) * a.dur);
        a.t += use / a.dur;
        rest -= use;
        if (a.type === 'arc') {
          const k = a.t * a.t * (3 - 2 * a.t);
          d.mesh.position.lerpVectors(a.from, a.to, k);
          d.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
          d.mesh.quaternion.slerpQuaternions(a.q0, a.quat, k);
        }
        if (a.t < 1 - 1e-9) break;
        d.anim.shift();
        if (a.sound) playHit('ball', a.sound);
      }
    }
    // Zahlen: was schon in der Mulde liegt (fliegende Kugeln zählen erst, wenn sie landen)
    const count = Array(14).fill(0);
    for (const d of stones) if (d.pit !== null && d.pit !== HAND && !d.anim.length) count[d.pit]++;
    labels.forEach((l, i) => l.n !== count[i] && draw(l, count[i], isStore(i)));
    const calm = !busy();
    rings.forEach((m, i) => {
      const on = i === marks.hover || (calm && (marks.legal.includes(i) || i === marks.last));
      m.visible = on;
      if (!on) return;
      m.material.color.setHex(i === marks.hover ? 0xffd27a : i === marks.last && !marks.legal.includes(i) ? 0xd8342a : 0xf0c060);
      m.material.opacity = i === marks.hover ? 0.95 : 0.55;
    });
  }

  function draw(l, n, big) {
    l.n = n;
    const g = l.canvas.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(244, 237, 220, 0.92)';
    g.strokeStyle = 'rgba(42, 33, 24, 0.85)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 32, 28, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#2a2118';
    g.font = `bold ${big ? 32 : 30}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
    l.tex.needsUpdate = true;
  }

  const busy = () => stones.some((d) => d.anim.length);

  // Kugel aus Mulde i nehmen (die oberste – oder die mit der Maus bewegte, wenn sie dort liegt)
  function takeFrom(i) {
    const list = lists[i];
    const k = preferred && list.includes(preferred) ? list.indexOf(preferred) : list.length - 1;
    if (k < 0) return null;
    if (list[k] === preferred) preferred = null;
    return list.splice(k, 1)[0];
  }

  function put(d, i, t0, animate, opts) {
    d.pit = i;
    lists[i].push(d);
    const to = slotOf(i, lists[i].length - 1);
    if (animate) fly(d, to, t0, opts);
    else setNow(d, to);
  }

  // Ereignisse eines Stands abspielen (nur animiert) → Zeit, zu der alles liegt
  function play(events, t) {
    const into = (d, i, at, sound = 0.32) => put(d, i, at, true, { sound });
    const lift = (from) => {
      hand.from = from;
      const all = lists[from].splice(0);
      all.forEach((d) => into(d, HAND, t, 0));
      return t + 0.4;
    };
    for (const e of events) {
      if (e.type === 'move') {
        t = lift(e.from);
        e.path.forEach((i, j) => {
          const d = takeFrom(HAND);
          if (d) into(d, i, t + j * SOW_S);
        });
        t += e.path.length * SOW_S + 0.25;
        if (e.capture) t = gather([e.capture.at, e.capture.opp], e.by === 0 ? 6 : 13, t);
      } else if (e.type === 'take') t = lift(e.from);
      else if (e.type === 'untake') {
        for (const d of lists[HAND].splice(0)) into(d, e.from, t, 0.15);
        t += 0.4;
      } else if (e.type === 'drop') {
        const d = takeFrom(HAND);
        if (d) into(d, e.at, t);
        t += SOW_S;
      } else if (e.type === 'capture') t = gather([e.at, e.opp], e.by === 0 ? 6 : 13, t);
      else if (e.type === 'shift') {
        const d = takeFrom(e.from);
        if (d) into(d, e.to, t);
        t += SOW_S;
      } else if (e.type === 'sweep') t = gather(e.by === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12], e.by === 0 ? 6 : 13, t + 0.3);
    }
    return t;
  }

  // Alle Kugeln der Mulden from ins Kalaha store
  function gather(from, store, t) {
    let j = 0;
    for (const i of from) for (const d of lists[i].splice(0)) put(d, store, t + 0.06 * j++, true, { sound: 0.25, height: 4, dur: 0.45 });
    return t + 0.06 * j + 0.5;
  }

  // Stand zeigen. animate: Ereignisse abspielen, dann alles Übrige an seinen Platz fliegen lassen.
  function show(st, animate) {
    const want = [...st.pits, st.open?.hand ?? 0];
    if (st.open) hand.from = st.open.from;
    let t = animate && st.events ? play(st.events, 0) : 0;
    if (!animate) {
      for (const list of lists) list.length = 0;
      for (const d of stones) d.pit = null;
    }
    // Zu viele in einer Mulde → in den Vorrat, dann fehlende auffüllen (zuerst aus dem Vorrat, sonst aus der Schachtel)
    const spare = [];
    lists.forEach((list, i) => {
      while (list.length > want[i]) spare.push(takeFrom(i));
    });
    for (const d of stones) if (d.pit === null && !spare.includes(d)) spare.push(d);
    const fresh = st.events?.[0]?.type === 'start' || st.events?.[0]?.type === 'seeds';
    let j = 0;
    lists.forEach((list, i) => {
      while (list.length < want[i] && spare.length) put(spare.shift(), i, t + (fresh ? 0.03 * j++ : 0), animate, { sound: 0.2, height: 5, dur: 0.5 });
    });
    // übrige Kugeln: weg (unsichtbar unter dem Brett) – zählen nicht mit
    for (const d of spare) {
      d.pit = null;
      setNow(d, new THREE.Vector3(0, THICK / 2, 0));
    }
    for (const d of stones) d.mesh.visible = d.pit !== null;
    // Haufen ordnen: wer nicht auf seinem Platz liegt (z. B. weil eine Kugel aus der Mitte genommen wurde), rutscht nach
    lists.forEach((list, i) => list.forEach((d, k) => {
      const to = slotOf(i, k);
      if (goalOf(d).distanceTo(to) < 0.01) return;
      if (animate) fly(d, to, Math.max(t, left(d)), { dur: 0.2, height: 0.5 });
      else setNow(d, to);
    }));
    preferred = null;
    if (!st.open) hand.from = null;
  }

  function reset() {
    shown = null;
    preferred = null;
    marks = { legal: [], hover: null, last: null };
    setGlow('hover', []);
    plates.set([]);
    for (const list of lists) list.length = 0;
    for (const d of stones) {
      d.pit = null;
      d.anim = [];
      d.mesh.visible = false;
    }
  }

  reset();

  // Punkt (lokal) → Mulde, deren Schale ihn enthält (mit etwas Rand), sonst null
  function pitAt(p) {
    for (let i = 0; i < 14; i++) {
      const c = centerOf(i);
      const { a, b } = shapeOf(i);
      if (((p.x - c.x) / (a + 0.3)) ** 2 + ((p.z - c.z) / (b + 0.3)) ** 2 <= 1) return i;
    }
    return null;
  }

  // Strahl → Mulde (Kugeln zuerst, dann die Brettebene) oder 14 (Hand), null = daneben
  function pick(raycaster) {
    const hit = raycaster.intersectObjects(stones.filter((d) => d.pit !== null).map((d) => d.mesh), false)[0];
    if (hit) return stones.find((d) => d.mesh === hit.object).pit;
    group.updateWorldMatrix(true, false);
    const ray = raycaster.ray.clone().applyMatrix4(group.matrixWorld.clone().invert());
    const at = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -THICK), new THREE.Vector3());
    return at ? pitAt(at) : null;
  }

  return {
    group,
    loose: () => stones.filter((d) => d.pit !== null).map((d) => d.mesh), // Kugeln fliegen beim Umwerfen einzeln (tisch.js)
    // Holz, Marmor oder Gold – folgt dem Schachfiguren-Design dieses PCs (settings.js)
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
    names: (labels, turn, viewer) => plates.set(labels, { at: (p) => across(p, 0, BOARD_W / 2 + 8), view: viewer ? Math.PI : 0, turn }),
    // s = Spielstand; eine neue Aktion (oder eine neue Partie) wird abgespielt, sonst alles direkt hingelegt
    sync(s) {
      if (!s || s === shown) return;
      const start = ['start', 'seeds'].includes(s.events?.[0]?.type);
      show(s, !!shown && (s.seq === shown.seq + 1 || start));
      shown = s;
    },
    // legal = Mulden mit möglichem Zug, hover = Mulde unter der Maus, last = Mulde der zuletzt gelegten Kugel
    setMarks(next) {
      marks = { legal: [], hover: null, last: null, ...next };
      setGlow('hover', marks.hover !== null ? lists[marks.hover].map((d) => d.mesh) : []);
    },
    pick,
    // Wo eine Kugel mit der Hand abgelegt wurde (tisch.js): Punkt (Welt) → Mulde oder null
    pitAt(world) {
      return pitAt(group.worldToLocal(world.clone()));
    },
    // Kugel zu einem Mesh: { pit } (14 = in der Hand) oder null
    stoneOf(mesh) {
      const d = stones.find((x) => x.mesh === mesh);
      return d ? { pit: d.pit } : null;
    },
    // diese Kugel soll als Nächstes wandern
    prefer(mesh) {
      preferred = stones.find((x) => x.mesh === mesh) ?? null;
    },
  };
}

// Brett: ein Holzblock mit Löchern für Mulden und Kalahas, in jedem Loch eine runde Schale
function buildBoard(group, material, inner) {
  const shape = new THREE.Shape();
  const hw = BOARD_L / 2;
  const hd = BOARD_W / 2;
  const rr = 3;
  shape.moveTo(-hw + rr, -hd);
  shape.lineTo(hw - rr, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  shape.lineTo(hw, hd - rr);
  shape.quadraticCurveTo(hw, hd, hw - rr, hd);
  shape.lineTo(-hw + rr, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  shape.lineTo(-hw, -hd + rr);
  shape.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  for (let i = 0; i < 14; i++) {
    const c = centerOf(i);
    const { a, b } = shapeOf(i);
    const hole = new THREE.Path();
    hole.absellipse(c.x, -c.z, a, b, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const bevel = 0.35;
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: THICK - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 40 })
    .rotateX(-Math.PI / 2).translate(0, bevel, 0), material);
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  // Schalen: halbe Ellipsoide vom Rand bis auf den Grund
  for (let i = 0; i < 14; i++) {
    const { a, b, d } = shapeOf(i);
    const pts = Array.from({ length: 13 }, (_, k) => {
      const t = (k / 12) * (Math.PI / 2);
      return new THREE.Vector2(Math.sin(t) * (a + 0.02), -Math.cos(t) * d);
    });
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), inner);
    bowl.scale.set(1, 1, b / a);
    bowl.position.copy(centerOf(i));
    bowl.receiveShadow = true;
    group.add(bowl);
  }
  // Boden unter den Löchern (sonst sähe man schräg von unten durch)
  const floor = new THREE.Mesh(new THREE.BoxGeometry(BOARD_L - 2, 0.3, BOARD_W - 2), inner);
  floor.position.y = 0.15;
  group.add(floor);
  // Brandzeichen-Schrift zwischen den Reihen
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: titleTexture(), transparent: true, roughness: 0.7, depthWrite: false }));
  plate.position.set(0, THICK + 0.02, 0);
  group.add(plate);
}

function titleTexture() {
  return canvasTexture(1024, 176, (g, w, h) => {
    g.font = 'italic bold 120px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(40, 20, 8, 0.55)';
    g.fillText('Kalaha', w / 2, h / 2 + 6);
  });
}
