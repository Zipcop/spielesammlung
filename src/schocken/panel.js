// Seitenfeld rechts (HTML): Spieler mit Deckeln, Deckel in der Mitte, Status, Wahl der Spielerzahl, der eigene Wurf als
// Würfel-Knöpfe (anklicken = herauslegen / zurück), Knöpfe Würfeln / Fertig / Sechsen umdrehen, Aufgedecktes, Anklage,
// Spielende und die Regeln in Kurzform. Alles nur per textContent – Namen kommen vom Netz.
import './schocken.css';
import { STONES } from './game.js';

const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export function createPanel(root, { solo, onSetup, onAction, onDie, onAccuse, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="sk-head"><span class="brand">Schocken</span><span data-round></span></div>
    <table class="sk-players"><tbody data-players></tbody></table>
    <p class="sk-pot" data-pot></p>
    <p class="sk-status" data-status></p>
    <div class="sk-setup" data-setup hidden>
      <p>Wie viele sitzen am Tisch?</p>
      <div class="row" data-counts></div>
    </div>
    <div class="sk-dice" data-dice></div>
    <p class="sk-mine" data-mine></p>
    <div class="sk-acts" data-acts></div>
    <div class="sk-accuse" data-accuse hidden>
      <p>Wer hat geschummelt?</p>
      <div class="row" data-targets></div>
      <button class="secondary small" data-accuse-cancel>Abbrechen</button>
    </div>
    <div class="sk-shown" data-shown></div>
    <p class="sk-hint" data-hint></p>
    <div class="sk-last" data-last></div>
    <div class="sk-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nochmal spielen</button>
      <button class="secondary small" data-regroup>Andere Spielerzahl</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="sk-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Bis zu 3 Würfe – wie oft, legt der Erste der Runde fest</li>
        <li><b>Einsen</b> herauslegen, der Rest fällt neu · zwei Sechsen in einem Wurf: eine wird zur Eins (nicht im letzten Wurf)</li>
        <li>Von unten: Zahl (221 … 665) · <b>Straße</b> · <b>General</b> (drei gleiche) · <b>Schock 2–6</b> (1-1-x) · <b>Schock aus</b> (1-1-1)</li>
        <li>Gleich: wer weniger Würfe brauchte, sonst wer früher dran war</li>
        <li>Der Niedrigste bekommt Deckel: Zahl 1, Straße 2, General 3, Schock x = x, Schock aus = alle (Hälfte verloren)</li>
        <li>Erst aus der Mitte (${STONES}), dann vom Höchsten · wer alle ${STONES} hat, verliert die Hälfte · zwei Hälften, sonst Finale</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.count) onSetup(Number(b.dataset.count));
    else if (b.dataset.die) onDie(Number(b.dataset.die));
    else if (b.dataset.act) onAction(b.dataset.act);
    else if (b.dataset.target) onAccuse(Number(b.dataset.target));
    else if ('accuseCancel' in b.dataset) onAccuse(null);
    else if ('again' in b.dataset) onAgain();
    else if ('regroup' in b.dataset) onRegroup();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  const cell = (tag, text, cls = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  return {
    // players: [{ name, stones, halves, turn, out, note }] · setup: null | [{ n, text }] · dice: [{ k, value, out, active }] ·
    // acts: [{ act, text, secondary, disabled, on }] · accuse: null | [{ seat, name }] · shown: [{ text, mark }] ·
    // end: null | { title, text, regroup }
    render({ round, players, pot, status, setup, dice, mine, acts, accuse, shown, hint, last, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        if (p.out) tr.classList.add('out');
        tr.append(cell('td', p.turn ? '▶' : '', 'sk-arrow'), cell('td', p.name), cell('td', p.note, 'sk-note'),
          cell('td', '½'.repeat(p.halves), 'sk-halves'), cell('td', p.stones ? `${p.stones} ●` : '–', 'sk-stones'));
        return tr;
      }));
      q('pot').textContent = pot;
      q('pot').hidden = !pot;
      q('status').textContent = status;
      q('setup').hidden = !setup;
      if (setup) {
        q('counts').replaceChildren(...setup.map((c) => {
          const b = cell('button', c.text, 'small');
          b.dataset.count = String(c.n);
          return b;
        }));
      }
      q('dice').replaceChildren(...dice.map((d) => {
        const b = cell('button', PIPS[d.value], `sk-die${d.out ? ' out' : ''}`);
        b.dataset.die = String(d.k);
        b.disabled = !d.active;
        b.title = d.out ? 'liegt draußen – anklicken = zurück in den Becher' : 'anklicken = herauslegen';
        return b;
      }));
      q('dice').hidden = !dice.length;
      q('mine').textContent = mine;
      q('mine').hidden = !mine;
      q('acts').replaceChildren(...acts.map((a) => {
        const b = cell('button', a.text, `${a.secondary ? 'secondary' : ''}${a.on ? ' on' : ''}`);
        b.dataset.act = a.act;
        b.disabled = !!a.disabled;
        return b;
      }));
      q('acts').hidden = !acts.length;
      q('accuse').hidden = !accuse;
      if (accuse) {
        q('targets').replaceChildren(...accuse.map((t) => {
          const b = cell('button', t.name, 'small');
          b.dataset.target = String(t.seat);
          return b;
        }));
      }
      q('shown').replaceChildren(...shown.map((r) => cell('p', r.text, r.mark)));
      q('shown').hidden = !shown.length;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('last').replaceChildren(...last.map((t) => cell('p', t)));
      q('end').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('regroup').hidden = !end.regroup;
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
    },
  };
}
