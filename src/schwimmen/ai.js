// Computer für Schwimmen: sieht nur seine Sicht (viewFor) und macht je Aufruf eine Aktion.
// Idee: Er rechnet jeden erlaubten Tausch durch (9 einzelne und „alle drei“) und nimmt den mit den meisten Punkten.
// Bringt keiner etwas, schiebt er – oder klopft, wenn sein Blatt gut genug ist. Je weniger Leben er hat, desto mehr
// will er fürs Klopfen haben (wer klopft und verliert, hat sich verschätzt). Nach fremdem Klopfen: letzter Tausch,
// wenn er etwas bringt. Als Geber behält er den ersten Satz ab 18 Punkten (ein zufälliger Satz bringt im Mittel knapp 16).
import { points, valueOf, BEST, FEUER } from './game.js';

export const KEEP = 18;
export const KNOCK = 26; // ab so vielen Punkten klopft er (mit nur noch einem Leben oder schwimmend: mehr)

// Alle Tausch-Möglichkeiten mit den Punkten danach: { give, take, pts } – sizes = erlaubte Anzahl (ohne Hilfen auch 2)
export function options(hand, middle, sizes = [1, 3]) {
  const out = [];
  if (sizes.includes(1)) {
    for (const g of hand) for (const t of middle) out.push({ give: [g], take: [t], pts: points(hand.map((c) => (c === g ? t : c))) });
  }
  if (sizes.includes(2)) {
    for (const keep of hand) {
      const give = hand.filter((c) => c !== keep);
      for (const rest of middle) {
        const take = middle.filter((c) => c !== rest);
        out.push({ give, take, pts: points([keep, ...take]) });
      }
    }
  }
  if (sizes.includes(3)) out.push({ give: [...hand], take: [...middle], pts: points(middle) });
  return out;
}

// Bester Tausch; bei gleichen Punkten der, der weniger hergibt (kleinste Summe der abgegebenen Werte)
export function best(list) {
  const given = (o) => o.give.reduce((sum, c) => sum + valueOf(c), 0);
  return [...list].sort((a, b) => b.pts - a.pts || given(a) - given(b))[0] ?? null;
}

const knockAt = (v, seat) => KNOCK + (v.lives[seat] <= 1 ? 1 : 0) + (v.lives[seat] === 0 ? 1 : 0);

// Nächste Aktion: { t: 'choose', arg: behalten } | { t: 'swap', arg: { give, take } } | { t: 'push' } | { t: 'knock' }
// | { t: 'claim' } (ohne Hilfen: 31 oder Feuer selbst aufdecken)
export function chooseMove(v, seat) {
  const hand = v.hands[seat];
  if (v.phase === 'choose') return { t: 'choose', arg: points(hand) >= KEEP };
  const now = points(hand);
  if (v.free && now >= BEST && !v.claims.includes(seat)) return { t: 'claim' };
  const top = best(options(hand, v.middle));
  if (top.pts >= BEST || top.pts === FEUER) return swapOf(top);
  if (v.knocker !== null) return top.pts > now ? swapOf(top) : { t: 'push' };
  if (now >= knockAt(v, seat) && top.pts <= now) return { t: 'knock' };
  return top.pts > now ? swapOf(top) : { t: 'push' };
}

const swapOf = (o) => ({ t: 'swap', arg: { give: o.give, take: o.take } });

// Ohne Hilfen (allein): ein Schummelzug statt des normalen – oder null, wenn sich keiner lohnt.
// Möglich: zwei Karten tauschen (wenn das klar mehr bringt), „31!“ rufen mit fast 31, klopfen und gleich danach
// außer der Reihe noch tauschen (then: danach lateSwap).
export function cheatMove(v, seat, rng = Math.random) {
  if (v.phase !== 'play' || v.turn !== seat) return null;
  const hand = v.hands[seat];
  const now = points(hand);
  const legal = best(options(hand, v.middle));
  const two = best(options(hand, v.middle, [2]));
  const list = [];
  if (two.pts >= Math.max(legal.pts, now) + 3) list.push(swapOf(two));
  if (now >= 27 && now < BEST) list.push({ t: 'claim' });
  if (v.knocker === null && now >= 23 && legal.pts > now) list.push({ t: 'knock', then: true });
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}

// Nach dem eigenen Klopfen außer der Reihe tauschen (Schummeln): bester Tausch mit der Mitte, wie sie jetzt liegt
export function lateSwap(v, seat) {
  if (v.phase !== 'play' || v.knocker !== seat) return null;
  const top = best(options(v.hands[seat], v.middle));
  return top.pts > points(v.hands[seat]) ? swapOf(top) : null;
}
