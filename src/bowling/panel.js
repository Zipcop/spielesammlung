// Seitenfeld rechts (HTML): Spielzettel beider Spieler (10 Frames mit Zeichen und Zwischensummen), Siege, Status,
// letzter Wurf, Tempo- und Drall-Anzeige, allein die Stufe, ohne Hilfen das Eintragen (Pins oder F), Spielende mit
// Revanche und die Regeln in Kurzform. Texte nur per textContent – nichts, was vom Netz kommt, landet als HTML.
import './bowling.css';
import { LEVELS } from './ai.js';
import { FOUL_TEMPO } from './physics.js';
import { FRAMES, FALSE_ALARM_POINTS } from './rules.js';

export function createPanel(root, { solo, onLevel, onClaim, onAgain, onLeave }) {
  const frameCells = Array.from({ length: FRAMES }, (_, f) => `<div class="bw-f${f === FRAMES - 1 ? ' tenth' : ''}"><div class="bw-m">${'<span></span>'.repeat(f === FRAMES - 1 ? 3 : 2)}</div><div class="bw-t"></div></div>`).join('');
  root.innerHTML = `
    <div class="bw-head"><span class="brand">Bowling</span><span class="muted small" data-round></span></div>
    ${[0, 1].map((p) => `
      <div class="bw-player" data-p="${p}">
        <div class="bw-row"><span class="bw-name"></span><span class="bw-wins"></span><span class="bw-total"></span></div>
        <div class="bw-frames">${frameCells}</div>
      </div>`).join('')}
    <p class="bw-status" data-status></p>
    <p class="bw-last" data-last></p>
    <p class="bw-hint" data-hint hidden></p>
    <div class="bw-meter" data-tempo-row><span>Tempo</span><div class="bw-bar"><div data-tempo></div><i style="left:${FOUL_TEMPO * 100}%"></i></div></div>
    <div class="bw-meter" data-hook-row><span>Drall</span><div class="bw-bar hook"><div data-hook></div></div><small data-hook-text></small></div>
    <div class="bw-claim" data-claim hidden>
      <p>Wie viele Pins sind gefallen? Selbst eintragen:</p>
      <div data-claim-buttons></div>
    </div>
    ${solo ? `<label class="bw-level">Computer <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <div class="bw-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="bw-rules">
      <li>10 Frames, je bis zu 2 Würfe – zu zweit abwechselnd je ein Frame</li>
      <li><b>Strike</b> (X, alle 10 im 1. Wurf) = 10 + die nächsten zwei Würfe</li>
      <li><b>Spare</b> (/, Rest im 2. Wurf) = 10 + der nächste Wurf</li>
      <li>10. Frame: nach Strike oder Spare ein 3. Wurf</li>
      <li><b>Foul</b> (F): zu viel Schwung, über die Linie gerutscht – der Wurf zählt 0</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen zählt die Anlage nicht mit und der Foul-Melder ist aus: Du trägst jeden Wurf selbst ein
      (Pins oder F). Schummeln = falsch eintragen, auch übertreten und trotzdem Pins schreiben. „Geschummelt!“ geht, bis der andere
      wirft: erwischt = der ganze Frame zählt 0, Fehlalarm = ${FALSE_ALARM_POINTS} Minuspunkte für den Rufer.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if ('pins' in d) onClaim(d.pins === 'F' ? 'F' : Number(d.pins));
    else if ('again' in d) onAgain();
    else if ('leave' in d || 'shelf' in d) onLeave(!('leave' in d));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));
  let claimFor = null;

  return {
    // players[p] = { name, frames: [[Zeichen]], totals: [Zahl|null], total, wins, turn, current (Frame-Nr. oder null) }
    // claim = null | { left } (Knöpfe 0–left und F) · end = { title, text } oder null
    render({ round, players, status, last, hint, level, claim, end, free }) {
      q('round').textContent = round;
      players.forEach((pl, p) => {
        const box = root.querySelector(`.bw-player[data-p="${p}"]`);
        box.classList.toggle('turn', pl.turn);
        box.querySelector('.bw-name').textContent = pl.name;
        box.querySelector('.bw-wins').textContent = `${pl.wins} ${pl.wins === 1 ? 'Sieg' : 'Siege'}`;
        box.querySelector('.bw-total').textContent = String(pl.total);
        box.querySelectorAll('.bw-f').forEach((cell, f) => {
          cell.classList.toggle('now', pl.current === f);
          cell.querySelectorAll('.bw-m span').forEach((sp, k) => (sp.textContent = pl.frames[f]?.[k] ?? ''));
          const t = pl.totals[f];
          cell.querySelector('.bw-t').textContent = t === null || t === undefined ? '' : String(t);
        });
      });
      q('status').textContent = status;
      q('last').textContent = last;
      q('last').hidden = !last;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      if (q('level')) q('level').value = String(level);
      q('claim').hidden = !claim;
      const key = claim ? `${claim.left}` : null;
      if (key !== claimFor) {
        claimFor = key;
        q('claim-buttons').replaceChildren(...(claim ? [...Array.from({ length: claim.left + 1 }, (_, n) => String(n)), 'F'] : []).map((v) => {
          const b = document.createElement('button');
          b.className = v === 'F' ? 'secondary small' : 'small';
          b.dataset.pins = v;
          b.textContent = v === 'F' ? 'F (übertreten)' : v;
          return b;
        }));
      }
      q('free').hidden = !free;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
    // Tempo 0–1 und Drall −1–1 (+ = nach links) beim Ausholen; null = Anzeige ruht
    setSwing(tempo, hook) {
      q('tempo-row').classList.toggle('idle', tempo === null);
      q('hook-row').classList.toggle('idle', hook === null);
      q('tempo').style.width = `${Math.round((tempo ?? 0) * 100)}%`;
      q('tempo').classList.toggle('foul', (tempo ?? 0) >= FOUL_TEMPO);
      const h = hook ?? 0;
      const bar = q('hook');
      bar.style.left = `${50 - Math.max(h, 0) * 50}%`;
      bar.style.width = `${Math.abs(h) * 50}%`;
      q('hook-text').textContent = hook === null || Math.abs(h) < 0.05 ? 'gerade' : `${Math.round(Math.abs(h) * 100)} % ${h > 0 ? 'links' : 'rechts'}`;
    },
  };
}
