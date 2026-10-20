// Seitenfeld rechts (HTML): Spieler mit Leben, Ansagen dieser Runde, eigener Wurf, Knöpfe für Würfeln / Ansagen /
// Glauben / Aufdecken, Anklage, Spielende und die Regeln in Kurzform. Alles nur per textContent – Namen kommen vom Netz.
import './maexchen.css';
import { CLAIMS, LIVES } from './game.js';

export function createPanel(root, { solo, onAction, onAccuse, onLeave }) {
  root.innerHTML = `
    <div class="mx-head"><span class="brand">Mäxchen</span><span data-round></span></div>
    <table class="mx-players"><tbody data-players></tbody></table>
    <p class="mx-status" data-status></p>
    <p class="mx-says" data-says></p>
    <p class="mx-mine" data-mine></p>
    <div class="mx-acts" data-acts></div>
    <div class="mx-claims" data-claims hidden>${CLAIMS.map((v) => `<button class="small" data-claim="${v}">${v === 21 ? 'Mäxchen' : v}</button>`).join('')}</div>
    <div class="mx-accuse" data-accuse hidden>
      <p>Wer hat geschummelt?</p>
      <div class="row" data-targets></div>
      <button class="secondary small" data-accuse-cancel>Abbrechen</button>
    </div>
    <p class="mx-hint" data-hint></p>
    <div class="mx-last" data-last></div>
    <div class="mx-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nochmal spielen</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="mx-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Höhere Zahl = Zehner: 3 + 1 = 31, 6 + 4 = 64</li>
        <li><b>Rangfolge</b>: 31, 32, 41 … 65, dann Pasch (11 bis 66), ganz oben <b>Mäxchen</b> (21)</li>
        <li>Ansagen müssen steigen – lügen ist erlaubt</li>
        <li>Der Nächste <b>glaubt</b> (würfelt selbst, ohne nachzusehen) oder <b>deckt auf</b></li>
        <li>Aufgedeckt: Lügner verliert 1 Leben, sonst der Zweifler – beim Mäxchen 2</li>
        <li>Mäxchen kann man ohne Aufdecken glauben: 1 Leben · jeder hat ${LIVES}, die Runde beginnt der Gewinner</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.claim) onAction('announce', Number(b.dataset.claim));
    else if (b.dataset.act) onAction(b.dataset.act);
    else if (b.dataset.target) onAccuse(Number(b.dataset.target));
    else if ('accuseCancel' in b.dataset) onAccuse(null);
    else if ('again' in b.dataset) onAction('again');
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  const cell = (tag, text, cls = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  return {
    // players: [{ name, lives, turn }] ab mir · acts: [{ act, text, secondary }] · claims: null | Set erlaubter Werte ·
    // accuse: null | [{ seat, name }] · last: [Sätze] · end: null | { title, text }
    render({ round, players, status, says, mine, acts, claims, accuse, hint, last, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        if (p.lives <= 0) tr.classList.add('out');
        tr.append(cell('td', p.turn ? '▶' : '', 'mx-arrow'), cell('td', p.name),
          cell('td', p.lives > 0 ? '●'.repeat(p.lives) + '○'.repeat(Math.max(0, LIVES - p.lives)) : 'raus', 'mx-lives'));
        return tr;
      }));
      q('status').textContent = status;
      q('says').textContent = says;
      q('says').hidden = !says;
      q('mine').textContent = mine;
      q('mine').hidden = !mine;
      q('acts').replaceChildren(...acts.map((a) => {
        const b = cell('button', a.text, a.secondary ? 'secondary' : '');
        b.dataset.act = a.act;
        return b;
      }));
      q('acts').hidden = !acts.length;
      q('claims').hidden = !claims;
      if (claims) root.querySelectorAll('[data-claim]').forEach((b) => (b.disabled = !claims.has(Number(b.dataset.claim))));
      q('accuse').hidden = !accuse;
      if (accuse) {
        q('targets').replaceChildren(...accuse.map((t) => {
          const b = cell('button', t.name, 'small');
          b.dataset.target = String(t.seat);
          return b;
        }));
      }
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('last').replaceChildren(...last.map((t) => cell('p', t)));
      q('end').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
    },
  };
}
