// Computer-Gegner: einfache Spiellogik, fair bis auf das gewollte Schummeln ohne Hilfen. Er bekommt nur seine Sicht (viewFor) –
// vom Mitspieler kennt er wie ein Mensch nur die Kartenzahl, vom Stapel nur die Höhe.
import { playable } from './game.js';
import { suitOf, rankOf, SUITS } from '../karten/cards.js';

// Nächste Aktion als Nachricht wie vom Gast: { t: 'play', arg } | { t: 'draw' } | { t: 'pass' }
// cheat (nur „Ohne Hilfen“, allein): Statt zu ziehen legt er eine unpassende Karte (nach dem Ziehen die gezogene),
// statt weiterzugeben die gezogene; kann er regelgerecht legen, „vergisst“ er bei der vorletzten Karte das „Mau“.
export function computerMove(v, me, cheat = false) {
  const options = playable(v, me);
  const sly = cheat && !options.length; // mit einer unpassenden Karte schummeln
  if (!options.length && !sly) return { t: v.drawn ? 'pass' : 'draw' };

  const hand = v.hands[me];
  const nearlyDone = v.hands[1 - me] <= 2; // Mitspieler hat fast keine Karten mehr
  const ofSuit = (suit, cards) => cards.filter((c) => suitOf(c) === suit && rankOf(c) !== 'J').length;
  // Buben aufheben, solange es anders geht; ist der Mitspieler fast fertig, lieber 7 oder 8;
  // sonst die Farbe abbauen, von der er am meisten hat
  const score = (c) => (rankOf(c) === 'J' ? -10 : 0) + (nearlyDone && '78'.includes(rankOf(c)) ? 5 : 0) + ofSuit(suitOf(c), hand);
  const card = (sly ? (v.drawn ? [v.drawn] : hand) : options).reduce((best, c) => (score(c) > score(best) ? c : best));
  const rest = hand.filter((c) => c !== card);
  const wish = SUITS.reduce((best, s) => (ofSuit(s, rest) > ofSuit(best, rest) ? s : best));
  return { t: 'play', arg: { card, wish, mau: rest.length === 1 && (sly || !cheat) } };
}
