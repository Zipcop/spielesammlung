// Mäxchen-Partie: verbindet Spielstand (game.js), Tisch mit Becher (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Vier Sitze wie bei Doppelkopf: Host 0, Gast 2 (gegenüber), die freien spielt der Computer (allein: 1, 2, 3).
// Der Host hält den vollen Stand, lässt die Computer handeln (und würfelt für sie mit Physik) und schickt dem Gast
// nur dessen Sicht (viewFor). Der Gast würfelt selbst mit Physik und schickt Wünsche (roll mit den Augen, announce,
// believe, doubt, accept, peek, accuse, again) – der Host prüft sie. Becherlagen laufen als 'mx' direkt zum anderen PC.
// free = „Ohne Hilfen“: alle Ansagen wählbar, „Nochmal würfeln“ und „Unter den Becher linsen“; „Geschummelt!“ gegen
// einen gewählten Spieler. Allein schummeln die Computer ab und zu selbst (nachwürfeln, linsen) und prüfen jeden
// Schummelzug des Menschen einmal (schummeln.js).
import {
  newGame, roll, announce, believe, doubt, accept, peek, accuse, again, waive, viewFor, valueOf, claimName, higher, lastClaim,
  alive, CLAIMS, MAEXCHEN, CHEAT_NAMES, SEATS,
} from './game.js';
import { chooseClaim, chooseDecision, wantsReroll, wantsPeek, observe } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { roll: 650, announce: 900, decide: 1100, accuse: 900, round: 2600 }; // so lange „überlegt“ der Computer
const REL = ['', 'links', 'gegenüber', 'rechts'];

export function startMaexchen({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let rolling = false; // meine Würfel klappern gerade (Physik hier)
  let cpuRolling = false; // Host: ein Computer würfelt gerade
  let timer = null;
  let hint = '';
  let picking = false; // „Geschummelt!“ gedrückt – wartet auf die Wahl des Spielers
  let cheered = false;
  let stopped = false;
  let memo = {}; // Gedächtnis der Computer (ai.js observe)
  let judged = new Set(); // allein ohne Hilfen: schon geprüfte Schummeleien/Ansagen des Menschen (seq)
  let due = null; // … und der Spieler, den ein Computer gleich anklagt
  let log = [];
  let asked = null; // Gast: welcher Wunsch zuletzt

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('mx-panel'), {
    solo,
    onAction: (type, arg) => (type === 'roll' ? rollNow() : type === 'reroll' ? rollNow('auto', true) : act(type, arg)),
    onAccuse: (target) => {
      picking = false;
      if (target === null) return render();
      act('accuse', target);
    },
    onLeave: (confirm) => (confirm && mine?.phase !== 'over' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({
    onAccuse: () => {
      picking = !picking;
      render();
    },
    hint: document.querySelector('[data-game="Mäxchen"] .dock [data-hint]'),
  });

  function apply(type, seat, arg) {
    if (type === 'roll') return roll(state, seat, arg);
    if (type === 'announce') return announce(state, seat, arg);
    if (type === 'believe') return believe(state, seat);
    if (type === 'doubt') return doubt(state, seat);
    if (type === 'accept') return accept(state, seat);
    if (type === 'peek') return peek(state, seat);
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'start') {
      cheered = false;
      memo = {};
      judged = new Set();
      due = null;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      if (isHost) observe(memo, state.events);
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    hint = '';
  }

  function commit(next) {
    setState(next);
    // Linsen: der Becher wackelt kurz – bei allen (der Host sagt es an, damit es auch der Gast sieht)
    for (const e of state.events) if (e.type === 'peek') board.tell(e.player);
    if (!solo) send({ t: 'state', state: viewFor(state, 2) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting || (rolling && type !== 'roll' && type !== 'again')) return; // „Nochmal“ auch, wenn das Spiel mitten im Wurf endete
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again') say(blocked());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, arg });
      render();
    }
  }

  // Würfeln mit Physik (auch der Gast würfelt selbst) – how: 'auto' schüttelt von selbst, 'hand' folgt der Maus
  async function rollNow(how = 'auto', twice = false) {
    if (!canRoll(twice)) return;
    rolling = true;
    picking = false;
    render();
    const values = await (how === 'hand' ? board.grab(mySeat) : board.roll(mySeat));
    rolling = false;
    if (stopped) return;
    if (values) act('roll', values);
    render();
  }

  function handle(msg) {
    if (stopped) return;
    if (msg.t === 'mx') return board.applyRemote(msg);
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'again') hint = blocked();
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
    if (stopped || !isHost || !state || cpuRolling) return;
    const s = state;
    if (solo && s.free && judge(s)) return;
    if (s.phase === 'over') {
      if (solo && s.free && !s.waived) commit(waive(state)); // letzte Runde geprüft – „Nochmal“ ist frei
      return;
    }
    const seat = s.turn;
    if (!isCpu(seat)) return;
    const v = viewFor(s, seat);
    const ended = s.events.some((e) => ['doubt', 'accept', 'caught', 'fehlalarm'].includes(e.type));
    if (s.phase === 'roll') return later(ended ? THINK_MS.round : THINK_MS.roll, () => cpuRoll(seat));
    if (s.phase === 'announce') {
      if (solo && s.free && s.rolls === 1 && wantsReroll(v) && cpuCheats()) return later(THINK_MS.roll, () => cpuRoll(seat));
      return later(THINK_MS.announce, () => commit(announce(state, seat, chooseClaim(v)) ?? state));
    }
    // decide: ab und zu linst er erst (allein ohne Hilfen) – dann weiß er es
    if (solo && s.free && !s.peeked.includes(seat) && wantsPeek(v, memo) && cpuCheats()) {
      return later(THINK_MS.decide, () => commit(peek(state, seat) ?? state));
    }
    const known = s.peeked.includes(seat) ? valueOf(s.dice) : null;
    later(THINK_MS.decide, () => {
      const d = chooseDecision(viewFor(state, seat), Math.random, known, memo);
      commit((d === 'doubt' ? doubt : d === 'accept' ? accept : believe)(state, seat) ?? doubt(state, seat));
    });
  }

  async function cpuRoll(seat) {
    cpuRolling = true;
    const values = await board.roll(seat);
    cpuRolling = false;
    if (stopped) return;
    const next = values && roll(state, seat, values);
    if (next) commit(next);
    else schedule();
  }

  // Allein ohne Hilfen: Jede Schummelei des Menschen prüft ein Computer einmal (erwischt jede zweite); nach einer
  // ehrlichen Ansage ruft er selten trotzdem (Fehlalarm – kostet ihn ein Leben).
  function judge(s) {
    for (const c of s.cheats) {
      if (!humans.includes(c.player) || judged.has(`c${c.seq}`)) continue;
      judged.add(`c${c.seq}`);
      if (cpuAccuses(true)) due = { player: c.player, cheat: true };
    }
    const said = s.events.find((e) => e.type === 'announce' && humans.includes(e.player));
    if (said && !judged.has(`a${s.seq}`) && !s.cheats.some((c) => c.player === said.player)) {
      judged.add(`a${s.seq}`);
      if (cpuAccuses(false)) due = { player: said.player, cheat: false };
    }
    // die Schummelei ist inzwischen verjährt (neue Runde) – dann ruft er nicht mehr
    if (due?.cheat && !s.cheats.some((c) => c.player === due.player)) due = null;
    const over = s.phase === 'over'; // nach Spielende darf auch ein ausgeschiedener Computer noch rufen
    const by = alive(s).find(isCpu) ?? (over ? s.seats.find(isCpu) : undefined);
    if (!due || (!over && !alive(s).includes(due.player)) || by === undefined) return (due = null);
    later(THINK_MS.accuse, () => {
      const target = due.player;
      due = null;
      commit(accuse(state, by, target) ?? state);
    });
    return true;
  }

  // Erst wenn Becher und Würfel ruhig sind, kurz überlegen, dann handeln (solange ändert niemand etwas am Stand)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // Wer in der letzten Runde geschummelt hat, startet die nächste Partie nicht selbst (game.js again)
  const blocked = () => (solo ? 'Der Computer prüft die letzte Runde noch …' : `${names.other()} startet die nächste Partie`);
  function say(text) {
    hint = text;
    render();
  }

  // --- Eingaben ---
  const running = () => mine && mine.phase !== 'over' && !waiting && !rolling;
  const myTurn = () => running() && mine.turn === mySeat;
  // solange ein Computer gleich „Geschummelt!“ ruft, wird nicht gewürfelt (sonst entwischt die Schummelei)
  const canRoll = (twice = false) => myTurn() && due === null && (twice ? mine.free && mine.phase === 'announce' : mine.phase === 'roll');

  let grabbing = false;
  const onMove = (e) => {
    if (grabbing) return board.drag(room.rayFrom(e));
    const over = canRoll() && board.hitCup(room.rayFrom(e));
    board.setHover(over);
    canvas.style.cursor = over ? 'grab' : '';
  };
  const onDown = (e) => {
    if (e.button !== 0 || !canRoll() || !board.hitCup(room.rayFrom(e))) return;
    e.preventDefault(); // Becher gehört dem Spiel – sonst würde tisch.js ihn greifen
    grabbing = true;
    canvas.style.cursor = 'grabbing';
    board.setHover(false);
    rollNow('hand');
    board.drag(room.rayFrom(e));
  };
  const onUp = (e) => {
    if (e.button !== 0 || !grabbing) return;
    grabbing = false;
    canvas.style.cursor = '';
    board.release();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && picking) {
      picking = false;
      render();
    }
    if (e.code !== 'Space' || e.target.tagName === 'INPUT' || !canRoll()) return;
    e.preventDefault();
    rollNow();
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    const over = v.phase === 'over';
    board.names(seatLabels(4, { mySeat, humans, me: names.me(), other: names.other(), cpu: nameOf, taken: (s) => v.seats.includes(s) }),
      over ? null : v.turn, (s) => v.lives[s] <= 0);
    const won = over && v.winner === mySeat;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const amIn = v.lives[mySeat] > 0;
    const canAccuse = v.free && (over || amIn) && !waiting && !rolling; // nach Spielende: die letzte Runde
    cheat.update({ free: v.free, canAccuse });
    if (!canAccuse) picking = false;
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.games}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const seats = [0, 1, 2, 3].map((k) => (mySeat + k) % 4).filter((p) => v.seats.includes(p));
    const claim = lastClaim(v);
    panel.render({
      round: `Partie ${v.games} · Runde ${v.round}`,
      players: seats.map((p) => ({ name: nameOf(p), lives: v.lives[p], turn: !over && v.turn === p })),
      status: statusText(),
      says: v.claims.length ? `Angesagt: ${v.claims.map((c) => `${shortOf(c.by)}: ${claimName(c.value)}`).join(' → ')}` : '',
      mine: v.dice && !v.shown && (v.roller === mySeat || v.peeked.includes(mySeat))
        ? `${v.roller === mySeat ? 'Dein Wurf' : 'Unter dem Becher'}: ${v.dice[0]} und ${v.dice[1]} → ${claimName(valueOf(v.dice))}` : '',
      acts: actions(),
      claims: myTurn() && v.phase === 'announce' ? new Set(CLAIMS.filter((x) => v.free || higher(x, claim?.value))) : null,
      accuse: picking && canAccuse ? seats.filter((p) => p !== mySeat && (over || v.lives[p] > 0)).map((p) => ({ seat: p, name: nameOf(p) })) : null,
      hint,
      last: log,
      end: over ? endInfo() : null,
    });
  }

  const shortOf = (seat) => (seat === mySeat ? 'du' : humans.includes(seat) ? names.other() : REL[rel(seat)]);

  function actions() {
    const v = mine;
    if (!myTurn()) return [];
    if (v.phase === 'roll') return [{ act: 'roll', text: 'Würfeln' }, ...(v.free && v.claims.length && !v.peeked.includes(mySeat) ? [{ act: 'peek', text: 'Unter den Becher linsen', secondary: true }] : [])];
    if (v.phase === 'announce') return v.free ? [{ act: 'reroll', text: 'Nochmal würfeln', secondary: true }] : [];
    const maex = lastClaim(v).value === MAEXCHEN;
    return [
      ...(maex ? [{ act: 'accept', text: 'Glauben (−1 Leben)' }] : []),
      ...(!maex || v.free ? [{ act: 'believe', text: maex ? 'Glauben und würfeln' : 'Glauben' }] : []),
      { act: 'doubt', text: 'Aufdecken' },
      ...(v.free && !v.peeked.includes(mySeat) ? [{ act: 'peek', text: 'Unter den Becher linsen', secondary: true }] : []),
    ];
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'over') return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (rolling) return 'Die Würfel klappern …';
    const claim = lastClaim(v);
    if (v.turn !== mySeat) {
      if (v.phase === 'decide') return `${nameOf(v.turn)} überlegt: glauben oder aufdecken?`;
      return `${nameOf(v.turn)} ${v.phase === 'roll' ? 'würfelt' : 'schaut und sagt an'} …`;
    }
    if (v.phase === 'roll') return claim ? `Du glaubst – würfeln und mehr als ${claimName(claim.value)} ansagen` : 'Du beginnst die Runde – würfeln';
    if (v.phase === 'announce') return claim ? `Was sagst du an? Mehr als ${claimName(claim.value)}` : 'Was sagst du an?';
    return `${nameOf(claim.by)} sagt ${claimName(claim.value)} – glauben oder aufdecken?`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'start') parts.push(`Neue Partie – ${who} ${verb(e.player, 'beginnst', 'beginnt')}.`);
      else if (e.type === 'announce') parts.push(`${who} ${verb(e.player, 'sagst', 'sagt')} „${claimName(e.value)}“.`);
      else if (e.type === 'believe') parts.push(`${who} ${verb(e.player, 'glaubst', 'glaubt')}.`);
      else if (e.type === 'doubt') {
        const lost = `${e.lost} Leben`;
        parts.push(`${who} ${verb(e.player, 'deckst', 'deckt')} auf: ${e.dice[0]} und ${e.dice[1]} = ${claimName(valueOf(e.dice))}, angesagt war ${claimName(e.value)}. `
          + `${e.truth ? 'Es stimmt' : 'Gelogen'} – ${nameOf(e.loser)} ${verb(e.loser, 'verlierst', 'verliert')} ${lost}.`);
      } else if (e.type === 'accept') parts.push(`${who} ${verb(e.player, 'glaubst', 'glaubt')} das Mäxchen und ${verb(e.player, 'gibst', 'gibt')} 1 Leben ab.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'out') parts.push(`${who} ${verb(e.player, 'bist', 'ist')} raus.`);
      else if (e.type === 'over') parts.push(e.winner === null ? 'Spiel vorbei.' : `${nameOf(e.winner)} ${verb(e.winner, 'gewinnst', 'gewinnt')}!`);
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      const what = e.kinds.map((k) => CHEAT_NAMES[k]).join(' und ');
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${what}: −1 Leben.`
        : `Erwischt! ${nameOf(e.player)} hat ${what}: −1 Leben.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat nicht geschummelt – du verlierst 1 Leben.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen: −1 Leben.`;
  }

  function endInfo() {
    const v = mine;
    const title = v.winner === mySeat ? 'Gewonnen!' : v.winner === null ? 'Ausgeschieden' : `${nameOf(v.winner)} ${verb(v.winner, 'gewinnst', 'gewinnt')}`;
    const places = [...v.out].reverse().map((p, i) => `${alive(v).length + i + 1}. ${nameOf(p)}`);
    const left = v.winner === null ? `Noch im Spiel: ${alive(v).map((p) => `${nameOf(p)} (${v.lives[p]} Leben)`).join(', ')} · ` : `1. ${nameOf(v.winner)} · `;
    return { title, text: `${left}${places.join(' · ')}` };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ seats: SEATS, humans, free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
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
