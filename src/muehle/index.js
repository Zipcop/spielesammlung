// Mühle-Partie: verbindet Spielstand (game.js), Brett (board.js), Seitenfeld (panel.js), Computer (ai.js im Worker) und Netz.
// Spieler 0 = Host (+z), 1 = Gast gegenüber bzw. allein der Computer. Der Host hält den Stand und schickt ihn dem Gast
// (forGuest); der Gast schickt Wünsche (place, move, take, pass, accuse, again), der Host prüft sie.
// free = „Ohne Hilfen“: nichts leuchtet, jeder Zug geht durch, nach jedem Zug „Stein nehmen“ oder „Zug beenden“.
// Allein schummelt der Computer ab und zu (cheatTurn) und prüft jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, place, move, take, pass, accuse, waive, again, forGuest, targets, takeTargets, movable, phaseOf, countOf,
  REASONS, MAX_STRIKES,
} from './game.js';
import { chooseTurn, cheatTurn } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 650; // so lange „überlegt“ der Computer mindestens
const LOG = 4;
const LEVEL_KEY = 'muehle-stufe';

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return [0, 1, 2].includes(n) && localStorage.getItem(LEVEL_KEY) !== null ? n : 1;
  } catch {
    return 1;
  }
}

export function startMuehle({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const CPU = 1;
  let state = null;
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let timer = null;
  let stopped = false;
  let selected = null; // gewählter eigener Stein (Punkt)
  let cheered = false;
  let log = [];
  let judged = null; // allein ohne Hilfen: Zug des Menschen, den der Computer schon geprüft hat
  let pending = null; // allein: Zug des Computers, dessen Schlagen noch aussteht
  let cpuLevel = loadLevel();
  let worker = null;
  let asks = 0;
  let games = 0; // zählt die Partien (seq beginnt bei der Revanche wieder bei 0 – sonst fehlte eine Meldung)

  const nameOf = (p) => (p === me ? 'Du' : solo ? 'Der Computer' : names.other());
  const verb = (p, du, er) => `${nameOf(p)} ${p === me ? du : er}`;

  const panel = createPanel($('mu-panel'), {
    solo,
    level: cpuLevel,
    onPass: () => act('pass'),
    onAgain: () => act('again'),
    onLevel: (n) => {
      cpuLevel = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch { /* privates Fenster: Stufe gilt nur bis zum Neuladen */ }
    },
    onLeave: (confirm) => (confirm && state && !state.result ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Mühle"] [data-hint]') });

  function apply(type, p, arg) {
    const a = arg ?? {};
    if (type === 'place') return place(state, p, a.to);
    if (type === 'move') return move(state, p, a.from, a.to);
    if (type === 'take') return take(state, p, a.at);
    if (type === 'pass') return pass(state, p);
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
      pending = null;
    }
    const fresh = next.seq !== state?.seq || next.events?.[0]?.type === 'start';
    state = next;
    selected = null;
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
      worker.onmessage = (e) => e.data.id === id && resolve(e.data.turn);
      worker.onerror = () => resolve(chooseTurn(s, CPU, { level: cpuLevel })); // Worker lädt nicht: dann eben hier rechnen
      worker.postMessage({ id, state: { board: s.board, hand: s.hand, positions: s.positions }, player: CPU, level: cpuLevel });
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
    if (s.step === 'take') {
      return later(THINK_MS / 2, () => {
        const t = pending?.take ?? -1;
        pending = null;
        const fallback = takeTargets(state, CPU)[0];
        commit((t >= 0 ? take(state, CPU, t) : null) ?? (state.free ? pass(state, CPU) : take(state, CPU, fallback)));
      });
    }
    if (open) {
      judged = s.cheat;
      if (cpuAccuses(s.cheat.why.length > 0)) return later(THINK_MS, () => commit(accuse(state, CPU)));
    }
    later(0, async () => {
      const at = state;
      const [turn] = await Promise.all([think(at), new Promise((r) => setTimeout(r, THINK_MS))]);
      if (stopped || state !== at || !turn) return;
      const sly = at.free && cpuCheats() ? cheatTurn(at, CPU, turn) : null;
      pending = sly ?? turn;
      commit(pending.from < 0 ? place(at, CPU, pending.to) : move(at, CPU, pending.from, pending.to));
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
  const canPass = () => ready() && state.free && state.step === 'take';

  // Was ein Klick auf Punkt k jetzt täte: { type, arg } oder 'select' oder null
  function intent(k) {
    if (k === null || !ready()) return null;
    const s = state;
    const at = s.board[k];
    if (s.step === 'take') {
      if (at !== 1 - me) return null;
      return s.free || takeTargets(s, me).includes(k) ? { type: 'take', arg: { at: k } } : null;
    }
    if (at === me) {
      if (s.free) return 'select';
      return movable(s, me).includes(k) ? 'select' : null;
    }
    if (at !== null) return null;
    if (selected !== null) return s.free || targets(s, me, selected).includes(k) ? { type: 'move', arg: { from: selected, to: k } } : null;
    return s.hand[me] > 0 ? { type: 'place', arg: { to: k } } : null;
  }

  function onClick(e) {
    const k = board.pickPoint(room.rayFrom(e));
    const what = intent(k);
    if (what === 'select') {
      selected = selected === k ? null : k;
      return render(k);
    }
    if (what) act(what.type, what.arg);
    else if (selected !== null && k === null) {
      selected = null;
      render();
    }
  }

  function onMove(e) {
    const k = board.pickPoint(room.rayFrom(e));
    const what = intent(k);
    canvas.style.cursor = what ? 'pointer' : '';
    marks(what ? k : null);
  }

  function onKey(e) {
    if (e.key === 'Escape' && selected !== null) {
      selected = null;
      return render();
    }
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && canPass()) {
      e.preventDefault();
      act('pass');
    }
  }

  // Stein mit der Hand abgestellt (tisch.js): setzen, ziehen oder – beim Schlagen – fremden Stein neben das Brett.
  // Antwort: 'move' (Spiel zieht), 'back' (Stein fliegt zurück) oder null (bleibt liegen)
  board.onPlace = (mesh, point) => {
    const st = board.stoneOf(mesh);
    if (!st || !state) return null;
    const { point: k, onBoard } = board.pointAt(point);
    const off = onBoard ? 'back' : null;
    if (!ready()) return off;
    if (state.step === 'take') {
      if (st.player === me || st.kind !== 'pt' || onBoard) return off;
      const what = intent(st.point);
      return what && act(what.type, what.arg) ? 'move' : 'back';
    }
    if (st.player !== me || !onBoard) return off;
    if (k === null || state.board[k] !== null) return 'back';
    let what = null;
    if (st.kind === 'hand') {
      selected = null; // ein gewählter Brettstein würde sonst aus dem Setzen ein Ziehen machen
      what = intent(k);
    }
    else if (st.kind === 'pt') {
      selected = st.point;
      what = intent(k);
    }
    if (!what || what === 'select' || (st.kind === 'hand' && what.type !== 'place') || (st.kind === 'pt' && what.type !== 'move')) {
      selected = null;
      return 'back';
    }
    board.prefer(mesh); // genau dieser Stein soll ziehen (nicht ein anderer aus der Hand)
    return act(what.type, what.arg) ? 'move' : 'back';
  };

  // --- Anzeige ---
  function marks(hover = null) {
    if (!state) return;
    const help = !state.free && ready();
    board.setMarks({
      targets: help && state.step === 'move' && selected !== null ? targets(state, me, selected) : [],
      takes: help && state.step === 'take' ? takeTargets(state, me) : [],
      selected,
      hover,
    });
  }

  function render(hover = null) {
    board.sync(state);
    if (!state) return;
    const s = state;
    board.names(seatLabels(2, { mySeat: me, humans: solo ? [me] : [0, 1], me: names.me(), other: names.other(), cpu: nameOf }), s.result ? null : s.turn, me);
    marks(hover);
    const canAccuse = s.free && !!s.cheat && s.cheat.player !== me && (s.result || (s.turn === me && s.step === 'move')) && !waiting;
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
        hand: s.hand[p],
        board: countOf(s.board, p),
        strikes: s.strikes[p],
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      free: s.free,
      canPass: canPass(),
      log,
      end: s.result ? endInfo() : null,
    });
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.turn !== me) return solo ? 'Der Computer überlegt …' : `${nameOf(s.turn)} ist dran …`;
    if (s.step === 'take') return s.free ? 'Stein des anderen nehmen – oder „Zug beenden“' : 'Mühle! Nimm einen Stein des anderen';
    const phase = phaseOf(s, me);
    if (selected !== null) return s.free ? 'Wohin? Freien Punkt anklicken (Esc = abwählen)' : 'Wohin? Leuchtenden Punkt anklicken (Esc = abwählen)';
    if (phase === 'place') return `Setz einen Stein – noch ${s.hand[me]} in der Hand`;
    if (s.free) return 'Eigenen Stein anklicken, dann einen freien Punkt';
    return phase === 'fly' ? 'Nur noch 3 Steine – du darfst springen' : 'Zieh einen Stein auf einen freien Nachbarpunkt';
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
      else if (e.type === 'place') parts.push(`${verb(e.player, 'setzt', 'setzt')} einen Stein.`);
      else if (e.type === 'move') parts.push(`${verb(e.player, e.jump && !state.free ? 'springst' : 'ziehst', e.jump && !state.free ? 'springt' : 'zieht')}.`);
      else if (e.type === 'mill' && !state.free) parts.push('Mühle!'); // ohne Hilfen muss man sie selbst sehen
      else if (e.type === 'take') parts.push(`${verb(e.player, 'nimmst', 'nimmt')} einen Stein.`);
      else if (e.type === 'over') parts.push(`${e.winner === null ? 'Remis' : e.winner === me ? 'Du gewinnst' : `${nameOf(e.winner)} gewinnt`}: ${REASONS[e.reason]}.`);
      else if (e.type === 'caught') parts.push(`„Geschummelt!“ – ${e.player === me ? 'du bist' : `${nameOf(e.player)} ist`} erwischt${e.why ? ` (${e.why})` : ''}.`);
      else if (e.type === 'fehlalarm') parts.push(`${verb(e.player, 'rufst', 'ruft')} „Geschummelt!“ – Fehlalarm.`);
    }
    return parts.join(' ');
  }

  function endInfo() {
    const r = state.result;
    const title = r.winner === null ? 'Remis' : r.winner === me ? 'Gewonnen!' : solo ? 'Der Computer gewinnt' : `${nameOf(r.winner)} gewinnt`;
    const loser = r.winner === null ? null : 1 - r.winner;
    const text = r.reason === 'steine' ? `${verb(loser, 'hast', 'hat')} nur noch zwei Steine.`
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
