// Seitenfeld rechts (HTML): zwei Spieler mit Paaren und Siegen, Status, Auswahl vor dem Austeilen (Größe, Motive),
// allein die Stufe, ohne Hilfen die Knöpfe „Weiter“, „Paar einstecken“ und „Heimlich linsen“, Verlauf, Spielende mit
// Revanche und die Regeln in Kurzform. Texte nur per textContent – nichts, was vom Netz kommt, landet als HTML.
import './memory.css';
import { LEVELS } from './ai.js';
import { SIZES, SETS, SET_KEYS } from './game.js';

export function createPanel(root, { solo, onSetup, onLevel, onPass, onPocket, onPeek, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="mem-head"><span class="brand">Memory</span><span class="mem-round" data-round></span></div>
    <ul class="mem-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="mem-name"></span><span class="mem-pairs"></span><span class="mem-score"></span></li>`).join('')}
    </ul>
    <p class="mem-status" data-status></p>
    <p class="mem-hint" data-hint hidden></p>
    <div class="mem-setup" data-setup hidden>
      <div class="mem-choice">Größe ${SIZES.map((n) => `<button class="secondary small" data-size="${n}">${n} Paare</button>`).join('')}</div>
      <div class="mem-choice">Motive ${SET_KEYS.map((k) => `<button class="secondary small" data-set="${k}">${SETS[k].name}</button>`).join('')}</div>
      <button data-deal>Austeilen</button>
    </div>
    ${solo ? `<label class="mem-level">Computer <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <div class="mem-actions" data-actions hidden>
      <button data-pass>Weiter</button>
      <button class="secondary small" data-pocket>Paar einstecken</button>
      <button class="secondary small" data-peek>Heimlich linsen</button>
    </div>
    <ol class="mem-log" data-log></ol>
    <div class="mem-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-regroup hidden>Andere Größe oder Motive</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="mem-rules">
      <li>Wer dran ist, deckt zwei Kärtchen auf</li>
      <li><b>Zwei gleiche</b> = Paar behalten und nochmal</li>
      <li>Zwei verschiedene drehen sich wieder um – der andere ist dran</li>
      <li>Am Ende gewinnt, wer mehr Paare hat; gleich viele = Unentschieden</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Nach zwei verschiedenen drückst du selbst „Weiter“ (oder Leertaste). Erlaubt, aber
      Schummeln: ein drittes Kärtchen aufdecken, zwei verschiedene als Paar einstecken, heimlich unter ein Kärtchen linsen oder vor dem
      zweiten Kärtchen „Weiter“. „Geschummelt!“ geht,
      bis der andere selbst etwas tut (z. B. aufdeckt): erwischt = alles seit dem Schummeln zurück, ein Paar an den Rufer, und der ist dran.
      Fehlalarm = der Rufer gibt ein Paar ab.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.mem-players li')];
  let pick = { size: 18, set: 'tiere' };

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const d = b.dataset;
    if ('size' in d) pick = { ...pick, size: Number(d.size) };
    else if ('set' in d) pick = { ...pick, set: d.set };
    else if ('deal' in d) onSetup(pick);
    else if ('pass' in d) onPass();
    else if ('pocket' in d) onPocket();
    else if ('peek' in d) onPeek();
    else if ('again' in d) onAgain();
    else if ('regroup' in d) onRegroup();
    else if ('leave' in d || 'shelf' in d) onLeave(!('leave' in d));
    showPick();
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  function showPick() {
    root.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', Number(b.dataset.size) === pick.size));
    root.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === pick.set));
  }

  return {
    // players = [{ name, pairs, wins, turn }] je Spieler · log = Zeilen (neueste zuerst) · end = { title, text, regroup } oder null
    // setup = null | { mine: true (Host wählt), size, set } · actions = null | { pass, pocket, peek (an/aus), peeking }
    render({ round, players, status, hint, setup, level, actions, log, end, free }) {
      q('round').textContent = round;
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.mem-name').textContent = p.name;
        rows[k].querySelector('.mem-pairs').textContent = p.pairs === null ? '' : `${p.pairs} ${p.pairs === 1 ? 'Paar' : 'Paare'}`;
        rows[k].querySelector('.mem-score').textContent = `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}`;
      });
      q('status').textContent = status;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('setup').hidden = !setup?.mine;
      if (setup?.mine && !q('setup').dataset.shown) {
        pick = { size: setup.size, set: setup.set }; // Vorauswahl: zuletzt gespielt
        q('setup').dataset.shown = '1';
        showPick();
      }
      if (!setup) delete q('setup').dataset.shown;
      if (q('level')) q('level').value = String(level);
      q('actions').hidden = !actions;
      if (actions) {
        q('pass').disabled = !actions.pass;
        q('pocket').disabled = !actions.pocket;
        q('peek').disabled = !actions.peek;
        q('peek').classList.toggle('on', actions.peeking);
        q('peek').textContent = actions.peeking ? 'Linsen: Kärtchen anklicken' : 'Heimlich linsen';
      }
      q('log').replaceChildren(...log.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
      q('free').hidden = !free;
      q('end').hidden = !end;
      q('regroup').hidden = !end?.regroup;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
  };
}
