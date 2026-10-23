// Reversi-Partie: verbindet Spielstand (game.js), Brett (board.js), Seitenfeld (panel.js), Computer (ai.js im Worker) und Netz.
// Spieler 0 = Host (+z), 1 = Gast gegenüber bzw. allein der Computer. Der Host hält den Stand, der Gast schickt Wünsche
// (move bzw. ohne Hilfen place, flip, unplace, done, pass – dazu accuse, again), der Host prüft sie und antwortet mit
// { t: 'state' }. Setzen: Feld anklicken – oder einen Stein vom Turm mit der Hand aufs Feld stellen (tisch.js).
// free = „Ohne Hilfen“: nichts wird gezeigt oder geprüft, umgedreht wird selbst (Stein anklicken), dann „Zug beenden“.
// Allein schummelt der Computer ab und zu (cheatTurn) und prüft jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, move, place, unplace, flip, done, pass, turnOf, accuse, waive, again, score, forGuest, flipsFor, legalMoves,
  colorOf, countOf, squareName, COLOR_NAMES,
} from './game.js';
import { chooseMove, cheatTurn, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 600; // so lange „überlegt“ der Computer mindestens
const LOG = 4;
const LEVEL_KEY = 'spielesammlung-reversi-stufe';

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(n) && n >= 0 && n < LEVELS.length && localStorage.getItem(LEVEL_KEY) !== null ? n : 1;
  } catch {
    return 1;
  }
}

export function startReversi({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const CPU = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (forGuest)
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let hover = null;
  let log = []; // Stände mit Neuigkeiten (neueste zuerst) – als Text erst beim Zeichnen, dann stimmen auch spätere Namen
  let cheered = false;
  let stopped = false;
  let worker = null;
  let asks = 0;
  let judged = null; // allein ohne Hilfen: Zug des Menschen, den der Computer schon geprüft hat

  const who = (p) => (p === me ? 'Du' : solo ? 'Der Computer' : names.other());
  const verb = (p, du, er) => (p === me ? du : er);
  const stones = (n) => (n === 1 ? 'einen Stein' : `${n} Steine`);

  const panel = createPanel($('rv-panel'), {
    solo,
    onLevel: (n) => {
      lvl = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch {
        // ohne Speicher gilt die Stufe eben nur bis zum Neuladen
      }
      render();
    },
    onDone: () => act('done'),
    onPass: () => act('pass'),
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Reversi"] .dock [data-hint]') });

  function apply(type, p, arg) {
    const at = arg?.at;
    if (type === 'move') return move(state, p, at);
    if (type === 'place') return place(state, p, at);
    if (type === 'flip') return flip(state, p, at);
    if (type === 'unplace') return unplace(state, p);
    if (type === 'done') return done(state, p);
    if (type === 'pass') return pass(state, p);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    return null;
  }

  function setState(next) {
    // neue Partie – derselbe Startstand nochmal (z. B. nach abgelehnter Revanche des Gasts) zählt nicht
    const start = next.events[0]?.type === 'start' && !(state && !state.result && state.seq === next.seq && state.round === next.round);
    if (start) {
      log = [];
      cheered = false;
      judged = null;
    }
    const fresh = start || next.seq !== state?.seq;
    state = next;
    if (fresh && describe(next)) log = [next, ...log].slice(0, LOG);
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return false;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
      else if (type === 'again') say(blockedText());
      return !!next;
    }
    waiting = true;
    asked = type;
    send({ t: type, arg });
    render();
    return true;
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'again' && state.result) hint = blockedText();
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  const blockedText = () => (solo ? 'Der Computer prüft noch deinen letzten Zug …' : `${names.other()} darf noch „Geschummelt!“ rufen – oder startet die Revanche.`);

  // --- Computer (nur allein) ---
  function think(s) {
    worker ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const id = ++asks;
    const ask = { board: s.board, color: colorOf(s, CPU), level: lvl };
    return new Promise((resolve) => {
      worker.onmessage = (e) => e.data.id === id && resolve(e.data.at);
      worker.onerror = () => resolve(chooseMove(ask.board, ask.color, ask.level)); // Worker lädt nicht: dann eben hier rechnen
      worker.postMessage({ id, ...ask });
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Zug des Menschen einmal prüfen, bevor der Computer selbst etwas tut (bei Spielende auch)
    if (s.free && s.cheat?.player === me && judged !== s.cheat) {
      judged = s.cheat;
      if (cpuAccuses(!s.cheat.legal)) return later(THINK_MS, () => commit(accuse(state, CPU) ?? state));
      if (s.result) return later(THINK_MS, () => commit(waive(state, CPU) ?? state));
    }
    if (s.result || s.turn !== CPU) return;
    later(0, async () => {
      const at = state;
      const [m] = await Promise.all([think(at), new Promise((r) => setTimeout(r, THINK_MS))]);
      if (stopped || state !== at) return;
      if (!at.free) return commit(move(at, CPU, m) ?? at);
      const sly = cpuCheats() ? cheatTurn(at, CPU, m) : null;
      if (sly) return commit(turnOf(at, CPU, sly.at, sly.flips) ?? at);
      commit((m < 0 ? pass(at, CPU) : turnOf(at, CPU, m, flipsFor(at.board, m, colorOf(at, CPU)))) ?? at);
    });
  }

  // Erst wenn die Steine liegen, kurz warten, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // --- Eingaben ---
  const myTurn = () => !!state && !state.result && state.turn === me && !waiting;
  const ready = () => myTurn() && !board.busy();

  // Was ein Klick auf Feld k jetzt täte: { type, arg } oder null. Umdrehen geht auch, während sich noch Steine drehen.
  function intent(k) {
    if (k === null || !myTurn()) return null;
    const s = state;
    if (s.free && s.open) return k === s.open.at ? { type: 'unplace' } : s.board[k] !== null ? { type: 'flip', arg: { at: k } } : null;
    if (!ready()) return null;
    if (!s.free) return s.board[k] === null && flipsFor(s.board, k, colorOf(s, me)).length ? { type: 'move', arg: { at: k } } : null;
    return s.board[k] === null ? { type: 'place', arg: { at: k } } : null;
  }

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function onClick(e) {
    if (!myTurn()) return;
    const k = board.pick(room.rayFrom(e));
    const what = intent(k);
    if (what) return act(what.type, what.arg);
    if (k === null || state.free || !ready()) return;
    say(state.board[k] === null ? 'Dort schließt du nichts ein.' : 'Das Feld ist besetzt.');
  }

  function onMove(e) {
    const k = board.pick(room.rayFrom(e));
    hover = intent(k) ? k : null;
    canvas.style.cursor = hover !== null ? 'pointer' : '';
    marks();
  }

  function onKey(e) {
    if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    if (myTurn() && state.free && state.open) {
      e.preventDefault();
      act('done');
    }
  }

  // Stein vom Turm mit der Hand aufs Feld gestellt (tisch.js) = setzen. Antwort: 'move' (das Spiel setzt ihn),
  // 'back' (zurück auf den Turm) oder null (bleibt liegen)
  board.onPlace = (mesh, point) => {
    const st = board.stoneOf(mesh);
    if (!st || !state) return null;
    const k = board.squareAt(point);
    if (st.cell !== null) return 'back'; // Steine auf dem Brett bleiben, wo sie sind
    if (k === null) return null; // liegt einfach auf dem Tisch
    const what = ready() && state.board[k] === null ? intent(k) : null;
    if (!what || (what.type !== 'move' && what.type !== 'place')) {
      if (ready() && !state.free && state.board[k] === null) say('Dort schließt du nichts ein.');
      return 'back';
    }
    board.prefer(mesh);
    return act(what.type, what.arg) ? 'move' : 'back';
  };

  // Hilfen auf dem Brett: mögliche Züge (nur mit Hilfen), Stein unter der Maus, letzter Stein, Umriss beim Umdrehen
  function marks() {
    const s = state;
    if (!s) return board.setMarks({});
    const flipping = s.free && s.open && hover !== null && hover !== s.open.at;
    board.setMarks({
      moves: !s.free && myTurn() ? legalMoves(s.board, colorOf(s, me)) : [],
      hover,
      ghost: hover !== null && !flipping && s.board[hover] === null ? colorOf(s, me) : null,
      last: s.open ? s.open.at : s.last,
      flip: flipping ? hover : null,
    });
  }

  // --- Anzeige ---
  function render() {
    board.sync(state);
    if (!state) return;
    const s = state;
    board.names(seatLabels(2, { mySeat: me, humans: solo ? [me] : [0, 1], me: names.me(), other: names.other(), cpu: () => `Computer (${LEVELS[lvl].name})` }), s.result ? null : s.turn, me);
    if (!myTurn()) hover = null;
    marks();
    const won = s.result?.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && !!s.cheat && s.cheat.player !== me && !waiting });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict, s), verdict.type === 'caught');
    const wins = score(s);
    const mine = s.free && myTurn();
    panel.render({
      players: [0, 1].map((p) => ({
        name: `${COLOR_NAMES[colorOf(s, p)]} – ${p === me ? 'Du' : solo ? `Computer (${LEVELS[lvl].name})` : names.other()}`,
        color: colorOf(s, p),
        discs: countOf(s, p),
        wins: wins[p],
        strikes: s.strikes?.[p] ?? 0,
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      hint: hint || (mine && s.open ? 'Steine anklicken = umdrehen, dann „Zug beenden“ (Leertaste)' : ''),
      level: lvl,
      log: log.map(describe),
      end: s.result ? endInfo() : null,
      free: !!s.free,
      actions: mine ? { done: !!s.open, pass: !s.open } : null,
    });
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.turn === me) return `Du bist dran (${COLOR_NAMES[colorOf(s, me)]})`;
    return solo ? 'Der Computer überlegt …' : `${names.other()} ist dran …`;
  }

  function describe(s) {
    const parts = [];
    for (const e of s.events) {
      if (e.type === 'start') parts.push(`Partie ${s.round ?? 1}: ${s.starter === me ? 'du fängst' : `${who(s.starter)} fängt`} an (Schwarz).`);
      else if (e.type === 'move' || e.type === 'done') parts.push(`${who(e.by)} setzt auf ${squareName(e.at)}${e.flips.length ? ` und ${verb(e.by, 'drehst', 'dreht')} ${stones(e.flips.length)} um` : ''}.`);
      else if (e.type === 'pass') parts.push(s.free ? `${who(e.by)} setzt aus.` : `${who(e.by)} ${verb(e.by, 'kannst', 'kann')} nicht ziehen und setzt aus.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e, s));
    }
    return parts.join(' ');
  }

  // e = { caught, player (bekommt die Verwarnung), by (hat gerufen), why } · s = Stand danach
  function verdictText(e, s) {
    const out = s.result?.reason === 'schummeln' ? ' Das ist die dritte – Partie verloren.' : '';
    if (e.caught) {
      const back = e.why.startsWith('ausgesetzt') ? `${e.player === me ? 'Du bist' : 'Er ist'} nochmal dran` : 'Der Zug wird zurückgenommen';
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ ' : ''}Erwischt! Du hast geschummelt: ${e.why}. ${back}, dazu eine Verwarnung.${out}`;
      return `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}. ${back}, dazu eine Verwarnung.${out}`;
    }
    if (e.player === me) return `Fehlalarm! Der Zug war in Ordnung – du bekommst eine Verwarnung.${out}`;
    return solo ? `Der Computer ruft „Geschummelt!“ – Fehlalarm, dein Zug war in Ordnung. Er bekommt eine Verwarnung.${out}`
      : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt eine Verwarnung.${out}`;
  }

  function endInfo() {
    const { winner, reason } = state.result;
    const wins = score(state);
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const why = { voll: 'Das Brett ist voll.', zu: 'Keiner kann mehr ziehen.', schummeln: 'Dritte Verwarnung.' }[reason];
    const discs = reason === 'schummeln' ? '' : ` Steine ${countOf(state, me)} : ${countOf(state, CPU)}.`;
    return { title, text: `${why}${discs} Stand: du ${wins[me]} : ${wins[CPU]} ${solo ? 'Computer' : names.other()}` };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ starter: 0, free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => state,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      worker?.terminate();
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
