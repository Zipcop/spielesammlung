// Kartenduell-Tisch: Spielmatte mit aufgedruckten Zonen – je Spieler 5 Monsterzonen, dahinter 5 Zonen für Zauber und
// Fallen, links die Feldzone, rechts Friedhof und Deck. Die eigene Hand offen als Fächer, die des Gegners verdeckt.
// Vor jeder besetzten Monsterzone ein Schildchen mit der aktuellen ATK/DEF, neben den Zonen die LP-Tafel.
// Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) – jede Karte (uid) hat ihr eigenes Mesh und fliegt dorthin,
// wo sie laut Sicht liegt; die Ereignisse der letzten Aktion geben die Reihenfolge (aktivierte Karten zeigen sich kurz
// in der Mitte, Angreifer stoßen vor). Maße in Zentimetern (Gruppe 1/100 skaliert).
//
// Plätze sind auf beiden PCs gleich (Sitz 0 auf +z, Sitz 1 auf −z) – die Tisch-Physik (tisch.js) erkennt Teile an ihrer
// Stelle. Nur die Drehung offener Karten und der Schilder ist je PC verschieden: Sie liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { createCards, flat, fan, CARD } from '../karten/cards3d.js';
import { canvasTexture, feltOf } from '../textures.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';
import { FACE, drawCard, drawBack } from './art.js';
import { CARD as CARDS, sortKey } from './cards.js';
import { atkOf, defOf } from './game.js';

const DECK = 40;
const SIDE = [0, Math.PI]; // Drehung um die Hochachse: +z-Platz → Platz des Sitzes
const MAT = { w: 80, d: 58, h: 0.4 };
const Y = MAT.h;
const ZX = [-20.8, -10.4, 0, 10.4, 20.8];
const MON_Z = 7.8;
const ST_Z = 18.9;
const LABEL_Z = 13.35;
const FIELD = { x: -33, z: MON_Z };
const GRAVE = { x: 33, z: MON_Z };
const PILE = { x: 33, z: ST_Z }; // Deck
const PLATE = { x: -33, z: ST_Z + 1 };
const HAND = { at: new THREE.Vector3(0, 7, 33), tilt: 0.95, width: 38, depth: 0.4 }; // depth: Karten nicht ineinander – sonst klemmt eine gepackte Karte an den Nachbarn (tisch.js)
const SHOW = new THREE.Vector3(0, 11, 4); // aktivierte Karte zeigt sich hier kurz (aus Sicht des Zuschauers)
const UP = new THREE.Vector3(0, 1, 0);
const ACROSS = new THREE.Vector3(1, 0, 0);

const around = (x, z, seat) => (seat === 0 ? [x, z] : [-x, -z]);
const ownerOf = (u) => (u < DECK ? 0 : 1);

// Texturen der Kartenseiten (einmal je Karte gezeichnet)
const faces = new Map();
const faceOf = (id) => {
  if (!faces.has(id)) faces.set(id, canvasTexture(FACE.w, FACE.h, (g, w, h) => drawCard(g, id, w, h)));
  return faces.get(id);
};
let backTex = null;
const back = () => (backTex ??= canvasTexture(FACE.w, FACE.h, (g, w, h) => drawBack(g, w, h)));

export function createDuelBoard(parent) {
  const cards = createCards(parent);
  const group = cards.group;
  const { felt } = buildMat(group);
  const backMat = new THREE.MeshStandardMaterial({ map: back(), color: 0xb8b8b8, roughness: 0.8 });
  const pool = Array.from({ length: DECK * 2 }, (_, u) => {
    const c = cards.make();
    c.mesh.material[1] = backMat; // eigene Rückseite statt der Spielkarten-Rückseite
    c.u = u;
    return c;
  });
  const plates = [0, 1].map(() => buildPlate(group, 512, 200, 13, 5.1));
  const labels = [0, 1].map(() => ZX.map(() => buildPlate(group, 256, 72, 8, 2.25)));
  let shown = null;
  let me = 0;
  let names = ['', ''];
  let marks = { selected: null, targets: [], tribute: [], dim: null };
  let hover = null;

  const turn = () => SIDE[me];
  function face(c, id) {
    c.id = id;
    c.mesh.material[0].map = id ? faceOf(id) : back();
  }

  // --- Plätze ---
  const zoneSpot = (p, i, z, rot, up, k = 0) => {
    const [x, zz] = around(ZX[i], z, p);
    return flat(x, Y + k * CARD.t, zz, rot, up);
  };
  const pileSpot = (p, where, k) => {
    const at = where === 'grave' ? GRAVE : PILE;
    const [x, z] = around(at.x, at.z, p);
    return flat(x, Y + k * CARD.t * 1.2, z, where === 'grave' ? turn() : SIDE[p] + 0.03, where === 'grave');
  };
  const fieldSpot = (p) => {
    const [x, z] = around(FIELD.x, FIELD.z, p);
    return flat(x, Y, z, turn(), true);
  };
  function showSpot() {
    const frame = new THREE.Quaternion().setFromAxisAngle(UP, turn()).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, 0.85));
    return { pos: SHOW.clone().applyAxisAngle(UP, turn()), quat: frame };
  }

  // Wo eine Karte laut Sicht v liegt – Lage für cards.fly
  function spots(v) {
    const out = new Map();
    for (const p of [0, 1]) {
      v.deck[p].forEach((u, k) => out.set(u, pileSpot(p, 'deck', k)));
      v.grave[p].forEach((u, k) => out.set(u, pileSpot(p, 'grave', k)));
      const hand = p === me ? [...v.hand[p]].sort((a, b) => sortKey(v.cards[a]) - sortKey(v.cards[b]) || a - b) : [...v.hand[p]].sort((a, b) => a - b); // fremde Hand gemischt, nicht nach Zugzeit
      hand.forEach((u, i) => {
        const raise = p === me && (u === hover || u === marks.selected) ? 1.4 : 0;
        out.set(u, fan(i, hand.length, { ...HAND, side: SIDE[p], raise, tilt: p === me ? HAND.tilt : 0.35 }));
      });
      v.mon[p].forEach((m, i) => {
        if (!m) return;
        const rot = (m.up ? turn() : SIDE[p]) + (m.pos === 'def' ? Math.PI / 2 : 0);
        out.set(m.u, zoneSpot(p, i, MON_Z, rot, m.up));
      });
      v.st[p].forEach((x, i) => x && out.set(x.u, zoneSpot(p, i, ST_Z, x.up ? turn() : SIDE[p], x.up)));
      if (v.field[p]) out.set(v.field[p].u, fieldSpot(p));
    }
    return out;
  }

  // Bild: bekannt und offen (oder eigene verdeckte Karte in der Hand) → Vorderseite
  const shows = (v, u) => !!v.cards[u] && !inDeck(v, u) && !hiddenOnField(v, u);
  const inDeck = (v, u) => v.deck[ownerOf(u)].includes(u);
  const hiddenOnField = (v, u) => {
    const p = ownerOf(u);
    return v.mon[p].some((m) => m?.u === u && !m.up) || v.st[p].some((x) => x?.u === u && !x.up);
  };

  // Alles ohne Flug an seinen Platz
  function rebuild(v) {
    cards.finish();
    const at = spots(v);
    for (const c of pool) {
      face(c, shows(v, c.u) ? v.cards[c.u] : null);
      const spot = at.get(c.u);
      c.mesh.visible = !!spot;
      if (spot) cards.place(c, spot);
    }
  }

  // Ereignisse der letzten Aktion nacheinander abspielen, dann alle übrigen Karten an ihren Platz
  function play(v, prev = null) {
    const at = spots(v);
    const before = prev ? spots(prev) : new Map();
    const moved = new Set();
    let t = 0;
    const go = (u, spot, opts = {}) => {
      const c = pool[u];
      cards.fly(c, spot, { delay: t, queue: true, lift: opts.lift ?? 2.5, onStart: opts.onStart, onLand: (quiet) => !quiet && opts.sound && playHit('card', opts.sound), dur: opts.dur });
      moved.add(u);
    };
    const reveal = (u) => () => face(pool[u], shows(v, u) ? v.cards[u] : null);
    for (const e of v.events) {
      const u = e.u;
      if (e.type === 'activate') {
        const c = pool[u];
        face(c, v.cards[u] ?? null);
        go(u, showSpot(), { lift: 3, sound: 0.5 });
        t += 0.95;
        if (at.has(u)) go(u, at.get(u), { lift: 1, sound: 0.6, onStart: reveal(u) });
        t += 0.25;
      } else if (e.type === 'attack') {
        const home = before.get(u) ?? at.get(u);
        if (!home) continue;
        const [gx, gz] = around(0, ST_Z, 1 - ownerOf(u)); // direkt: bis zur Grundlinie des Gegners
        const goal = e.target !== null ? (before.get(e.target) ?? at.get(e.target))?.pos ?? new THREE.Vector3(gx, Y, gz) : new THREE.Vector3(gx, Y, gz);
        const pos = home.pos.clone().lerp(goal, 0.72).setY(home.pos.y + 2);
        cards.fly(pool[u], { pos, quat: home.quat }, { delay: t, queue: true, dur: 0.32, lift: 2.5 });
        cards.fly(pool[u], home, { delay: t + 0.34, queue: true, dur: 0.3, onLand: (quiet) => !quiet && playHit('card', 1) });
        moved.add(u);
        t += 0.7;
      } else if (e.type === 'flip' && prev) { // erst an Ort und Stelle aufdecken
        const p = ownerOf(u);
        const i = prev.mon[p].findIndex((m) => m?.u === u);
        const now = v.mon[p].find((m) => m?.u === u) ?? prev.mon[p][i];
        if (i < 0) continue;
        go(u, zoneSpot(p, i, MON_Z, turn() + (now.pos === 'def' ? Math.PI / 2 : 0), true), { lift: 1.2, sound: 0.6, onStart: () => face(pool[u], v.cards[u] ?? null) });
        t += 0.45;
        if (at.has(u) && v.mon[p].some((m) => m?.u === u)) go(u, at.get(u), { lift: 0.2 });
      } else if (['draw', 'summon', 'set', 'flip', 'position', 'destroy', 'tribute', 'grave', 'bounce', 'revive', 'discard'].includes(e.type) && at.has(u) && !(e.type === 'grave' && moved.has(u) && t > 0)) {
        go(u, at.get(u), { lift: e.type === 'position' ? 0.6 : 2.5, sound: e.type === 'draw' ? 0.35 : 0.7, onStart: reveal(u), dur: e.type === 'draw' ? 0.32 : undefined });
        t += e.type === 'draw' ? 0.18 : 0.32;
      } else if (e.type === 'battle') t += 0.1;
    }
    for (const c of pool) {
      const spot = at.get(c.u);
      c.mesh.visible = !!spot || c.mesh.visible;
      if (!spot) continue;
      if (moved.has(c.u)) continue;
      const id = shows(v, c.u) ? v.cards[c.u] : null;
      if (c.id !== id) face(c, id);
      cards.fly(c, spot, { dur: 0.25 });
    }
  }

  // Schilder: LP-Tafeln und ATK/DEF vor den Monstern (für den Zuschauer lesbar)
  function drawSigns(v) {
    for (const p of [0, 1]) {
      const pl = plates[p];
      const [x, z] = around(PLATE.x, PLATE.z, p);
      pl.mesh.position.set(x, Y + 2.6, z);
      pl.mesh.quaternion.setFromAxisAngle(UP, turn()).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, -0.75));
      const active = v.phase === 'duel' && (v.pending ? v.pending.who === p : v.turn === p);
      const lp = v.phase === 'setup' ? '–' : `${v.lp[p]} LP`;
      const who = names[p] || (p === 0 ? 'Host' : 'Gast');
      pl.draw(`${who}|${lp}|${active}`, (g, w, h) => {
        g.fillStyle = active ? 'rgba(232, 190, 90, 0.95)' : 'rgba(24, 16, 12, 0.85)';
        g.beginPath();
        g.roundRect(6, 6, w - 12, h - 12, 26);
        g.fill();
        g.fillStyle = active ? '#2a1606' : '#f1e4c8';
        g.textAlign = 'center';
        g.font = '600 46px system-ui, sans-serif';
        g.fillText(who, w / 2, 64, w - 40);
        g.font = 'bold 82px Georgia, serif';
        g.fillText(lp, w / 2, 160, w - 40);
      });
      ZX.forEach((_, i) => {
        const m = v.mon[p][i];
        const lb = labels[p][i];
        const [lx, lz] = around(ZX[i], LABEL_Z, p);
        lb.mesh.position.set(lx, Y + 0.05, lz);
        lb.mesh.quaternion.setFromAxisAngle(UP, turn()).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, -Math.PI / 2));
        const c = m && v.cards[m.u] && CARDS[v.cards[m.u]];
        const known = c && (m.up || p === me);
        const atk = known && (m.up ? atkOf(v, m.u) : c.atk);
        const def = known && (m.up ? defOf(v, m.u) : c.def);
        lb.draw(m && `${known ? `${c.id}|${atk}|${def}|${m.pos}` : '?'}`, m && ((g, w, h) => {
          g.fillStyle = 'rgba(16, 10, 8, 0.78)';
          g.beginPath();
          g.roundRect(4, 4, w - 8, h - 8, 18);
          g.fill();
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          if (!known) {
            g.fillStyle = '#d9cdb4';
            g.font = 'bold 40px system-ui, sans-serif';
            g.fillText('?', w / 2, h / 2 + 2);
            return;
          }
          const tone = (now, base) => (now > base ? '#8fe08a' : now < base ? '#ff8a80' : '#f4ead2');
          g.font = 'bold 36px system-ui, sans-serif';
          g.fillStyle = tone(atk, c.atk);
          g.globalAlpha = m.pos === 'atk' ? 1 : 0.55;
          g.fillText(String(atk), w * 0.27, h / 2 + 2);
          g.globalAlpha = 0.7;
          g.fillStyle = '#f4ead2';
          g.fillText('/', w / 2, h / 2 + 2);
          g.globalAlpha = m.pos === 'def' ? 1 : 0.55;
          g.fillStyle = tone(def, c.def);
          g.fillText(String(def), w * 0.73, h / 2 + 2);
          g.globalAlpha = 1;
        }));
      });
    }
  }

  function glow() {
    const meshes = (list) => list.filter((u) => u !== null && u !== undefined).map((u) => pool[u].mesh);
    setGlow('hover', meshes([hover, marks.selected, ...marks.targets, ...marks.tribute]));
    for (const c of pool) cards.shade(c, marks.dim && ownerOf(c.u) === me && shown?.hand[me].includes(c.u) && !marks.dim.has(c.u) ? 0.55 : 1);
  }

  function reset() {
    shown = null;
    hover = null;
    me = 0;
    marks = { selected: null, targets: [], tribute: [], dim: null };
    setGlow('hover', []);
    cards.finish();
    for (const c of pool) {
      face(c, null);
      const p = ownerOf(c.u);
      cards.place(c, pileSpot(p, 'deck', c.u % DECK));
      c.mesh.visible = true;
    }
    for (const pl of plates) pl.draw(null, null);
    for (const row of labels) for (const lb of row) lb.draw(null, null);
  }

  reset();

  // Klickfläche des eigenen Decks
  const deckHit = new THREE.Mesh(new THREE.BoxGeometry(CARD.w, 2, CARD.h), new THREE.MeshBasicMaterial());
  deckHit.visible = false;
  group.add(deckHit);

  return {
    group,
    // Die Matte ist das Brett, die Karten fliegen beim Umwerfen einzeln (tisch.js)
    loose: () => pool.filter((c) => c.mesh.visible).map((c) => c.mesh),
    setDesign: (s) => (felt.map = feltOf(s.felt)),
    reset,
    update: (dt) => cards.update(dt),
    busy: cards.busy,
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut, labels = Namen je Sitz
    sync(v, seat, labelsNow) {
      names = labelsNow ?? names;
      if (!v) return;
      if (v !== shown) {
        const prev = shown;
        const turned = me !== seat;
        me = seat;
        shown = v;
        const [x, z] = around(PILE.x, PILE.z, me);
        deckHit.position.set(x, Y + 1, z);
        if (v.phase === 'setup') {
          reset();
          [me, shown] = [seat, v]; // reset() setzt beides zurück
        } else if (!prev || turned || prev.phase === 'setup' || v.events[0]?.type === 'deal') {
          if (v.events[0]?.type === 'deal') {
            rebuild({ ...v, hand: [[], []], deck: [[...v.deck[0], ...v.hand[0]].sort((a, b) => a - b), [...v.deck[1], ...v.hand[1]].sort((a, b) => a - b)] });
            playShuffle();
            play({ ...v, events: [...v.hand[0], ...v.hand[1]].sort((a, b) => (a % DECK) - (b % DECK)).map((u) => ({ type: 'draw', u })) });
          } else rebuild(v);
        } else if (v.seq === prev.seq + 1 || v.events[0]?.type === 'caught') play(v, prev);
        else rebuild(v);
      }
      drawSigns(v);
      glow();
    },
    // Hervorhebungen: selected = gewählte Karte, targets = mögliche Ziele, tribute = gewählte Tribute,
    // dim = Set der Handkarten, die gerade gehen (die anderen dunkler) – null = alle hell
    setMarks(next) {
      marks = { selected: null, targets: [], tribute: [], dim: null, ...next };
      if (shown && shown.phase !== 'setup') play({ ...shown, events: [] });
      glow();
    },
    setHover(u) {
      if (u === hover) return;
      const was = hover;
      hover = u;
      if (shown && shown.phase !== 'setup' && [was, u].some((x) => x !== null && shown.hand[me].includes(x))) play({ ...shown, events: [] });
      glow();
    },
    // Getroffene Karte (uid) oder null – Karten im Flug zählen nicht
    pick: (raycaster) => cards.pick(raycaster, pool.filter((c) => c.mesh.visible))?.u ?? null,
    hitDeck: (raycaster) => raycaster.intersectObject(deckHit, false).length > 0,
    // Mit der Hand gepackt (tisch.js): { u, from: 'hand' | 'other' } oder null
    cardOf(mesh) {
      const c = mesh.userData.card;
      if (!c || !shown) return null;
      return { u: c.u, from: shown.hand[me].includes(c.u) ? 'hand' : 'other' };
    },
    // Zone unter einem Punkt (Welt): { row: 'mon' | 'st' | 'field', seat } oder null
    zoneAt(point) {
      const p = group.worldToLocal(point.clone());
      for (const seat of [0, 1]) {
        const [x, z] = seat === 0 ? [p.x, p.z] : [-p.x, -p.z];
        if (Math.abs(x) <= 26 && Math.abs(z - MON_Z) < 5) return { row: 'mon', seat };
        if (Math.abs(x) <= 26 && Math.abs(z - ST_Z) < 5) return { row: 'st', seat };
        if (Math.abs(x - FIELD.x) < 5 && Math.abs(z - FIELD.z) < 5.5) return { row: 'field', seat };
      }
      return null;
    },
  };
}

// Spielmatte: dünne Unterlage aus Filz, darauf Zonen und Schrift (durchscheinend aufgedruckt)
function buildMat(group) {
  const feltMat = new THREE.MeshStandardMaterial({ map: feltOf('gruen'), roughness: 1 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(MAT.w, MAT.h, MAT.d), [edge, edge, feltMat, edge, edge, edge]);
  base.position.y = MAT.h / 2;
  const print = canvasTexture(2048, Math.round((2048 * MAT.d) / MAT.w), (g, w, h) => {
    const s = w / MAT.w; // Pixel je cm
    const X = (x) => w / 2 + x * s;
    const Z = (z) => h / 2 + z * s;
    g.strokeStyle = 'rgba(240, 220, 170, 0.55)';
    g.fillStyle = 'rgba(240, 220, 170, 0.07)';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(X(-MAT.w / 2 + 1), Z(-MAT.d / 2 + 1), (MAT.w - 2) * s, (MAT.d - 2) * s, 28);
    g.stroke();
    g.setLineDash([18, 12]);
    g.beginPath();
    g.moveTo(X(-MAT.w / 2 + 3), Z(0));
    g.lineTo(X(MAT.w / 2 - 3), Z(0));
    g.stroke();
    g.setLineDash([]);
    const zone = (x, z, label, rot) => {
      const zw = CARD.w + 1.4;
      const zh = CARD.h + 1.2;
      g.beginPath();
      g.roundRect(X(x) - (zw * s) / 2, Z(z) - (zh * s) / 2, zw * s, zh * s, 14);
      g.fill();
      g.stroke();
      if (!label) return;
      g.save();
      g.translate(X(x), Z(z));
      g.rotate(rot);
      g.fillStyle = 'rgba(240, 220, 170, 0.42)';
      g.font = `600 ${Math.round(1.05 * s)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      label.split('\n').forEach((line, i, all) => g.fillText(line, 0, (i - (all.length - 1) / 2) * 1.3 * s));
      g.restore();
      g.fillStyle = 'rgba(240, 220, 170, 0.07)';
    };
    for (const seat of [0, 1]) {
      const rot = seat === 0 ? 0 : Math.PI;
      const at = (x, z) => (seat === 0 ? [x, z] : [-x, -z]);
      ZX.forEach((x) => zone(...at(x, MON_Z), 'Monster', rot));
      ZX.forEach((x) => zone(...at(x, ST_Z), 'Zauber\n& Falle', rot));
      zone(...at(FIELD.x, FIELD.z), 'Feld', rot);
      zone(...at(GRAVE.x, GRAVE.z), 'Friedhof', rot);
      zone(...at(PILE.x, PILE.z), 'Deck', rot);
    }
    g.fillStyle = 'rgba(240, 220, 170, 0.3)';
    g.font = `italic ${Math.round(1.6 * s)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('K A R T E N D U E L L', X(-33), Z(0));
    g.fillText('K A R T E N D U E L L', X(33), Z(0));
  });
  const deco = new THREE.Mesh(new THREE.PlaneGeometry(MAT.w, MAT.d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: print, transparent: true, roughness: 1, depthWrite: false }));
  deco.position.y = MAT.h + 0.01;
  for (const m of [base, deco]) {
    m.receiveShadow = true;
    group.add(m);
  }
  base.castShadow = true;
  return { felt: feltMat };
}

// Schild mit Canvas-Bild (draw(fn) zeichnet neu, draw(null) blendet aus)
function buildPlate(group, pw, ph, w, h) {
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, depthWrite: false }));
  mesh.renderOrder = 1;
  mesh.visible = false;
  group.add(mesh);
  let last = null;
  return {
    mesh,
    // key: gleicher Schlüssel = gleiches Bild, dann nicht neu zeichnen
    draw(key, fn) {
      mesh.visible = !!fn;
      if (!fn || key === last) return;
      last = key;
      const g = c.getContext('2d');
      g.clearRect(0, 0, pw, ph);
      fn(g, pw, ph);
      tex.needsUpdate = true;
    },
  };
}
