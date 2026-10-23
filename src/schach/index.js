// Schach-Partie: verbindet Spielstand (game.js), 3D-Brett (board.js), Partiezettel (panel.js) und Netz.
// Zu zweit: Der Host hält den Spielstand und schickt ihn nach jeder Änderung komplett an den Gast;
// der Gast schickt nur Wünsche (Zug, Aufgeben, Revanche) – der Host prüft sie mit chess.js.
// Allein (level gesetzt): Spieler 1 ist Stockfish (solo.js), dazu das Orakel mit Zuganalyse (analysis.js).
// Zu zweit: Live-Bewertung der eigenen Züge (abschaltbar) und nach der Partie der Rückblick „Partie analysieren“ –
// jeder PC rechnet für sich. free = „Ohne Hilfen“ (zu zweit und allein): keine erlaubten Felder, jede eigene Figur
// darf überallhin, „Geschummelt!“-Knopf – und keine Analyse, kein Orakel, kein Zurücknehmen.
import { newGame, whiteFor, move, resign, takeBack, again, accuse, waive, anyMove, turnOf, colorOf, legalMoves, positionAt, REASONS, MAX_STRIKES } from './game.js';
import { createPanel } from './panel.js';
import { createSolo, LEVELS, loadRecord } from './solo.js';
import { createAnalyst } from './analysis.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const SYMBOLS = { w: { q: '♕', r: '♖', b: '♗', n: '♘' }, b: { q: '♛', r: '♜', b: '♝', n: '♞' } };

// Figur auf einem Feld laut FEN, z. B. 'P' (weißer Bauer), 'k' (schwarzer König) oder null
function pieceAt(fen, sq) {
  const rows = fen.split(' ')[0].split('/').map((row) => row.replace(/\d/g, (n) => '.'.repeat(Number(n))));
  const piece = rows[8 - Number(sq[1])]?.['abcdefgh'.indexOf(sq[0])];
  return piece && piece !== '.' ? piece : null;
}

// Live-Bewertung zu zweit: an/aus pro PC (Nico: „auch live, aber abschaltbar“)
const LIVE_KEY = 'spielesammlung-schach-live';
function loadLive() {
  try {
    return localStorage.getItem(LIVE_KEY) !== 'aus';
  } catch {
    return true;
  }
}

// Farbwahl am Tisch (Nico: „Weiß oder Schwarz wählen“) – pro PC gemerkt; ohne Speicher gilt sie bis zum Neuladen
const COLOR_KEY = 'spielesammlung-schach-farbe';
let chosenColor = (() => {
  try {
    const c = localStorage.getItem(COLOR_KEY);
    return c === 'w' || c === 'b' ? c : 'zufall';
  } catch {
    return 'zufall';
  }
})();
export const loadColor = () => chosenColor;
export function saveColor(color) {
  chosenColor = color;
  try {
    localStorage.setItem(COLOR_KEY, color);
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neuladen
  }
}

// Was der Gast sehen darf: ob der letzte Zug regelwidrig war, muss er selbst merken
const forGuest = (s) => (s.free ? { ...s, cheat: s.cheat && { player: s.cheat.player } } : s);

export function startSchach({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = () => (solo ? 'Der Computer' : names.other()); // Name kann sich während der Partie ändern
  let state = null;
  let cheered = false; // Sieg-Konfetti schon gezeigt
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let selected = null; // gewähltes Feld
  let targets = []; // erlaubte Züge der gewählten Figur
  let promotion = null; // offene Auswahl bei der Umwandlung
  let showHint = false;
  let round = 0; // zählt die Partien, damit eine alte Rückfrage nicht die Revanche trifft
  let liveOn = loadLive(); // zu zweit: eigene Züge gleich bewerten
  let review = null; // Rückblick nach der Partie: { ply } = gezeigte Stellung nach so vielen Halbzügen;
  // line = Schritt beim Vorspielen der besten Fortsetzung statt Zug ply (0 = Stellung vor dem Zug), sonst fehlt es
  let analyst = null; // Stockfish-Analyse, startet erst bei Bedarf

  const panel = createPanel($('chess-panel'), {
    solo,
    onTip: () => {
      showHint = true;
      render();
    },
    onBack: takeMyMoveBack,
    onResign: () => {
      const asked = round;
      ask('Wirklich aufgeben?', () => asked === round && act('resign'));
    },
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
    onLive: (on) => {
      liveOn = on;
      try {
        localStorage.setItem(LIVE_KEY, on ? 'an' : 'aus');
      } catch {
        // ohne Speicher gilt die Wahl nur bis zum Neuladen
      }
      syncAnalyst();
      render();
    },
    onReview: () => {
      if (!state?.result || state.free) return;
      review = { ply: state.moves.length };
      startAnalyst().update(state, false);
      analyst.analyseAll();
      render();
    },
    onPly: (to) => {
      if (!review) return;
      const n = state.moves.length;
      const ply = { first: 0, prev: review.ply - 1, next: review.ply + 1, last: n }[to] ?? Number(to);
      review = { ply: Math.max(0, Math.min(n, ply)) };
      render();
    },
    onLine: stepLine,
    onCloseReview: () => {
      review = null;
      render();
    },
  });
  const coach = solo ? createSolo({
    level,
    me,
    onComputerMove: (uci) => {
      // ohne Hilfen kann Stockfish in einer regelwidrigen Stellung Unsinn liefern – dann irgendein erlaubter Zug
      const next = move(state, 1 - me, uci) ?? (state.free ? move(state, 1 - me, anyMove(state)) : null);
      if (next) commit(next);
    },
    onJudge: (accuses) => {
      const next = accuses ? accuse(state, 1 - me) : waive(state, 1 - me);
      if (next) commit(next);
    },
  }) : null;

  // Analyse: allein immer live, zu zweit live nur wenn eingeschaltet; ohne Hilfen gar nicht
  const liveActive = () => !!state && !state.free && (solo || liveOn);
  const startAnalyst = () => (analyst ??= createAnalyst({ onChange: render }));
  function syncAnalyst() {
    if (!state || state.free) return;
    if (liveActive() || analyst) startAnalyst().update(state, liveActive());
  }
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Schach"] [data-hint]') });

  function apply(type, player, arg) {
    if (type === 'move') return move(state, player, arg);
    if (type === 'resign') return resign(state, player);
    if (type === 'accuse') return accuse(state, player);
    if (type === 'again') return rematchBlocked(state, player) ? null : again(state); // Farben werden getauscht
    return null;
  }

  function setState(next) {
    if (state?.result && !next.result) {
      round++; // neue Partie
      review = null;
    }
    state = next;
    syncAnalyst();
    clearSelection();
    promotion = null; // z. B. Mitspieler gibt auf, während ich die Umwandlung auswähle
    $('promo').hidden = true;
  }

  function commit(next) {
    setState(next);
    showHint = false;
    send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    coach?.update(state);
    render();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
    } else {
      waiting = true;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (!isHost && msg.t === 'state') {
      setState(msg.state);
      waiting = false;
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 1 - me, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // Rückblick: beste Fortsetzung vorspielen – 'start', 'next', 'prev' oder 'stop' (zurück zur Partie)
  function stepLine(to) {
    const len = review && analyst?.view(colorOf(state, me), true).lines[review.ply - 1]?.length;
    if (!len) return;
    if (to === 'stop') review = { ply: review.ply };
    else review = { ply: review.ply, line: Math.max(0, Math.min(len, to === 'start' ? 0 : (review.line ?? 0) + (to === 'next' ? 1 : -1))) };
    render();
  }

  // Allein: meinen letzten Zug zurücknehmen (und die Antwort des Computers, falls er schon gezogen hat)
  const myMoves = () => (state ? Math.floor((state.moves.length + (colorOf(state, me) === 'w' ? 1 : 0)) / 2) : 0);
  function takeMyMoveBack() {
    if (!solo || state.result || myMoves() === 0) return;
    const next = takeBack(state, turnOf(state) === me ? 2 : 1);
    if (next) commit(next);
  }

  const myTurn = () => state && !state.result && !waiting && !promotion && turnOf(state) === me;

  function clearSelection() {
    selected = null;
    targets = [];
  }

  function render() {
    if (!state) return board.sync(state);
    const mine = colorOf(state, me);
    const view = analyst && !state.free ? analyst.view(mine, !!review) : null;
    // Vorspielen: Partie bis vor den Zug, dann so viele Züge der besten Fortsetzung
    const line = review?.line !== undefined ? view?.lines[review.ply - 1] : null;
    const shown = line ? [...state.moves.slice(0, review.ply - 1), ...line.slice(0, review.line).map((m) => m.uci)] : null;
    board.sync(!review ? state : line ? positionAt({ ...state, moves: shown }, shown.length) : positionAt(state, review.ply));
    const opponent = solo ? `Computer (${LEVELS[level].name})` : names.other();
    const myColor = mine === 'w' ? 0 : 1; // Schilder je Farbe: 0 = Weiß, 1 = Schwarz
    board.names(seatLabels(2, { mySeat: myColor, humans: solo ? [myColor] : [0, 1], me: names.me(), other: names.other(), cpu: () => opponent }),
      state.result ? null : state.fen.split(' ')[1] === 'w' ? 0 : 1, myColor);
    // im Rückblick zeigt der Pfeil den besseren Zug (aus der Stellung vor dem gezeigten Zug)
    board.setMarks(review ? { selected: null, targets: [], arrow: (line ? line[review.line]?.uci : view?.arrows[review.ply - 1]) ?? null } : { selected, targets, arrow: showHint && myTurn() ? view?.hint : null });
    // Plakette: im Rückblick über dem gezeigten Zug, live über meinem letzten Zug
    const badgeAt = line ? -1 : review ? review.ply - 1 : liveActive() ? view?.last?.index ?? -1 : -1;
    board.setBadge(badgeAt >= 0 ? state.moves[badgeAt].slice(2, 4) : null, view?.verdicts[badgeAt]);
    const won = state.result?.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!state.free, canAccuse: !!state.cheat && state.cheat.player !== me && !waiting });
    const v = state.verdict;
    if (v) {
      const who = v.player === me ? 'du bekommst' : `${other()} bekommt`; // mitten im Satz
      cheat.say(`${state.moves.length}:${state.strikes}:${JSON.stringify(v)}`, solo ? soloVerdict(v) : v.caught
        ? `Erwischt! ${v.player === me ? 'Du hast' : `${other()} hat`} geschummelt${v.why ? `: ${v.why}` : ''} – ${v.player === me ? 'dein' : 'der'} Zug wird zurückgenommen, ${who} eine Verwarnung.`
        : `Fehlalarm! Der Zug war erlaubt – ${who} eine Verwarnung.`, v.caught);
    }
    panel.render({
      state,
      players: mine === 'w' ? `Du (Weiß) – ${opponent} (Schwarz)` : `${opponent} (Weiß) – Du (Schwarz)`,
      other: solo ? 'Computer' : names.other(),
      status: statusText(),
      end: state.result && endInfo(),
      analysis: liveActive() || review ? view : null,
      live: { available: !solo && !state.free, on: liveOn },
      review,
      canTip: myTurn(),
      canBack: !state.result && myMoves() > 0,
      canResign: !state.result && !waiting,
      canReview: !!state.result && !state.free,
    });
  }

  function statusText() {
    // ohne Hilfen: Verwarnungen mit anzeigen (bei der dritten ist die Partie verloren)
    const strikes = state.free ? ` · Verwarnungen: du ${state.strikes[me]}/${MAX_STRIKES}, ${solo ? 'Computer' : other()} ${state.strikes[1 - me]}/${MAX_STRIKES}` : '';
    if (state.result) return `Partie beendet${strikes}`;
    if (waiting) return 'Zug wird gesendet …';
    const check = state.check ? 'Schach! ' : '';
    if (turnOf(state) === me) return `${check}Du bist am Zug${strikes}`;
    return solo ? `${check}Der Computer denkt …${strikes}` : `${check}${other()} ist am Zug${strikes}`;
  }

  // Allein: Meldungen, wenn der Computer ruft oder erwischt wird (v.player = wer die Verwarnung bekommt)
  function soloVerdict({ caught, player, why }) {
    if (player !== me) return caught ? `Erwischt! Der Computer hat geschummelt${why ? `: ${why}` : ''} – er nimmt seinen Zug zurück und bekommt eine Verwarnung.` : 'Der Computer ruft „Geschummelt!“ – Fehlalarm, dein Zug war erlaubt. Er bekommt eine Verwarnung.';
    return caught ? `Der Computer ruft „Geschummelt!“ Erwischt! Du hast geschummelt${why ? `: ${why}` : ''} – du musst neu ziehen und bekommst eine Verwarnung.` : 'Fehlalarm! Der Zug des Computers war erlaubt – du bekommst eine Verwarnung.';
  }

  function endInfo() {
    const { winner, reason } = state.result;
    const title = winner === null ? 'Remis' : winner === me ? 'Du gewinnst!' : `${other()} gewinnt`;
    let text = reason === 'aufgabe' ? (winner === me ? `${other()} hat aufgegeben.` : 'Du hast aufgegeben.') : `${REASONS[reason]}.`;
    if (solo && state.free) text += ' Ohne Hilfen – zählt nicht zur Bilanz.';
    else if (solo) {
      const r = loadRecord()[level] ?? { w: 0, d: 0, l: 0 };
      text += ` Bilanz gegen ${LEVELS[level].name} – Siege: ${r.w} · Remis: ${r.d} · Niederlagen: ${r.l}`;
    }
    return { title, text };
  }

  // --- Eingaben: Figur anklicken → erlaubte Felder leuchten → Ziel anklicken ---
  // Ohne Hilfen leuchtet nichts: eigene Figur anklicken, dann irgendein Zielfeld.
  const isMine = (sq) => {
    const piece = sq && pieceAt(state.fen, sq);
    return !!piece && (piece === piece.toUpperCase()) === (colorOf(state, me) === 'w');
  };

  const onMove = (e) => {
    const sq = myTurn() ? board.pickSquare(room.rayFrom(e)) : null;
    const movable = sq && (state.free ? isMine(sq) : legalMoves(state, sq).length > 0);
    board.setHover(movable ? sq : null);
    canvas.style.cursor = movable || targets.some((t) => t.to === sq) || (state.free && selected && sq) ? 'pointer' : '';
  };

  function freeClick(sq) {
    if (!sq) return;
    if (isMine(sq) || !selected) {
      selected = isMine(sq) ? sq : null;
      return render();
    }
    const from = selected;
    const pawn = pieceAt(state.fen, from).toLowerCase() === 'p';
    if (pawn && sq[1] === (colorOf(state, me) === 'w' ? '8' : '1')) return choosePromotion(['q', 'r', 'b', 'n'].map((p) => ({ uci: from + sq + p })));
    clearSelection();
    act('move', from + sq);
  }

  const onClick = (e) => {
    if (!myTurn()) return;
    const sq = board.pickSquare(room.rayFrom(e));
    if (state.free) return freeClick(sq);
    const options = targets.filter((t) => t.to === sq);
    if (options.length > 1) return choosePromotion(options); // Bauer erreicht die letzte Reihe
    if (options.length === 1) {
      clearSelection();
      return act('move', options[0].uci);
    }
    targets = sq ? legalMoves(state, sq) : [];
    selected = targets.length ? sq : null;
    render();
  };

  // Figur mit der Hand abgestellt (tisch.js): auf einem Feld = Zug, sonst zurück auf ihr Feld; neben dem Brett bleibt sie liegen.
  // Antwort: 'move' (Spiel zieht), 'back' (Figur fliegt zurück) oder null (bleibt, wo sie ist)
  board.onPlace = (piece, point) => {
    const to = board.squareAt(point);
    if (!to) return null;
    const from = piece.userData.square;
    if (!from || to === from || !myTurn() || !isMine(from)) return 'back';
    if (state.free) {
      const pawn = pieceAt(state.fen, from).toLowerCase() === 'p';
      if (pawn && to[1] === (colorOf(state, me) === 'w' ? '8' : '1')) {
        selected = from;
        choosePromotion(['q', 'r', 'b', 'n'].map((p) => ({ uci: from + to + p })));
        return 'back';
      }
      clearSelection();
      act('move', from + to);
      return 'move';
    }
    const options = legalMoves(state, from).filter((t) => t.to === to);
    if (options.length > 1) choosePromotion(options); // Bauer erreicht die letzte Reihe – erst Figur wählen
    if (options.length !== 1) return 'back';
    clearSelection();
    act('move', options[0].uci);
    return 'move';
  };

  function choosePromotion(options) {
    promotion = options;
    const symbols = SYMBOLS[colorOf(state, me)];
    $('promo').querySelectorAll('button').forEach((b) => (b.firstChild.textContent = symbols[b.dataset.piece]));
    $('promo').hidden = false;
  }

  function closePromotion(piece) {
    const choice = promotion?.find((o) => o.uci[4] === piece);
    promotion = null;
    $('promo').hidden = true;
    clearSelection();
    if (choice) act('move', choice.uci);
    else render();
  }

  const onKey = (e) => {
    if (review && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      if (review.line !== undefined) return stepLine(e.key === 'ArrowLeft' ? 'prev' : 'next');
      review = { ply: Math.max(0, Math.min(state.moves.length, review.ply + (e.key === 'ArrowLeft' ? -1 : 1))) };
      return render();
    }
    if (e.key !== 'Escape') return;
    if (review?.line !== undefined) return stepLine('stop');
    if (promotion) return closePromotion(null);
    clearSelection();
    render();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  $('promo').onclick = (e) => {
    const b = e.target.closest('button');
    if (b || e.target === $('promo')) closePromotion(b?.dataset.piece); // Knopf oder daneben
  };
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame(whiteFor(loadColor()), { free })); // gewählte Farbe (oder Zufall); der Gast bekommt die andere

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    stop() {
      board.onPlace = null;
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      $('promo').hidden = true;
      stopFrames();
      coach?.stop();
      analyst?.stop();
      board.reset();
    },
  };
}
