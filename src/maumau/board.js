// Mau-Mau-Tisch: Nachziehstapel, Ablage, eigene Hand als Fächer, verdeckte Hand des Mitspielers und
// der Wunsch-Chip. Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) und spielt die
// Ereignisse der letzten Aktion als Kartenflüge ab. Maße in Zentimetern (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { suitChip, setCardBack } from '../karten/faces.js';
import { makeDeck, SUITS, RANKS } from '../karten/cards.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';

const DECK = makeDeck('7').length;
const TALON = { x: -7.5, z: -1 };
const PILE = { x: 3.5, z: -1 };
const HAND = { at: new THREE.Vector3(0, 7, 23), tilt: 0.95 }; // Platz auf der +z-Seite, der andere gegenüber
const ORDER = ['c', 'h', 's', 'd']; // Hand sortiert: Kreuz, Herz, Pik, Karo – schwarz und rot im Wechsel
const sideOf = (player) => (player === 0 ? 0 : Math.PI);

const talonSpot = (k) => flat(TALON.x, k * CARD.t, TALON.z, 0.03, false);
// Ablage etwas unordentlich – aus der Lage im Stapel berechnet, damit beide dasselbe sehen
const pileSpot = (k) => flat(PILE.x + ((k * 31) % 7 - 3) * 0.18, k * CARD.t, PILE.z + ((k * 17) % 5 - 2) * 0.18, ((k * 7919) % 13 - 6) * 0.035);

export function createMauMauBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  let model = { talon: [], pile: [], hands: [[], []] }; // Kartenobjekte je Ort
  let shown = null;
  let me = 0;
  let hover = null;
  let canPlay = null; // Karten, die gerade passen (null = keine Abdunklung)

  // Wunsch-Chip neben der Ablage
  const chip = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 40), [
    new THREE.MeshStandardMaterial({ color: 0xc89a3c, roughness: 0.4, metalness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: suitChip('h'), roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xc89a3c }),
  ]);
  chip.position.set(PILE.x + 8.5, 0.25, PILE.z);
  chip.castShadow = chip.receiveShadow = true;
  chip.visible = false;
  cards.group.add(chip);

  // Klickfläche des Nachziehstapels – auch wenn er gerade leer ist (Ziehen mischt dann die Ablage neu)
  const talonHit = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, 1.2, CARD.h), new THREE.MeshBasicMaterial());
  talonHit.position.set(TALON.x, 0.6, TALON.z);
  talonHit.visible = false;
  cards.group.add(talonHit);

  const order = (c) => ORDER.indexOf(c.id?.[0]) * 20 + RANKS.indexOf(c.id?.[1]);
  const handOf = (p) => (p === me ? [...model.hands[p]].sort((a, b) => order(a) - order(b)) : model.hands[p]);
  const count = (h) => (Array.isArray(h) ? h.length : h);

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln, mit Startverzögerung
  function layout(moves = new Map(), instant = false) {
    if (hover && !model.hands[me].includes(hover)) { // gerade gelegt → leuchtet nicht mehr
      hover = null;
      setGlow('hover', []);
    }
    const spots = new Map();
    model.talon.forEach((c, k) => spots.set(c, talonSpot(k)));
    model.pile.forEach((c, k) => spots.set(c, pileSpot(k)));
    for (const p of [0, 1]) {
      const hand = handOf(p);
      hand.forEach((c, i) => spots.set(c, fan(i, hand.length, { ...HAND, side: sideOf(p), raise: c === hover ? 1.6 : 0 })));
    }
    for (const [c, spot] of spots) {
      const m = moves.get(c);
      if (instant) cards.place(c, spot);
      else if (m) cards.fly(c, spot, { delay: m.delay, lift: m.lift ?? 3, queue: m.queue, onStart: m.onStart, onLand: (quiet) => quiet || playHit('card', m.sound ?? 0.6) });
      else cards.fly(c, spot, { dur: 0.22 });
    }
    for (const c of pool) cards.shade(c, canPlay && model.hands[me].includes(c) && !canPlay.includes(c.id) ? 0.42 : 1); // alle, sonst bleibt eine Karte vom letzten Spiel dunkel
  }

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null; // Karten werden neu verteilt – die alte Hover-Karte kann jetzt eine andere sein
    setGlow('hover', []);
    let k = 0;
    const next = (id) => {
      const c = pool[k++];
      cards.setFace(c, id);
      return c;
    };
    model = {
      talon: Array.from({ length: v.talon }, () => next(null)),
      pile: v.pile.map(next),
      hands: [0, 1].map((p) => (Array.isArray(v.hands[p]) ? v.hands[p].map(next) : Array.from({ length: v.hands[p] }, () => next(null)))),
    };
    layout(new Map(), true);
  }

  // Neues Spiel: alles zum Stapel, mischen (zwei Hälften laufen ineinander), abwechselnd austeilen, erste Karte aufdecken
  function deal(v) {
    rebuild({ talon: DECK, pile: [], hands: [0, 0] });
    const half = DECK / 2;
    model.talon.forEach((c, k) => {
      const left = k < half;
      const j = left ? k : k - half;
      cards.fly(c, flat(TALON.x + (left ? -3.8 : 3.8), j * CARD.t, TALON.z, left ? 0.25 : -0.25, false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, talonSpot(k), { delay: 0.32 + j * 0.012, dur: 0.18, queue: true });
    });
    const moves = new Map();
    let t = 0.9;
    const mine = [...(Array.isArray(v.hands[me]) ? v.hands[me] : [])];
    for (let i = 0; i < count(v.hands[0]) + count(v.hands[1]); i++) {
      const p = (v.starter + i) % 2;
      const c = model.talon.pop();
      cards.setFace(c, p === me ? mine.shift() ?? null : null);
      model.hands[p].push(c);
      moves.set(c, { delay: t, queue: true, sound: 0.5 });
      t += 0.13;
    }
    const first = model.talon.pop();
    cards.setFace(first, v.pile[0]);
    model.pile.push(first);
    moves.set(first, { delay: t + 0.2, queue: true });
    layout(moves);
  }

  // Ereignisse der letzten Aktion nacheinander abspielen
  function playEvents(v) {
    const moves = new Map();
    let t = 0;
    for (const e of v.events) {
      if (e.type === 'play') {
        const hand = model.hands[e.player];
        const c = e.player === me ? hand.find((x) => x.id === e.card) : hand[Math.floor(hand.length / 2)];
        if (!c) return rebuild(v);
        hand.splice(hand.indexOf(c), 1);
        cards.setFace(c, e.card);
        model.pile.push(c);
        moves.set(c, { delay: t, sound: 0.9 });
        t += 0.4;
      } else if (e.type === 'draw') {
        for (let i = 0; i < e.count; i++) {
          const c = model.talon.pop();
          if (!c) return rebuild(v);
          cards.setFace(c, e.player === me ? e.cards?.[i] ?? null : null);
          model.hands[e.player].push(c);
          moves.set(c, { delay: t, sound: 0.45 });
          t += 0.16;
        }
        t += 0.15;
      } else if (e.type === 'shuffle') {
        const back = model.pile.splice(0, model.pile.length - 1);
        back.forEach((c, k) => {
          model.talon.push(c);
          moves.set(c, { delay: t + k * 0.02, sound: 0.2, onStart: k === 0 ? playShuffle : undefined });
        });
        t += 0.5 + back.length * 0.02;
        // die oberste Karte bleibt liegen und sinkt erst, wenn die anderen weg sind
        if (!moves.has(model.pile[0])) moves.set(model.pile[0], { delay: t - 0.1, lift: 0, sound: 0 });
      }
    }
    if (!matches(v)) return rebuild(v); // Anzeige passt nicht zum Stand → ohne Animation neu aufbauen
    layout(moves);
  }

  function matches(v) {
    const ids = (p) => model.hands[p].map((c) => c.id).sort().join();
    return model.talon.length === v.talon
      && model.pile.length === v.pile.length && model.pile.every((c, k) => c.id === v.pile[k])
      && [0, 1].every((p) => (Array.isArray(v.hands[p]) ? ids(p) === [...v.hands[p]].sort().join() : model.hands[p].length === v.hands[p]));
  }

  function reset() {
    shown = null;
    hover = null;
    setGlow('hover', []);
    canPlay = null;
    me = 0;
    chip.visible = false;
    rebuild({ talon: DECK, pile: [], hands: [0, 0] });
  }

  reset();

  return {
    group: cards.group,
    loose: () => [...pool.map((c) => c.mesh), chip], // kein Brett – beim Umwerfen fliegen die Karten (tisch.js)
    setDesign: (s) => setCardBack(s.cardBack), // Kartenrücken dieses PCs
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // v = Sicht eines Spielers (viewFor), player = wer zuschaut
    sync(v, player) {
      if (!v || v === shown) return;
      me = player;
      if (shown && matches(v)) layout(); // z. B. derselbe Stand nochmal geschickt
      else if (v.events[0]?.type === 'deal') deal(v);
      else if (shown && v.seq === shown.seq + 1) playEvents(v);
      else rebuild(v);
      shown = v;
      chip.visible = SUITS.includes(v.wish);
      chip.rotation.y = Math.PI / 2 + sideOf(player); // Bild des Zylinderdeckels zeigt sonst nach +x
      if (chip.visible) chip.material[1].map = suitChip(v.wish);
    },
    // ids = Karten, die gerade gelegt werden dürfen (die übrigen werden dunkler), null = alle normal
    setPlayable(ids) {
      canPlay = ids;
      layout();
    },
    setHover(id) {
      const c = model.hands[me].find((x) => x.id === id) ?? null;
      if (c === hover) return;
      hover = c;
      setGlow('hover', c ? [c.mesh] : []);
      layout();
    },
    // eigene Karte unter der Maus (Kartentext) oder null
    pickHand: (raycaster) => cards.pick(raycaster, model.hands[me])?.id ?? null,
    // Karte zu einem Mesh (mit der Hand gepackt, tisch.js): { id, from: 'hand' | 'talon' } oder null (andere Karte)
    cardOf(mesh) {
      const c = mesh.userData.card;
      if (model.hands[me].includes(c)) return { id: c.id, from: 'hand' };
      return c && c === model.talon.at(-1) ? { id: null, from: 'talon' } : null;
    },
    // Wo auf dem Tisch ein Punkt (Welt) liegt: 'pile' (auf der Ablage), 'hand' (vor mir) oder null
    zoneAt(point) {
      const p = cards.group.worldToLocal(point.clone());
      if (Math.hypot(p.x - PILE.x, p.z - PILE.z) < 9) return 'pile';
      return (me === 0 ? p.z : -p.z) > 12 ? 'hand' : null;
    },
    hitTalon: (raycaster) => raycaster.intersectObject(talonHit, false).length > 0,
  };
}
