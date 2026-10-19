// Schach-Rätsel (allein): Taktik-Rätsel lösen oder bei „Bester Zug?“ aus vier Zügen wählen – jeweils mit
// eigener Wertung, gespeichert auf diesem PC. Logik in puzzle.js, Rätsel in puzzles.json (Lichess, CC0 –
// erzeugt mit scripts/puzzles.mjs). Bedienung am Brett wie bei Schach: Figur anklicken → Ziel anklicken
// oder Figur mit der Hand hinstellen.
import './raetsel.css';
import { legalMoves } from './game.js';
import { german } from './panel.js';
import { START_RATING, THEMES, PICKABLE, puzzleFrom, positionOf, isRight, rate, pickPuzzle, choicesFor } from './puzzle.js';

const KEY = 'spielesammlung-schach-raetsel';
const MODES = { solve: 'Rätsel lösen', choose: 'Bester Zug?' };
const COLOR = { w: 'Weiß', b: 'Schwarz' };
const SYMBOLS = { w: { q: '♕', r: '♖', b: '♗', n: '♘' }, b: { q: '♛', r: '♜', b: '♝', n: '♞' } };
const LOOK_MS = 800; // kurz die Stellung zeigen, dann zieht der Gegner
const REPLY_MS = 450; // Antwort des Gegners
const WRONG_MS = 900; // falscher Zug bleibt kurz stehen
const PLAY_MS = 900; // Lösung vorspielen

// Gespeicherter Fortschritt – was nicht passt (alte Fassung, Handeingriff), fällt auf den Anfangswert zurück
function loadProgress() {
  const fresh = () => ({ rating: START_RATING, games: 0, solved: 0 });
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    // kein Speicher oder kaputter Eintrag
  }
  const count = (c) => (c && [c.rating, c.games, c.solved].every(Number.isFinite) ? c : fresh());
  return {
    solve: count(saved.solve),
    choose: count(saved.choose),
    seen: Array.isArray(saved.seen) ? saved.seen : [],
    theme: PICKABLE.includes(saved.theme) ? saved.theme : 'mix',
    mode: saved.mode in MODES ? saved.mode : 'solve',
  };
}

function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // ohne Speicher gilt der Fortschritt nur bis zum Neuladen
  }
}

export function startRaetsel({ room, board, canvas, onLeave }) {
  const root = document.getElementById('puzzle-panel');
  const progress = loadProgress();
  const seen = new Set(progress.seen);
  let list = null; // Rätsel aus puzzles.json (wird nachgeladen)
  let p = null; // aktuelles Rätsel
  let k = 0; // so viele Züge der Lösung stehen auf dem Brett
  let phase = 'load'; // load | look | play | reply | choose | show | done
  let failed = false; // einmal danebengelegen → zählt als nicht gelöst
  let counted = false; // Wertung für dieses Rätsel schon geändert
  let change = null; // letzte Änderung der Wertung
  let choices = []; // „Bester Zug?“: [{ uci, san, right }]
  let picked = null; // gewählte Antwort
  let message = 'Rätsel werden geladen …';
  let shown = null; // Spielstand auf dem Brett
  let selected = null;
  let targets = [];
  let promotion = null; // offene Auswahl bei der Umwandlung
  let timer = null;
  let stopped = false;

  root.innerHTML = `
    <div class="chess-head"><span class="brand">Schach-Rätsel</span><span data-who></span></div>
    <div class="pz-modes">${Object.entries(MODES).map(([m, label]) => `<button class="secondary small" data-mode="${m}">${label}</button>`).join('')}</div>
    <label class="pz-theme">Thema <select data-theme>
      <option value="mix">Gemischt</option>${PICKABLE.map((t) => `<option value="${t}">${THEMES[t]}</option>`).join('')}
    </select></label>
    <div class="pz-rating"><span>Deine Wertung</span><b data-rating></b><span data-change></span></div>
    <p class="chess-status" data-status></p>
    <div class="pz-choices" data-choices></div>
    <div class="pz-promo" data-promo hidden><span>Umwandeln in:</span>${'qrbn'.split('').map((x) => `<button class="secondary" data-piece="${x}"></button>`).join('')}</div>
    <p class="pz-info" data-info></p>
    <div class="row">
      <button class="secondary small" data-solution>Lösung zeigen</button>
      <button class="small" data-next>Nächstes Rätsel</button>
    </div>
    <p class="pz-stats" data-stats></p>
    <p class="pz-source" data-source></p>
    <button class="secondary" data-leave>Zurück zum Schrank</button>`;
  const q = (name) => root.querySelector(`[data-${name}]`);

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.choice) choose(Number(b.dataset.choice));
    else if (b.dataset.piece) closePromotion(b.dataset.piece);
    else if ('solution' in b.dataset) showSolution();
    else if ('next' in b.dataset) next();
    else if ('leave' in b.dataset) onLeave();
  };
  q('theme').onchange = (e) => {
    progress.theme = e.target.value;
    saveProgress(progress);
    next();
  };
  // „Bester Zug?“: Maus über einer Antwort zeigt den Zug als Pfeil
  root.onpointerover = (e) => {
    const b = e.target.closest('[data-choice]');
    if (phase === 'choose') board.setMarks({ selected: null, targets: [], arrow: b ? choices[b.dataset.choice].uci : null });
  };

  import('./puzzles.json').then((m) => {
    list = m.default;
    if (!stopped) next();
  });

  // Ein Ablauf zur Zeit (Gegenzug, Lösung vorspielen …) – ein neues Rätsel bricht ihn ab
  function later(ms, fn) {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  }

  const played = () => p.line.slice(0, k);

  function show(moves) {
    shown = positionOf(p, moves);
    board.sync(shown);
  }

  function next() {
    if (!list) return render(); // Knöpfe zeigen die Wahl schon, Rätsel kommt nach dem Laden
    giveUp();
    const row = pickPuzzle(list, progress[progress.mode].rating, progress.theme, seen);
    p = puzzleFrom(row);
    seen.add(p.id);
    progress.seen = [...seen];
    saveProgress(progress);
    k = 0;
    failed = counted = false;
    choices = [];
    picked = null;
    clearSelection(); // sonst gälten die Ziele der alten Figur auf dem neuen Brett
    closePromotion(null);
    phase = 'look';
    message = `Du spielst ${COLOR[p.color]}. Gleich zieht ${COLOR[p.color === 'w' ? 'b' : 'w']} …`;
    board.reset(); // sonst hält das Brett die neue Stellung (auch ohne Züge) für die alte
    show([]);
    render();
    later(LOOK_MS, () => {
      k = 1;
      show(played());
      if (progress.mode === 'choose') {
        choices = choicesFor(p);
        phase = 'choose';
        message = 'Welcher Zug ist der beste?';
      } else {
        phase = 'play';
        message = `Finde den besten Zug für ${COLOR[p.color]}.`;
      }
      render();
    });
  }

  function setMode(mode) {
    if (mode === progress.mode) return;
    giveUp(); // zählt noch für den alten Modus
    progress.mode = mode;
    saveProgress(progress);
    change = null;
    next();
  }

  // Überspringen (auch per Thema- oder Moduswechsel) zählt als nicht gelöst – Nico: „damit die Wertung ehrlich bleibt“
  function giveUp() {
    if (p && !counted) count(false);
  }

  // Wertung einmal je Rätsel ändern
  function count(solved) {
    counted = true;
    const mine = progress[progress.mode];
    const after = rate(mine, p.rating, solved, progress.mode === 'choose' ? choices.length || 4 : 0); // übersprungen, bevor die Antworten standen: wie 4
    change = after.rating - mine.rating;
    progress[progress.mode] = { ...after, solved: mine.solved + (solved ? 1 : 0) };
    saveProgress(progress);
  }

  // --- Rätsel lösen ---
  function tryMove(uci) {
    if (phase !== 'play') return;
    clearSelection();
    if (!isRight(p, k, uci)) {
      if (!counted) count(false);
      failed = true;
      show([...played(), uci]);
      phase = 'reply';
      message = `${german(shown.san.at(-1))} ist nicht die Lösung.`;
      later(WRONG_MS, () => {
        show(played());
        phase = 'play';
        message = 'Versuch es noch einmal – oder lass dir die Lösung zeigen.';
        render();
      });
      return render();
    }
    const mate = positionOf(p, [...played(), uci]).mate; // jedes Matt ist richtig, auch ein anderes als in der Lösung
    if (mate || k + 1 >= p.line.length) {
      k += 1;
      show(mate ? [...p.line.slice(0, k - 1), uci] : played());
      return finish();
    }
    k += 1;
    show(played());
    phase = 'reply';
    message = 'Richtig!';
    render();
    later(REPLY_MS, () => {
      k += 1;
      show(played());
      phase = 'play';
      message = 'Richtig! Und jetzt?';
      render();
    });
  }

  function finish() {
    if (!counted) count(true);
    phase = 'done';
    message = failed ? 'Gelöst – zählt aber nicht, weil vorher ein Fehlzug kam.' : 'Richtig gelöst!';
    render();
  }

  // Lösung Zug für Zug vorspielen (zählt als nicht gelöst)
  function showSolution() {
    if (phase !== 'play') return;
    if (!counted) count(false);
    failed = true;
    clearSelection();
    closePromotion(null);
    message = 'Lösung wird gezeigt …';
    playOut('So geht die Lösung.');
  }

  function playOut(text) {
    phase = 'show';
    const step = () => {
      if (k >= p.line.length) {
        phase = 'done';
        message = text;
        return render();
      }
      k += 1;
      show(played());
      render();
      later(PLAY_MS, step);
    };
    later(PLAY_MS / 2, step);
    render();
  }

  // --- Bester Zug? ---
  function choose(i) {
    if (phase !== 'choose') return;
    picked = i;
    const right = choices[i].right;
    failed = !right;
    count(right);
    board.setMarks({ selected: null, targets: [], arrow: null });
    message = right ? 'Richtig – das ist der beste Zug!' : `Leider nicht. Richtig ist ${german(choices.find((c) => c.right).san)}.`;
    playOut(`${message} So geht es weiter.`);
  }

  // --- Anzeige ---
  function render() {
    if (stopped) return;
    const mine = progress[progress.mode];
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === progress.mode));
    q('theme').value = progress.theme;
    q('who').textContent = p ? `Du spielst ${COLOR[p.color]}` : '';
    q('rating').textContent = mine.rating;
    q('change').textContent = change === null ? '' : change >= 0 ? `+${change}` : `−${-change}`;
    q('change').className = change > 0 ? 'pz-up' : change < 0 ? 'pz-down' : '';
    q('status').textContent = message;
    q('status').classList.toggle('pz-good', phase === 'done' && !failed);

    const answered = picked !== null;
    q('choices').hidden = progress.mode !== 'choose' || !choices.length;
    q('choices').innerHTML = choices.map((c, i) => {
      const look = answered && c.right ? 'right' : answered && i === picked ? 'wrong' : '';
      return `<button class="secondary ${look}" data-choice="${i}"${answered ? ' disabled' : ''}>${german(c.san)}</button>`;
    }).join('');

    const done = phase === 'done';
    q('info').innerHTML = !p ? '' : done
      ? `Rätsel-Wertung <b>${p.rating}</b>${p.themes.length ? ` · ${p.themes.map((t) => THEMES[t]).join(', ')}` : ''}`
      : `Rätsel-Wertung ${p.rating}`;
    q('solution').hidden = progress.mode !== 'solve';
    q('solution').disabled = phase !== 'play';
    q('next').disabled = !list;
    q('next').textContent = counted || phase === 'load' ? 'Nächstes Rätsel' : 'Überspringen';
    q('next').title = counted || phase === 'load' ? '' : 'Zählt als nicht gelöst';
    q('stats').textContent = mine.games ? `Gelöst: ${mine.solved} von ${mine.games}` : 'Noch keine Rätsel gelöst';
    q('source').textContent = p ? `Rätsel ${p.id} · lichess.org (CC0)` : 'Rätsel: lichess.org (CC0)';
    if (phase !== 'choose') board.setMarks({ selected, targets, arrow: null });
  }

  // --- Eingaben am Brett (nur beim Lösen) ---
  const myTurn = () => phase === 'play' && !promotion;

  function clearSelection() {
    selected = null;
    targets = [];
  }

  const onMove = (e) => {
    const sq = myTurn() ? board.pickSquare(room.rayFrom(e)) : null;
    const movable = sq && legalMoves(shown, sq).length > 0;
    board.setHover(movable ? sq : null);
    canvas.style.cursor = movable || targets.some((t) => t.to === sq) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!myTurn()) return;
    const sq = board.pickSquare(room.rayFrom(e));
    const options = targets.filter((t) => t.to === sq);
    if (options.length > 1) return choosePromotion(options); // Bauer erreicht die letzte Reihe
    if (options.length === 1) return tryMove(options[0].uci);
    targets = sq ? legalMoves(shown, sq) : [];
    selected = targets.length ? sq : null;
    render();
  };

  // Figur mit der Hand abgestellt (tisch.js): 'move' = Zug, 'back' = zurück auf ihr Feld, null = bleibt liegen
  board.onPlace = (piece, point) => {
    const to = board.squareAt(point);
    if (!to) return null;
    const from = piece.userData.square;
    if (!from || to === from || !myTurn()) return 'back';
    const options = legalMoves(shown, from).filter((t) => t.to === to);
    if (options.length > 1) choosePromotion(options);
    if (options.length !== 1) return 'back';
    tryMove(options[0].uci);
    return 'move';
  };

  function choosePromotion(options) {
    promotion = options;
    q('promo').querySelectorAll('button').forEach((b) => (b.textContent = SYMBOLS[p.color][b.dataset.piece]));
    q('promo').hidden = false;
  }

  function closePromotion(piece) {
    const choice = promotion?.find((o) => o.uci[4] === piece);
    promotion = null;
    q('promo').hidden = true;
    if (choice) tryMove(choice.uci);
  }

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    closePromotion(null);
    clearSelection();
    render();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));
  render();

  return {
    handle() {}, // nur allein – übers Netz kommt nichts
    refresh: render,
    stop() {
      stopped = true;
      clearTimeout(timer);
      board.onPlace = null;
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
      root.onclick = root.onpointerover = null;
    },
  };
}
