// Allein gegen den Computer: Stockfish als Gegner (gedrosselt je Stufe bzw. auf die Stärke des Coachs), die Bilanz
// je Stufe und die eigene Elo-Zahl (elo.js). Bewertung, Tipp und Abzeichen kommen aus analysis.js.
// Ohne Hilfen (free) schummelt der Computer ab und zu selbst und prüft jeden Zug des Menschen einmal (schummeln.js).
import { createEngine } from './engine.js';
import { turnOf, cheatMove, kingExposed, anyMove } from './game.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { strengthFor, recordGame } from './elo.js';

export { LEVELS } from './elo.js'; // Stufen mit fester Elo
const MIN_THINK_MS = 700; // der Computer zieht nicht schlagartig

// Bilanz je Stufe: { [Stufe]: { w: Siege, d: Remis, l: Niederlagen } } – nur in diesem Browser ('coach' = Coach-Partien)
const KEY = 'spielesammlung-schach-bilanz-2'; // neu seit den Stufen ab 400 (28.10.2026) – alte Nummern passen nicht mehr
export function loadRecord() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveOutcome(level, outcome) {
  const all = loadRecord();
  all[level] ??= { w: 0, d: 0, l: 0 };
  all[level][outcome]++;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // ohne Speicher (z. B. privates Fenster) gibt es eben keine Bilanz
  }
}

// me = mein Spieler (0), der Computer ist 1 - me
// opponent() = { elo, record (Schlüssel der Bilanz), coach } – Stärke der laufenden Partie
// onJudge(accuses): ohne Hilfen – der Computer ruft „Geschummelt!“ (true) oder verzichtet nach Partieende (false)
export function createSolo({ opponent, me = 0, onComputerMove, onJudge }) {
  let strength = strengthFor(opponent().elo);
  const computer = createEngine(strength.options);
  let state = null;
  let gen = 0; // jede neue Stellung zählt hoch; veraltete Computerzüge werden verworfen

  // hold = der Computer wartet noch (der Coach schaut sich erst meinen Zug an) – weiter mit release()
  function update(s, hold = false) {
    // Ohne Hilfen zählt nicht zur Bilanz und nicht zur Elo: Eine Partie mit Schummeln ist kein faires Ergebnis
    if (s.result && !state?.result && !s.free) {
      const { elo, record, coach } = opponent();
      const outcome = s.result.winner === me ? 'w' : s.result.winner === null ? 'd' : 'l';
      saveOutcome(record, outcome);
      recordGame(elo, { w: 1, d: 0.5, l: 0 }[outcome], coach);
    }
    state = s;
    computer.cancel(); // laufende Rechnung ist jetzt veraltet
    gen++;
    // Ohne Hilfen prüft der Computer den Zug des Menschen genau einmal, bevor er selbst zieht – auch wenn der Zug
    // die Partie beendet hat (dann schließt sein Verzicht die Frist)
    const open = s.free && s.cheat?.player === me;
    // Lässt der Mensch seinen König im Schach stehen, sagt man es am Brett immer – und Stockfish könnte die Stellung nicht rechnen
    const accuses = open && (kingExposed(s) || cpuAccuses(!s.cheat.legal));
    if (accuses || (open && s.result)) judge(gen, accuses);
    else if (!hold && !s.result && turnOf(s) !== me) think(gen);
  }

  async function judge(g, accuses) {
    await new Promise((resolve) => setTimeout(resolve, MIN_THINK_MS)); // erst sieht man den Zug, dann ruft er
    if (g === gen) onJudge(accuses);
  }

  // forced = diesen Zug spielen (die Drohung, die der Coach angekündigt hat)
  async function think(g, forced) {
    const started = performance.now();
    const next = strengthFor(opponent().elo); // neue Partie, andere Stärke (Coach wächst mit)
    if (JSON.stringify(next) !== JSON.stringify(strength)) {
      strength = next;
      computer.configure({ 'Skill Level': 20, ...strength.options }); // Skill Level zurück, falls jetzt UCI_Elo gilt
    }
    // Ohne Hilfen ab und zu ein Schummelzug. Steht der König des Menschen im Schach (sollte nach update() nicht
    // vorkommen – dann ruft der Computer vorher), bekommt Stockfish die Stellung nicht – dann irgendein erlaubter Zug.
    let best = forced ?? (state.free && cpuCheats() ? cheatMove(state) : null);
    if (!best && state.free && kingExposed(state)) best = anyMove(state);
    if (!best && strength.random && Math.random() < strength.random) best = anyMove(state); // unter 1320: ab und zu ein Zufallszug
    best ??= (await computer.analyse(state.fen, strength.go)).best;
    await new Promise((resolve) => setTimeout(resolve, MIN_THINK_MS - (performance.now() - started)));
    if (g === gen) onComputerMove(best);
  }

  return {
    update,
    // Computer darf jetzt ziehen (nach update(s, true)); mit uci einen bestimmten Zug
    release(uci) {
      if (state && !state.result && turnOf(state) !== me) think(++gen, uci);
    },
    stop() {
      gen++;
      computer.stop();
    },
  };
}
