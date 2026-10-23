// Memory-Tisch: quadratische Kärtchen aus dicker Pappe (5,4 cm, runde Ecken) verdeckt im Raster in der Tischmitte,
// eingesteckte Paare liegen offen, schindelartig rechts vor dem Spieler (Host vorn rechts, Gast hinten links).
// Kennt keine Regeln: zeigt die Sicht eines Spielers (viewFor) und spielt die Ereignisse der letzten Aktion ab –
// Kärtchen drehen sich im Bogen um, Paare fliegen zum Spieler, beim Linsen kommt ein Kärtchen kurz hoch (nur der
// Linsende sieht das Motiv). Maße in Zentimetern (Gruppe 1/100 skaliert). Platz i liegt auf beiden PCs an derselben
// Stelle (die Tisch-Physik erkennt Teile an ihrer Nummer); offene Motive liegen für den, der zuschaut, aufrecht.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { motifTexture, tileBack, setTileBack } from './motifs.js';
import { GRID } from './game.js';
import { playHit, playShuffle } from '../sound.js';
import { setGlow } from '../glow.js';
import { createPlates, across } from '../plates.js';

export const TILE = { w: 5.4, t: 0.22, r: 0.45 };
const MAX = 48; // 24 Paare
const PITCH = 5.9; // Abstand im Raster
const PILE = { x: 30, z: 4, dx: 2.8, dz: 6.4, per: 5 }; // eingesteckte Paare des Hosts (der Gast gegenüber, gespiegelt)
const FLY_S = 0.4;
const GLARE = 0.35; // flach liegende Vorderseiten etwas dunkler – sonst überstrahlt die Hängelampe sie
const UP = new THREE.Vector3(0, 1, 0);
const ACROSS = new THREE.Vector3(1, 0, 0);
const FACE_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
const normal = new THREE.Vector3();

const same = (a, b) => !!a && a.pos.distanceToSquared(b.pos) < 1e-6 && a.quat.angleTo(b.quat) < 1e-3;

// Kärtchen: Ober- und Unterseite (rundes Quadrat) und Kante – Gruppen: Vorderseite (oben), Rückseite, Kante
function tileGeometry() {
  const { w, t, r } = TILE;
  const h = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-h + r, -h);
  shape.lineTo(h - r, -h);
  shape.quadraticCurveTo(h, -h, h, -h + r);
  shape.lineTo(h, h - r);
  shape.quadraticCurveTo(h, h, h - r, h);
  shape.lineTo(-h + r, h);
  shape.quadraticCurveTo(-h, h, -h, h - r);
  shape.lineTo(-h, -h + r);
  shape.quadraticCurveTo(-h, -h, -h + r, -h);
  const side = (up) => {
    const g = new THREE.ShapeGeometry(shape, 4).toNonIndexed();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) g.attributes.uv.setXY(i, (pos.getX(i) + h) / w, (pos.getY(i) + h) / w);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, up ? t / 2 : -t / 2, 0);
    return g;
  };
  const ring = shape.getPoints(4);
  const edge = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [a, b] = [ring[i], ring[i + 1]];
    edge.push(a.x, t / 2, -a.y, b.x, t / 2, -b.y, b.x, -t / 2, -b.y, a.x, t / 2, -a.y, b.x, -t / 2, -b.y, a.x, -t / 2, -a.y);
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
  band.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((edge.length / 3) * 2).fill(0), 2));
  band.computeVertexNormals();
  return mergeGeometries([side(true), side(false), band], true);
}

export function createMemoryBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);
  const geometry = tileGeometry();
  const backMat = new THREE.MeshStandardMaterial({ map: tileBack(), color: 0xb8b8b8, roughness: 0.8 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.9 });
  const tiles = Array.from({ length: MAX }, (_, i) => {
    const front = new THREE.MeshStandardMaterial({ map: tileBack(), roughness: 0.85 });
    const mesh = new THREE.Mesh(geometry, [front, backMat, edgeMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const tile = { i, mesh, id: null, target: null };
    mesh.userData.tile = tile;
    return tile;
  });

  const plates = createPlates(group, 2);
  let anims = [];
  let clock = 0;
  let shown = null;
  let me = 0;
  let set = 'tiere';
  let cols = 6;
  let rows = 6;
  let hover = null;

  // --- Lagen ---
  const turn = () => (me === 0 ? 0 : Math.PI); // offene Motive aufrecht für den, der zuschaut
  const flat = (x, y, z, up) => {
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, turn());
    if (!up) quat.multiply(FACE_DOWN);
    return { pos: new THREE.Vector3(x, y + TILE.t / 2, z), quat };
  };
  const gridSpot = (i, up) => flat((i % cols - (cols - 1) / 2) * PITCH, 0, (Math.floor(i / cols) - (rows - 1) / 2) * PITCH, up);
  // k-tes Kärtchen im Stapel von Spieler p: je Paar zwei übereinander, die Paare als Schindeln nebeneinander
  function pileSpot(p, k) {
    const q = Math.floor(k / 2);
    const col = q % PILE.per;
    const v = new THREE.Vector3(PILE.x + col * PILE.dx, (col * 2 + (k % 2)) * TILE.t + (k % 2) * 0.02, PILE.z + Math.floor(q / PILE.per) * PILE.dz);
    if (p === 1) v.set(-v.x, v.y, -v.z);
    const s = flat(v.x, v.y, v.z, true);
    s.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, (k % 2 ? 0.08 : -0.05)));
    return s;
  }
  // Vor dem Austeilen: alle Kärtchen als vier Stapel in der Mitte
  const boxSpot = (i) => flat(((i % 4) - 1.5) * (TILE.w + 0.8), Math.floor(i / 4) * TILE.t, 0, false);
  // Linsen: Kärtchen hoch und zum Linsenden gekippt, die Unterseite zeigt zu ihm
  function peekSpot(i, by) {
    const s = gridSpot(i, false);
    const toward = by === 0 ? 1 : -1;
    s.pos.add(new THREE.Vector3(0, 4.5, toward * 2.5));
    s.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, -toward * 2.0));
    return s;
  }

  // --- Bild ---
  function setFace(tile, id) {
    tile.id = id;
    tile.mesh.material[0].map = id === null ? tileBack() : motifTexture(set, id);
  }

  // --- Bewegung (wie cards3d.js): Bogen mit Drehung; queue = nach den schon geplanten ---
  function place(tile, spot) {
    tile.target = spot;
    tile.mesh.position.copy(spot.pos);
    tile.mesh.quaternion.copy(spot.quat);
  }

  function fly(tile, spot, { delay = 0, dur = FLY_S, lift = 0, queue = false, onStart, onLand } = {}) {
    if (same(tile.target, spot) && !queue) return;
    const last = anims.findLast((a) => a.tile === tile && !a.done);
    if (last && !queue) last.to = spot;
    else anims.push({ tile, to: spot, start: clock + delay, dur, lift, onStart, onLand, from: null });
    tile.target = spot;
  }

  function update(dt) {
    clock += dt;
    for (const a of anims) {
      if (a.done || clock < a.start) continue;
      if (!a.from) {
        for (const b of anims) if (b !== a && b.tile === a.tile && b.from) b.done = true;
        a.from = { pos: a.tile.mesh.position.clone(), quat: a.tile.mesh.quaternion.clone() };
        a.onStart?.();
      }
      const t = Math.min((clock - a.start) / a.dur, 1);
      const k = t * t * (3 - 2 * t);
      a.tile.mesh.position.lerpVectors(a.from.pos, a.to.pos, k);
      a.tile.mesh.position.y += Math.sin(t * Math.PI) * a.lift;
      a.tile.mesh.quaternion.slerpQuaternions(a.from.quat, a.to.quat, k);
      if (t === 1) {
        a.done = true;
        a.onLand?.(false);
      }
    }
    anims = anims.filter((a) => !a.done);
    for (const tile of tiles) {
      const up = Math.max(0, normal.set(0, 1, 0).applyQuaternion(tile.mesh.quaternion).y);
      tile.mesh.material[0].color.setScalar(1 - GLARE * up ** 4);
    }
  }

  function finish() {
    const open = anims;
    anims = [];
    for (const a of open) a.onLand?.(true);
    for (const a of open) place(a.tile, a.tile.target);
  }

  const busy = () => Math.max(0, ...anims.map((a) => a.start + a.dur - clock));

  // --- Stand zeigen ---
  // Ziel jedes Platzes laut Sicht v: liegt im Raster (offen, wenn das Motiv bekannt ist) oder im Stapel des Besitzers
  function spotOf(v, i) {
    const o = v.owner[i];
    return o === null ? gridSpot(i, v.tiles[i] !== null) : pileSpot(o, v.piles[o].indexOf(i));
  }

  // Alle Kärtchen an ihren Platz. timing = Map Platz → { delay, lift, dur } (sonst kurzer Flug); instant = sofort
  function layout(v, timing = new Map(), instant = false) {
    tiles.forEach((tile, i) => {
      tile.mesh.visible = i < v.tiles.length;
      if (!tile.mesh.visible) return;
      const spot = spotOf(v, i);
      const id = v.tiles[i];
      const m = timing.get(i);
      if (instant || !m && same(tile.target, spot)) {
        if (instant) place(tile, spot);
        if (tile.id !== id) setFace(tile, id);
        return;
      }
      const faceNow = id !== null && tile.id !== id; // Bild beim Abflug, verdeckt erst beim Landen
      fly(tile, spot, {
        delay: m?.delay ?? 0,
        dur: m?.dur ?? 0.3,
        lift: m?.lift ?? 1.5,
        queue: !!m?.queue,
        onStart: () => faceNow && setFace(tile, id),
        onLand: (quiet) => {
          if (id === null && tile.id !== null) setFace(tile, null);
          if (!quiet) playHit('card', m?.sound ?? 0.5);
        },
      });
    });
  }

  function rebuild(v) {
    finish();
    set = v.set;
    [cols, rows] = GRID[v.size] ?? [6, 6];
    if (v.phase === 'setup') {
      tiles.forEach((tile, i) => {
        tile.mesh.visible = true;
        setFace(tile, null);
        place(tile, boxSpot(i));
      });
      return;
    }
    layout(v, new Map(), true);
  }

  // Alle Kärtchen zurück in die Stapel in der Mitte (Bild weg, sobald sie liegen)
  function collect() {
    tiles.forEach((tile, i) => {
      tile.mesh.visible = true;
      fly(tile, boxSpot(i), { delay: i * 0.008, dur: 0.4, lift: 3, onLand: () => setFace(tile, null) });
    });
  }

  // Austeilen: alles in die Stapel, mischen, dann reihum ins Raster (übrige bleiben in der Schachtel)
  function deal(v) {
    collect();
    set = v.set;
    [cols, rows] = GRID[v.size];
    playShuffle();
    layout(v, new Map(v.tiles.map((_, i) => [i, { delay: 0.9 + i * 0.035, dur: 0.35, lift: 3, sound: 0.3, queue: true }])));
  }

  // Ereignisse der letzten Aktion abspielen. delay zählt jeweils ab jetzt.
  function play(v) {
    const timing = new Map(); // letzter Flug je Platz (layout)
    let t = 0;
    for (const e of v.events) {
      if (e.type === 'cover' || e.type === 'pass') {
        for (const i of e.tiles) timing.set(i, { delay: t, dur: 0.35, lift: 1.5, sound: 0.4 });
        if (e.tiles.length) t += 0.35;
      } else if (e.type === 'flip') {
        timing.set(e.i, { delay: t, dur: 0.4, lift: 2.5, sound: 0.6 });
        t += 0.4;
      } else if (e.type === 'pair' || e.type === 'pocket') {
        t += e.type === 'pair' ? 0.9 : 0.2; // erst sehen, dann zum Spieler
        for (const i of e.tiles) {
          const f = timing.get(i);
          // gerade aufgedeckt: erst im Raster umdrehen, danach zum Stapel
          if (f) fly(tiles[i], gridSpot(i, true), { delay: f.delay, dur: f.dur, lift: f.lift, onStart: () => setFace(tiles[i], v.tiles[i]), onLand: (q) => !q && playHit('card', 0.6) });
          timing.set(i, { delay: t, dur: 0.55, lift: 5, sound: 0.5, queue: !!f });
        }
        t += 0.3;
      }
    }
    layout(v, timing);
    for (const e of v.events) if (e.type === 'peek') peekAnim(v, e);
  }

  // Linsen: hoch, kurz halten, wieder hin. Der Linsende sieht das Motiv (nur in seiner Sicht steht es im Ereignis).
  // delay zählt auch bei queue ab jetzt.
  function peekAnim(v, e) {
    const tile = tiles[e.i];
    const up = peekSpot(e.i, e.by);
    const back = spotOf(v, e.i);
    fly(tile, up, { dur: 0.35, lift: 0, onStart: () => e.motif !== null && e.motif !== undefined && setFace(tile, e.motif) });
    fly(tile, up, { delay: 0.35, dur: 1.3, queue: true });
    fly(tile, back, { delay: 1.65, dur: 0.35, queue: true, onLand: (quiet) => {
      if (shown?.tiles[e.i] === null) setFace(tile, null);
      if (!quiet) playHit('card', 0.4);
    } });
  }

  function reset() {
    shown = null;
    hover = null;
    me = 0;
    setGlow('hover', []);
    plates.set([]);
    rebuild({ phase: 'setup', set: 'tiere', size: 24 });
  }

  reset();

  return {
    group,
    loose: () => tiles.map((t) => t.mesh), // kein Brett – beim Umwerfen fliegen die Kärtchen (tisch.js)
    setDesign: (s) => setTileBack(s.cardBack), // Rückseite in der Farbe des Kartenrückens dieses PCs
    update,
    busy,
    reset,
    // Namensschilder vor dem Raster: labels[spieler] = Text, turn = wer dran ist (oder null)
    names: (labels, who = null) => plates.set(labels, { at: (p) => across(p, 0, 23), view: turn(), turn: who }),
    // v = Sicht eines Spielers (viewFor), seat = wer zuschaut
    sync(v, seat) {
      if (!v || v === shown) return;
      const prev = shown;
      const turned = me !== seat;
      me = seat;
      shown = v;
      if (v.phase === 'setup') return prev ? collect() : rebuild(v);
      if (v.events[0]?.type === 'deal' && prev?.seq !== v.seq) return deal(v);
      if (prev && !turned && prev.phase !== 'setup' && prev.round === v.round && v.seq === prev.seq + 1) return play(v);
      rebuild(v);
    },
    // Platz unter der Maus aus der Liste allowed (Plätze) oder null
    pick(raycaster, allowed) {
      const flying = new Set(anims.filter((a) => a.lift > 0).map((a) => a.tile));
      const list = allowed.map((i) => tiles[i]).filter((t) => !flying.has(t) && t.mesh.visible);
      const hit = raycaster.intersectObjects(list.map((t) => t.mesh), false)[0];
      return hit ? hit.object.userData.tile.i : null;
    },
    setHover(i) {
      const tile = i === null || i === undefined ? null : tiles[i];
      if (tile === hover) return;
      hover = tile;
      setGlow('hover', tile ? [tile.mesh] : []);
    },
    // Kärtchen zu einem Mesh (mit der Hand gepackt, tisch.js): Platz oder null
    tileOf: (mesh) => mesh.userData.tile?.i ?? null,
    // Liegt ein Punkt (Welt) bei meinen eingesteckten Paaren?
    nearPile(point) {
      const p = group.worldToLocal(point.clone());
      const x = me === 0 ? p.x : -p.x;
      const z = me === 0 ? p.z : -p.z;
      return x > PILE.x - 5 && z > PILE.z - 5 && z < PILE.z + 4 * PILE.dz;
    },
  };
}
