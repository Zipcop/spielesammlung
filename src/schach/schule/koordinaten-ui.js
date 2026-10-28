// Schach-Schule, Koordinaten- und Blind-Training (Anzeige). Regeln in koordinaten.js.
import { ROUND_MS, BLIND_SHOW_MS, BLIND_ROUND, randomSquare, recordRound, blindTask, fenOf } from './koordinaten.js';
import { plainState } from './brett.js';

const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';
const GOOD = '#2fb34a';
const BAD = '#e0302a';
const FLASH_MS = 350;

export function openKoordinaten(ctx) {
  let mode = 'felder'; // felder | blind
  let color = 'w'; // wer unten sitzt
  let running = false;
  let target = null;
  let score = 0;
  let ends = 0; // Zeitpunkt, an dem die Runde endet
  let tick = null;
  let task = null; // Blind-Aufgabe
  let asked = 0;
  let right = 0;
  let blindPhase = 'idle'; // idle | look | ask | answered | done
  let flash = [];

  const white = () => (color === 'w' ? 0 : 1);

  function frame() {
    ctx.fresh();
    clearInterval(tick);
    running = false;
    ctx.setSquares(null);
    ctx.marks();
    document.body.classList.remove('sch-nocoords');
    ctx.body.innerHTML = `
      <div class="pz-modes"><button class="secondary small" data-mode="felder">Felder finden</button><button class="secondary small" data-mode="blind">Blind-Übung</button></div>
      <div data-area></div>`;
    ctx.body.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    if (mode === 'felder') felder();
    else blind();
  }

  // --- Felder finden ---
  function felder() {
    const rec = ctx.schule.coords;
    ctx.show(plainState(EMPTY, white()), true);
    ctx.q('area').innerHTML = `
      <label class="pz-theme">Unten <select data-color><option value="w">Weiß</option><option value="b">Schwarz</option></select></label>
      <div class="sch-target" data-target>–</div>
      <div class="sch-box"><span data-time>${ROUND_MS / 1000} s</span> · Treffer: <b data-score>0</b></div>
      <button data-go>Runde starten (${ROUND_MS / 1000} s)</button>
      <p class="sch-note" data-rec>Rekord Weiß unten: ${rec.w} · Schwarz unten: ${rec.b}</p>
      <p class="sch-note">Klick das genannte Feld so schnell du kannst. Die Buchstaben am 2D-Brett sind dabei ausgeblendet.</p>`;
    ctx.q('color').value = color;
  }

  function startRound() {
    running = true;
    score = 0;
    target = randomSquare();
    ends = Date.now() + ROUND_MS;
    document.body.classList.add('sch-nocoords');
    ctx.show(plainState(EMPTY, white()), true);
    ctx.setSquares(hit);
    ctx.q('go').disabled = true;
    ctx.q('color').disabled = true;
    tick = setInterval(() => (ctx.alive() ? update() : clearInterval(tick)), 100);
    update();
  }

  function hit(sq) {
    if (!running) return;
    const ok = sq === target;
    if (ok) {
      score++;
      target = randomSquare(Math.random, target);
    }
    flash = [{ square: sq, color: ok ? GOOD : BAD }];
    ctx.marks([], flash);
    ctx.later(FLASH_MS, () => ctx.marks());
    update();
  }

  function update() {
    const left = Math.max(0, ends - Date.now());
    ctx.q('time').textContent = `${(left / 1000).toFixed(1).replace('.', ',')} s`;
    ctx.q('score').textContent = score;
    ctx.q('target').textContent = running ? target : '–';
    if (running && left <= 0) endRound();
  }

  function endRound() {
    running = false;
    clearInterval(tick);
    ctx.setSquares(null);
    document.body.classList.remove('sch-nocoords');
    const r = recordRound(ctx.schule.coords, color, score);
    ctx.schule.coords = r.records;
    ctx.save();
    ctx.q('target').textContent = `${score} Treffer${r.best ? ' – Rekord!' : ''}`;
    ctx.q('go').disabled = false;
    ctx.q('go').textContent = 'Nochmal';
    ctx.q('color').disabled = false;
    ctx.q('rec').textContent = `Rekord Weiß unten: ${r.records.w} · Schwarz unten: ${r.records.b}`;
  }

  // --- Blind-Übung ---
  function blind() {
    blindPhase = 'idle';
    ctx.show(plainState(EMPTY, 0), true);
    ctx.q('area').innerHTML = `
      <p class="chess-status" data-status>Merk dir die Figuren – nach ${BLIND_SHOW_MS / 1000} Sekunden verschwinden sie.</p>
      <p class="sch-question" data-question></p>
      <div class="row" data-answers hidden><button class="secondary" data-answer="yes">Ja</button><button class="secondary" data-answer="no">Nein</button></div>
      <button data-blind>Runde starten (${BLIND_ROUND} Fragen)</button>
      <p class="sch-note" data-rec>Rekord: ${ctx.schule.blind} von ${BLIND_ROUND}</p>`;
  }

  function nextTask() {
    task = blindTask();
    blindPhase = 'look';
    ctx.marks();
    ctx.show(plainState(fenOf(task.pieces), 0), true);
    ctx.q('question').textContent = task.question;
    ctx.q('answers').hidden = true;
    ctx.q('blind').hidden = true;
    ctx.q('status').textContent = `Frage ${asked + 1} von ${BLIND_ROUND} – gut hinsehen …`;
    ctx.later(BLIND_SHOW_MS, () => {
      blindPhase = 'ask';
      ctx.show(plainState(EMPTY, 0), true);
      ctx.q('answers').hidden = false;
      ctx.q('status').textContent = 'Und? Ja oder Nein?';
    });
  }

  function answer(yes) {
    if (blindPhase !== 'ask') return;
    blindPhase = 'answered';
    asked++;
    const ok = yes === task.answer;
    if (ok) right++;
    ctx.show(plainState(fenOf(task.pieces), 0), true); // Auflösung: Figuren wieder zeigen
    ctx.marks([{ uci: task.from + task.to, look: task.answer ? 'green' : 'red' }]);
    ctx.q('answers').hidden = true;
    ctx.q('status').textContent = `${ok ? 'Richtig' : 'Falsch'} – ${task.answer ? 'ja, das geht.' : 'nein, das geht nicht.'} (${right} von ${asked})`;
    ctx.q('status').classList.toggle('pz-good', ok);
    ctx.q('blind').hidden = false;
    ctx.q('blind').textContent = asked < BLIND_ROUND ? 'Nächste Frage' : 'Auswertung';
  }

  function blindClick() {
    if (blindPhase === 'idle' || blindPhase === 'done') {
      asked = right = 0;
      ctx.q('status').classList.remove('pz-good');
      return nextTask();
    }
    if (blindPhase !== 'answered') return;
    ctx.q('status').classList.remove('pz-good');
    if (asked < BLIND_ROUND) return nextTask();
    blindPhase = 'done';
    const best = right > ctx.schule.blind;
    ctx.schule.blind = Math.max(ctx.schule.blind, right);
    ctx.save();
    ctx.marks();
    ctx.show(plainState(EMPTY, 0), true);
    ctx.q('question').textContent = '';
    ctx.q('status').textContent = `${right} von ${BLIND_ROUND} richtig${best ? ' – Rekord!' : ''}`;
    ctx.q('blind').textContent = 'Neue Runde';
    ctx.q('rec').textContent = `Rekord: ${ctx.schule.blind} von ${BLIND_ROUND}`;
  }

  frame();
  return {
    click(b) {
      if (b.dataset.mode && b.dataset.mode !== mode && !running) {
        mode = b.dataset.mode;
        frame();
      } else if ('go' in b.dataset) startRound();
      else if (b.dataset.answer) answer(b.dataset.answer === 'yes');
      else if ('blind' in b.dataset) blindClick();
    },
    change(el) {
      if (el.dataset.color === undefined || running) return;
      color = el.value;
      ctx.show(plainState(EMPTY, white()), true);
    },
    stop: () => clearInterval(tick),
  };
}
