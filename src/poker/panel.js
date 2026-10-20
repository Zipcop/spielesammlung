// Seitenfeld rechts (HTML): Spieler mit Chips und Einsatz, Pot, eigene Hand, Knöpfe (Passen, Schieben, Mitgehen,
// Erhöhen mit Schieberegler), Ansage beim Showdown (ohne Hilfen), Anklage, Spielgeld-Konto mit Bank und die Handrangfolge.
// Alles nur per textContent – Namen kommen vom Netz.
import './poker.css';
import { CATEGORIES } from './hand.js';
import { formatChips } from '../spielgeld.js';

export function createPanel(root, { solo, onAction, onAccuse, onLeave }) {
  root.innerHTML = `
    <div class="pk-head"><span class="brand">Texas Hold'em</span><span data-round></span></div>
    <table class="pk-players"><tbody data-players></tbody></table>
    <p class="pk-pot" data-pot></p>
    <p class="pk-status" data-status></p>
    <p class="pk-mine" data-mine></p>
    <p class="pk-peek" data-peek></p>
    <div class="pk-acts" data-acts></div>
    <div class="pk-raise" data-raise hidden>
      <div class="row">
        <input type="range" data-slider />
        <input type="number" data-amount />
      </div>
      <div class="pk-quick">
        <button class="secondary small" data-quick="min">Min</button>
        <button class="secondary small" data-quick="half">½ Pot</button>
        <button class="secondary small" data-quick="pot">Pot</button>
        <button class="secondary small" data-quick="max">All-in</button>
      </div>
      <button data-raise-go></button>
    </div>
    <div class="pk-claims" data-claims hidden>
      <p>Deine Hand ansagen:</p>
      ${CATEGORIES.map((c, i) => `<button class="small" data-claim="${i}">${c}</button>`).join('')}
    </div>
    <div class="pk-accuse" data-accuse hidden>
      <p>Wer hat geschummelt?</p>
      <div class="row" data-targets></div>
      <button class="secondary small" data-accuse-cancel>Abbrechen</button>
    </div>
    <p class="pk-hint" data-hint></p>
    <div class="pk-last" data-last></div>
    <p class="pk-bank" data-bank></p>
    <details class="pk-rules">
      <summary>Handrangfolge</summary>
      <ol reversed>
        <li><b>Royal Flush</b> – A K D B 10 einer Farbe</li>
        <li><b>Straight Flush</b> – Straße einer Farbe</li>
        <li><b>Vierling</b> – 4 Gleiche</li>
        <li><b>Full House</b> – Drilling + Paar</li>
        <li><b>Flush</b> – 5 einer Farbe</li>
        <li><b>Straße</b> – 5 in Folge (A-2-3-4-5 geht)</li>
        <li><b>Drilling</b> – 3 Gleiche</li>
        <li><b>Zwei Paare</b></li>
        <li><b>Ein Paar</b></li>
        <li><b>Höchste Karte</b></li>
      </ol>
      <p>Beste 5 aus deinen 2 und den 5 Karten in der Mitte. Blinds 5 / 10, erhöhen mindestens um die letzte Erhöhung.</p>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const slider = q('slider');
  const amount = q('amount');
  let bet = null; // { min, max, pot, call, label }
  let key = '';
  let value = 0; // gewählter Betrag – genau so gesendet (der Regler selbst rundet auf seine Schritte)

  const clamp = (x) => Math.max(bet.min, Math.min(bet.max, Math.round(x)));
  const setTo = (x) => {
    const v = clamp(x);
    value = v;
    slider.value = String(v);
    amount.value = String(v);
    q('raise-go').textContent = v === bet.max ? `All-in (${formatChips(v)})` : `${bet.label} ${formatChips(v)}`;
  };
  slider.oninput = () => setTo(Number(slider.value));
  amount.onchange = () => setTo(Number(amount.value) || bet.min);

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.claim) onAction('claim', Number(b.dataset.claim));
    else if (b.dataset.act) onAction(b.dataset.act);
    else if (b.dataset.quick && bet) setTo({ min: bet.min, max: bet.max, half: bet.call + bet.pot / 2, pot: bet.call + bet.pot }[b.dataset.quick]);
    else if ('raiseGo' in b.dataset && bet) onAction('raise', value);
    else if (b.dataset.target) onAccuse(Number(b.dataset.target));
    else if ('accuseCancel' in b.dataset) onAccuse(null);
    else if ('shelf' in b.dataset) onLeave();
  };

  const cell = (tag, text, cls = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  return {
    // players: [{ name, chips, bet, note, turn, out, dealer }] ab mir · acts: [{ act, text, secondary }] ·
    // bet: null | { min, max, pot, call, label, key } · claims: bool · accuse: null | [{ seat, name }] · last: [Sätze]
    render({ round, players, pot, status, mine, peek, acts, bet: b, claims, accuse, hint, last, bank }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        if (p.out) tr.classList.add('out');
        tr.append(cell('td', p.turn ? '▶' : '', 'pk-arrow'), cell('td', p.name + (p.dealer ? ' (D)' : '')),
          cell('td', formatChips(p.chips), 'pk-chips'), cell('td', p.note, 'pk-note'));
        return tr;
      }));
      q('pot').textContent = pot;
      q('pot').hidden = !pot;
      q('status').textContent = status;
      q('mine').textContent = mine;
      q('mine').hidden = !mine;
      q('peek').textContent = peek;
      q('peek').hidden = !peek;
      q('acts').replaceChildren(...acts.map((a) => {
        const btn = cell('button', a.text, a.secondary ? 'secondary' : '');
        btn.dataset.act = a.act;
        return btn;
      }));
      q('acts').hidden = !acts.length;
      bet = b;
      q('raise').hidden = !b;
      if (b) {
        slider.min = amount.min = String(b.min);
        slider.max = amount.max = String(b.max);
        slider.step = '1';
        if (b.key !== key) setTo(b.start ?? b.min); // neuer Zug: Regler auf den Startwert
        else setTo(value);
      }
      key = b?.key ?? '';
      q('claims').hidden = !claims;
      q('accuse').hidden = !accuse;
      if (accuse) {
        q('targets').replaceChildren(...accuse.map((t) => {
          const btn = cell('button', t.name, 'small');
          btn.dataset.target = String(t.seat);
          return btn;
        }));
      }
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('last').replaceChildren(...last.map((t) => cell('p', t)));
      q('bank').textContent = bank;
    },
  };
}
