// Schocken-Partie: verbindet Spielstand (game.js), Tisch mit Bechern und Deckeln (board.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Sitze wie bei Doppelkopf: Host 0, Gast 2 (gegenüber), die freien spielt der Computer.
// Zu Beginn wählt der Host, wie viele am Tisch sitzen (2–4). Der Host hält den vollen Stand, lässt die Computer handeln
// (und würfelt für sie mit Physik) und schickt dem Gast nur dessen Sicht (viewFor). Der Gast würfelt selbst mit Physik
// und schickt Wünsche (setup, roll mit den Augen, toggle, flip, stand, twist, accuse, again, regroup) – der Host prüft
// sie. Becherlagen laufen als 'sk' direkt zum anderen PC.
// free = „Ohne Hilfen“: nochmal würfeln geht immer, jeder Würfel lässt sich herauslegen, Sechsen umdrehen auch falsch,
// dazu „Würfel heimlich drehen“; „Geschummelt!“ gegen einen gewählten Spieler bis zum ersten Wurf der nächsten Runde.
// Allein schummeln die Computer ab und zu selbst (nochmal würfeln) und prüfen jede Schummelei des Menschen einmal.
import {
  newGame, setup, roll, toggle, flip, stand, twist, accuse, waive, again, regroup, viewFor, judge, maxRolls, ranking,
  CHEAT_NAMES, STONES,
} from './game.js';
import { chooseMove } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { roll: 650, act: 700, accuse: 900, round: 3200 }; // so lange „überlegt“ der Computer
const WATCH_MS = 1500; // ohne Hilfen zu zweit: nach dem Aufdecken etwas länger, damit ein Mensch noch anfechten kann
const REL = ['', 'links', 'gegenüber', 'rechts'];
const HALF = ['', '1. Hälfte', '2. Hälfte', 'Finale'];

export function startSchocken({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null;
  let mine = null;
  let waiting = false;
  let asked = null;
  let rolling = false;
  let cpuRolling = false;
  let timer = null;
  let hint = '';
  let picking = false; // „Geschummelt!“ gedrückt – wartet auf die Wahl des Spielers
  let twisting = false;
  let cheered = false;
  let stopped = false;
  let judged = new Set(); // allein ohne Hilfen: schon geprüfte Schummeleien / Züge des Menschen
  let due = null; // … und der Spieler, den ein Computer gleich anklagt
  let log = [];

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('sk-panel'), {
    solo,
    onSetup: (n) => act('setup', n),
    onAction: (type) => {
      if (type === 'roll') return rollNow();
      if (type === 'twist') {
        twisting = !twisting;
        return render();
      }
      act(type);
    },
    onDie: (k) => dieClicked(k),
    onAccuse: (target) => {
      picking = false;
      if (target === null) return render();
      act('accuse', target);
    },
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine?.phase === 'play' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({
    onAccuse: () => {
      picking = !picking;
      render();
    },
    hint: document.querySelector('[data-game="Schocken"] .dock [data-hint]'),
  });

  function apply(type, seat, arg) {
    if (type === 'setup') return setup(state, seat, arg);
    if (type === 'roll') return roll(state, seat, arg);
    if (type === 'toggle') return toggle(state, seat, arg);
    if (type === 'flip') return flip(state, seat);
    if (type === 'stand') return stand(state, seat);
    if (type === 'twist') return twist(state, seat, arg);
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    if (type === 'regroup') return regroup(state, seat);
    return null;
  }

  function setState(next) {
    if (next.phase === 'setup' || next.events[0]?.type === 'start') {
      cheered = false;
      judged = new Set();
      due = null;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    if (mine.turn !== mySeat || !mine.free) twisting = false;
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 2) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  function act(type, arg) {
    if (!state || waiting || (rolling && type !== 'again')) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again' || type === 'regroup') say(blocked());
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
    if (msg.t === 'sk') return board.applyRemote(msg);
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && (asked === 'again' || asked === 'regroup')) hint = blocked();
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 2, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 2) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // Würfeln mit Physik – how: 'auto' schüttelt von selbst, 'hand' folgt der Maus
  async function rollNow(how = 'auto') {
    if (!canRoll()) return;
    rolling = true;
    picking = twisting = false;
    render();
    const values = await (how === 'hand' ? board.grab(mySeat, mine.out[mySeat]) : board.roll(mySeat, mine.out[mySeat]));
    rolling = false;
    if (stopped) return;
    if (values) act('roll', values);
    render();
  }

  // --- Computer (nur beim Host) ---
  const isCpu = (seat) => !humans.includes(seat);

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state || cpuRolling) return;
    const s = state;
    if (solo && s.free && judge_(s)) return;
    if (s.phase === 'over') {
      if (solo && s.free && !s.waived) commit(waive(state)); // letzte Runde geprüft – „Nochmal“ ist frei
      return;
    }
    if (s.phase !== 'play' || !isCpu(s.turn)) return;
    const seat = s.turn;
    const v = viewFor(s, seat);
    // Rundenbeginn: erst einmal aufs Aufgedeckte schauen (zu zweit ohne Hilfen etwas länger – man kann noch anfechten)
    if (s.rolls === 0) {
      const wait = s.shown && s.turn === s.order[0] ? THINK_MS.round + (s.free && !solo ? WATCH_MS : 0) : THINK_MS.roll;
      return later(wait, () => cpuRoll(seat));
    }
    const m = chooseMove(v, seat);
    // allein ohne Hilfen: mit schlechtem Wurf würfelt er ab und zu über die Grenze
    const sly = solo && s.free && m.t === 'stand' && s.rolls >= maxRolls(s) && judge(s.dice[seat]).rank < 200 && cpuCheats();
    if (m.t === 'roll' || sly) return later(THINK_MS.act, () => cpuRoll(seat));
    later(THINK_MS.act, () => commit(apply(m.t, seat, m.arg) ?? stand(state, seat) ?? state));
  }

  async function cpuRoll(seat) {
    cpuRolling = true;
    const values = await board.roll(seat, state.out[seat]);
    cpuRolling = false;
    if (stopped) return;
    const next = values && roll(state, seat, values);
    if (next) commit(next);
    else commit(stand(state, seat) ?? state);
  }

  // Allein ohne Hilfen: Jede Schummelei des Menschen prüft ein Computer einmal (erwischt jede zweite); nach einem
  // ehrlichen Zug ruft er selten trotzdem (Fehlalarm – er verliert dann die Runde).
  function judge_(s) {
    for (const c of s.cheats) {
      if (!humans.includes(c.player) || judged.has(`c${c.seq}`)) continue;
      judged.add(`c${c.seq}`);
      if (cpuAccuses(true)) due = { player: c.player, cheat: true };
    }
    const done = s.events.find((e) => e.type === 'stand' && humans.includes(e.player));
    if (done && !judged.has(`s${s.seq}`) && !s.cheats.some((c) => c.player === done.player)) {
      judged.add(`s${s.seq}`);
      if (cpuAccuses(false)) due = { player: done.player, cheat: false };
    }
    if (due?.cheat && !s.cheats.some((c) => c.player === due.player)) due = null; // inzwischen verjährt
    const base = s.undo ?? s;
    const by = base.order.find((p) => isCpu(p) && p !== due?.player);
    if (!due || by === undefined || !base.order.includes(due.player)) return (due = null);
    later(THINK_MS.accuse, () => {
      const target = due.player;
      due = null;
      commit(accuse(state, by, target) ?? state);
    });
    return true;
  }

  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  const blocked = () => (solo ? 'Der Computer prüft die letzte Runde noch …' : `${names.other()} startet die nächste Partie`);
  function say(text) {
    hint = text;
    render();
  }

  // --- Eingaben ---
  const running = () => mine && mine.phase === 'play' && !waiting && !rolling;
  const myTurn = () => running() && mine.turn === mySeat;
  // solange ein Computer gleich „Geschummelt!“ ruft, wird nicht gewürfelt (sonst entwischt die Schummelei)
  const canRoll = () => myTurn() && due === null && mine.out[mySeat].some((o) => !o) && (mine.free || mine.rolls < maxRolls(mine));
  const canStand = () => myTurn() && mine.rolls > 0 && (mine.free || !mine.mustRoll);

  function dieClicked(k) {
    if (!myTurn() || mine.rolls === 0) return;
    if (twisting) return act('twist', k);
    if (!mine.free && !mine.out[mySeat][k] && mine.dice[mySeat][k] !== 1) return say('Herauslegen darfst du nur Einsen.');
    act('toggle', k);
  }

  let grabbing = false;
  const onMove = (e) => {
    if (grabbing) return board.drag(room.rayFrom(e));
    const ray = room.rayFrom(e);
    const k = myTurn() && mine.rolls > 0 ? board.pickDie(ray, mySeat) : -1;
    const cup = k < 0 && canRoll() && board.hitCup(ray, mySeat);
    board.setHover(cup ? mySeat : null);
    canvas.style.cursor = k >= 0 ? 'pointer' : cup ? 'grab' : '';
  };
  const onDown = (e) => {
    if (e.button !== 0 || !myTurn()) return;
    const ray = room.rayFrom(e);
    const k = mine.rolls > 0 ? board.pickDie(ray, mySeat) : -1;
    if (k >= 0) {
      e.preventDefault(); // eigene Würfel gehören dem Spiel: Klick = herauslegen bzw. zurück
      return dieClicked(k);
    }
    if (!canRoll() || !board.hitCup(ray, mySeat)) return;
    e.preventDefault(); // Becher gehört dem Spiel – sonst würde tisch.js ihn greifen
    grabbing = true;
    canvas.style.cursor = 'grabbing';
    board.setHover(null);
    rollNow('hand');
    board.drag(ray);
  };
  const onUp = (e) => {
    if (e.button !== 0 || !grabbing) return;
    grabbing = false;
    canvas.style.cursor = '';
    board.release();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && (picking || twisting)) {
      picking = twisting = false;
      render();
    }
    if (e.code !== 'Space' || e.target.tagName === 'INPUT' || !canRoll()) return;
    e.preventDefault();
    rollNow();
  };

  // --- Anzeige ---
  function render() {
    if (!waiting) board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    const at = v.seats.length ? v.seats : humans;
    board.names(seatLabels(4, { mySeat, humans, me: names.me(), other: names.other(), cpu: nameOf, taken: (s) => at.includes(s) }),
      v.phase === 'play' ? v.turn : null, (s) => v.phase === 'play' && !v.active.includes(s));
    const over = v.phase === 'over';
    const lost = over && v.loser === mySeat;
    if (over && !lost && !cheered) room.celebrate(me); // verloren hat ein anderer – Konfetti
    cheered = over && !lost;
    const base = v.order;
    const canAccuse = v.free && v.phase !== 'setup' && base.includes(mySeat) && !waiting && !rolling;
    cheat.update({ free: v.free, canAccuse });
    if (!canAccuse) picking = false;
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.games}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const seats = [...(v.seats.length ? v.seats : humans)].sort((a, b) => rel(a) - rel(b));
    const turn = myTurn();
    const myDice = v.dice[mySeat];
    const showDice = v.phase === 'play' && v.turn === mySeat && v.rolls > 0;
    panel.render({
      round: v.phase === 'setup' ? 'Spielerzahl wählen' : `Partie ${v.games} · ${HALF[v.half]} · Runde ${v.round}`,
      players: seats.map((p) => ({
        name: nameOf(p), stones: v.stones[p], halves: v.halves.filter((x) => x === p).length,
        turn: v.phase === 'play' && v.turn === p, out: v.phase === 'play' && !v.active.includes(p), note: noteOf(p),
      })),
      pot: v.phase === 'setup' ? '' : v.pot ? `Mitte: ${v.pot} von ${STONES} Deckeln` : 'Mitte leer – Deckel gibt jetzt der Höchste ab',
      status: statusText(),
      setup: v.phase === 'setup' && isHost ? setupInfo() : null,
      dice: showDice ? [0, 1, 2].map((k) => ({ k, value: myDice[k], out: v.out[mySeat][k], active: turn })) : [],
      mine: showDice ? `Dein Wurf: ${judge(myDice).name} · Wurf ${v.rolls}${v.free ? '' : ` von ${maxRolls(v)}`}` : '',
      acts: actions(),
      accuse: picking && canAccuse ? seats.filter((p) => p !== mySeat && base.includes(p)).map((p) => ({ seat: p, name: nameOf(p) })) : null,
      shown: v.shown ? shownList() : [],
      hint,
      last: log,
      end: over ? endInfo() : null,
    });
  }

  function noteOf(p) {
    const v = mine;
    if (v.phase !== 'play') return '';
    if (!v.active.includes(p)) return 'raus';
    if (v.done[p] !== null) return `${v.done[p]} ${v.done[p] === 1 ? 'Wurf' : 'Würfe'}`;
    if (v.turn === p && v.rolls) return `${v.rolls}. Wurf`;
    return '';
  }

  function shownList() {
    const sh = mine.shown;
    const order = ranking({ ...mine, dice: sh.dice, done: Object.fromEntries(sh.results.map((r) => [r.player, r.n])), order: sh.results.map((r) => r.player) },
      sh.results.map((r) => r.player));
    return order.map((p) => {
      const r = sh.results.find((x) => x.player === p);
      const mark = p === sh.high ? 'high' : p === sh.low ? 'low' : '';
      return { text: `${nameOf(p)}: ${r.name} (${r.n} ${r.n === 1 ? 'Wurf' : 'Würfe'})${p === sh.low && sh.forced ? ' – nach Anklage' : ''}`, mark };
    });
  }

  function setupInfo() {
    return [2, 3, 4].map((n) => {
      const cpu = n - humans.length;
      return { n, text: cpu ? `${n} (${solo ? 'du + ' : '+ '}${cpu} Computer)` : '2 (ihr zwei)' };
    });
  }

  function actions() {
    const v = mine;
    if (!myTurn()) return [];
    const acts = [];
    const more = v.rolls < maxRolls(v);
    acts.push({ act: 'roll', text: v.rolls === 0 ? 'Würfeln' : 'Nochmal würfeln', disabled: !canRoll(), secondary: v.rolls > 0 && !more });
    if (v.rolls > 0) acts.push({ act: 'stand', text: 'Fertig – so bleibt es', disabled: !canStand() });
    const sixes = [0, 1, 2].filter((k) => v.fresh[k] && !v.out[mySeat][k] && v.dice[mySeat][k] === 6).length;
    if (v.rolls > 0 && !v.flipped && (v.free ? sixes >= 1 : sixes >= 2 && more)) {
      acts.push({ act: 'flip', text: sixes >= 3 ? 'Sechsen → zwei Einsen' : 'Zwei Sechsen → eine Eins', secondary: true });
    }
    if (v.free && v.rolls > 0) acts.push({ act: 'twist', text: twisting ? 'Drehen aus' : 'Würfel heimlich drehen', secondary: true, on: twisting });
    return acts;
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Wie viele spielen mit?' : `${names.other()} wählt die Spielerzahl …`;
    if (v.phase === 'over') return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (rolling) return 'Die Würfel klappern …';
    if (twisting) return 'Würfel anklicken = eine Zahl weiterdrehen';
    const limit = v.limit === null ? '' : ` (höchstens ${v.limit} ${v.limit === 1 ? 'Wurf' : 'Würfe'})`;
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ${verb(v.turn, 'würfelst', 'würfelt')} …${limit}`;
    if (v.rolls === 0) return v.turn === v.order[0] ? 'Du fängst an – du legst die Wurfzahl fest' : `Du bist dran${limit}`;
    if (v.mustRoll) return 'Die Sechs muss zurück in den Becher – nochmal würfeln';
    return v.rolls < maxRolls(v) ? 'Einsen herauslegen und nochmal – oder fertig?' : 'Fertig!';
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'setup') parts.push('Neue Partie – erst die Spielerzahl wählen.');
      else if (e.type === 'start') parts.push(`Los geht's – ${who} ${verb(e.player, 'fängst', 'fängt')} an.`);
      else if (e.type === 'flip') parts.push(`${who} ${verb(e.player, 'drehst', 'dreht')} ${e.n === 2 ? 'zwei Sechsen zu Einsen' : 'eine Sechs zur Eins'}.`);
      else if (e.type === 'reveal') {
        const got = e.from === 'all' ? 'alle Deckel' : `${e.stones} Deckel ${e.from === 'pot' ? 'aus der Mitte' : `von ${nameOf(e.from)}`}`;
        parts.push(`Aufgedeckt! Höchster: ${nameOf(e.high)} mit ${e.value}. ${nameOf(e.low)} ${verb(e.low, 'bekommst', 'bekommt')} ${got}.`);
      } else if (e.type === 'half') parts.push(`${who} ${verb(e.player, 'verlierst', 'verliert')} ${e.half === 3 ? 'das Finale' : `die ${e.half}. Hälfte`}!`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'over') parts.push(`${nameOf(e.loser)} ${verb(e.loser, 'verlierst', 'verliert')} die Partie${e.double ? ' – beide Hälften!' : '.'}`);
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      const what = e.kinds.map((k) => CHEAT_NAMES[k]).slice(0, 2).join(' und ');
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${what} und verlierst die Runde.`
        : `Erwischt! ${nameOf(e.player)} hat ${what} und verliert die Runde.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat nicht geschummelt – du verlierst die Runde.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und verliert die Runde.`;
  }

  function endInfo() {
    const v = mine;
    const title = v.loser === mySeat ? 'Verloren!' : `${nameOf(v.loser)} ${verb(v.loser, 'verlierst', 'verliert')}`;
    const halves = v.halves.map((p, i) => `${HALF[i + 1]}: ${nameOf(p)}`).join(' · ');
    return { title, text: `Verloren haben – ${halves}`, regroup: isHost };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ humans, free }));
  setTimeout(() => !stopped && render());

  return {
    handle,
    refresh: render,
    view: () => mine,
    stop() {
      stopped = true;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
