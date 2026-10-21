// Zehntausend-Partie: verbindet Spielstand (game.js), Tisch mit Arena und Becher (board.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Sitze wie bei Doppelkopf: Host 0, Gast 2 (gegenüber), die freien spielt der Computer.
// Zu Beginn wählt der Host, wie viele am Tisch sitzen (2–4). Der Host hält den vollen Stand, lässt die Computer
// handeln (und würfelt für sie mit Physik) und schickt dem Gast dessen Sicht (viewFor). Der Gast würfelt selbst mit
// Physik und schickt Wünsche (setup, roll mit den Augen, toggle, bank, pass, twist, accuse, again, regroup) – der Host
// prüft sie. Würfel- und Becherlagen laufen als 'zt' direkt zum anderen PC.
// free = „Ohne Hilfen“: Herauslegen, Weiterwürfeln und Aufhören gehen immer, dazu „Weitergeben“ nach einer Niete und
// „Würfel heimlich drehen“; „Geschummelt!“ gegen den letzten Zug, bis der Nächste würfelt. Allein schummeln die Computer
// ab und zu selbst und prüfen jeden Zug des Menschen einmal (schummeln.js). Zu zweit warten die Computer etwas länger,
// solange ein Mensch den Zug des anderen noch anfechten kann.
import {
  newGame, setup, roll, toggle, bank, pass, twist, accuse, waive, again, regroup, viewFor, pickOf, selected, thrownBy, scoreOf,
  MIN_BANK, GOAL, CHEAT_NAMES, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from './game.js';
import { choosePick } from './ai.js';
import { createPanel, fmt } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { roll: 700, pick: 900, decide: 700, accuse: 900, turn: 1400 }; // so lange „überlegt“ der Computer
const WATCH_MS = 1500; // ohne Hilfen zu zweit: so lange länger, damit ein Mensch den letzten Zug noch anfechten kann
const REL = ['', 'links', 'gegenüber', 'rechts'];
const DRAG_PX = 18;

export function startZehntausend({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null; // Host: voller Stand · Gast: seine Sicht
  let mine = null;
  let waiting = false;
  let asked = null;
  let rolling = false; // meine Würfel rollen gerade
  let cpuRolling = false;
  let timer = null;
  let hint = '';
  let cheered = false;
  let stopped = false;
  let twisting = false; // ohne Hilfen: „Würfel heimlich drehen“ ist an – Klick auf einen Würfel dreht ihn
  let plan = null; // Computer: { seq, stop } – nach dem Herauslegen aufhören oder weiterwürfeln
  let judged = null; // allein ohne Hilfen: zuletzt geprüfter Zug des Menschen
  let log = [];

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('zt-panel'), {
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
    onDie: (i) => dieClicked(i),
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine?.phase === 'play' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Zehntausend"] .dock [data-hint]') });

  function apply(type, seat, arg) {
    if (type === 'setup') return setup(state, seat, arg);
    if (type === 'roll') return roll(state, seat, arg);
    if (type === 'toggle') return toggle(state, seat, arg);
    if (type === 'bank') return bank(state, seat);
    if (type === 'pass') return pass(state, seat);
    if (type === 'twist') return twist(state, seat, arg);
    if (type === 'accuse') return accuse(state, seat);
    if (type === 'again') return again(state, seat);
    if (type === 'regroup') return regroup(state, seat);
    return null;
  }

  function setState(next) {
    if (next.phase === 'setup' || next.events[0]?.type === 'start') {
      cheered = false;
      judged = null;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    if (mine.turn !== mySeat || !mine.free) twisting = false;
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state) });
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
      else if (type === 'accuse') say('Zu spät – inzwischen hat der Nächste gewürfelt.');
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
    if (msg.t === 'zt') return board.applyRemote(msg);
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && (asked === 'again' || asked === 'regroup')) hint = blocked();
      if (asked === 'accuse' && !msg.state.events.some((e) => e.type === 'caught' || e.type === 'fehlalarm')) hint = 'Zu spät – inzwischen hat der Nächste gewürfelt.';
      asked = null; // nur die Antwort auf diesen Wunsch – sonst hinge „Zu spät“ an jedem weiteren Stand
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 2, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Würfeln mit Physik: how 'auto' = Becher schüttelt von selbst, 'cup' = Becher von Hand, 'hand' = Handvoll ---
  async function rollNow(how = 'auto', from = -1) {
    if (!canRoll()) return explainRoll();
    rolling = true;
    twisting = false;
    render();
    const thrown = thrownBy(mine);
    const values = await (how === 'cup' ? board.grab(thrown, mySeat) : how === 'hand' ? board.grabHand(thrown, mySeat, from) : board.roll(thrown, mySeat));
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
    const c = s.cheat;
    // Allein ohne Hilfen: Ist der Zug des Menschen vorbei, prüft ihn ein Computer einmal
    if (solo && s.free && c?.player === mySeat && (s.phase === 'over' || s.turn !== mySeat) && c !== judged) {
      judged = c;
      const by = s.phase === 'play' && isCpu(s.turn) ? s.turn : s.seats.find(isCpu);
      return later(THINK_MS.accuse, () => {
        if (cpuAccuses(state.cheat.kinds.length > 0)) return commit(accuse(state, by));
        if (state.phase === 'over') return commit(waive(state, by));
        schedule();
      });
    }
    if (s.phase !== 'play' || !isCpu(s.turn)) return;
    const seat = s.turn;
    const watch = s.free && c && c.player !== seat && humans.some((h) => h !== c.player) && s.rolls === 0;
    if (s.rolls === 0) return later((s.list.length || s.events.some((e) => e.type === 'bust') ? THINK_MS.turn : THINK_MS.roll) + (watch ? WATCH_MS : 0), () => cpuRoll(seat));
    if (s.bust) {
      // ohne Hilfen bleibt die Niete liegen: allein würfelt er ab und zu heimlich weiter, sonst gibt er ab
      if (solo && cpuCheats()) return later(THINK_MS.decide, () => cpuRoll(seat));
      return later(THINK_MS.decide, () => commit(pass(state, seat) ?? state));
    }
    if (plan?.seq === s.seq) {
      return later(THINK_MS.decide, () => (plan.stop ? commit(bank(state, seat) ?? state) : cpuRoll(seat)));
    }
    later(THINK_MS.pick, () => {
      const v = viewFor(state);
      const choice = choosePick(v, seat);
      // genau seine Auswahl markieren (nach einer Anklage mitten im Zug kann schon etwas markiert sein)
      const next = [0, 1, 2, 3, 4, 5].reduce((x, i) => (x.marked[i] !== choice.dice.includes(i) ? toggle(x, seat, i) ?? x : x), state);
      // allein ohne Hilfen hört er ab und zu schon unter 350 auf
      const total = v.turnPts + scoreOf(choice.dice.map((i) => v.dice[i])).points;
      const sly = solo && state.free && !choice.stop && total >= 150 && total < MIN_BANK && cpuCheats();
      plan = { seq: next.seq, stop: choice.stop || sly };
      commit(next);
    });
  }

  async function cpuRoll(seat) {
    cpuRolling = true;
    const values = await board.roll(thrownBy(state), seat);
    cpuRolling = false;
    if (stopped) return;
    const next = values && roll(state, seat, values);
    if (next) commit(next);
    else if (state.turn === seat && state.rolls > 0) commit(bank(state, seat) ?? pass(state, seat) ?? state);
    else schedule();
  }

  // Erst wenn alles ruhig liegt, kurz überlegen, dann handeln (solange ändert niemand etwas am Stand)
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
  const running = () => mine && mine.phase === 'play' && !waiting && !rolling;
  const myTurn = () => running() && mine.turn === mySeat;
  const blocked = () => (solo ? 'Der Computer prüft den letzten Zug noch …' : `${names.other()} startet die nächste Partie`);
  const pickOk = () => selected(mine).length > 0 && !pickOf(mine).junk;
  const canRoll = () => myTurn() && (mine.rolls === 0 || mine.free || (!mine.bust && pickOk()));
  const canBank = () => myTurn() && mine.rolls > 0 && (mine.free || (pickOk() && mine.turnPts + pickOf(mine).points >= MIN_BANK));

  function say(text) {
    hint = text;
    render();
  }

  function explainRoll() {
    if (!myTurn()) return;
    if (!selected(mine).length) return say('Erst mindestens einen wertenden Würfel herauslegen (anklicken).');
    if (pickOf(mine).junk) return say(junkText());
  }

  // Würfel angeklickt (im Seitenfeld oder auf dem Tisch)
  function dieClicked(i) {
    if (!myTurn() || mine.rolls === 0) return;
    if (twisting) return act('twist', i);
    if (mine.where[i] !== 'table') return;
    act('toggle', i);
  }

  let grabbing = false;
  let pressed = null; // freier Würfel gedrückt: { i, x, y } – Klick = herauslegen, Ziehen = Handvoll werfen
  let handled = false;
  const freeDie = (i) => i >= 0 && (mine.rolls === 0 ? true : mine.where[i] === 'table' && !mine.marked[i]);
  const onMove = (e) => {
    if (pressed && !grabbing && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) {
      handled = true;
      if (canRoll()) {
        grabbing = true;
        canvas.style.cursor = 'grabbing';
        rollNow('hand', pressed.i);
      } else explainRoll();
      pressed = null;
    }
    if (grabbing) return board.drag(room.rayFrom(e));
    const ray = room.rayFrom(e);
    const i = myTurn() ? board.pickDie(ray) : -1;
    const markable = i >= 0 && mine.rolls > 0 && mine.where[i] === 'table';
    const cup = !markable && canRoll() && board.hitCup(ray);
    board.setHover(markable ? i : -1, cup);
    canvas.style.cursor = markable ? 'pointer' : cup || (i >= 0 && freeDie(i) && canRoll()) ? 'grab' : '';
  };
  const onDown = (e) => {
    if (e.button !== 0 || !myTurn()) return;
    handled = false;
    const ray = room.rayFrom(e);
    const i = board.pickDie(ray);
    if (i >= 0 && (freeDie(i) || mine.marked[i])) {
      e.preventDefault(); // die eigenen Würfel gehören dem Spiel: Klick = herauslegen, Ziehen = Handvoll werfen
      pressed = { i, x: e.clientX, y: e.clientY };
      return;
    }
    if (canRoll() && board.hitCup(ray)) {
      e.preventDefault(); // Becher gehört dem Spiel – sonst würde tisch.js ihn greifen
      grabbing = handled = true;
      canvas.style.cursor = 'grabbing';
      board.setHover(-1);
      rollNow('cup');
      board.drag(ray);
    }
  };
  const onUp = (e) => {
    if (e.button !== 0) return;
    const was = pressed;
    pressed = null;
    if (grabbing) {
      grabbing = false;
      canvas.style.cursor = '';
      board.release();
      return;
    }
    if (was && !handled) dieClicked(was.i);
  };
  const onKey = (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT' || !myTurn()) return;
    e.preventDefault();
    rollNow();
  };

  // --- Anzeige ---
  function render() {
    if (!waiting) board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    const turn = myTurn();
    const canAccuse = v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== mySeat && v.seats.includes(mySeat) && !waiting && !rolling;
    cheat.update({ free: v.free, canAccuse });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.games}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.phase === 'over' && v.winner === mySeat;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const seats = [...(v.seats.length ? v.seats : humans)].sort((a, b) => rel(a) - rel(b));
    const showDice = v.phase === 'play' && v.rolls > 0;
    panel.render({
      round: v.phase === 'setup' ? 'Spielerzahl wählen' : `Partie ${v.games} · ${v.count} am Tisch · Ziel ${fmt(GOAL)}`,
      players: seats.map((p) => ({ name: nameOf(p), score: v.scores[p], turn: v.phase === 'play' && v.turn === p, goal: v.final === p })),
      status: statusText(),
      setup: v.phase === 'setup' && isHost ? setupInfo() : null,
      dice: showDice ? [0, 1, 2, 3, 4, 5].filter((i) => v.where[i] !== 'aside').map((i) => ({
        i, value: v.dice[i], marked: v.marked[i], aside: false, active: turn && (twisting || v.where[i] === 'table'),
      })) : [],
      turn: v.phase === 'play' && v.rolls > 0 ? turnText() : '',
      acts: actions(),
      hint,
      last: log,
      end: v.phase === 'over' ? endInfo() : null,
    });
  }

  function setupInfo() {
    return [2, 3, 4].map((n) => {
      const cpu = n - humans.length;
      return { n, text: cpu ? `${n} (${solo ? 'du + ' : '+ '}${cpu} Computer)` : '2 (ihr zwei)' };
    });
  }

  const junkText = () => {
    const bad = selected(mine).map((i) => mine.dice[i]).filter((d) => d !== 1 && d !== 5);
    return `${[...new Set(bad)].join(' und ')} zählt so nicht – nur Einsen, Fünfen, drei gleiche, Straße oder drei Paare aus diesem Wurf.`;
  };

  function turnText() {
    const v = mine;
    const sel = selected(v);
    const pick = pickOf(v);
    const sum = v.turnPts + pick.points;
    const who = v.turn === mySeat ? 'Dein Zug' : `Zug von ${nameOf(v.turn)}`;
    if (v.bust) return `${who}: Niete – nichts wertet${v.turnPts ? `, ${fmt(v.turnPts)} sind weg` : ''}.`;
    if (!sel.length) return `${who}: ${fmt(v.turnPts)} Punkte`;
    return `${who}: ${fmt(v.turnPts)} + ${fmt(pick.points)} = ${fmt(sum)} Punkte${pick.junk && !v.free ? ' (nicht alles zählt)' : ''}`;
  }

  function actions() {
    const v = mine;
    if (!myTurn()) return [];
    if (v.rolls === 0) return [{ act: 'roll', text: 'Würfeln' }];
    const n = thrownBy(v).filter(Boolean).length;
    const acts = [];
    if (v.bust && v.free) acts.push({ act: 'pass', text: 'Weitergeben' });
    if (!v.bust || v.free) {
      acts.push({ act: 'roll', text: n === 6 && v.rolls > 0 && !v.bust ? 'Mit allen 6 weiter' : `Weiterwürfeln (${n})`, disabled: !canRoll(), secondary: v.bust });
      acts.push({ act: 'bank', text: `Aufhören (+${fmt(v.turnPts + pickOf(v).points)})`, disabled: !canBank(), secondary: v.bust });
    }
    if (v.free) acts.push({ act: 'twist', text: twisting ? 'Drehen aus' : 'Würfel heimlich drehen', secondary: true, on: twisting });
    return acts;
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Wie viele spielen mit?' : `${names.other()} wählt die Spielerzahl …`;
    if (v.phase === 'over') return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (rolling) return 'Die Würfel rollen …';
    const last = v.final !== null ? ' (letzte Runde)' : '';
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ${v.rolls ? 'ist dran' : 'würfelt'} …${last}`;
    if (twisting) return 'Würfel anklicken = eine Zahl weiterdrehen';
    if (v.rolls === 0) return `Du bist dran${last} – Becher greifen, Würfel werfen oder „Würfeln“`;
    if (v.bust) return v.free ? 'Niete! „Weitergeben“ – oder doch …?' : 'Niete!';
    if (!selected(v).length) return 'Wertende Würfel anklicken = herauslegen';
    if (pickOf(v).junk && !v.free) return 'Nicht jeder gewählte Würfel zählt';
    if (v.turnPts + pickOf(v).points < MIN_BANK && !v.free) return `Weiterwürfeln – aufhören geht erst ab ${MIN_BANK}`;
    return 'Weiterwürfeln oder aufhören?';
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'setup') parts.push('Neue Partie – erst die Spielerzahl wählen.');
      else if (e.type === 'start') parts.push(`Los geht's – ${who} ${verb(e.player, 'beginnst', 'beginnt')}.`);
      else if (e.type === 'anschluss') parts.push(`Alle sechs gewertet – ${who} ${verb(e.player, 'würfelst', 'würfelt')} mit allen weiter!`);
      else if (e.type === 'bust') parts.push(`Niete! ${who} ${verb(e.player, 'verlierst', 'verliert')} ${e.lost ? `${fmt(e.lost)} Punkte` : 'den Zug'}.`);
      else if (e.type === 'bank') parts.push(`${who} ${verb(e.player, 'schreibst', 'schreibt')} ${fmt(e.points)} auf.`);
      else if (e.type === 'goal') parts.push(`${who} ${verb(e.player, 'hast', 'hat')} ${fmt(GOAL)}!${events.some((x) => x.type === 'over') ? '' : ' Wer in dieser Runde noch dran ist, hat einen letzten Zug.'}`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'over') parts.push(e.winner === null ? 'Spiel vorbei – Gleichstand an der Spitze.' : `${nameOf(e.winner)} ${verb(e.winner, 'gewinnst', 'gewinnt')}!`);
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      const what = e.kinds.map((k) => CHEAT_NAMES[k]).slice(0, 2).join(' und ');
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${what}: Die Punkte des Zugs sind weg, dazu ${CHEAT_PENALTY} Strafpunkte (−${fmt(e.lost)}).`
        : `Erwischt! ${nameOf(e.player)} hat ${what}: Die Punkte des Zugs sind weg, dazu ${CHEAT_PENALTY} Strafpunkte (−${fmt(e.lost)}).`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig gespielt – du verlierst ${FALSE_ALARM_PENALTY} Punkte.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen: −${FALSE_ALARM_PENALTY} Punkte.`;
  }

  function endInfo() {
    const v = mine;
    const order = [...v.seats].sort((a, b) => v.scores[b] - v.scores[a]);
    const title = v.winner === mySeat ? 'Gewonnen!' : v.winner === null ? 'Gleichstand!' : `${nameOf(v.winner)} ${verb(v.winner, 'gewinnst', 'gewinnt')}`;
    return { title, text: order.map((p, k) => `${k + 1}. ${nameOf(p)} ${fmt(v.scores[p])}`).join(' · '), regroup: isHost };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ humans, free }));
  // main.js setzt nach dem Start die Bedienhinweise zurück – danach einmal neu zeichnen, damit „Ohne Hilfen“ stimmt
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
