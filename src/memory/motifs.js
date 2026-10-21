// Memory-Bilder, selbst gezeichnet (Canvas) – keine Bilddateien. Drei Sätze zu je 24 Motiven (Namen in game.js):
// Tiere (Köpfe und kleine Tiere im Comic-Stil), Obst & Gemüse, Formen (8 Formen in Rot, Blau, Grün).
// Vorderseite: helles Kärtchen mit Rand, Motiv in der Mitte. Rückseite: Farbe folgt dem Kartenrücken (settings.js).
// Gezeichnet wird in Einheiten 0 … 100 (ganzes Kärtchen), dunkle Umrisse wie bei einem Kinder-Memory.
import { canvasTexture } from '../textures.js';

export const SIZE = 256; // Pixel je Seite
const INK = '#2a2118';
const PAPER = '#fbf6ea';
const TAU = Math.PI * 2;

// --- Zeichenhilfen (Einheiten 0 … 100) ---
function paint(g, fill, lw = 2.2) {
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (lw) {
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.lineJoin = g.lineCap = 'round';
    g.stroke();
  }
}
function circle(g, x, y, r, fill, lw) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  paint(g, fill, lw);
}
function oval(g, x, y, rx, ry, fill, lw, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  paint(g, fill, lw);
}
function poly(g, pts, fill, lw) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  paint(g, fill, lw);
}
// Pfad aus Befehlen: ['M', x, y], ['L', x, y], ['Q', cx, cy, x, y], ['C', c1x, c1y, c2x, c2y, x, y], ['Z']
function path(g, cmds, fill, lw) {
  g.beginPath();
  for (const [c, ...a] of cmds) {
    if (c === 'M') g.moveTo(...a);
    else if (c === 'L') g.lineTo(...a);
    else if (c === 'Q') g.quadraticCurveTo(...a);
    else if (c === 'C') g.bezierCurveTo(...a);
    else if (c === 'Z') g.closePath();
  }
  paint(g, fill, lw);
}
function line(g, pts, lw = 2.2, color = INK) {
  g.beginPath();
  pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineWidth = lw;
  g.strokeStyle = color;
  g.lineCap = g.lineJoin = 'round';
  g.stroke();
}
const dot = (g, x, y, r, fill = INK) => circle(g, x, y, r, fill, 0);
// Augenpaar mit Glanzpunkt
function eyes(g, x, y, dx, r = 3.2) {
  for (const s of [-1, 1]) {
    dot(g, x + s * dx, y, r);
    dot(g, x + s * dx + r * 0.35, y - r * 0.35, r * 0.35, '#fff');
  }
}
function smile(g, x, y, w, h = w * 0.5) {
  g.beginPath();
  g.moveTo(x - w, y);
  g.quadraticCurveTo(x, y + h * 2, x + w, y);
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.stroke();
}
function cheeks(g, x, y, dx, r = 3.4) {
  for (const s of [-1, 1]) circle(g, x + s * dx, y, r, 'rgba(240, 110, 120, 0.45)', 0);
}
// Stern mit n Zacken
function starPts(x, y, n, r1, r2, turn = -Math.PI / 2) {
  return Array.from({ length: 2 * n }, (_, k) => {
    const a = turn + (k * Math.PI) / n;
    const r = k % 2 ? r2 : r1;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r];
  });
}

// --- Tiere ---
const ANIMALS = [
  function katze(g) {
    for (const s of [-1, 1]) {
      poly(g, [[50 + s * 30, 42], [50 + s * 32, 14], [50 + s * 12, 30]], '#f0a64a');
      poly(g, [[50 + s * 27, 36], [50 + s * 29, 21], [50 + s * 17, 30]], '#f6c3c0', 0);
    }
    oval(g, 50, 55, 32, 28, '#f0a64a');
    for (const s of [-1, 1]) line(g, [[50 + s * 26, 46], [50 + s * 20, 49]], 2.4, '#b8661c');
    eyes(g, 50, 50, 11, 3.6);
    poly(g, [[46, 59], [54, 59], [50, 63]], '#e8737f', 1.6);
    line(g, [[50, 63], [50, 66]], 1.8);
    smile(g, 50, 66, 5, 1.2);
    for (const s of [-1, 1]) {
      line(g, [[50 + s * 10, 62], [50 + s * 30, 59]], 1.4);
      line(g, [[50 + s * 10, 65], [50 + s * 29, 67]], 1.4);
    }
  },
  function hund(g) {
    oval(g, 50, 52, 27, 30, '#c98b4f');
    for (const s of [-1, 1]) oval(g, 50 + s * 28, 52, 9, 20, '#6b4426', 2.2, s * 0.25);
    oval(g, 40, 44, 8, 9, '#f2e3c9', 0);
    eyes(g, 50, 45, 10, 3.4);
    oval(g, 50, 64, 15, 12, '#f2e3c9');
    oval(g, 50, 58, 6, 4.5, INK, 0);
    line(g, [[50, 62], [50, 67]], 1.8);
    smile(g, 50, 67, 6, 1.4);
    path(g, [['M', 46, 71], ['Q', 50, 80, 54, 71]], '#e8737f', 1.6);
  },
  function maus(g) {
    for (const s of [-1, 1]) {
      circle(g, 50 + s * 25, 30, 16, '#a9a9b2');
      circle(g, 50 + s * 25, 30, 10, '#f3b8bf', 0);
    }
    oval(g, 50, 56, 25, 24, '#a9a9b2');
    eyes(g, 50, 52, 9, 3.3);
    circle(g, 50, 64, 4.2, '#e8737f', 1.6);
    for (const s of [-1, 1]) {
      line(g, [[50 + s * 6, 66], [50 + s * 26, 62]], 1.4);
      line(g, [[50 + s * 6, 68], [50 + s * 25, 71]], 1.4);
    }
    smile(g, 50, 70, 4, 1);
  },
  function schwein(g) {
    for (const s of [-1, 1]) poly(g, [[50 + s * 14, 28], [50 + s * 32, 16], [50 + s * 30, 40]], '#f4a3b4');
    circle(g, 50, 54, 30, '#f7b8c5');
    eyes(g, 50, 45, 12, 3.2);
    oval(g, 50, 62, 13, 9, '#ef8fa4');
    oval(g, 45, 62, 2.4, 3.6, '#9b3c52', 0);
    oval(g, 55, 62, 2.4, 3.6, '#9b3c52', 0);
    cheeks(g, 50, 56, 22);
  },
  function baer(g) {
    for (const s of [-1, 1]) {
      circle(g, 50 + s * 24, 28, 11, '#8a5a32');
      circle(g, 50 + s * 24, 28, 6, '#c99a6b', 0);
    }
    circle(g, 50, 54, 29, '#8a5a32');
    eyes(g, 50, 47, 11, 3.4);
    oval(g, 50, 62, 13, 10, '#d9b48b');
    oval(g, 50, 57.5, 5.5, 4, INK, 0);
    line(g, [[50, 61], [50, 65]], 1.8);
    smile(g, 50, 65, 5, 1.3);
  },
  function fuchs(g) {
    for (const s of [-1, 1]) {
      poly(g, [[50 + s * 14, 30], [50 + s * 32, 10], [50 + s * 32, 38]], '#e8742a');
      poly(g, [[50 + s * 20, 30], [50 + s * 29, 18], [50 + s * 29, 34]], '#3a2418', 0);
    }
    path(g, [['M', 18, 36], ['Q', 50, 24, 82, 36], ['Q', 78, 58, 50, 84], ['Q', 22, 58, 18, 36], ['Z']], '#e8742a');
    path(g, [['M', 22, 50], ['Q', 40, 54, 50, 84], ['Q', 60, 54, 78, 50], ['Q', 72, 64, 50, 84], ['Q', 28, 64, 22, 50], ['Z']], '#fbf3e6', 0);
    path(g, [['M', 18, 36], ['Q', 50, 24, 82, 36], ['Q', 78, 58, 50, 84], ['Q', 22, 58, 18, 36], ['Z']], null);
    eyes(g, 50, 48, 12, 3.2);
    oval(g, 50, 79, 4.5, 3.5, INK, 0);
  },
  function hase(g) {
    for (const s of [-1, 1]) {
      oval(g, 50 + s * 12, 24, 8, 22, '#e9e4dc', 2.2, s * 0.12);
      oval(g, 50 + s * 12, 25, 4, 16, '#f3b8bf', 0, s * 0.12);
    }
    oval(g, 50, 60, 25, 23, '#e9e4dc');
    eyes(g, 50, 56, 10, 3.2);
    poly(g, [[46, 64], [54, 64], [50, 68]], '#e8737f', 1.6);
    line(g, [[50, 68], [50, 71]], 1.8);
    poly(g, [[46, 71], [54, 71], [54, 77], [46, 77]], '#fff', 1.6);
    line(g, [[50, 71], [50, 77]], 1.2);
    cheeks(g, 50, 66, 16);
  },
  function eule(g) {
    for (const s of [-1, 1]) poly(g, [[50 + s * 16, 26], [50 + s * 30, 12], [50 + s * 28, 32]], '#8b5e3c');
    oval(g, 50, 54, 30, 34, '#8b5e3c');
    oval(g, 50, 66, 18, 20, '#d9b48b', 0);
    for (const [x, y] of [[44, 62], [56, 62], [50, 70], [44, 76], [56, 76]]) path(g, [['M', x - 4, y], ['Q', x, y + 4, x + 4, y]], null, 1.4);
    for (const s of [-1, 1]) {
      circle(g, 50 + s * 12, 42, 11, '#fff');
      circle(g, 50 + s * 12, 42, 6, '#f2c014', 0);
      dot(g, 50 + s * 12, 42, 3.4);
      dot(g, 50 + s * 12 + 1.2, 40.8, 1.1, '#fff');
    }
    poly(g, [[46, 50], [54, 50], [50, 58]], '#f2a01b', 1.6);
  },
  function frosch(g) {
    for (const s of [-1, 1]) {
      circle(g, 50 + s * 17, 32, 12, '#5cb84a');
      circle(g, 50 + s * 17, 32, 7, '#fff', 1.6);
      dot(g, 50 + s * 17, 33, 3.6);
    }
    oval(g, 50, 58, 34, 24, '#5cb84a');
    path(g, [['M', 28, 58], ['Q', 50, 78, 72, 58]], null, 2.4);
    dot(g, 45, 48, 1.3);
    dot(g, 55, 48, 1.3);
    cheeks(g, 50, 60, 26);
  },
  function loewe(g) {
    poly(g, starPts(50, 52, 14, 40, 31), '#b5651d');
    circle(g, 50, 52, 26, '#f2c25c');
    for (const s of [-1, 1]) circle(g, 50 + s * 20, 32, 7, '#f2c25c');
    eyes(g, 50, 46, 10, 3.3);
    oval(g, 50, 62, 12, 9, '#fbe3a8', 0);
    poly(g, [[45, 56], [55, 56], [50, 61]], '#7a3f22', 1.4);
    line(g, [[50, 61], [50, 64]], 1.8);
    smile(g, 50, 64, 5, 1.2);
  },
  function panda(g) {
    for (const s of [-1, 1]) circle(g, 50 + s * 23, 28, 10, INK);
    circle(g, 50, 54, 30, '#fff');
    for (const s of [-1, 1]) oval(g, 50 + s * 12, 48, 7, 10, INK, 0, s * -0.5);
    for (const s of [-1, 1]) {
      dot(g, 50 + s * 12, 47, 2.6, '#fff');
      dot(g, 50 + s * 12, 47, 1.3);
    }
    oval(g, 50, 62, 5, 3.6, INK, 0);
    line(g, [[50, 65], [50, 68]], 1.8);
    smile(g, 50, 68, 5, 1.2);
  },
  function kuh(g) {
    for (const s of [-1, 1]) {
      path(g, [['M', 50 + s * 16, 26], ['Q', 50 + s * 30, 22, 50 + s * 32, 10], ['Q', 50 + s * 36, 26, 50 + s * 20, 34], ['Z']], '#f2e3c9');
      oval(g, 50 + s * 31, 40, 10, 5, '#fff', 2.2, s * 0.4);
    }
    oval(g, 50, 50, 24, 26, '#fff');
    path(g, [['M', 34, 32], ['Q', 46, 30, 44, 42], ['Q', 34, 46, 30, 38], ['Z']], INK, 0);
    oval(g, 64, 38, 6, 4, INK, 0);
    eyes(g, 50, 46, 10, 3.2);
    oval(g, 50, 66, 18, 12, '#f4a3b4');
    oval(g, 44, 66, 2.6, 3.6, '#9b3c52', 0);
    oval(g, 56, 66, 2.6, 3.6, '#9b3c52', 0);
  },
  function kueken(g) {
    for (const s of [-1, 1]) line(g, [[50 + s * 8, 78], [50 + s * 8, 86], [50 + s * 4, 89]], 2.4, '#f2a01b');
    for (const s of [-1, 1]) line(g, [[50 + s * 8, 86], [50 + s * 12, 89]], 2.4, '#f2a01b');
    circle(g, 50, 54, 27, '#ffd93b');
    path(g, [['M', 44, 28], ['Q', 46, 20, 50, 27], ['Q', 54, 20, 56, 28]], null, 2);
    path(g, [['M', 66, 58], ['Q', 80, 54, 74, 68], ['Q', 70, 66, 66, 58], ['Z']], '#f6c21b');
    eyes(g, 50, 48, 9, 3);
    poly(g, [[45, 55], [55, 55], [50, 62]], '#f2801b', 1.6);
    cheeks(g, 50, 58, 15, 3);
  },
  function pinguin(g) {
    for (const s of [-1, 1]) oval(g, 50 + s * 11, 86, 8, 4, '#f2a01b');
    oval(g, 50, 52, 27, 35, '#283040');
    oval(g, 50, 60, 18, 25, '#fff', 0);
    oval(g, 44, 40, 7, 9, '#fff', 0);
    oval(g, 56, 40, 7, 9, '#fff', 0);
    for (const s of [-1, 1]) oval(g, 50 + s * 26, 60, 6, 15, '#283040', 2.2, s * -0.3);
    eyes(g, 50, 40, 6, 2.6);
    poly(g, [[44, 47], [56, 47], [50, 54]], '#f2a01b', 1.6);
    cheeks(g, 50, 50, 13, 2.6);
  },
  function fisch(g) {
    poly(g, [[76, 50], [94, 34], [90, 50], [94, 66]], '#f2801b');
    path(g, [['M', 44, 32], ['Q', 52, 20, 62, 32]], '#f2801b');
    path(g, [['M', 10, 50], ['Q', 36, 22, 78, 50], ['Q', 36, 78, 10, 50], ['Z']], '#3f8fd8');
    for (const x of [44, 54, 64]) path(g, [['M', x, 38], ['Q', x - 6, 50, x, 62]], null, 1.6);
    circle(g, 25, 47, 5, '#fff', 1.6);
    dot(g, 26, 47, 2.6);
    path(g, [['M', 13, 54], ['Q', 17, 56, 20, 53]], null, 1.6);
  },
  function marienkaefer(g) {
    for (const [a, b] of [[[30, 64], [18, 70]], [[70, 64], [82, 70]], [[30, 48], [16, 46]], [[70, 48], [84, 46]], [[34, 76], [24, 86]], [[66, 76], [76, 86]]]) line(g, [a, b], 2.4);
    for (const s of [-1, 1]) line(g, [[50 + s * 6, 22], [50 + s * 14, 10]], 2);
    circle(g, 50, 28, 13, INK);
    eyes(g, 50, 26, 5, 2);
    for (const k of [0, 1]) dot(g, 44 + k * 12, 26, 1.4, '#fff');
    circle(g, 50, 58, 30, '#e0261c');
    line(g, [[50, 30], [50, 88]], 2.2);
    for (const [x, y, r] of [[37, 46, 6], [63, 46, 6], [33, 64, 5], [67, 64, 5], [42, 78, 4.5], [58, 78, 4.5]]) dot(g, x, y, r);
  },
  function schnecke(g) {
    path(g, [['M', 12, 78], ['L', 80, 78], ['Q', 90, 78, 88, 60], ['Q', 86, 48, 80, 52], ['L', 76, 70], ['L', 12, 74], ['Z']], '#b8d86a');
    for (const s of [0, 1]) {
      line(g, [[82 - s * 6, 52], [86 - s * 10, 36]], 2);
      dot(g, 86 - s * 10, 36, 3);
    }
    dot(g, 84, 60, 2.2);
    circle(g, 44, 50, 26, '#c98a4a');
    g.beginPath();
    for (let t = 0; t < 3.2 * Math.PI; t += 0.1) {
      const r = 2 + t * 2.1;
      const x = 44 + Math.cos(t) * r;
      const y = 50 + Math.sin(t) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineWidth = 2.4;
    g.strokeStyle = '#6b4426';
    g.stroke();
  },
  function biene(g) {
    for (const s of [-1, 1]) oval(g, 50 + s * 12, 28, 12, 17, 'rgba(190, 228, 255, 0.95)', 2, s * -0.5);
    poly(g, [[84, 56], [94, 58], [84, 60]], INK, 0);
    oval(g, 54, 58, 30, 21, '#ffd23b');
    g.save();
    g.beginPath();
    g.ellipse(54, 58, 30, 21, 0, 0, TAU);
    g.clip();
    g.fillStyle = INK;
    for (const x of [48, 62, 76]) g.fillRect(x, 30, 7, 60);
    g.restore();
    oval(g, 54, 58, 30, 21, null);
    circle(g, 24, 56, 13, INK);
    for (const s of [-1, 1]) {
      line(g, [[20 + s * 3, 44], [16 + s * 6, 32]], 1.8);
      dot(g, 16 + s * 6, 32, 2.2);
    }
    dot(g, 20, 54, 2.4, '#fff');
    dot(g, 20.6, 53.4, 1.2);
    path(g, [['M', 16, 61], ['Q', 19, 64, 22, 61]], null, 1.4);
  },
  function elefant(g) {
    for (const s of [-1, 1]) path(g, [['M', 50 + s * 14, 30], ['Q', 50 + s * 46, 16, 50 + s * 42, 50], ['Q', 50 + s * 38, 70, 50 + s * 16, 60], ['Z']], '#9aa3b0');
    for (const s of [-1, 1]) path(g, [['M', 50 + s * 18, 34], ['Q', 50 + s * 38, 26, 50 + s * 36, 50], ['Q', 50 + s * 32, 62, 50 + s * 18, 56], ['Z']], '#e9a7b4', 0);
    oval(g, 50, 44, 20, 22, '#9aa3b0');
    path(g, [['M', 43, 56], ['Q', 42, 74, 48, 84], ['Q', 54, 90, 58, 84], ['Q', 52, 78, 57, 56], ['Z']], '#9aa3b0');
    eyes(g, 50, 42, 9, 3);
    for (const y of [74, 79]) line(g, [[47, y], [52, y + 1]], 1.4);
    cheeks(g, 50, 52, 13, 3);
  },
  function affe(g) {
    for (const s of [-1, 1]) {
      circle(g, 50 + s * 29, 50, 10, '#8a5a32');
      circle(g, 50 + s * 29, 50, 5.5, '#e8c39a', 0);
    }
    circle(g, 50, 50, 27, '#8a5a32');
    path(g, [['M', 50, 44], ['Q', 40, 30, 32, 42], ['Q', 26, 54, 36, 62], ['Q', 34, 76, 50, 76], ['Q', 66, 76, 64, 62], ['Q', 74, 54, 68, 42], ['Q', 60, 30, 50, 44], ['Z']], '#e8c39a', 1.8);
    eyes(g, 50, 46, 8, 3);
    dot(g, 47, 58, 1.4);
    dot(g, 53, 58, 1.4);
    smile(g, 50, 64, 8, 2.2);
  },
  function schaf(g) {
    const puffs = Array.from({ length: 12 }, (_, k) => [50 + Math.cos((k / 12) * TAU) * 27, 52 + Math.sin((k / 12) * TAU) * 25]);
    for (const [x, y] of puffs) circle(g, x, y, 11, '#f7f4ee');
    circle(g, 50, 52, 26, '#f7f4ee', 0);
    for (const s of [-1, 1]) oval(g, 50 + s * 20, 46, 9, 5, '#4a3b33', 2, s * 0.5);
    oval(g, 50, 56, 15, 19, '#4a3b33');
    for (const s of [-1, 1]) {
      dot(g, 50 + s * 6, 52, 3, '#fff');
      dot(g, 50 + s * 6, 52, 1.6);
    }
    oval(g, 50, 66, 4, 2.6, '#e9a7b4', 0);
    for (const [x, y] of [[42, 34], [50, 31], [58, 34]]) circle(g, x, y, 6, '#f7f4ee', 1.6);
  },
  function igel(g) {
    path(g, [['M', 16, 72], ...starPts(52, 64, 13, 40, 28, Math.PI).filter(([, y]) => y <= 70).sort((a, b) => a[0] - b[0]).map(([x, y]) => ['L', x, y]), ['L', 88, 72], ['Z']], '#6b4426');
    path(g, [['M', 10, 70], ['Q', 18, 50, 40, 52], ['Q', 52, 58, 52, 72], ['Z']], '#e8c39a');
    dot(g, 10, 69, 3.4);
    eyes(g, 32, 60, 0, 2.6);
    for (const x of [26, 44, 62, 76]) oval(g, x, 75, 4, 3, '#e8c39a', 1.6);
  },
  function schildkroete(g) {
    for (const [x, y] of [[26, 72], [74, 72], [32, 46], [68, 46]]) oval(g, x, y, 8, 6, '#8cc35a');
    oval(g, 86, 60, 10, 8, '#8cc35a');
    eyes(g, 89, 57, 0, 2);
    path(g, [['M', 14, 66], ['Q', 18, 28, 50, 26], ['Q', 82, 28, 82, 66], ['Z']], '#3f8a3a');
    for (const [x, y] of [[50, 40], [36, 54], [64, 54], [50, 58]]) poly(g, Array.from({ length: 6 }, (_, k) => [x + Math.cos((k / 6) * TAU) * 7, y + Math.sin((k / 6) * TAU) * 7]), '#6cb04f', 1.6);
    line(g, [[14, 66], [82, 66]], 2.4);
  },
  function schmetterling(g) {
    for (const s of [-1, 1]) {
      path(g, [['M', 50, 48], ['Q', 50 + s * 20, 10, 50 + s * 40, 20], ['Q', 50 + s * 46, 40, 50, 52], ['Z']], '#9b5de5');
      path(g, [['M', 50, 54], ['Q', 50 + s * 40, 56, 50 + s * 32, 80], ['Q', 50 + s * 16, 88, 50, 58], ['Z']], '#f15bb5');
      circle(g, 50 + s * 26, 30, 5, '#fee440', 1.6);
      circle(g, 50 + s * 24, 68, 4, '#fee440', 1.6);
    }
    oval(g, 50, 54, 4.5, 22, '#3a2c28');
    for (const s of [-1, 1]) {
      line(g, [[50, 34], [50 + s * 10, 18]], 1.8);
      dot(g, 50 + s * 10, 18, 2.2);
    }
  },
];

// --- Obst & Gemüse ---
const LEAF = '#4caf50';
const PRODUCE = [
  function apfel(g) {
    path(g, [['M', 50, 34], ['C', 30, 22, 14, 40, 20, 60], ['C', 26, 84, 42, 88, 50, 82], ['C', 58, 88, 74, 84, 80, 60], ['C', 86, 40, 70, 22, 50, 34], ['Z']], '#e0261c');
    line(g, [[50, 34], [52, 18]], 3, '#6b4426');
    path(g, [['M', 53, 24], ['Q', 64, 10, 74, 18], ['Q', 64, 30, 53, 24], ['Z']], LEAF, 1.8);
    oval(g, 34, 48, 4, 8, 'rgba(255,255,255,0.55)', 0, 0.4);
  },
  function birne(g) {
    path(g, [['M', 50, 22], ['C', 40, 22, 40, 40, 34, 50], ['C', 20, 66, 30, 88, 50, 88], ['C', 70, 88, 80, 66, 66, 50], ['C', 60, 40, 60, 22, 50, 22], ['Z']], '#c5d84a');
    line(g, [[50, 22], [48, 10]], 3, '#6b4426');
    path(g, [['M', 50, 16], ['Q', 58, 6, 66, 12], ['Q', 58, 20, 50, 16], ['Z']], LEAF, 1.6);
    oval(g, 38, 64, 4, 8, 'rgba(255,255,255,0.5)', 0, 0.3);
  },
  function kirschen(g) {
    path(g, [['M', 32, 66], ['Q', 36, 36, 58, 16], ['Q', 62, 40, 68, 60]], null, 2.6);
    path(g, [['M', 58, 16], ['Q', 72, 10, 80, 22], ['Q', 66, 26, 58, 16], ['Z']], LEAF, 1.6);
    circle(g, 32, 70, 15, '#c1121f');
    circle(g, 68, 64, 15, '#c1121f');
    oval(g, 27, 65, 3, 5, 'rgba(255,255,255,0.6)', 0, 0.4);
    oval(g, 63, 59, 3, 5, 'rgba(255,255,255,0.6)', 0, 0.4);
  },
  function banane(g) {
    path(g, [['M', 18, 40], ['Q', 26, 84, 80, 72], ['Q', 88, 68, 84, 62], ['Q', 40, 70, 30, 34], ['Z']], '#ffd93b');
    path(g, [['M', 22, 44], ['Q', 34, 74, 78, 70]], null, 1.4);
    poly(g, [[18, 40], [30, 34], [28, 28], [20, 30]], '#8b6b2a', 1.8);
    dot(g, 84, 64, 2.4, '#5a4a2a');
  },
  function trauben(g) {
    line(g, [[50, 28], [52, 14]], 3, '#6b4426');
    path(g, [['M', 52, 20], ['Q', 66, 8, 78, 18], ['Q', 66, 30, 52, 20], ['Z']], LEAF, 1.6);
    const rows = [[36, 50, 64], [30, 43, 57, 70], [36, 50, 64], [43, 57], [50]];
    rows.forEach((xs, r) => xs.forEach((x) => circle(g, x, 34 + r * 12, 8, '#7b3fa0', 1.8)));
    rows.forEach((xs, r) => xs.forEach((x) => dot(g, x - 2.4, 31.6 + r * 12, 1.8, 'rgba(255,255,255,0.5)')));
  },
  function erdbeere(g) {
    path(g, [['M', 22, 36], ['Q', 50, 26, 78, 36], ['Q', 78, 64, 50, 88], ['Q', 22, 64, 22, 36], ['Z']], '#e5383b');
    for (const [x, y] of [[36, 46], [50, 44], [64, 46], [42, 58], [58, 58], [50, 70], [32, 56], [68, 56]]) oval(g, x, y, 1.6, 2.4, '#ffe08a', 0);
    poly(g, starPts(50, 32, 6, 16, 6), LEAF, 1.8);
  },
  function zitrone(g) {
    path(g, [['M', 12, 52], ['Q', 18, 44, 24, 42], ['Q', 50, 18, 76, 42], ['Q', 82, 44, 88, 52], ['Q', 82, 60, 76, 62], ['Q', 50, 86, 24, 62], ['Q', 18, 60, 12, 52], ['Z']], '#fde047');
    oval(g, 40, 44, 8, 3.5, 'rgba(255,255,255,0.6)', 0, -0.3);
    for (const [x, y] of [[56, 58], [62, 50], [46, 62]]) dot(g, x, y, 1, '#c9a50a');
  },
  function orange(g) {
    circle(g, 50, 56, 30, '#f7931e');
    for (const [x, y] of [[40, 48], [58, 46], [64, 62], [44, 68], [52, 58], [34, 60]]) dot(g, x, y, 1.1, '#c96a0a');
    dot(g, 50, 27, 3, '#6b4426');
    path(g, [['M', 50, 27], ['Q', 64, 12, 76, 22], ['Q', 64, 32, 50, 27], ['Z']], LEAF, 1.6);
    oval(g, 36, 44, 4, 7, 'rgba(255,255,255,0.45)', 0, 0.5);
  },
  function wassermelone(g) {
    path(g, [['M', 10, 36], ['L', 90, 36], ['Q', 86, 82, 50, 84], ['Q', 14, 82, 10, 36], ['Z']], '#2f9e44');
    path(g, [['M', 16, 36], ['L', 84, 36], ['Q', 80, 74, 50, 76], ['Q', 20, 74, 16, 36], ['Z']], '#f1f8e0', 0);
    path(g, [['M', 20, 36], ['L', 80, 36], ['Q', 76, 70, 50, 71], ['Q', 24, 70, 20, 36], ['Z']], '#f03e3e', 0);
    line(g, [[10, 36], [90, 36]], 2.2);
    for (const [x, y] of [[34, 46], [50, 50], [66, 46], [42, 60], [58, 60], [50, 40]]) oval(g, x, y, 1.6, 2.8, INK, 0);
  },
  function ananas(g) {
    for (const [a, h] of [[-0.5, 22], [-0.2, 28], [0.15, 30], [0.5, 22]]) {
      g.save();
      g.translate(50, 38);
      g.rotate(a);
      path(g, [['M', -5, 0], ['Q', -4, -h * 0.6, 0, -h], ['Q', 4, -h * 0.6, 5, 0], ['Z']], LEAF, 1.6);
      g.restore();
    }
    oval(g, 50, 62, 22, 27, '#f2b632');
    g.save();
    g.beginPath();
    g.ellipse(50, 62, 22, 27, 0, 0, TAU);
    g.clip();
    for (let d = -60; d < 60; d += 9) {
      line(g, [[50 + d - 30, 30], [50 + d + 30, 94]], 1.2, '#a8701a');
      line(g, [[50 + d + 30, 30], [50 + d - 30, 94]], 1.2, '#a8701a');
    }
    g.restore();
    oval(g, 50, 62, 22, 27, null);
  },
  function karotte(g) {
    for (const a of [-0.45, 0, 0.45]) {
      g.save();
      g.translate(62, 30);
      g.rotate(a + 0.6);
      path(g, [['M', -4, 0], ['Q', -3, -14, 0, -22], ['Q', 3, -14, 4, 0], ['Z']], LEAF, 1.6);
      g.restore();
    }
    path(g, [['M', 52, 22], ['Q', 72, 22, 72, 40], ['L', 24, 86], ['Q', 20, 88, 22, 82], ['Z']], '#f77f00');
    for (const [a, b] of [[[52, 40], [58, 44]], [[44, 52], [50, 56]], [[36, 64], [42, 68]]]) line(g, [a, b], 1.6, '#b85a00');
  },
  function pilz(g) {
    path(g, [['M', 40, 52], ['Q', 36, 80, 42, 86], ['L', 58, 86], ['Q', 64, 80, 60, 52], ['Z']], '#f4ead2');
    path(g, [['M', 12, 54], ['Q', 14, 18, 50, 16], ['Q', 86, 18, 88, 54], ['Q', 50, 62, 12, 54], ['Z']], '#e0261c');
    for (const [x, y, r] of [[30, 38, 5], [50, 28, 6], [70, 38, 5], [42, 48, 3.4], [62, 48, 3.4]]) circle(g, x, y, r, '#fff', 0);
  },
  function tomate(g) {
    oval(g, 50, 58, 34, 27, '#f0432a');
    path(g, [['M', 40, 40], ['Q', 50, 46, 60, 40]], null, 1.4);
    poly(g, starPts(50, 36, 5, 14, 5), '#2f9e44', 1.6);
    line(g, [[50, 36], [52, 26]], 3, '#2f9e44');
    oval(g, 32, 52, 4, 7, 'rgba(255,255,255,0.5)', 0, 0.4);
  },
  function paprika(g) {
    path(g, [['M', 50, 32], ['C', 36, 24, 18, 30, 22, 54], ['C', 24, 76, 36, 88, 44, 84], ['Q', 50, 80, 56, 84], ['C', 64, 88, 76, 76, 78, 54], ['C', 82, 30, 64, 24, 50, 32], ['Z']], '#2f9e44');
    path(g, [['M', 50, 34], ['Q', 46, 60, 50, 80]], null, 1.4);
    path(g, [['M', 44, 30], ['Q', 50, 24, 56, 30], ['Q', 50, 34, 44, 30], ['Z']], '#1b6e2d', 1.6);
    path(g, [['M', 50, 28], ['Q', 50, 18, 58, 12]], null, 3.2);
    oval(g, 32, 50, 3.5, 9, 'rgba(255,255,255,0.45)', 0, 0.2);
  },
  function pflaume(g) {
    oval(g, 50, 58, 25, 29, '#5b3c8c', 2.2, 0.25);
    path(g, [['M', 52, 32], ['Q', 40, 56, 50, 86]], null, 1.6);
    line(g, [[52, 32], [56, 18]], 3, '#6b4426');
    oval(g, 38, 50, 3.5, 8, 'rgba(255,255,255,0.4)', 0, 0.3);
  },
  function kiwi(g) {
    circle(g, 50, 52, 34, '#8b6b2a');
    circle(g, 50, 52, 29, '#8cc63f', 0);
    circle(g, 50, 52, 10, '#f4f1d0', 0);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU;
      oval(g, 50 + Math.cos(a) * 15, 52 + Math.sin(a) * 15, 1.4, 2.6, INK, 0, a + Math.PI / 2);
    }
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU + 0.2;
      line(g, [[50 + Math.cos(a) * 18, 52 + Math.sin(a) * 18], [50 + Math.cos(a) * 26, 52 + Math.sin(a) * 26]], 1, 'rgba(244, 241, 208, 0.7)');
    }
  },
  function mais(g) {
    path(g, [['M', 50, 18], ['Q', 66, 30, 64, 58], ['Q', 62, 76, 50, 82], ['Q', 38, 76, 36, 58], ['Q', 34, 30, 50, 18], ['Z']], '#ffd23b');
    for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) oval(g, 43 + c * 7, 28 + r * 7.4, 3, 3.2, '#f2b632', 1);
    path(g, [['M', 50, 90], ['Q', 18, 80, 22, 40], ['Q', 34, 70, 48, 78], ['Z']], LEAF, 1.8);
    path(g, [['M', 50, 90], ['Q', 82, 80, 78, 40], ['Q', 66, 70, 52, 78], ['Z']], '#66bb6a', 1.8);
  },
  function aubergine(g) {
    path(g, [['M', 58, 26], ['C', 84, 30, 82, 60, 66, 76], ['C', 50, 92, 20, 90, 22, 72], ['C', 24, 58, 44, 56, 46, 40], ['Q', 48, 28, 58, 26], ['Z']], '#5a2a82');
    path(g, [['M', 44, 34], ['Q', 52, 20, 70, 30], ['Q', 62, 38, 56, 34], ['Q', 50, 40, 44, 34], ['Z']], '#2f9e44', 1.8);
    line(g, [[60, 26], [66, 12]], 3.2, '#2f9e44');
    oval(g, 34, 72, 3, 8, 'rgba(255,255,255,0.35)', 0, 0.9);
  },
  function brokkoli(g) {
    path(g, [['M', 42, 56], ['L', 38, 88], ['L', 62, 88], ['L', 58, 56], ['Z']], '#9ccc65');
    for (const [x, y, r] of [[30, 48, 13], [50, 40, 15], [70, 48, 13], [40, 30, 12], [60, 30, 12], [50, 56, 12]]) circle(g, x, y, r, '#2e7d32');
    for (const [x, y] of [[30, 46], [50, 38], [70, 46], [40, 28], [60, 28]]) dot(g, x - 3, y - 2, 1.8, '#4caf50');
  },
  function avocado(g) {
    path(g, [['M', 50, 12], ['C', 66, 12, 70, 40, 78, 58], ['C', 86, 82, 66, 92, 50, 92], ['C', 34, 92, 14, 82, 22, 58], ['C', 30, 40, 34, 12, 50, 12], ['Z']], '#33691e');
    path(g, [['M', 50, 18], ['C', 62, 18, 64, 42, 72, 58], ['C', 78, 78, 64, 86, 50, 86], ['C', 36, 86, 22, 78, 28, 58], ['C', 36, 42, 38, 18, 50, 18], ['Z']], '#dcedc8', 0);
    circle(g, 50, 62, 15, '#8d5a2b');
    oval(g, 45, 57, 3, 5, 'rgba(255,255,255,0.4)', 0, 0.5);
  },
  function zwiebel(g) {
    path(g, [['M', 50, 22], ['Q', 54, 36, 70, 44], ['Q', 86, 56, 76, 74], ['Q', 66, 88, 50, 88], ['Q', 34, 88, 24, 74], ['Q', 14, 56, 30, 44], ['Q', 46, 36, 50, 22], ['Z']], '#d9a066');
    for (const d of [-12, 0, 12]) path(g, [['M', 50 + d * 0.3, 32], ['Q', 50 + d * 2, 60, 50 + d * 0.8, 86]], null, 1.3);
    line(g, [[50, 22], [48, 10]], 2.4, '#8b6b2a');
    line(g, [[44, 88], [42, 94]], 1.4);
    line(g, [[50, 88], [50, 95]], 1.4);
    line(g, [[56, 88], [58, 94]], 1.4);
  },
  function erbsen(g) {
    g.save();
    g.translate(50, 52);
    g.rotate(-0.55);
    path(g, [['M', -40, 0], ['Q', -36, -16, 0, -16], ['Q', 36, -16, 42, -2], ['Q', 36, 14, 0, 14], ['Q', -36, 14, -40, 0], ['Z']], '#7cb342');
    path(g, [['M', -32, 0], ['Q', 0, -9, 34, -2], ['Q', 0, 8, -32, 0], ['Z']], '#c5e1a5', 0);
    for (const x of [-22, -8, 6, 20]) circle(g, x, -1, 6.5, '#8bc34a', 1.6);
    path(g, [['M', -40, 0], ['Q', -48, -2, -50, -10]], null, 2.2);
    g.restore();
  },
  function radieschen(g) {
    for (const a of [-0.5, 0, 0.5]) {
      g.save();
      g.translate(50, 40);
      g.rotate(a);
      path(g, [['M', 0, 0], ['Q', -10, -14, 0, -28], ['Q', 10, -14, 0, 0], ['Z']], LEAF, 1.6);
      g.restore();
    }
    circle(g, 50, 58, 20, '#e63973');
    path(g, [['M', 42, 74], ['Q', 50, 82, 58, 74], ['Q', 52, 80, 50, 92], ['Q', 48, 80, 42, 74], ['Z']], '#fff', 1.6);
    oval(g, 42, 52, 3, 6, 'rgba(255,255,255,0.5)', 0, 0.4);
  },
  function kuerbis(g) {
    for (const [x, rx] of [[30, 18], [70, 18], [42, 18], [58, 18], [50, 16]]) oval(g, x, 58, rx, 26, '#f57c00', 2);
    path(g, [['M', 48, 34], ['Q', 46, 22, 52, 16], ['L', 56, 18], ['Q', 52, 24, 54, 34], ['Z']], '#6b4426', 1.8);
    path(g, [['M', 56, 22], ['Q', 70, 14, 76, 26], ['Q', 64, 30, 56, 22], ['Z']], LEAF, 1.6);
  },
];

// --- Formen: 8 Formen in Rot, Blau, Grün (Reihenfolge wie die Namen in game.js) ---
const COLORS = ['#d62828', '#1d4ed8', '#16843f'];
const SHAPES = [
  (g, c) => circle(g, 50, 52, 30, c, 3),
  (g, c) => poly(g, [[22, 24], [78, 24], [78, 80], [22, 80]], c, 3),
  (g, c) => poly(g, [[50, 16], [86, 82], [14, 82]], c, 3),
  (g, c) => poly(g, starPts(50, 54, 5, 38, 16), c, 3),
  (g, c) => path(g, [['M', 50, 84], ['C', 22, 64, 10, 46, 18, 32], ['C', 26, 16, 46, 18, 50, 34], ['C', 54, 18, 74, 16, 82, 32], ['C', 90, 46, 78, 64, 50, 84], ['Z']], c, 3),
  (g, c) => poly(g, [[50, 12], [80, 52], [50, 92], [20, 52]], c, 3),
  (g, c) => path(g, [['M', 60, 14], ['C', 26, 18, 18, 70, 46, 86], ['C', 62, 94, 80, 86, 86, 74], ['C', 56, 80, 40, 56, 48, 34], ['C', 52, 24, 56, 18, 60, 14], ['Z']], c, 3),
  (g, c) => path(g, [['M', 50, 12], ['C', 58, 30, 76, 46, 76, 62], ['C', 76, 78, 64, 88, 50, 88], ['C', 36, 88, 24, 78, 24, 62], ['C', 24, 46, 42, 30, 50, 12], ['Z']], c, 3),
];
const FORMS = SHAPES.flatMap((shape) => COLORS.map((c) => (g) => {
  shape(g, c);
  // Glanz, damit die Formen nicht ganz flach wirken
  g.save();
  g.globalAlpha = 0.25;
  oval(g, 38, 38, 7, 4, '#fff', 0, -0.6);
  g.restore();
}));

const DRAW = { tiere: ANIMALS, obst: PRODUCE, formen: FORMS };

// Vorderseite: Papier, schmaler Rand, Motiv
function drawFace(g, w, set, m) {
  g.fillStyle = PAPER;
  g.fillRect(0, 0, w, w);
  g.save();
  g.scale(w / 100, w / 100);
  g.lineWidth = 1.6;
  g.strokeStyle = 'rgba(42, 33, 24, 0.35)';
  g.beginPath();
  g.roundRect(4, 4, 92, 92, 7);
  g.stroke();
  // Motiv etwas kleiner, damit es nicht an den Rand stößt
  g.translate(50, 50);
  g.scale(0.86, 0.86);
  g.translate(-50, -50);
  DRAW[set][m](g);
  g.restore();
}

const faces = new Map();
export function motifTexture(set, m) {
  const key = `${set}-${m}`;
  if (!faces.has(key)) faces.set(key, canvasTexture(SIZE, SIZE, (g, w) => drawFace(g, w, set, m)));
  return faces.get(key);
}

// Für Bilder außerhalb von three.js (z. B. Seitenfeld): Motiv auf ein Canvas zeichnen
export function paintMotif(canvas, set, m) {
  drawFace(canvas.getContext('2d'), canvas.width, set, m);
}

// --- Rückseite: Farbe wie der Kartenrücken (rot, blau, grün), Punktmuster und eine Blüte in der Mitte ---
const BACKS = { rot: ['#8e1c24', '#6a1219'], blau: ['#20407a', '#152c58'], gruen: ['#1f5c3c', '#143f29'] };
let backColors = BACKS.rot;
let back = null;

function drawBack(g, w) {
  g.save();
  g.scale(w / 100, w / 100);
  g.fillStyle = '#f4ecd8';
  g.fillRect(0, 0, 100, 100);
  g.beginPath();
  g.roundRect(4, 4, 92, 92, 7);
  g.fillStyle = backColors[0];
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255, 226, 170, 0.2)';
  for (let y = 0; y < 100; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < 100; x += 10) dot(g, x, y, 1.6, 'rgba(255, 226, 170, 0.22)');
  g.restore();
  circle(g, 50, 50, 22, backColors[1], 0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    oval(g, 50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12, 8, 4.2, '#e0b04a', 0, a);
  }
  circle(g, 50, 50, 6, backColors[1], 0);
  circle(g, 50, 50, 3.2, '#e0b04a', 0);
  g.lineWidth = 1.2;
  g.strokeStyle = '#e0b04a';
  g.beginPath();
  g.roundRect(9, 9, 82, 82, 4);
  g.stroke();
  g.restore();
}

export function tileBack() {
  back ??= canvasTexture(SIZE, SIZE, (g, w) => drawBack(g, w));
  return back;
}

// Andere Rückseiten-Farbe: dieselbe Textur neu zeichnen – alle verdeckten Kärtchen ändern sich mit
export function setTileBack(name) {
  backColors = BACKS[name] ?? BACKS.rot;
  const tex = tileBack();
  drawBack(tex.image.getContext('2d'), tex.image.width);
  tex.needsUpdate = true;
}
