// Schach-Rätsel (allein): Taktik-Rätsel lösen oder bei „Bester Zug?“ aus vier Zügen wählen – jeweils mit
// eigener Wertung, gespeichert auf diesem PC. Logik in puzzle.js, Rätsel in puzzles.json (Lichess, CC0 –
// erzeugt mit scripts/puzzles.mjs). Bedienung am Brett wie bei Schach: Figur anklicken → Ziel anklicken
// oder Figur mit der Hand hinstellen.
// Lernen (lernen.js, Nico 28.10.2026): Tagesrätsel mit Serie, Rätsel-Sturm (3 Minuten), „Meine Fehler“ (eigene
// Fehler aus Partien und verpasste Rätsel, wiederholt mit Abstand), Schwächen-Profil mit „Gezielt üben“ und Erfolge.
import './raetsel.css';
import { legalMoves } from './game.js';
import { german } from './panel.js';
import { START_RATING, THEMES, PICKABLE, puzzleFrom, positionOf, isRight, rate, pickPuzzle, choicesFor } from './puzzle.js';
import { withFlatView } from './board2d.js';
import {
  loadLernen, saveLernen, dayOf, pickDaily, solveDaily, dailyDone, currentStreak, recordMotifs, weaknesses, focusTheme,
  puzzleMistake, addMistakes, reviewMistake, mistakeQueue, mistakePuzzle, alsoRight, dueCount, INTERVALS,
  stormStart, stormStep, stormPick, stormLeft, stormEnd, STORM_LIVES, ACHIEVEMENTS, earned, newAchievements, MIN_TRIES,
} from './lernen.js';

const KEY = 'spielesammlung-schach-raetsel';
const MODES = { solve: 'Rätsel lösen', choose: 'Bester Zug?', daily: 'Tagesrätsel', storm: 'Sturm', fehler: 'Meine Fehler' };
const RATED = new Set(['solve', 'choose']); // diese Modi haben eine Wertung
const PROFILED = new Set(['solve', 'daily', 'storm']); // diese zählen fürs Schwächen-Profil (nicht „Bester Zug?“: dort hilft Raten)
const COLOR = { w: 'Weiß', b: 'Schwarz' };
const SYMBOLS = { w: { q: '♕', r: '♖', b: '♗', n: '♘' }, b: { q: '♛', r: '♜', b: '♝', n: '♞' } };
const KIND = { fehler: 'Fehler', patzer: 'Patzer', verpasst: 'Verpasster Gewinn' };
const LOOK_MS = 800; // kurz die Stellung zeigen, dann zieht der Gegner
const REPLY_MS = 450; // Antwort des Gegners
const WRONG_MS = 900; // falscher Zug bleibt kurz stehen
const PLAY_MS = 900; // Lösung vorspielen
const STORM_LOOK_MS = 400; // im Sturm geht alles schneller
const STORM_REPLY_MS = 250;
const STORM_NEXT_MS = 500;
const AWARD_MS = 6000; // so lange steht die Meldung über einen neuen Erfolg

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
    mode: Object.hasOwn(MODES, saved.mode) ? saved.mode : 'solve', // nicht „in“: 'toString' o. ä. ließe pickPuzzle endlos suchen
  };
}

function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // ohne Speicher gilt der Fortschritt nur bis zum Neuladen
  }
}

const shortDay = (day) => `${Number(day.slice(8))}.${Number(day.slice(5, 7))}.`; // '2026-10-28' → '28.10.'
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function startRaetsel({ room, board, canvas, onLeave }) {
  // 2D ↔ 3D wie bei Schach (board2d.js): jeder board-Aufruf geht an beide Bretter, 2D-Eingaben denselben Weg wie im 3D
  board = withFlatView(board, { me: 0, onClick: clickSquare, onDrop: placePiece, onHover: (sq) => pointAt(myTurn() ? sq : null) });
  const root = document.getElementById('puzzle-panel');
  const progress = loadProgress();
  const seen = new Set(progress.seen);
  let lern = loadLernen(); // Tagesrätsel, Profil, Meine Fehler, Sturm-Rekord (lernen.js)
  if (lern.solved === null) { // erstes Mal: bisher gelöste Rätsel zählen für die Erfolge mit
    lern.solved = progress.solve.solved + progress.choose.solved;
    saveLernen(lern);
  }
  let list = null; // Rätsel aus puzzles.json (wird nachgeladen)
  let p = null; // aktuelles Rätsel; p.mode = Modus, in dem es kam; p.lead = Züge des Gegners vorab (0 oder 1)
  let k = 0; // so viele Züge der Lösung stehen auf dem Brett
  let phase = 'load'; // load | look | play | reply | choose | show | done | empty | storm-ready | storm-over
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
  let storm = null; // laufender Sturm (lernen.js stormStart) oder null
  let stormSeen = new Set(); // im Sturm kommt kein Rätsel doppelt
  let stormClock = null;
  let lastStorm = null; // Ergebnis des letzten Sturms { score, record }
  const practised = new Set(); // „Meine Fehler“: in dieser Sitzung schon gezeigt
  let award = null; // Meldung über neue Erfolge
  let awardTimer = null;
  const today = () => dayOf();

  root.innerHTML = `
    <div class="chess-head"><span class="brand">Schach-Rätsel</span><span data-who></span></div>
    <div class="pz-modes">${['solve', 'choose'].map((m) => `<button class="secondary small" data-mode="${m}">${MODES[m]}</button>`).join('')}</div>
    <div class="pz-modes pz-learn">${['daily', 'storm', 'fehler'].map((m) => `<button class="secondary small" data-mode="${m}">${MODES[m]}</button>`).join('')}</div>
    <label class="pz-theme" data-theme-row>Thema <select data-theme>
      <option value="mix">Gemischt</option>${PICKABLE.map((t) => `<option value="${t}">${THEMES[t]}</option>`).join('')}
    </select></label>
    <div class="pz-rating" data-box></div>
    <p class="pz-award" data-award hidden></p>
    <p class="chess-status" data-status></p>
    <div class="pz-choices" data-choices></div>
    <div class="pz-promo" data-promo hidden><span>Umwandeln in:</span>${'qrbn'.split('').map((x) => `<button class="secondary" data-piece="${x}"></button>`).join('')}</div>
    <p class="pz-info" data-info></p>
    <div class="row" data-buttons>
      <button class="secondary small" data-solution>Lösung zeigen</button>
      <button class="small" data-next>Nächstes Rätsel</button>
    </div>
    <button data-storm-start hidden>Sturm starten</button>
    <p class="pz-stats" data-stats></p>
    <section class="pz-profile" data-profile></section>
    <div class="pz-trophies" data-trophies></div>
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
    else if ('stormStart' in b.dataset) startStorm();
    else if ('focus' in b.dataset) practiseWeakest();
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
  const fast = () => p?.mode === 'storm';

  function show(moves) {
    shown = positionOf(p, moves);
    board.sync(shown);
  }

  // Lernstand ändern und speichern – neue Erfolge werden kurz gemeldet
  function learn(fn) {
    const before = lern;
    lern = fn(lern);
    saveLernen(lern);
    const got = newAchievements(before, lern);
    if (got.length) {
      award = `Neuer Erfolg: ${got.map((a) => `${a.symbol} ${a.label}`).join(', ')}!`;
      clearTimeout(awardTimer);
      awardTimer = setTimeout(() => {
        award = null;
        render();
      }, AWARD_MS);
    }
  }

  function next() {
    if (!list) return render(); // Knöpfe zeigen die Wahl schon, Rätsel kommt nach dem Laden
    giveUp();
    const mode = progress.mode;
    if (mode === 'storm') return stormReady();
    if (mode === 'daily') return begin(dailyPuzzle());
    if (mode === 'fehler') return begin(mistakeNext());
    const row = pickPuzzle(list, progress[mode].rating, progress.theme, seen);
    seen.add(row[0]);
    progress.seen = [...seen];
    saveProgress(progress);
    begin({ ...puzzleFrom(row), mode, lead: 1 });
  }

  // Rätsel aufs Brett: erst die Stellung, dann (lead 1) der Zug des Gegners – oder (lead 0) gleich ich
  function begin(puzzle) {
    clearTimeout(timer);
    p = puzzle;
    k = 0;
    failed = counted = false;
    choices = [];
    picked = null;
    clearSelection(); // sonst gälten die Ziele der alten Figur auf dem neuen Brett
    closePromotion(null);
    if (!p) {
      phase = 'empty';
      message = 'Noch keine Fehler gespeichert. Spiel eine Partie gegen den Computer oder den Coach (oder zu zweit) – deine Fehler und Patzer landen hier, verpasste Rätsel auch.';
      return render();
    }
    board.reset(); // sonst hält das Brett die neue Stellung (auch ohne Züge) für die alte
    show([]);
    if (!p.lead) return startPlay();
    phase = 'look';
    message = `Du spielst ${COLOR[p.color]}. Gleich zieht ${COLOR[p.color === 'w' ? 'b' : 'w']} …`;
    render();
    later(fast() ? STORM_LOOK_MS : LOOK_MS, () => {
      k = 1;
      show(played());
      if (p.mode === 'choose') {
        choices = choicesFor(p);
        phase = 'choose';
        message = 'Welcher Zug ist der beste?';
        return render();
      }
      startPlay();
    });
  }

  function startPlay() {
    phase = 'play';
    message = p.replay ? 'Heute schon gelöst ✓ – zum Nachspielen, zählt nicht nochmal.'
      : p.mode === 'fehler' && !p.lead ? `Aus deiner Partie: Finde den besten Zug für ${COLOR[p.color]}.`
        : `Finde den besten Zug für ${COLOR[p.color]}.`;
    render();
  }

  // Tagesrätsel: für heute einmal gewählt, passend zur Wertung bei „Rätsel lösen“
  function dailyPuzzle() {
    const day = today();
    const { daily, row } = pickDaily(lern.daily, list, day, progress.solve.rating);
    if (daily.pick?.id !== lern.daily.pick?.id || daily.pick?.date !== lern.daily.pick?.date) learn((d) => ({ ...d, daily }));
    return { ...puzzleFrom(row), mode: 'daily', lead: 1, day, replay: dailyDone(lern.daily, day) }; // day: zählt für diesen Tag, auch nach Mitternacht gelöst
  }

  // Meine Fehler: fällige zuerst, in dieser Sitzung noch nicht gezeigte vor schon gezeigten
  function mistakeNext() {
    const queue = mistakeQueue(lern.mistakes, today());
    if (!queue.length) return null;
    const m = queue.find((x) => !practised.has(x.id) && x.id !== p?.mistake?.id) ?? queue.find((x) => x.id !== p?.mistake?.id) ?? queue[0];
    practised.add(m.id);
    const row = m.puzzle ? list.find((r) => r[0] === m.puzzle) : null;
    return { ...mistakePuzzle(m, row), mode: 'fehler', early: m.due > today() };
  }

  function setMode(mode) {
    if (mode === progress.mode) return;
    giveUp(); // zählt noch für den alten Modus
    abortStorm();
    progress.mode = mode;
    saveProgress(progress);
    change = null;
    next();
  }

  // „Gezielt üben“: Thema mit der schlechtesten Quote bei „Rätsel lösen“
  function practiseWeakest() {
    const theme = focusTheme(lern.motifs);
    if (!theme) return;
    giveUp();
    abortStorm();
    progress.mode = 'solve';
    progress.theme = theme;
    saveProgress(progress);
    change = null;
    next();
  }

  // Überspringen (auch per Thema- oder Moduswechsel) zählt als nicht gelöst – Nico: „damit die Wertung ehrlich bleibt“.
  // Nur bei den Modi mit Wertung; fürs Profil und „Meine Fehler“ zählt Überspringen nicht.
  function giveUp() {
    if (p && !counted && RATED.has(p.mode)) count(false, true);
  }

  // Ergebnis einmal je Rätsel: Wertung, Profil, Wiederholung, Sturm. skipped = übersprungen, ohne es zu versuchen
  function count(solved, skipped = false) {
    counted = true;
    const mode = p.mode;
    if (RATED.has(mode)) {
      const mine = progress[mode];
      const after = rate(mine, p.rating, solved, mode === 'choose' ? choices.length || 4 : 0); // übersprungen, bevor die Antworten standen: wie 4
      change = after.rating - mine.rating;
      progress[mode] = { ...after, solved: mine.solved + (solved ? 1 : 0) };
      saveProgress(progress);
    }
    if (skipped || p.replay) return;
    const day = p.day ?? today();
    learn((d) => {
      let out = { ...d, solved: (d.solved ?? 0) + (solved ? 1 : 0) };
      // Tagesrätsel zählt fürs Profil nur beim ersten Versuch am Tag
      const firstTry = mode !== 'daily' || d.daily.tried !== day;
      if (PROFILED.has(mode) && firstTry) out.motifs = recordMotifs(d.motifs, p.themes, solved);
      if (mode === 'daily') out.daily = { ...out.daily, tried: day };
      if (!solved && (mode === 'solve' || (mode === 'daily' && firstTry))) out.mistakes = addMistakes(d.mistakes, [puzzleMistake(p, day)]);
      if (mode === 'fehler') {
        const after = reviewMistake(p.mistake, solved, day);
        out.mistakes = d.mistakes.flatMap((m) => (m.id !== p.mistake.id ? [m] : after ? [after] : []));
        if (!after) out.cleared = d.cleared + 1;
      }
      return out;
    });
    if (mode === 'storm' && storm) storm = stormStep(storm, solved);
  }

  // --- Rätsel lösen ---
  function tryMove(uci) {
    if (phase !== 'play') return;
    clearSelection();
    if (!isRight(p, k, uci) && !alsoRight(p, k, uci)) {
      if (!counted) count(false);
      failed = true;
      show([...played(), uci]);
      phase = 'reply';
      message = `${german(shown.san.at(-1))} ist nicht die Lösung.`;
      if (p.mode === 'storm') { // im Sturm geht es nach einem Fehler gleich mit dem nächsten Rätsel weiter
        later(WRONG_MS / 2, () => (storm.over ? stormOver('Drei Fehler – der Sturm ist vorbei.') : nextStorm()));
        return render();
      }
      later(WRONG_MS, () => {
        show(played());
        phase = 'play';
        message = 'Versuch es noch einmal – oder lass dir die Lösung zeigen.';
        render();
      });
      return render();
    }
    const mate = positionOf(p, [...played(), uci]).mate; // jedes Matt ist richtig, auch ein anderes als in der Lösung
    if (mate || alsoRight(p, k, uci) || k + 1 >= p.line.length) {
      k += 1;
      show(mate || alsoRight(p, k - 1, uci) ? [...p.line.slice(0, k - 1), uci] : played());
      return finish();
    }
    k += 1;
    show(played());
    phase = 'reply';
    message = 'Richtig!';
    render();
    later(fast() ? STORM_REPLY_MS : REPLY_MS, () => {
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
    // Tagesrätsel: zählt für die Serie auch nach einem Fehlversuch – aber nicht, wenn heute die Lösung gezeigt wurde
    const shownToday = p.mode === 'daily' && lern.daily.shown === p.day;
    if (p.mode === 'daily' && !p.replay && !shownToday) learn((d) => ({ ...d, daily: solveDaily(d.daily, p.day) }));
    if (p.mode === 'storm') {
      message = 'Richtig!';
      later(STORM_NEXT_MS, nextStorm);
      return render();
    }
    message = p.replay ? 'Gelöst – heute schon gezählt.'
      : p.mode === 'fehler' ? (failed ? 'Gelöst – zählt aber nicht, weil vorher ein Fehlzug kam. Morgen nochmal.' : mistakeText())
        : shownToday ? 'Gelöst – zählt heute nicht für die Serie, weil die Lösung gezeigt wurde.'
        : p.mode === 'daily' ? `Tagesrätsel gelöst! Serie: ${currentStreak(lern.daily, today())} ${currentStreak(lern.daily, today()) === 1 ? 'Tag' : 'Tage'}.`
          : failed ? 'Gelöst – zählt aber nicht, weil vorher ein Fehlzug kam.' : 'Richtig gelöst!';
    render();
  }

  // Richtig bei „Meine Fehler“: wann kommt er wieder?
  function mistakeText() {
    const m = lern.mistakes.find((x) => x.id === p.mistake.id);
    if (!m) return 'Richtig – dieser Fehler ist erledigt!';
    if (p.early) return `Richtig! (War noch nicht fällig – bleibt beim ${shortDay(m.due)}.)`;
    return `Richtig! Wieder dran am ${shortDay(m.due)}`;
  }

  // Lösung Zug für Zug vorspielen (zählt als nicht gelöst)
  function showSolution() {
    if (phase !== 'play' || p.mode === 'storm') return;
    if (!counted) count(false);
    failed = true;
    if (p.mode === 'daily' && !p.replay) learn((d) => ({ ...d, daily: { ...d.daily, shown: p.day } }));
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

  // --- Rätsel-Sturm: 3 Minuten, immer schwerer, 3 Fehler = vorbei ---
  function stormReady() {
    clearTimeout(timer);
    p = null;
    phase = 'storm-ready';
    message = `Rätsel-Sturm: 3 Minuten, so viele Rätsel wie möglich. Sie werden immer schwerer, bei ${STORM_LIVES} Fehlern ist Schluss.`;
    render();
  }

  function startStorm() {
    if (!list || storm) return;
    storm = stormStart(Date.now());
    stormSeen = new Set();
    lastStorm = null;
    clearInterval(stormClock);
    stormClock = setInterval(() => {
      if (!storm) return;
      if (stormLeft(storm, Date.now()) <= 0) return stormOver('Die Zeit ist um!');
      renderBox();
    }, 250);
    nextStorm();
  }

  function nextStorm() {
    if (!storm) return;
    const row = stormPick(list, storm.index, stormSeen);
    stormSeen.add(row[0]);
    begin({ ...puzzleFrom(row), mode: 'storm', lead: 1 });
  }

  function stormOver(why) {
    if (!storm) return;
    clearInterval(stormClock);
    clearTimeout(timer);
    const { score } = storm;
    const record = score > lern.storm.best;
    storm = null;
    learn((d) => ({ ...d, storm: stormEnd(d.storm, score) }));
    lastStorm = { score, record };
    clearSelection();
    closePromotion(null);
    phase = 'storm-over';
    message = `${why} ${score} Rätsel gelöst${record ? ' – neuer Rekord!' : '.'}`;
    render();
  }

  // Modus gewechselt oder Tisch verlassen: laufender Sturm zählt nicht
  function abortStorm() {
    clearInterval(stormClock);
    storm = null;
  }

  // --- Anzeige ---
  function renderBox() {
    const mode = progress.mode;
    const box = q('box');
    if (RATED.has(mode)) {
      box.innerHTML = `<span>Deine Wertung</span><b>${progress[mode].rating}</b><span class="${change > 0 ? 'pz-up' : change < 0 ? 'pz-down' : ''}">${change === null ? '' : change >= 0 ? `+${change}` : `−${-change}`}</span>`;
    } else if (mode === 'daily') {
      const streak = currentStreak(lern.daily, today());
      box.innerHTML = `<span>Serie</span><b>${streak}</b><span>${streak === 1 ? 'Tag' : 'Tage'} · Bestwert ${lern.daily.best}</span>`;
    } else if (mode === 'storm') {
      const left = storm ? stormLeft(storm, Date.now()) : 0;
      const errors = storm ? storm.errors : 0;
      box.innerHTML = storm
        ? `<span>Zeit</span><b>${clock(left)}</b><span>Gelöst <b class="pz-small">${storm.score}</b> · Fehler ${'✗'.repeat(errors)}${'○'.repeat(STORM_LIVES - errors)}</span>`
        : `<span>Rekord</span><b>${lern.storm.best}</b><span>${lern.storm.runs ? `${lern.storm.runs} ${lern.storm.runs === 1 ? 'Sturm' : 'Stürme'}` : 'noch kein Sturm'}${lastStorm ? ` · zuletzt ${lastStorm.score}` : ''}</span>`;
    } else {
      const due = dueCount(lern.mistakes, today());
      box.innerHTML = `<span>Fällig</span><b>${due}</b><span>von ${lern.mistakes.length} gespeicherten · erledigt ${lern.cleared}</span>`;
    }
  }

  function render() {
    if (stopped) return;
    const mode = progress.mode;
    const rated = RATED.has(mode);
    root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    q('theme-row').hidden = !rated;
    q('theme').value = progress.theme;
    q('who').textContent = p ? `Du spielst ${COLOR[p.color]}` : '';
    renderBox();
    q('award').hidden = !award;
    q('award').textContent = award ?? '';
    q('status').textContent = message;
    q('status').classList.toggle('pz-good', phase === 'done' && !failed);

    const answered = picked !== null;
    q('choices').hidden = p?.mode !== 'choose' || !choices.length;
    q('choices').innerHTML = choices.map((c, i) => {
      const look = answered && c.right ? 'right' : answered && i === picked ? 'wrong' : '';
      return `<button class="secondary ${look}" data-choice="${i}"${answered ? ' disabled' : ''}>${german(c.san)}</button>`;
    }).join('');

    q('info').innerHTML = infoText();
    const stormMode = mode === 'storm';
    q('buttons').hidden = stormMode || phase === 'empty';
    q('solution').hidden = mode === 'choose';
    q('solution').disabled = phase !== 'play';
    q('next').disabled = !list;
    q('next').textContent = nextLabel();
    q('next').title = rated && !counted && phase !== 'load' ? 'Zählt als nicht gelöst' : '';
    q('storm-start').hidden = !stormMode || !!storm || !list;
    q('storm-start').textContent = phase === 'storm-over' ? 'Nochmal stürmen' : 'Sturm starten';
    const mine = progress[rated ? mode : 'solve'];
    q('stats').textContent = !rated ? '' : mine.games ? `Gelöst: ${mine.solved} von ${mine.games}` : 'Noch keine Rätsel gelöst';
    q('stats').hidden = !rated;
    renderProfile();
    q('source').textContent = p?.rating ? `Rätsel ${p.id} · lichess.org (CC0)` : 'Rätsel: lichess.org (CC0)';
    if (phase !== 'choose') board.setMarks({ selected, targets, arrow: null });
  }

  function nextLabel() {
    if (progress.mode === 'daily') return phase === 'done' && !failed ? 'Nochmal ansehen' : 'Von vorn';
    if (progress.mode === 'fehler') return 'Nächster Fehler';
    return counted || phase === 'load' ? 'Nächstes Rätsel' : 'Überspringen';
  }

  function infoText() {
    if (!p) return '';
    const done = phase === 'done' || phase === 'storm-over';
    const themes = done && p.themes.length ? ` · ${p.themes.map((t) => THEMES[t] ?? t).join(', ')}` : '';
    if (p.mode === 'daily') return `Tagesrätsel vom ${shortDay(p.day)} · Rätsel-Wertung ${done ? `<b>${p.rating}</b>` : p.rating}${themes}`;
    if (p.mode === 'fehler') {
      const m = p.mistake;
      const now = lern.mistakes.find((x) => x.id === m.id); // nach der Antwort: neuer Stand (oder erledigt)
      const plan = !now ? 'erledigt ✓' : `Wiederholung ${now.step + 1} von ${INTERVALS.length + 1}${now.due > today() ? ` · fällig am ${shortDay(now.due)}` : ' · fällig'}`;
      if (m.src === 'partie') {
        const was = m.played ? ` · gespielt: <b>${german(m.played)}</b>${m.kind ? ` (${KIND[m.kind] ?? m.kind})` : ''}` : '';
        const best = done ? ` · Stockfish: <b>${german(positionOf({ ...p, line: [m.best] }, [m.best]).san[0])}</b>` : '';
        return `Aus deiner Partie vom ${shortDay(m.date ?? m.due)}${was}${best}<br><small>${plan}</small>`;
      }
      return `Verpasstes Rätsel ${p.id}${p.rating ? ` · Wertung ${p.rating}` : ''}${themes}<br><small>${plan}</small>`;
    }
    if (p.mode === 'storm') return `Sturm-Rätsel ${storm ? storm.index + 1 : ''} · Wertung ${p.rating}`;
    return done ? `Rätsel-Wertung <b>${p.rating}</b>${themes}` : `Rätsel-Wertung ${p.rating}`;
  }

  // Schwächen-Profil und Erfolge (unter den Knöpfen)
  function renderProfile() {
    const weak = weaknesses(lern.motifs);
    q('profile').innerHTML = weak.length
      ? `<p><b>Deine Schwächen:</b> ${weak.slice(0, 4).map((w) => `${THEMES[w.theme]}&nbsp;${w.percent}&nbsp;%`).join(' · ')}</p>
        <button class="secondary small" data-focus title="Rätsel lösen mit dem Thema, das dir am schwersten fällt">Gezielt üben: ${THEMES[weak[0].theme]}</button>`
      : `<p class="pz-muted">Schwächen-Profil: erscheint, sobald ein Thema ${MIN_TRIES} Versuche hat.</p>`;
    const have = new Set(earned(lern));
    q('trophies').innerHTML = ACHIEVEMENTS.map((a) => `<span class="${have.has(a.id) ? 'got' : ''}" title="${a.label}${have.has(a.id) ? '' : ' (noch nicht)'}">${a.symbol}</span>`).join('');
  }

  // --- Eingaben am Brett (nur beim Lösen) ---
  const myTurn = () => phase === 'play' && !promotion;

  function clearSelection() {
    selected = null;
    targets = [];
  }

  // Feld unter der Maus (3D über den Strahl, 2D direkt): Figur leicht aufleuchten lassen – Antwort = Mauszeiger
  function pointAt(sq) {
    const movable = sq && legalMoves(shown, sq).length > 0;
    board.setHover(movable ? sq : null);
    return movable || targets.some((t) => t.to === sq) ? 'pointer' : '';
  }
  const onMove = (e) => (canvas.style.cursor = pointAt(myTurn() ? board.pickSquare(room.rayFrom(e)) : null));

  const onClick = (e) => myTurn() && clickSquare(board.pickSquare(room.rayFrom(e)));

  // Feld angeklickt (3D oder 2D)
  function clickSquare(sq) {
    if (!myTurn()) return;
    const options = targets.filter((t) => t.to === sq);
    if (options.length > 1) return choosePromotion(options); // Bauer erreicht die letzte Reihe
    if (options.length === 1) return tryMove(options[0].uci);
    targets = sq ? legalMoves(shown, sq) : [];
    selected = targets.length ? sq : null;
    render();
  }

  // Figur mit der Hand abgestellt (tisch.js): 'move' = Zug, 'back' = zurück auf ihr Feld, null = bleibt liegen
  board.onPlace = (piece, point) => {
    const to = board.squareAt(point);
    return to ? placePiece(piece.userData.square, to) : null;
  };

  // Figur von from nach to gestellt (3D mit der Hand, 2D mit der Maus gezogen)
  function placePiece(from, to) {
    if (!from || to === from || !myTurn()) return 'back';
    const options = legalMoves(shown, from).filter((t) => t.to === to);
    if (options.length > 1) choosePromotion(options);
    if (options.length !== 1) return 'back';
    tryMove(options[0].uci);
    return 'move';
  }

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
      clearTimeout(awardTimer);
      abortStorm();
      board.onPlace = null;
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
      board.removeFlat(); // 2D-Brett und Knopf weg
      root.onclick = root.onpointerover = null;
    },
  };
}
