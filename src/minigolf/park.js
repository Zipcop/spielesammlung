// Die Anlage drumherum: Rasen, Wege, Hecken, Bäume, Bänke, Kassenhäuschen, Blumenbeete und der Himmel.
// Alles selbst gezeichnet (Canvas-Texturen), keine Bilddateien. Nur fürs Aussehen – die Physik kennt nur die Bahnen.
import * as THREE from 'three';
import { canvasTexture, woodTexture } from '../textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

// Feste Zufallsfolge, damit die Anlage auf beiden PCs gleich aussieht
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function grassTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#4f7d33';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26000; i++) {
      const tone = Math.random();
      g.fillStyle = tone < 0.45 ? `rgba(30, 60, 18, ${rand(0.1, 0.35)})` : tone < 0.9 ? `rgba(120, 170, 70, ${rand(0.08, 0.25)})` : `rgba(170, 160, 80, ${rand(0.05, 0.2)})`;
      const x = Math.random() * w;
      const y = Math.random() * h;
      g.fillRect(x, y, 1, rand(2, 6));
    }
  }, { repeat: [24, 24] });
}

// Gestrichener Beton: Farbe mit feinen Poren und leichten Laufspuren
export function concreteTexture(color) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0, 0, 0, ${rand(0.02, 0.12)})` : `rgba(255, 255, 255, ${rand(0.02, 0.08)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rand(1, 2.5), rand(1, 2.5));
    }
    for (let i = 0; i < 10; i++) { // abgespielte, hellere Bahnen
      const grad = g.createLinearGradient(0, 0, w, 0);
      const x = rand(0.2, 0.8);
      grad.addColorStop(Math.max(0, x - 0.15), 'rgba(255, 255, 255, 0)');
      grad.addColorStop(x, `rgba(255, 255, 255, ${rand(0.02, 0.05)})`);
      grad.addColorStop(Math.min(1, x + 0.15), 'rgba(255, 255, 255, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
  }, { repeat: [0.5, 0.5] });
}

// Bahnfilz: kurze Fasern
export function laneFeltTexture(color) {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 50000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0, 0, 0, ${rand(0, 0.12)})` : `rgba(180, 230, 170, ${rand(0, 0.06)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rand(1, 3), 1);
    }
  }, { repeat: [1.5, 1.5] });
}

function paverTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#7c7266';
    g.fillRect(0, 0, w, h);
    const n = 8;
    const s = w / n;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const tone = Math.round(rand(150, 190));
        g.fillStyle = `rgb(${tone}, ${tone - 10}, ${tone - 24})`;
        const off = r % 2 ? s / 2 : 0;
        g.fillRect(c * s + off + 3, r * s + 3, s - 6, s - 6);
        g.fillRect(c * s + off + 3 - w, r * s + 3, s - 6, s - 6);
      }
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${rand(0, 0.12)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, { repeat: [1, 1] });
}

function leafTexture(base = '#2f5a24') {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3500; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(10, 30, 8, ${rand(0.2, 0.5)})` : `rgba(120, 170, 70, ${rand(0.15, 0.4)})`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, rand(2, 5), rand(1, 3), rand(0, 3), 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat: [2, 1] });
}

function barkTexture() {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#4a3624';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(20, 12, 6, ${rand(0.2, 0.5)})`;
      g.lineWidth = rand(1, 3);
      const x = rand(0, w);
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + rand(-3, 3), y);
      g.stroke();
    }
  });
}

// Himmel als Rundumbild (equirektangulär): Blau mit Wolken, am Horizont dunstig mit fernen Baumreihen
export function skyTexture() {
  const tex = canvasTexture(2048, 1024, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h / 2);
    sky.addColorStop(0, '#2f6fc0');
    sky.addColorStop(0.7, '#8fbfe8');
    sky.addColorStop(1, '#b4cad3');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#4a6b38';
    g.fillRect(0, h / 2, w, h / 2);
    for (let i = 0; i < 26; i++) { // Wolken aus weichen Kreisen
      const cx = rand(0, w);
      const cy = rand(h * 0.12, h * 0.4);
      const size = rand(16, 40);
      for (let k = 0; k < 9; k++) {
        const x = cx + k * size * 0.7 - size * 3;
        const r = size * rand(0.8, 1.5);
        const blob = g.createRadialGradient(x, cy + rand(-6, 6), 0, x, cy, r);
        blob.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
        blob.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = blob;
        g.fillRect(x - r, cy - r, 2 * r, 2 * r);
      }
    }
    for (const [tone, top, size] of [['#7f9a86', 0.47, 9], ['#5c7a52', 0.485, 7]]) { // ferne Baumreihen im Dunst
      g.fillStyle = tone;
      for (let x = 0; x < w; x += size * 1.6) {
        g.beginPath();
        g.ellipse(x, h * top + rand(-4, 4), size * rand(1, 1.8), size * rand(1.2, 2.6), 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillRect(0, h * top, w, h * (0.5 - top) + 1);
    }
  });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
export const HAZE = 0xb4cad3; // Dunst am Horizont (Nebel)

function mesh(geometry, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}

// Rasen, Wege und Bepflanzung im Bezug der Anlage
export function buildPark(group) {
  const rng = seeded(4711);
  const r = (a, b) => a + rng() * (b - a);
  const grass = mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }), -2, 0, 0);
  grass.rotation.x = -Math.PI / 2;
  grass.castShadow = false;
  group.add(grass);

  // Wege: Hauptweg zwischen den beiden Bahnreihen, dazu ein Weg zum Kassenhäuschen
  const paver = new THREE.MeshStandardMaterial({ map: paverTexture(), roughness: 0.85 });
  const path = (x0, x1, z0, z1) => {
    const tex = paver.map.clone();
    tex.needsUpdate = true;
    tex.repeat.set((x1 - x0) / 1.2, (z1 - z0) / 1.2);
    const m = mesh(new THREE.BoxGeometry(x1 - x0, 0.03, z1 - z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), (x0 + x1) / 2, 0.015, (z0 + z1) / 2);
    m.castShadow = false;
    group.add(m);
  };
  path(-16, 12, -1.45, 1.45);
  path(-13.2, -11.4, 1.45, 6);

  // Hecke rundum (mit Lücke am Eingang links)
  const hedge = new THREE.MeshStandardMaterial({ map: leafTexture(), roughness: 0.9 });
  const hedgeBox = (x0, x1, z0, z1) => group.add(mesh(new THREE.BoxGeometry(x1 - x0, 0.95, z1 - z0), hedge, (x0 + x1) / 2, 0.475, (z0 + z1) / 2));
  hedgeBox(-17, 13, -14.6, -14);
  hedgeBox(-17, 13, 14, 14.6);
  hedgeBox(12.4, 13, -14, 14);
  hedgeBox(-17, -16.4, -14, -1.6);
  hedgeBox(-17, -16.4, 1.6, 14);

  // Bäume außen herum und ein paar zwischen den Bahnenden
  const bark = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 });
  const leaves = [new THREE.MeshStandardMaterial({ map: leafTexture('#335f26'), roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: leafTexture('#41702c'), roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: leafTexture('#2c4f22'), roughness: 0.9 })];
  const blob = new THREE.IcosahedronGeometry(1, 2);
  const spots = [];
  for (let x = -16; x <= 12; x += 3.1) spots.push([x + r(-0.6, 0.6), -16.2 + r(-0.8, 0.8)], [x + r(-0.6, 0.6), 16.2 + r(-0.8, 0.8)]);
  for (let z = -12; z <= 12; z += 3.4) if (Math.abs(z) > 2.5) spots.push([-18.6 + r(-0.6, 0.6), z + r(-0.6, 0.6)], [14.6 + r(-0.6, 0.6), z + r(-0.6, 0.6)]);
  spots.push([-14.6, 9.8], [-6.0, -13.2], [-4.0, 13.0], [11.2, -12.6], [-15, -12.4]);
  for (const [x, z] of spots) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    const height = r(2.2, 3.4);
    tree.add(mesh(new THREE.CylinderGeometry(0.11, 0.17, height, 10), bark, 0, height / 2, 0));
    const crown = r(1.1, 1.7);
    for (let k = 0; k < 4; k++) {
      const m = mesh(blob, leaves[Math.floor(rng() * leaves.length)], r(-0.5, 0.5), height + r(-0.2, 0.7), r(-0.5, 0.5));
      m.scale.set(crown * r(0.7, 1), crown * r(0.6, 0.9), crown * r(0.7, 1));
      tree.add(m);
    }
    tree.rotation.y = r(0, 6);
    group.add(tree);
  }

  // Kassenhäuschen mit Vordach und Schild, daneben Bänke und Blumenbeete
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#8a5a32', boards: 6 }), roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#4a2c17', boards: 3 }), roughness: 0.6 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x8c3b2a, roughness: 0.7 });
  const hut = new THREE.Group();
  hut.position.set(-12.3, 0, 8.2);
  hut.add(mesh(new THREE.BoxGeometry(2.6, 2.2, 2.0), wood, 0, 1.1, 0));
  const top = mesh(new THREE.ConeGeometry(2.1, 0.9, 4), roof, 0, 2.65, 0);
  top.rotation.y = Math.PI / 4;
  top.scale.set(1, 1, 0.8);
  hut.add(top);
  hut.add(mesh(new THREE.BoxGeometry(1.3, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0x1f1a14, roughness: 0.3 }), 0, 1.35, -1.01)); // Fenster
  hut.add(mesh(new THREE.BoxGeometry(1.6, 0.06, 0.45), dark, 0, 0.98, -1.2)); // Tresen
  const sign = mesh(new THREE.PlaneGeometry(1.8, 0.42), new THREE.MeshStandardMaterial({ map: signTexture('Minigolf', 'Kasse · Schläger · Bälle'), roughness: 0.6 }), 0, 1.95, -1.012, false);
  sign.rotation.y = Math.PI;
  hut.add(sign);
  group.add(hut);

  const bench = (x, z, ry) => {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = ry;
    for (const dx of [-0.7, 0.7]) b.add(mesh(new THREE.BoxGeometry(0.06, 0.42, 0.42), dark, dx, 0.21, 0));
    for (const dz of [-0.13, 0, 0.13]) b.add(mesh(new THREE.BoxGeometry(1.6, 0.035, 0.11), wood, 0, 0.44, dz));
    for (const dy of [0.62, 0.76]) b.add(mesh(new THREE.BoxGeometry(1.6, 0.09, 0.03), wood, 0, dy, 0.2));
    group.add(b);
  };
  bench(-8.5, 1.9, 0);
  bench(-2.5, -1.9, Math.PI);
  bench(-9.6, 10.5, Math.PI / 2);
  bench(-7.2, 5.2, -Math.PI / 2);

  const soil = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1 });
  const petals = [0xd8343a, 0xf2b630, 0xe86fb0, 0xf4efe2, 0x8a5ad0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const flower = new THREE.SphereGeometry(0.05, 8, 6);
  const bed = (x, z, w, d) => {
    const m = mesh(new THREE.BoxGeometry(w, 0.12, d), soil, x, 0.06, z);
    group.add(m);
    const count = Math.round(w * d * 24);
    for (let i = 0; i < count; i++) {
      const f = mesh(flower, petals[Math.floor(rng() * petals.length)], x + r(-w / 2 + 0.06, w / 2 - 0.06), 0.15 + r(0, 0.06), z + r(-d / 2 + 0.06, d / 2 - 0.06), false);
      group.add(f);
    }
  };
  bed(-14.5, 3.6, 1.6, 0.9);
  bed(-9.8, 13.2, 3, 0.7);
  bed(-6.0, 9.0, 1.4, 1.4);
  bed(11.3, 6, 1.2, 2.4);
}

// Schild: großer Titel, kleine Zeile darunter
export function signTexture(title, line) {
  return canvasTexture(512, 120, (g, w, h) => {
    g.fillStyle = '#f2ead6';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2f5a24';
    g.lineWidth = 8;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#2f5a24';
    g.font = `bold ${line ? 50 : 56}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, w / 2, line ? 40 : h / 2);
    if (line) {
      g.font = `bold ${line.length > 14 ? 28 : 36}px Georgia, serif`;
      g.fillText(line, w / 2, 90);
    }
  });
}
