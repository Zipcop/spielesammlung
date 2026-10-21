// Seitenfeld rechts (HTML): Spieler mit Punktestand, Status, Wahl der Spielerzahl, der letzte Wurf als Würfel-Knöpfe
// (anklicken = herauslegen), Punkte dieses Zugs, Knöpfe Würfeln / Aufhören, Spielende und die Regeln in Kurzform.
// Alles nur per textContent – Namen kommen vom Netz.
import './zehntausend.css';
import { GOAL, MIN_BANK } from './game.js';

const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
export const fmt = (n) => n.toLocaleString('de-DE');

export function createPanel(root, { solo, onSetup, onAction, onDie, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="zt-head"><span class="brand">Zehntausend</span><span data-round></span></div>
    <table class="zt-players"><tbody data-players></tbody></table>
    <p class="zt-status" data-status></p>
    <div class="zt-setup" data-setup hidden>
      <p>Wie viele sitzen am Tisch?</p>
      <div class="row" data-counts></div>
    </div>
    <div class="zt-dice" data-dice></div>
    <p class="zt-turn" data-turn></p>
    <div class="zt-acts" data-acts></div>
    <p class="zt-hint" data-hint></p>
    <div class="zt-last" data-last></div>
    <div class="zt-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nochmal spielen</button>
      <button class="secondary small" data-regroup>Andere Spielerzahl</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="zt-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li><b>Eins</b> = 100, <b>Fünf</b> = 50 · drei gleiche = Augenzahl × 100, drei Einsen = 1.000</li>
        <li>Jeder weitere gleiche verdoppelt: vier Zweien 400, fünf 800 · <b>Straße</b> 1–6 = 2.000 · <b>drei Paare</b> = 1.500</li>
        <li>Kombinationen zählen nur aus einem Wurf</li>
        <li>Nach jedem Wurf mindestens einen wertenden Würfel herauslegen, dann weiterwürfeln oder aufhören (ab ${MIN_BANK})</li>
        <li><b>Niete</b> (nichts wertet): alle Punkte des Zugs sind weg · alle sechs gewertet: mit allen sechs weiter</li>
        <li>Wer zuerst ${fmt(GOAL)} hat: wer in der Runde nach ihm noch dran ist, hat einen letzten Zug, die meisten Punkte gewinnen</li>
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
    // players: [{ name, score, turn, goal }] · setup: null | [{ n, text }] · dice: [{ i, value, marked, aside, active }] ·
    // acts: [{ act, text, secondary, disabled, on }] · end: null | { title, text, regroup }
    render({ round, players, status, setup, dice, turn, acts, hint, last, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        tr.append(cell('td', p.turn ? '▶' : '', 'zt-arrow'), cell('td', p.name), cell('td', p.goal ? '★' : '', 'zt-goal'), cell('td', fmt(p.score), 'zt-score'));
        return tr;
      }));
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
        const b = cell('button', PIPS[d.value], `zt-die${d.marked ? ' marked' : ''}${d.aside ? ' aside' : ''}`);
        b.dataset.die = String(d.i);
        b.disabled = !d.active;
        b.title = d.aside ? 'schon herausgelegt' : d.marked ? 'wird herausgelegt – nochmal klicken = zurück' : 'anklicken = herauslegen';
        return b;
      }));
      q('dice').hidden = !dice.length;
      q('turn').textContent = turn;
      q('turn').hidden = !turn;
      q('acts').replaceChildren(...acts.map((a) => {
        const b = cell('button', a.text, `${a.secondary ? 'secondary' : ''}${a.on ? ' on' : ''}`);
        b.dataset.act = a.act;
        b.disabled = !!a.disabled;
        return b;
      }));
      q('acts').hidden = !acts.length;
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
