// Vier gewinnt als reine Funktionen (kein DOM, kein three.js). Der Host hält den Spielstand: Jede Aktion liefert einen
// neuen Zustand oder null (ungültig). Spieler 0 = Host (Rot), 1 = Gast bzw. Computer (Gelb). Standardregeln:
// 7 Spalten × 6 Reihen, abwechselnd ein Stein in eine Spalte, er fällt nach unten; vier eigene in einer Reihe
// (waagrecht, senkrecht, diagonal) gewinnen, volles Brett = Remis. Jede Farbe hat 21 Steine.
// board[c] = Spalte c von unten nach oben, Einträge = Farbe des Steins (0 Rot, 1 Gelb).
//
// „Ohne Hilfen“ (free): Jeder Stein geht durch – auch außer der Reihe (z. B. zwei hintereinander) oder ein Stein in der
// Farbe des Gegners. Bis der andere selbst einen Stein einwirft, kann er „Geschummelt!“ rufen (accuse): Stimmt es,
// kommen die Schummel-Steine wieder heraus und der Schummler bekommt eine Verwarnung; sonst trifft die Verwarnung den
// Ankläger. Bei der dritten Verwarnung ist die Partie verloren (wie bei Schach).
import { rematchBlocked } from '../schummeln.js';

export const COLS = 7;
export const ROWS = 6;
export const STONES = 21; // je Farbe
export const MAX_STRIKES = 3;
export const COLOR_NAMES = ['Rot', 'Gelb'];

const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

// starter = wer anfängt · wins = Siege aus früheren Partien (Revanche zählt weiter)
// round = Nummer der Partie (zählt bei jeder Revanche weiter)
export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  const s = { board: Array.from({ length: COLS }, () => []), starter, turn: starter, moves: [], result: null, wins: [...wins], round, seq: 0, events: [{ type: 'start' }] };
  return free ? { ...s, free: true, strikes: [0, 0], cheat: null, verdict: null } : s;
}

export const used = (s, color) => s.moves.filter((m) => m.color === color).length;
export const isFull = (s) => s.board.every((col) => col.length === ROWS);
export const openCols = (s) => s.board.flatMap((col, c) => (col.length < ROWS ? [c] : []));
const at = (board, c, r) => (c >= 0 && c < COLS && r >= 0 ? board[c][r] : undefined);

// Alle Steine der Reihe durch (c, r), wenn es mindestens vier gleiche sind – sonst null
export function lineAt(board, c, r) {
  const color = at(board, c, r);
  if (color === undefined) return null;
  for (const [dc, dr] of DIRS) {
    const cells = [[c, r]];
    for (const k of [1, -1]) {
      for (let x = c + k * dc, y = r + k * dr; at(board, x, y) === color; x += k * dc, y += k * dr) cells.push([x, y]);
    }
    if (cells.length >= 4) return cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  return null;
}

// Stein einwerfen: by = wer wirft, color = Farbe des Steins (Standard: die eigene)
export function drop(s, by, col, color = by) {
  if (s.result || (by !== 0 && by !== 1) || (color !== 0 && color !== 1)) return null;
  if (!Number.isInteger(col) || col < 0 || col >= COLS || s.board[col].length >= ROWS) return null;
  if (used(s, color) >= STONES) return null; // keine Steine dieser Farbe mehr
  const why = [];
  if (by !== s.turn) why.push(s.moves.at(-1)?.by === by ? 'zwei Steine hintereinander eingeworfen' : 'außer der Reihe eingeworfen');
  if (color !== by) why.push(`mit einem Stein des Gegners (${COLOR_NAMES[color]}) gespielt`);
  if (why.length && !s.free) return null;

  const row = s.board[col].length;
  const board = s.board.map((c, k) => (k === col ? [...c, color] : c));
  const line = lineAt(board, col, row);
  const turn = 1 - by;
  let result = null;
  if (line) result = { winner: color, reason: 'vier', line };
  else if (board.every((c) => c.length === ROWS)) result = { winner: null, reason: 'voll' };
  const next = { ...s, board, turn, moves: [...s.moves, { col, row, color, by }], result, seq: s.seq + 1, events: [{ type: 'drop', col, row, color, by }] };
  // Wer dran ist, hat keinen eigenen Stein mehr (nur nach unbemerktem Schummeln mit fremden Steinen möglich) → Remis
  if (!result && used(next, turn) >= STONES) next.result = { winner: null, reason: 'steine' };
  if (!s.free) return next;
  return { ...next, cheat: record(s, by, why), verdict: null };
}

// Offene Anklage-Frist des Werfers: Wirft er gleich noch einmal, läuft sie weiter (zweiter Stein ist immer außer der
// Reihe); prev = Stand vor dem ersten Schummel-Stein. why = versteckter Grund (nur beim Host, forGuest entfernt ihn).
function record(s, by, why) {
  const clean = { ...s, cheat: null, verdict: null };
  const c = s.cheat?.player === by ? s.cheat : null;
  if (!c) return { player: by, legal: !why.length, why, prev: clean };
  return { player: by, legal: c.legal && !why.length, why: [...new Set([...c.why, ...why])], prev: c.legal ? clean : c.prev };
}

// Grund für die Meldung: höchstens zwei Verstöße, mit „ und “ verbunden
export const whyText = (why) => why.slice(0, 2).join(' und ');

// „Geschummelt!“ – nur gegen den anderen, solange er die Frist noch offen hat
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  const guilty = c.legal ? by : c.player;
  const base = c.legal ? s : c.prev; // erwischt: Stand vor dem ersten Schummel-Stein, wer dort dran war, ist wieder dran
  const strikes = s.strikes.map((n, p) => (p === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln' } : null;
  // stones = so viele Schummel-Steine kommen wieder heraus
  const verdict = { caught: !c.legal, player: guilty, by, ...(!c.legal && { why: whyText(c.why), stones: s.moves.length - base.moves.length }) };
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

// Revanche: der andere fängt an, die Siege zählen weiter. Wer noch erwischt werden kann, startet sie nicht selbst.
export function again(s, by) {
  if (!s.result || rematchBlocked(s, by)) return null;
  return newGame({ starter: 1 - s.starter, free: !!s.free, wins: score(s), round: (s.round ?? 1) + 1 });
}

// Was der Gast sehen darf: ob der letzte Stein regelgerecht war, muss er selbst merken
export const forGuest = (s) => (s.free && s.cheat ? { ...s, cheat: { player: s.cheat.player } } : s);
