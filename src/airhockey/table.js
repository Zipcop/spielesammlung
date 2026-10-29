// Air-Hockey-Tisch: Spielfläche mit Luftlöchern und Linien, Banden mit Torschlitzen, Korpus und Beine, zwei Torzähler an
// der Mittellinie, Puck und zwei Schläger. Zeigt nur an – die Physik (physics.js) rechnet der Host, der Gast sagt voraus (index.js).
// Maße in Metern (echte Größe, rules.js). Ursprung der Gruppe = Mitte der Spielfläche auf Höhe der Tischplatte des Zimmers;
// die Spielfläche liegt auf SURF (80 cm über dem Boden). Länge entlang z: Host-Tor auf +z, Gast-Tor auf −z.
// Der Tisch hängt am tableTop (der kleine Spieltisch wird solange ausgeblendet, room.setFurniture).
import * as THREE from 'three';
import { TABLE, R, RM } from './rules.js';
import { canvasTexture } from '../textures.js';
import { createPhysics } from './physics.js';

const { L, W, GOAL, RAIL, CORNER } = TABLE;
export const SURF = 0.04; // Spielfläche über der Zimmer-Tischplatte (0,76 m) = 0,80 m über dem Boden
const RAIL_H = 0.03; // Banden stehen so hoch über der Spielfläche
const PUCK_H = 0.005;
export const COLORS = ['#c8262b', '#1f5fbf']; // Schläger: Host rot, Gast blau
const UP = new THREE.Vector3(0, 1, 0);

export function createAirhockeyBoard(parent) {
  const group = new THREE.Group();
  parent.add(group);
  buildTable(group);
  const displays = [buildDisplay(group, 0), buildDisplay(group, 1)];

  const puck = buildPuck();
  group.add(puck);
  const mallets = COLORS.map((c) => {
    const m = buildMallet(c);
    group.add(m);
    return m;
  });
  addLights(group);

  let RAPIER = null;
  let loading = null;
  function ready() {
    loading ??= (async () => {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
    })();
    return loading;
  }

  // Lage anzeigen: puck = [x, z], mallets = [[x, z], [x, z]] (Tisch-Koordinaten)
  function show(p, ms) {
    const over = Math.abs(p[1]) - L / 2; // im Schlitz sinkt der Puck nach unten weg
    puck.position.set(p[0], SURF + PUCK_H / 2 - Math.min(Math.max(over - R * 0.5, 0) * 0.6, 0.1), p[1]);
    puck.visible = over < 0.16;
    ms.forEach(([x, z], i) => mallets[i].position.set(x, SURF, z));
  }

  let shownScore = '0,0';
  function reset() {
    shownScore = '0,0';
    show([0, 0], [[0, L / 2 - 0.2], [0, -L / 2 + 0.2]]);
    displays.forEach((d) => d.set([0, 0]));
  }
  reset();

  return {
    group,
    noTisch: true, // der Air-Hockey-Tisch wird nicht umgeworfen (tisch.js)
    ready,
    // neue Physik-Welt (nach ready())
    newPhysics: () => createPhysics(RAPIER),
    show,
    reset,
    // Torzähler an der Mittellinie: score = [Host, Gast]
    setScore(score) {
      if (score.join() === shownScore) return; // Textur nur neu zeichnen, wenn sich etwas ändert
      shownScore = score.join();
      displays.forEach((d) => d.set(score));
    },
    // Punkt auf der Spielfläche unter der Maus (Tisch-Koordinaten [x, z]) oder null
    pick(raycaster) {
      const height = group.localToWorld(new THREE.Vector3(0, SURF, 0)).y;
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -height), new THREE.Vector3());
      if (!hit) return null;
      const local = group.worldToLocal(hit);
      return [local.x, local.z];
    },
    // Tisch-Koordinaten → Punkt in der Welt (auf der Spielfläche)
    toWorld: ([x, z]) => group.localToWorld(new THREE.Vector3(x, SURF, z)),
  };
}

// Spielfläche: hellgrau, Luftlöcher im 1″-Raster, rote Mittellinie mit Mittelkreis, blaue Torraum-Bögen vor den Schlitzen
function fieldTexture() {
  const px = 900; // Pixel je Meter
  return canvasTexture(Math.round(W * px), Math.round(L * px), (g, w, h) => {
    g.fillStyle = '#e9edf0';
    g.fillRect(0, 0, w, h);
    const grad = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, h * 0.7); // leicht glänzende Mitte
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(160,170,180,0.18)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const line = (color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width * px;
    };
    line('#c8262b', 0.012);
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.beginPath();
    g.arc(w / 2, h / 2, 0.15 * px, 0, Math.PI * 2);
    g.stroke();
    line('#1f5fbf', 0.008);
    for (const [y, a0, a1] of [[0, 0, Math.PI], [h, Math.PI, Math.PI * 2]]) {
      g.beginPath();
      g.arc(w / 2, y, 0.24 * px, a0, a1);
      g.stroke();
    }
    for (const y of [h * 0.25, h * 0.75]) { // Viertel-Linien (Anwurf-Punkte)
      g.fillStyle = 'rgba(31, 95, 191, 0.55)';
      g.beginPath();
      g.arc(w / 2, y, 0.012 * px, 0, Math.PI * 2);
      g.fill();
    }
    // Luftlöcher: 2,54 cm Raster, feine dunkle Punkte
    const step = 0.0254 * px;
    g.fillStyle = 'rgba(60, 66, 74, 0.32)';
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // gerundete Ecken (Bande) – wie die Physik
    const c = CORNER * px;
    g.fillStyle = '#1b1d21';
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [0, h, 1, -1], [w, h, -1, -1]]) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + sx * c, y);
      g.arc(x + sx * c, y + sy * c, c, sy > 0 ? -Math.PI / 2 : Math.PI / 2, sx > 0 ? Math.PI : 0, sx * sy > 0);
      g.closePath();
      g.fill();
    }
  });
}

function buildTable(group) {
  const field = new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.62, metalness: 0 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.4, metalness: 0.3 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8d939a, roughness: 0.45, metalness: 0.6 }); // Alu-Leiste oben
  const bumper = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 });
  const body = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.5, metalness: 0.2 });
  const hole = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1 });
  const add = (geometry, material, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = shadow;
    group.add(m);
    return m;
  };
  const top = add(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), field, 0, SURF, 0, false);
  top.receiveShadow = true;
  const outerW = W + 2 * RAIL;
  const outerL = L + 2 * RAIL;
  const rail = (w, d, x, z) => {
    add(new THREE.BoxGeometry(w, RAIL_H, d), railMat, x, SURF + RAIL_H / 2, z);
    add(new THREE.BoxGeometry(w, 0.004, d), capMat, x, SURF + RAIL_H + 0.002, z, false);
  };
  for (const s of [-1, 1]) {
    rail(RAIL, outerL, s * (W / 2 + RAIL / 2), 0); // Längsbanden
    add(new THREE.BoxGeometry(0.006, RAIL_H * 0.8, L), bumper, s * (W / 2 + 0.003), SURF + RAIL_H * 0.4, 0); // Gummi innen
    const seg = (W - GOAL) / 2;
    for (const sx of [-1, 1]) {
      rail(seg, RAIL, sx * (GOAL / 2 + seg / 2), s * (L / 2 + RAIL / 2)); // Stirnbanden neben dem Schlitz
      add(new THREE.BoxGeometry(seg, RAIL_H * 0.8, 0.006), bumper, sx * (GOAL / 2 + seg / 2), SURF + RAIL_H * 0.4, s * (L / 2 + 0.003));
    }
    // Torschlitz: dunkle Öffnung, dahinter der Kasten, in den der Puck fällt; oben eine Brücke der Bande
    add(new THREE.BoxGeometry(GOAL, 0.12, RAIL), hole, 0, SURF - 0.08, s * (L / 2 + RAIL / 2), false); // Boden 2 cm tiefer: man sieht hinein
    add(new THREE.BoxGeometry(GOAL + 0.02, 0.012, RAIL * 0.45), railMat, 0, SURF + RAIL_H - 0.006, s * (L / 2 + RAIL * 0.72));
    add(new THREE.BoxGeometry(GOAL + 0.02, 0.004, RAIL * 0.45), capMat, 0, SURF + RAIL_H + 0.002, s * (L / 2 + RAIL * 0.72), false);
  }
  // Korpus, Zierstreifen an den Seiten, Beine bis zum Boden (Boden 0,76 m unter der Gruppe)
  add(new THREE.BoxGeometry(outerW - 0.02, 0.19, outerL - 0.02), body, 0, SURF - 0.105, 0); // Oberkante unter der Spielfläche (sonst Schattenstreifen)
  const stripe = new THREE.MeshStandardMaterial({ color: 0xc8262b, roughness: 0.4 });
  const stripe2 = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.4 });
  for (const s of [-1, 1]) {
    for (const [mat, dz] of [[stripe, 1], [stripe2, -1]]) add(new THREE.BoxGeometry(0.004, 0.035, outerL / 2 - 0.08), mat, s * (outerW / 2 - 0.008), SURF - 0.09, dz * (outerL / 4), false);
  }
  const legs = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.45, metalness: 0.5 });
  const floor = -0.76;
  const legH = SURF - 0.2 - floor;
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.09, legH, 0.09), legs, sx * (outerW / 2 - 0.12), floor + legH / 2, sz * (outerL / 2 - 0.16));
    add(new THREE.BoxGeometry(outerW - 0.3, 0.05, 0.05), legs, 0, floor + 0.12, sz * (outerL / 2 - 0.16));
  }
  add(new THREE.BoxGeometry(0.05, 0.05, outerL - 0.4), legs, 0, floor + 0.12, 0);
}

// Torzähler an der Mittellinie, außen an der Längsbande: für den Host rechts (+x), für den Gast rechts (−x).
// Der Leser sieht oben die Tore des anderen, unten die eigenen – je in der Farbe des Schlägers.
function buildDisplay(group, reader) {
  const side = reader === 0 ? 1 : -1;
  const size = [0.16, 0.3];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 480;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.3 });
  const housing = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.4 });
  const unit = new THREE.Group();
  unit.position.set(side * (W / 2 + RAIL + size[0] / 2 + 0.01), SURF + 0.01, 0);
  unit.rotation.y = reader === 0 ? 0 : Math.PI;
  const box = new THREE.Mesh(new THREE.BoxGeometry(size[0] + 0.02, 0.04, size[1] + 0.02), housing);
  box.castShadow = box.receiveShadow = true;
  unit.add(box);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(...size).rotateX(-Math.PI / 2), face);
  screen.position.y = 0.0205;
  unit.add(screen);
  group.add(unit);
  const draw = (score) => {
    const g = c.getContext('2d');
    g.fillStyle = '#07080a';
    g.fillRect(0, 0, c.width, c.height);
    g.font = 'bold 170px "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [p, y] of [[1 - reader, 120], [reader, 360]]) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillText('8', c.width / 2, y); // ausgeschaltete Segmente
      g.fillStyle = p === 0 ? '#ff4a4a' : '#4aa0ff';
      g.fillText(String(score[p]), c.width / 2, y);
    }
    g.fillStyle = '#c8262b';
    g.fillRect(20, 238, c.width - 40, 4);
    tex.needsUpdate = true;
  };
  return { set: draw };
}

// Puck: grüner Lexan-Puck (eine der USAA-Turnierfarben) mit weißem Klebering oben
function buildPuck() {
  const puck = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: 0x15803a, roughness: 0.75 }); // matt: sonst spiegelt die Lampe darüber den Puck weiß
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, PUCK_H, 40), side);
  disc.castShadow = disc.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.55, R * 0.68, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf8f8f2, roughness: 0.6 }));
  ring.position.y = PUCK_H / 2 + 0.0003;
  puck.add(disc, ring);
  return puck;
}

// Schläger (Mallet, „High-Top“): flache Scheibe mit Filzboden, gewölbter Körper, Griff-Knauf
function buildMallet(color) {
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, clearcoat: 0.5 });
  const profile = [
    [0, 0], [RM, 0], [RM, 0.012], [RM * 0.92, 0.018], [RM * 0.5, 0.026], [0.014, 0.034], [0.012, 0.052],
    [0.019, 0.058], [0.021, 0.066], [0.016, 0.072], [0, 0.074],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), mat);
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// Zwei Leuchten über den Tischenden (ohne Schatten) – das Zimmerlicht reicht nur bis etwa einen Meter von der Mitte
function addLights(group) {
  for (const s of [-1, 1]) {
    const light = new THREE.PointLight(0xfff1dc, 0.9, 3.5, 2);
    light.position.set(0, SURF + 1.3, s * 0.8);
    group.add(light);
  }
}
