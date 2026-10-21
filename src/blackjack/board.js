// Black-Jack-Tisch: halbrunder Filz mit Polsterrand, fünf Boxen im Bogen, gegenüber die Bank mit Kartenschlitten
// (rechts vom Croupier aus links), Ablagefach und Chiprack. Vor jeder Box: Chipstapel des Spielers, Einsatzfeld, die
// Karten (geteilte Hände nebeneinander) und ein Schild mit der Summe; die Bank legt ihre Karten in die Mitte. Kennt
// keine Regeln: zeigt die Sicht eines Spielers (viewFor). Karten kommen aus dem Schlitten geflogen und gehen am Ende
// der Runde ins Ablagefach; Chips rutschen vom Stapel ins Feld, verlorene zur Bank, Gewinne kommen von der Bank.
// Maße in Zentimetern (Gruppe 1/100 skaliert). Beide Menschen sitzen auf derselben Seite (Boxen 1 und 3).
import * as THREE from 'three';
import { createCards, flat, CARD } from '../karten/cards3d.js';
import { setCardBack } from '../karten/faces.js';
import { feltOf, woodTexture, canvasTexture } from '../textures.js';
import { playHit, playShuffle } from '../sound.js';
import { chipsFor } from '../poker/board.js';
import { total, isBlackjack, scoreOf } from './game.js';

const H = 0.6; // Höhe des Filzes
const Y = H + 0.02;
const C = new THREE.Vector2(0, -20); // Mittelpunkt des Bogens (Mitte der Bankseite)
const R = 50; // Filz
const DEPTH = 10; // Streifen der Bank hinter dem Mittelpunkt
const ANGLE = [0, 1, 2, 3, 4].map((p) => ((20 + 35 * p) * Math.PI) / 180); // Box 0 rechts (+x, links vom Croupier)
const R_BET = 38; // Einsatzfeld
const R_CARD = 26; // erste Karte einer Hand
const R_INS = 32.5; // Versicherungslinie
const R_STACK = 43; // Chips des Spielers
const R_PLATE = 48; // Namensschild
const HAND_GAP = 8.6; // geteilte Hände nebeneinander
const STEP = { r: -1.3, side: 1.7 }; // jede weitere Karte etwas nach rechts und zur Bank – die Ecke mit dem Wert bleibt frei
const DEALER = new THREE.Vector3(0, 0, -13);
const SHOE = new THREE.Vector3(37, 0, -23);
const DISCARD = new THREE.Vector3(-37, 0, -23);
const BANK = new THREE.Vector3(0, 0, -25); // Chiprack
const CHIP = { r: 1.95, h: 0.34 };
const COLUMN = 10;
const CHIPS = [ // wie Texas Hold'em
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

// Punkt im Bogen: Abstand r vom Mittelpunkt, Winkel a, side = seitlich (+ = rechts aus Sicht des Spielers)
const polar = (r, a, side = 0) => new THREE.Vector3(r * Math.cos(a) + side * Math.sin(a), 0, C.y + r * Math.sin(a) - side * Math.cos(a));
const facing = (a) => Math.PI / 2 - a; // Drehung, mit der Kartenkopf und Schrift zur Bank zeigen

export function createBlackjackBoard(parent) {
  const cards = createCards(parent);
  const group = cards.group;
  const { felt } = buildTable(group);
  const shoe = buildShoe(group);
  const discard = buildDiscard(group);
  buildRack(group);
  const plates = [0, 1, 2, 3, 4].map(() => buildTag(group, 15, 3.6, 0.8));
  const tags = []; // Summen-Schilder der Hände (bei Bedarf mehr)
  const dealerTag = buildTag(group, 7, 3, 0.9);

  // --- Karten ---
  const all = []; // { mesh, pid, key, busy }
  let placed = new Map(); // key → Karte
  let shown = null;
  let me = 1;
  let hover = []; // leuchtende Karten

  function take() {
    let c = all.find((x) => !x.key && !x.away);
    if (!c) {
      c = cards.make();
      all.push(c);
    }
    c.mesh.visible = true;
    return c;
  }
  const setFace = (c, id) => {
    c.pid = id;
    cards.setFace(c, id);
  };
  const shoeSpot = () => flat(SHOE.x - 4, Y + 2.2, SHOE.z + 6.5, -0.35, false);
  const discardSpot = (k) => flat(DISCARD.x + ((k * 7) % 5 - 2) * 0.2, Y + 0.5 + discard.height(), DISCARD.z, 0.3 + ((k * 3) % 5 - 2) * 0.03, false);

  // Lage jeder Karte nach Stand: d0, d1 … (Bank), p.i.k (Box, Hand, Karte)
  function layoutOf(v) {
    const out = [];
    v.dealer.forEach((id, k) => {
      const n = v.dealer.length;
      out.push({ key: `d${k}`, id, spot: flat(DEALER.x + (k - (n - 1) / 2) * 7, Y + k * CARD.t, DEALER.z, 0), order: k ? 1000 + k : 5.5, box: -1 });
    });
    v.boxes.forEach((box, p) => {
      if (!box) return;
      const n = box.hands.length;
      box.hands.forEach((h, i) => {
        const side = ((n - 1) / 2 - i) * HAND_GAP;
        h.cards.forEach((id, k) => {
          const at = polar(R_CARD + k * STEP.r, ANGLE[p], side + k * STEP.side);
          out.push({ key: `${p}.${i}.${k}`, id, spot: flat(at.x, Y + k * CARD.t, at.z, facing(ANGLE[p])), order: k * 10 + p + (i ? 50 + i : 0), box: p });
        });
      });
    });
    return out;
  }

  // Karten auf den Stand bringen: gleiche bleiben (oder rücken, z. B. beim Teilen), neue kommen aus dem Schlitten,
  // übrige fliegen ins Ablagefach. → Sekunden, bis alles liegt
  function layoutCards(v, instant) {
    if (instant) cards.finish();
    const want = layoutOf(v);
    const next = new Map();
    const free = new Map(placed);
    const fresh = [];
    for (const w of want) {
      const same = free.get(w.key);
      if (same && same.pid === w.id) {
        next.set(w.key, same);
        free.delete(w.key);
      }
    }
    for (const w of want) {
      if (next.has(w.key)) continue;
      // beim Teilen wandert eine Karte in eine neue Hand derselben Box
      const moved = [...free].find(([k, c]) => c.pid === w.id && k.split('.')[0] === String(w.box));
      if (moved) {
        next.set(w.key, moved[1]);
        free.delete(moved[0]);
      } else fresh.push(w);
    }
    let t = 0;
    for (const w of want) {
      const c = next.get(w.key);
      if (!c) continue;
      c.key = w.key;
      if (instant) {
        cards.setFace(c, w.id); // ein noch nicht losgeflogener Flug hätte das Bild erst beim Start gezeigt
        cards.place(c, w.spot);
      } else cards.fly(c, w.spot, { dur: 0.3 });
    }
    // ins Ablagefach
    let k = 0;
    for (const c of free.values()) {
      c.key = null;
      if (instant) {
        c.mesh.visible = false;
        continue;
      }
      c.away = true;
      setFace(c, c.pid); // Bild bleibt, bis die Karte umgedreht im Fach liegt
      cards.fly(c, discardSpot(k), {
        delay: k * 0.04, lift: 3, queue: true,
        onLand: () => {
          c.away = false;
          if (!c.key) c.mesh.visible = false;
        },
      });
      k++;
    }
    if (k) t = 0.5 + k * 0.04;
    fresh.sort((a, b) => a.order - b.order);
    fresh.forEach((w, i) => {
      const c = take();
      c.key = w.key;
      next.set(w.key, c);
      if (instant) {
        setFace(c, w.id);
        cards.place(c, w.spot);
        return;
      }
      cards.place(c, shoeSpot());
      setFace(c, null);
      const at = t + i * 0.32;
      c.pid = w.id;
      cards.fly(c, w.spot, {
        delay: at, lift: 2.5, queue: true,
        onStart: () => c.pid === w.id && cards.setFace(c, w.id),
        onLand: (quiet) => !quiet && playHit('card', 0.5),
      });
    });
    placed = next;
    return fresh.length ? t + fresh.length * 0.32 + 0.35 : t;
  }

  // --- Chips (wie bei Texas Hold'em: Spalten je Wert, gleiche bleiben liegen, neue kommen von dort, wo das Geld herkommt) ---
  const chipGeo = new THREE.CylinderGeometry(CHIP.r, CHIP.r, CHIP.h, 36);
  const chipMats = new Map(CHIPS.map((c) => [c.value, [
    new THREE.MeshStandardMaterial({ map: chipEdge(c), roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
    new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
  ]]));
  const chips = []; // { mesh, value, loc, target }
  let anims = [];
  let clock = 0;

  function newChip(value) {
    const mesh = new THREE.Mesh(chipGeo, chipMats.get(value));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const c = { mesh, value, loc: null };
    mesh.userData.chip = c;
    chips.push(c);
    return c;
  }

  // Ort einer Chip-Gruppe: s3 = Stapel Box 3, b3.1 = Einsatz Box 3 Hand 1, i3 = Versicherung Box 3, bank = Chiprack
  function locCenter(loc) {
    if (loc === 'bank') return { at: BANK.clone(), turn: 0, wide: 6 };
    const p = Number(loc[1]);
    const turn = facing(ANGLE[p]);
    if (loc[0] === 's') return { at: polar(R_STACK, ANGLE[p], 8.5), turn, wide: 3 };
    if (loc[0] === 'i') return { at: polar(R_INS, ANGLE[p], -6.5), turn, wide: 2 };
    const [i, n] = loc.slice(3).split('/').map(Number);
    return { at: polar(R_BET, ANGLE[p], ((n - 1) / 2 - i) * HAND_GAP), turn, wide: 2 };
  }
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

  // Alle Chips auf die Beträge amounts { loc: Betrag } bringen; neue kommen aus from(loc), übrige rutschen zur Bank
  function layoutChips(amounts, delay, instant, from = () => null) {
    const want = new Map();
    for (const [loc, amount] of Object.entries(amounts)) if (amount > 0) want.set(loc, slotsFor(loc, chipsFor(amount, loc[0] === 's' ? 50 : 30)));
    const used = new Set();
    const placements = [];
    const missing = [];
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
      c.loc = null; // übrig: rutscht zur Bank und verschwindet
      c.target = null;
      if (instant) c.mesh.visible = false;
      else anims.push({ chip: c, to: BANK.clone().setY(Y + CHIP.h / 2), start: clock + delay, dur: SLIDE_S + 0.15, lift: 1, hide: true });
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
      if ((c.target ?? c.mesh.position).distanceToSquared(pos) < 1e-4 && !c.appear) continue;
      c.target = pos.clone();
      anims = anims.filter((a) => a.chip !== c || a.start <= clock + delay);
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
      const t = Math.min((clock - a.start) / a.dur, 1);
      const k = t * t * (3 - 2 * t);
      a.chip.mesh.position.lerpVectors(a.from, a.to, k);
      a.chip.mesh.position.y += Math.sin(t * Math.PI) * a.lift;
      if (t === 1) {
        a.done = true;
        if (a.hide && !a.chip.loc) a.chip.mesh.visible = false;
        if (a.sound) playHit('die', 0.25);
      }
    }
    anims = anims.filter((a) => !a.done);
  }

  // Beträge nach Stand. Nach der Runde liegt das, was zurückkommt, noch im Feld (Gewinn dazu, Verlorenes weg) – mit der
  // nächsten Runde rutscht es zum Stapel.
  function amountsOf(v) {
    const out = {};
    v.players.forEach((pl, p) => {
      if (!pl) return;
      const box = v.boxes[p];
      const back = v.phase === 'done' && box ? box.hands.reduce((a, h) => a + (h.back ?? 0), 0) + (box.insuranceBack ?? 0) : 0;
      out[`s${p}`] = v.stacks[p] - back;
      if (v.phase === 'bet') out[`b${p}.0/1`] = v.bets[p] ?? 0;
      if (!box) return;
      const n = box.hands.length;
      box.hands.forEach((h, i) => (out[`b${p}.${i}/${n}`] = v.phase === 'done' ? h.back ?? 0 : h.bet));
      out[`i${p}`] = v.phase === 'done' ? box.insuranceBack ?? 0 : box.insurance ?? 0;
    });
    return out;
  }
  const flow = (v) => (loc) => (loc[0] === 's' ? 'bank' : v.phase === 'done' ? 'bank' : `s${loc[1]}`);

  // --- Schilder ---
  let names = [];
  function tagFor(i) {
    while (tags.length <= i) tags.push(buildTag(group, 5.2, 2.8, 0.9));
    return tags[i];
  }
  const handText = (h) => {
    if (isBlackjack(h)) return 'BJ';
    const t = total(h.cards);
    if (h.claim !== null && h.claim !== undefined) return String(h.claim); // ohne Hilfen: angesagt – prüfen muss man selbst
    return t.soft && t.total < 21 && !h.done ? `${t.total - 10}/${t.total}` : String(t.total);
  };
  function layoutTags(v) {
    let k = 0;
    v.boxes.forEach((box, p) => {
      if (!box) return;
      const n = box.hands.length;
      box.hands.forEach((h, i) => {
        if (!h.cards.length) return;
        const tag = tagFor(k++);
        const side = ((n - 1) / 2 - i) * HAND_GAP;
        const at = polar(R_CARD + 6.4, ANGLE[p], side); // vor der ersten Karte, zum Spieler hin
        tag.mesh.position.set(at.x, Y + 0.6, at.z);
        tag.mesh.rotation.set(-Math.PI / 2, 0, facing(ANGLE[p]));
        const turn = v.turn?.box === p && v.turn.hand === i;
        const bad = scoreOf(h) > 21 || h.result === 'lose' || h.result === 'bust';
        const good = h.result === 'win' || h.result === 'blackjack';
        tag.draw(handText(h), turn ? 'turn' : good ? 'good' : bad ? 'bad' : '');
      });
    });
    for (; k < tags.length; k++) tags[k].draw('', '');
    if (v.dealer.length) {
      const t = total(v.dealer);
      dealerTag.mesh.position.set(0, Y + 0.6, DEALER.z + 6.6);
      dealerTag.mesh.rotation.set(-Math.PI / 2, 0, 0);
      const text = v.dealer.length === 2 && t.total === 21 ? 'BJ' : t.soft && v.dealer.length === 1 ? '1/11' : String(t.total);
      dealerTag.draw(text, t.total > 21 ? 'bad' : '');
    } else dealerTag.draw('', '');
    plates.forEach((pl, p) => {
      const at = polar(R_PLATE, ANGLE[p]);
      pl.mesh.position.set(at.x, Y + 0.05, at.z);
      pl.mesh.rotation.set(-Math.PI / 2, 0, facing(ANGLE[p]));
      pl.draw(v.players[p] ? names[p] ?? '' : '', v.turn?.box === p ? 'turn' : '');
    });
  }

  function apply(v, instant) {
    const t = layoutCards(v, instant);
    layoutChips(amountsOf(v), instant ? 0 : v.phase === 'done' ? t : 0, instant, flow(v));
    discard.set(v.used - placedCount());
    layoutTags(v);
    setGlowHover();
  }
  const placedCount = () => placed.size;

  function setGlowHover() {
    for (const c of all) cards.shade(c, 1);
    for (const c of hover) cards.shade(c, 1.25);
  }

  function reset() {
    shown = null;
    anims = [];
    cards.finish();
    for (const c of all) {
      c.key = null;
      c.away = false;
      c.mesh.visible = false;
    }
    placed = new Map();
    for (const c of chips) {
      c.loc = null;
      c.target = null;
      c.mesh.visible = false;
    }
    discard.set(0);
    plates.forEach((pl) => pl.draw('', ''));
    tags.forEach((t) => t.draw('', ''));
    dealerTag.draw('', '');
  }

  reset();

  return {
    group,
    // Karten und Chips fliegen beim Umwerfen einzeln (tisch.js); der Tisch mit Schlitten ist das Brett
    loose: () => [...all.filter((c) => c.key).map((c) => c.mesh), ...chips.filter((c) => c.loc).map((c) => c.mesh)],
    setDesign(s) {
      setCardBack(s.cardBack);
      felt.map = feltOf(s.felt);
      shoe.back.color.set({ blau: 0x1c3a8a, gruen: 0x1c6a3a }[s.cardBack] ?? 0x8a1c1c); // oberste Karte im Schlitten
    },
    reset,
    update(dt) {
      clock += dt;
      cards.update(dt);
      updateChips();
    },
    busy: () => Math.max(cards.busy(), ...anims.map((a) => a.start + a.dur - clock), 0),
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut, labels = Namen je Box (mit Chips)
    sync(v, seat, labels) {
      names = labels ?? names;
      if (!v) return;
      if (v !== shown) {
        const prev = shown;
        const turned = me !== seat;
        me = seat;
        shown = v;
        if (prev && !turned && v.seq === prev.seq) {
          // gleicher Stand, nur ein Merker (waive) oder ein angeglichenes Konto – Karten bleiben liegen
          layoutChips(amountsOf(v), 0, false, flow(v));
          layoutTags(v);
        } else {
          if (v.events.some((e) => e.type === 'shuffle')) setTimeout(playShuffle, 100);
          apply(v, !prev || turned || v.seq !== prev.seq + 1);
        }
      } else layoutTags(v);
    },
    // eigene Karten der Hand, die dran ist, hervorheben
    setHover(keys) {
      hover = keys.map((k) => placed.get(k)).filter(Boolean);
      setGlowHover();
    },
    // Gehört ein Mesh zu meinem Chipstapel? → Wert des Chips, sonst null (tisch.js: mit der Hand gepackt)
    chipOf(mesh) {
      const c = chips.find((x) => x.mesh === mesh);
      return c && c.loc === `s${me}` ? c.value : null;
    },
    // Box, in deren Feld (Einsatz oder Karten) ein Punkt (Welt) liegt – oder null
    boxAt(point) {
      const p = group.worldToLocal(point.clone());
      const d = Math.hypot(p.x - C.x, p.z - C.y);
      if (d < 18 || d > 45) return null;
      const a = Math.atan2(p.z - C.y, p.x - C.x);
      const k = Math.round(((a * 180) / Math.PI - 20) / 35);
      return k >= 0 && k < 5 ? k : null;
    },
  };
}

function buildTable(group) {
  // Halbkreis zu den Spielern (+z) plus Streifen der Bank. Formen in x/y mit y = −(z − Mittelpunkt): nach dem Drehen
  // um x liegt der Bogen auf der Spielerseite und die Fläche zeigt nach oben.
  const half = (r, depth) => {
    const sh = new THREE.Shape();
    sh.moveTo(-r, 0);
    sh.absarc(0, 0, r, Math.PI, 2 * Math.PI, false);
    sh.lineTo(r, depth);
    sh.lineTo(-r, depth);
    sh.lineTo(-r, 0);
    return sh;
  };
  const flatGeo = (sh, depth) => {
    const g = depth ? new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 48 }) : new THREE.ShapeGeometry(sh, 48);
    g.rotateX(-Math.PI / 2);
    g.translate(0, depth ? 0 : H + 0.01, C.y);
    return g;
  };
  const feltGeo = flatGeo(half(R, DEPTH), 0);
  const pos = feltGeo.attributes.position;
  const uv = feltGeo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + R) / (2 * R), (pos.getZ(i) - C.y + DEPTH) / (2 * R));
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const top = new THREE.Mesh(feltGeo, feltMat);
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2a14', boards: 2 }), roughness: 0.45 });
  const base = new THREE.Mesh(flatGeo(half(R + 3.5, DEPTH + 2), H), wood);
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.55 });
  const rail = new THREE.Mesh(new THREE.TorusGeometry(R + 1.6, 2.6, 14, 64, Math.PI).rotateX(Math.PI / 2), leather);
  rail.scale.y = 0.6;
  rail.position.set(0, H + 0.5, C.y);
  // Aufdruck: Einsatzfelder, Versicherungslinie, Schriftzüge im Bogen
  const W = 2 * R;
  const D = R + DEPTH;
  const px = 20; // Pixel je cm
  const print = canvasTexture(W * px, D * px, (g) => {
    const X = (x) => (x + R) * px;
    const Z = (z) => (z - C.y + DEPTH) * px;
    const cx = X(0);
    const cz = Z(C.y);
    const ink = 'rgba(255, 240, 200, 0.6)';
    const gold = 'rgba(225, 190, 110, 0.85)';
    g.lineWidth = 5;
    for (let p = 0; p < 5; p++) {
      const at = polar(R_BET, ANGLE[p]);
      g.strokeStyle = gold;
      g.beginPath();
      g.arc(X(at.x), Z(at.z), 4.6 * px, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(225, 190, 110, 0.35)';
      g.beginPath();
      g.arc(X(at.x), Z(at.z), 3.6 * px, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = ink;
    g.lineWidth = 3;
    for (const r of [R_INS - 1.8, R_INS + 1.8]) {
      g.beginPath();
      g.arc(cx, cz, r * px, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    arcText(g, cx, cz, R_INS * px, 'VERSICHERUNG ZAHLT 2 : 1', 'bold 44px Georgia, serif', ink);
    arcText(g, cx, cz, 18.5 * px, 'BLACK JACK ZAHLT 3 : 2', 'bold 62px Georgia, serif', 'rgba(255, 240, 200, 0.7)');
    arcText(g, cx, cz, 15.6 * px, 'Die Bank zieht bis 16 und steht ab 17', 'italic 40px Georgia, serif', 'rgba(255, 240, 200, 0.45)');
  });
  const deco = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: print, transparent: true, roughness: 1, depthWrite: false }));
  deco.position.set(0, H + 0.015, C.y - DEPTH + D / 2);
  for (const m of [base, rail, top, deco]) {
    m.receiveShadow = true;
    group.add(m);
  }
  rail.castShadow = true;
  return { felt: feltMat };
}

// Schrift im Bogen um (cx, cy), Buchstaben aufrecht zum Mittelpunkt hin, lesbar von außen (von den Spielern aus)
function arcText(g, cx, cy, r, text, font, color) {
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const span = widths.reduce((a, b) => a + b, 0) / r;
  let a = Math.PI / 2 + span / 2; // von links (−x, großer Winkel) nach rechts
  [...text].forEach((ch, i) => {
    const w = widths[i] / r;
    const m = a - w / 2;
    g.save();
    g.translate(cx + r * Math.cos(m), cy + r * Math.sin(m));
    g.rotate(m - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    a -= w;
  });
  g.restore();
}

// Kartenschlitten: dunkle Kiste, vorn schräg, darin die oberste Karte (Rückseite)
function buildShoe(group) {
  const box = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.35, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.5, 7, 17), dark);
  body.position.set(0, 3.5, 0);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(9.5, 1.2, 3), dark);
  lip.position.set(0, 0.6, 9.5);
  const back = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.8 });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 8.8), back);
  card.rotation.x = -Math.PI / 2 - 0.45;
  card.position.set(0, 4, 8.6);
  for (const m of [body, lip, card]) {
    m.castShadow = m.receiveShadow = true;
    box.add(m);
  }
  box.position.set(SHOE.x, Y, SHOE.z);
  box.rotation.y = -0.35;
  group.add(box);
  return { back };
}

// Ablagefach: offene Plexiglas-Schale, darin ein Kartenblock, so hoch wie die abgelegten Karten
function buildDiscard(group) {
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.15, transparent: true, opacity: 0.35 });
  const tray = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.4, 11), glass);
  floor.position.y = 0.2;
  tray.add(floor);
  for (const [w, d, x, z] of [[0.4, 11, -4.05, 0], [0.4, 11, 4.05, 0], [8.5, 0.4, 0, -5.3]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), glass);
    wall.position.set(x, 3.5, z);
    tray.add(wall);
  }
  const block = new THREE.Mesh(new THREE.BoxGeometry(6.3, 1, 8.8), new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.9 }));
  block.castShadow = block.receiveShadow = true;
  tray.add(block);
  tray.position.set(DISCARD.x, Y, DISCARD.z);
  tray.rotation.y = 0.3;
  group.add(tray);
  let h = 0;
  const set = (n) => {
    h = Math.max(0, n) * CARD.t;
    block.visible = h > 0.01;
    block.scale.y = Math.max(h, 0.01);
    block.position.y = 0.4 + h / 2;
  };
  return { set, height: () => h };
}

// Chiprack der Bank: Holzrahmen mit Säulen in allen Farben (nur Schmuck)
function buildRack(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#3a2010', boards: 1 }), roughness: 0.5 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(34, 1, 7), wood);
  frame.position.set(BANK.x, Y + 0.5, BANK.z - 1.5);
  frame.castShadow = frame.receiveShadow = true;
  group.add(frame);
  const geo = new THREE.CylinderGeometry(CHIP.r, CHIP.r, 1, 32);
  CHIPS.slice(1).concat(CHIPS.slice(2, 5)).forEach((c, i) => {
    const n = 9 + ((i * 5) % 4);
    const mats = [
      new THREE.MeshStandardMaterial({ map: chipEdge(c, n), roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
      new THREE.MeshStandardMaterial({ map: chipTop(c), roughness: 0.45 }),
    ];
    const col = new THREE.Mesh(geo, mats);
    col.scale.y = n * CHIP.h;
    col.position.set(BANK.x + (i - 4) * 4, Y + 1 + (n * CHIP.h) / 2, BANK.z - 1.5);
    col.castShadow = col.receiveShadow = true;
    group.add(col);
  });
}

// Schild flach auf dem Filz: Name oder Summe. mode: '' | 'turn' (gelb) | 'good' (grün) | 'bad' (rot)
function buildTag(group, w, h, scale) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * 40);
  c.height = Math.round(h * 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
  mesh.renderOrder = 2;
  group.add(mesh);
  let key = null;
  return {
    mesh,
    draw(text, mode) {
      if (key === `${text}|${mode}`) return;
      key = `${text}|${mode}`;
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      mesh.visible = !!text;
      if (!text) return;
      g.fillStyle = { turn: 'rgba(240, 200, 80, 0.94)', good: 'rgba(60, 150, 80, 0.92)', bad: 'rgba(170, 40, 35, 0.9)' }[mode] ?? 'rgba(20, 14, 10, 0.75)';
      g.beginPath();
      g.roundRect(3, 3, c.width - 6, c.height - 6, c.height / 2 - 3);
      g.fill();
      g.fillStyle = mode === 'turn' ? '#2a1a08' : '#f6eedc';
      g.font = `bold ${Math.round(c.height * 0.55 * scale)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, c.width / 2, c.height / 2 + 2, c.width - 16);
      tex.needsUpdate = true;
    },
  };
}

// Chip: Rand mit hellen Streifen (rows = so viele Chips übereinander, für die Säulen im Rack), Oberseite mit Wert
function chipEdge({ color }, rows = 1) {
  return canvasTexture(256, 32 * Math.min(rows, 8), (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (let i = 0; i < 8; i++) g.fillRect(i * (w / 8) + 6 + (r % 2) * 10, r * rh, w / 16, rh);
      g.fillStyle = 'rgba(0, 0, 0, 0.35)';
      g.fillRect(0, r * rh, w, 1);
    }
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
