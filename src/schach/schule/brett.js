// Schach-Schule: Spielstand fürs Brett (board.sync / 2D-Brett) aus Startstellung + Zügen – reine Logik.
// white = Spieler 0 (dieser PC) hat Weiß → 0, sonst 1 (dann steht Schwarz unten).
import { Chess } from 'chess.js';

const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

export function stateOf(fen, moves = [], white = 0) {
  const chess = new Chess(fen);
  for (const m of moves) chess.move(parse(m));
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  return {
    white,
    moves,
    fen: chess.fen(),
    san: history.map((m) => m.san),
    last: last ? { from: last.from, to: last.to } : null,
    captured: history.filter((m) => m.captured).map((m) => (m.color === 'w' ? 'b' : 'w') + m.captured),
    check: chess.inCheck(),
    mate: chess.isCheckmate(),
    over: chess.isGameOver(), // Matt, Patt, Remis-Regel (Wiederholung zählt ab fen)
    result: null,
  };
}

// Nur Figuren zeigen (auch ohne Könige, z. B. Koordinaten- und Blind-Training, Stellung im Aufbau) – keine Regelprüfung
export const plainState = (fen, white = 0) => ({ white, moves: [], fen, san: [], last: null, captured: [], check: false, mate: false, result: null });

// Zugliste als Text mit Nummern: '1. e4 e5 2. Sf3' – san = Kurzschrift, start = Zugnummer und Seite der ersten
export function moveText(san, german, startFen) {
  const [, turn, , , , full] = startFen.split(' ');
  let n = Number(full) || 1;
  let white = turn === 'w';
  const out = [];
  san.forEach((s, i) => {
    if (white) out.push(`${n}.`);
    else if (i === 0) out.push(`${n}…`);
    out.push(german(s));
    if (!white) n++;
    white = !white;
  });
  return out.join(' ');
}
