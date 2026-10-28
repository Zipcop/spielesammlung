// „Drohung zeigen“ (Schach, allein und zu zweit, nur mit Hilfen): Was würde der Gegner jetzt ziehen, wenn er
// nochmal dran wäre? Nullzug (lernen.js) an Stockfish, bester Zug als roter Pfeil, Satz aus coach.js.
// Rechnet nur auf diesem PC – übers Netz geht nichts. Stockfish startet erst beim ersten Knopfdruck.
import { createEngine } from './engine.js';
import { nullMoveFen } from './lernen.js';
import { threatText } from './coach.js';

const GO = 'depth 14'; // wie die Zuganalyse (analysis.js)

export function createThreats() {
  let engine = null;
  const cache = new Map(); // FEN → Ergebnis

  // Liefert { uci, text } – oder { check: true } (ich stehe im Schach), { none: true } (er hätte keinen Zug)
  async function find(fen) {
    if (cache.has(fen)) return cache.get(fen);
    const pass = nullMoveFen(fen);
    if (!pass) return { check: true };
    engine ??= createEngine();
    const r = await engine.analyse(pass, GO);
    const pv = r.lines[0]?.pv[0] === r.best ? r.lines[0].pv : [r.best];
    const said = r.best && r.best !== '(none)' ? threatText(pass, pv, r.score) : null;
    const out = said ? { uci: said.uci, text: said.text, threat: said.threat } : { none: true };
    cache.set(fen, out);
    return out;
  }

  return { find, stop: () => engine?.stop() };
}
