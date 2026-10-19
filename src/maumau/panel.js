// Seitenfeld rechts (HTML): Spieler mit Kartenzahl, Status, was zuletzt passiert ist, Knöpfe
// „Mau!“ / „Karte ziehen“ / „Weiter“, die Regeln in Kurzform und das Spielende.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML im Fenster.

export function createPanel(root, { solo, onMau, onDraw, onPass, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="mm-head"><span class="brand">Mau-Mau</span><span data-players></span></div>
    <p class="mm-status" data-status></p>
    <p class="mm-last" data-last></p>
    <p class="mm-hint" data-hint></p>
    <div class="mm-actions" data-running>
      <button class="mm-mau" data-mau>Mau!</button>
      <div class="row">
        <button class="secondary small" data-draw>Karte ziehen</button>
        <button class="secondary small" data-pass>Weiter</button>
      </div>
    </div>
    <div class="mm-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="mm-rules">
      <li>Gleiche Farbe oder gleicher Wert legen – sonst eine Karte ziehen</li>
      <li><b>7</b> – der andere zieht 2, außer er legt auch eine 7 (dann 4 …)</li>
      <li><b>8</b> – der andere setzt aus</li>
      <li><b>Bube</b> – auf alles außer Bube, du wünschst dir eine Farbe</li>
      <li>Vorletzte Karte: vorher <b>„Mau!“</b> drücken, sonst 1 Strafkarte</li>
    </ul>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('mau' in b.dataset) onMau();
    else if ('draw' in b.dataset) onDraw();
    else if ('pass' in b.dataset) onPass();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // end = { title, text } oder null
    render({ players, status, last, hint, mau, canMau, canDraw, canPass, end }) {
      q('players').textContent = players;
      q('status').textContent = status;
      q('last').textContent = last;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('mau').disabled = !canMau;
      q('mau').classList.toggle('on', mau);
      q('mau').textContent = mau ? 'Mau! ✓ angesagt' : 'Mau!';
      q('draw').disabled = !canDraw;
      q('pass').disabled = !canPass;
      q('running').hidden = !!end;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end; // am Ende reicht „Zurück zum Schrank“
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
  };
}
