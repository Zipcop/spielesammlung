// Partiezettel rechts (HTML): Spieler, Status, Eröffnung, Zugliste mit Abzeichen, Ende der Partie.
// Allein zusätzlich das Orakel (Gewinnchance, Verlauf, Tipp, Zug zurück); zu zweit ein Schalter für die
// Live-Bewertung. Nach der Partie der Rückblick „Analyse“: alle Züge mit Abzeichen, Stellungssymbol, Blättern.
import './analyse.css';
import { BADGES } from './badges.js';

const GERMAN = { N: 'S', B: 'L', R: 'T', Q: 'D' }; // Springer, Läufer, Turm, Dame
// Text kommt beim Gast vom Host → spitze Klammern usw. entfernen, damit nichts als HTML gilt
const plain = (text) => String(text).replace(/[<>&"']/g, '');
export const german = (san) => plain(san).replace(/[NBRQ]/g, (c) => GERMAN[c]);

const SYMBOL_TEXT = {
  '=': 'ausgeglichen', '⩲': 'Weiß leicht besser', '⩱': 'Schwarz leicht besser', '±': 'Weiß klar besser',
  '∓': 'Schwarz klar besser', '+−': 'Weiß gewinnt', '−+': 'Schwarz gewinnt',
};

const badge = (kind) => (kind ? `<span class="badge" style="--c:${BADGES[kind].color}" title="${BADGES[kind].label}">${BADGES[kind].symbol}</span>` : '');
const verdictText = (kind) => `${badge(kind)} <span class="verdict-${kind}">${BADGES[kind].label}</span>`;
const moveNo = (i) => `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'}`; // Zug i (0 = erster weißer Zug)

// Ergebnis aus Sicht von Weiß: 1-0, 0-1 oder ½-½
function resultText(state) {
  const { winner } = state.result;
  if (winner === null) return '½-½';
  return (winner === state.white) ? '1-0' : '0-1';
}

// Verlaufskurve (0–100 %) als Punkte für eine SVG-Linie
const curvePoints = (curve) => {
  const n = Math.max(curve.length - 1, 1);
  return curve.map((v, k) => (v === null ? null : `${(k / n) * 100},${30 - v * 0.3}`)).filter(Boolean).join(' ');
};

export function createPanel(root, { solo, onTip, onBack, onResign, onAgain, onLeave, onLive, onReview, onPly, onCloseReview }) {
  root.innerHTML = `
    <div class="chess-head"><span class="brand">Schach</span><span data-players></span></div>
    <p class="chess-status" data-status></p>
    <p class="chess-opening" data-opening hidden></p>
    ${solo ? `
    <section class="oracle" data-oracle>
      <div class="oracle-head"><span>Orakel</span><span data-percent></span></div>
      <div class="oracle-bar"><div data-bar></div></div>
      <svg class="oracle-curve" viewBox="0 0 100 30" preserveAspectRatio="none">
        <line x1="0" y1="15" x2="100" y2="15" /><polyline data-curve />
      </svg>
      <p class="oracle-text" data-verdict></p>
      <div class="row">
        <button class="secondary small" data-tip>Tipp</button>
        <button class="secondary small" data-back>Zug zurück</button>
      </div>
    </section>` : `
    <section class="live" data-live-box>
      <label><input type="checkbox" data-live /> Live-Bewertung meiner Züge</label>
      <p class="oracle-text" data-live-verdict></p>
    </section>`}
    <div class="moves" data-scroll><table><tbody data-moves></tbody></table></div>
    <section class="review" data-review hidden>
      <div class="oracle-head"><span>Analyse</span><span data-progress></span></div>
      <svg class="oracle-curve" viewBox="0 0 100 30" preserveAspectRatio="none">
        <line x1="0" y1="15" x2="100" y2="15" /><polyline data-review-curve /><line class="now" data-now y1="0" y2="30" />
      </svg>
      <p class="review-move" data-review-move></p>
      <div class="row nav">
        <button class="secondary small" data-ply-to="first" title="Anfang">⏮</button>
        <button class="secondary small" data-ply-to="prev" title="Zug zurück (←)">◀</button>
        <button class="secondary small" data-ply-to="next" title="Zug vor (→)">▶</button>
        <button class="secondary small" data-ply-to="last" title="Ende">⏭</button>
      </div>
      <table class="review-sum" data-summary></table>
      <button class="secondary small" data-review-close>Zurück zum Ergebnis</button>
    </section>
    <div class="chess-end" data-end hidden>
      <h3 data-end-title></h3>
      <p data-end-text></p>
      <button class="secondary" data-analyse>Analyse</button>
      <button data-again>Revanche</button>
      <button class="secondary" data-leave>Zurück zum Schrank</button>
    </div>
    <div class="row" data-running>
      <button class="secondary small" data-resign>Aufgeben</button>
      ${solo ? '<button class="secondary small" data-shelf>Zum Schrank</button>' : ''}
    </div>`;

  const q = (name) => root.querySelector(`[data-${name}]`);
  root.onclick = (e) => {
    const cell = e.target.closest('td[data-ply]');
    if (cell) return onPly(Number(cell.dataset.ply));
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('tip' in b.dataset) onTip();
    else if ('back' in b.dataset) onBack();
    else if ('resign' in b.dataset) onResign();
    else if ('again' in b.dataset) onAgain();
    else if ('analyse' in b.dataset) onReview();
    else if ('reviewClose' in b.dataset) onCloseReview();
    else if ('plyTo' in b.dataset) onPly(b.dataset.plyTo);
    else if ('leave' in b.dataset || 'shelf' in b.dataset) onLeave(!('leave' in b.dataset));
  };
  if (!solo) q('live').onchange = (e) => onLive(e.target.checked);
  let scrolledAt = null; // Zugzahl und Rückblick-Stellung beim letzten Scrollen

  return {
    // analysis = analysis.view() oder null · live = { available, on } (zu zweit) · review = { ply } oder null
    render({ state, players, other, status, end, analysis, live, review, canTip, canBack, canResign, canReview }) {
      q('players').textContent = players;
      q('status').textContent = status;
      q('status').classList.toggle('check', state.check && !state.result);
      q('opening').hidden = !analysis?.opening;
      q('opening').textContent = analysis?.opening ? `Eröffnung: ${analysis.opening}` : '';

      // Zugliste: Nummer, Weiß, Schwarz – mit Abzeichen; im Rückblick anklickbar, mit Stellungssymbol
      const rows = [];
      for (let i = 0; i < state.san.length; i += 2) {
        const cell = (k) => {
          if (k >= state.san.length) return '<td></td>';
          const now = review ? review.ply === k + 1 : k === state.san.length - 1;
          const symbol = review && analysis?.symbols[k + 1] ? `<small>${analysis.symbols[k + 1]}</small>` : '';
          return `<td class="${now ? 'last' : ''}"${review ? ` data-ply="${k + 1}"` : ''}>${german(state.san[k])}${badge(analysis?.verdicts[k])}${symbol}</td>`;
        };
        rows.push(`<tr><th>${i / 2 + 1}.</th>${cell(i)}${cell(i + 1)}</tr>`);
      }
      if (state.result && review) rows.push(`<tr class="result"><td colspan="3">${resultText(state)}</td></tr>`);
      q('moves').innerHTML = rows.join('') || '<tr><td class="empty">Noch keine Züge</td></tr>';
      // nur bei neuem Zug bzw. anderer Stellung im Rückblick scrollen – nicht bei jedem Rechenergebnis
      const at = `${state.san.length} ${review?.ply}`;
      if (at !== scrolledAt) {
        scrolledAt = at;
        const now = q('moves').querySelector('td.last');
        if (review && now) now.scrollIntoView({ block: 'nearest' });
        else if (!review) q('scroll').scrollTop = q('scroll').scrollHeight;
      }

      q('review').hidden = !review;
      q('end').hidden = !end || !!review;
      q('running').hidden = !!end;
      if (end) {
        q('end-title').textContent = end.title;
        q('end-text').textContent = end.text;
        q('analyse').hidden = !canReview;
      }
      q('resign').disabled = !canResign;
      if (review) renderReview(state, analysis, review.ply, other);

      if (!solo) {
        q('live-box').hidden = !live.available || !!state.result;
        q('live').checked = live.on;
        q('live-verdict').innerHTML = live.on ? lastVerdict(state, analysis, false) : ''; // zu zweit kein Engine-Zug, solange die Partie läuft
        return;
      }
      q('oracle').hidden = !!review || !analysis; // ohne Hilfen kein Orakel – damit auch kein Tipp, kein Zug zurück
      if (!analysis) return;
      const known = analysis.curve.filter((v) => v !== null);
      const percent = known.at(-1) ?? 50;
      q('percent').textContent = `Gewinnchance ${Math.round(percent)} %`;
      q('bar').style.width = `${percent}%`;
      q('curve').setAttribute('points', curvePoints(analysis.curve));
      q('verdict').innerHTML = analysis.last ? lastVerdict(state, analysis) : canTip ? 'Mach deinen ersten Zug.' : 'Der Computer fängt an …';
      q('tip').disabled = !canTip;
      q('tip').textContent = canTip && !analysis.hint ? 'Tipp (Orakel rechnet …)' : 'Tipp';
      q('back').disabled = !canBack;
    },
  };

  // Einstufung meines letzten Zugs, z. B. „Dein Zug Dh5: ?! Ungenauigkeit – besser war d4“
  function lastVerdict(state, analysis, withBetter = true) {
    const last = analysis?.last;
    if (!last) return '';
    const move = `Dein Zug <b>${german(state.san[last.index])}</b>`;
    if (!last.kind) return `${move}: Stockfish rechnet …`;
    return `${move}: ${verdictText(last.kind)}${withBetter && last.better ? ` – besser war <b>${german(last.better)}</b>` : ''}`;
  }

  function renderReview(state, analysis, ply, other) {
    const { done, total } = analysis.progress;
    q('progress').textContent = done < total ? `Stockfish rechnet … ${done}/${total}` : 'fertig';
    q('review-curve').setAttribute('points', curvePoints(analysis.curve));
    const x = (ply / Math.max(analysis.curve.length - 1, 1)) * 100;
    q('now').setAttribute('x1', x);
    q('now').setAttribute('x2', x);

    const i = ply - 1; // Zug, der zu dieser Stellung geführt hat
    const symbol = analysis.symbols[ply];
    const kind = i >= 0 ? analysis.verdicts[i] : null;
    q('review-move').innerHTML = (i < 0 ? 'Ausgangsstellung' : `${moveNo(i)} <b>${german(state.san[i])}</b> ${kind ? verdictText(kind) : '· rechnet …'}`)
      + (analysis.better[i] ? ` – besser war <b>${german(analysis.better[i])}</b>` : '')
      + (symbol ? `<br>Stellung: <b>${symbol}</b> ${SYMBOL_TEXT[symbol]}` : '')
      + (ply === state.moves.length ? ` · Ergebnis <b>${resultText(state)}</b>` : '');

    // Zusammenfassung wie bei chess.com: wie oft welches Abzeichen, je Spieler
    const mine = state.moves.length && analysis.mine;
    const count = (kind, me) => analysis.verdicts.filter((v, k) => v === kind && (k % 2 === (mine === 'w' ? 0 : 1)) === me).length;
    q('summary').innerHTML = `<tr><th></th><th>Du</th><th>${plain(other)}</th></tr>`
      + Object.keys(BADGES).filter((kind) => analysis.verdicts.includes(kind)) // nur, was vorkommt – spart Platz
        .map((kind) => `<tr><td>${badge(kind)} ${BADGES[kind].label}</td><td>${count(kind, true)}</td><td>${count(kind, false)}</td></tr>`).join('');
  }
}
