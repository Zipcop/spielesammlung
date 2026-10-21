// Black Jack an fünf Boxen gegen die Bank (Computer-Croupier) als reine Funktionen. Der Host hält den vollen Stand:
// Jede Aktion liefert einen neuen Zustand oder null (ungültig). Boxen 0–4 in Spielreihenfolge (Box 0 links vom
// Croupier, „first base“): Host Box 1, Gast Box 3, freie Boxen besetzt auf Wunsch der Computer. Jeder sieht nur
// viewFor(state, box).
//
// Regeln wie in deutschen Spielbanken (Spielbanken Bayern, „Black Jack Spielregeln“, Stand August 2018; Spielbanken
// Niedersachsen, „Spielerklärung Black Jack“, 2020; de.wikipedia.org/wiki/Black_Jack – alle abgerufen 21.10.2026):
// 6 Kartenspiele à 52 Blatt aus dem Schlitten, eine Schnittkarte trennt den Rest ab – erscheint sie, wird die laufende
// Runde zu Ende gespielt und dann neu gemischt. Ass 1 oder 11, Bilder 10. Jede Box bekommt offen eine Karte, die Bank
// eine, dann jede Box die zweite – die Bank bekommt ihre zweite Karte erst, wenn alle Boxen fertig sind (europäisch,
// ohne verdeckte Karte). Black Jack (Ass + 10/Bild in den ersten zwei Karten) zahlt 3 : 2, gegen Black Jack der Bank
// Gleichstand. Die Bank zieht bis 16 und steht ab 17 (auch „soft“, Ass als 11). Verdoppeln nur auf 9, 10 oder 11 aus
// den ersten zwei Karten, danach genau eine Karte – auch nach dem Teilen. Teilen bei zwei gleichwertigen Karten (auch
// 10 und König), erneut teilen geht; geteilte Asse bekommen je nur eine Karte (ein weiteres Ass darf wieder geteilt
// werden); nach dem Teilen sind Ass + 10 nur 21, kein Black Jack. Versicherung bei Ass der Bank: halber Einsatz,
// zahlt 2 : 1. Hat die Bank Black Jack, verlieren alle Einsätze außer Black Jack – auch Verdoppeltes und Geteiltes
// (Wikipedia: „riskiert er jeden dieser Einsätze zu verlieren“).
// Eigene Festlegungen (Nico bestätigen): 5 Boxen, Einsatz 10 bis 500 in Zehnern (wer weniger als 10 hat, setzt den
// Rest), höchstens 4 Hände je Box, Versicherung nur gleich nach dem Austeilen (für den Grundeinsatz), kein
// „pay me out“, keine Nebenwetten, Black-Jack-Gewinn abgerundet auf ganze Chips.
//
// Spielgeld (wie Poker, Nico 20.10.2026): Menschen setzen sich mit ihrem ganzen Konto (spielgeld.js); wer pleite ist,
// leiht bei der Bank (borrow). Computer bringen 1.000 mit; ist einer pleite, kommt ein neuer.
//
// „Ohne Hilfen“ (free – die Bank schummelt nie; zu zweit schummeln nur die beiden Menschen, allein auch die
// Computer-Mitspieler ab und zu, index.js): Für die Hände der Menschen prüft und beendet niemand etwas (nur ein
// ausgeteilter Black Jack ist sofort fertig). Schummeln ist (vermerkt, sieht nur der Host): heimlich die
// nächste Karte im Schlitten ansehen ('peek'), beim Bleiben eine höhere Summe ansagen – auch über 21 weiterspielen
// und dann ansagen ('claim'), verdoppeln ohne 9/10/11 ('double'), Ungleiches teilen ('split'), nach dem Verdoppeln
// oder auf geteilte Asse noch eine Karte nehmen ('more'), den Einsatz nach dem Austeilen erhöhen ('raise').
// „Geschummelt!“ (gegen einen gewählten Spieler) geht, bis die nächste Runde beginnt: Erwischt verliert der Schummler
// alle Einsätze dieser Runde (ist sie schon abgerechnet, wird zurückgebucht, was er bekam). Fehlalarm: Der Rufer zahlt
// dem Beschuldigten 20. Allein prüfen die Computer; sitzt keiner am Tisch, prüft der Croupier (BANK – sein Fehlalarm
// zahlt die Bank).
import { makeDeck, shuffle, rankOf, cardName } from '../karten/cards.js';

export const BOXES = [0, 1, 2, 3, 4];
export const HOST = 1;
export const BANK = -1; // der Croupier als Prüfer (ohne Hilfen allein ohne Computer-Mitspieler)
export const GUEST = 3;
export const MIN = 10;
export const MAX = 500;
export const DECKS = 6;
export const BUY_IN = 1000; // so viel bringt ein Computer mit
export const MAX_HANDS = 4;
export const PENALTY = 2 * MIN; // Fehlalarm
export const CPU_NAMES = ['Bruno', 'Erika', 'Kalle', 'Lotte', 'Hannes', 'Greta', 'Otto', 'Frieda', 'Paul', 'Ilse', 'Jupp', 'Trude'];
const CPU_ORDER = [2, 0, 4, 3]; // freie Boxen in dieser Reihenfolge besetzen
const N = 5;
const set = (arr, i, v) => arr.map((x, k) => (k === i ? v : x));
const bump = (s, events, extra) => ({ ...s, ...extra, seq: s.seq + 1, events });

// --- Kartenwerte ---
export const valueOf = (card) => (rankOf(card) === 'A' ? 11 : 'TJQK'.includes(rankOf(card)) ? 10 : Number(rankOf(card)));
// → { total, soft } – soft = ein Ass zählt noch als 11
export function total(cards) {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    if (rankOf(c) === 'A') aces++;
    sum += valueOf(c);
  }
  while (sum > 21 && aces) {
    sum -= 10;
    aces--;
  }
  return { total: sum, soft: aces > 0 };
}
export const isBlackjack = (hand) => hand.cards.length === 2 && !hand.split && total(hand.cards).total === 21;
// Summe, die zählt: ohne Hilfen die Ansage, sonst die Karten
export const scoreOf = (hand) => hand.claim ?? total(hand.cards).total;
export const shoeCount = (s) => (typeof s.shoe === 'number' ? s.shoe : s.shoe.length);
export const inRound = (s) => s.phase === 'insurance' || s.phase === 'play';

// Neuer Schlitten: 6 Spiele gemischt, die Schnittkarte liegt 60–89 Karten vor dem Ende
function newShoe(rng) {
  const shoe = shuffle(Array.from({ length: DECKS }, () => makeDeck('2')).flat(), rng);
  return { shoe, cut: 60 + Math.floor(rng() * 30), used: 0 };
}

function newCpu(players, rng) {
  const used = new Set(players.map((p) => p?.name));
  const names = CPU_NAMES.filter((n) => !used.has(n));
  return { human: false, name: names[Math.floor(rng() * names.length)] ?? 'Computer' };
}

// --- Neue Runde am Tisch: erst wählt der Host, wie viele Computer mitspielen (setup) ---
// humans = Boxen der Menschen (Host 1, Gast 3), chips = ihre Konten { box: chips }
export function newGame({ humans = [HOST], chips = {}, free = false, seq = 0, id = null } = {}, rng = Math.random) {
  const players = new Array(N).fill(null);
  for (const p of humans) players[p] = { human: true };
  return {
    seq,
    events: [{ type: 'start' }],
    id: id ?? Math.floor(rng() * 2 ** 32).toString(36),
    round: 0,
    free,
    waived: false, // allein ohne Hilfen: Runde von den Computern geprüft
    humans: [...humans],
    players,
    stacks: BOXES.map((p) => (humans.includes(p) ? Math.max(0, Math.floor(chips[p] ?? 0)) : 0)),
    phase: 'setup', // setup → bet → (insurance) → play → done → bet …
    shoe: [],
    cut: 0,
    used: 0, // Karten im Ablagefach seit dem letzten Mischen
    bets: new Array(N).fill(null), // Einsätze vor dem Austeilen (null = noch nicht gesetzt)
    boxes: new Array(N).fill(null), // { hands: [Hand], insurance: null | Betrag (0 = nein), forfeit }
    dealer: [],
    turn: null, // { box, hand }
    peek: new Array(N).fill(null), // ohne Hilfen: heimlich angesehene nächste Karte
    cheats: [], // { player, kind, why, seq }
    payout: new Array(N).fill(0), // was die letzte Runde je Box zurückgab (Einsatz + Gewinn)
    staked: new Array(N).fill(0), // was in der letzten Runde je Box gesetzt war
  };
}

// Host wählt die Zahl der Computer (0 … freie Boxen) – danach wird gesetzt
export function setup(s, seat, cpus, rng = Math.random) {
  const free = CPU_ORDER.filter((p) => !s.humans.includes(p));
  if (s.phase !== 'setup' || seat !== s.humans[0] || !Number.isInteger(cpus) || cpus < 0 || cpus > free.length) return null;
  let players = s.players;
  let stacks = s.stacks;
  for (const p of free.slice(0, cpus)) {
    players = set(players, p, newCpu(players, rng));
    stacks = set(stacks, p, BUY_IN);
  }
  return startBetting({ ...s, players, stacks, ...newShoe(rng) }, [{ type: 'setup', cpus }], rng);
}

// Was ein Computer setzt: 10–50, nie mehr als er hat
const cpuBet = (stack, rng) => Math.min(stack, MIN * (1 + Math.floor(rng() * 5)));
export const validBet = (amount, stack) => Number.isInteger(amount) && amount > 0 && amount <= stack
  && (stack < MIN ? amount === stack : amount >= MIN && amount <= MAX && amount % MIN === 0);

// Setzrunde: pleite Computer ersetzen, die Computer setzen gleich, die Menschen wählen ihren Einsatz
function startBetting(s, events, rng) {
  let players = s.players;
  let stacks = s.stacks;
  for (const p of BOXES) {
    if (!players[p] || players[p].human || stacks[p] > 0) continue;
    const cpu = newCpu(players, rng);
    players = set(players, p, cpu);
    stacks = set(stacks, p, BUY_IN);
    events.push({ type: 'newcpu', player: p, name: cpu.name });
  }
  const bets = new Array(N).fill(null);
  for (const p of BOXES) {
    if (!players[p] || players[p].human) continue;
    bets[p] = cpuBet(stacks[p], rng);
    stacks = set(stacks, p, stacks[p] - bets[p]);
    events.push({ type: 'bet', player: p, amount: bets[p] });
  }
  return bump(s, events, {
    players, stacks, bets, phase: 'bet', boxes: new Array(N).fill(null), dealer: [], turn: null,
    peek: new Array(N).fill(null), cheats: [], waived: false,
  });
}

// --- Einsatz eines Menschen. Haben alle Menschen mit Geld gesetzt, wird ausgeteilt ---
export function bet(s, seat, amount, rng = Math.random) {
  if (s.phase !== 'bet' || !s.humans.includes(seat) || s.bets[seat] !== null || !validBet(amount, s.stacks[seat])) return null;
  const next = { ...s, stacks: set(s.stacks, seat, s.stacks[seat] - amount), bets: set(s.bets, seat, amount) };
  const events = [{ type: 'bet', player: seat, amount }];
  return ready(next) ? deal(next, events, rng) : bump(next, events, {});
}
const ready = (s) => s.humans.every((p) => s.bets[p] !== null || s.stacks[p] === 0) && s.humans.some((p) => s.bets[p] > 0);

const newHand = (cards, bet, extra = {}) => ({ cards, bet, split: false, aces: false, doubled: false, done: false, claim: null, ...extra });

// Karte aus dem Schlitten (ist er leer, kommt ein neuer – bei 60 Karten Rest passiert das in einer Runde nicht)
function draw(s, rng) {
  const fresh = s.shoe.length ? null : newShoe(rng);
  const shoe = fresh ? fresh.shoe : s.shoe;
  return [shoe[0], { ...s, ...(fresh ?? {}), shoe: shoe.slice(1), used: (fresh ? 0 : s.used) + 1, peek: new Array(N).fill(null) }];
}

// Austeilen: Schnittkarte erreicht → erst neu mischen. Eine Karte je Box, eine für die Bank, die zweite je Box.
function deal(s, events, rng) {
  let next = s;
  if (s.shoe.length <= s.cut) {
    next = { ...next, ...newShoe(rng) };
    events.push({ type: 'shuffle' });
  }
  const order = BOXES.filter((p) => s.bets[p] > 0);
  const hands = Object.fromEntries(order.map((p) => [p, []]));
  let card;
  for (const p of order) {
    [card, next] = draw(next, rng);
    hands[p].push(card);
  }
  [card, next] = draw(next, rng);
  const dealer = [card];
  for (const p of order) {
    [card, next] = draw(next, rng);
    hands[p].push(card);
  }
  const boxes = BOXES.map((p) => (order.includes(p) ? { hands: [newHand(hands[p], s.bets[p])], insurance: null, forfeit: false } : null));
  // Versicherung nur bei Ass der Bank – die Computer versichern nie (Basic Strategy)
  const insure = rankOf(dealer[0]) === 'A';
  if (insure) order.filter((p) => !s.players[p].human).forEach((p) => (boxes[p].insurance = 0));
  next = { ...next, boxes, dealer, bets: new Array(N).fill(null), round: s.round + 1, cheats: [], payout: new Array(N).fill(0), staked: new Array(N).fill(0) };
  events.push({ type: 'deal', round: next.round });
  if (insure && order.some((p) => s.players[p].human)) return bump(next, events, { phase: 'insurance', turn: null });
  return advance({ ...next, phase: 'play' }, events, rng);
}

// --- Versicherung (nur Menschen, gleichzeitig): yes = halber Einsatz auf die Versicherungslinie ---
export const insuranceOf = (s, seat) => Math.floor(s.boxes[seat].hands[0].bet / 2);
export function insure(s, seat, yes, rng = Math.random) {
  if (s.phase !== 'insurance' || !s.boxes[seat] || s.boxes[seat].insurance !== null || !s.humans.includes(seat)) return null;
  const amount = yes ? insuranceOf(s, seat) : 0;
  if (yes && (amount <= 0 || amount > s.stacks[seat])) return null;
  const boxes = set(s.boxes, seat, { ...s.boxes[seat], insurance: amount });
  const next = { ...s, boxes, stacks: set(s.stacks, seat, s.stacks[seat] - amount) };
  const events = [{ type: 'insure', player: seat, amount }];
  if (BOXES.some((p) => boxes[p] && boxes[p].insurance === null)) return bump(next, events, {});
  return advance({ ...next, phase: 'play' }, events, rng);
}

const strictFor = (s, p) => !s.free || !s.players[p].human; // für Computer gilt immer alles
const setHand = (s, p, i, hand) => set(s.boxes, p, { ...s.boxes[p], hands: set(s.boxes[p].hands, i, hand) });
const pair = (hand) => hand.cards.length === 2 && valueOf(hand.cards[0]) === valueOf(hand.cards[1]);

// Nächste Hand, die noch spielt: geteilte Hände bekommen hier ihre zweite Karte; Black Jack, 21 und geteilte Asse sind
// sofort fertig (ohne Hilfen bei den Menschen nur Black Jack). Keine mehr → die Bank spielt.
function advance(s, events, rng) {
  let next = s;
  for (;;) {
    const p = BOXES.find((b) => next.boxes[b]?.hands.some((h) => !h.done));
    if (p === undefined) return dealerPlay(next, events, rng);
    const i = next.boxes[p].hands.findIndex((h) => !h.done);
    let hand = next.boxes[p].hands[i];
    if (hand.cards.length === 1) {
      let card;
      [card, next] = draw(next, rng);
      hand = { ...hand, cards: [...hand.cards, card] };
      events.push({ type: 'card', player: p, hand: i, card, auto: true });
    }
    const strict = strictFor(next, p);
    const t = total(hand.cards).total;
    const aces = hand.aces && !(pair(hand) && next.boxes[p].hands.length < MAX_HANDS && next.stacks[p] >= hand.bet); // nur ein weiteres Ass darf noch geteilt werden
    if (isBlackjack(hand) || (strict && (aces || t >= 21))) {
      if (isBlackjack(hand)) events.push({ type: 'blackjack', player: p, hand: i });
      next = { ...next, boxes: setHand(next, p, i, { ...hand, done: true }) };
      continue;
    }
    return bump(next, events, { boxes: setHand(next, p, i, hand), turn: { box: p, hand: i } });
  }
}

// Was darf seat gerade? (für Oberfläche und Computer) – nach den Regeln; ohne Hilfen geht für Menschen mehr (act)
export function options(s, seat) {
  if (s.phase !== 'play' || s.turn?.box !== seat) return null;
  const box = s.boxes[seat];
  const hand = box.hands[s.turn.hand];
  const t = total(hand.cards).total;
  const first = hand.cards.length === 2 && !hand.doubled;
  const money = s.stacks[seat] >= hand.bet;
  return {
    hit: !hand.doubled && !hand.aces && t < 21,
    stand: true,
    double: first && !hand.aces && money && [9, 10, 11].includes(t),
    split: first && money && pair(hand) && box.hands.length < MAX_HANDS,
    total: t,
  };
}

const cheat = (s, seat, kind, why) => [...s.cheats, { player: seat, kind, why, seq: s.seq + 1 }];

// --- Spielzug auf der Hand, die dran ist: hit · stand · double · split · claim (ohne Hilfen: angesagte Summe) ---
export function act(s, seat, move, arg, rng = Math.random) {
  const o = options(s, seat);
  if (!o) return null;
  const free = !strictFor(s, seat);
  const i = s.turn.hand;
  const hand = s.boxes[seat].hands[i];
  let cheats = s.cheats;
  const events = [];
  if (move === 'hit') {
    if (!o.hit) {
      if (!free) return null;
      if (hand.doubled || hand.aces) cheats = cheat(s, seat, 'more', hand.doubled ? 'nach dem Verdoppeln noch eine Karte genommen' : 'auf ein geteiltes Ass noch eine Karte genommen');
    }
    const [card, next] = draw(s, rng);
    const h = { ...hand, cards: [...hand.cards, card] };
    const t = total(h.cards).total;
    events.push({ type: 'card', player: seat, hand: i, card });
    if (!free && t > 21) events.push({ type: 'bust', player: seat, hand: i, total: t });
    const done = !free && t >= 21;
    const after = { ...next, cheats, boxes: setHand(next, seat, i, { ...h, done }) };
    return done ? advance(after, events, rng) : bump(after, events, {});
  }
  if (move === 'stand' || move === 'claim') {
    let h = { ...hand, done: true };
    const t = o.total;
    if (move === 'claim') {
      if (!s.free || !Number.isInteger(arg) || arg < 4 || arg > 21) return null; // ansagen dürfen auch Computer (allein)
      if (arg !== t) h = { ...h, claim: arg };
      if (arg > t || t > 21) cheats = cheat(s, seat, 'claim', t > 21 ? `${arg} angesagt, aber ${t} gehabt – verkauft` : `${arg} angesagt, aber nur ${t} gehabt`);
      events.push({ type: 'claim', player: seat, hand: i, total: arg });
    } else {
      events.push({ type: 'stand', player: seat, hand: i, total: t });
      if (t > 21) events.push({ type: 'bust', player: seat, hand: i, total: t });
    }
    return advance({ ...s, cheats, boxes: setHand(s, seat, i, h) }, events, rng);
  }
  if (move === 'double') {
    if (hand.cards.length !== 2 || hand.doubled || s.stacks[seat] < hand.bet) return null;
    if (!o.double) {
      if (!free) return null;
      cheats = cheat(s, seat, 'double', hand.aces ? 'ein geteiltes Ass verdoppelt' : `auf ${o.total} verdoppelt – erlaubt nur 9, 10 oder 11`);
    }
    const [card, next] = draw(s, rng);
    const h = { ...hand, cards: [...hand.cards, card], bet: hand.bet * 2, doubled: true, done: !free };
    const t = total(h.cards).total;
    events.push({ type: 'double', player: seat, hand: i, card, bet: h.bet });
    if (!free && t > 21) events.push({ type: 'bust', player: seat, hand: i, total: t });
    const after = { ...next, cheats, stacks: set(s.stacks, seat, s.stacks[seat] - hand.bet), boxes: setHand(next, seat, i, h) };
    return free ? bump(after, events, {}) : advance(after, events, rng);
  }
  if (move === 'split') {
    const box = s.boxes[seat];
    if (hand.cards.length !== 2 || hand.doubled || s.stacks[seat] < hand.bet || box.hands.length >= MAX_HANDS) return null;
    if (!o.split) {
      if (!free) return null;
      cheats = cheat(s, seat, 'split', `${cardName(hand.cards[0])} und ${cardName(hand.cards[1])} geteilt – nicht gleich viel wert`);
    }
    const aces = hand.cards.every((c) => rankOf(c) === 'A');
    const a = newHand([hand.cards[0]], hand.bet, { split: true, aces });
    const b = newHand([hand.cards[1]], hand.bet, { split: true, aces });
    const hands = [...box.hands.slice(0, i), a, b, ...box.hands.slice(i + 1)];
    events.push({ type: 'split', player: seat, hand: i });
    const after = { ...s, cheats, stacks: set(s.stacks, seat, s.stacks[seat] - hand.bet), boxes: set(s.boxes, seat, { ...box, hands }) };
    return advance(after, events, rng); // die erste der beiden bekommt gleich ihre zweite Karte
  }
  return null;
}

// --- Die Bank: zweite Karte, dann bis 16 ziehen, ab 17 stehen. Braucht keiner mehr ihre Karten, zieht sie nicht. ---
function dealerPlay(s, events, rng) {
  const hands = BOXES.flatMap((p) => (s.boxes[p] && !s.boxes[p].forfeit ? s.boxes[p].hands : []));
  const open = hands.filter((h) => !isBlackjack(h) && scoreOf(h) <= 21);
  const up = valueOf(s.dealer[0]);
  const insured = BOXES.some((p) => s.boxes[p]?.insurance > 0);
  let next = s;
  const drawn = [];
  let dealer = s.dealer;
  const take = () => {
    let card;
    [card, next] = draw(next, rng);
    dealer = [...dealer, card];
    drawn.push(card);
  };
  if (open.length || insured || (hands.some(isBlackjack) && up >= 10)) take();
  const bj = dealer.length === 2 && total(dealer).total === 21;
  if (!bj && open.length) while (total(dealer).total < 17) take();
  events.push({ type: 'dealer', cards: drawn, total: total(dealer).total, blackjack: bj });
  return settle({ ...next, dealer }, events);
}

// Ergebnis einer Hand gegen die Bank → { result, back } (back = was zurückkommt, Einsatz eingeschlossen)
export function judge(hand, dealer, forfeit = false) {
  const d = total(dealer).total;
  const dbj = dealer.length === 2 && d === 21;
  const t = scoreOf(hand);
  if (forfeit) return { result: 'lose', back: 0 };
  if (t > 21) return { result: 'bust', back: 0 };
  if (isBlackjack(hand)) return dbj ? { result: 'push', back: hand.bet } : { result: 'blackjack', back: hand.bet + Math.floor(hand.bet * 1.5) };
  if (dbj) return { result: 'lose', back: 0 };
  if (d > 21 || t > d) return { result: 'win', back: hand.bet * 2 };
  if (t === d) return { result: 'push', back: hand.bet };
  return { result: 'lose', back: 0 };
}

const stakeOf = (box) => (box ? box.hands.reduce((a, h) => a + h.bet, 0) + (box.insurance ?? 0) : 0);

function settle(s, events) {
  const dbj = s.dealer.length === 2 && total(s.dealer).total === 21;
  const payout = new Array(N).fill(0);
  const staked = BOXES.map((p) => stakeOf(s.boxes[p]));
  const boxes = s.boxes.map((box, p) => {
    if (!box) return null;
    const hands = box.hands.map((h) => {
      const { result, back } = judge(h, s.dealer, box.forfeit);
      payout[p] += back;
      return { ...h, done: true, result, back };
    });
    const ins = box.insurance > 0 && dbj && !box.forfeit ? box.insurance * 3 : 0;
    payout[p] += ins;
    return { ...box, hands, insuranceBack: ins };
  });
  events.push({ type: 'settle', payout, staked });
  return bump(s, events, { boxes, payout, staked, stacks: s.stacks.map((x, p) => x + payout[p]), phase: 'done', turn: null });
}

// Nächste Runde (Host, wenn die Runde vorbei ist)
export function newRound(s, rng = Math.random) {
  if (s.phase !== 'done') return null;
  return startBetting(s, [{ type: 'next' }], rng);
}

// Allein nach der Runde: Die Computer haben sie geprüft und lassen sie gelten
export const waive = (s) => (s.free && s.phase === 'done' && !s.waived ? { ...s, waived: true } : null);

// Ein Mensch will die nächste Runde (ohne Hilfen): Wer geschummelt hat, startet sie nicht selbst, solange man ihn noch
// erwischen kann – allein, bis die Computer geprüft haben (waive), zu zweit startet der andere (und verzichtet damit).
// Haben beide geschummelt, darf jeder.
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'done' || !s.humans.includes(seat)) return null;
  const cheated = (p) => s.cheats.some((c) => c.player === p);
  const watched = s.humans.length === 1 ? !s.waived : s.humans.some((p) => p !== seat && !cheated(p));
  if (s.free && cheated(seat) && watched) return null;
  return newRound(s, rng);
}

// --- Ohne Hilfen: heimlich die nächste Karte im Schlitten ansehen (solange die Runde läuft und man eine Box hat) ---
export function peek(s, seat) {
  if (!s.free || !inRound(s) || !s.boxes[seat] || s.boxes[seat].forfeit || s.peek[seat]) return null;
  const card = s.shoe[0];
  const c = { player: seat, kind: 'peek', why: 'heimlich die nächste Karte im Schlitten angesehen', seq: s.seq + 1 };
  return bump(s, [{ type: 'peek', player: seat }], { peek: set(s.peek, seat, card), cheats: [...s.cheats, c] });
}

// --- Ohne Hilfen: Einsatz nach dem Austeilen erhöhen (auf die erste Hand, die noch spielt, sonst die erste) ---
export function raise(s, seat, amount) {
  if (!s.free || !inRound(s) || !s.boxes[seat] || s.boxes[seat].forfeit || !s.humans.includes(seat) || !validBet(amount, s.stacks[seat])) return null;
  const box = s.boxes[seat];
  const i = Math.max(0, box.hands.findIndex((h) => !h.done));
  const boxes = setHand(s, seat, i, { ...box.hands[i], bet: box.hands[i].bet + amount });
  const c = { player: seat, kind: 'raise', why: `den Einsatz nach dem Austeilen um ${amount} erhöht`, seq: s.seq + 1 };
  return bump(s, [{ type: 'raise', player: seat, hand: i, amount }], { boxes, stacks: set(s.stacks, seat, s.stacks[seat] - amount), cheats: [...s.cheats, c] });
}

// --- Ohne Hilfen: „Geschummelt!“ – ab der ersten Runde, bis die nächste beginnt. by/target = Box (by auch BANK) ---
export function accuse(s, by, target, rng = Math.random) {
  if (!s.free || by === target || !(by === BANK || s.players[by]) || !s.players[target] || s.round === 0) return null;
  if (s.phase !== 'done' && !inRound(s)) return null;
  const found = s.cheats.filter((c) => c.player === target);
  if (!found.length || !s.boxes[target]) {
    const paid = by === BANK ? PENALTY : Math.min(PENALTY, s.stacks[by]);
    const stacks = s.stacks.map((x, p) => (p === by ? x - paid : p === target ? x + paid : x));
    return bump(s, [{ type: 'fehlalarm', player: by, target, paid }], { stacks });
  }
  const kinds = [...new Set(found.map((c) => c.kind))];
  const why = [...new Set(found.map((c) => c.why))].slice(0, 2).join(' und ');
  const cheats = s.cheats.filter((c) => c.player !== target);
  if (s.phase === 'done') {
    // schon abgerechnet: seinen Gewinn zurückbuchen – hat er ihn nicht mehr ganz, bleibt sein Stapel bei 0
    const back = s.payout[target];
    const box = s.boxes[target];
    const hands = box.hands.map((h) => ({ ...h, result: 'lose', back: 0 }));
    return bump(s, [{ type: 'caught', player: target, by, kinds, why, resettled: true, back }], {
      cheats,
      stacks: set(s.stacks, target, Math.max(0, s.stacks[target] - back)),
      payout: set(s.payout, target, 0),
      boxes: set(s.boxes, target, { ...box, hands, insuranceBack: 0 }),
    });
  }
  // Runde läuft: alle seine Hände sind verloren, sie spielen nicht weiter
  const box = s.boxes[target];
  const boxes = set(s.boxes, target, { ...box, forfeit: true, insurance: box.insurance ?? 0, hands: box.hands.map((h) => ({ ...h, done: true })) });
  const event = { type: 'caught', player: target, by, kinds, why };
  const after = { ...s, cheats, boxes };
  if (s.phase === 'insurance') {
    if (BOXES.some((p) => boxes[p] && boxes[p].insurance === null)) return bump(after, [event], {});
    return advance({ ...after, phase: 'play' }, [event], rng);
  }
  if (s.turn?.box === target) return advance(after, [event], rng);
  return bump(after, [event], {});
}

// --- Spielgeld: Wer nichts mehr hat (auch nichts gesetzt), leiht sich bei der Bank ---
export function borrow(s, seat, amount) {
  if (!s.humans.includes(seat) || account(s, seat) > 0 || !(amount > 0)) return null;
  return bump(s, [{ type: 'borrow', player: seat, amount }], { stacks: set(s.stacks, seat, s.stacks[seat] + amount) });
}

// Konto eines Menschen nach diesem Stand: Chips vor ihm plus, was in der laufenden Runde steht (eine unterbrochene
// Runde kostet nichts – nur wer erwischt wurde, hat seine Einsätze sofort verloren)
export function account(s, seat) {
  if (s.phase === 'bet') return s.stacks[seat] + (s.bets[seat] ?? 0);
  if (inRound(s)) return s.stacks[seat] + (s.boxes[seat]?.forfeit ? 0 : stakeOf(s.boxes[seat]));
  return s.stacks[seat];
}

// Kontostand hat sich außerhalb dieser Runde geändert (z. B. Fortsetzen nach einem anderen Spiel): Chips angleichen.
// Reicht der Stapel nicht, kommt der Rest aus dem Einsatz (das Geld gab es ja nicht). Steht dann kein Mensch mehr aus,
// wird gleich ausgeteilt.
export function setAccount(s, seat, chips, rng = Math.random) {
  const diff = Math.floor(chips) - account(s, seat);
  if (!diff) return s;
  let short = Math.max(0, -(s.stacks[seat] + diff));
  let next = { ...s, stacks: set(s.stacks, seat, Math.max(0, s.stacks[seat] + diff)) };
  if (short && s.phase === 'bet' && s.bets[seat]) {
    const left = Math.max(0, s.bets[seat] - short);
    next = { ...next, bets: set(s.bets, seat, left || null) };
  } else if (short && inRound(s) && s.boxes[seat] && !s.boxes[seat].forfeit) {
    const hands = s.boxes[seat].hands.map((h) => {
      const cut = Math.min(short, h.bet);
      short -= cut;
      return { ...h, bet: h.bet - cut };
    });
    const ins = s.boxes[seat].insurance;
    const insurance = ins > 0 ? ins - Math.min(short, ins) : ins;
    next = { ...next, boxes: set(s.boxes, seat, { ...s.boxes[seat], hands, insurance }) };
  }
  if (s.phase === 'bet' && ready(next)) return deal(next, [], rng);
  return next;
}

// --- Sicht eines Spielers: Schlitten nur als Anzahl, gelinste Karte nur für sich, Schummeleien nur beim Host ---
export function viewFor(s, seat) {
  return {
    ...s,
    shoe: shoeCount(s),
    peek: s.peek.map((c, p) => (p === seat ? c : null)),
    cheats: [],
    events: s.events.filter((e) => e.type !== 'peek' || e.player === seat),
  };
}
