// Spieleschrank: Regal mit einer Schachtel pro geplantem Spiel (Liste in games.js).
// Gebaut mit der Vorderseite nach +z, Breite entlang x; room.js stellt ihn an die Wand.
import * as THREE from 'three';
import { SHELF, PLAYABLE } from './games.js';
import { boxLabelTexture, plaqueTexture, woodTexture } from './textures.js';
import { setGlow } from './glow.js';

const T = 0.03; // Brettstärke
const PLINTH = 0.08; // Sockel
const ROWS = 4;
const GAP = 0.012; // zwischen zwei Stapeln
// Jede Fach-Spalte ist so breit, wie ihre Stapel nebeneinander brauchen (+ 2 cm Luft je Seite)
const COL_W = SHELF.map((c) => {
  const across = Math.ceil(Math.ceil(c.games.length / ROWS) / c.perPile);
  return across * c.box[0] + (across - 1) * GAP + 0.04;
});
export const SIZE = { w: COL_W.reduce((a, b) => a + b, 0) + (SHELF.length + 1) * T, h: 1.47, d: 0.4 };
const ROW_H = (SIZE.h - PLINTH - (ROWS + 1) * T) / ROWS;
const LEFT = COL_W.map((_, c) => -SIZE.w / 2 + T + COL_W.slice(0, c).reduce((a, b) => a + b, 0) + c * T); // Innenkante links
const PULL = 0.06; // so weit rutscht eine Schachtel beim Zeigen heraus
const COLORS = ['#7a2e24', '#24476b', '#2f5a34', '#8a5a1c', '#5a2f5e', '#2d5f5f', '#6b3a1e', '#3b3f70', '#7a6a2a', '#5e2433', '#25503f', '#4f4a44'];
const BOOK_COLORS = [0x7a1f1f, 0x1f3a5a, 0x2f4a2a, 0x8a6a2a, 0x4a2a4a, 0x2a2a2a, 0x9a4a1a];

// Liste gleichmäßig auf n Teile verteilen (vordere Teile bekommen den Rest)
function split(list, n) {
  const parts = [];
  let start = 0;
  for (let k = 0; k < n; k++) {
    const size = Math.ceil((list.length - start) / (n - k));
    parts.push(list.slice(start, start + size));
    start += size;
  }
  return parts;
}

function piles(list, perPile) {
  const out = [];
  for (let k = 0; k < list.length; k += perPile) out.push(list.slice(k, k + perPile));
  return out;
}

export function createShelf() {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#5a3519', boards: 2 }), roughness: 0.55 });
  const add = (geometry, material, x, y, z) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  // Korpus: Rückwand, Sockel, Böden, Seiten und Trennwände, Kranz oben
  add(box(SIZE.w, SIZE.h, 0.02), wood, 0, SIZE.h / 2, -SIZE.d / 2 + 0.01);
  add(box(SIZE.w, PLINTH, SIZE.d - 0.03), wood, 0, PLINTH / 2, -0.015);
  for (let k = 0; k <= ROWS; k++) add(box(SIZE.w, T, SIZE.d), wood, 0, PLINTH + k * (ROW_H + T) + T / 2, 0);
  for (const x of [...LEFT.map((l) => l - T / 2), SIZE.w / 2 - T / 2]) add(box(T, SIZE.h - PLINTH, SIZE.d), wood, x, (SIZE.h + PLINTH) / 2, 0);
  add(box(SIZE.w + 0.08, 0.05, SIZE.d + 0.05), wood, 0, SIZE.h + 0.025, 0.01);

  // eigenes warmes Licht von schräg oben, sonst liegt der Schrank im Schatten
  const lamp = new THREE.SpotLight(0xffd2a0, 9, 0, 0.75, 0.6, 2);
  lamp.position.set(0, 2.4, 1.5);
  lamp.target.position.set(0, 0.8, 0);
  group.add(lamp, lamp.target);

  const boxes = [];
  const sides = new Map(); // Seitenfarbe → Material (geteilt)
  SHELF.forEach((category, c) => {
    const left = LEFT[c];
    const [bw, bh, bd] = category.box;
    // eine Form je Kategorie; Etikett auf der letzten Fläche → nur zwei Zeichenaufrufe je Schachtel statt sechs
    const shape = box(bw, bh, bd).rotateY(Math.PI); // die Rückseite (−z, letzte Fläche) zeigt jetzt nach vorn
    shape.clearGroups();
    shape.addGroup(0, 30, 0);
    shape.addGroup(30, 6, 1);

    const plaque = add(new THREE.PlaneGeometry(0.3, 0.06), new THREE.MeshStandardMaterial({
      map: plaqueTexture(category.title), roughness: 0.35, metalness: 0.6,
    }), left + COL_W[c] / 2, SIZE.h + 0.025, SIZE.d / 2 + 0.036);
    plaque.castShadow = false;

    // Fächer von oben nach unten füllen, Stapel links beginnen
    split(category.games, ROWS).forEach((games, r) => {
      const floor = PLINTH + T + (ROWS - 1 - r) * (ROW_H + T);
      const stacks = piles(games, category.perPile);
      stacks.forEach((pile, p) => {
        pile.forEach((name, level) => {
          const index = SHELF.slice(0, c).reduce((n, s) => n + s.games.length, 0) + category.games.indexOf(name);
          const color = COLORS[index % COLORS.length];
          if (!sides.has(color)) sides.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
          const front = new THREE.MeshStandardMaterial({
            map: boxLabelTexture(name, category.title, color, PLAYABLE.has(name), bw / bh), roughness: 0.6,
          });
          const m = add(shape, [sides.get(color), front],
            left + 0.02 + bw / 2 + p * (bw + GAP), floor + bh * (level + 0.5), SIZE.d / 2 - 0.03 - bd / 2);
          m.rotation.y = (Math.random() - 0.5) * 0.04; // nicht ganz akkurat eingeräumt
          m.userData = { game: name, home: m.position.z };
          boxes.push(m);
        });
      });

      // Restplatz mit Büchern füllen
      const used = 0.02 + stacks.length * (bw + GAP);
      for (let x = left + used + 0.03; x < left + COL_W[c] - 0.06;) {
        const w = 0.025 + Math.random() * 0.03;
        const h = Math.min(0.2 + Math.random() * 0.12, ROW_H - 0.03);
        add(box(w, h, 0.2), new THREE.MeshStandardMaterial({
          color: BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)], roughness: 0.8,
        }), x + w / 2, floor + h / 2, SIZE.d / 2 - 0.13);
        x += w + 0.003;
      }
    });
  });

  let hover = null;
  let taken = null;

  return {
    group,
    // Schachtel unter dem Mauszeiger → Spielname oder null
    pick(raycaster) {
      const hit = raycaster.intersectObjects(boxes, false).find((h) => h.object.visible);
      return hit ? hit.object.userData.game : null;
    },
    hit(raycaster) {
      return raycaster.intersectObject(group, true).length > 0;
    },
    setHover(game) {
      if (game === hover) return;
      hover = game;
      setGlow('shelf', boxes.filter((b) => b.userData.game === game));
    },
    // Spiel liegt auf dem Tisch → Schachtel fehlt im Schrank
    setTaken(game) {
      taken = game;
      boxes.forEach((b) => (b.visible = b.userData.game !== taken));
    },
    update(dt) {
      const k = 1 - Math.exp(-dt * 12);
      for (const b of boxes) {
        const out = b.userData.game === hover ? PULL : 0;
        b.position.z += (b.userData.home + out - b.position.z) * k;
      }
    },
  };
}
