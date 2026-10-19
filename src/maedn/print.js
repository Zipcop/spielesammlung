// Aufdruck des Spielplans als Canvas-Textur: Laufbahn, A-Felder, Häuser (B), Ziele (a–d), Pfeile.
// Klassischer Look: helles Papier auf Holz, weiße Felder mit dunklem Rand, Farbfelder je Spieler.
import { canvasTexture } from '../textures.js';
import { TRACK_CELLS, GOAL_CELLS, HOUSE_CELLS } from './layout.js';

export const COLORS = [
  { name: 'Gelb', field: '#f0bf2a', piece: 0xe3ab12, text: '#3a2a05', css: '#e8b51c' },
  { name: 'Grün', field: '#3d9a4c', piece: 0x1f8a3a, text: '#f4f0e0', css: '#3a9a4a' },
  { name: 'Rot', field: '#d23b2d', piece: 0xc0281e, text: '#f8ece0', css: '#d03a2c' },
  { name: 'Schwarz', field: '#2d2a28', piece: 0x1b1a19, text: '#f1e6d2', css: '#3a3634' },
];

// Maße in cm: Brett 46 × 46, Feldabstand 3,9 → Raster 39 cm, Rand 3,5 cm
export const BOARD = 46;
export const STEP = 3.9;
export const FIELD_R = 1.45;
const PX = 2048;
const S = PX / BOARD;
const at = ([c, r]) => [(BOARD / 2 + (c - 5) * STEP) * S, (BOARD / 2 + (r - 5) * STEP) * S];

// colors = Farbe je Sitz (Index in COLORS) – das Brett wird so gedreht, dass die Farbe des Hosts vor ihm liegt
export function boardTexture(colors = [0, 1, 2, 3]) {
  const colorOf = (seat) => COLORS[colors[seat]];
  return canvasTexture(PX, PX, (g) => {
    // Papier: warmes Creme mit leichtem Verlauf und Körnung
    const bg = g.createRadialGradient(PX / 2, PX / 2, PX * 0.1, PX / 2, PX / 2, PX * 0.75);
    bg.addColorStop(0, '#f3e4bf');
    bg.addColorStop(1, '#e2c995');
    g.fillStyle = bg;
    g.fillRect(0, 0, PX, PX);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '90,60,20' : '255,250,235'},${0.03 + Math.random() * 0.05})`;
      g.fillRect(Math.random() * PX, Math.random() * PX, 2 + Math.random() * 3, 1 + Math.random() * 2);
    }
    // doppelter Zierrahmen
    g.strokeStyle = '#7a2a1c';
    g.lineWidth = 0.18 * S;
    g.strokeRect(1.1 * S, 1.1 * S, PX - 2.2 * S, PX - 2.2 * S);
    g.lineWidth = 0.06 * S;
    g.strokeRect(1.5 * S, 1.5 * S, PX - 3 * S, PX - 3 * S);

    // Verbindungslinie der Laufbahn
    g.strokeStyle = '#3b2a1a';
    g.lineWidth = 0.32 * S;
    g.lineJoin = 'round';
    g.beginPath();
    TRACK_CELLS.forEach((cell, i) => (i ? g.lineTo(...at(cell)) : g.moveTo(...at(cell))));
    g.closePath();
    g.stroke();

    // Mitte: Rosette in den vier Farben
    const [mx, my] = at([5, 5]);
    colors.forEach((c, k) => {
      const col = COLORS[c];
      g.fillStyle = col.field;
      g.beginPath();
      g.moveTo(mx, my);
      g.arc(mx, my, 1.25 * S, Math.PI / 4 + (k + 0.5) * Math.PI / 2, Math.PI / 4 + (k + 1.5) * Math.PI / 2);
      g.closePath();
      g.fill();
    });
    ring(g, mx, my, 1.25 * S, '#3b2a1a', 0.12 * S);

    // weiße Felder der Laufbahn, A-Felder in Spielerfarbe
    TRACK_CELLS.forEach((cell, i) => {
      const seat = i % 10 === 0 ? i / 10 : -1;
      field(g, at(cell), seat >= 0 ? colorOf(seat).field : '#fbf6ea');
      if (seat >= 0) letter(g, at(cell), 'A', colorOf(seat).text, seat);
    });
    // Häuser und Ziele
    for (let seat = 0; seat < 4; seat++) {
      const col = colorOf(seat);
      HOUSE_CELLS[seat].forEach((cell) => {
        field(g, at(cell), col.field);
        letter(g, at(cell), 'B', col.text, seat, 0.75);
      });
      GOAL_CELLS[seat].forEach((cell, k) => {
        field(g, at(cell), col.field);
        letter(g, at(cell), 'abcd'[k], col.text, seat);
      });
      arrow(g, seat, col);
    }
  });
}

function field(g, [x, y], fill) {
  const r = FIELD_R * S;
  g.fillStyle = 'rgba(40, 25, 10, 0.25)'; // leichter Schatten → Feld wirkt eingelassen
  g.beginPath();
  g.arc(x + 0.06 * S, y + 0.08 * S, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  ring(g, x, y, r, '#2a2118', 0.14 * S);
  ring(g, x, y, r * 0.8, 'rgba(0, 0, 0, 0.12)', 0.05 * S);
}

function ring(g, x, y, r, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
}

// Buchstabe, lesbar von der Seite des Sitzes aus (Sitz k = k · 90° im Uhrzeigersinn gedreht)
function letter(g, [x, y], text, color, seat, alpha = 0.9) {
  g.save();
  g.translate(x, y);
  g.rotate((seat * Math.PI) / 2);
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.font = `bold ${Math.round(1.25 * S)}px Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, 0.08 * S);
  g.restore();
}

// Pfeil neben dem A-Feld in Laufrichtung (für Sitz 0: neben Feld 4/10 nach oben)
function arrow(g, seat, col) {
  const [x, y] = at(TRACK_CELLS[seat * 10]);
  g.save();
  g.translate(x, y);
  g.rotate((seat * Math.PI) / 2);
  g.translate(-1.95 * S, -0.2 * S);
  g.fillStyle = col.field;
  g.strokeStyle = '#2a2118';
  g.lineWidth = 0.06 * S;
  g.beginPath();
  g.moveTo(0, -0.95 * S);
  g.lineTo(0.42 * S, -0.35 * S);
  g.lineTo(0.15 * S, -0.35 * S);
  g.lineTo(0.15 * S, 0.7 * S);
  g.lineTo(-0.15 * S, 0.7 * S);
  g.lineTo(-0.15 * S, -0.35 * S);
  g.lineTo(-0.42 * S, -0.35 * S);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}
