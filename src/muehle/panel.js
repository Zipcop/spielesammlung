// Seitenfeld rechts (HTML): zwei Spieler mit Steinfarbe und Steinen, Status, „Zug beenden“ (ohne Hilfen),
// Stufe des Computers, Verlauf, Spielende mit Revanche und die Regeln in Kurzform.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML im Fenster.
import './muehle.css';
import { LEVELS } from './ai.js';

export function createPanel(root, { solo, level, onPass, onAgain, onLeave, onLevel }) {
  root.innerHTML = `
    <div class="mu-head"><span class="brand">Mühle</span></div>
    <ul class="mu-players">${[0, 1].map((k) => `
      <li data-row="${k}"><span class="mu-dot"></span><span class="mu-name"></span><span class="mu-count"></span></li>`).join('')}
    </ul>
    <p class="mu-status" data-status></p>
    <div class="mu-actions" data-running>
      <button class="secondary" data-pass hidden>Zug beenden</button>
    </div>
    ${solo ? `<label class="mu-level">Computer: <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="mu-log" data-log></ol>
    <div class="mu-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="mu-rules">
      <li>Erst alle 9 Steine <b>setzen</b>, dann auf einen freien Nachbarpunkt <b>ziehen</b></li>
      <li>Nur noch 3 Steine: auf jeden freien Punkt <b>springen</b></li>
      <li>Drei in einer Linie = <b>Mühle</b>: einen Stein des anderen nehmen – aus einer Mühle nur, wenn sonst keiner frei ist</li>
      <li>Verloren mit 2 Steinen oder ohne Zug</li>
      <li>Remis: dreimal dieselbe Stellung oder 20 Züge je Seite, ohne dass ein Stein fällt</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Nichts leuchtet, alles geht – auch springen, aus einer Mühle oder ohne Mühle schlagen.
      Nach jedem Zug darfst du einen Stein nehmen oder „Zug beenden“ (Leertaste). „Geschummelt!“ geht, bis du selbst ziehst:
      erwischt = Zug zurück und eine Verwarnung, Fehlalarm = eine Verwarnung für dich. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.mu-players li')];
  if (q('level')) {
    q('level').value = String(level);
    q('level').onchange = (e) => onLevel(Number(e.target.value));
  }
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('pass' in b.dataset) onPass();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // players = [{ name, light, hand, board, strikes, turn }] (ich zuerst) · log = Zeilen (neueste zuerst)
    // end = { title, text } oder null · canPass = „Zug beenden“ jetzt möglich (nur ohne Hilfen sichtbar)
    render({ players, status, free, canPass, log, end }) {
      q('free').hidden = !free;
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.mu-dot').classList.toggle('light', p.light);
        rows[k].querySelector('.mu-name').textContent = p.name;
        const parts = [];
        if (p.hand > 0) parts.push(`Hand ${p.hand}`);
        parts.push(`Brett ${p.board}`);
        if (free) parts.push(`⚠ ${p.strikes}/3`);
        rows[k].querySelector('.mu-count').textContent = parts.join(' · ');
      });
      q('status').textContent = status;
      q('pass').hidden = !free;
      q('pass').disabled = !canPass;
      q('log').replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      q('running').hidden = !!end || !free;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
  };
}
