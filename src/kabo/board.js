// Kabo-Tisch: vor jedem Platz vier verdeckte Karten im 2 × 2-Raster (Platz 0/1 nah, 2/3 hinten), in der Mitte links
// der verdeckte Stapel, rechts die offene Ablage. Die gezogene Karte hält der Ziehende schräg vor sich – nur er sieht
// ihr Bild. Ansehen: Die Karte kippt zum Betrachter hoch – nur er sieht ihr Bild, alle anderen sehen nur, dass sie
// angesehen wird. Wer „Kabo!“ ruft, bekommt ein rotes Kabo-Plättchen neben seine Karten. Abwerfen: Die Karte fliegt auf
// die Ablage, ihr Platz bleibt leer; falsch geworfen zeigt sie sich allen kurz über der Ablage und fliegt zurück, eine
// Strafkarte kommt dazu – links neben dem Raster wachsen dafür bis zu zwei Spalten. Kennt keine Regeln: zeigt die
// Sicht eines Spielers (viewFor) und spielt die Ereignisse der letzten Aktion als Kartenflüge ab. Maße in Zentimetern.
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, 1 auf −x, 2 auf −z, 3 auf +x) – die Tisch-Physik (tisch.js) erkennt
// Teile an ihrer Stelle. Nur die Drehung offener Karten ist je PC verschieden: Sie liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { canvasTexture } from '../textures.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, seatSide } from '../plates.js';

const DECK = 54;
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung um die Hochachse: +z-Platz → Platz des Sitzes
// Raster aus Sicht des Sitzes auf +z: x, z je Platz – 0/1 nah, 2/3 hinten, Strafkarten in Spalten links daneben
const GRID = [[-3.7, 29], [3.7, 29], [-3.7, 19.4], [3.7, 19.4], [-11.1, 29], [-11.1, 19.4], [-18.5, 29], [-18.5, 19.4]];
const TALON = { x: -5, z: 0 };
const DISCARD = { x: 5, z: 0 };
const HELD = new THREE.Vector3(13, 7, 27); // gezogene Karte: rechts neben dem Raster, zum Spieler hochgestellt
const LOOK = { lift: 4.5, tilt: 1.0, toward: 1.5 }; // angesehene Karte: so hoch, so steil, so weit zum Betrachter
const TOKEN = new THREE.Vector3(0, 0, 12.5); // Kabo-Plättchen vor dem Raster, zur Tischmitte hin (links wachsen Strafkarten)
const SHOW = { y: 4, z: 4 }; // falsch abgeworfene Karte: so hoch über der Ablage, zur Mitte hin, für alle offen
const PLATE = new THREE.Vector3(17, 0, 31); // Namensschild rechts neben dem Raster (aus Sicht des Sitzes auf +z)
const UP = new THREE.Vector3(0, 1, 0);
const ACROSS = new THREE.Vector3(1, 0, 0);

const around = (v, seat) => v.clone().applyAxisAngle(UP, SIDE[seat]);
// ab Platz 8 (sehr viele Strafkarten) liegen sie leicht versetzt auf den äußeren Spalten
const gridAt = (p, i) => {
  const [x, z] = GRID[i < 8 ? i : 4 + (i % 4)];
  const k = i < 8 ? 0 : Math.floor(i / 4) - 1;
  return around(new THREE.Vector3(x - k * 0.8, k * 0.4, z - k * 0.8), p);
};
const count = (x) => (Array.isArray(x) ? x.length : x ?? 0);
// Plätze eines Sitzes: true = Karte, false = leer (abgeworfen); in der Sicht ist leer '' (EMPTY)
const slots = (x) => (Array.isArray(x) ? x.map((c) => c !== '') : Array.from({ length: x ?? 0 }, () => true));

// Kabo-Plättchen: rote Holzscheibe mit heller Schrift
function tokenTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f3e9d6';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f3e9d6';
    g.font = 'bold 66px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('KABO', w / 2, h / 2 + 4);
  });
}

export function createKaboBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  const plates = createPlates(cards.group, 4);
  const top = new THREE.MeshStandardMaterial({ map: tokenTexture(), roughness: 0.55 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x8e1d17, roughness: 0.6 });
  const token = { mesh: new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 40), [rim, top, rim]), target: null };
  token.mesh.castShadow = true;
  token.mesh.visible = false;
  cards.group.add(token.mesh);
  let model = empty();
  let shown = null;
  let me = 0;
  let hover = null; // Karte unter der Maus
  let picked = []; // ausgewählte Stellen: { zone: 'hand', p, i } | { zone: 'discard' }

  function empty() {
    return { talon: [], discard: [], drawn: null, hands: [[], [], [], []] };
  }

  const turn = () => SIDE[me];
  const talonSpot = (k) => flat(TALON.x, k * CARD.t, TALON.z, 0.04, false);
  // Ablage: offen, leicht durcheinander, aufrecht für den Zuschauer
  const discardSpot = (k) => flat(DISCARD.x, k * CARD.t, DISCARD.z, turn() + (((k * 7) % 5) - 2) * 0.05, true);
  const heldSpot = (seat) => fan(0, 1, { at: HELD, side: SIDE[seat], tilt: 0.95 });
  const isPicked = (p, i) => picked.some((x) => x.zone === 'hand' && x.p === p && x.i === i);

  // Wer sieht Karte (p, i) gerade an? Sitz oder null – beim Ansehen zu Beginn jeder seine nahen Karten
  function lookerOf(v, p, i) {
    if (!v || v.phase === 'over') return null;
    if (v.phase === 'peek' && i < 2 && !v.ready.includes(p)) return p;
    if (v.look?.spots.some((x) => x.p === p && x.i === i)) return v.look.seat;
    if (v.secret && v.secret.p === p && v.secret.i === i) return v.secret.seat;
    return null;
  }

  // Lage einer Handkarte: verdeckt flach, zum Betrachter hochgekippt oder am Rundenende offen
  function handSpot(p, i) {
    const at = gridAt(p, i);
    if (shown?.phase === 'over') return flat(at.x, at.y, at.z, turn());
    const looker = lookerOf(shown, p, i);
    if (looker !== null) {
      const to = around(new THREE.Vector3(0, 0, 1), looker).multiplyScalar(LOOK.toward);
      const quat = new THREE.Quaternion().setFromAxisAngle(UP, SIDE[looker]).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, LOOK.tilt));
      return { pos: new THREE.Vector3(at.x + to.x, LOOK.lift, at.z + to.z), quat };
    }
    const up = p === me && isPicked(p, i) ? 0.8 : p === me && hover === model.hands[p][i] ? 0.4 : 0;
    return flat(at.x, at.y + up, at.z, SIDE[p], false);
  }

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln (mit Startverzögerung)
  function layout(moves = new Map(), instant = false) {
    const spots = new Map();
    model.talon.forEach((c, k) => spots.set(c, talonSpot(k)));
    model.discard.forEach((c, k) => {
      const lifted = k === model.discard.length - 1 && picked.some((x) => x.zone === 'discard');
      spots.set(c, lifted ? flat(DISCARD.x, k * CARD.t + 1.2, DISCARD.z, turn(), true) : discardSpot(k));
    });
    if (model.drawn) spots.set(model.drawn, heldSpot(shown?.turn ?? me));
    for (const p of [0, 1, 2, 3]) model.hands[p].forEach((c, i) => c && spots.set(c, handSpot(p, i)));
    for (const [c, spot] of spots) {
      const m = moves.get(c);
      if (instant) cards.place(c, spot);
      else if (m) {
        // immer als neuer Flug (queue): Hängte er sich an einen laufenden (z. B. Anheben unter der Maus), fiele onStart
        // weg – und die Karte zeigte auf der Ablage die Rückseite
        cards.fly(c, spot, {
          delay: m.delay, lift: m.lift ?? 3, queue: true, onStart: m.onStart,
          onLand: (quiet) => !quiet && m.sound && playHit('card', m.sound),
        });
      } else cards.fly(c, spot, { dur: 0.25 });
    }
    const lit = picked.map((x) => (x.zone === 'discard' ? model.discard.at(-1) : model.hands[x.p]?.[x.i])).filter(Boolean);
    setGlow('hover', [...lit, ...(hover && !lit.includes(hover) ? [hover] : [])].map((c) => c.mesh));
    placeToken(instant);
  }

  // Kabo-Plättchen vor dem Rufer (sonst weg)
  function placeToken(instant) {
    const caller = shown && shown.phase !== 'setup' ? shown.caller ?? shown.result?.caller ?? null : null;
    token.mesh.visible = caller !== null;
    if (caller === null) return;
    const p = around(TOKEN, caller);
    const spot = { pos: new THREE.Vector3(p.x, 0.25, p.z), quat: new THREE.Quaternion().setFromAxisAngle(UP, turn()) };
    if (instant || !token.target) {
      token.target = spot;
      token.mesh.position.copy(spot.pos);
      token.mesh.quaternion.copy(spot.quat);
    } else cards.fly(token, spot, { lift: 3, dur: 0.5 });
  }

  // Bilder: offen nur, was die Sicht zeigt – alles andere Rückseite (verrät nichts, auch nicht beim Umwerfen)
  function faces(v, skip = new Set()) {
    const set = (c, id) => !skip.has(c) && cards.setFace(c, id ?? null);
    model.talon.forEach((c) => set(c, null));
    model.discard.forEach((c, k) => set(c, v.discard?.[k]));
    if (model.drawn) set(model.drawn, v.drawn);
    for (const p of [0, 1, 2, 3]) model.hands[p].forEach((c, i) => c && set(c, v.hands?.[p]?.[i]));
  }

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null;
    let k = 0;
    const next = () => pool[k++];
    model = empty();
    model.hands = [0, 1, 2, 3].map((p) => slots(v.hands?.[p]).map((full) => (full ? next() : null)));
    model.discard = Array.from({ length: count(v.discard) }, next);
    model.drawn = v.drawn ? next() : null;
    model.talon = Array.from({ length: count(v.talon) }, next);
    while (k < DECK) model.talon.unshift(next()); // im Aufbau: alle Karten im Stapel
    faces(v);
    layout(new Map(), true);
  }

  // Neue Runde: alles zum Stapel, mischen, reihum je eine Karte (viermal, ab dem Startspieler), dann eine auf die Ablage
  function deal(v) {
    rebuild({ hands: [0, 0, 0, 0] });
    model.talon.forEach((c, k) => {
      const shift = k % 2 ? 3.6 : -3.6;
      cards.fly(c, flat(TALON.x + shift, (k >> 1) * CARD.t, TALON.z, 0.04 + (k % 2 ? -0.25 : 0.25), false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, talonSpot(k), { delay: 0.32 + k * 0.01, dur: 0.18, queue: true });
    });
    const order = [];
    for (let p = v.starter, n = 0; n < 4; p = (p + 1) % 4, n++) if (count(v.hands[p])) order.push(p);
    const moves = new Map();
    let t = 1.0;
    for (let i = 0; i < 4; i++) {
      for (const p of order) {
        const c = model.talon.pop();
        model.hands[p].push(c);
        moves.set(c, { delay: t, queue: true, sound: 0.35 });
        t += 0.08;
      }
    }
    const c = model.talon.pop();
    model.discard.push(c);
    moves.set(c, { delay: t + 0.2, queue: true, sound: 0.6, onStart: () => cards.setFace(c, v.discard[0]) });
    faces(v, new Set([c]));
    layout(moves);
  }

  function playEvents(v) {
    const moves = new Map();
    let t = 0;
    const move = (c, m) => moves.set(c, { delay: t, lift: 2.5, sound: 0.6, ...m });
    for (const e of v.events) {
      if (e.type === 'mixed') {
        const top = model.discard.pop();
        for (const c of model.discard) move(c, { lift: 1.5, sound: 0, onStart: () => cards.setFace(c, null) });
        model.talon.unshift(...model.discard);
        model.discard = top ? [top] : [];
        playShuffle();
        t += 0.5;
      } else if (e.type === 'draw') {
        const c = model.talon.pop();
        if (!c) return rebuild(v);
        model.drawn = c;
        move(c, { lift: 3, sound: 0.4 });
        t += 0.35;
      } else if (e.type === 'place' || e.type === 'take') {
        const hand = model.hands[e.player];
        const c = e.type === 'place' ? model.drawn : model.discard.pop();
        const old = hand[e.i];
        if (!c || !old) return rebuild(v);
        hand[e.i] = c;
        if (e.type === 'place') model.drawn = null;
        model.discard.push(old);
        move(c, { sound: 0.5 });
        move(old, { delay: t + 0.12, sound: 0.8, onStart: () => cards.setFace(old, e.type === 'take' ? e.old : e.card) });
        t += 0.45;
      } else if (e.type === 'drop') {
        const c = model.drawn;
        if (!c) return rebuild(v);
        model.drawn = null;
        model.discard.push(c);
        move(c, { sound: 0.8, onStart: () => cards.setFace(c, e.card) });
        t += 0.35;
      } else if (e.type === 'swap') {
        const a = model.hands[e.player];
        const b = model.hands[e.other.p];
        const [x, y] = [a[e.own], b[e.other.i]];
        if (!x || !y) return rebuild(v);
        a[e.own] = y;
        b[e.other.i] = x;
        move(x, { lift: 4, sound: 0.5 });
        move(y, { lift: 4, delay: t + 0.08, sound: 0.5 });
        t += 0.5;
      } else if (e.type === 'snap') {
        const hand = model.hands[e.player];
        const c = hand[e.i];
        if (!c) return rebuild(v);
        if (e.ok) {
          hand[e.i] = null;
          model.discard.push(c);
          move(c, { lift: 3, sound: 0.9, onStart: () => cards.setFace(c, e.card) });
          t += 0.4;
        } else {
          // allen zeigen (über der Ablage, aufrecht für den Zuschauer), dann verdeckt zurück; Strafkarte vom Stapel
          const show = around(new THREE.Vector3(DISCARD.x, 0, 0), 0);
          const quat = new THREE.Quaternion().setFromAxisAngle(UP, turn()).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, 0.9));
          const toMe = new THREE.Vector3(0, 0, SHOW.z).applyAxisAngle(UP, turn());
          cards.fly(c, { pos: new THREE.Vector3(show.x + toMe.x, SHOW.y, show.z + toMe.z), quat }, { delay: t, lift: 2, queue: true, onStart: () => cards.setFace(c, e.card) });
          move(c, { delay: t + 1.6, queue: true, sound: 0.5, onStart: () => cards.setFace(c, null) });
          playHit('wood', 0.5, t + 0.5);
          if (e.penalty !== null) {
            const pen = model.talon.pop();
            if (!pen) return rebuild(v);
            hand[e.penalty] = pen;
            move(pen, { delay: t + 2.0, lift: 3, sound: 0.5 });
          }
          t += 2.3;
        }
      } else if (e.type === 'kabo') {
        playHit('wood', 0.9, 0.05);
        playHit('wood', 0.8, 0.3);
      }
    }
    if (!matches(v)) return rebuild(v);
    faces(v, new Set(moves.keys()));
    // bewegte Karten bekommen ihr Bild beim Abflug (sonst sähe man es, bevor sie liegen)
    for (const [c, m] of moves) {
      if (m.onStart) continue;
      const slot = where(c);
      m.onStart = () => cards.setFace(c, idAt(v, slot));
    }
    layout(moves);
  }

  // Wo liegt eine Karte im Modell? und welches Bild gehört laut Sicht dorthin
  function where(c) {
    if (model.drawn === c) return { zone: 'drawn' };
    const k = model.discard.indexOf(c);
    if (k >= 0) return { zone: 'discard', k };
    for (const p of [0, 1, 2, 3]) {
      const i = model.hands[p].indexOf(c);
      if (i >= 0) return { zone: 'hand', p, i };
    }
    return { zone: 'talon' };
  }
  const idAt = (v, x) => (x.zone === 'drawn' ? v.drawn : x.zone === 'discard' ? v.discard[x.k] : x.zone === 'hand' ? v.hands[x.p][x.i] : null) ?? null;

  function matches(v) {
    const same = (p) => {
      const want = slots(v.hands[p]);
      return model.hands[p].length === want.length && want.every((full, i) => full === !!model.hands[p][i]);
    };
    return model.talon.length === count(v.talon) && model.discard.length === count(v.discard) && !!model.drawn === !!v.drawn
      && [0, 1, 2, 3].every(same);
  }

  function reset() {
    shown = null;
    hover = null;
    picked = [];
    me = 0;
    token.target = null;
    setGlow('hover', []);
    plates.set([]);
    rebuild({ hands: [0, 0, 0, 0] });
  }

  reset();

  // Stelle einer Karte (für Klicks und die Hand): { zone: 'hand', p, i } | { zone: 'talon' } | { zone: 'discard' } | { zone: 'drawn' }
  function slotOf(c) {
    if (!c) return null;
    if (model.talon.includes(c)) return c === model.talon.at(-1) ? { zone: 'talon' } : null;
    if (model.discard.includes(c)) return c === model.discard.at(-1) ? { zone: 'discard' } : null;
    const x = where(c);
    return x.zone === 'hand' || x.zone === 'drawn' ? x : null;
  }

  return {
    group: cards.group,
    // Karten und das Kabo-Plättchen fliegen beim Umwerfen einzeln (tisch.js) – feste Reihenfolge auf beiden PCs
    loose: () => [...pool.map((c) => c.mesh), token.mesh],
    setDesign: (s) => setCardBack(s.cardBack),
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // Namensschilder: labels[sitz] = Text ('' = leerer Platz), turn = wer dran ist (oder null)
    names: (labels, turn = null) => plates.set(labels, { at: (s) => around(new THREE.Vector3(seatSide(s, me) * PLATE.x, 0, PLATE.z), s), view: SIDE[me], turn }),
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut
    sync(v, seat) {
      if (!v || v === shown) return;
      const turned = me !== seat;
      me = seat;
      const prev = shown;
      shown = v;
      if (v.phase === 'setup') rebuild(v);
      else if (v.events[0]?.type === 'deal') deal(v);
      else if (!turned && prev && prev.phase !== 'setup' && v.seq === prev.seq && matches(v)) {
        faces(v); // derselbe Stand noch einmal (z. B. ungültiger Wunsch) – laufende Flüge nicht abbrechen
        layout();
      } else if (!turned && prev && prev.phase !== 'setup' && v.events[0]?.type !== 'caught' && v.seq === prev.seq + 1) playEvents(v);
      else rebuild(v);
    },
    // Ausgewählte Stellen leuchten (eigene Karte hebt sich, die Ablage auch)
    setPicked(next) {
      picked = next.map((x) => ({ ...x }));
      layout();
    },
    setHover(slot) {
      const c = !slot ? null : slot.zone === 'hand' ? model.hands[slot.p]?.[slot.i] ?? null : slot.zone === 'talon' ? model.talon.at(-1) ?? null
        : slot.zone === 'discard' ? model.discard.at(-1) ?? null : model.drawn;
      if (c === hover) return;
      hover = c;
      layout();
    },
    // Getroffene Stelle unter der Maus (oberste Karte von Stapel und Ablage, Handkarten aller Plätze, gezogene Karte)
    pick(raycaster) {
      const list = [...model.hands.flat(), model.talon.at(-1), model.discard.at(-1), model.drawn].filter(Boolean);
      return slotOf(cards.pick(raycaster, list));
    },
    // Stelle zu einem Mesh (mit der Hand gepackt, tisch.js) oder null
    slotOfMesh: (mesh) => slotOf(mesh.userData.card),
    // Stelle an einem Punkt (Welt): nächste Handkarte, Stapel oder Ablage im Umkreis einer Kartenlänge – sonst null
    slotAt(point) {
      const p = cards.group.worldToLocal(point.clone());
      let best = null;
      let dist = 6;
      const check = (slot, x, z) => {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < dist) [best, dist] = [slot, d];
      };
      check({ zone: 'talon' }, TALON.x, TALON.z);
      check({ zone: 'discard' }, DISCARD.x, DISCARD.z);
      for (const q of [0, 1, 2, 3]) model.hands[q].forEach((c, i) => c && check({ zone: 'hand', p: q, i }, gridAt(q, i).x, gridAt(q, i).z));
      return best;
    },
  };
}
