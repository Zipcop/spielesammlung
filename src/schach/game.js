// Spielablauf als reine Funktionen auf Basis von chess.js. Der Host hält den Spielstand:
// Jede Aktion liefert einen neuen Zustand oder null (ungültig, z. B. nicht dran oder regelwidrig).
// Spieler 0 = Host, 1 = Gast bzw. Computer. Züge werden als UCI-Text gespeichert ('e2e4', 'e7e8q').
//
// „Ohne Hilfen“ (free): Jede eigene Figur darf auf jedes Feld ziehen, das nicht von einer eigenen Figur
// oder einem König besetzt ist – auch regelwidrig. Bis zum nächsten Zug kann der andere „Geschummelt!“
// rufen (accuse): Stimmt es, wird der Zug zurückgenommen und der Schummler muss neu ziehen; sonst trifft
// die Verwarnung den Ankläger. Bei der dritten Verwarnung ist die Partie verloren.
// Weil chess.js regelwidrige Stellungen nicht nachspielen kann, läuft dieser Modus über die FEN der
// aktuellen Stellung; die dreifache Wiederholung zählen wir dann selbst (positions).
import { Chess } from 'chess.js';

export const MAX_STRIKES = 3;

export const REASONS = {
  matt: 'Schachmatt',
  aufgabe: 'Aufgabe',
  patt: 'Patt',
  material: 'Ungenügendes Material',
  wiederholung: 'Dreifache Wiederholung',
  fuenfzig: '50-Züge-Regel',
  schummeln: 'Dritte Verwarnung',
};

// white = welcher Spieler Weiß hat (0 oder 1)
export function newGame(white = 0, { free = false } = {}) {
  const s = snapshot({ white, moves: [], result: null }, new Chess());
  if (!free) return s;
  return { ...s, free: true, strikes: [0, 0], positions: [positionKey(s.fen)], cheat: null, verdict: null };
}

export const colorOf = (s, player) => (player === s.white ? 'w' : 'b');
const playerOf = (s, color) => (color === 'w' ? s.white : 1 - s.white);

// Wer ist am Zug? (0 oder 1)
export function turnOf(s) {
  return playerOf(s, s.fen.split(' ')[1]);
}

export function move(s, player, uci) {
  if (s.result || turnOf(s) !== player || typeof uci !== 'string') return null;
  if (s.free) return freeMove(s, player, uci);
  const chess = replay(s.moves);
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null; // regelwidrig
  }
  return snapshot({ ...s, moves: [...s.moves, chess.history({ verbose: true }).at(-1).lan] }, chess);
}

export function resign(s, player) {
  if (s.result || (player !== 0 && player !== 1)) return null;
  return { ...s, result: { winner: 1 - player, reason: 'aufgabe' }, ...(s.free && { cheat: null }) };
}

// Nur allein gegen den Computer: die letzten Halbzüge zurücknehmen, solange die Partie läuft
export function takeBack(s, plies) {
  if (s.free || s.result || !(plies >= 1 && plies <= s.moves.length)) return null;
  const moves = s.moves.slice(0, -plies);
  return snapshot({ ...s, moves }, replay(moves));
}

// Rückblick nach der Partie: Stellung nach den ersten Halbzügen (nur für die Anzeige, nicht „Ohne Hilfen“)
export function positionAt(s, plies) {
  const moves = s.moves.slice(0, plies);
  return snapshot({ ...s, moves, result: null }, replay(moves));
}

// Revanche: die Farben werden getauscht
export function again(s) {
  return s.result ? newGame(1 - s.white, { free: s.free }) : null;
}

// „Geschummelt!“ – nur gegen den letzten Zug des anderen, solange danach nicht gezogen wurde.
export function accuse(s, player) {
  const c = s.cheat;
  if (!s.free || !c || c.player === player || (player !== 0 && player !== 1)) return null;
  const guilty = c.legal ? player : c.player;
  const base = c.legal ? { ...s, cheat: null } : c.prev; // erwischt: Stellung vor dem Zug, Schummler ist wieder dran
  const strikes = base.strikes.map((n, p) => (p === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln' } : null;
  return { ...base, strikes, result: base.result ?? out, verdict: { caught: !c.legal, player: guilty, by: player } };
}

// Erlaubte Züge der Figur auf diesem Feld (nur für die Seite am Zug)
export function legalMoves(s, square) {
  if (s.result) return [];
  return new Chess(s.fen, { skipValidation: true }).moves({ square, verbose: true }).map((m) => ({ to: m.to, uci: m.lan, capture: !!m.captured }));
}

// Die ganze Partie nachspielen – so kennt chess.js alle früheren Stellungen (dreifache Wiederholung)
function replay(moves) {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess;
}

// Alles, was die Anzeige braucht, steckt im Zustand: Stellung (FEN), Zugliste, letzter Zug, geschlagene Figuren, Ergebnis
function snapshot(s, chess) {
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  return {
    white: s.white,
    moves: s.moves,
    fen: chess.fen(),
    san: history.map((m) => m.san),
    last: last ? { from: last.from, to: last.to } : null,
    captured: history.filter((m) => m.captured).map((m) => (m.color === 'w' ? 'b' : 'w') + m.captured),
    check: chess.inCheck(),
    result: s.result ?? resultOf(s, chess, chess.isThreefoldRepetition()),
  };
}

// winner: 0 oder 1, bei Remis null. Matt hat Vorrang vor den Remis-Regeln.
function resultOf(s, chess, repeated) {
  if (chess.isCheckmate()) return { winner: playerOf(s, chess.turn() === 'w' ? 'b' : 'w'), reason: 'matt' };
  if (chess.isStalemate()) return { winner: null, reason: 'patt' };
  if (chess.isInsufficientMaterial()) return { winner: null, reason: 'material' };
  if (repeated) return { winner: null, reason: 'wiederholung' };
  if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fuenfzig' };
  return null;
}

// --- Ohne Hilfen ---

// Stellung ohne Zugzähler – gleiche Schlüssel = gleiche Stellung (für die dreifache Wiederholung)
const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

function freeMove(s, player, uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const chess = new Chess(s.fen, { skipValidation: true });
  let done;
  try {
    const m = chess.move({ from, to, promotion: uci[4] });
    // Steht der König nach einem Schummelzug im Schach, bietet chess.js das Schlagen des Königs an – das gibt es nicht
    if (m.captured === 'k') return null;
    done = { legal: true, fen: chess.fen(), san: m.san, lan: m.lan, captured: m.captured ? (m.color === 'w' ? 'b' : 'w') + m.captured : null };
  } catch {
    const forced = forceMove(s.fen, from, to, uci[4]);
    if (!forced) return null; // nicht einmal regelwidrig möglich (fremde Figur, eigene Figur oder König im Weg …)
    done = { legal: false, ...forced };
    chess.load(forced.fen, { skipValidation: true });
    done.san += chess.isCheckmate() ? '#' : chess.inCheck() ? '+' : ''; // Zettel sieht aus wie bei echten Zügen
  }
  const next = {
    ...s,
    moves: [...s.moves, done.lan],
    fen: done.fen,
    san: [...s.san, done.san],
    last: { from, to },
    captured: done.captured ? [...s.captured, done.captured] : s.captured,
    check: chess.inCheck(),
    positions: [...s.positions, positionKey(done.fen)],
    cheat: { player, legal: done.legal, prev: { ...s, cheat: null, verdict: null } },
    verdict: null,
  };
  const key = next.positions.at(-1);
  return { ...next, result: resultOf(next, chess, next.positions.filter((p) => p === key).length >= 3) };
}

const FILES = 'abcdefgh';
const SQUARE = /^[a-h][1-8]$/;

// Figur ohne Regelprüfung versetzen. Erlaubt: eigene Figur auf ein freies oder gegnerisches Feld,
// aber keinen König schlagen und keinen Bauern auf die eigene Grundreihe. Zieht der König von e1/e8 zwei Felder
// zur Seite und ist der Weg bis zum Turm frei, kommt der Turm mit (Rochade, z. B. trotz Schach). Ein Bauer auf
// der letzten Reihe wird umgewandelt (Standard: Dame).
function forceMove(fen, from, to, promotion) {
  if (!SQUARE.test(from) || !SQUARE.test(to) || from === to) return null;
  const [placement, turn, castling, , half, full] = fen.split(' ');
  const board = placement.split('/').map((row) => row.replace(/\d/g, (n) => '.'.repeat(Number(n))).split(''));
  const at = (sq) => [8 - Number(sq[1]), FILES.indexOf(sq[0])]; // Zeile 0 = Reihe 8
  const [fr, fc] = at(from);
  const [tr, tc] = at(to);
  const piece = board[fr][fc];
  if (piece === '.') return null;
  const white = piece === piece.toUpperCase();
  if ((turn === 'w') !== white) return null; // nur eigene Figuren
  const target = board[tr][tc];
  if (target !== '.' && (target === target.toUpperCase()) === white) return null; // nicht auf eine eigene Figur
  if (target.toLowerCase() === 'k') return null; // Könige werden nicht geschlagen
  const type = piece.toLowerCase();
  if (type === 'p' && to[1] === (white ? '1' : '8')) return null;

  let placed = piece;
  if (type === 'p' && to[1] === (white ? '8' : '1')) {
    const p = 'qrbn'.includes(promotion) && promotion ? promotion : 'q';
    placed = white ? p.toUpperCase() : p;
  }
  // Rochade: nur vom Ausgangsfeld, Turm in der Ecke, alles dazwischen leer
  let castled = '';
  if (type === 'k' && from === (white ? 'e1' : 'e8') && fr === tr && Math.abs(tc - fc) === 2) {
    const rook = white ? 'R' : 'r';
    const [rookFrom, rookTo] = tc > fc ? [7, tc - 1] : [0, tc + 1];
    const between = board[tr].slice(Math.min(fc, rookFrom) + 1, Math.max(fc, rookFrom));
    if (board[tr][rookFrom] === rook && between.every((c) => c === '.')) {
      board[tr][rookFrom] = '.';
      board[tr][rookTo] = rook;
      castled = tc > fc ? 'O-O' : 'O-O-O';
    }
  }
  board[fr][fc] = '.';
  board[tr][tc] = placed;

  let rights = castling === '-' ? '' : castling;
  const drop = (chars) => (rights = [...rights].filter((c) => !chars.includes(c)).join(''));
  if (type === 'k') drop(white ? 'KQ' : 'kq');
  for (const sq of [from, to]) drop({ h1: 'K', a1: 'Q', h8: 'k', a8: 'q' }[sq] ?? '');

  const capture = target !== '.';
  const rows = board.map((row) => row.join('').replace(/\.+/g, (dots) => String(dots.length)));
  const newFen = [
    rows.join('/'),
    white ? 'b' : 'w',
    rights || '-',
    '-',
    type === 'p' || capture ? 0 : Number(half) + 1,
    white ? full : Number(full) + 1,
  ].join(' ');
  const promoted = placed !== piece ? placed.toLowerCase() : '';
  return {
    fen: newFen,
    san: castled || (type === 'p' ? (capture ? from[0] : '') : piece.toUpperCase()) + (capture ? 'x' : '') + to + (promoted ? '=' + promoted.toUpperCase() : ''),
    lan: from + to + promoted,
    captured: capture ? (white ? 'b' : 'w') + target.toLowerCase() : null,
  };
}
