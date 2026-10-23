// Texas-Hold'em-Tisch: runde Filzmatte mit Polsterrand und Setzlinie, sechs Plätze. Vor jedem Platz: zwei Karten,
// der Chipstapel (Spalten je Chipwert), davor der Einsatz der laufenden Setzrunde, dazu Namensschild und Dealer-Knopf.
// In der Mitte die Gemeinschaftskarten und der Pot. Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) und
// spielt die Ereignisse der letzten Aktion ab – Karten fliegen, Chips rutschen vom Stapel zum Einsatz, in den Pot und
// zum Gewinner. Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, dann im Uhrzeigersinn je 60°, Sitz 3 auf −z) – die Tisch-Physik
// (tisch.js) erkennt Teile an ihrer Stelle. Nur die Drehung offener Karten und der Schilder ist je PC verschieden.
import * as THREE from 'three';
import { createCards, flat, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { feltOf, woodTexture, canvasTexture } from '../textures.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';

const MAT = { r: 44, h: 0.6 }; // Filz (Oberkante = Höhe der Karten und Chips)
const RAIL = { r: 46.5, tube: 3.2 }; // Polsterrand
const Y = MAT.h + 0.02;
const SIDE = [0, 1, 2, 3, 4, 5].map((k) => -k * Math.PI / 3); // Drehung +z-Platz → Platz des Sitzes
const HOLE = new THREE.Vector3(0, 0, 33); // Mitte der beiden Handkarten (aus Sicht des Sitzes auf +z)
const HOLE_TILT = 0.32; // eigene Handkarten zu mir hochgekippt (rad)
const STACK = new THREE.Vector3(12.5, 0, 33); // Chipstapel rechts daneben
const BET = new THREE.Vector3(0, 0, 21.5); // Einsatz der Setzrunde
const BUTTON = new THREE.Vector3(-9.5, 0, 26); // Dealer-Knopf
const PLATE = new THREE.Vector3(0, 0, 40.8); // Namensschild am Rand
const DECK = new THREE.Vector3(-14, 0, 22); // Kartenstapel vor dem Geber (links vom Einsatz)
const POT = new THREE.Vector3(0, 0, -11);
const MUCK = new THREE.Vector3(-20, 0, 11); // abgelegte Karten: links vor dem Geber, neben dem Stapel
const BOARD_STEP = 7.1;
const CHIP = { r: 1.95, h: 0.34 };
const COLUMN = 10; // so viele Chips höchstens übereinander
const CHIPS = [ // Wert, Farbe, Schrift – übliche Casino-Farben
  { value: 5000, color: '#8a4a1c', ink: '#ffffff' },
  { value: 1000, color: '#e0b020', ink: '#222222' },
  { value: 500, color: '#6a2d93', ink: '#ffffff' },
  { value: 100, color: '#1c1c1c', ink: '#ffffff' },
  { value: 25, color: '#1f7d3d', ink: '#ffffff' },
  { value: 5, color: '#c0232b', ink: '#ffffff' },
  { value: 1, color: '#f2f2f2', ink: '#222222' },
];
const SLIDE_S = 0.4;
const UP = new THREE.Vector3(0, 1, 0);

const around = (v, seat) => v.clone().applyAxisAngle(UP, SIDE[seat]);

// Betrag → Chips (größte zuerst), höchstens max Stück – darüber werden die kleinen weggelassen (nur Anzeige)
export function chipsFor(amount, max = 60) {
  const out = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const c of CHIPS) {
    while (rest >= c.value && out.length < max) {
      out.push(c.value);
      rest -= c.value;
    }
  }
  return out;
}

export function createPokerBoard(parent) {
  const cards = createCards(parent);
  const group = cards.group;
  const { felt, deco } = buildMat(group);
  const pool = Array.from({ length: 52 }, () => cards.make());
  const button = buildButton(group);
  const plates = [0, 1, 2, 3, 4, 5].map(() => buildPlate(group));

  // --- Chips ---
  const chipGeo = new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 36);
  const chipMats = new Map(CHIPS.map((c) => [c.value, [
    new THREE.MeshStandardMaterial({ map: chipEdge(c), roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
  ]]));
  const chips = []; // { mesh, value, loc, slot, anim }
  let anims = [];
  let clock = 0;

  function newChip(value) {
    const mesh = new THREE.Mesh(chipGeo, chipMats.get(value));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const c = { mesh, value, loc: null };
    chips.push(c);
    return c;
  }

  // Platz einer Chipspalte: Stapel und Einsatz vor dem Sitz, Pot in der Mitte
  function locCenter(loc) {
    if (loc === 'pot') return { at: POT.clone(), turn: 0, wide: 6 };
    const seat = Number(loc.slice(1));
    return { at: around(loc[0] === 's' ? STACK : BET, seat), turn: SIDE[seat], wide: loc[0] === 's' ? 4 : 3 };
  }
  // Chips eines Orts in Spalten: je Wert eigene Spalten, nebeneinander, bei vielen in einer zweiten Reihe dahinter
  function slotsFor(loc, values) {
    const { at, turn, wide } = locCenter(loc);
    const cols = [];
    let last = null;
    for (const v of values) {
      if (v !== last || cols.at(-1).length >= COLUMN) cols.push([]);
      cols.at(-1).push(v);
      last = v;
    }
    const out = [];
    const rows = Math.ceil(cols.length / wide);
    cols.forEach((col, i) => {
      const row = Math.floor(i / wide);
      const inRow = Math.min(wide, cols.length - row * wide);
      const k = i % wide;
      const local = new THREE.Vector3((k - (inRow - 1) / 2) * (CHIP.r * 2 + 0.25), 0, (row - (rows - 1) / 2) * -(CHIP.r * 2 + 0.25));
      const p = local.applyAxisAngle(UP, turn).add(at);
      col.forEach((v, h) => out.push({ value: v, pos: new THREE.Vector3(p.x + ((h * 7) % 3 - 1) * 0.05, Y + CHIP.h / 2 + h * CHIP.h, p.z + ((h * 5) % 3 - 1) * 0.05) }));
    });
    return out;
  }

  // Alle Chips auf die Beträge amounts { loc: Betrag } bringen. Gleiche Chips bleiben liegen, überzählige rutschen zu
  // einem Ort, der diesen Wert braucht (der nächste zuerst – so wandern Einsätze vom Stapel zum Pot), was dann noch
  // fehlt, kommt aus from(loc) dazu (Wechselgeld), was übrig ist, verschwindet.
  function layoutChips(amounts, delay = 0, instant = false, from = () => null) {
    const want = new Map(); // loc → [{ value, pos }]
    for (const [loc, amount] of Object.entries(amounts)) if (amount > 0) want.set(loc, slotsFor(loc, chipsFor(amount, loc === 'pot' ? 90 : 60)));
    const used = new Set();
    const placements = []; // [chip, pos]
    const missing = []; // [loc, slot]
    for (const [loc, slots] of want) {
      const here = chips.filter((c) => c.loc === loc && !used.has(c));
      for (const slot of slots) {
        const c = here.find((x) => x.value === slot.value && !used.has(x));
        if (c) {
          used.add(c);
          placements.push([c, slot.pos, loc]);
        } else missing.push([loc, slot]);
      }
    }
    const spare = chips.filter((c) => c.loc && !used.has(c));
    for (const [loc, slot] of missing) {
      let best = null;
      for (const c of spare) {
        if (c.value !== slot.value || used.has(c)) continue;
        if (!best || c.mesh.position.distanceToSquared(slot.pos) < best.mesh.position.distanceToSquared(slot.pos)) best = c;
      }
      if (best) {
        used.add(best);
        placements.push([best, slot.pos, loc, true]);
        continue;
      }
      // neuer Chip: erscheint dort, wo das Geld herkommt (oder fällt kurz von oben)
      const c = chips.find((x) => !x.loc && !used.has(x) && x.value === slot.value && !anims.some((a) => a.chip === x)) ?? newChip(slot.value);
      used.add(c);
      const src = from(loc);
      const start = src ? locCenter(src).at.setY(Y + CHIP.h / 2) : slot.pos.clone().setY(slot.pos.y + 3);
      if (!instant) {
        c.mesh.position.copy(start);
        c.mesh.visible = false;
        c.appear = true;
      }
      placements.push([c, slot.pos, loc, true]);
    }
    for (const c of chips) {
      if (used.has(c) || !c.loc) continue;
      c.loc = null; // übrig: verschwindet nach der Bewegung
      c.target = null;
      if (instant) c.mesh.visible = false;
      else anims.push({ chip: c, to: null, start: clock + delay + SLIDE_S, dur: 0 });
    }
    let sound = 0;
    for (const [c, pos, loc, moved] of placements) {
      c.loc = loc;
      if (instant) {
        c.mesh.position.copy(pos);
        c.mesh.visible = true;
        c.target = pos.clone();
        continue;
      }
      // schon dort oder dorthin geplant (nicht die jetzige Lage – die kann noch von einer früheren Bewegung stammen)
      if ((c.target ?? c.mesh.position).distanceToSquared(pos) < 1e-4 && !c.appear) continue;
      c.target = pos.clone();
      anims = anims.filter((a) => a.chip !== c || a.start <= clock + delay); // spätere Pläne für diesen Chip gelten nicht mehr
      anims.push({ chip: c, to: pos.clone(), start: clock + delay, dur: SLIDE_S, lift: moved && c.mesh.position.distanceTo(pos) > 6 ? 1.2 : 0.3, sound: sound++ < 3 });
    }
  }

  function updateChips() {
    for (const a of anims) {
      if (a.done || clock < a.start) continue;
      if (!a.from) {
        a.from = a.chip.mesh.position.clone();
        if (a.chip.appear) {
          a.chip.mesh.visible = true;
          a.chip.appear = false;
        }
      }
      if (!a.to) {
        a.done = true;
        if (!a.chip.loc) a.chip.mesh.visible = false;
        continue;
      }
      const t = Math.min((clock - a.start) / a.dur, 1);
      const k = t * t * (3 - 2 * t);
      a.chip.mesh.position.lerpVectors(a.from, a.to, k);
      a.chip.mesh.position.y += Math.sin(t * Math.PI) * a.lift;
      if (t === 1) {
        a.done = true;
        if (a.sound) playHit('die', 0.25);
      }
    }
    anims = anims.filter((a) => !a.done);
  }

  // --- Karten ---
  let model = { deck: [], holes: [[], [], [], [], [], []], board: [], muck: [] };
  let shown = null;
  let me = 0;
  let hover = false; // eigene Karten leuchten (z. B. „in die Mitte schieben = passen“)

  const setFace = (c, id) => {
    c.pid = id;
    cards.setFace(c, id);
  };
  const deckSpot = (seat, k) => {
    const p = around(DECK, seat ?? 0);
    return flat(p.x, Y + k * CARD.t, p.z, SIDE[seat ?? 0] + 0.3, false);
  };
  // Handkarten: eigene offen und leicht angehoben zu mir, fremde verdeckt flach – aufgedeckte offen für den Zuschauer
  const holeSpot = (seat, i, open) => {
    const p = around(HOLE.clone().add(new THREE.Vector3((i - 0.5) * 4.2, 0, 0)), seat);
    const turn = (open ? SIDE[me] : SIDE[seat]) + (i - 0.5) * 0.12;
    const spot = flat(p.x, Y + i * CARD.t, p.z, turn, open);
    if (seat === me && open && !showOf(seat)) {
      // so hoch, dass die weggekippte Kante über dem Filz bleibt (vorher 0,6 cm – die Kante steckte ~7 mm im Tisch)
      spot.pos.y += (CARD.h / 2) * Math.sin(HOLE_TILT) + 0.1;
      spot.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, SIDE[seat]), -HOLE_TILT));
    }
    return spot;
  };
  const boardSpot = (k) => flat((k - 2) * BOARD_STEP, Y, 0, SIDE[me]);
  const muckSpot = (k) => {
    const p = around(MUCK.clone().add(new THREE.Vector3(((k * 7) % 5 - 2) * 0.3, 0, ((k * 3) % 5 - 2) * 0.3)), shown?.button ?? 0);
    return flat(p.x, Y + k * CARD.t, p.z, SIDE[shown?.button ?? 0] + 0.6 + ((k * 11) % 7 - 3) * 0.12, false);
  };
  const showOf = (seat) => !!shown?.shown?.includes(seat);

  function layoutCards(moves = new Map(), instant = false) {
    const spots = new Map();
    model.deck.forEach((c, k) => spots.set(c, deckSpot(shown?.button, k)));
    model.board.forEach((c, k) => spots.set(c, boardSpot(k)));
    model.muck.forEach((c, k) => spots.set(c, muckSpot(k)));
    model.holes.forEach((h, seat) => h.forEach((c, i) => spots.set(c, holeSpot(seat, i, !!c.pid))));
    for (const [c, spot] of spots) {
      const m = moves.get(c);
      if (instant) cards.place(c, spot);
      else if (m) {
        cards.fly(c, spot, {
          delay: m.delay, lift: m.lift ?? 2.5, queue: m.queue, onStart: m.onStart,
          onLand: (quiet) => !quiet && m.sound && playHit('card', m.sound),
        });
      } else cards.fly(c, spot, { dur: 0.25 });
    }
    setGlow('hover', hover ? model.holes[me].map((c) => c.mesh) : []);
  }

  function rebuildCards(v) {
    cards.finish();
    let k = 0;
    const next = (id) => {
      const c = pool[k++];
      setFace(c, id);
      return c;
    };
    model = { deck: [], holes: [[], [], [], [], [], []], board: [], muck: [] };
    v.holes.forEach((h, seat) => {
      if (!h) return;
      const cardsOf = h.map((id) => next(id));
      if (v.status[seat] === 'fold') model.muck.push(...cardsOf.map((c) => (setFace(c, null), c)));
      else model.holes[seat] = cardsOf;
    });
    model.board = v.board.map((id) => next(id));
    const burned = v.board.length ? v.board.length - 2 : 0; // je Straße eine verbrannte Karte
    for (let i = 0; i < burned; i++) model.muck.push(next(null));
    while (k < pool.length) model.deck.push(next(null));
    layoutCards(new Map(), true);
  }

  // Neue Hand: alles zum Stapel vor dem neuen Geber, mischen, je zwei Karten ab dem Small Blind
  function dealCards(v, e, t0) {
    const all = [...model.board, ...model.muck, ...model.holes.flat(), ...model.deck];
    model = { deck: all, holes: [[], [], [], [], [], []], board: [], muck: [] };
    const moves = new Map();
    all.forEach((c, k) => {
      setFace(c, null);
      moves.set(c, { delay: t0 + (k % 13) * 0.01, lift: 3, sound: 0 });
    });
    layoutCards(moves);
    let t = t0 + 0.75;
    setTimeout(playShuffle, (t - 0.6) * 1000);
    const order = [0, 1, 2, 3, 4, 5].map((k) => (e.sb + k) % 6).filter((p) => v.holes[p]);
    const deal = new Map();
    for (let round = 0; round < 2; round++) {
      for (const p of order) {
        const c = model.deck.pop();
        setFaceLater(c, Array.isArray(v.holes[p]) ? v.holes[p][round] : null, t);
        model.holes[p].push(c);
        deal.set(c, { delay: t, queue: true, sound: 0.45 });
        t += 0.08;
      }
    }
    layoutCards(deal);
    return t + 0.3;
  }
  // Vorderseite erst zeigen, wenn die Karte losfliegt – sonst sähe man sie schon auf dem Stapel
  function setFaceLater(c, id, delay) {
    c.pid = id;
    cards.setFace(c, null);
    if (id) setTimeout(() => c.pid === id && cards.setFace(c, id), delay * 1000);
  }

  function foldCards(seat, t) {
    const list = model.holes[seat].splice(0);
    const moves = new Map();
    list.forEach((c, i) => {
      setFace(c, null);
      model.muck.push(c);
      moves.set(c, { delay: t + i * 0.06, lift: 2, sound: 0.4 });
    });
    layoutCards(moves);
  }

  function streetCards(cardsOut, t) {
    const moves = new Map();
    const burn = model.deck.pop();
    if (burn) {
      model.muck.push(burn);
      moves.set(burn, { delay: t, lift: 1.5, sound: 0.3 });
    }
    cardsOut.forEach((id, i) => {
      const c = model.deck.pop();
      if (!c) return;
      setFaceLater(c, id, t + 0.25 + i * 0.18);
      model.board.push(c);
      moves.set(c, { delay: t + 0.25 + i * 0.18, lift: 2.5, sound: 0.6 });
    });
    layoutCards(moves);
    return t + 0.45 + cardsOut.length * 0.18;
  }

  function revealCards(v, t) {
    for (const p of v.shown) {
      const h = v.holes[p];
      if (!Array.isArray(h) || !h[0] || !model.holes[p].length) continue;
      model.holes[p].forEach((c, i) => {
        if (c.pid !== h[i]) setFaceLater(c, h[i], t);
      });
    }
    setTimeout(() => layoutCards(), t * 1000);
  }

  // Chipbeträge nach Stand: Stapel, Einsätze, Pot (Gesetztes früherer Setzrunden)
  function amountsOf(v) {
    const out = {};
    const done = v.phase === 'done' || v.phase === 'wait';
    v.stacks.forEach((x, p) => (out[`s${p}`] = x));
    v.bet.forEach((x, p) => (out[`b${p}`] = done ? 0 : x));
    out.pot = done ? 0 : v.invested.reduce((a, b) => a + b, 0) - v.bet.reduce((a, b) => a + b, 0);
    return out;
  }

  function playEvents(v, prev) {
    const amounts = amountsOf(prev);
    const flow = { bet: (loc) => (loc[0] === 'b' ? `s${loc.slice(1)}` : null), pot: () => null, win: (loc) => (loc[0] === 's' ? 'pot' : null) };
    let t = 0;
    const move = (kind, wait) => {
      layoutChips({ ...amounts }, t, false, flow[kind]);
      t += wait;
    };
    for (const e of v.events) {
      if (e.type === 'deal') {
        t = dealCards(v, e, t);
      } else if (e.type === 'newcpu') {
        amounts[`s${e.player}`] = v.stacks[e.player] + v.invested[e.player];
      } else if (e.type === 'blind' || e.type === 'bet') {
        amounts[`s${e.player}`] -= e.put;
        amounts[`b${e.player}`] += e.put;
        if (e.put) move('bet', e.type === 'blind' ? 0.12 : 0.3);
      } else if (e.type === 'caught' && e.resettled) {
        // abgerechnete Hand wird neu verteilt: alte Gewinne zurück in die Mitte
        prev.payout.forEach((x, p) => {
          amounts[`s${p}`] -= x;
          amounts.pot += x;
        });
        move('win', 0.5);
        if (v.status[e.player] === 'fold' && model.holes[e.player].length) foldCards(e.player, t);
      } else if (e.type === 'fold' || (e.type === 'caught' && v.status[e.player] === 'fold' && model.holes[e.player].length)) {
        foldCards(e.player, t);
        t += 0.3;
      } else if (e.type === 'street') {
        toPot(amounts);
        move('pot', 0.45);
        t = streetCards(e.cards, t);
      } else if (e.type === 'reveal' || e.type === 'showdown') {
        revealCards(v, t);
        t += 0.6;
      } else if (e.type === 'win') {
        toPot(amounts);
        move('pot', 0.45);
        if (e.showdown) {
          revealCards(v, t);
          t += 0.9;
        }
        amounts.pot = 0;
        e.payout.forEach((x, p) => (amounts[`s${p}`] += x));
        move('win', 0.5);
      }
    }
    if (!sameCards(v)) return rebuild(v, t);
    layoutChips(amountsOf(v), t, false, flow.win); // was sonst noch anders ist (Fehlalarm, Leihen, neu abgerechnet)
    return t;
  }

  const toPot = (amounts) => {
    for (let p = 0; p < 6; p++) {
      amounts.pot += amounts[`b${p}`];
      amounts[`b${p}`] = 0;
    }
  };

  function sameCards(v) {
    const holes = v.holes.every((h, p) => (h && v.status[p] !== 'fold' ? model.holes[p].length === 2 : model.holes[p].length === 0));
    return holes && model.board.length === v.board.length && model.board.every((c, i) => c.pid === v.board[i]);
  }

  function rebuild(v, delay = 0) {
    const go = () => {
      rebuildCards(shown);
      layoutChips(amountsOf(shown), 0, true);
    };
    if (delay > 0) setTimeout(go, delay * 1000);
    else go();
  }

  // Namensschilder und Knopf
  let names = [];
  function layoutTable(v) {
    deco.rotation.y = SIDE[me]; // Schriftzug lesbar für den, der zuschaut
    const b = around(BUTTON, v.button ?? 0);
    button.visible = v.button !== null;
    button.position.set(b.x, Y + 0.35, b.z);
    plates.forEach((pl, seat) => {
      const p = around(PLATE, seat);
      pl.mesh.position.set(p.x, Y + 0.05, p.z);
      // längs zum Platz, aber nie auf dem Kopf für den, der zuschaut
      const away = Math.abs(Math.atan2(Math.sin(SIDE[seat] - SIDE[me]), Math.cos(SIDE[seat] - SIDE[me]))) > Math.PI / 2;
      pl.mesh.rotation.set(-Math.PI / 2, 0, SIDE[seat] + (away ? Math.PI : 0));
      const text = names[seat] ?? '';
      const turn = v.turn === seat;
      const key = `${text}|${turn}|${v.status[seat]}`;
      if (pl.key !== key) {
        pl.key = key;
        pl.draw(text, turn, v.status[seat] === 'fold' || v.status[seat] === 'out');
      }
    });
  }

  function reset() {
    shown = null;
    me = 0;
    hover = false;
    anims = [];
    for (const c of chips) {
      c.loc = null;
      c.target = null;
      c.mesh.visible = false;
    }
    setGlow('hover', []);
    rebuildCards({ holes: [null, null, null, null, null, null], status: [], board: [] });
    button.visible = false;
    plates.forEach((pl) => pl.draw('', false, false));
  }

  reset();

  return {
    group,
    // Karten, Chips und Knopf fliegen beim Umwerfen einzeln (tisch.js); die Matte ist das Brett
    loose: () => [...pool.map((c) => c.mesh), ...chips.filter((c) => c.loc).map((c) => c.mesh), button],
    setDesign(s) {
      setCardBack(s.cardBack);
      felt.map = feltOf(s.felt);
    },
    reset,
    update(dt) {
      clock += dt;
      cards.update(dt);
      updateChips();
    },
    busy: () => Math.max(cards.busy(), ...anims.map((a) => a.start + a.dur - clock), 0),
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut, labels = Namen je Sitz (mit Chips)
    sync(v, seat, labels) {
      names = labels ?? names;
      if (!v) return;
      if (v !== shown) {
        const prev = shown;
        const turned = me !== seat;
        me = seat;
        shown = v;
        if (prev && !turned && v.seq === prev.seq) {
          // gleicher Stand, nur ein Merker geändert (z. B. waive) – nichts neu legen
        } else if (!prev || turned || v.seq !== prev.seq + 1) rebuild(v);
        else playEvents(v, prev);
      }
      layoutTable(v);
    },
    // eigene Karten hervorheben (Maus darüber, wenn man sie in die Mitte schieben kann)
    setHover(on) {
      if (hover === on) return;
      hover = on;
      layoutCards();
    },
    // Gehört ein Mesh zu meinen Karten / meinem Stapel? (tisch.js: mit der Hand gepackt)
    partOf(mesh) {
      if (model.holes[me].some((c) => c.mesh === mesh)) return 'cards';
      if (chips.some((c) => c.mesh === mesh && c.loc === `s${me}`)) return 'chips';
      return null;
    },
    hitMine(raycaster) {
      return raycaster.intersectObjects(model.holes[me].map((c) => c.mesh), false).length > 0;
    },
    // Liegt ein Punkt (Welt) innerhalb der Setzlinie?
    inMiddle(point) {
      const p = group.worldToLocal(point.clone());
      return Math.hypot(p.x, p.z) < 26;
    },
  };
}

function buildMat(group) {
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.45 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(RAIL.r + RAIL.tube - 0.5, RAIL.r + RAIL.tube, MAT.h, 72), wood);
  base.position.y = MAT.h / 2;
  const rail = new THREE.Mesh(new THREE.TorusGeometry(RAIL.r, RAIL.tube * 0.8, 14, 96).rotateX(Math.PI / 2), leather);
  rail.scale.y = 0.6;
  rail.position.y = MAT.h + 0.6;
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const top = new THREE.Mesh(new THREE.CircleGeometry(MAT.r, 72).rotateX(-Math.PI / 2), feltMat);
  top.position.y = MAT.h + 0.01;
  // Setzlinie und Schriftzug (hell, durchscheinend auf dem Filz)
  const print = canvasTexture(1024, 1024, (g, w) => {
    g.strokeStyle = 'rgba(255, 240, 200, 0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(w / 2, w / 2, w * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255, 240, 200, 0.35)';
    g.font = 'bold 40px Georgia, serif';
    g.textAlign = 'center';
    g.fillText("TEXAS HOLD'EM", w / 2, w / 2 + 165);
    g.font = 'italic 26px Georgia, serif';
    g.fillText('No Limit · Blinds 5 / 10', w / 2, w / 2 + 200);
  });
  const deco = new THREE.Mesh(new THREE.PlaneGeometry(86, 86).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: print, transparent: true, roughness: 1, depthWrite: false }));
  deco.position.y = MAT.h + 0.015;
  for (const m of [base, rail, top, deco]) {
    m.receiveShadow = true;
    group.add(m);
  }
  rail.castShadow = true;
  return { felt: feltMat, deco };
}

function buildButton(group) {
  const face = canvasTexture(256, 256, (g, w) => {
    g.fillStyle = '#f4f1e8';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#222';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 18, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#222';
    g.font = 'bold 50px Georgia, serif';
    g.textAlign = 'center';
    g.fillText('DEALER', w / 2, w / 2 + 17);
  });
  const side = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.4 });
  const top = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.7, 36), [side, top, side]);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// Namensschild: kleines Kärtchen am Rand, Name groß – wer dran ist, leuchtet gelb, wer raus ist, ist blass
function buildPlate(group) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
  mesh.renderOrder = 1;
  group.add(mesh);
  return {
    mesh,
    draw(text, turn, faded) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 512, 128);
      mesh.visible = !!text;
      if (!text) return;
      g.fillStyle = turn ? 'rgba(240, 200, 80, 0.92)' : 'rgba(20, 14, 10, 0.72)';
      g.beginPath();
      g.roundRect(6, 10, 500, 108, 40);
      g.fill();
      g.fillStyle = turn ? '#2a1a08' : faded ? 'rgba(240, 230, 210, 0.45)' : '#f3e9d6';
      g.font = 'bold 52px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 66, 470);
      tex.needsUpdate = true;
    },
  };
}

// Chip: Rand mit hellen Streifen, Oberseite mit Ring und Wert
function chipEdge({ color }) {
  return canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < 8; i++) g.fillRect(i * (w / 8) + 6, 0, w / 16, h);
  });
}
function chipTop({ color, ink, value }) {
  return canvasTexture(128, 128, (g, w) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 10;
    g.setLineDash([14, 12]);
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 8, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255, 255, 255, 0.18)';
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink === '#ffffff' ? '#ffffff' : '#222222';
    g.font = `bold ${value >= 1000 ? 30 : 38}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(value >= 1000 ? `${value / 1000}K` : String(value), w / 2, w / 2 + 2);
  });
}
