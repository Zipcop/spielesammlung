// Kabo-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Sitze wie bei Schwimmen: Host 0 (+z), Gast 2 (gegenüber), die freien Sitze spielt der Computer. Zu Beginn wählt der
// Host, wie viele am Tisch sitzen (2–4). Der Host hält den vollen Stand, lässt die Computer handeln und schickt dem
// Gast nur dessen Sicht (viewFor). Der Gast schickt Wünsche (ready, draw, take, place, drop, ability, done, kabo, sneak,
// accuse, again, regroup), der Host prüft sie. Bedienung: Stapel anklicken = ziehen, Ablage anklicken und dann eine
// eigene Karte = nehmen; gezogene Karte: eigene Karte anklicken = tauschen, Ablage anklicken = ablegen; Fähigkeit:
// Karten anklicken. Oder Karten mit der Hand hinlegen (tisch.js → onPlace).
// Abwerfen (snap): eigene Karte auf die Ablage ziehen – außerhalb des eigenen Zugs reicht ein Klick auf die eigene
// Karte. Der Computer wirft nur sicher bekannte Karten ab, nach 0,8–2 s Reaktionszeit; seinen Zug beginnt er frühestens
// 2 s, nachdem eine Karte offen auf die Ablage kam, damit Menschen eine Chance haben.
// free = „Ohne Hilfen“: nach jedem Ablegen der Schritt „Fähigkeit“ mit allen vier Fähigkeiten, „Heimlich ansehen“, Kabo
// jederzeit, gesperrte Karten tauschbar; „Geschummelt!“ gegen den letzten Zug. Allein schummeln die Computer ab und zu
// und prüfen jeden Zug des Menschen einmal (schummeln.js).
import {
  newGame, setup, ready, draw, take, place, drop, ability, done, kabo, sneak, snap, again, regroup, accuse, waive, viewFor,
  powerOf, cardName, valueOf, MISS, CAUGHT, FALSE_ALARM, GOAL, EMPTY,
} from './game.js';
import { chooseMove, cheatMove, snapMove } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { play: 900, look: 1300, accuse: 900 }; // so lange „überlegt“ der Computer, nachdem die Karten liegen
const WATCH_MS = 1500; // ohne Hilfen: so lange länger, damit ein Mensch den letzten Zug noch anfechten kann
const SNAP_MS = 2000; // Abwurf-Frist: so lange wartet der Computer, bevor er nach einer offenen Karte seinen Zug beginnt
const REACT_MS = [800, 2000]; // Reaktionszeit des Computers beim Abwerfen (zufällig dazwischen)
const REL = ['', 'links', 'gegenüber', 'rechts'];
const KIND_LABEL = { own: 'Eigene ansehen', other: 'Fremde ansehen', swap: 'Blind tauschen', king: 'König: beide ansehen' }; // wie im Seitenfeld
const POWER_TEXT = { own: 'eine eigene Karte ansehen', other: 'eine fremde Karte ansehen', swap: 'eine eigene gegen eine fremde blind tauschen', king: 'eine eigene und eine fremde ansehen, dann wahlweise tauschen' };

export function startKabo({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let lastArg = null; // Gast: Inhalt des letzten Wunsches
  let timer = null;
  let snapPlan = null; // Host: geplanter Abwurf eines Computers { key, timer }
  let hint = '';
  let cheered = false;
  let stopped = false;
  let judged = null; // allein ohne Hilfen: zuletzt geprüfter Zug des Menschen
  let picked = []; // ausgewählte Stellen (Ablage zum Nehmen, Karten für eine Fähigkeit)
  let kind = null; // ohne Hilfen: gewählte Fähigkeit
  let sneaking = false; // ohne Hilfen: „Heimlich ansehen“ gedrückt
  let log = [];

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);
  const whose = (p) => (p === mySeat ? 'deine' : `von ${nameOf(p)}`);

  const panel = createPanel($('kb-panel'), {
    solo,
    onSetup: (n) => act('setup', n),
    onReady: () => act('ready'),
    onDraw: () => myStep('start') && act('draw'),
    onTake: () => myStep('start') && toggleTake(),
    onKabo: () => myStep('start') && act('kabo'),
    onDrop: () => myStep('drawn') && act('drop'),
    onKind: (k) => chooseKind(k),
    onSkip: () => myStep('power') && act('done', false),
    onSeen: () => myStep('look') && act('done', false),
    onKing: (swap) => myStep('look') && act('done', swap),
    onSneak: () => toggleSneak(),
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine && mine.phase !== 'setup' && !mine.done ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse', mine?.cheat?.player), hint: document.querySelector('[data-game="Kabo"] .dock [data-hint]') });

  function apply(type, seat, arg) {
    if (type === 'setup') return setup(state, seat, arg);
    if (type === 'ready') return ready(state, seat);
    if (type === 'draw') return draw(state, seat);
    if (type === 'take') return take(state, seat, arg);
    if (type === 'place') return place(state, seat, arg);
    if (type === 'drop') return drop(state, seat);
    if (type === 'ability') return arg && typeof arg === 'object' ? ability(state, seat, arg) : null;
    if (type === 'done') return done(state, seat, arg === true);
    if (type === 'kabo') return kabo(state, seat);
    if (type === 'sneak') return arg && typeof arg === 'object' ? sneak(state, seat, arg) : null;
    if (type === 'snap') return arg && typeof arg === 'object' ? snap(state, seat, arg.i, undefined, arg.top) : null;
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    if (type === 'regroup') return regroup(state, seat);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'deal' || next.phase === 'setup') {
      cheered = false;
      judged = null;
      if (next.phase === 'setup' || next.round === 1) log = [];
    }
    const fresh = next.seq !== state?.seq;
    const before = mine;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    // Auswahl gilt nur innerhalb eines Schritts
    if (!before || before.step !== mine.step || before.turn !== mine.turn || before.phase !== mine.phase) {
      picked = [];
      kind = mine.power ?? null;
      sneaking = false;
    }
    if (!myTurn()) sneaking = false;
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 2) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
    planSnap();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again' || type === 'regroup') say(blocked());
      else if (type === 'accuse') say('Zu spät – inzwischen hat ein anderer gespielt.');
      else if (lockedTry(type, arg)) say('Die Karten des Kabo-Rufers sind gesperrt – mit ihnen tauscht keiner.');
      else if (type === 'snap') say(snapNot());
      else render();
    } else {
      waiting = true;
      asked = type;
      lastArg = arg;
      send({ t: type, arg });
      render();
    }
  }

  // Wollte ich (mit Hilfen) mit einer gesperrten Karte des Rufers tauschen?
  function lockedTry(type, arg) {
    if (!mine || mine.caller === null) return false;
    if (type === 'ability') return arg?.kind === 'swap' && arg.other?.p === mine.caller;
    return type === 'done' && arg === true && mine.look?.spots[1]?.p === mine.caller;
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      const verdict = msg.state.events.some((e) => e.type === 'caught' || e.type === 'fehlalarm');
      // Neuer Stand, derselbe Zug noch anfechtbar (z. B. der nächste Schritt des Computers): Das Urteil kommt noch.
      // Die Antwort selbst ist entweder das Urteil oder – ungültig – der Stand, den ich schon habe (same).
      const pending = asked === 'accuse' && !same && !verdict && msg.state.cheat?.player === lastArg;
      waiting = pending;
      setState(msg.state);
      if (same && asked === 'again') hint = blocked();
      if (asked === 'accuse' && !verdict && !pending) hint = 'Zu spät – inzwischen hat ein anderer gespielt.';
      if (same && lockedTry(asked, lastArg)) hint = 'Die Karten des Kabo-Rufers sind gesperrt – mit ihnen tauscht keiner.';
      if (same && asked === 'snap') hint = snapNot();
      if (!pending) asked = null;
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 2, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 2) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Computer (nur beim Host) ---
  const isCpu = (seat) => !humans.includes(seat);

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state) return;
    const s = state;
    const c = s.cheat;
    // Allein ohne Hilfen: Ist der Zug des Menschen vorbei, prüft ihn ein Computer einmal – am Rundenende in jedem Fall
    // judged erst, wenn wirklich geprüft ist – bis dahin wartet auch ein Abwurf des Computers (planSnap)
    if (solo && s.free && c?.player === mySeat && !c.snap && (s.phase === 'over' || s.turn !== mySeat) && (c !== judged || s.phase === 'over')) {
      const by = s.phase === 'play' && isCpu(s.turn) ? s.turn : s.seats.find(isCpu);
      return later(THINK_MS.accuse, () => {
        judged = c;
        if (cpuAccuses(!state.cheat.legal)) return commit(accuse(state, by));
        if (state.phase === 'over') return commit(waive(state, by));
        schedule();
      });
    }
    if (s.phase !== 'play' || !isCpu(s.turn)) return;
    const seat = s.turn;
    const watch = s.free && c && c.player !== seat && humans.some((h) => h !== c.player) && s.step === 'start';
    const wait = (s.step === 'look' ? THINK_MS.look : THINK_MS.play) + (watch ? WATCH_MS : 0);
    later(s.step === 'start' && s.snapOpen ? Math.max(wait, SNAP_MS) : wait, () => {
      const v = viewFor(state, seat);
      const sly = solo && state.free && cpuCheats() ? cheatMove(v, seat) : null;
      const m = sly ?? chooseMove(v, seat);
      commit(apply(m.t, seat, m.arg) ?? apply('done', seat, false) ?? apply('draw', seat) ?? state);
    });
  }

  // Abwerfen der Computer: Kennt einer eine passende Karte, wirft er sie nach seiner Reaktionszeit ab. Der Plan gilt für
  // die oberste Ablagekarte (key) – Züge dazwischen (Fähigkeit, „Fertig“) halten ihn nicht auf. Ohne Hilfen wartet er,
  // solange ein Mensch den Zug eines anderen noch anfechten könnte (ein Abwurf beendet diese Frist).
  function planSnap() {
    if (stopped || !isHost || !state) return;
    const s = state;
    const key = s.phase === 'play' && s.snapOpen ? `${s.round}-${s.discard.length}-${s.discard.at(-1)}` : null;
    if (snapPlan && snapPlan.key === key) return;
    clearTimeout(snapPlan?.timer);
    snapPlan = null;
    if (!key) return;
    const who = s.seats.filter((p) => isCpu(p) && snapMove(viewFor(s, p), p));
    if (!who.length) return;
    const seat = who[Math.floor(Math.random() * who.length)];
    const ms = REACT_MS[0] + Math.random() * (REACT_MS[1] - REACT_MS[0]);
    const fire = () => {
      if (stopped || !state) return;
      const c = state.cheat;
      const open = state.free && c && !c.snap && c.player !== seat && humans.some((h) => h !== c.player);
      const judging = solo && state.free && c && !c.snap && c.player === mySeat && c !== judged; // erst prüft er den Menschen
      if (judging || (open && Date.now() - planned < WATCH_MS + 500)) return (snapPlan.timer = setTimeout(fire, 300));
      snapPlan = null;
      const m = snapMove(viewFor(state, seat), seat);
      const next = m && snap(state, seat, m.arg);
      if (next) commit(next);
      else planSnap();
    };
    const planned = Date.now();
    snapPlan = { key, timer: setTimeout(fire, ms) };
  }

  // Erst wenn die Karten liegen, kurz überlegen, dann handeln (solange ändert niemand etwas am Stand)
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
  const running = () => !!mine && (mine.phase === 'play' || mine.phase === 'peek') && !waiting;
  const myTurn = () => running() && mine.phase === 'play' && mine.turn === mySeat;
  const myStep = (step) => myTurn() && mine.step === step;
  const allMoved = () => mine.seats.every((p) => mine.moved.includes(p));
  const blocked = () => (solo ? 'Der Computer prüft noch …' : `${names.other()} startet die nächste Runde`);
  const same = (a, b) => a.zone === b.zone && a.p === b.p && a.i === b.i;
  const kindNow = () => (mine.free ? kind : mine.power);
  // Darf ich gerade abwerfen? (Frist offen, ich spiele mit und habe nicht „Kabo!“ gerufen)
  const canSnap = () => running() && mine.phase === 'play' && mine.snapOpen && mine.seats.includes(mySeat) && mine.caller !== mySeat;
  const top = () => mine.discard.at(-1);

  function snapNot() {
    if (mine?.caller === mySeat) return 'Du hast „Kabo!“ gerufen – deine Karten sind gesperrt.';
    if (mine?.phase === 'play' && mine.snapOpen) return 'Zu spät – inzwischen liegt eine andere Karte oben.';
    return 'Abwerfen geht gerade nicht – der Nächste hat schon angefangen.';
  }

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function notNow() {
    if (!mine || mine.phase === 'over' || mine.phase === 'setup') return say('');
    if (mine.phase === 'peek') return say(mine.ready.includes(mySeat) ? 'Warte, bis alle ihre Karten angesehen haben.' : 'Erst deine beiden nahen Karten ansehen, dann „Gesehen“.');
    return say(`${nameOf(mine.turn)} ist dran.`);
  }

  function toggleTake() {
    const on = picked.some((x) => x.zone === 'discard');
    picked = on ? [] : [{ zone: 'discard' }];
    hint = on ? '' : 'Jetzt die eigene Karte anklicken, die dafür auf die Ablage kommt.';
    render();
  }

  function chooseKind(k) {
    if (!myStep('power') || !mine.free) return;
    kind = kind === k ? null : k;
    picked = [];
    render();
  }

  function toggleSneak() {
    if (!myTurn() || !mine.free) return;
    sneaking = !sneaking;
    render();
  }

  // Fähigkeit mit den gewählten Karten auslösen, sobald genug gewählt ist
  function tryAbility() {
    const k = kindNow();
    const own = picked.find((x) => x.p === mySeat);
    const other = picked.find((x) => x.p !== mySeat);
    if (k === 'own' && own) return act('ability', { kind: k, own: own.i });
    if (k === 'other' && other) return act('ability', { kind: k, other: { p: other.p, i: other.i } });
    if ((k === 'swap' || k === 'king') && own && other) return act('ability', { kind: k, own: own.i, other: { p: other.p, i: other.i } });
    render();
  }

  // Klick (oder hingelegte Karte) auf eine Stelle
  function choose(slot) {
    if (!running() || !slot) return;
    // außerhalb des eigenen Zugs: Klick auf eine eigene Karte = abwerfen
    if (!myTurn() && slot.zone === 'hand' && slot.p === mySeat && canSnap()) return act('snap', { i: slot.i, top: top() });
    if (!myTurn()) return notNow();
    if (sneaking) {
      if (slot.zone !== 'hand') return say('Heimlich ansehen: eine Karte im Raster anklicken.');
      sneaking = false;
      return act('sneak', { p: slot.p, i: slot.i });
    }
    const step = mine.step;
    if (step === 'start') {
      if (slot.zone === 'talon') return act('draw');
      if (slot.zone === 'discard') return toggleTake();
      if (slot.zone === 'hand' && slot.p === mySeat && picked.some((x) => x.zone === 'discard')) return act('take', slot.i);
      return say('Stapel anklicken = ziehen · Ablage anklicken, dann eine eigene Karte = nehmen.');
    }
    if (step === 'drawn') {
      if (slot.zone === 'hand' && slot.p === mySeat) return act('place', slot.i);
      if (slot.zone === 'discard') return act('drop');
      return say('Eigene Karte anklicken = gegen die gezogene tauschen · Ablage anklicken = ablegen.');
    }
    if (step === 'power') {
      const k = kindNow();
      if (!k) return say('Erst eine Fähigkeit wählen – oder „Fertig“.');
      if (slot.zone !== 'hand') return say('Karten im Raster anklicken.');
      if (k === 'own' && slot.p !== mySeat) return say('Eine deiner eigenen Karten anklicken.');
      if (k === 'other' && slot.p === mySeat) return say('Eine Karte eines anderen anklicken.');
      const side = (x) => x.p === mySeat;
      const was = picked.find((x) => same(x, slot));
      picked = was ? picked.filter((x) => x !== was) : [...picked.filter((x) => side(x) !== side(slot)), slot];
      hint = '';
      return tryAbility();
    }
    if (step === 'look' && mine.look?.kind !== 'king') return act('done', false);
    return render();
  }

  // Karte mit der Hand abgelegt (tisch.js): gezogene Karte auf eine eigene = tauschen, auf die Ablage = ablegen;
  // oberste Ablagekarte auf eine eigene = nehmen; Stapelkarte zu sich = ziehen
  board.onPlace = (mesh, point) => {
    const from = board.slotOfMesh(mesh);
    const to = board.slotAt(point);
    if (!from) return null;
    // eigene Karte auf die Ablage = abwerfen (auch außer der Reihe)
    if (from.zone === 'hand' && from.p === mySeat && to?.zone === 'discard') {
      if (!canSnap()) return (say(snapNot()), 'back');
      return (act('snap', { i: from.i, top: top() }), 'move');
    }
    if (!myTurn()) return from.zone === 'hand' ? 'back' : null;
    const own = to?.zone === 'hand' && to.p === mySeat;
    if (from.zone === 'drawn' && mine.step === 'drawn' && (own || to?.zone === 'discard')) return (act(own ? 'place' : 'drop', own ? to.i : undefined), 'move');
    if (from.zone === 'discard' && mine.step === 'start' && own) return (act('take', to.i), 'move');
    if (from.zone === 'talon' && mine.step === 'start' && to?.zone !== 'talon') return (act('draw'), 'move');
    return from.zone === 'hand' ? 'back' : null;
  };

  // Was lässt sich gerade anklicken?
  function clickable(slot) {
    if (slot && !myTurn() && slot.zone === 'hand' && slot.p === mySeat) return canSnap();
    if (!slot || !myTurn()) return false;
    if (sneaking) return slot.zone === 'hand';
    const step = mine.step;
    if (step === 'start') return slot.zone === 'talon' || slot.zone === 'discard' || (slot.zone === 'hand' && slot.p === mySeat && picked.length > 0);
    if (step === 'drawn') return slot.zone === 'discard' || (slot.zone === 'hand' && slot.p === mySeat);
    if (step === 'power') {
      const k = kindNow();
      return slot.zone === 'hand' && !!k && (k === 'own' ? slot.p === mySeat : k === 'other' ? slot.p !== mySeat : true);
    }
    return step === 'look' && mine.look?.kind !== 'king' && slot.zone === 'hand';
  }

  const onMove = (e) => {
    if (e.buttons & 1) return; // Karte wird gerade gezogen (tisch.js) – sie darf sich nicht unter der Hand bewegen
    const slot = board.pick(room.rayFrom(e));
    const ok = clickable(slot);
    board.setHover(ok ? slot : null);
    canvas.style.cursor = ok ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const slot = board.pick(room.rayFrom(e));
    if (slot) choose(slot);
  };

  const onKey = (e) => {
    if (e.key !== 'Escape' || (!picked.length && !sneaking)) return;
    picked = [];
    sneaking = false;
    hint = '';
    render();
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    const at = v.seats.length ? v.seats : humans;
    board.names(seatLabels(4, { mySeat, humans, me: names.me(), other: names.other(), cpu: nameOf, taken: (s) => at.includes(s) }), v.phase === 'play' ? v.turn : null);
    board.setPicked(picked);
    const canAccuse = v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== mySeat && !waiting;
    cheat.update({ free: v.free, canAccuse });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.phase === 'over' && v.done && v.winners.includes(mySeat);
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const seats = [...at].sort((a, b) => rel(a) - rel(b));
    const step = myTurn() ? v.step : null;
    const k = step === 'power' ? kindNow() : null;
    panel.render({
      round: v.phase === 'setup' ? 'Spielerzahl wählen' : `Partie ${v.games} · Runde ${v.round} · ${v.count} am Tisch · bis ${GOAL}`,
      players: seats.map((p) => ({
        name: nameOf(p),
        score: v.phase === 'setup' ? '' : String(v.scores[p]),
        note: noteOf(p),
        turn: v.phase === 'play' && v.turn === p,
      })),
      status: statusText(),
      card: cardText(),
      setup: v.phase === 'setup' && isHost ? setupInfo() : null,
      peek: running() && v.phase === 'peek' && !v.ready.includes(mySeat),
      start: step === 'start' ? { draw: true, take: true, taking: picked.some((x) => x.zone === 'discard'), kabo: v.caller === null && (v.free || allMoved()) } : null,
      drawn: step === 'drawn',
      power: step === 'power' ? { kinds: v.free ? ['own', 'other', 'swap', 'king'] : null, kind: k, skip: v.free ? 'Fertig' : 'Überspringen' } : null,
      look: step === 'look' ? (v.look?.kind === 'king' && (v.free || v.look.spots[1].p !== v.caller) ? 'king' : 'seen') : null,
      sneak: v.free && v.phase === 'play' && v.seats.includes(mySeat) ? { on: sneaking, enabled: myTurn() } : null,
      snap: canSnap() && Array.isArray(v.hands[mySeat]) && v.hands[mySeat].some((c) => c !== EMPTY)
        ? `Abwerfen: Hast du auch ${rankName(top())}? Eigene Karte auf die Ablage ziehen${myTurn() ? '' : ' oder anklicken'} – falsch = Strafkarte.` : '',
      last: log.join(' '),
      hint,
      end: v.phase === 'over' ? endInfo() : null,
    });
  }

  function noteOf(p) {
    const v = mine;
    if (v.phase === 'setup') return '';
    if (v.phase === 'over' && v.result) {
      const pts = v.result.points[p];
      return `${v.result.caller === p ? 'Kabo ' : ''}${v.result.sums[p]} → ${pts < 0 ? pts : `+${pts}`}`;
    }
    const parts = [];
    if (v.caller === p) parts.push('Kabo!');
    if (v.fines[p]) parts.push(`Strafe +${v.fines[p]}`);
    if (v.phase === 'peek' && !v.ready.includes(p)) parts.push(verb(p, 'siehst nach', 'sieht nach'));
    return parts.join(' · ');
  }

  function setupInfo() {
    return [2, 3, 4].map((n) => {
      const cpu = n - humans.length;
      return { n, text: cpu ? `${n} (${solo ? 'du + ' : '+ '}${cpu} Computer)` : '2 (ihr zwei)' };
    });
  }

  // Gezogene oder gerade angesehene Karte(n) in Worten (nur mit Hilfen – ohne Hilfen zeigt nur der Tisch die Karte)
  function cardText() {
    const v = mine;
    if (v.free || !myTurn()) return '';
    if (v.step === 'drawn' && v.drawn) {
      const pw = powerOf(v.drawn);
      return `Gezogen: ${cardName(v.drawn)} (${valueOf(v.drawn)})${pw ? ` – abgelegt: ${POWER_TEXT[pw]}` : ''}`;
    }
    if (v.step === 'power' && v.power) return `${cardName(v.discard.at(-1))}: ${POWER_TEXT[v.power]} – Karten anklicken`;
    if (v.step === 'look' && v.look) {
      const list = v.look.spots.map((x) => `${cardName(v.hands[x.p][x.i])} (${whose(x.p)})`);
      return `Angesehen: ${list.join(' und ')}`;
    }
    return '';
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Wie viele spielen mit?' : `${names.other()} wählt die Spielerzahl …`;
    if (v.phase === 'over') return v.done ? 'Partie vorbei' : 'Runde vorbei';
    if (waiting) return 'Wird gesendet …';
    if (v.phase === 'peek') return v.ready.includes(mySeat) ? 'Warte auf die anderen …' : 'Sieh dir deine beiden nahen Karten an und merk sie dir!';
    if (v.turn !== mySeat) {
      if (v.look && v.look.seat === v.turn) return `${nameOf(v.turn)} sieht ${v.look.spots.length > 1 ? 'zwei Karten' : 'eine Karte'} an …`;
      return v.caller !== null ? `${nameOf(v.turn)} hat den letzten Zug …` : `${nameOf(v.turn)} ist dran …`;
    }
    const last = v.caller !== null ? 'Letzter Zug: ' : '';
    if (sneaking) return 'Heimlich ansehen: Karte anklicken';
    if (v.step === 'start') return `${last}ziehen, Ablage nehmen${v.caller === null ? ' oder „Kabo!“' : ''}`;
    if (v.step === 'drawn') return 'Eigene Karte anklicken = tauschen · Ablage = ablegen';
    if (v.step === 'power') {
      const k = kindNow();
      if (!k) return 'Fähigkeit wählen – oder „Fertig“';
      return `${KIND_LABEL[k]}: ${k === 'own' ? 'eigene Karte' : k === 'other' ? 'fremde Karte' : 'eigene und fremde Karte'} anklicken`;
    }
    if (v.step === 'look') {
      if (v.look?.kind !== 'king') return 'Gut merken – dann „Gemerkt“';
      return v.free || v.look.spots[1].p !== v.caller ? 'Tauschen oder nicht?' : 'Karte des Kabo-Rufers: nur ansehen – dann „Gemerkt“';
    }
    return '';
  }

  // Rang der Karte mit Artikel für den Abwurf-Hinweis (Farbe egal): „eine 7“, „eine Dame“, „einen König“, „ein Ass“
  function rankName(c) {
    const r = c?.[0] === 'x' ? 'Joker' : cardName(c).split(' ').slice(1).join(' ');
    return `${r === 'Ass' ? 'ein' : ['König', 'Bube', 'Joker'].includes(r) ? 'einen' : 'eine'} ${r}`;
  }

  const spotText = (x) => `${x.i < 2 ? 'nahe' : 'hintere'} Karte ${x.p === mySeat ? 'von dir' : `von ${nameOf(x.p)}`}`;

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'setup') parts.push('Neue Partie – erst die Spielerzahl wählen.');
      else if (e.type === 'deal') parts.push(`Runde ${mine.round}: Alle sehen ihre beiden nahen Karten an. ${nameOf(e.starter)} ${verb(e.starter, 'fängst', 'fängt')} an.`);
      else if (e.type === 'start') parts.push(`Los geht’s – ${nameOf(e.player)} ${verb(e.player, 'bist', 'ist')} dran.`);
      else if (e.type === 'mixed') parts.push('Stapel leer – die Ablage wird gemischt.');
      else if (e.type === 'draw') parts.push(`${who} ${verb(e.player, 'ziehst', 'zieht')}.`);
      else if (e.type === 'place') parts.push(`${who} ${verb(e.player, 'tauschst', 'tauscht')} – ${cardName(e.card)} kommt auf die Ablage.`);
      else if (e.type === 'drop') parts.push(`${who} ${verb(e.player, 'legst', 'legt')} ${cardName(e.card)} ab.`);
      else if (e.type === 'take') parts.push(`${who} ${verb(e.player, 'nimmst', 'nimmt')} ${cardName(e.card)} von der Ablage, ${cardName(e.old)} kommt dafür hin.`);
      else if (e.type === 'look') parts.push(`${who} ${verb(e.player, 'siehst', 'sieht')} ${e.spots.map(spotText).join(' und ')} an.`);
      else if (e.type === 'swap') parts.push(`${who} ${verb(e.player, 'tauschst', 'tauscht')} ${e.king ? '' : 'blind '}mit ${e.other.p === mySeat ? 'dir' : nameOf(e.other.p)}.`);
      else if (e.type === 'skip') parts.push(`${who} ${verb(e.player, 'nutzt', 'nutzt')} die Fähigkeit nicht.`);
      else if (e.type === 'kabo') parts.push(`${who} ${verb(e.player, 'rufst', 'ruft')} „Kabo!“ – jeder andere hat noch einen Zug.`);
      else if (e.type === 'sneak') parts.push('Du siehst heimlich eine Karte an.');
      else if (e.type === 'snap') {
        parts.push(e.ok ? `${who} ${verb(e.player, 'wirfst', 'wirft')} ${cardName(e.card)} ab – passt!`
          : `${who} ${verb(e.player, 'wirfst', 'wirft')} ${cardName(e.card)} ab – passt nicht! Sie geht zurück${e.penalty === null ? '.' : ', dazu eine Strafkarte.'}`);
      }
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${e.why}. Der Zug wird zurückgenommen, du setzt ihn aus und bekommst ${CAUGHT} Strafpunkte.`
        : `Erwischt! ${nameOf(e.player)} hat ${e.why}. Der Zug wird zurückgenommen, ${nameOf(e.player)} setzt ihn aus und bekommt ${CAUGHT} Strafpunkte.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig gespielt – du bekommst ${FALSE_ALARM} Strafpunkte.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt ${FALSE_ALARM} Strafpunkte.`;
  }

  function endInfo() {
    const v = mine;
    const r = v.result;
    const caller = r.caller;
    const why = caller === null ? '' : r.alone ? `${nameOf(caller)} ${verb(caller, 'hast', 'hat')} „Kabo!“ gerufen und allein am wenigsten – ${verb(caller, 'du schreibst', 'er schreibt')} 0. `
      : `${nameOf(caller)} ${verb(caller, 'hast', 'hat')} „Kabo!“ gerufen, aber nicht allein am wenigsten – Summe + ${MISS}. `;
    const fined = v.seats.filter((p) => r.fines[p]);
    const text = why + (fined.length ? `Strafpunkte: ${fined.map((p) => `${nameOf(p)} +${r.fines[p]}`).join(', ')}. ` : '')
      + (v.done ? `Stand: ${[...v.seats].sort((a, b) => v.scores[a] - v.scores[b]).map((p) => `${nameOf(p)} ${v.scores[p]}`).join(' · ')}` : '');
    const wins = v.winners;
    const title = !v.done ? (r.points[mySeat] === Math.min(...v.seats.map((p) => r.points[p])) ? 'Gute Runde!' : 'Runde vorbei')
      : wins.length > 1 ? (wins.includes(mySeat) ? 'Gleichstand – ihr gewinnt gemeinsam' : 'Partie vorbei')
        : wins[0] === mySeat ? 'Du gewinnst die Partie!' : `${nameOf(wins[0])} ${verb(wins[0], 'gewinnst', 'gewinnt')} die Partie`;
    return { title, text: text.trim(), again: v.done ? 'Neue Partie' : 'Nächste Runde', regroup: isHost };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ humans, free }));
  // main.js setzt nach dem Start die Bedienhinweise zurück – danach einmal neu zeichnen, damit „Ohne Hilfen“ stimmt
  setTimeout(() => !stopped && render());

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => mine,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      clearTimeout(snapPlan?.timer);
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
