// Zug- und Stellungsbewertung aus den Zahlen von Stockfish. Quellen:
// - Gewinnchance: Lichess (scalachess core/src/main/scala/eval.scala, WinPercent).
// - Zug-Einstufung: chess.com „How are moves classified?“ (support.chess.com/en/articles/8572705, Stand 09.02.2026):
//   verlorene erwartete Punkte 0 = Bester Zug, bis 0,02 Ausgezeichnet, bis 0,05 Gut, bis 0,10 Ungenauigkeit,
//   bis 0,20 Fehler, darüber Patzer. chess.com rechnet die erwarteten Punkte zusätzlich mit der Elo-Zahl –
//   die kennen wir nicht, deshalb nehmen wir die Lichess-Gewinnchance. Brillant, Großartig und Verpasster Gewinn
//   beschreibt chess.com nur in Worten; die Umsetzung unten ist unsere eigene Auslegung davon.
// - Stellungssymbole: verbreitete Grenzen 0,3 / 0,7 / 1,5 Bauern (Lichess-Blog „Understanding chess engines'
//   evaluations“; ChessBase nutzt ähnliche). Eine feste Norm dafür gibt es nicht.
// Bewertung immer aus Sicht eines Spielers: { cp } = Hundertstel-Bauern (+ = gut für ihn),
// { mate } = Matt in n Zügen (+ er setzt matt, − er wird matt, 0 = er ist matt).
import { Chess } from 'chess.js';

const CEILING = 1000; // Anzeige: ab ±10 Bauern zählt alles als entschieden
const NOT_BAD = 0.45; // Brillant/Großartig: danach höchstens leicht schlechter (≈ −½ Bauer)
const COMPLETELY_WON = 0.97; // … und ohne den Zug nicht schon völlig gewonnen (≈ +9 Bauern)
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Gewinnchance von −1 (verloren) bis +1 (gewonnen)
export function winningChances(cp) {
  return Math.max(-1, Math.min(1, 2 / (1 + Math.exp(-0.00368208 * cp)) - 1));
}

// Gewinnchance in Prozent (0–100) für die Anzeige
export function winPercent(score) {
  const cp = score.mate !== undefined ? Math.sign(score.mate || -1) * CEILING : Math.max(-CEILING, Math.min(CEILING, score.cp));
  return 50 + 50 * winningChances(cp);
}

// Erwartete Punkte 0–1 (1 = sicher gewonnen): Matt zählt voll, sonst die Lichess-Kurve ohne Deckel
export function expected(score) {
  if (score.mate !== undefined) return score.mate > 0 ? 1 : 0;
  return 0.5 + 0.5 * winningChances(score.cp);
}

// Ausgang der Partie grob: gewonnen / offen / verloren – Grenze ±1,5 Bauern wie bei den Stellungssymbolen
const WINNING = expected({ cp: 150 });
const outcome = (e) => (e >= WINNING ? 1 : e <= 1 - WINNING ? -1 : 0);

// Bewertung aus Sicht der Seite am Zug (so liefert Stockfish sie) → Sicht des anderen
export const flip = (score) => (score.mate !== undefined ? { mate: -score.mate } : { cp: -score.cp });

// Einstufung eines Zugs. m = {
//   before, after: Bewertung vor und nach dem Zug (Sicht des Ziehenden)
//   second: Bewertung des zweitbesten Zugs (Sicht des Ziehenden), null = es gab nur diesen Zug
//   best: der Zug, den Stockfish vorschlägt?        book: Stellung danach steht im Eröffnungsbuch?
//   sacrifice: Figurenopfer (isSacrifice)?          recapture: schlägt nur gerade Geschlagenes zurück?
//   gift: erwartete Punkte, die der letzte Zug des Gegners verschenkt hat (sonst 0)
//   beforeGift: erwartete Punkte vor diesem Geschenk }
export function classify(m) {
  if (m.book) return 'buch';
  const after = expected(m.after);
  const loss = Math.max(0, expected(m.before) - after);
  if (loss < 0.02 && m.second) { // chess.com: „immer der beste oder fast beste Zug“
    const second = expected(m.second);
    const fine = after >= NOT_BAD && second < COMPLETELY_WON;
    if (fine && m.sacrifice) return 'brillant'; // „ein gutes Figurenopfer“
    // „entscheidend für den Ausgang“: alles andere wäre mindestens ein Fehler und hätte den Ausgang gedreht
    // (z. B. verloren statt offen, offen statt gewonnen) – kein bloßes Zurückschlagen
    if (fine && !m.recapture && after - second >= 0.1 && outcome(after) !== outcome(second)) return 'grossartig';
  }
  if (m.best || !m.second) return 'best';
  if (loss < 0.02) return 'ausgezeichnet';
  if (loss < 0.05) return 'gut';
  // „Verpasster Gewinn“: Der Gegner hat sich gerade verrechnet, und dieser Zug gibt den Vorteil wieder her.
  // Was er darüber hinaus verliert, muss unter 0,10 bleiben (allein höchstens eine Ungenauigkeit) –
  // sonst ist es ein eigener Fehler/Patzer.
  if (loss >= 0.1 && m.gift >= 0.1 && after > m.beforeGift - 0.1) return 'verpasst';
  return loss < 0.1 ? 'ungenau' : loss < 0.2 ? 'fehler' : 'patzer';
}

// Figurenopfer: Nach dem Zug kann der Gegner sofort Material gewinnen – mindestens 2 Bauerneinheiten
// (eine Figur gegen einen Bauern, ein Turm gegen eine Leichtfigur …), auch wenn man auf demselben Feld
// zurückschlägt. Und es ist freiwillig: Hätte man einfach ausgesetzt, wären mindestens 2 Einheiten mehr
// geblieben (sonst war das Material schon vorher verloren, z. B. nach einer Gabel). Im Schach gibt es kein
// Aussetzen – dort zählt der sicherste andere Zug (davon gibt es dann nur wenige).
export function isSacrifice(fen, uci) {
  const chess = new Chess(fen);
  const me = chess.turn();
  const material = (c) => c.board().flat().reduce((sum, p) => sum + (p ? (p.color === me ? 1 : -1) * VALUE[p.type] : 0), 0);
  // Material, wenn der Gegner (in c am Zug) das Beste schlägt und ich auf demselben Feld bestmöglich zurückschlage
  const exposed = (c) => {
    let worst = material(c);
    for (const x of c.moves({ verbose: true }).filter((m) => m.captured)) {
      c.move(x);
      let best = material(c);
      for (const r of c.moves({ verbose: true }).filter((m) => m.captured && m.to === x.to)) {
        c.move(r);
        best = Math.max(best, material(c));
        c.undo();
      }
      c.undo();
      worst = Math.min(worst, best);
    }
    return worst;
  };
  const kept = (move) => {
    chess.move(move);
    const k = exposed(chess);
    chess.undo();
    return k;
  };
  const moves = chess.moves({ verbose: true });
  const mine = moves.find((m) => m.lan === uci);
  if (!mine) return false; // regelwidrig
  const after = kept(mine);
  if (after > material(chess) - 2) return false;
  if (chess.inCheck()) return moves.some((m) => m !== mine && kept(m) >= after + 2);
  const pass = fen.split(' ');
  pass[1] = me === 'w' ? 'b' : 'w';
  pass[3] = '-'; // en passant gilt nach dem Aussetzen nicht mehr
  return after <= exposed(new Chess(pass.join(' '))) - 2;
}

// Stellungssymbol aus Sicht von Weiß (score = Bewertung aus Sicht von Weiß)
export function positionSymbol(score) {
  if (score.mate !== undefined) return score.mate > 0 ? '+−' : '−+';
  const pawns = score.cp / 100;
  const size = Math.abs(pawns);
  if (size <= 0.3) return '=';
  if (size <= 0.7) return pawns > 0 ? '⩲' : '⩱';
  if (size <= 1.5) return pawns > 0 ? '±' : '∓';
  return pawns > 0 ? '+−' : '−+';
}
