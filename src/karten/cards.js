// Französisches Blatt als reine Daten. Eine Karte ist ein kurzer Text aus Farbe + Wert:
// 'h7' = Herz 7, 'sT' = Pik 10, 'cJ' = Kreuz Bube, 'dA' = Karo Ass.
// makeDeck('7') = 32 Karten (Mau-Mau, Skat …), makeDeck('2') = alle 52 Karten (Rommé, Poker …).
// Joker: 'xr' (rot) und 'xb' (schwarz) – kommen in keinem Blatt von makeDeck vor, Rommé legt sie selbst dazu.

export const SUITS = ['c', 's', 'h', 'd']; // Kreuz, Pik, Herz, Karo
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUIT_NAMES = { c: 'Kreuz', s: 'Pik', h: 'Herz', d: 'Karo' };
const RANK_NAMES = { T: '10', J: 'Bube', Q: 'Dame', K: 'König', A: 'Ass' };

export const suitOf = (card) => card[0];
export const rankOf = (card) => card[1];
export const isRed = (card) => card[0] === 'h' || card[0] === 'd';
export const isCard = (card) => typeof card === 'string' && card.length === 2 && SUITS.includes(card[0]) && RANKS.includes(card[1]);
export const JOKERS = ['xr', 'xb'];
export const isJoker = (card) => JOKERS.includes(card);

// 'h7' → 'Herz 7', 'cJ' → 'Kreuz Bube', 'xr' → 'Joker'
export const cardName = (card) => (isJoker(card) ? 'Joker' : `${SUIT_NAMES[suitOf(card)]} ${RANK_NAMES[rankOf(card)] ?? rankOf(card)}`);

export function makeDeck(lowest = '7') {
  const ranks = RANKS.slice(RANKS.indexOf(lowest));
  return SUITS.flatMap((s) => ranks.map((r) => s + r));
}

// Mischen nach Fisher-Yates; rng lässt sich für Tests festlegen
export function shuffle(cards, rng = Math.random) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}
