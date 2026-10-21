// Schwimmen-Tisch: in der Mitte drei offene Karten (beim Geben der zweite Satz des Gebers verdeckt), der verdeckte
// Stapel vorn rechts, beiseitegelegte Mitten vorn links. Die eigene Hand offen als Fächer, die anderen verdeckt an
// ihren Plätzen. Vor jedem Platz rechts drei Streichhölzer = Leben; verlorene liegen im Topf hinten links. Wer keins
// mehr hat, schwimmt – dann liegt dort ein Rettungsring. Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor)
// und spielt die Ereignisse der letzten Aktion als Kartenflüge ab. Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, 1 auf −x, 2 auf −z, 3 auf +x) – die Tisch-Physik (tisch.js) erkennt
// Teile an ihrer Stelle. Nur die Drehung offener Karten ist je PC verschieden: Sie liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { canvasTexture } from '../textures.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';

const DECK = 32;
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Drehung um die Hochachse: +z-Platz → Platz des Sitzes
const HAND = { at: new THREE.Vector3(0, 7.5, 34), tilt: 0.95, width: 12, gap: 5, angle: 0.12 };
const MID_X = 7.4; // Abstand der drei Karten in der Mitte
const TALON = { x: 24, z: 22 };
const DISCARD = { x: -24, z: 22 };
const POT = { x: -23, z: -21 }; // verlorene Leben
const LIFE = { x: 13, z: 24, gap: 1.5 }; // Streichhölzer rechts vor dem Platz (aus Sicht des Sitzes auf +z)
const REVEAL_R = 23; // Rundenende: Karten offen vor den Spielern
const UP = new THREE.Vector3(0, 1, 0);

const around = (v, seat) => v.clone().applyAxisAngle(UP, SIDE[seat]);
const count = (h) => (Array.isArray(h) ? h.length : h);

// Streichholz: Holzstab mit rotem Kopf, liegt längs zur Tischmitte
function makeMatch(wood, head) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 4.6), wood);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), head);
  tip.scale.set(1, 0.95, 1.45);
  tip.position.z = -2.35;
  stick.castShadow = tip.castShadow = true;
  g.add(stick, tip);
  return g;
}

// Rettungsring: rot-weiß gestreift
function ringTexture() {
  return canvasTexture(256, 32, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f3efe6' : '#c4271f';
      g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
  });
}

export function createSchwimmenBoard(parent) {
  const cards = createCards(parent);
  const pool = Array.from({ length: DECK }, () => cards.make());
  const wood = new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 0.85 });
  const head = new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.7 });
  // je Sitz 3 Streichhölzer (als „Karte“ für cards.fly: { mesh, target })
  const sticks = [0, 1, 2, 3].map(() => [0, 1, 2].map(() => {
    const mesh = makeMatch(wood, head);
    cards.group.add(mesh);
    return { mesh, target: null };
  }));
  const ringMat = new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.6 });
  const rings = [0, 1, 2, 3].map(() => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.65, 12, 32), ringMat);
    mesh.castShadow = true;
    mesh.visible = false;
    cards.group.add(mesh);
    return { mesh, target: null };
  });
  let model = empty();
  let shown = null;
  let me = 0;
  let hover = null;
  let picked = { hand: [], middle: [] }; // ausgewählte Karten (Kennungen)

  function empty() {
    return { talon: [], discard: [], middle: [], spare: [], hands: [[], [], [], []] };
  }

  const turn = () => SIDE[me];
  const midX = (i) => (i - 1) * MID_X;
  // Mitte: auf beiden PCs an derselben Stelle (Karte 0 bei −x), nur zum Zuschauer hin gedreht
  const midSpot = (i, raise = 0, faceUp = true) => flat(midX(i), raise, 0, turn(), faceUp);
  const talonSpot = (k) => flat(TALON.x, k * CARD.t, TALON.z, 0.04, false);
  const discardSpot = (k) => flat(DISCARD.x, k * CARD.t, DISCARD.z, -0.06 + ((k * 7) % 5) * 0.03, false);
  const reveal = () => shown?.phase === 'over';

  // Alle Karten an ihren Platz; moves = Karten, die gerade den Ort wechseln (mit Startverzögerung)
  function layout(moves = new Map(), instant = false) {
    if (hover && !model.hands[me].includes(hover)) hover = null;
    const spots = new Map();
    model.talon.forEach((c, k) => spots.set(c, talonSpot(k)));
    model.discard.forEach((c, k) => spots.set(c, discardSpot(k)));
    model.spare.forEach((c, i) => spots.set(c, midSpot(i, CARD.t, false)));
    model.middle.forEach((c, i) => spots.set(c, midSpot(i, picked.middle.includes(c.id) ? 0.8 : 0)));
    for (const seat of [0, 1, 2, 3]) {
      const hand = model.hands[seat];
      hand.forEach((c, i) => {
        if (reveal()) {
          const p = around(new THREE.Vector3((i - (hand.length - 1) / 2) * 6.8, 0, REVEAL_R), seat);
          return spots.set(c, flat(p.x, 0, p.z, turn()));
        }
        const up = seat === me && picked.hand.includes(c.id) ? 2.2 : seat === me && c === hover ? 1 : 0;
        spots.set(c, fan(i, hand.length, { ...HAND, side: SIDE[seat], raise: up, tilt: seat === me ? HAND.tilt : 0.35 }));
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
    const lit = [...model.middle.filter((c) => picked.middle.includes(c.id)), ...model.hands[me].filter((c) => picked.hand.includes(c.id))];
    setGlow('hover', [...lit, ...(hover && !lit.includes(hover) ? [hover] : [])].map((c) => c.mesh));
  }

  // Leben: Streichhölzer vor dem Platz, verlorene im Topf; schwimmt jemand, liegt dort der Ring
  function lives(v, instant = false) {
    let lost = 0;
    for (const seat of [0, 1, 2, 3]) {
      const playing = !!v && v.phase !== 'setup' && v.seats.includes(seat);
      const out = playing && v.gone[seat] !== null;
      const left = playing && !out ? v.lives[seat] : 0;
      sticks[seat].forEach((m, i) => {
        m.mesh.visible = playing;
        if (!playing) return;
        let spot;
        if (i < left) {
          const p = around(new THREE.Vector3(LIFE.x + (i - 1) * LIFE.gap, 0, LIFE.z), seat);
          spot = { pos: new THREE.Vector3(p.x, 0.15, p.z), quat: new THREE.Quaternion().setFromAxisAngle(UP, SIDE[seat] + (i - 1) * 0.06) };
        } else {
          const k = lost++;
          const a = k * 2.39996; // Sonnenblumen-Muster: ein kleiner Haufen
          spot = {
            pos: new THREE.Vector3(POT.x + Math.cos(a) * Math.sqrt(k) * 0.9, 0.15 + (k % 3) * 0.29, POT.z + Math.sin(a) * Math.sqrt(k) * 0.9),
            quat: new THREE.Quaternion().setFromAxisAngle(UP, k * 1.1),
          };
        }
        if (instant || !m.target) {
          m.target = spot;
          m.mesh.position.copy(spot.pos);
          m.mesh.quaternion.copy(spot.quat);
        } else cards.fly(m, spot, { lift: 4, dur: 0.6 });
      });
      const ring = rings[seat];
      ring.mesh.visible = playing && !out && left === 0;
      const p = around(new THREE.Vector3(LIFE.x, 0, LIFE.z), seat);
      const spot = { pos: new THREE.Vector3(p.x, 0.65, p.z), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) };
      ring.target = spot;
      ring.mesh.position.copy(spot.pos);
      ring.mesh.quaternion.copy(spot.quat);
    }
  }

  // Ohne Animation genau den Stand herstellen
  function rebuild(v) {
    cards.finish();
    hover = null;
    let k = 0;
    const next = (id) => {
      const c = pool[k++];
      cards.setFace(c, id ?? null);
      return c;
    };
    const ids = (x) => (Array.isArray(x) ? x.map((id) => next(id)) : Array.from({ length: x ?? 0 }, () => next(null)));
    model = empty();
    model.hands = [0, 1, 2, 3].map((p) => ids(v.hands?.[p] ?? 0));
    model.middle = ids(v.middle ?? []);
    model.spare = ids(count(v.spare ?? 0));
    model.discard = ids(count(v.discard ?? 0));
    model.talon = ids(count(v.talon ?? 0));
    while (k < DECK) model.talon.unshift(next(null)); // im Aufbau: alle Karten im Stapel
    layout(new Map(), true);
  }

  // Neue Runde: alles zum Stapel, mischen, reihum je eine Karte (dreimal), dann der zweite Satz des Gebers in die Mitte
  function deal(v) {
    rebuild({ hands: [0, 0, 0, 0] });
    model.talon.forEach((c, k) => {
      const shift = k % 2 ? 3.6 : -3.6;
      cards.fly(c, flat(TALON.x + shift, (k >> 1) * CARD.t, TALON.z, 0.04 + (k % 2 ? -0.25 : 0.25), false), { dur: 0.25, lift: 0.5, onStart: k === 0 ? playShuffle : undefined });
      cards.fly(c, talonSpot(k), { delay: 0.32 + k * 0.01, dur: 0.18, queue: true });
    });
    const order = [];
    for (let p = (v.dealer + 1) % 4, n = 0; n < 4; p = (p + 1) % 4, n++) if (count(v.hands[p])) order.push(p);
    const mine = Array.isArray(v.hands[me]) ? [...v.hands[me]] : [];
    const moves = new Map();
    let t = 0.9;
    for (let i = 0; i < 3; i++) {
      for (const p of order) {
        const c = model.talon.pop();
        cards.setFace(c, p === me ? mine.shift() ?? null : null);
        model.hands[p].push(c);
        moves.set(c, { delay: t, queue: true, sound: 0.35 });
        t += 0.09;
      }
    }
    for (let i = 0; i < count(v.spare); i++) {
      const c = model.talon.pop();
      model.spare.push(c);
      moves.set(c, { delay: t + 0.15, queue: true, sound: 0.35 });
      t += 0.09;
    }
    layout(moves);
  }

  // Karte aus einer Hand: eigene nach Kartentext, beim anderen die, die gerade dort liegt (sie sind verdeckt).
  // skip = in dieser Aktion schon bewegte Karten
  function fromHand(seat, id, i, skip = []) {
    const hand = model.hands[seat];
    const free = hand.filter((x) => !skip.includes(x));
    return free.find((x) => x.id === id) ?? (seat === me ? null : free[Math.min(i, free.length - 1)] ?? null);
  }

  function playEvents(v) {
    const moves = new Map();
    let t = 0;
    for (const e of v.events) {
      if (e.type === 'choose') {
        if (model.spare.length !== 3) return rebuild(v);
        if (e.keep) {
          model.middle = model.spare.map((c, i) => {
            const id = e.middle[i];
            moves.set(c, { delay: t + i * 0.12, lift: 1.5, sound: 0.5, onStart: () => cards.setFace(c, id) });
            c.id = id;
            return c;
          });
        } else {
          const hand = model.hands[e.player];
          const moved = [];
          model.middle = e.middle.map((id) => {
            const c = fromHand(e.player, id, 0, moved);
            if (!c) return null;
            moved.push(c);
            moves.set(c, { delay: t + moved.length * 0.12, lift: 2.5, sound: 0.6, onStart: () => cards.setFace(c, id) });
            c.id = id;
            return c;
          });
          if (model.middle.includes(null)) return rebuild(v);
          const mine = e.player === me && Array.isArray(v.hands[me]) ? v.hands[me] : null;
          model.hands[e.player] = model.spare.map((c, i) => {
            if (mine) cards.setFace(c, mine[i]);
            moves.set(c, { delay: t + 0.4 + i * 0.12, lift: 2, sound: 0.4 });
            return c;
          });
          if (hand.some((c) => !model.middle.includes(c))) return rebuild(v);
        }
        model.spare = [];
        t += 0.6;
      } else if (e.type === 'swap') {
        const hand = model.hands[e.player];
        const moved = [];
        e.give.forEach((id, i) => {
          const h = fromHand(e.player, id, 0, moved);
          const m = model.middle.find((x) => x.id === e.take[i]);
          if (!h || !m) return;
          hand[hand.indexOf(h)] = m;
          model.middle[model.middle.indexOf(m)] = h;
          moved.push(m);
          h.id = id;
          moves.set(h, { delay: t, lift: 2.5, sound: 0.8, onStart: () => cards.setFace(h, id) });
          // in fremde Hände verdeckt (wie beim Austeilen) – sonst zeigte der Fächer des anderen die Vorderseite
          moves.set(m, { delay: t + 0.1, lift: 2.5, sound: 0.5, onStart: e.player === me || reveal() ? undefined : () => cards.setFace(m, null) });
          t += 0.15;
        });
        t += 0.2;
      } else if (e.type === 'renew') {
        model.middle.forEach((c, i) => {
          model.discard.push(c);
          moves.set(c, { delay: t + i * 0.08, lift: 2, sound: 0.4, onStart: () => cards.setFace(c, null) });
        });
        t += 0.4;
        if (e.mixed) {
          model.talon.unshift(...model.discard.splice(0));
          playShuffle();
        }
        model.middle = e.cards.map((id, i) => {
          const c = model.talon.pop();
          if (!c) return null;
          c.id = id;
          moves.set(c, { delay: t + i * 0.12, lift: 2, sound: 0.6, onStart: () => cards.setFace(c, id) });
          return c;
        });
        if (model.middle.includes(null)) return rebuild(v);
        t += 0.4;
      } else if (e.type === 'knock') {
        playHit('wood', 0.9, 0.05);
        playHit('wood', 0.8, 0.3);
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
    return model.talon.length === count(v.talon) && model.discard.length === count(v.discard) && model.spare.length === count(v.spare)
      && same(ids(model.middle), v.middle) && [0, 1, 2, 3].every(hand);
  }

  // Rundenende: Karten aller Spieler bekommen ihr Bild (liegen dann offen vor ihnen)
  function showRest(v) {
    for (const p of [0, 1, 2, 3]) {
      if (!Array.isArray(v.hands[p]) || v.hands[p].length !== model.hands[p].length) continue;
      model.hands[p].forEach((c, i) => {
        if (p !== me || !c.id) cards.setFace(c, v.hands[p][i]);
      });
    }
  }

  function reset() {
    shown = null;
    hover = null;
    picked = { hand: [], middle: [] };
    me = 0;
    setGlow('hover', []);
    rebuild({ hands: [0, 0, 0, 0] });
    lives(null, true);
  }

  reset();

  return {
    group: cards.group,
    // Karten, Streichhölzer und Ringe fliegen beim Umwerfen einzeln (tisch.js) – feste Reihenfolge auf beiden PCs
    loose: () => [...pool.map((c) => c.mesh), ...sticks.flat().map((m) => m.mesh), ...rings.map((r) => r.mesh)],
    setDesign: (s) => setCardBack(s.cardBack),
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut
    sync(v, seat) {
      if (!v || v === shown) return;
      const turned = me !== seat;
      me = seat;
      const prev = shown;
      shown = v;
      if (v.phase === 'setup') rebuild(v);
      else if (v.events[0]?.type === 'deal') deal(v);
      else if (!turned && prev && prev.phase !== 'setup' && matches(v)) {
        if (reveal()) showRest(v);
        layout();
      } else if (!turned && prev && prev.phase !== 'setup' && v.events[0]?.type !== 'caught' && v.seq === prev.seq + 1) playEvents(v);
      else {
        rebuild(v);
        if (reveal()) showRest(v);
        layout();
      }
      lives(v, !prev || turned);
    },
    // Ausgewählte Karten: eigene heben sich, die aus der Mitte auch und leuchten
    setPicked(next) {
      picked = { hand: [...next.hand], middle: [...next.middle] };
      layout();
    },
    setHover(id) {
      const c = id ? model.hands[me].find((x) => x.id === id) ?? null : null;
      if (c === hover) return;
      hover = c;
      layout();
    },
    pickHand: (raycaster) => (reveal() ? null : cards.pick(raycaster, model.hands[me])?.id ?? null),
    pickMiddle: (raycaster) => (reveal() ? null : cards.pick(raycaster, model.middle)?.id ?? null),
    // Karte zu einem Mesh (mit der Hand gepackt, tisch.js): { id, from: 'hand' | 'middle' } oder null
    cardOf(mesh) {
      const c = mesh.userData.card;
      if (c && model.hands[me].includes(c)) return { id: c.id, from: 'hand' };
      return c && model.middle.includes(c) ? { id: c.id, from: 'middle' } : null;
    },
    // Wo liegt ein Punkt (Welt)? 'middle' (Tischmitte), 'hand' (vor mir) oder null
    zoneAt(point) {
      const p = cards.group.worldToLocal(point.clone()).applyAxisAngle(UP, -SIDE[me]);
      if (Math.abs(p.x) < 13 && Math.abs(p.z) < 8) return 'middle';
      return p.z > 18 && Math.abs(p.x) < 20 ? 'hand' : null;
    },
    // Karte der Mitte bzw. eigene Handkarte, die einem Punkt am nächsten liegt (nach links/rechts aus meiner Sicht)
    nearestMiddle(point) {
      const x = cards.group.worldToLocal(point.clone()).x; // die Mitte liegt auf beiden PCs gleich
      const i = [0, 1, 2].sort((a, b) => Math.abs(midX(a) - x) - Math.abs(midX(b) - x))[0];
      return model.middle[i]?.id ?? null;
    },
    nearestHand(point) {
      const x = cards.group.worldToLocal(point.clone()).applyAxisAngle(UP, -SIDE[me]).x;
      const hand = model.hands[me];
      const at = (c) => fan(hand.indexOf(c), hand.length, { ...HAND, side: 0 }).pos.x;
      return [...hand].sort((a, b) => Math.abs(at(a) - x) - Math.abs(at(b) - x))[0]?.id ?? null;
    },
  };
}
