// Texas-Hold'em-Runde: verbindet Spielstand (game.js), Tisch (board.js), Seitenfeld (panel.js), Computer (ai.js),
// Spielgeld (spielgeld.js) und Netz. Sechs Plätze: Host 0, Gast 3 (gegenüber), die freien spielt der Computer.
// Der Host hält den vollen Stand, lässt die Computer handeln und schickt dem Gast nur dessen Sicht (viewFor). Der Gast
// schickt Wünsche (act, claim, peek, accuse, deal, borrow) – der Host prüft sie.
//
// Spielgeld: Jeder PC hat sein eigenes Konto (spielgeld.js) und setzt sich mit allem an den Tisch. Der Gast meldet sein
// Konto beim Start ({ t: 'bank' }); der Host wartet darauf. Danach schreibt jeder PC nach jedem Stand seinen Betrag
// (Chips vor ihm + was in der laufenden Hand steckt) zurück. Wer bei 0 ist, leiht bei der Bank.
// free = „Ohne Hilfen“: Regler erlaubt jeden Betrag, „Schieben“ geht immer, „Nächste Karte ansehen“, beim Showdown
// sagt jeder seine Hand an; „Geschummelt!“ gegen einen gewählten Spieler. Allein schummeln die Computer ab und zu selbst
// (linsen, falsch ansagen) und prüfen jeden Schummelzug des Menschen einmal (schummeln.js).
import {
  newGame, nextHand, act, options, claim, peek, accuse, waive, deal, borrow, account, setAccount, viewFor, live, pot, betting,
  CATEGORIES, BIG,
} from './game.js';
import { evaluate, handName } from './hand.js';
import { decide, wantsPeek, chooseClaim } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { loadMoney, setChips, borrowMoney, formatChips, LOAN } from '../spielgeld.js';
import { cardName } from '../karten/cards.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { act: 900, claim: 800, accuse: 900, start: 700, next: 2600, showdown: 4800 };
const MOVE_TEXT = { check: ['schiebst', 'schiebt'], call: ['gehst mit', 'geht mit'], bet: ['setzt', 'setzt'], raise: ['erhöhst auf', 'erhöht auf'] };

export function startPoker({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 3;
  const humans = solo ? [0] : [0, 3];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let timer = null;
  let hint = '';
  let picking = false; // „Geschummelt!“ gedrückt – wartet auf die Wahl des Spielers
  let stopped = false;
  let judged = new Set(); // allein ohne Hilfen: schon geprüfte Schummeleien/Ansagen des Menschen
  let due = null; // … und der Spieler, den ein Computer gleich anklagt
  let log = [];
  let money = loadMoney();
  let cheered = 0; // Hand, für die es schon Konfetti gab
  let asked = null; // Gast: welcher Wunsch zuletzt

  const own = (v) => (solo ? v.stacks[mySeat] : account(v, mySeat));
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : mine?.players[seat]?.name ?? 'Computer');
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('pk-panel'), {
    solo,
    onAction: (type, arg) => onAction(type, arg),
    onAccuse: (target) => {
      picking = false;
      if (target === null) return render();
      act_('accuse', { target });
    },
    onLeave: () => leave(),
  });
  const cheat = createCheatUI({
    onAccuse: () => {
      picking = !picking;
      render();
    },
    hint: document.querySelector('[data-game="Texas Hold\'em"] .dock [data-hint]'),
  });

  function leave() {
    const inHand = mine && (betting(mine) || mine.phase === 'claim') && live(mine).includes(mySeat) && mine.invested[mySeat] > 0;
    if (inHand) ask('Hand aufgeben und zurück zum Schrank? Was du schon gesetzt hast, ist weg.', onLeave);
    else onLeave();
  }

  // --- Spielstand ---
  function apply(type, seat, arg = {}) {
    if (type === 'act') return act(state, seat, arg.move, arg.to);
    if (type === 'claim') return claim(state, seat, arg.cat);
    if (type === 'peek') return peek(state, seat);
    if (type === 'accuse') return accuse(state, seat, arg.target);
    if (type === 'deal') return deal(state, seat);
    if (type === 'borrow') return borrow(state, seat, LOAN);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'start') {
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
    // Konto dieses PCs nachführen – zu zweit kostet eine unterbrochene Hand nichts (sie bleibt gespeichert, account
    // zählt das Gesetzte mit); allein ist Gesetztes sofort weg (sonst brächte Neuladen es zurück)
    const chips = own(mine);
    if (chips !== money.chips || money.link !== mine.id) money = setChips(chips, mine.id);
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 3) });
    save?.(state); // zu zweit: Host merkt sich die Runde (saves.js)
    render();
    schedule();
  }

  // Host: Runde beginnen – zu zweit erst, wenn das Konto des Gasts bekannt ist
  function begin(guest) {
    let s = resume ?? newGame({ humans, free, chips: { 0: money.chips, 3: guest?.chips ?? 0 } });
    // fortgesetzt: hat sich ein Konto seitdem woanders geändert, gleichen die Chips das aus
    if (resume && money.link !== s.id) s = setAccount(s, 0, money.chips);
    if (resume && guest && guest.link !== s.id) s = setAccount(s, 3, guest.chips);
    commit(s);
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act_(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'deal') say(blocked());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, ...arg });
      render();
    }
  }

  function onAction(type, arg) {
    if (type === 'claim') return act_('claim', { cat: arg });
    if (type === 'raise') return act_('act', { move: 'raise', to: arg });
    if (type === 'peek' || type === 'deal') return act_(type);
    if (type === 'borrow') {
      const m = borrowMoney(); // die Statistik gehört diesem PC
      if (!m) return say('Leihen geht erst, wenn dein Konto leer ist.');
      money = m;
      return act_('borrow');
    }
    act_('act', { move: type });
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'deal') hint = blocked();
      return render();
    }
    if (!isHost) return;
    if (msg.t === 'bank') {
      const guest = { chips: Math.max(0, Math.floor(Number(msg.chips) || 0)), link: typeof msg.link === 'string' ? msg.link : null };
      if (!state) return begin(guest);
      if (guest.link !== state.id) commit(setAccount(state, 3, guest.chips));
      return;
    }
    if (!state) return;
    const next = apply(msg.t, 3, msg);
    if (next) commit(next);
    else send({ t: 'state', state: viewFor(state, 3) }); // ungültig → Gast bekommt den aktuellen Stand zurück
  }

  // --- Computer (nur beim Host) ---
  const isCpu = (seat) => !humans.includes(seat);

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state) return;
    const s = state;
    if (solo && s.free && judge(s)) return;
    if (s.phase === 'wait') return later(THINK_MS.start, tryDeal);
    if (s.phase === 'done') {
      if (s.free) {
        if (solo && !s.waived) commit(waive(state)); // Hand geprüft – „Nächste Hand“ ist frei
        return;
      }
      const showdown = s.events.find((e) => e.type === 'win')?.showdown;
      return later(showdown ? THINK_MS.showdown : THINK_MS.next, tryDeal);
    }
    if (s.phase === 'claim') {
      const seat = live(s).find((p) => isCpu(p) && s.claims[p] === null);
      if (seat === undefined) return;
      return later(THINK_MS.claim, () => commit(claim(state, seat, chooseClaim(viewFor(state, seat), seat, solo && cpuCheats())) ?? state));
    }
    const seat = s.turn;
    if (!isCpu(seat)) return;
    const think = THINK_MS.act * (0.6 + Math.random() * 0.8);
    // allein ohne Hilfen: ab und zu linst er erst auf die nächste Karte
    if (solo && s.free && !s.peek[seat] && wantsPeek(viewFor(s, seat), seat) && cpuCheats()) return later(think, () => commit(peek(state, seat) ?? state));
    later(think, () => {
      const v = viewFor(state, seat);
      const d = decide(v, seat, { known: state.peek[seat] });
      const o = options(state, seat);
      commit(act(state, seat, d.move, d.to) ?? act(state, seat, o.check ? 'check' : 'fold'));
    });
  }

  // Neue Hand (wenn keiner der Menschen Chips hat, wartet der Tisch aufs Leihen)
  function tryDeal() {
    const next = nextHand(state);
    if (next) commit(next);
    else render();
  }

  // Allein ohne Hilfen: Jede Schummelei des Menschen prüft ein Computer einmal (erwischt jede zweite); nach einer
  // ehrlichen Ansage beim Showdown ruft er selten trotzdem (Fehlalarm – kostet ihn 2 Big Blinds).
  function judge(s) {
    for (const c of s.cheats) {
      if (!humans.includes(c.player) || judged.has(`c${c.seq}`)) continue;
      judged.add(`c${c.seq}`);
      if (cpuAccuses(true)) due = { player: c.player, cheat: true };
    }
    const said = s.events.find((e) => e.type === 'claim' && humans.includes(e.player));
    if (said && !judged.has(`a${s.seq}`) && !s.cheats.some((c) => c.player === said.player)) {
      judged.add(`a${s.seq}`);
      if (cpuAccuses(false)) due = { player: said.player, cheat: false };
    }
    if (due?.cheat && !s.cheats.some((c) => c.player === due.player)) due = null; // schon verjährt (neue Hand)
    if (!due) return false;
    const by = live(s).find(isCpu) ?? [1, 2, 4, 5].find(isCpu);
    later(THINK_MS.accuse, () => {
      const target = due.player;
      due = null;
      commit(accuse(state, by, target) ?? state);
    });
    return true;
  }

  // Erst wenn Karten und Chips liegen, kurz überlegen, dann handeln (solange ändert niemand etwas am Stand)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy() > 0.05) timer = setTimeout(tick, 60);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  const blocked = () => (!humans.some((p) => mine.stacks[p]) ? 'Erst Geld bei der Bank leihen' : solo ? 'Der Computer prüft die Hand noch …' : `${names.other()} startet die nächste Hand`);
  function say(text) {
    hint = text;
    render();
  }

  // --- Eingaben am Tisch: eigene Karten in die Mitte = passen, Chip vom eigenen Stapel in die Mitte = mitgehen ---
  const myTurn = () => mine && betting(mine) && mine.turn === mySeat && !waiting;
  board.onPlace = (mesh, point) => {
    const part = board.partOf(mesh);
    if (!part || !board.inMiddle(point) || !myTurn()) return null;
    const o = options(mine, mySeat);
    if (part === 'cards') onAction('fold');
    else if (o.need > 0) onAction('call');
    else if (o.raise) onAction('raise', o.raise.min);
    else onAction('check');
    return 'move';
  };
  const onMove = (e) => {
    const over = myTurn() && board.hitMine(room.rayFrom(e));
    board.setHover(over);
  };

  // --- Anzeige ---
  const label = (seat) => {
    if (!mine?.players[seat]) return '';
    const who = seat === mySeat ? names.me() || 'Du' : humans.includes(seat) ? names.other() : mine.players[seat].name;
    return `${who} · ${formatChips(mine.stacks[seat])}`;
  };

  function render() {
    board.sync(mine, mySeat, [0, 1, 2, 3, 4, 5].map(label));
    if (!mine) {
      panel.render({ round: '', players: [], pot: '', status: solo ? 'Mische …' : `Warte auf das Konto von ${names.other()} …`, mine: '', peek: '', acts: [], bet: null, claims: false, accuse: null, hint: '', last: [], bank: bankText() });
      return;
    }
    const v = mine;
    const done = v.phase === 'done' || v.phase === 'wait';
    const canAccuse = v.free && v.hand > 0 && !waiting;
    cheat.update({ free: v.free, canAccuse });
    if (!canAccuse) picking = false;
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.id}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.events.find((e) => e.type === 'win');
    // Konfetti, wenn ich einen Showdown gewonnen habe (einmal je Hand)
    if (won?.showdown && won.pots.some((p) => p.winners.includes(mySeat) && p.eligible.length > 1) && cheered !== v.hand) {
      cheered = v.hand;
      room.celebrate(me);
    }
    const seats = [0, 1, 2, 3, 4, 5].map((k) => (mySeat + k) % 6);
    panel.render({
      round: v.hand ? `Hand ${v.hand} · Blinds 5 / 10` : 'Blinds 5 / 10',
      players: seats.map((p) => ({
        name: nameOf(p), chips: v.stacks[p], note: noteOf(p), turn: !done && v.turn === p,
        out: v.status[p] === 'fold' || v.status[p] === 'out', dealer: v.button === p,
      })),
      pot: !done && pot(v) ? `Pot: ${formatChips(pot(v))}` : '',
      status: statusText(),
      mine: myHand(),
      peek: v.peek?.[mySeat] ? `Gelinst – die nächste Karte: ${cardName(v.peek[mySeat])}` : '',
      acts: actions(),
      bet: betBox(),
      claims: v.phase === 'claim' && live(v).includes(mySeat) && v.claims[mySeat] === null && !waiting,
      accuse: picking && canAccuse ? seats.filter((p) => p !== mySeat).map((p) => ({ seat: p, name: nameOf(p) })) : null,
      hint,
      last: log,
      bank: bankText(),
    });
  }

  function bankText() {
    const lent = money.loans ? ` · von der Bank geliehen: ${formatChips(money.borrowed)} (${money.loans}-mal)` : ' · noch nichts geliehen';
    return `Dein Konto: ${formatChips(mine ? own(mine) : money.chips)}${lent}`;
  }

  function noteOf(p) {
    const v = mine;
    if (v.status[p] === 'out') return v.stacks[p] ? '' : 'pleite';
    if (v.status[p] === 'fold') return 'passt';
    if (v.phase === 'done' && v.payout[p]) return `+${formatChips(v.payout[p])}`;
    if (v.phase === 'claim' && v.claims[p] !== null) return CATEGORIES[v.claims[p]];
    if (v.status[p] === 'allin') return 'all-in';
    return v.bet[p] ? `setzt ${formatChips(v.bet[p])}` : '';
  }

  function myHand() {
    const h = mine.holes[mySeat];
    if (!h?.[0]) return '';
    const cards = `${cardName(h[0])}, ${cardName(h[1])}`;
    return mine.board.length ? `Deine Hand: ${handName(evaluate([...h, ...mine.board]))} (${cards})` : `Deine Karten: ${cards}`;
  }

  function actions() {
    const v = mine;
    if (waiting) return [];
    const out = [];
    if (v.stacks[mySeat] === 0 && !((betting(v) || v.phase === 'claim') && live(v).includes(mySeat))) out.push({ act: 'borrow', text: `Bei der Bank leihen (${formatChips(LOAN)})` });
    if (v.phase === 'done' && v.free) out.push({ act: 'deal', text: 'Nächste Hand' });
    if (!myTurn()) return out;
    const o = options(v, mySeat);
    out.push({ act: 'fold', text: 'Passen', secondary: true });
    if (o.check) out.push({ act: 'check', text: 'Schieben' });
    else {
      out.push({ act: 'call', text: o.need >= v.stacks[mySeat] ? `All-in mitgehen (${formatChips(o.need)})` : `Mitgehen (${formatChips(o.need)})` });
      if (v.free) out.push({ act: 'check', text: 'Schieben', secondary: true });
    }
    if (v.free && v.phase !== 'river' && !v.peek[mySeat]) out.push({ act: 'peek', text: 'Nächste Karte ansehen', secondary: true });
    return out;
  }

  // Erhöhen: normal ab dem Mindestbetrag, ohne Hilfen jeder Betrag (auch zu wenig)
  function betBox() {
    if (!myTurn()) return null;
    const v = mine;
    const o = options(v, mySeat);
    const all = v.bet[mySeat] + v.stacks[mySeat];
    const range = v.free ? (all > v.bet[mySeat] ? { min: v.bet[mySeat] + 1, max: all } : null) : o.raise;
    if (!range) return null;
    const start = o.raise?.min ?? Math.min(all, v.current + BIG);
    return {
      ...range, start, pot: pot(v), call: o.need, label: v.current ? 'Erhöhen auf' : 'Setzen', key: `${v.id}-${v.hand}-${v.phase}-${v.current}`,
    };
  }

  function statusText() {
    const v = mine;
    if (waiting) return 'Wird gesendet …';
    if ((v.phase === 'wait' || v.phase === 'done') && !humans.some((p) => v.stacks[p])) return 'Keiner hat mehr Chips – leih dir Geld von der Bank';
    if (v.phase === 'wait') return 'Gleich geht es los …';
    if (v.phase === 'done') {
      return v.free ? 'Hand vorbei – „Nächste Hand“, wenn ihr so weit seid' : 'Hand vorbei – gleich kommt die nächste';
    }
    if (v.phase === 'claim') {
      if (live(v).includes(mySeat) && v.claims[mySeat] === null) return 'Showdown – sag deine Hand an';
      return 'Showdown – die anderen sagen an …';
    }
    if (v.status[mySeat] === 'out') return v.stacks[mySeat] ? 'Du steigst mit der nächsten Hand ein' : 'Du bist pleite und schaust zu';
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ${verb(v.turn, 'bist', 'ist')} dran …`;
    const o = options(v, mySeat);
    return o.check ? 'Du bist dran – schieben oder setzen' : `Du bist dran – ${formatChips(o.need)} zum Mitgehen`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'deal') parts.push(`Hand ${e.hand} – ${nameOf(e.button)} ${verb(e.button, 'gibst', 'gibt')}.`);
      else if (e.type === 'newcpu') parts.push(`Neu am Tisch: ${e.name}.`);
      else if (e.type === 'fold') parts.push(`${who} ${verb(e.player, 'passt', 'passt')}.`);
      else if (e.type === 'bet') {
        const [du, er] = MOVE_TEXT[e.move];
        const amount = e.move === 'check' ? '' : e.move === 'call' ? ` (${formatChips(e.put)})` : ` ${formatChips(e.to)}`;
        parts.push(`${who} ${verb(e.player, du, er)}${amount}${e.allin ? ' – all-in' : ''}.`);
      } else if (e.type === 'street') parts.push(`${{ flop: 'Flop', turn: 'Turn', river: 'River' }[e.name]}: ${e.cards.map(cardName).join(', ')}.`);
      else if (e.type === 'claim') parts.push(`${who} ${verb(e.player, 'sagst', 'sagt')} an: ${CATEGORIES[e.cat]}.`);
      else if (e.type === 'win') parts.push(winText(e));
      else if (e.type === 'borrow') parts.push(`${who} ${verb(e.player, 'leihst dir', 'leiht sich')} ${formatChips(e.amount)} von der Bank.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function winText(e) {
    const out = [];
    e.pots.forEach((p, i) => {
      if (!p.winners.length) return;
      const names_ = p.winners.map(nameOf).join(' und ');
      const what = e.showdown && p.winners.length && e.hands[p.winners[0]] ? ` mit ${e.hands[p.winners[0]]}` : '';
      const side = e.pots.length > 1 ? (i === 0 ? 'den Hauptpot' : `Side Pot ${i}`) : 'den Pot';
      if (p.eligible.length === 1 && e.showdown) out.push(`${names_} ${verb(p.winners[0], 'bekommst', 'bekommt')} ${formatChips(p.amount)} zurück.`);
      else if (p.winners.length > 1) out.push(`${names_} teilen ${side} (${formatChips(p.amount)})${what}.`);
      else out.push(`${names_} ${verb(p.winners[0], 'gewinnst', 'gewinnt')} ${side} (${formatChips(p.amount)})${what}.`);
    });
    return out.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      const what = e.resettled ? 'Der Pot wird nach den echten Karten neu verteilt.' : 'Die Hand ist für ihn verloren.';
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast geschummelt: ${e.why}. ${what.replace('ihn', 'dich')}`
        : `Erwischt! ${nameOf(e.player)} hat geschummelt: ${e.why}. ${what}`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat nicht geschummelt – du zahlst ${formatChips(e.paid)}.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und zahlt ${formatChips(e.paid)} an ${nameOf(e.target).replace(/^Du$/, 'dich')}.`;
  }

  canvas.addEventListener('pointermove', onMove);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost && solo) begin(null);
  else if (isHost) render(); // wartet auf { t: 'bank' }
  else {
    send({ t: 'bank', chips: money.chips, link: money.link });
    render();
  }

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => mine,
    stop() {
      stopped = true;
      clearTimeout(timer);
      cheat.remove();
      board.onPlace = null;
      canvas.removeEventListener('pointermove', onMove);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
