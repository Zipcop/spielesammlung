// Seitenfeld rechts (HTML): beide Spieler mit LP, Hand, Deck und Friedhof, Phase mit Knöpfen, Vorschau der Karte unter
// der Maus (groß und lesbar) mit ihren Aktionen, Reaktion auf Angriff/Beschwörung, Deckwahl, Duell-Ende, Regeln kurz.
// Alles nur per textContent – Namen und eigene Decknamen kommen vom Netz.
import './kartenduell.css';
import { paintCard } from './art.js';

export function createPanel(root, { solo, onPick, onBuild, onStep, onAction, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="kd-head"><span class="brand">Kartenduell</span><span data-round></span></div>
    <table class="kd-players"><tbody data-players></tbody></table>
    <div class="kd-steps" data-steps>
      <span data-s="main1">Haupt 1</span><span data-s="battle">Kampf</span><span data-s="main2">Haupt 2</span><span data-s="end">Ende</span>
    </div>
    <p class="kd-status" data-status></p>
    <div class="kd-setup" data-setup hidden>
      <p>Mit welchem Deck spielst du?</p>
      <div class="kd-decks" data-decks></div>
      <button class="secondary small" data-build>Eigenes Deck bauen …</button>
    </div>
    <div class="row kd-phase" data-phase>
      <button class="secondary small" data-to="battle">Zur Kampfphase</button>
      <button class="secondary small" data-to="main2">Zu Haupt 2</button>
      <button class="small" data-to="end">Zug beenden</button>
    </div>
    <div class="kd-card" data-card hidden>
      <canvas width="512" height="716" data-preview></canvas>
      <p class="kd-stats" data-stats></p>
      <div class="kd-acts" data-acts></div>
    </div>
    <p class="kd-hint" data-hint></p>
    <p class="kd-last" data-last></p>
    <div class="kd-end" data-end-box hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary small" data-regroup>Andere Decks</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="kd-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Je <b>8000 LP</b>, 40 Karten, 5 auf der Hand. Wer anfängt, zieht im 1. Zug nicht und greift nicht an.</li>
        <li><b>Haupt 1</b>: 1 Monster beschwören (offen) oder verdeckt setzen – Stufe 5–6 braucht <b>1 Tribut</b>, ab 7 zwei. Zauber aktivieren, Zauber/Fallen setzen.</li>
        <li><b>Kampf</b>: Jedes Monster in Angriff greift einmal an. Hat der Gegner keins, geht es direkt auf seine LP.</li>
        <li>ATK gegen ATK: der Schwächere fällt, der Unterschied geht von seinen LP ab. Gegen DEF: höher = zerstört (kein Schaden), niedriger = du verlierst den Unterschied.</li>
        <li><b>Fallen</b> wirken ab dem nächsten Zug – als Antwort auf Angriff oder Beschwörung.</li>
        <li>Position einmal je Zug wechseln, nicht im Zug der Beschwörung. Ab 7 Handkarten am Zugende abwerfen.</li>
        <li>Verloren: <b>0 LP</b> oder keine Karte mehr zum Ziehen.</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.deck) onPick(b.dataset.deck);
    else if ('build' in b.dataset) onBuild();
    else if (b.dataset.to) onStep(b.dataset.to);
    else if (b.dataset.act) onAction(Number(b.dataset.act));
    else if ('again' in b.dataset) onAgain();
    else if ('regroup' in b.dataset) onRegroup();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  const el = (tag, text, cls = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  let painted;

  return {
    // players: [{ name, lp, hand, deck, grave, turn }] (ich zuerst) · step: main1 | battle | main2 | end | null ·
    // phase: null | { battle, main2, end } (Knöpfe frei) · setup: null | { decks: [{ key, name, info, ok }], wait } ·
    // card: null | { id, stats, acts: [{ label, primary, off }] } · end: null | { title, text, again, regroup }
    render({ round, players, step, status, setup, phase, card, hint, last, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.flatMap((p) => {
        const tr = document.createElement('tr');
        if (p.turn) tr.className = 'turn';
        tr.append(el('td', p.turn ? '▶' : '', 'kd-arrow'), el('td', p.name), el('td', p.lp === null ? '' : `${p.lp} LP`, 'kd-lp'));
        if (p.hand === null) return [tr];
        const sub = document.createElement('tr');
        sub.className = p.turn ? 'turn sub' : 'sub';
        const info = el('td', `Hand ${p.hand} · Deck ${p.deck} · Friedhof ${p.grave}`, 'muted');
        info.colSpan = 3;
        sub.append(info);
        return [tr, sub];
      }));
      q('steps').hidden = !step;
      for (const s of q('steps').children) s.classList.toggle('on', s.dataset.s === step);
      q('status').textContent = status;
      q('setup').hidden = !setup;
      if (setup) {
        q('decks').replaceChildren(...setup.decks.map((d) => {
          const b = el('button', '', 'secondary small kd-deck');
          b.dataset.deck = d.key;
          b.disabled = !d.ok || setup.wait;
          b.append(el('b', d.name), el('span', d.info));
          return b;
        }));
        q('build').disabled = setup.wait;
      }
      q('phase').hidden = !phase;
      if (phase) for (const b of q('phase').children) b.disabled = !phase[b.dataset.to];
      q('card').hidden = !card;
      if (card) {
        if (painted !== card.id) paintCard(q('preview'), card.id);
        painted = card.id;
        q('stats').textContent = card.stats;
        q('stats').hidden = !card.stats;
        q('acts').replaceChildren(...card.acts.map((a, i) => {
          const b = el('button', a.label, a.primary ? 'small' : 'secondary small');
          b.dataset.act = String(i);
          b.disabled = !!a.off;
          return b;
        }));
      }
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('last').textContent = last;
      q('end-box').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('again').disabled = !end.again;
        q('regroup').disabled = !end.regroup;
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
    },
  };
}
