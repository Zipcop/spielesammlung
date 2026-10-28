// Schach-Schule, Eröffnungs-Training – reine Logik ohne Anzeige. Je Eröffnung eine Hauptlinie (allgemein bekannte
// Zugfolgen); jede Stellung darin steht im Eröffnungsbuch openings.json (Lichess-Eröffnungsliste, CC0), book = der Name,
// den die Liste der letzten benannten Stellung gibt (geprüft in test/schach-schule.test.js).
// Du ziehst deine Seite, der Computer die andere. Falscher Zug → der richtige wird gezeigt und muss gespielt werden.
// Eigene Festlegung (zur Bestätigung): „sicher“ = SURE_STREAK fehlerfreie Durchgänge hintereinander; ein Fehler setzt
// die Serie auf 0, und die Eröffnung kommt bei „Fehler wiederholen“ dran, bis sie wieder sicher ist.
import { Chess } from 'chess.js';

export const SURE_STREAK = 2;

export const OPENINGS = [
  { id: 'italienisch', name: 'Italienische Partie', side: 'w', line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2', book: 'Italian Game: Classical Variation' },
  { id: 'spanisch', name: 'Spanische Partie', side: 'w', line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3', book: 'Ruy Lopez: Closed' },
  { id: 'schottisch', name: 'Schottische Partie', side: 'w', line: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7', book: 'Scotch Game: Classical Variation' },
  { id: 'koenigsgambit', name: 'Königsgambit', side: 'w', line: 'e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5', book: "King's Gambit Accepted: Kieseritzky Gambit" },
  { id: 'londoner', name: 'Londoner System', side: 'w', line: 'd4 d5 Nf3 Nf6 Bf4 c5 e3 Nc6 Nbd2 e6 c3', book: "Queen's Pawn Game: London System" },
  { id: 'damengambit', name: 'Damengambit (abgelehnt)', side: 'w', line: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 Nbd7 Rc1 c6', book: "Queen's Gambit Declined: Orthodox Defense" },
  { id: 'englisch', name: 'Englische Eröffnung', side: 'w', line: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 Bc5 d3 d6 Bg2 O-O O-O', book: "English Opening: King's English Variation, Four Knights Variation" },
  { id: 'sizilianisch', name: 'Sizilianisch (Najdorf)', side: 'b', line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6', book: 'Sicilian Defense: Najdorf Variation' },
  { id: 'franzoesisch', name: 'Französisch (Vorstoß)', side: 'b', line: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6', book: 'French Defense: Advance Variation' },
  { id: 'carokann', name: 'Caro-Kann', side: 'b', line: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7', book: 'Caro-Kann Defense: Classical Variation' },
  { id: 'skandinavisch', name: 'Skandinavisch', side: 'b', line: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 Bf5', book: 'Scandinavian Defense: Classical Variation' },
  { id: 'zweispringer', name: 'Zweispringerspiel', side: 'b', line: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5', book: 'Italian Game: Two Knights Defense' },
  { id: 'koenigsindisch', name: 'Königsindisch', side: 'b', line: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7', book: "King's Indian Defense: Orthodox Variation" },
  { id: 'slawisch', name: 'Slawisch', side: 'b', line: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O', book: 'Slav Defense: Czech Variation' },
  { id: 'hollaendisch', name: 'Holländisch', side: 'b', line: 'd4 f5 g3 Nf6 Bg2 g6 Nf3 Bg7 O-O O-O c4 d6', book: 'Dutch Defense' },
];

export const movesOf = (op) => op.line.split(' ');

// Hauptlinie als UCI-Züge (fürs Brett und den Pfeil)
export function uciOf(op) {
  const chess = new Chess();
  return movesOf(op).map((san) => chess.move(san).lan);
}

// Ist ply ein Zug, den du ziehst? (Weiß zieht die geraden, Schwarz die ungeraden)
export const isMine = (op, ply) => (ply % 2 === 0) === (op.side === 'w');

// Dein Zug uci an Stelle ply richtig? Gleiche Stellung danach wie mit dem Buchzug (Schreibweise egal)
export function check(op, ply, uci) {
  const chess = new Chess();
  const line = movesOf(op);
  for (const san of line.slice(0, ply)) chess.move(san);
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
  const mine = chess.fen();
  chess.undo();
  chess.move(line[ply]);
  return chess.fen() === mine;
}

// Durchgang beendet: errors = Fehler darin. progress = { [id]: { runs, streak, best, errors (insgesamt), sure } }
export function finishRun(progress, id, errors) {
  const old = progress[id] ?? { runs: 0, streak: 0, best: 0, errors: 0, sure: false };
  const streak = errors ? 0 : old.streak + 1;
  const best = Math.max(old.best ?? 0, streak);
  return { ...progress, [id]: { runs: old.runs + 1, streak, best, errors: old.errors + errors, sure: streak >= SURE_STREAK } };
}

// „Fehler wiederholen“: die erste Eröffnung, die schon Fehler hatte und gerade nicht sicher ist – sonst null
export function toRepeat(progress) {
  return OPENINGS.find((op) => progress[op.id]?.errors > 0 && !progress[op.id].sure)?.id ?? null;
}
