// Mau-Mau für zwei als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert
// einen neuen Zustand oder null (ungültig, z. B. nicht dran oder Karte passt nicht).
// Spieler 0 = Host, 1 = Gast bzw. Computer. Der Gast bekommt nur viewFor(state, 1) zu sehen.
//
// Regeln (gängigste Variante nach de.wikipedia „Mau-Mau (Kartenspiel)“ und de.wikibooks „Kartenspiele: MauMau“):
// 32 Karten, je 5 auf die Hand, die erste offene Karte wirkt nicht. Gleiche Farbe oder gleicher Wert legen.
// Wer nicht kann oder will, zieht eine Karte und darf sie sofort legen, wenn sie passt.
// 7 = der andere zieht 2 – oder legt selbst eine 7, dann zieht der nächste 4 (6, 8 …); danach normaler Zug.
// 8 = der andere setzt aus. Bube = auf alles außer einen Buben, Farbe wünschen.
// Wer die vorletzte Karte legt, sagt „Mau“ – sonst 1 Strafkarte. Wer keine Karte mehr hat, gewinnt.
// Nachziehstapel leer → die Ablage außer der obersten Karte wird gemischt und neuer Stapel.
//
// „Ohne Hilfen“ (free): Jede Karte der Hand darf gelegt werden, auch regelwidrig, und eine gezogene Karte
// darf man immer behalten oder legen. Bis zum nächsten Zug kann der andere „Geschummelt!“ rufen (accuse):
// Stimmt es, kommt die Karte zurück auf die Hand und es gibt 2 Strafkarten, sonst 1 Karte für den Ankläger.
import { makeDeck, shuffle, suitOf, rankOf, SUITS } from '../karten/cards.js';

export const HAND_SIZE = 5;
export const MAU_PENALTY = 1;
export const CHEAT_PENALTY = 2;
export const FALSE_ALARM_PENALTY = 1;

export function newGame(starter = 0, rng = Math.random, { free = false } = {}) {
  const talon = shuffle(makeDeck('7'), rng);
  const hands = [[], []];
  for (let i = 0; i < 2 * HAND_SIZE; i++) hands[(starter + i) % 2].push(talon.pop()); // abwechselnd austeilen
  const pile = [talon.pop()];
  return {
    starter,
    turn: starter,
    hands,
    talon, // Nachziehstapel (verdeckt), oberste Karte = letzte
    pile, // Ablage (offen), oberste Karte = letzte
    wish: null, // gewünschte Farbe nach einem Buben
    sevens: 0, // gelegte 7er in Folge, für die noch nicht gezogen wurde (je 2 Karten)
    drawn: null, // gerade gezogene Karte, die noch gelegt werden darf
    winner: null,
    seq: 0, // zählt die Aktionen (für die Anzeige)
    events: [{ type: 'deal' }], // was die letzte Aktion bewirkt hat – für Animation und Text
    free, // ohne Hilfen: Schummeln möglich
    cheat: null, // letzter gelegter Zug, solange man ihn anprangern kann: { player, legal, prev }
  };
}

export const top = (s) => s.pile.at(-1);
const other = (player) => 1 - player;
const withHand = (hands, player, hand) => hands.map((h, p) => (p === player ? hand : h));

// Darf diese Karte jetzt auf die Ablage? (klappt auch mit der Sicht eines Spielers)
export function fits(s, card) {
  if (s.sevens > 0) return rankOf(card) === '7'; // offene 7: nur mit einer 7 weitergeben
  if (rankOf(card) === 'J') return rankOf(top(s)) !== 'J'; // Bube auf alles, nur nicht auf einen Buben
  if (s.wish) return suitOf(card) === s.wish;
  return suitOf(card) === suitOf(top(s)) || rankOf(card) === rankOf(top(s));
}

// Karten, die der Spieler jetzt legen darf – nach dem Ziehen nur noch die gezogene
export function playable(s, player) {
  if (s.winner !== null || s.turn !== player) return [];
  return (s.drawn ? [s.drawn] : s.hands[player]).filter((c) => fits(s, c));
}

// arg = { card, wish, mau }: wish = Wunschfarbe beim Buben, mau = „Mau“ angesagt
export function play(s, player, arg) {
  const { card, wish = null, mau = false } = arg ?? {};
  const legal = playable(s, player).includes(card);
  const cheating = s.free && s.winner === null && s.turn === player && s.hands[player].includes(card);
  if (!legal && !cheating) return null;
  const rest = s.hands[player].filter((c) => c !== card);
  const jack = rankOf(card) === 'J' && rest.length > 0; // mit der letzten Karte muss niemand mehr wünschen
  if (jack && !SUITS.includes(wish)) return null;
  let next = {
    ...s,
    hands: withHand(s.hands, player, rest),
    pile: [...s.pile, card],
    wish: jack ? wish : null,
    sevens: 0, // eine offene 7 mit einer anderen Karte überdeckt – geht nur beim Schummeln
    drawn: null,
    seq: s.seq + 1,
    events: [{ type: 'play', player, card, wish: jack ? wish : null }],
    // Ein noch offener eigener Schummelzug (z. B. vor einer 8) bleibt anfechtbar – sonst könnte der Schummler
    // die Frist mit seinem nächsten Zug selbst schließen
    cheat: !s.free ? null : s.cheat?.player === player && !s.cheat.legal ? s.cheat : { player, legal, prev: { ...s, cheat: null } },
  };
  if (!rest.length) return { ...next, winner: player };
  if (rest.length === 1) {
    next.events.push({ type: 'mau', player, said: mau === true });
    if (mau !== true) next = take(next, player, MAU_PENALTY, 'mau');
  }
  if (rankOf(card) === '7') return { ...next, sevens: s.sevens + 1, turn: other(player) };
  if (rankOf(card) === '8') return { ...next, events: [...next.events, { type: 'skip', player: other(player) }] }; // gleich nochmal dran
  return { ...next, turn: other(player) };
}

// Karte ziehen. Bei offener 7 sind es 2 je 7 – danach geht der Zug normal weiter.
// Sonst eine Karte: passt sie, darf sie gelegt werden (oder pass), sonst ist der andere dran.
// Ohne Hilfen verrät das Spiel nicht, ob die gezogene Karte passt: Man legt sie oder drückt „Weiter“.
export function draw(s, player, rng = Math.random) {
  if (s.winner !== null || s.turn !== player || s.drawn) return null;
  const base = { ...s, seq: s.seq + 1, events: [], cheat: keepOwn(s, player) };
  if (s.sevens > 0) return { ...take(base, player, 2 * s.sevens, 'sieben', rng), sevens: 0 };
  const next = take(base, player, 1, 'zug', rng);
  const card = next.hands[player].length > s.hands[player].length ? next.hands[player].at(-1) : null;
  if (card && (s.free || fits(next, card))) return { ...next, drawn: card };
  return endTurn(next, player); // passt nicht oder es gab keine Karte mehr
}

// Gezogene Karte behalten statt legen
export function pass(s, player) {
  if (s.winner !== null || s.turn !== player || !s.drawn) return null;
  return endTurn({ ...s, seq: s.seq + 1, events: [], cheat: keepOwn(s, player) }, player, true);
}

// „Geschummelt!“ – nur gegen den letzten Zug des anderen, solange danach nichts passiert ist.
// Erwischt: alles wie vor dem Zug, die Karte ist wieder auf der Hand, dazu 2 Strafkarten; der Schummler ist wieder dran.
// Fehlalarm: der Ankläger zieht 1 Karte.
export function accuse(s, player, rng = Math.random) {
  const c = s.cheat;
  if (!s.free || !c || c.player === player || (player !== 0 && player !== 1)) return null;
  if (!c.legal) {
    const back = { ...c.prev, seq: s.seq + 1, events: [{ type: 'caught', player: c.player, by: player }] };
    return take(back, c.player, CHEAT_PENALTY, 'strafe', rng);
  }
  const base = { ...s, seq: s.seq + 1, cheat: null, events: [{ type: 'fehlalarm', player }] };
  return take(base, player, FALSE_ALARM_PENALTY, 'fehlalarm', rng);
}

// Revanche: der andere fängt an
export function again(s, rng = Math.random) {
  return s.winner === null ? null : newGame(other(s.starter), rng, { free: s.free });
}

// Anfechtbar bleibt nur der eigene Zug – sobald der andere etwas tut, ist die Frist vorbei
const keepOwn = (s, player) => (s.cheat?.player === player ? s.cheat : null);

// kept = gezogene Karte bewusst behalten (statt: passte nicht)
const endTurn = (s, player, kept = false) => ({ ...s, drawn: null, turn: other(player), events: [...s.events, { type: 'pass', player, kept }] });

// n Karten vom Nachziehstapel nehmen; ist er leer, wird die Ablage ohne die oberste Karte neu gemischt.
// Liegt gar nichts mehr da (alle Karten auf der Hand), gibt es eben weniger.
function take(s, player, n, why, rng = Math.random) {
  let { talon, pile } = s;
  const events = [...s.events];
  const all = [];
  let chunk = [];
  const flush = () => chunk.length && events.push({ type: 'draw', player, why, count: chunk.length, cards: chunk });
  while (all.length < n) {
    if (!talon.length) {
      if (pile.length < 2) break;
      flush();
      chunk = [];
      talon = shuffle(pile.slice(0, -1), rng);
      pile = pile.slice(-1);
      events.push({ type: 'shuffle', count: talon.length });
    }
    all.push(talon.at(-1));
    chunk.push(talon.at(-1));
    talon = talon.slice(0, -1);
  }
  flush();
  if (all.length < n) events.push({ type: 'empty', player }); // nicht genug Karten da
  return { ...s, talon, pile, hands: withHand(s.hands, player, [...s.hands[player], ...all]), events };
}

// Was ein Spieler sehen darf: eigene Karten offen, vom anderen nur die Anzahl, vom Nachziehstapel nur die Höhe.
// Vom anfechtbaren Zug nur, wer ihn gemacht hat – ob er regelwidrig war und der Stand davor bleiben beim Host.
export function viewFor(s, player) {
  return {
    ...s,
    hands: s.hands.map((h, p) => (p === player ? h : h.length)),
    talon: s.talon.length,
    drawn: s.turn === player ? s.drawn : null,
    events: s.events.map((e) => (e.type === 'draw' && e.player !== player ? withoutCards(e) : e)),
    cheat: s.cheat && { player: s.cheat.player },
  };
}

const withoutCards = ({ cards, ...e }) => e;

// Kartenzahl eines Spielers – im vollen Stand eine Liste, in der Sicht des anderen nur die Zahl
export const handSize = (s, player) => (Array.isArray(s.hands[player]) ? s.hands[player].length : s.hands[player]);
