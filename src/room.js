// 3D-Spielzimmer: Raum, Licht, Kamera, Spieleschrank und Spieltisch. Kennt weder Netz noch Spielregeln.
// Maße in Metern, der Tisch steht im Ursprung. Der Host sitzt auf der +z-Seite, der Gast gegenüber.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { woodTexture, wallpaperTexture, rugTexture, nightTexture, paintingTexture } from './textures.js';
import { createShelf, SIZE as SHELF_SIZE } from './shelf.js';
import { createCamera } from './camera.js';
import { createGraphics } from './graphics.js';
import { createDust, createConfetti } from './effects.js';
import { createDesigns } from './designs.js';

export const TABLE_TOP = 0.76;
const ROOM = { w: 6, d: 6, h: 2.6 };
const LAMP_Y = 1.72; // Glühbirne der Hängelampe über dem Tisch

// Kamera: [Position, Blickziel]. Start vor dem Schrank; „table“ zeigt den Tisch mit dem Schrank im Hintergrund.
// Am Platz etwas nach rechts schauen, damit rechts Raum für den Block bleibt. An den Plätzen frei drehbar (camera.js).
const VIEWS = {
  shelf: [[-0.15, 1.0, 0], [-2.6, 0.72, 0]],
  table: [[1.85, 1.45, 1.2], [-0.3, 0.62, -0.25]],
  seat0: [[0, TABLE_TOP + 0.38, 0.36], [0.06, TABLE_TOP, 0.04]],
  seat1: [[0, TABLE_TOP + 0.38, -0.36], [-0.06, TABLE_TOP, -0.04]],
  chess0: [[0, TABLE_TOP + 0.56, 0.52], [0.07, TABLE_TOP, -0.04]],
  chess1: [[0, TABLE_TOP + 0.56, -0.52], [-0.07, TABLE_TOP, 0.04]],
  cards0: [[0, TABLE_TOP + 0.5, 0.56], [0.1, TABLE_TOP, -0.02]],
  cards1: [[0, TABLE_TOP + 0.5, -0.56], [-0.1, TABLE_TOP, 0.02]],
  // Rommé: höher und steiler, damit Hand, Stapel und beide Auslagen ins Bild passen (rechts das Seitenfeld)
  romme0: [[0.1, TABLE_TOP + 0.7, 0.64], [0.15, TABLE_TOP, 0.08]],
  romme1: [[-0.1, TABLE_TOP + 0.7, -0.64], [-0.15, TABLE_TOP, -0.08]],
  // Doppelkopf: vier Hände rund um den Tisch – hoch genug, dass die Fächer links und rechts mit ins Bild passen
  doko0: [[0.08, TABLE_TOP + 0.84, 0.72], [0.12, TABLE_TOP, 0.07]],
  doko1: [[-0.08, TABLE_TOP + 0.84, -0.72], [-0.12, TABLE_TOP, -0.07]],
  // MÄDN: Würfelteller liegt rechts neben dem Brett (+x) → Blick so verschoben, dass Brett und Teller neben das Seitenfeld passen
  maedn0: [[0.1, TABLE_TOP + 0.6, 0.56], [0.19, TABLE_TOP, -0.02]],
  maedn1: [[0, TABLE_TOP + 0.6, -0.56], [0.02, TABLE_TOP, 0.02]],
  // Gast an der Seite (Farbe neben der des Hosts): links (−x, Teller hinter dem Brett) bzw. rechts (+x, Teller vorn)
  maednL: [[-0.6, TABLE_TOP + 0.62, 0.02], [0.05, TABLE_TOP, 0.07]],
  maednR: [[0.8, TABLE_TOP + 0.7, -0.02], [0.1, TABLE_TOP, -0.06]],
  // Billard: eigener, langer Tisch (Längsseite entlang x) – Blick von der Stirnseite, Host an der Kopfseite (−x),
  // Gast an der Fußseite (+x). Das Blickziel folgt dann der weißen Kugel (billard/index.js → room.focus).
  billard0: [[-1.15, TABLE_TOP + 0.75, 0], [-0.3, TABLE_TOP + 0.03, 0]],
  billard1: [[1.15, TABLE_TOP + 0.75, 0], [0.3, TABLE_TOP + 0.03, 0]],
};

export function createRoom(canvas) {
  // Kantenglättung, Auflösung und Schatten stellt graphics.js je nach Einstellung ein
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0906);
  // schwache Umgebungs-Spiegelung, damit Würfel und Lack nicht stumpf wirken
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12;

  const view = createCamera(canvas, VIEWS);
  const { camera } = view;

  const roomLook = buildRoom(scene);
  const { table, top } = buildTable(scene);
  const tableTop = new THREE.Group(); // hier legen Spiele ihre Sachen ab
  tableTop.position.y = TABLE_TOP;
  table.add(tableTop);
  const { spot, hemi, shadeGlow } = addLights(scene);
  // Zimmer-Stil und Tageszeit (designs.js) tauschen Texturen, Farben und Licht dieser Teile
  const designs = createDesigns(scene, {
    ...roomLook, table: top, tableWood: top.map, spot, hemi, glowing: [...roomLook.glowing, shadeGlow],
  });

  const graphics = createGraphics(renderer, scene, camera, [spot]);
  const dust = createDust(scene, LAMP_Y);
  const confetti = createConfetti(scene, table, TABLE_TOP);
  let confettiOn = true;

  // Spieleschrank an der linken Wand
  const shelf = createShelf();
  shelf.group.position.set(-ROOM.w / 2 + SHELF_SIZE.d / 2, 0, 0);
  shelf.group.rotation.y = Math.PI / 2;
  scene.add(shelf.group);

  // --- Maus → Strahl in die Szene ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function rayFrom(e) {
    const r = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster;
  }

  // --- Darstellung ---
  function resize() {
    graphics.setSize(canvas.clientWidth, canvas.clientHeight);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    // Bei schmalen Fenstern das Bild weiter machen, damit seitlich nichts abgeschnitten wird (Maßstab: 16:9 mit 42°)
    const fit = 2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(21)) * 16) / 9 / camera.aspect);
    camera.fov = Math.max(42, THREE.MathUtils.radToDeg(fit));
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const frameFns = new Set();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    view.update(dt);
    shelf.update(dt);
    dust.update(dt, camera);
    confetti.update(dt);
    designs.update(dt);
    frameFns.forEach((fn) => fn(dt));
    graphics.render();
  });

  view.setView('shelf', true);

  return {
    scene,
    shelf,
    tableTop,
    setView: view.setView,
    resetView: view.resetView,
    focus: view.focus,
    rayFrom,
    // Punkt in der Welt → Bildschirmpunkt { x, y } in CSS-Pixeln (z. B. Billard: Richtung des Queues), null wenn hinter der Kamera
    toScreen(point) {
      const v = point.clone().project(camera);
      if (v.z > 1) return null;
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    // Einstellungen dieses PCs (settings.js) – beim Start einmal aufrufen
    applySettings(s) {
      designs.apply(s.room, s.daytime);
      graphics.apply(s);
      dust.group.visible = s.dust;
      confettiOn = s.confetti;
    },
    // Spieltisch und Stühle zeigen oder (beim Billardtisch) ausblenden – was auf dem Tisch liegt, bleibt
    setFurniture(visible) {
      for (const child of table.children) if (child !== tableTop) child.visible = visible;
    },
    // Sieg-Konfetti an der Tischkante vor diesem Spieler (0 = Host auf +z)
    celebrate(player) {
      if (confettiOn) confetti.burst(player === 0 ? 1 : -1);
    },
    onFrame(fn) {
      frameFns.add(fn);
      return () => frameFns.delete(fn);
    },
  };
}

function mesh(geometry, material, { x = 0, y = 0, z = 0, ry = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = shadow;
  return m;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Liefert die Materialien und Lichter, die designs.js je nach Stil und Tageszeit tauscht
function buildRoom(scene) {
  const floorMat = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#6b4226', boards: 8, joints: true, repeat: [4, 4] }), roughness: 0.6 });
  const floor = mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  scene.add(floor);

  const rugMat = new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.95 });
  const rug = mesh(new THREE.PlaneGeometry(1.9, 2.6), rugMat, { y: 0.004 });
  rug.rotation.x = -Math.PI / 2;
  rug.rotation.z = Math.PI / 2;
  rug.castShadow = false;
  scene.add(rug);

  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 1 });
  const ceiling = mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), ceilingMat, { y: ROOM.h });
  ceiling.rotation.x = Math.PI / 2;
  scene.add(ceiling);

  // Wände: Tapete oben, Holzvertäfelung unten
  const paper = new THREE.MeshStandardMaterial({ map: wallpaperTexture(), roughness: 0.9 });
  const panel = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2c17', boards: 3 }), roughness: 0.5 });
  const walls = [
    { x: 0, z: -ROOM.d / 2, ry: 0 },
    { x: -ROOM.w / 2, z: 0, ry: Math.PI / 2 },
    { x: ROOM.w / 2, z: 0, ry: -Math.PI / 2 },
    { x: 0, z: ROOM.d / 2, ry: Math.PI },
  ];
  for (const { x, z, ry } of walls) {
    const wall = new THREE.Group();
    wall.position.set(x, 0, z);
    wall.rotation.y = ry;
    wall.add(mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.h), paper, { y: ROOM.h / 2 }));
    wall.add(mesh(box(ROOM.w, 0.95, 0.03), panel, { y: 0.475, z: 0.015 }));
    wall.add(mesh(box(ROOM.w, 0.04, 0.05), panel, { y: 0.96, z: 0.025 }));
    scene.add(wall);
  }

  // Fenster mit Nachthimmel und Vorhängen (Rückwand)
  const win = new THREE.Group();
  win.position.set(-1.1, 1.5, -ROOM.d / 2 + 0.02);
  const sky = new THREE.MeshBasicMaterial({ map: nightTexture() });
  win.add(mesh(new THREE.PlaneGeometry(1, 1.2), sky, { shadow: false }));
  const frame = new THREE.MeshStandardMaterial({ color: 0xe8dcc6, roughness: 0.6 });
  for (const [w, h, x, y] of [[1.1, 0.06, 0, 0.63], [1.1, 0.08, 0, -0.63], [0.06, 1.3, -0.53, 0], [0.06, 1.3, 0.53, 0], [0.04, 1.2, 0, 0], [1, 0.04, 0, 0.15]]) {
    win.add(mesh(box(w, h, 0.05), frame, { x, y, z: 0.02 }));
  }
  win.add(mesh(box(1.25, 0.04, 0.16), frame, { y: -0.68, z: 0.07 }));
  const curtain = new THREE.MeshStandardMaterial({ color: 0x6b1f1a, roughness: 0.95 });
  for (const x of [-0.72, 0.72]) win.add(mesh(box(0.3, 1.75, 0.06), curtain, { x, y: -0.05, z: 0.1 }));
  scene.add(win);

  // Bild an der Wand
  const picture = new THREE.Group();
  picture.position.set(1.2, 1.6, -ROOM.d / 2 + 0.03);
  picture.add(mesh(box(0.86, 0.66, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.4, metalness: 0.6 })));
  picture.add(mesh(new THREE.PlaneGeometry(0.76, 0.56), new THREE.MeshStandardMaterial({ map: paintingTexture(), roughness: 0.8 }), { z: 0.021 }));
  scene.add(picture);

  // Stehlampe in der Ecke
  const lamp = new THREE.Group();
  lamp.position.set(-2.45, 0, -2.45);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.35, metalness: 0.8 });
  lamp.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 32), brass, { y: 0.015 }));
  lamp.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 12), brass, { y: 0.77 }));
  const lampShade = new THREE.MeshStandardMaterial({
    color: 0xf0d9b0, emissive: 0xffb060, emissiveIntensity: 2.6, side: THREE.DoubleSide, roughness: 0.9, // heller als alles Beleuchtete → Lichtschein (graphics.js)
  });
  lamp.add(mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.32, 32, 1, true), lampShade, { y: 1.62, shadow: false }));
  const glow = new THREE.PointLight(0xffb070, 2.2, 0, 2);
  glow.position.y = 1.58;
  lamp.add(glow);
  scene.add(lamp);

  return { floor: floorMat, rug: rugMat, ceiling: ceilingMat, paper, panel, sky, curtain, floorLamp: glow, glowing: [lampShade] };
}

function buildTable(scene) {
  const table = new THREE.Group();
  const top = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#5c3418', boards: 5 }), roughness: 0.65 }); // wie designs.js
  const dark = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#3e2210', boards: 2 }), roughness: 0.55 });

  table.add(mesh(new RoundedBoxGeometry(1.0, 0.045, 1.0, 2, 0.012), top, { y: TABLE_TOP - 0.0225 }));
  for (const [w, d, x, z] of [[0.86, 0.025, 0, 0.44], [0.86, 0.025, 0, -0.44], [0.025, 0.86, 0.44, 0], [0.025, 0.86, -0.44, 0]]) {
    table.add(mesh(box(w, 0.08, d), dark, { x, y: TABLE_TOP - 0.085, z }));
  }
  for (const x of [-0.43, 0.43]) {
    for (const z of [-0.43, 0.43]) table.add(mesh(box(0.06, TABLE_TOP - 0.045, 0.06), dark, { x, y: (TABLE_TOP - 0.045) / 2, z }));
  }

  for (const sideZ of [1, -1]) table.add(chair(dark, sideZ));

  scene.add(table);
  return { table, top };
}

function chair(wood, sideZ) {
  const c = new THREE.Group();
  c.position.z = sideZ * 0.68;
  c.rotation.y = sideZ > 0 ? 0 : Math.PI;
  c.add(mesh(new RoundedBoxGeometry(0.44, 0.04, 0.42, 2, 0.01), wood, { y: 0.45 }));
  for (const x of [-0.19, 0.19]) {
    for (const z of [-0.18, 0.18]) c.add(mesh(box(0.035, 0.45, 0.035), wood, { x, y: 0.225, z }));
    c.add(mesh(box(0.035, 0.5, 0.035), wood, { x, y: 0.72, z: 0.18 }));
  }
  for (const y of [0.62, 0.74, 0.86]) c.add(mesh(box(0.38, 0.05, 0.02), wood, { y, z: 0.18 }));
  return c;
}

function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffe2c0, 0x2a1a10, 0.35);
  scene.add(hemi);

  // Hängelampe über dem Tisch – Hauptlicht mit Schatten
  const shade = new THREE.Group();
  shade.position.set(0, 1.78, 0);
  shade.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, ROOM.h - 1.78, 6), new THREE.MeshStandardMaterial({ color: 0x111111 }), {
    y: (ROOM.h - 1.78) / 2, shadow: false,
  }));
  shade.add(mesh(new THREE.ConeGeometry(0.22, 0.16, 40, 1, true), new THREE.MeshStandardMaterial({
    color: 0x24412f, roughness: 0.4, metalness: 0.5, side: THREE.FrontSide,
  }), { shadow: false }));
  const shadeGlow = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffd9a0, emissiveIntensity: 2.6, side: THREE.BackSide });
  shade.add(mesh(new THREE.ConeGeometry(0.218, 0.158, 40, 1, true), shadeGlow, { shadow: false }));
  shade.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3dc).multiplyScalar(8) }), { y: -0.05, shadow: false }));
  scene.add(shade);

  const spot = new THREE.SpotLight(0xffd6a0, 7, 0, 0.8, 0.6, 2);
  spot.position.set(0, LAMP_Y, 0);
  spot.target.position.set(0, TABLE_TOP, 0);
  spot.castShadow = true; // Auflösung und Art der Schatten: graphics.js
  spot.shadow.camera.near = 0.3;
  spot.shadow.camera.far = 3;
  spot.shadow.bias = -0.0002;
  spot.shadow.normalBias = 0.002;
  scene.add(spot, spot.target);
  return { spot, hemi, shadeGlow };
}
