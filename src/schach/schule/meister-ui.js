// Schach-Schule, Meisterpartien „Zug raten“ (Anzeige): Die Partie läuft bis zu deinem Zug, du rätst, Stockfish vergleicht
// deinen Zug mit dem des Meisters (meister.js guessPoints), dann steht der echte Zug auf dem Brett.
import { german } from '../panel.js';
import { flip } from '../oracle.js';
import { MASTER_GAMES, MAX_POINTS, movesOf, isGuess, guessCount, guessPoints, stepAt, recordGame } from './meister.js';
import { stateOf, moveText } from './brett.js';
import { START } from './editor.js';

const GO = 'depth 14';
const AUTO_MS = 600; // Züge bis zu deinem
const SHOW_MS = 1600; // Vergleich stehen lassen, dann der echte Zug

export function openMeister(ctx) {
  let g = null;
  let line = [];
  let ply = 0;
  let points = 0;
  let guesses = 0;
  let phase = 'list'; // list | auto | guess | judge | done
  let message = '';
  let master = null; // Promise: Bewertung nach dem Meisterzug (Sicht des Ziehenden)

  function renderList() {
    ctx.fresh();
    phase = 'list';
    ctx.setPlay(null);
    ctx.marks();
    ctx.body.innerHTML = `
      <p class="sch-note">Du spielst die Seite des Siegers und rätst seine Züge. Meisterzug oder gleich gut (laut Stockfish) = ${MAX_POINTS} Punkte, schwächere Züge weniger.</p>
      <div class="sch-list">${MASTER_GAMES.map((x) => {
        const best = ctx.schule.master[x.id];
        return `<button class="secondary sch-item sch-game" data-game="${x.id}"><span><b>${x.title}</b><small>${x.white} – ${x.black}, ${x.where}</small></span><span class="sch-muted">${best === undefined ? '' : `${best}/${guessCount(x) * MAX_POINTS}`}</span></button>`;
      }).join('')}</div>`;
  }

  function start(id) {
    g = MASTER_GAMES.find((x) => x.id === id);
    ctx.fresh();
    line = movesOf(g).map((_, i) => stepAt(g, i).move.uci);
    ply = 0;
    points = guesses = 0;
    ctx.body.innerHTML = `
      <h3 class="sch-h">${g.title}</h3>
      <p class="sch-goal">${g.white} – ${g.black}, ${g.where}. Du spielst ${g.side === 'w' ? 'Weiß' : 'Schwarz'}.</p>
      <p class="chess-status" data-status></p>
      <div class="sch-box">Punkte: <b data-points>0</b> von <span data-max>0</span></div>
      <p class="sch-moves" data-moves></p>
      <div class="row"><button class="secondary small" data-restart>Von vorn</button><button class="secondary small" data-list>Alle Partien</button></div>
      <p class="pz-source">Zugfolge: ${g.source}</p>`;
    ctx.marks();
    ctx.show(state(), true);
    advance();
  }

  const state = () => stateOf(START, line.slice(0, ply), g.side === 'w' ? 0 : 1);

  // Bis zum nächsten Ratezug weiterspielen
  function advance() {
    if (ply >= line.length) return done();
    if (isGuess(g, ply)) {
      phase = 'guess';
      message = 'Welchen Zug spielte der Meister?';
      const { fen } = stepAt(g, ply);
      const after = stateOf(fen, [line[ply]]).fen;
      master = evalAfter(after); // rechnet schon, während du überlegst
      ctx.setPlay({ color: g.side, onMove });
      return render();
    }
    phase = 'auto';
    message = ply < g.from ? 'Die Eröffnung läuft …' : 'Der Gegner zieht …';
    ctx.setPlay(null);
    render();
    ctx.later(ply < g.from ? AUTO_MS / 2 : AUTO_MS, () => {
      ply++;
      ctx.marks();
      ctx.show(state());
      advance();
    });
  }

  // Bewertung nach einem Zug aus Sicht dessen, der ihn gemacht hat (Matt steht schon fest)
  function evalAfter(fen) {
    const s = stateOf(fen);
    if (s.mate) return Promise.resolve({ mate: 1 });
    return ctx.analyse(fen, GO).then((r) => (r?.score ? flip(r.score) : r === null ? null : { cp: 0 }));
  }

  function onMove(uci) {
    if (phase !== 'guess') return;
    phase = 'judge';
    ctx.setPlay(null);
    guesses++;
    const ok = ctx.token();
    const real = line[ply];
    const before = state().fen;
    const realSan = german(stateOf(before, [real]).san[0]);
    const mySan = german(stateOf(before, [uci]).san[0]);
    const same = stateOf(before, [uci]).fen === stateOf(before, [real]).fen;
    message = 'Stockfish vergleicht …';
    render();
    const mine = same ? Promise.resolve(null) : evalAfter(stateOf(before, [uci]).fen);
    Promise.all([master, mine]).then(([m, y]) => {
      if (!ok() || (!same && (!m || !y))) return;
      const got = guessPoints({ same, master: m, mine: y });
      points += got;
      message = same ? `Genau! ${realSan} – ${got} Punkte.` : `Du: ${mySan} · Meister: ${realSan} – ${got} ${got === 1 ? 'Punkt' : 'Punkte'}${got === MAX_POINTS ? ' (gleich gut)' : ''}.`;
      ctx.marks(same ? [{ uci: real, look: 'green' }] : [{ uci, look: got === MAX_POINTS ? 'blue' : 'red' }, { uci: real, look: 'green' }]);
      render();
      ctx.later(SHOW_MS, () => {
        ply++;
        ctx.show(state());
        ctx.marks([{ uci: real, look: 'green' }]);
        advance();
      });
    });
  }

  function done() {
    phase = 'done';
    ctx.setPlay(null);
    const max = guessCount(g) * MAX_POINTS;
    const r = recordGame(ctx.schule.master, g.id, points);
    ctx.schule.master = r.best;
    ctx.save();
    const end = state().mate ? 'Schachmatt!' : `${g.side === 'w' ? 'Schwarz' : 'Weiß'} gab hier auf.`;
    message = `${end} Du hast ${points} von ${max} Punkten${r.record ? ' – neuer Bestwert!' : '.'}`;
    render();
  }

  function render() {
    if (!ctx.q('status')) return;
    ctx.q('status').textContent = message;
    ctx.q('status').classList.toggle('pz-good', phase === 'done');
    ctx.q('points').textContent = points;
    ctx.q('max').textContent = guesses * MAX_POINTS;
    ctx.q('moves').textContent = moveText(state().san, german, START);
  }

  renderList();
  return {
    click(b) {
      if (b.dataset.game) start(b.dataset.game);
      else if ('list' in b.dataset) renderList();
      else if ('restart' in b.dataset) start(g.id);
    },
  };
}
