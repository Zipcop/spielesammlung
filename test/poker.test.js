// Texas Hold'em (src/poker/hand.js, game.js): Handbewertung, Blinds und Reihenfolge, Setzregeln (Mindesterhöhung,
// kleines All-in), Side Pots, Split Pot, Sicht je Spieler, Spielgeld und „Ohne Hilfen“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, handName } from '../src/poker/hand.js';
import {
  newGame, nextHand, act, options, claim, peek, accuse, waive, deal, borrow, account, setAccount, viewFor, buildPots, live, pot,
  SMALL, BIG, BUY_IN, PENALTY,
} from '../src/poker/game.js';
import { loadMoney, setChips, borrowMoney, START, LOAN } from '../src/spielgeld.js';

function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const hand = (str) => str.split(' ');
const ev = (str) => evaluate(hand(str));
const better = (a, b) => assert.ok(ev(a).score > ev(b).score, `${a} sollte ${b} schlagen`);
const tie = (a, b) => assert.equal(ev(a).score, ev(b).score, `${a} = ${b}`);

// Tisch mit festen Stacks; gesetzt = Sitze, die Chips haben (andere Computer mit 0 werden ersetzt – deshalb hier
// Menschen auf allen Sitzen, die leer bleiben sollen)
function table({ stacks, button, humans = [0], free = false }) {
  let s = newGame({ humans, free, chips: Object.fromEntries(humans.map((p) => [p, stacks[p]])) }, rngOf(1));
  const seated = [0, 1, 2, 3, 4, 5].filter((p) => stacks[p] === 0 || humans.includes(p));
  const players = s.players.map((x, p) => (seated.includes(p) ? { human: true } : x));
  return nextHand({ ...s, players, stacks: [...stacks], button: (button + 5) % 6, humans: seated }, rngOf(2));
}
// Karten festlegen: holes { sitz: 'hA hK' }, board = 5 Karten (Brennkarten werden davor gelegt)
function rig(s, holes, board) {
  const h = [...s.holes];
  for (const [p, str] of Object.entries(holes)) h[p] = hand(str);
  const b = hand(board);
  return { ...s, holes: h, deck: ['x1', b[0], b[1], b[2], 'x2', b[3], 'x3', b[4]] };
}
const go = (s, ...steps) => steps.reduce((x, [seat, move, to]) => {
  const next = act(x, seat, move, to);
  assert.ok(next, `Zug ungültig: ${seat} ${move} ${to ?? ''} (dran: ${x.turn}, Phase ${x.phase})`);
  return next;
}, s);
const total = (s) => s.stacks.reduce((a, b) => a + b, 0) + (s.phase === 'done' ? 0 : pot(s));

// --- Handbewertung ---
test('Rangfolge der Kategorien', () => {
  const list = [
    'h2 d5 c7 s9 hJ cK d3', // Höchste Karte
    'h2 d2 c7 s9 hJ cK d3', // Paar
    'h2 d2 c7 s7 hJ cK d3', // Zwei Paare
    'h2 d2 c2 s9 hJ cK d3', // Drilling
    'h2 d3 c4 s5 h6 cK dJ', // Straße
    'h2 h5 h7 h9 hJ cK d3', // Flush
    'h2 d2 c2 s9 h9 cK d3', // Full House
    'h2 d2 c2 s2 hJ cK d3', // Vierling
    'h5 h6 h7 h8 h9 cK d3', // Straight Flush
  ];
  list.forEach((h, cat) => assert.equal(ev(h).cat, cat, h));
  for (let i = 1; i < list.length; i++) better(list[i], list[i - 1]);
});

test('Kicker, Wheel, beste 5 aus 7', () => {
  better('hA dA c9 s7 h4 c3 d2', 'hA dA c8 s7 h4 c3 d2'); // Kicker 9 schlägt 8
  tie('hA dA c9 s7 h5 c3 d2', 'sA cA d9 h7 s5 d3 c2'); // Farbe zählt nicht
  tie('hA dA cK sQ hJ c3 d2', 'sA cA dK hQ sJ d4 c3'); // nur die besten 5 zählen (4 und 3 spielen nicht)
  assert.equal(ev('hA d2 c3 s4 h5 cK d9').cat, 4); // Wheel
  better('h2 d3 c4 s5 h6 cK d9', 'hA d2 c3 s4 h5 cK d9'); // 6-hoch schlägt Wheel
  better('hT dJ cQ sK hA c2 d2', 'h9 dT cJ sQ hK c2 d2'); // höchste Straße
  assert.equal(ev('hT dJ cQ sK hA c2 d3').ranks[0], 14);
  // drei Paare: die besten zwei + bester Kicker
  assert.deepEqual(ev('hK dK c9 s9 h4 c4 dQ').ranks, [13, 9, 12]);
  // zwei Drillinge = Full House mit dem höheren
  assert.deepEqual(ev('hK dK cK s9 h9 c9 d2').ranks, [13, 9]);
  better('hK dK cK s2 h2 c9 d3', 'hQ dQ cQ sA hA c9 d3');
  // Flush und Straße zugleich – Flush gewinnt; Straight Flush nur in einer Farbe
  assert.equal(ev('h4 h5 h6 h7 d8 h2 c3').cat, 5);
  assert.equal(ev('h4 h5 h6 h7 h8 d9 cT').cat, 8);
  assert.equal(ev('hA h2 h3 h4 h5 d9 cT').ranks[0], 5); // Straight Flush bis 5
  better('hA hJ h9 h7 h2 c3 d4', 'hK hQ hJ h9 h7 c3 d4');
  better('hA dA cA sA h2 c3 d4', 'hK dK cK sK hA c3 d4');
  assert.equal(handName(ev('hT hJ hQ hK hA c2 d3')), 'Royal Flush');
  assert.equal(handName(ev('hK dK c9 s9 h4 c4 dQ')), 'Zwei Paare, Könige und Neuner');
  assert.equal(handName(ev('h8 d9 cT sJ hQ c2 d2')), 'Straße bis zur Dame');
});

// --- Blinds und Reihenfolge ---
test('6 Plätze: Blinds links vom Knopf, preflop beginnt links vom Big Blind, danach links vom Knopf', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  assert.equal(s.button, 0);
  assert.equal(s.bet[1], SMALL);
  assert.equal(s.bet[2], BIG);
  assert.equal(s.turn, 3);
  assert.equal(s.phase, 'preflop');
  assert.ok(s.holes.every((h) => h.length === 2));
  assert.equal(new Set(s.holes.flat()).size, 12);
  assert.equal(s.deck.length, 52 - 12);
  // alle gehen mit, der Big Blind darf noch (Option) – er schiebt
  let t = go(s, [3, 'call'], [4, 'call'], [5, 'call'], [0, 'call'], [1, 'call']);
  assert.equal(t.turn, 2);
  assert.ok(options(t, 2).check);
  t = go(t, [2, 'check']);
  assert.equal(t.phase, 'flop');
  assert.equal(t.board.length, 3);
  assert.equal(t.turn, 1);
  assert.equal(pot(t), 60);
});

test('Zu zweit: Knopf ist Small Blind und handelt preflop zuerst, nach dem Flop zuletzt', () => {
  const s = table({ stacks: [1000, 0, 0, 1000, 0, 0], button: 0, humans: [0, 3] });
  assert.equal(s.button, 0);
  assert.equal(s.bet[0], SMALL);
  assert.equal(s.bet[3], BIG);
  assert.equal(s.turn, 0);
  const t = go(s, [0, 'call'], [3, 'check']);
  assert.equal(t.phase, 'flop');
  assert.equal(t.turn, 3);
  // nächste Hand: Knopf wandert
  const u = go(t, [3, 'check'], [0, 'raise', 50], [3, 'fold']);
  assert.equal(u.phase, 'done');
  assert.equal(u.stacks[0], 1010);
  const v = nextHand(u, rngOf(3));
  assert.equal(v.button, 3);
  assert.equal(v.turn, 3);
});

test('Erhöhen: mindestens um die letzte Erhöhung; danach dürfen alle wieder', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  assert.equal(act(s, 3, 'raise', 15), null); // unter 20
  assert.deepEqual(options(s, 3).raise, { min: 20, max: 1000 });
  let t = go(s, [3, 'raise', 30]); // +20
  assert.equal(options(t, 4).raise.min, 50);
  assert.equal(act(t, 4, 'raise', 45), null);
  t = go(t, [4, 'raise', 80]); // +50
  assert.equal(options(t, 5).raise.min, 130);
  assert.equal(act(t, 4, 'call'), null, 'nicht dran');
  assert.equal(act(t, 5, 'check'), null, 'schieben geht nicht bei offenem Einsatz');
});

test('Kleines All-in öffnet die Setzrunde nicht neu', () => {
  // Sitz 5 hat nur 45: 0 setzt 30 (+20), 5 geht all-in auf 45 (+15 < 20) – 0 darf nur mitgehen oder passen
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 45], button: 2 }); // SB 3, BB 4, dran 5
  let t = go(s, [5, 'call'], [0, 'raise', 30], [1, 'fold'], [2, 'fold'], [3, 'fold'], [4, 'call']);
  assert.equal(t.turn, 5);
  t = go(t, [5, 'raise', 45]);
  assert.equal(t.status[5], 'allin');
  assert.equal(t.turn, 0);
  assert.equal(options(t, 0).raise, null);
  assert.equal(act(t, 0, 'raise', 100), null);
  t = go(t, [0, 'call']);
  assert.equal(t.turn, 4);
  assert.equal(options(t, 4).raise, null, 'Sitz 4 hat nach der vollen Erhöhung schon gehandelt');
  t = go(t, [4, 'call']);
  assert.equal(t.phase, 'flop');
});

test('Alle passen: der Letzte gewinnt ohne Showdown, Karten bleiben verdeckt', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  const t = go(s, [3, 'raise', 100], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']);
  assert.equal(t.phase, 'done');
  assert.equal(t.stacks[3], 1015);
  assert.equal(t.stacks[1], 995);
  assert.equal(t.stacks[2], 990);
  assert.deepEqual(t.shown, []);
  assert.equal(viewFor(t, 0).holes[3][0], null);
  assert.equal(total(t), 6000);
});

test('Showdown mit Abrechnung', () => {
  let s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  s = rig(s, { 3: 'hA dA', 0: 'hK dK' }, 'c2 s7 h9 dJ c4');
  let t = go(s, [3, 'raise', 30], [4, 'fold'], [5, 'fold'], [0, 'call'], [1, 'fold'], [2, 'fold']);
  assert.equal(t.phase, 'flop');
  assert.deepEqual(t.board, ['c2', 's7', 'h9']);
  t = go(t, [3, 'check'], [0, 'check']); // Turn
  assert.deepEqual(t.board, ['c2', 's7', 'h9', 'dJ']);
  t = go(t, [3, 'check'], [0, 'check'], [3, 'raise', 100], [0, 'call']);
  assert.equal(t.phase, 'done');
  assert.equal(t.stacks[3], 1000 + 130 + 15);
  assert.equal(t.stacks[0], 870);
  assert.deepEqual(t.shown.sort(), [0, 3]);
  assert.deepEqual(viewFor(t, 2).holes[0], ['hK', 'dK']);
  assert.equal(t.events.at(-1).hands[3], 'Paar Asse');
});

// --- Side Pots ---
test('Side Pots: drei All-ins mit verschiedenen Stacks', () => {
  // 1 hat 100, 4 hat 300, 5 hat 1000; Board gibt 1 die beste, 4 die zweitbeste Hand
  let s = table({ stacks: [0, 100, 0, 0, 300, 1000], button: 4, humans: [1] }); // Knopf 4, SB 5, BB 1
  assert.equal(s.button, 4);
  s = rig(s, { 1: 'hA dA', 4: 'hK dK', 5: 'hQ dQ' }, 'c2 s7 h9 dJ c4');
  let t = go(s, [4, 'raise', 300], [5, 'call'], [1, 'call']);
  assert.equal(t.phase, 'done');
  assert.deepEqual(t.pots.map((p) => p.amount), [300, 400]);
  assert.deepEqual(t.pots.map((p) => p.winners), [[1], [4]]);
  assert.equal(t.stacks[1], 300);
  assert.equal(t.stacks[4], 400);
  assert.equal(t.stacks[5], 700);
  assert.equal(total(t), 1400);
  // jetzt gewinnt der Große: alles an ihn bis auf nichts
  s = rig(s, { 1: 'h3 d8', 4: 'h5 d6', 5: 'hQ dQ' }, 'c2 s7 hT dJ cK');
  t = go(s, [4, 'raise', 300], [5, 'call'], [1, 'call']);
  assert.equal(t.stacks[5], 1400);
});

test('Side Pot: Nicht gedecktes Geld geht zurück, gefoldetes Geld bleibt im Pot', () => {
  assert.deepEqual(buildPots([50, 200, 200, 0, 0, 30], [0, 1]), [
    { amount: 50 + 50 + 50 + 30, eligible: [0, 1] }, { amount: 150 + 150, eligible: [1] },
  ]);
  // Sitz 1 setzt 500, Sitz 4 ist all-in für 200 → 300 gehen an Sitz 1 zurück
  let s = table({ stacks: [0, 1000, 0, 0, 200, 0], button: 4, humans: [1] });
  s = rig(s, { 1: 'h3 d8', 4: 'hA dA' }, 'c2 s7 hT dJ cK');
  const t = go(s, [4, 'call'], [1, 'raise', 500], [4, 'call']);
  assert.equal(t.phase, 'done');
  assert.equal(t.stacks[4], 400);
  assert.equal(t.stacks[1], 800);
});

test('Split Pot: geteilt, unteilbarer Rest an den Ersten links vom Knopf', () => {
  assert.deepEqual(buildPots([5, 5, 5, 0, 0, 0], [0, 1, 2]), [{ amount: 15, eligible: [0, 1, 2] }]);
  let s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  s = rig(s, { 1: 'h3 d4', 2: 'c3 s4', 3: 'h2 c2' }, 'hA sK dQ cJ hT'); // Board-Straße: alle gleich
  let t = go(s, [3, 'raise', 20], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'call'], [2, 'call']);
  while (t.phase !== 'done') t = go(t, [t.turn, 'check']);
  assert.equal(t.phase, 'done');
  assert.equal(t.pots[0].amount, 60);
  assert.deepEqual(t.pots[0].winners, [1, 2, 3]);
  assert.deepEqual(t.payout.slice(1, 4), [20, 20, 20]);
});

test('Split Pot mit ungeradem Betrag', () => {
  // zwei gleiche Hände, Pot 25 (Sitz 0 hat 5 vom Small Blind dazu gegeben und gefoldet) – an 0 vorbei: Rest an Sitz 2
  let s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 5 }); // SB 0, BB 1, dran 2
  s = rig(s, { 1: 'h2 d3', 2: 'c2 s3' }, 'hA sK dQ cJ hT');
  let t = go(s, [2, 'call'], [3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'check']);
  for (let i = 0; i < 6; i++) t = go(t, [t.turn, 'check']);
  assert.equal(t.pots[0].amount, 25);
  assert.equal(t.payout[1], 13);
  assert.equal(t.payout[2], 12);
});

test('Alle all-in: Karten sofort auf, Board läuft durch', () => {
  let s = table({ stacks: [500, 0, 0, 300, 0, 0], button: 0, humans: [0, 3] });
  s = rig(s, { 0: 'hA dA', 3: 'hK dK' }, 'c2 s7 h9 dJ cK');
  const t = go(s, [0, 'raise', 500], [3, 'call']);
  assert.equal(t.phase, 'done');
  assert.ok(t.events.some((e) => e.type === 'reveal'));
  assert.equal(t.board.length, 5);
  assert.equal(t.stacks[3], 600);
  assert.equal(t.stacks[0], 200);
});

test('Blind größer als der Stack: all-in für weniger', () => {
  const s = table({ stacks: [1000, 3, 1000, 1000, 1000, 1000], button: 0 });
  assert.equal(s.bet[1], 3);
  assert.equal(s.status[1], 'allin');
  assert.equal(s.current, BIG);
});

// --- Sicht je Spieler ---
test('viewFor: nur eigene Karten, Stapel als Anzahl, keine Schummeleien', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  const v = viewFor(s, 3);
  assert.deepEqual(v.holes[3], s.holes[3]);
  assert.deepEqual(v.holes[0], [null, null]);
  assert.equal(typeof v.deck, 'number');
  const p = peek(s, 3);
  assert.equal(viewFor(p, 3).peek[3], s.deck[1]);
  assert.equal(viewFor(p, 0).peek[3], null);
  assert.deepEqual(viewFor(p, 0).cheats, []);
  assert.ok(!viewFor(p, 0).events.some((e) => e.type === 'peek'));
});

// --- Spielgeld ---
test('Spielgeld: Computer mit 1.000, Menschen mit ganzem Konto; Pleite-Computer werden ersetzt; Leihen bei 0', () => {
  let s = newGame({ humans: [0, 3], chips: { 0: 5000, 3: 0 } }, rngOf(5));
  assert.equal(s.stacks[0], 5000);
  assert.equal(s.stacks[1], BUY_IN);
  s = nextHand(s, rngOf(6));
  assert.equal(s.status[3], 'out');
  assert.equal(s.holes[3], null);
  assert.equal(account(s, 0), 5000);
  const b = borrow(s, 3, 1000);
  assert.ok(b);
  assert.equal(b.stacks[3], 1000);
  assert.equal(borrow(b, 3, 1000), null, 'nur bei 0');
  assert.equal(borrow(s, 1, 1000), null, 'Computer leihen nicht');
  // Computer pleite → neuer
  const done = { ...s, phase: 'done', stacks: s.stacks.map((x, p) => (p === 2 ? 0 : x)) };
  const n = nextHand(done, rngOf(7));
  assert.equal(n.stacks[2] + n.invested[2], BUY_IN);
  assert.ok(n.events.some((e) => e.type === 'newcpu' && e.player === 2));
  // Menschen alle pleite → keine Hand
  assert.equal(nextHand({ ...done, stacks: done.stacks.map((x, p) => (p === 0 || p === 3 ? 0 : x)) }, rngOf(7)), null);
});

test('Spielgeld: Konto zählt Gesetztes der laufenden Hand mit, setAccount gleicht an', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  const t = go(s, [3, 'raise', 100], [4, 'fold'], [5, 'fold'], [0, 'call']);
  assert.equal(t.stacks[0], 900);
  assert.equal(account(t, 0), 1000);
  const u = setAccount(t, 0, 1500);
  assert.equal(u.stacks[0], 1400);
  assert.equal(account(u, 0), 1500);
});

test('Spielgeld-Konto (spielgeld.js): Start, Speichern, Leihen nur bei 0 mit Statistik', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadMoney(storage).chips, START);
  assert.equal(borrowMoney(storage), null);
  setChips(0, 'abc', storage);
  assert.equal(loadMoney(storage).link, 'abc');
  const m = borrowMoney(storage);
  assert.deepEqual(m, { chips: LOAN, borrowed: LOAN, loans: 1, link: null });
  setChips(0, null, storage);
  borrowMoney(storage);
  assert.deepEqual(loadMoney(storage), { chips: LOAN, borrowed: 2 * LOAN, loans: 2, link: null });
  storage.setItem('spielesammlung-spielgeld', '{kaputt');
  assert.equal(loadMoney(storage).chips, START);
});

// --- Ohne Hilfen ---
test('Normal: nichts Regelwidriges geht durch', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  assert.equal(act(s, 3, 'check'), null);
  assert.equal(act(s, 3, 'raise', 5), null);
  assert.equal(act(s, 3, 'raise', 15), null);
  assert.equal(peek(s, 3), null);
  assert.equal(accuse(s, 0, 3), null);
});

test('Ohne Hilfen: zu wenig bezahlen, schieben trotz Einsatz, zu wenig erhöhen – vermerkt mit Grund', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  let t = go(s, [3, 'raise', 5]); // nur 5 statt 10
  assert.equal(t.cheats[0].kind, 'short');
  assert.equal(t.cheats[0].why, 'nur 5 statt 10 bezahlt');
  t = go(t, [4, 'check']);
  assert.equal(t.cheats[1].why, 'geschoben, obwohl 10 zu bezahlen waren');
  t = go(t, [5, 'raise', 15]);
  assert.equal(t.cheats[2].why, 'auf 15 erhöht – mindestens 20 wäre nötig');
  assert.equal(t.turn, 0);
  assert.deepEqual(viewFor(t, 0).cheats, []);
});

test('Ohne Hilfen: erwischt während der Hand – Schummler ist raus, sein Geld bleibt im Pot', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  let t = go(s, [3, 'raise', 5], [4, 'fold'], [5, 'fold']);
  const c = accuse(t, 0, 3);
  assert.equal(c.status[3], 'fold');
  assert.equal(c.invested[3], 5);
  const e = c.events.find((x) => x.type === 'caught');
  assert.equal(e.why, 'nur 5 statt 10 bezahlt');
  assert.equal(c.cheats.length, 0);
  assert.equal(c.turn, 0, 'weiter mit dem, der dran war');
  // Fehlalarm: Rufer zahlt 2 Big Blinds
  const f = accuse(t, 0, 4);
  assert.equal(f.events[0].type, 'fehlalarm');
  assert.equal(f.stacks[0], 1000 - PENALTY);
  assert.equal(f.stacks[4], 1000 + PENALTY);
  // wer dran ist und erwischt wird: der Nächste ist dran
  t = go(s, [3, 'raise', 5], [4, 'fold'], [5, 'fold'], [0, 'call'], [1, 'call'], [2, 'check']);
  assert.equal(t.phase, 'flop');
  assert.equal(t.turn, 1);
  t = go(t, [1, 'check'], [2, 'check']);
  assert.equal(t.turn, 3);
  const g = accuse(t, 0, 3);
  assert.equal(g.turn, 0);
});

test('Ohne Hilfen: falsche Ansage beim Showdown gewinnt – erwischt wird nach echten Karten neu verteilt', () => {
  let s = table({ stacks: [1000, 0, 0, 1000, 0, 0], button: 0, humans: [0, 3], free: true });
  s = rig(s, { 0: 'hA dA', 3: 'h3 d8' }, 'c2 s7 h9 dJ cK');
  let t = go(s, [0, 'call'], [3, 'check']);
  for (let i = 0; i < 6; i++) t = go(t, [t.turn, 'check']);
  assert.equal(t.phase, 'claim');
  assert.deepEqual(viewFor(t, 0).holes[3], ['h3', 'd8'], 'Karten liegen offen');
  t = claim(t, 3, 4); // „Straße“ – gelogen
  assert.equal(t.phase, 'claim');
  t = claim(t, 0, 1); // Paar – ehrlich
  assert.equal(t.phase, 'done');
  assert.equal(t.stacks[3], 1010, 'Lüge hat gewonnen');
  assert.equal(t.cheats[0].why, '„Straße“ angesagt, aber nur Höchste Karte König');
  const c = accuse(t, 0, 3);
  assert.equal(c.stacks[0], 1010);
  assert.equal(c.stacks[3], 990);
  assert.equal(total(c), 2000);
  // Fehlalarm nach der Hand
  const f = accuse(t, 3, 0);
  assert.equal(f.events[0].type, 'fehlalarm');
});

test('Ohne Hilfen: erwischt, nachdem alle anderen gepasst haben – Pot an den Rufer', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  const t = go(s, [3, 'raise', 15], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']);
  assert.equal(t.stacks[3], 1015);
  const c = accuse(t, 0, 3);
  assert.equal(c.stacks[3], 985);
  assert.equal(c.stacks[0], 1030);
  assert.equal(total(c), 6000);
});

test('Ohne Hilfen: linsen zeigt die nächste Karte, wird vermerkt; nächste Hand löscht Schummeleien', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  const p = peek(s, 0);
  assert.equal(p.peek[0], s.deck[1]);
  assert.equal(peek(p, 0), null, 'nur einmal je Straße');
  let t = go(p, [3, 'call'], [4, 'call'], [5, 'call'], [0, 'call'], [1, 'call'], [2, 'check']);
  assert.equal(t.board[0], s.deck[1], 'gelinste Karte kommt wirklich');
  assert.equal(t.peek[0], null);
  // bis zur nächsten Hand anklagbar; wer geschummelt hat, startet sie nicht selbst
  t = go(t, [1, 'raise', 500], [2, 'fold'], [3, 'fold'], [4, 'fold'], [5, 'fold'], [0, 'fold']);
  assert.equal(t.phase, 'done');
  assert.equal(deal({ ...t, humans: [0] }, 0), null);
  const w = waive({ ...t, humans: [0] });
  assert.ok(deal(w, 0));
  const n = nextHand(t, rngOf(9));
  assert.deepEqual(n.cheats, []);
  // zu zweit: der andere startet; haben beide geschummelt, darf jeder
  const two = { ...t, humans: [0, 3] };
  assert.equal(deal(two, 0), null);
  assert.ok(deal(two, 3));
  const both = { ...two, cheats: [...two.cheats, { player: 3, kind: 'check', why: 'x', seq: 1 }] };
  assert.ok(deal(both, 0));
});

test('Zufallspartien: Chips bleiben erhalten, nie negativ, jede Hand endet', () => {
  const rng = rngOf(42);
  let s = newGame({ humans: [0], chips: { 0: 1000 } }, rng);
  let showdowns = 0;
  for (let h = 0; h < 400; h++) {
    const before = s.stacks.reduce((a, b) => a + b, 0);
    const n = nextHand(s, rng);
    if (!n) {
      s = borrow(s, 0, 1000);
      assert.ok(s, 'leihen muss gehen');
      continue;
    }
    s = n;
    const added = s.events.filter((e) => e.type === 'newcpu').length * BUY_IN;
    let guard = 0;
    while (s.phase !== 'done') {
      assert.ok(guard++ < 100, 'Hand endet nicht');
      const seat = s.turn;
      const o = options(s, seat);
      const r = rng();
      let next;
      if (r < 0.15) next = act(s, seat, 'fold');
      else if (r < 0.35 && o.raise) next = act(s, seat, 'raise', o.raise.min + Math.floor(rng() ** 3 * (o.raise.max - o.raise.min + 1)));
      else next = o.check ? act(s, seat, 'check') : act(s, seat, 'call');
      assert.ok(next, `Zug ging nicht: ${JSON.stringify(o)}`);
      s = next;
    }
    if (s.events.at(-1).showdown) showdowns++;
    assert.ok(s.stacks.every((x) => x >= 0));
    assert.equal(s.stacks.reduce((a, b) => a + b, 0), before + added, `Hand ${h}: Chips verloren`);
    assert.equal(s.pots.reduce((a, p) => a + p.amount, 0), pot(s));
  }
  assert.ok(showdowns > 50, `nur ${showdowns} Showdowns`);
});

test('Zufallspartien ohne Hilfen: Schummeln, Linsen, Ansagen und Anklagen verlieren keine Chips', () => {
  const rng = rngOf(7);
  let s = newGame({ humans: [0, 3], chips: { 0: 1000, 3: 1000 }, free: true }, rng);
  let caught = 0;
  for (let h = 0; h < 300; h++) {
    const n = nextHand(s, rng);
    if (!n) {
      s = borrow(s, 0, 1000) ?? borrow(s, 3, 1000) ?? s;
      continue;
    }
    s = n;
    const sum = (x) => x.stacks.reduce((a, b) => a + b, 0) + (x.phase === 'done' ? 0 : pot(x));
    const before = sum(s);
    let guard = 0;
    while (s.phase !== 'done') {
      assert.ok(guard++ < 200, 'Hand endet nicht');
      const r = rng();
      if (r < 0.05) {
        const next = accuse(s, Math.floor(rng() * 6), Math.floor(rng() * 6));
        if (next) {
          if (next.events[0].type === 'caught') caught++;
          s = next;
          continue;
        }
      }
      if (s.phase === 'claim') {
        const p = live(s).find((x) => s.claims[x] === null);
        s = claim(s, p, Math.floor(rng() * 9));
        continue;
      }
      const seat = s.turn;
      if (r < 0.08 && peek(s, seat)) {
        s = peek(s, seat);
        continue;
      }
      const o = options(s, seat);
      const k = rng();
      let next;
      if (k < 0.12) next = act(s, seat, 'fold');
      else if (k < 0.2) next = act(s, seat, 'check');
      else if (k < 0.3) next = act(s, seat, 'raise', s.bet[seat] + 1 + Math.floor(rng() * s.stacks[seat]));
      else if (k < 0.45 && o.raise) next = act(s, seat, 'raise', o.raise.min);
      else next = o.check ? act(s, seat, 'check') : act(s, seat, 'call');
      if (next) s = next;
    }
    if (rng() < 0.3) s = accuse(s, Math.floor(rng() * 6), Math.floor(rng() * 6)) ?? s;
    assert.ok(s.stacks.every((x) => x >= 0));
    assert.equal(sum(s), before, `Hand ${h}: Chips verloren`);
  }
  assert.ok(caught > 10, `nur ${caught} erwischt`);
});

// --- Befunde aus dem Review (20.10.2026) ---
test('Review: Fehlalarm aus dem Gewinn, dann erwischt – kein negativer Stapel, keine Chips aus dem Nichts', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  let t = go(s, [3, 'raise', 15], [4, 'fold'], [5, 'fold'], [0, 'fold'], [1, 'fold'], [2, 'fold']); // 3 schummelt und gewinnt 30
  t = { ...t, stacks: t.stacks.map((x, p) => (p === 3 ? 25 : x + (p === 4 ? 1015 - 25 : 0))) }; // nur noch 25 vor ihm
  const before = total(t);
  t = accuse(t, 3, 4); // Fehlalarm: zahlt 20 aus dem Gewinn
  t = accuse(t, 0, 3); // erwischt: alter Gewinn (30) wird zurückgedreht – er hat nur noch 5
  assert.ok(t.stacks.every((x) => x >= 0), JSON.stringify(t.stacks));
  assert.equal(total(t), before);
});

test('Review: setAccount mitten in der Hand mit kleinerem Konto erzeugt keine Chips', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0 });
  const t = go(s, [3, 'call'], [4, 'call'], [5, 'call'], [0, 'raise', 600]);
  const u = setAccount(t, 0, 100);
  assert.equal(account(u, 0), 100);
  assert.ok(u.stacks[0] >= 0);
});

test('Review: ohne Hilfen ist genau mitgehen per Regler kein Schummeln, mehr als ein All-in-Gegner auch nicht', () => {
  const s = table({ stacks: [1000, 1000, 1000, 1000, 1000, 1000], button: 0, free: true });
  const t = go(s, [3, 'raise', 10]);
  assert.equal(t.cheats.length, 0);
  // Gegner all-in, alle anderen passen – mehr setzen ist sinnlos (kommt zurück), aber kein Schummeln
  let u = table({ stacks: [2000, 0, 0, 1000, 0, 0], button: 0, humans: [0, 3], free: true });
  u = go(u, [0, 'call'], [3, 'raise', 1000]);
  u = go(u, [0, 'raise', 2000]);
  assert.equal(u.cheats.length, 0);
  assert.equal(u.phase, 'claim');
  u = claim(claim(u, 0, evaluate([...u.holes[0], ...u.board]).cat), 3, evaluate([...u.holes[3], ...u.board]).cat);
  assert.equal(u.phase, 'done');
  assert.equal(u.stacks[0] + u.stacks[3], 3000);
  assert.ok(u.stacks[0] >= 1000, 'der nicht gedeckte Teil kommt zurück');
});
