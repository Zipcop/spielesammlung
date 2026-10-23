// Memory-Partie: verbindet Spielstand (game.js), Kärtchen auf dem Tisch (board.js), Seitenfeld (panel.js), Computer (ai.js)
// und Netz. Spieler 0 = Host, 1 = Gast bzw. Computer. Der Host hält den vollen Stand (er kennt alle Motive), zeigt selbst
// aber nur seine Sicht und schickt dem Gast dessen Sicht (viewFor). Der Gast schickt Wünsche (setup, flip, pass, pocket,
// peek, accuse, again, regroup), der Host prüft sie und antwortet mit { t: 'state' }.
// Aufdecken: Kärtchen anklicken – oder mit der Maus anheben und wieder hinlegen (tisch.js).
// free = „Ohne Hilfen“: nach zwei verschiedenen selbst „Weiter“; drittes Kärtchen, ungleiches Paar einstecken
// (offenes Kärtchen zu den eigenen Paaren legen oder „Paar einstecken“) und heimlich linsen gehen – der andere kann
// „Geschummelt!“ rufen, bis er sein erstes Kärtchen aufdeckt. Allein linst der Computer ab und zu selbst und prüft
// jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, setup, flip, pass, pocket, peek, accuse, waive, again, regroup, score, viewFor, pairsOf, motifName, SETS,
} from './game.js';
import { LEVELS, remember, fade, chooseFlip, peekTarget } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { first: 850, second: 650, look: 1600, pass: 1100 }; // look: so lange liegen die Kärtchen des Menschen offen
const ACCUSE_MS = 800;
const LOG = 3;
const LEVEL_KEY = 'spielesammlung-memory-stufe';

function loadLevel() {
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    const n = Number(raw);
    return raw !== null && Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1;
  } catch {
    return 1;
  }
}

export function startMemory({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let log = [];
  let cheered = false;
  let stopped = false;
  let peeking = false; // ohne Hilfen: nächster Klick linst nur
  // Computer (allein): Gedächtnis, Zug angefangen (dann einmal vergessen), schon gelinst, geprüfter Zug des Menschen
  let mem = new Map();
  let cpuTurn = false;
  let cpuPeeked = false;
  let judged = null;

  const who = (p) => (p === me ? 'Du' : solo ? 'Der Computer' : names.other());
  const verb = (p, du, er) => (p === me ? du : er);
  const whom = (p) => (p === me ? 'dich' : solo ? 'den Computer' : names.other());
  const nameOf = (m) => motifName(mine.set, m);

  const panel = createPanel($('mem-panel'), {
    solo,
    onSetup: (pick) => act('setup', pick),
    onLevel: (n) => {
      lvl = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch {
        // ohne Speicher gilt die Stufe eben nur bis zum Neuladen
      }
      render();
    },
    onPass: () => tryPass(),
    onPocket: () => tryPocket(),
    onPeek: () => {
      peeking = !peeking && myTurn();
      render();
    },
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine?.phase === 'play' ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Memory"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'setup') return setup(state, p, arg ?? {});
    if (type === 'flip') return flip(state, p, arg);
    if (type === 'pass') return pass(state, p);
    if (type === 'pocket') return pocket(state, p);
    if (type === 'peek') return peek(state, p, arg);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    if (type === 'regroup') return regroup(state, p);
    return null;
  }

  function setState(next) {
    const start = next.phase === 'setup' || next.events[0]?.type === 'deal';
    if (start && next.seq !== state?.seq) {
      log = [];
      cheered = false;
      mem = new Map();
      judged = null;
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, me) : state;
    if (fresh) {
      const text = describe(mine);
      if (text) log = [text, ...log].slice(0, LOG);
      if (solo) mem = remember(mem, viewFor(state, other).events, lvl, other); // der Computer schaut mit
      const peeked = mine.events.find((e) => e.type === 'peek' && e.by === me);
      hint = peeked ? `Darunter liegt: ${nameOf(peeked.motif)}` : '';
    } else hint = '';
    if (!myTurn()) peeking = false;
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 1) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
      else if (type === 'again' || type === 'regroup') say(blockedText());
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
      if (same && (asked === 'again' || asked === 'regroup') && state.phase === 'over') hint = blockedText();
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 1) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  const blockedText = () => (solo ? 'Der Computer prüft noch deinen letzten Zug …' : `${names.other()} darf noch „Geschummelt!“ rufen – oder startet die Revanche.`);

  // --- Computer (nur allein) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    const c = s.free ? s.cheat : null;
    // Ohne Hilfen: Ist der Zug des Menschen vorbei, prüft ihn der Computer einmal
    if (c?.player === me && (s.phase === 'over' || s.turn !== me) && c !== judged) {
      judged = c;
      if (cpuAccuses(!c.legal)) return later(ACCUSE_MS, () => commit(accuse(state, other) ?? state));
      if (s.phase === 'over') return later(ACCUSE_MS, () => commit(waive(state, other) ?? state));
    }
    if (s.phase !== 'play' || s.turn !== other) {
      cpuTurn = false;
      return;
    }
    if (!cpuTurn) {
      cpuTurn = true;
      cpuPeeked = false;
      mem = fade(mem, lvl);
    }
    const v = viewFor(s, other);
    if (s.free && s.open.length >= 2) return later(THINK_MS.pass, () => commit(pass(state, other) ?? state)); // zwei verschiedene: Weiter
    const wait = s.shown.length ? THINK_MS.look : s.open.length ? THINK_MS.second : THINK_MS.first;
    later(wait, () => {
      if (state.free && !cpuPeeked && cpuCheats()) {
        const k = peekTarget(v, mem);
        if (k !== null) {
          cpuPeeked = true;
          return commit(peek(state, other, k) ?? state);
        }
      }
      commit(flip(state, other, chooseFlip(viewFor(state, other), mem)) ?? state);
    });
  }

  // Erst wenn die Kärtchen liegen, kurz überlegen, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
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
  const running = () => !!mine && mine.phase === 'play' && !waiting;
  const myTurn = () => running() && mine.turn === me;
  const onTable = () => mine.owner.flatMap((o, k) => (o === null && !mine.open.includes(k) ? [k] : []));

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function tryFlip(i) {
    if (!running()) return false;
    if (mine.turn !== me) return say(`${who(mine.turn)} ${verb(mine.turn, 'bist', 'ist')} dran.`);
    if (mine.owner[i] !== null || mine.open.includes(i)) return false;
    if (!mine.free && mine.open.length >= 2) return false;
    act('flip', i);
    return true;
  }

  function tryPeek(i) {
    peeking = false;
    if (!myTurn() || mine.owner[i] !== null || mine.open.includes(i) || mine.shown.includes(i)) return say('Linsen geht nur unter ein verdecktes Kärtchen.');
    act('peek', i);
    return true;
  }

  function tryPass() {
    if (!myTurn() || !mine.free) return false;
    act('pass');
    return true;
  }

  function tryPocket() {
    if (!myTurn() || !mine.free) return false;
    if (mine.open.length !== 2) return say('Einstecken geht mit genau zwei offenen Kärtchen.');
    act('pocket');
    return true;
  }

  // Kärtchen mit der Hand abgelegt (tisch.js): ein verdecktes = aufdecken; ohne Hilfen ein offenes zu meinen Paaren = einstecken
  board.onPlace = (mesh, point) => {
    const i = board.tileOf(mesh);
    if (i === null || !mine || mine.phase !== 'play' || i >= mine.tiles.length || mine.owner[i] !== null) return null;
    if (mine.open.includes(i)) return mine.free && board.nearPile(point) && tryPocket() ? 'move' : 'back';
    return tryFlip(i) ? 'move' : 'back';
  };

  const onMove = (e) => {
    const i = myTurn() && !board.busy() ? board.pick(room.rayFrom(e), peeking ? onTable().filter((k) => !mine.shown.includes(k)) : onTable()) : null;
    board.setHover(i);
    canvas.style.cursor = i !== null ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const i = board.pick(room.rayFrom(e), onTable());
    if (i === null) return;
    if (peeking) tryPeek(i);
    else tryFlip(i);
  };

  const onKey = (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
    if (e.code === 'Space' && mine?.free && myTurn()) {
      e.preventDefault();
      tryPass();
    } else if (e.code === 'Escape' && peeking) {
      peeking = false;
      render();
    }
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, me);
    if (!mine) return;
    const v = mine;
    board.names(seatLabels(2, { mySeat: me, humans: solo ? [me] : [0, 1], me: names.me(), other: names.other(), cpu: () => `Computer (${LEVELS[lvl].name})` }), v.phase === 'play' ? v.turn : null);
    if (!myTurn()) board.setHover(null);
    const won = v.phase === 'over' && v.result.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!v.free, canAccuse: !!v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== me && !waiting });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const wins = score(v);
    const turn = myTurn();
    panel.render({
      round: v.phase === 'setup' ? '' : `Partie ${v.round} · ${v.size} Paare`,
      players: [me, other].map((p) => ({
        name: p === me ? 'Du' : solo ? `Computer (${LEVELS[lvl].name})` : names.other(),
        pairs: v.phase === 'setup' ? null : pairsOf(v, p),
        wins: wins[p],
        turn: v.phase === 'play' && v.turn === p,
      })),
      status: statusText(),
      hint,
      setup: v.phase === 'setup' ? { mine: isHost, size: v.size, set: v.set } : null,
      level: lvl,
      actions: v.free && v.phase === 'play' && turn ? { pass: true, pocket: v.open.length === 2, peek: true, peeking } : null,
      log,
      end: v.phase === 'over' ? endInfo() : null,
      free: !!v.free,
    });
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Größe und Motive wählen, dann „Austeilen“' : `${names.other()} wählt Größe und Motive …`;
    if (v.phase === 'over') return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (v.turn !== me) return solo ? 'Der Computer ist dran …' : `${names.other()} ist dran …`;
    if (peeking) return 'Unter welches Kärtchen linsen?';
    if (v.open.length >= 2) return 'Kein Paar – „Weiter“ drücken';
    return v.open.length ? 'Noch ein Kärtchen aufdecken' : 'Du bist dran – deck zwei Kärtchen auf';
  }

  function describe(v) {
    const parts = [];
    for (const e of v.events) {
      if (e.type === 'deal') parts.push(`Partie ${v.round}: ${e.starter === me ? 'du fängst' : `${who(e.starter)} fängt`} an (${v.size} Paare, ${SETS[v.set].name}).`);
      else if (e.type === 'flip') parts.push(`${who(e.by)} ${verb(e.by, 'deckst', 'deckt')} ${nameOf(e.motif)} auf.`);
      else if (e.type === 'pair') parts.push(`Ein Paar für ${whom(e.by)}!`);
      else if (e.type === 'miss') parts.push('Kein Paar.');
      else if (e.type === 'pass') parts.push(`${who(e.by)} ${verb(e.by, 'drehst', 'dreht')} die Kärtchen um.`);
      else if (e.type === 'pocket') parts.push(`${who(e.by)} ${verb(e.by, 'steckst', 'steckt')} ${nameOf(v.tiles[e.tiles[0]])} und ${nameOf(v.tiles[e.tiles[1]])} als Paar ein.`);
      else if (e.type === 'peek') parts.push(e.by === me ? 'Du linst heimlich unter ein Kärtchen.' : `${who(e.by)} hebt heimlich ein Kärtchen an!`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'over') parts.push(overText(v));
    }
    return parts.join(' ');
  }

  function overText(v) {
    const { winner } = v.result;
    if (winner === null) return 'Gleich viele Paare – unentschieden.';
    return winner === me ? 'Du hast die meisten Paare!' : `${who(winner)} hat die meisten Paare.`;
  }

  // e = { caught, player (bekommt die Strafe), by (hat gerufen), why, gift (Plätze des abgegebenen Paars oder null) }
  function verdictText(e) {
    const r = 1 - e.player; // bekommt das Paar
    const gift = e.gift ? `${e.player === me ? 'Du gibst' : `${who(e.player)} gibt`} ein Paar an ${whom(r)} ab.` : `${e.player === me ? 'Du hast' : `${who(e.player)} hat`} noch kein Paar zum Abgeben.`;
    if (e.caught) {
      const lead = e.player === me ? `${solo ? 'Der Computer ruft „Geschummelt!“ – ' : ''}Erwischt! Du hast geschummelt: ${e.why}.` : `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}.`;
      return `${lead} Alles seit dem Schummeln wird zurückgenommen. ${gift} ${e.by === me ? 'Du bist' : `${who(e.by)} ist`} dran.`;
    }
    const lead = e.player === me ? `Fehlalarm! ${solo ? 'Der Computer' : names.other()} hat richtig gespielt.` : solo ? 'Der Computer ruft „Geschummelt!“ – Fehlalarm, du hast richtig gespielt.' : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen.`;
    return `${lead} ${gift}`;
  }

  function endInfo() {
    const { winner, pairs } = mine.result;
    const wins = score(mine);
    const opp = solo ? 'Computer' : names.other();
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const rest = mine.owner.some((o) => o === null) ? ' Kein Paar mehr möglich.' : '';
    return { title, text: `Paare: du ${pairs[me]} : ${pairs[other]} ${opp}.${rest} Siege: du ${wins[me]} : ${wins[other]} ${opp}`, regroup: isHost };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => mine,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.setHover(null);
      board.reset();
    },
  };
}
