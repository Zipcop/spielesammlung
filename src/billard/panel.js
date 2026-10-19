// Seitenfeld rechts (HTML): beide Spieler mit Gruppe und übrigen Kugeln, Status, letzter Stoß, Kraftanzeige,
// Regeln in Kurzform und das Spielende. Texte nur per textContent – nichts vom Netz landet als HTML im Fenster.
import './billard.css';

export const BALL_CSS = { 1: '#f2c018', 2: '#1c4fbf', 3: '#d42020', 4: '#5b2a86', 5: '#f2701b', 6: '#1c7a3c', 7: '#7a1b1b', 8: '#141414' };

export function createPanel(root, { solo, onAgain, onLeave }) {
  root.innerHTML = `
    <div class="bil-head"><span class="brand">Billard</span><span class="muted small">8-Ball</span></div>
    <ul class="bil-players">
      <li data-p="0"><span class="bil-name"></span><span class="bil-group"></span><span class="bil-left"></span></li>
      <li data-p="1"><span class="bil-name"></span><span class="bil-group"></span><span class="bil-left"></span></li>
    </ul>
    <p class="bil-status" data-status></p>
    <p class="bil-last" data-last></p>
    <div class="bil-power" data-power-row><span>Kraft</span><div class="bil-bar"><div data-power></div></div></div>
    <div class="bil-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <ul class="bil-rules">
      <li>Zuerst eine Kugel der eigenen Gruppe treffen (offener Tisch: nicht die 8)</li>
      <li>Eigene Kugel versenkt = weiterstoßen</li>
      <li>Foul (Weiße drin, falsche Kugel zuerst, keine Bande): der andere hat <b>Ball in Hand</b></li>
      <li>Die <b>8</b> zuletzt – zu früh oder mit Foul versenkt = verloren</li>
    </ul>
    ${solo ? '<div class="row" data-shelf-row><button class="secondary small" data-shelf>Zum Schrank</button></div>' : ''}`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('again' in b.dataset) onAgain();
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };

  return {
    // players[p] = { name, group, left: [Nummern], turn }, end = { title, text } oder null
    render({ players, status, last, end }) {
      players.forEach((pl, p) => {
        const li = root.querySelector(`[data-p="${p}"]`);
        li.classList.toggle('turn', pl.turn);
        li.querySelector('.bil-name').textContent = pl.name;
        li.querySelector('.bil-group').textContent = pl.group;
        const left = li.querySelector('.bil-left');
        left.replaceChildren(...pl.left.map((n) => {
          const dot = document.createElement('span');
          dot.className = n > 8 ? 'bil-ball stripe' : 'bil-ball';
          dot.style.setProperty('--c', BALL_CSS[n > 8 ? n - 8 : n]);
          dot.title = `Kugel ${n}`;
          return dot;
        }));
      });
      q('status').textContent = status;
      q('last').textContent = last;
      q('last').hidden = !last;
      q('end').hidden = !end;
      if (q('shelf-row')) q('shelf-row').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
      }
    },
    // Kraft 0–1 (null = Balken ausblenden)
    setPower(power) {
      q('power-row').classList.toggle('idle', power === null);
      q('power').style.width = `${Math.round((power ?? 0) * 100)}%`;
    },
  };
}
