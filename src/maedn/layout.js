// Spielplan als Raster 11 × 11 (Spalte c nach rechts = +x, Zeile r nach unten = +z, Mitte = 5/5), rein.
// Sitz 0 (Host) sitzt unten (+z), die anderen folgen im Uhrzeigersinn: 1 links, 2 oben, 3 rechts.
// Für Sitz 0 sind A-Feld, Arm, Ziel und Haus festgelegt – die anderen Sitze sind dasselbe, je 90° gedreht.
import { HOUSE, GOAL, TRACK } from './rules.js';

// 90° im Uhrzeigersinn um die Mitte (von oben gesehen)
const turn = ([c, r], k) => {
  for (let i = 0; i < k; i++) [c, r] = [10 - r, c];
  return [c, r];
};

// Die ersten 10 Felder der Laufbahn ab dem A-Feld von Sitz 0: den eigenen Arm hinauf, links hinaus, Armende
const ARM = [[4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5]];
const GOAL0 = [[5, 9], [5, 8], [5, 7], [5, 6]]; // Zielfelder a–d
const HOUSE0 = [[0, 9], [1, 9], [0, 10], [1, 10]]; // B-Felder in der Ecke links unten

export const TRACK_CELLS = [0, 1, 2, 3].flatMap((k) => ARM.map((cell) => turn(cell, k)));
export const GOAL_CELLS = [0, 1, 2, 3].map((k) => GOAL0.map((cell) => turn(cell, k)));
export const HOUSE_CELLS = [0, 1, 2, 3].map((k) => HOUSE0.map((cell) => turn(cell, k)));

// Rasterfeld einer Figur: seat = Sitz, pos = Stand (rules.js), piece = Figur 0–3 (für ihr B-Feld)
export function cellOf(seat, pos, piece) {
  if (pos === HOUSE) return HOUSE_CELLS[seat][piece];
  if (pos >= GOAL) return GOAL_CELLS[seat][pos - GOAL];
  return TRACK_CELLS[(seat * (TRACK / 4) + pos) % TRACK];
}

// Weg Feld für Feld von einem Stand zum anderen (ohne Startfeld): aus dem Haus direkt aufs A-Feld
export function pathOf(seat, from, to, piece) {
  if (from === HOUSE) return [cellOf(seat, to, piece)];
  return Array.from({ length: to - from }, (_, k) => cellOf(seat, from + 1 + k, piece));
}
