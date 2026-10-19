// Seitenfeld rechts (HTML): vor dem Spiel die Farbwahl, dann vier Spieler mit Farbe und Fortschritt, Status,
// Verlauf, „Würfeln“, Regeln in Kurzform und das Spielende mit Plätzen.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML im Fenster.
import './maedn.css';
import { COLORS } from './print.js';

export function createPanel(root, { solo, onRoll, onAgain, onLeave, onPick }) {
  root.innerHTML = `
    <div class="md-head"><span class="brand">Mensch ärgere Dich nicht</span></div>
    <ul class="md-players">${COLORS.map((c, k) => `
      <li data-seat="${k}"><span class="md-dot" style="--c:${c.css}"></span><span class="md-name"></span><span class="md-goal"></span></li>`).join('')}
    </ul>
    <p class="md-status" data-status></p>
    <div class="md-colors" data-choose hidden>${COLORS.map((c, k) => `
      <button class="md-color" data-color="${k}" style="--c:${c.css}"><span class="md-dot"></span><span>${c.name}</span><small></small></button>`).join('')}
    </div>
    <div class="md-actions" data-running>
      <button data-roll>Würfeln</button>
    </div>
    <ol class="md-log" data-log></ol>
    <div class="md-end" data-end hidden>
      <h3 data-end-title></h3>
      <ol data-end-places></ol>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="md-rules">
      <li>Aus dem Haus nur mit einer <b>6</b> – bei einer 6 darfst du wählen: rauskommen oder ziehen</li>
      <li>Das A-Feld räumen, solange noch Figuren im Haus warten</li>
      <li><b>6</b> = nach dem Zug nochmal würfeln</li>
      <li>Genau auf einer fremden Figur landen = schlagen – <b>wer schlagen kann, muss schlagen</b></li>
      <li>Ins Ziel nur mit passender Zahl, dort darf man überspringen</li>
      <li>Keine Figur draußen: bis zu dreimal würfeln</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: eigene Figur anklicken, dann ein beliebiges Feld voraus – es wird nichts geprüft.
      „Geschummelt!“ geht, bis du selbst würfelst: erwischt = Figur zurück ins Haus, Fehlalarm = du setzt einmal aus.
      Auch ein ausgelassener Schlag gilt als Schummeln.</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.md-players li')];
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('color' in b.dataset) onPick(Number(b.dataset.color));
    else if ('roll' in b.dataset) onRoll();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // Farbwahl: picks = { mine, other, otherName } (Farb-Index oder null), sonst null → normales Seitenfeld
    choose({ status, picks, free }) {
      q('free').hidden = !free;
      q('status').textContent = status;
      for (const b of root.querySelectorAll('[data-color]')) {
        const k = Number(b.dataset.color);
        b.classList.toggle('on', picks.mine === k);
        b.disabled = picks.other === k;
        b.querySelector('small').textContent = picks.mine === k ? 'Du' : picks.other === k ? picks.otherName : '';
      }
      q('choose').hidden = false;
      for (const name of ['running', 'end', 'log']) q(name).hidden = true;
      root.querySelector('.md-players').hidden = true;
    },
    // players = [{ name, color, goal, out, turn, place }] je Sitz · log = Zeilen (neueste zuerst) · end = { title, places } oder null
    // free = ohne Hilfen (Hinweis zeigen)
    render({ players, status, canRoll, rollText, log, end, free }) {
      q('free').hidden = !free;
      q('choose').hidden = true;
      q('log').hidden = false;
      root.querySelector('.md-players').hidden = false;
      players.forEach((p, k) => {
        rows[k].querySelector('.md-dot').style.setProperty('--c', p.color);
        rows[k].classList.toggle('turn', p.turn);
        rows[k].classList.toggle('done', p.place > 0);
        rows[k].querySelector('.md-name').textContent = p.place > 0 ? `${p.place}. ${p.name}` : p.name;
        // ● im Ziel · ◐ unterwegs · ○ im Haus
        rows[k].querySelector('.md-goal').textContent = '●'.repeat(p.goal) + '◐'.repeat(p.out) + '○'.repeat(4 - p.goal - p.out);
      });
      q('status').textContent = status;
      q('roll').disabled = !canRoll;
      q('roll').textContent = rollText;
      q('log').replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      q('running').hidden = !!end;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-places').replaceChildren(...end.places.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      }
    },
  };
}
