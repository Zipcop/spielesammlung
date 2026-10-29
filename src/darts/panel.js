// Seitenfeld rechts (HTML): beide Spieler mit Rest, Legs und Schnitt, die Pfeile der Aufnahme, Checkout-Vorschlag,
// Status, Rückmeldung zum Wurf und Tempo-Anzeige, Knöpfe (Pfeile ziehen, ohne Hilfen: Punkte eintragen, nächstes Leg),
// Einstellungen vor dem Start (Modus, Legs), allein die Stufe, Verlauf, Spielende und Regeln in Kurzform.
// Texte nur per textContent – nichts vom Netz landet als HTML im Fenster.
import './darts.css';
import { LEVELS } from './ai.js';
import { MODES, LEGS, MAX_VISIT } from './game.js';

export function createPanel(root, { solo, onSetup, onLevel, onPull, onClaim, onNext, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="dt-head"><span class="brand">Darts</span><span class="muted small" data-format></span></div>
    <ul class="dt-players">${[0, 1].map((k) => `
      <li data-p="${k}"><span class="dt-name"></span><span class="dt-rest"></span><span class="dt-legs"></span><span class="dt-avg"></span></li>`).join('')}
    </ul>
    <div class="dt-visit" data-visit><span></span><span></span><span></span><b data-sum></b></div>
    <p class="dt-checkout" data-checkout hidden></p>
    <p class="dt-status" data-status></p>
    <p class="dt-feedback" data-feedback hidden></p>
    <div class="dt-tempo" data-tempo-row><span>Tempo</span><div class="dt-bar"><i></i><div data-tempo></div></div></div>
    <div class="dt-setup" data-setup hidden>
      <div class="dt-choice">Modus ${MODES.map((m) => `<button class="secondary small" data-mode="${m}">${m}</button>`).join('')}</div>
      <div class="dt-choice">Legs ${LEGS.map((n) => `<button class="secondary small" data-legs="${n}">Best of ${n}</button>`).join('')}</div>
      <button data-start>Los geht’s</button>
    </div>
    <div class="dt-actions" data-actions hidden>
      <button data-pull>Pfeile ziehen</button>
      <form class="dt-claim" data-claim hidden>
        <input type="number" min="0" max="${MAX_VISIT}" step="1" placeholder="Punkte" data-claim-input>
        <button type="submit">Eintragen</button>
        <button type="button" class="secondary small" data-bust>Überworfen (0)</button>
      </form>
      <button data-next hidden>Nächstes Leg</button>
    </div>
    ${solo ? `<label class="dt-level">Computer <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="dt-log" data-log></ol>
    <div class="dt-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-regroup hidden>Andere Einstellungen</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="dt-rules">
      <li>Jede Aufnahme: 3 Pfeile, die Punkte gehen vom Rest ab</li>
      <li>Genau auf 0 – der letzte Pfeil muss ein <b>Doppel</b> sein (Bull = 50 zählt)</li>
      <li><b>Bust</b>: unter 0, Rest 1 oder 0 ohne Doppel – die Aufnahme zählt nicht</li>
      <li>Triple-Ring = dreifach, äußerer Ring = doppelt</li>
    </ul>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  let pick = { mode: 501, bestOf: 3 };
  const input = q('claim-input');
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.mode) pick = { ...pick, mode: Number(b.dataset.mode) };
    else if (b.dataset.legs) pick = { ...pick, bestOf: Number(b.dataset.legs) };
    else if ('start' in b.dataset) onSetup(pick);
    else if ('pull' in b.dataset) onPull();
    else if ('bust' in b.dataset) onClaim(0);
    else if ('next' in b.dataset) onNext();
    else if ('again' in b.dataset) onAgain();
    else if ('regroup' in b.dataset) onRegroup();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
    showPick();
  };
  q('claim').onsubmit = (e) => {
    e.preventDefault();
    const v = Number(input.value);
    if (input.value !== '' && Number.isInteger(v) && v >= 0 && v <= MAX_VISIT) onClaim(v);
  };
  input.onkeydown = (e) => e.key !== 'Escape' && e.stopPropagation(); // Leertaste zieht sonst die Pfeile; Esc bricht einen Wurf ab
  q('level')?.addEventListener('change', (e) => onLevel(Number(e.target.value)));

  function showPick() {
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', Number(b.dataset.mode) === pick.mode));
    root.querySelectorAll('[data-legs]').forEach((b) => b.classList.toggle('on', Number(b.dataset.legs) === pick.bestOf));
  }
  showPick();

  return {
    // players[p] = { name, rest, legs, need, avg, turn } · visit = { slots: [text], sum } | null · actions = { pull, claim, next }
    render({ format, players, visit, checkout, status, feedback, setup, actions, level, log, end }) {
      q('format').textContent = format;
      players.forEach((pl, p) => {
        const li = root.querySelector(`[data-p="${p}"]`);
        li.classList.toggle('turn', pl.turn);
        li.querySelector('.dt-name').textContent = pl.name;
        li.querySelector('.dt-rest').textContent = pl.rest;
        li.querySelector('.dt-legs').textContent = `Legs ${'●'.repeat(pl.legs)}${'○'.repeat(Math.max(0, pl.need - pl.legs))}`;
        li.querySelector('.dt-avg').textContent = pl.avg;
      });
      q('visit').hidden = !visit;
      if (visit) {
        [...q('visit').children].slice(0, 3).forEach((el, i) => {
          el.textContent = visit.slots[i] ?? '';
          el.classList.toggle('off', visit.slots[i] === undefined);
        });
        q('sum').textContent = visit.sum;
      }
      q('checkout').hidden = !checkout;
      q('checkout').textContent = checkout ? `Checkout: ${checkout}` : '';
      q('status').textContent = status;
      q('feedback').hidden = !feedback;
      q('feedback').textContent = feedback ?? '';
      q('setup').hidden = !setup;
      root.querySelectorAll('[data-setup] button').forEach((b) => (b.disabled = !setup?.mine));
      if (setup && !setup.mine) pick = { mode: setup.mode, bestOf: setup.bestOf };
      showPick();
      q('actions').hidden = !actions;
      q('pull').hidden = !actions?.pull;
      const claimWas = !q('claim').hidden;
      q('claim').hidden = !actions?.claim;
      if (actions?.claim && !claimWas) {
        input.value = '';
        input.focus();
      }
      q('next').hidden = !actions?.next;
      if (q('level') && level !== undefined) q('level').value = String(level);
      q('log').replaceChildren(...log.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('regroup').hidden = !end.regroup;
      }
    },
    // Tempo der Wurfbewegung (Anteil vom Ideal, null = ausgegraut)
    setTempo(ratio) {
      q('tempo-row').classList.toggle('idle', ratio === null);
      q('tempo').style.width = `${Math.round(Math.min(ratio ?? 0, 2) * 50)}%`;
    },
  };
}
