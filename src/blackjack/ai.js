// Computer-Mitspieler für Black Jack (nur beim Host): spielen die Grundstrategie („Basic Strategy“) für mehrere
// Kartenspiele, Bank steht auf Soft 17, Verdoppeln nach dem Teilen erlaubt – angepasst an die Regeln hier: Verdoppeln
// nur auf 9/10/11 (sonst ziehen) und europäisch ohne verdeckte Bankkarte (11 gegen 10/Ass ziehen, 8er gegen 10/Ass
// nicht teilen – der Black Jack der Bank nähme sonst den doppelten Einsatz). Versichern nie.
// Quellen: en.wikipedia.org/wiki/Blackjack#Basic_strategy (Tabelle 4–8 Decks, S17, DAS) und
// wizardofodds.com/games/blackjack/strategy/european/ („no hole card“), abgerufen 21.10.2026.
import { total, valueOf, options } from './game.js';

// Zug für die Hand cards gegen die offene Bankkarte up – o = options() (was erlaubt ist)
export function basic(cards, up, o) {
  const d = valueOf(up); // 2 … 11 (Ass)
  const want = choose(cards, d, o);
  if (want === 'split' && !o.split) return choose(cards, d, { ...o, split: false });
  if (want === 'double' && !o.double) return o.hit ? 'hit' : 'stand';
  if (want === 'hit' && !o.hit) return 'stand';
  return want;
}

function choose(cards, d, o) {
  if (o.split && cards.length === 2 && valueOf(cards[0]) === valueOf(cards[1])) {
    const v = valueOf(cards[0]);
    const split = {
      11: true,
      10: false,
      9: d <= 9 && d !== 7,
      8: d <= 9,
      7: d <= 7,
      6: d <= 6,
      5: false,
      4: d === 5 || d === 6,
      3: d <= 7,
      2: d <= 7,
    }[v];
    if (split) return 'split';
  }
  const { total: t, soft } = total(cards);
  if (soft) {
    if (t >= 19) return 'stand';
    if (t === 18) return d <= 8 ? 'stand' : 'hit';
    return 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return d <= 6 ? 'stand' : 'hit';
  if (t === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (t === 11 || t === 10) return d <= 9 ? 'double' : 'hit';
  if (t === 9) return d >= 3 && d <= 6 ? 'double' : 'hit';
  return 'hit';
}

// Zug des Computers auf seat (passt immer zu options)
export function decide(s, seat) {
  const o = options(s, seat);
  if (!o) return null;
  return basic(s.boxes[seat].hands[s.turn.hand].cards, s.dealer[0], o);
}
