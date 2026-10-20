// Seitenfeld rechts (HTML): Spielart, die vier Spieler (Partei, Stiche, Punktestand), Status, Vorbehalt, Ansagen,
// letzter Stich, Abrechnung, Spielliste und die Regeln in Kurzform. Alles nur per textContent – Namen kommen vom Netz.
import './doko.css';
import { SOLO_NAMES } from './game.js';

const SOLO_ORDER = ['diamonds', 'hearts', 'spades', 'clubs', 'queens', 'jacks', 'fleischlos'];

export function createPanel(root, { solo, onCall, onAnnounce, onAgain, onLeave, onAccuse }) {
  root.innerHTML = `
    <div class="dk-head"><span class="brand">Doppelkopf</span><span data-contract></span></div>
    <table class="dk-players"><tbody data-players></tbody></table>
    <p class="dk-status" data-status></p>
    <div class="dk-reserve" data-reserve hidden>
      <div class="row"><button data-call="gesund">Gesund</button><button data-call="wedding" class="secondary">Hochzeit</button></div>
      <p class="muted small">Oder ein Solo (du spielst allein gegen drei):</p>
      <div class="dk-solos">${SOLO_ORDER.map((k) => `<button class="secondary small" data-call="${k}">${SOLO_NAMES[k]}</button>`).join('')}</div>
    </div>
    <div class="dk-says" data-says-row><span data-says></span><span class="dk-ann" data-ann></span></div>
    <div class="dk-accuse" data-accuse hidden>
      <p>Wer hat nicht bedient?</p>
      <div class="row" data-targets></div>
      <button class="secondary small" data-accuse-cancel>Abbrechen</button>
    </div>
    <p class="dk-last" data-last></p>
    <p class="dk-trick" data-trick></p>
    <p class="dk-hint" data-hint></p>
    <div class="dk-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <ul class="dk-lines" data-lines></ul>
      <button data-again>Nächstes Spiel</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="dk-list" data-list-box>
      <summary>Spielliste</summary>
      <table><thead data-list-head></thead><tbody data-list></tbody></table>
    </details>
    <details class="dk-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li><b>Trumpf</b> (hoch → tief): Herz-10, Damen, Buben (je Kreuz, Pik, Herz, Karo), Karo Ass, 10, König, 9</li>
        <li><b>Re</b> = die Kreuz-Damen, <b>Kontra</b> = die anderen · gewinnen ab 121 Augen (Kontra: 120)</li>
        <li><b>Bedienen</b>: Trumpf auf Trumpf, Farbe auf Farbe – sonst frei (auch stechen)</li>
        <li>Zwei gleiche Karten: die erste sticht – auch bei der Herz-10</li>
        <li><b>Ansagen</b>: Re/Kontra bis 11 Karten, keine 90 bis 10, keine 60 bis 9, keine 30 bis 8, schwarz bis 7</li>
        <li>Sonderpunkte: Fuchs gefangen, Doppelkopf (≥ 40 Augen), Karlchen im letzten Stich, gegen die Kreuz-Damen</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.call) onCall(b.dataset.call);
    else if (b.dataset.level) onAnnounce(Number(b.dataset.level));
    else if (b.dataset.target) onAccuse(Number(b.dataset.target));
    else if ('accuseCancel' in b.dataset) onAccuse(null);
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  const cell = (tag, text, cls = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  return {
    // players: [{ name, party, tricks, score, turn }] in Sitzreihenfolge ab mir · reserve: null | { wedding } ·
    // ann: [{ level, text }] Knöpfe für Ansagen · accuse: null | [{ seat, name }] · end: null | { title, text, lines } ·
    // list: { names, rows: [{ title, points }], total }
    render({ contract, players, status, reserve, says, ann, accuse, last, trick, hint, end, list }) {
      q('contract').textContent = contract;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        tr.append(cell('td', p.turn ? '▶' : '', 'dk-arrow'), cell('td', p.name), cell('td', p.party ?? '', `dk-party ${p.party === 'Re' ? 're' : p.party === 'Kontra' ? 'kontra' : ''}`),
          cell('td', p.tricks === null ? '' : `${p.tricks} St.`, 'muted'), cell('td', p.score > 0 ? `+${p.score}` : String(p.score), 'dk-score'));
        return tr;
      }));
      q('status').textContent = status;
      q('reserve').hidden = !reserve;
      if (reserve) root.querySelector('[data-call="wedding"]').hidden = !reserve.wedding;
      q('says').textContent = says;
      q('ann').replaceChildren(...ann.map((a) => {
        const b = cell('button', a.text, 'small');
        b.dataset.level = String(a.level);
        return b;
      }));
      q('says-row').hidden = !says && !ann.length;
      q('accuse').hidden = !accuse;
      if (accuse) {
        q('targets').replaceChildren(...accuse.map((t) => {
          const b = cell('button', t.name, 'small');
          b.dataset.target = String(t.seat);
          return b;
        }));
      }
      q('last').textContent = last;
      q('trick').textContent = trick;
      q('trick').hidden = !trick;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('end').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('lines').replaceChildren(...end.lines.map((l) => cell('li', l)));
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      q('list-box').hidden = !list.rows.length;
      const head = document.createElement('tr');
      head.append(cell('th', ''), ...list.names.map((n) => cell('th', n)));
      q('list-head').replaceChildren(head);
      const rows = list.rows.map((r) => {
        const tr = document.createElement('tr');
        tr.append(cell('td', r.title, 'muted'), ...r.points.map((x) => cell('td', x > 0 ? `+${x}` : String(x))));
        return tr;
      });
      const total = document.createElement('tr');
      total.className = 'total';
      total.append(cell('td', 'Stand'), ...list.total.map((x) => cell('td', String(x))));
      q('list').replaceChildren(...rows, total);
    },
  };
}
