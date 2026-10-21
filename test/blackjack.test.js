// Black Jack (src/blackjack/game.js, ai.js): Kartenwerte, Austeilen ohne verdeckte Bankkarte, Bank steht ab 17,
// Black Jack 3 : 2, Verdoppeln auf 9/10/11, Teilen (auch erneut, Asse nur je eine Karte), Versicherung 2 : 1,
// Schlitten mit Schnittkarte, Sicht je Spieler, Spielgeld, „Ohne Hilfen“ und ganze Partien Computer gegen Computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, bet, insure, act, options, again, newRound, peek, raise, accuse, waive, borrow, account, setAccount, viewFor,
  total, isBlackjack, judge, validBet, shoeCount, HOST, GUEST, BANK, MIN, BUY_IN, PENALTY, DECKS,
} from '../src/blackjack/game.js';
import { basic, decide } from '../src/blackjack/ai.js';
import { OUTCOME } from '../src/results.js';

function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const cards = (str) => str.split(' ');
const FILL = cards('c2 c3 c4 c5 c6 c7 c8 c9 cT cJ cQ cK cA').flatMap((c) => [c, c, c, c, c, c]);

// Tisch in der Setzrunde mit festem Schlitten (Karten in Ausgabe-Reihenfolge, danach Füllkarten)
function table({ humans = [HOST], chips = { [HOST]: 1000, [GUEST]: 1000 }, free = false, cpus = 0, shoe = '' } = {}) {
  const s = setup(newGame({ humans, chips, free }, rngOf(1)), humans[0], cpus, rngOf(2));
  return { ...s, shoe: [...(shoe ? cards(shoe) : []), ...FILL], cut: 0 };
}
const go = (s, ...steps) => steps.reduce((x, [seat, move, arg]) => {
  const next = act(x, seat, move, arg, rngOf(3));
  assert.ok(next, `Zug ungültig: ${seat} ${move} (dran: ${JSON.stringify(x.turn)}, Phase ${x.phase})`);
  return next;
}, s);
const hand = (s, p, i = 0) => s.boxes[p].hands[i];

// --- Kartenwerte ---
test('Werte: Ass 1 oder 11, Bilder 10, Black Jack nur mit den ersten zwei Karten', () => {
  assert.deepEqual(total(cards('hA hK')), { total: 21, soft: true });
  assert.deepEqual(total(cards('hA hA')), { total: 12, soft: true });
  assert.deepEqual(total(cards('hA h6 hK')), { total: 17, soft: false });
  assert.deepEqual(total(cards('hA hA h9')), { total: 21, soft: true });
  assert.deepEqual(total(cards('hQ hJ h5')), { total: 25, soft: false });
  assert.equal(isBlackjack({ cards: cards('sA dT'), split: false }), true);
  assert.equal(isBlackjack({ cards: cards('sA dT'), split: true }), false); // nach dem Teilen nur 21
  assert.equal(isBlackjack({ cards: cards('s7 d7 h7'), split: false }), false);
});

test('Einsatz: 10 bis 500 in Zehnern, wer weniger als 10 hat, setzt den Rest', () => {
  assert.equal(validBet(10, 1000), true);
  assert.equal(validBet(500, 1000), true);
  assert.equal(validBet(510, 1000), false);
  assert.equal(validBet(15, 1000), false);
  assert.equal(validBet(5, 1000), false);
  assert.equal(validBet(40, 30), false);
  assert.equal(validBet(5, 5), true);
  assert.equal(validBet(3, 5), false);
});

// --- Aufbau ---
test('Neues Spiel: Host wählt die Computer, sie setzen gleich; Schlitten mit 6 × 52 Karten', () => {
  const s0 = newGame({ humans: [HOST, GUEST], chips: { [HOST]: 700, [GUEST]: 300 } }, rngOf(1));
  assert.equal(s0.phase, 'setup');
  assert.equal(setup(s0, GUEST, 1), null); // nur der Host
  assert.equal(setup(s0, HOST, 4), null); // zu zweit höchstens 3
  const s = setup(s0, HOST, 3, rngOf(2));
  assert.equal(s.phase, 'bet');
  assert.deepEqual(s.players.map((p) => (p ? (p.human ? 'M' : 'C') : '-')).join(''), 'CMCMC');
  for (const p of [0, 2, 4]) assert.ok(s.bets[p] >= MIN && s.bets[p] <= 50 && s.stacks[p] === BUY_IN - s.bets[p]);
  assert.deepEqual([s.stacks[HOST], s.stacks[GUEST]], [700, 300]);
  assert.equal(s.shoe.length, DECKS * 52);
  assert.ok(s.cut >= 60 && s.cut < 90);
  const solo = setup(newGame({}, rngOf(1)), HOST, 4, rngOf(2));
  assert.deepEqual(solo.players.map((p) => (p ? (p.human ? 'M' : 'C') : '-')).join(''), 'CMCCC');
  assert.equal(newGame({ free: true }).free, true); // ohne Hilfen auch allein (die Computer schummeln und prüfen)
  assert.equal(newGame({ humans: [HOST, GUEST], free: true }).free, true);
});

test('Austeilen: je Box eine Karte, die Bank eine, dann je Box die zweite – die Bank wartet', () => {
  let s = table({ humans: [HOST, GUEST], cpus: 1, shoe: 'h2 h3 h4 h5 h6 h7 h8' }); // Computer auf Box 2
  s = bet(s, HOST, 20);
  assert.equal(s.phase, 'bet'); // wartet auf den Gast
  s = bet(s, GUEST, 30);
  assert.equal(s.phase, 'play');
  assert.deepEqual(hand(s, HOST).cards, ['h2', 'h6']);
  assert.deepEqual(hand(s, 2).cards, ['h3', 'h7']);
  assert.deepEqual(hand(s, GUEST).cards, ['h4', 'h8']);
  assert.deepEqual(s.dealer, ['h5']);
  assert.deepEqual(s.turn, { box: HOST, hand: 0 });
  assert.equal(account(s, HOST), 1000);
  assert.equal(s.stacks[HOST], 980);
});

test('Bank zieht bis 16 und steht auf Soft 17; Gewinn 1 : 1, Gleichstand behält den Einsatz', () => {
  // Host 10+9 = 19, Bank 6 + Ass = Soft 17 → steht
  let s = bet(table({ shoe: 'hT d6 h9 cA' }), HOST, 100);
  s = go(s, [HOST, 'stand']);
  assert.equal(s.phase, 'done');
  assert.deepEqual(s.dealer, ['d6', 'cA']);
  assert.equal(hand(s, HOST).result, 'win');
  assert.equal(s.stacks[HOST], 1100);
  // Bank 6 + 10 = 16 → zieht 5 = 21; Host 20 verliert
  s = bet(table({ shoe: 'hT d6 hQ cT h5' }), HOST, 100);
  s = go(s, [HOST, 'stand']);
  assert.deepEqual(s.dealer, ['d6', 'cT', 'h5']);
  assert.equal(hand(s, HOST).result, 'lose');
  assert.equal(s.stacks[HOST], 900);
  // Gleichstand 18 : 18
  s = bet(table({ shoe: 'hT d9 h8 c9' }), HOST, 100);
  s = go(s, [HOST, 'stand']);
  assert.equal(hand(s, HOST).result, 'push');
  assert.equal(s.stacks[HOST], 1000);
  // Bank verkauft sich
  s = bet(table({ shoe: 'hT d6 h7 cT cK' }), HOST, 100);
  s = go(s, [HOST, 'stand']);
  assert.equal(hand(s, HOST).result, 'win');
  assert.equal(total(s.dealer).total, 26);
});

test('Ziehen und Verkaufen: über 21 ist sofort verloren, die Bank zieht dann nicht mehr', () => {
  let s = bet(table({ shoe: 'hT d7 h6 cK' }), HOST, 50);
  s = go(s, [HOST, 'hit']);
  assert.equal(s.phase, 'done');
  assert.equal(hand(s, HOST).result, 'bust');
  assert.deepEqual(s.dealer, ['d7']); // keiner mehr im Spiel
  assert.equal(s.stacks[HOST], 950);
  // 21 nach dem Ziehen: fertig ohne Klick
  s = bet(table({ shoe: 'h5 d7 h6 cK cT' }), HOST, 50);
  s = go(s, [HOST, 'hit']);
  assert.equal(hand(s, HOST).done, true);
  assert.equal(s.phase, 'done');
});

test('Black Jack zahlt 3 : 2, gegen Black Jack der Bank Gleichstand; die Bank zieht nur eine Karte nach', () => {
  let s = bet(table({ shoe: 'hA d9 hK c7' }), HOST, 100);
  assert.equal(s.phase, 'done'); // nichts mehr zu entscheiden
  assert.deepEqual(s.dealer, ['d9']); // gegen 9 kann die Bank keinen Black Jack mehr haben
  assert.equal(hand(s, HOST).result, 'blackjack');
  assert.equal(s.stacks[HOST], 1150);
  s = bet(table({ shoe: 'hA dT hK cA' }), HOST, 100);
  assert.deepEqual(s.dealer, ['dT', 'cA']);
  assert.equal(hand(s, HOST).result, 'push');
  assert.equal(s.stacks[HOST], 1000);
  s = bet(table({ shoe: 'hA dT hK c7' }), HOST, 10);
  assert.equal(s.stacks[HOST], 1015);
  assert.deepEqual(s.dealer, ['dT', 'c7']); // nur die zweite Karte
});

test('Verdoppeln nur auf 9, 10 oder 11 – genau eine Karte; Black Jack der Bank nimmt auch den doppelten Einsatz', () => {
  let s = bet(table({ shoe: 'h6 d7 h5 cK c8' }), HOST, 100); // 11 gegen 7
  assert.equal(options(s, HOST).double, true);
  s = go(s, [HOST, 'double']);
  assert.equal(hand(s, HOST).bet, 200);
  assert.deepEqual(hand(s, HOST).cards, ['h6', 'h5', 'cK']);
  assert.equal(s.phase, 'done'); // nach dem Verdoppeln ist die Hand fertig
  assert.equal(hand(s, HOST).result, 'win'); // 21 gegen 7 + 8
  assert.equal(s.stacks[HOST], 1200);
  s = bet(table({ shoe: 'h6 dT h6 cK' }), HOST, 100); // 12: nicht verdoppeln
  assert.equal(options(s, HOST).double, false);
  assert.equal(act(s, HOST, 'double'), null);
  // Bank Black Jack nach dem Verdoppeln: beide Einsätze weg (europäisch, ohne verdeckte Karte)
  s = bet(table({ shoe: 'h5 dA h5 c9 cK' }), HOST, 100);
  s = insure(s, HOST, false);
  s = go(s, [HOST, 'double']);
  assert.deepEqual(s.dealer, ['dA', 'cK']);
  assert.equal(hand(s, HOST).result, 'lose');
  assert.equal(s.stacks[HOST], 800);
});

test('Teilen: gleichwertige Karten (auch 10 und König), erneut teilen, verdoppeln nach dem Teilen', () => {
  let s = bet(table({ shoe: 'h8 d6 c8 s8 h3 cT s9 c9 c7' }), HOST, 100);
  assert.equal(options(s, HOST).split, true);
  s = go(s, [HOST, 'split']);
  assert.equal(s.boxes[HOST].hands.length, 2);
  assert.deepEqual(hand(s, HOST, 0).cards, ['h8', 's8']); // die erste bekommt gleich ihre zweite Karte
  assert.deepEqual(hand(s, HOST, 1).cards, ['c8']);
  s = go(s, [HOST, 'split']); // erneut teilen
  assert.equal(s.boxes[HOST].hands.length, 3);
  assert.deepEqual(hand(s, HOST, 0).cards, ['h8', 'h3']);
  s = go(s, [HOST, 'double']); // 11 nach dem Teilen
  assert.deepEqual(s.turn, { box: HOST, hand: 1 });
  assert.deepEqual(hand(s, HOST, 1).cards, ['s8', 's9']); // zweite Karte erst, wenn die Hand dran ist
  s = go(s, [HOST, 'stand']);
  assert.deepEqual(hand(s, HOST, 2).cards, ['c8', 'c9']);
  s = go(s, [HOST, 'stand']);
  assert.equal(s.phase, 'done');
  // Bank: 6 + 7 = 13 … zieht weiter aus den Füllkarten
  assert.equal(s.stacks[HOST] + 0, account(s, HOST));
  const t = table({ shoe: 'hT d6 sK' });
  assert.equal(options(bet(t, HOST, 10), HOST).split, true); // 10 und König sind gleich viel wert
  assert.equal(options(bet(table({ shoe: 'hT d6 s9' }), HOST, 10), HOST).split, false);
});

test('Geteilte Asse: je nur eine Karte, Ass + 10 ist dann 21 (kein Black Jack), ein weiteres Ass darf wieder geteilt werden', () => {
  let s = bet(table({ shoe: 'hA d9 cA sK dA h7 c8' }), HOST, 100);
  s = go(s, [HOST, 'split']);
  assert.deepEqual(hand(s, HOST, 0).cards, ['hA', 'sK']);
  assert.equal(hand(s, HOST, 0).done, true); // fertig ohne Klick
  assert.deepEqual(hand(s, HOST, 1).cards, ['cA', 'dA']); // A-A: noch einmal teilen oder bleiben
  const o = options(s, HOST);
  assert.equal(o.hit, false);
  assert.equal(o.double, false);
  assert.equal(o.split, true);
  s = go(s, [HOST, 'split']);
  assert.equal(s.phase, 'done');
  assert.deepEqual(hand(s, HOST, 1).cards, ['cA', 'h7']);
  assert.deepEqual(hand(s, HOST, 2).cards, ['dA', 'c8']);
  // Bank 9 + Füllkarte c2 … : Ass+König zählt 21, zahlt nur 1 : 1
  assert.equal(hand(s, HOST, 0).result, 'win');
  assert.equal(hand(s, HOST, 0).back, 200);
});

test('Versicherung bei Ass der Bank: halber Einsatz, zahlt 2 : 1 – sonst verloren', () => {
  let s = bet(table({ humans: [HOST, GUEST], cpus: 1, shoe: 'hT h9 h8 dA h7 h9 h8 cK' }), HOST, 100);
  s = bet(s, GUEST, 40);
  assert.equal(s.phase, 'insurance');
  assert.equal(s.boxes[2].insurance, 0); // Computer versichern nie
  s = insure(s, HOST, true);
  assert.equal(s.stacks[HOST], 850);
  assert.equal(insure(s, HOST, true), null); // nur einmal
  s = insure(s, GUEST, false);
  assert.equal(s.phase, 'play');
  s = go(s, [HOST, 'stand']);
  // Computer auf Box 2 (9 + 9) ist dran – er steht laut Grundstrategie
  s = go(s, [2, decide(s, 2)], [GUEST, 'stand']);
  assert.deepEqual(s.dealer, ['dA', 'cK']);
  assert.equal(s.stacks[HOST], 850 + 150); // Hand verloren, Versicherung 50 × 3 zurück
  assert.equal(s.stacks[GUEST], 960);
  // ohne Black Jack der Bank ist die Versicherung weg
  s = bet(table({ shoe: 'hT dA h9 c7' }), HOST, 100);
  s = insure(s, HOST, true);
  s = go(s, [HOST, 'stand']);
  assert.deepEqual(s.dealer, ['dA', 'c7']);
  assert.equal(hand(s, HOST).result, 'win'); // 19 gegen Soft 18
  assert.equal(s.stacks[HOST], 1000 - 150 + 200);
});

test('Schlitten: an der Schnittkarte wird vor der nächsten Runde neu gemischt', () => {
  let s = table();
  s = { ...s, shoe: s.shoe.slice(0, 70), cut: 75, used: 242 };
  s = bet(s, HOST, 10);
  assert.ok(s.events.some((e) => e.type === 'shuffle'));
  assert.ok(s.used < 20);
  assert.ok(s.shoe.length > 290);
});

test('Sicht: Schlitten nur als Anzahl, gelinste Karte nur für sich, Schummeleien nur beim Host', () => {
  let s = bet(bet(table({ humans: [HOST, GUEST], free: true, shoe: 'h9 h8 d7 h9 h8 cK' }), HOST, 10), GUEST, 10);
  s = peek(s, GUEST);
  assert.equal(s.peek[GUEST], 'cK');
  const host = viewFor(s, HOST);
  const guest = viewFor(s, GUEST);
  assert.equal(typeof host.shoe, 'number');
  assert.equal(shoeCount(host), s.shoe.length);
  assert.equal(host.peek[GUEST], null);
  assert.equal(guest.peek[GUEST], 'cK');
  assert.deepEqual(guest.cheats, []);
  assert.equal(host.events.some((e) => e.type === 'peek'), false);
  assert.equal(guest.events.some((e) => e.type === 'peek'), true);
  assert.equal(JSON.stringify(guest).length < 15000, true); // passt in eine PeerJS-Nachricht
});

// --- Spielgeld ---
test('Spielgeld: Konto zählt den Einsatz mit, leihen nur bei 0, angleichen nimmt notfalls vom Einsatz', () => {
  let s = table({ chips: { [HOST]: 30 } });
  s = bet(s, HOST, 30);
  assert.equal(account(s, HOST), 30);
  assert.equal(borrow(s, HOST, 1000), null); // es steht noch Geld im Spiel
  s = go(s, [HOST, 'stand']);
  if (s.stacks[HOST] === 0) {
    assert.equal(account(s, HOST), 0);
    s = borrow(s, HOST, 1000);
    assert.equal(s.stacks[HOST], 1000);
  }
  let b = bet(table({ shoe: 'h9 d7 h9' }), HOST, 100);
  b = setAccount(b, HOST, 1050); // woanders 50 gewonnen
  assert.equal(account(b, HOST), 1050);
  assert.equal(b.stacks[HOST], 950);
  b = setAccount(b, HOST, 40); // woanders fast alles verloren
  assert.equal(account(b, HOST), 40);
  assert.equal(hand(b, HOST).bet, 40);
  // Setzrunde: wer nichts hat, schaut zu; der Tisch wartet, bis ein Mensch setzt
  let w = table({ humans: [HOST, GUEST], chips: { [HOST]: 0, [GUEST]: 100 } });
  w = bet(w, GUEST, 10);
  assert.equal(w.phase, 'play');
  assert.equal(w.boxes[HOST], null);
  let z = table({ chips: { [HOST]: 0 } });
  assert.equal(z.phase, 'bet');
  z = borrow(z, HOST, 1000);
  assert.equal(z.stacks[HOST], 1000);
});

test('Pleite Computer wird ersetzt', () => {
  let s = table({ cpus: 1 });
  s = { ...s, stacks: s.stacks.map((x, p) => (p === 2 ? 0 : x)), bets: s.bets.map((x, p) => (p === 2 ? null : x)), phase: 'done' };
  const name = s.players[2].name;
  s = newRound(s, rngOf(9));
  assert.ok(s.events.some((e) => e.type === 'newcpu' && e.player === 2));
  assert.notEqual(s.players[2].name, name);
  assert.equal(s.stacks[2] + s.bets[2], BUY_IN);
});

// --- Ohne Hilfen ---
test('Ohne Hilfen: Regelwidriges geht und wird vermerkt – erwischt verliert alles, Fehlalarm kostet 20', () => {
  let s = table({ humans: [HOST, GUEST], free: true, shoe: 'hT h6 d7 h9 h7 cK c5' });
  s = bet(bet(s, HOST, 100), GUEST, 100);
  s = go(s, [HOST, 'hit']); // 10 + 9 + König = 29 – geht ohne Hilfen weiter
  assert.equal(hand(s, HOST).done, false);
  s = go(s, [HOST, 'claim', 20]);
  assert.equal(s.cheats.length, 1);
  assert.equal(s.cheats[0].kind, 'claim');
  assert.match(s.cheats[0].why, /20 angesagt, aber 29 gehabt/);
  // Gast: verdoppelt auf 13 (regelwidrig) und bleibt
  s = go(s, [GUEST, 'double'], [GUEST, 'stand']);
  assert.equal(s.cheats.length, 2);
  assert.equal(s.phase, 'done');
  assert.equal(hand(s, HOST).result, 'win'); // Ansage 20 gegen die Bank
  const before = s.stacks[HOST];
  // Gast ruft „Geschummelt!“: Gewinn wird zurückgebucht
  const caught = accuse(s, GUEST, HOST);
  assert.equal(caught.events[0].type, 'caught');
  assert.match(caught.events[0].why, /20 angesagt/);
  assert.equal(caught.stacks[HOST], before - s.payout[HOST]);
  assert.equal(caught.payout[HOST], 0);
  // nochmal rufen: nichts mehr da → Fehlalarm
  const again_ = accuse(caught, GUEST, HOST);
  assert.equal(again_.events[0].type, 'fehlalarm');
  assert.equal(again_.stacks[GUEST], caught.stacks[GUEST] - PENALTY);
  assert.equal(again_.stacks[HOST], caught.stacks[HOST] + PENALTY);
  // Wer geschummelt hat, startet die nächste Runde nicht selbst, solange der andere rufen kann
  const onlyHost = { ...s, cheats: s.cheats.filter((c) => c.player === HOST) };
  assert.equal(again(onlyHost, HOST), null);
  assert.ok(again(onlyHost, GUEST));
  assert.ok(again(s, HOST)); // beide haben geschummelt
});

test('Ohne Hilfen: erwischt während der Runde – alle Hände verloren, der Nächste ist dran', () => {
  let s = table({ humans: [HOST, GUEST], free: true, shoe: 'h8 h6 d7 h8 h9 c5' });
  s = bet(bet(s, HOST, 100), GUEST, 100);
  s = go(s, [HOST, 'split']); // 8 + 8 ist erlaubt
  assert.equal(s.cheats.length, 0);
  s = raise(s, HOST, 50);
  assert.equal(hand(s, HOST).bet, 150);
  assert.equal(s.cheats[0].kind, 'raise');
  const c = accuse(s, GUEST, HOST);
  assert.equal(c.events[0].type, 'caught');
  assert.equal(c.boxes[HOST].forfeit, true);
  assert.deepEqual(c.turn, { box: GUEST, hand: 0 });
  const end = go(c, [GUEST, 'stand']);
  assert.equal(end.payout[HOST], 0);
  assert.ok(end.boxes[HOST].hands.every((h) => h.result === 'lose'));
  // Fehlalarm mitten in der Runde
  const f = accuse(s, HOST, GUEST);
  assert.equal(f.events[0].type, 'fehlalarm');
  assert.equal(f.stacks[HOST], s.stacks[HOST] - PENALTY);
  // ohne Hilfen gibt es das alles nicht
  const strict = bet(table({ shoe: 'h8 h6 d7' }), HOST, 100);
  assert.equal(peek(strict, HOST), null);
  assert.equal(raise(strict, HOST, 50), null);
  assert.equal(act(strict, HOST, 'claim', 21), null);
  assert.equal(accuse(strict, HOST, GUEST), null);
});

test('Ohne Hilfen: linsen, nach dem Verdoppeln weiterziehen und Ungleiches teilen werden vermerkt', () => {
  let s = table({ humans: [HOST, GUEST], free: true, shoe: 'h5 h9 d7 h4 h8 c3 cT' });
  s = bet(bet(s, HOST, 100), GUEST, 100);
  s = peek(s, HOST);
  assert.equal(s.peek[HOST], 'c3');
  assert.equal(peek(s, HOST), null); // schon gesehen
  s = go(s, [HOST, 'double'], [HOST, 'hit']); // 9 ist erlaubt, danach ziehen nicht
  assert.deepEqual(s.cheats.map((c) => c.kind), ['peek', 'more']);
  s = go(s, [HOST, 'stand'], [GUEST, 'split']); // 9 und 8 geteilt
  assert.equal(s.cheats.at(-1).kind, 'split');
  assert.equal(OUTCOME.Blackjack(s), undefined); // Runde läuft
});

test('Nach dem Review: Erwischte Einsätze zählen nicht mehr zum Konto, angleichen kürzt auch die Versicherung und teilt aus', () => {
  let s = table({ humans: [HOST, GUEST], free: true, shoe: 'h8 h6 d7 h8 h9 c5' });
  s = bet(bet(s, HOST, 100), GUEST, 100);
  s = raise(s, HOST, 50);
  const c = accuse(s, GUEST, HOST);
  assert.equal(account(c, HOST), c.stacks[HOST]); // Einsätze sind weg
  assert.equal(raise(c, HOST, 10), null);
  assert.equal(peek(c, HOST), null);
  // Versicherung beim Angleichen
  let v = bet(table({ shoe: 'hT dA h9 c7' }), HOST, 100);
  v = insure(v, HOST, true);
  v = setAccount(v, HOST, 0);
  assert.equal(account(v, HOST), 0);
  // Setzrunde: Gast wird auf 0 gestellt, nachdem der Host gesetzt hat → es wird ausgeteilt
  let w = table({ humans: [HOST, GUEST] });
  w = bet(w, HOST, 50);
  w = bet(w, GUEST, 50);
  assert.equal(w.phase, 'play');
  let x = table({ humans: [HOST, GUEST] });
  x = bet(x, GUEST, 50);
  x = setAccount(x, GUEST, 0);
  assert.equal(x.phase, 'bet'); // Host hat noch nicht gesetzt
  x = bet(x, HOST, 50);
  assert.equal(x.phase, 'play');
  let y = table({ humans: [HOST, GUEST] });
  y = bet(y, HOST, 50);
  y = setAccount(y, GUEST, 0);
  assert.equal(y.phase, 'play');
  assert.equal(y.boxes[GUEST], null);
});

test('Ohne Hilfen allein: Computer dürfen linsen und ansagen, prüfen den Menschen; sonst prüft der Croupier', () => {
  // Host Box 1, Computer Box 2: Host 10+6, Computer 10+5, Bank 7
  let s = table({ free: true, cpus: 1, shoe: 'hT sT d7 h6 s5 c9 cK' });
  assert.equal(s.free, true);
  s = bet(s, HOST, 100);
  s = go(s, [HOST, 'claim', 20]); // Mensch sagt 20 statt 16
  assert.deepEqual(s.turn, { box: 2, hand: 0 });
  s = peek(s, 2);
  assert.equal(s.peek[2], 'c9');
  s = go(s, [2, 'claim', 19]); // Computer sagt 19 statt 15
  assert.equal(s.phase, 'done');
  assert.deepEqual(s.cheats.map((c) => [c.player, c.kind]), [[HOST, 'claim'], [2, 'peek'], [2, 'claim']]);
  // Computer erwischt den Menschen, der Mensch den Computer
  const a = accuse(s, 2, HOST);
  assert.equal(a.events[0].type, 'caught');
  assert.equal(a.payout[HOST], 0);
  const b = accuse(a, HOST, 2);
  assert.equal(b.events[0].type, 'caught');
  assert.match(b.events[0].why, /19 angesagt, aber nur 15 gehabt/);
  // Fehlalarm des Croupiers zahlt die Bank
  const c = accuse(b, BANK, HOST);
  assert.equal(c.events[0].type, 'fehlalarm');
  assert.equal(c.stacks[HOST], b.stacks[HOST] + PENALTY);
  // Wer geschummelt hat, startet die nächste Runde erst, wenn geprüft ist
  assert.equal(again(s, HOST), null);
  assert.ok(again(waive(s), HOST));
  assert.equal(waive(waive(s)), null);
  assert.ok(again(a, HOST)); // erwischt – nichts mehr offen
});

// --- Grundstrategie ---
test('Grundstrategie der Computer', () => {
  const all = { hit: true, stand: true, double: true, split: true };
  const b = (h, up, o = all) => basic(cards(h), up, o);
  assert.equal(b('hT h6', 'dT'), 'hit');
  assert.equal(b('hT h6', 'd6'), 'stand');
  assert.equal(b('hT h2', 'd3'), 'hit');
  assert.equal(b('hT h2', 'd4'), 'stand');
  assert.equal(b('h6 h5', 'd9'), 'double');
  assert.equal(b('h6 h5', 'dT'), 'hit'); // ohne verdeckte Bankkarte
  assert.equal(b('h6 h3', 'd2'), 'hit');
  assert.equal(b('h6 h3', 'd5'), 'double');
  assert.equal(b('h6 h3', 'd5', { ...all, double: false }), 'hit');
  assert.equal(b('hA h7', 'd8'), 'stand');
  assert.equal(b('hA h7', 'd9'), 'hit');
  assert.equal(b('hA h6', 'd5'), 'hit'); // Soft-Doppeln gibt es hier nicht
  assert.equal(b('h8 s8', 'd9'), 'split');
  assert.equal(b('h8 s8', 'dT'), 'hit');
  assert.equal(b('hA sA', 'd6'), 'split');
  assert.equal(b('hT sK', 'd6'), 'stand');
  assert.equal(b('h9 s9', 'd7'), 'stand');
  assert.equal(b('h5 s5', 'd6'), 'double');
  assert.equal(b('hA sA', 'd6', { hit: false, stand: true, double: false, split: false }), 'stand'); // geteilte Asse
});

// --- Ganze Partien ---
function playRounds(seed, { rounds = 60, humans = [HOST], cpus = 4 } = {}) {
  const rng = rngOf(seed);
  let s = setup(newGame({ humans, chips: Object.fromEntries(humans.map((p) => [p, 500])) }, rng), HOST, cpus, rng);
  const seen = new Set();
  let played = 0;
  for (let step = 0; step < rounds * 40 && played < rounds; step++) {
    seen.add(s.phase);
    for (const p of [0, 1, 2, 3, 4]) assert.ok(s.stacks[p] >= 0, `Stapel negativ (Box ${p})`);
    let next = null;
    if (s.phase === 'bet') {
      const p = humans.find((h) => s.bets[h] === null && s.stacks[h] > 0);
      if (p === undefined) next = borrow(s, humans.find((h) => account(s, h) === 0), 1000);
      else next = bet(s, p, Math.min(s.stacks[p] >= MIN ? 10 * (1 + Math.floor(rng() * 10)) : s.stacks[p], s.stacks[p] >= MIN ? s.stacks[p] - (s.stacks[p] % 10) : s.stacks[p]), rng);
    } else if (s.phase === 'insurance') {
      const p = humans.find((h) => s.boxes[h]?.insurance === null);
      next = insure(s, p, false, rng);
    } else if (s.phase === 'play') {
      next = act(s, s.turn.box, decide(s, s.turn.box), undefined, rng);
    } else if (s.phase === 'done') {
      played++;
      const net = s.payout.reduce((a, b) => a + b, 0) - s.staked.reduce((a, b) => a + b, 0);
      assert.ok(Number.isFinite(net));
      next = newRound(s, rng);
    }
    assert.ok(next, `hängt in Phase ${s.phase} (${JSON.stringify(s.turn)})`);
    s = next;
  }
  return { s, played, seen };
}

test('Computer gegen Computer: viele Runden laufen durch, mit Mischen, Teilen und Versicherung', () => {
  const { s, played, seen } = playRounds(7, { rounds: 120 });
  assert.equal(played, 120);
  assert.ok(seen.has('insurance'));
  assert.ok(s.round >= 120);
  for (const seed of [1, 2, 3]) assert.equal(playRounds(seed, { rounds: 40, humans: [HOST, GUEST], cpus: 3 }).played, 40);
});

// --- Statistik ---
test('Statistik: je Runde, wer von beiden mehr gewonnen (oder weniger verloren) hat', () => {
  let s = table({ humans: [HOST, GUEST], shoe: 'hT hT d7 h9 h8 c9' }); // Host 19, Gast 18, Bank 7 + 9 = 16 → zieht
  s = bet(bet(s, HOST, 100), GUEST, 50);
  assert.equal(OUTCOME.Blackjack(s), undefined);
  s = go(s, [HOST, 'stand'], [GUEST, 'stand']);
  const net = (p) => s.payout[p] - s.staked[p];
  const want = net(HOST) === net(GUEST) ? null : net(HOST) > net(GUEST) ? 0 : 1;
  assert.equal(OUTCOME.Blackjack(s), want);
  // nur einer hat gesetzt → zählt nicht
  let w = table({ humans: [HOST, GUEST], chips: { [HOST]: 0, [GUEST]: 100 }, shoe: 'hT d7 h9 c9' });
  w = go(bet(w, GUEST, 10), [GUEST, 'stand']);
  assert.equal(w.phase, 'done');
  assert.equal(OUTCOME.Blackjack(w), undefined);
  // gleich viel = Remis
  const tie = { ...s, payout: [0, 200, 0, 200, 0], staked: [0, 100, 0, 100, 0] };
  assert.equal(OUTCOME.Blackjack(tie), null);
});

test('judge: Ergebnis einer Hand', () => {
  const h = (str, bet = 10, extra = {}) => ({ cards: cards(str), bet, split: false, claim: null, ...extra });
  assert.deepEqual(judge(h('hA hK'), cards('d9 d8')), { result: 'blackjack', back: 25 });
  assert.deepEqual(judge(h('hA hK', 10, { split: true }), cards('d9 d8')), { result: 'win', back: 20 });
  assert.deepEqual(judge(h('h9 h8 h5'), cards('d9 dA')), { result: 'bust', back: 0 });
  assert.deepEqual(judge(h('h9 h8 h4'), cards('dA dK')), { result: 'lose', back: 0 });
  assert.deepEqual(judge(h('h9 h8 h4', 10, { claim: 20 }), cards('d9 d8 d4')), { result: 'lose', back: 0 });
  assert.deepEqual(judge(h('h9 h8', 10, { claim: 20 }), cards('d9 d8')), { result: 'win', back: 20 });
  assert.deepEqual(judge(h('h9 h8'), cards('d9 d8'), true), { result: 'lose', back: 0 });
});

// Ablauf in index.js (Review 21.10.2026): Allein ohne Hilfen will der Croupier nach ehrlichem Bleiben (selten) rufen,
// der Mensch startet aber sofort die nächste Runde – der Fehlalarm darf dann nicht in der neuen Runde nachkommen.
test('index.js allein ohne Hilfen: kein nachgeholter Fehlalarm zum Bleiben der alten Runde', async (t) => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startBlackjack } = await import('../src/blackjack/index.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.01); // Prüfer ruft nach ehrlichem Bleiben (5 %)
  const s = bet(table({ free: true, shoe: 'h9 hT d9 c8' }), HOST, 10); // 9 + 9 gegen 10, die Bank zieht 8 = 18
  assert.equal(s.phase, 'play');
  const g = startBlackjack({ ...io, me: 0, level: 1, free: true, resume: s });
  ui.panel.onAction('stand');
  assert.equal(g.view().phase, 'done');
  ui.panel.onAction('again');
  ui.panel.onAction('bet', 10);
  assert.equal(g.view().phase, 'play');
  const seq = g.view().seq;
  for (let i = 0; i < 30; i++) t.mock.timers.tick(200);
  assert.ok(!g.view().events.some((e) => e.type === 'fehlalarm'));
  assert.equal(g.view().seq, seq, 'keiner hat etwas getan');
  g.stop();
});
