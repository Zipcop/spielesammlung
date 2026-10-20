// Vier-gewinnt-Partie: verbindet Spielstand (game.js), Rahmen (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Spieler 0 = Host (Rot), 1 = Gast bzw. Computer (Gelb). Der Host hält den Stand, der Gast schickt Wünsche
// (drop, accuse, again), der Host prüft sie und antwortet mit { t: 'state' }.
// Einwerfen: Spalte anklicken – oder einen Stein vom Stapel mit der Hand über den Rahmen halten und loslassen (tisch.js).
// free = „Ohne Hilfen“: jeder Stein geht durch (auch außer der Reihe oder vom Stapel des anderen), der andere kann
// „Geschummelt!“ rufen, bis er selbst einwirft. Allein schummelt der Computer ab und zu und prüft jeden Stein des Menschen
// einmal (schummeln.js).
import { newGame, drop, accuse, waive, again, score, forGuest, used, COLS, ROWS, STONES, COLOR_NAMES } from './game.js';
import { chooseMove, cheatMove, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 450; // so lange „überlegt“ der Computer, nachdem der Stein liegt
const ACCUSE_MS = 700;
const LOG = 3;
const LEVEL_KEY = 'spielesammlung-viergewinnt-stufe';
const ADJ = ['roten', 'gelben'];

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(n) && n >= 0 && n < LEVELS.length && localStorage.getItem(LEVEL_KEY) !== null ? n : 1;
  } catch {
    return 1;
  }
}

export function startVierGewinnt({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (forGuest)
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let log = []; // Stände mit Neuigkeiten (neueste zuerst) – als Text erst beim Zeichnen, dann stimmen auch spätere Namen
  let cheered = false;
  let stopped = false;
  let extra = false; // allein ohne Hilfen: Computer wirft gleich noch einen Stein (zwei hintereinander)
  const judged = new WeakSet(); // allein ohne Hilfen: schon geprüfte Steine des Menschen

  const who = (p) => (p === me ? 'Du' : solo ? 'Computer' : names.other());
  const colNo = (c) => (me === 0 ? c + 1 : COLS - c); // der Gast sieht den Rahmen von hinten

  const panel = createPanel($('vg-panel'), {
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
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Vier gewinnt"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'drop') return drop(state, p, arg?.col, arg?.color ?? p);
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
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) {
        extra = false;
        commit(next);
      } else if (type === 'again') say(blockedText());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, arg });
      render();
    }
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

  const blockedText = () => (solo ? 'Der Computer prüft noch deinen letzten Stein …' : `${names.other()} darf noch „Geschummelt!“ rufen – oder startet die Revanche.`);

  // --- Computer (nur allein) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Stein des Menschen einmal prüfen, bevor der Computer selbst etwas tut
    if (s.free && s.cheat?.player === me && !judged.has(s.cheat)) {
      judged.add(s.cheat);
      if (cpuAccuses(!s.cheat.legal)) return later(ACCUSE_MS, () => commit(accuse(state, other) ?? state));
      if (s.result) return later(ACCUSE_MS, () => commit(waive(state, other) ?? state));
    }
    if (s.result) return;
    if (extra) return later(THINK_MS, () => {
      extra = false;
      commit(drop(state, other, chooseMove(state, other, lvl)) ?? state);
    });
    if (s.turn !== other) return;
    later(THINK_MS, () => {
      const sly = state.free && cpuCheats() ? cheatMove(state, other) : null;
      if (sly?.color === me) return commit(drop(state, other, sly.col, me) ?? drop(state, other, chooseMove(state, other, lvl)));
      const next = drop(state, other, chooseMove(state, other, lvl));
      extra = !!sly?.twice && !next.result;
      commit(next);
    });
  }

  // Erst wenn der Stein liegt, kurz überlegen, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
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
  const running = () => !!state && !state.result && !waiting;
  const myTurn = () => running() && state.turn === me;
  const canDrop = () => running() && (state.free || state.turn === me);

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function tryDrop(col, color = me) {
    if (!running()) return false;
    if (!state.free && state.turn !== me) return say(`${who(state.turn)} ist dran.`);
    if (state.board[col].length >= ROWS) return say('Die Spalte ist voll.');
    if (!state.free && color !== me) return say(`Nimm einen ${ADJ[me]} Stein – von deinem Stapel.`);
    if (used(state, color) >= STONES) return say(`Keine ${ADJ[color]} Steine mehr.`);
    act('drop', { col, color });
    return true;
  }

  // Stein mit der Hand über dem Rahmen abgestellt (tisch.js) = einwerfen. point liegt auf dem Rahmen oder – zeigt die Maus
  // durch ein Loch oder über den Rahmen – auf der Tischebene dahinter; die Spalte ergibt sich aus der Blickrichtung dorthin.
  board.onPlace = (mesh, point) => {
    const st = board.stoneOf(mesh);
    if (!st || st.inFrame || !running()) return st ? 'back' : null;
    const at = room.toScreen(point);
    const col = at ? board.pickColumn(room.rayFrom({ clientX: at.x, clientY: at.y })) : null;
    if (col === null) return null; // liegt einfach auf dem Tisch
    board.prefer(mesh);
    return tryDrop(col, st.color) ? 'move' : 'back';
  };

  const onMove = (e) => {
    const col = canDrop() && !board.busy() ? board.pickColumn(room.rayFrom(e)) : null;
    const usable = col !== null && state.board[col].length < ROWS;
    board.setGhost(usable ? col : null, me);
    canvas.style.cursor = usable ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!canDrop() || board.busy()) return;
    const col = board.pickColumn(room.rayFrom(e));
    if (col !== null) tryDrop(col);
  };

  // --- Anzeige ---
  function render() {
    board.sync(state);
    if (!state) return;
    const s = state;
    if (!canDrop()) board.setGhost(null);
    const won = s.result?.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && !!s.cheat && s.cheat.player !== me && !waiting });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict, s), verdict.type === 'caught');
    const wins = score(s);
    panel.render({
      players: [0, 1].map((p) => ({
        name: `${COLOR_NAMES[p]} – ${p === me ? 'Du' : solo ? `Computer (${LEVELS[lvl].name})` : names.other()}`,
        wins: wins[p],
        strikes: s.strikes?.[p] ?? 0,
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      hint,
      level: lvl,
      log: log.map(describe),
      end: s.result ? endInfo() : null,
      free: !!s.free,
    });
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.turn === me) return `Du bist dran (${COLOR_NAMES[me]})`;
    return solo ? 'Der Computer überlegt …' : `${names.other()} ist dran …`;
  }

  function describe(s) {
    const parts = [];
    for (const e of s.events) {
      if (e.type === 'start') parts.push(`Partie ${s.round ?? 1}: ${s.starter === me ? 'du fängst' : `${who(s.starter)} fängt`} an.`);
      else if (e.type === 'drop') parts.push(`${who(e.by)} ${e.by === me ? 'wirfst' : 'wirft'} ${e.color === e.by ? '' : `einen ${ADJ[e.color]} Stein `}in Spalte ${colNo(e.col)}.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e, s));
    }
    if (s.result?.reason === 'vier') parts.push(s.result.winner === me ? 'Vier in einer Reihe!' : `${who(s.result.winner)} hat vier in einer Reihe.`);
    return parts.join(' ');
  }

  // e = { caught, player (bekommt die Verwarnung), by (hat gerufen), why, stones } · s = Stand danach
  function verdictText(e, s) {
    const back = e.stones > 1 ? `Die ${e.stones} Steine kommen` : 'Der Stein kommt';
    const out = s.result?.reason === 'schummeln' ? ' Das ist die dritte – Partie verloren.' : '';
    if (e.caught) {
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ ' : ''}Erwischt! Du hast geschummelt: ${e.why}. ${back} wieder raus, dazu eine Verwarnung.${out}`;
      return `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}. ${back} wieder raus, dazu eine Verwarnung.${out}`;
    }
    if (e.player === me) return `Fehlalarm! Der Stein war in Ordnung – du bekommst eine Verwarnung.${out}`;
    return solo ? `Der Computer ruft „Geschummelt!“ – Fehlalarm, dein Stein war in Ordnung. Er bekommt eine Verwarnung.${out}`
      : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt eine Verwarnung.${out}`;
  }

  function endInfo() {
    const { winner, reason } = state.result;
    const wins = score(state);
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const why = { vier: 'Vier in einer Reihe.', voll: 'Das Brett ist voll.', steine: 'Die Steine sind alle.', schummeln: 'Dritte Verwarnung.' }[reason];
    return { title, text: `${why} Stand: du ${wins[me]} : ${wins[other]} ${solo ? 'Computer' : names.other()}` };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
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
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
