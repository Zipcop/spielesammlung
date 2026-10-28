// Schach-Schule, Endspiel-Training (Anzeige): Lehrstellung wählen, gegen Stockfish (volle Stärke) spielen, bis das Ziel
// erreicht oder verfehlt ist (endspiele.js judge). Nach einem Fehler erklärt der Coach (coach.js), was besser gewesen wäre.
import { german } from '../panel.js';
import { explainBetter } from '../coach.js';
import { flip } from '../oracle.js';
import { ENDGAMES, judge } from './endspiele.js';
import { stateOf } from './brett.js';

const GO = 'depth 18 movetime 1500'; // volle Stärke, aber ohne lange Wartezeit
const REPLY_MS = 300;
const GOAL = { mate: 'Setze matt', promote: 'Bring den Bauern durch', draw: 'Halte Remis' };
const COLOR = { w: 'Weiß', b: 'Schwarz' };
const bold = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function openEndspiel(ctx) {
  let eg = null;
  let moves = [];
  let me = 'w';
  let phase = 'list'; // list | play | wait | done | failed
  let message = '';
  let coach = '';
  let before = null; // Stockfish zur Stellung vor meinem Zug: { best, score (meine Sicht), pv }
  let beforeFen = null;

  function renderList() {
    ctx.fresh();
    phase = 'list';
    ctx.setPlay(null);
    ctx.marks();
    ctx.body.innerHTML = `
      <p class="sch-note">Lehrstellungen gegen Stockfish in voller Stärke. Geschafft = Haken.</p>
      <div class="sch-list">${ENDGAMES.map((e) => `<button class="secondary sch-item" data-eg="${e.id}"><span>${e.title}</span><span class="sch-check">${ctx.schule.endgames[e.id] ? '✓' : ''}</span></button>`).join('')}</div>`;
  }

  function start(id) {
    eg = ENDGAMES.find((e) => e.id === id);
    ctx.fresh();
    me = eg.fen.split(' ')[1];
    moves = [];
    coach = '';
    ctx.body.innerHTML = `
      <h3 class="sch-h">${eg.title}</h3>
      <p class="sch-goal" data-goal></p>
      <p class="sch-text">${eg.text}</p>
      <p class="chess-status" data-status></p>
      <p class="sch-coach" data-coach hidden></p>
      <div class="row"><button class="secondary small" data-tip>Tipp</button><button class="secondary small" data-back>Zug zurück</button><button class="secondary small" data-restart>Neu</button></div>
      <button class="secondary small" data-list>Alle Endspiele</button>`;
    ctx.q('goal').textContent = `${GOAL[eg.goal]}${eg.within ? ` in ${eg.within} Zügen` : ''}${eg.goal === 'draw' ? ` (${eg.moves} Züge lang)` : ''} – du hast ${COLOR[me]}.`;
    ctx.marks();
    ctx.show(state(), true);
    yourTurn();
  }

  const state = () => stateOf(eg.fen, moves, me === 'w' ? 0 : 1);
  const fen = () => state().fen;

  // Ich bin dran: Stockfish rechnet schon die Stellung (für Tipp und Coach)
  function yourTurn() {
    phase = 'play';
    message = 'Du bist am Zug.';
    before = null;
    beforeFen = fen();
    ctx.setPlay({ color: me, onMove });
    render();
    const at = beforeFen;
    ctx.analyse(at, GO).then((r) => {
      if (r && at === beforeFen) before = { best: r.best, score: r.score, pv: r.lines[0]?.pv ?? [r.best] };
    });
  }

  function onMove(uci) {
    if (phase !== 'play') return;
    const fenBefore = beforeFen;
    const prior = before;
    moves = [...moves, uci];
    ctx.marks();
    ctx.show(state());
    ctx.setPlay(null);
    phase = 'wait';
    message = 'Stockfish rechnet …';
    render();
    const first = judge(eg, moves);
    if (first.state) return end(first);
    ctx.analyse(fen(), GO).then((r) => {
      if (!r) return;
      const mine = r.score ? flip(r.score) : null; // Sicht der Seite am Zug → meine
      const j = judge(eg, moves, mine);
      if (j.state) {
        if (j.state === 'failed' && prior && mine) {
          const better = explainBetter(fenBefore, prior.pv, prior.score, mine, null);
          coach = better ? better.text : '';
          ctx.marks(better ? [{ uci: better.uci, look: 'green' }] : []);
        }
        return end(j);
      }
      ctx.later(REPLY_MS, () => {
        moves = [...moves, r.best];
        ctx.show(state());
        const after = judge(eg, moves);
        if (after.state) return end(after);
        yourTurn();
      });
    });
  }

  function end(j) {
    phase = j.state;
    ctx.setPlay(null);
    message = j.text;
    if (j.state === 'done' && !ctx.schule.endgames[eg.id]) {
      ctx.schule.endgames[eg.id] = true;
      ctx.save();
    }
    render();
  }

  // Letzten eigenen Zug (samt Antwort) zurücknehmen
  function back() {
    if (!['play', 'failed', 'done'].includes(phase) || !moves.length) return;
    const mineIdx = moves.length % 2 === 1 ? moves.length - 1 : moves.length - 2; // ich habe den ersten Zug
    moves = moves.slice(0, Math.max(0, mineIdx));
    ctx.fresh();
    coach = '';
    ctx.marks();
    ctx.show(state(), true);
    yourTurn();
  }

  function tip() {
    if (phase !== 'play') return;
    if (!before) {
      message = 'Stockfish rechnet noch – gleich nochmal.';
      return render();
    }
    ctx.marks([{ uci: before.best, look: 'blue' }]);
    message = `Tipp: ${german(stateOf(beforeFen, [before.best]).san[0])} (blauer Pfeil).`;
    render();
  }

  function render() {
    const status = ctx.q('status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('pz-good', phase === 'done');
    status.classList.toggle('check', phase === 'failed');
    ctx.q('coach').hidden = !coach;
    ctx.q('coach').innerHTML = coach ? `Coach: ${bold(coach)}` : '';
    ctx.q('tip').disabled = phase !== 'play';
    ctx.q('back').disabled = !moves.length || phase === 'wait';
  }

  renderList();
  return {
    click(b) {
      if (b.dataset.eg) start(b.dataset.eg);
      else if ('list' in b.dataset) renderList();
      else if ('restart' in b.dataset) start(eg.id);
      else if ('back' in b.dataset) back();
      else if ('tip' in b.dataset) tip();
    },
  };
}
