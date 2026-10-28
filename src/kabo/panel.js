// Seitenfeld rechts (HTML): Spieler mit Punktestand (am Rundenende mit den Punkten der Runde), Status, Wahl der
// Spielerzahl, die Knöpfe des Zuges (Gesehen · Ziehen / Ablage nehmen / Kabo! · Ablegen · Fähigkeit oder Überspringen ·
// Gemerkt / Tauschen), ohne Hilfen die vier Fähigkeiten und „Heimlich ansehen“, Rundenende und die Regeln in Kurzform.
// Alles nur per textContent – Namen kommen vom Netz.
import './kabo.css';

const KIND_LABEL = { own: 'Eigene ansehen', other: 'Fremde ansehen', swap: 'Blind tauschen', king: 'König: beide ansehen' };

export function createPanel(root, { solo, onSetup, onReady, onDraw, onTake, onKabo, onDrop, onKind, onSkip, onSeen, onKing, onSneak, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="kb-head"><span class="brand">Kabo</span><span data-round></span></div>
    <table class="kb-players"><tbody data-players></tbody></table>
    <p class="kb-status" data-status></p>
    <p class="kb-card" data-card></p>
    <div class="kb-setup" data-setup hidden>
      <p>Wie viele sitzen am Tisch?</p>
      <div class="row" data-counts></div>
      <p class="muted small">Gespielt wird, bis einer 100 Punkte hat – wer dann am wenigsten hat, gewinnt</p>
    </div>
    <div class="row kb-actions" data-peek hidden><button class="small" data-ready>Gesehen – los geht’s</button></div>
    <div class="row kb-actions" data-start hidden>
      <button class="small" data-draw>Vom Stapel ziehen</button>
      <button class="secondary small" data-take>Ablage nehmen</button>
      <button class="small kb-kabo" data-kabo>Kabo!</button>
    </div>
    <div class="row kb-actions" data-drawn hidden><button class="secondary small" data-drop>Ablegen</button></div>
    <div class="row kb-actions" data-power hidden>
      <button class="secondary small" data-kind="own">${KIND_LABEL.own}</button>
      <button class="secondary small" data-kind="other">${KIND_LABEL.other}</button>
      <button class="secondary small" data-kind="swap">${KIND_LABEL.swap}</button>
      <button class="secondary small" data-kind="king">${KIND_LABEL.king}</button>
      <button class="small" data-skip>Überspringen</button>
    </div>
    <div class="row kb-actions" data-look hidden>
      <button class="small" data-seen>Gemerkt</button>
      <button class="small" data-king="1">Tauschen</button>
      <button class="secondary small" data-king="0">Nicht tauschen</button>
    </div>
    <div class="row kb-actions" data-sneak-row hidden><button class="secondary small" data-sneak>Heimlich ansehen</button></div>
    <p class="kb-last" data-last></p>
    <p class="kb-hint" data-hint></p>
    <div class="kb-end" data-end-box hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nächste Runde</button>
      <button class="secondary small" data-regroup>Andere Spielerzahl</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="kb-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Je <b>4 Karten verdeckt</b> vor dir. Zu Beginn siehst du einmal die <b>beiden nahen</b> an – merk sie dir!</li>
        <li>Werte: <b>Joker 0</b>, <b>roter König −1</b>, Ass 1, 2–10 die Augen, Bube, Dame, schwarzer König 10</li>
        <li>Im Zug: vom Stapel ziehen und gegen eine eigene tauschen <b>oder</b> ablegen – oder die Ablage nehmen und tauschen</li>
        <li>Frisch gezogen abgelegt: <b>7/8</b> eigene ansehen, <b>9/10</b> fremde ansehen, <b>Bube/Dame</b> blind tauschen, <b>schwarzer König</b> beide ansehen, dann wahlweise tauschen</li>
        <li><b>Kabo!</b> statt eines Zuges, wenn jeder dran war: Jeder andere hat noch einen Zug, deine Karten sind gesperrt</li>
        <li>Jeder schreibt seine Summe. Rufer allein am niedrigsten: <b>0</b>, sonst Summe <b>+ 10</b>. Bis einer 100 hat – am wenigsten gewinnt</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.count) onSetup(Number(b.dataset.count));
    else if ('ready' in b.dataset) onReady();
    else if ('draw' in b.dataset) onDraw();
    else if ('take' in b.dataset) onTake();
    else if ('kabo' in b.dataset) onKabo();
    else if ('drop' in b.dataset) onDrop();
    else if (b.dataset.kind) onKind(b.dataset.kind);
    else if ('skip' in b.dataset) onSkip();
    else if ('seen' in b.dataset) onSeen();
    else if (b.dataset.king) onKing(b.dataset.king === '1');
    else if ('sneak' in b.dataset) onSneak();
    else if ('again' in b.dataset) onAgain();
    else if ('regroup' in b.dataset) onRegroup();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  const cell = (tag, text, cls = '') => {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };

  return {
    // players: [{ name, score, note, turn }] ab mir · setup: null | [{ n, text }] · peek: bool ·
    // start: null | { draw, take, kabo, taking } · drawn: bool · power: null | { kinds: [..] | null, kind, skip } ·
    // look: null | 'seen' | 'king' · sneak: null | { on, enabled } · end: null | { title, text, again, regroup }
    render({ round, players, status, card, setup, peek, start, drawn, power, look, sneak, last, hint, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        tr.className = p.turn ? 'turn' : '';
        tr.append(cell('td', p.turn ? '▶' : '', 'kb-arrow'), cell('td', p.name), cell('td', p.note, 'kb-note'), cell('td', p.score, 'kb-score'));
        return tr;
      }));
      q('status').textContent = status;
      q('card').textContent = card;
      q('card').hidden = !card;
      q('setup').hidden = !setup;
      if (setup) {
        q('counts').replaceChildren(...setup.map((c) => {
          const b = cell('button', c.text, 'small');
          b.dataset.count = String(c.n);
          return b;
        }));
      }
      q('peek').hidden = !peek;
      q('start').hidden = !start;
      if (start) {
        q('draw').disabled = !start.draw;
        q('take').disabled = !start.take;
        q('take').classList.toggle('on', !!start.taking);
        q('kabo').disabled = !start.kabo;
      }
      q('drawn').hidden = !drawn;
      q('power').hidden = !power;
      if (power) {
        for (const b of root.querySelectorAll('[data-kind]')) {
          b.hidden = !power.kinds?.includes(b.dataset.kind);
          b.classList.toggle('on', power.kind === b.dataset.kind);
        }
        q('skip').textContent = power.skip;
      }
      q('look').hidden = !look;
      if (look) {
        q('seen').hidden = look !== 'seen';
        for (const b of root.querySelectorAll('[data-king]')) b.hidden = look !== 'king';
      }
      q('sneak-row').hidden = !sneak;
      if (sneak) {
        q('sneak').disabled = !sneak.enabled;
        q('sneak').classList.toggle('on', sneak.on);
        q('sneak').textContent = sneak.on ? 'Heimlich ansehen: Karte anklicken' : 'Heimlich ansehen';
      }
      q('last').textContent = last;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('end-box').hidden = !end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('again').textContent = end.again;
        q('regroup').hidden = !end.regroup;
      }
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
    },
  };
}
