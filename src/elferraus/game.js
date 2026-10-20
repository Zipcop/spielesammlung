// Elfer raus! für 2–4 als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei Doppelkopf: 0 = Host (+z), 1 = links (−x),
// 2 = gegenüber (−z, der Gast), 3 = rechts (+x). Zu zweit sitzen 0 und 2, zu dritt 0, 1, 2. Freie Sitze spielt der
// Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln: Ravensburger-Anleitung „Elfer raus!“ (Spiel Nr. 27 143 6, © 2011 Ravensburger Spieleverlag; Grundspiel,
// gleichlautend die englische Ravensburger-Fassung „Eleven starts!“ – beide auf ravensburger.de/spielanleitungen):
// 80 Karten, je 1–20 in Rot, Gelb, Grün und Blau. Zu zweit und zu dritt bekommt jeder 20 Karten, zu viert 15; der Rest
// ist der verdeckte Nachziehstapel. Zu zweit werden die 20 blauen Karten aussortiert (60 Karten).
// Wer die rote 11 hat, legt sie in die Mitte und beginnt (sonst Gelb, Grün, Blau; gar kein Elfer: neu mischen).
// Dann reihum im Uhrzeigersinn: an einen Elfer links die gleichfarbige 10 (weiter abwärts bis 1) oder rechts die 12
// (aufwärts bis 20) anlegen, oder einen weiteren Elfer als neue Reihe auslegen. Man darf beliebig viele passende
// Karten legen, muss aber mindestens eine, wenn man kann – Karten zurückhalten, um andere zu blockieren, ist erlaubt.
// Wer nicht kann, zieht eine Karte: passt sie, legt er sie an und der Nächste ist dran; sonst zieht er weiter,
// höchstens 3 Karten. Stapel leer: wer nicht kann, passt. Wer zuerst keine Karten mehr hat, gewinnt die Runde.
// Mehrere Runden: Jeder schreibt die Summe seiner Restkarten auf, der Gewinner 0 – wenig ist gut.
//
// Eigene Festlegungen: Die gezogene Karte muss gelegt werden, wenn sie passt (Pflicht „mindestens eine Karte“);
// danach ist der Zug vorbei. Der Anfangs-Elfer liegt gleich beim Austeilen. Geht gar nichts mehr (Stapel leer und
// eine ganze Runde lang hat keiner angelegt – nur nach Schummeln möglich), endet die Runde: Jeder schreibt seine
// Restpunkte auf, vorn ist, wer die wenigsten hat.
//
// „Ohne Hilfen“ (free): Jede Karte lässt sich legen (sie kommt auf die Seite ihrer Zahl, auch ohne Anschluss), ziehen
// und „Fertig“ gehen immer. Ob ein Zug regelwidrig war, merkt sich nur der Host (cheat, mit kurzem Grund). Der ganze
// Zug eines Spielers ist anfechtbar, bis der Nächste etwas tut. Erwischt: der Zug wird komplett zurückgenommen, der
// Schummler bekommt 2 Strafkarten und spielt ihn neu; Fehlalarm: der Ankläger zieht 1 Strafkarte (wie Mau-Mau, Rommé).
import { shuffle } from '../karten/cards.js';

export const COLORS = ['r', 'y', 'g', 'b']; // auch Rangfolge des Anfangs-Elfers
export const COLOR_NAMES = { r: 'Rot', y: 'Gelb', g: 'Grün', b: 'Blau' };
export const SEAT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export const HAND_SIZE = { 2: 20, 3: 20, 4: 15 };
export const DRAW_MAX = 3;
export const CHEAT_PENALTY = 2;
export const FALSE_ALARM_PENALTY = 1;

// Kartentexte: Farbe + Zahl, 'r11' = Rot 11, 'b20' = Blau 20
export const colorOf = (c) => c[0];
export const numOf = (c) => Number(c.slice(1));
export const cardName = (c) => `${COLOR_NAMES[colorOf(c)]} ${numOf(c)}`;
export const isCard = (c) => typeof c === 'string' && /^[rygb]([1-9]|1\d|20)$/.test(c);
export const colorsFor = (n) => (n === 2 ? COLORS.slice(0, 3) : COLORS);

export function makeDeck(n = 4) {
  return colorsFor(n).flatMap((c) => Array.from({ length: 20 }, (_, i) => c + (i + 1)));
}

const len = (x) => (Array.isArray(x) ? x.length : x); // Hand/Stapel: im vollen Stand Liste, in fremder Sicht Anzahl
const withHand = (hands, seat, hand) => hands.map((h, p) => (p === seat ? hand : h));
export const nextSeat = (seats, seat) => seats[(seats.indexOf(seat) + 1) % seats.length];
export const points = (hand) => hand.reduce((sum, c) => sum + numOf(c), 0);

// Oberste Karte einer Seite (ohne Karte dort: der Elfer)
export const topOf = (row, side) => (row[side].length ? numOf(row[side].at(-1)) : 11);
const sideOf = (n) => (n === 11 ? 'mid' : n < 11 ? 'left' : 'right');

// Passt die Karte jetzt an die Reihen?
export function fits(rows, card) {
  const row = rows[colorOf(card)];
  const n = numOf(card);
  if (!row) return false;
  if (n === 11) return !row.mid;
  if (!row.mid) return false;
  return n < 11 ? n === topOf(row, 'left') - 1 : n === topOf(row, 'right') + 1;
}

// --- Neue Partie ---
// Erst wählt der Host, wie viele am Tisch sitzen (setup), dann wird ausgeteilt. humans = Sitze der Menschen.
export function newGame({ humans = [0], free = false, seq = 0 } = {}) {
  return {
    seq,
    events: [{ type: 'setup' }],
    phase: 'setup', // setup → play → over
    humans,
    free,
    count: null, // Spieler am Tisch (2–4)
    seats: [],
    colors: [],
    round: 0,
    hands: [[], [], [], []],
    talon: [],
    rows: {}, // je Farbe { mid: Elfer liegt, left: [10 … abwärts], right: [12 … aufwärts] }
    starter: null,
    turn: null,
    played: 0, // in diesem Zug angelegt
    drawn: 0, // in diesem Zug gezogen
    fresh: null, // zuletzt gezogene Karte (nur sie darf nach dem Ziehen noch gelegt werden)
    passes: 0, // Züge in Folge ohne Anlegen
    result: null, // { winner, out, points }
    score: [0, 0, 0, 0],
    list: [], // { round, points }
    cheat: null, // ohne Hilfen: anfechtbarer Zug { player, legal, prev, why } – nur beim Host
  };
}

// Spielerzahl wählen (nur der Host, Sitz 0) – gleich danach wird ausgeteilt
export function setup(s, seat, count, rng = Math.random) {
  if (s.phase !== 'setup' || seat !== 0 || !SEAT_SETS[count]) return null;
  return deal({ ...s, count, score: [0, 0, 0, 0], list: [], round: 0 }, rng);
}

function deal(s, rng) {
  const seats = SEAT_SETS[s.count];
  const colors = colorsFor(s.count);
  for (;;) {
    const deck = shuffle(makeDeck(s.count), rng);
    const hands = [[], [], [], []];
    let k = 0;
    for (const p of seats) hands[p] = deck.slice(k, (k += HAND_SIZE[s.count]));
    const first = colors.map((c) => `${c}11`).find((c) => seats.some((p) => hands[p].includes(c)));
    if (!first) continue; // kein Elfer ausgeteilt – neu mischen
    const starter = seats.find((p) => hands[p].includes(first));
    hands[starter] = hands[starter].filter((c) => c !== first);
    return {
      ...s,
      phase: 'play',
      round: s.round + 1,
      seats,
      colors,
      hands,
      talon: deck.slice(k),
      rows: Object.fromEntries(colors.map((c) => [c, { mid: c === colorOf(first), left: [], right: [] }])),
      starter,
      turn: nextSeat(seats, starter),
      played: 0,
      drawn: 0,
      fresh: null,
      passes: 0,
      result: null,
      cheat: null,
      seq: s.seq + 1,
      events: [{ type: 'deal', starter, first }],
    };
  }
}

// --- Was gerade erlaubt ist (klappt auch mit der Sicht des Spielers) ---
export function playable(s, seat) {
  if (s.phase !== 'play' || s.turn !== seat) return [];
  if (s.drawn) return s.fresh && !s.played && fits(s.rows, s.fresh) ? [s.fresh] : [];
  return s.hands[seat].filter((c) => fits(s.rows, c));
}

export const canDraw = (s, seat) => s.phase === 'play' && s.turn === seat && !s.played && s.drawn < DRAW_MAX && len(s.talon) > 0 && !playable(s, seat).length;

// „Fertig“: nach mindestens einer Karte – oder „Passen“, wenn nichts passt und nicht mehr gezogen werden darf
export const canEnd = (s, seat) => s.phase === 'play' && s.turn === seat
  && (s.played > 0 || (!playable(s, seat).length && (!len(s.talon) || s.drawn >= DRAW_MAX)));

// --- Aktionen ---
export function play(s, seat, card) {
  if (s.phase !== 'play' || s.turn !== seat || !s.hands[seat].includes(card)) return null;
  const legal = playable(s, seat).includes(card);
  if (!legal && !s.free) return null;
  let next = begin(s, seat);
  if (!legal) next = mark(next, playFault(s, card));
  const row = next.rows[colorOf(card)];
  const side = sideOf(numOf(card));
  const rows = { ...next.rows, [colorOf(card)]: side === 'mid' ? { ...row, mid: true } : { ...row, [side]: [...row[side], card] } };
  next = {
    ...next,
    rows,
    hands: withHand(next.hands, seat, next.hands[seat].filter((c) => c !== card)),
    played: s.played + 1,
    fresh: card === s.fresh ? null : s.fresh,
    seq: s.seq + 1,
    events: [{ type: 'play', player: seat, card }],
  };
  if (!next.hands[seat].length) return finish(next, seat);
  if (!s.free && (s.drawn || !playable(next, seat).length)) return endTurn(next); // gezogene Karte gelegt / nichts passt mehr
  return next;
}

export function draw(s, seat) {
  if (s.phase !== 'play' || s.turn !== seat || !s.talon.length) return null;
  const legal = canDraw(s, seat);
  if (!legal && !s.free) return null;
  let next = begin(s, seat);
  if (!legal) next = mark(next, drawFault(s, seat));
  const card = s.talon.at(-1);
  next = {
    ...next,
    talon: s.talon.slice(0, -1),
    hands: withHand(next.hands, seat, [...next.hands[seat], card]),
    drawn: s.drawn + 1,
    fresh: card,
    seq: s.seq + 1,
    events: [{ type: 'draw', player: seat, card }],
  };
  if (!s.free && !fits(next.rows, card) && (next.drawn >= DRAW_MAX || !next.talon.length)) return endTurn(next);
  return next;
}

// „Fertig“ bzw. „Passen“
export function end(s, seat) {
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const legal = canEnd(s, seat);
  if (!legal && !s.free) return null;
  let next = begin(s, seat);
  if (!legal) next = mark(next, endFault(s, seat));
  return endTurn({ ...next, seq: s.seq + 1, events: [] });
}

function endTurn(s) {
  const seat = s.turn;
  const passes = s.played ? 0 : s.passes + 1;
  const next = { ...s, turn: nextSeat(s.seats, seat), played: 0, drawn: 0, fresh: null, passes, events: [...s.events, { type: 'end', player: seat, played: s.played }] };
  return !next.talon.length && passes >= s.seats.length ? finish(next, null) : next; // eine Runde lang ging nichts
}

// Rundenende: out = Sitz, der keine Karten mehr hat (null = keiner – dann ist vorn, wer die wenigsten Punkte hat)
function finish(s, out) {
  const pts = [0, 1, 2, 3].map((p) => (s.seats.includes(p) ? points(s.hands[p]) : 0));
  const winner = out ?? lowest(s.seats, pts);
  return {
    ...s,
    phase: 'over',
    turn: null,
    fresh: null,
    result: { winner, out: out !== null, points: pts },
    score: s.score.map((x, p) => x + pts[p]),
    list: [...s.list, { round: s.round, points: pts }],
    events: [...s.events, { type: 'over', winner, out: out !== null }],
  };
}

// Wer die wenigsten Punkte hat (bei Gleichstand keiner)
function lowest(seats, pts) {
  const low = Math.min(...seats.map((p) => pts[p]));
  const best = seats.filter((p) => pts[p] === low);
  return best.length === 1 ? best[0] : null;
}

// Nächste Runde mit gleicher Spielerzahl; wer zuletzt geschummelt hat, startet sie nicht, solange man ihn noch erwischen kann
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  return deal({ ...s, cheat: null }, rng);
}

// Andere Spielerzahl (nur der Host): zurück zur Auswahl, der Punktestand beginnt neu
export function regroup(s, seat) {
  if (s.phase !== 'over' || seat !== 0 || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1 });
}

// --- Ohne Hilfen ---
// Erste Aktion eines Zugs: ab hier ist dieser Zug anfechtbar (prev = Stand davor), der des Vorgängers nicht mehr
function begin(s, seat) {
  if (!s.free || s.cheat?.player === seat) return s;
  return { ...s, cheat: { player: seat, legal: true, prev: { ...s, cheat: null }, why: [] } };
}

const mark = (s, why) => ({ ...s, cheat: { ...s.cheat, legal: false, why: [...new Set([...s.cheat.why, why])] } });

function playFault(s, card) {
  if (s.drawn && s.played) return 'nach der gezogenen Karte noch weitergelegt';
  if (s.drawn && card !== s.fresh) return 'nach dem Ziehen eine andere als die gezogene Karte gelegt';
  const row = s.rows[colorOf(card)];
  const col = COLOR_NAMES[colorOf(card)];
  if (!row.mid) return `${cardName(card)} gelegt, bevor ${col} 11 lag`;
  const side = sideOf(numOf(card));
  return `${cardName(card)} passt nicht an ${col} ${topOf(row, side)}`;
}

// Gründe nennen nur offene Karten – was in der Hand passte, bleibt verdeckt (der Zug wird ja zurückgenommen)
function drawFault(s, seat) {
  if (s.played) return 'nach dem Anlegen noch gezogen';
  if (s.drawn >= DRAW_MAX) return `${s.drawn + 1} Karten gezogen statt höchstens ${DRAW_MAX}`;
  if (s.drawn) return 'weitergezogen, obwohl die gezogene Karte passte';
  return 'gezogen, obwohl eine Karte passte';
}

function endFault(s, seat) {
  const can = playable(s, seat);
  if (can.length) return s.drawn ? 'die gezogene Karte passte und wurde nicht angelegt' : 'nichts angelegt, obwohl eine Karte passte';
  return s.drawn ? `nur ${s.drawn} statt bis zu ${DRAW_MAX} Karten nachgezogen` : 'nicht nachgezogen, obwohl nichts passte';
}

// „Geschummelt!“ gegen den offenen Zug. Erwischt: Zug zurück, 2 Strafkarten, der Schummler ist wieder dran.
// Fehlalarm: der Ankläger zieht 1 Karte (nach Rundenende zählt sie als Punkte).
// target = wessen Zug gemeint ist: Hat inzwischen ein anderer gezogen, gilt die Anklage nicht (null) – sonst träfe sie ihn.
export function accuse(s, by, target) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !s.seats.includes(by)) return null;
  if (target !== undefined && target !== c.player) return null;
  if (!c.legal) {
    const why = (c.why ?? []).slice(0, 2).join(' und ');
    return penalty({ ...c.prev, cheat: null, seq: s.seq + 1, events: [{ type: 'caught', player: c.player, by, why }] }, c.player, CHEAT_PENALTY);
  }
  return penalty({ ...s, cheat: null, seq: s.seq + 1, events: [{ type: 'fehlalarm', player: by, target: c.player }] }, by, FALSE_ALARM_PENALTY);
}

// Den offenen Zug gelten lassen (allein: der Computer am Rundenende) – sonst hielte er den anderen von der nächsten Runde ab
export const waive = (s, seat) => (s.free && s.cheat && s.cheat.player !== seat ? { ...s, cheat: null } : null);

// Strafkarten vom Stapel (ist er leer, gibt es eben weniger)
function penalty(s, seat, n) {
  const cards = s.talon.slice(-n).reverse();
  const next = {
    ...s,
    talon: s.talon.slice(0, s.talon.length - cards.length),
    hands: withHand(s.hands, seat, [...s.hands[seat], ...cards]),
    events: [...s.events, ...cards.map((card) => ({ type: 'draw', player: seat, card, why: 'strafe' }))],
  };
  if (s.phase !== 'over' || !cards.length) return next;
  const extra = points(cards); // Runde schon vorbei: die Strafkarten zählen gleich mit
  const add = (pts) => pts.map((x, p) => (p === seat ? x + extra : x));
  const pts = add(s.result.points);
  return {
    ...next,
    result: { ...s.result, points: pts, winner: s.result.out ? s.result.winner : lowest(s.seats, pts) },
    score: add(s.score),
    list: s.list.map((r, i) => (i === s.list.length - 1 ? { ...r, points: add(r.points) } : r)),
  };
}

// Was ein Sitz sehen darf: eigene Karten offen, von den anderen nur die Anzahl (nach der Runde alles), vom Stapel die Höhe.
// Vom anfechtbaren Zug nur, wer ihn gemacht hat.
export function viewFor(s, seat) {
  const over = s.phase === 'over';
  return {
    ...s,
    hands: s.hands.map((h, p) => (p === seat || over ? h : h.length)),
    talon: s.talon.length,
    fresh: s.turn === seat ? s.fresh : null,
    events: s.events.map((e) => (e.type === 'draw' && e.player !== seat ? { ...e, card: null } : e)),
    cheat: s.cheat && { player: s.cheat.player },
  };
}

export const handSize = (s, seat) => len(s.hands[seat]);
