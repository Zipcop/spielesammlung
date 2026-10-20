// Pokerhände bewerten (rein, schnell – auch für die Simulationen der Computer): beste 5 aus 5–7 Karten.
// Karten wie in karten/cards.js: 'hA' = Herz Ass, 'sT' = Pik 10. Rangfolge der Hände (en.wikipedia.org/wiki/List_of_poker_hands,
// abgerufen 20.10.2026): Höchste Karte < Paar < Zwei Paare < Drilling < Straße < Flush < Full House < Vierling < Straight Flush
// (der höchste heißt Royal Flush). Gleiche Hände entscheiden die Kicker; Farben haben keinen Rang. A-2-3-4-5 ist die
// kleinste Straße („Wheel“), das Ass zählt dort als 1.

const VALUE = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const SUIT = { c: 0, s: 1, h: 2, d: 3 };
export const CATEGORIES = ['Höchste Karte', 'Ein Paar', 'Zwei Paare', 'Drilling', 'Straße', 'Flush', 'Full House', 'Vierling', 'Straight Flush'];
const NAMES = { 2: 'Zweier', 3: 'Dreier', 4: 'Vierer', 5: 'Fünfer', 6: 'Sechser', 7: 'Siebener', 8: 'Achter', 9: 'Neuner', 10: 'Zehner', 11: 'Buben', 12: 'Damen', 13: 'Könige', 14: 'Asse' };
const HIGH = { 10: 'Zehn', 11: 'Bube', 12: 'Dame', 13: 'König', 14: 'Ass' };
const TO = { 14: 'zum Ass', 13: 'zum König', 12: 'zur Dame', 11: 'zum Buben', 10: 'zur Zehn' };

export const valueOf = (card) => VALUE[card[1]];

// Wertung als eine Zahl: Kategorie und bis zu 5 Ränge (je 4 Bit) – größer = besser
const pack = (cat, ranks) => ranks.reduce((n, r) => n * 16 + r, cat) * 16 ** (5 - ranks.length);

// höchste Karte einer Straße in einer Bitmaske der Werte (Bit v), 0 = keine
function straightTop(mask) {
  if (mask & (1 << 14)) mask |= 1 << 1; // Ass auch als 1
  for (let top = 14; top >= 5; top--) {
    const run = 0b11111 << (top - 4);
    if ((mask & run) === run) return top;
  }
  return 0;
}

// → { cat, score, ranks } – ranks = die entscheidenden Werte in Reihenfolge (für Namen und Tests)
export function evaluate(cards) {
  const count = new Array(15).fill(0);
  const suits = [0, 0, 0, 0];
  const bySuit = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const v = VALUE[c[1]];
    const s = SUIT[c[0]];
    count[v]++;
    suits[s]++;
    bySuit[s] |= 1 << v;
    mask |= 1 << v;
  }
  const flushSuit = suits.findIndex((n) => n >= 5);
  if (flushSuit >= 0) {
    const top = straightTop(bySuit[flushSuit]);
    if (top) return result(8, [top]);
  }
  const quads = [];
  const trips = [];
  const pairs = [];
  const singles = [];
  for (let v = 14; v >= 2; v--) {
    if (count[v] === 4) quads.push(v);
    else if (count[v] === 3) trips.push(v);
    else if (count[v] === 2) pairs.push(v);
    else if (count[v] === 1) singles.push(v);
  }
  const kickers = (skip, n) => {
    const out = [];
    for (let v = 14; v >= 2 && out.length < n; v--) if (count[v] && !skip.includes(v)) out.push(v);
    return out;
  };
  if (quads.length) return result(7, [quads[0], ...kickers([quads[0]], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const pair = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return result(6, [trips[0], pair]);
  }
  if (flushSuit >= 0) {
    const out = [];
    for (let v = 14; v >= 2 && out.length < 5; v--) if (bySuit[flushSuit] & (1 << v)) out.push(v);
    return result(5, out);
  }
  const top = straightTop(mask);
  if (top) return result(4, [top]);
  if (trips.length) return result(3, [trips[0], ...kickers([trips[0]], 2)]);
  if (pairs.length >= 2) return result(2, [pairs[0], pairs[1], ...kickers([pairs[0], pairs[1]], 1)]);
  if (pairs.length) return result(1, [pairs[0], ...kickers([pairs[0]], 3)]);
  return result(0, singles.slice(0, 5));
}

const result = (cat, ranks) => ({ cat, score: pack(cat, ranks), ranks });

// „Zwei Paare, Könige und Fünfer“, „Straße bis zur Dame“, „Royal Flush“
export function handName({ cat, ranks }) {
  const r = ranks[0];
  if (cat === 8) return r === 14 ? 'Royal Flush' : `Straight Flush bis ${TO[r] ?? `zur ${r}`}`;
  if (cat === 7) return `Vierling ${NAMES[r]}`;
  if (cat === 6) return `Full House, ${NAMES[r]} und ${NAMES[ranks[1]]}`;
  if (cat === 5) return `Flush, ${HIGH[r] ?? r} hoch`;
  if (cat === 4) return `Straße bis ${TO[r] ?? `zur ${r}`}`;
  if (cat === 3) return `Drilling ${NAMES[r]}`;
  if (cat === 2) return `Zwei Paare, ${NAMES[r]} und ${NAMES[ranks[1]]}`;
  if (cat === 1) return `Paar ${NAMES[r]}`;
  return `Höchste Karte ${HIGH[r] ?? r}`;
}
