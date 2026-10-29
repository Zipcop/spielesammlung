// Seitenfeld rechts (HTML): beide Spieler mit Farbe, Toren und gewonnenen Partien, Status, 7-Sekunden-Anzeige, allein die Stufe,
// Verlauf, Spielende mit Revanche und die Regeln in Kurzform. Texte nur per textContent – nichts vom Netz landet als HTML.
import './airhockey.css';
import { LEVELS } from './ai.js';
import { WIN } from './rules.js';
import { COLORS } from './table.js';

export function createPanel(root, { solo, onLevel, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="ah-head"><span class="brand">Air-Hockey</span><span class="muted small">bis ${WIN} Tore</span></div>
    <ul class="ah-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="ah-dot" style="--c:${COLORS[k]}"></span><span class="ah-name"></span><span class="ah-score"></span><span class="ah-wins"></span></li>`).join('')}
    </ul>
    <p class="ah-status" data-status></p>
    <div class="ah-clock" data-clock-row><span>Puck bei dir</span><div class="ah-bar"><div data-clock></div></div></div>
    ${solo ? `<label class="ah-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <ol class="ah-log" data-log></ol>
    <div class="ah-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="ah-rules">
      <li>Dein Schläger folgt der Maus – nur in deiner Hälfte</li>
      <li>Puck ganz in den Schlitz des anderen = <b>Tor</b>; wer ${WIN} hat, gewinnt</li>
      <li>Nach einem Tor bekommt der Getroffene den Puck</li>
      <li>Höchstens <b>7 Sekunden</b> in der eigenen Hälfte, sonst bekommt ihn der andere</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen prüft der Tisch nichts: Dein Schläger reicht bis 30 cm über die Mittellinie
      (mehr als halb drüben = Verstoß), mit gedrückter rechter Maustaste hältst du den Puck fest (Topping), und nach 7 Sekunden pfeift
      keiner. „Geschummelt!“ (oder Taste G) erwischt einen Verstoß der letzten 5 Sekunden: Strafpunkt für den Rufer, ein Tor des Schummlers
      in diesen 5 Sekunden zählt nicht. Fehlalarm: Das Spiel läuft weiter, jeder zweite ist ein Strafpunkt für den anderen.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.ah-players li')];
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  return {
    // players = [{ name, score, wins, alarms }] je Spieler (0 Host, 1 Gast) · log = Zeilen (neueste zuerst) · end = { title, text } oder null
    render({ players, me, status, level, log, end, free }) {
      players.forEach((p, k) => {
        rows[k].classList.toggle('me', k === me);
        rows[k].querySelector('.ah-name').textContent = p.name;
        rows[k].querySelector('.ah-score').textContent = String(p.score);
        rows[k].querySelector('.ah-wins').textContent = `${p.wins} ${p.wins === 1 ? 'Partie' : 'Partien'}${free && p.alarms ? ` · ${p.alarms}× Fehlalarm` : ''}`;
      });
      q('status').textContent = status;
      if (q('level')) q('level').value = String(level);
      q('log').replaceChildren(...log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
      q('free').hidden = !free;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        // ohne Hilfen wartet der Sieger kurz: so lange kann der andere seinen letzten Verstoß noch erwischen
        q('again').disabled = end.wait > 0;
        q('again').textContent = end.wait > 0 ? `Revanche (noch ${end.wait} s – Anklage möglich)` : 'Revanche';
      }
    },
    // Wie lange der Puck schon in der eigenen Hälfte liegt: 0–1 (von 7 Sekunden), null = ausblenden
    setClock(part) {
      q('clock-row').classList.toggle('idle', part === null);
      q('clock').style.width = `${Math.round(Math.min(part ?? 0, 1) * 100)}%`;
    },
  };
}
