// Kalaha-Partie: verbindet Spielstand (game.js), Brett (board.js), Seitenfeld (panel.js), Computer (ai.js im Worker) und Netz.
// Spieler 0 = Host (+z), 1 = Gast gegenüber bzw. allein der Computer. Der Host hält den Stand, der Gast schickt Wünsche
// (move bzw. ohne Hilfen take, drop, untake, capture, shift, done – dazu seeds, accuse, again), der Host prüft sie und
// antwortet mit { t: 'state' }. Ziehen: eigene Mulde anklicken – oder eine Kugel daraus mit der Hand in eine andere
// Mulde legen (tisch.js). free = „Ohne Hilfen“: gesät wird selbst, Stein für Stein, dann „Zug beenden“.
// Allein schummelt der Computer ab und zu (cheatTurn) und prüft jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, setSeeds, move, take, untake, drop, capture, shift, done, turnOf, planOf, accuse, waive, again, score, forGuest,
  legalMoves, pitsOf, isStore, holeNo, STORE, SEEDS, DEFAULT_SEEDS,
} from './game.js';
import { chooseMove, cheatTurn, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 600; // so lange „überlegt“ der Computer mindestens
const LOG = 4;
const LEVEL_KEY = 'spielesammlung-kalaha-stufe';
const SEEDS_KEY = 'spielesammlung-kalaha-steine';
const HAND = 14;

function loadNumber(key, ok, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const n = Number(raw);
    return raw !== null && ok(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function store(key, n) {
  try {
    localStorage.setItem(key, String(n));
  } catch {
    // ohne Speicher gilt die Wahl eben nur bis zum Neuladen
  }
}

export function startKalaha({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const CPU = 1 - me;
  let lvl = loadNumber(LEVEL_KEY, (n) => Number.isInteger(n) && n >= 0 && n < LEVELS.length, 1);
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
  const whose = (p) => (p === me ? 'deiner' : 'der');

  const panel = createPanel($('ka-panel'), {
    solo,
    onLevel: (n) => {
      lvl = n;
      store(LEVEL_KEY, n);
      render();
    },
    onSeeds: (n) => {
      store(SEEDS_KEY, n);
      act('seeds', { n });
    },
    onCapture: () => state?.open && act('capture', { at: state.open.drops.at(-1) }),
    onDone: () => act('done'),
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Kalaha"] .dock [data-hint]') });

  function apply(type, p, arg) {
    const s = state;
    if (type === 'move') return move(s, p, arg?.pit);
    if (type === 'take') return take(s, p, arg?.pit);
    if (type === 'untake') return untake(s, p);
    if (type === 'drop') return drop(s, p, arg?.at);
    if (type === 'takedrop') { // Kugel aus der eigenen Mulde mit der Hand woandershin gelegt: leeren + ablegen
      const t = take(s, p, arg?.pit);
      const d = t && drop(t, p, arg?.at);
      return d && { ...d, seq: s.seq + 1, events: [...t.events, ...d.events] };
    }
    if (type === 'capture') return capture(s, p, arg?.at);
    if (type === 'shift') return shift(s, p, arg?.from, arg?.to);
    if (type === 'done') return done(s, p);
    if (type === 'seeds') return setSeeds(s, p, arg?.n);
    if (type === 'accuse') return accuse(s, p);
    if (type === 'again') return again(s, p);
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
      else if (type === 'seeds') render(); // Auswahl zurückstellen
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
    const q = { pits: s.pits, player: CPU, level: lvl };
    return new Promise((resolve) => {
      worker.onmessage = (e) => e.data.id === id && resolve(e.data.at);
      worker.onerror = () => resolve(chooseMove(q.pits, q.player, q.level)); // Worker lädt nicht: dann eben hier rechnen
      worker.postMessage({ id, ...q });
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Zug des Menschen einmal prüfen, bevor der Computer selbst etwas tut (bei Spielende auch)
    if (s.free && !s.open && s.cheat?.player === me && judged !== s.cheat) {
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
      commit(turnOf(at, CPU, sly ?? planOf(at.pits, CPU, m)) ?? at);
    });
  }

  // Erst wenn die Kugeln liegen, kurz warten, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
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

  // Was ein Klick auf Mulde k jetzt täte: { type, arg } oder null. Ablegen geht auch, während noch Kugeln fliegen.
  function intent(k) {
    if (k === null || k === HAND || !myTurn()) return null;
    const s = state;
    const o = s.open;
    if (s.free && o) {
      if (k === o.from && !o.drops.length && !o.shifts.length && !o.captures.length) return { type: 'untake' };
      return o.hand ? { type: 'drop', arg: { at: k } } : null;
    }
    if (!ready() || !pitsOf(me).includes(k) || !s.pits[k]) return null;
    return { type: s.free ? 'take' : 'move', arg: { pit: k } };
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
    if (k === null || k === HAND || state.free || !ready()) return;
    say(isStore(k) ? 'Ein Kalaha leert man nicht – wähl eine deiner Mulden.' : !pitsOf(me).includes(k) ? 'Das ist eine Mulde des anderen – deine liegen vor dir.' : 'Die Mulde ist leer.');
  }

  function onMove(e) {
    const k = board.pick(room.rayFrom(e));
    hover = intent(k) ? k : null;
    canvas.style.cursor = hover !== null ? 'pointer' : '';
    marks();
  }

  function onKey(e) {
    if (e.code !== 'Space' || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    if (myTurn() && state.free && state.open && !state.open.hand) {
      e.preventDefault();
      act('done');
    }
  }

  // Kugel mit der Hand in eine Mulde gelegt (tisch.js). Antwort: 'move' (das Spiel bewegt sie), 'back' (zurück an
  // ihren Platz) oder null (bleibt liegen)
  board.onPlace = (mesh, point) => {
    const st = board.stoneOf(mesh);
    if (!st || !state || st.pit === null) return null;
    const k = board.pitAt(point);
    if (k === null) return null; // liegt einfach auf dem Tisch
    if (k === st.pit || !myTurn()) return 'back';
    const s = state;
    const o = s.open;
    let what = null;
    if (!s.free) what = ready() && pitsOf(me).includes(st.pit) ? { type: 'move', arg: { pit: st.pit } } : null;
    else if (!o) what = ready() && pitsOf(me).includes(st.pit) ? { type: 'takedrop', arg: { pit: st.pit, at: k } } : null;
    else if (st.pit === HAND) what = o.hand ? { type: 'drop', arg: { at: k } } : null;
    else what = { type: 'shift', arg: { from: st.pit, to: k } };
    if (!what) {
      if (ready() && !pitsOf(me).includes(st.pit)) say('Nimm eine Kugel aus einer deiner Mulden.');
      return 'back';
    }
    board.prefer(mesh);
    return act(what.type, what.arg) ? 'move' : 'back';
  };

  // Hilfen auf dem Brett: mögliche Züge (nur mit Hilfen), Mulde unter der Maus, Mulde der letzten Kugel
  function marks() {
    const s = state;
    if (!s) return board.setMarks({});
    board.setMarks({
      legal: !s.free && myTurn() ? legalMoves(s.pits, me) : [],
      hover,
      last: s.last,
    });
  }

  // --- Anzeige ---
  function render() {
    board.sync(state);
    if (!state) return;
    const s = state;
    if (!myTurn()) hover = null;
    marks();
    const won = s.result?.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && !!s.cheat && s.cheat.player !== me && !waiting });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict, s), verdict.type === 'caught');
    const wins = score(s);
    const o = s.free && myTurn() ? s.open : null;
    panel.render({
      players: [0, 1].map((p) => ({
        name: p === me ? 'Du' : solo ? `Computer (${LEVELS[lvl].name})` : names.other(),
        store: s.pits[STORE[p]],
        wins: wins[p],
        strikes: s.strikes?.[p] ?? 0,
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      hint: hint || (o ? (o.hand ? 'Mulde anklicken = einen Stein hineinlegen' : 'Alles gelegt: „Fangen“ (wenn erlaubt) oder „Zug beenden“ (Leertaste)') : ''),
      level: lvl,
      seeds: { n: s.seeds, open: me === 0 && !s.result && !s.moves && !s.open },
      log: log.map(describe),
      end: s.result ? endInfo() : null,
      free: !!s.free,
      actions: o ? { capture: !o.hand && !o.captures.length && o.drops.length > 0 && !isStore(o.drops.at(-1)), done: !o.hand } : null,
    });
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.turn === me) {
      if (s.open?.hand) return `Du säst – noch ${stones(s.open.hand)} in der Hand`;
      if (s.open) return 'Alle Steine gelegt';
      return s.free ? 'Du bist dran – eigene Mulde leeren' : 'Du bist dran – eigene Mulde wählen';
    }
    return solo ? 'Der Computer überlegt …' : `${names.other()} ist dran …`;
  }

  function describe(s) {
    const parts = [];
    for (const e of s.events) {
      if (e.type === 'start') parts.push(`Partie ${s.round ?? 1}: ${s.starter === me ? 'du fängst' : `${who(s.starter)} fängt`} an · ${s.seeds} Steine je Mulde.`);
      else if (e.type === 'seeds') parts.push(`Neu aufgebaut: ${e.n} Steine je Mulde.`);
      else if (e.type === 'move') {
        const caught = e.capture ? ` und ${verb(e.by, 'fängst', 'fängt')} ${stones(e.capture.n)}` : '';
        parts.push(`${who(e.by)} ${verb(e.by, 'säst', 'sät')} ${stones(e.path.length)} aus ${whose(e.by)} ${holeNo(e.from)}. Mulde${caught}${e.bonus ? ' – letzter im Kalaha: nochmal!' : '.'}`);
      } else if (e.type === 'done') parts.push(`${who(e.by)} ${verb(e.by, 'hast', 'hat')} aus ${whose(e.by)} ${holeNo(e.from)}. Mulde gesät${e.captured ? ' und gefangen' : ''}${e.bonus ? ' – letzter im Kalaha: nochmal!' : '.'}`);
      else if (e.type === 'sweep') parts.push(`Eine Seite ist leer – ${who(e.by)} ${verb(e.by, 'räumst', 'räumt')} ${stones(e.n)} ins eigene Kalaha.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e, s));
    }
    return parts.join(' ');
  }

  // e = { caught, player (bekommt die Verwarnung), by (hat gerufen), why } · s = Stand danach
  function verdictText(e, s) {
    const out = s.result?.reason === 'schummeln' ? ' Das ist die dritte – Partie verloren.' : '';
    if (e.caught) {
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ ' : ''}Erwischt! Du hast geschummelt: ${e.why}. Der Zug wird zurückgenommen, dazu eine Verwarnung.${out}`;
      return `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}. Der Zug wird zurückgenommen, dazu eine Verwarnung.${out}`;
    }
    if (e.player === me) return `Fehlalarm! Der Zug war in Ordnung – du bekommst eine Verwarnung.${out}`;
    return solo ? `Der Computer ruft „Geschummelt!“ – Fehlalarm, dein Zug war in Ordnung. Er bekommt eine Verwarnung.${out}`
      : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt eine Verwarnung.${out}`;
  }

  function endInfo() {
    const { winner, reason } = state.result;
    const wins = score(state);
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const why = { leer: 'Eine Seite ist leer.', schummeln: 'Dritte Verwarnung.' }[reason];
    const count = reason === 'schummeln' ? '' : ` Kalaha ${state.pits[STORE[me]]} : ${state.pits[STORE[CPU]]}.`;
    return { title, text: `${why}${count} Stand: du ${wins[me]} : ${wins[CPU]} ${solo ? 'Computer' : names.other()}` };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ starter: 0, free, seeds: loadNumber(SEEDS_KEY, (n) => SEEDS.includes(n), DEFAULT_SEEDS) }));

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
