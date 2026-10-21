// Seitenfeld rechts (HTML): Boxen mit Chips und Händen, Bank, eigene Hände, Wahl der Computer, Einsatz mit
// Schieberegler, Knöpfe (Karte, Bleiben, Verdoppeln, Teilen, Versicherung), ohne Hilfen die Ansage der Summe,
// Spielgeld-Konto mit Bank und die Regeln kurz. Alles nur per textContent – Namen kommen vom Netz.
import './blackjack.css';
import { formatChips } from '../spielgeld.js';
import { MIN, MAX } from './game.js';

export function createPanel(root, { solo, onAction, onAccuse, onLeave }) {
  root.innerHTML = `
    <div class="bj-head"><span class="brand">Black Jack</span><span data-round></span></div>
    <table class="bj-players"><tbody data-players></tbody></table>
    <p class="bj-dealer" data-dealer></p>
    <p class="bj-status" data-status></p>
    <div class="bj-mine" data-mine></div>
    <p class="bj-peek" data-peek></p>
    <div class="bj-setup" data-setup hidden>
      <p>Wie viele Computer spielen mit?</p>
      <div class="row" data-counts></div>
    </div>
    <div class="bj-bet" data-bet hidden>
      <div class="row">
        <input type="range" data-slider />
        <input type="number" data-amount />
      </div>
      <div class="bj-quick">
        <button class="secondary small" data-quick="min">Min</button>
        <button class="secondary small" data-quick="50">50</button>
        <button class="secondary small" data-quick="100">100</button>
        <button class="secondary small" data-quick="max">Max</button>
      </div>
      <button data-bet-go></button>
    </div>
    <div class="bj-acts" data-acts></div>
    <div class="bj-claims" data-claims hidden>
      <p>Summe ansagen und bleiben:</p>
      ${[17, 18, 19, 20, 21].map((n) => `<button class="small" data-claim="${n}">${n}</button>`).join('')}
    </div>
    <div class="bj-accuse" data-accuse hidden>
      <p>Wer hat geschummelt?</p>
      <div class="row" data-targets></div>
      <button class="secondary small" data-accuse-cancel>Abbrechen</button>
    </div>
    <p class="bj-hint" data-hint></p>
    <div class="bj-last" data-last></div>
    <p class="bj-bank" data-bank></p>
    <details class="bj-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Ass 1 oder 11, Bilder 10. Näher an 21 als die Bank, ohne drüber.</li>
        <li><b>Black Jack</b> (Ass + 10/Bild) zahlt 3 : 2, sonst 1 : 1.</li>
        <li>Die Bank zieht bis 16, ab 17 steht sie – ihre zweite Karte kommt erst nach allen Boxen.</li>
        <li><b>Verdoppeln</b> nur auf 9, 10 oder 11 – genau eine Karte.</li>
        <li><b>Teilen</b> zwei gleich viel werte Karten, bis 4 Hände; Asse bekommen je nur eine Karte.</li>
        <li><b>Versicherung</b> bei Ass der Bank: halber Einsatz, zahlt 2 : 1.</li>
        <li>Black Jack der Bank schlägt alles außer Black Jack – auch Verdoppeltes und Geteiltes.</li>
      </ul>
      <p>Einsatz ${MIN} bis ${MAX} je Box, 6 Kartenspiele im Schlitten.</p>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  const slider = q('slider');
  const amount = q('amount');
  let bet = null; // { min, max, label, step }
  let key = '';
  let value = 0;

  const clamp = (x) => {
    const v = Math.max(bet.min, Math.min(bet.max, Math.round(x / bet.step) * bet.step));
    return Math.max(bet.min, Math.min(bet.max, v));
  };
  const setTo = (x) => {
    value = clamp(Number.isFinite(x) ? x : bet.min);
    slider.value = String(value);
    amount.value = String(value);
    q('bet-go').textContent = `${bet.label} ${formatChips(value)}`;
  };
  slider.oninput = () => setTo(Number(slider.value));
  amount.onchange = () => setTo(Number(amount.value));

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.claim) onAction('claim', Number(b.dataset.claim));
    else if (b.dataset.count) onAction('setup', Number(b.dataset.count));
    else if (b.dataset.act) onAction(b.dataset.act);
    else if (b.dataset.quick && bet) setTo({ min: bet.min, max: bet.max }[b.dataset.quick] ?? Number(b.dataset.quick));
    else if ('betGo' in b.dataset && bet) onAction(bet.act, value);
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
    // players: [{ name, chips, note, turn, out }] · mine: [Zeilen] · setup: null | [{ n, text }] ·
    // bet: null | { min, max, step, start, label, act, key } · acts: [{ act, text, secondary, disabled }] ·
    // accuse: null | [{ seat, name }] (allein: wen „Geschummelt!“ trifft)
    render({ round, players, dealer, status, mine, peek, setup, bet: b, acts, claims, accuse, hint, last, bank }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        if (p.out) tr.classList.add('out');
        tr.append(cell('td', p.turn ? '▶' : '', 'bj-arrow'), cell('td', p.name), cell('td', formatChips(p.chips), 'bj-chips'), cell('td', p.note, 'bj-note'));
        return tr;
      }));
      q('dealer').textContent = dealer;
      q('dealer').hidden = !dealer;
      q('status').textContent = status;
      q('mine').replaceChildren(...mine.map((t) => cell('p', t)));
      q('mine').hidden = !mine.length;
      q('peek').textContent = peek;
      q('peek').hidden = !peek;
      q('setup').hidden = !setup;
      if (setup) {
        q('counts').replaceChildren(...setup.map((c) => {
          const btn = cell('button', c.text, 'small');
          btn.dataset.count = String(c.n);
          return btn;
        }));
      }
      bet = b;
      q('bet').hidden = !b;
      if (b) {
        slider.min = amount.min = String(b.min);
        slider.max = amount.max = String(b.max);
        slider.step = amount.step = String(b.step);
        if (b.key !== key) setTo(b.start ?? b.min);
        else setTo(value);
      }
      key = b?.key ?? '';
      q('acts').replaceChildren(...acts.map((a) => {
        const btn = cell('button', a.text, a.secondary ? 'secondary' : '');
        btn.dataset.act = a.act;
        btn.disabled = !!a.disabled;
        return btn;
      }));
      q('acts').hidden = !acts.length;
      q('claims').hidden = !claims;
      q('accuse').hidden = !accuse;
      if (accuse) {
        q('targets').replaceChildren(...accuse.map((a) => {
          const btn = cell('button', a.name, 'small');
          btn.dataset.target = String(a.seat);
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
