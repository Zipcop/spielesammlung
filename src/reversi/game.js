// Reversi (Othello) als reine Funktionen (kein DOM, kein three.js). Der Host hält den Spielstand: Jede Aktion liefert
// einen neuen Zustand oder null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer. Standardregeln: 8 × 8 Felder,
// in der Mitte zwei schwarze und zwei weiße Steine über Kreuz, Schwarz fängt an. Ein Stein muss in mindestens einer der
// acht Richtungen gegnerische Steine lückenlos zwischen sich und einem eigenen Stein einschließen – die werden alle
// umgedreht. Wer nicht ziehen kann, setzt aus. Kann keiner mehr ziehen, gewinnt, wer mehr Steine hat.
// board[r * 8 + c] = null (frei), 0 (schwarz) oder 1 (weiß) · r = Reihe 1–8 (0–7), c = Spalte a–h (0–7).
// Farben sind keine Spieler: Wer anfängt (starter), spielt Schwarz – bei der Revanche also der andere.
//
// „Ohne Hilfen“ (free): Ein Zug ist wie am echten Brett mehrere Schritte – Stein auf ein freies Feld setzen (place),
// Steine umdrehen (flip, beliebige), fertig (done). Geprüft wird nichts, auch Aussetzen (pass) geht immer. Bis der andere
// selbst setzt oder aussetzt, kann er „Geschummelt!“ rufen (accuse): Stimmt es, kommt der Zug zurück und der Schummler
// bekommt eine Verwarnung; sonst trifft die Verwarnung den Ankläger. Bei der dritten ist die Partie verloren.
import { rematchBlocked } from '../schummeln.js';

export const N = 8;
export const MAX_STRIKES = 3;
export const COLOR_NAMES = ['Schwarz', 'Weiß'];

const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

// Feldname wie auf dem Brett: Spalte a–h, Reihe 1–8
export const squareName = (k) => 'abcdefgh'[k % N] + (Math.floor(k / N) + 1);

// Startaufstellung: d4 und e5 weiß, e4 und d5 schwarz
export function startBoard() {
  const b = Array(N * N).fill(null);
  b[27] = b[36] = 1;
  b[28] = b[35] = 0;
  return b;
}

// Steine, die color mit einem Stein auf Feld at umdrehen würde (leer = kein Zug dort)
export function flipsFor(board, at, color) {
  if (board[at] !== null) return [];
  const r0 = Math.floor(at / N);
  const c0 = at % N;
  const out = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = r0 + dr;
    let c = c0 + dc;
    while (r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === 1 - color) {
      line.push(r * N + c);
      r += dr;
      c += dc;
    }
    if (line.length && r >= 0 && r < N && c >= 0 && c < N && board[r * N + c] === color) out.push(...line);
  }
  return out;
}

export const legalMoves = (board, color) => board.flatMap((v, k) => (v === null && flipsFor(board, k, color).length ? [k] : []));
export const colorOf = (s, p) => (p === s.starter ? 0 : 1);
export const countOf = (s, p) => s.board.filter((v) => v === colorOf(s, p)).length;
export const canMove = (s, p) => legalMoves(s.board, colorOf(s, p)).length > 0;

// starter = wer anfängt (spielt Schwarz) · wins = Siege aus früheren Partien · round = Nummer der Partie
export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  const s = { board: startBoard(), starter, turn: starter, last: null, result: null, wins: [...wins], round, seq: 0, events: [{ type: 'start' }] };
  return free ? { ...s, free: true, passes: 0, open: null, strikes: [0, 0], cheat: null, verdict: null } : s;
}

// Partie vorbei? (niemand kann mehr ziehen) → Ergebnis, sonst null
function ending(s, board) {
  if (legalMoves(board, 0).length || legalMoves(board, 1).length) return null;
  return final({ ...s, board }, board.every((v) => v !== null) ? 'voll' : 'zu');
}

function final(s, reason) {
  const n = [countOf(s, 0), countOf(s, 1)];
  return { winner: n[0] === n[1] ? null : n[0] > n[1] ? 0 : 1, reason, count: n };
}

const valid = (s, by, at) => !s.result && by === s.turn && Number.isInteger(at) && at >= 0 && at < N * N && s.board[at] === null;

// Normaler Zug: Stein auf at, Eingeschlossenes wird umgedreht. Kann der andere danach nicht, setzt er aus (pass).
export function move(s, by, at) {
  if (s.free || !valid(s, by, at)) return null;
  const color = colorOf(s, by);
  const flips = flipsFor(s.board, at, color);
  if (!flips.length) return null;
  const board = [...s.board];
  board[at] = color;
  for (const k of flips) board[k] = color;
  const events = [{ type: 'move', by, at, flips }];
  const next = { ...s, board, last: at, seq: s.seq + 1, events };
  const result = ending(next, board);
  if (result) return { ...next, result };
  if (legalMoves(board, 1 - color).length) return { ...next, turn: 1 - by };
  events.push({ type: 'pass', by: 1 - by });
  return { ...next, turn: by };
}

// --- Ohne Hilfen ---

// Stein auf ein beliebiges freies Feld – der Zug ist offen, bis done. Damit ist die Frist des anderen vorbei.
export function place(s, by, at) {
  if (!s.free || s.open || !valid(s, by, at)) return null;
  const prev = { ...s, cheat: null, verdict: null };
  const board = [...s.board];
  board[at] = colorOf(s, by);
  return { ...prev, board, open: { at, flipped: [], prev }, seq: s.seq + 1, events: [{ type: 'place', by, at }] };
}

// Gesetzten Stein wieder wegnehmen (Zug noch offen): alles wie vor dem Setzen
export function unplace(s, by) {
  if (!s.free || !s.open || s.result || by !== s.turn) return null;
  return { ...s.open.prev, seq: s.seq + 1, events: [{ type: 'unplace', by }] };
}

// Einen Stein umdrehen (beliebigen, außer dem gerade gesetzten); zweimal = wieder wie vorher
export function flip(s, by, at) {
  const o = s.open;
  if (!s.free || !o || s.result || by !== s.turn || at === o.at || !Number.isInteger(at) || s.board[at] == null) return null;
  const board = [...s.board];
  board[at] = 1 - board[at];
  const flipped = o.flipped.includes(at) ? o.flipped.filter((k) => k !== at) : [...o.flipped, at];
  return { ...s, board, open: { ...o, flipped }, seq: s.seq + 1, events: [{ type: 'flip', by, at }] };
}

// Zug fertig: jetzt wird (versteckt) festgehalten, ob er regelgerecht war – der andere ist dran
export function done(s, by) {
  const o = s.open;
  if (!s.free || !o || s.result || by !== s.turn) return null;
  const rule = flipsFor(o.prev.board, o.at, colorOf(s, by));
  const why = [];
  if (!rule.length) why.push('Stein gesetzt, ohne etwas einzuschließen');
  const missing = rule.filter((k) => !o.flipped.includes(k)).length;
  const extra = o.flipped.filter((k) => !rule.includes(k)).length;
  if (missing) why.push(missing === 1 ? 'einen eingeschlossenen Stein nicht umgedreht' : `${missing} eingeschlossene Steine nicht umgedreht`);
  if (extra) why.push(extra === 1 ? 'einen Stein umgedreht, der nicht eingeschlossen war' : `${extra} Steine umgedreht, die nicht eingeschlossen waren`);
  const next = { ...s, open: null, turn: 1 - by, last: o.at, passes: 0, seq: s.seq + 1, events: [{ type: 'done', by, at: o.at, flips: o.flipped }] };
  return { ...next, result: ending(next, s.board), cheat: { player: by, legal: !why.length, why, prev: o.prev } };
}

// Aussetzen: ohne Hilfen jederzeit vor dem Setzen (regelwidrig, wenn ein Zug möglich war). Setzen beide nacheinander
// aus, ist die Partie vorbei.
export function pass(s, by) {
  if (!s.free || s.open || s.result || by !== s.turn) return null;
  const prev = { ...s, cheat: null, verdict: null };
  const legal = !canMove(s, by);
  const passes = (s.passes ?? 0) + 1;
  const next = { ...prev, turn: 1 - by, passes, seq: s.seq + 1, events: [{ type: 'pass', by }] };
  const result = passes >= 2 ? final(s, 'zu') : ending(next, s.board);
  return { ...next, result, cheat: { player: by, legal, why: legal ? [] : ['ausgesetzt, obwohl ein Zug möglich war'], prev } };
}

// Ein ganzer Zug ohne Hilfen in einem Schritt (Computer): setzen, flips umdrehen, fertig – zählt als eine Aktion
// (seq + 1), damit das Brett ihn abspielt
export function turnOf(s, by, at, flips) {
  let next = place(s, by, at);
  for (const k of flips) next = next && flip(next, by, k);
  next = next && done(next, by);
  return next && { ...next, seq: s.seq + 1 };
}

// Grund für die Meldung: höchstens zwei Verstöße, mit „ und “ verbunden
export const whyText = (why) => why.slice(0, 2).join(' und ');

// „Geschummelt!“ – nur gegen den anderen, solange er die Frist noch offen hat
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  const guilty = c.legal ? by : c.player;
  const base = c.legal ? s : c.prev; // erwischt: Stand vor dem Schummel-Zug, der Schummler ist wieder dran
  const strikes = s.strikes.map((n, p) => (p === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln' } : null;
  const verdict = { caught: !c.legal, player: guilty, by, ...(!c.legal && { why: whyText(c.why) }) };
  return { ...base, strikes, result: base.result ?? out, cheat: null, verdict, seq: s.seq + 1, events: [{ type: c.legal ? 'fehlalarm' : 'caught', ...verdict }] };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche)
export function waive(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Siege einschließlich der laufenden, beendeten Partie
export const score = (s) => s.wins.map((n, p) => n + (s.result?.winner === p ? 1 : 0));

// Revanche: der andere fängt an (und spielt Schwarz), die Siege zählen weiter
export function again(s, by) {
  if (!s.result || rematchBlocked(s, by)) return null;
  return newGame({ starter: 1 - s.starter, free: !!s.free, wins: score(s), round: (s.round ?? 1) + 1 });
}

// Was der Gast sehen darf: ob der letzte Zug regelgerecht war, muss er selbst merken
export function forGuest(s) {
  if (!s.free) return s;
  return { ...s, cheat: s.cheat && { player: s.cheat.player }, open: s.open && { at: s.open.at, flipped: s.open.flipped } };
}
