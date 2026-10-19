// Rommé für zwei als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig, z. B. nicht dran oder Figur stimmt nicht). Spieler 0 = Host, 1 = Gast bzw. Computer.
// Der Gast bekommt nur viewFor(state, 1) zu sehen.
//
// Regeln („Standard“, Quellen: Spielkarten.com-Anleitung 330016977 (ASS Altenburger), Schmidt-Spiele-Anleitung 49420
// „Rommé/Bridge/Canasta“, pagat.com/de/rummy/rummy.html):
// 110 Karten (2 × 52 + 6 Joker). Jeder bekommt 13 Karten, wer anfängt 14 (Spielkarten.com) – er zieht im ersten Zug
// nicht, sondern legt nur ab. Figuren: Satz = 3–4 gleiche Werte in verschiedenen Farben, Reihe = ab 3 aufeinander-
// folgende Karten einer Farbe, Ass vor der 2 (A-2-3) oder hinter dem König (D-K-A), kein Umlauf K-A-2.
// Joker ersetzen jede Karte und zählen so viel wie sie (beim Herauskommen). Ein Zug: ziehen (Stapel oder oberste
// Ablagekarte), Figuren auslegen, anlegen, Joker austauschen, zum Schluss immer eine Karte ablegen.
// Herauskommen (erstes Auslegen) mit mindestens 30 Punkten, auch aus mehreren Figuren im selben Zug; erst danach
// anlegen (bei sich und beim anderen) und Joker austauschen. Wer die letzte Karte ablegt, gewinnt die Runde und
// bekommt die Restpunkte des anderen (Joker 20, Ass 11, Bilder und 10 je 10, sonst der Zahlenwert).
//
// Wo die Quellen auseinandergehen, gilt hier:
// - Erste Runde (jeder einmal dran): nur ziehen und ablegen, noch nicht auslegen (Spielkarten.com – passt zum
//   Austeilen mit 14 Karten; Schmidt teilt 13 aus und deckt eine Karte auf).
// - Herauskommen ab 30 Punkten (Spielkarten.com; Schmidt: 31, nennt 30 als Variante).
// - Anlegen und Joker tauschen erst nach dem Herauskommen, dann aber schon im selben Zug (Schmidt).
// - Ein eingetauschter Joker muss im selben Zug wieder ausgelegt oder angelegt werden (Schmidt).
// - Die letzte Karte muss abgelegt werden – man kann also nicht alle Karten auslegen (Schmidt und Spielkarten.com;
//   pagat erlaubt das Ausgehen ohne Abwurf).
// - Die vom Ablagestapel genommene Karte darf im selben Zug nicht wieder abgelegt werden (pagat) – sonst könnte man
//   endlos tauschen, ohne zu ziehen.
// - Nachziehstapel leer: die Ablage ohne die oberste Karte wird gemischt und neuer Stapel (pagat-Hausregel „mischen“).
// - Ist der Stapel zum zweiten Mal aufgebraucht, endet die Runde (pagat-Hausregel – sonst kann sie hängen, wenn beide
//   nur noch 1–2 Karten haben und nirgends mehr anlegen können): Wer weniger Restpunkte hat, bekommt die Differenz;
//   gleich viele = unentschieden (winner = NOBODY, keine Punkte).
// - Joker im Satz: steht für eine fehlende Farbe; in der Reihe für die Stelle, an der er liegt.
// Für die Bedienung: „Zug zurücksetzen“ nimmt alles zurück, was man in diesem Zug ausgelegt, angelegt oder
// getauscht hat (gezogen bleibt gezogen) – damit bleibt niemand mit zu wenig Punkten oder einem Joker hängen.
//
// „Ohne Hilfen“ (free, nur zu zweit): Auslegen, Anlegen, Tauschen und Ablegen gehen auch regelwidrig – das Spiel prüft
// dann nur, dass man dran ist, die Karten hat und zum Schluss eine Karte ablegen kann. Nach dem Ablegen kann der andere
// bis zu seinem Ziehen „Geschummelt!“ rufen (accuse) – gemeint ist der ganze letzte Zug: Stimmt es, wird er komplett
// zurückgenommen, der Schummler bekommt 2 Strafkarten und spielt ihn neu; sonst zieht der Ankläger 1 Strafkarte
// (wie Mau-Mau, Nicos Vorgaben vom 19.10.2026).
import { SUITS, RANKS, shuffle } from '../karten/cards.js';

export const HAND_SIZE = 13;
export const OPEN_MIN = 30;
export const JOKER_POINTS = 20;
export const NOBODY = -1; // winner bei Unentschieden
export const CHEAT_PENALTY = 2;
export const FALSE_ALARM_PENALTY = 1;

// Kartentexte: Farbe + Wert + Blatt a/b ('h7a' = Herz 7 aus dem ersten Blatt), Joker 'xr1' … 'xb3' (rot/schwarz).
// Die ersten beiden Zeichen sind das Kartenbild ('h7', 'xr').
export const isJoker = (c) => c[0] === 'x';
export const faceOf = (c) => c.slice(0, 2);
export const suitOf = (c) => c[0];
export const rankOf = (c) => c[1];

export function makeDeck() {
  const cards = [];
  for (const deck of ['a', 'b']) for (const s of SUITS) for (const r of RANKS) cards.push(s + r + deck);
  for (const color of ['r', 'b']) for (let i = 1; i <= 3; i++) cards.push(`x${color}${i}`);
  return cards;
}

const DECK = new Set(makeDeck());
export const isCard = (c) => typeof c === 'string' && DECK.has(c);

// Stelle in einer Reihe: 2 … 13 (König), Ass 1 oder 14
const posOf = (rank) => RANKS.indexOf(rank) + 2;
// Punkte einer Stelle in der Reihe (Ass vorn 1, hinten 11)
const valueAt = (pos) => (pos === 1 ? 1 : pos === 14 ? 11 : Math.min(pos, 10));
// Punkte eines Werts im Satz und auf der Hand (Ass 11)
const rankValue = (rank) => (rank === 'A' ? 11 : Math.min(posOf(rank), 10));

// Restpunkte einer Karte auf der Hand
export const cardPoints = (c) => (isJoker(c) ? JOKER_POINTS : rankValue(rankOf(c)));
export const handPoints = (hand) => hand.reduce((sum, c) => sum + cardPoints(c), 0);

// --- Figuren ---
// Satz: { kind: 'set', cards } – echte Karten nach Farbe, Joker hinten.
// Reihe: { kind: 'run', suit, low, cards } – Karte i liegt an Stelle low + i (Joker an seiner Stelle).
// Ohne Hilfen auch { kind: 'free', cards } – geschummelte Figur, an die nichts mehr regelgerecht passt.

const bySuit = (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b));
const realOf = (cards) => cards.filter((c) => !isJoker(c));

export function meldValue(m) {
  if (m.kind === 'free') return 0;
  if (m.kind === 'run') return m.cards.reduce((sum, c, i) => sum + valueAt(m.low + i), 0);
  return m.cards.length * rankValue(rankOf(realOf(m.cards)[0]));
}

// Reihe mit n Karten ab Stelle low – oder null, wenn die Karten dort nicht hinpassen
function runAt(cards, low) {
  const real = realOf(cards);
  const n = cards.length;
  if (low < 1 || low + n - 1 > 14) return null;
  const slots = new Array(n).fill(null);
  for (const c of real) {
    const options = rankOf(c) === 'A' ? [1, 14] : [posOf(rankOf(c))];
    const i = options.map((p) => p - low).find((k) => k >= 0 && k < n && !slots[k]);
    if (i === undefined) return null;
    slots[i] = c;
  }
  const jokers = cards.filter(isJoker);
  if (slots.filter((x) => !x).length !== jokers.length) return null;
  return { kind: 'run', suit: suitOf(real[0]), low, cards: slots.map((x) => x ?? jokers.shift()) };
}

// Alle Möglichkeiten, diese Karten als Figur zu legen
function arrangements(cards) {
  const real = realOf(cards);
  if (cards.length < 3 || !real.length || new Set(cards).size !== cards.length) return [];
  const out = [];
  const rank = rankOf(real[0]);
  if (cards.length <= 4 && real.every((c) => rankOf(c) === rank) && new Set(real.map(suitOf)).size === real.length) {
    out.push({ kind: 'set', cards: [...[...real].sort(bySuit), ...cards.filter(isJoker)] });
  }
  if (real.every((c) => suitOf(c) === suitOf(real[0]))) {
    for (let low = 1; low + cards.length - 1 <= 14; low++) {
      const run = runAt(cards, low);
      if (run) out.push(run);
    }
  }
  return out;
}

// Alle Lagen dieser Karten, die beste zuerst: die meisten Punkte – bei Gleichstand lieber Reihe, dann die höhere Lage.
// hint = { kind, low } lässt nur diese Lage übrig (Joker vorn oder hinten, Satz oder Reihe).
export function arrangeOptions(cards, hint = null) {
  let options = arrangements(cards);
  if (hint) options = options.filter((m) => m.kind === hint.kind && (m.kind === 'set' || m.low === hint.low));
  const score = (m) => meldValue(m) * 100 + (m.kind === 'run' ? 50 + m.low : 0);
  return options.sort((a, b) => score(b) - score(a));
}

// Karten als Figur anordnen (beste bzw. per hint gewählte Lage) oder null
export const arrange = (cards, hint = null) => arrangeOptions(cards, hint)[0] ?? null;

// Karte an eine Figur anlegen → neue Figur oder null. end = 'low' | 'high' (nur für Joker an Reihen von Belang)
export function extend(m, card, end = null) {
  if (m.kind === 'free') return null;
  if (m.kind === 'set') {
    if (m.cards.length >= 4) return null;
    const real = realOf(m.cards);
    if (!isJoker(card) && (rankOf(card) !== rankOf(real[0]) || real.some((c) => suitOf(c) === suitOf(card)))) return null;
    return { ...m, cards: [...[...real, ...realOf([card])].sort(bySuit), ...m.cards.filter(isJoker), ...(isJoker(card) ? [card] : [])] };
  }
  const high = m.low + m.cards.length - 1;
  const fitsAt = (p) => isJoker(card) || (suitOf(card) === m.suit && (rankOf(card) === 'A' ? p === 1 || p === 14 : posOf(rankOf(card)) === p));
  const fitsLow = m.low > 1 && fitsAt(m.low - 1);
  const fitsHigh = high < 14 && fitsAt(high + 1);
  if (fitsLow && (!fitsHigh || end === 'low')) return { ...m, low: m.low - 1, cards: [card, ...m.cards] };
  return fitsHigh ? { ...m, cards: [...m.cards, card] } : null; // passt beides, kommt die Karte nach hinten
}

// Echte Karte gegen einen Joker der Figur tauschen → { meld, joker } oder null
export function swapIn(m, card) {
  if (isJoker(card) || m.kind === 'free') return null;
  let i = -1;
  if (m.kind === 'set') {
    const real = realOf(m.cards);
    if (rankOf(card) === rankOf(real[0]) && !real.some((c) => suitOf(c) === suitOf(card))) i = m.cards.findIndex(isJoker);
  } else if (suitOf(card) === m.suit) {
    i = m.cards.findIndex((c, k) => isJoker(c) && (rankOf(card) === 'A' ? [1, 14].includes(m.low + k) : posOf(rankOf(card)) === m.low + k));
  }
  if (i < 0) return null;
  const cards = m.cards.map((c, k) => (k === i ? card : c));
  const meld = m.kind === 'set' ? { ...m, cards: [...realOf(cards).sort(bySuit), ...cards.filter(isJoker)] } : { ...m, cards };
  return { meld, joker: m.cards[i] };
}

// --- Spielstand ---

export function newGame(starter = 0, rng = Math.random, { score = [0, 0], free = false } = {}) {
  const talon = shuffle(makeDeck(), rng);
  const hands = [[], []];
  for (let i = 0; i < 2 * HAND_SIZE + 1; i++) hands[(starter + i) % 2].push(talon.pop()); // abwechselnd, der Anfänger bekommt 14
  const s = {
    starter,
    turn: starter,
    phase: 'play', // 'draw' = erst ziehen · 'play' = auslegen, anlegen, ablegen (der Anfänger zieht im ersten Zug nicht)
    hands,
    talon, // Nachziehstapel (verdeckt), oberste Karte = letzte
    pile: [], // Ablage (offen), oberste Karte = letzte
    melds: [], // ausgelegte Figuren mit owner
    opened: [false, false], // schon herausgekommen
    turns: 0, // fertige Züge – solange jeder noch nicht einmal dran war (< 2), wird nicht ausgelegt
    taken: null, // in diesem Zug von der Ablage genommen – darf nicht gleich wieder abgelegt werden
    fresh: [], // Figuren dieses Zugs, solange die 30 Punkte zum Herauskommen noch nicht erreicht sind
    swapped: [], // in diesem Zug eingetauschte Joker – müssen noch in diesem Zug wieder auf den Tisch
    changed: false, // in diesem Zug schon etwas ausgelegt, angelegt oder getauscht („Zug zurücksetzen“ möglich)
    start: null, // Stand nach dem Ziehen, für „Zug zurücksetzen“: { hand, melds, opened }
    restocks: 0, // so oft wurde die Ablage schon zum neuen Stapel gemischt
    winner: null, // Spieler, NOBODY (unentschieden) oder null (läuft)
    points: 0, // Punkte, die der Gewinner bekommt (Restpunkte des anderen bzw. die Differenz)
    score, // Punkte aus allen Runden dieser Sitzung
    free, // ohne Hilfen: Schummeln möglich
    clean: true, // ohne Hilfen: in diesem Zug bisher alles regelgerecht
    cheat: null, // ohne Hilfen: letzter Zug, solange man ihn anprangern kann: { player, legal, prev }
    turnStart: null, // ohne Hilfen: Stand am Anfang dieses Zugs (nach dem Ziehen) – dahin geht es bei „erwischt“ zurück
    seq: 0,
    events: [{ type: 'deal' }],
  };
  return free ? { ...s, turnStart: s } : s;
}

const other = (player) => 1 - player;
const withHand = (hands, player, hand) => hands.map((h, p) => (p === player ? hand : h));
const withMeld = (melds, i, m) => melds.map((x, k) => (k === i ? m : x));
const freshValue = (s) => s.fresh.reduce((sum, i) => sum + meldValue(s.melds[i]), 0);

// Darf der Spieler gerade auslegen/anlegen/ablegen?
const playing = (s, player) => s.winner === null && s.turn === player && s.phase === 'play';
export const canMeld = (s, player) => playing(s, player) && s.turns >= 2;
// Karten, die man am Ende ablegen darf
export const discardable = (s, hand) => hand.filter((c) => c !== s.taken && !s.swapped.includes(c));

// Ziehen: from = 'talon' (Nachziehstapel) oder 'pile' (oberste Ablagekarte)
export function draw(s, player, from, rng = Math.random) {
  if (s.winner !== null || s.turn !== player || s.phase !== 'draw') return null;
  let { talon, pile, restocks = 0 } = s;
  const events = [];
  let card;
  if (from === 'pile') {
    if (!pile.length) return null;
    card = pile.at(-1);
    pile = pile.slice(0, -1);
  } else if (from === 'talon') {
    if (!talon.length) {
      if (pile.length < 2) return null; // nichts zum Mischen da – dann bleibt nur die Ablagekarte
      talon = shuffle(pile.slice(0, -1), rng);
      pile = pile.slice(-1);
      restocks++;
      events.push({ type: 'shuffle', count: talon.length });
    }
    card = talon.at(-1);
    talon = talon.slice(0, -1);
  } else return null;
  events.push({ type: 'draw', player, from, card });
  const hand = [...s.hands[player], card];
  const next = {
    ...s,
    talon,
    pile,
    hands: withHand(s.hands, player, hand),
    phase: 'play',
    taken: from === 'pile' ? card : null,
    restocks,
    start: { hand, melds: s.melds, opened: s.opened },
    clean: true,
    cheat: null, // wer zieht, hat den letzten Zug des anderen hingenommen
    seq: s.seq + 1,
    events,
  };
  return next.free ? { ...next, turnStart: { ...next, turnStart: null } } : next;
}

// Prüft die Karten aus der Hand: alle vorhanden, verschieden – und danach bleibt etwas zum Ablegen übrig
function takeFromHand(s, player, cards) {
  const hand = s.hands[player];
  if (!Array.isArray(cards) || !cards.length || new Set(cards).size !== cards.length || !cards.every((c) => isCard(c) && hand.includes(c))) return null;
  const rest = hand.filter((c) => !cards.includes(c));
  return discardable(s, rest).length ? rest : null;
}

// Neue Figur auslegen. hint = { kind, low } (siehe arrange)
function strictMeld(s, player, cards, hint) {
  if (!canMeld(s, player)) return null;
  const rest = takeFromHand(s, player, cards);
  const m = rest && arrange(cards, hint && typeof hint === 'object' ? hint : null);
  if (!m) return null;
  const index = s.melds.length;
  const next = {
    ...s,
    hands: withHand(s.hands, player, rest),
    melds: [...s.melds, { owner: player, ...m }],
    swapped: s.swapped.filter((j) => !cards.includes(j)),
    changed: true,
    seq: s.seq + 1,
    events: [{ type: 'meld', player, index, cards: m.cards }],
  };
  if (s.opened[player]) return next;
  const fresh = [...s.fresh, index];
  const points = freshValue({ ...next, fresh });
  if (points < OPEN_MIN) return { ...next, fresh };
  return { ...next, fresh: [], opened: s.opened.map((o, p) => o || p === player), events: [...next.events, { type: 'open', player, points }] };
}

// Eine Karte an eine ausliegende Figur anlegen (eigene oder fremde)
function strictLayoff(s, player, card, index, end) {
  if (!canMeld(s, player) || !s.opened[player] || !Number.isInteger(index) || !s.melds[index]) return null;
  const rest = takeFromHand(s, player, [card]);
  const m = rest && extend(s.melds[index], card, end === 'low' || end === 'high' ? end : null);
  if (!m) return null;
  return {
    ...s,
    hands: withHand(s.hands, player, rest),
    melds: withMeld(s.melds, index, m),
    swapped: s.swapped.filter((j) => j !== card),
    changed: true,
    seq: s.seq + 1,
    events: [{ type: 'layoff', player, index, card, at: m.cards.indexOf(card) }],
  };
}

// Joker aus einer Figur gegen die passende echte Karte tauschen – der Joker kommt auf die Hand
function strictSwap(s, player, card, index) {
  if (!canMeld(s, player) || !s.opened[player] || !Number.isInteger(index) || !s.melds[index]) return null;
  if (!isCard(card) || !s.hands[player].includes(card)) return null;
  const res = swapIn(s.melds[index], card);
  if (!res) return null;
  return {
    ...s,
    hands: withHand(s.hands, player, [...s.hands[player].filter((c) => c !== card), res.joker]),
    melds: withMeld(s.melds, index, { ...s.melds[index], ...res.meld }),
    swapped: [...s.swapped, res.joker],
    changed: true,
    seq: s.seq + 1,
    events: [{ type: 'swap', player, index, card, joker: res.joker }],
  };
}

// Alles zurücknehmen, was in diesem Zug ausgelegt, angelegt oder getauscht wurde
export function undo(s, player) {
  if (!playing(s, player) || !s.changed || !s.start) return null;
  return {
    ...s,
    hands: withHand(s.hands, player, s.start.hand),
    melds: s.start.melds,
    opened: s.start.opened,
    fresh: [],
    swapped: [],
    changed: false,
    clean: true, // alles aus diesem Zug ist zurückgenommen
    seq: s.seq + 1,
    events: [{ type: 'undo', player }],
  };
}

// Karte ablegen – beendet den Zug. Letzte Karte abgelegt = Runde gewonnen.
function strictDiscard(s, player, card) {
  if (!playing(s, player) || !isCard(card)) return null;
  const hand = s.hands[player];
  if (!discardable(s, hand).includes(card)) return null;
  if (s.fresh.length) return null; // erst auf 30 Punkte kommen oder zurücknehmen
  if (s.swapped.some((j) => hand.includes(j))) return null; // eingetauschter Joker muss erst wieder auf den Tisch
  return finishDiscard(s, player, card);
}

// Karte auf die Ablage, Zug zu Ende – und ggf. die Runde (letzte Karte oder Stapel zum zweiten Mal leer)
function finishDiscard(s, player, card) {
  const rest = s.hands[player].filter((c) => c !== card);
  const next = {
    ...s,
    hands: withHand(s.hands, player, rest),
    pile: [...s.pile, card],
    turn: other(player),
    phase: 'draw',
    turns: s.turns + 1,
    taken: null,
    fresh: [],
    swapped: [],
    changed: false,
    start: null,
    seq: s.seq + 1,
    events: [{ type: 'discard', player, card }],
  };
  // In einer Sicht (Prüfung beim Gast) sind fremde Hand und Stapel nur Zahlen
  const theirs = s.hands[other(player)];
  const left = Array.isArray(s.talon) ? s.talon.length : s.talon;
  if (rest.length && !left && ((s.restocks ?? 0) >= 1 || next.pile.length < 2)) {
    // Stapel zum zweiten Mal aufgebraucht: weniger Restpunkte gewinnt die Differenz
    const [a, b] = [rest, theirs].map((h) => (Array.isArray(h) ? handPoints(h) : 0));
    const winner = a === b ? NOBODY : a < b ? player : other(player);
    const points = Math.abs(a - b);
    return {
      ...next,
      phase: 'over',
      winner,
      points,
      score: s.score.map((v, p) => (p === winner ? v + points : v)),
      events: [...next.events, { type: 'exhausted', winner, points }],
    };
  }
  if (rest.length) return next;
  const points = Array.isArray(theirs) ? handPoints(theirs) : 0;
  return {
    ...next,
    turn: player,
    phase: 'over',
    winner: player,
    points,
    score: s.score.map((v, p) => (p === player ? v + points : v)),
    events: [...next.events, { type: 'win', player, points }],
  };
}

// --- Aktionen: mit Regeln – und ohne Hilfen notfalls regelwidrig (macht den Zug „unsauber“) ---

export function meld(s, player, cards, hint = null) {
  return strictMeld(s, player, cards, hint) ?? (s.free ? looseMeld(s, player, cards) : null);
}

export function layoff(s, player, card, index, end = null) {
  return strictLayoff(s, player, card, index, end) ?? (s.free ? looseLayoff(s, player, card, index, end) : null);
}

export function swap(s, player, card, index) {
  return strictSwap(s, player, card, index) ?? (s.free ? looseSwap(s, player, card, index) : null);
}

export function discard(s, player, card) {
  const strict = strictDiscard(s, player, card);
  if (!s.free) return strict;
  const next = strict ?? looseDiscard(s, player, card);
  return next && { ...next, cheat: { player, legal: !!strict && s.clean, prev: s.turnStart } };
}

// Ohne Hilfen: Karten aus der Hand (mindestens min) – es muss nur eine zum Ablegen übrig bleiben
function looseCards(s, player, cards, min) {
  const hand = s.hands[player];
  if (!playing(s, player) || !Array.isArray(cards) || cards.length < min || new Set(cards).size !== cards.length) return null;
  if (!cards.every((c) => isCard(c) && hand.includes(c))) return null;
  const rest = hand.filter((c) => !cards.includes(c));
  return rest.length ? rest : null;
}

// Beliebige Karten (ab 3) als Figur – wer so auslegt, gilt als herausgekommen
function looseMeld(s, player, cards) {
  const rest = looseCards(s, player, cards, 3);
  if (!rest) return null;
  const m = arrange(cards) ?? { kind: 'free', cards: [...cards] };
  const index = s.melds.length;
  return {
    ...s,
    hands: withHand(s.hands, player, rest),
    melds: [...s.melds, { owner: player, ...m }],
    opened: s.opened.map((o, p) => o || p === player),
    fresh: [],
    swapped: s.swapped.filter((j) => !cards.includes(j)),
    changed: true,
    clean: false,
    seq: s.seq + 1,
    events: [{ type: 'meld', player, index, cards: m.cards }],
  };
}

// Karte an eine Figur, auch wenn sie nicht passt (dann hinten dran, die Figur wird „geschummelt“)
function looseLayoff(s, player, card, index, end) {
  if (!Number.isInteger(index) || !s.melds[index]) return null;
  const rest = looseCards(s, player, [card], 1);
  if (!rest) return null;
  const old = s.melds[index];
  const m = extend(old, card, end === 'low' || end === 'high' ? end : null) ?? { owner: old.owner, kind: 'free', cards: [...old.cards, card] };
  return {
    ...s,
    hands: withHand(s.hands, player, rest),
    melds: withMeld(s.melds, index, m),
    swapped: s.swapped.filter((j) => j !== card),
    changed: true,
    clean: false,
    seq: s.seq + 1,
    events: [{ type: 'layoff', player, index, card, at: m.cards.indexOf(card) }],
  };
}

// Beliebige echte Karte gegen den ersten Joker der Figur
function looseSwap(s, player, card, index) {
  if (!playing(s, player) || !Number.isInteger(index) || !s.melds[index]) return null;
  if (!isCard(card) || isJoker(card) || !s.hands[player].includes(card)) return null;
  const old = s.melds[index];
  const i = old.cards.findIndex(isJoker);
  if (i < 0) return null;
  const cards = old.cards.map((c, k) => (k === i ? card : c));
  const joker = old.cards[i];
  return {
    ...s,
    hands: withHand(s.hands, player, [...s.hands[player].filter((c) => c !== card), joker]),
    melds: withMeld(s.melds, index, { owner: old.owner, ...(arrange(cards) ?? { kind: 'free', cards }) }),
    swapped: [...s.swapped, joker],
    changed: true,
    clean: false,
    seq: s.seq + 1,
    events: [{ type: 'swap', player, index, card, joker }],
  };
}

// Jede Karte der Hand – mit zu wenig Punkten ausgelegt gilt man trotzdem als herausgekommen
function looseDiscard(s, player, card) {
  if (!playing(s, player) || !isCard(card) || !s.hands[player].includes(card)) return null;
  const opened = s.fresh.length ? s.opened.map((o, p) => o || p === player) : s.opened;
  return finishDiscard({ ...s, opened, fresh: [] }, player, card);
}

// „Geschummelt!“ – gegen den letzten Zug des anderen, bis man selbst zieht (auch nach Rundenende).
// Erwischt: alles wie am Anfang dieses Zugs (nach seinem Ziehen), dazu 2 Strafkarten – der Schummler spielt neu.
// Fehlalarm: der Ankläger zieht 1 Strafkarte.
export function accuse(s, player, rng = Math.random) {
  const c = s.cheat;
  if (!s.free || !c || c.player === player || (player !== 0 && player !== 1)) return null;
  if (!c.legal) {
    const back = { ...c.prev, cheat: null, seq: s.seq + 1, events: [{ type: 'caught', player: c.player, by: player }] };
    return penalty(back, c.player, CHEAT_PENALTY, rng);
  }
  return penalty({ ...s, cheat: null, seq: s.seq + 1, events: [{ type: 'fehlalarm', player }] }, player, FALSE_ALARM_PENALTY, rng);
}

// n Strafkarten vom Stapel (ist er leer, wird die Ablage gemischt; liegt nichts mehr da, gibt es eben weniger)
function penalty(s, player, n, rng) {
  let { talon, pile, restocks = 0 } = s;
  const events = [...s.events];
  const cards = [];
  while (cards.length < n) {
    if (!talon.length) {
      if (pile.length < 2) break;
      talon = shuffle(pile.slice(0, -1), rng);
      pile = pile.slice(-1);
      restocks++;
      events.push({ type: 'shuffle', count: talon.length });
    }
    cards.push(talon.at(-1));
    events.push({ type: 'draw', player, from: 'talon', why: 'strafe', card: talon.at(-1) });
    talon = talon.slice(0, -1);
  }
  const mid = s.turn === player && s.phase === 'play'; // mitten im eigenen Zug: auch „Zug zurücksetzen“ behält sie
  const add = (hands) => withHand(hands, player, [...hands[player], ...cards]);
  return {
    ...s,
    talon,
    pile,
    restocks,
    hands: add(s.hands),
    start: mid && s.start ? { ...s.start, hand: [...s.start.hand, ...cards] } : s.start,
    turnStart: mid && s.turnStart ? { ...s.turnStart, talon, pile, restocks, hands: add(s.turnStart.hands) } : s.turnStart,
    events,
  };
}

// Nächste Runde: der andere fängt an, die Punkte bleiben stehen
export function again(s, rng = Math.random) {
  return s.winner === null ? null : newGame(other(s.starter), rng, { score: s.score, free: s.free });
}

// Was ein Spieler sehen darf: eigene Karten offen, vom anderen nur die Anzahl (nach Rundenende alles),
// vom Nachziehstapel nur die Höhe, gezogene Stapelkarten des anderen ohne Bild.
export function viewFor(s, player) {
  return {
    ...s,
    hands: s.hands.map((h, p) => (p === player || s.winner !== null ? h : h.length)),
    talon: s.talon.length,
    start: null,
    turnStart: null,
    cheat: s.cheat && { player: s.cheat.player }, // ob regelwidrig und der Stand davor bleiben beim Host
    events: s.events.map((e) => (e.type === 'draw' && e.from === 'talon' && e.player !== player ? withoutCard(e) : e)),
  };
}

const withoutCard = ({ card, ...e }) => e;

// Kartenzahl eines Spielers – im vollen Stand eine Liste, in der Sicht des anderen nur die Zahl
export const handSize = (s, player) => (Array.isArray(s.hands[player]) ? s.hands[player].length : s.hands[player]);
// Punkte, die in diesem Zug schon zum Herauskommen ausliegen
export const openPoints = freshValue;
