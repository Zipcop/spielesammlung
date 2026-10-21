// Black-Jack-Runde: verbindet Spielstand (game.js), Tisch (board.js), Seitenfeld (panel.js), Computer (ai.js),
// Spielgeld (spielgeld.js) und Netz. Fünf Boxen: Host Box 1, Gast Box 3, die Bank und freie Boxen spielt der Computer
// (wie viele, wählt der Host zu Beginn). Der Host hält den vollen Stand, lässt Computer und Bank handeln und schickt
// dem Gast nur dessen Sicht (viewFor). Der Gast schickt Wünsche (setup, bet, insure, act, peek, raise, accuse, again,
// borrow) – der Host prüft sie.
//
// Spielgeld wie bei Texas Hold'em: Jeder PC hat sein Konto und setzt sich mit allem an den Tisch. Der Gast meldet sein
// Konto beim Start ({ t: 'bank' }), der Host wartet darauf. Danach schreibt jeder PC nach jedem Stand seinen Betrag
// zurück (Chips vor ihm + was in der laufenden Runde steht). Wer bei 0 ist, leiht bei der Bank.
// free = „Ohne Hilfen“ (nur zu zweit): Für die eigenen Hände wird nichts geprüft oder beendet – Karte, Verdoppeln,
// Teilen gehen immer, „Summe ansagen“, „Nächste Karte ansehen“, Einsatz erhöhen; „Geschummelt!“ gegen den anderen bis
// zur nächsten Runde. Die nächste Runde startet dann per Knopf (wie beim Poker). Allein schummeln die Computer-
// Mitspieler ab und zu selbst (linsen, falsche Summe ansagen) und prüfen jeden Schummelzug des Menschen einmal
// (schummeln.js); sitzt kein Computer am Tisch, prüft der Croupier. Die Bank schummelt nie.
import {
  setup, bet, insure, act, options, again, newRound, peek, raise, accuse, waive, borrow, account, setAccount, viewFor, newGame,
  total, isBlackjack, scoreOf, insuranceOf, inRound, validBet, HOST, GUEST, BANK, MIN, MAX,
} from './game.js';
import { decide } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { loadMoney, setChips, borrowMoney, formatChips, LOAN } from '../spielgeld.js';
import { cardName } from '../karten/cards.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { act: 850, next: 3600, accuse: 900 };
const RESULT = { win: 'gewonnen', blackjack: 'Black Jack!', push: 'Gleichstand', lose: 'verloren', bust: 'verkauft' };

export function startBlackjack({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? HOST : GUEST;
  const other = isHost ? GUEST : HOST;
  const humans = solo ? [HOST] : [HOST, GUEST];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let timer = null;
  let hint = '';
  let stopped = false;
  let log = [];
  let money = loadMoney();
  let cheered = 0; // Runde, für die es schon Konfetti gab
  let asked = null; // Gast: welcher Wunsch zuletzt
  let picking = false; // allein: „Geschummelt!“ gedrückt – wartet auf die Wahl des Computers
  let judged = new Set(); // allein ohne Hilfen: schon geprüfte Schummeleien/Züge des Menschen
  let due = null; // … und wen ein Computer gleich anklagt

  const own = (v) => (solo ? v.stacks[mySeat] : account(v, mySeat));
  const nameOf = (seat) => (seat === BANK ? 'Der Croupier' : seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : mine?.players[seat]?.name ?? 'Computer');
  const verb = (seat, du, er) => (seat === mySeat ? du : er);

  const panel = createPanel($('bj-panel'), {
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
    // zu zweit schummeln nur die beiden Menschen – allein wählt man den Computer
    onAccuse: () => {
      if (!solo) return act_('accuse', { target: other });
      picking = !picking;
      render();
    },
    hint: document.querySelector('[data-game="Blackjack"] .dock [data-hint]'),
  });

  function leave() {
    const inGame = mine && inRound(mine) && mine.boxes[mySeat];
    if (inGame && solo) ask('Runde aufgeben und zurück zum Schrank? Was du gesetzt hast, ist weg.', onLeave);
    else onLeave();
  }

  // --- Spielstand ---
  function apply(type, seat, arg = {}) {
    if (type === 'setup') return setup(state, seat, arg.cpus);
    if (type === 'bet') return bet(state, seat, arg.amount);
    if (type === 'insure') return insure(state, seat, !!arg.yes);
    if (type === 'act') return act(state, seat, arg.move, arg.total);
    if (type === 'peek') return peek(state, seat);
    if (type === 'raise') return raise(state, seat, arg.amount);
    if (type === 'accuse') return accuse(state, seat, arg.target);
    if (type === 'again') return again(state, seat);
    if (type === 'borrow') return borrow(state, seat, LOAN);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'start') {
      log = [];
      judged = new Set();
      due = null;
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 4);
    }
    // Konto dieses PCs nachführen – zu zweit kostet eine unterbrochene Runde nichts (sie bleibt gespeichert), allein ist
    // Gesetztes sofort weg (sonst brächte Neuladen es zurück)
    const chips = own(mine);
    if (chips !== money.chips || money.link !== mine.id) money = setChips(chips, mine.id);
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, GUEST) });
    save?.(state); // zu zweit: Host merkt sich die Runde (saves.js)
    render();
    schedule();
  }

  // Host: Runde beginnen – zu zweit erst, wenn das Konto des Gasts bekannt ist
  function begin(guest) {
    let s = resume ?? newGame({ humans, free, chips: { [HOST]: money.chips, [GUEST]: guest?.chips ?? 0 } });
    if (resume && money.link !== s.id) s = setAccount(s, HOST, money.chips);
    if (resume && guest && guest.link !== s.id) s = setAccount(s, GUEST, guest.chips);
    commit(s);
  }

  function act_(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again') say(blocked());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, ...arg });
      render();
    }
  }

  function onAction(type, arg) {
    if (type === 'setup') return act_('setup', { cpus: arg });
    if (type === 'bet' || type === 'raise') return act_(type, { amount: arg });
    if (type === 'insure' || type === 'noinsure') return act_('insure', { yes: type === 'insure' });
    if (type === 'claim') return act_('act', { move: 'claim', total: arg });
    if (type === 'peek' || type === 'again') return act_(type);
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
      if (same && asked === 'again') hint = blocked();
      return render();
    }
    if (!isHost) return;
    if (msg.t === 'bank') {
      const guest = { chips: Math.max(0, Math.floor(Number(msg.chips) || 0)), link: typeof msg.link === 'string' ? msg.link : null };
      if (!state) return begin(guest);
      if (guest.link !== state.id) commit(setAccount(state, GUEST, guest.chips));
      return;
    }
    if (!state) return;
    const next = apply(msg.t, GUEST, msg);
    if (next) commit(next);
    else send({ t: 'state', state: viewFor(state, GUEST) }); // ungültig → Gast bekommt den aktuellen Stand zurück
  }

  // --- Computer und Bank (nur beim Host) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state) return;
    const s = state;
    if (solo && s.free && judge(s)) return;
    if (s.phase === 'done') {
      if (!s.free) return later(THINK_MS.next, () => commit(newRound(state) ?? state));
      if (solo && !s.waived) commit(waive(state)); // Runde geprüft – „Nächste Runde“ ist frei
      return;
    }
    if (s.phase !== 'play' || humans.includes(s.turn.box)) return;
    const seat = s.turn.box;
    const think = THINK_MS.act * (0.6 + Math.random() * 0.8);
    // allein ohne Hilfen: ab und zu linst ein Computer in den Schlitten oder sagt eine bessere Summe an
    if (solo && s.free && cpuCheats()) {
      const t = total(s.boxes[seat].hands[s.turn.hand].cards).total;
      if (!s.peek[seat] && t >= 12 && t < 21) return later(think, () => commit(peek(state, seat) ?? state));
      if (t >= 12 && t < 17) return later(think, () => commit(act(state, seat, 'claim', 17 + Math.floor(Math.random() * 4)) ?? state));
    }
    later(think, () => commit(act(state, seat, cpuMove(state, seat)) ?? state));
  }

  // Zug eines Computers: Grundstrategie – hat er gelinst, zieht er, solange die gesehene Karte nicht überkauft
  function cpuMove(s, seat) {
    const known = s.peek[seat];
    const o = options(s, seat);
    if (!known || !o.hit) return decide(s, seat);
    const cards = s.boxes[seat].hands[s.turn.hand].cards;
    return total([...cards, known]).total <= 21 && o.total < 20 ? 'hit' : 'stand';
  }

  // Allein ohne Hilfen: Jede Schummelei des Menschen prüft ein Computer einmal (erwischt jede zweite); nach einem
  // ehrlichen Bleiben ruft er selten trotzdem (Fehlalarm – kostet ihn 20). Ohne Computer am Tisch prüft der Croupier.
  function judge(s) {
    for (const c of s.cheats) {
      if (!humans.includes(c.player) || judged.has(`c${c.seq}`)) continue;
      judged.add(`c${c.seq}`);
      if (cpuAccuses(true)) due = { player: c.player, cheat: true };
    }
    const stood = s.events.find((e) => (e.type === 'stand' || e.type === 'claim') && humans.includes(e.player));
    if (stood && !judged.has(`a${s.seq}`) && !s.cheats.some((c) => c.player === stood.player)) {
      judged.add(`a${s.seq}`);
      if (cpuAccuses(false)) due = { player: stood.player, cheat: false, round: s.round };
    }
    if (due?.cheat && !s.cheats.some((c) => c.player === due.player)) due = null; // schon verjährt (neue Runde)
    if (due && !due.cheat && due.round !== s.round) due = null; // Fehlalarm zu einer alten Runde nicht nachholen
    if (!due || !(inRound(s) || s.phase === 'done')) return false;
    const cpus = [0, 1, 2, 3, 4].filter((p) => s.players[p] && !s.players[p].human);
    const by = cpus.find((p) => s.boxes[p] && !s.boxes[p].forfeit) ?? cpus[0] ?? BANK;
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

  const blocked = () => (solo ? 'Die anderen prüfen die Runde noch …' : `${names.other()} startet die nächste Runde – oder ruft „Geschummelt!“`);
  function say(text) {
    hint = text;
    render();
  }

  // --- Eingaben am Tisch: Chip vom eigenen Stapel in die eigene Box = setzen (beim Verdoppeln: verdoppeln) ---
  board.onPlace = (mesh, point) => {
    const value = board.chipOf(mesh);
    if (value === null || board.boxAt(point) !== mySeat || waiting || !mine) return null;
    const v = mine;
    const stack = v.stacks[mySeat];
    const amount = stack < MIN ? stack : Math.max(MIN, Math.min(MAX, stack - (stack % MIN), Math.floor(value / MIN) * MIN || MIN));
    if (v.phase === 'bet' && v.bets[mySeat] === null && validBet(amount, stack)) onAction('bet', amount);
    else if (myTurn() && (options(v, mySeat).double || (v.free && hand()?.cards.length === 2))) onAction('double');
    else if (v.free && inRound(v) && v.boxes[mySeat] && !v.boxes[mySeat].forfeit && validBet(amount, stack)) onAction('raise', amount);
    else return 'back';
    return 'move';
  };

  const myTurn = () => mine && mine.phase === 'play' && mine.turn?.box === mySeat && !waiting;
  const hand = () => (mine?.turn ? mine.boxes[mine.turn.box].hands[mine.turn.hand] : null);

  // --- Anzeige ---
  const label = (seat) => {
    if (!mine?.players[seat]) return '';
    const who = seat === mySeat ? names.me() || 'Du' : humans.includes(seat) ? names.other() : mine.players[seat].name;
    return `${who} · ${formatChips(mine.stacks[seat])}`;
  };

  function render() {
    board.sync(mine, mySeat, [0, 1, 2, 3, 4].map(label));
    board.setHover(myTurn() ? hand().cards.map((_, k) => `${mySeat}.${mine.turn.hand}.${k}`) : []);
    if (!mine) {
      panel.render({ round: '', players: [], dealer: '', status: solo ? 'Mische …' : `Warte auf das Konto von ${names.other()} …`, mine: [], peek: '', setup: null, bet: null, acts: [], claims: false, accuse: null, hint: '', last: [], bank: bankText() });
      return;
    }
    const v = mine;
    const canAccuse = v.free && v.round > 0 && (inRound(v) || v.phase === 'done') && !waiting;
    cheat.update({ free: v.free, canAccuse });
    if (!canAccuse) picking = false;
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.id}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    // Konfetti, wenn ich in dieser Runde mehr zurückbekomme als gesetzt (einmal je Runde)
    if (v.phase === 'done' && v.payout[mySeat] > v.staked[mySeat] && cheered !== v.round) {
      cheered = v.round;
      room.celebrate(0); // beide sitzen auf der Spielerseite (+z)
    }
    panel.render({
      round: v.round ? `Runde ${v.round} · Einsatz ${MIN}–${MAX}` : `Einsatz ${MIN}–${MAX}`,
      players: [0, 1, 2, 3, 4].filter((p) => v.players[p]).map((p) => ({
        name: nameOf(p), chips: v.stacks[p], note: noteOf(p), turn: v.phase === 'play' && v.turn?.box === p,
        out: !v.boxes[p] && v.phase !== 'bet',
      })),
      dealer: v.dealer.length ? `Bank: ${v.dealer.map(cardName).join(', ')} = ${dealerTotal(v.dealer)}` : '',
      status: statusText(),
      mine: myHands(),
      peek: v.peek?.[mySeat] ? `Gelinst – die nächste Karte: ${cardName(v.peek[mySeat])}` : '',
      setup: v.phase === 'setup' && isHost && !waiting ? setupInfo() : null,
      bet: betBox(),
      acts: actions(),
      claims: v.free && myTurn(),
      accuse: picking && canAccuse ? [0, 1, 2, 3, 4].filter((p) => p !== mySeat && v.players[p]).map((p) => ({ seat: p, name: nameOf(p) })) : null,
      hint,
      last: log,
      bank: bankText(),
    });
  }

  const dealerTotal = (cards) => (cards.length === 2 && total(cards).total === 21 ? 'Black Jack' : total(cards).total);

  function setupInfo() {
    const n = 5 - humans.length;
    return Array.from({ length: n + 1 }, (_, k) => ({ n: k, text: k ? `${k} Computer` : solo ? 'Nur ich' : 'Nur wir' }));
  }

  function bankText() {
    const lent = money.loans ? ` · von der Bank geliehen: ${formatChips(money.borrowed)} (${money.loans}-mal)` : ' · noch nichts geliehen';
    return `Dein Konto: ${formatChips(mine ? own(mine) : money.chips)}${lent}`;
  }

  function noteOf(p) {
    const v = mine;
    if (v.phase === 'bet') return v.bets[p] ? `setzt ${formatChips(v.bets[p])}` : v.stacks[p] ? '' : 'pleite';
    const box = v.boxes[p];
    if (!box) return v.stacks[p] ? '' : 'pleite';
    if (box.forfeit) return 'erwischt';
    if (v.phase === 'done') {
      const net = v.payout[p] - v.staked[p];
      return net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : '±0';
    }
    return box.hands.map((h) => (isBlackjack(h) ? 'BJ' : scoreOf(h) > 21 && h.done ? 'verkauft' : String(scoreOf(h)))).join(' · ');
  }

  function myHands() {
    const box = mine.boxes[mySeat];
    if (!box) return mine.phase === 'bet' && mine.bets[mySeat] ? [`Dein Einsatz: ${formatChips(mine.bets[mySeat])}`] : [];
    const n = box.hands.length;
    const lines = box.hands.map((h, i) => {
      const t = total(h.cards);
      const sum = isBlackjack(h) ? 'Black Jack' : t.soft && t.total < 21 ? `${t.total - 10} oder ${t.total}` : String(t.total);
      const said = h.claim !== null ? ` (angesagt: ${h.claim})` : '';
      const res = h.result ? ` – ${RESULT[h.result]}` : '';
      const turn = mine.turn?.box === mySeat && mine.turn.hand === i && mine.phase === 'play' ? '▶ ' : '';
      return `${turn}${n > 1 ? `Hand ${i + 1}: ` : 'Deine Hand: '}${h.cards.map(cardName).join(', ')} = ${sum}${said} · Einsatz ${formatChips(h.bet)}${h.doubled ? ' (verdoppelt)' : ''}${res}`;
    });
    if (box.insurance > 0) lines.push(`Versichert mit ${formatChips(box.insurance)}`);
    return lines;
  }

  function actions() {
    const v = mine;
    if (waiting) return [];
    const out = [];
    if (account(v, mySeat) === 0 && !(inRound(v) && v.boxes[mySeat])) out.push({ act: 'borrow', text: `Bei der Bank leihen (${formatChips(LOAN)})` });
    if (v.phase === 'done' && v.free) out.push({ act: 'again', text: 'Nächste Runde' });
    if (v.phase === 'insurance' && v.boxes[mySeat]?.insurance === null) {
      const amount = insuranceOf(v, mySeat);
      out.push({ act: 'insure', text: `Versichern (${formatChips(amount)})`, disabled: amount <= 0 || amount > v.stacks[mySeat] });
      out.push({ act: 'noinsure', text: 'Keine Versicherung', secondary: true });
    }
    if (v.free && inRound(v) && v.boxes[mySeat] && !v.boxes[mySeat].forfeit && !v.peek[mySeat]) out.push({ act: 'peek', text: 'Nächste Karte ansehen', secondary: true });
    if (!myTurn()) return out;
    const o = options(v, mySeat);
    const h = hand();
    const two = h.cards.length === 2 && !h.doubled;
    const money_ = v.stacks[mySeat] >= h.bet;
    // ohne Hilfen ist alles da (nur Geld muss reichen); sonst nur, was die Regeln erlauben
    out.unshift(
      { act: 'hit', text: 'Karte', disabled: !v.free && !o.hit },
      { act: 'stand', text: 'Bleiben' },
      { act: 'double', text: `Verdoppeln (${formatChips(h.bet)})`, disabled: v.free ? !(two && money_) : !o.double },
      { act: 'split', text: `Teilen (${formatChips(h.bet)})`, disabled: v.free ? !(two && money_ && v.boxes[mySeat].hands.length < 4) : !o.split },
    );
    return out;
  }

  // Einsatz: in der Setzrunde der eigene, ohne Hilfen während der Runde „Einsatz erhöhen“
  function betBox() {
    const v = mine;
    if (waiting) return null;
    const stack = v.stacks[mySeat];
    const range = stack < MIN ? { min: stack, max: stack, step: 1 } : { min: MIN, max: Math.min(MAX, stack - (stack % MIN)), step: MIN };
    if (v.phase === 'bet' && v.bets[mySeat] === null && stack > 0) {
      return { ...range, start: Math.min(range.max, Math.max(range.min, 50)), label: 'Setzen', act: 'bet', key: `${v.id}-${v.round}-bet` };
    }
    if (v.free && inRound(v) && v.boxes[mySeat] && !v.boxes[mySeat].forfeit && stack > 0) {
      return { ...range, start: range.min, label: 'Einsatz erhöhen um', act: 'raise', key: `${v.id}-${v.round}-raise` };
    }
    return null;
  }

  function statusText() {
    const v = mine;
    if (waiting) return 'Wird gesendet …';
    if (v.phase === 'setup') return isHost ? 'Wähl, wie viele Computer mitspielen' : `${names.other()} wählt die Mitspieler …`;
    if (v.phase === 'bet') {
      if (v.bets[mySeat] === null && v.stacks[mySeat] > 0) return 'Setz deinen Einsatz – Regler oder Chip in deine Box';
      if (!humans.some((p) => v.stacks[p] > 0 || v.bets[p])) return 'Keiner hat mehr Chips – leih dir Geld von der Bank';
      if (v.stacks[mySeat] === 0 && !v.bets[mySeat]) return 'Du hast nichts mehr – leih dir Geld oder schau zu';
      return `Warte auf den Einsatz von ${names.other()} …`;
    }
    if (v.phase === 'insurance') {
      if (v.boxes[mySeat]?.insurance === null) return 'Die Bank zeigt ein Ass – versichern?';
      return 'Die anderen entscheiden sich noch …';
    }
    if (v.phase === 'done') {
      const net = v.boxes[mySeat] ? v.payout[mySeat] - v.staked[mySeat] : null;
      const res = net === null ? 'Runde vorbei' : net > 0 ? `Du gewinnst ${formatChips(net)}` : net < 0 ? `Du verlierst ${formatChips(-net)}` : 'Gleichstand – Einsatz zurück';
      return v.free ? `${res} – „Nächste Runde“, wenn ihr so weit seid` : `${res} – gleich geht es weiter`;
    }
    if (!v.boxes[mySeat]) return 'Du schaust diese Runde zu';
    if (v.turn.box !== mySeat) return `${nameOf(v.turn.box)} ${verb(v.turn.box, 'bist', 'ist')} dran …`;
    const t = total(hand().cards).total;
    return `Du bist dran – ${t}: Karte oder bleiben?`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = nameOf(e.player);
      if (e.type === 'setup') parts.push(e.cpus ? `${e.cpus} Computer spielen mit.` : 'Ohne Computer am Tisch.');
      else if (e.type === 'newcpu') parts.push(`Neu am Tisch: ${e.name}.`);
      else if (e.type === 'shuffle') parts.push('Die Schnittkarte ist da – neu gemischt.');
      else if (e.type === 'deal') parts.push(`Runde ${e.round}: Die Bank zeigt ${cardName(mine.dealer[0])}.`);
      else if (e.type === 'bet' && humans.includes(e.player)) parts.push(`${who} ${verb(e.player, 'setzt', 'setzt')} ${formatChips(e.amount)}.`);
      else if (e.type === 'insure') parts.push(e.amount ? `${who} ${verb(e.player, 'versicherst dich', 'versichert sich')}.` : `${who} ${verb(e.player, 'versicherst dich', 'versichert sich')} nicht.`);
      else if (e.type === 'blackjack') parts.push(`${who}: Black Jack!`);
      else if (e.type === 'card') parts.push(`${who} ${e.auto ? verb(e.player, 'bekommst', 'bekommt') : verb(e.player, 'ziehst', 'zieht')} ${cardName(e.card)}.`);
      else if (e.type === 'stand') parts.push(`${who} ${verb(e.player, 'bleibst', 'bleibt')} bei ${e.total}.`);
      else if (e.type === 'claim') parts.push(`${who} ${verb(e.player, 'bleibst', 'bleibt')} bei ${e.total}.`); // klingt wie ehrliches Bleiben
      else if (e.type === 'bust') parts.push(`${who} ${verb(e.player, 'hast', 'hat')} ${e.total} – verkauft.`);
      else if (e.type === 'double') parts.push(`${who} ${verb(e.player, 'verdoppelst', 'verdoppelt')} und ${verb(e.player, 'bekommst', 'bekommt')} ${cardName(e.card)}.`);
      else if (e.type === 'split') parts.push(`${who} ${verb(e.player, 'teilst', 'teilt')}.`);
      else if (e.type === 'raise') parts.push(`${who} ${verb(e.player, 'legst', 'legt')} ${formatChips(e.amount)} nach.`);
      else if (e.type === 'dealer') parts.push(e.blackjack ? 'Die Bank hat Black Jack!' : e.cards.length ? `Die Bank zieht ${e.cards.map(cardName).join(', ')} – ${e.total > 21 ? `${e.total}, verkauft` : e.total}.` : 'Die Bank zieht nicht mehr.');
      else if (e.type === 'borrow') parts.push(`${who} ${verb(e.player, 'leihst dir', 'leiht sich')} ${formatChips(e.amount)} von der Bank.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      // ist die Runde schon abgerechnet, geht auch zurück, was er bekommen hatte – in jedem Fall sind alle Einsätze weg
      const [du, er] = e.resettled
        ? ['Was du in dieser Runde zurückbekommen hast, geht an die Bank – alle deine Einsätze sind verloren.', 'Was er in dieser Runde zurückbekommen hat, geht an die Bank – alle seine Einsätze sind verloren.']
        : ['Alle deine Einsätze dieser Runde sind verloren.', 'Alle seine Einsätze dieser Runde sind verloren.'];
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast ${e.why}. ${du}` : `Erwischt! ${nameOf(e.player)} hat ${e.why}. ${er}`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat nicht geschummelt – du zahlst ${formatChips(e.paid)}.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen – ${e.player === BANK ? 'die Bank zahlt' : 'zahlt'} dir ${formatChips(e.paid)}.`;
  }

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
      stopFrames();
      board.reset();
    },
  };
}
