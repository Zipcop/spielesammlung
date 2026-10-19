// Kniffel-Wertung als reine Funktionen (kein DOM, kein three.js) – dadurch mit `node --test` prüfbar.
// Regeln nach der Schmidt-Spiele-Anleitung: 13 Felder, Bonus 35 ab 63 oben,
// jeder weitere Kniffel = 50 Zusatzpunkte + Joker (beliebiges freies Feld mit Höchstpunktzahl).

export const UPPER = ['einser', 'zweier', 'dreier', 'vierer', 'fuenfer', 'sechser'];
export const LOWER = ['dreierpasch', 'viererpasch', 'fullHouse', 'kleineStrasse', 'grosseStrasse', 'kniffel', 'chance'];
export const FIELDS = [...UPPER, ...LOWER];

export const LABELS = {
  einser: 'Einser',
  zweier: 'Zweier',
  dreier: 'Dreier',
  vierer: 'Vierer',
  fuenfer: 'Fünfer',
  sechser: 'Sechser',
  dreierpasch: 'Dreierpasch',
  viererpasch: 'Viererpasch',
  fullHouse: 'Full House',
  kleineStrasse: 'Kleine Straße',
  grosseStrasse: 'Große Straße',
  kniffel: 'Kniffel',
  chance: 'Chance',
};

// Höchstpunktzahl je Feld – gilt für den Joker beim zweiten, dritten … Kniffel
export const MAX = {
  einser: 5, zweier: 10, dreier: 15, vierer: 20, fuenfer: 25, sechser: 30,
  dreierpasch: 30, viererpasch: 30, fullHouse: 25, kleineStrasse: 30, grosseStrasse: 40, kniffel: 50, chance: 30,
};

export const BONUS_FROM = 63;
export const BONUS = 35;
export const EXTRA_KNIFFEL = 50;

const sum = (dice) => dice.reduce((a, b) => a + b, 0);

// Wie oft kommt jede Augenzahl vor? Index 1–6
function counts(dice) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
}

function hasRun(dice, length) {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = dice.includes(v) ? run + 1 : 0;
    if (run >= length) return true;
  }
  return false;
}

export function isKniffel(dice) {
  return counts(dice).includes(5);
}

// Punkte für ein Feld nach den Grundregeln (ohne Joker)
export function scoreDice(dice, field) {
  const c = counts(dice);
  const most = Math.max(...c);
  switch (field) {
    case 'dreierpasch': return most >= 3 ? sum(dice) : 0;
    case 'viererpasch': return most >= 4 ? sum(dice) : 0;
    case 'fullHouse': return c.includes(3) && c.includes(2) ? 25 : 0; // drei gleiche + zwei gleiche, andere
    case 'kleineStrasse': return hasRun(dice, 4) ? 30 : 0;
    case 'grosseStrasse': return hasRun(dice, 5) ? 40 : 0;
    case 'kniffel': return most === 5 ? 50 : 0;
    case 'chance': return sum(dice);
    default: {
      const face = UPPER.indexOf(field) + 1;
      return c[face] * face;
    }
  }
}

// Joker: Kniffel gewürfelt, obwohl das Kniffel-Feld schon mit 50 belegt ist.
// (Ein gestrichener Kniffel – 0 – zählt nicht als erster Kniffel.)
export function isJoker(dice, card) {
  return isKniffel(dice) && card.kniffel === 50;
}

// Mögliche Punkte für alle noch freien Felder
export function scoreOptions(dice, card) {
  const joker = isJoker(dice, card);
  const options = {};
  for (const field of FIELDS) {
    if (card[field] === undefined) options[field] = joker ? MAX[field] : scoreDice(dice, field);
  }
  return options;
}

export function totals(card, extraKniffel = 0) {
  const upper = UPPER.reduce((s, f) => s + (card[f] ?? 0), 0);
  const bonus = upper >= BONUS_FROM ? BONUS : 0;
  const lower = LOWER.reduce((s, f) => s + (card[f] ?? 0), 0);
  const extra = extraKniffel * EXTRA_KNIFFEL;
  return { upper, bonus, lower, extra, total: upper + bonus + lower + extra };
}
