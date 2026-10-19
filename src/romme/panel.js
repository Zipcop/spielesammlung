// Seitenfeld rechts (HTML): Spieler mit Kartenzahl und Punkten, Status, Auswahl, was zuletzt passiert ist, Knöpfe
// „Auslegen“ / „Ablegen“ / „Zug zurücksetzen“ / „Sortieren“, die Regeln in Kurzform und das Rundenende.
// Texte werden nur per textContent gesetzt – nichts, was vom Netz kommt, landet als HTML im Fenster.
import './romme.css';

export function createPanel(root, { solo, onMeld, onLay, onDiscard, onUndo, onSort, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="rm-head"><span class="brand">Rommé</span><span data-players></span><span class="rm-score" data-score></span></div>
    <p class="rm-status" data-status></p>
    <div class="rm-pick" data-pick-row><span data-pick></span><button class="secondary small" data-lay>Andere Lage</button></div>
    <p class="rm-last" data-last></p>
    <p class="rm-hint" data-hint></p>
    <div class="rm-actions" data-running>
      <div class="row">
        <button data-meld>Auslegen</button>
        <button data-discard>Ablegen</button>
      </div>
      <div class="row">
        <button class="secondary small" data-undo>Zug zurücksetzen</button>
        <button class="secondary small" data-sort>Nach Wert sortieren</button>
      </div>
    </div>
    <div class="rm-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Nächste Runde</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="rm-rules">
      <li>Zug: Karte <b>ziehen</b> (Stapel oder Ablage) – auslegen, anlegen – zum Schluss <b>eine Karte ablegen</b></li>
      <li><b>Satz</b>: 3–4 gleiche Werte, verschiedene Farben · <b>Reihe</b>: ab 3 aufeinanderfolgende einer Farbe (A-2-3 oder D-K-A)</li>
      <li><b>Herauskommen</b> mit mindestens 30 Punkten – danach an alle Figuren anlegen und Joker tauschen</li>
      <li>Erste Runde: nur ziehen und ablegen · Joker zählt wie die Karte, die er ersetzt</li>
      <li>Letzte Karte abgelegt = Runde gewonnen · Restpunkte: Joker 20, Ass 11, Bilder 10</li>
    </ul>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('meld' in b.dataset) onMeld();
    else if ('lay' in b.dataset) onLay();
    else if ('discard' in b.dataset) onDiscard();
    else if ('undo' in b.dataset) onUndo();
    else if ('sort' in b.dataset) onSort();
    else if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // end = { title, text } oder null
    // lay = { k, n }: gewählte Lage k von n möglichen (Knopf nur, wenn es mehrere gibt)
    render({ players, score, status, pick, lay, last, hint, canMeld, canDiscard, canUndo, sort, end }) {
      q('players').textContent = players;
      q('score').textContent = score;
      q('status').textContent = status;
      q('pick').textContent = pick;
      q('pick-row').hidden = !pick;
      q('lay').hidden = !(lay?.n > 1);
      q('lay').textContent = lay?.n > 1 ? `Andere Lage (${lay.k + 1}/${lay.n})` : 'Andere Lage';
      q('last').textContent = last;
      q('hint').textContent = hint;
      q('hint').hidden = !hint;
      q('meld').disabled = !canMeld;
      q('discard').disabled = !canDiscard;
      q('undo').disabled = !canUndo;
      q('sort').textContent = sort === 'suit' ? 'Nach Wert sortieren' : 'Nach Farbe sortieren';
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
