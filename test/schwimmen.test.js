// Schwimmen (src/schwimmen/game.js, ai.js): Regeln nach de.wikipedia „Schwimmen (Kartenspiel)“, Sichten, „Ohne Hilfen“,
// Computer und Statistik (results.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, choose, swap, push, knock, claim, accuse, waive, again, regroup, viewFor, points, pointsName, valueOf,
  active, nextActive, LIVES, HALF, FEUER,
} from '../src/schwimmen/game.js';
import { chooseMove, cheatMove, lateSwap, options, best } from '../src/schwimmen/ai.js';
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

// Fester Stand mitten in der Runde: Sitze 0, 1 und 2 (zu dritt), Sitz 0 ist dran
function fixed({ hands, middle = ['d7', 'd8', 'd9'], free = false, talon = ['c7', 'c8', 'c9', 'cT', 'cJ', 'cQ'], turn = 0, lives = [3, 3, 3, 0], humans = [0, 2] } = {}) {
  return {
    ...newGame({ humans, free }),
    phase: 'play', count: 3, seats: [0, 1, 2], lives, round: 1, games: 1, dealer: 2, turn,
    hands: [...hands, []], middle, talon, discard: [],
  };
}

test('Kartenwerte und Punkte: höchste Farbe, drei Gleiche 30½, drei Asse Feuer', () => {
  assert.deepEqual(['hA', 'hK', 'hT', 'hJ', 'hQ', 'h9', 'h8', 'h7'].map(valueOf), [11, 10, 10, 10, 10, 9, 8, 7]);
  assert.equal(points(['hA', 'hK', 'hQ']), 31);
  assert.equal(points(['hA', 'hK', 'sT']), 21);
  assert.equal(points(['h7', 's8', 'c9']), 9);
  assert.equal(points(['h7', 'h8', 'c9']), 15);
  assert.equal(points(['h7', 's7', 'c7']), HALF);
  assert.equal(points(['hK', 'sK', 'cK']), HALF);
  assert.equal(points(['hA', 'sA', 'cA']), FEUER);
  assert.equal(pointsName(HALF), '30½');
  assert.equal(pointsName(FEUER), 'Feuer');
  assert.equal(pointsName(27), '27');
});

test('Austeilen: je 3 Karten, der Geber einen zweiten Satz, Rest verdeckt; der Geber entscheidet zuerst', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 20; seed++) {
      const s = setup(newGame(), 0, n, seeded(seed));
      assert.equal(s.phase, 'choose');
      assert.equal(s.turn, s.dealer);
      assert.ok(s.seats.includes(s.dealer));
      const all = [...s.seats.flatMap((p) => s.hands[p]), ...s.spare, ...s.talon];
      assert.equal(all.length, 32);
      assert.equal(new Set(all).size, 32);
      for (const p of s.seats) assert.equal(s.hands[p].length, 3);
      assert.equal(s.spare.length, 3);
      assert.equal(s.talon.length, 32 - 3 * n - 3);
      assert.deepEqual(s.lives.filter((x, p) => s.seats.includes(p)), new Array(n).fill(LIVES));
    }
  }
  assert.equal(setup(newGame(), 2, 3), null); // nur der Host wählt
  assert.equal(setup(newGame(), 0, 5), null);
});

test('Geber behält: zweiter Satz offen in die Mitte · Geber nimmt den zweiten: erster Satz offen in die Mitte; Vorhand beginnt', () => {
  let s = setup(newGame(), 0, 4, seeded(3));
  s = { ...s, hands: [['h7', 's8', 'c9'], ['h8', 's9', 'cT'], ['h9', 'sT', 'cJ'], ['hT', 'sJ', 'cQ']], spare: ['d7', 'd8', 'd9'], dealer: 1, turn: 1 };
  assert.equal(choose(s, 0, true), null); // nur der Geber
  const keep = choose(s, 1, true);
  assert.deepEqual(keep.middle, ['d7', 'd8', 'd9']);
  assert.deepEqual(keep.hands[1], ['h8', 's9', 'cT']);
  assert.equal(keep.turn, 2);
  assert.equal(keep.phase, 'play');
  const other = choose(s, 1, false);
  assert.deepEqual(other.middle, ['h8', 's9', 'cT']);
  assert.deepEqual(other.hands[1], ['d7', 'd8', 'd9']);
  assert.equal(viewFor(other, 0).spare, 0);
});

test('31 gleich nach dem Geben: Runde sofort vorbei – auch beim Geber, Feuer geht vor', () => {
  let s = setup(newGame(), 0, 3, seeded(5));
  s = { ...s, hands: [['hA', 'hK', 'hQ'], ['h7', 's8', 'c9'], ['dA', 'sA', 'cA'], []], spare: ['d7', 'd8', 'd9'], dealer: 1, turn: 1 };
  const over = choose(s, 1, true);
  assert.equal(over.phase, 'over');
  assert.equal(over.result.reason, 'show');
  assert.equal(over.result.feuer, 2);
  assert.deepEqual(over.result.losers, [0, 1]); // Feuer: alle anderen verlieren
  assert.deepEqual([over.lives[0], over.lives[1], over.lives[2]], [2, 2, 3]);
});

test('Tauschen: eine oder alle drei Karten, nie zwei; nur wer dran ist', () => {
  const s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']] });
  assert.equal(swap(s, 1, ['c7'], ['d7']), null); // nicht dran
  assert.equal(swap(s, 0, ['hA', 'hK'], ['d7', 'd8']), null); // zwei gehen nicht
  assert.equal(swap(s, 0, ['hA'], ['c7']), null); // nicht in der Mitte
  const one = swap(s, 0, ['s7'], ['d9']);
  assert.deepEqual(one.hands[0], ['hA', 'hK', 'd9']);
  assert.deepEqual(one.middle, ['d7', 'd8', 's7']); // die abgegebene Karte liegt am Platz der genommenen
  assert.equal(one.turn, 1);
  const all = swap(s, 0, ['hA', 'hK', 's7'], ['d7', 'd8', 'd9']);
  assert.deepEqual(all.hands[0], ['d7', 'd8', 'd9']);
  assert.deepEqual(all.middle, ['hA', 'hK', 's7']);
});

test('Tausch zu 31 beendet die Runde sofort; wer am wenigsten hat, verliert ein Leben', () => {
  const s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], middle: ['d7', 'hQ', 'd9'] });
  const over = swap(s, 0, ['s7'], ['hQ']);
  assert.equal(over.phase, 'over');
  assert.equal(over.result.reason, 'show');
  assert.deepEqual(over.result.points.slice(0, 3), [31, 15, 15]);
  assert.deepEqual(over.result.losers, [1, 2]); // Gleichstand ganz unten: beide verlieren
  assert.equal(over.turn, null);
  assert.deepEqual(viewFor(over, 1).hands[0], ['hA', 'hK', 'hQ']); // nach der Runde alles offen
});

test('Schieben: haben alle hintereinander geschoben, kommt eine neue Mitte – wer zuerst schob, ist wieder dran', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], turn: 1 });
  s = push(s, 1);
  assert.equal(s.turn, 2);
  s = push(s, 2);
  assert.deepEqual(s.middle, ['d7', 'd8', 'd9']);
  s = push(s, 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.middle, ['cQ', 'cJ', 'cT']);
  assert.deepEqual(s.discard, ['d7', 'd8', 'd9']);
  assert.equal(s.talon.length, 3);
  assert.equal(s.events.at(-1).type, 'renew');
  // ein Tausch dazwischen fängt neu an zu zählen
  let t = push(fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], turn: 1 }), 1);
  t = swap(t, 2, ['s8'], ['d7']);
  t = push(t, 0);
  assert.deepEqual(t.middle, ['s8', 'd8', 'd9']);
  // Stapel zu klein: das Beiseitegelegte kommt gemischt darunter
  let u = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], talon: ['cA'] });
  u = { ...u, discard: ['sA', 'sK', 'sQ'] };
  u = push(push(push(u, 0), 1), 2, seeded(1));
  assert.equal(u.middle.length, 3);
  assert.equal(u.talon.length + u.discard.length + u.middle.length, 7);
  assert.ok(u.events.some((e) => e.type === 'renew' && e.mixed));
});

test('Klopfen: jeder andere ist noch einmal dran, dann wird aufgedeckt; nur einmal je Runde', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']] });
  s = knock(s, 0);
  assert.equal(s.knocker, 0);
  assert.equal(s.turn, 1);
  assert.equal(knock(s, 1), null);
  assert.equal(swap(s, 0, ['s7'], ['d7']), null); // der Klopfer tauscht nicht mehr
  s = swap(s, 1, ['s9'], ['d9']);
  assert.equal(s.phase, 'play');
  s = push(s, 2);
  assert.equal(s.phase, 'over');
  assert.equal(s.result.reason, 'knock');
  assert.deepEqual(s.result.points.slice(0, 3), [21, 15, 15]);
  assert.deepEqual(s.result.losers, [1, 2]);
});

test('Alle gleich: keiner verliert · 3 Leben, dann schwimmen, dann raus; der Letzte gewinnt', () => {
  let s = knock(fixed({ hands: [['hA', 'hK', 's7'], ['cA', 'cK', 's9'], ['dA', 'dK', 's8']] }), 0);
  s = push(push(s, 1), 2);
  assert.deepEqual(s.result.losers, []);
  // Sitz 1 schwimmt (0 Leben) und verliert wieder: raus; Sitz 2 hat noch 1
  let t = knock(fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], lives: [3, 0, 1, 0] }), 0);
  t = push(push(t, 1), 2);
  assert.deepEqual(t.result.losers, [1, 2]);
  assert.deepEqual(t.result.out, [1]);
  assert.equal(t.gone[1], 1);
  assert.equal(t.lives[2], 0); // schwimmt jetzt
  assert.deepEqual(active(t), [0, 2]);
  assert.equal(t.done, false);
  assert.equal(nextActive(t, 0), 2);
  // nächste Runde: der Ausgeschiedene bekommt keine Karten, der Geber wechselt
  const n = again(t, 0, seeded(2));
  assert.equal(n.phase, 'choose');
  assert.equal(n.hands[1].length, 0);
  assert.equal(n.dealer, 0); // nach Sitz 2 kommt Sitz 0 (1 ist raus)
  // Sitz 2 verliert auch schwimmend: raus – Sitz 0 gewinnt die Partie
  let u = knock({ ...fixed({ hands: [['hA', 'hK', 's7'], [], ['h7', 'h8', 's8']], lives: [2, 0, 0, 0] }), gone: [null, 1, null, null] }, 0);
  u = push(u, 2);
  assert.equal(u.done, true);
  assert.equal(u.winner, 0);
  assert.equal(OUTCOME.Schwimmen(u), 0);
  // neue Partie: alle wieder mit 3 Leben
  const fresh = again(u, 2, seeded(4));
  assert.equal(fresh.games, 2);
  assert.deepEqual(fresh.gone, [null, null, null, null]);
  assert.equal(fresh.lives[1], LIVES);
});

test('Sicht: fremde Hände und der zweite Satz verdeckt, Stapel nur als Anzahl', () => {
  const s = setup(newGame({ humans: [0, 2] }), 0, 4, seeded(7));
  const v = viewFor(s, 2);
  assert.equal(v.hands[0], 3);
  assert.deepEqual(v.hands[2], s.hands[2]);
  assert.equal(v.spare, 3);
  assert.equal(v.talon, 17);
  assert.equal(typeof v.discard, 'number');
});

test('Ohne Hilfen: zwei Karten tauschen geht durch – „Geschummelt!“: Zug zurück, der Schummler verliert die Runde allein', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true, middle: ['hQ', 'h9', 'd9'] });
  s = swap(s, 0, ['s7', 'hK'], ['hQ', 'h9']);
  assert.ok(s);
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(viewFor(s, 2).cheat, { player: 0 });
  const caught = accuse(s, 2);
  assert.equal(caught.phase, 'over');
  assert.equal(caught.result.reason, 'caught');
  assert.deepEqual(caught.result.losers, [0]);
  assert.deepEqual(caught.hands[0], ['hA', 'hK', 's7']); // zurückgenommen
  assert.equal(caught.lives[0], 2);
  assert.equal(caught.events[0].why, 'zwei Karten auf einmal getauscht');
  assert.equal(reverted(caught), true);
  assert.equal(accuse(caught, 2), null);
});

test('Ohne Hilfen: „31!“ ohne 31 zählt als 31 – erwischt verliert der Rufer; mit 31 ist es kein Schummeln', () => {
  const s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true, turn: 1 });
  const lie = claim(s, 0); // auch außer der Reihe
  assert.equal(lie.phase, 'over');
  assert.deepEqual(lie.result.losers, [1, 2]);
  assert.equal(lie.result.points[0], 21);
  const caught = accuse(lie, 1, 0);
  assert.deepEqual(caught.result.losers, [0]);
  assert.match(caught.events[0].why, /31!.*nur 21/);
  assert.deepEqual(caught.lives.slice(0, 3), [2, 3, 3]);
  // mit Hilfen gibt es „31!“ nicht (das Spiel deckt selbst auf)
  assert.equal(claim({ ...s, free: false }, 0), null);
  // echte 31: Fehlalarm
  const real = claim({ ...s, hands: [['hA', 'hK', 'hQ'], ...s.hands.slice(1)] }, 0);
  assert.equal(real.cheat.legal, true);
  const alarm = accuse(real, 2);
  assert.equal(alarm.events[0].type, 'fehlalarm');
  assert.deepEqual(alarm.skip, [2]); // setzt seinen nächsten Zug aus
  assert.deepEqual(alarm.result.losers, [1, 2]); // das Ergebnis bleibt
  assert.equal(reverted(alarm), false);
});

test('Ohne Hilfen: Fehlalarm – wer dran ist, setzt gleich aus (schiebt), sonst beim nächsten Zug', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true });
  s = swap(s, 0, ['s7'], ['d9']);
  const now = accuse(s, 1);
  assert.equal(now.events[0].type, 'fehlalarm');
  assert.equal(now.turn, 2);
  assert.ok(now.events.some((e) => e.type === 'push' && e.player === 1 && e.skipped));
  const later = accuse(s, 2);
  assert.deepEqual(later.skip, [2]);
  const next = push(later, 1);
  assert.equal(next.turn, 0); // Sitz 2 hat ausgesetzt
  assert.deepEqual(next.skip, []);
});

test('Ohne Hilfen: der Klopfer tauscht nach dem Klopfen außer der Reihe – anfechtbar bis ein anderer etwas tut', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true, middle: ['hQ', 'd8', 'd9'] });
  s = knock(s, 0);
  assert.equal(swap(s, 2, ['s8'], ['d8']), null); // außer der Reihe nur der Klopfer
  s = swap(s, 0, ['s7'], ['hQ']);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'play'); // ohne Hilfen deckt das Spiel 31 nicht selbst auf
  assert.equal(s.cheat.legal, false);
  const caught = accuse(s, 1);
  assert.deepEqual(caught.hands[0], ['hA', 'hK', 's7']); // Klopfen und Tausch zurück
  assert.equal(caught.knocker, null);
  assert.deepEqual(caught.result.losers, [0]);
  assert.equal(caught.events[0].why, 'nach dem Klopfen noch getauscht');
  // hat inzwischen ein anderer gespielt, ist der Zug nicht mehr anfechtbar
  const on = push(s, 1);
  assert.equal(accuse(on, 2, 0), null);
  assert.equal(accuse(on, 2).events[0].type, 'fehlalarm'); // gilt dem Schieben von Sitz 1
});

test('Ohne Hilfen: eigenes „31!“ hinterher wäscht einen Schummelzug nicht rein', () => {
  let s = fixed({ hands: [['hA', 's7', 'c8'], ['c7', 'd8', 's9'], ['h7', 'h8', 's8']], free: true, middle: ['hK', 'hQ', 'd9'] });
  s = swap(s, 0, ['s7', 'c8'], ['hK', 'hQ']);
  s = claim(s, 0);
  assert.equal(s.cheat.legal, false);
  const caught = accuse(s, 1);
  assert.equal(caught.events[0].type, 'caught');
  assert.deepEqual(caught.hands[0], ['hA', 's7', 'c8']);
  assert.deepEqual(caught.result.losers, [0]);
});

test('Ohne Hilfen: wer zuletzt geschummelt hat, startet die nächste Runde nicht; allein lässt der Computer sie gelten', () => {
  let s = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true });
  s = claim(s, 0);
  assert.equal(again(s, 0), null);
  assert.equal(regroup(s, 0), null);
  assert.ok(again(s, 2));
  const ok = waive(s, 1);
  assert.equal(ok.cheat, null);
  assert.ok(again(ok, 0));
  assert.ok(regroup(ok, 0).phase === 'setup');
  assert.equal(regroup(ok, 2), null);
});

test('Computer: nimmt die 31, klopft mit gutem Blatt, schiebt, wenn kein Tausch etwas bringt', () => {
  const base = fixed({ hands: [['hA', 'hK', 's7'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], middle: ['hQ', 'd8', 'd9'] });
  assert.deepEqual(chooseMove(viewFor(base, 0), 0), { t: 'swap', arg: { give: ['s7'], take: ['hQ'] } });
  const good = { ...base, hands: [['hA', 'hK', 'h9'], ...base.hands.slice(1)], middle: ['c7', 'd8', 'd9'] };
  assert.deepEqual(chooseMove(viewFor(good, 0), 0), { t: 'knock' });
  const weak = { ...base, hands: [['h7', 'h8', 'h9'], ...base.hands.slice(1)], middle: ['c7', 'd8', 's9'] };
  assert.deepEqual(chooseMove(viewFor(weak, 0), 0), { t: 'push' });
  const after = { ...weak, knocker: 2 };
  assert.deepEqual(chooseMove(viewFor({ ...after, middle: ['hT', 'd8', 's9'] }, 0), 0), { t: 'swap', arg: { give: ['h7'], take: ['hT'] } });
  // Geber: gutes Blatt behalten
  const deal = { ...base, phase: 'choose', turn: 0, spare: ['c9', 'cT', 'cJ'] };
  assert.deepEqual(chooseMove(viewFor(deal, 0), 0), { t: 'choose', arg: true });
  assert.deepEqual(chooseMove(viewFor({ ...deal, hands: [['h7', 's8', 'c9'], ...deal.hands.slice(1)] }, 0), 0), { t: 'choose', arg: false });
  // Tauschliste: 9 einzelne + alle drei (ohne Hilfen auch 9 Zweier)
  assert.equal(options(['hA', 'hK', 's7'], ['c7', 'd8', 'd9']).length, 10);
  assert.equal(options(['hA', 'hK', 's7'], ['c7', 'd8', 'd9'], [2]).length, 9);
  assert.equal(best(options(['h7', 's8', 'c9'], ['hA', 'hK', 'hQ'])).pts, 31);
  // ohne Hilfen sagt er seine 31 selbst an
  const own = { ...base, free: true, hands: [['hA', 'hK', 'hQ'], ...base.hands.slice(1)] };
  assert.deepEqual(chooseMove(viewFor(own, 0), 0), { t: 'claim' });
});

test('Computer schummelt (allein ohne Hilfen): zwei tauschen, „31!“ mit fast 31, nach dem Klopfen tauschen', () => {
  const base = fixed({ hands: [['hA', 's7', 'c8'], ['c7', 'c8', 's9'], ['h7', 'h8', 's8']], free: true, middle: ['hK', 'hQ', 'd9'] });
  assert.deepEqual(cheatMove(viewFor(base, 0), 0, () => 0), { t: 'swap', arg: { give: ['s7', 'c8'], take: ['hK', 'hQ'] } });
  const near = { ...base, hands: [['hA', 'hK', 'h7'], ...base.hands.slice(1)], middle: ['c7', 'd8', 'd9'] };
  assert.deepEqual(cheatMove(viewFor(near, 0), 0, () => 0), { t: 'claim' });
  const mid = { ...base, hands: [['hA', 'h8', 'h7'], ...base.hands.slice(1)], middle: ['hT', 'd8', 'd9'] };
  const m = cheatMove(viewFor(mid, 0), 0, () => 0.99);
  assert.deepEqual(m, { t: 'knock', then: true });
  const knocked = knock(mid, 0);
  assert.deepEqual(lateSwap(viewFor(knocked, 0), 0), { t: 'swap', arg: { give: ['h7'], take: ['hT'] } });
  assert.ok(swap(knocked, 0, ['h7'], ['hT']));
  assert.equal(cheatMove(viewFor(base, 1), 1), null); // nicht dran
});

// Ganze Partie Computer gegen Computer; ohne Hilfen schummeln sie ab und zu und rufen manchmal „Geschummelt!“
function playOut(n, free, seed) {
  const rng = seeded(seed);
  let s = setup(newGame({ humans: [0, 2], free }), 0, n, rng);
  let steps = 0;
  let rounds = 0;
  while (!s.done) {
    assert.ok(++steps < 5000, 'Partie endet nicht');
    if (s.phase === 'over') {
      rounds++;
      s = again(s, s.cheat ? s.seats.find((p) => p !== s.cheat.player) : 0, rng);
      assert.ok(s);
      continue;
    }
    if (free && s.cheat && rng() < 0.15) {
      const by = s.seats.find((p) => p !== s.cheat.player && s.gone[p] === null);
      const next = accuse(s, by);
      assert.ok(next);
      s = next;
      continue;
    }
    const seat = s.turn;
    const v = viewFor(s, seat);
    const m = (free && rng() < 0.15 && cheatMove(v, seat, rng)) || chooseMove(v, seat);
    let next = m.t === 'choose' ? choose(s, seat, m.arg) : m.t === 'swap' ? swap(s, seat, m.arg.give, m.arg.take) : m.t === 'push' ? push(s, seat, rng) : m.t === 'knock' ? knock(s, seat) : claim(s, seat);
    assert.ok(next, `ungültig: ${JSON.stringify(m)}`);
    if (m.then) {
      const late = lateSwap(viewFor(next, seat), seat);
      if (late) next = swap(next, seat, late.arg.give, late.arg.take) ?? next;
    }
    s = next;
    // nichts geht verloren
    if (s.phase !== 'setup') {
      const cards = [...s.seats.flatMap((p) => s.hands[p]), ...s.spare, ...s.middle, ...s.talon, ...s.discard];
      assert.equal(cards.length, 32);
      assert.equal(new Set(cards).size, 32);
    }
  }
  return { s, rounds };
}

test('Computer-Partien zu 2, 3 und 4 laufen bis zum Ende – mit und ohne Hilfen, jede Aktion gültig', () => {
  for (const n of [2, 3, 4]) {
    for (const free of [false, true]) {
      for (let seed = 1; seed <= 12; seed++) {
        const { s, rounds } = playOut(n, free, seed * 31 + n);
        assert.ok(rounds >= 3, `${n}: nur ${rounds} Runden`);
        const left = active(s);
        assert.ok(left.length === 1 || !left.some((p) => s.humans.includes(p)));
        assert.ok([0, 1, null].includes(OUTCOME.Schwimmen(s)));
      }
    }
  }
});

test('Statistik: wer von beiden Menschen länger dabei war; gleichzeitig raus = Remis; läuft = undefined', () => {
  const base = { done: true, humans: [0, 2] };
  assert.equal(OUTCOME.Schwimmen({ ...base, done: false, gone: [null, null, null, null] }), undefined);
  assert.equal(OUTCOME.Schwimmen({ ...base, gone: [null, 3, 5, 2] }), 0);
  assert.equal(OUTCOME.Schwimmen({ ...base, gone: [4, 2, null, 3] }), 1);
  assert.equal(OUTCOME.Schwimmen({ ...base, gone: [6, null, 4, 3] }), 0); // Host schied später aus
  assert.equal(OUTCOME.Schwimmen({ ...base, gone: [5, null, 5, 1] }), null); // in derselben Runde
});

// Ablauf in index.js (Review 21.10.2026): Allein ohne Hilfen tauscht der Mensch auf 31 und ruft „31!“ – sofort (noch
// bevor der Computer den Tausch geprüft hat) oder kurz danach (geprüft, der Computer hat aber noch nicht gezogen). Die
// offene Aktion bleibt dieselbe; am Rundenende muss sie trotzdem geprüft werden, sonst kann keiner weiter.
test('index.js allein ohne Hilfen: „31!“ gleich nach dem eigenen Tausch – der Computer prüft, die Runde hängt nicht', async (t) => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startSchwimmen } = await import('../src/schwimmen/index.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.9); // der Computer ruft nicht und schummelt nicht
  for (const wait of [0, 1000]) {
    const resume = {
      ...fixed({ hands: [['c7', 'c8', 'd9'], ['s7', 's8', 's9']], middle: ['hA', 'hK', 'hQ'], free: true, humans: [0] }),
      count: 2, seats: [0, 2], lives: [3, 0, 3, 0], hands: [['c7', 'c8', 'd9'], [], ['s7', 's8', 's9'], []], events: [],
    };
    const g = startSchwimmen({ ...io, me: 0, level: 1, free: true, resume });
    ui.panel.onAll(); // alle drei tauschen = 31
    t.mock.timers.tick(wait);
    assert.equal(g.view().turn, 2, 'der Computer hat noch nicht gezogen');
    ui.panel.onClaim(); // „31!“
    assert.equal(g.view().phase, 'over');
    for (let i = 0; i < 50; i++) t.mock.timers.tick(200);
    assert.equal(g.view().cheat, null, `der Computer hat geprüft (${wait} ms)`);
    ui.panel.onAgain();
    assert.equal(g.view().phase, 'choose', 'die nächste Runde beginnt');
    g.stop();
  }
});
