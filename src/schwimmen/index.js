// Schwimmen-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Sitze wie bei Doppelkopf: Host 0 (+z), Gast 2 (gegenüber), die freien Sitze spielt der Computer. Zu Beginn wählt der
// Host, wie viele am Tisch sitzen (2–4). Der Host hält den vollen Stand, lässt die Computer handeln und schickt dem
// Gast nur dessen Sicht (viewFor). Der Gast schickt Wünsche (choose, swap, push, knock, claim, accuse, again), der Host
// prüft sie. Tauschen: eigene Karte anklicken, dann eine aus der Mitte (oder umgekehrt) – oder hinziehen.
// free = „Ohne Hilfen“: keine Punkte-Anzeige, 31 deckt keiner von selbst auf („31!“), zwei Karten lassen sich tauschen
// (erst zwei eigene wählen, dann zwei aus der Mitte), der Klopfer kann nachtauschen; „Geschummelt!“ gegen die letzte
// Aktion. Allein schummeln die Computer ab und zu und prüfen jede Aktion des Menschen einmal (schummeln.js).
import {
  newGame, setup, choose, swap, push, knock, claim, again, regroup, accuse, waive, viewFor, points, pointsName, active,
  cardName, BEST, FEUER,
} from './game.js';
import { chooseMove, cheatMove, lateSwap } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { play: 900, accuse: 900 }; // so lange „überlegt“ der Computer, nachdem die Karten liegen
const WATCH_MS = 1500; // ohne Hilfen: so lange länger, damit ein Mensch die letzte Aktion noch anfechten kann
const REL = ['', 'links', 'gegenüber', 'rechts'];

export function startSchwimmen({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let cheered = false;
  let stopped = false;
  let judged = null; // allein ohne Hilfen: zuletzt geprüfte Aktion des Menschen
  let sneak = null; // allein ohne Hilfen: Computer, der nach seinem Klopfen noch tauschen will
  let picked = { hand: [], middle: [] }; // ausgewählte Karten zum Tauschen
  let log = [];

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const shortOf = (seat) => (seat === mySeat ? 'du' : humans.includes(seat) ? names.other() : REL[rel(seat)]);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('sw-panel'), {
    solo,
    onSetup: (n) => act('setup', n),
    onKeep: (keep) => act('choose', keep),
    onAll: () => trySwap(mine.hands[mySeat], mine.middle),
    onPush: () => myTurn() && act('push'),
    onKnock: () => myTurn() && act('knock'),
    onClaim: () => act('claim'),
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine && mine.phase !== 'setup' && !mine.done ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse', mine?.cheat?.player), hint: document.querySelector('[data-game="Schwimmen"] .dock [data-hint]') });

  function apply(type, seat, arg) {
    if (type === 'setup') return setup(state, seat, arg);
    if (type === 'choose') return choose(state, seat, arg);
    if (type === 'swap') return arg && typeof arg === 'object' ? swap(state, seat, arg.give, arg.take) : null;
    if (type === 'push') return push(state, seat);
    if (type === 'knock') return knock(state, seat);
    if (type === 'claim') return claim(state, seat);
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    if (type === 'regroup') return regroup(state, seat);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'deal' || next.phase === 'setup') {
      cheered = false;
      judged = null;
      sneak = null;
      if (next.phase === 'setup' || next.round === 1) log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    // Auswahl: nur, was noch da ist
    const hand = Array.isArray(mine.hands[mySeat]) ? mine.hands[mySeat] : [];
    picked = { hand: picked.hand.filter((c) => hand.includes(c)), middle: picked.middle.filter((c) => mine.middle.includes(c)) };
    if (!canSwap()) picked = { hand: [], middle: [] };
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 2) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again' || type === 'regroup') say(blocked());
      else if (type === 'accuse') say('Zu spät – inzwischen hat ein anderer gespielt.');
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
      if (same && asked === 'again') hint = blocked();
      if (asked === 'accuse' && !msg.state.events.some((e) => e.type === 'caught' || e.type === 'fehlalarm')) hint = 'Zu spät – inzwischen hat ein anderer gespielt.';
      asked = null;
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

  function cpuMove(seat, m) {
    if (m.t === 'choose') return choose(state, seat, m.arg);
    if (m.t === 'swap') return swap(state, seat, m.arg.give, m.arg.take);
    return apply(m.t, seat);
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state) return;
    const s = state;
    const c = s.cheat;
    // Allein ohne Hilfen: Ist die Aktion des Menschen vorbei, prüft sie ein Computer einmal – am Rundenende in jedem Fall:
    // Ruft der Mensch gleich nach seinem Zug „31!“, bleibt es dieselbe offene Aktion; ungeprüft bliebe die Runde liegen
    if (solo && s.free && c?.player === mySeat && (s.phase === 'over' || s.turn !== mySeat) && (c !== judged || s.phase === 'over')) {
      judged = c;
      const by = s.phase === 'play' && isCpu(s.turn) ? s.turn : active(s).find(isCpu) ?? s.seats.find(isCpu);
      return later(THINK_MS.accuse, () => {
        if (cpuAccuses(!state.cheat.legal)) return commit(accuse(state, by));
        if (state.phase === 'over') return commit(waive(state, by));
        schedule();
      });
    }
    if (s.phase !== 'play') sneak = null;
    // Allein ohne Hilfen: der Computer hat geklopft und tauscht gleich noch (Schummeln)
    if (sneak !== null && s.knocker === sneak) {
      const seat = sneak;
      sneak = null;
      return later(THINK_MS.play, () => {
        const m = lateSwap(viewFor(state, seat), seat);
        if (m) commit(cpuMove(seat, m) ?? state);
        else schedule();
      });
    }
    // Ohne Hilfen deckt keiner von selbst auf: Computer mit 31 oder Feuer rufen „31!“
    const lucky = s.free && s.phase === 'play' ? active(s).find((p) => isCpu(p) && points(s.hands[p]) >= BEST && !s.claims.includes(p)) : undefined;
    if (lucky !== undefined) return later(THINK_MS.play, () => commit(claim(state, lucky) ?? state));
    if ((s.phase !== 'play' && s.phase !== 'choose') || !isCpu(s.turn)) return;
    const seat = s.turn;
    const watch = s.free && c && c.player !== seat && humans.some((h) => h !== c.player);
    later(THINK_MS.play + (watch ? WATCH_MS : 0), () => {
      const v = viewFor(state, seat);
      const sly = solo && state.free && cpuCheats() ? cheatMove(v, seat) : null;
      const m = sly ?? chooseMove(v, seat);
      if (m.then) sneak = seat;
      commit(cpuMove(seat, m) ?? push(state, seat) ?? choose(state, seat, true));
    });
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
  const running = () => mine && (mine.phase === 'play' || mine.phase === 'choose') && !waiting;
  const myTurn = () => running() && mine.phase === 'play' && mine.turn === mySeat;
  const inGame = () => !!mine && mine.seats.includes(mySeat) && mine.gone[mySeat] === null;
  // Tauschen geht, wenn ich dran bin – ohne Hilfen auch als Klopfer außer der Reihe
  const canSwap = () => myTurn() || (running() && mine.phase === 'play' && mine.free && mine.knocker === mySeat && inGame());
  const blocked = () => (solo ? 'Der Computer prüft noch …' : `${names.other()} startet die nächste Runde`);

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function notNow() {
    if (!running() || mine.phase !== 'play') return say('Gerade wird nicht getauscht.');
    if (!inGame()) return say('Du bist raus – schau zu.');
    if (mine.knocker === mySeat) return say('Du hast geklopft – jetzt sind die anderen noch einmal dran.');
    return say(`${nameOf(mine.turn)} ist dran.`);
  }

  function trySwap(give, take) {
    if (!canSwap()) return notNow();
    if (!mine.free && (give.length !== take.length || give.length === 2)) return say('Tauschen geht nur mit einer Karte oder allen dreien.');
    picked = { hand: [], middle: [] };
    act('swap', { give: [...give], take: [...take] });
    return true;
  }

  // Auswahl: genauso viele eigene wie Karten aus der Mitte gewählt = tauschen. Mit Hilfen immer nur eine Karte je Seite,
  // ohne Hilfen lassen sich mehrere wählen (erst die eigenen, dann die aus der Mitte).
  function pick(side, id) {
    if (!canSwap()) return notNow();
    const list = picked[side];
    const next = list.includes(id) ? list.filter((c) => c !== id) : mine.free ? [...list, id] : [id];
    picked = { ...picked, [side]: next };
    if (picked.hand.length && picked.hand.length === picked.middle.length) return trySwap(picked.hand, picked.middle);
    hint = '';
    render();
    return true;
  }

  // Karte mit der Hand abgelegt (tisch.js): eigene Karte in die Mitte = gegen die nächstliegende tauschen,
  // Karte aus der Mitte zu mir = gegen die ausgewählte (sonst die nächstliegende) eigene tauschen
  board.onPlace = (mesh, point) => {
    const c = board.cardOf(mesh);
    const zone = board.zoneAt(point);
    if (!c || !canSwap()) return null;
    if (c.from === 'hand' && zone === 'middle') return trySwap([c.id], [board.nearestMiddle(point)]) ? 'move' : 'back';
    if (c.from === 'middle' && zone === 'hand') {
      const own = picked.hand.length === 1 ? picked.hand[0] : board.nearestHand(point);
      return trySwap([own], [c.id]) ? 'move' : 'back';
    }
    return null;
  };

  const onMove = (e) => {
    if (e.buttons & 1) return; // Karte wird gerade gezogen (tisch.js) – sie darf sich nicht unter der Hand bewegen
    const ray = room.rayFrom(e);
    const id = canSwap() ? board.pickHand(ray) : null;
    board.setHover(id);
    canvas.style.cursor = id || (canSwap() && board.pickMiddle(ray)) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const ray = room.rayFrom(e);
    const id = board.pickHand(ray);
    if (id) return pick('hand', id);
    const mid = board.pickMiddle(ray);
    if (mid) pick('middle', mid);
  };

  const onKey = (e) => {
    if (e.key !== 'Escape' || (!picked.hand.length && !picked.middle.length)) return;
    picked = { hand: [], middle: [] };
    render();
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    board.setPicked(picked);
    const canAccuse = v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== mySeat && !waiting;
    cheat.update({ free: v.free, canAccuse });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.phase === 'over' && v.done && v.winner === mySeat;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const seats = [...(v.seats.length ? v.seats : humans)].sort((a, b) => rel(a) - rel(b));
    const turn = myTurn();
    const hand = Array.isArray(v.hands[mySeat]) ? v.hands[mySeat] : [];
    panel.render({
      round: v.phase === 'setup' ? 'Spielerzahl wählen' : `Partie ${v.games} · Runde ${v.round} · ${v.count} am Tisch`,
      players: seats.map((p) => ({
        name: nameOf(p),
        lives: v.phase === 'setup' ? '' : v.gone[p] !== null ? 'raus' : v.lives[p] ? `${v.lives[p]} Leben` : 'schwimmt',
        note: noteOf(p),
        turn: (v.phase === 'play' || v.phase === 'choose') && v.turn === p,
        out: v.phase !== 'setup' && v.gone[p] !== null,
      })),
      status: statusText(),
      hand: !v.free && hand.length === 3 && running() && inGame() ? `Deine Hand: ${valueText(points(hand))}` : '',
      setup: v.phase === 'setup' && isHost ? setupInfo() : null,
      choose: running() && v.phase === 'choose' && v.turn === mySeat,
      actions: v.phase === 'play' && inGame() ? {
        all: canSwap() && v.middle.length === 3,
        push: turn,
        knock: turn && v.knocker === null,
        claim: v.free ? !waiting && !v.claims.includes(mySeat) : null,
      } : null,
      last: log.join(' '),
      hint,
      end: v.phase === 'over' ? endInfo() : null,
    });
  }

  const valueText = (x) => (x === FEUER ? 'Feuer (drei Asse)!' : x === BEST ? '31!' : `${pointsName(x)} Punkte`);

  function noteOf(p) {
    const v = mine;
    if (v.phase === 'over' && v.result?.points[p] !== null && v.result?.points[p] !== undefined) {
      return `${pointsName(v.result.points[p])}${v.claims.includes(p) && v.result.points[p] < BEST ? ' („31!“)' : ''}`;
    }
    if (v.phase === 'setup') return '';
    if (v.knocker === p) return 'klopft';
    return v.dealer === p ? 'gibt' : '';
  }

  function setupInfo() {
    const extra = (k) => (k === 1 ? '1 Computer' : `${k} Computer`);
    return [2, 3, 4].map((n) => {
      const cpu = n - humans.length;
      return { n, text: cpu ? `${n} (${solo ? 'du + ' : '+ '}${extra(cpu)})` : '2 (ihr zwei)' };
    });
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Wie viele spielen mit?' : `${names.other()} wählt die Spielerzahl …`;
    if (v.phase === 'over') return v.done ? 'Partie vorbei' : 'Runde vorbei';
    if (waiting) return 'Wird gesendet …';
    if (v.phase === 'choose') return v.turn === mySeat ? 'Du gibst: diese Karten behalten oder die andere Hand nehmen?' : `${nameOf(v.turn)} gibt und wählt …`;
    if (!inGame()) return `Du bist raus – ${nameOf(v.turn)} ist dran …`;
    if (v.turn !== mySeat) return v.knocker === mySeat ? `Du hast geklopft – ${nameOf(v.turn)} ist noch dran …` : `${nameOf(v.turn)} ist dran …`;
    if (v.knocker !== null) return 'Letzter Zug: tauschen oder schieben';
    return 'Du bist dran: tauschen, schieben oder klopfen';
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      if (e.type === 'setup') parts.push('Neue Partie – erst die Spielerzahl wählen.');
      else if (e.type === 'deal') parts.push(`Runde ${mine.round}: ${nameOf(e.dealer)} ${verb(e.dealer, 'gibst', 'gibt')}.`);
      else if (e.type === 'choose') parts.push(e.keep ? `${nameOf(e.player)} ${verb(e.player, 'behältst', 'behält')} die ersten Karten.` : `${nameOf(e.player)} ${verb(e.player, 'nimmst', 'nimmt')} die andere Hand.`);
      else if (e.type === 'swap') {
        parts.push(e.give.length === 3 ? `${nameOf(e.player)} ${verb(e.player, 'tauschst', 'tauscht')} alle drei.`
          : `${nameOf(e.player)} ${verb(e.player, 'tauschst', 'tauscht')} ${e.give.map(cardName).join(' und ')} gegen ${e.take.map(cardName).join(' und ')}.`);
      } else if (e.type === 'push') parts.push(e.skipped ? `${nameOf(e.player)} ${verb(e.player, 'setzt', 'setzt')} aus.` : `${nameOf(e.player)} ${verb(e.player, 'schiebst', 'schiebt')}.`);
      else if (e.type === 'renew') parts.push(`Alle haben geschoben – neue Mitte${e.mixed ? ' (Stapel neu gemischt)' : ''}.`);
      else if (e.type === 'knock') parts.push(`${nameOf(e.player)} ${verb(e.player, 'klopfst', 'klopft')}!`);
      else if (e.type === 'show') parts.push(`${nameOf(e.player)} ${verb(e.player, 'hast', 'hat')} ${mine.result?.feuer === e.player ? 'Feuer' : '31'}!`);
      else if (e.type === 'claim') parts.push(`${nameOf(e.player)} ${verb(e.player, 'rufst', 'ruft')} „31!“`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${e.why}. Das wird zurückgenommen, du verlierst die Runde (1 Leben).`
        : `Erwischt! ${nameOf(e.player)} hat ${e.why}. Das wird zurückgenommen, ${nameOf(e.player)} verliert die Runde (1 Leben).`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig gespielt – du setzt deinen nächsten Zug aus.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und setzt den nächsten Zug aus.`;
  }

  function endInfo() {
    const v = mine;
    const r = v.result;
    const list = (ps) => ps.map((p) => (p === mySeat ? 'du' : nameOf(p))).join(' und ');
    const why = r.reason === 'caught' ? `${nameOf(r.by)} ${verb(r.by, 'wurdest', 'wurde')} beim Schummeln erwischt. `
      : r.feuer !== null ? `${nameOf(r.feuer)} ${verb(r.feuer, 'hast', 'hat')} Feuer! `
        : r.reason === 'knock' ? `${nameOf(r.by)} ${verb(r.by, 'hast', 'hat')} geklopft. `
          : r.reason === 'claim' ? `${nameOf(r.by)} ${verb(r.by, 'rufst', 'ruft')} „31!“. ` : `${nameOf(r.by)} ${verb(r.by, 'hast', 'hat')} 31! `;
    const cap = (t) => t[0].toUpperCase() + t.slice(1);
    const says = (ps, du, er, sie) => `${cap(list(ps))} ${ps.length > 1 ? sie : ps[0] === mySeat ? du : er}`;
    const swim = r.losers.filter((p) => v.gone[p] === null && v.lives[p] === 0);
    const text = [
      why + (r.losers.length ? `${says(r.losers, 'verlierst', 'verliert', 'verlieren')} ein Leben.` : 'Alle gleich – keiner verliert ein Leben.'),
      swim.length ? `${says(swim, 'schwimmst', 'schwimmt', 'schwimmen')} jetzt.` : '',
      r.out.length ? `${says(r.out, 'bist', 'ist', 'sind')} raus.` : '',
    ].filter(Boolean).join(' ');
    const title = !v.done ? (r.losers.includes(mySeat) ? 'Runde verloren' : 'Runde überstanden')
      : v.winner === mySeat ? 'Du gewinnst die Partie!' : v.winner === null ? 'Partie vorbei' : `${nameOf(v.winner)} ${verb(v.winner, 'gewinnst', 'gewinnt')} die Partie`;
    return { title, text, again: v.done ? 'Neue Partie' : 'Nächste Runde', regroup: isHost };
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
