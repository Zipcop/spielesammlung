// Schach-Schule, Eröffnungs-Training (Anzeige): Eröffnung wählen, Hauptlinie ziehen – du deine Seite, der Computer die
// andere. Falscher Zug → grüner Pfeil zeigt den richtigen, den spielst du dann. Regeln in eroeffnungen.js.
import { german } from '../panel.js';
import { OPENINGS, SURE_STREAK, movesOf, uciOf, isMine, check, finishRun, toRepeat } from './eroeffnungen.js';
import { stateOf, moveText } from './brett.js';
import { START as START_FEN } from './editor.js';

const REPLY_MS = 450;
const SIDE = { w: 'Weiß', b: 'Schwarz' };

export function openEroeffnung(ctx) {
  let op = null;
  let line = [];
  let ply = 0;
  let errors = 0;
  let missed = false; // an dieser Stelle schon danebengelegen (Fehler zählt einmal je Zug)
  let message = '';
  let phase = 'list'; // list | play | wait | done
  let book = null; // openings.json (für „auch ein Buchzug“)

  import('../openings.json').then((m) => (book = m.default));

  function status(o) {
    const p = ctx.schule.openings[o.id];
    if (p?.sure) return '<span class="sch-check">✓ sicher</span>';
    if (p?.errors) return `<span class="sch-warn">üben (${p.streak}/${SURE_STREAK})</span>`;
    return p ? `<span class="sch-muted">${p.streak}/${SURE_STREAK}</span>` : '';
  }

  function renderList() {
    ctx.fresh();
    phase = 'list';
    ctx.setPlay(null);
    ctx.marks();
    const repeat = toRepeat(ctx.schule.openings);
    const group = (side) => OPENINGS.filter((o) => o.side === side).map((o) => `<button class="secondary sch-item" data-op="${o.id}"><span>${o.name}</span>${status(o)}</button>`).join('');
    ctx.body.innerHTML = `
      ${repeat ? `<button data-repeat="${repeat}">Fehler wiederholen</button>` : ''}
      <h3 class="sch-h">Mit Weiß</h3><div class="sch-list">${group('w')}</div>
      <h3 class="sch-h">Mit Schwarz</h3><div class="sch-list">${group('b')}</div>
      <p class="sch-note">Sicher = ${SURE_STREAK}-mal hintereinander ohne Fehler. Namen und Buchstellungen: Lichess-Eröffnungsliste (CC0).</p>`;
  }

  function start(id) {
    op = OPENINGS.find((o) => o.id === id);
    ctx.fresh();
    line = uciOf(op);
    ply = 0;
    errors = 0;
    missed = false;
    ctx.body.innerHTML = `
      <h3 class="sch-h">${op.name}</h3>
      <p class="sch-goal">Du spielst ${SIDE[op.side]} · ${movesOf(op).length} Halbzüge</p>
      <p class="chess-status" data-status></p>
      <p class="sch-moves" data-moves></p>
      <p class="sch-note" data-book>${op.book}</p>
      <div class="row"><button class="secondary small" data-restart>Von vorn</button><button class="secondary small" data-list>Alle Eröffnungen</button></div>`;
    ctx.marks();
    ctx.show(state(), true);
    step();
  }

  const state = () => stateOf(START_FEN, line.slice(0, ply), op.side === 'w' ? 0 : 1);

  // Wer ist dran? Computerzug von selbst, sonst warten
  function step() {
    if (ply >= line.length) return done();
    if (isMine(op, ply)) {
      phase = 'play';
      message = missed ? 'Spiel jetzt den Zug mit dem grünen Pfeil.' : 'Dein Zug.';
      ctx.setPlay({ color: op.side, onMove });
      return render();
    }
    phase = 'wait';
    message = 'Der Computer zieht …';
    ctx.setPlay(null);
    render();
    ctx.later(REPLY_MS, () => {
      ply++;
      ctx.show(state());
      step();
    });
  }

  function onMove(uci) {
    if (phase !== 'play') return;
    if (check(op, ply, uci)) {
      ply++;
      missed = false;
      ctx.marks();
      ctx.show(state());
      return step();
    }
    if (!missed) errors++;
    missed = true;
    const after = stateOf(state().fen, [uci]);
    const key = after.fen.split(' ').slice(0, 2).join(' ');
    const alsoBook = book && book[key] !== undefined;
    const right = german(stateOf(state().fen, [line[ply]]).san[0]);
    message = `${german(after.san[0])} ist nicht die Hauptlinie${alsoBook ? ' (aber auch ein Buchzug)' : ''}. Hier spielt man ${right}.`;
    ctx.marks([{ uci: line[ply], look: 'green' }]);
    ctx.show(state()); // falscher Zug bleibt nicht stehen
    render();
  }

  function done() {
    phase = 'done';
    ctx.setPlay(null);
    ctx.schule.openings = finishRun(ctx.schule.openings, op.id, errors);
    ctx.save();
    const p = ctx.schule.openings[op.id];
    message = errors ? `${errors} Fehler – gleich nochmal, bis sie sitzt.` : p.sure ? `Fehlerfrei – ${op.name} sitzt (✓ sicher)!` : `Fehlerfrei! Noch ${SURE_STREAK - p.streak}-mal, dann ist sie sicher.`;
    render();
    ctx.q('restart').textContent = 'Nochmal';
  }

  function render() {
    if (!ctx.q('status')) return;
    ctx.q('status').textContent = message || (phase === 'wait' ? 'Der Computer zieht …' : '');
    ctx.q('status').classList.toggle('pz-good', phase === 'done' && !errors);
    ctx.q('moves').textContent = moveText(state().san, german, START_FEN) || '–';
  }

  renderList();
  return {
    click(b) {
      if (b.dataset.op) start(b.dataset.op);
      else if (b.dataset.repeat) start(b.dataset.repeat);
      else if ('list' in b.dataset) renderList();
      else if ('restart' in b.dataset) start(op.id);
    },
  };
}
