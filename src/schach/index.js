// Schach-Partie: verbindet Spielstand (game.js), 3D-Brett (board.js), Partiezettel (panel.js) und Netz.
// Zu zweit: Der Host hält den Spielstand und schickt ihn nach jeder Änderung komplett an den Gast;
// der Gast schickt nur Wünsche (Zug, Aufgeben, Revanche) – der Host prüft sie mit chess.js.
// Allein (level gesetzt): Spieler 1 ist Stockfish (solo.js), dazu das Orakel mit Zuganalyse (analysis.js).
// Zu zweit: Live-Bewertung der eigenen Züge (abschaltbar) und nach der Partie der Rückblick „Partie analysieren“ –
// jeder PC rechnet für sich. free = „Ohne Hilfen“ (zu zweit und allein): keine erlaubten Felder, jede eigene Figur
// darf überallhin, „Geschummelt!“-Knopf – und keine Analyse, kein Orakel, kein Zurücknehmen.
// level = 'coach': „Mit Coach spielen“ – der Computer spielt in der Stärke des Coachs und kommentiert meine Züge
// (tutor.js, coach.js); ohne Hilfen gibt es dabei nicht. Elo (elo.js): allein je PC, zu zweit aus der Statistik.
// Lernen (lernen.js, mit Hilfen): „Drohung zeigen“ (Taste D, drohung.js) und nach der Partie werden meine Fehler und
// Patzer zu Rätseln für „Meine Fehler“ in Schach-Rätsel – beides nur auf diesem PC.
import { newGame, whiteFor, move, resign, takeBack, again, accuse, waive, anyMove, turnOf, colorOf, legalMoves, positionAt, REASONS, MAX_STRIKES } from './game.js';
import { createPanel } from './panel.js';
import { createSolo, LEVELS, loadRecord } from './solo.js';
import { createAnalyst } from './analysis.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked } from '../schummeln.js';
import { seatLabels } from '../plates.js';
import { createTutor } from './tutor.js';
import { loadElo, coachElo, pairElo, diffText } from './elo.js';
import { loadStats, pairOf } from '../stats.js';
import { cleanName } from '../settings.js';
import { withFlatView } from './board2d.js';
import { createThreats } from './drohung.js';
import { loadLernen, saveLernen, collectMistakes, addMistakes, dayOf } from './lernen.js';

const $ = (id) => document.getElementById(id);
const THREAT_ARROW = { kind: 'threat', color: '#e0302a' }; // rot wie beim Coach (tutor.js)
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
  const coaching = level === 'coach';
  if (coaching) free = false; // der Coach ist ja Hilfe
  let gameElo = coaching ? coachElo() : LEVELS[level]?.elo; // Stärke des Gegners in dieser Partie
  const isHost = me === 0;
  const other = () => (solo ? (coaching ? 'Der Coach' : 'Der Computer') : names.other()); // Name kann sich während der Partie ändern
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
  let threats = null; // „Drohung zeigen“ (drohung.js), startet erst beim ersten Knopfdruck
  let threat = null; // angezeigte Drohung: { fen, uci, text } – nur auf diesem PC, geht nicht übers Netz
  let harvested = false; // Fehler dieser Partie schon in „Meine Fehler“ (lernen.js) übernommen
  // 2D ↔ 3D (Taste V): ab hier füttert jeder board-Aufruf beide Bretter; 2D-Eingaben gehen denselben Weg wie im 3D
  board = withFlatView(board, { me, onClick: clickSquare, onDrop: placePiece, onHover: (sq) => pointAt(myTurn() ? sq : null) });

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
    // Coach: 'back' = meinen Zug zurücknehmen (er hat noch nicht geantwortet), 'go' = weiter, er spielt seine Drohung
    onCoach: (choice) => {
      if (!tutor || !state || state.result || turnOf(state) === me) return;
      if (choice === 'go') {
        tutor.go();
        return render();
      }
      const next = takeBack(state, 1);
      if (!next) return;
      tutor.back(next.moves.length);
      commit(next);
    },
    onThreat: toggleThreat,
  });
  const coach = solo ? createSolo({
    opponent: () => ({ elo: gameElo, record: coaching ? 'coach' : level, coach: coaching }),
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
  const tutor = coaching ? createTutor({ me, solo: coach, onChange: () => render() }) : null;

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
      harvest(true); // was bis jetzt eingestuft ist, kommt noch in „Meine Fehler“
      round++; // neue Partie
      review = null;
      harvested = false;
      if (coaching) gameElo = coachElo(); // der Coach hat sich auf meine neue Zahl eingestellt
    }
    const ended = next.result && !state?.result;
    if (ended && !state) harvested = true; // schon beendete Partie fortgesetzt: ihre Fehler kamen damals schon in „Meine Fehler“
    state = next;
    if (threat && (threat.fen !== state.fen || state.result)) threat = null; // neuer Zug oder Partie aus – die Drohung gilt nicht mehr
    syncAnalyst();
    // Partie zu Ende (mit Hilfen): Stockfish stuft im Hintergrund alle Züge ein – meine Fehler und Patzer werden Rätsel
    if (ended && !harvested && !state.free) {
      startAnalyst().update(state, false);
      analyst.analyseAll();
    }
    clearSelection();
    promotion = null; // z. B. Mitspieler gibt auf, während ich die Umwandlung auswähle
    $('promo').hidden = true;
  }

  function commit(next) {
    setState(next);
    showHint = false;
    send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    coach?.update(state, tutor?.afterCommit(state)); // beim Coach wartet der Computer, bis mein Zug eingestuft ist
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

  // Nach der Partie: meine Fehler, Patzer und verpassten Gewinne als Rätsel für „Meine Fehler“ (Schach-Rätsel) merken –
  // nur meine eigenen Züge, nur auf diesem PC. Sobald alle meine Züge eingestuft sind – oder beim Verlassen bzw. bei der
  // Revanche (final) mit dem, was bis dahin gerechnet ist.
  function harvest(final = false) {
    if (harvested || !state?.result || state.free || !analyst) return;
    const mine = colorOf(state, me);
    const view = analyst.view(mine, false);
    const complete = view.verdicts.every((v, i) => v || (i % 2 === 0) !== (mine === 'w'));
    if (!complete && !final) return;
    harvested = true;
    const found = collectMistakes(view, analyst.coachView, state.moves, dayOf());
    if (!found.length) return;
    const data = loadLernen();
    saveLernen({ ...data, mistakes: addMistakes(data.mistakes, found) });
  }

  // „Drohung zeigen“ (Taste D): Was würde der Gegner ziehen, wenn er jetzt nochmal dran wäre? Nur mit Hilfen,
  // nur wenn ich am Zug bin – und nur auf diesem PC.
  const canThreat = () => !!state && !state.free && !review && myTurn();
  function toggleThreat() {
    if (threat) {
      threat = null;
      return render();
    }
    if (!canThreat()) return;
    const fen = state.fen;
    threat = { fen, text: 'Stockfish rechnet …' };
    render();
    (threats ??= createThreats()).find(fen).then((r) => {
      if (threat?.fen !== fen) return; // inzwischen gezogen oder ausgeblendet
      threat = r.check ? { fen, text: 'Du stehst im Schach – die Drohung ist das Schach selbst. Wehr es zuerst ab.' }
        : r.none ? { fen, text: 'Keine Drohung – der Gegner hätte gar keinen Zug.' }
          : { fen, uci: r.uci, text: r.text };
      render();
    });
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
    tutor?.check(view, analyst); // Coach: Einstufung meines Zugs da? Dann spricht er (oder zieht)
    harvest();
    // Vorspielen: Partie bis vor den Zug, dann so viele Züge der besten Fortsetzung
    const line = review?.line !== undefined ? view?.lines[review.ply - 1] : null;
    const shown = line ? [...state.moves.slice(0, review.ply - 1), ...line.slice(0, review.line).map((m) => m.uci)] : null;
    board.sync(!review ? state : line ? positionAt({ ...state, moves: shown }, shown.length) : positionAt(state, review.ply));
    const opponent = solo ? (coaching ? `Coach (${gameElo})` : `Computer (${LEVELS[level].name})`) : names.other();
    const myColor = mine === 'w' ? 0 : 1; // Schilder je Farbe: 0 = Weiß, 1 = Schwarz
    board.names(seatLabels(2, { mySeat: myColor, humans: solo ? [myColor] : [0, 1], me: names.me(), other: names.other(), cpu: () => opponent }),
      state.result ? null : state.fen.split(' ')[1] === 'w' ? 0 : 1, myColor);
    // im Rückblick zeigt der Pfeil den besseren Zug (aus der Stellung vor dem gezeigten Zug)
    board.setMarks(review ? { selected: null, targets: [], arrow: (line ? line[review.line]?.uci : view?.arrows[review.ply - 1]) ?? null } : { selected, targets, arrow: showHint && myTurn() ? view?.hint : null, arrows: [...(tutor?.view().arrows ?? []), ...(threat?.uci ? [{ uci: threat.uci, ...THREAT_ARROW }] : [])] });
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
      other: solo ? (coaching ? 'Coach' : 'Computer') : names.other(),
      status: statusText(),
      elo: eloText(),
      coach: tutor?.view().say ?? null,
      end: state.result && endInfo(),
      analysis: liveActive() || review ? view : null,
      live: { available: !solo && !state.free, on: liveOn },
      review,
      canTip: myTurn(),
      canBack: !state.result && myMoves() > 0,
      canResign: !state.result && !waiting,
      canReview: !!state.result && !state.free,
      threat: state.free ? null : { can: canThreat(), on: !!threat, text: threat?.text ?? null },
    });
  }

  function statusText() {
    // ohne Hilfen: Verwarnungen mit anzeigen (bei der dritten ist die Partie verloren)
    const strikes = state.free ? ` · Verwarnungen: du ${state.strikes[me]}/${MAX_STRIKES}, ${solo ? 'Computer' : other()} ${state.strikes[1 - me]}/${MAX_STRIKES}` : '';
    if (state.result) return `Partie beendet${strikes}`;
    if (waiting) return 'Zug wird gesendet …';
    const check = state.check ? 'Schach! ' : '';
    if (turnOf(state) === me) return `${check}Du bist am Zug${strikes}`;
    if (tutor?.waiting()) return 'Der Coach schaut sich deinen Zug an …';
    if (tutor?.view().say?.choice) return 'Zurücknehmen oder weiterspielen?';
    return solo ? `${check}${other()} denkt …${strikes}` : `${check}${other()} ist am Zug${strikes}`;
  }

  // Elo-Zeile: allein meine Zahl und die des Gegners, zu zweit beide Namen (aus der Statistik, stats.js)
  function eloText() {
    if (solo) return `Elo: du ${loadElo().rating} · ${coaching ? 'Coach' : 'Computer'} ${gameElo}`;
    const pair = pairOf(names.me(), names.other());
    if (!pair) return '';
    const elo = pairElo(loadStats(), pair);
    const mine = cleanName(names.me());
    const theirs = pair.find((n) => n !== mine);
    return `Elo: ${mine} ${elo[mine]} · ${theirs} ${elo[theirs]}`;
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
    if (solo && state.free) text += ' Ohne Hilfen – zählt nicht zur Bilanz und nicht zur Elo.';
    else if (solo) {
      const r = loadRecord()[coaching ? 'coach' : level] ?? { w: 0, d: 0, l: 0 };
      const { rating, last } = loadElo();
      text += ` Deine Elo: ${rating}${last ? ` (${diffText(last.after - last.before)})` : ''}.`;
      if (coaching) text += ` Nächste Partie spielt der Coach mit ${coachElo()}.`;
      text += ` Bilanz gegen ${coaching ? 'den Coach' : LEVELS[level].name} – Siege: ${r.w} · Remis: ${r.d} · Niederlagen: ${r.l}`;
    }
    return { title, text };
  }

  // --- Eingaben: Figur anklicken → erlaubte Felder leuchten → Ziel anklicken ---
  // Ohne Hilfen leuchtet nichts: eigene Figur anklicken, dann irgendein Zielfeld.
  const isMine = (sq) => {
    const piece = sq && pieceAt(state.fen, sq);
    return !!piece && (piece === piece.toUpperCase()) === (colorOf(state, me) === 'w');
  };

  // Feld unter der Maus (3D über den Strahl, 2D direkt): Figur leicht aufleuchten lassen – Antwort = Mauszeiger
  function pointAt(sq) {
    if (!state) return ''; // Gast: erster Stand noch nicht da
    const movable = sq && (state.free ? isMine(sq) : legalMoves(state, sq).length > 0);
    board.setHover(movable ? sq : null);
    return movable || targets.some((t) => t.to === sq) || (state.free && selected && sq) ? 'pointer' : '';
  }
  const onMove = (e) => (canvas.style.cursor = pointAt(myTurn() ? board.pickSquare(room.rayFrom(e)) : null));

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

  const onClick = (e) => myTurn() && clickSquare(board.pickSquare(room.rayFrom(e)));

  // Feld angeklickt (3D oder 2D)
  function clickSquare(sq) {
    if (!myTurn()) return;
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
  }

  // Figur mit der Hand abgestellt (tisch.js): auf einem Feld = Zug, sonst zurück auf ihr Feld; neben dem Brett bleibt sie liegen.
  // Antwort: 'move' (Spiel zieht), 'back' (Figur fliegt zurück) oder null (bleibt, wo sie ist)
  board.onPlace = (piece, point) => {
    const to = board.squareAt(point);
    return to ? placePiece(piece.userData.square, to) : null;
  };

  // Figur von from nach to gestellt (3D mit der Hand, 2D mit der Maus gezogen)
  function placePiece(from, to) {
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
  }

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
    // D = Drohung zeigen/ausblenden (nicht beim Tippen in einem Feld, nicht mit Strg/Alt)
    if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !e.target.closest?.('input, textarea, select, [contenteditable]')) return toggleThreat();
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
      tutor?.stop();
      harvest(true); // Tisch verlassen: was eingestuft ist, kommt noch in „Meine Fehler“
      analyst?.stop();
      threats?.stop();
      board.reset();
      board.removeFlat(); // 2D-Brett und Knopf weg
    },
  };
}
