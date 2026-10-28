// Schach-Rätsel – reine Logik ohne Anzeige. Die Rätsel stammen aus der Lichess-Rätseldatenbank
// (database.lichess.org, Lizenz CC0). Quellen für die Regeln:
// - Aufbau: FEN = Stellung VOR dem Zug des Gegners; der erste Zug der Liste ist dieser Zug, danach folgen
//   abwechselnd Lösung (Spieler) und Antwort (Gegner) – Beschreibung der Datenbank auf database.lichess.org.
// - Richtig ist der Lösungszug oder jeder Zug, der sofort mattsetzt – so prüft es Lichess selbst
//   (lila: ui/puzzle/src/moveTest.ts).
// - Eindeutig: Lichess nimmt nur Stellungen, in denen der Lösungszug klar besser ist als der zweitbeste
//   (Gewinnchance mehr als 0,7 höher auf der Skala −1…+1; bei Matt in 1 zählt auch jedes andere Matt) –
//   lichess-puzzler, generator/generator.py (is_valid_attack). Deshalb gibt es bei „Bester Zug?“ genau einen
//   richtigen Zug, solange kein anderes Matt angeboten wird.
// - Wertung wie Elo: Erwartung E = 1 / (1 + 10^((Rätsel − ich) / 400)), K = 40 für die ersten 30 Rätsel,
//   danach 20 (FIDE-Wertungsordnung, handbook.fide.com/chapter/B022024, 8.3.3). Bei der Auswahl aus vier
//   Zügen trifft man auch durch Raten: E' = 1/4 + 3/4 · E (Rate-Parameter wie im 3PL-Modell der Testtheorie).
import { Chess } from 'chess.js';

export const START_RATING = 1000;

// Themen der Datenbank, die wir anzeigen (alle anderen fallen beim Erzeugen der Daten weg)
export const THEMES = {
  mateIn1: 'Matt in 1',
  mateIn2: 'Matt in 2',
  mateIn3: 'Matt in 3',
  mateIn4: 'Matt in 4',
  mateIn5: 'Matt in 5+',
  fork: 'Gabel',
  pin: 'Fesselung',
  skewer: 'Spieß',
  discoveredAttack: 'Abzugsangriff',
  doubleCheck: 'Doppelschach',
  hangingPiece: 'Ungedeckte Figur',
  sacrifice: 'Opfer',
  backRankMate: 'Grundreihenmatt',
  smotheredMate: 'Ersticktes Matt',
  deflection: 'Ablenkung',
  attraction: 'Hinlenkung',
  trappedPiece: 'Gefangene Figur',
  promotion: 'Umwandlung',
  xRayAttack: 'Röntgenangriff',
  intermezzo: 'Zwischenzug',
  quietMove: 'Stiller Zug',
  zugzwang: 'Zugzwang',
  endgame: 'Endspiel',
};

// Zur Auswahl im Panel – genug Rätsel je Wertungsbereich (scripts/puzzles.mjs zieht je Thema gleichmäßig)
export const PICKABLE = ['mateIn1', 'mateIn2', 'mateIn3', 'fork', 'pin', 'skewer', 'discoveredAttack', 'hangingPiece', 'sacrifice', 'backRankMate', 'deflection', 'endgame'];

const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// Datenzeile [id, fen, Züge, Wertung, Themen] → Rätsel. color = Seite des Spielers (am Zug nach dem ersten Zug)
export function puzzleFrom([id, fen, moves, rating, themes]) {
  return { id, fen, line: moves.split(' '), rating, themes: themes ? themes.split(' ') : [], color: fen.split(' ')[1] === 'w' ? 'b' : 'w' };
}

// Spielstand für die Anzeige (board.sync) nach diesen Zügen ab der Rätselstellung.
// white: Spieler 0 (dieser PC) sitzt vorn – das Brett dreht sich, wenn er Schwarz hat.
export function positionOf(p, moves) {
  const chess = new Chess(p.fen);
  for (const m of moves) chess.move(parse(m));
  const history = chess.history({ verbose: true });
  const last = history.at(-1);
  return {
    white: p.color === 'w' ? 0 : 1,
    moves,
    fen: chess.fen(),
    san: history.map((m) => m.san),
    last: last ? { from: last.from, to: last.to } : null,
    captured: history.filter((m) => m.captured).map((m) => (m.color === 'w' ? 'b' : 'w') + m.captured),
    check: chess.inCheck(),
    mate: chess.isCheckmate(),
    result: null,
  };
}

// Zug des Spielers an Stelle k der Lösung (k ungerade) richtig? Gleiche Stellung danach wie mit dem
// Lösungszug (deckt auch andere Schreibweisen ab) oder Matt. Regelwidrig = falsch.
export function isRight(p, k, uci) {
  const chess = new Chess(p.fen);
  for (const m of p.line.slice(0, k)) chess.move(parse(m));
  try {
    chess.move(parse(uci));
  } catch {
    return false;
  }
  if (chess.isCheckmate()) return true;
  const mine = chess.fen();
  chess.undo();
  chess.move(parse(p.line[k]));
  return chess.fen() === mine;
}

// Neue Wertung nach einem Rätsel. me = { rating, games }, choices = Anzahl Antworten bei „Bester Zug?“ (sonst 0).
// solved: true/false – oder als Zahl die Punkte einer Partie (1, 0,5, 0), so rechnet auch die Schach-Elo (elo.js)
export function rate(me, puzzleRating, solved, choices = 0) {
  const e = 1 / (1 + 10 ** ((puzzleRating - me.rating) / 400));
  const expected = choices ? 1 / choices + (1 - 1 / choices) * e : e;
  const k = me.games < 30 ? 40 : 20;
  const points = typeof solved === 'number' ? solved : solved ? 1 : 0;
  return { rating: Math.round(me.rating + k * (points - expected)), games: me.games + 1 };
}

// Nächstes Rätsel: passendes Thema ('mix' = alle), noch nicht gesehen, Wertung nah an meiner
// (erst ±100, dann immer breiter). Alle gesehen → wieder von vorn. Kein Rätsel zum Thema → null.
export function pickPuzzle(list, rating, theme, seen, random = Math.random) {
  const pool = theme === 'mix' ? list : list.filter((row) => row[4].split(' ').includes(theme));
  if (!pool.length) return null;
  const fresh = pool.filter((row) => !seen.has(row[0]));
  const from = fresh.length ? fresh : pool;
  for (let width = 100; ; width += 100) {
    const near = from.filter((row) => Math.abs(row[3] - rating) <= width);
    if (near.length) return near[Math.floor(random() * near.length)];
  }
}

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// „Bester Zug?“: Lösungszug und drei andere Züge, die verlockend aussehen (Schlagen, Schach, dieselbe Figur,
// dasselbe Zielfeld). Kein anderes Matt, denn das wäre auch richtig. Liefert [{ uci, san, right }] gemischt.
export function choicesFor(p, random = Math.random) {
  const chess = new Chess(p.fen);
  chess.move(parse(p.line[0]));
  const all = chess.moves({ verbose: true });
  const right = all.find((m) => m.lan === p.line[1]);
  const target = right.after; // Stellung nach dem Lösungszug
  const alsoRight = (m) => m.after === target || m.san.endsWith('#'); // wie isRight, nur ohne Nachspielen
  const lure = (m) => (m.captured ? 2 + VALUE[m.captured] / 3 : 0) + (m.san.includes('+') ? 2 : 0) + (m.from === right.from ? 1 : 0) + (m.to === right.to ? 1 : 0) + random() * 1.5;
  const wrong = all
    .filter((m) => m !== right && !alsoRight(m)) // auch kein anderes Matt
    .map((m) => ({ m, score: lure(m) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ m }) => m);
  const list = [right, ...wrong].map((m) => ({ uci: m.lan, san: m.san, right: m === right }));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
