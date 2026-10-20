// Seitenfeld rechts (HTML): zwei Spieler mit Farbe und Siegen, Status, allein die Stufe, Verlauf, Spielende mit Revanche
// und die Regeln in Kurzform. Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML.
import './viergewinnt.css';
import { LEVELS } from './ai.js';

export function createPanel(root, { solo, onLevel, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="vg-head"><span class="brand">Vier gewinnt</span></div>
    <ul class="vg-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="vg-dot c${k}"></span><span class="vg-name"></span><span class="vg-score"></span></li>`).join('')}
    </ul>
    <p class="vg-status" data-status></p>
    <p class="vg-hint" data-hint hidden></p>
    ${solo ? `<label class="vg-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="vg-log" data-log></ol>
    <div class="vg-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="vg-rules">
      <li>Abwechselnd einen Stein in eine Spalte – er fällt nach unten</li>
      <li><b>Vier eigene in einer Reihe</b> gewinnen: waagrecht, senkrecht oder schräg</li>
      <li>Brett voll ohne Vierer = Unentschieden</li>
      <li>Bei der Revanche fängt der andere an</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Jeder Stein geht durch – auch zwei hintereinander, außer der Reihe oder einer
      vom Stapel des anderen. „Geschummelt!“ geht, bis der andere selbst einen Stein einwirft: erwischt = Stein wieder raus und eine Verwarnung,
      Fehlalarm = Verwarnung für den Rufer. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.vg-players li')];
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  return {
    // players = [{ name, wins, strikes, turn }] je Farbe · log = Zeilen (neueste zuerst) · end = { title, text } oder null
    // hint = kurzer Hinweis (z. B. „Die Spalte ist voll.“), '' = keiner
    render({ players, status, hint, level, log, end, free }) {
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.vg-name').textContent = p.name;
        rows[k].querySelector('.vg-score').textContent = `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}${free ? ` · ${p.strikes}/3 ⚠` : ''}`;
      });
      q('status').textContent = status;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
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
