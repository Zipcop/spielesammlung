// Texas Hold'em (No-Limit) für bis zu 6 Plätze als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion
// liefert einen neuen Zustand oder null (ungültig). Sitze 0–5 im Uhrzeigersinn: 0 = Host (+z), 3 = Gast (−z, gegenüber),
// die übrigen spielt der Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln (en.wikipedia.org/wiki/Texas_hold_%27em und Robert's Rules of Poker, Abschnitt No-Limit/Blinds, abgerufen
// 20.10.2026): Jeder bekommt 2 verdeckte Karten, links vom Dealer-Knopf setzen Small und Big Blind (5/10). Vier
// Setzrunden: Preflop (beginnt links vom Big Blind), Flop (3 Karten), Turn, River (je 1, vor jeder wird eine Karte
// verbrannt) – ab dem Flop beginnt der Erste links vom Knopf. Zu zweit setzt der Knopf den Small Blind und handelt
// preflop zuerst. Erhöhen mindestens um die letzte volle Erhöhung (anfangs 1 Big Blind); ein All-in darunter öffnet die
// Runde für die, die schon gehandelt haben, nicht neu (sie dürfen nur mitgehen oder passen). Showdown: beste 5 aus 7
// (hand.js); Side Pots nach den Einsätzen der All-in-Spieler; Gleichstand teilt, der unteilbare Rest geht an den
// ersten Gewinner links vom Knopf. Sind alle bis auf einen all-in, werden die Karten sofort aufgedeckt.
// Vereinfachung: Der Knopf wandert einfach zum nächsten Spieler mit Chips (keine „Dead Button“-Regel).
//
// Spielgeld (Nico 20.10.2026): Menschen setzen sich mit ihrem ganzen Konto (spielgeld.js); wer pleite ist, leiht bei
// der Bank (borrow). Computer bringen 1.000 mit; ist einer pleite, kommt ein neuer.
//
// „Ohne Hilfen“ (free, Nico 20.10.2026): Bluffen ist kein Schummeln. Schummeln ist (vermerkt, sieht nur der Host):
// zu wenig bezahlen ('short'), zu wenig erhöhen ('minraise', 'reopen'), schieben trotz offenem Einsatz ('check'),
// heimlich die nächste Gemeinschaftskarte ansehen ('peek') und beim Showdown eine bessere Hand ansagen ('claim') –
// ohne Hilfen sagt jeder seine Hand selbst an, der Pot geht nach den Ansagen. „Geschummelt!“ geht bis zur nächsten
// Hand: Erwischt verliert der Schummler die Hand (Gesetztes bleibt im Pot; ist die Hand schon vorbei, wird der Pot
// nach den echten Karten ohne ihn neu verteilt – hat sonst keiner mehr Karten, bekommt ihn der Rufer). Fehlalarm:
// Der Rufer zahlt dem Beschuldigten 2 Big Blinds.
import { makeDeck, shuffle } from '../karten/cards.js';
import { evaluate, handName, CATEGORIES } from './hand.js';

export const SEATS = [0, 1, 2, 3, 4, 5];
export const SMALL = 5;
export const BIG = 10;
export const BUY_IN = 1000; // so viel bringt ein Computer mit
export const PENALTY = 2 * BIG; // Fehlalarm
export const STREETS = ['preflop', 'flop', 'turn', 'river'];
export const CPU_NAMES = ['Bruno', 'Erika', 'Kalle', 'Lotte', 'Hannes', 'Greta', 'Otto', 'Frieda', 'Paul', 'Ilse', 'Jupp', 'Trude'];
export const STYLES = ['fels', 'hai', 'zocker', 'fisch']; // ai.js
export { CATEGORIES };

const N = 6;
const set = (arr, i, v) => arr.map((x, k) => (k === i ? v : x));
// Sitze ab start im Uhrzeigersinn (start eingeschlossen)
const from = (start) => SEATS.map((k) => (start + k) % N);
const isLive = (st) => st === 'in' || st === 'allin';
export const live = (s) => SEATS.filter((p) => isLive(s.status[p]));
export const betting = (s) => STREETS.includes(s.phase);
export const pot = (s) => s.invested.reduce((a, b) => a + b, 0);
const bump = (s, events, extra) => ({ ...s, ...extra, seq: s.seq + 1, events });

function newCpu(s, rng) {
  const used = new Set(s.players.map((p) => p?.name));
  const names = CPU_NAMES.filter((n) => !used.has(n));
  const name = names[Math.floor(rng() * names.length)] ?? 'Computer';
  return { human: false, name, style: STYLES[Math.floor(rng() * STYLES.length)] };
}

// --- Neue Runde am Tisch (noch ohne Hand) ---
// humans = Sitze der Menschen (Host 0, Gast 3), chips = ihre Konten { sitz: chips }
export function newGame({ humans = [0], chips = {}, free = false, seq = 0, id = null } = {}, rng = Math.random) {
  let s = {
    seq,
    events: [{ type: 'start' }],
    id: id ?? Math.floor(rng() * 2 ** 32).toString(36),
    hand: 0,
    free,
    humans: [...humans],
    players: new Array(N).fill(null),
    stacks: SEATS.map((p) => (humans.includes(p) ? Math.max(0, Math.floor(chips[p] ?? 0)) : BUY_IN)),
    button: null,
    phase: 'wait', // wait → preflop → flop → turn → river → (claim) → done → preflop …
    deck: [],
    board: [],
    holes: new Array(N).fill(null),
    status: new Array(N).fill('out'), // out = keine Karten · in · fold · allin
    bet: new Array(N).fill(0), // in dieser Setzrunde
    invested: new Array(N).fill(0), // in dieser Hand insgesamt
    current: 0, // höchster Einsatz dieser Setzrunde
    minRaise: BIG,
    acted: new Array(N).fill(false), // seit der letzten vollen Erhöhung gehandelt
    raises: new Array(N).fill(0), // wie oft jemand in dieser Hand gesetzt/erhöht hat (sieht jeder)
    pending: [], // wer in dieser Setzrunde noch handeln muss
    turn: null,
    claims: new Array(N).fill(null), // ohne Hilfen: angesagte Kategorie beim Showdown
    shown: [], // aufgedeckte Hände
    payout: new Array(N).fill(0), // Gewinne der letzten Hand
    pots: [], // [{ amount, winners, eligible }]
    peek: new Array(N).fill(null), // ohne Hilfen: heimlich angesehene nächste Karte
    cheats: [], // { player, kind, why, seq }
    waived: false,
  };
  for (const p of SEATS) if (!humans.includes(p)) s.players = set(s.players, p, newCpu(s, rng));
  for (const p of humans) s.players = set(s.players, p, { human: true });
  return s;
}

const nextOf = (s, seat, ok) => from(seat + 1).find(ok) ?? null;

// --- Neue Hand: pleite Computer ersetzen, Knopf weiter, Blinds, je 2 Karten. null = keiner der Menschen hat Chips ---
export function nextHand(s, rng = Math.random) {
  if (betting(s) || s.phase === 'claim') return null;
  const events = [];
  let players = s.players;
  let stacks = s.stacks;
  for (const p of SEATS) {
    if (players[p].human || stacks[p] > 0) continue;
    const cpu = newCpu({ players }, rng);
    players = set(players, p, cpu);
    stacks = set(stacks, p, BUY_IN);
    events.push({ type: 'newcpu', player: p, name: cpu.name });
  }
  const seated = SEATS.filter((p) => stacks[p] > 0);
  if (!s.humans.some((p) => stacks[p] > 0) || seated.length < 2) return null;
  const has = (p) => stacks[p] > 0;
  const button = s.button === null ? seated[Math.floor(rng() * seated.length)] : nextOf(s, s.button, has);
  const heads = seated.length === 2;
  const sb = heads ? button : nextOf(s, button, has);
  const bb = nextOf(s, sb, has);
  let deck = shuffle(makeDeck('2'), rng);
  const holes = new Array(N).fill(null);
  const order = from(sb).filter(has);
  order.forEach((p, i) => (holes[p] = [deck[i], deck[i + order.length]]));
  deck = deck.slice(order.length * 2);
  const status = SEATS.map((p) => (has(p) ? 'in' : 'out'));
  const bet = new Array(N).fill(0);
  const post = (p, amount) => {
    const put = Math.min(amount, stacks[p]);
    stacks = set(stacks, p, stacks[p] - put);
    bet[p] = put;
    if (stacks[p] === 0) status[p] = 'allin';
    events.push({ type: 'blind', player: p, put, big: amount === BIG });
  };
  post(sb, SMALL);
  post(bb, BIG);
  const next = {
    ...s,
    players, stacks, button, deck, holes, status, bet,
    hand: s.hand + 1,
    phase: 'preflop',
    board: [],
    invested: [...bet],
    current: BIG,
    minRaise: BIG,
    acted: new Array(N).fill(false),
    raises: new Array(N).fill(0),
    pending: from(heads ? sb : bb + 1).filter((p) => status[p] === 'in'),
    turn: null,
    claims: new Array(N).fill(null),
    shown: [],
    payout: new Array(N).fill(0),
    pots: [],
    peek: new Array(N).fill(null),
    cheats: [],
    waived: false,
  };
  const all = [{ type: 'deal', hand: next.hand, button, sb, bb }, ...events];
  return proceed(next, all, bb); // dran ist der Erste nach dem Big Blind (zu zweit: der Knopf)
}

// Was darf seat gerade? (für Oberfläche und Computer) – call = zu bezahlen, raise = { min, max } (Gesamteinsatz der Runde)
export function options(s, seat) {
  if (!betting(s) || s.turn !== seat) return null;
  const need = Math.max(0, s.current - s.bet[seat]);
  const all = s.bet[seat] + s.stacks[seat];
  const others = SEATS.some((p) => p !== seat && s.status[p] === 'in');
  const can = !s.acted[seat] && all > s.current && others;
  const min = Math.min(all, s.current === 0 ? BIG : s.current + s.minRaise);
  return {
    need: Math.min(need, s.stacks[seat]),
    check: need === 0,
    raise: can ? { min, max: all } : null,
  };
}

const why = {
  check: (need) => `geschoben, obwohl ${need} zu bezahlen waren`,
  short: (paid, need) => `nur ${paid} statt ${need} bezahlt`,
  minraise: (to, min) => `auf ${to} erhöht – mindestens ${min} wäre nötig`,
  reopen: () => 'erhöht, obwohl nach dem kleinen All-in nur Mitgehen erlaubt war',
};

// --- Setzen: fold · check · call · raise (to = Gesamteinsatz dieser Setzrunde) ---
export function act(s, seat, move, to) {
  const opt = options(s, seat);
  if (!opt) return null;
  const need = s.current - s.bet[seat];
  let cheat = null;
  let put = 0;
  if (move === 'fold') {
    const status = set(s.status, seat, 'fold');
    const next = { ...s, status, pending: s.pending.filter((p) => p !== seat), acted: set(s.acted, seat, true) };
    return proceed(next, [{ type: 'fold', player: seat }], seat);
  }
  if (move === 'check') {
    if (need > 0) {
      if (!s.free) return null;
      cheat = { kind: 'check', why: why.check(Math.min(need, s.stacks[seat])) };
    }
  } else if (move === 'call') {
    if (need <= 0) return null;
    put = Math.min(need, s.stacks[seat]);
  } else if (move === 'raise') {
    if (!Number.isInteger(to)) return null;
    put = to - s.bet[seat];
    if (put <= 0 || put > s.stacks[seat]) return null;
    const allIn = put === s.stacks[seat];
    if (to <= s.current) {
      // weniger als nötig gezahlt (genau mitgehen und ein All-in für weniger sind erlaubt)
      if (to < s.current && !allIn) {
        if (!s.free) return null;
        cheat = { kind: 'short', why: why.short(put, need) };
      }
    } else if (!opt.raise) {
      if (!s.free) return null;
      // nach einem kleinen All-in nur mitgehen – mehr als ein All-in-Gegner zu setzen ist dagegen nur sinnlos (kommt zurück)
      if (s.acted[seat]) cheat = { kind: 'reopen', why: why.reopen() };
    } else if (to - s.current < s.minRaise && !allIn) {
      if (!s.free) return null;
      cheat = { kind: 'minraise', why: why.minraise(to, opt.raise.min) };
    }
  } else return null;

  const stacks = set(s.stacks, seat, s.stacks[seat] - put);
  const bet = set(s.bet, seat, s.bet[seat] + put);
  const invested = set(s.invested, seat, s.invested[seat] + put);
  const status = stacks[seat] === 0 ? set(s.status, seat, 'allin') : s.status;
  let { current, minRaise, pending } = s;
  let acted = set(s.acted, seat, true);
  pending = pending.filter((p) => p !== seat);
  if (bet[seat] > current) {
    const raise = bet[seat] - current;
    if (raise >= minRaise) {
      minRaise = raise; // volle Erhöhung: alle anderen dürfen wieder erhöhen
      acted = SEATS.map((p) => p === seat);
    }
    current = bet[seat];
    pending = from(seat + 1).filter((p) => p !== seat && status[p] === 'in');
  }
  const kind = move === 'raise' ? (bet[seat] > s.current ? (s.current === 0 ? 'bet' : 'raise') : 'call') : move;
  const event = { type: 'bet', player: seat, move: kind, put, to: bet[seat], allin: status[seat] === 'allin' };
  const cheats = cheat ? [...s.cheats, { player: seat, ...cheat, seq: s.seq + 1 }] : s.cheats;
  const raises = kind === 'bet' || kind === 'raise' ? set(s.raises, seat, s.raises[seat] + 1) : s.raises;
  return proceed({ ...s, stacks, bet, invested, status, current, minRaise, acted, pending, cheats, raises }, [event], seat);
}

// Nach einer Aktion: Nächster am Zug, nächste Straße, Showdown oder Hand vorbei
function proceed(s, events, after) {
  if (live(s).length === 1) return settle(s, events);
  const pending = s.pending.filter((p) => s.status[p] === 'in');
  if (pending.length) {
    const turn = from(after + 1).find((p) => pending.includes(p));
    return bump(s, events, { pending, turn });
  }
  // Setzrunde vorbei
  let next = { ...s, bet: new Array(N).fill(0), current: 0, minRaise: BIG, acted: new Array(N).fill(false), pending: [], turn: null };
  const all = [...events];
  const canAct = SEATS.filter((p) => next.status[p] === 'in');
  // höchstens einer kann noch setzen → Karten auf, Board fertig austeilen
  if (canAct.length <= 1 && !next.shown.length) {
    next = { ...next, shown: live(next) };
    all.push({ type: 'reveal', players: live(next) });
  }
  while (next.phase !== 'river') {
    next = dealStreet(next, all);
    if (canAct.length > 1) {
      const first = from(next.button + 1).filter((p) => next.status[p] === 'in');
      return bump(next, all, { pending: first, turn: first[0] });
    }
  }
  // Showdown
  if (s.free) {
    const players = live(next);
    return bump(next, [...all, { type: 'showdown', players }], { phase: 'claim', shown: players, turn: null });
  }
  return settle({ ...next, shown: live(next) }, all);
}

function dealStreet(s, events) {
  const at = STREETS.indexOf(s.phase) + 1;
  const n = at === 1 ? 3 : 1;
  const cards = s.deck.slice(1, 1 + n); // eine verbrennen
  events.push({ type: 'street', name: STREETS[at], cards });
  return { ...s, phase: STREETS[at], board: [...s.board, ...cards], deck: s.deck.slice(1 + n), peek: new Array(N).fill(null) };
}

// --- Ohne Hilfen: beim Showdown die eigene Hand ansagen (0 = Höchste Karte … 8 = Straight Flush) ---
export function claim(s, seat, cat) {
  if (s.phase !== 'claim' || !isLive(s.status[seat]) || s.claims[seat] !== null) return null;
  if (!Number.isInteger(cat) || cat < 0 || cat >= CATEGORIES.length) return null;
  const real = evaluate([...s.holes[seat], ...s.board]);
  const lie = cat > real.cat;
  const cheats = lie ? [...s.cheats, { player: seat, kind: 'claim', why: `„${CATEGORIES[cat]}“ angesagt, aber nur ${handName(real)}`, seq: s.seq + 1 }] : s.cheats;
  const claims = set(s.claims, seat, cat);
  const next = { ...s, claims, cheats };
  const events = [{ type: 'claim', player: seat, cat }];
  if (live(next).every((p) => claims[p] !== null)) return settle(next, events);
  return bump(next, events, {});
}

// Wertung einer Hand am Showdown: echt – oder ohne Hilfen nach der Ansage (innerhalb der Kategorie zählt die echte
// Hand nur, wenn sie wirklich so ist, sonst ist sie die kleinste dieser Kategorie)
function scoreOf(s, p, honest) {
  const real = evaluate([...s.holes[p], ...s.board]);
  const said = s.claims[p];
  if (honest || said === null) return real.score;
  return said === real.cat ? real.score : said * 16 ** 5;
}

// Pots nach Einsatzhöhen: Jeder Pot gehört denen, die bis zu seiner Höhe dabei sind. Geld über der Höhe aller
// verbliebenen Spieler (nur ohne Hilfen möglich) kommt in den obersten Pot – oder gehört allen, die noch dabei sind.
export function buildPots(invested, contenders) {
  const levels = [...new Set(contenders.map((p) => invested[p]))].filter((x) => x > 0).sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    const amount = invested.reduce((sum, x) => sum + Math.max(0, Math.min(x, level) - prev), 0);
    pots.push({ amount, eligible: contenders.filter((p) => invested[p] >= level) });
    prev = level;
  }
  const rest = invested.reduce((sum, x) => sum + Math.max(0, x - prev), 0);
  if (rest && pots.length) pots.at(-1).amount += rest;
  else if (rest) pots.push({ amount: rest, eligible: [...contenders] });
  return pots;
}

// Hand abrechnen. fallback = wer einen Pot bekommt, um den sonst keiner mehr spielt (Rufer nach „Geschummelt!“)
function settle(s, events, { honest = false, fallback = null } = {}) {
  const contenders = live(s);
  const pots = buildPots(s.invested, contenders);
  const payout = new Array(N).fill(0);
  const showdown = contenders.length > 1;
  const score = showdown ? Object.fromEntries(contenders.map((p) => [p, scoreOf(s, p, honest)])) : {};
  const result = pots.map(({ amount, eligible }) => {
    let winners;
    if (!eligible.length) winners = fallback !== null ? [fallback] : [];
    else if (eligible.length === 1) winners = eligible;
    else {
      const best = Math.max(...eligible.map((p) => score[p]));
      winners = eligible.filter((p) => score[p] === best);
    }
    // unteilbarer Rest: an den ersten Gewinner links vom Knopf
    winners = from(s.button + 1).filter((p) => winners.includes(p));
    const share = Math.floor(amount / winners.length);
    winners.forEach((p, i) => (payout[p] += share + (i < amount - share * winners.length ? 1 : 0)));
    return { amount, winners, eligible };
  });
  const stacks = s.stacks.map((x, p) => x + payout[p]);
  // Namen der Hände fürs Protokoll – ohne Hilfen die Ansage (die echten Karten liegen ja offen, prüfen muss man selbst)
  const nameOf = (p) => (!honest && s.claims[p] !== null ? `${CATEGORIES[s.claims[p]]} (angesagt)` : handName(evaluate([...s.holes[p], ...s.board])));
  const hands = showdown ? Object.fromEntries(contenders.map((p) => [p, nameOf(p)])) : {};
  const event = { type: 'win', pots: result, payout, hands, showdown };
  return bump(s, [...events, event], {
    stacks, payout, pots: result, phase: 'done', turn: null, pending: [], bet: new Array(N).fill(0), current: 0,
    shown: showdown || s.phase === 'done' ? (s.shown.length ? s.shown : contenders) : [],
  });
}

// --- Ohne Hilfen: heimlich die nächste Gemeinschaftskarte ansehen (vor dem River, wer noch Karten hat) ---
export function peek(s, seat) {
  if (!s.free || !betting(s) || s.phase === 'river' || !isLive(s.status[seat]) || s.peek[seat]) return null;
  const card = s.deck[1]; // die oberste wird verbrannt
  const cheat = { player: seat, kind: 'peek', why: 'heimlich die nächste Gemeinschaftskarte angesehen', seq: s.seq + 1 };
  return bump(s, [{ type: 'peek', player: seat }], { peek: set(s.peek, seat, card), cheats: [...s.cheats, cheat] });
}

// --- Ohne Hilfen: „Geschummelt!“ – bis die nächste Hand ausgeteilt ist ---
export function accuse(s, by, target, rng = Math.random) {
  if (!s.free || by === target || !SEATS.includes(by) || !SEATS.includes(target) || s.hand === 0) return null;
  const found = s.cheats.filter((c) => c.player === target);
  if (!found.length) {
    const paid = Math.min(PENALTY, s.stacks[by]);
    const stacks = s.stacks.map((x, p) => (p === by ? x - paid : p === target ? x + paid : x));
    return bump(s, [{ type: 'fehlalarm', player: by, target, paid }], { stacks });
  }
  const kinds = [...new Set(found.map((c) => c.kind))];
  const reasons = [...new Set(found.map((c) => c.why))].slice(0, 2).join(' und ');
  const event = { type: 'caught', player: target, by, kinds, why: reasons };
  const cheats = s.cheats.filter((c) => c.player !== target);
  const status = isLive(s.status[target]) ? set(s.status, target, 'fold') : s.status;
  if (s.phase === 'done') {
    // Hand ist schon abgerechnet: zurückdrehen und nach den echten Karten ohne ihn neu verteilen
    const back = { ...s, stacks: s.stacks.map((x, p) => x - s.payout[p]), status, cheats, claims: new Array(N).fill(null) };
    return settleDebt(settle(back, [{ ...event, resettled: true }], { honest: true, fallback: by }));
  }
  const next = { ...s, status, cheats, claims: set(s.claims, target, null), pending: s.pending.filter((p) => p !== target) };
  if (s.phase === 'claim') {
    if (live(next).length === 1 || live(next).every((p) => next.claims[p] !== null)) return settle(next, [event], { fallback: by });
    return bump(next, [event], {});
  }
  if (live(next).length === 1) return settle(next, [event]);
  if (s.turn !== target) return bump(next, [event], {});
  return proceed(next, [event], target);
}

// Hat jemand vom alten Gewinn schon etwas weggegeben (Fehlalarm), fehlt es beim Zurückdrehen: Der Stapel bleibt bei 0,
// und die neuen Gewinner bekommen so viel weniger (größter Gewinn zuerst) – es entstehen keine Chips
function settleDebt(s) {
  const debt = s.stacks.reduce((sum, x) => sum + Math.max(0, -x), 0);
  if (!debt) return s;
  const stacks = s.stacks.map((x) => Math.max(0, x));
  const payout = [...s.payout];
  let rest = debt;
  for (const p of SEATS.filter((x) => payout[x] > 0).sort((a, b) => payout[b] - payout[a])) {
    const take = Math.min(rest, payout[p], stacks[p]);
    payout[p] -= take;
    stacks[p] -= take;
    rest -= take;
  }
  return { ...s, stacks, payout };
}

// Allein nach der Hand: Der Computer hat sie geprüft und lässt sie gelten
export const waive = (s) => (s.free && s.phase === 'done' && !s.waived ? { ...s, waived: true } : null);

// Ein Mensch will die nächste Hand. Wer in dieser Hand geschummelt hat, startet sie nicht selbst, solange man ihn noch
// erwischen kann: allein, bis der Computer geprüft hat (waive), zu zweit startet der andere (und verzichtet damit).
// Haben beide geschummelt, darf jeder – wer startet, verzichtet ja auch auf seine Anklage.
export function deal(s, seat, rng = Math.random) {
  if (s.phase !== 'done' && s.phase !== 'wait') return null;
  const cheated = (p) => s.cheats.some((c) => c.player === p);
  const watched = s.humans.length === 1 ? !s.waived : s.humans.some((p) => p !== seat && !cheated(p));
  if (s.free && watched && cheated(seat)) return null;
  return nextHand(s, rng);
}

// --- Spielgeld: Wer nichts mehr hat, leiht sich bei der Bank (zählt erst für die nächste Hand) ---
export function borrow(s, seat, amount) {
  const inHand = (betting(s) || s.phase === 'claim') && isLive(s.status[seat]);
  if (!s.humans.includes(seat) || s.stacks[seat] > 0 || inHand || !(amount > 0)) return null;
  return bump(s, [{ type: 'borrow', player: seat, amount }], { stacks: set(s.stacks, seat, amount) });
}

// Konto eines Menschen nach diesem Stand: Chips vor ihm plus, was er in die laufende Hand gesetzt hat (eine
// unterbrochene Hand kostet nichts)
export const account = (s, seat) => s.stacks[seat] + (s.phase === 'done' || s.phase === 'wait' ? 0 : s.invested[seat]);

// Kontostand hat sich außerhalb dieser Runde geändert (z. B. Fortsetzen nach anderem Spiel): Chips angleichen
// Reicht der Stapel nicht, kommt der Rest aus dem, was er in der laufenden Hand gesetzt hat (das Geld gab es ja nicht).
export function setAccount(s, seat, chips) {
  const diff = Math.floor(chips) - account(s, seat);
  if (!diff) return s;
  const short = Math.max(0, -(s.stacks[seat] + diff));
  const cut = s.phase === 'done' || s.phase === 'wait' ? 0 : Math.min(short, s.invested[seat]);
  return {
    ...s,
    stacks: set(s.stacks, seat, Math.max(0, s.stacks[seat] + diff)),
    invested: set(s.invested, seat, s.invested[seat] - cut),
    bet: set(s.bet, seat, Math.max(0, s.bet[seat] - cut)),
  };
}

// --- Sicht eines Spielers: fremde Karten verdeckt (außer aufgedeckt), Stapel nur als Anzahl, Schummeleien nur beim Host ---
export function viewFor(s, seat) {
  return {
    ...s,
    deck: s.deck.length,
    holes: s.holes.map((h, p) => (!h || p === seat || s.shown.includes(p) ? h : [null, null])),
    peek: s.peek.map((c, p) => (p === seat ? c : null)),
    cheats: [],
    events: s.events.filter((e) => e.type !== 'peek' || e.player === seat),
  };
}
