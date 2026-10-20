// Kniffel-Block als HTML-Tabelle: Punkte beider Spieler, beim Spieler am Zug die möglichen
// Punkte je freiem Feld (grau). Klick auf ein Feld der eigenen Spalte = eintragen.
// Ohne Hilfen (state.free) gibt es keine grauen Vorschläge: Man tippt die Punkte selbst ein (askClaim).
// Werte und Namen kommen beim Gast vom Host → nur per textContent eintragen, nie als HTML.
import { UPPER, LOWER, LABELS, BONUS_FROM, scoreOptions, totals } from './rules.js';
import { MAX_CLAIM, FALSE_ALARM_POINTS } from './game.js';

const HELP = {
  einser: 'nur Einser zählen', zweier: 'nur Zweier zählen', dreier: 'nur Dreier zählen',
  vierer: 'nur Vierer zählen', fuenfer: 'nur Fünfer zählen', sechser: 'nur Sechser zählen',
  dreierpasch: '3 gleiche · alle Augen', viererpasch: '4 gleiche · alle Augen', fullHouse: '3 + 2 gleiche · 25',
  kleineStrasse: '4 in Folge · 30', grosseStrasse: '5 in Folge · 40', kniffel: '5 gleiche · 50', chance: 'alle Augen',
};

export function createSheet(root, { me, onPick }) {
  const cols = [me, 1 - me]; // eigene Spalte zuerst
  const cells = (key) => cols.map((p) => `<td data-player="${p}" data-key="${key}"></td>`).join('');
  const row = (f) => `<tr><th>${LABELS[f]}<small>${HELP[f]}</small></th>${cells(f)}</tr>`;
  const sum = (key, label, cls = 'sum') => `<tr class="${cls}"><th>${label}</th>${cells(key)}</tr>`;

  root.innerHTML = `
    <table>
      <thead><tr><th class="brand">Kniffel</th>${cols.map((p) => `<th data-head="${p}"></th>`).join('')}</tr></thead>
      <tbody>
        ${UPPER.map(row).join('')}
        ${sum('upper', 'Summe oben')}
        ${sum('bonus', `Bonus<small>ab ${BONUS_FROM} oben · 35</small>`)}
        ${LOWER.map(row).join('')}
        ${sum('lower', 'Summe unten')}
        ${sum('extra', 'Zusatz-Kniffel<small>je 50</small>')}
        ${sum('penalty', `Fehlalarme<small>je −${FALSE_ALARM_POINTS}</small>`)}
        ${sum('total', 'Gesamt', 'total')}
      </tbody>
    </table>`;

  const cell = (p, key) => root.querySelector(`td[data-player="${p}"][data-key="${key}"]`);
  let previous = null;

  root.onclick = (e) => {
    if (e.target.tagName === 'INPUT') return; // gerade wird eine Zahl eingetippt
    const td = e.target.closest('td.pick');
    if (td) onPick(td.dataset.key);
  };

  return {
    // canPick: ich bin dran, habe gewürfelt und die Würfel liegen; names[p] = Name von Spieler p
    render(state, canPick, names) {
      cell(me, 'penalty').parentElement.hidden = !state.free;
      for (const p of cols) {
        const card = state.cards[p];
        const active = state.turn === p && state.rolls > 0 && !state.over;
        const options = active && !state.free ? scoreOptions(state.dice, card) : {};
        const head = root.querySelector(`[data-head="${p}"]`);
        head.textContent = names[p];
        head.classList.toggle('turn', state.turn === p && !state.over);

        for (const f of [...UPPER, ...LOWER]) {
          const td = cell(p, f);
          const filled = card[f] !== undefined;
          const isNew = filled && previous && previous.cards[p][f] === undefined;
          td.textContent = filled ? (card[f] === 0 ? '–' : card[f]) : options[f] ?? '';
          td.className = filled ? (isNew ? 'filled new' : 'filled') : active ? `option${options[f] === 0 ? ' zero' : ''}` : '';
          if (!filled && active && p === me && canPick) td.classList.add('pick');
        }

        const t = totals(card, state.extra[p]);
        const hide = state.free && !state.over; // ohne Hilfen rechnet man erst am Ende zusammen – auch kein „noch X“
        cell(p, 'upper').textContent = hide ? '' : t.upper;
        const upperDone = UPPER.every((f) => card[f] !== undefined);
        const bonus = cell(p, 'bonus');
        if (hide) bonus.textContent = '';
        else if (t.bonus || upperDone) bonus.textContent = t.bonus || '–';
        else bonus.replaceChildren(Object.assign(document.createElement('small'), { textContent: `noch ${BONUS_FROM - t.upper}` }));
        cell(p, 'lower').textContent = hide ? '' : t.lower;
        cell(p, 'extra').textContent = t.extra || '–';
        const penalty = state.penalty?.[p] ?? 0;
        cell(p, 'penalty').textContent = penalty ? `−${penalty}` : '–';
        cell(p, 'total').textContent = hide ? '' : t.total - penalty;
      }
      previous = state;
    },

    // Ohne Hilfen: Punkte für dieses Feld selbst eintippen und einen Zusatz-Kniffel selbst ankreuzen
    // (Kästchen in der eigenen Zusatz-Kniffel-Zeile). done(zahl, angesagt) oder done(null) = abgebrochen
    askClaim(field, done) {
      const td = cell(me, field);
      const input = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: MAX_CLAIM, step: 1, className: 'claim' });
      input.placeholder = 'Punkte';
      td.replaceChildren(input);
      // kein <label>: dessen Klick holt den Fokus aus dem Zahlenfeld, onblur bräche ab
      const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
      const tick = document.createElement('span');
      tick.append(box, Object.assign(document.createElement('small'), { textContent: ' +50' }));
      tick.onmousedown = (e) => e.preventDefault(); // Fokus bleibt im Zahlenfeld
      // auch „+50“ anklicken setzt den Haken – ohne Rückgabewert: false würde den Klick aufs Kästchen abbrechen
      tick.onclick = (e) => {
        if (e.target !== box) box.checked = !box.checked;
      };
      cell(me, 'extra').replaceChildren(tick);
      input.focus();
      let finished = false;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        const value = Number(input.value);
        if (ok && input.value !== '' && Number.isInteger(value) && value >= 0 && value <= MAX_CLAIM) done(value, box.checked);
        else done(null);
      };
      input.onkeydown = (e) => {
        e.stopPropagation(); // Leertaste würfelt sonst
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      };
      input.onblur = () => finish(false);
    },
  };
}
