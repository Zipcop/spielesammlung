// Tisch-Physik (src/tisch.js) ohne Browser: Teile packen, anheben, werfen, umstoßen, Brett umwerfen, aufbauen –
// und zwei Tische, die sich Nachrichten schicken (beide sollen dasselbe sehen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('../test-stubs/tisch-hooks.mjs', import.meta.url);
const { createTisch } = await import('../src/tisch.js');
const { TABLE_TOP } = await import('../test-stubs/stub-room.js');

const DT = 1 / 60;
let clock = 0;
performance.now = () => clock;

// --- Ersatz für Fenster, Zimmer und Spielbrett ---
const canvas = {};
// Fenster mit eigenen Zuhörern; alles andere (z. B. performance – Rapier fragt danach, sobald es ein window gibt) wie global
function fakeWindow() {
  const listeners = {};
  return Object.assign(Object.create(globalThis), {
    listeners,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
  });
}
const created = []; // vom Tisch angelegte Elemente (der Knopf „Aufbauen“)
globalThis.document = {
  createElement: () => {
    const el = { hidden: true };
    created.push(el);
    return el;
  },
  body: { append() {}, classList: { toggle() {} } },
};

function fakeRoom() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 50);
  camera.position.set(0, TABLE_TOP + 0.8, 0.55);
  camera.lookAt(0, TABLE_TOP, 0);
  camera.updateMatrixWorld();
  const tableTop = new THREE.Group();
  tableTop.position.y = TABLE_TOP;
  scene.add(tableTop);
  const raycaster = new THREE.Raycaster();
  const frames = [];
  return {
    scene, camera, tableTop, frames,
    onFrame: (fn) => frames.push(fn),
    rayFrom(e) {
      raycaster.setFromCamera(new THREE.Vector2(e.clientX / 500 - 1, 1 - e.clientY / 500), camera);
      return raycaster;
    },
  };
}

// Brett 40 × 40 cm (2 cm dick) mit runden Figuren (Ø 2 cm, 3 cm hoch) – Maße in cm, Gruppe 1/100 wie im Spiel
function fakeBoard(room, spots, order = (list) => list) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  room.tableTop.add(group);
  const base = new THREE.Mesh(new THREE.BoxGeometry(40, 2, 40), new THREE.MeshBasicMaterial());
  base.position.y = 1;
  group.add(base);
  const pieces = spots.map(([x, z]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 3, 12), new THREE.MeshBasicMaterial()); // eigene Form: Kopien eindeutig zuzuordnen
    m.position.set(x, 3.5, z);
    group.add(m);
    return m;
  });
  room.scene.updateMatrixWorld(true);
  return { group, pieces, loose: () => order([...pieces]) };
}

// Ein PC: Zimmer, Brett, Tisch; Nachrichten landen im Postfach des anderen
function makePC(spots, order) {
  const room = fakeRoom();
  const board = fakeBoard(room, spots, order);
  const win = fakeWindow();
  globalThis.window = win;
  const outbox = []; // noch nicht zugestellt
  const sent = []; // alles, was je gesendet wurde
  const tisch = createTisch({ room, canvas, send: (msg) => {
    const copy = JSON.parse(JSON.stringify(msg));
    outbox.push(copy);
    sent.push(copy);
  } });
  const button = created.at(-1);
  tisch.setBoard(board);
  return { room, board, win, tisch, outbox, sent, button };
}

function fire(pc, type, x, y, extra = {}) {
  globalThis.window = pc.win;
  const e = { type, button: 0, target: canvas, clientX: x, clientY: y, deltaY: 0, defaultPrevented: false, stopped: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...extra };
  for (const fn of pc.win.listeners[type] ?? []) fn(e);
  return e;
}

// Bildschirmpunkt eines Weltpunkts (0–1000 Pixel)
function screenOf(room, p) {
  const v = p.clone().project(room.camera);
  return [(v.x + 1) * 500, (1 - v.y) * 500];
}
const worldOf = (o) => o.getWorldPosition(new THREE.Vector3());
const hidden = (o) => !o.layers.isEnabled(0);
const copyOf = (pc, piece) => pc.room.scene.children.find((c) => c.geometry === piece.geometry && c !== piece && c.isMesh);
const copies = (pc) => pc.room.scene.children.filter((c) => c !== pc.room.tableTop);

// Bilder laufen lassen; Nachrichten gehen nach jedem Bild an die anderen PCs
async function run(seconds, ...pcs) {
  for (let t = 0; t < seconds; t += DT) {
    await null; // wie im Browser: Wartendes (z. B. nach dem Laden) läuft zwischen den Bildern
    clock += DT * 1000;
    for (const pc of pcs) {
      globalThis.window = pc.win;
      pc.room.scene.updateMatrixWorld(true);
      for (const fn of pc.room.frames) fn(DT);
    }
    for (const pc of pcs) {
      const mail = pc.outbox.splice(0);
      for (const other of pcs) if (other !== pc) for (const m of mail) await other.tisch.handle(m);
    }
  }
}

// bis das Laden der Physik (WASM) durch ist
async function settle(...pcs) {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await run(DT, ...pcs);
  }
}

// Teil mit der Maus packen (drücken, über 18 px ziehen) und zu einem Bildschirmpunkt führen
async function grabAndMove(pc, piece, to, seconds = 1) {
  const [x, y] = screenOf(pc.room, worldOf(piece).add(new THREE.Vector3(0, 0.012, 0)));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  fire(pc, 'pointermove', to[0], to[1]);
  await run(seconds, pc);
}

test('Figur packen: hebt sich an, folgt der Maus, fällt beim Loslassen, „Aufbauen“ stellt sie zurück', async () => {
  const pc = makePC([[-10, 0], [10, 0]]);
  const [a] = pc.board.pieces;
  const start = worldOf(a);
  const target = screenOf(pc.room, new THREE.Vector3(0.02, TABLE_TOP + 0.03, -0.06));
  await grabAndMove(pc, a, target);
  const copy = copyOf(pc, a);
  assert.ok(copy, 'Kopie in der Szene');
  assert.ok(hidden(a), 'echte Figur versteckt');
  assert.ok(copy.position.y > start.y + 0.05, `angehoben: ${copy.position.y.toFixed(3)} > ${(start.y + 0.05).toFixed(3)}`);
  const held = copy.position.clone();

  // Mausrad hoch: höher halten
  fire(pc, 'wheel', target[0], target[1], { deltaY: -100 });
  await run(0.5, pc);
  assert.ok(copy.position.y > held.y + 0.015, 'Mausrad hebt höher');

  fire(pc, 'pointerup', target[0], target[1]);
  await run(2, pc);
  // steht (Mitte 1,5 cm über dem Brett) oder liegt (1 cm) – jedenfalls auf dem Brett, nicht in der Luft
  assert.ok(copy.position.y > TABLE_TOP + 0.02 + 0.009 && copy.position.y < TABLE_TOP + 0.02 + 0.016, `liegt/steht wieder auf dem Brett: y = ${copy.position.y.toFixed(4)}`);
  assert.ok(copy.position.distanceTo(start) > 0.05, 'an einer anderen Stelle');

  await pc.tisch.handle({ t: 'tisch', a: 'auf' }); // wie der Knopf „Aufbauen“
  await run(1.2, pc);
  assert.equal(copyOf(pc, a), undefined, 'Kopie weg');
  assert.ok(!hidden(a), 'echte Figur wieder da');
});

test('Klick ohne Ziehen bleibt beim Spiel: nichts wird gepackt', async () => {
  const pc = makePC([[0, 0]]);
  const [a] = pc.board.pieces;
  await settle(pc);
  const [x, y] = screenOf(pc.room, worldOf(a));
  const down = fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 5, y);
  fire(pc, 'pointerup', x + 5, y);
  await run(0.3, pc);
  assert.equal(down.stopped, false);
  assert.ok(!hidden(a));
  assert.equal(copies(pc).length, 0);
});

test('Umstoßen: eine schnell durchgezogene Figur wirft die stehende um', async () => {
  const pc = makePC([[-12, 0], [0, 0]]);
  const [a, b] = pc.board.pieces;
  const [x, y] = screenOf(pc.room, worldOf(a).add(new THREE.Vector3(0, 0.012, 0)));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  // tief halten und waagerecht quer durch b ziehen (Teile folgen der Mausbewegung)
  for (let i = 0; i < 6; i++) fire(pc, 'wheel', x + 25, y, { deltaY: 100 });
  await run(0.4, pc);
  const far = [x + 25 + 400, y];
  fire(pc, 'pointermove', far[0], far[1]);
  await run(1, pc);
  fire(pc, 'pointerup', far[0], far[1]);
  await run(1.5, pc);
  assert.ok(hidden(b), 'getroffene Figur ist jetzt lose');
  const cb = copyOf(pc, b);
  assert.ok(cb && cb.position.distanceTo(worldOf(b)) > 0.01, 'und wurde weggestoßen');
});

test('Bewegt das Spiel ein echtes Teil, fliegt seine Kopie hinterher und das Teil ist wieder normal', async () => {
  const pc = makePC([[-10, 0]]);
  const [a] = pc.board.pieces;
  const target = screenOf(pc.room, new THREE.Vector3(0.1, TABLE_TOP + 0.03, 0.1));
  await grabAndMove(pc, a, target, 0.6);
  fire(pc, 'pointerup', target[0], target[1]);
  await run(1, pc);
  assert.ok(hidden(a));
  a.position.set(5, 3.5, -10); // Spielzug
  await run(1.2, pc);
  assert.ok(!hidden(a), 'echte Figur wieder sichtbar');
  assert.equal(copyOf(pc, a), undefined);
});

test('Brett umwerfen: alles fliegt einzeln, das Spiel ruht; „Aufbauen“ stellt alles hin', async () => {
  const pc = makePC([[-10, 0], [10, 5], [0, -10]]);
  const { group, pieces } = pc.board;
  const home = group.position.clone();
  const [x, y] = screenOf(pc.room, new THREE.Vector3(0.15, TABLE_TOP + 0.02, 0.15)); // Brett, keine Figur
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  assert.equal(pc.tisch.busy(), false);
  // schwungvoll nach rechts und loslassen
  const [fx, fy] = screenOf(pc.room, new THREE.Vector3(0.45, TABLE_TOP + 0.02, 0.15));
  fire(pc, 'pointermove', fx, fy);
  await run(0.05, pc); // noch in voller Fahrt loslassen
  fire(pc, 'pointerup', fx, fy);
  await run(0.1, pc);
  assert.equal(pc.tisch.busy(), true, 'umgeworfen');
  assert.equal(group.visible, false);
  assert.equal(copies(pc).length, pieces.length + 1, 'jede Figur und das Brett als Kopie');
  assert.ok(pc.sent.some((m) => m.a === 'chaos' && m.m.length === pieces.length), 'Mitspieler erfährt, wo welches Teil stand');
  const click = fire(pc, 'click', x, y);
  assert.equal(click.stopped, true, 'Spiel bekommt keine Klicks');
  await run(2, pc);
  await pc.tisch.handle({ t: 'tisch', a: 'auf' });
  await run(1.2, pc);
  assert.equal(pc.tisch.busy(), false);
  assert.equal(group.visible, true);
  assert.equal(copies(pc).length, 0);
  assert.ok(group.position.distanceTo(home) < 1e-6);
  assert.ok(pieces.every((p) => !hidden(p)));
});

test('Brett mit dem Mausrad anheben: alles wird einzeln, das Brett bleibt in der Hand', async () => {
  const pc = makePC([[-10, 0], [10, 0]]);
  const { group } = pc.board;
  const [x, y] = screenOf(pc.room, new THREE.Vector3(0.15, TABLE_TOP + 0.02, 0.15));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  const wheel = fire(pc, 'wheel', x + 25, y, { deltaY: -100 });
  assert.equal(wheel.defaultPrevented, true, 'Kamera zoomt nicht');
  await run(0.6, pc);
  assert.equal(group.visible, false);
  const boardCopy = copies(pc).find((c) => c.isGroup);
  assert.ok(boardCopy.position.y > TABLE_TOP + 0.03, `Brett schwebt in der Hand: ${boardCopy.position.y.toFixed(3)}`);
  fire(pc, 'pointerup', x + 25, y);
  await run(1.5, pc);
  assert.ok(boardCopy.position.y < TABLE_TOP + 0.03, 'fällt zurück auf den Tisch');
});

test('Netz: der Mitspieler sieht dieselbe Flugbahn – auch wenn seine Teile anders nummeriert sind', async () => {
  const spots = [[-10, 0], [10, 0], [0, 10]];
  const a = makePC(spots);
  const b = makePC(spots, (list) => list.reverse()); // andere Reihenfolge in loose()
  await settle(a, b);
  const pa = a.board.pieces[0];
  const pb = b.board.pieces[0]; // dieselbe Figur (gleiche Stelle)
  const target = screenOf(a.room, new THREE.Vector3(-0.13, TABLE_TOP + 0.03, 0.1)); // weg von den anderen Figuren
  const [x, y] = screenOf(a.room, worldOf(pa).add(new THREE.Vector3(0, 0.012, 0)));
  fire(a, 'pointerdown', x, y);
  fire(a, 'pointermove', x + 25, y);
  await run(0.05, a, b);
  fire(a, 'pointermove', target[0], target[1]);
  await run(0.8, a, b);
  fire(a, 'pointerup', target[0], target[1]);
  await run(2, a, b);
  const ca = copyOf(a, pa);
  const cb = copyOf(b, pb);
  assert.ok(ca && cb, 'beide haben eine Kopie');
  assert.ok(hidden(pb), 'beim Mitspieler ist die echte Figur auch versteckt');
  assert.ok(!hidden(b.board.pieces[1]) && !hidden(b.board.pieces[2]), 'die anderen Figuren stehen');
  assert.ok(ca.position.distanceTo(cb.position) < 0.002, `gleiche Lage: ${ca.position.distanceTo(cb.position).toFixed(4)} m`);

  // Jetzt packt der Mitspieler die Figur und wirft sie zurück – bei mir folgt sie ihm
  const [bx, by] = screenOf(b.room, cb.position.clone().add(new THREE.Vector3(0, 0.012, 0)));
  const down = fire(b, 'pointerdown', bx, by);
  assert.equal(down.stopped, true, 'lose Kopie wird sofort gepackt');
  const back = screenOf(b.room, new THREE.Vector3(-0.12, TABLE_TOP + 0.03, -0.05));
  fire(b, 'pointermove', back[0], back[1]);
  await run(0.8, a, b);
  fire(b, 'pointerup', back[0], back[1]);
  await run(2, a, b);
  assert.ok(ca.position.distanceTo(cb.position) < 0.002, `wieder gleiche Lage: ${ca.position.distanceTo(cb.position).toFixed(4)} m`);
  assert.ok(cb.position.x < 0, 'liegt jetzt links');
});

// --- Stufe 2: mit der Hand abstellen = Zug (board.onPlace) ---
async function placeAt(pc, piece, point) {
  const target = screenOf(pc.room, point);
  await grabAndMove(pc, piece, target, 0.8);
  fire(pc, 'pointerup', target[0], target[1]);
}

test('Abstellen: Spiel sagt „zurück“ → Figur fliegt an ihren Platz', async () => {
  const pc = makePC([[-10, 0]]);
  const [a] = pc.board.pieces;
  const asked = [];
  pc.board.onPlace = (original, point) => {
    asked.push([original, point]);
    return 'back';
  };
  await placeAt(pc, a, new THREE.Vector3(0.05, TABLE_TOP + 0.03, 0.05));
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0], a, 'das echte Teil wird genannt');
  assert.ok(Math.abs(asked[0][1].x - 0.05) < 0.03, 'Punkt liegt dort, wo abgestellt wurde');
  await run(1.2, pc);
  assert.equal(copyOf(pc, a), undefined);
  assert.ok(!hidden(a));
});

test('Abstellen: Spiel zieht → Kopie rastet am neuen Platz ein, sobald das Spiel fertig ist', async () => {
  const pc = makePC([[-10, 0]]);
  const [a] = pc.board.pieces;
  let busy = false;
  pc.board.busy = () => busy;
  pc.board.onPlace = () => {
    busy = true;
    a.position.set(5, 3.5, 5); // das Spiel setzt die Figur (versteckt) um und animiert noch
    return 'move';
  };
  await placeAt(pc, a, new THREE.Vector3(0.05, TABLE_TOP + 0.03, 0.05));
  await run(0.5, pc);
  assert.ok(copyOf(pc, a), 'wartet, solange das Spiel noch animiert');
  busy = false;
  await run(0.4, pc);
  assert.equal(copyOf(pc, a), undefined, 'eingerastet');
  assert.ok(!hidden(a));
});

test('Abstellen: Spiel zieht doch nicht (z. B. Host lehnt ab) → nach kurzer Zeit zurück', async () => {
  const pc = makePC([[-10, 0]]);
  const [a] = pc.board.pieces;
  pc.board.onPlace = () => 'move';
  await placeAt(pc, a, new THREE.Vector3(0.05, TABLE_TOP + 0.03, 0.05));
  await run(1, pc);
  assert.ok(copyOf(pc, a));
  await run(2.8, pc);
  assert.equal(copyOf(pc, a), undefined);
  assert.ok(!hidden(a));
});

test('Geworfen zählt nicht als Zug: das Spiel wird nicht gefragt', async () => {
  const pc = makePC([[-10, 0]]);
  const [a] = pc.board.pieces;
  let asked = 0;
  pc.board.onPlace = () => {
    asked++;
    return 'move';
  };
  const [x, y] = screenOf(pc.room, worldOf(a).add(new THREE.Vector3(0, 0.012, 0)));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  const far = screenOf(pc.room, new THREE.Vector3(0.3, TABLE_TOP + 0.03, 0));
  fire(pc, 'pointermove', far[0], far[1]);
  await run(0.03, pc);
  fire(pc, 'pointerup', far[0], far[1]);
  assert.equal(asked, 0);
});

test('Anheben zwischen engen Nachbarn: die Figur geht senkrecht hoch und stößt niemanden an', async () => {
  const pc = makePC([[0, 0], [0, 4], [4, 0], [-4, 0], [0, -4]]);
  const [a, ...others] = pc.board.pieces;
  const start = worldOf(a);
  const [x, y] = screenOf(pc.room, start.clone().add(new THREE.Vector3(0, 0.012, 0)));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x, y - 25); // über die Schwelle ziehen
  await settle(pc);
  await run(1, pc);
  const copy = copyOf(pc, a);
  assert.ok(copy.position.y > start.y + 0.06, 'angehoben');
  assert.ok(Math.hypot(copy.position.x - start.x, copy.position.z - start.z) < 0.03, 'kaum seitlich versetzt');
  assert.ok(others.every((o) => !hidden(o)), 'Nachbarn stehen noch');
});

// --- Befunde der Prüfung vom 19.10.2026 ---
async function throwBoard(pc) {
  const [x, y] = screenOf(pc.room, new THREE.Vector3(0.15, TABLE_TOP + 0.02, 0.15));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  const [fx, fy] = screenOf(pc.room, new THREE.Vector3(0.45, TABLE_TOP + 0.02, 0.15));
  fire(pc, 'pointermove', fx, fy);
  await run(0.05, pc);
  fire(pc, 'pointerup', fx, fy);
}

test('Umgeworfene runde Figuren kommen zur Ruhe – danach keine Lage-Nachrichten mehr', async () => {
  const pc = makePC([[-10, 0], [10, 5], [0, -10], [5, 10]]);
  await throwBoard(pc);
  await run(8, pc);
  const from = pc.sent.length;
  await run(2, pc);
  assert.equal(pc.sent.slice(from).filter((m) => m.a === 'p').length, 0, 'alles liegt still');
});

test('Brett nur verschoben, „Aufbauen“: Brett steht wieder, der Knopf verschwindet', async () => {
  const pc = makePC([[-10, 0]]);
  const { group } = pc.board;
  const home = group.position.clone();
  const [x, y] = screenOf(pc.room, new THREE.Vector3(0.15, TABLE_TOP + 0.02, 0.15));
  fire(pc, 'pointerdown', x, y);
  fire(pc, 'pointermove', x + 25, y);
  await settle(pc);
  fire(pc, 'pointermove', x + 60, y);
  await run(1, pc);
  fire(pc, 'pointerup', x + 60, y);
  await run(1, pc);
  assert.equal(pc.button.hidden, false, 'Knopf da, Brett ist verschoben');
  await pc.tisch.handle({ t: 'tisch', a: 'auf' });
  await run(1.2, pc);
  assert.ok(group.position.distanceTo(home) < 1e-6);
  assert.equal(pc.button.hidden, true);
});

test('Beide werfen gleichzeitig um: einer rechnet weiter, beim anderen folgen die Teile', async () => {
  const spots = [[-10, 0], [10, 5], [0, -10]];
  const a = makePC(spots);
  const b = makePC(spots);
  await settle(a, b);
  for (const pc of [a, b]) {
    const [x, y] = screenOf(pc.room, new THREE.Vector3(0.15, TABLE_TOP + 0.02, 0.15));
    fire(pc, 'pointerdown', x, y);
    fire(pc, 'pointermove', x + 25, y);
  }
  await run(0.05, a, b);
  for (const pc of [a, b]) {
    const [fx, fy] = screenOf(pc.room, new THREE.Vector3(0.45, TABLE_TOP + 0.02, 0.15));
    fire(pc, 'pointermove', fx, fy);
  }
  await run(0.05, a, b);
  for (const pc of [a, b]) fire(pc, 'pointerup', 900, 500);
  await run(1, a, b);
  const from = [a.sent.length, b.sent.length];
  await run(1, a, b);
  const senders = [a.sent.slice(from[0]), b.sent.slice(from[1])].filter((list) => list.some((m) => m.a === 'p')).length;
  assert.ok(senders <= 1, 'höchstens einer sendet Lagen');
  await run(8, a, b);
  for (let i = 0; i < spots.length; i++) {
    const ca = copyOf(a, a.board.pieces[i]);
    const cb = copyOf(b, b.board.pieces[i]);
    assert.ok(ca.position.distanceTo(cb.position) < 0.01, `Figur ${i} liegt bei beiden gleich (${ca.position.distanceTo(cb.position).toFixed(3)} m)`);
  }
});
