// Kartenduell (src/kartenduell/game.js, cards.js): vereinfachte Duell-Regeln, Sichten, „Ohne Hilfen“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, pickDeck, summon, flip, position, setCard, activate, pass, attack, nextStep, discard, draw, accuse, waive,
  again, regroup, viewFor, moves, apply, atkOf, defOf, locate, LP_START, HAND_MAX, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from '../src/kartenduell/game.js';
import { CARDS, CARD, DECKS, deckProblem, tributesFor, DECK_SIZE } from '../src/kartenduell/cards.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fester Stand mitten im Duell. Karten als ids; uids werden je Sitz ab 0 bzw. 40 vergeben (Rückgabe: ids → uids).
// mon/st: { id, pos, up, since, eq } – since = Zug, in dem die Karte kam (Standard: früher)
function duel({ hands = [[], []], mon = [[], []], st = [[], []], field = [null, null], grave = [[], []], deck = [10, 10], turn = 0, turnNo = 5, step = 'main1', free = false, lp } = {}) {
  const s = { ...newGame({ humans: [0, 1], free }), phase: 'duel', turn, turnNo, step, picks: [{ name: 'A', list: [] }, { name: 'B', list: [] }] };
  const next = [0, DECK_SIZE];
  const u = [[], []];
  const add = (p, id) => {
    const k = next[p]++;
    s.cards[k] = id;
    u[p].push(k);
    return k;
  };
  for (const p of [0, 1]) {
    s.deck[p] = Array.from({ length: deck[p] }, () => add(p, 'g01'));
    s.hand[p] = hands[p].map((id) => add(p, id));
    s.grave[p] = grave[p].map((id) => add(p, id));
    s.mon[p] = [0, 1, 2, 3, 4].map((i) => {
      const m = mon[p][i];
      return m ? { u: add(p, m.id), pos: m.pos ?? 'atk', up: m.up ?? true, since: m.since ?? 1, changed: null, attacked: null } : null;
    });
    s.st[p] = [0, 1, 2, 3, 4].map((i) => {
      const x = st[p][i];
      return x ? { u: add(p, x.id), up: x.up ?? false, since: x.since ?? 1, eq: x.eq ?? null } : null;
    });
    s.field[p] = field[p] ? { u: add(p, field[p]) } : null;
  }
  if (lp) s.lp = lp;
  return s;
}
const hand = (s, p, id) => s.hand[p].find((u) => s.cards[u] === id);
const onField = (s, p, id) => s.mon[p].find((m) => m && s.cards[m.u] === id)?.u;
const setOn = (s, p, id) => s.st[p].find((x) => x && s.cards[x.u] === id)?.u;

test('Karten: 60 Sorten mit Texten, drei feste Decks mit je 40 erlaubten Karten', () => {
  assert.equal(CARDS.length, 60);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 60);
  for (const c of CARDS) assert.ok(c.name && c.text.length > 10, c.id);
  for (const [k, d] of Object.entries(DECKS)) assert.equal(deckProblem(d.list), '', k);
  assert.match(deckProblem([...DECKS.glut.list.slice(1), 's03']), /höchstens 1-mal/);
  assert.match(deckProblem(DECKS.glut.list.slice(1)), /genau 40/);
  assert.deepEqual([1, 4, 5, 6, 7, 8].map(tributesFor), [0, 0, 1, 1, 2, 2]);
});

test('Start: beide wählen ein Deck, je 5 Karten; wer anfängt, zieht nicht, der andere schon', () => {
  let s = newGame({ humans: [0, 1] });
  assert.equal(pickDeck(s, 0, { deck: 'nix' }), null);
  s = pickDeck(s, 0, { deck: 'glut' }, seeded(1));
  assert.equal(s.phase, 'setup');
  assert.equal(pickDeck(s, 0, { deck: 'glut' }), null, 'nur einmal wählen');
  s = pickDeck(s, 1, { name: 'Mein Deck', list: DECKS.tiefsee.list }, seeded(2));
  assert.equal(s.phase, 'duel');
  assert.equal(s.turnNo, 1);
  assert.equal(s.turn, s.starter);
  assert.equal(s.hand[s.starter].length, 5);
  assert.equal(s.hand[1 - s.starter].length, 5);
  assert.equal(s.deck[0].length + s.hand[0].length, 40);
  s = nextStep(s, s.starter, 'end');
  assert.equal(s.turn, 1 - s.starter);
  assert.equal(s.hand[s.turn].length, 6);
  assert.equal(s.step, 'main1');
});

test('Normalbeschwörung: einmal je Zug, Tribute nach Stufe', () => {
  let s = duel({ hands: [['g04', 'g06', 'g08', 'g10'], []], mon: [[{ id: 'g01' }], []] });
  s = summon(s, 0, hand(s, 0, 'g04'));
  assert.ok(onField(s, 0, 'g04') !== undefined);
  assert.equal(summon(s, 0, hand(s, 0, 'g06')), null, 'zweite Beschwörung');
  let t = duel({ hands: [['g08', 'g10'], []], mon: [[{ id: 'g01' }, { id: 'g02' }], []] });
  assert.equal(summon(t, 0, hand(t, 0, 'g08')), null, 'Stufe 5 ohne Tribut');
  const g01 = onField(t, 0, 'g01');
  t = summon(t, 0, hand(t, 0, 'g08'), { tributes: [g01] });
  assert.equal(locate(t, g01).where, 'grave');
  assert.ok(onField(t, 0, 'g08') !== undefined);
  const u = duel({ hands: [['g10'], []], mon: [[{ id: 'g01' }, { id: 'g02' }], []] });
  const both = u.mon[0].filter(Boolean).map((m) => m.u);
  assert.equal(summon(u, 0, hand(u, 0, 'g10'), { tributes: both.slice(0, 1) }), null, 'Stufe 8 braucht 2');
  assert.ok(summon(u, 0, hand(u, 0, 'g10'), { tributes: both }));
  const v = duel({ hands: [['g04'], []] });
  const set = summon(v, 0, hand(v, 0, 'g04'), { set: true });
  const m = set.mon[0].find(Boolean);
  assert.equal(m.pos, 'def');
  assert.equal(m.up, false);
});

test('Position: nicht im Beschwörungszug, nur einmal je Zug; Flip deckt auf und kommt in Angriff', () => {
  let s = duel({ hands: [['g04'], []], mon: [[{ id: 'g05' }, { id: 't01', pos: 'def', up: false }], []] });
  s = summon(s, 0, hand(s, 0, 'g04'));
  assert.equal(position(s, 0, onField(s, 0, 'g04')), null);
  const golem = onField(s, 0, 'g05');
  s = position(s, 0, golem);
  assert.equal(locate(s, golem).slot.pos, 'def');
  assert.equal(position(s, 0, golem), null);
  const qualle = onField(s, 0, 't01');
  const before = s.hand[0].length;
  s = flip(s, 0, qualle);
  assert.equal(locate(s, qualle).slot.up, true);
  assert.equal(locate(s, qualle).slot.pos, 'atk');
  assert.equal(s.hand[0].length, before + 1, 'Nebelqualle: ziehe 1');
});

test('Kampf: Angriff gegen Angriff, gegen Verteidigung, Gleichstand, direkt', () => {
  const base = { step: 'battle', mon: [[{ id: 'g06' }], [{ id: 'g04' }]] }; // 1800 gegen 1600
  let s = duel(base);
  s = attack(s, 0, onField(s, 0, 'g06'), onField(s, 1, 'g04'));
  assert.equal(s.lp[1], LP_START - 200);
  assert.equal(s.grave[1].length, 1);
  assert.equal(attack(s, 0, onField(s, 0, 'g06'), null)?.lp[1], undefined, 'nur einmal angreifen');
  s = duel({ step: 'battle', mon: [[{ id: 'g04' }], [{ id: 'g06' }]] });
  s = attack(s, 0, onField(s, 0, 'g04'), onField(s, 1, 'g06'));
  assert.equal(s.lp[0], LP_START - 200);
  assert.equal(s.grave[0].length, 1);
  s = duel({ step: 'battle', mon: [[{ id: 'g04' }], [{ id: 'g04' }]] });
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u);
  assert.equal(s.grave[0].length + s.grave[1].length, 2, 'gleich stark: beide weg');
  assert.deepEqual(s.lp, [LP_START, LP_START]);
  s = duel({ step: 'battle', mon: [[{ id: 'g04' }], [{ id: 'g05', pos: 'def', up: false }]] }); // 1600 gegen DEF 2000
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u);
  assert.equal(s.lp[0], LP_START - 400);
  assert.equal(s.mon[1][0].up, true, 'verdeckter Verteidiger wird aufgedeckt');
  s = duel({ step: 'battle', mon: [[{ id: 'g08' }], [{ id: 'g02', pos: 'def' }]] }); // Feuerspeier 2100 durchbohrt DEF 800
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u);
  assert.equal(s.lp[1], LP_START - 1300);
  s = duel({ step: 'battle', mon: [[{ id: 'g06' }], [{ id: 'g02' }]] });
  assert.equal(attack(s, 0, s.mon[0][0].u, null), null, 'direkt nur ohne Monster beim Gegner');
  s = duel({ step: 'battle', mon: [[{ id: 'n02' }], [{ id: 'g10' }]] });
  assert.equal(attack(s, 0, s.mon[0][0].u, null).lp[1], LP_START - 1100, 'Schattenkobold darf direkt');
  s = duel({ step: 'battle', turnNo: 1, mon: [[{ id: 'g06' }], []] });
  assert.equal(attack(s, 0, s.mon[0][0].u, null), null, 'nicht im ersten Zug');
});

test('Effekte beim Zerstören und Aufdecken im Kampf', () => {
  let s = duel({ step: 'battle', mon: [[{ id: 'g06' }], [{ id: 'g03' }]] }); // Aschefuchs fällt: 500 Schaden
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u);
  assert.equal(s.lp[0], LP_START - 500);
  s = duel({ step: 'battle', mon: [[{ id: 'g04' }, { id: 'g06' }], [{ id: 'w03', pos: 'def', up: false }]] }); // Moosgnom
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u); // 1600 > DEF 1400 → Gnom fällt, sein Flip zerstört die Flammenschwinge
  assert.equal(onField(s, 0, 'g06'), undefined);
  assert.equal(s.grave[1].length, 1);
});

test('Fallen: Reaktion auf Angriff und Beschwörung, nicht im Zug des Setzens', () => {
  let s = duel({ step: 'battle', mon: [[{ id: 'g06' }], [{ id: 'g04' }]], st: [[], [{ id: 'f01' }]] });
  s = attack(s, 0, s.mon[0][0].u, s.mon[1][0].u);
  assert.equal(s.pending.type, 'react');
  assert.equal(s.pending.who, 1);
  assert.equal(nextStep(s, 0, 'end'), null, 'erst muss der andere reagieren');
  const mirror = setOn(s, 1, 'f01');
  const r = activate(s, 1, mirror);
  assert.equal(r.mon[0][0], null, 'Spiegelschild zerstört den Angreifer');
  assert.deepEqual(r.lp, [LP_START, LP_START]);
  assert.equal(r.pending, null);
  const p = pass(s, 1);
  assert.equal(p.lp[1], LP_START - 200);
  s = duel({ step: 'battle', mon: [[{ id: 'g06' }, { id: 'g04' }], []], st: [[], [{ id: 'f02' }]] });
  s = attack(s, 0, s.mon[0][0].u, null);
  s = activate(s, 1, setOn(s, 1, 'f02'));
  assert.equal(s.step, 'main2', 'Stolperdraht beendet die Kampfphase');
  assert.equal(s.lp[1], LP_START);
  s = duel({ hands: [['g06', 'g01'], []], st: [[], [{ id: 'f03' }, { id: 'f03', since: 5 }]] });
  const small = summon(s, 0, hand(s, 0, 'g01'));
  assert.equal(activate(small, 1, small.st[1][0].u), null, 'Dornengrube erst ab 1000 ATK');
  s = summon(s, 0, hand(s, 0, 'g06'));
  assert.equal(s.pending.trigger, 'summon');
  assert.equal(activate(s, 1, s.st[1][1].u), null, 'im selben Zug gesetzt');
  s = activate(s, 1, s.st[1][0].u);
  assert.equal(onField(s, 0, 'g06'), undefined);
  assert.equal(s.grave[1].length, 1, 'Falle danach im Friedhof');
});

test('Zauber: Ziel, Ausrüstung, Feld, Dauerzauber, Wiederkehr', () => {
  let s = duel({ hands: [['s03', 's07', 's10', 's14', 's13'], []], mon: [[{ id: 'g06' }], [{ id: 'g10' }]], grave: [['g09'], []] });
  assert.equal(activate(s, 0, hand(s, 0, 's03')), null, 'Blitzschlag braucht ein Ziel');
  s = activate(s, 0, hand(s, 0, 's03'), s.mon[1][0].u);
  assert.equal(s.mon[1][0], null);
  const wing = onField(s, 0, 'g06');
  s = activate(s, 0, hand(s, 0, 's07'), wing);
  assert.equal(atkOf(s, wing), 1800 + 700, 'Flammenklinge am Feuer-Monster');
  s = activate(s, 0, hand(s, 0, 's10'));
  assert.equal(atkOf(s, wing), 1800 + 700 + 300);
  s = activate(s, 0, hand(s, 0, 's14'));
  assert.equal(atkOf(s, wing), 1800 + 700 + 300 + 200);
  s = activate(s, 0, hand(s, 0, 's13'));
  assert.ok(onField(s, 0, 'g09') !== undefined, 'Wiederkehr holt den Vulkanwyrm');
  const blade = setOn(s, 0, 's07');
  s = { ...s, turn: 1, step: 'main1', turnNo: 6 };
  // Ausrüstung fällt mit dem Monster
  const killed = activate({ ...s, hand: [s.hand[0], [...s.hand[1], 79]], cards: { ...s.cards, 79: 's03' } }, 1, 79, wing);
  assert.equal(locate(killed, blade).where, 'grave');
});

test('Ende des Zugs: mehr als 6 Handkarten abwerfen; leeres Deck verliert', () => {
  let s = duel({ hands: [['g01', 'g01', 'g01', 'g01', 'g01', 'g01', 'g02', 'g03'], []] });
  s = nextStep(s, 0, 'end');
  assert.equal(s.pending.type, 'discard');
  s = discard(s, 0, s.hand[0][0]);
  assert.equal(s.turn, 0);
  s = discard(s, 0, s.hand[0][0]);
  assert.equal(s.hand[0].length, HAND_MAX);
  assert.equal(s.turn, 1);
  const d = nextStep(duel({ deck: [10, 0] }), 0, 'end');
  assert.equal(d.phase, 'over');
  assert.equal(d.winner, 0);
});

test('LP auf 0: Duell vorbei, Siege werden gezählt, Revanche mit gleichen Decks', () => {
  let s = duel({ step: 'battle', mon: [[{ id: 'g10' }], []], lp: [LP_START, 2500] });
  s = { ...s, picks: [{ name: 'Glut', list: DECKS.glut.list }, { name: 'Tiefsee', list: DECKS.tiefsee.list }] };
  s = attack(s, 0, s.mon[0][0].u, null);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.deepEqual(s.wins, [1, 0]);
  const r = again(s, 1, seeded(3));
  assert.equal(r.phase, 'duel');
  assert.deepEqual(r.wins, [1, 0]);
  assert.equal(r.round, 1);
  assert.equal(regroup(s, 0).phase, 'setup');
});

test('Sicht: fremde Hand, verdeckte Karten und Decks bleiben geheim', () => {
  const s = duel({ hands: [['g04'], ['t05']], mon: [[], [{ id: 't01', up: false, pos: 'def' }]], st: [[{ id: 'f01' }], [{ id: 'f02' }]] });
  const v = viewFor(s, 0);
  assert.equal(v.cards[s.hand[1][0]], undefined);
  assert.equal(v.cards[s.mon[1][0].u], undefined);
  assert.equal(v.cards[s.st[1][0].u], undefined);
  assert.equal(v.cards[s.st[0][0].u], 'f01', 'eigene verdeckte Karte kennt man');
  assert.equal(v.cards[s.hand[0][0]], 'g04');
  assert.ok(s.deck[0].every((u) => v.cards[u] === undefined));
  assert.equal(v.rand, null);
  const w = viewFor({ ...s, free: true, cheat: { player: 1, legal: false, prev: s, why: ['x'] } }, 0);
  assert.deepEqual(w.cheat, { player: 1 });
  assert.ok(!JSON.stringify(viewFor(s, 1)).includes('"f01"'), 'Gast sieht das Spiegelschild des Hosts nicht');
});

test('moves: nur Erlaubtes; Computer-Sicht reicht dafür', () => {
  const s = duel({ hands: [['g04', 'g10', 's01', 'f02'], []], mon: [[{ id: 'g01' }], [{ id: 'g02' }]] });
  const m = moves(viewFor(s, 0), 0);
  assert.ok(m.some((x) => x.t === 'summon' && s.cards[x.u] === 'g04'));
  assert.ok(!m.some((x) => x.t === 'summon' && s.cards[x.u] === 'g10'), 'Stufe 8 mit nur 1 Monster nicht');
  assert.ok(m.some((x) => x.t === 'activate' && s.cards[x.u] === 's01'));
  assert.ok(m.some((x) => x.t === 'set' && s.cards[x.u] === 'f02'));
  assert.ok(!m.some((x) => x.t === 'attack'), 'in der Hauptphase kein Angriff');
  for (const x of m) assert.ok(apply(s, 0, x), JSON.stringify(x));
  assert.deepEqual(moves(s, 1), [], 'nicht dran');
});

test('Ohne Hilfen: Schummeln geht, Erwischt nimmt alles ab dem Schummeln zurück, 500 LP Strafe', () => {
  let s = duel({ free: true, hands: [['g04', 'g06', 'g10'], []], deck: [10, 10] });
  assert.equal(s.hand[0].length, 3);
  s = draw(s, 0); // erlaubt: 1 Karte
  assert.equal(s.cheat.legal, true);
  s = summon(s, 0, hand(s, 0, 'g04'));
  const before = s;
  s = summon(s, 0, hand(s, 0, 'g10')); // ohne Tribute und zweite Beschwörung
  assert.equal(s.cheat.legal, false);
  assert.match(s.cheat.why.join(' '), /Tribut/);
  s = nextStep(s, 0, 'battle');
  s = attack(s, 0, onField(s, 0, 'g10'), null);
  assert.equal(s.lp[1], LP_START - 3000);
  const caught = accuse(s, 1);
  assert.equal(caught.events[0].type, 'caught');
  assert.match(caught.events[0].why, /Tribut/);
  assert.equal(caught.lp[0], LP_START - CHEAT_PENALTY);
  assert.equal(caught.lp[1], LP_START, 'Angriff danach auch zurück');
  assert.deepEqual(caught.mon[0], before.mon[0]);
  assert.equal(caught.step, 'main1');
  assert.equal(caught.cheat, null);
  // Fehlalarm
  let t = duel({ free: true, hands: [['g04'], []] });
  t = summon(t, 0, hand(t, 0, 'g04'));
  const alarm = accuse(t, 1);
  assert.equal(alarm.events[0].type, 'fehlalarm');
  assert.equal(alarm.lp[1], LP_START - FALSE_ALARM_PENALTY);
  assert.equal(alarm.mon[0].filter(Boolean).length, 1, 'Zug bleibt');
  assert.equal(accuse(t, 0), null, 'sich selbst anklagen geht nicht');
  // Eine Karte zu viel, Falle im Setz-Zug, Angriff im ersten Zug, zweimal Position
  let u = duel({ free: true, turnNo: 1, hands: [['f01'], []], mon: [[{ id: 'g06', since: 1 }], []], step: 'main1' });
  u = draw(u, 0);
  assert.match(u.cheat.why[0], /zu viel gezogen/);
  u = position(u, 0, onField(u, 0, 'g06'));
  assert.match(u.cheat.why.join(), /Beschwörung/);
  u = nextStep(u, 0, 'battle');
  assert.equal(attack(u, 0, onField(u, 0, 'g06'), null), null, 'aus der Verteidigung geht es auch ohne Hilfen nicht');
  let w = duel({ free: true, turnNo: 1, step: 'battle', mon: [[{ id: 'g06' }], []] });
  w = attack(w, 0, w.mon[0][0].u, null);
  assert.match(w.cheat.why[0], /ersten Zug/);
  // Der andere tut etwas → Frist vorbei, er selbst kann nicht mehr anklagen, aber die neue gilt
  let x = duel({ free: true, hands: [['g04', 'g05'], ['g06']], deck: [10, 10] });
  x = summon(x, 0, hand(x, 0, 'g04'));
  x = summon(x, 0, hand(x, 0, 'g05'));
  x = nextStep(x, 0, 'end');
  assert.equal(x.cheat.player, 0, 'Frist läuft im Zug des anderen weiter, bis er etwas tut');
  const y = draw(x, 1);
  assert.equal(y.cheat.player, 1);
  assert.equal(y.cheat.legal, true);
  assert.equal(accuse(y, 0).events[0].type, 'fehlalarm');
  assert.equal(accuse(x, 1).events[0].type, 'caught');
  assert.equal(accuse(x, 1).turn, 0, 'zurück im Zug des Schummlers');
});

test('Ohne Hilfen: moves auf der Sicht geht auch mit offener Frist (cheat nur { player })', () => {
  let s = duel({ free: true, turnNo: 1, hands: [['g04', 'g05'], []], mon: [[{ id: 'g06' }], []] });
  s = draw(s, 0); // erste Karte zu viel
  const v = viewFor(s, 0);
  const m = moves(v, 0, { strict: false });
  assert.ok(m.some((x) => x.t === 'draw'));
  assert.ok(m.some((x) => x.t === 'summon'));
  assert.ok(moves(viewFor(s, 1), 1, { strict: false }).length === 0);
});

test('Ohne Hilfen: Schummel-Sieg zurückgenommen, Revanche erst nach Anklage oder Verzicht', () => {
  let s = duel({ free: true, step: 'battle', mon: [[{ id: 'g06' }], []], lp: [LP_START, 1800] });
  s = { ...s, picks: [{ name: 'Glut', list: DECKS.glut.list }, { name: 'Tiefsee', list: DECKS.tiefsee.list }] };
  s.mon[0][0].attacked = s.turnNo; // hat schon angegriffen
  s = attack(s, 0, s.mon[0][0].u, null); // zweiter Angriff = Schummeln, gewinnt
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(s.wins, [1, 0]);
  assert.equal(s.phase, 'over');
  assert.equal(again(s, 0), null);
  const c = accuse(s, 1);
  assert.equal(c.phase, 'duel');
  assert.deepEqual(c.wins, [0, 0]);
  assert.ok(again(waive(s, 1), 0));
});

test('Computer: spielt ganze Duelle nur mit gültigen Zügen und schlägt Zufallszüge klar', async () => {
  const { chooseMove } = await import('../src/kartenduell/ai.js');
  const rng = seeded(7);
  let won = 0;
  for (let g = 0; g < 12; g++) {
    const decks = Object.keys(DECKS);
    let s = pickDeck(pickDeck(newGame({ humans: [0] }), 0, { deck: decks[g % 3] }, rng), 1, { deck: decks[(g + 1) % 3] }, rng);
    for (let k = 0; s.phase === 'duel' && k < 2000; k++) {
      const seat = s.pending ? s.pending.who : s.turn;
      const all = moves(s, seat);
      const m = seat === 0 ? chooseMove(viewFor(s, 0), 0) : all[Math.floor(rng() * all.length)];
      const next = apply(s, seat, m, rng);
      assert.ok(next, `ungültiger Zug ${JSON.stringify(m)}`);
      s = next;
    }
    assert.equal(s.phase, 'over');
    if (s.winner === 0) won++;
  }
  assert.ok(won >= 11, `nur ${won} von 12 gewonnen`);
});

test('Computer ohne Hilfen: zieht selbst, Schummelzüge sind regelwidrig und werden erwischt', async () => {
  const { chooseMove, cheatMove } = await import('../src/kartenduell/ai.js');
  let s = duel({ free: true, turn: 1, hands: [[], ['g10', 'g04']], mon: [[], []] });
  assert.deepEqual(chooseMove(viewFor(s, 1), 1), { t: 'draw' });
  s = apply(s, 1, { t: 'draw' });
  const m = cheatMove(viewFor(s, 1), 1, () => 0);
  assert.equal(m.t, 'summon');
  assert.equal(s.cards[m.u], 'g10', 'Sonnenglutdrache ohne Tribute');
  const after = apply(s, 1, m);
  assert.equal(after.cheat.legal, false);
  assert.equal(accuse(after, 0).events[0].type, 'caught');
});

test('Eigenes Deck: speichern, laden, nur bekannte Karten, spielbar erst mit 40', async () => {
  const { loadDeck, saveDeck, playable } = await import('../src/kartenduell/deck.js');
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadDeck(storage), null);
  saveDeck({ name: '  Mein   Drachen-Deck ', list: ['g10', 'xx', 'g01'] }, storage);
  const d = loadDeck(storage);
  assert.equal(d.name, 'Mein Drachen-Deck');
  assert.deepEqual(d.list, ['g01', 'g10']);
  assert.equal(playable(d), false);
  saveDeck({ name: '', list: DECKS.glut.list }, storage);
  assert.equal(playable(loadDeck(storage)), true);
  assert.equal(loadDeck(storage).name, 'Mein Deck');
  mem.set('spielesammlung-kartenduell-deck', '{kaputt');
  assert.equal(loadDeck(storage), null);
});

test('Statistik: Sieger des Duells, Host Sitz 0, Gast Sitz 1', async () => {
  const { OUTCOME, reverted } = await import('../src/results.js');
  assert.equal(OUTCOME.Kartenduell({ phase: 'duel' }), undefined);
  assert.equal(OUTCOME.Kartenduell({ phase: 'over', winner: 1 }), 1);
  assert.equal(OUTCOME.Kartenduell({ phase: 'over', winner: null }), null);
  assert.equal(reverted({ events: [{ type: 'caught' }] }), true);
});

test('Review: Falle entscheidet vor dem Kampf, Kampfschaden vor Tod-Effekten, kaputte Deckwahl, verdeckter Grund', () => {
  // Gegenschlag bringt den Angreifer auf 0 → kein Kampf mehr, der Verteidiger gewinnt
  let s = duel({ step: 'battle', mon: [[{ id: 'g10' }], []], st: [[], [{ id: 'f09' }]], lp: [1000, 2000] });
  s = attack(s, 0, s.mon[0][0].u, null);
  s = activate(s, 1, s.st[1][0].u);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 1);
  assert.equal(s.lp[1], 2000);
  // Aschefuchs fällt und hätte 500 Schaden gemacht – der Angreifer hat aber schon gewonnen
  let t = duel({ step: 'battle', mon: [[{ id: 'g06' }], [{ id: 'g03' }]], lp: [400, 300] });
  t = attack(t, 0, t.mon[0][0].u, t.mon[1][0].u);
  assert.equal(t.winner, 0);
  assert.equal(t.lp[0], 400);
  for (const deck of ['__proto__', 'constructor', 'toString', 7, null]) assert.equal(pickDeck(newGame(), 1, { deck }), null);
  // verdeckt ohne Tribute: Grund nennt keinen Namen
  let u = duel({ free: true, hands: [['g10'], []] });
  u = summon(u, 0, hand(u, 0, 'g10'), { set: true });
  assert.ok(!/Sonnenglut|Stufe/.test(accuse(u, 1).events[0].why));
  // fremde Deckwahl bleibt bis zum Austeilen geheim
  const p = pickDeck(newGame({ humans: [0, 1] }), 0, { deck: 'glut' });
  assert.deepEqual(viewFor(p, 1).picks[0], { name: '' });
});
