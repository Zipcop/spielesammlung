// Kartenbilder für das französische Blatt, selbst gezeichnet (Canvas) – keine Bilddateien.
// Vorderseite: Wert + Farbzeichen in zwei Ecken, Augen für 2–10, großes Ass, Bildkarten B/D/K
// doppelköpfig wie echte Karten (von beiden Seiten lesbar), Joker (rot/schwarz) mit Narrenkopf. Dazu Rückseite und Wunsch-Chip.
import { canvasTexture } from '../textures.js';
import { suitOf, rankOf, isCard, isJoker } from './cards.js';

export const FACE = { w: 400, h: 560 }; // Seitenverhältnis wie eine Poker-Karte (63 × 88 mm)
const RED = '#c0182a';
const BLACK = '#1b1b1b';
const GOLD = '#e0a82e';
const BLUE = '#1f3f8f';
const inkOf = (suit) => (suit === 'h' || suit === 'd' ? RED : BLACK);
const INDEX = { T: '10', J: 'B', Q: 'D', K: 'K', A: 'A' }; // deutsche Eckzeichen: Bube, Dame, König, Ass

// Farbzeichen im Einheitsquadrat (−0,5 … 0,5), alle Teilformen im Uhrzeigersinn (sonst Löcher beim Füllen)
const SHAPES = {
  h(g) {
    g.moveTo(0, 0.5);
    g.bezierCurveTo(-0.15, 0.35, -0.5, 0.1, -0.5, -0.17);
    g.bezierCurveTo(-0.5, -0.38, -0.36, -0.5, -0.24, -0.5);
    g.bezierCurveTo(-0.1, -0.5, 0, -0.4, 0, -0.28);
    g.bezierCurveTo(0, -0.4, 0.1, -0.5, 0.24, -0.5);
    g.bezierCurveTo(0.36, -0.5, 0.5, -0.38, 0.5, -0.17);
    g.bezierCurveTo(0.5, 0.1, 0.15, 0.35, 0, 0.5);
  },
  d(g) {
    g.moveTo(0, -0.5);
    g.quadraticCurveTo(0.17, -0.2, 0.38, 0);
    g.quadraticCurveTo(0.17, 0.2, 0, 0.5);
    g.quadraticCurveTo(-0.17, 0.2, -0.38, 0);
    g.quadraticCurveTo(-0.17, -0.2, 0, -0.5);
  },
  s(g) {
    g.moveTo(0, -0.5);
    g.bezierCurveTo(0.12, -0.32, 0.5, -0.12, 0.5, 0.1);
    g.bezierCurveTo(0.5, 0.28, 0.36, 0.36, 0.24, 0.36);
    g.bezierCurveTo(0.14, 0.36, 0.07, 0.31, 0.04, 0.24);
    g.quadraticCurveTo(0.06, 0.42, 0.2, 0.5);
    g.lineTo(-0.2, 0.5);
    g.quadraticCurveTo(-0.06, 0.42, -0.04, 0.24);
    g.bezierCurveTo(-0.07, 0.31, -0.14, 0.36, -0.24, 0.36);
    g.bezierCurveTo(-0.36, 0.36, -0.5, 0.28, -0.5, 0.1);
    g.bezierCurveTo(-0.5, -0.12, -0.12, -0.32, 0, -0.5);
  },
  c(g) {
    for (const [x, y, r] of [[0, -0.27, 0.21], [-0.25, 0.07, 0.21], [0.25, 0.07, 0.21], [0, 0.02, 0.1]]) {
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
    g.moveTo(0.04, 0.1);
    g.quadraticCurveTo(0.05, 0.4, 0.2, 0.5);
    g.lineTo(-0.2, 0.5);
    g.quadraticCurveTo(-0.05, 0.4, -0.04, 0.1);
    g.closePath();
  },
};

// Farbzeichen zeichnen: Mitte (x, y), Größe in Pixeln, flip = auf dem Kopf (untere Kartenhälfte)
export function drawSuit(g, suit, x, y, size, flip = false) {
  g.save();
  g.translate(x, y);
  if (flip) g.rotate(Math.PI);
  g.scale(size, size);
  g.beginPath();
  SHAPES[suit](g);
  g.fill();
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

// Schmaler schwarzer Rand ringsum (Nico 20.10.2026): weiß auf weiß verschwammen übereinanderliegende Karten.
// Die Ecken folgen der Kartenform (Radius 3,5 mm = 22 Pixel, cards3d.js).
function frame(g, w, h) {
  const width = 8; // ≈ 1,3 mm
  g.strokeStyle = BLACK;
  g.lineWidth = width;
  roundRect(g, width / 2, width / 2, w - width, h - width, 22 - width / 2);
  g.stroke();
}

// Augen-Bilder 2–10: Spalte (0 links, 1 Mitte, 2 rechts) und Zeile (0 oben … 1 unten)
const R4 = [0, 1 / 3, 2 / 3, 1];
const PIPS = {
  2: [[1, 0], [1, 1]],
  3: [[1, 0], [1, 0.5], [1, 1]],
  4: [[0, 0], [2, 0], [0, 1], [2, 1]],
  5: [[0, 0], [2, 0], [1, 0.5], [0, 1], [2, 1]],
  6: [[0, 0], [2, 0], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  7: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [0, 1], [2, 1]],
  8: [[0, 0], [2, 0], [1, 0.25], [0, 0.5], [2, 0.5], [1, 0.75], [0, 1], [2, 1]],
  9: [...R4.flatMap((y) => [[0, y], [2, y]]), [1, 0.5]],
  T: [...R4.flatMap((y) => [[0, y], [2, y]]), [1, 1 / 6], [1, 5 / 6]],
};

const cache = new Map();

// Vorderseite einer Karte (wird beim ersten Mal gezeichnet und dann wiederverwendet)
export function cardFace(card) {
  if (!isCard(card) && !isJoker(card)) return cardBack();
  if (!cache.has(card)) cache.set(card, canvasTexture(FACE.w, FACE.h, (g, w, h) => (isJoker(card) ? drawJoker(g, card, w, h) : drawFace(g, card, w, h))));
  return cache.get(card);
}

// Joker: „JOKER“ senkrecht in zwei Ecken, in der Mitte ein Narr mit Schellenkappe – rot/gold/blau oder schwarz/gold/grau
function drawJoker(g, card, w, h) {
  const ink = card === 'xr' ? RED : BLACK;
  const [capA, capB] = card === 'xr' ? [RED, BLUE] : [BLACK, '#6d6d6d'];
  g.fillStyle = '#fbf8f1';
  g.fillRect(0, 0, w, h);
  frame(g, w, h);
  for (const flip of [false, true]) {
    g.save();
    if (flip) {
      g.translate(w, h);
      g.rotate(Math.PI);
    }
    g.fillStyle = ink;
    g.font = 'bold 40px Georgia, serif';
    g.textAlign = 'center';
    [...'JOKER'].forEach((ch, i) => g.fillText(ch, 40, 62 + i * 40));
    g.restore();
  }

  const cx = w / 2;
  const cy = h / 2 + 30;
  const line = (width = 3) => {
    g.strokeStyle = BLACK;
    g.lineWidth = width;
    g.stroke();
  };
  // Halskrause aus Zacken
  g.beginPath();
  for (let k = 0; k <= 12; k++) {
    const a = Math.PI * (k / 12);
    const r = k % 2 ? 70 : 96;
    g.lineTo(cx + Math.cos(a) * r * 1.25, cy + 62 + Math.sin(a) * r * 0.45);
  }
  g.closePath();
  g.fillStyle = GOLD;
  g.fill();
  line();
  // Gesicht
  g.beginPath();
  g.ellipse(cx, cy, 58, 70, 0, 0, Math.PI * 2);
  g.fillStyle = '#f5d3ad';
  g.fill();
  line();
  g.fillStyle = BLACK;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(cx + s * 22, cy - 12, 6, 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#e07a7a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(cx + s * 34, cy + 16, 10, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(cx, cy + 18, 26, 0.15 * Math.PI, 0.85 * Math.PI);
  g.strokeStyle = '#b3261e';
  g.lineWidth = 5;
  g.stroke();
  // Schellenkappe: drei Zipfel mit Glöckchen, abwechselnd zwei Farben
  const tips = [[cx - 120, cy - 120], [cx, cy - 190], [cx + 120, cy - 120]];
  tips.forEach(([x, y], i) => {
    g.beginPath();
    g.moveTo(cx - 62 + i * 41, cy - 48);
    g.quadraticCurveTo((x + cx) / 2 - 10, (y + cy) / 2 - 40, x, y);
    g.quadraticCurveTo((x + cx) / 2 + 30, (y + cy) / 2, cx - 62 + (i + 1) * 41, cy - 48);
    g.closePath();
    g.fillStyle = i % 2 ? capB : capA;
    g.fill();
    line();
    g.beginPath();
    g.arc(x, y, 13, 0, Math.PI * 2);
    g.fillStyle = GOLD;
    g.fill();
    line(2);
  });
  // Kappenrand
  g.beginPath();
  g.ellipse(cx, cy - 50, 66, 16, 0, 0, Math.PI * 2);
  g.fillStyle = GOLD;
  g.fill();
  line();
}

function drawFace(g, card, w, h) {
  const suit = suitOf(card);
  const rank = rankOf(card);
  const ink = inkOf(suit);
  g.fillStyle = '#fbf8f1';
  g.fillRect(0, 0, w, h);
  frame(g, w, h);

  // Ecken: oben links und (gedreht) unten rechts
  for (const flip of [false, true]) {
    g.save();
    if (flip) {
      g.translate(w, h);
      g.rotate(Math.PI);
    }
    g.fillStyle = ink;
    g.font = 'bold 66px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const text = INDEX[rank] ?? rank;
    g.save();
    g.translate(44, 78);
    if (text.length > 1) g.scale(0.72, 1); // „10“ schmaler, damit es in die Ecke passt
    g.fillText(text, 0, 0);
    g.restore();
    drawSuit(g, suit, 44, 112, 40);
    g.restore();
  }

  g.fillStyle = ink;
  if (PIPS[rank]) {
    const cols = [w * 0.3, w * 0.5, w * 0.7];
    const [top, bottom] = [h * 0.2, h * 0.8];
    for (const [col, row] of PIPS[rank]) drawSuit(g, suit, cols[col], top + row * (bottom - top), 74, row > 0.5);
  } else if (rank === 'A') {
    drawSuit(g, suit, w / 2, h / 2, 190);
  } else {
    drawCourt(g, suit, rank, w, h);
  }
}

// Bildkarte: Rahmen, obere Hälfte mit Figur, dieselbe Figur um 180° gedreht unten
function drawCourt(g, suit, rank, w, h) {
  const frame = { x: w * 0.19, y: h * 0.125, w: w * 0.62, h: h * 0.75 };
  const [robe, panel] = inkOf(suit) === RED ? [RED, BLUE] : [BLUE, RED];

  g.fillStyle = '#fbf0d8';
  g.fillRect(frame.x, frame.y, frame.w, frame.h);
  g.save();
  g.beginPath();
  g.rect(frame.x, frame.y, frame.w, frame.h);
  g.clip();
  for (const flip of [false, true]) {
    g.save();
    if (flip) {
      g.translate(w, h);
      g.rotate(Math.PI);
    }
    figure(g, { x: frame.x, y: frame.y, w: frame.w, h: frame.h / 2 }, suit, rank, robe, panel);
    g.restore();
  }
  g.restore();

  // Mittellinie und doppelter Rahmen
  g.strokeStyle = GOLD;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(frame.x, h / 2);
  g.lineTo(frame.x + frame.w, h / 2);
  g.stroke();
  g.strokeStyle = inkOf(suit);
  g.lineWidth = 3;
  g.strokeRect(frame.x, frame.y, frame.w, frame.h);
  g.strokeStyle = GOLD;
  g.lineWidth = 2;
  g.strokeRect(frame.x + 6, frame.y + 6, frame.w - 12, frame.h - 12);
}

// Halbe Figur im Bereich b (oben = Kopf, unten = Mittellinie). u, v = Anteile 0–1 in b.
function figure(g, b, suit, rank, robe, panel) {
  const X = (u) => b.x + u * b.w;
  const Y = (v) => b.y + v * b.h;
  const outline = () => {
    g.strokeStyle = BLACK;
    g.lineWidth = 2.5;
    g.stroke();
  };
  const shape = (pts, fill) => {
    g.beginPath();
    pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v))));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    outline();
  };

  // Gewand mit Schultern, Mittelbahn und goldenem Saum
  g.beginPath();
  g.moveTo(X(0.06), Y(1.02));
  g.lineTo(X(0.06), Y(0.8));
  g.quadraticCurveTo(X(0.1), Y(0.62), X(0.33), Y(0.6));
  g.lineTo(X(0.67), Y(0.6));
  g.quadraticCurveTo(X(0.9), Y(0.62), X(0.94), Y(0.8));
  g.lineTo(X(0.94), Y(1.02));
  g.closePath();
  g.fillStyle = robe;
  g.fill();
  outline();
  shape([[0.4, 0.62], [0.6, 0.62], [0.64, 1.02], [0.36, 1.02]], panel);
  g.fillStyle = GOLD;
  for (let v = 0.7; v < 1; v += 0.1) {
    g.beginPath();
    g.arc(X(0.5), Y(v), 4, 0, Math.PI * 2);
    g.fill();
  }
  shape([[0.06, 0.86], [0.36, 0.86], [0.36, 0.9], [0.06, 0.9]], GOLD);
  shape([[0.64, 0.86], [0.94, 0.86], [0.94, 0.9], [0.64, 0.9]], GOLD);

  // Beigabe: König Zepter, Dame Blume, Bube Hellebarde
  g.lineWidth = 5;
  g.strokeStyle = BLACK;
  if (rank === 'K') {
    g.beginPath();
    g.moveTo(X(0.18), Y(1));
    g.lineTo(X(0.18), Y(0.3));
    g.stroke();
    g.fillStyle = GOLD;
    g.beginPath();
    g.arc(X(0.18), Y(0.27), 9, 0, Math.PI * 2);
    g.fill();
    outline();
  } else if (rank === 'Q') {
    g.beginPath();
    g.moveTo(X(0.8), Y(1));
    g.quadraticCurveTo(X(0.86), Y(0.75), X(0.8), Y(0.55));
    g.strokeStyle = '#2f6b2f';
    g.stroke();
    g.fillStyle = RED;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(X(0.8) + Math.cos(a) * 9, Y(0.5) + Math.sin(a) * 9, 8, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = GOLD;
    g.beginPath();
    g.arc(X(0.8), Y(0.5), 6, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(X(0.82), Y(1));
    g.lineTo(X(0.82), Y(0.16));
    g.stroke();
    shape([[0.82, 0.1], [0.92, 0.2], [0.82, 0.3]], '#c9ccd2');
  }

  // Kragen, Hals, Haare (hinter dem Kopf), Kopf
  shape([[0.44, 0.5], [0.56, 0.5], [0.56, 0.62], [0.44, 0.62]], '#f2cfa6');
  g.beginPath();
  g.ellipse(X(0.5), Y(0.61), b.w * 0.17, b.h * 0.055, 0, 0, Math.PI * 2);
  g.fillStyle = '#f7f1e3';
  g.fill();
  outline();
  const hair = { K: '#d9d4c8', Q: '#d9a63a', J: '#6b3e1e' }[rank];
  if (rank === 'Q') {
    g.beginPath();
    g.ellipse(X(0.5), Y(0.42), b.w * 0.16, b.h * 0.22, 0, 0, Math.PI * 2);
    g.fillStyle = hair;
    g.fill();
    outline();
  }
  const head = { x: X(0.5), y: Y(0.38), rx: b.w * 0.105, ry: b.h * 0.16 };
  g.beginPath();
  g.ellipse(head.x, head.y, head.rx, head.ry, 0, 0, Math.PI * 2);
  g.fillStyle = '#f5d3ad';
  g.fill();
  outline();

  // Bart (König), kurze Haare + Schnurrbart (Bube)
  g.fillStyle = hair;
  if (rank === 'K') {
    g.beginPath();
    g.moveTo(head.x - head.rx, head.y);
    g.quadraticCurveTo(head.x - head.rx, head.y + head.ry * 1.6, head.x, head.y + head.ry * 1.75);
    g.quadraticCurveTo(head.x + head.rx, head.y + head.ry * 1.6, head.x + head.rx, head.y);
    g.quadraticCurveTo(head.x, head.y + head.ry * 0.75, head.x - head.rx, head.y);
    g.fill();
    outline();
  } else if (rank === 'J') {
    g.beginPath();
    g.ellipse(head.x, head.y + head.ry * 0.45, head.rx * 0.55, head.ry * 0.12, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Gesicht
  g.fillStyle = BLACK;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(head.x + side * head.rx * 0.4, head.y - head.ry * 0.12, 3.2, 2.4, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 2;
  g.strokeStyle = '#8a5a3a';
  g.beginPath();
  g.moveTo(head.x, head.y - head.ry * 0.05);
  g.lineTo(head.x - 3, head.y + head.ry * 0.25);
  g.lineTo(head.x + 2, head.y + head.ry * 0.27);
  g.stroke();
  if (rank !== 'K') {
    g.strokeStyle = '#b3261e';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(head.x, head.y + head.ry * 0.38, 6, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  }

  // Kopfbedeckung: Krone (König), Diadem (Dame), Barett mit Feder (Bube)
  const brim = head.y - head.ry * 0.75;
  if (rank === 'K') {
    shape([[0.37, 0.16], [0.4, 0.04], [0.45, 0.12], [0.5, 0.01], [0.55, 0.12], [0.6, 0.04], [0.63, 0.16], [0.63, (brim - b.y) / b.h], [0.37, (brim - b.y) / b.h]], GOLD);
  } else if (rank === 'Q') {
    shape([[0.4, (brim - b.y) / b.h], [0.43, 0.1], [0.5, 0.05], [0.57, 0.1], [0.6, (brim - b.y) / b.h]], GOLD);
  } else {
    g.beginPath();
    g.ellipse(head.x, brim + 2, head.rx * 1.35, head.ry * 0.32, -0.12, 0, Math.PI * 2);
    g.fillStyle = panel;
    g.fill();
    outline();
    g.beginPath();
    g.moveTo(X(0.58), brim - 4);
    g.quadraticCurveTo(X(0.75), Y(0.02), X(0.7), Y(0.16));
    g.lineWidth = 6;
    g.strokeStyle = '#f7f1e3';
    g.stroke();
  }
  if (rank !== 'J') {
    g.fillStyle = panel;
    for (const u of [0.44, 0.5, 0.56]) {
      g.beginPath();
      g.arc(X(u), brim - 6, 4, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Farbzeichen oben links im Bild, wie bei echten Karten
  g.fillStyle = inkOf(suit);
  drawSuit(g, suit, X(0.15), Y(0.13), 34);
}

let back = null;
// Rückseiten-Farben: [Feld, Mitte]
const BACKS = { rot: ['#7e1820', '#5e1016'], blau: ['#1d3566', '#13254a'], gruen: ['#1d5236', '#123a26'] };
let backColors = BACKS.rot;

// Rückseite: Rautengitter, goldener Rahmen und die vier Farben in der Mitte
export function cardBack() {
  back ??= canvasTexture(FACE.w, FACE.h, drawBack);
  return back;
}

// Andere Rückseiten-Farbe: dieselbe Textur neu zeichnen – alle verdeckten Karten ändern sich mit
export function setCardBack(name) {
  backColors = BACKS[name] ?? BACKS.rot;
  const tex = cardBack();
  drawBack(tex.image.getContext('2d'), tex.image.width, tex.image.height);
  tex.needsUpdate = true;
}

function drawBack(g, w, h) {
  {
    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, w, h);
    const m = 22;
    roundRect(g, m, m, w - 2 * m, h - 2 * m, 14);
    g.fillStyle = backColors[0];
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(255, 214, 160, 0.22)';
    g.lineWidth = 2;
    for (let d = -h; d < w + h; d += 24) {
      g.beginPath();
      g.moveTo(d, 0);
      g.lineTo(d + h, h);
      g.moveTo(d, h);
      g.lineTo(d + h, 0);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = GOLD;
    g.lineWidth = 3;
    roundRect(g, m + 8, m + 8, w - 2 * m - 16, h - 2 * m - 16, 10);
    g.stroke();
    g.beginPath();
    g.ellipse(w / 2, h / 2, 96, 120, 0, 0, Math.PI * 2);
    g.fillStyle = backColors[1];
    g.fill();
    g.stroke();
    g.fillStyle = GOLD;
    drawSuit(g, 's', w / 2, h / 2 - 58, 52);
    drawSuit(g, 'h', w / 2 + 50, h / 2, 52);
    drawSuit(g, 'c', w / 2, h / 2 + 58, 52);
    drawSuit(g, 'd', w / 2 - 50, h / 2, 52);
  }
}

const chips = new Map();

// Runder Chip mit der gewünschten Farbe (liegt nach einem Buben neben der Ablage)
export function suitChip(suit) {
  if (!chips.has(suit)) {
    chips.set(suit, canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#f4ead2';
      g.fillRect(0, 0, w, w);
      g.strokeStyle = GOLD;
      g.lineWidth = 14;
      g.beginPath();
      g.arc(w / 2, w / 2, w / 2 - 16, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = inkOf(suit);
      drawSuit(g, suit, w / 2, w / 2, 140);
    }));
  }
  return chips.get(suit);
}

// Farbzeichen auf ein <canvas> im Auswahlfenster malen
export function paintSuit(canvas, suit) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = inkOf(suit);
  drawSuit(g, suit, canvas.width / 2, canvas.height / 2, canvas.height * 0.9);
}
