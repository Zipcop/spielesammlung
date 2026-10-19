// Staunton-Figuren als Geometrie, in Zentimetern, Fuß auf y = 0. Gedrechselte Teile sind
// Rotationskörper (Profil [Radius, Höhe] von unten nach oben); Springerkopf, Zinnen,
// Kronenkugeln und Kreuz kommen als eigene Teile dazu. Der Springer schaut nach −x.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Profil weich durchziehen; doppelte Punkte ergeben eine scharfe Kante
function lathe(profile) {
  const points = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(profile.length * 8);
  points.forEach((p) => (p.x = Math.max(p.x, 0)));
  return new THREE.LatheGeometry(points, 48);
}

// Kugel-Bogen fürs Profil (Mitte auf der Achse), Winkel in Grad
function arc(y, radius, from, to, steps = 6) {
  const out = [];
  for (let k = 0; k <= steps; k++) {
    const a = THREE.MathUtils.degToRad(from + ((to - from) * k) / steps);
    out.push([radius * Math.cos(a), y + radius * Math.sin(a)]);
  }
  return out;
}

// Gemeinsamer Fuß: Platte, Wulst, Kehle
const foot = (R) => [
  [0, 0], [R, 0], [R, 0], [R, 0.34], [R * 0.95, 0.5], [R * 0.8, 0.63], [R * 0.82, 0.8], [R * 0.72, 0.96],
];

// Doppelter Kragen unter dem Kopf
const collar = (y, R, neck) => [
  [neck, y], [R, y + 0.14], [R * 1.04, y + 0.26], [R, y + 0.38], [neck * 1.1, y + 0.48],
  [R * 0.86, y + 0.6], [R * 0.88, y + 0.68], [neck * 1.05, y + 0.78],
];

function merge(parts) {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

function pawn() {
  return lathe([...foot(1.38), [0.6, 1.4], [0.48, 2.2], ...collar(2.25, 0.9, 0.45), ...arc(3.75, 0.82, -50, 90)]);
}

function rook() {
  const body = lathe([
    ...foot(1.65), [0.95, 1.3], [0.86, 2.2], [0.9, 3.1], [1.0, 3.5],
    [1.16, 3.6], [1.16, 3.6], [1.16, 3.75], [1.16, 3.75], [1.0, 3.86],
    [1.08, 4.15], [1.3, 4.42], [1.34, 4.48], [1.34, 4.48], [1.34, 4.85], [1.34, 4.85],
    [1.0, 4.85], [1.0, 4.85], [1.0, 4.62], [1.0, 4.62], [0, 4.62],
  ]);
  // Zinnen: 6 Ringstücke auf dem Rand
  const merlons = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 1.34, a, a + 0.68, false);
    shape.absarc(0, 0, 1.0, a + 0.68, a, true);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false, curveSegments: 6 });
    g.rotateX(-Math.PI / 2).translate(0, 4.85, 0);
    merlons.push(g);
  }
  return merge([body, ...merlons]);
}

function knight() {
  const base = lathe([...foot(1.7), [1.2, 1.15], [1.2, 1.15], [1.2, 1.35], [1.2, 1.35], [0, 1.35]]);
  // Pferdekopf von der Seite: x = nach vorn (Maul), y = nach oben
  const s = new THREE.Shape();
  s.moveTo(-1.1, 1.2);
  s.splineThru([new THREE.Vector2(-1.2, 2.1), new THREE.Vector2(-1.05, 3.1), new THREE.Vector2(-0.8, 4.0), new THREE.Vector2(-0.5, 4.75)]);
  s.lineTo(-0.38, 5.3);
  s.lineTo(-0.22, 5.95); // Ohrspitze
  s.lineTo(0.05, 5.4);
  s.splineThru([new THREE.Vector2(0.45, 5.22), new THREE.Vector2(0.95, 4.88), new THREE.Vector2(1.45, 4.3), new THREE.Vector2(1.72, 3.9)]);
  s.lineTo(1.66, 3.55); // Maul
  s.lineTo(1.25, 3.45);
  s.lineTo(1.05, 3.6);
  s.splineThru([new THREE.Vector2(0.72, 3.35), new THREE.Vector2(0.48, 2.95), new THREE.Vector2(0.58, 2.35), new THREE.Vector2(0.92, 1.85), new THREE.Vector2(1.0, 1.2)]);
  s.lineTo(-1.1, 1.2);
  const head = new THREE.ExtrudeGeometry(s, {
    depth: 1.3, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.22, bevelSegments: 4, curveSegments: 16,
  });
  head.translate(0, 0, -0.65);
  // Wie geschnitzt: Hals breit, zur Schnauze und zu den Ohren hin schmaler
  const pos = head.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const toSnout = THREE.MathUtils.clamp((pos.getX(i) + 1.2) / 2.9, 0, 1);
    const toEars = THREE.MathUtils.clamp((pos.getY(i) - 4.6) / 1.4, 0, 1);
    pos.setZ(i, pos.getZ(i) * (1.15 - 0.45 * toSnout) * (1 - 0.35 * toEars));
  }
  head.computeVertexNormals();
  head.rotateY(Math.PI); // Maul zeigt nach −x (wie im Diagramm nach links)
  return merge([base, head]);
}

function bishop() {
  return lathe([
    ...foot(1.6), [0.8, 1.3], [0.58, 2.2], [0.46, 3.1], ...collar(3.2, 0.98, 0.48),
    [0.62, 4.15], [0.84, 4.55], [0.87, 5.0], [0.7, 5.5], [0.4, 5.85], [0.16, 6.0],
    ...arc(6.22, 0.28, -50, 90, 5),
  ]);
}

function queen() {
  const body = lathe([
    ...foot(1.8), [0.92, 1.4], [0.66, 2.6], [0.54, 3.7], ...collar(3.85, 1.08, 0.55),
    [0.7, 4.85], [0.95, 5.5], [1.16, 6.12], [1.2, 6.28], [1.2, 6.28], [1.0, 6.34],
    [0.72, 6.55], [0.5, 6.78], [0.32, 6.88], ...arc(7.14, 0.32, -50, 90, 5),
  ]);
  // Krone: Kugeln rundherum
  const balls = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    balls.push(new THREE.SphereGeometry(0.2, 12, 8).translate(Math.cos(a) * 1.08, 6.42, Math.sin(a) * 1.08));
  }
  return merge([body, ...balls]);
}

function king() {
  const body = lathe([
    ...foot(1.85), [0.98, 1.45], [0.7, 2.8], [0.58, 4.0], ...collar(4.15, 1.1, 0.6),
    [0.75, 5.15], [1.0, 5.8], [1.14, 6.38], [1.17, 6.52], [1.17, 6.52], [1.0, 6.58],
    [0.82, 6.75], [0.55, 6.95], [0.32, 7.05], [0.28, 7.1], [0, 7.12],
  ]);
  const upright = new THREE.BoxGeometry(0.36, 1.25, 0.36).translate(0, 7.62, 0);
  const bar = new THREE.BoxGeometry(0.95, 0.34, 0.36).translate(0, 7.78, 0);
  return merge([body, upright, bar]);
}

// type = 'p' | 'n' | 'b' | 'r' | 'q' | 'k' (wie in chess.js)
export function createPieceGeometries() {
  return { p: pawn(), n: knight(), b: bishop(), r: rook(), q: queen(), k: king() };
}
