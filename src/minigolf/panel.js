// Seitenfeld rechts (HTML): Bahn, Spielprotokoll (9 Bahnen + Summe), Status, Verlauf, Kraftanzeige, Übersicht-Knopf,
// ohne Hilfen „Ball verlegen“ und das Eintragen der Schläge, allein die Stufe, Spielende und die Regeln in Kurzform.
// Texte nur per textContent – nichts vom Netz landet als HTML im Fenster.
import './minigolf.css';
import { LEVELS } from './ai.js';
import { HOLES, MAX_STROKES } from './course.js';
import { MAX_SCORE } from './rules.js';

export function createPanel(root, { solo, onLevel, onAgain, onLeave, onOverview, onMove, onClaim }) {
  const cols = Array.from({ length: HOLES }, (_, h) => h);
  root.innerHTML = `
    <div class="mg-head"><span class="brand">Minigolf</span><span class="muted small" data-hole></span></div>
    <table class="mg-card">
      <thead><tr><th></th>${cols.map((h) => `<th data-col="${h}">${h + 1}</th>`).join('')}<th>Σ</th></tr></thead>
      <tbody>${[0, 1].map((p) => `<tr data-p="${p}"><th class="mg-name"></th>${cols.map((h) => `<td data-col="${h}"></td>`).join('')}<td class="mg-total"></td></tr>`).join('')}</tbody>
    </table>
    <p class="mg-status" data-status></p>
    <ol class="mg-log" data-log></ol>
    <div class="mg-power" data-power-row><span>Kraft</span><div class="mg-bar"><div data-power></div></div></div>
    <div class="mg-claim" data-claim hidden>
      <span>Wie viele Schläge trägst du ein?</span>
      <div>${Array.from({ length: MAX_SCORE }, (_, i) => `<button class="small" data-n="${i + 1}">${i + 1}</button>`).join('')}</div>
    </div>
    <div class="row mg-tools">
      <button class="secondary small" data-over>Übersicht</button>
      <button class="secondary small" data-move hidden>Ball verlegen</button>
    </div>
    ${solo ? `<label class="mg-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <div class="mg-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="mg-rules">
      <li>Abwechselnd: wer dran ist, spielt die Bahn zu Ende, dann der andere</li>
      <li>Jeder Schlag zählt – nach ${MAX_STROKES} Schlägen nicht drin = <b>${MAX_SCORE}</b></li>
      <li>Ball von der Bahn (Rasen, Wasser) = zurück an die Schlagstelle + 1 Strafschlag</li>
      <li>Die wenigsten Schläge über 9 Bahnen gewinnen</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Am Ende der Bahn trägst du deine Schläge selbst ein – auch falsch. „Ball verlegen“ geht
      vor jedem Schlag, so oft du willst; erlaubt ist nur Ablegen: liegt der Ball an der Bande (Hindernisse zählen nicht), einmal je Schlag
      bis 20 cm gerade von ihr weg. „Geschummelt!“ geht, bis der andere selbst
      schlägt, verlegt oder einträgt: erwischt = Eintrag berichtigt + 2 Strafschläge, Fehlalarm = 1 Strafschlag für den Rufer.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('again' in b.dataset) onAgain();
    else if ('over' in b.dataset) onOverview();
    else if ('move' in b.dataset) onMove();
    else if ('n' in b.dataset) onClaim(Number(b.dataset.n));
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  return {
    // players[p] = { name, cells: [9 Texte], total, turn } · log = Zeilen (neueste zuerst) · end = { title, text } oder null
    render({ hole, holeName, players, status, log, end, free, claim, canMove, moving, overview, level }) {
      q('hole').textContent = `Bahn ${hole + 1} · ${holeName}`;
      players.forEach((pl, p) => {
        const row = root.querySelector(`tr[data-p="${p}"]`);
        row.classList.toggle('turn', pl.turn);
        row.querySelector('.mg-name').textContent = pl.name;
        row.querySelector('.mg-name').title = pl.name;
        row.querySelectorAll('td[data-col]').forEach((td, h) => (td.textContent = pl.cells[h]));
        row.querySelector('.mg-total').textContent = pl.total;
      });
      root.querySelectorAll('[data-col]').forEach((el) => el.classList.toggle('now', Number(el.dataset.col) === hole && !end));
      q('status').textContent = status;
      q('log').replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      q('claim').hidden = !claim;
      q('move').hidden = !canMove && !moving;
      q('move').textContent = moving ? 'Verlegen abbrechen' : 'Ball verlegen';
      q('over').textContent = overview ? 'Zum Ball' : 'Übersicht';
      if (q('level')) q('level').value = String(level);
      q('free').hidden = !free;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
    // Kraft 0–1 (null = Balken ausblenden)
    setPower(power) {
      q('power-row').classList.toggle('idle', power === null);
      q('power').style.width = `${Math.round((power ?? 0) * 100)}%`;
    },
  };
}
