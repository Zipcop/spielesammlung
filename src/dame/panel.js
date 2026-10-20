// Seitenfeld rechts (HTML): zwei Spieler mit Steinfarbe, Steinen und Damen, Status, „Zur Dame“ und „Zug beenden“
// (ohne Hilfen), Stufe des Computers, Verlauf, Spielende mit Revanche und die Regeln in Kurzform.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML im Fenster.
import './dame.css';
import { LEVELS } from './ai.js';

export function createPanel(root, { solo, level, onCrown, onEnd, onAgain, onLeave, onLevel }) {
  root.innerHTML = `
    <div class="da-head"><span class="brand">Dame</span></div>
    <ul class="da-players">${[0, 1].map((k) => `
      <li data-row="${k}"><span class="da-dot"></span><span class="da-name"></span><span class="da-count"></span></li>`).join('')}
    </ul>
    <p class="da-status" data-status></p>
    <div class="da-actions" data-running>
      <button class="secondary" data-crown hidden>Zur Dame machen</button>
      <button class="secondary" data-end-turn hidden>Zug beenden</button>
    </div>
    ${solo ? `<label class="da-level">Computer: <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="da-log" data-log></ol>
    <div class="da-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="da-rules">
      <li>Steine ziehen <b>schräg ein Feld vorwärts</b> und schlagen nur vorwärts – über den Gegner aufs freie Feld dahinter</li>
      <li><b>Schlagzwang:</b> Kannst du schlagen, musst du – und zwar so lange es weitergeht</li>
      <li>Auf der letzten Reihe wird ein Stein zur <b>Dame</b> (Doppelstein): sie zieht und schlägt beliebig weit, auch rückwärts</li>
      <li>Verloren ohne Steine oder ohne Zug</li>
      <li>Remis: dreimal dieselbe Stellung oder 25 Züge je Seite nur mit Damen, ohne Schlagen</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Nichts leuchtet, fast alles geht – rückwärts ziehen, Schlagzwang übergehen,
      aufhören, bevor alles geschlagen ist. Nach einem Sprung oder auf der letzten Reihe: weiterspringen, „Zur Dame machen“ oder
      „Zug beenden“ (Leertaste). „Geschummelt!“ geht, bis du selbst ziehst: erwischt = Zug zurück und eine Verwarnung,
      Fehlalarm = eine Verwarnung für dich. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.da-players li')];
  if (q('level')) {
    q('level').value = String(level);
    q('level').onchange = (e) => onLevel(Number(e.target.value));
  }
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('crown' in b.dataset) onCrown();
    else if ('endTurn' in b.dataset) onEnd();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // players = [{ name, light, men, kings, strikes, turn }] (ich zuerst) · log = Zeilen (neueste zuerst)
    // end = { title, text } oder null · canCrown/canEnd = Knöpfe jetzt möglich (nur ohne Hilfen sichtbar)
    render({ players, status, free, canCrown, canEnd, log, end }) {
      q('free').hidden = !free;
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.da-dot').classList.toggle('light', p.light);
        rows[k].querySelector('.da-name').textContent = p.name;
        const parts = [`${p.men} ${p.men === 1 ? 'Stein' : 'Steine'}`];
        if (p.kings) parts.push(`${p.kings} ${p.kings === 1 ? 'Dame' : 'Damen'}`);
        if (free) parts.push(`⚠ ${p.strikes}/3`);
        rows[k].querySelector('.da-count').textContent = parts.join(' · ');
      });
      q('status').textContent = status;
      q('crown').hidden = !free || !canCrown;
      q('end-turn').hidden = !free;
      q('end-turn').disabled = !canEnd;
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
