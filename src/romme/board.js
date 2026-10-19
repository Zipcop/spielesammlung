// Rommé-Tisch: Nachziehstapel und Ablage in der Mitte, die Figuren jedes Spielers in zwei Reihen vor seinem Platz,
// eigene Hand als Fächer (ausgewählte Karten angehoben), verdeckte Hand des Mitspielers. Kennt keine Regeln: zeigt die
// Sicht eines Spielers (viewFor) und spielt die Ereignisse der letzten Aktion als Kartenflüge ab.
// Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Spieler 0 auf +z) – die Tisch-Physik (tisch.js) erkennt Teile an ihrer Stelle.
// Nur die Drehung ist je PC verschieden: Offene Karten liegen für den, der zuschaut, aufrecht; in einer Figur liegt die
// Karte rechts (von ihm aus gesehen) oben, damit von jeder Karte die linke obere Ecke zu sehen ist.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { RANKS } from '../karten/cards.js';
import { faceOf, isJoker, suitOf, rankOf } from './game.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';

const DECK = 110;
const TALON = { x: -8, z: 0 };
const PILE = { x: 2, z: 0 };
const HAND = { at: new THREE.Vector3(0, 7.5, 34), tilt: 0.95, width: 34 }; // Platz auf der +z-Seite, der andere gegenüber
const ROWS = [9.9, 19.1]; // Mitte der beiden Figuren-Reihen vor einem Platz (z)
const ROW_W = 72; // so breit dürfen die Reihen werden (rechts liegt das Seitenfeld)
const REVEAL_Z = 31; // aufgedeckte Restkarten am Rundenende
const SUIT_ORDER = ['c', 'h', 's', 'd']; // Hand nach Farbe: Kreuz, Herz, Pik, Karo – schwarz und rot im Wechsel
const sideOf = (player) => (player === 0 ? 0 : Math.PI);
const signOf = (player) => (player === 0 ? 1 : -1);

const talonSpot = (k) => flat(TALON.x, k * CARD.t, TALON.z, 0.03, false);

export function createRommeBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  let model = { talon: [], pile: [], melds: [], hands: [[], []] }; // Kartenobjekte je Ort
  let shown = null;
  let me = 0;
  let hover = null; // Kartenobjekt unter der Maus
  let selected = new Set(); // ausgewählte Handkarten (Kartentexte)
  let sort = 'suit'; // Hand nach Farbe oder nach Wert
  let reveal = false; // Rundenende: Karten des anderen offen hinlegen
  let meldSpots = new Map(); // Figur → Lagen ihrer Karten (für Klicks und Ablegen mit der Hand)

  // Klickflächen von Stapel und Ablage – auch wenn sie gerade leer sind
  const hitBox = (x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, 1.2, CARD.h), new THREE.MeshBasicMaterial());
    m.position.set(x, 0.6, z);
    m.visible = false;
    cards.group.add(m);
    return m;
  };
  const talonHit = hitBox(TALON.x, TALON.z);
  const pileHit = hitBox(PILE.x, PILE.z);

  // Rommé-Kartentext merken, auf der Karte das Bild dazu (null = verdeckt)
  function setFace(c, id) {
    c.rid = id;
    cards.setFace(c, id ? faceOf(id) : null);
  }

  const order = (id) => {
    if (isJoker(id)) return 1000;
    const r = RANKS.indexOf(rankOf(id));
    const s = SUIT_ORDER.indexOf(suitOf(id));
    return sort === 'suit' ? s * 20 + r : r * 4 + s;
  };
  const myHand = () => [...model.hands[me]].sort((a, b) => order(a.rid) - order(b.rid) || (a.rid < b.rid ? -1 : 1));

  // Ablage etwas unordentlich – aus der Lage im Stapel berechnet, damit beide dasselbe sehen
  const pileSpot = (k) => flat(PILE.x + ((k * 31) % 7 - 3) * 0.18, k * CARD.t, PILE.z + ((k * 17) % 5 - 2) * 0.18, ((k * 7919) % 13 - 6) * 0.035 + sideOf(me));

  // Lagen aller Figuren: je Spieler in Reihen von seiner linken zur rechten Hand; reicht der Platz nicht, rücken die Karten enger
  function layoutMelds() {
    const spots = new Map();
    for (const p of [0, 1]) {
      const mine = model.melds.map((m, i) => i).filter((i) => shown?.melds[i]?.owner === p);
      let step = 2.1;
      let gap = 2.4;
      let place = null;
      for (let tries = 0; tries < 4; tries++) {
        place = [];
        let row = 0;
        let x = 0;
        for (const i of mine) {
          const w = CARD.w + (model.melds[i].length - 1) * step;
          if (x > 0 && x + w > ROW_W) [row, x] = [row + 1, 0];
          place.push({ i, row, x });
          x += w + gap;
        }
        if (!place.length || place.at(-1).row < ROWS.length) break;
        step -= 0.25;
        gap -= 0.5;
      }
      for (const { i, row, x } of place) {
        const n = model.melds[i].length;
        const z = signOf(p) * (ROWS[row] ?? ROWS.at(-1) + 9 * (row - ROWS.length + 1));
        spots.set(i, model.melds[i].map((c, k) => {
          const local = x + CARD.w / 2 + k * step - ROW_W / 2; // von links nach rechts, aus Sicht des Besitzers
          const stack = p === me ? k : n - 1 - k; // von mir aus gesehen rechte Karte oben
          return flat(signOf(p) * local, stack * CARD.t * 1.1, z, sideOf(me));
        }));
      }
    }
    return spots;
  }

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln, mit Startverzögerung
  function layout(moves = new Map(), instant = false) {
    if (hover && !located(hover)) hover = null;
    const spots = new Map();
    model.talon.forEach((c, k) => spots.set(c, talonSpot(k)));
    model.pile.forEach((c, k) => spots.set(c, pileSpot(k)));
    meldSpots = layoutMelds();
    for (const [i, list] of meldSpots) model.melds[i].forEach((c, k) => spots.set(c, list[k]));
    const hand = myHand();
    hand.forEach((c, i) => {
      const raise = (selected.has(c.rid) ? 2.2 : 0) + (c === hover ? 0.9 : 0);
      spots.set(c, fan(i, hand.length, { ...HAND, side: sideOf(me), raise }));
    });
    const theirs = model.hands[1 - me];
    theirs.forEach((c, i) => {
      if (!reveal) return spots.set(c, fan(i, theirs.length, { ...HAND, side: sideOf(1 - me) }));
      const step = Math.min(2.6, 60 / Math.max(theirs.length, 1));
      const local = (i - (theirs.length - 1) / 2) * step;
      spots.set(c, flat(signOf(1 - me) * local, (theirs.length - 1 - i) * CARD.t * 1.1, signOf(1 - me) * REVEAL_Z, sideOf(me))); // von mir aus rechte Karte oben
    });
    for (const [c, spot] of spots) {
      const m = moves.get(c);
      if (instant) cards.place(c, spot);
      else if (m) {
        cards.fly(c, spot, {
          delay: m.delay, lift: m.lift ?? 3, queue: m.queue, onStart: m.onStart,
          onLand: (quiet) => {
            m.land?.();
            if (!quiet) playHit('card', m.sound ?? 0.6);
          },
        });
      }
      else cards.fly(c, spot, { dur: 0.22 });
    }
    setGlow('hover', hover ? [hover.mesh] : []);
    setGlow('selected', hand.filter((c) => selected.has(c.rid)).map((c) => c.mesh));
  }

  const located = (c) => model.hands[me].includes(c) || model.talon.at(-1) === c || model.pile.at(-1) === c || model.melds.some((m) => m.includes(c));

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null;
    let k = 0;
    const next = (id) => {
      const c = pool[k++];
      setFace(c, id);
      return c;
    };
    const hand = (p) => (Array.isArray(v.hands[p]) ? v.hands[p].map(next) : Array.from({ length: v.hands[p] }, () => next(null)));
    model = {
      talon: Array.from({ length: v.talon }, () => next(null)),
      pile: v.pile.map(next),
      melds: v.melds.map((m) => m.cards.map(next)),
      hands: [hand(0), hand(1)],
    };
    while (k < pool.length) model.talon.unshift(next(null)); // sollte nie nötig sein – keine Karte bleibt irgendwo liegen
    layout(new Map(), true);
  }

  // Neues Spiel: alles zum Stapel, mischen, abwechselnd austeilen (der Anfänger bekommt 14)
  function deal(v) {
    rebuild({ talon: DECK, pile: [], melds: [], hands: [0, 0] });
    const half = DECK / 2;
    model.talon.forEach((c, k) => {
      const left = k < half;
      const j = left ? k : k - half;
      cards.fly(c, flat(TALON.x + (left ? -3.8 : 3.8), j * CARD.t, TALON.z, left ? 0.25 : -0.25, false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, talonSpot(k), { delay: 0.32 + j * 0.006, dur: 0.18, queue: true });
    });
    const moves = new Map();
    let t = 0.9;
    const mine = [...(Array.isArray(v.hands[me]) ? v.hands[me] : [])];
    const n = handCount(v, 0) + handCount(v, 1);
    for (let i = 0; i < n; i++) {
      const p = (v.starter + i) % 2;
      const c = model.talon.pop();
      setFace(c, p === me ? mine.shift() ?? null : null);
      model.hands[p].push(c);
      moves.set(c, { delay: t, queue: true, sound: 0.5 });
      t += 0.09;
    }
    layout(moves);
  }

  // Karte aus der Hand eines Spielers: eigene nach Kartentext, beim anderen eine aus der Mitte (sie sind verdeckt)
  function fromHand(player, id) {
    const hand = model.hands[player];
    const c = hand.find((x) => x.rid === id) ?? (player === me ? null : hand[Math.floor(hand.length / 2)]);
    if (c) hand.splice(hand.indexOf(c), 1);
    return c;
  }

  // Karten in der Hand des anderen sind verdeckt – eine offen aufgenommene (Ablage, Joker) verliert ihr Bild,
  // sobald sie dort angekommen ist (sonst zeigte sie nach dem Umwerfen des Tischs ein altes Bild)
  const hideIn = (player, c) => () => {
    if (player !== me && !reveal && model.hands[player].includes(c)) setFace(c, null);
  };

  // Ereignisse der letzten Aktion nacheinander abspielen
  function playEvents(v) {
    const moves = new Map();
    let t = 0;
    for (const e of v.events) {
      const mine = e.player === me;
      if (e.type === 'draw') {
        const c = e.from === 'pile' ? model.pile.pop() : model.talon.pop();
        if (!c) return rebuild(v);
        if (mine || e.from === 'talon') setFace(c, mine ? e.card ?? null : null);
        model.hands[e.player].push(c);
        moves.set(c, { delay: t, sound: 0.45, land: hideIn(e.player, c) });
        t += 0.3;
      } else if (e.type === 'shuffle') {
        const back = model.pile.splice(0, model.pile.length - 1);
        back.forEach((c, k) => {
          setFace(c, null);
          model.talon.push(c);
          moves.set(c, { delay: t + k * 0.015, sound: 0.2, onStart: k === 0 ? playShuffle : undefined });
        });
        t += 0.5 + back.length * 0.015;
        if (model.pile[0] && !moves.has(model.pile[0])) moves.set(model.pile[0], { delay: t - 0.1, lift: 0, sound: 0 }); // sinkt erst danach
      } else if (e.type === 'meld') {
        const list = e.cards.map((id) => fromHand(e.player, id));
        if (list.some((c) => !c)) return rebuild(v);
        list.forEach((c, k) => {
          setFace(c, e.cards[k]);
          moves.set(c, { delay: t + k * 0.08, sound: 0.7 });
        });
        model.melds[e.index] = list;
        t += 0.5;
      } else if (e.type === 'layoff') {
        const c = fromHand(e.player, e.card);
        const m = model.melds[e.index];
        if (!c || !m) return rebuild(v);
        setFace(c, e.card);
        m.splice(e.at, 0, c);
        moves.set(c, { delay: t, sound: 0.7 });
        t += 0.4;
      } else if (e.type === 'swap') {
        const c = fromHand(e.player, e.card);
        const m = model.melds[e.index];
        const j = m?.find((x) => x.rid === e.joker);
        if (!c || !j) return rebuild(v);
        setFace(c, e.card);
        m[m.indexOf(j)] = c;
        model.hands[e.player].push(j);
        moves.set(c, { delay: t, sound: 0.7 });
        moves.set(j, { delay: t + 0.25, sound: 0.5, land: hideIn(e.player, j) });
        t += 0.6;
      } else if (e.type === 'discard') {
        const c = fromHand(e.player, e.card);
        if (!c) return rebuild(v);
        setFace(c, e.card);
        model.pile.push(c);
        moves.set(c, { delay: t, sound: 0.9 });
        t += 0.4;
      } else if (e.type === 'undo') {
        if (!undoMoves(v, e.player, moves, t)) return rebuild(v);
        t += 0.5;
      }
    }
    // Ein Satz sortiert sich nach einem Tausch neu nach Farbe – Reihenfolge wie im Stand übernehmen
    model.melds.forEach((m, i) => {
      const order = v.melds[i]?.cards;
      if (order && m.length === order.length) m.sort((a, b) => order.indexOf(a.rid) - order.indexOf(b.rid));
    });
    if (!matches(v)) return rebuild(v); // Anzeige passt nicht zum Stand → ohne Animation neu aufbauen
    layout(moves);
  }

  // Zug zurücksetzen: Figuren wie im Stand, alles Übrige zurück auf die Hand des Spielers
  function undoMoves(v, player, moves, t) {
    const onTable = new Map(model.melds.flat().map((c) => [c.rid, c]));
    const melds = [];
    for (const m of v.melds) {
      const list = [];
      for (const id of m.cards) {
        let c = onTable.get(id);
        if (c) onTable.delete(id);
        else c = fromHand(player, id); // z. B. ein Joker, der getauscht war
        if (!c) return false;
        setFace(c, id);
        list.push(c);
        moves.set(c, { delay: t, sound: 0.4 });
      }
      melds.push(list);
    }
    for (const c of onTable.values()) {
      if (player !== me) setFace(c, null);
      model.hands[player].push(c);
      moves.set(c, { delay: t, sound: 0.4 });
    }
    model.melds = melds;
    return true;
  }

  const handCount = (v, p) => (Array.isArray(v.hands[p]) ? v.hands[p].length : v.hands[p]);
  const ids = (list) => list.map((c) => c.rid);

  function matches(v) {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const hand = (p) => (p === me && Array.isArray(v.hands[p]) ? same(ids(model.hands[p]).sort(), [...v.hands[p]].sort()) : model.hands[p].length === handCount(v, p));
    return model.talon.length === v.talon
      && same(ids(model.pile), v.pile)
      && model.melds.length === v.melds.length && v.melds.every((m, i) => same(ids(model.melds[i]), m.cards))
      && hand(0) && hand(1);
  }

  // Rundenende: Restkarten des anderen aufdecken
  function showRest(v) {
    const theirs = v.hands[1 - me];
    if (!Array.isArray(theirs) || theirs.length !== model.hands[1 - me].length) return;
    model.hands[1 - me].forEach((c, i) => setFace(c, theirs[i]));
  }

  function reset() {
    shown = null;
    hover = null;
    selected = new Set();
    reveal = false;
    me = 0;
    setGlow('hover', []);
    setGlow('selected', []);
    rebuild({ talon: DECK, pile: [], melds: [], hands: [0, 0] });
  }

  reset();

  // Welche Figur liegt unter einem Punkt (Brett-Koordinaten) – mit dem näheren Ende
  function meldAt(p) {
    for (const [index, list] of meldSpots) {
      const xs = list.map((s) => s.pos.x);
      const z = list[0].pos.z;
      if (Math.abs(p.z - z) > CARD.h / 2 + 0.5 || p.x < Math.min(...xs) - CARD.w / 2 - 0.5 || p.x > Math.max(...xs) + CARD.w / 2 + 0.5) continue;
      const near = (k) => Math.abs(list[k].pos.x - p.x);
      return { index, end: near(0) <= near(list.length - 1) ? 'low' : 'high' };
    }
    return null;
  }

  return {
    group: cards.group,
    loose: () => pool.map((c) => c.mesh), // kein Brett – beim Umwerfen fliegen die Karten (tisch.js)
    setDesign: (s) => setCardBack(s.cardBack), // Kartenrücken dieses PCs
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // v = Sicht eines Spielers (viewFor), player = wer zuschaut
    sync(v, player) {
      if (!v || v === shown) return;
      me = player;
      const prev = shown;
      shown = v;
      reveal = v.winner !== null;
      selected = new Set([...selected].filter((id) => Array.isArray(v.hands[me]) && v.hands[me].includes(id)));
      if (prev && matches(v)) layout(); // z. B. derselbe Stand nochmal geschickt
      else if (v.events[0]?.type === 'deal') deal(v);
      else if (prev && v.seq === prev.seq + 1) playEvents(v);
      else rebuild(v);
      if (reveal) {
        showRest(v);
        layout();
      }
    },
    // Ausgewählte Handkarten (werden angehoben und leuchten)
    setSelected(list) {
      selected = new Set(list);
      layout();
    },
    setSort(how) {
      sort = how;
      layout();
    },
    // Karte unter der Maus leuchten lassen (Kartentext, 'talon', 'pile' oder null)
    setHover(what) {
      const c = what === 'talon' ? model.talon.at(-1) : what === 'pile' ? model.pile.at(-1)
        : model.hands[me].find((x) => x.rid === what) ?? model.melds.flat().find((x) => x.rid === what) ?? null;
      if ((c ?? null) === hover) return;
      hover = c ?? null;
      layout();
    },
    // eigene Karte unter der Maus (Kartentext) oder null
    pickHand: (raycaster) => cards.pick(raycaster, model.hands[me])?.rid ?? null,
    // Figur unter der Maus: { index, card, end } oder null
    pickMeld(raycaster) {
      const c = cards.pick(raycaster, model.melds.flat());
      if (!c) return null;
      const index = model.melds.findIndex((m) => m.includes(c));
      const at = meldAt(cards.group.worldToLocal(raycaster.intersectObject(c.mesh, false)[0]?.point.clone() ?? c.mesh.getWorldPosition(new THREE.Vector3())));
      return { index, card: c.rid, end: at?.index === index ? at.end : 'high' };
    },
    hitTalon: (raycaster) => raycaster.intersectObject(talonHit, false).length > 0 || !!cards.pick(raycaster, model.talon.slice(-1)),
    hitPile: (raycaster) => raycaster.intersectObject(pileHit, false).length > 0 || !!cards.pick(raycaster, model.pile.slice(-1)),
    // Weltpunkt eines Teils für den Rundgang (tutorials.js): 'stapel', 'ablage', 'hand', 'auslage' (vor mir) oder null
    anchor(name) {
      const local = { stapel: [TALON.x, 0, TALON.z], ablage: [PILE.x, 0, PILE.z], hand: [0, HAND.at.y, signOf(me) * HAND.at.z], auslage: [0, 0, signOf(me) * ROWS[0]] }[name];
      return local ? cards.group.localToWorld(new THREE.Vector3(...local)) : null;
    },
    // Karte zu einem Mesh (mit der Hand gepackt, tisch.js): { id, from: 'hand' | 'talon' | 'pile' | 'meld', index } oder null
    cardOf(mesh) {
      const c = mesh.userData.card;
      if (!c) return null;
      if (model.hands[me].includes(c)) return { id: c.rid, from: 'hand' };
      if (c === model.talon.at(-1)) return { id: null, from: 'talon' };
      if (c === model.pile.at(-1)) return { id: c.rid, from: 'pile' };
      const index = model.melds.findIndex((m) => m.includes(c));
      return index >= 0 ? { id: c.rid, from: 'meld', index } : null;
    },
    // Wo auf dem Tisch ein Punkt (Welt) liegt: { zone: 'pile' | 'talon' | 'meld' | 'hand' | 'mine', index, end } oder null.
    // 'mine' = freie Fläche vor mir (dort entsteht eine neue Figur)
    zoneAt(point) {
      const p = cards.group.worldToLocal(point.clone());
      if (Math.hypot(p.x - PILE.x, p.z - PILE.z) < 6) return { zone: 'pile' };
      if (Math.hypot(p.x - TALON.x, p.z - TALON.z) < 6) return { zone: 'talon' };
      const meld = meldAt(p);
      if (meld) return { zone: 'meld', ...meld };
      const z = signOf(me) * p.z;
      if (z > 27) return { zone: 'hand' };
      return z > 5 ? { zone: 'mine' } : null;
    },
  };
}
