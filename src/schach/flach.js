// Reine Teile der 2D-Ansicht (ohne DOM, getestet in test/schach-2d.test.js): Feld ↔ Lage auf dem flachen Brett
// (auch gedreht für Schwarz), Figuren aus der FEN, Pfeil-Geometrie (Springer geknickt), eigene Zeichnungen mit
// der rechten Maustaste und die selbst gezeichneten Figuren als SVG. Maße in Feldern: das Brett ist 8 × 8 groß,
// (0|0) ist die linke obere Ecke aus Sicht des Zuschauers.

const FILES = 'abcdefgh';

// Linke obere Ecke des Felds: x = Spalte, y = Zeile von oben. flipped = Schwarz sitzt unten
export function squareXY(square, flipped = false) {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  return flipped ? { x: 7 - f, y: r - 1 } : { x: f, y: 8 - r };
}

// Feld an einer Stelle des Bretts (in Feldern, auch Bruchteile) oder null daneben
export function squareAtXY(x, y, flipped = false) {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (!(col >= 0 && col < 8 && row >= 0 && row < 8)) return null;
  return flipped ? FILES[7 - col] + (row + 1) : FILES[col] + (8 - row);
}

// Figuren laut FEN: [{ square: 'e1', color: 'w', type: 'k' }, …] – ohne Regelprüfung (ohne Hilfen gibt es auch Regelwidriges)
export function piecesOf(fen) {
  const out = [];
  fen.split(' ')[0].split('/').forEach((row, i) => {
    let f = 0;
    for (const c of row) {
      if (/\d/.test(c)) f += Number(c);
      else {
        out.push({ square: FILES[f] + (8 - i), color: c === c.toUpperCase() ? 'w' : 'b', type: c.toLowerCase() });
        f += 1;
      }
    }
  });
  return out;
}

const round = (v) => Math.round(v * 1000) / 1000;

// Pfeil von Feldmitte zu Feldmitte: line = Schaft als Linienzug (endet am Fuß der Spitze), head = Dreieck [Spitze, links, rechts].
// Springerzüge laufen geknickt: erst den langen Schenkel, dann den kurzen (wie man den Springer zählt).
export function arrowShape(uci, flipped = false, { head = 0.5, headWidth = 0.58 } = {}) {
  const center = (sq) => {
    const { x, y } = squareXY(sq, flipped);
    return [x + 0.5, y + 0.5];
  };
  const a = center(uci.slice(0, 2));
  const b = center(uci.slice(2, 4));
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const knight = [Math.abs(dx), Math.abs(dy)].sort().join() === '1,2';
  const points = knight ? [a, Math.abs(dx) > Math.abs(dy) ? [b[0], a[1]] : [a[0], b[1]], b] : [a, b];
  const from = points.at(-2);
  const len = Math.hypot(b[0] - from[0], b[1] - from[1]);
  const [ux, uy] = [(b[0] - from[0]) / len, (b[1] - from[1]) / len]; // Richtung des letzten Stücks
  const base = [b[0] - ux * head, b[1] - uy * head];
  const half = headWidth / 2;
  return {
    line: [...points.slice(0, -1), base].map((p) => p.map(round)),
    head: [b, [base[0] + uy * half, base[1] - ux * half], [base[0] - uy * half, base[1] + ux * half]].map((p) => p.map(round)),
  };
}

// Eigene Zeichnungen (rechte Maustaste): Farbe je nach gedrückter Taste – ohne = grün, Shift = rot, Strg = blau, Alt = gelb
export const DRAW_COLORS = { gruen: '#2e9b3a', rot: '#d63a2f', blau: '#2f78d6', gelb: '#e8b400' };
export const drawColor = (e) => (e.shiftKey ? 'rot' : e.ctrlKey || e.metaKey ? 'blau' : e.altKey ? 'gelb' : 'gruen');

// Zeichnung { from, to, color } (from === to = Feld markiert) an- oder abschalten: dasselbe nochmal = weg,
// gleicher Pfeil in anderer Farbe = umgefärbt
export function toggleDrawing(list, item) {
  const same = (d) => d.from === item.from && d.to === item.to;
  const old = list.find(same);
  if (!old) return [...list, item];
  if (old.color === item.color) return list.filter((d) => !same(d));
  return list.map((d) => (same(d) ? item : d));
}

// --- Figuren: selbst gezeichnete Staunton-Umrisse (Feld 100 × 100, Fuß unten) ---
// b = Körper (gefüllt, Umriss), d = Linie im Inneren, e = Punkt (Auge, Nüster). Gezeichnet wird in der Reihenfolge –
// Späteres deckt Früheres ab, so entstehen Kragen und Fuß.
const BASE = ['b', 'M22 90 H78 V86 C78 80 72 77 66 77 H34 C28 77 22 80 22 86 Z'];
const BODY = ['b', 'M35 77 C35 64 40 56 42 49 H58 C60 56 65 64 65 77 Z'];
const BAND = ['b', 'M31 46 C31 40 69 40 69 46 C69 51 31 51 31 46 Z'];
const ball = (x, y, r) => ['b', `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`];
const dot = (x, y, r) => ['e', ball(x, y, r)[1]];
export const SHAPES = {
  p: [
    ['b', 'M37 78 C39 64 44 56 45 47 H55 C56 56 61 64 63 78 Z'],
    ball(50, 31, 12),
    ['b', 'M38 46 C38 41 62 41 62 46 C62 50 38 50 38 46 Z'],
    ['b', 'M26 90 H74 V87 C74 81 69 78 63 78 H37 C31 78 26 81 26 87 Z'],
  ],
  r: [
    ['b', 'M34 74 L37 42 H63 L66 74 Z'],
    ['b', 'M29 42 V20 H38 V27 H45.5 V20 H54.5 V27 H62 V20 H71 V42 Z'],
    ['d', 'M30 35 H70'],
    ['b', 'M29 80 V74 H71 V80 Z'],
    BASE,
  ],
  n: [
    ['b', 'M33 77 C33 66 39 58 46 51 C39 55 31 59 25 58 C19 57 15 52 17 46 C18 42 22 39 26 37 C31 33 35 28 38 23 L43 10 L50 19 C65 20 77 34 75 56 C74 66 71 72 71 77 Z'],
    dot(41, 31, 3),
    dot(21, 48, 1.7),
    ['d', 'M55 25 C65 32 70 45 68 62'],
    BASE,
  ],
  b: [
    ['b', 'M37 77 C37 64 42 56 44 50 H56 C58 56 63 64 63 77 Z'],
    ['b', 'M50 15 C39 24 33 34 37 43 C39 47 61 47 63 43 C67 34 61 24 50 15 Z'],
    ['d', 'M56 25 L48 35'],
    ball(50, 12, 4.5),
    ['b', 'M37 50 C37 45 63 45 63 50 C63 54 37 54 37 50 Z'],
    BASE,
  ],
  q: [
    BODY,
    ['b', 'M31 44 L24 19 L37 32 L38 14 L46 31 L50 11 L54 31 L62 14 L63 32 L76 19 L69 44 Z'],
    ball(24, 18, 3.6), ball(38, 13, 3.6), ball(50, 10, 3.6), ball(62, 13, 3.6), ball(76, 18, 3.6),
    BAND,
    BASE,
  ],
  k: [
    BODY,
    ['b', 'M47 6 H53 V12 H59 V18 H53 V28 H47 V18 H41 V12 H47 Z'],
    ['b', 'M32 44 C27 35 31 26 40 26 C45 26 48 29 50 32 C52 29 55 26 60 26 C69 26 73 35 68 44 Z'],
    ['d', 'M50 33 V42'],
    BAND,
    BASE,
  ],
};

// Weiß mit dunkler Kontur, Schwarz fast schwarz mit hellen Linien innen
const LOOK = { w: { fill: '#fbf8f0', line: '#1c1a17', detail: '#1c1a17' }, b: { fill: '#2b2724', line: '#0c0b0a', detail: '#e9e2d4' } };

// Figur als SVG-Text (nur feste Zeichen – kein Text von außen)
export function pieceSvg(color, type) {
  const c = LOOK[color];
  const parts = SHAPES[type].map(([kind, d]) => {
    if (kind === 'b') return `<path d="${d}" fill="${c.fill}" stroke="${c.line}"/>`;
    if (kind === 'd') return `<path d="${d}" fill="none" stroke="${c.detail}"/>`;
    return `<path d="${d}" fill="${c.detail}" stroke="none"/>`;
  });
  return `<svg viewBox="0 0 100 100" aria-hidden="true" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">${parts.join('')}</svg>`;
}
