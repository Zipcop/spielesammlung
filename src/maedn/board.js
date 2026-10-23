// MÄDN-Tisch: Holzbrett mit Aufdruck, 16 Kegelfiguren und der Würfelteller (dice.js). Kennt keine Regeln:
// zeigt einen Spielstand (rules.js) und spielt die Ereignisse der letzten Aktion ab – Figuren hüpfen Feld für Feld,
// Geschlagene fliegen zurück ins Haus. Maße in Zentimetern (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { HOUSE, GOAL, TRACK } from './rules.js';
import { cellOf, pathOf, TRACK_CELLS, GOAL_CELLS, HOUSE_CELLS } from './layout.js';
import { createPlates } from '../plates.js';
import { boardTexture, COLORS, BOARD, STEP, FIELD_R } from './print.js';
import { createDice } from './dice.js';

const THICK = 1.6; // Brettdicke – Figuren stehen auf dieser Höhe
const TRAY_AT = new THREE.Vector3(34.5, 0, 0); // Würfelteller rechts neben dem Brett (vom Host aus)
const HOP_S = 0.17; // ein Feld weiter
const HOP_H = 1.6;
const HOME_S = 0.75; // geschlagene Figur fliegt heim
const HOME_H = 14;

const toWorld = ([c, r]) => new THREE.Vector3((c - 5) * STEP, THICK, (r - 5) * STEP);
const SIDE = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // Blickrichtung je Sitz (0 unten, 1 links, 2 oben, 3 rechts)

// Namensschild eines Sitzes (Rasterfeld der Mitte): im Viertel seines Hauses der freie Streifen aus 4 × 2 Feldern
// neben dem Haus, der quer vor dem Zuschauer liegt (viewer = Sitz der Kamera)
function plateCell(seat, viewer) {
  const [c, r] = [0, 1].map((i) => HOUSE_CELLS[seat].reduce((a, cell) => a + cell[i], 0) / 4); // Mitte des Hauses
  const [qc, qr] = [c, r].map((v) => v + (v < 5 ? 1 : -1)); // Mitte des Viertels (4 × 4 Felder)
  return viewer % 2 === 0 ? [qc, 2 * qr - r] : [2 * qc - c, qr];
}

// Punkt auf dem Brett (lokal, cm) → Stand für seat (0–39 Laufbahn ab dem eigenen A-Feld, 40–43 eigenes Ziel) oder null
function fieldOf(at, seat) {
  const c = Math.round(at.x / STEP + 5);
  const r = Math.round(at.z / STEP + 5);
  const same = ([a, b]) => a === c && b === r;
  const k = TRACK_CELLS.findIndex(same);
  if (k >= 0) return (k - seat * (TRACK / 4) + TRACK) % TRACK;
  const g = GOAL_CELLS[seat].findIndex(same);
  return g >= 0 ? GOAL + g : null;
}

// Kegelfigur als Drehkörper: Fuß mit Fase, schlanker Körper, Kragen, Kugelkopf (3 cm hoch)
function pawnGeometry() {
  const pts = [[0, 0], [0.78, 0], [0.82, 0.07], [0.8, 0.2], [0.7, 0.28], [0.6, 0.5], [0.49, 0.95], [0.4, 1.4],
    [0.33, 1.72], [0.29, 1.88], [0.44, 1.97], [0.42, 2.07], [0.28, 2.12]];
  for (let k = 0; k <= 10; k++) {
    const a = -1.2 + (k / 10) * (Math.PI / 2 + 1.2);
    pts.push([Math.max(0, 0.52 * Math.cos(a)), 2.5 + 0.52 * Math.sin(a)]);
  }
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 32);
}

export function createMaednBoard(parent, { onStream = () => {} } = {}) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const body = buildBoard(group);
  const dice = createDice(group, TRAY_AT, { onStream });

  // Figuren: je Sitz 4, jede mit eigenem Material (für das Aufleuchten) und größerer unsichtbarer Klickfläche
  const geometry = pawnGeometry();
  const hitGeometry = new THREE.CylinderGeometry(1.35, 1.35, 3.4, 12).translate(0, 1.7, 0);
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const pieces = COLORS.map((col) => [0, 1, 2, 3].map(() => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({
      color: col.piece, roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.3,
    }));
    mesh.castShadow = mesh.receiveShadow = true;
    const hit = new THREE.Mesh(hitGeometry, hitMaterial);
    mesh.add(hit);
    group.add(mesh);
    return { mesh, hit, anim: [] };
  }));

  // Ringe unter Figuren, die ziehen dürfen, und eine durchsichtige Figur auf dem Zielfeld
  const ringGeometry = new THREE.RingGeometry(FIELD_R * 0.98, FIELD_R * 1.28, 40).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, toneMapped: false }));
    m.visible = false;
    group.add(m);
    return m;
  });
  const ghost = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
  ghost.visible = false;
  group.add(ghost);
  const ghostRing = new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false }));
  ghostRing.visible = false;
  group.add(ghostRing);

  let shown = null;
  let movable = { seat: -1, list: [] };
  let hover = -1;
  let hoverTarget = null;
  let clock = 0;
  let colors = [0, 1, 2, 3]; // Farbe je Sitz (Index in COLORS) – je nach Farbwahl gedreht
  const plates = createPlates(group, 4, { w: 14, h: 3.5 });
  const prints =new Map([['0,1,2,3', body.material[2].map]]); // Aufdruck je Drehung, höchstens 4

  // Brett und Figuren in den Farben dieser Partie
  function setColors(next) {
    if (next.join() === colors.join()) return;
    colors = [...next];
    if (!prints.has(colors.join())) prints.set(colors.join(), boardTexture(colors));
    body.material[2].map = prints.get(colors.join());
    body.material[2].needsUpdate = true;
    pieces.forEach((mine, seat) => mine.forEach((p) => p.mesh.material.color.setHex(COLORS[colors[seat]].piece)));
  }

  // --- Stand anzeigen ---
  function place(seat, i, pos) {
    const p = pieces[seat][i];
    p.anim = [];
    p.mesh.position.copy(toWorld(cellOf(seat, pos, i)));
  }

  function snap(s) {
    s.pieces.forEach((mine, seat) => mine.forEach((pos, i) => place(seat, i, pos)));
  }

  // Restzeit aller noch geplanten Animationen einer Figur (Sekunden)
  const remaining = (p) => p.anim.reduce((sum, a) => sum + (1 - a.t) * (a.wait ?? a.dur), 0);

  // Hüpfer von Feld zu Feld, hinten an die Warteschlange der Figur; delay = so lange wartet sie vorher.
  // Liefert, wann die Figur ankommt (von jetzt an gerechnet).
  function queueHops(seat, i, cells, { delay = 0, dur = HOP_S, height = HOP_H, last = 0.5, step = 0.22 } = {}) {
    const p = pieces[seat][i];
    let from = p.anim.length ? p.anim.at(-1).to : p.mesh.position.clone();
    if (delay > 0) p.anim.push({ wait: delay, t: 0, to: from });
    cells.forEach((cell, k) => {
      const to = toWorld(cell);
      p.anim.push({ from, to, t: 0, dur, height, sound: k === cells.length - 1 ? last : step });
      from = to;
    });
    return remaining(p);
  }

  function animate(s) {
    let arrive = 0; // wann der Ziehende ankommt – auch wenn er noch einen älteren Zug abarbeitet
    for (const e of s.events) {
      if (e.type === 'move') {
        const out = e.from === HOUSE;
        arrive = queueHops(e.player, e.piece, pathOf(e.player, e.from, e.to, e.piece), out ? { dur: 0.36, height: 3.5 } : {});
      } else if (e.type === 'hit') {
        const victim = pieces[e.player][e.piece];
        playHit('swish', 0.5, arrive);
        queueHops(e.player, e.piece, [cellOf(e.player, HOUSE, e.piece)], { delay: arrive - remaining(victim), dur: HOME_S, height: HOME_H, last: 0.8 });
      } else if (e.type === 'home' || e.type === 'back') {
        // „Geschummelt!“: Schummel-Figur fliegt heim, geschlagene Figur zurück auf ihr Feld
        queueHops(e.player, e.piece, [cellOf(e.player, e.type === 'home' ? HOUSE : e.to, e.piece)], { dur: HOME_S, height: HOME_H, last: 0.8 });
      }
    }
  }

  function update(dt) {
    clock += dt;
    dice.update(dt);
    for (const mine of pieces) {
      for (const p of mine) {
        let left = dt;
        while (left > 0 && p.anim.length) {
          const a = p.anim[0];
          const dur = a.wait ?? a.dur;
          const use = Math.min(left, (1 - a.t) * dur);
          a.t += use / dur;
          left -= use;
          if (a.wait === undefined) {
            const k = a.t * a.t * (3 - 2 * a.t);
            p.mesh.position.lerpVectors(a.from, a.to, k);
            p.mesh.position.y += Math.sin(a.t * Math.PI) * a.height;
          }
          if (a.t >= 1 - 1e-9) {
            p.anim.shift();
            if (a.sound) playHit('wood', a.sound);
          } else break;
        }
      }
    }
    // bewegbare Figuren pulsieren leicht
    const glow = 0.45 + 0.35 * Math.sin(clock * 5);
    rings.forEach((r) => (r.material.opacity = glow + 0.2));
    pieces.forEach((mine, seat) => mine.forEach((p, i) => {
      const on = seat === movable.seat && movable.list.includes(i);
      p.mesh.material.emissive.setHex(on ? 0x6a4a10 : 0x000000);
      p.mesh.material.emissiveIntensity = on ? (i === hover ? 1.4 : glow) : 0;
    }));
    // Ringe folgen den Figuren (auch während sie hüpfen)
    rings.forEach((r, k) => {
      const i = movable.list[k];
      r.visible = i !== undefined && !busy();
      if (r.visible) r.position.copy(pieces[movable.seat][i].mesh.position).setY(THICK + 0.03);
    });
  }

  const busy = () => dice.busy() || pieces.some((mine) => mine.some((p) => p.anim.length));

  function setHover(seat, i, target) {
    if (i === hover && target === hoverTarget && seat === movable.seat) return;
    hover = i;
    hoverTarget = target;
    const on = i >= 0 && target !== null && target !== undefined;
    setGlow('hover', on ? [pieces[seat][i].mesh] : []);
    ghost.visible = ghostRing.visible = on;
    if (!on) return;
    const at = toWorld(cellOf(seat, target, i));
    ghost.position.copy(at);
    ghostRing.position.copy(at).setY(THICK + 0.03);
    ghost.material.color.setHex(COLORS[colors[seat]].piece);
  }

  function reset() {
    shown = null;
    setColors([0, 1, 2, 3]);
    plates.set([]);
    movable = { seat: -1, list: [] };
    setHover(-1, -1, null);
    dice.reset();
    // Startbild: alle Figuren im Haus, je eine auf ihrem A-Feld
    pieces.forEach((mine, seat) => mine.forEach((_, i) => place(seat, i, i === 0 ? 0 : HOUSE)));
  }

  reset();

  return {
    group,
    loose: () => [...pieces.flat().map((p) => p.mesh), dice.tray], // Figuren und Würfelteller fliegen beim Umwerfen einzeln (tisch.js)
    setDesign: dice.setDesign, // Würfelfarbe und Filz dieses PCs
    ready: dice.ready,
    roll: dice.roll,
    applyRemote: dice.applyRemote,
    update,
    busy,
    reset,
    // s = Spielstand; bei genau einer neuen Aktion wird sie abgespielt, sonst alles direkt hingestellt
    sync(s) {
      if (!s || s === shown) return;
      setColors(s.colors ?? [0, 1, 2, 3]); // während der Farbwahl: Brett wie im Karton
      if (shown && s.seq === shown.seq + 1 && s.pieces && shown.pieces) animate(s);
      else if (s.pieces && (!shown || s.seq !== shown.seq || !shown.pieces)) snap(s);
      shown = s;
    },
    // Namensschilder in der Ecke jeder Farbe: labels[sitz] = Text, turn = wer dran ist (oder null), viewer = Sitz der Kamera
    names: (labels, turn, viewer) => plates.set(labels, { at: (s) => toWorld(plateCell(s, viewer)), view: SIDE[viewer], turn }),
    // Figuren, die gerade ziehen dürfen (leuchten, Ring darunter)
    setMovable(seat, list) {
      movable = { seat, list: [...list] };
      if (!movable.list.includes(hover)) setHover(seat, -1, null);
    },
    setHover,
    hitTray: dice.hit,
    // eigene Figur unter der Maus (nur aus allowed), sonst -1. exact = nur der Kegel, nicht die große Klickfläche
    pickPiece(raycaster, seat, allowed, exact = false) {
      const targets = allowed.map((i) => (exact ? pieces[seat][i].mesh : pieces[seat][i].hit));
      const hits = raycaster.intersectObjects(targets, false);
      return hits.length ? allowed[targets.indexOf(hits[0].object)] : -1;
    },
    // Feld unter der Maus als Stand für seat (0–39 Laufbahn ab dem eigenen A-Feld, 40–43 eigenes Ziel), sonst null.
    // Zeigt die Maus auf eine fremde Figur, zählt das Feld, auf dem sie steht (sonst träfe man das Feld dahinter).
    // Eigene Figuren zählen nicht – auf ihr Feld darf man ohnehin nicht, und sie sollen keine Felder verdecken.
    pickField(raycaster, seat) {
      const onPiece = raycaster.intersectObjects(pieces.filter((_, q) => q !== seat).flat().map((p) => p.hit), false)[0];
      const onBoard = raycaster.intersectObject(body, false)[0];
      const at = onPiece ? onPiece.object.parent.position.clone() : onBoard && group.worldToLocal(onBoard.point.clone());
      if (!at || (!onPiece && Math.abs(at.y - THICK) > 0.1)) return null; // nur die Oberseite des Bretts
      return fieldOf(at, seat);
    },
    // Wo eine Figur mit der Hand abgestellt wurde (tisch.js): Punkt (Welt) → { field: Stand für seat oder null, onBoard }
    fieldAt(point, seat) {
      const at = group.worldToLocal(point.clone());
      return { field: fieldOf(at, seat), onBoard: Math.abs(at.x) <= BOARD / 2 && Math.abs(at.z) <= BOARD / 2 };
    },
    // Figur zu einem Mesh: { seat, piece } oder null
    pieceOf(mesh) {
      for (let seat = 0; seat < pieces.length; seat++) {
        const i = pieces[seat].findIndex((p) => p.mesh === mesh);
        if (i >= 0) return { seat, piece: i };
      }
      return null;
    },
    // Würfel mit der Hand: grabDie(seat) → Augenzahl (Promise), dragDie(Strahl) schüttelt, releaseDie() wirft
    grabDie: dice.grab,
    dragDie: dice.drag,
    releaseDie: dice.release,
    hitDie: dice.hitDie,
  };
}

function buildBoard(group) {
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#6a3c1c', boards: 3 }), roughness: 0.45 });
  const print = new THREE.MeshPhysicalMaterial({ map: boardTexture(), roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.5 });
  // Brettkörper (Seiten aus Holz), oben der Aufdruck
  const body = new THREE.Mesh(new THREE.BoxGeometry(BOARD, THICK, BOARD), [wood, wood, print, wood, wood, wood]);
  body.position.y = THICK / 2;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return body;
}
