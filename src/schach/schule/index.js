// Schach-Schule (allein): besser Schach lernen – Lernpfad mit Kapiteln, Endspiel-, Eröffnungs- und Koordinaten-Training,
// Meisterpartien „Zug raten“, Analysebrett und eine Fortschritts-Seite. Ein Panel mit Übersicht, je Bereich ein eigenes
// Modul (pfad.js, endspiel.js, eroeffnung.js, koordinaten-ui.js, meister-ui.js, analyse.js, fortschritt.js); die reine
// Logik steht daneben (lernpfad.js, endspiele.js …, getestet in test/schach-schule*.test.js).
// Brett wie bei Schach-Rätsel: 3D-Brett mit 2D-Ansicht (board2d.js, Knopf „2D“ / Taste V). Die Bereiche bekommen ein
// gemeinsames „ctx“: Stellung zeigen, Pfeile setzen, Züge annehmen (Seite oder beide), rohe Feld-Klicks, Stockfish.
import '../raetsel.css'; // Modus-Knöpfe, Umwandlung, Quellenzeile wie bei Schach-Rätsel
import './schule.css';
import { Chess } from 'chess.js';
import { withFlatView } from '../board2d.js';
import { createEngine } from '../engine.js';
import { loadSchule, saveSchule } from './speicher.js';
import { levelOf } from './lernpfad.js';
import { openPfad } from './pfad.js';
import { openEndspiel } from './endspiel.js';
import { openEroeffnung } from './eroeffnung.js';
import { openKoordinaten } from './koordinaten-ui.js';
import { openMeister } from './meister-ui.js';
import { openAnalyse } from './analyse.js';
import { openFortschritt } from './fortschritt.js';

const SECTIONS = [
  { id: 'pfad', title: 'Lernpfad', info: 'Kapitel mit Erklärung und Übungen', open: openPfad },
  { id: 'endspiel', title: 'Endspiele', info: 'Lehrstellungen gegen Stockfish', open: openEndspiel },
  { id: 'eroeffnung', title: 'Eröffnungen', info: 'Hauptlinien üben, bis sie sitzen', open: openEroeffnung },
  { id: 'koordinaten', title: 'Koordinaten', info: 'Felder finden und Blind-Übung', open: openKoordinaten },
  { id: 'meister', title: 'Meisterpartien', info: 'Zug raten in berühmten Partien', open: openMeister },
  { id: 'analyse', title: 'Analysebrett', info: 'Stellung aufbauen und rechnen lassen', open: openAnalyse },
  { id: 'fortschritt', title: 'Fortschritt', info: 'Elo, Wertungen, Rekorde', open: openFortschritt },
];
const SYMBOLS = { w: { q: '♕', r: '♖', b: '♗', n: '♘' }, b: { q: '♛', r: '♜', b: '♝', n: '♞' } };
// Pfeile: kind fürs 3D-Brett (board.js LOOK), color fürs 2D-Brett
const ARROW = { blue: { kind: 'arrow' }, green: { kind: 'better', color: '#2fb34a' }, red: { kind: 'threat', color: '#e0302a' } };
export const START_FEN = new Chess().fen();

export function startSchule({ room, board, canvas, onLeave }) {
  board = withFlatView(board, { me: 0, onClick: clickSquare, onDrop: placePiece, onHover: (sq) => pointAt(sq) });
  const root = document.getElementById('schule-panel');
  const schule = loadSchule();
  let current = null; // offener Bereich: { id, handle }
  let gen = 0; // zählt hoch bei jedem Wechsel – alte Rückrufe (Stockfish, Zeitgeber) laufen dann ins Leere
  let timers = [];
  let engine = null;
  let pos = null; // Spielstand auf dem Brett
  let play = null; // { color: 'w' | 'b' | 'any', onMove(uci) } – wer am Brett ziehen darf
  let onSquare = null; // rohe Feld-Klicks (Koordinaten, Aufbau) statt Zügen
  let selected = null;
  let targets = [];
  let extra = { arrows: [], circles: [] };
  let promotion = null;
  let stopped = false;

  root.innerHTML = `
    <div class="chess-head"><span class="brand">Schach-Schule</span><span data-level></span></div>
    <div class="sch-top" data-top hidden><button class="secondary small" data-home>← Übersicht</button><b data-title></b></div>
    <div class="sch-menu" data-menu>${SECTIONS.map((s) => `<button class="secondary" data-section="${s.id}"><b>${s.title}</b><small>${s.info}</small></button>`).join('')}</div>
    <div class="pz-promo" data-promo hidden><span>Umwandeln in:</span>${'qrbn'.split('').map((x) => `<button class="secondary" data-piece="${x}"></button>`).join('')}</div>
    <div class="sch-body" data-body></div>
    <button class="secondary" data-leave>Zurück zum Schrank</button>`;
  const q = (name) => root.querySelector(`[data-${name}]`);
  const body = q('body');

  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.section) open(b.dataset.section);
    else if ('home' in b.dataset) open(null);
    else if (b.dataset.piece) closePromotion(b.dataset.piece);
    else if ('leave' in b.dataset) onLeave();
    else current?.handle.click?.(b);
  };
  root.onchange = (e) => current?.handle.change?.(e.target);
  root.oninput = (e) => current?.handle.input?.(e.target);

  function head() {
    const { level, stars } = levelOf(schule.path);
    q('level').textContent = `Level ${level} · ${stars} ★`;
  }

  // Bereich öffnen (null = Übersicht): alles vom alten Bereich aufräumen
  function open(id) {
    current?.handle.stop?.();
    current = null;
    gen++;
    timers.forEach(clearTimeout);
    timers = [];
    engine?.cancel();
    play = onSquare = null;
    extra = { arrows: [], circles: [] };
    clearSelection();
    closePromotion(null);
    document.body.classList.remove('sch-nocoords');
    body.textContent = '';
    const s = SECTIONS.find((x) => x.id === id);
    q('menu').hidden = !!s;
    q('top').hidden = !s;
    head();
    if (!s) {
      show(plainStart(), true);
      body.innerHTML = '<p class="sch-note">Wähle oben einen Bereich. Dein Fortschritt bleibt auf diesem PC gespeichert.</p>';
      return;
    }
    q('title').textContent = s.title;
    current = { id, handle: s.open(makeCtx()) ?? {} };
  }

  const plainStart = () => ({ white: 0, moves: [], fen: START_FEN, san: [], last: null, captured: [], check: false, mate: false, result: null });

  function makeCtx() {
    const my = gen;
    let run = 0; // fresh() zählt hoch: neuer Durchgang im selben Bereich – alte Zeitgeber und Stockfish-Antworten verfallen
    const alive = () => my === gen && !stopped;
    const current = () => {
      const r = run;
      return () => alive() && r === run;
    };
    return {
      body,
      q: (name) => body.querySelector(`[data-${name}]`),
      schule,
      save: () => {
        saveSchule(schule);
        head();
      },
      alive,
      // Stellung zeigen; fresh = andere Grundstellung (Brett neu aufbauen statt Zug gleiten lassen)
      show,
      // Pfeile/Kreise: [{ uci, look: 'blue' | 'green' | 'red' }], [{ square, color }]
      marks(arrows = [], circles = []) {
        extra = { arrows: arrows.map((a) => ({ uci: a.uci, ...ARROW[a.look ?? 'blue'] })), circles };
        drawMarks();
      },
      setPlay(next) {
        play = next;
        clearSelection();
        drawMarks();
      },
      setSquares(fn) {
        onSquare = fn;
        clearSelection();
        drawMarks();
      },
      // Stockfish (volle Stärke); Ergebnis null, wenn der Bereich inzwischen gewechselt wurde
      analyse(fen, go = 'depth 16') {
        engine ??= createEngine();
        const ok = current();
        return engine.analyse(fen, go).then((r) => (ok() ? r : null));
      },
      later(ms, fn) {
        const ok = current();
        const t = setTimeout(() => ok() && fn(), ms);
        timers.push(t);
        return t;
      },
      token: current, // Prüfer für den laufenden Durchgang: const ok = ctx.token(); … if (!ok()) return
      // neuer Durchgang (Neustart, andere Übung, Liste): was vom alten noch aussteht, läuft ins Leere
      fresh() {
        run++;
      },
      cancel: (t) => clearTimeout(t),
      home: () => open(null),
      open,
    };
  }

  // --- Brett ---
  function show(state, fresh = false) {
    if (fresh) board.reset(); // sonst hält das Brett eine neue Stellung mit gleich vielen Zügen für die alte
    pos = state;
    clearSelection();
    closePromotion(null);
    board.sync(state);
    drawMarks();
  }

  function drawMarks() {
    if (stopped) return;
    board.setMarks({ selected, targets, arrow: null, arrows: extra.arrows, circles: extra.circles });
  }

  function clearSelection() {
    selected = null;
    targets = [];
  }

  const turnOf = () => pos?.fen.split(' ')[1];
  const myTurn = () => !!(play && pos && !promotion && !pos.mate && (play.color === 'any' || play.color === turnOf()));

  function legal(sq) {
    try {
      return new Chess(pos.fen).moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, uci: m.lan, capture: !!m.captured }));
    } catch {
      return [];
    }
  }

  // Feld unter der Maus: Figur leicht aufleuchten lassen – Antwort = Mauszeiger
  function pointAt(sq) {
    if (onSquare) {
      board.setHover(null);
      return sq ? 'pointer' : '';
    }
    const movable = !!sq && myTurn() && legal(sq).length > 0;
    board.setHover(movable ? sq : null);
    return movable || targets.some((t) => t.to === sq) ? 'pointer' : '';
  }
  const onMove = (e) => (canvas.style.cursor = pointAt(board.pickSquare(room.rayFrom(e))));
  const onClick = (e) => clickSquare(board.pickSquare(room.rayFrom(e)));

  // Feld angeklickt (3D oder 2D)
  function clickSquare(sq) {
    if (onSquare) return sq && onSquare(sq);
    if (!myTurn()) return;
    const options = targets.filter((t) => t.to === sq);
    if (options.length > 1) return choosePromotion(options);
    if (options.length === 1) return move(options[0].uci);
    targets = sq ? legal(sq) : [];
    selected = targets.length ? sq : null;
    drawMarks();
  }

  function move(uci) {
    clearSelection();
    drawMarks();
    play.onMove(uci);
  }

  // Figur mit der Hand abgestellt (tisch.js): 'move' = Zug, 'back' = zurück auf ihr Feld
  board.onPlace = (piece, point) => {
    const to = board.squareAt(point);
    return to ? placePiece(piece.userData.square, to) : null;
  };

  function placePiece(from, to) {
    if (onSquare || !from || to === from || !myTurn()) return 'back';
    const options = legal(from).filter((t) => t.to === to);
    if (options.length > 1) choosePromotion(options);
    if (options.length !== 1) return 'back';
    move(options[0].uci);
    return 'move';
  }

  function choosePromotion(options) {
    promotion = options;
    q('promo').querySelectorAll('button').forEach((b) => (b.textContent = SYMBOLS[turnOf()][b.dataset.piece]));
    q('promo').hidden = false;
  }

  function closePromotion(piece) {
    const choice = promotion?.find((o) => o.uci[4] === piece);
    promotion = null;
    q('promo').hidden = true;
    if (choice) move(choice.uci);
  }

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    closePromotion(null);
    clearSelection();
    drawMarks();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));
  open(null);

  return {
    handle() {}, // nur allein – übers Netz kommt nichts
    refresh: () => current?.handle.refresh?.(),
    stop() {
      stopped = true;
      current?.handle.stop?.();
      gen++;
      timers.forEach(clearTimeout);
      engine?.stop();
      board.onPlace = null;
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      document.body.classList.remove('sch-nocoords');
      stopFrames();
      board.reset();
      board.removeFlat();
      root.onclick = root.onchange = root.oninput = null;
    },
  };
}
