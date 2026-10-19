// Allein gegen den Computer: Stockfish als Gegner (gedrosselt je Stufe) und die Bilanz je Stufe.
// Bewertung, Tipp und Abzeichen kommen aus analysis.js.
import { createEngine } from './engine.js';
import { turnOf } from './game.js';

// Skill Level 0–20 lässt Stockfish absichtlich schwächere Züge wählen; die Suchtiefe bremst zusätzlich
export const LEVELS = [
  { name: 'Anfänger', skill: 0, go: 'depth 1' },
  { name: 'Leicht', skill: 3, go: 'depth 4' },
  { name: 'Mittel', skill: 8, go: 'depth 8' },
  { name: 'Stark', skill: 14, go: 'depth 12' },
  { name: 'Meister', skill: 20, go: 'movetime 1500' },
];
const MIN_THINK_MS = 700; // der Computer zieht nicht schlagartig

// Bilanz je Stufe: { [Stufe]: { w: Siege, d: Remis, l: Niederlagen } } – nur in diesem Browser
const KEY = 'spielesammlung-schach-bilanz';
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
export function createSolo({ level, me = 0, onComputerMove }) {
  const computer = createEngine({ 'Skill Level': LEVELS[level].skill });
  let state = null;
  let gen = 0; // jede neue Stellung zählt hoch; veraltete Computerzüge werden verworfen

  function update(s) {
    if (s.result && !state?.result) saveOutcome(level, s.result.winner === me ? 'w' : s.result.winner === null ? 'd' : 'l');
    state = s;
    computer.cancel(); // laufende Rechnung ist jetzt veraltet
    gen++;
    if (!s.result && turnOf(s) !== me) think(gen);
  }

  async function think(g) {
    const started = performance.now();
    const { best } = await computer.analyse(state.fen, LEVELS[level].go);
    await new Promise((resolve) => setTimeout(resolve, MIN_THINK_MS - (performance.now() - started)));
    if (g === gen) onComputerMove(best);
  }

  return {
    update,
    stop() {
      gen++;
      computer.stop();
    },
  };
}
