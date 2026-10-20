// Elfer-raus-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Sitze wie bei Doppelkopf: Host 0 (+z), Gast 2 (gegenüber), die freien Sitze spielt der Computer. Zu Beginn wählt der
// Host, wie viele am Tisch sitzen (2–4). Der Host hält den vollen Stand, lässt die Computer handeln und schickt dem
// Gast nur dessen Sicht (viewFor). Der Gast schickt Wünsche (play, draw, end, accuse, again), der Host prüft sie.
// free = „Ohne Hilfen“: nichts wird abgedunkelt, jede Karte lässt sich legen, ziehen und „Fertig“ gehen immer;
// „Geschummelt!“ gegen den letzten Zug, bis der Nächste etwas tut. Allein schummeln die Computer ab und zu und prüfen
// jeden Zug des Menschen einmal (schummeln.js). Zu zweit warten die Computer etwas länger, solange ein Mensch den
// Zug des anderen noch anfechten kann.
import {
  newGame, setup, play, draw, end, again, regroup, accuse, waive, viewFor, playable, canDraw, canEnd, fits, cardName,
  handSize, DRAW_MAX, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from './game.js';
import { chooseMove, cheatMove } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { play: 650, accuse: 900 }; // so lange „überlegt“ der Computer, nachdem die Karten liegen
const WATCH_MS = 1500; // ohne Hilfen: so lange länger, damit ein Mensch den letzten Zug noch anfechten kann
const REL = ['', 'links', 'gegenüber', 'rechts'];

export function startElferRaus({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
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
  let judged = null; // allein ohne Hilfen: zuletzt geprüfter Zug des Menschen
  let log = [];

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const shortOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : REL[rel(seat)]);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('er-panel'), {
    solo,
    onSetup: (n) => act('setup', n),
    onDraw: () => tryDraw(),
    onEnd: () => act('end'),
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && mine?.phase === 'play' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse', mine?.cheat?.player), hint: document.querySelector('[data-game="Elfer raus"] .dock [data-hint]') });

  function apply(type, seat, arg) {
    if (type === 'setup') return setup(state, seat, arg);
    if (type === 'play') return play(state, seat, arg);
    if (type === 'draw') return draw(state, seat);
    if (type === 'end') return end(state, seat);
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    if (type === 'regroup') return regroup(state, seat);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'deal' || next.phase === 'setup') {
      cheered = false;
      judged = null;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
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
      else if (type === 'accuse') say('Zu spät – inzwischen hat der Nächste gespielt.');
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
      if (asked === 'accuse' && !msg.state.events.some((e) => e.type === 'caught' || e.type === 'fehlalarm')) hint = 'Zu spät – inzwischen hat der Nächste gespielt.';
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
    // Allein ohne Hilfen: Ist der Zug des Menschen vorbei, prüft ihn ein Computer einmal
    if (solo && s.free && c?.player === mySeat && (s.phase === 'over' || s.turn !== mySeat) && c !== judged) {
      judged = c;
      const by = s.phase === 'play' && isCpu(s.turn) ? s.turn : s.seats.find(isCpu);
      return later(THINK_MS.accuse, () => {
        if (cpuAccuses(!state.cheat.legal)) return commit(accuse(state, by));
        if (state.phase === 'over') return commit(waive(state, by));
        schedule();
      });
    }
    if (s.phase !== 'play' || !isCpu(s.turn)) return;
    const seat = s.turn;
    const watch = s.free && c && c.player !== seat && humans.some((h) => h !== c.player);
    later(THINK_MS.play + (watch ? WATCH_MS : 0), () => {
      const v = viewFor(state, seat);
      const sly = solo && state.free && !v.played && !v.drawn && cpuCheats() ? cheatMove(v, seat) : null;
      const m = sly ?? chooseMove(v, seat);
      commit(apply(m.t, seat, m.arg) ?? end(state, seat) ?? draw(state, seat));
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
  const running = () => mine && mine.phase === 'play' && !waiting;
  const myTurn = () => running() && mine.turn === mySeat;
  const blocked = () => (solo ? 'Der Computer prüft den Zug noch …' : `${names.other()} startet die nächste Runde`);

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function tryPlay(card) {
    if (!running()) return false;
    if (mine.turn !== mySeat) return say(`${nameOf(mine.turn)} ist dran.`);
    if (!mine.free && !playable(mine, mySeat).includes(card)) {
      if (mine.drawn) return say('Nach dem Ziehen darf nur die gezogene Karte angelegt werden.');
      return say(`${cardName(card)} passt gerade nirgends an.`);
    }
    act('play', card);
    return true;
  }

  function tryDraw() {
    if (!myTurn()) return false;
    if (!mine.free && !canDraw(mine, mySeat)) {
      if (!mine.talon) return say('Der Stapel ist leer.');
      if (mine.played) return say('Du hast schon angelegt – weiterlegen oder „Fertig“.');
      if (mine.drawn >= DRAW_MAX) return say(`Höchstens ${DRAW_MAX} Karten – jetzt „Passen“.`);
      return say('Es passt eine Karte – ziehen darfst du erst, wenn nichts passt.');
    }
    if (!mine.talon) return say('Der Stapel ist leer.');
    act('draw');
    return true;
  }

  // Karte mit der Hand abgelegt (tisch.js): eigene Karte zu den Reihen = anlegen, oberste Stapelkarte vor mich = ziehen
  board.onPlace = (mesh, point) => {
    const c = board.cardOf(mesh);
    const zone = board.zoneAt(point);
    if (!c || !myTurn()) return null;
    if (c.from === 'hand' && zone === 'rows') return tryPlay(c.id) ? 'move' : 'back';
    if (c.from === 'talon' && zone === 'hand') return tryDraw() ? 'move' : 'back';
    return null;
  };

  const onMove = (e) => {
    const ray = room.rayFrom(e);
    const id = myTurn() ? board.pickHand(ray) : null;
    board.setHover(id);
    canvas.style.cursor = id || (myTurn() && board.hitTalon(ray)) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const ray = room.rayFrom(e);
    const id = board.pickHand(ray);
    if (id) return tryPlay(id);
    if (board.hitTalon(ray)) tryDraw();
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    const turn = myTurn();
    board.setPlayable(!v.free && turn ? playable(v, mySeat) : null);
    const canAccuse = v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== mySeat && !waiting;
    cheat.update({ free: v.free, canAccuse });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.phase === 'over' && v.result.winner === mySeat;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const seats = [...(v.seats.length ? v.seats : humans)].sort((a, b) => rel(a) - rel(b));
    panel.render({
      round: v.phase === 'setup' ? 'Spielerzahl wählen' : `Runde ${v.round} · ${v.count} am Tisch`,
      players: seats.map((p) => ({
        name: nameOf(p),
        cards: v.phase === 'setup' ? null : handSize(v, p),
        score: v.score[p],
        turn: v.phase === 'play' && v.turn === p,
      })),
      status: statusText(),
      setup: v.phase === 'setup' && isHost ? setupInfo() : null,
      actions: v.phase === 'play' ? {
        draw: turn && (v.free ? v.talon > 0 : canDraw(v, mySeat)),
        end: turn && (v.free || canEnd(v, mySeat)),
        endText: v.played ? 'Fertig' : 'Passen',
      } : null,
      last: log.join(' '),
      hint,
      end: v.phase === 'over' ? endInfo() : null,
      list: {
        names: seats.map(shortOf),
        rows: v.list.slice(-8).map((r) => ({ round: r.round, points: seats.map((p) => r.points[p]) })),
        total: seats.map((p) => v.score[p]),
      },
    });
  }

  function setupInfo() {
    const extra = (k) => (k === 1 ? '1 Computer' : `${k} Computer`);
    const counts = [2, 3, 4].map((n) => {
      const cpu = n - humans.length;
      return { n, text: cpu ? `${n} (${solo ? 'du + ' : '+ '}${extra(cpu)})` : '2 (ihr zwei)' };
    });
    return { counts, note: 'Zu zweit ohne Blau (60 Karten), je 20 Karten · zu dritt je 20, zu viert je 15' };
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return isHost ? 'Wie viele spielen mit?' : `${names.other()} wählt die Spielerzahl …`;
    if (v.phase === 'over') return 'Runde vorbei';
    if (waiting) return 'Wird gesendet …';
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ist dran …`;
    if (v.free) return 'Du bist dran';
    if (v.drawn && v.fresh && fits(v.rows, v.fresh)) return `${cardName(v.fresh)} passt – anlegen!`;
    if (v.drawn && canDraw(v, mySeat)) return `Passt nicht – nochmal ziehen (${v.drawn} von ${DRAW_MAX})`;
    if (playable(v, mySeat).length) return v.played ? 'Noch eine anlegen – oder „Fertig“' : 'Du bist dran – leg mindestens eine Karte an';
    if (canDraw(v, mySeat)) return 'Nichts passt – Karte ziehen';
    return 'Nichts passt – „Passen“';
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      if (e.type === 'setup') parts.push('Neue Partie – erst die Spielerzahl wählen.');
      else if (e.type === 'deal') parts.push(`Runde ${mine.round}: ${nameOf(e.starter)} ${verb(e.starter, 'legst', 'legt')} ${cardName(e.first)} aus.`);
      else if (e.type === 'play') parts.push(`${nameOf(e.player)} ${verb(e.player, 'legst', 'legt')} ${cardName(e.card)} an.`);
      else if (e.type === 'draw' && e.why !== 'strafe') parts.push(`${nameOf(e.player)} ${verb(e.player, 'ziehst', 'zieht')} ${e.card ? cardName(e.card) : 'eine Karte'}.`);
      else if (e.type === 'end' && !e.played) parts.push(`${nameOf(e.player)} ${verb(e.player, 'passt', 'passt')}.`);
      else if (e.type === 'over') parts.push(e.out ? `${nameOf(e.winner)} ${verb(e.winner, 'bist', 'ist')} raus!` : 'Nichts geht mehr – Runde vorbei.');
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    const why = e.why ? `: ${e.why}` : '';
    if (e.type === 'caught') {
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast geschummelt${why}. Dein Zug wird zurückgenommen, dazu ${CHEAT_PENALTY} Strafkarten.`
        : `Erwischt! ${nameOf(e.player)} hat geschummelt${why}. Der Zug wird zurückgenommen, dazu ${CHEAT_PENALTY} Strafkarten.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig gespielt – du ziehst ${FALSE_ALARM_PENALTY} Strafkarte.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und zieht ${FALSE_ALARM_PENALTY} Strafkarte.`;
  }

  function endInfo() {
    const r = mine.result;
    const others = mine.seats.filter((p) => !r.out || p !== r.winner).sort((a, b) => rel(a) - rel(b));
    const title = r.winner === mySeat ? 'Elfer raus! Du gewinnst!' : r.winner === null ? 'Keiner gewinnt' : `${nameOf(r.winner)} gewinnt`;
    const lead = Math.min(...mine.seats.map((p) => mine.score[p]));
    const leaders = mine.seats.filter((p) => mine.score[p] === lead).map((p) => (p === mySeat ? 'du' : nameOf(p)));
    const text = `${r.out ? '' : 'Nichts ging mehr. '}Restpunkte: ${others.map((p) => `${shortOf(p)} ${r.points[p]}`).join(', ')}. `
      + `Vorn (wenigste Punkte): ${leaders.join(' und ')}.`;
    return { title, text, regroup: isHost };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
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
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
