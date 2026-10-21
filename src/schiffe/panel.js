// Seitenfeld rechts (HTML): zwei Spieler mit Siegen, Status, allein die Stufe, beim Aufstellen „Zufällig“ und „Fertig“,
// ohne Hilfen die eigene Antwort auf einen Schuss, beide Flotten mit Treffern, Verlauf, Spielende mit Revanche und die
// Regeln in Kurzform. Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML.
import './schiffe.css';
import { LEVELS } from './ai.js';

export function createPanel(root, { solo, onLevel, onRandom, onReady, onAnswer, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="sv-head"><span class="brand">Schiffe versenken</span></div>
    <ul class="sv-players">${[0, 1].map((k) => `
      <li data-player="${k}"><span class="sv-dot c${k}"></span><span class="sv-name"></span><span class="sv-score"></span></li>`).join('')}
    </ul>
    <p class="sv-status" data-status></p>
    <p class="sv-hint" data-hint hidden></p>
    <div class="sv-setup" data-setup hidden>
      <p class="small">Schiff ziehen = verschieben · anklicken (oder beim Ziehen R / Mausrad) = drehen</p>
      <div class="row"><button class="secondary small" data-random>Zufällig</button><button class="small" data-ready>Fertig</button></div>
    </div>
    <div class="sv-answer" data-answer hidden>
      <p data-answer-text></p>
      <div class="row"><select data-answer-pick></select><button class="small" data-answer-go>Antworten</button></div>
    </div>
    ${solo ? `<label class="sv-level">Stufe <select data-level>${LEVELS.map((l, i) => `<option value="${i}">${i + 1} · ${l.name}</option>`).join('')}</select></label>` : ''}
    <div class="sv-fleets" data-fleets hidden>${[0, 1].map((k) => `
      <div><h4 data-fleet-title="${k}"></h4><ul data-fleet="${k}"></ul></div>`).join('')}
    </div>
    <ol class="sv-log" data-log></ol>
    <div class="sv-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="sv-rules">
      <li>Flotte verdeckt aufstellen: 5 Schiffe, gerade, nicht übereinander – berühren erlaubt</li>
      <li>Abwechselnd <b>ein Schuss</b>, auch nach einem Treffer</li>
      <li>Antwort: Wasser, Treffer (mit Schiff) oder versenkt</li>
      <li>Wer zuerst die ganze Flotte versenkt, gewinnt · Revanche: der andere schießt zuerst</li>
    </ul>
    <p class="muted small" data-free hidden>Ohne Hilfen: Wer beschossen wird, antwortet selbst – und darf lügen. Schießen geht auch außer der Reihe,
      Schiffe lassen sich übereinander aufstellen und mitten im Spiel verschieben. „Geschummelt!“ prüft alles, was der andere seit der
      letzten Anklage getan hat – auch nach dem Ende, wenn alle Schiffe offen liegen: erwischt = alles wird richtiggestellt und eine
      Verwarnung (wer so gewonnen hat, verliert), Fehlalarm = Verwarnung für den Rufer. Drei Verwarnungen = verloren.${solo ? ' Allein schummelt der Computer auch mal – und passt auf.' : ''}</p>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const rows = [...root.querySelectorAll('.sv-players li')];
  let answers = [];
  let asked = null; // Schuss, für den die Auswahl gerade steht – sonst springt sie bei jedem Neuzeichnen zurück
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('again' in b.dataset) onAgain();
    else if ('random' in b.dataset) onRandom();
    else if ('ready' in b.dataset) onReady();
    else if ('answerGo' in b.dataset) onAnswer(answers[Number(q('answer-pick').value)]);
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (q('level')) q('level').onchange = (e) => onLevel(Number(e.target.value));

  // Flotte als Liste: Name, ein Kästchen je Feld (getroffen = rot), versenkt durchgestrichen
  function fleetList(list, ships) {
    list.replaceChildren(...ships.map((s) => {
      const li = document.createElement('li');
      li.classList.toggle('sunk', s.sunk);
      const name = Object.assign(document.createElement('span'), { textContent: s.name });
      const boxes = Object.assign(document.createElement('span'), { className: 'sv-boxes' });
      for (let i = 0; i < s.len; i++) boxes.append(Object.assign(document.createElement('i'), { className: i < s.hits ? 'hit' : '' }));
      li.append(name, boxes);
      return li;
    }));
  }

  return {
    // players = [{ name, wins, strikes, turn }] · setup = Aufstell-Knöpfe zeigen · answer = { key, text, options, pick } oder null
    // fleets = [{ title, ships: [{ name, len, hits, sunk }] }] oder null · log = Zeilen (neueste zuerst) · end = { title, text } oder null
    render({ players, status, hint, level, setup, answer, fleets, log, end, free }) {
      players.forEach((p, k) => {
        rows[k].classList.toggle('turn', p.turn);
        rows[k].querySelector('.sv-name').textContent = p.name;
        rows[k].querySelector('.sv-score').textContent = `${p.wins} ${p.wins === 1 ? 'Sieg' : 'Siege'}${free ? ` · ${p.strikes}/3 ⚠` : ''}`;
      });
      q('status').textContent = status;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      if (q('level')) q('level').value = String(level);
      q('setup').hidden = !setup;
      q('answer').hidden = !answer;
      if (answer) {
        q('answer-text').textContent = answer.text;
        if (asked !== answer.key) {
          asked = answer.key;
          answers = answer.options;
          q('answer-pick').replaceChildren(...answer.options.map((o, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: o.label })));
          q('answer-pick').value = String(answer.pick);
        }
      } else asked = null;
      q('fleets').hidden = !fleets;
      if (fleets) {
        fleets.forEach((f, k) => {
          q(`fleet-title="${k}"`).textContent = f.title;
          fleetList(q(`fleet="${k}"`), f.ships);
        });
      }
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
