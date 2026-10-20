// 3D-Spielkarten für alle Kartenspiele: dünnes Plättchen mit runden Ecken, Vorderseite, Rückseite
// und Kante. Karten fliegen im Bogen zu ihrem Ziel und drehen sich dabei um; dazu Lagen für
// „flach auf dem Tisch“ und „Fächer in der Hand“. Kennt keine Spielregeln.
// Maße in Zentimetern – die Gruppe ist auf 1/100 skaliert (Szene in Metern).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardFace, cardBack } from './faces.js';

export const CARD = { w: 6.3, h: 8.8, t: 0.03, r: 0.35 }; // Poker-Maß, 0,3 mm dick
const FLY_S = 0.42;
const UP = new THREE.Vector3(0, 1, 0);
const ACROSS = new THREE.Vector3(1, 0, 0);
const FACE_DOWN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

// Lage = { pos, quat }. Flach auf dem Tisch: Kartenkopf zeigt nach −z, turn = Drehung (Bogenmaß)
export function flat(x, y, z, turn = 0, faceUp = true) {
  const quat = new THREE.Quaternion().setFromAxisAngle(UP, turn);
  if (!faceUp) quat.multiply(FACE_DOWN);
  return { pos: new THREE.Vector3(x, y + CARD.t / 2, z), quat };
}

// Karte i von n im Fächer. at = Mitte des Fächers für den Platz auf der +z-Seite, side = Drehung zum
// Platz (0 oder π), tilt = wie weit die Karten zum Spieler aufgestellt sind, raise = Karte angehoben
export function fan(i, n, { at, side = 0, tilt = 0.6, gap = 3.3, width = 28, angle = 0.075, raise = 0 }) {
  const k = i - (n - 1) / 2;
  const dx = Math.min(gap, width / Math.max(n - 1, 1));
  const da = Math.min(angle, 0.8 / Math.max(n - 1, 1));
  const frame = new THREE.Quaternion().setFromAxisAngle(UP, side).multiply(new THREE.Quaternion().setFromAxisAngle(ACROSS, tilt));
  // in der Kartenebene: x = rechts, −z = oben; y = zum Spieler (spätere Karten liegen vorne)
  const local = new THREE.Vector3(k * dx, i * 0.05, (k * dx) ** 2 * 0.01 - raise); // äußere Karten etwas tiefer (Bogen)
  return {
    pos: local.applyQuaternion(frame).add(at.clone().applyAxisAngle(UP, side)),
    quat: frame.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, -k * da)),
  };
}

const same = (a, b) => !!a && a.pos.distanceToSquared(b.pos) < 1e-6 && a.quat.angleTo(b.quat) < 1e-3;

function cardGeometry() {
  const { w, h, t, r } = CARD;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);

  const side = (up) => {
    const g = new THREE.ShapeGeometry(shape, 4).toNonIndexed();
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) g.attributes.uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2); // Vorderseite nach oben, Rückseite nach unten
    g.translate(0, up ? t / 2 : -t / 2, 0);
    return g;
  };

  // Kante: schmales Band entlang des Umrisses
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

  return mergeGeometries([side(true), side(false), band], true); // Gruppen: Vorderseite, Rückseite, Kante
}

export function createCards(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);

  const geometry = cardGeometry();
  const backMat = new THREE.MeshStandardMaterial({ map: cardBack(), color: 0xb0b0b0, roughness: 0.8 }); // etwas dunkler, sonst wirkt das Rot unter der Lampe blass
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.8, side: THREE.DoubleSide });
  let anims = [];
  let clock = 0;

  // Neue Karte, zunächst unbekannt (beidseitig Rückseite – so verrät sie nichts)
  function make() {
    const front = new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.85 }); // matt wie Karton – glänzend spiegelte die Lampe
    const mesh = new THREE.Mesh(geometry, [front, backMat, edgeMat]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    const card = { mesh, id: null, target: null };
    mesh.userData.card = card;
    return card;
  }

  // id = Kartentext oder null (verdeckt/unbekannt)
  function setFace(card, id) {
    card.id = id;
    card.mesh.material[0].map = cardFace(id);
  }

  function place(card, spot) {
    card.target = spot;
    card.mesh.position.copy(spot.pos);
    card.mesh.quaternion.copy(spot.quat);
  }

  // Karte fliegen lassen; mit queue kommt der Flug nach den schon geplanten. Ist die Karte ohne queue
  // schon unterwegs (oder eingeplant), ändert sich nur das Ziel – z. B. wenn sich der Fächer beim Austeilen neu ordnet.
  function fly(card, spot, { delay = 0, dur = FLY_S, lift = 0, queue = false, onStart, onLand } = {}) {
    if (same(card.target, spot) && !queue) return;
    const last = anims.findLast((a) => a.card === card && !a.done);
    if (last && !queue) last.to = spot;
    else anims.push({ card, to: spot, start: clock + delay, dur, lift, onStart, onLand, from: null });
    card.target = spot;
  }

  function update(dt) {
    clock += dt;
    for (const a of anims) {
      if (a.done || clock < a.start) continue;
      if (!a.from) {
        for (const b of anims) if (b !== a && b.card === a.card && b.from) b.done = true; // frühere Bewegung endet hier
        a.from = { pos: a.card.mesh.position.clone(), quat: a.card.mesh.quaternion.clone() };
        a.onStart?.();
      }
      const t = Math.min((clock - a.start) / a.dur, 1);
      const k = t * t * (3 - 2 * t);
      a.card.mesh.position.lerpVectors(a.from.pos, a.to.pos, k);
      a.card.mesh.position.y += Math.sin(t * Math.PI) * a.lift;
      a.card.mesh.quaternion.slerpQuaternions(a.from.quat, a.to.quat, k);
      if (t === 1) {
        a.done = true;
        a.onLand?.(false);
      }
    }
    anims = anims.filter((a) => !a.done);
  }

  // Alle Flüge sofort beenden (instant = true: ohne Geräusch)
  function finish() {
    const open = anims;
    anims = [];
    for (const a of open) a.onLand?.(true);
    for (const a of open) place(a.card, a.card.target);
  }

  return {
    group,
    make,
    setFace,
    place,
    fly,
    update,
    finish,
    // Sekunden, bis alle Karten liegen
    busy: () => Math.max(0, ...anims.map((a) => a.start + a.dur - clock)),
    // Oberste getroffene Karte aus der Liste oder null. Karten im Flug zählen nicht – sonst trifft ein
    // schneller zweiter Klick auf den Stapel die gerade gezogene Karte.
    pick(raycaster, cards) {
      const flying = new Set(anims.filter((a) => a.lift > 0).map((a) => a.card));
      const hit = raycaster.intersectObjects(cards.filter((c) => !flying.has(c)).map((c) => c.mesh), false)[0];
      return hit?.object.userData.card ?? null;
    },
    // Karte abdunkeln (z. B. passt gerade nicht)
    shade(card, level) {
      card.mesh.material[0].color.setScalar(level);
    },
  };
}
