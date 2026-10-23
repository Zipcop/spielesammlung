// Tisch-Physik für alle Spiele: Jedes Teil lässt sich einzeln packen – Figuren, Würfel, Becher, Karten, Block,
// Würfelteller und das Brett selbst. Linke Maustaste auf ein Teil und ziehen = hochheben (Mausrad = höher/tiefer),
// loslassen = fallen lassen, schwungvoll loslassen = werfen. Was getroffen wird, kippt oder fliegt mit.
// Das Brett rutscht flach über den Tisch; schwungvoll losgelassen, über die Kante geschoben oder mit dem Mausrad
// angehoben, fliegt alles einzeln durcheinander. „Aufbauen“ stellt alles wieder hin.
//
// Die Partie bleibt immer erhalten: Ein gepacktes Teil ist eine Kopie, das echte Teil wird nur versteckt.
// Bewegt das Spiel das echte Teil (Zug, Wurf, geschlagen), fliegt die Kopie von selbst dorthin zurück.
// Ist das ganze Brett umgeworfen, nimmt das Spiel bis zum Aufbauen keine Klicks an (Computergegner ziehen weiter).
// Sanft abgestellt (nicht geworfen) fragt der Tisch das Spiel: board.onPlace(echtes Teil, Punkt) → 'move' = das Spiel
// zieht (die Kopie rastet danach am neuen Platz ein), 'back' = zurück an den alten Platz, null = bleibt liegen.
//
// Netz: Wer ein Teil anfasst oder anstößt, rechnet dessen Physik und sendet die Lagen 30-mal pro Sekunde;
// beim anderen folgt die Kopie nur. So sehen beide dieselben Flugbahnen. Teile heißen nach ihrer Nummer in
// loose(), das Brett heißt 'b'. Weil die Reihenfolge auf beiden PCs nicht gleich sein muss (Schach legt Figuren
// neu an), sagt der Packende dazu, wo das Teil im Spiel steht – der andere nimmt sein Teil an dieser Stelle.
//
// Ein Brett braucht dafür nur: group (alles des Spiels) und loose() = lose Teile (Figuren, Würfel, Karten …).
import * as THREE from 'three';
import { TABLE_TOP } from './room.js';
import { playHit } from './sound.js';

const STEP = 1 / 120;
const DRAG_PX = 18; // ab so viel Mausweg wird aus einem Klick ein Greifen (kleines Verwackeln bleibt ein Klick)
const THROW_SPEED = 1.2; // m/s – Brett schneller losgelassen = umwerfen
const SLIDE_SPEED = 3.5; // m/s – so schnell folgt das geschobene Brett höchstens der Maus
const HAND_SPEED = 5; // m/s – so schnell folgt ein gepacktes Teil höchstens (= schnellster Wurf)
const PULL = 12; // wie fest ein gepacktes Teil zur Maus gezogen wird
const LIFT = 0.08; // m – so hoch hebt man ein Teil beim Packen an
const WHEEL_STEP = 0.02; // m je Mausrad-Raste
const MAX_HEIGHT = 1.6;
const KNOCK_SPEED = 0.25; // m/s – so schnell muss ein Teil sein, um ein stehendes umzustoßen
const FORCE_MIN = 0.01; // N – ab dieser Kontaktkraft zählt eine Berührung
const UPRIGHT = 8; // wie fest sich ein gepacktes Teil aufrichtet
const BACK_S = 0.9; // Zurückfliegen
const SNAP_S = 0.25; // nach einem Zug mit der Hand: kurz auf das Feld einrasten
const PLACE_SPEED = 0.8; // m/s – langsamer abgestellt zählt als Zug, schneller ist geworfen
const MOVE_WAIT_MS = 2500; // so lange wartet ein abgestellter Zug auf das Spiel, dann fliegt die Figur zurück
const SEND_MS = 33; // Lagen 30-mal pro Sekunde senden
const POSE_MS = 50; // Lage des geschobenen Bretts 20-mal pro Sekunde
const MOVED = 0.005; // m – so weit muss das Spiel ein echtes Teil bewegen, damit seine Kopie zurückfliegt
const TURNED = 0.05; // rad – oder so weit drehen
const TABLE_HALF = 0.5;
const ROOM_HALF = 3;
const ROOM_H = 2.6;
const MIN_HALF = new THREE.Vector3(0.0015, 0.0015, 0.0015); // Karten, Filz: nicht dünner als 3 mm, sonst rutschen sie durch
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = { x: 0, y: 0, z: 0 };

// Kollisionsgruppen (Mitglied << 16 | Filter): Zimmer, Brett, stehende Teile, lose Teile.
// Stehende Teile stoßen nur mit losen zusammen – sonst drückten sie gegen das Brett, auf dem sie stehen.
const ROOM = 1;
const BASE = 2;
const PLACED = 4;
const LOOSE = 8;
const groups = (member, filter) => (member << 16) | filter;
const G_ROOM = groups(ROOM, BASE | LOOSE);
const G_BASE = groups(BASE, ROOM | LOOSE);
const G_PLACED = groups(PLACED, LOOSE);
const G_LOOSE = groups(LOOSE, ROOM | BASE | PLACED | LOOSE);
const HIDDEN = 31; // Ebene für versteckte echte Teile – Kamera, Schatten und Maus sehen nur Ebene 0

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);
const r4 = (n) => Math.round(n * 10000) / 10000;

export function createTisch({ room, canvas, send }) {
  const scene = room.scene;
  const rank = Math.random(); // packen beide gleichzeitig dasselbe Teil, behält es der mit der größeren Zahl
  let board = null; // Brett des laufenden Spiels
  let home = null; // Platz des Bretts auf dem Tisch (lokal)
  let RAPIER = null;
  let world = null;
  let queue = null;
  let loading = null;

  // Solange etwas los ist, hat jedes Teil einen Körper (sonst gar keinen – spart Rechenzeit).
  // Teil: { key, original, body, colliders, state: placed | mine | theirs, copy, ret, target, … }
  let items = null;
  const byCollider = new Map(); // Collider-Handle → Teil
  let touching = new Set(); // Paare, die sich im letzten Schritt berührt haben (neue Berührung = Aufprall)
  const aliases = new Map(); // Nummer beim Mitspieler → meine Nummer für dasselbe Teil
  const savedLayers = new WeakMap();
  let slide = false; // Brett wird geschoben
  let full = false; // ganzes Brett umgeworfen – das Spiel ruht bis zum Aufbauen
  let grab = null; // { item, body, slide, height, point, local }
  let pending = null; // Maus gedrückt, noch kein Greifen
  let pressed = false; // linke Maustaste ist gerade unten (Greifen startet erst nach dem Laden – vielleicht ist sie dann schon los)
  let taken = false; // dieses Drücken hat eine lose Kopie gepackt – der Klick danach gehört nicht dem Spiel
  let slideBack = null; // verschobenes Brett rutscht zurück
  let lastEvent = null;
  let lastSend = 0;
  let lastPose = 0;
  let remotePose = null; // Lage des Bretts vom Mitspieler
  let round = 0; // zählt „Aufbauen“ – Brett-Lagen aus einer früheren Runde werden verworfen

  const button = document.createElement('button');
  button.className = 'tisch-aufbauen';
  button.textContent = 'Aufbauen';
  button.hidden = true;
  document.body.append(button);
  button.onclick = () => {
    send({ t: 'tisch', a: 'auf' });
    rebuild();
  };

  function ready() {
    loading ??= (async () => {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      world.timestep = STEP;
      queue = new RAPIER.EventQueue(true);
      const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const wall = (hx, hy, hz, x, y, z, friction = 0.6) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z).setFriction(friction).setRestitution(0.2).setCollisionGroups(G_ROOM), fixed);
      wall(TABLE_HALF, 0.0225, TABLE_HALF, 0, TABLE_TOP - 0.0225, 0, 0.5); // Tischplatte
      wall(ROOM_HALF, 0.05, ROOM_HALF, 0, -0.05, 0, 0.8); // Boden
      wall(ROOM_HALF, 0.05, ROOM_HALF, 0, ROOM_H + 0.05, 0); // Decke
      for (const s of [-1, 1]) {
        wall(0.05, ROOM_H / 2, ROOM_HALF, s * (ROOM_HALF + 0.05), ROOM_H / 2, 0);
        wall(ROOM_HALF, ROOM_H / 2, 0.05, 0, ROOM_H / 2, s * (ROOM_HALF + 0.05));
      }
    })();
    return loading;
  }

  // --- Hilfen ---
  const worldPos = (o) => o.getWorldPosition(new THREE.Vector3());
  const worldQuat = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const visibleMesh = (o) => o.isMesh && o.visible && o.material && !(Array.isArray(o.material) ? o.material : [o.material]).every((m) => m.visible === false);
  const isChild = (o, parent) => {
    for (let p = o; p; p = p.parent) if (p === parent) return true;
    return false;
  };
  const meshesOf = (o) => {
    const out = [];
    o.traverse((m) => visibleMesh(m) && out.push(m));
    return out;
  };

  // Feste Teile des Bretts: alle sichtbaren Meshes, die nicht zu einem losen Teil gehören
  function baseMeshes() {
    const loose = new Set(board.loose());
    const out = [];
    board.group.traverse((o) => {
      if (loose.has(o)) return;
      for (let p = o.parent; p && p !== board.group; p = p.parent) if (loose.has(p)) return;
      if (visibleMesh(o) && !o.userData.plate) out.push(o); // Namensschilder (plates.js) sind kein Teil des Bretts
    });
    return out;
  }

  // Loses Teil, zu dem ein getroffenes Mesh gehört (oder null = Brett)
  function looseOf(o) {
    const loose = new Set(board.loose());
    for (let p = o; p && p !== board.group; p = p.parent) if (loose.has(p)) return p;
    return null;
  }

  // Lage von m im Rahmen von frame: [Mitte, Drehung, halbe Größe] in Metern (Achsen von m)
  function partIn(frame, m) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const rel = new THREE.Matrix4().multiplyMatrices(frame.matrixWorld.clone().invert(), m.matrixWorld);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    rel.decompose(pos, quat, scale);
    const s = frame.getWorldScale(new THREE.Vector3());
    const box = m.geometry.boundingBox;
    const center = box.getCenter(new THREE.Vector3()).multiply(scale).applyQuaternion(quat).add(pos).multiply(s);
    const half = box.getSize(new THREE.Vector3()).multiply(scale).multiply(s).multiplyScalar(0.5).max(MIN_HALF);
    return { center, quat, half };
  }

  // Hohes rundes Teil als 16-eckiges Prisma – ein echter Zylinder rollt umgefallen ewig weiter und schläft nie ein
  function prism(halfHeight, radius) {
    const points = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const y of [-halfHeight, halfHeight]) points.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    }
    return RAPIER.ColliderDesc.convexHull(new Float32Array(points));
  }

  // Form eines losen Teils aus seiner Hülle: hohe runde Teile (Figuren, Becher) als Prisma, sonst als Quader
  function shapeOf(o, meshes) {
    o.updateWorldMatrix(true, true);
    const inv = o.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    for (const m of meshes) {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    }
    const s = o.getWorldScale(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3()).multiply(s);
    const h = box.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5).max(MIN_HALF);
    const r = Math.max(h.x, h.z);
    const round = Math.abs(h.x - h.z) < 0.25 * r && h.y > 1.2 * r;
    const desc = (round && prism(h.y, r)) || RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z);
    return {
      descs: [desc.setTranslation(center.x, center.y, center.z)],
      cube: !round && Math.max(h.x, h.y, h.z) < 1.3 * Math.min(h.x, h.y, h.z), // Würfel liegen auf jeder Seite richtig
      thin: Math.min(h.x, h.y, h.z) <= MIN_HALF.x, // Karte
    };
  }

  // Brett aus vielen Quadern (einer je Mesh) – so bleibt eine Würfelschale hohl
  function baseShape(meshes) {
    board.group.updateWorldMatrix(true, true);
    return {
      descs: meshes.map((m) => {
        const { center, quat, half } = partIn(board.group, m);
        return RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setRotation(quat);
      }),
      cube: false,
      thin: false,
    };
  }

  function makeBody(o, shape, density) {
    const p = worldPos(o);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(worldQuat(o))
      .setCcdEnabled(true)
      .setLinearDamping(0.15)
      .setAngularDamping(0.3));
    const colliders = shape.descs.map((d) => world.createCollider(d.setDensity(density).setFriction(0.55).setRestitution(0.25)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(FORCE_MIN), body));
    return { body, colliders };
  }

  function setGroups(it, g) {
    for (const c of it.colliders) c.setCollisionGroups(g);
  }

  // Tisch aufwecken: jedes sichtbare Teil und das Brett bekommen einen Körper, der dem Spiel folgt
  function wake() {
    if (items || !world || !board) return;
    items = new Map();
    board.group.updateWorldMatrix(true, true);
    const add = (it) => {
      it.rest = worldQuat(it.original); // so steht es normalerweise (zum Aufrichten in der Hand)
      it.upAxis = UP.clone().applyQuaternion(it.rest.clone().invert());
      for (const c of it.colliders) byCollider.set(c.handle, it);
      items.set(it.key, it);
    };
    board.loose().forEach((o, key) => {
      const meshes = meshesOf(o);
      if (!meshes.length) return; // gerade unsichtbar (z. B. Wunsch-Chip)
      const shape = shapeOf(o, meshes);
      const it = { key, original: o, ...makeBody(o, shape, 600), cube: shape.cube, thin: shape.thin, state: 'placed', copy: null, ret: null, target: null, rested: false, heard: 0 };
      setGroups(it, G_PLACED);
      add(it);
    });
    const parts = baseMeshes();
    if (parts.length) {
      const it = { key: 'b', base: true, parts, original: board.group, ...makeBody(board.group, baseShape(parts), 700), cube: false, thin: false, state: 'placed', copy: null, ret: null, target: null, rested: false, heard: 0 };
      setGroups(it, G_BASE);
      add(it);
    }
  }

  // Alles steht wieder an seinem Platz → Körper weg
  function rest() {
    for (const it of items.values()) world.removeRigidBody(it.body);
    items = null;
    byCollider.clear();
    aliases.clear();
  }

  // Das Spiel hat ein Teil entfernt (z. B. Schach legt Figuren neu an) → Kopie und Körper weg
  function drop(it) {
    if (grab?.item === it) grab = null;
    it.copy?.removeFromParent();
    world.removeRigidBody(it.body);
    for (const c of it.colliders) byCollider.delete(c.handle);
    items.delete(it.key);
  }

  // Wo das echte Teil im Spiel steht (Meter, relativ zum Brett) – damit findet der Mitspieler dasselbe Teil
  function spotOf(it) {
    const p = worldPos(it.original).applyMatrix4(board.group.matrixWorld.clone().invert()).multiply(board.group.getWorldScale(new THREE.Vector3()));
    return [r4(p.x), r4(p.y), r4(p.z)];
  }

  // Meine Nummer für ein Teil des Mitspielers: das Teil an derselben Stelle (höchstens 2 cm daneben).
  // Ohne Stelle gilt nur, was schon zugeordnet ist; findet sich nichts, wird die Nachricht verworfen (null) –
  // die bloße Nummer könnte bei mir ein anderes Teil sein.
  function resolve(k, spot) {
    if (k === 'b') return 'b';
    if (Array.isArray(spot) && spot.length === 3 && spot.every(Number.isFinite)) {
      let best = null;
      let dist = 0.02;
      for (const it of items.values()) {
        if (it.base) continue;
        const [x, y, z] = spotOf(it);
        const d = Math.hypot(x - spot[0], y - spot[1], z - spot[2]);
        if (d < dist) [best, dist] = [it.key, d];
      }
      if (best === null) return null;
      aliases.set(k, best);
    }
    return aliases.get(k) ?? null;
  }

  const calm = () => items && !grab && !slide && !full && !slideBack && ![...items.values()].some((it) => it.state !== 'placed');

  // Echte Teile verstecken, ohne visible anzufassen (das gehört dem Spiel): andere Ebene für Bild und Maus
  function hide(o, on) {
    o.traverse((c) => {
      if (on) {
        if (!savedLayers.has(c)) savedLayers.set(c, c.layers.mask);
        c.layers.set(HIDDEN);
      } else if (savedLayers.has(c)) {
        c.layers.mask = savedLayers.get(c);
        savedLayers.delete(c);
      }
    });
  }

  // Kopie nur fürs Aussehen (teilt Form und Material). Nicht clone(): das kopiert userData per JSON,
  // und bei Mau-Mau zeigt die Karte darin auf ihr eigenes Mesh (Kreis) → Absturz.
  function copyLook(o, withChildren) {
    const c = o.isMesh ? new THREE.Mesh(o.geometry, o.material) : new THREE.Group();
    c.castShadow = o.castShadow;
    c.receiveShadow = o.receiveShadow;
    c.visible = o.visible;
    c.position.copy(o.position);
    c.quaternion.copy(o.quaternion);
    c.scale.copy(o.scale);
    if (withChildren) for (const child of o.children) c.add(copyLook(child, true));
    return c;
  }

  // Lage des echten Teils relativ zum Brett (und seiner Unterteile relativ zu ihm, z. B. Würfel im Teller) –
  // ändert sie sich, hat das Spiel es bewegt
  const relTo = (frame, o) => new THREE.Matrix4().multiplyMatrices(frame.matrixWorld.clone().invert(), o.matrixWorld);
  const partsOf = (o) => {
    const out = [];
    o.traverse((c) => c !== o && c.isMesh && out.push(c));
    return out;
  };

  function anchorOf(o) {
    return { self: relTo(board.group, o), parts: partsOf(o).map((c) => [c, relTo(o, c)]) };
  }

  function differs(was, now, frame) {
    const a = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(frame.matrixWorld, was));
    const b = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(frame.matrixWorld, now));
    if (a.distanceTo(b) > MOVED) return true;
    const qa = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(was));
    const qb = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(now));
    return qa.angleTo(qb) > TURNED;
  }

  function movedInGame(it) {
    const o = it.original;
    return differs(it.anchor.self, relTo(board.group, o), board.group) || it.anchor.parts.some(([c, was]) => differs(was, relTo(o, c), o));
  }

  // --- Teile lösen, besitzen, zurückholen ---
  function loosen(it, owner) {
    if (it.state !== 'placed' || it.base) return;
    const o = it.original;
    it.copy = copyLook(o, true);
    o.matrixWorld.decompose(it.copy.position, it.copy.quaternion, it.copy.scale);
    scene.add(it.copy);
    hide(o, true);
    it.anchor = anchorOf(o);
    setOwner(it, owner);
  }

  // mine = ich rechne die Physik und sende · theirs = Kopie folgt den Lagen vom Mitspieler
  function setOwner(it, owner) {
    it.state = owner;
    it.awaitMove = 0;
    it.rested = false;
    it.body.setBodyType(owner === 'mine' ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true);
    setGroups(it, G_LOOSE);
    if (owner === 'theirs') it.target = { pos: it.copy.position.clone(), quat: it.copy.quaternion.clone() };
  }

  // Ich nehme ein Teil (packen oder anstoßen) – der Mitspieler lässt seine Kopie dann mir folgen
  function claim(it) {
    const at = it.base ? null : spotOf(it);
    if (it.state === 'placed') loosen(it, 'mine');
    else setOwner(it, 'mine');
    send({ t: 'tisch', a: 'own', k: it.key, r: rank, at });
  }

  // Kopie fliegt zum echten Teil (das Brett: an seinen Platz auf dem Tisch)
  function sendBack(it, seconds = BACK_S) {
    if (!it.copy || it.ret) return;
    if (grab?.item === it) grab = null;
    it.ret = { t: 0, dur: seconds, from: { pos: it.copy.position.clone(), quat: it.copy.quaternion.clone() } };
    it.body.setEnabled(false);
  }

  // Teil mit der Hand abgestellt: Das Spiel entscheidet, ob es ein Zug ist (board.onPlace → 'move' | 'back' | null).
  // Gemeint ist das Feld, auf das die Maus zeigt – nicht das unter dem schwebenden Teil (schräg von oben gesehen
  // scheint es über einem weiter hinten liegenden Feld zu schweben).
  function place(it) {
    const v = it.body.linvel();
    if (!board.onPlace || Math.hypot(v.x, v.z) > PLACE_SPEED) return; // geworfen ist kein Zug
    const answer = board.onPlace(it.original, aimOf(it));
    if (answer === 'back') sendBack(it);
    else if (answer === 'move') it.awaitMove = performance.now() + MOVE_WAIT_MS;
  }

  // Punkt auf dem Brett (sonst auf Höhe der Tischplatte), auf den die Maus zeigt
  function aimOf(it) {
    if (!lastEvent) return it.copy.position.clone();
    const hit = room.rayFrom(lastEvent).intersectObjects(baseMeshes(), false)[0];
    return hit?.point ?? rayPoint(lastEvent, worldPos(board.group).y) ?? it.copy.position.clone();
  }

  function cancelReturn(it) {
    it.ret = null;
    it.body.setEnabled(true);
    it.body.setTranslation(it.copy.position, true);
    it.body.setRotation(it.copy.quaternion, true);
    it.body.setLinvel(ZERO, true);
    it.body.setAngvel(ZERO, true);
  }

  function targetOf(it) {
    const m = it.base
      ? board.group.parent.matrixWorld.clone().multiply(new THREE.Matrix4().compose(home, board.group.quaternion, board.group.scale))
      : it.original.matrixWorld;
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    m.decompose(pos, quat, new THREE.Vector3());
    return { pos, quat };
  }

  // Kopie weg, echtes Teil wieder sichtbar, Körper folgt wieder dem Spiel
  function settle(it) {
    it.copy.removeFromParent(); // Form und Material gehören dem echten Teil
    it.copy = null;
    it.ret = null;
    it.awaitMove = 0;
    if (!it.base) hide(it.original, false);
    it.state = 'placed';
    it.body.setEnabled(true);
    it.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    setGroups(it, it.base ? G_BASE : G_PLACED);
    const to = targetOf(it);
    it.body.setTranslation(to.pos, true);
    it.body.setRotation(to.quat, true);
  }

  // --- Brett schieben ---
  async function startSlide(point) {
    await ready();
    if (!board || full || slide) return;
    wake();
    const b = items?.get('b');
    if (!b || b.state !== 'placed') return;
    slide = true;
    slideBack = null;
    remotePose = null; // jetzt schiebe ich – eine alte Lage vom Mitspieler zöge das Brett sonst zurück
    b.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    b.body.lockRotations(true, true); // beim Schieben bleibt das Brett flach liegen
    if (pressed) grab = { item: b, body: b.body, slide: true, height: point.y, point: point.clone(), local: point.clone().sub(b.body.translation()) };
    showButton();
  }

  function endSlide() {
    const b = items.get('b');
    slide = false;
    b.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  // --- Ganzes Brett umwerfen (oder anheben): alles fliegt einzeln ---
  // owner = mine: ich werfe und rechne · theirs: der Mitspieler hat geworfen, meine Kopien folgen ihm
  async function startFull(velocity, { owner = 'mine', gentle = false, point = null, height = 0, spots = [] } = {}) {
    await ready();
    if (!board || full) return;
    wake();
    if (owner === 'mine') { // dem Mitspieler sagen, welches Teil wo steht – er findet seine damit
      send({ t: 'tisch', a: 'chaos', v: velocity.toArray().map(r4), g: gentle ? 1 : 0, r: rank, m: [...items.values()].filter((it) => !it.base).map((it) => [it.key, ...spotOf(it)]) });
    } else {
      for (const s of spots) if (Array.isArray(s) && s.length === 4 && validKey(s[0])) resolve(s[0], s.slice(1));
    }
    const group = board.group;
    group.updateWorldMatrix(true, true);
    if (grab?.slide) grab = null;
    slide = false;
    slideBack = null;
    for (const it of items.values()) {
      if (it.ret) cancelReturn(it);
      if (it.base) {
        const holder = new THREE.Group();
        const inverse = group.matrixWorld.clone().invert();
        for (const m of it.parts) {
          const c = copyLook(m, false);
          new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld).decompose(c.position, c.quaternion, c.scale);
          holder.add(c);
        }
        group.matrixWorld.decompose(holder.position, holder.quaternion, holder.scale);
        scene.add(holder);
        it.copy = holder;
        it.body.lockRotations(false, true);
        setOwner(it, owner);
      } else if (it.state === 'placed') loosen(it, owner);
      else if (owner === 'mine' && it.state === 'theirs') continue; // gehört gerade dem Mitspieler
      if (owner === 'mine' && it.state === 'mine' && !gentle) {
        const up = it.base ? 1.2 : rand(0.4, 1.8);
        const spin = it.base ? 6 : 14;
        it.body.setLinvel({ x: velocity.x + rand(-0.4, 0.4), y: velocity.y + up, z: velocity.z + rand(-0.4, 0.4) }, true);
        it.body.setAngvel({ x: rand(-spin, spin), y: rand(-spin, spin), z: rand(-spin, spin) }, true);
      }
    }
    // Das (unsichtbare) Brett zurück an seinen Platz – beim Aufbauen landen die Teile sonst um den Schiebeweg versetzt
    if (home) group.position.copy(home);
    group.updateWorldMatrix(true, true);
    group.visible = false;
    full = true;
    const b = items.get('b');
    if (point && pressed && b && owner === 'mine') startGrab(b, point, height);
    showButton();
  }

  function throwBoard(v) {
    startFull(new THREE.Vector3(v.x, v.y, v.z).clampLength(0, SLIDE_SPEED));
  }

  // Mausrad hoch beim Schieben: Brett anheben – alles darauf rutscht und fällt, wie es kommt
  function liftBoard() {
    const { point, height } = grab;
    startFull(new THREE.Vector3(), { gentle: true, point: point.clone(), height: height + 2 * WHEEL_STEP });
  }

  // --- Aufbauen: alle Kopien fliegen an den Platz der echten Teile, Brett rutscht zurück ---
  function rebuild() {
    round++; // ältere Brett-Lagen vom Mitspieler gelten nicht mehr
    grab = null;
    pending = null;
    if (items) {
      if (slide) endSlide();
      for (const it of items.values()) sendBack(it);
    }
    if (!full && board && home && !board.group.position.equals(home)) slideBack = { t: 0, from: board.group.position.clone() };
    remotePose = null;
    showButton();
  }

  function finishFull() {
    for (const it of items.values()) if (it.copy) settle(it);
    board.group.visible = true;
    if (home) board.group.position.copy(home);
    full = false;
    showButton();
  }

  function showButton() {
    const loose = !!items && [...items.values()].some((it) => it.copy);
    document.body.classList.toggle('tisch-chaos', full); // Spiel-Knöpfe ruhen, solange das Brett umgeworfen ist
    button.hidden = !board || (!loose && !slide && !full && !slideBack && (!home || board.group.position.distanceTo(home) < 0.001));
  }

  // --- Packen ---
  // Das Teil hebt sich senkrecht und folgt dann der Bewegung der Maus (nicht ihrem Punkt auf der höheren Ebene –
  // der liegt schräg von oben gesehen weiter vorn, das Teil spränge sonst in die Nachbarn)
  function startGrab(it, point, height = point.y + LIFT) {
    if (it.ret) cancelReturn(it);
    if (it.state !== 'mine') claim(it);
    const h = Math.min(height, MAX_HEIGHT);
    const start = new THREE.Vector3().copy(it.body.translation()).add(new THREE.Vector3(0, h - point.y, 0));
    const onPlane = (lastEvent && rayPoint(lastEvent, h)) || point.clone();
    grab = { item: it, body: it.body, slide: false, height: h, point: onPlane, local: onPlane.clone().sub(start) };
    it.awaitMove = 0; // wieder in der Hand – ein offener Zug zählt nicht mehr
  }

  async function grabPlaced(original, point) {
    await ready();
    if (!board || full) return;
    wake();
    const it = items && [...items.values()].find((i) => i.original === original);
    if (it && pressed) startGrab(it, point);
  }

  function rayPoint(e, height) {
    const ray = room.rayFrom(e).ray;
    return ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
  }

  function moveGrab(e) {
    const p = rayPoint(e, grab.height);
    if (p) grab.point.copy(p);
  }

  // Was liegt unter der Maus: Kopie eines losen Teils (nicht, solange sie zurückfliegt), echtes Teil oder Brett
  function pick(e) {
    const copies = items ? [...items.values()].filter((it) => it.copy && !it.ret) : [];
    const hits = room.rayFrom(e).intersectObjects([...copies.map((it) => it.copy), board.group], true);
    for (const h of hits) {
      const it = copies.find((c) => isChild(h.object, c.copy));
      if (it) return { item: it, point: h.point };
      if (full || !h.object.layers.isEnabled(0)) continue;
      const original = looseOf(h.object);
      // Unsichtbares übergehen (z. B. Klickfläche des Kartenstapels) – außer Klickhilfen in einem sichtbaren losen Teil
      if (original ? !shown(original) : !(shown(h.object) && visibleMesh(h.object))) continue;
      return { original, point: h.point };
    }
    return null;
  }

  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };

  // --- Maus ---
  function onDown(e) {
    if (e.button !== 0 || e.target !== canvas || !board) return;
    pressed = true;
    taken = false;
    lastEvent = e;
    const hit = pick(e);
    if (full) e.stopPropagation(); // umgeworfen: Spiel bekommt keine Klicks
    if (!hit) return;
    if (hit.item) { // lose Kopie: sofort packen, das Spiel sieht davon nichts – auch nicht den Klick danach
      e.stopPropagation();
      taken = true;
      return startGrab(hit.item, hit.point);
    }
    if (!full) pending = { x: e.clientX, y: e.clientY, point: hit.point.clone(), original: hit.original, event: e };
  }

  function onMove(e) {
    lastEvent = e;
    if (pending && !grab && !pending.dragging) {
      if (pending.event.defaultPrevented) pending = null; // das Spiel hat den Klick selbst genommen (z. B. Würfelbecher)
      else if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > DRAG_PX) {
        pending.dragging = true;
        if (pending.original) grabPlaced(pending.original, pending.point);
        else startSlide(pending.point);
      }
    }
    if (grab) moveGrab(e);
  }

  function onUp(e) {
    if (e.button !== 0) return;
    pressed = false;
    const dragged = pending?.dragging;
    pending = null;
    if (!grab) {
      if (dragged || taken) swallowClick(); // z. B. Griff ging verloren (Mitspieler, Spielzug, Aufbauen)
      taken = false;
      return;
    }
    taken = false;
    swallowClick();
    const g = grab;
    grab = null;
    const v = g.body.linvel();
    if (g.slide && Math.hypot(v.x, v.z) > THROW_SPEED) throwBoard(v);
    else if (!g.slide && !g.item.base) place(g.item); // Teile behalten ihren Schwung – sanft abgestellt fragt das Spiel nach
  }

  function onWheel(e) {
    if (!grab) return;
    e.preventDefault();
    e.stopPropagation(); // sonst zoomt die Kamera
    const up = e.deltaY < 0;
    if (grab.slide) {
      if (up) liftBoard();
      return;
    }
    // senkrecht heben/senken: das Ziel bleibt über derselben Stelle, nur der Bezug zur Maus wird nachgeführt
    const goal = grab.point.clone().sub(grab.local);
    const was = grab.height;
    grab.height = Math.min(Math.max(grab.height + (up ? WHEEL_STEP : -WHEEL_STEP), TABLE_TOP + 0.005), MAX_HEIGHT);
    goal.y += grab.height - was;
    const p = lastEvent && rayPoint(lastEvent, grab.height);
    if (p) {
      grab.point.copy(p);
      grab.local.copy(p).sub(goal);
    }
  }

  // Nach dem Greifen kommt noch ein click – den soll das Spiel nicht als Spielzug sehen
  function swallowClick() {
    const stop = (e) => e.stopPropagation();
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }

  // Umgeworfen: keine Klicks und keine Leertaste ans Spiel
  const block = (e) => {
    if (!full) return;
    if (e.type === 'keydown' ? e.code === 'Space' : e.button === 0 && e.target === canvas) e.stopPropagation();
  };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('click', block, true);
  window.addEventListener('keydown', block, true);

  // --- Bild für Bild ---
  let acc = 0;
  room.onFrame((dt) => {
    if (remotePose && board && !slide) {
      board.group.position.lerp(remotePose, 1 - Math.exp(-dt * 20));
      showButton();
    }
    if (slideBack) stepSlideBack(dt);
    if (!world || !items) return;
    board.group.updateWorldMatrix(true, true);

    // Stehende Teile folgen dem Spiel, fremde Kopien den gesendeten Lagen
    for (const it of items.values()) {
      if (!it.base && !isChild(it.original, board.group)) {
        drop(it);
        continue;
      }
      if (it.state === 'placed' && !(it.base && slide)) {
        const { pos, quat } = it.base ? { pos: worldPos(board.group), quat: worldQuat(board.group) } : { pos: worldPos(it.original), quat: worldQuat(it.original) };
        it.body.setNextKinematicTranslation(pos);
        it.body.setNextKinematicRotation(quat);
      } else if (it.state === 'theirs' && !it.ret) {
        const k = 1 - Math.exp(-dt * 25);
        it.copy.position.lerp(it.target.pos, k);
        it.copy.quaternion.slerp(it.target.quat, k);
        it.body.setNextKinematicTranslation(it.copy.position);
        it.body.setNextKinematicRotation(it.copy.quaternion);
      }
      // Hat das Spiel das echte Teil bewegt (Zug, Wurf, geschlagen), fliegt die Kopie hinterher –
      // nach einem Zug mit der Hand rastet sie erst ein, wenn das Spiel fertig gezogen hat
      if (!full && !it.base && it.copy && !it.ret) {
        if (movedInGame(it)) {
          if (!it.awaitMove) sendBack(it);
          else if (!board.busy?.()) sendBack(it, SNAP_S);
        } else if (it.awaitMove && performance.now() > it.awaitMove) sendBack(it); // das Spiel hat nicht gezogen
      }
    }

    acc = Math.min(acc + dt, 8 * STEP);
    while (acc >= STEP) {
      acc -= STEP;
      if (grab) pull(grab);
      world.step(queue);
      const now = new Set();
      queue.drainContactForceEvents((e) => onContact(e.collider1(), e.collider2(), now));
      touching = now;
    }

    for (const it of items.values()) {
      if (it.ret) stepReturn(it, dt);
      else if (it.state === 'mine') {
        it.copy.position.copy(it.body.translation());
        it.copy.quaternion.copy(it.body.rotation());
      }
    }
    if (full) {
      if ([...items.values()].every((it) => !it.copy || (it.ret && it.ret.t >= 1))) {
        if ([...items.values()].some((it) => it.ret)) finishFull();
      }
    } else {
      for (const it of items.values()) if (it.ret && it.ret.t >= 1) settle(it);
    }

    if (slide) {
      const b = items.get('b');
      const c = b.body.translation();
      board.group.position.copy(board.group.parent.worldToLocal(new THREE.Vector3(c.x, c.y, c.z)));
      if (Math.abs(c.x) > TABLE_HALF || Math.abs(c.z) > TABLE_HALF) { // über die Kante geschoben → fällt um
        grab = null;
        throwBoard(b.body.linvel());
      } else if (performance.now() - lastPose > POSE_MS) {
        lastPose = performance.now();
        send({ t: 'tisch', a: 'pose', p: board.group.position.toArray().map(r4), n: round });
      }
      if (slide && !grab && b.body.isSleeping()) endSlide();
    }
    sendPoses();
    showButton();
    if (calm()) rest();
  });

  // Gepacktes Teil zieht zur Maus (Geschwindigkeit statt Kraft – bleibt ruhig und lässt sich werfen)
  // und richtet sich dabei auf (Würfel nicht – die liegen auf jeder Seite richtig)
  function pull(g) {
    const t = g.body.translation();
    const v = g.point.clone().sub(g.local).sub(t).multiplyScalar(PULL);
    if (g.slide) v.y = g.body.linvel().y;
    const max = g.slide ? SLIDE_SPEED : HAND_SPEED;
    if (v.length() > max) v.setLength(max);
    g.body.setLinvel(v, true);
    if (!g.slide) g.body.setAngvel(g.item.cube ? ZERO : upright(g.item), true);
  }

  function upright(it) {
    const now = it.upAxis.clone().applyQuaternion(it.body.rotation());
    const angle = Math.acos(Math.min(Math.max(now.dot(UP), -1), 1));
    if (angle < 1e-3) return ZERO;
    const axis = now.clone().cross(UP);
    if (axis.lengthSq() < 1e-9) axis.set(1, 0, 0); // steht auf dem Kopf
    return axis.normalize().multiplyScalar(Math.min(angle * UPRIGHT, 12));
  }

  // Berührung mit Kraft (nicht nur Annäherung – „Berührung beginnt“ meldet Rapier schon zentimeterweit vorher):
  // eigene schnelle Teile stoßen stehende um – und klappern, wenn die Berührung neu ist
  function onContact(h1, h2, now) {
    const pair = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
    now.add(pair);
    const fresh = !touching.has(pair);
    const a = byCollider.get(h1);
    const b = byCollider.get(h2);
    for (const [mover, other] of [[a, b], [b, a]]) {
      if (!mover || mover.state !== 'mine') continue;
      const v = mover.body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const t = performance.now();
      if (fresh && speed > 0.3 && t - mover.heard > 60) {
        mover.heard = t;
        playHit(mover.thin ? 'card' : mover.cube ? 'die' : 'wood', Math.min(speed / 2.5, 1));
      }
      if (other && other.state === 'placed' && !other.base && speed > KNOCK_SPEED && !full) {
        claim(other);
        other.body.setLinvel({ x: v.x * 0.5, y: v.y * 0.5, z: v.z * 0.5 }, true);
      }
    }
  }

  function stepReturn(it, dt) {
    it.ret.t = Math.min(it.ret.t + dt / it.ret.dur, 1);
    const k = smooth(it.ret.t);
    const to = targetOf(it);
    it.copy.position.lerpVectors(it.ret.from.pos, to.pos, k);
    it.copy.position.y += Math.sin(it.ret.t * Math.PI) * 0.15;
    it.copy.quaternion.slerpQuaternions(it.ret.from.quat, to.quat, k);
  }

  function stepSlideBack(dt) {
    slideBack.t = Math.min(slideBack.t + dt / BACK_S, 1);
    board.group.position.lerpVectors(slideBack.from, home, smooth(slideBack.t));
    if (slideBack.t === 1) {
      slideBack = null;
      showButton(); // sonst bliebe der Knopf stehen – ohne lose Teile endet das Bild davor
    }
  }

  // Lagen meiner bewegten Teile senden (ruhende einmal zum Schluss)
  function sendPoses() {
    if (performance.now() - lastSend < SEND_MS) return;
    const s = [];
    for (const it of items.values()) {
      if (it.state !== 'mine' || it.ret) continue;
      const sleeping = it.body.isSleeping();
      if (sleeping && it.rested) continue;
      it.rested = sleeping;
      const p = it.body.translation();
      const q = it.body.rotation();
      s.push([it.key, r4(p.x), r4(p.y), r4(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)]);
    }
    if (!s.length) return;
    lastSend = performance.now();
    send({ t: 'tisch', a: 'p', s });
  }

  const validKey = (k) => k === 'b' || Number.isInteger(k);

  // Lagen vom Mitspieler: seine Teile folgen bei mir. Meine eigenen gebe ich nur per „own“ ab – eine verspätete
  // Lage darf sie nicht übernehmen (sonst rechnet am Ende keiner mehr)
  function applyPoses(list) {
    for (const e of list) {
      if (!Array.isArray(e) || e.length !== 8 || !validKey(e[0]) || !e.slice(1).every(Number.isFinite)) continue;
      const it = items.get(resolve(e[0]));
      if (!it || it.ret || it.state === 'mine') continue;
      if (it.state === 'placed') {
        if (it.base) continue; // das Brett fliegt nur nach „chaos“
        loosen(it, 'theirs');
      }
      it.target = { pos: new THREE.Vector3(e[1], e[2], e[3]), quat: new THREE.Quaternion(e[4], e[5], e[6], e[7]).normalize() };
    }
  }

  function takeOver(k, r, at) {
    const it = items.get(resolve(k, at));
    if (!it || it.ret) return;
    if (grab?.item === it) {
      if (rank > r) return send({ t: 'tisch', a: 'own', k: it.key, r: rank, at: it.base ? null : spotOf(it) }); // ich halte es fester
      grab = null;
    }
    if (it.state === 'placed') {
      if (!it.base) loosen(it, 'theirs');
    } else setOwner(it, 'theirs');
  }

  return {
    // Brett des laufenden Spiels (oder null am Schrank) – alles Laufende wird sofort beendet
    setBoard(next) {
      if (items) {
        for (const it of items.values()) {
          if (it.copy) {
            it.copy.removeFromParent();
            if (!it.base) hide(it.original, false);
          }
        }
        rest();
      }
      if (board) {
        if (home) board.group.position.copy(home);
        board.group.visible = true; // war beim Umwerfen ausgeblendet
      }
      slide = full = false;
      grab = pending = remotePose = slideBack = null;
      board = next?.noTisch ? null : next; // z. B. der Billardtisch wird nicht umgeworfen
      home = board ? board.group.position.clone() : null;
      showButton();
      if (next) ready();
    },
    // Nachrichten { t: 'tisch', a: … } vom anderen PC
    // Alle warten aufs Laden der Physik, damit die Reihenfolge bleibt (sonst überholte z. B. „auf“ ein „chaos“)
    async handle(msg) {
      if (!board) return;
      await ready();
      if (!board) return;
      if (msg.a === 'pose' && Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every(Number.isFinite)) {
        if (Number.isInteger(msg.n) && msg.n < round) return; // noch vor dem letzten „Aufbauen“ geschickt
        if (Number.isInteger(msg.n)) round = msg.n;
        remotePose = new THREE.Vector3().fromArray(msg.p);
        slideBack = null;
        showButton();
      } else if (msg.a === 'chaos' && Array.isArray(msg.v) && msg.v.length === 3 && msg.v.every(Number.isFinite)) {
        if (full) { // beide haben gleichzeitig umgeworfen: der mit dem höheren Rang rechnet weiter
          if (!(Number(msg.r) > rank)) return;
          for (const s of Array.isArray(msg.m) ? msg.m : []) if (Array.isArray(s) && s.length === 4 && validKey(s[0])) resolve(s[0], s.slice(1));
          for (const it of items.values()) if (it.state === 'mine' && grab?.item !== it) setOwner(it, 'theirs');
          return;
        }
        if (remotePose) board.group.position.copy(remotePose);
        remotePose = null;
        await startFull(new THREE.Vector3().fromArray(msg.v), { owner: 'theirs', spots: Array.isArray(msg.m) ? msg.m : [] });
      } else if (msg.a === 'auf') {
        rebuild();
      } else if ((msg.a === 'p' && Array.isArray(msg.s)) || (msg.a === 'own' && validKey(msg.k) && Number.isFinite(msg.r))) {
        wake();
        if (!items) return;
        if (msg.a === 'p') applyPoses(msg.s);
        else takeOver(msg.k, msg.r, msg.at);
        showButton();
      }
    },
    busy: () => full,
  };
}
