// Schach-Schule, Analysebrett – reine Logik ohne Anzeige: Stellung frei aufbauen (Figur setzen/entfernen, wer zieht),
// FEN prüfen, und der Satz zum besten Zug (aus der Hauptvariante von Stockfish, Fakten aus coach.js lineFacts).
import { Chess, validateFen } from 'chess.js';
import { lineFacts } from '../coach.js';

export const START = new Chess().fen();
export const EMPTY = '4k3/8/8/8/8/8/8/4K3 w - - 0 1'; // „Leeres Brett“: nur die Könige

const FILES = 'abcdefgh';

// Brett-Teil der FEN ↔ 8 × 8 Liste (Zeile 0 = Reihe 8), Feld = Buchstabe ('K', 'p' …) oder ''
function grid(fen) {
  return fen.split(' ')[0].split('/').map((row) => row.replace(/\d/g, (n) => '.'.repeat(Number(n))).split('').map((c) => (c === '.' ? '' : c)));
}
function boardOf(rows) {
  return rows.map((r) => r.map((c) => c || '1').join('').replace(/1+/g, (m) => String(m.length))).join('/');
}

// Rochaderechte, die zur Aufstellung passen: König und Turm auf ihren Grundfeldern (wanted = gewünschte Rechte, z. B. aus einer FEN)
export function castlingFor(board, wanted = 'KQkq') {
  const rows = grid(board);
  const at = (sq) => rows[8 - Number(sq[1])][FILES.indexOf(sq[0])];
  const ok = { K: at('e1') === 'K' && at('h1') === 'R', Q: at('e1') === 'K' && at('a1') === 'R', k: at('e8') === 'k' && at('h8') === 'r', q: at('e8') === 'k' && at('a8') === 'r' };
  return 'KQkq'.split('').filter((c) => ok[c] && wanted.includes(c)).join('') || '-';
}

// Figur setzen (piece = 'K', 'p' …) oder entfernen (null). Rochaderechte passen sich an, en passant und Zähler gehen zurück.
export function placeOn(fen, square, piece) {
  const rows = grid(fen);
  rows[8 - Number(square[1])][FILES.indexOf(square[0])] = piece ?? '';
  const board = boardOf(rows);
  const [, turn, castling] = fen.split(' ');
  return `${board} ${turn} ${castlingFor(board, castling === '-' ? 'KQkq' : castling)} - 0 1`;
}

// Figur auf einem Feld (Buchstabe wie in der FEN) oder null
export function pieceAt(fen, square) {
  return grid(fen)[8 - Number(square[1])][FILES.indexOf(square[0])] || null;
}

// Wer zieht? color = 'w' | 'b'
export function setTurn(fen, color) {
  const f = fen.split(' ');
  return `${f[0]} ${color} ${f[2]} - 0 1`;
}

// Stellung prüfen. Fehlende Felder werden ergänzt (nur Brett → Weiß am Zug). Liefert { ok: true, fen } oder { ok: false, error }
export function checkFen(input) {
  const parts = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Keine Stellung eingegeben.' };
  const [board, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = parts;
  if (!/^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}$/.test(board) || board.split('/').some((r) => r.replace(/\d/g, (n) => '.'.repeat(n)).length !== 8)) {
    return { ok: false, error: 'Das Brett braucht 8 Reihen mit je 8 Feldern.' };
  }
  if (!/^[wb]$/.test(turn)) return { ok: false, error: 'Am Zug muss w (Weiß) oder b (Schwarz) sein.' };
  const count = (c) => board.split('').filter((x) => x === c).length;
  if (count('K') !== 1 || count('k') !== 1) return { ok: false, error: 'Jede Seite braucht genau einen König.' };
  if (/[pP]/.test(board.split('/')[0] + board.split('/')[7])) return { ok: false, error: 'Bauern dürfen nicht auf der ersten oder letzten Reihe stehen.' };
  if (count('P') > 8 || count('p') > 8) return { ok: false, error: 'Mehr als 8 Bauern einer Farbe.' };
  if ([...'PNBRQK'].reduce((s, c) => s + count(c), 0) > 16 || [...'pnbrqk'].reduce((s, c) => s + count(c), 0) > 16) return { ok: false, error: 'Mehr als 16 Figuren einer Farbe.' };
  const fen = `${board} ${turn} ${castlingFor(board, castling)} ${/^[a-h][36]$/.test(ep) ? ep : '-'} ${Number(half) || 0} ${Math.max(1, Number(full) || 1)}`;
  if (!validateFen(fen).ok) return { ok: false, error: 'Diese Stellung ist ungültig.' };
  const chess = new Chess(fen);
  // die Seite, die nicht am Zug ist, darf nicht im Schach stehen
  const other = turn === 'w' ? 'b' : 'w';
  const king = chess.findPiece({ type: 'k', color: other })[0];
  if (chess.isAttacked(king, turn)) return { ok: false, error: `${other === 'w' ? 'Weiß' : 'Schwarz'} steht im Schach, ist aber nicht am Zug.` };
  return { ok: true, fen };
}

// Bewertung aus Sicht von Weiß als Text: '+0,4', '−1,2', 'Weiß setzt in 3 matt'
export function evalWhite(score, turn) {
  const s = turn === 'w' ? score : score.mate !== undefined ? { mate: -score.mate } : { cp: -score.cp };
  if (s.mate !== undefined) return s.mate === 0 ? 'matt' : `${s.mate > 0 ? 'Weiß' : 'Schwarz'} setzt in ${Math.abs(s.mate)} matt`;
  const pawns = (Math.abs(s.cp) / 100).toFixed(1).replace('.', ',');
  return pawns === '0,0' ? '0,0' : `${s.cp > 0 ? '+' : '−'}${pawns}`;
}

const NAME = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
const ONE = { p: 'einen Bauern', n: 'einen Springer', b: 'einen Läufer', r: 'einen Turm', q: 'die Dame' };

// Satz zum besten Zug: fen = Stellung, pv = Stockfishs Hauptvariante, score = Bewertung (Sicht der Seite am Zug).
// Text mit **Zug** fett (wie beim Coach). null, wenn die Variante nicht passt.
export function explainBest(fen, pv, score) {
  const f = pv?.length ? lineFacts(fen, pv) : null;
  if (!f) return null;
  const side = fen.split(' ')[1] === 'w' ? 'Weiß' : 'Schwarz';
  const move = `**${f.san}**`;
  if (f.mate) return `Bester Zug für ${side}: ${move} – Schachmatt!`;
  if (score?.mate > 0) return `Bester Zug für ${side}: ${move} – damit setzt ${side} in ${score.mate} Zügen matt.`;
  const why = [];
  if (f.check) why.push('gibt Schach');
  if (f.fork.length) why.push(`greift mit ${f.piece === 'q' ? 'der Dame' : `dem ${NAME[f.piece]}`} mehrere Figuren gleichzeitig an (${f.piece === 'n' || f.piece === 'p' ? 'Gabel' : 'Doppelangriff'})`);
  if (f.unguarded) why.push(`schlägt ${ONE[f.unguarded.type]}, der ungedeckt ist`.replace('die Dame, der', 'die Dame, die'));
  else if (f.gain >= 1) why.push(`gewinnt unterm Strich etwa ${Math.round(f.gain)} Bauerneinheit${Math.round(f.gain) === 1 ? '' : 'en'} Material`);
  if (f.promo) why.push(`macht aus dem Bauern ${f.promo === 'q' ? 'eine Dame' : `einen ${NAME[f.promo]}`}`);
  const tail = score ? ` (Bewertung ${evalWhite(score, fen.split(' ')[1])})` : '';
  return why.length ? `Bester Zug für ${side}: ${move} – er ${why.join(' und ')}${tail}.` : `Bester Zug für ${side}: ${move}${tail}.`;
}
