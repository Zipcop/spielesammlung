// Seitenfeld rechts (HTML): Spieler mit Leben (und am Rundenende den Punkten), Status, eigene Punkte, Knöpfe
// (Geber: behalten / andere Hand · im Zug: alle drei tauschen, schieben, klopfen, ohne Hilfen „31!“), Wahl der
// Spielerzahl, Rundenende und die Regeln in Kurzform. Alles nur per textContent – Namen kommen vom Netz.
import './schwimmen.css';

export function createPanel(root, { solo, onSetup, onKeep, onAll, onPush, onKnock, onClaim, onAgain, onRegroup, onLeave }) {
  root.innerHTML = `
    <div class="sw-head"><span class="brand">Schwimmen</span><span data-round></span></div>
    <table class="sw-players"><tbody data-players></tbody></table>
    <p class="sw-status" data-status></p>
    <p class="sw-hand" data-hand></p>
    <div class="sw-setup" data-setup hidden>
      <p>Wie viele sitzen am Tisch?</p>
      <div class="row" data-counts></div>
      <p class="muted small">Jeder hat 3 Leben – danach schwimmt er, beim nächsten Verlust ist er raus</p>
    </div>
    <div class="row sw-actions" data-choose hidden>
      <button class="small" data-keep="1">Behalten</button>
      <button class="secondary small" data-keep="0">Andere Hand nehmen</button>
    </div>
    <div class="row sw-actions" data-actions hidden>
      <button class="secondary small" data-all>Alle drei tauschen</button>
      <button class="secondary small" data-push>Schieben</button>
      <button class="small" data-knock>Klopfen</button>
      <button class="small" data-claim>31!</button>
    </div>
    <p class="sw-last" data-last></p>
    <p class="sw-hint" data-hint></p>
    <div class="sw-end" data-end-box hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nächste Runde</button>
      <button class="secondary small" data-regroup>Andere Spielerzahl</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <details class="sw-rules">
      <summary>Regeln kurz</summary>
      <ul>
        <li>Je 3 Karten, 3 liegen offen in der Mitte. <b>Ass 11</b>, König, Dame, Bube, 10 je <b>10</b>, sonst die Augen</li>
        <li>Es zählt die <b>höchste Summe einer Farbe</b> (höchstens 31); drei gleiche Werte = <b>30½</b>, drei Asse = <b>Feuer</b></li>
        <li>Im Zug: <b>eine</b> Karte oder <b>alle drei</b> mit der Mitte tauschen (nie zwei), <b>schieben</b> oder <b>klopfen</b></li>
        <li>Schieben alle hintereinander, kommt eine neue Mitte. Nach dem Klopfen ist jeder andere noch einmal dran</li>
        <li><b>31</b> oder Feuer: sofort Schluss. Wer am wenigsten hat, verliert ein Leben – bei Feuer alle anderen</li>
        <li>3 Leben, dann <b>schwimmst</b> du; verlierst du noch einmal, bist du raus. Der Letzte gewinnt</li>
      </ul>
    </details>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.count) onSetup(Number(b.dataset.count));
    else if (b.dataset.keep) onKeep(b.dataset.keep === '1');
    else if ('all' in b.dataset) onAll();
    else if ('push' in b.dataset) onPush();
    else if ('knock' in b.dataset) onKnock();
    else if ('claim' in b.dataset) onClaim();
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
    // players: [{ name, lives, note, turn, out }] ab mir · setup: null | [{ n, text }] · choose: bool ·
    // actions: null | { all, push, knock, claim } (claim null = Knopf weg) · end: null | { title, text, again, regroup }
    render({ round, players, status, hand, setup, choose, actions, last, hint, end }) {
      q('round').textContent = round;
      q('players').replaceChildren(...players.map((p) => {
        const tr = document.createElement('tr');
        tr.className = [p.turn && 'turn', p.out && 'out'].filter(Boolean).join(' ');
        tr.append(cell('td', p.turn ? '▶' : '', 'sw-arrow'), cell('td', p.name), cell('td', p.lives, 'sw-lives'), cell('td', p.note, 'sw-score'));
        return tr;
      }));
      q('status').textContent = status;
      q('hand').textContent = hand;
      q('hand').hidden = !hand;
      q('setup').hidden = !setup;
      if (setup) {
        q('counts').replaceChildren(...setup.map((c) => {
          const b = cell('button', c.text, 'small');
          b.dataset.count = String(c.n);
          return b;
        }));
      }
      q('choose').hidden = !choose;
      q('actions').hidden = !actions;
      if (actions) {
        q('all').disabled = !actions.all;
        q('push').disabled = !actions.push;
        q('knock').disabled = !actions.knock;
        q('claim').hidden = actions.claim === null;
        q('claim').disabled = !actions.claim;
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
