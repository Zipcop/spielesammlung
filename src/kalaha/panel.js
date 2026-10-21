// Seitenfeld rechts (HTML): zwei Spieler mit Kalaha-Stand, Siegen und Verwarnungen, Status, allein die Stufe, vor dem
// ersten Zug die Steine je Mulde (nur der Host), ohne Hilfen die Knöpfe „Fangen“ und „Zug beenden“, Verlauf, Spielende
// mit Revanche und die Regeln in Kurzform.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML.
import './kalaha.css';
import { LEVELS } from './ai.js';
import { SEEDS } from './game.js';

export function createPanel(root, { solo, onLevel, onSeeds, onCapture, onDone, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="ka-head"><span class="brand">Kalaha</span></div>
    <ul class="ka-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="ka-name"></span><span class="ka-score"></span></li>`).join('')}
    </ul>
    <p class="ka-status" data-status></p>
    <p class="ka-hint" data-hint hidden></p>
    <div class="row" data-actions hidden>
      <button class="secondary small" data-capture>Fangen</button>
      <button class="small" data-done>Zug beenden</button>
    </div>
    ${solo ? `<label class="ka-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <label class="ka-seeds">Steine je Mulde <select data-seeds>${SEEDS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
    <ol class="ka-log" data-log></ol>
    <div class="ka-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="ka-rules">
      <li>Eigene Mulde leeren und die Steine <b>einzeln gegen den Uhrzeigersinn</b> verteilen – ins eigene Kalaha ja, das des anderen nicht</li>
      <li>Letzter Stein im eigenen Kalaha = <b>nochmal</b></li>
      <li>Letzter Stein in einer leeren eigenen Mulde, gegenüber liegen Steine = <b>alles ins eigene Kalaha</b></li>
      <li>Eine Seite leer = Schluss, Reste kommen ins eigene Kalaha · mehr Steine im Kalaha gewinnt</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Nichts wird geprüft. Mulde anklicken = Steine in die Hand, dann Stein für Stein eine Mulde
      anklicken (oder Kugel hinlegen). Gefangen wird mit „Fangen“ (Mulde des letzten Steins), dann „Zug beenden“. Eine Kugel mit der Maus in eine
      andere Mulde legen geht auch – mitten im Zug. „Geschummelt!“ geht, bis der andere selbst eine Mulde leert: erwischt = Zug zurück und eine
      Verwarnung, Fehlalarm = Verwarnung für den Rufer. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.ka-players li')];
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('capture' in b.dataset) onCapture();
    else if ('done' in b.dataset) onDone();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));
  q('seeds').onchange = (e) => onSeeds(Number(e.target.value));

  return {
    // players = [{ name, store, wins, strikes, turn }] je Spieler · log = Zeilen (neueste zuerst) · end = { title, text } oder null
    // hint = kurzer Hinweis, '' = keiner · actions = { capture, done } oder null (ausblenden) · seeds = { n, open } (open = änderbar)
    render({ players, status, hint, level, seeds, log, end, free, actions }) {
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.ka-name').textContent = p.name;
        rows[k].querySelector('.ka-score').textContent = `${p.store} im Kalaha · ${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}${free ? ` · ${p.strikes}/3 ⚠` : ''}`;
      });
      q('status').textContent = status;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('actions').hidden = !actions;
      q('capture').disabled = !actions?.capture;
      q('done').disabled = !actions?.done;
      if (q('level')) q('level').value = String(level);
      q('seeds').value = String(seeds.n);
      q('seeds').disabled = !seeds.open;
      q('seeds').title = seeds.open ? 'Gilt sofort – bis zum ersten Zug' : 'Nur vor dem ersten Zug (bei zwei Spielern stellt es der Host ein)';
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
