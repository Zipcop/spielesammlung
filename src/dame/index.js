// Dame-Partie: verbindet Spielstand (game.js), Brett (board.js), Seitenfeld (panel.js), Computer (ai.js im Worker) und Netz.
// Spieler 0 = Host (+z), 1 = Gast gegenüber bzw. allein der Computer. Der Host hält den Stand und schickt ihn dem Gast
// (forGuest); der Gast schickt Wünsche (play, accuse, again), der Host prüft sie.
// Ein Zug entsteht Schritt für Schritt: Stein wählen, Feld anklicken – bei einem Schlag springt der Stein erst hier am PC
// (Vorschau, route) und wartet auf den nächsten Sprung; fertig geht der ganze Weg auf einmal an den Host.
// free = „Ohne Hilfen“: nichts leuchtet, jeder schräge Zug geht durch, nach einem Sprung oder auf der letzten Reihe
// entscheidest du selbst: weiterspringen, „Zur Dame machen“ oder „Zug beenden“.
// Allein schummelt der Computer ab und zu (cheatMove) und prüft jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, play, accuse, waive, again, forGuest, inspect, movable, mustJump, continuations, lastRow, REASONS, MAX_STRIKES,
} from './game.js';
import { chooseMove, cheatMove } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 650; // so lange „überlegt“ der Computer mindestens
const LOG = 4;
const LEVEL_KEY = 'dame-stufe';

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return [0, 1, 2].includes(n) && localStorage.getItem(LEVEL_KEY) !== null ? n : 1;
  } catch {
    return 1;
  }
}

export function startDame({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const CPU = 1;
  let state = null;
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let timer = null;
  let stopped = false;
  let route = null; // angefangener eigener Zug: [Stein, Landefeld, …]
  let cheered = false;
  let log = [];
  let judged = null; // allein ohne Hilfen: Zug des Menschen, den der Computer schon geprüft hat
  let cpuLevel = loadLevel();
  let worker = null;
  let asks = 0;
  let games = 0; // zählt die Partien (seq beginnt bei der Revanche wieder bei 0 – sonst fehlte eine Meldung)

  const nameOf = (p) => (p === me ? 'Du' : solo ? 'Der Computer' : names.other());
  const verb = (p, du, er) => `${nameOf(p)} ${p === me ? du : er}`;

  const panel = createPanel($('da-panel'), {
    solo,
    level: cpuLevel,
    onCrown: () => finish(true),
    onEnd: () => finish(false),
    onAgain: () => act('again'),
    onLevel: (n) => {
      cpuLevel = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch { /* privates Fenster: Stufe gilt nur bis zum Neuladen */ }
    },
    onLeave: (confirm) => (confirm && state && !state.result ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Dame"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'play') return arg && Array.isArray(arg.path) ? play(state, p, { path: arg.path, crown: arg.crown === true }) : null;
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return rematchBlocked(state, p) ? null : again(state);
    return null;
  }

  function setState(next) {
    if (next.events?.[0]?.type === 'start') {
      games++;
      log = [];
      cheered = false;
      judged = null;
    }
    const fresh = next.seq !== state?.seq || next.events?.[0]?.type === 'start';
    state = next;
    route = null;
    if (fresh) {
      const text = describe(next.events);
      if (text) log = [text, ...log].slice(0, LOG);
    }
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
      if (!next) return false;
      commit(next);
      return true;
    }
    waiting = true;
    route = type === 'play' ? arg.path : null; // der Zug bleibt sichtbar, bis der Host antwortet
    send({ t: type, arg });
    render();
    return true;
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      waiting = false;
      setState(msg.state);
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Computer (nur allein, beim Host) ---
  function think(s) {
    worker ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const id = ++asks;
    return new Promise((resolve) => {
      worker.onmessage = (e) => e.data.id === id && resolve(e.data.move);
      worker.onerror = () => resolve(chooseMove(s, CPU, { level: cpuLevel })); // Worker lädt nicht: dann eben hier rechnen
      worker.postMessage({ id, state: { board: s.board, positions: s.positions }, player: CPU, level: cpuLevel });
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !solo || !state) return;
    const s = state;
    // Hat der Mensch zuletzt gezogen, prüft der Computer das einmal (bei Spielende auch)
    const open = s.free && s.cheat && s.cheat.player === me && judged !== s.cheat;
    if (s.result) {
      if (open) later(THINK_MS, () => {
        judged = state.cheat;
        commit((cpuAccuses(state.cheat.why.length > 0) ? accuse(state, CPU) : null) ?? waive(state, CPU));
      });
      return;
    }
    if (s.turn !== CPU) return;
    if (open) {
      judged = s.cheat;
      if (cpuAccuses(s.cheat.why.length > 0)) return later(THINK_MS, () => commit(accuse(state, CPU)));
    }
    later(0, async () => {
      const at = state;
      const [move] = await Promise.all([think(at), new Promise((r) => setTimeout(r, THINK_MS))]);
      if (stopped || state !== at || !move) return;
      const m = (at.free && cpuCheats() ? cheatMove(at, CPU) : null) ?? move;
      const next = play(at, CPU, { path: m.path, crown: m.crown });
      if (next) commit(next);
    });
  }

  // Erst wenn die Steine liegen, kurz warten, dann handeln (solange ändert niemand etwas am Stand)
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
  const jumped = () => !!route && route.length > 1; // Stein ist schon gesprungen und wartet (Vorschau)
  const canEnd = () => ready() && state.free && jumped();
  const canCrown = () => canEnd() && state.board[route[0]] < 2;
  const tookSoFar = () => (jumped() ? inspect(state.board, me, route, false)?.took.length ?? 0 : 0);

  // Was ein Klick auf Feld k jetzt täte: 'select', { type: 'play', arg } (Zug fertig), { type: 'route', path } oder null
  function intent(k) {
    if (k === null || !ready()) return null;
    const s = state;
    const at = s.board[k];
    if (!jumped()) {
      if (at !== null && (at & 1) === me) return s.free || movable(s, me).includes(k) ? 'select' : null;
      return route && at === null ? step(k) : null;
    }
    return at === null || k === route[0] ? step(k) : null; // das Startfeld ist während des Zugs frei
  }

  function step(k) {
    const path = [...route, k];
    if (!state.free) {
      const next = continuations(state, me, path);
      if (!next.length) return null;
      return next.some((m) => m.path.length === path.length) ? { type: 'play', arg: { path } } : { type: 'route', path };
    }
    const c = inspect(state.board, me, path, false);
    if (!c) return null;
    const took = c.took.length > tookSoFar();
    const crownRow = !c.king && k >> 3 === lastRow(me);
    if (took || crownRow) return { type: 'route', path }; // selbst entscheiden: weiter, Dame oder Zug beenden
    return { type: 'play', arg: { path, crown: false } };
  }

  function run(what, k) {
    if (what === 'select') {
      route = route?.[0] === k ? null : [k];
      render(k);
      return true;
    }
    if (what?.type === 'route') {
      route = what.path;
      render();
      return true;
    }
    if (what?.type === 'play') return act('play', what.arg);
    return false;
  }

  // Ohne Hilfen: angefangenen Zug abschließen (crown = zur Dame machen)
  function finish(crown) {
    if (!canEnd() || (crown && !canCrown())) return;
    act('play', { path: route, crown });
  }

  function onClick(e) {
    const k = board.pickSquare(room.rayFrom(e));
    const what = intent(k);
    if (what) run(what, k);
    else if (route?.length === 1 && (k === null || state.board[k] === null)) {
      route = null; // ins Leere geklickt: abwählen (ein angefangener Sprung bleibt)
      render();
    }
  }

  function onMove(e) {
    const k = board.pickSquare(room.rayFrom(e));
    const what = intent(k);
    canvas.style.cursor = what ? 'pointer' : '';
    marks(what ? k : null);
  }

  function onKey(e) {
    if (e.key === 'Escape' && route) {
      route = null;
      return render();
    }
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && canEnd()) {
      e.preventDefault();
      finish(false);
    }
  }

  // Stein mit der Hand abgestellt (tisch.js): eigenen Stein auf ein Feld = Schritt des Zugs.
  // Antwort: 'move' (Spiel zieht), 'back' (Stein fliegt zurück) oder null (bleibt liegen)
  board.onPlace = (mesh, point) => {
    const st = board.stoneOf(mesh);
    if (!st || !state) return null;
    const { square: k, onBoard } = board.squareAt(point);
    const off = onBoard ? 'back' : null;
    if (!ready() || st.kind !== 'sq' || st.player !== me) return off;
    if (!onBoard) return null;
    if (k === null) return 'back'; // auf dem Rahmen abgestellt
    if (jumped() ? st.square !== route[route.length - 1] : intent(st.square) !== 'select') return 'back';
    const before = route;
    if (!jumped()) route = [st.square];
    const what = intent(k);
    if (!what || what === 'select' || !run(what, k)) {
      route = before;
      render();
      return 'back';
    }
    return 'move';
  };

  // --- Anzeige ---
  // Vorschau: der Stein steht schon auf dem letzten Landefeld, die übersprungenen liegen noch (rot umrandet)
  function preview() {
    if (!jumped()) return { board: state.board, took: [] };
    const c = inspect(state.board, me, route, false);
    if (!c) return { board: state.board, took: [] };
    const b = state.board.slice();
    b[c.to] = b[route[0]];
    if (c.to !== route[0]) b[route[0]] = null;
    return { board: b, took: c.took };
  }

  function marks(hover = null) {
    if (!state) return;
    const help = !state.free && ready();
    const { took } = preview();
    const next = help && route ? continuations(state, me, route).map((m) => m.path[route.length]) : [];
    board.setMarks({
      targets: next,
      force: help && !route && mustJump(state, me) ? movable(state, me) : [],
      took: ready() ? took : [],
      selected: route && ready() ? route[route.length - 1] : null,
      hover,
    });
  }

  function render(hover = null) {
    if (!state) return;
    board.sync(state, preview().board);
    const s = state;
    marks(hover);
    const canAccuse = s.free && !!s.cheat && s.cheat.player !== me && (s.result || s.turn === me) && !jumped() && !waiting;
    cheat.update({ free: s.free, canAccuse });
    if (s.verdict) cheat.say(`${games}:${s.seq}`, verdictText(s.verdict), s.verdict.caught);
    const won = s.result?.winner === me;
    if (won && !cheered) room.celebrate?.(me);
    cheered = won;
    const order = [me, 1 - me];
    panel.render({
      players: order.map((p) => ({
        name: `${nameOf(p)}${p === s.white ? ' · Weiß' : ' · Schwarz'}`,
        light: p === s.white,
        men: s.board.filter((x) => x === p).length,
        kings: s.board.filter((x) => x === p + 2).length,
        strikes: s.strikes[p],
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      free: s.free,
      canCrown: canCrown(),
      canEnd: canEnd(),
      log,
      end: s.result ? endInfo() : null,
    });
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.turn !== me) return solo ? 'Der Computer überlegt …' : `${nameOf(s.turn)} ist dran …`;
    if (jumped()) {
      if (!s.free) return 'Weiter schlagen: leuchtendes Feld anklicken';
      return s.board[route[0]] < 2 && route[route.length - 1] >> 3 === lastRow(me) ? 'Letzte Reihe: „Zur Dame machen“ – oder „Zug beenden“'
        : 'Weiterspringen – oder „Zug beenden“ (Leertaste)';
    }
    if (route) return s.free ? 'Wohin? Feld anklicken (Esc = abwählen)' : 'Wohin? Leuchtendes Feld anklicken (Esc = abwählen)';
    if (s.free) return 'Eigenen Stein anklicken, dann ein Feld';
    return mustJump(s, me) ? 'Schlagzwang! Einen leuchtenden Stein anklicken' : 'Zieh einen Stein schräg nach vorn';
  }

  function verdictText(v) {
    const strike = (p) => (p === me ? 'du bekommst eine Verwarnung' : `${solo ? 'der Computer' : nameOf(p)} bekommt eine Verwarnung`);
    const lost = state.result?.reason === 'schummeln' ? ` Das war die ${MAX_STRIKES}. – Partie verloren.` : '';
    const why = v.why ? `: ${v.why}` : '';
    if (v.caught) {
      return v.player === me ? `${nameOf(v.by)} ruft „Geschummelt!“ – erwischt! Du hast geschummelt${why}. Dein Zug wird zurückgenommen, du bekommst eine Verwarnung.${lost}`
        : `Erwischt! ${nameOf(v.player)} hat geschummelt${why} – der Zug wird zurückgenommen, ${strike(v.player)}.${lost}`;
    }
    return v.player === me ? `Fehlalarm! Der Zug war erlaubt – du bekommst eine Verwarnung.${lost}`
      : `${nameOf(v.player)} ruft „Geschummelt!“ – Fehlalarm, dein Zug war erlaubt. ${strike(v.player)[0].toUpperCase()}${strike(v.player).slice(1)}.${lost}`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events ?? []) {
      if (e.type === 'start') parts.push(`Neue Partie – ${verb(e.player, 'hast', 'hat')} Weiß und ${e.player === me ? 'fängst' : 'fängt'} an.`);
      else if (e.type === 'move') {
        parts.push(e.took ? `${verb(e.player, 'schlägst', 'schlägt')} ${e.took === 1 ? 'einen Stein' : `${e.took} Steine`}.` : `${verb(e.player, 'ziehst', 'zieht')}.`);
        if (e.crown) parts.push('Dame!');
      } else if (e.type === 'over') parts.push(`${e.winner === null ? 'Remis' : e.winner === me ? 'Du gewinnst' : `${nameOf(e.winner)} gewinnt`}: ${REASONS[e.reason]}.`);
      else if (e.type === 'caught') parts.push(`„Geschummelt!“ – ${e.player === me ? 'du bist' : `${nameOf(e.player)} ist`} erwischt${e.why ? ` (${e.why})` : ''}.`);
      else if (e.type === 'fehlalarm') parts.push(`${verb(e.player, 'rufst', 'ruft')} „Geschummelt!“ – Fehlalarm.`);
    }
    return parts.join(' ');
  }

  function endInfo() {
    const r = state.result;
    const title = r.winner === null ? 'Remis' : r.winner === me ? 'Gewonnen!' : solo ? 'Der Computer gewinnt' : `${nameOf(r.winner)} gewinnt`;
    const loser = r.winner === null ? null : 1 - r.winner;
    const text = r.reason === 'steine' ? `${verb(loser, 'hast', 'hat')} keine Steine mehr.`
      : r.reason === 'blockiert' ? `${verb(loser, 'kannst', 'kann')} nicht mehr ziehen.`
        : r.reason === 'schummeln' ? `${verb(loser, 'hast', 'hat')} die dritte Verwarnung bekommen.`
          : `${REASONS[r.reason]}.`;
    return { title, text };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  let wasBusy = false;
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    const busy = board.busy();
    if (busy !== wasBusy) render(); // Knöpfe und Ringe erst, wenn alles liegt
    wasBusy = busy;
  });

  if (isHost) commit(resume ?? newGame({ white: Math.random() < 0.5 ? 0 : 1, free }));

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
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
