// Kabo (src/kabo/game.js, ai.js): Regeln (Festlegungen nach den Cambio-Volksregeln), Sichten, Gedächtnis, „Ohne Hilfen“,
// Computer und Statistik (results.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, ready, draw, place, drop, take, ability, done, kabo, sneak, accuse, waive, again, regroup, viewFor,
  valueOf, powerOf, sumOf, nextSeat, fullDeck, DECK, GOAL, LOCKED,
} from '../src/kabo/game.js';
import { chooseMove, cheatMove, estimate } from '../src/kabo/ai.js';
import { OUTCOME, reverted } from '../src/results.js';

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

// Fester Stand mitten in der Runde: Sitze 0, 1 und 2 (zu dritt), Sitz 0 ist dran, alle waren schon einmal dran
const HANDS = [['h2', 'c3', 'sK', 'd9'], ['hK', 'xr', 'c5', 'sQ'], ['d4', 'h8', 'cT', 'sA'], []];
function fixed({ hands = HANDS, free = false, turn = 0, humans = [0, 2], talon = ['c2', 'h7', 'sJ', 'd8', 'cK'], discard = ['h6'], moved = [0, 1, 2], scores = [0, 0, 0, 0] } = {}) {
  return {
    ...newGame({ humans, free }),
    phase: 'play', count: 3, seats: [0, 1, 2], round: 1, games: 1, starter: 0, turn, step: 'start',
    hands: hands.map((h) => [...h]), talon, discard, moved, scores,
  };
}

test('Kartenwerte und Fähigkeiten: Joker 0, roter König −1, Ass 1, Bilder 10; 7/8 eigene, 9/10 fremde, B/D tauschen, schwarzer König', () => {
  assert.deepEqual(['xr', 'xb', 'hK', 'dK', 'sK', 'cK', 'hA', 'h2', 'h9', 'hT', 'hJ', 'hQ'].map(valueOf), [0, 0, -1, -1, 10, 10, 1, 2, 9, 10, 10, 10]);
  assert.deepEqual(['h7', 'c8', 'd9', 'sT', 'hJ', 'cQ', 'sK', 'hK', 'h6', 'xr', 'hA'].map(powerOf), ['own', 'own', 'other', 'other', 'swap', 'swap', 'king', null, null, null, null]);
  assert.equal(fullDeck().length, DECK);
  assert.equal(new Set(fullDeck()).size, DECK);
  assert.equal(fullDeck().reduce((sum, c) => sum + valueOf(c), 0), 318);
  assert.equal(sumOf(['hK', 'dK', 'xr', 'xb']), -2);
});

test('Austeilen: je 4 Karten, eine offen auf die Ablage, der Rest ist der Stapel; erst nahe Karten ansehen', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 15; seed++) {
      const s = setup(newGame({ humans: [0, 2] }), 0, n, seeded(seed));
      assert.equal(s.phase, 'peek');
      assert.ok(s.seats.includes(s.starter));
      const all = [...s.seats.flatMap((p) => s.hands[p]), ...s.discard, ...s.talon];
      assert.equal(all.length, DECK);
      assert.equal(new Set(all).size, DECK);
      for (const p of s.seats) assert.equal(s.hands[p].length, 4);
      assert.equal(s.discard.length, 1);
      assert.equal(s.talon.length, DECK - 4 * n - 1);
      assert.deepEqual(s.ready, s.seats.filter((p) => p !== 0 && p !== 2)); // der Computer ist gleich so weit
    }
  }
  assert.equal(setup(newGame(), 2, 3), null);
  assert.equal(setup(newGame(), 0, 5), null);
});

test('Ansehen zu Beginn: nur die eigenen nahen Karten, bis „Gesehen“ – dann zählt das Gedächtnis', () => {
  let s = setup(newGame({ humans: [0, 2] }), 0, 3, seeded(9));
  const v = viewFor(s, 0);
  assert.deepEqual(v.hands[0], [s.hands[0][0], s.hands[0][1], null, null]);
  assert.deepEqual(v.hands[2], [null, null, null, null]);
  assert.deepEqual(v.hands[1], [null, null, null, null]);
  assert.equal(v.seen, null); // Menschen bekommen kein Gedächtnis angezeigt
  assert.deepEqual(viewFor(s, 1).seen[1], [s.hands[1][0], s.hands[1][1], null, null]); // der Computer merkt sich
  assert.equal(draw(s, s.starter), null);
  s = ready(s, 0);
  assert.equal(s.phase, 'peek');
  assert.deepEqual(viewFor(s, 0).hands[0], [null, null, null, null]);
  assert.equal(ready(s, 0), null);
  s = ready(s, 2);
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, s.starter);
  assert.equal(s.step, 'start');
});

test('Ziehen und tauschen: die alte Karte kommt offen auf die Ablage, nur der Ziehende sieht die gezogene', () => {
  let s = draw(fixed(), 0);
  assert.equal(s.drawn, 'cK');
  assert.equal(s.step, 'drawn');
  assert.equal(viewFor(s, 0).drawn, 'cK');
  assert.equal(viewFor(s, 2).drawn, '??');
  assert.equal(viewFor(s, 0).talon, 4);
  assert.equal(place(s, 1, 0), null);
  s = place(s, 0, 2);
  assert.deepEqual(s.hands[0], ['h2', 'c3', 'cK', 'd9']);
  assert.deepEqual(s.discard, ['h6', 'sK']);
  assert.equal(s.turn, 1);
  assert.equal(s.step, 'start');
  assert.equal(s.seen[0][0][2], 'cK'); // er weiß, was er hingelegt hat
  assert.equal(s.seen[1][0][2], null);
});

test('Ziehen und ablegen: Karte ohne Fähigkeit → der Nächste; mit Fähigkeit → ansehen, tauschen oder auslassen', () => {
  let s = drop(draw(fixed({ talon: ['h5'] }), 0), 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.discard, ['h6', 'h5']);
  // 7: eigene Karte ansehen
  s = drop(draw(fixed({ talon: ['h7'] }), 0), 0);
  assert.equal(s.step, 'power');
  assert.equal(s.power, 'own');
  assert.equal(ability(s, 0, { kind: 'other', other: { p: 1, i: 0 } }), null); // passt nicht zur 7
  const look = ability(s, 0, { kind: 'own', own: 3 });
  assert.equal(look.step, 'look');
  assert.deepEqual(viewFor(look, 0).hands[0], [null, null, null, 'd9']);
  assert.deepEqual(viewFor(look, 2).hands[0], [null, null, null, null]); // der andere sieht nur, dass angesehen wird
  assert.deepEqual(viewFor(look, 2).look, { seat: 0, kind: 'own', spots: [{ p: 0, i: 3 }] });
  assert.equal(look.seen[0][0][3], 'd9');
  const on = done(look, 0);
  assert.equal(on.turn, 1);
  assert.deepEqual(viewFor(on, 0).hands[0], [null, null, null, null]);
  // auslassen geht immer
  assert.equal(done(s, 0).turn, 1);
  // 10: fremde Karte ansehen
  const ten = ability(drop(draw(fixed({ talon: ['sT'] }), 0), 0), 0, { kind: 'other', other: { p: 2, i: 1 } });
  assert.deepEqual(viewFor(ten, 0).hands[2], [null, 'h8', null, null]);
  assert.equal(ability(drop(draw(fixed({ talon: ['sT'] }), 0), 0), 0, { kind: 'other', other: { p: 0, i: 1 } }), null); // nicht die eigene
});

test('Bube/Dame: blind tauschen – wer etwas wusste, weiß es am neuen Platz; schwarzer König: ansehen, dann wahlweise tauschen', () => {
  let s = { ...drop(draw(fixed({ talon: ['hQ'] }), 0), 0) };
  s.seen = s.seen.map((x) => x.map((h) => [...h]));
  s.seen[1][0][0] = 'h2';
  const sw = ability(s, 0, { kind: 'swap', own: 0, other: { p: 1, i: 1 } });
  assert.deepEqual(sw.hands[0], ['xr', 'c3', 'sK', 'd9']);
  assert.deepEqual(sw.hands[1], ['hK', 'h2', 'c5', 'sQ']);
  assert.equal(sw.seen[1][1][1], 'h2');
  assert.equal(sw.seen[1][0][0], null);
  assert.equal(sw.turn, 1);
  // König
  const k = drop(draw(fixed({ talon: ['cK'] }), 0), 0);
  assert.equal(k.power, 'king');
  const look = ability(k, 0, { kind: 'king', own: 2, other: { p: 1, i: 1 } });
  assert.deepEqual(viewFor(look, 0).hands[0], [null, null, 'sK', null]);
  assert.deepEqual(viewFor(look, 0).hands[1], [null, 'xr', null, null]);
  assert.equal(done(look, 0, true).hands[0][2], 'xr');
  assert.equal(done(look, 0, false).hands[0][2], 'sK');
  // nach 7/8 gibt es kein Tauschen
  assert.equal(done(ability(drop(draw(fixed({ talon: ['h8'] }), 0), 0), 0, { kind: 'own', own: 1 }), 0, true), null);
});

test('Ablage nehmen: muss gegen eine eigene getauscht werden, keine Fähigkeit; alle wissen, was dort liegt', () => {
  const s = take(fixed({ discard: ['c4', 'hJ'] }), 0, 2);
  assert.deepEqual(s.hands[0], ['h2', 'c3', 'hJ', 'd9']);
  assert.deepEqual(s.discard, ['c4', 'sK']);
  assert.equal(s.turn, 1);
  assert.equal(s.seen[2][0][2], 'hJ');
  assert.equal(take(fixed(), 0, 4), null);
});

test('Stapel leer: die Ablage ohne die oberste Karte wird gemischt', () => {
  const s = draw(fixed({ talon: [], discard: ['c2', 'h7', 'sJ', 'd8'] }), 0, seeded(3));
  assert.equal(s.events[0].type, 'mixed');
  assert.deepEqual(s.discard, ['d8']);
  assert.equal(s.talon.length, 2);
  assert.equal(new Set([...s.talon, s.drawn]).size, 3);
});

test('„Kabo!“: erst wenn jeder dran war; danach hat jeder andere genau einen Zug, die Karten des Rufers sind gesperrt', () => {
  assert.equal(kabo(fixed({ moved: [1, 2] }), 0), null);
  let s = kabo(fixed(), 0);
  assert.equal(s.caller, 0);
  assert.equal(s.turn, 1);
  // gesperrt: blind tauschen mit dem Rufer geht nicht, ansehen schon
  const q = drop(draw({ ...s, talon: ['sQ'] }, 1), 1);
  assert.equal(ability(q, 1, { kind: 'swap', own: 0, other: { p: 0, i: 0 } }), null);
  assert.ok(ability(q, 1, { kind: 'swap', own: 0, other: { p: 2, i: 0 } }));
  const k = ability(drop(draw({ ...s, talon: ['sK'] }, 1), 1), 1, { kind: 'king', own: 0, other: { p: 0, i: 0 } });
  assert.ok(k);
  assert.equal(done(k, 1, true), null);
  assert.equal(kabo(s, 1), null); // nur einmal je Runde
  s = done(q, 1);
  assert.equal(s.turn, 2);
  s = place(draw(s, 2), 2, 3);
  assert.equal(s.phase, 'over');
  assert.equal(s.result.caller, 0);
});

// Zug ohne Wirkung: eine 6 ziehen und ablegen (ohne Hilfen danach „Fertig“)
function pass(s, seat) {
  const t = drop(draw({ ...s, talon: [...s.talon, 'h6'] }, seat), seat);
  return t.step === 'power' ? done(t, seat) : t;
}

test('Wertung: Rufer allein am niedrigsten = 0, sonst Summe + 10; die anderen schreiben ihre Summe; ab 100 ist Schluss', () => {
  // Sitz 0: 2+3+10+9 = 24, Sitz 1: −1+0+5+10 = 14, Sitz 2: 4+8+10+1 = 23
  const s = pass(pass(kabo(fixed({ turn: 1 }), 1), 2), 0);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result.sums.slice(0, 3), [24, 14, 23]);
  assert.equal(s.result.alone, true);
  assert.deepEqual(s.result.points.slice(0, 3), [24, 0, 23]);
  assert.deepEqual(s.scores.slice(0, 3), [24, 0, 23]);
  assert.equal(s.done, false);
  assert.deepEqual(viewFor(s, 0).hands[1], HANDS[1]); // alles offen
  // Rufer nicht allein am niedrigsten: Summe + 10
  const t = pass(pass(kabo(fixed({ turn: 2 }), 2), 0), 1);
  assert.equal(t.phase, 'over');
  assert.equal(t.result.alone, false);
  assert.equal(t.result.points[2], 33);
  // Gleichstand ganz unten zählt nicht als allein
  const tie = fixed({ hands: [['h2', 'h3', 'h4', 'h5'], ['c2', 'c3', 'c4', 'c5'], ['sK', 'sQ', 'sJ', 'sT'], []], turn: 1 });
  const u = pass(pass(kabo(tie, 1), 2), 0);
  assert.equal(u.result.alone, false);
  assert.equal(u.result.points[1], 24);
  // bis 100: niedrigster Stand gewinnt, Gleichstand = mehrere Sieger
  const end = pass(pass(kabo(fixed({ turn: 1, scores: [70, 80, 90, 0] }), 1), 2), 0);
  assert.equal(end.done, true);
  assert.deepEqual(end.scores.slice(0, 3), [94, 80, 113]);
  assert.equal(end.winner, 1);
  assert.equal(OUTCOME.Kabo(end), 0); // Host 94 vor Gast 113
  const even = pass(pass(kabo(fixed({ turn: 1, scores: [72, 96, 77, 0] }), 1), 2), 0);
  assert.deepEqual(even.scores.slice(0, 3), [96, 96, 100]);
  assert.deepEqual(even.winners, [0, 1]);
  assert.equal(even.winner, null);
  assert.equal(GOAL, 100);
});

test('Nächste Runde: der Nächste fängt an; nach dem Ende eine neue Partie mit 0 Punkten', () => {
  const s = pass(pass(kabo(fixed(), 0), 1), 2);
  assert.equal(s.phase, 'over');
  const n = again(s, 0, seeded(1));
  assert.equal(n.phase, 'peek');
  assert.equal(n.starter, nextSeat(s, 0));
  assert.equal(n.round, 2);
  const fresh = again({ ...s, done: true }, 2, seeded(2));
  assert.equal(fresh.games, 2);
  assert.deepEqual(fresh.scores, [0, 0, 0, 0]);
  assert.equal(regroup(s, 2), null);
  assert.equal(regroup(s, 0).phase, 'setup');
});

test('Sicht: Stapel nur als Anzahl, Ablage offen, Gedächtnis nur für den Computer, am Ende alles offen', () => {
  const s = fixed({ humans: [0] });
  const v = viewFor(s, 0);
  assert.equal(v.talon, 5);
  assert.deepEqual(v.discard, ['h6']);
  assert.equal(v.seen, null);
  assert.ok(Array.isArray(viewFor(s, 2).seen)); // Sitz 2 ist hier ein Computer
  const over = { ...s, phase: 'over' };
  assert.deepEqual(viewFor(over, 2).hands[0], HANDS[0]);
});

test('Ohne Hilfen: Fähigkeit ohne passende Karte – „Geschummelt!“: Zug zurück, setzt aus, +10 Punkte', () => {
  let s = draw(fixed({ free: true, talon: ['h5'] }), 0);
  s = place(s, 0, 2); // tauschen – ohne Hilfen kommt trotzdem der Schritt „Fähigkeit“
  assert.equal(s.step, 'power');
  assert.equal(s.power, null);
  s = ability(s, 0, { kind: 'swap', own: 2, other: { p: 1, i: 1 } });
  assert.ok(s);
  assert.equal(s.turn, 1);
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(viewFor(s, 2).cheat, { player: 0 });
  const caught = accuse(s, 2);
  assert.equal(caught.events[0].type, 'caught');
  assert.match(caught.events[0].why, /ohne passende Karte blind getauscht/);
  assert.deepEqual(caught.hands[0], HANDS[0]); // alles zurück
  assert.deepEqual(caught.hands[1], HANDS[1]);
  assert.equal(caught.talon.length, 1);
  assert.equal(caught.turn, 1); // er setzt den Zug aus
  assert.equal(caught.fines[0], 10);
  assert.equal(reverted(caught), true);
  assert.equal(accuse(caught, 2), null);
  // normale 7 ohne Hilfen: kein Schummeln
  const ok = ability(drop(draw(fixed({ free: true, talon: ['h7'] }), 0), 0), 0, { kind: 'own', own: 2 });
  assert.equal(ok.cheat.legal, true);
  // nach dem schwarzen König nur eine Karte ansehen ist weniger als erlaubt – kein Schummeln
  const less = ability(drop(draw(fixed({ free: true, talon: ['cK'] }), 0), 0), 0, { kind: 'other', other: { p: 1, i: 0 } });
  assert.equal(less.cheat.legal, true);
});

test('Ohne Hilfen: Fehlalarm kostet den Ankläger 5 Punkte; anfechtbar nur, bis ein anderer etwas tut', () => {
  let s = place(draw(fixed({ free: true }), 0), 0, 1);
  s = done(s, 0);
  const alarm = accuse(s, 1);
  assert.equal(alarm.events[0].type, 'fehlalarm');
  assert.equal(alarm.fines[1], 5);
  assert.equal(alarm.cheat, null);
  assert.equal(reverted(alarm), false);
  const on = draw(s, 1);
  assert.equal(accuse(on, 2, 0), null); // der Zug von Sitz 0 ist nicht mehr anfechtbar
  // Strafen zählen am Rundenende mit
  const end = pass({ ...alarm, caller: 2 }, 1);
  assert.equal(end.phase, 'over');
  assert.equal(end.result.points[1], 14 + 5);
});

test('Ohne Hilfen: heimlich ansehen sieht nur der Schummler; zu früh „Kabo!“; gesperrte Karte tauschen', () => {
  const s = fixed({ free: true, moved: [] });
  const peek = sneak(s, 0, { p: 1, i: 2 });
  assert.equal(viewFor(peek, 0).hands[1][2], 'c5');
  assert.equal(viewFor(peek, 2).hands[1][2], null);
  assert.equal(viewFor(peek, 2).events.length, 0); // der andere sieht nichts davon
  assert.equal(peek.cheat, null); // anfechtbar erst, wenn sein Zug sichtbar beginnt (siehe unten)
  assert.equal(sneak(fixed(), 0, { p: 1, i: 2 }), null); // nur ohne Hilfen
  assert.equal(sneak(s, 1, { p: 0, i: 0 }), null); // nur im eigenen Zug
  const after = draw(peek, 0);
  assert.equal(viewFor(after, 0).hands[1][2], null); // beim nächsten Schritt wieder verdeckt
  const caught = accuse(after, 1);
  assert.match(caught.events[0].why, /heimlich/);
  assert.equal(caught.turn, 1);
  // zu früh Kabo
  const early = kabo(s, 0);
  assert.equal(early.caller, 0);
  assert.match(accuse(early, 2).events[0].why, /bevor jeder/);
  assert.equal(accuse(early, 2).caller, null);
  // gesperrt
  let k = kabo(fixed({ free: true }), 0);
  k = ability(drop(draw({ ...k, talon: ['hJ'] }, 1), 1), 1, { kind: 'swap', own: 0, other: { p: 0, i: 0 } });
  assert.equal(k.cheat.why[0], LOCKED);
  const back = accuse(k, 2);
  assert.deepEqual(back.hands[0], HANDS[0]);
  assert.equal(back.turn, 2);
  assert.equal(back.caller, 0);
});

test('Ohne Hilfen: heimlich ansehen zu Zugbeginn verrät sich nicht über „Geschummelt!“ – der Zug davor bleibt anfechtbar', () => {
  const s = pass(fixed({ free: true, turn: 2 }), 2); // Sitz 2 hat gespielt, jetzt ist Sitz 0 dran
  assert.equal(s.turn, 0);
  assert.deepEqual(viewFor(s, 2).cheat, { player: 2 });
  const peek = sneak(s, 0, { p: 1, i: 2 });
  const twice = sneak(peek, 0, { p: 1, i: 3 });
  for (const x of [peek, twice]) {
    assert.deepEqual(viewFor(x, 2).cheat, { player: 2 }); // für den anderen hat sich nichts geändert
    assert.deepEqual(viewFor(x, 1).cheat, { player: 2 });
    assert.equal(accuse(x, 1, 2).events[0].type, 'fehlalarm'); // Sitz 2 ist noch anfechtbar
  }
  // sobald er sichtbar handelt, gehört das heimliche Ansehen zu seinem Zug
  const on = draw(twice, 0);
  assert.deepEqual(viewFor(on, 2).cheat, { player: 0 });
  assert.match(accuse(on, 2).events[0].why, /heimlich/);
  // auch nach einem Fehlalarm gegen den Zug davor
  const alarm = accuse(peek, 1, 2);
  assert.equal(accuse(draw(alarm, 0), 1).events[0].type, 'caught');
  // mitten im Zug heimlich ansehen: gleich anfechtbar
  const mid = sneak(draw(s, 0), 0, { p: 2, i: 0 });
  assert.equal(mid.cheat.legal, false);
  assert.equal(accuse(mid, 1).events[0].type, 'caught');
});

test('Ohne Hilfen: Schummeln im letzten Zug – erwischt nach dem Rundenende rollt die Wertung zurück', () => {
  let s = pass(kabo(fixed({ free: true, turn: 1 }), 1), 2);
  s = sneak(s, 0, { p: 1, i: 0 });
  s = done(place(draw({ ...s, talon: ['h5'] }, 0), 0, 2), 0);
  assert.equal(s.phase, 'over');
  assert.equal(again(s, 0), null); // der Schummler startet die nächste Runde nicht
  const caught = accuse(s, 2);
  assert.equal(caught.phase, 'over'); // Zug ausgesetzt – dann ist der Rufer wieder dran: aufdecken
  assert.equal(caught.hands[0][2], 'sK');
  assert.equal(caught.result.points[0], 24 + 10);
  assert.equal(caught.scores[0], 34);
  // Fehlalarm nach dem Ende: 5 gleich auf den Stand
  const fair = pass(pass(kabo(fixed({ free: true, turn: 1 }), 1), 2), 0);
  const alarm = accuse(fair, 1);
  assert.equal(alarm.scores[1], fair.scores[1] + 5);
  assert.ok(waive(fair, 1).cheat === null);
});

test('Computer: tauscht hohe gegen niedrige, nimmt gute Ablage, nutzt Fähigkeiten, ruft Kabo mit wenig', () => {
  const s = fixed({ humans: [0] });
  // Sitz 1 kennt seine Karten: −1, 0, 5, 10 → Summe 14
  const known = { ...s, turn: 1, seen: s.seen.map((x, p) => (p === 1 ? x.map((h, q) => (q === 1 ? [...HANDS[1]] : [...h])) : x)) };
  assert.equal(estimate(viewFor(known, 1), 1, 1), 14);
  assert.deepEqual(chooseMove(viewFor({ ...known, discard: ['h2'] }, 1), 1), { t: 'take', arg: 3 });
  assert.deepEqual(chooseMove(viewFor(known, 1), 1), { t: 'draw' });
  const d = draw({ ...known, talon: ['h3'] }, 1);
  assert.deepEqual(chooseMove(viewFor(d, 1), 1), { t: 'place', arg: 3 });
  const hi = draw({ ...known, talon: ['h9'] }, 1);
  assert.deepEqual(chooseMove(viewFor(hi, 1), 1), { t: 'drop' });
  const nine = drop(hi, 1);
  const m = chooseMove(viewFor(nine, 1), 1);
  assert.equal(m.t, 'ability');
  assert.equal(m.arg.kind, 'other');
  // Kabo mit niedriger Summe
  const low = { ...known, hands: [HANDS[0], ['hK', 'xr', 'c2', 'sA'], HANDS[2], []] };
  low.seen = low.seen.map((x, p) => (p === 1 ? x.map((h, q) => (q === 1 ? ['hK', 'xr', 'c2', 'sA'] : h)) : x));
  assert.deepEqual(chooseMove(viewFor(low, 1), 1), { t: 'kabo' });
  assert.notDeepEqual(chooseMove(viewFor({ ...low, moved: [1] }, 1), 1), { t: 'kabo' }); // noch nicht jeder war dran
  // ohne Hilfen schummelt er: zu früh Kabo oder heimlich ansehen
  const sly = cheatMove(viewFor({ ...low, free: true, moved: [1] }, 1), 1, () => 0);
  assert.deepEqual(sly, { t: 'kabo' });
  assert.equal(cheatMove(viewFor(known, 1), 1), null); // nur ohne Hilfen
});

// Ganze Partie Computer gegen Computer; ohne Hilfen schummeln sie ab und zu und rufen manchmal „Geschummelt!“
function playOut(n, free, seed) {
  const rng = seeded(seed);
  let s = setup(newGame({ humans: [0, 2], free }), 0, n, rng);
  let steps = 0;
  let rounds = 0;
  while (!s.done) {
    assert.ok(++steps < 20000, 'Partie endet nicht');
    if (s.phase === 'over') {
      rounds++;
      s = again(s, s.cheat ? s.seats.find((p) => p !== s.cheat.player) : 0, rng);
      assert.ok(s);
      continue;
    }
    if (s.phase === 'peek') {
      s = ready(s, s.seats.find((p) => !s.ready.includes(p)));
      continue;
    }
    if (free && s.cheat && rng() < 0.1) {
      const by = s.seats.find((p) => p !== s.cheat.player);
      const next = accuse(s, by);
      assert.ok(next);
      s = next;
      continue;
    }
    const seat = s.turn;
    const v = { ...viewFor(s, seat), seen: s.seen[seat] }; // hier spielt der Computer auch die Sitze der Menschen
    const m = (free && rng() < 0.15 && cheatMove(v, seat, rng)) || chooseMove(v, seat);
    const next = act(s, seat, m, rng);
    assert.ok(next, `ungültig: ${JSON.stringify(m)} in ${s.step}`);
    s = next;
    if (s.phase === 'play' || s.phase === 'over') {
      const cards = [...s.seats.flatMap((p) => s.hands[p]), ...s.discard, ...s.talon, ...(s.drawn ? [s.drawn] : [])];
      assert.equal(cards.length, DECK);
      assert.equal(new Set(cards).size, DECK);
    }
  }
  return { s, rounds };
}

function act(s, seat, m, rng) {
  if (m.t === 'ready') return ready(s, seat);
  if (m.t === 'draw') return draw(s, seat, rng);
  if (m.t === 'take') return take(s, seat, m.arg);
  if (m.t === 'place') return place(s, seat, m.arg);
  if (m.t === 'drop') return drop(s, seat);
  if (m.t === 'ability') return ability(s, seat, m.arg);
  if (m.t === 'done') return done(s, seat, m.arg);
  if (m.t === 'kabo') return kabo(s, seat);
  if (m.t === 'sneak') return sneak(s, seat, m.arg);
  return null;
}

test('Computer-Partien zu 2, 3 und 4 laufen bis 100 – mit und ohne Hilfen, jede Aktion gültig', () => {
  const stats = { rounds: 0, games: 0, alone: 0, calls: 0 };
  for (const n of [2, 3, 4]) {
    for (const free of [false, true]) {
      for (let seed = 1; seed <= 10; seed++) {
        const { s, rounds } = playOut(n, free, seed * 17 + n);
        assert.ok(rounds >= 1, `${n}: nur eine Runde`); // die letzte Runde zählt hier nicht mit
        assert.ok(s.seats.some((p) => s.scores[p] >= GOAL));
        assert.ok(s.winners.length >= 1);
        assert.ok([0, 1, null].includes(OUTCOME.Kabo(s)));
        stats.rounds += rounds;
        stats.games++;
      }
    }
  }
  assert.ok(stats.rounds / stats.games < 30, `zu lange Partien: ${stats.rounds / stats.games}`);
});

test('Statistik: weniger Punkte gewinnt (Host Sitz 0, Gast humans[1]); gleich = Remis; läuft = undefined', () => {
  const base = { done: true, humans: [0, 2] };
  assert.equal(OUTCOME.Kabo({ ...base, done: false, scores: [10, 0, 20, 0] }), undefined);
  assert.equal(OUTCOME.Kabo({ ...base, scores: [40, 0, 101, 0] }), 0);
  assert.equal(OUTCOME.Kabo({ ...base, scores: [104, 3, 60, 0] }), 1);
  assert.equal(OUTCOME.Kabo({ ...base, scores: [50, 3, 50, 100] }), null);
});

// Ablauf in index.js (ohne Browser): allein, normal und ohne Hilfen – der Computer spielt seine Züge, prüft allein ohne
// Hilfen jeden Zug des Menschen einmal, und die Runde läuft bis zum Ende weiter.
test('index.js allein: Mensch und Computer spielen eine Runde bis zum Aufdecken – auch ohne Hilfen mit Heimlich-Ansehen', async (t) => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startKabo } = await import('../src/kabo/index.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const free of [false, true]) {
    const g = startKabo({ ...io, me: 0, level: 1, free });
    ui.panel.onSetup(2);
    assert.equal(g.view().phase, 'peek');
    assert.equal(g.view().hands[0].filter(Boolean).length, 2); // die nahen Karten sind offen
    ui.panel.onReady();
    assert.equal(g.view().phase, 'play');
    for (let k = 0; k < 400 && g.view().phase === 'play'; k++) {
      const v = g.view();
      if (v.turn === 0) {
        if (v.step === 'start' && free && !v.secret && k < 50) ui.panel.onSneak();
        if (v.step === 'start') (v.caller == null && v.seats.every((p) => v.moved.includes(p)) && k > 20 ? ui.panel.onKabo : ui.panel.onDraw)();
        else if (v.step === 'drawn') ui.panel.onDrop();
        else if (v.step === 'power') ui.panel.onSkip();
        else if (v.step === 'look') ui.panel.onSeen();
      }
      t.mock.timers.tick(500);
    }
    for (let i = 0; i < 40; i++) t.mock.timers.tick(500);
    assert.equal(g.view().phase, 'over', `Runde vorbei (${free ? 'ohne Hilfen' : 'normal'})`);
    assert.ok(ui.shown.end);
    if (free) assert.notEqual(g.view().cheat?.player, 0, 'der Computer hat den Zug des Menschen geprüft');
    ui.panel.onAgain();
    assert.equal(g.view().phase, 'peek', 'die nächste Runde beginnt');
    g.stop();
  }
});

// Gast (index.js): „Geschummelt!“ mitten im Zug des Computers – kommt vorher dessen nächster Schritt an, ist das noch
// nicht die Antwort. Früher stand dann kurz „Zu spät …“, obwohl das Urteil noch folgte.
test('index.js Gast: „Geschummelt!“ – ein Zwischenstand desselben Zugs zeigt nicht „Zu spät …“, das Urteil kommt danach', async (t) => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startKabo } = await import('../src/kabo/index.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [];
  const g = startKabo({ ...io, me: 2, send: (m) => sent.push(m) });
  const host = (s) => g.handle({ t: 'state', state: viewFor(s, 2) });
  // Computer (Sitz 1) zieht – Sitz 2 ruft „Geschummelt!“, der Host schickt aber erst den nächsten Schritt (ablegen)
  const drawn = draw(fixed({ free: true, turn: 1 }), 1);
  host(drawn);
  ui.cheat.onAccuse();
  assert.deepEqual(sent.at(-1), { t: 'accuse', arg: 1 });
  const dropped = drop(drawn, 1);
  host(dropped);
  assert.notEqual(ui.shown.hint, 'Zu spät – inzwischen hat ein anderer gespielt.');
  host(accuse(dropped, 2, 1)); // jetzt die Antwort: Fehlalarm
  assert.equal(g.view().events[0].type, 'fehlalarm');
  assert.equal(ui.shown.hint, '');
  assert.notEqual(ui.shown.status, 'Wird gesendet …');
  // Wirklich zu spät: inzwischen hat ein anderer gespielt (neuer Zug), danach kommt der unveränderte Stand zurück
  const next = done(accuse(dropped, 2, 1), 1); // Computer lässt die Fähigkeit aus, Sitz 2 ist dran …
  const own = draw(next, 2); // … und hat schon gezogen
  host(drop(draw(fixed({ free: true, turn: 1 }), 1), 1));
  ui.cheat.onAccuse();
  host(own);
  assert.equal(ui.shown.hint, 'Zu spät – inzwischen hat ein anderer gespielt.');
  host(own); // Antwort auf den ungültigen Wunsch: derselbe Stand
  assert.notEqual(ui.shown.status, 'Wird gesendet …');
  g.stop();
});

test('index.js: Rundenende mit negativer Summe zeigt „-2 → -2“, nicht „+-2“', async (t) => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startKabo } = await import('../src/kabo/index.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = startKabo({ ...io, me: 2, send: () => {} });
  const s = pass(pass(kabo(fixed({ hands: [HANDS[0], HANDS[1], ['hK', 'dK', 'xr', 'xb'], []], turn: 1 }), 1), 2), 0);
  assert.equal(s.result.points[2], -2);
  g.handle({ t: 'state', state: viewFor(s, 2) });
  assert.deepEqual(ui.shown.players.map((x) => x.note), ['-2 → -2', '24 → +24', 'Kabo 14 → +24']);
  g.stop();
});
