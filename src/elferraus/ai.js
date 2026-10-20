// Computer für Elfer raus: sieht nur seine Sicht (viewFor) und macht je Aufruf eine Aktion.
// Idee: Eine Karte zu legen öffnet die Reihe dahinter für alle. Lohnend ist das nur, wenn man selbst Karten weiter
// in dieser Richtung hat – sonst ist es ein Geschenk an die anderen. Also legt er zuerst eigene Ketten und Karten,
// hinter denen er noch etwas hat, hält Schlüsselkarten (Elfer und Karten, hinter denen nur fremde liegen) zurück und
// legt davon nur, was er muss – dann die, die am wenigsten freigibt. Hat jemand fast keine Karten mehr (oder er
// selbst), legt er alles, was passt: Restpunkte zählen.
import { playable, canDraw, colorOf, numOf, fits } from './game.js';

const ENDGAME = 3; // so wenige Karten hat ein anderer – jetzt alles loswerden

// Wie gut ist es, diese passende Karte jetzt zu legen? > 0 = lohnt sich, < 0 = Geschenk (je kleiner, desto mehr)
export function worth(v, seat, card) {
  const col = colorOf(card);
  const n = numOf(card);
  const mine = new Set(v.hands[seat].filter((c) => colorOf(c) === col).map(numOf));
  const dirs = n === 11 ? [-1, 1] : [n < 11 ? -1 : 1];
  let score = 0;
  for (const d of dirs) {
    const end = d < 0 ? 1 : 20;
    const ahead = [];
    for (let k = n + d; d < 0 ? k >= end : k <= end; k += d) ahead.push(k);
    const own = ahead.filter((k) => mine.has(k));
    if (!own.length) {
      score -= ahead.length / 10; // gibt die ganze Richtung frei
      continue;
    }
    let run = 0;
    while (mine.has(n + d * (run + 1))) run++;
    const gap = Math.abs(own[0] - n) - 1; // so viele fremde Karten liegen bis zur nächsten eigenen dazwischen
    score += 1 + run + own.length * 0.5 - gap * 0.3;
  }
  return score;
}

// Nächste Aktion: { t: 'play', arg: karte } | { t: 'draw' } | { t: 'end' }
export function chooseMove(v, seat) {
  const can = playable(v, seat);
  if (v.drawn) {
    if (can.length) return { t: 'play', arg: can[0] };
    return canDraw(v, seat) ? { t: 'draw' } : { t: 'end' };
  }
  if (!can.length) return canDraw(v, seat) ? { t: 'draw' } : { t: 'end' };
  const ranked = can.map((c) => ({ c, w: worth(v, seat, c) })).sort((a, b) => b.w - a.w || numOf(b.c) - numOf(a.c));
  const others = v.seats.filter((p) => p !== seat).map((p) => (Array.isArray(v.hands[p]) ? v.hands[p].length : v.hands[p]));
  const dump = Math.min(...others) <= ENDGAME || v.hands[seat].length <= 2;
  if (!v.played || dump || ranked[0].w > 0) return { t: 'play', arg: ranked[0].c }; // mindestens eine Karte
  return { t: 'end' };
}

// Ohne Hilfen (allein): ein Schummelzug als erste Aktion des Zugs – oder null, wenn sich keiner anbietet.
// Möglich: eine Karte ohne Anschluss loswerden (die höchste), nicht nachziehen, obwohl nichts passt,
// oder gar nichts legen, obwohl etwas passt (Schlüsselkarte festhalten).
export function cheatMove(v, seat, rng = Math.random) {
  if (v.played || v.drawn) return null;
  const hand = v.hands[seat];
  const can = playable(v, seat);
  const options = [];
  const stuck = hand.filter((c) => !fits(v.rows, c)).sort((a, b) => numOf(b) - numOf(a));
  if (stuck.length && hand.length > 1) options.push({ t: 'play', arg: stuck[0] });
  if (!can.length && v.talon > 0) options.push({ t: 'end' });
  if (can.length && can.every((c) => worth(v, seat, c) < 0)) options.push({ t: 'end' });
  return options.length ? options[Math.floor(rng() * options.length)] : null;
}
