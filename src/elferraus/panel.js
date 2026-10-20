// Seitenfeld rechts (HTML): Spieler mit Kartenzahl und Punktestand, Status, was zuletzt passiert ist, Knöpfe
// „Karte ziehen“ / „Fertig“, Wahl der Spielerzahl, Rundenende, Punkteliste und die Regeln in Kurzform.
// Alles nur per textContent – Namen kommen vom Netz.
import './elferraus.css';

export function createPanel(root, { solo, onSetup, onDraw, onEnd, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="er-head"><span class="brand">Elfer raus!</span><span data-round></span></div>
    <table class="er-players"><tbody data-players></tbody></table>
    <p class="er-status" data-status></p>
    <div class="er-setup" data-setup hidden>
      <p>Wie viele sitzen am Tisch?</p>
      <div class="row" data-counts></div>
      <p class="muted small" data-setup-note></p>
    </div>
    <div class="row er-actions" data-actions>
      <button class="secondary small" data-draw>Karte ziehen</button>
      <button class="small" data-end>Fertig</button>
    </div>
    <p class="er-last" data-last></p>
    <p class="er-hint" data-hint></p>
    <div class="er-end" data-end-box hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nächste Runde</button>
      <button class="secondary small" data-regroup>Andere Spielerzahl</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="er-list" data-list-box>
      <summary>Punkteliste</summary>
      <table><thead data-list-head></thead><tbody data-list></tbody></table>
    </details>
    <details class="er-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Wer die <b>rote 11</b> hat, legt sie aus – der Nächste ist dran</li>
        <li><b>Anlegen</b>: an die 11 derselben Farbe abwärts (10 … 1) und aufwärts (12 … 20) – oder eine andere 11 als neue Reihe</li>
        <li>So viele Karten wie du willst, aber <b>mindestens eine</b>, wenn eine passt – zurückhalten blockiert die anderen</li>
        <li>Nichts passt: <b>ziehen</b>, bis eine passt – höchstens 3 Karten; die passende gleich anlegen</li>
        <li>Wer zuerst keine Karte mehr hat, gewinnt; die anderen schreiben ihre Restpunkte auf – wenig ist gut</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.count) onSetup(Number(b.dataset.count));
    else if ('draw' in b.dataset) onDraw();
    else if ('end' in b.dataset) onEnd();
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
    // players: [{ name, cards, score, turn }] ab mir · setup: null | { counts: [{ n, text }], note } ·
    // actions: null | { draw, end, endText } · end: null | { title, text, regroup } · list: { names, rows, total }
    render({ round, players, status, setup, actions, last, hint, end, list }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        tr.append(cell('td', p.turn ? '▶' : '', 'er-arrow'), cell('td', p.name), cell('td', p.cards === null ? '' : p.cards === 1 ? '1 Karte' : `${p.cards} Karten`, 'muted'), cell('td', String(p.score), 'er-score'));
        return tr;
      }));
      q('status').textContent = status;
      q('setup').hidden = !setup;
      if (setup) {
        q('counts').replaceChildren(...setup.counts.map((c) => {
          const b = cell('button', c.text, 'small');
          b.dataset.count = String(c.n);
          return b;
        }));
        q('setup-note').textContent = setup.note;
      }
      q('actions').hidden = !actions;
      if (actions) {
        q('draw').disabled = !actions.draw;
        q('end').disabled = !actions.end;
        q('end').textContent = actions.endText;
      }
      q('last').textContent = last;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('end-box').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('regroup').hidden = !end.regroup;
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      q('list-box').hidden = !list.rows.length;
      const head = document.createElement('tr');
      head.append(cell('th', ''), ...list.names.map((n) => cell('th', n)));
      q('list-head').replaceChildren(head);
      const rows = list.rows.map((r) => {
        const tr = document.createElement('tr');
        tr.append(cell('td', `Runde ${r.round}`, 'muted'), ...r.points.map((x) => cell('td', String(x))));
        return tr;
      });
      const total = document.createElement('tr');
      total.className = 'total';
      total.append(cell('td', 'Summe'), ...list.total.map((x) => cell('td', String(x))));
      q('list').replaceChildren(...rows, total);
    },
  };
}
