// Mühle als reine Funktionen. Der Host hält den Spielstand: Jede Aktion liefert einen neuen Zustand oder null
// (ungültig, z. B. nicht dran oder regelwidrig). Spieler 0 = Host, 1 = Gast bzw. Computer.
//
// Regeln (Standard, z. B. de.wikipedia.org/wiki/Mühle_(Spiel) und deep-muehle.de/muehle-spielregeln):
// - Jeder hat 9 Steine. Weiß fängt an. Zuerst werden die Steine abwechselnd auf freie Punkte gesetzt (Setzen),
//   danach zieht man einen eigenen Stein auf einen freien Nachbarpunkt (Ziehen). Wer nur noch 3 Steine hat,
//   darf mit einem Stein auf jeden freien Punkt springen (Springen).
// - Drei eigene Steine in einer Linie = Mühle: Wer eine Mühle schließt, nimmt einen gegnerischen Stein vom Brett.
//   Steine aus einer Mühle nur, wenn alle gegnerischen Steine in Mühlen stehen. Zwei Mühlen auf einmal = trotzdem
//   nur ein Stein (deep-muehle.de; Wikipedia nennt das für die Variante Morabaraba).
// - Verloren hat, wer nur noch 2 Steine hat oder nicht mehr ziehen kann.
// - Remis (gewählt nach deep-muehle.de): dieselbe Stellung zum dritten Mal oder 20 Züge je Spieler (40 Halbzüge)
//   in der Zug- und Sprungphase, ohne dass ein Stein geschlagen wurde.
//
// „Ohne Hilfen“ (free): Jeder Zug geht durch – auch springen mit mehr als 3 Steinen, ziehen statt setzen,
// schlagen ohne Mühle oder aus einer Mühle. Nach jedem Setzen oder Ziehen darf man einen gegnerischen Stein
// schlagen oder den Zug beenden (pass) – so verrät das Spiel nicht, ob eine Mühle zu ist. Bis der andere selbst
// setzt oder zieht, kann er „Geschummelt!“ rufen (accuse): Stimmt es, wird der ganze Zug zurückgenommen, der
// Schummler muss neu ziehen und bekommt eine Verwarnung; sonst trifft die Verwarnung den Ankläger (wie Schach).
// Bei der dritten Verwarnung ist die Partie verloren.
//
// Punkte 0–23: Ring r (0 außen, 1 Mitte, 2 innen) × Stelle k (0 links oben, dann im Uhrzeigersinn: 1 oben Mitte,
// 2 rechts oben, 3 rechts Mitte, 4 rechts unten, 5 unten Mitte, 6 links unten, 7 links Mitte) → Punkt r * 8 + k.

export const STONES = 9;
export const POINTS = 24;
export const MAX_STRIKES = 3;
export const QUIET_LIMIT = 40; // Halbzüge ohne Schlagen in der Zugphase → Remis

export const REASONS = {
  steine: 'Nur noch zwei Steine',
  blockiert: 'Kein Zug mehr möglich',
  wiederholung: 'Dreimal dieselbe Stellung',
  zuege: '20 Züge ohne Schlagen',
  schummeln: 'Dritte Verwarnung',
};

// Nachbarn: im Ring reihum, an den Mitten (k ungerade) auch quer zum Nachbarring
export const NEIGHBORS = Array.from({ length: POINTS }, (_, i) => {
  const r = Math.floor(i / 8);
  const k = i % 8;
  const out = [r * 8 + ((k + 1) % 8), r * 8 + ((k + 7) % 8)];
  if (k % 2 === 1) {
    if (r > 0) out.push(i - 8);
    if (r < 2) out.push(i + 8);
  }
  return out;
});

// 16 Mühlen: je Ring die vier Seiten, dazu die vier Querlinien durch die Mitten
export const MILLS = [
  ...[0, 1, 2].flatMap((r) => [[0, 1, 2], [2, 3, 4], [4, 5, 6], [6, 7, 0]].map((m) => m.map((k) => r * 8 + k))),
  ...[1, 3, 5, 7].map((k) => [k, 8 + k, 16 + k]),
];
const MILLS_AT = Array.from({ length: POINTS }, (_, i) => MILLS.filter((m) => m.includes(i)));

const isPoint = (i) => Number.isInteger(i) && i >= 0 && i < POINTS;
export const countOf = (board, p) => board.reduce((n, x) => n + (x === p ? 1 : 0), 0);
export const inMill = (board, i) => board[i] !== null && MILLS_AT[i].some((m) => m.every((j) => board[j] === board[i]));
// Darf dieser Stein (regelgerecht) geschlagen werden? Aus einer Mühle nur, wenn alle des Spielers in Mühlen stehen
export const takeable = (board, i) => board[i] !== null && (!inMill(board, i) || board.every((x, j) => x !== board[i] || inMill(board, j)));
const closesMill = (board, i) => inMill(board, i);

// Phase eines Spielers: Setzen (Steine in der Hand), Springen (genau 3 Steine) oder Ziehen
export function phaseOf(s, p) {
  if (s.hand[p] > 0) return 'place';
  return countOf(s.board, p) === 3 ? 'fly' : 'move';
}

// white = welcher Spieler Weiß hat und anfängt (0 oder 1)
export function newGame({ white = 0, free = false } = {}) {
  return {
    white,
    free,
    board: Array(POINTS).fill(null), // je Punkt: null oder Spieler 0/1
    hand: [STONES, STONES],
    turn: white,
    step: 'move', // move = setzen oder ziehen · take = Stein schlagen (ohne Hilfen: oder Zug beenden)
    closed: false, // in diesem Zug wurde eine Mühle geschlossen
    last: null, // letzter Zug: { player, from, to, took }
    quiet: 0, // Halbzüge ohne Schlagen in der Zugphase
    positions: [], // Stellungen seit dem letzten Schlagen (Zugphase), für die Wiederholung
    result: null, // { winner: 0 | 1 | null, reason }
    strikes: [0, 0], // Verwarnungen (ohne Hilfen)
    // Zug des Spielers, der zuletzt dran war, solange man ihn anprangern kann (ohne Hilfen):
    // { player, why: [Gründe], prev: Stand vor dem Zug } – why und prev nur beim Host (forGuest)
    cheat: null,
    verdict: null, // Ergebnis von „Geschummelt!“: { caught, player (bekommt die Verwarnung), by, why }
    seq: 0,
    events: [{ type: 'start', player: white }],
  };
}

// Revanche: die Farben werden getauscht
export function again(s) {
  return s.result ? newGame({ white: 1 - s.white, free: s.free }) : null;
}

const mayAct = (s, p) => !s.result && (p === 0 || p === 1) && s.turn === p;

// Beginn eines Zugs: ohne Hilfen schließt er die Frist des anderen und merkt sich den Stand davor
function begin(s, p) {
  if (!s.free) return { ...s, verdict: null };
  return { ...s, verdict: null, cheat: { player: p, why: [], prev: { ...s, cheat: null, verdict: null } } };
}

const blame = (s, why) => (why && s.free ? { ...s, cheat: { ...s.cheat, why: [...s.cheat.why, why] } } : s);

// Stein setzen (Steine in der Hand)
export function place(s, p, to) {
  if (!mayAct(s, p) || s.step !== 'move' || s.hand[p] <= 0 || !isPoint(to) || s.board[to] !== null) return null;
  const board = s.board.map((x, i) => (i === to ? p : x));
  const hand = s.hand.map((n, q) => (q === p ? n - 1 : n));
  return afterMove(begin(s, p), p, board, hand, { type: 'place', player: p, to }, { player: p, from: null, to, took: null });
}

// Stein ziehen (Nachbarpunkt) oder springen (3 Steine). Ohne Hilfen: jeder freie Punkt, auch während des Setzens.
export function move(s, p, from, to) {
  if (!mayAct(s, p) || s.step !== 'move' || !isPoint(from) || !isPoint(to) || s.board[from] !== p || s.board[to] !== null) return null;
  const phase = phaseOf(s, p);
  const near = NEIGHBORS[from].includes(to);
  let why = null;
  if (phase === 'place') why = 'gezogen statt einen Stein zu setzen';
  else if (phase === 'move' && !near) why = 'gesprungen, obwohl noch mehr als 3 Steine da sind';
  if (why && !s.free) return null;
  const board = s.board.map((x, i) => (i === from ? null : i === to ? p : x));
  const jump = phase !== 'place' && !near;
  return afterMove(blame(begin(s, p), why), p, board, s.hand, { type: 'move', player: p, from, to, jump }, { player: p, from, to, took: null });
}

function afterMove(s, p, board, hand, event, last) {
  const closed = closesMill(board, last.to);
  const other = 1 - p;
  const next = { ...s, board, hand, closed, last, seq: s.seq + 1, events: [event, ...(closed ? [{ type: 'mill', player: p }] : [])] };
  // regelgerecht nur nach einer Mühle (und wenn es etwas zu schlagen gibt); ohne Hilfen darf man immer
  if (s.free || (closed && board.includes(other))) return { ...next, step: 'take' };
  return endTurn(next, p);
}

// Gegnerischen Stein schlagen
export function take(s, p, at) {
  if (!mayAct(s, p) || s.step !== 'take' || !isPoint(at) || s.board[at] !== 1 - p) return null;
  let why = null;
  if (!s.closed) why = 'ohne Mühle geschlagen';
  else if (!takeable(s.board, at)) why = 'einen Stein aus einer Mühle geschlagen, obwohl ein anderer frei war';
  if (why && !s.free) return null;
  const board = s.board.map((x, i) => (i === at ? null : x));
  const next = { ...blame(s, why), board, last: { ...s.last, took: at }, seq: s.seq + 1, events: [{ type: 'take', player: p, at }] };
  return endTurn(next, p, true);
}

// Ohne Hilfen: Zug beenden, ohne zu schlagen (nach einer Mühle verschenkt man das Schlagen – kein Regelverstoß)
export function pass(s, p) {
  if (!mayAct(s, p) || s.step !== 'take' || !s.free) return null;
  return endTurn({ ...s, seq: s.seq + 1, events: [{ type: 'pass', player: p }] }, p);
}

// Zug zu Ende: der andere ist dran – hat er verloren, oder ist es Remis?
function endTurn(s, p, took = false) {
  const o = 1 - p;
  const moving = s.last.from !== null && s.hand[0] === 0 && s.hand[1] === 0; // Zugphase (Setzen zählt nicht)
  const quiet = took ? 0 : moving ? s.quiet + 1 : s.quiet;
  const next = { ...s, turn: o, step: 'move', closed: false, quiet };
  const key = s.hand[0] === 0 && s.hand[1] === 0 ? `${s.board.map((x) => (x === null ? '.' : x)).join('')}${o}` : null;
  next.positions = took || !key ? (key ? [key] : []) : [...s.positions, key];
  let result = null;
  if (countOf(s.board, o) + s.hand[o] < 3) result = { winner: p, reason: 'steine' };
  else if (!canMove(next, o)) result = { winner: p, reason: 'blockiert' };
  else if (key && next.positions.filter((x) => x === key).length >= 3) result = { winner: null, reason: 'wiederholung' };
  else if (quiet >= QUIET_LIMIT) result = { winner: null, reason: 'zuege' };
  return result ? { ...next, result, events: [...next.events, { type: 'over', ...result }] } : next;
}

// Kann p regelgerecht setzen oder ziehen?
export function canMove(s, p) {
  if (s.hand[p] > 0 || countOf(s.board, p) === 3) return s.board.includes(null);
  return s.board.some((x, i) => x === p && NEIGHBORS[i].some((j) => s.board[j] === null));
}

// Regelgerechte Ziele für den Stein auf from (Zugphase) bzw. alle freien Punkte (Setzen)
export function targets(s, p, from = null) {
  if (s.result || s.turn !== p || s.step !== 'move') return [];
  const free = s.board.flatMap((x, i) => (x === null ? [i] : []));
  if (s.hand[p] > 0) return from === null ? free : [];
  if (from === null || s.board[from] !== p) return [];
  return countOf(s.board, p) === 3 ? free : NEIGHBORS[from].filter((j) => s.board[j] === null);
}

// Steine, die p jetzt regelgerecht schlagen darf
export function takeTargets(s, p) {
  if (s.result || s.turn !== p || s.step !== 'take' || !s.closed) return [];
  return s.board.flatMap((x, i) => (x === 1 - p && takeable(s.board, i) ? [i] : []));
}

// Eigene Steine, die regelgerecht ziehen können
export function movable(s, p) {
  if (s.result || s.turn !== p || s.step !== 'move' || s.hand[p] > 0) return [];
  return s.board.flatMap((x, i) => (x === p && targets(s, p, i).length ? [i] : []));
}

// „Geschummelt!“ – nur gegen den letzten Zug des anderen, solange er danach nicht selbst gezogen hat
export function accuse(s, p) {
  const c = s.cheat;
  if (!s.free || !c || c.player === p || (p !== 0 && p !== 1) || (s.turn !== p && !s.result) || (s.step !== 'move' && !s.result)) return null;
  const caught = c.why.length > 0;
  const guilty = caught ? c.player : p;
  const base = caught ? c.prev : { ...s, cheat: null }; // erwischt: Stand vor dem Zug, der Schummler ist wieder dran
  const strikes = base.strikes.map((n, q) => (q === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln' } : null;
  const result = caught ? out : base.result ?? out;
  // erwischt: erst jetzt wird der Grund für beide sichtbar (höchstens zwei, mit „und“)
  const verdict = { caught, player: guilty, by: p, ...(caught && { why: c.why.slice(0, 2).join(' und ') }) };
  return { ...base, strikes, result, verdict, seq: s.seq + 1, events: [{ type: caught ? 'caught' : 'fehlalarm', ...verdict }, ...(result && result !== base.result ? [{ type: 'over', ...result }] : [])] };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche nach Spielende)
export function waive(s, p) {
  const c = s.cheat;
  if (!s.free || !c || c.player === p || (p !== 0 && p !== 1)) return null;
  return { ...s, cheat: null };
}

// Was der Gast sehen darf: ob der letzte Zug regelgerecht war, muss er selbst merken
export const forGuest = (s) => (s.free ? { ...s, cheat: s.cheat && { player: s.cheat.player } } : s);
