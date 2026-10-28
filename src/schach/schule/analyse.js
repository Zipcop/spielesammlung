// Schach-Schule, Analysebrett (Anzeige): Stellung aufbauen (Figur aus der Leiste wählen, Feld anklicken; gleiche Figur
// nochmal = weg), wer zieht, FEN einfügen/kopieren, letzte gespeicherte Schach-Partie laden. Dann „Analysieren“:
// beide Seiten frei ziehen, „Zurück“ nimmt Züge zurück; Stockfish zeigt Bewertung, beste Variante (Pfeil) und einen Satz
// zum besten Zug (editor.js explainBest).
import { german } from '../panel.js';
import { pieceSvg } from '../flach.js';
import { loadSaves } from '../../saves.js';
import { START, EMPTY, placeOn, pieceAt, setTurn, checkFen, evalWhite, explainBest } from './editor.js';
import { stateOf, plainState, moveText } from './brett.js';

const GO = 'depth 16';
const PIECES = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const bold = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function openAnalyse(ctx) {
  let mode = 'edit'; // edit | play
  let fen = START; // Stellung im Aufbau bzw. Startstellung der Analyse
  let moves = [];
  let tool = 'P'; // gewählte Figur oder 'x' = entfernen
  let view = 0; // 0 = Weiß unten, 1 = Schwarz unten
  let message = '';
  let shownFen = null;

  // --- Aufbau ---
  function edit() {
    mode = 'edit';
    moves = [];
    ctx.setPlay(null);
    ctx.marks();
    ctx.setSquares(placeAt);
    const saved = loadSaves().Schach?.state;
    ctx.body.innerHTML = `
      <p class="sch-note">Figur wählen, dann Feld anklicken. Dieselbe Figur nochmal = entfernen.</p>
      <div class="sch-palette">${PIECES.map((p) => `<button class="secondary" data-tool="${p}" title="${p}">${pieceSvg(p === p.toUpperCase() ? 'w' : 'b', p.toLowerCase())}</button>`).join('')}<button class="secondary" data-tool="x" title="Entfernen">✕</button></div>
      <div class="row">
        <label class="pz-theme">Am Zug <select data-turn><option value="w">Weiß</option><option value="b">Schwarz</option></select></label>
        <button class="secondary small" data-flip>Brett drehen</button>
      </div>
      <div class="row"><button class="secondary small" data-start>Grundstellung</button><button class="secondary small" data-empty>Nur Könige</button></div>
      ${saved?.moves?.length ? '<button class="secondary small" data-load>Letzte Schach-Partie laden</button>' : ''}
      <label class="sch-fen">FEN <input data-fen spellcheck="false"></label>
      <div class="row"><button class="secondary small" data-apply>FEN übernehmen</button><button class="secondary small" data-copy>FEN kopieren</button></div>
      <p class="chess-status" data-status></p>
      <button data-go>Analysieren</button>`;
    drawEdit();
  }

  function placeAt(sq) {
    if (mode !== 'edit') return;
    const piece = tool === 'x' || pieceAt(fen, sq) === tool ? null : tool;
    fen = placeOn(fen, sq, piece);
    message = '';
    drawEdit();
  }

  function drawEdit() {
    ctx.show(plainState(fen, view), true);
    ctx.body.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    ctx.q('turn').value = fen.split(' ')[1];
    ctx.q('fen').value = fen;
    const c = checkFen(fen);
    ctx.q('status').textContent = message || (c.ok ? 'Stellung ist gültig.' : c.error);
    ctx.q('status').classList.toggle('check', !c.ok);
    ctx.q('go').disabled = !c.ok;
  }

  function applyFen() {
    const c = checkFen(ctx.q('fen').value);
    if (!c.ok) {
      message = c.error;
      ctx.q('status').textContent = c.error;
      ctx.q('status').classList.add('check');
      return;
    }
    fen = c.fen;
    message = 'FEN übernommen.';
    drawEdit();
  }

  function copyFen() {
    const text = mode === 'edit' ? fen : current().fen;
    navigator.clipboard?.writeText(text).then(() => setStatus('FEN kopiert.'), () => setStatus(text));
  }

  function setStatus(text) {
    message = text;
    if (ctx.q('status')) ctx.q('status').textContent = text;
  }

  function loadGame() {
    const s = loadSaves().Schach?.state;
    try {
      stateOf(START, s.moves); // regelwidrige Züge („Ohne Hilfen“) lassen sich nicht nachspielen
      fen = START;
      view = s.white === 0 ? 0 : 1;
      analyse(s.moves);
    } catch {
      setStatus('Diese Partie lässt sich nicht laden (regelwidrige Züge).');
    }
  }

  // --- Analyse ---
  const current = () => stateOf(fen, moves, view);

  function analyse(start = []) {
    const c = checkFen(fen);
    if (!c.ok) return;
    fen = c.fen;
    mode = 'play';
    moves = [...start];
    ctx.setSquares(null);
    ctx.body.innerHTML = `
      <div class="sch-eval" data-eval>…</div>
      <p class="sch-coach" data-best></p>
      <p class="sch-note" data-line></p>
      <p class="sch-moves" data-moves></p>
      <p class="chess-status" data-status></p>
      <div class="row"><button class="secondary small" data-undo>Zurück</button><button class="secondary small" data-flip>Brett drehen</button></div>
      <div class="row"><button class="secondary small" data-edit>Bearbeiten</button><button class="secondary small" data-copy>FEN kopieren</button></div>`;
    ctx.show(current(), true);
    ctx.setPlay({ color: 'any', onMove: (uci) => {
      moves = [...moves, uci];
      ctx.show(current());
      think();
    } });
    think();
  }

  // Stockfish zur aktuellen Stellung
  function think() {
    const s = current();
    shownFen = s.fen;
    ctx.marks();
    ctx.q('moves').textContent = moveText(s.san, german, fen) || 'Noch keine Züge – zieh frei für beide Seiten.';
    ctx.q('undo').disabled = !moves.length;
    message = '';
    ctx.q('status').textContent = '';
    if (s.over) { // Matt, Patt oder Remis-Regel – da rechnet Stockfish nicht
      ctx.q('eval').textContent = s.mate ? 'Schachmatt' : 'Remis';
      ctx.q('best').textContent = '';
      ctx.q('line').textContent = '';
      return;
    }
    ctx.q('eval').textContent = 'Stockfish rechnet …';
    ctx.analyse(s.fen, GO).then((r) => {
      if (!r || shownFen !== s.fen || mode !== 'play') return;
      const turn = s.fen.split(' ')[1];
      const pv = r.lines[0]?.pv?.[0] === r.best ? r.lines[0].pv : [r.best];
      ctx.q('eval').textContent = r.score ? (r.score.mate !== undefined ? evalWhite(r.score, turn) : `Bewertung ${evalWhite(r.score, turn)} (+ gut für Weiß)`) : '';
      const text = explainBest(s.fen, pv, r.score);
      ctx.q('best').innerHTML = text ? bold(text) : '';
      let line = [];
      try {
        line = stateOf(s.fen, pv.slice(0, 8)).san;
      } catch {
        line = [];
      }
      ctx.q('line').textContent = line.length ? `Beste Variante: ${moveText(line, german, s.fen)}` : '';
      ctx.marks([{ uci: r.best, look: 'blue' }]);
    });
  }

  function undo() {
    if (!moves.length) return;
    moves = moves.slice(0, -1);
    ctx.show(current(), true);
    think();
  }

  edit();
  return {
    click(b) {
      if (b.dataset.tool) {
        tool = b.dataset.tool;
        ctx.body.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x.dataset.tool === tool));
      } else if ('start' in b.dataset) {
        fen = START;
        message = '';
        drawEdit();
      } else if ('empty' in b.dataset) {
        fen = EMPTY;
        message = '';
        drawEdit();
      } else if ('flip' in b.dataset) {
        view = 1 - view;
        if (mode === 'edit') drawEdit();
        else {
          ctx.show(current(), true);
          think();
        }
      } else if ('apply' in b.dataset) applyFen();
      else if ('copy' in b.dataset) copyFen();
      else if ('load' in b.dataset) loadGame();
      else if ('go' in b.dataset) analyse();
      else if ('undo' in b.dataset) undo();
      else if ('edit' in b.dataset) {
        fen = current().fen;
        edit();
      }
    },
    change(el) {
      if (el.dataset.turn !== undefined) {
        fen = setTurn(fen, el.value);
        message = '';
        drawEdit();
      }
    },
  };
}
