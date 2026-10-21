// Schwimmen (auch „31“ oder „Schnauz“) für 2–4 als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion
// liefert einen neuen Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei Doppelkopf: 0 = Host (+z),
// 1 = links (−x), 2 = gegenüber (−z, der Gast), 3 = rechts (+x). Zu zweit sitzen 0 und 2, zu dritt 0, 1, 2. Freie Sitze
// spielt der Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln (de.wikipedia.org/wiki/Schwimmen_(Kartenspiel), abgerufen 21.10.2026): 32 Karten (Skatblatt). Jeder bekommt
// 3 Karten, der Geber zwei Sätze zu je 3: Er sieht sich den ersten an und spielt ihn – dann kommt der zweite offen in
// die Mitte – oder er legt ihn offen in die Mitte und nimmt den zweiten. Der Rest ist der verdeckte Stapel. Vorhand
// (links vom Geber) beginnt, gespielt wird im Uhrzeigersinn. Kartenwerte: Ass 11, König, Dame, Bube und 10 je 10, sonst
// die Augen. Gezählt wird die höchste Summe einer Farbe (höchstens 31); drei gleiche Werte zählen 30½. Ein Zug: eine
// Karte oder alle drei mit der Mitte tauschen (nie zwei), schieben oder klopfen. Nach dem Klopfen ist jeder andere noch
// einmal dran (tauschen oder schieben), dann wird aufgedeckt. Schieben alle nacheinander, kommt die Mitte beiseite und
// drei neue Karten vom Stapel werden aufgedeckt; wer zuerst geschoben hat, ist wieder dran. Wer 31 hat, deckt sofort
// auf, die Runde ist zu Ende (auch gleich nach dem Geben). Feuer (dort als Variante): drei Asse beenden die Runde
// ebenso, alle anderen verlieren ein Leben. Sonst verliert, wer am wenigsten hat, ein Leben (mehrere bei Gleichstand).
// Jeder hat 3 Leben; wer keins mehr hat, „schwimmt“ und scheidet beim nächsten Verlust aus. Der Letzte gewinnt.
//
// Eigene Festlegungen: Feuer zählt (höher als 31). Haben alle Übrigen gleich viel, verliert keiner. Gleichstand bei 30½
// ist einfach Gleichstand. Jeder darf schwimmen. Klopfen geht jederzeit (auch im ersten Zug), aber nur einmal je Runde.
// Reicht der Stapel nicht für eine neue Mitte, wird das Beiseitegelegte gemischt und kommt unter den Stapel. Der Geber
// wechselt jede Runde zum Nächsten, der noch dabei ist; der erste wird ausgelost. 31 und Feuer erkennt das Spiel selbst.
// Sind beide Menschen draußen (allein: der Mensch), endet die Partie.
//
// „Ohne Hilfen“ (free): Das Spiel deckt 31 nicht selbst auf – wer 31 oder Feuer hat, drückt „31!“ (geht jederzeit
// während der Runde). Schummeln (merkt sich nur der Host, mit kurzem Grund): zwei Karten tauschen, „31!“ ohne 31 (zählt
// dann als 31) und als Klopfer nach dem Klopfen noch tauschen (außer der Reihe). Jede Aktion ist anfechtbar, bis ein
// anderer etwas tut (am Rundenende: bis zur nächsten Runde). Erwischt: die Aktion wird zurückgenommen und der Schummler
// verliert die Runde allein (1 Leben). Fehlalarm: der Ankläger setzt seinen nächsten Zug aus (er schiebt).
import { makeDeck, shuffle, suitOf, rankOf, SUITS, cardName } from '../karten/cards.js';

export const SEAT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export const LIVES = 3;
export const BEST = 31;
export const HALF = 30.5; // drei gleiche Werte
export const FEUER = 33; // drei Asse – höher als alles
export { cardName };

// Kartenwert: Ass 11, Bilder und 10 je 10, sonst die Augen
export const valueOf = (c) => (rankOf(c) === 'A' ? 11 : 'TJQK'.includes(rankOf(c)) ? 10 : Number(rankOf(c)));

// Punkte einer Hand: höchste Summe einer Farbe, drei Gleiche 30½, drei Asse Feuer
export function points(hand) {
  if (!Array.isArray(hand) || hand.length !== 3) return 0;
  if (hand.every((c) => rankOf(c) === rankOf(hand[0]))) return rankOf(hand[0]) === 'A' ? FEUER : HALF;
  return Math.max(...SUITS.map((s) => hand.filter((c) => suitOf(c) === s).reduce((sum, c) => sum + valueOf(c), 0)));
}
export const pointsName = (x) => (x === FEUER ? 'Feuer' : x === HALF ? '30½' : String(x));

const len = (x) => (Array.isArray(x) ? x.length : x); // im vollen Stand Liste, in fremder Sicht Anzahl
const withHand = (hands, seat, hand) => hands.map((h, p) => (p === seat ? hand : h));
export const active = (s) => s.seats.filter((p) => s.gone[p] === null);
// nächster Sitz im Uhrzeigersinn, der noch dabei ist
export function nextActive(s, seat) {
  for (let k = 1; k <= 4; k++) {
    const p = (seat + k) % 4;
    if (s.seats.includes(p) && s.gone[p] === null) return p;
  }
  return seat;
}
// Zählt im Spielstand: angesagte 31 zählt ohne Hilfen auch ohne 31 als 31
const scoreOf = (s, p) => (s.claims.includes(p) ? Math.max(points(s.hands[p]), BEST) : points(s.hands[p]));

// --- Neue Partie ---
// Erst wählt der Host, wie viele am Tisch sitzen (setup), dann wird ausgeteilt. humans = Sitze der Menschen.
export function newGame({ humans = [0], free = false, seq = 0 } = {}) {
  return {
    seq,
    events: [{ type: 'setup' }],
    phase: 'setup', // setup → choose → play → over (Runde vorbei) → choose …
    humans,
    free,
    count: null, // Spieler am Tisch (2–4)
    seats: [],
    lives: [0, 0, 0, 0],
    gone: [null, null, null, null], // Runde, in der jemand ausgeschieden ist (null = noch dabei)
    done: false, // Partie entschieden
    winner: null,
    games: 0,
    round: 0,
    dealer: null,
    turn: null,
    hands: [[], [], [], []],
    spare: [], // zweiter Satz des Gebers (verdeckt)
    middle: [], // offen in der Mitte
    talon: [],
    discard: [], // beiseitegelegte Mitten
    pushes: 0, // so viele haben zuletzt hintereinander geschoben
    knocker: null,
    claims: [], // ohne Hilfen: wer „31!“ gerufen hat
    skip: [], // ohne Hilfen: wer nach einem Fehlalarm den nächsten Zug aussetzt
    result: null,
    cheat: null, // ohne Hilfen: anfechtbare Aktion { player, legal, prev, why } – nur beim Host
  };
}

// Spielerzahl wählen (nur der Host, Sitz 0) – gleich danach wird ausgeteilt
export function setup(s, seat, count, rng = Math.random) {
  if (s.phase !== 'setup' || seat !== 0 || !SEAT_SETS[count]) return null;
  return match({ ...s, count }, rng);
}

// Neue Partie mit dieser Spielerzahl: alle haben 3 Leben, der erste Geber wird ausgelost
function match(s, rng) {
  const seats = SEAT_SETS[s.count];
  const lives = [0, 1, 2, 3].map((p) => (seats.includes(p) ? LIVES : 0));
  const first = seats[Math.floor(rng() * seats.length)];
  return deal({ ...s, seats, lives, gone: [null, null, null, null], done: false, winner: null, games: s.games + 1, round: 0, dealer: null, skip: [] }, rng, first);
}

function deal(s, rng, dealer = nextActive(s, s.dealer)) {
  const deck = shuffle(makeDeck('7'), rng);
  const hands = [[], [], [], []];
  let k = 0;
  for (const p of active(s)) hands[p] = deck.slice(k, (k += 3));
  return {
    ...s,
    phase: 'choose',
    round: s.round + 1,
    dealer,
    turn: dealer,
    hands,
    spare: deck.slice(k, k + 3),
    middle: [],
    talon: deck.slice(k + 3),
    discard: [],
    pushes: 0,
    knocker: null,
    claims: [],
    result: null,
    cheat: null,
    seq: s.seq + 1,
    events: [{ type: 'deal', dealer }],
  };
}

// --- Der Geber entscheidet: ersten Satz behalten (keep) oder offen in die Mitte legen und den zweiten nehmen ---
export function choose(s, seat, keep) {
  if (s.phase !== 'choose' || s.turn !== seat || typeof keep !== 'boolean') return null;
  const middle = keep ? s.spare : s.hands[seat];
  const hands = keep ? s.hands : withHand(s.hands, seat, s.spare);
  const next = { ...s, phase: 'play', hands, spare: [], middle, seq: s.seq + 1 };
  const events = [{ type: 'choose', player: seat, keep, middle }];
  // 31 oder Feuer gleich nach dem Geben: sofort aufdecken (Feuer zuerst, sonst ab Vorhand)
  if (!s.free) {
    const order = [];
    for (let p = nextActive(s, seat), k = 0; k < active(s).length; p = nextActive(s, p), k++) order.push(p);
    const lucky = order.find((p) => points(hands[p]) === FEUER) ?? order.find((p) => points(hands[p]) >= BEST);
    if (lucky !== undefined) return finish(next, [...events, { type: 'show', player: lucky }], 'show', lucky);
  }
  return turnTo(next, nextActive(s, seat), events);
}

// --- Tauschen: give = eigene Karten, take = Karten aus der Mitte (gleich viele; erlaubt sind 1 oder 3) ---
// Ohne Hilfen gehen auch zwei – und der Klopfer darf außer der Reihe tauschen (beides Schummeln).
export function swap(s, seat, give, take) {
  if (s.phase !== 'play' || !Array.isArray(give) || !Array.isArray(take)) return null;
  const n = give.length;
  if (!n || n > 3 || take.length !== n || new Set(give).size !== n || new Set(take).size !== n) return null;
  if (!give.every((c) => s.hands[seat].includes(c)) || !take.every((c) => s.middle.includes(c))) return null;
  const onTurn = s.turn === seat;
  const late = !onTurn && s.knocker === seat;
  if (!onTurn && !(late && s.free)) return null;
  const legal = onTurn && n !== 2;
  if (!legal && !s.free) return null;
  let next = begin(s, seat);
  if (n === 2) next = mark(next, 'zwei Karten auf einmal getauscht');
  if (late) next = mark(next, 'nach dem Klopfen noch getauscht');
  // Karte für Karte: give[i] kommt in der Mitte an den Platz von take[i], take[i] auf der Hand an den von give[i]
  const hand = s.hands[seat].map((c) => (give.includes(c) ? take[give.indexOf(c)] : c));
  const middle = s.middle.map((c) => (take.includes(c) ? give[take.indexOf(c)] : c));
  next = { ...next, hands: withHand(next.hands, seat, hand), middle, pushes: 0, seq: s.seq + 1 };
  const events = [{ type: 'swap', player: seat, give, take }];
  if (late) return { ...next, events };
  if (!s.free && points(hand) >= BEST) return finish(next, [...events, { type: 'show', player: seat }], 'show', seat);
  return advance(next, events);
}

// --- Schieben: nicht tauschen. Haben alle nacheinander geschoben, gibt es eine neue Mitte. ---
export function push(s, seat, rng = Math.random) {
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const [next, events] = pushed(begin(s, seat), seat, [], false, rng);
  return advance({ ...next, seq: s.seq + 1 }, events);
}

function pushed(s, seat, events, skipped, rng = Math.random) {
  const pushes = s.pushes + 1;
  const all = [...events, { type: 'push', player: seat, ...(skipped && { skipped: true }) }];
  if (pushes < active(s).length) return [{ ...s, pushes }, all];
  // Alle haben geschoben: Mitte beiseite, drei neue vom Stapel (reicht er nicht, kommt das Beiseitegelegte gemischt darunter)
  let talon = s.talon;
  let discard = [...s.discard, ...s.middle];
  const mixed = talon.length < 3;
  if (mixed) {
    talon = [...shuffle(discard, rng), ...talon];
    discard = [];
  }
  const cards = talon.slice(-3).reverse();
  return [{ ...s, pushes: 0, middle: cards, talon: talon.slice(0, -3), discard }, [...all, { type: 'renew', old: s.middle, cards, mixed }]];
}

// --- Klopfen: jeder andere ist noch einmal dran, dann wird aufgedeckt ---
export function knock(s, seat) {
  if (s.phase !== 'play' || s.turn !== seat || s.knocker !== null) return null;
  const next = { ...begin(s, seat), knocker: seat, pushes: 0, seq: s.seq + 1 };
  return advance(next, [{ type: 'knock', player: seat }]);
}

// --- „31!“ – aufdecken, die Runde ist sofort vorbei (nur ohne Hilfen; sonst deckt das Spiel selbst auf) ---
export function claim(s, seat) {
  if (s.phase !== 'play' || !active(s).includes(seat) || s.claims.includes(seat)) return null;
  const real = points(s.hands[seat]);
  const legal = real >= BEST;
  if (!legal && !s.free) return null;
  let next = begin(s, seat);
  if (!legal) next = mark(next, `„31!“ gerufen, aber nur ${pointsName(real)} gehabt`);
  next = { ...next, claims: [...s.claims, seat], seq: s.seq + 1 };
  return finish(next, [{ type: 'claim', player: seat, feuer: real === FEUER }], 'claim', seat);
}

// Nächster Zug: wer aussetzen muss, schiebt von selbst; kommt das Klopfen herum, wird aufgedeckt
function advance(s, events) {
  return turnTo(s, nextActive(s, s.turn), events);
}

function turnTo(s, seat, events) {
  if (s.knocker !== null && seat === s.knocker) return finish(s, events, 'knock', s.knocker);
  if (!s.skip.includes(seat)) return { ...s, turn: seat, events };
  const [next, all] = pushed({ ...s, turn: seat, skip: s.skip.filter((p) => p !== seat) }, seat, events, true);
  return turnTo(next, nextActive(next, seat), all);
}

// Rundenende: alle Karten offen. reason = 'knock' | 'show' (31/Feuer erkannt) | 'claim' | 'caught' (by = Schummler)
function finish(s, events, reason, by) {
  const seats = active(s);
  const pts = [0, 1, 2, 3].map((p) => (seats.includes(p) ? points(s.hands[p]) : null));
  const score = (p) => scoreOf(s, p);
  const feuer = seats.find((p) => pts[p] === FEUER) ?? null;
  let losers;
  if (reason === 'caught') losers = [by];
  else if (feuer !== null) losers = seats.filter((p) => p !== feuer);
  else {
    const low = Math.min(...seats.map(score));
    losers = seats.every((p) => score(p) === low) ? [] : seats.filter((p) => score(p) === low);
  }
  const lives = [...s.lives];
  const gone = [...s.gone];
  for (const p of losers) {
    if (lives[p] > 0) lives[p]--;
    else gone[p] = s.round;
  }
  const next = { ...s, lives, gone, skip: s.skip.filter((p) => gone[p] === null) };
  const left = active(next);
  const done = left.length <= 1 || !left.some((p) => s.humans.includes(p));
  const winner = done && left.length === 1 ? left[0] : null;
  const result = { reason, by, points: pts, losers, feuer, out: losers.filter((p) => gone[p] !== null) };
  return {
    ...next,
    phase: 'over',
    turn: null,
    done,
    winner,
    result,
    events: [...events, { type: 'over', losers, feuer, reason, by }],
  };
}

// Nächste Runde – oder nach dem Ende eine neue Partie. Wer zuletzt geschummelt hat, startet sie nicht, solange man ihn
// noch erwischen kann.
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  const base = { ...s, cheat: null };
  return s.done ? match(base, rng) : deal(base, rng);
}

// Andere Spielerzahl (nur der Host): zurück zur Auswahl
export function regroup(s, seat) {
  if (s.phase !== 'over' || seat !== 0 || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1 });
}

// --- Ohne Hilfen ---
// Jede Aktion ist anfechtbar (prev = Stand davor), bis ein anderer etwas tut. Handelt derselbe Spieler gleich noch
// einmal (Klopfer tauscht nach, „31!“ hinterher), bleibt seine erste Aktion mit anfechtbar – sonst wüsche er sie rein.
function begin(s, seat) {
  if (!s.free || s.cheat?.player === seat) return s;
  return { ...s, cheat: { player: seat, legal: true, prev: { ...s, cheat: null }, why: [] } };
}

const mark = (s, why) => ({ ...s, cheat: { ...s.cheat, legal: false, why: [...new Set([...s.cheat.why, why])] } });

// „Geschummelt!“ gegen die offene Aktion. Erwischt: zurück auf den Stand davor, der Schummler verliert die Runde allein.
// Fehlalarm: der Ankläger setzt seinen nächsten Zug aus (ist er gerade dran, gleich diesen).
// target = wessen Aktion gemeint ist: Hat inzwischen ein anderer gespielt, gilt die Anklage nicht (null).
export function accuse(s, by, target) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !s.seats.includes(by)) return null;
  if (target !== undefined && target !== c.player) return null;
  if (!c.legal) {
    const why = c.why.slice(0, 2).join(' und ');
    return finish({ ...c.prev, seq: s.seq + 1 }, [{ type: 'caught', player: c.player, by, why }], 'caught', c.player);
  }
  const next = { ...s, cheat: null, seq: s.seq + 1 };
  const events = [{ type: 'fehlalarm', player: by, target: c.player }];
  if (s.gone[by] !== null) return { ...next, events };
  if (s.phase === 'play' && s.turn === by) {
    const [sat, all] = pushed(next, by, events, true);
    return advance(sat, all);
  }
  return { ...next, skip: [...new Set([...s.skip, by])], events };
}

// Die offene Aktion gelten lassen (allein: der Computer am Rundenende) – sonst hielte sie die nächste Runde auf
export const waive = (s, seat) => (s.free && s.cheat && s.cheat.player !== seat ? { ...s, cheat: null } : null);

// Was ein Sitz sehen darf: eigene Karten und die Mitte offen, von den anderen nur die Anzahl (nach der Runde alles),
// den zweiten Satz des Gebers sieht keiner. Von der anfechtbaren Aktion nur, wer sie gemacht hat.
export function viewFor(s, seat) {
  const over = s.phase === 'over';
  return {
    ...s,
    hands: s.hands.map((h, p) => (p === seat || over ? h : h.length)),
    spare: s.spare.length,
    talon: s.talon.length,
    discard: s.discard.length,
    cheat: s.cheat && { player: s.cheat.player },
  };
}

export const handSize = (s, seat) => len(s.hands[seat]);
