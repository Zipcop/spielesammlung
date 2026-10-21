// Kleine gemeinsame Würfel-Helfer für Zehntausend und Schocken (Kniffel, Mäxchen und MÄDN haben ihre eigenen, Mäxchen
// nimmt von hier nur die Zufallslagen):
// welche Zahl oben liegt, Würfel mit einer Zahl nach oben hinlegen, zufällige Startlage, Würfel-Material, Lage zum Senden.
// Maße in cm wie in den Brettern (Gruppe 1/100 skaliert).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { diceFaces } from './textures.js';

// Reihenfolge der BoxGeometry-Seiten: +x, −x, +y, −y, +z, −z (Gegenseiten ergeben 7)
export const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => new THREE.Vector3(...v));
export const UP = new THREE.Vector3(0, 1, 0);

export const rand = (a, b) => a + Math.random() * (b - a);
export const smooth = (t) => t * t * (3 - 2 * t);
export const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Welche Zahl liegt oben? up = 1 heißt: liegt ganz flach
export function topFace(q) {
  let best = 0;
  let up = -2;
  FACE_NORMALS.forEach((n, i) => {
    const y = n.clone().applyQuaternion(q).y;
    if (y > up) [best, up] = [i, y];
  });
  return { value: FACE_VALUES[best], up };
}

// Würfel mit value oben, um yaw (rad) um die Senkrechte gedreht
export const upright = (value, yaw = 0) => new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(value)], UP)
  .premultiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));

// Ganz zufällige Lage, gleichverteilt über alle Drehungen (Shoemake) – damit der Startwurf nichts vorgibt. Zufällige
// Euler-Winkel sind nicht gleichverteilt: Unter dem Becher von Hand (kaum Schwung) kam die 3 so nur bei 11 % der Würfe.
// (Bei Kniffel kam mit fester Startlage die 3 fast dreimal so oft wie die 5.)
export function randomQuat() {
  const [a, b, c] = [Math.random(), Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI];
  return new THREE.Quaternion(Math.sqrt(1 - a) * Math.sin(b), Math.sqrt(1 - a) * Math.cos(b), Math.sqrt(a) * Math.sin(c), Math.sqrt(a) * Math.cos(c));
}
// Zufällige Zahl oben, in Vierteln gedreht (so passen mehrere Würfel ohne Überlappen nebeneinander).
// Auch für den Collider im Würfel-Körper: Rapier behandelt dessen sechs Seiten nicht ganz gleich (mit kaum Schwung kam
// seine Seite +x zu oft nach oben, Becher von Hand bei Zehntausend die 2 bei 20 %). Zufällig gedreht ist die Form
// gleich, aber keine Collider-Seite gehört mehr fest zu einer Zahl (Messung 21.10.2026).
export const randomTurn = (yaw = 0) => upright(1 + Math.floor(Math.random() * 6), yaw + Math.floor(Math.random() * 4) * Math.PI / 2);

// Drehung um die Senkrechte, die ein liegender Würfel gerade hat
export function yawOf(q) {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  if (Math.abs(f.y) > 0.7) f.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(-f.z, f.x);
}

// Würfel-Mesh mit sechs bedruckten Seiten (Stil aus settings: weiss, elfenbein, rot, schwarz)
export function makeDie(size, radius, style = 'weiss') {
  const faces = diceFaces(style);
  const m = new THREE.Mesh(new RoundedBoxGeometry(size, size, size, 4, radius), FACE_VALUES.map((v) => new THREE.MeshPhysicalMaterial({
    ...faces[v - 1], bumpScale: 1.4, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25,
  })));
  m.castShadow = m.receiveShadow = true;
  return m;
}
export function restyleDie(m, style) {
  const f = diceFaces(style);
  m.material.forEach((mat, k) => Object.assign(mat, f[FACE_VALUES[k] - 1], { needsUpdate: true }));
}

// Lage zum Senden: [x, y, z, qx, qy, qz, qw]
export const pose = (m) => [
  round(m.position.x, 2), round(m.position.y, 2), round(m.position.z, 2),
  round(m.quaternion.x, 4), round(m.quaternion.y, 4), round(m.quaternion.z, 4), round(m.quaternion.w, 4),
];
export const isPose = (a) => Array.isArray(a) && a.length === 7 && a.every(Number.isFinite);
