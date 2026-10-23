// Doppelkopf-Tisch: vier Hände (die eigene offen als Fächer, die anderen verdeckt an ihren Plätzen), der laufende Stich
// in der Mitte (jede Karte etwas zu dem hin, der sie gelegt hat), gewonnene Stiche als verdeckter Stapel vorn rechts
// vor jedem Spieler. Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) und spielt die Ereignisse der letzten
// Aktion als Kartenflüge ab. Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, 1 auf −x, 2 auf −z, 3 auf +x) – die Tisch-Physik (tisch.js) erkennt
// Teile an ihrer Stelle. Nur die Drehung offener Karten ist je PC verschieden: Sie liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { faceOf, suitOf, rankOf, isTrump, power, orderFrom } from './game.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, seatSide } from '../plates.js';

const DECK = 48;
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung um die Hochachse: +z-Platz → Platz des Sitzes
const HAND = { at: new THREE.Vector3(0, 7.5, 34), tilt: 0.95, width: 34 };
const TRICK_R = 7; // so weit liegt eine Stichkarte von der Mitte zu ihrem Spieler hin
const PILE = new THREE.Vector3(24, 0, 31); // gewonnene Stiche: rechts neben der eigenen Hand (aus Sicht des Spielers auf +z)
const DECK_R = 12; // Kartenstapel beim Austeilen: vor dem Geber
const REVEAL_R = 24; // aufgedeckte Restkarten (erwischt): vor dem Spieler
const PAUSE = 1.1; // so lange bleibt ein voller Stich liegen, bevor er eingesammelt wird
const PLATE = new THREE.Vector3(26, 0, 41); // Namensschild am Rand rechts neben der Hand (aus Sicht des Sitzes auf +z)
const SUIT_ORDER = ['c', 's', 'h', 'd']; // Fehlfarben in der Hand: Kreuz, Pik, Herz, Karo
const FEHL = ['A', 'T', 'K', 'Q', 'J', '9'];

const around = (v, seat) => v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SIDE[seat]);

export function createDokoBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  let model = { deck: [], hands: [[], [], [], []], trick: [], piles: [[], [], [], []] }; // Kartenobjekte je Ort
  let shown = null;
  let me = 0;
  let kind = 'normal';
  let hover = null;
  let playable = null; // Set der Kartentexte, die gerade passen (null = alle hell)
  let reveal = false;
  let clock = 0;
  let collectEnd = 0; // bis dahin liegt der letzte Stich noch in der Mitte (nächste Karte wartet)
  const plates = createPlates(cards.group, 4);

  function setFace(c, id) {
    c.did = id;
    cards.setFace(c, id ? faceOf(id) : null);
  }

  // Hand sortiert: Trümpfe (höchster links), dann Kreuz, Pik, Herz, Karo jeweils Ass bis Neun
  const order = (id) => (isTrump(id, kind) ? 100 - power(id, kind) : 100 + SUIT_ORDER.indexOf(suitOf(id)) * 10 + FEHL.indexOf(rankOf(id)));
  const myHand = () => [...model.hands[me]].sort((a, b) => order(a.did) - order(b.did) || (a.did < b.did ? -1 : 1));

  const deckSpot = (seat, k) => {
    const p = around(new THREE.Vector3(0, 0, DECK_R), seat);
    return flat(p.x, k * CARD.t, p.z, SIDE[seat] + 0.04, false);
  };
  // Stichkarte: leicht verdreht, aufrecht für den Zuschauer
  const trickSpot = (k, seat) => {
    const p = around(new THREE.Vector3(((seat * 7) % 3 - 1) * 0.6, 0, TRICK_R), seat);
    return flat(p.x, k * CARD.t * 1.2, p.z, SIDE[me] + ((seat * 5 + 2) % 7 - 3) * 0.05);
  };
  const pileSpot = (seat, k) => {
    const p = around(PILE, seat);
    const trick = Math.floor(k / 4);
    return flat(p.x + ((trick * 13) % 5 - 2) * 0.12, k * CARD.t * 1.05, p.z + ((trick * 7) % 5 - 2) * 0.12, SIDE[seat] + 0.5 + ((trick * 11) % 7 - 3) * 0.04, false);
  };

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln (mit Startverzögerung)
  function layout(moves = new Map(), instant = false) {
    if (hover && !model.hands[me].includes(hover)) hover = null;
    const spots = new Map();
    model.deck.forEach((c, k) => spots.set(c, deckSpot(shown?.dealer ?? 0, k)));
    model.trick.forEach((c, k) => spots.set(c, trickSpot(k, c.seat)));
    model.piles.forEach((pile, seat) => pile.forEach((c, k) => spots.set(c, pileSpot(seat, k))));
    for (const seat of [0, 1, 2, 3]) {
      const hand = seat === me ? myHand() : model.hands[seat];
      hand.forEach((c, i) => {
        if (reveal) {
          const step = Math.min(2.6, 34 / Math.max(hand.length, 1));
          const p = around(new THREE.Vector3((i - (hand.length - 1) / 2) * step, 0, REVEAL_R), seat);
          return spots.set(c, flat(p.x, i * CARD.t * 1.1, p.z, SIDE[me]));
        }
        const raise = seat === me && c === hover ? 1.2 : 0;
        // fremde Hände flacher – sonst sieht man die seitlichen Fächer nur als Strich
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
    for (const c of model.hands[me]) cards.shade(c, playable && !playable.has(c.did) ? 0.55 : 1);
    setGlow('hover', hover ? [hover.mesh] : []);
  }

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null;
    collectEnd = clock;
    let k = 0;
    const next = (id, seat = null) => {
      const c = pool[k++];
      setFace(c, id);
      cards.shade(c, 1);
      c.seat = seat;
      return c;
    };
    const hand = (p) => (Array.isArray(v.hands[p]) ? v.hands[p].map((id) => next(id)) : Array.from({ length: v.hands[p] }, () => next(null)));
    model = {
      deck: [],
      hands: [hand(0), hand(1), hand(2), hand(3)],
      trick: v.trick.map((x) => next(x.c, x.p)),
      piles: [[], [], [], []],
    };
    for (const t of v.tricks) for (const x of t.cards) model.piles[t.winner].push(next(null, x.p));
    while (k < pool.length) model.deck.push(next(null)); // nur vor dem Austeilen
    layout(new Map(), true);
  }

  // Neues Spiel: alles zum Stapel vor dem Geber, mischen, viermal je drei Karten ab dem linken Nachbarn
  function deal(v) {
    rebuild({ hands: [0, 0, 0, 0], trick: [], tricks: [] });
    const half = DECK / 2;
    model.deck.forEach((c, k) => {
      const left = k < half;
      const j = left ? k : k - half;
      const base = deckSpot(v.dealer, j);
      const shift = around(new THREE.Vector3(left ? -3.8 : 3.8, 0, 0), v.dealer);
      cards.fly(c, flat(base.pos.x + shift.x, j * CARD.t, base.pos.z + shift.z, SIDE[v.dealer] + (left ? 0.25 : -0.25), false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, deckSpot(v.dealer, k), { delay: 0.32 + j * 0.006, dur: 0.18, queue: true });
    });
    const mine = [...(Array.isArray(v.hands[me]) ? v.hands[me] : [])];
    const moves = new Map();
    let t = 0.9;
    for (let packet = 0; packet < 4; packet++) {
      for (const p of orderFrom(v.dealer)) {
        for (let i = 0; i < 3; i++) {
          const c = model.deck.pop();
          setFace(c, p === me ? mine.shift() ?? null : null);
          model.hands[p].push(c);
          moves.set(c, { delay: t, queue: true, sound: 0.45 });
          t += 0.045;
        }
        t += 0.08;
      }
    }
    layout(moves);
  }

  // Karte aus der Hand: eigene nach Kartentext, beim anderen eine aus der Mitte (sie sind verdeckt)
  function fromHand(seat, id) {
    const hand = model.hands[seat];
    const c = hand.find((x) => x.did === id) ?? (seat === me ? null : hand[Math.floor(hand.length / 2)]);
    if (c) hand.splice(hand.indexOf(c), 1);
    return c;
  }

  function playEvents(v) {
    const moves = new Map();
    let t = Math.max(0, collectEnd - clock); // voriger Stich liegt noch – erst einsammeln lassen
    for (const e of v.events) {
      if (e.type === 'play') {
        const c = fromHand(e.player, e.card);
        if (!c) return rebuild(v);
        setFace(c, e.card);
        c.seat = e.player;
        model.trick.push(c);
        cards.fly(c, trickSpot(model.trick.length - 1, e.player), { delay: t, lift: 2.5, onLand: (quiet) => !quiet && playHit('card', 0.8) });
        t += 0.42;
      } else if (e.type === 'trick') {
        const list = model.trick.splice(0);
        if (list.length !== 4) return rebuild(v);
        list.forEach((c, k) => {
          model.piles[e.winner].push(c);
          moves.set(c, { delay: t + PAUSE + k * 0.05, queue: true, lift: 1.5, sound: k === 3 ? 0.5 : 0, onStart: () => setFace(c, null) });
        });
        t += PAUSE + 0.6;
        collectEnd = clock + t;
      }
    }
    if (!matches(v)) return rebuild(v);
    layout(moves);
  }

  const ids = (list) => list.map((c) => c.did);
  function matches(v) {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    // fremde Hände nur nach der Anzahl – aufgedeckte Restkarten bekommen ihr Bild danach (showRest)
    const hand = (p) => (Array.isArray(v.hands[p]) && p === me ? same(ids(model.hands[p]).sort(), [...v.hands[p]].sort()) : model.hands[p].length === (Array.isArray(v.hands[p]) ? v.hands[p].length : v.hands[p]));
    const piles = [0, 1, 2, 3].every((p) => model.piles[p].length === v.tricks.filter((t) => t.winner === p).length * 4);
    return !model.deck.length && same(ids(model.trick), v.trick.map((x) => x.c)) && piles && [0, 1, 2, 3].every(hand);
  }

  // Spielende nach „Geschummelt!“: Restkarten offen vor die Spieler legen
  function showRest(v) {
    for (const p of [0, 1, 2, 3]) {
      if (!Array.isArray(v.hands[p]) || v.hands[p].length !== model.hands[p].length) continue;
      const sorted = [...v.hands[p]].sort((a, b) => order(a) - order(b));
      model.hands[p].forEach((c, i) => setFace(c, sorted[i]));
    }
  }

  function reset() {
    shown = null;
    hover = null;
    playable = null;
    reveal = false;
    me = 0;
    kind = 'normal';
    setGlow('hover', []);
    plates.set([]);
    rebuild({ hands: [0, 0, 0, 0], trick: [], tricks: [] });
  }

  reset();

  return {
    group: cards.group,
    loose: () => pool.map((c) => c.mesh), // kein Brett – beim Umwerfen fliegen die Karten (tisch.js)
    setDesign: (s) => setCardBack(s.cardBack),
    reset,
    update(dt) {
      clock += dt;
      cards.update(dt);
    },
    busy: cards.busy,
    // Namensschilder: labels[sitz] = Text ('' = leerer Platz), turn = wer dran ist (oder null)
    names: (labels, turn = null) => plates.set(labels, { at: (s) => around(new THREE.Vector3(seatSide(s, me) * PLATE.x, 0, PLATE.z), s), view: SIDE[me], turn }),
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut
    sync(v, seat) {
      if (!v || v === shown) return;
      me = seat;
      kind = v.kind;
      const prev = shown;
      shown = v;
      reveal = v.phase === 'over' && v.hands.some((h) => Array.isArray(h) && h.length);
      if (prev && matches(v)) layout();
      else if (v.events[0]?.type === 'deal') deal(v);
      else if (prev && v.seq === prev.seq + 1) playEvents(v);
      else rebuild(v);
      if (reveal) {
        showRest(v);
        layout();
      }
    },
    // Karten, die gerade passen (die anderen werden abgedunkelt) – null = alle hell
    setPlayable(list) {
      playable = list ? new Set(list) : null;
      layout();
    },
    setHover(id) {
      const c = id ? model.hands[me].find((x) => x.did === id) ?? null : null;
      if (c === hover) return;
      hover = c;
      layout();
    },
    pickHand: (raycaster) => cards.pick(raycaster, model.hands[me])?.did ?? null,
    // Karte zu einem Mesh (mit der Hand gepackt, tisch.js): { id, from: 'hand' } oder null
    cardOf(mesh) {
      const c = mesh.userData.card;
      return c && model.hands[me].includes(c) ? { id: c.did, from: 'hand' } : null;
    },
    // Liegt ein Punkt (Welt) in der Tischmitte, wo der Stich entsteht?
    inMiddle(point) {
      const p = cards.group.worldToLocal(point.clone());
      return Math.hypot(p.x, p.z) < 16;
    },
    // Wo ist der Platz eines Sitzes (Welt) – z. B. für Namensschilder
    seatPoint(seat) {
      return cards.group.localToWorld(around(new THREE.Vector3(0, 14, 40), seat));
    },
  };
}
