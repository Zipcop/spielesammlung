// Computer-Gegner für Schocken: Einsen legt er heraus, zwei Sechsen dreht er zur Eins (solange er noch nichts Gutes
// hat), und er hört auf, sobald er eine Straße, einen General oder einen Schock hat – einen kleinen Schock (2 oder 3)
// würfelt er aber noch einmal nach, wenn er darf (schlechter als Schock 2 kann es dann nicht werden, 1/6 ist Schock aus).
// Was die anderen unter dem Becher haben, weiß er nicht – wie jeder am Tisch.
import { judge, maxRolls } from './game.js';

// Nächster Schritt für seat → { t: 'roll' | 'stand' | 'flip' | 'toggle', arg }
export function chooseMove(v, seat) {
  if (v.rolls === 0) return { t: 'roll' };
  const dice = v.dice[seat];
  const out = v.out[seat];
  const wrongOut = () => [0, 1, 2].find((i) => out[i] !== (dice[i] === 1)); // Einsen raus, alles andere zurück in den Becher
  if (v.mustRoll) return wrongOut() !== undefined ? { t: 'toggle', arg: wrongOut() } : { t: 'roll' };
  const r = judge(dice);
  const more = v.rolls < maxRolls(v);
  if (!more) return { t: 'stand' };
  if (r.rank >= 400) {
    // Schock: mit 2 oder 3 die dritte Zahl nochmal werfen, sonst stehen lassen
    if (r.kind === 'schock' && r.stones <= 3) {
      const wrong = wrongOut();
      return wrong !== undefined ? { t: 'toggle', arg: wrong } : { t: 'roll' };
    }
    return { t: 'stand' };
  }
  if (r.rank >= 200) return { t: 'stand' }; // Straße oder General
  const sixes = [0, 1, 2].filter((i) => v.fresh[i] && !out[i] && dice[i] === 6);
  if (sixes.length >= 2 && !v.flipped) return { t: 'flip' };
  const wrong = wrongOut();
  return wrong !== undefined ? { t: 'toggle', arg: wrong } : { t: 'roll' };
}
