// Seitenfeld rechts (HTML): zwei Spieler mit Farbe, Steinen und Siegen, Status, allein die Stufe, ohne Hilfen die Knöpfe
// „Zug beenden“ und „Aussetzen“, Verlauf, Spielende mit Revanche und die Regeln in Kurzform.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML.
import './reversi.css';
import { LEVELS } from './ai.js';

export function createPanel(root, { solo, onLevel, onDone, onPass, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="rv-head"><span class="brand">Reversi</span></div>
    <ul class="rv-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="rv-dot"></span><span class="rv-name"></span><span class="rv-score"></span></li>`).join('')}
    </ul>
    <p class="rv-status" data-status></p>
    <p class="rv-hint" data-hint hidden></p>
    <div class="row" data-actions hidden>
      <button class="small" data-done>Zug beenden</button>
      <button class="secondary small" data-pass>Aussetzen</button>
    </div>
    ${solo ? `<label class="rv-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="rv-log" data-log></ol>
    <div class="rv-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="rv-rules">
      <li>Stein so setzen, dass er gegnerische Steine <b>einschließt</b> – waagrecht, senkrecht oder schräg</li>
      <li>Alle eingeschlossenen Steine werden umgedreht</li>
      <li>Kein Zug möglich = aussetzen · keiner kann mehr = Schluss</li>
      <li>Mehr Steine gewinnt · Schwarz fängt an, bei der Revanche der andere</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Nichts wird gezeigt oder geprüft. Stein auf ein freies Feld, eingeschlossene Steine
      selbst anklicken (umdrehen), dann „Zug beenden“. Aussetzen geht immer. „Geschummelt!“ geht, bis der andere selbst setzt oder aussetzt:
      erwischt = Zug zurück und eine Verwarnung, Fehlalarm = Verwarnung für den Rufer. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.rv-players li')];
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('done' in b.dataset) onDone();
    else if ('pass' in b.dataset) onPass();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  return {
    // players = [{ name, color, discs, wins, strikes, turn }] je Spieler · log = Zeilen (neueste zuerst)
    // end = { title, text } oder null · hint = kurzer Hinweis, '' = keiner · actions = { done, pass } oder null (ausblenden)
    render({ players, status, hint, level, log, end, free, actions }) {
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.rv-dot').className = `rv-dot c${p.color}`;
        rows[k].querySelector('.rv-name').textContent = p.name;
        rows[k].querySelector('.rv-score').textContent = `${p.discs} ● · ${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}${free ? ` · ${p.strikes}/3 ⚠` : ''}`;
      });
      q('status').textContent = status;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('actions').hidden = !actions;
      q('done').disabled = !actions?.done;
      q('pass').disabled = !actions?.pass;
      if (q('level')) q('level').value = String(level);
      q('log').replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      q('free').hidden = !free;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
  };
}
