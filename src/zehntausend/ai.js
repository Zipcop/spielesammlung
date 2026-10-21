// Computer-Gegner für Zehntausend: wählt nach jedem Wurf, welche Würfel er herauslegt, und ob er aufhört.
// Herauslegen: alle Möglichkeiten (Teilmengen der geworfenen Würfel, die ganz zählen) durchgehen und die nehmen, die
// Punkte plus Wert der übrigen Würfel am höchsten macht – lieber eine Eins nehmen und mit fünf weiterwürfeln als Eins
// und Fünf mit vier. Aufhören: je weniger Würfel übrig, desto eher (Niete-Gefahr mit 1 Würfel 67 %, mit 2: 44 %,
// 3: 28 %, 4: 16 %, 5: 8 %, 6: 2 %). In der letzten Runde würfelt er weiter, bis er vorn liegt.
import { scoreOf, onTable, MIN_BANK, GOAL, DICE } from './game.js';

// so viel ist es ungefähr wert, mit n Würfeln weiterwürfeln zu dürfen (0 = alle gewertet → Anschluss mit 6)
const LEFT_WORTH = [450, 0, 40, 90, 180, 300, 450];
// ab so vielen Punkten im Zug hört er auf, wenn noch n Würfel übrig wären
const STOP_AT = [Infinity, 300, 300, 400, 700, 2000, Infinity];

// Alle erlaubten Auswahlen aus den geworfenen Würfeln: { dice: [Nummern], points }
export function options(v) {
  const table = onTable(v);
  const out = [];
  for (let m = 1; m < 1 << table.length; m++) {
    const dice = table.filter((_, k) => m & (1 << k));
    const { points, junk } = scoreOf(dice.map((i) => v.dice[i]));
    if (points > 0 && !junk) out.push({ dice, points });
  }
  return out;
}

// Was tut er nach einem Wurf? → { dice: [herauslegen], stop }
export function choosePick(v, seat) {
  const asideBefore = v.where.filter((w) => w === 'aside').length;
  let best = null;
  for (const o of options(v)) {
    const left = DICE - asideBefore - o.dice.length; // 0 = Anschluss
    const worth = o.points + LEFT_WORTH[left] - o.dice.length; // bei Gleichstand weniger Würfel
    if (!best || worth > best.worth) best = { ...o, left, worth };
  }
  if (!best) return { dice: [], stop: false };
  const total = v.turnPts + best.points;
  const mine = v.scores[seat] + total;
  const others = Math.max(...v.seats.filter((p) => p !== seat).map((p) => v.scores[p]));
  let stop;
  if (total < MIN_BANK) stop = false;
  else if (v.final !== null) stop = mine > others; // letzte Runde: erst aufhören, wenn er vorn liegt
  else if (mine >= GOAL) stop = true;
  else stop = total >= STOP_AT[best.left];
  return { dice: best.dice, stop };
}
