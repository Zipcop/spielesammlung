// Schach-Schule, Fortschritts-Seite (Anzeige): alles aus speicher.js summary – eigene Zahlen und die anderer Teile
// (Schach-Elo mit Kurve, Rätsel-Wertung, Tägliches Rätsel), nur gelesen.
import { loadElo, loadEloHistory } from '../elo.js';
import { loadOthers, summary, curvePoints } from './speicher.js';
import { BLIND_ROUND } from './koordinaten.js';
import { START } from './editor.js';
import { plainState } from './brett.js';

const W = 280;
const H = 90;

export function openFortschritt(ctx) {
  ctx.show(plainState(START), true);
  const s = summary({ schule: ctx.schule, ...loadOthers(), elo: loadElo(), history: loadEloHistory() });
  const row = (label, value) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const puzzle = (p) => (p ? `${p.rating} <small>(${p.solved} von ${p.games} gelöst)</small>` : '–');
  const curve = s.curve.length > 1
    ? `<svg class="sch-curve" viewBox="0 0 ${W} ${H}"><polyline points="${curvePoints(s.curve, W, H)}" /></svg><p class="sch-note">Elo nach jeder gewerteten Partie (${Math.min(...s.curve)} – ${Math.max(...s.curve)})</p>`
    : '<p class="sch-note">Die Elo-Kurve wächst ab jetzt mit jeder gewerteten Schach-Partie gegen Computer oder Coach.</p>';
  ctx.body.innerHTML = `
    <div class="sch-box"><b>Schach-Elo ${s.elo.rating}</b> · ${s.elo.games} Partien</div>
    ${curve}
    <table class="sch-table">
      ${row('Rätsel lösen', puzzle(s.puzzles.solve))}
      ${row('Bester Zug?', puzzle(s.puzzles.choose))}
      ${row('Tägliches Rätsel', s.daily ? `Serie ${s.daily.streak} <small>(beste ${s.daily.best})</small>` : '–')}
      ${row('Lernpfad', `Level ${s.path.level} · ${s.path.stars}/${s.path.max} ★ · ${s.path.done}/${s.path.total} Kapitel`)}
      ${row('Endspiele', `${s.endgames.done}/${s.endgames.total} geschafft`)}
      ${row('Eröffnungen', `${s.openings.sure}/${s.openings.total} sicher`)}
      ${row('Koordinaten', `Rekord ${s.coords.w} <small>(Weiß unten)</small> · ${s.coords.b} <small>(Schwarz unten)</small>`)}
      ${row('Blind-Übung', `${s.blind}/${BLIND_ROUND}`)}
      ${row('Meisterpartien', `${s.master.played}/${s.master.total} gespielt`)}
    </table>`;
  return {};
}
