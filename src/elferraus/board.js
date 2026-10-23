// Elfer-raus-Tisch: in der Mitte je Farbe eine Reihe (Elfer in der Mitte, links der Stapel 10 → 1, rechts 12 → 20,
// jede Karte etwas weiter außen, damit man sieht, wie weit die Reihe ist), der verdeckte Nachziehstapel vorn rechts,
// zu zweit daneben die aussortierten blauen Karten. Die eigene Hand offen als Fächer, die anderen verdeckt an ihren
// Plätzen. Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) und spielt die Ereignisse der letzten Aktion
// als Kartenflüge ab. Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, 1 auf −x, 2 auf −z, 3 auf +x) – die Tisch-Physik (tisch.js) erkennt
// Teile an ihrer Stelle. Nur die Drehung offener Karten ist je PC verschieden: Sie liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { COLORS, colorOf, numOf } from './game.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, seatSide } from '../plates.js';

const DECK = 80;
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung um die Hochachse: +z-Platz → Platz des Sitzes
const HAND = { at: new THREE.Vector3(0, 7.5, 34), tilt: 0.95, width: 34 };
const TALON = { x: 22, z: 19 };
const SPARE = { x: -22, z: 19 }; // zu zweit: die aussortierten blauen Karten
const ROW_X = 7.2; // so weit liegen die Stapel 10 und 12 neben dem Elfer
const STEP = 0.6; // jede weitere Karte so viel weiter außen
const ROW_DZ = 10;
const REVEAL_R = 26; // Rundenende: Restkarten offen vor den Spielern
const PLATE = new THREE.Vector3(26, 0, 41); // Namensschild am Rand rechts neben der Hand (aus Sicht des Sitzes auf +z)
const ORDER = { r: 0, y: 1, g: 2, b: 3 };

const around = (v, seat) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SIDE[seat]);
const count = (h) => (Array.isArray(h) ? h.length : h);

export function createElferBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  let model = empty();
  let shown = null;
  let me = 0;
  let hover = null;
  let playable = null; // Set der Karten, die gerade passen (null = alle hell)
  let colors = COLORS;
  const plates = createPlates(cards.group, 4);

  function empty() {
    return { talon: [], spare: [], hands: [[], [], [], []], rows: Object.fromEntries(COLORS.map((c) => [c, { mid: null, left: [], right: [] }])) };
  }

  // Reihe einer Farbe: z-Lage, je nachdem wie viele Farben im Spiel sind
  const rowZ = (col) => (colors.indexOf(col) - (colors.length - 1) / 2) * ROW_DZ;
  const turn = () => SIDE[me];
  const rowSpot = (col, side, k) => {
    const x = side === 'mid' ? 0 : (side === 'left' ? -1 : 1) * (ROW_X + k * STEP);
    return flat(x, (side === 'mid' ? 0 : k + 1) * CARD.t * 1.1, rowZ(col), turn());
  };
  const talonSpot = (k) => flat(TALON.x, k * CARD.t, TALON.z, 0.04, false);
  const spareSpot = (k) => flat(SPARE.x, k * CARD.t, SPARE.z, -0.05, false);

  const order = (c) => ORDER[colorOf(c.id)] * 30 + numOf(c.id);
  const myHand = () => [...model.hands[me]].sort((a, b) => order(a) - order(b));
  const reveal = () => shown?.phase === 'over';

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln (mit Startverzögerung)
  function layout(moves = new Map(), instant = false) {
    if (hover && !model.hands[me].includes(hover)) hover = null;
    const spots = new Map();
    model.talon.forEach((c, k) => spots.set(c, talonSpot(k)));
    model.spare.forEach((c, k) => spots.set(c, spareSpot(k)));
    for (const [col, r] of Object.entries(model.rows)) {
      if (r.mid) spots.set(r.mid, rowSpot(col, 'mid', 0));
      r.left.forEach((c, k) => spots.set(c, rowSpot(col, 'left', k)));
      r.right.forEach((c, k) => spots.set(c, rowSpot(col, 'right', k)));
    }
    for (const seat of [0, 1, 2, 3]) {
      const hand = seat === me || reveal() ? [...model.hands[seat]].sort((a, b) => (a.id && b.id ? order(a) - order(b) : 0)) : model.hands[seat];
      hand.forEach((c, i) => {
        if (reveal()) {
          const step = Math.min(2.2, 34 / Math.max(hand.length, 1));
          const p = around(new THREE.Vector3((i - (hand.length - 1) / 2) * step, 0, REVEAL_R), seat);
          return spots.set(c, flat(p.x, i * CARD.t * 1.1, p.z, turn()));
        }
        const raise = seat === me && c === hover ? 1.2 : 0;
        spots.set(c, fan(i, hand.length, { ...HAND, side: SIDE[seat], raise, tilt: seat === me ? HAND.tilt : 0.35 }));
      });
    }
    for (const [c, spot] of spots) {
      const m = moves.get(c);
      if (instant) cards.place(c, spot);
      else if (m) {
        cards.fly(c, spot, {
          delay: m.delay, lift: m.lift ?? 3, queue: m.queue, onStart: m.onStart,
          onLand: (quiet) => !quiet && m.sound && playHit('card', m.sound),
        });
      } else cards.fly(c, spot, { dur: 0.22 });
    }
    for (const c of model.hands[me]) cards.shade(c, playable && !playable.has(c.id) ? 0.55 : 1);
    setGlow('hover', hover ? [hover.mesh] : []);
  }

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null;
    colors = v.colors?.length ? v.colors : COLORS;
    let k = 0;
    const next = (id) => {
      const c = pool[k++];
      cards.setFace(c, id);
      cards.shade(c, 1);
      return c;
    };
    const hand = (p) => (Array.isArray(v.hands[p]) ? v.hands[p].map((id) => next(id)) : Array.from({ length: v.hands[p] }, () => next(null)));
    model = empty();
    model.hands = [hand(0), hand(1), hand(2), hand(3)];
    for (const [col, r] of Object.entries(v.rows ?? {})) {
      model.rows[col] = { mid: r.mid ? next(`${col}11`) : null, left: r.left.map((id) => next(id)), right: r.right.map((id) => next(id)) };
    }
    const inGame = v.phase === 'setup' ? DECK : v.colors.length * 20;
    const talon = v.phase === 'setup' ? DECK : count(v.talon);
    model.talon = Array.from({ length: talon }, () => next(null));
    while (k < inGame) model.talon.push(next(null)); // sollte nicht vorkommen – lieber in den Stapel als verloren
    while (k < DECK) model.spare.push(next(null));
    if (v.phase === 'setup') model.talon.push(...model.spare.splice(0));
    layout(new Map(), true);
  }

  // Neue Runde: alles zum Stapel, mischen, reihum austeilen (eine Karte je Spieler), dann fliegt der Anfangs-Elfer in die Mitte
  function deal(v) {
    const total = v.colors.length * 20;
    rebuild({ phase: 'play', colors: v.colors, hands: [0, 0, 0, 0], talon: total, rows: {} });
    model.talon.forEach((c, k) => {
      const shift = k % 2 ? 3.6 : -3.6;
      cards.fly(c, flat(TALON.x + shift, (k >> 1) * CARD.t, TALON.z, 0.04 + (k % 2 ? -0.25 : 0.25), false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, talonSpot(k), { delay: 0.32 + k * 0.004, dur: 0.18, queue: true });
    });
    const e = v.events[0];
    const mine = [...(Array.isArray(v.hands[me]) ? v.hands[me] : [])];
    if (me === e.starter) mine.push(e.first);
    const sizes = v.seats.map((p) => count(v.hands[p]) + (p === e.starter ? 1 : 0));
    const moves = new Map();
    let t = 0.9;
    const step = Math.min(0.05, 2.4 / sizes.reduce((a, b) => a + b, 0));
    for (let i = 0; i < Math.max(...sizes); i++) {
      v.seats.forEach((p, j) => {
        if (i >= sizes[j]) return;
        const c = model.talon.pop();
        cards.setFace(c, p === me ? mine.shift() ?? null : null);
        model.hands[p].push(c);
        moves.set(c, { delay: t, queue: true, sound: 0.35 });
        t += step;
      });
    }
    // Anfangs-Elfer: aus der Hand des Starters in die Mitte
    const hand = model.hands[e.starter];
    const c = hand.find((x) => x.id === e.first) ?? hand[Math.floor(hand.length / 2)];
    hand.splice(hand.indexOf(c), 1);
    model.rows[colorOf(e.first)].mid = c;
    moves.set(c, { delay: t + 0.4, queue: true, lift: 3, sound: 0.8, onStart: () => cards.setFace(c, e.first) });
    layout(moves);
  }

  // Karte aus einer Hand: eigene nach Kartentext, beim anderen eine aus der Mitte (sie sind verdeckt)
  function fromHand(seat, id) {
    const hand = model.hands[seat];
    const c = hand.find((x) => x.id === id) ?? (seat === me ? null : hand[Math.floor(hand.length / 2)]);
    if (c) hand.splice(hand.indexOf(c), 1);
    return c;
  }

  function playEvents(v) {
    const moves = new Map();
    let t = 0;
    for (const e of v.events) {
      if (e.type === 'play') {
        const c = fromHand(e.player, e.card);
        if (!c) return rebuild(v);
        c.id = e.card; // Bild erst beim Abflug, die Kennung gleich – sonst passt das Modell nicht zur Sicht (matches)
        const row = model.rows[colorOf(e.card)];
        const n = numOf(e.card);
        if (n === 11) row.mid = c;
        else row[n < 11 ? 'left' : 'right'].push(c);
        moves.set(c, { delay: t, lift: 2.5, sound: 0.8, onStart: () => cards.setFace(c, e.card) });
        t += 0.35;
      } else if (e.type === 'draw') {
        const c = model.talon.pop();
        if (!c) return rebuild(v);
        cards.setFace(c, e.player === me ? e.card : null);
        model.hands[e.player].push(c);
        moves.set(c, { delay: t, lift: 2, sound: 0.45 });
        t += 0.3;
      }
    }
    if (!matches(v)) return rebuild(v);
    if (reveal()) showRest(v);
    layout(moves);
  }

  const ids = (list) => list.map((c) => c.id);
  function matches(v) {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const hand = (p) => (p === me && Array.isArray(v.hands[p]) ? same(ids(model.hands[p]).sort(), [...v.hands[p]].sort()) : model.hands[p].length === count(v.hands[p]));
    const rows = Object.entries(v.rows ?? {}).every(([col, r]) => {
      const m = model.rows[col];
      return !!m.mid === r.mid && same(ids(m.left), r.left) && same(ids(m.right), r.right);
    });
    return model.talon.length === count(v.talon) && rows && [0, 1, 2, 3].every(hand);
  }

  // Rundenende: Restkarten aller Spieler bekommen ihr Bild (liegen dann offen vor ihnen)
  function showRest(v) {
    for (const p of [0, 1, 2, 3]) {
      if (!Array.isArray(v.hands[p]) || v.hands[p].length !== model.hands[p].length || p === me) continue;
      model.hands[p].forEach((c, i) => cards.setFace(c, v.hands[p][i]));
    }
  }

  function reset() {
    shown = null;
    hover = null;
    playable = null;
    me = 0;
    setGlow('hover', []);
    plates.set([]);
    rebuild({ phase: 'setup', hands: [0, 0, 0, 0], rows: {} });
  }

  reset();

  // Klickfläche des Nachziehstapels
  const talonHit = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, 1.5, CARD.h), new THREE.MeshBasicMaterial());
  talonHit.position.set(TALON.x, 0.75, TALON.z);
  talonHit.visible = false;
  cards.group.add(talonHit);

  return {
    group: cards.group,
    loose: () => pool.map((c) => c.mesh), // kein Brett – beim Umwerfen fliegen die Karten (tisch.js)
    setDesign: (s) => setCardBack(s.cardBack),
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut
    sync(v, seat) {
      if (!v || v === shown) return;
      me = seat;
      const prev = shown;
      shown = v;
      if (v.phase === 'setup') rebuild(v);
      else if (v.events[0]?.type === 'caught') { // Zug zurück: neu aufbauen – auch aufgedeckte Restkarten wieder verdeckt
        rebuild(v);
        if (reveal()) showRest(v);
        layout();
      } else if (prev && prev.phase !== 'setup' && matches(v)) {
        if (reveal()) showRest(v);
        layout();
      } else if (v.events[0]?.type === 'deal') deal(v);
      else if (prev && prev.phase !== 'setup' && v.seq === prev.seq + 1) playEvents(v);
      else {
        rebuild(v);
        if (reveal()) showRest(v);
        layout();
      }
    },
    // Namensschilder: labels[sitz] = Text ('' = leerer Platz), turn = wer dran ist (oder null)
    names: (labels, turn = null) => plates.set(labels, { at: (s) => around(new THREE.Vector3(seatSide(s, me) * PLATE.x, 0, PLATE.z), s), view: SIDE[me], turn }),
    // Karten, die gerade passen (die anderen werden abgedunkelt) – null = alle hell
    setPlayable(list) {
      playable = list ? new Set(list) : null;
      layout();
    },
    setHover(id) {
      const c = id ? model.hands[me].find((x) => x.id === id) ?? null : null;
      if (c === hover) return;
      hover = c;
      layout();
    },
    pickHand: (raycaster) => (reveal() ? null : cards.pick(raycaster, model.hands[me])?.id ?? null),
    hitTalon: (raycaster) => model.talon.length > 0 && raycaster.intersectObject(talonHit, false).length > 0,
    // Karte zu einem Mesh (mit der Hand gepackt, tisch.js): { id, from: 'hand' | 'talon' } oder null
    cardOf(mesh) {
      const c = mesh.userData.card;
      if (c && model.hands[me].includes(c)) return { id: c.id, from: 'hand' };
      return c && c === model.talon.at(-1) ? { id: null, from: 'talon' } : null;
    },
    // Wo liegt ein Punkt (Welt)? 'rows' (Tischmitte bei den Reihen), 'hand' (vor mir) oder null
    zoneAt(point) {
      const p = cards.group.worldToLocal(point.clone());
      if (Math.abs(p.x) < 18 && Math.abs(p.z) < colors.length * ROW_DZ / 2 + 3) return 'rows';
      return (me === 0 ? p.z : -p.z) > 24 ? 'hand' : null;
    },
  };
}
