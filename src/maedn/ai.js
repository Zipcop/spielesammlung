// Computer-Spieler: bewertet jeden erlaubten Zug und nimmt den besten.
// Reihenfolge der Wünsche: schlagen (ist ohnehin Pflicht) > ins Ziel > in Sicherheit bringen > vorankommen.
// Herauskommen (bei einer 6 freiwillig) bekommt keine Extrapunkte: In je 4000 simulierten Partien gewann der Computer
// so am häufigsten (42 % als 1 gegen 3 Zufallsspieler; 2 gegen 2 gegen dieselbe Logik mit Bonus 75 fürs
// Herauskommen 61 %, 1 gegen 3 davon 33 % statt 25 %) –
// eine frische Figur auf dem A-Feld muss wieder weg und steht im Weg. Er sieht nur, was auch Menschen am Brett
// sehen, und würfelt nicht selbst – das macht der Host.
import { legalMoves, targetOf, fieldOf, HOUSE, GOAL, TRACK, SEATS } from './rules.js';

// Wie wahrscheinlich wird eine Figur von player auf diesem Feld im nächsten Wurf eines Gegners geschlagen?
// Gegner 1–6 Felder dahinter: 1/6 · 7–12 Felder (erst eine 6, dann der Rest): 1/36 ·
// fremdes A-Feld, während dort noch Figuren im Haus warten: 1/6 (bei einer 6 müssen sie heraus).
export function danger(s, player, field) {
  let p = 0;
  for (let q = 0; q < SEATS; q++) {
    if (q === player || s.places.includes(q)) continue;
    for (const pos of s.pieces[q]) {
      const at = fieldOf(q, pos);
      if (at === null) continue;
      const k = (field - at + TRACK) % TRACK;
      if (k === 0 || pos + k >= TRACK) continue; // biegt vorher ins eigene Ziel ab
      if (k <= 6) p += 1 / 6;
      else if (k <= 12) p += 1 / 36;
    }
    if (s.pieces[q].includes(HOUSE) && fieldOf(q, 0) === field) p += 1 / 6;
  }
  return Math.min(p, 1);
}

// Punkte für einen Zug – je höher, desto lieber
export function rate(s, player, piece) {
  const from = s.pieces[player][piece];
  const to = targetOf(s, player, piece);
  const field = fieldOf(player, to);
  let score = to * 0.2; // vorankommen
  if (field !== null) {
    for (let q = 0; q < SEATS; q++) {
      if (q === player) continue;
      const victim = s.pieces[q].find((p) => fieldOf(q, p) === field);
      if (victim !== undefined) score += 100 + victim; // schlagen – je weiter der Gegner war, desto besser
    }
  }
  if (from < GOAL && to >= GOAL) score += 70;
  if (from >= GOAL) score += 10; // im Ziel aufrücken macht Platz
  // Gefahr, in der die Figur jetzt steht bzw. danach stünde – eine weit gekommene Figur zu verlieren, tut mehr weh
  const worth = (pos) => 1.5 * (20 + pos);
  if (from >= 0 && from < TRACK) score += danger(s, player, fieldOf(player, from)) * worth(from);
  if (field !== null) score -= danger(s, player, field) * worth(to);
  return score;
}

// Welche Figur der Computer zieht (Index 0–3); bei Gleichstand die erste
export function chooseMove(s, player = s.turn) {
  const options = legalMoves(s, player);
  if (!options.length) return null;
  return options.reduce((best, i) => (rate(s, player, i) > rate(s, player, best) ? i : best));
}
