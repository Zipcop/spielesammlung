// Zehntausend (src/zehntausend/game.js, ai.js): Wertung, Ablauf (herauslegen, Niete, Anschluss, Aufhören ab 350),
// letzte Runde nach 10 000, „Ohne Hilfen“ (Schummeln und Anklagen) und Computer-gegen-Computer-Partien bis zum Ende.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, roll, toggle, bank, pass, twist, accuse, waive, again, regroup, viewFor, scoreOf, scores, thrownBy, leader,
  MIN_BANK, GOAL, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from '../src/zehntausend/game.js';
import { choosePick, options } from '../src/zehntausend/ai.js';

function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const start = (count = 2, opts = {}) => setup(newGame(opts), 0, count, Math.random, 0);
const ok = (s) => {
  assert.ok(s, 'Schritt ungültig');
  return s;
};
const pick = (s, seat, idx) => idx.reduce((x, i) => ok(toggle(x, seat, i)), s);

test('Wertung: Einsen, Fünfen, Drillinge, Verdoppeln, Straße, drei Paare', () => {
  assert.deepEqual(scoreOf([1]), { points: 100, junk: 0 });
  assert.deepEqual(scoreOf([5, 5]), { points: 100, junk: 0 });
  assert.equal(scoreOf([2, 2, 2]).points, 200);
  assert.equal(scoreOf([1, 1, 1]).points, 1000);
  assert.equal(scoreOf([6, 6, 6]).points, 600);
  assert.equal(scoreOf([2, 2, 2, 2]).points, 400);
  assert.equal(scoreOf([2, 2, 2, 2, 2]).points, 800);
  assert.equal(scoreOf([2, 2, 2, 2, 2, 2]).points, 1600);
  assert.equal(scoreOf([1, 1, 1, 1]).points, 2000);
  assert.equal(scoreOf([1, 1, 1, 1, 1]).points, 4000);
  assert.equal(scoreOf([5, 5, 5, 1]).points, 600);
  assert.equal(scoreOf([3, 3, 3, 4, 4, 4]).points, 700);
  assert.deepEqual(scoreOf([6, 2, 4, 1, 3, 5]), { points: 2000, junk: 0 });
  assert.deepEqual(scoreOf([2, 2, 3, 3, 6, 6]), { points: 1500, junk: 0 });
  assert.deepEqual(scoreOf([4, 4, 4, 4, 6, 6]), { points: 1500, junk: 0 }); // vier gleiche + Paar = drei Paare
  assert.deepEqual(scoreOf([1, 1, 1, 1, 5, 5]), { points: 2100, junk: 0 }); // hier zählt das Verdoppeln mehr
  assert.deepEqual(scoreOf([1, 3]), { points: 100, junk: 1 });
  assert.equal(scores([2, 3, 4, 6, 6, 2]), false);
  assert.equal(scores([2, 3, 4, 6, 6, 3]), false);
  assert.equal(scores([2, 2, 3, 3, 6, 6]), true);
  assert.equal(scores([3]), false);
});

test('Spielerzahl: Sitze wie Elfer raus, nur der Host wählt', () => {
  const s = newGame({ humans: [0, 2] });
  assert.equal(s.phase, 'setup');
  assert.equal(setup(s, 2, 3), null);
  assert.equal(setup(s, 0, 5), null);
  assert.deepEqual(setup(s, 0, 2).seats, [0, 2]);
  assert.deepEqual(setup(s, 0, 3).seats, [0, 1, 2]);
  assert.deepEqual(setup(s, 0, 4).seats, [0, 1, 2, 3]);
});

test('Ablauf: würfeln, herauslegen, weiterwürfeln, aufhören ab 350', () => {
  let s = start();
  assert.equal(s.turn, 0);
  assert.equal(roll(s, 2, [1, 1, 1, 1, 1, 1]), null, 'nicht dran');
  assert.equal(bank(s, 0), null, 'erst würfeln');
  s = ok(roll(s, 0, [1, 5, 2, 3, 4, 4]));
  assert.equal(s.rolls, 1);
  assert.deepEqual(s.where, Array(6).fill('table'));
  assert.equal(roll(s, 0, [1, 1, 1, 1, 1, 1]), null, 'nichts herausgelegt');
  assert.equal(roll(pick(s, 0, [2]), 0, [1, 1, 1, 1, 1, 1]), null, 'Zwei zählt nicht');
  s = pick(s, 0, [0]);
  assert.equal(bank(s, 0), null, '100 reicht nicht');
  s = ok(roll(s, 0, [6, 5, 5, 5, 2, 3])); // Würfel 0 liegt draußen, die anderen fallen neu
  assert.equal(s.dice[0], 1);
  assert.equal(s.where[0], 'aside');
  assert.equal(s.turnPts, 100);
  assert.deepEqual(thrownBy(s), [false, true, true, true, true, true]);
  s = pick(s, 0, [1, 2, 3]); // drei Fünfen = 500
  s = ok(bank(s, 0));
  assert.equal(s.scores[0], 600);
  assert.equal(s.turn, 2);
  assert.equal(s.rolls, 0);
  assert.deepEqual(s.list, [{ player: 0, points: 600 }]);
});

test('Niete: alle Punkte des Zugs weg, der Nächste ist dran', () => {
  let s = start();
  s = ok(roll(s, 0, [1, 1, 1, 2, 3, 4]));
  s = ok(roll(pick(s, 0, [0, 1, 2]), 0, [1, 1, 1, 2, 3, 6]));
  assert.equal(s.turn, 2);
  assert.equal(s.scores[0], 0);
  assert.ok(s.events.some((e) => e.type === 'bust' && e.lost === 1000));
});

test('Anschluss: alle sechs gewertet – mit allen sechs weiter, Punkte bleiben', () => {
  let s = start();
  s = ok(roll(s, 0, [1, 5, 2, 2, 2, 3]));
  s = ok(roll(pick(s, 0, [0, 1, 2, 3, 4]), 0, [1, 5, 2, 2, 2, 5])); // nur Würfel 5 fällt neu: eine 5
  assert.equal(s.turnPts, 350);
  s = pick(s, 0, [5]);
  assert.deepEqual(thrownBy(s), Array(6).fill(true));
  s = ok(roll(s, 0, [3, 3, 4, 4, 6, 6]));
  assert.ok(s.events.some((e) => e.type === 'anschluss'));
  assert.equal(s.turnPts, 400);
  assert.deepEqual(s.where, Array(6).fill('table'));
  s = ok(bank(pick(s, 0, [0, 1, 2, 3, 4, 5]), 0)); // drei Paare
  assert.equal(s.scores[0], 1900);
});

test('Wer 10 000 erreicht, beendet das Spiel nach der Runde – wer danach noch dran ist, hat einen Zug', () => {
  let s = { ...start(3), scores: [9800, 9000, 0] };
  s = ok(roll(s, 0, [1, 1, 1, 2, 3, 4]));
  s = ok(bank(pick(s, 0, [0, 1, 2]), 0));
  assert.equal(s.final, 0);
  assert.equal(s.phase, 'play');
  assert.ok(s.events.some((e) => e.type === 'goal'));
  s = ok(roll(s, 1, [1, 1, 1, 1, 2, 3]));
  s = ok(bank(pick(s, 1, [0, 1, 2, 3]), 1)); // 9000 + 2000 = 11000
  assert.equal(s.phase, 'play');
  s = ok(roll(s, 2, [2, 3, 4, 6, 6, 2])); // Niete
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 1);
  assert.equal(leader([0, 2], [5, 0, 5, 0]), null);
});

test('Ohne Hilfen: Regelwidriges geht, wird vermerkt und ist anfechtbar, bis der Nächste würfelt', () => {
  let s = start(2, { free: true });
  s = ok(roll(s, 0, [2, 3, 4, 6, 6, 2])); // Niete – der Zug bleibt offen
  assert.equal(s.bust, true);
  assert.equal(s.turn, 0);
  s = ok(roll(pick(s, 0, [0]), 0, [2, 1, 1, 1, 5, 5])); // weiter nach Niete, Zwei herausgelegt
  assert.deepEqual(s.cheat.kinds.sort(), ['junk', 'reroll']);
  assert.equal(viewFor(s).cheat.kinds, undefined, 'der Gast sieht nicht, ob geschummelt wurde');
  s = ok(bank(pick(s, 0, [1]), 0)); // nur 100 → unter 350
  assert.ok(s.cheat.kinds.includes('low'));
  assert.equal(s.scores[0], 100);
  assert.equal(s.turn, 2);
  const caught = ok(accuse(s, 2));
  assert.equal(caught.scores[0], 0, 'Punkte des Zugs weg, nicht unter 0');
  assert.ok(caught.events.some((e) => e.type === 'caught' && e.lost === 100 + CHEAT_PENALTY));
  assert.equal(accuse(caught, 2), null, 'nur einmal');
  // der Nächste würfelt: der alte Zug ist nicht mehr anfechtbar
  const later = ok(roll(s, 2, [1, 2, 3, 4, 6, 6]));
  assert.equal(later.cheat.player, 2);
  assert.equal(accuse(later, 2), null, 'eigenen Zug nicht');
});

test('Ohne Hilfen: Fehlalarm kostet den Rufer, Würfel drehen, Niete selbst abgeben', () => {
  let s = { ...start(2, { free: true }), scores: [1000, 1000, 1000, 0] };
  s = ok(roll(s, 0, [1, 1, 1, 2, 3, 4]));
  const alarm = ok(accuse(s, 2));
  assert.equal(alarm.scores[2], 1000 - FALSE_ALARM_PENALTY);
  assert.equal(alarm.turn, 0, 'der Zug läuft weiter');
  s = ok(roll(pick(s, 0, [0, 1, 2]), 0, [1, 1, 1, 2, 3, 3])); // Niete
  assert.equal(s.bust, true);
  const turned = ok(twist(s, 0, 3)); // 2 → 3: drei Dreien
  assert.equal(turned.dice[3], 3);
  assert.equal(turned.bust, false);
  assert.deepEqual(turned.cheat.kinds, ['twist']);
  const caught = ok(accuse(turned, 2));
  assert.equal(caught.turn, 2, 'erwischt im laufenden Zug: der Zug ist vorbei');
  assert.equal(caught.scores[0], 1000 - CHEAT_PENALTY);
  assert.equal(twist(start(), 0, 0), null, 'mit Hilfen nicht');
  const passed = ok(pass(s, 0));
  assert.equal(passed.turn, 2);
  assert.equal(passed.scores[0], 1000);
  assert.equal(passed.cheat.kinds.length, 0);
});

test('Nach Spielende: anfechtbar, der Schummler startet die nächste Partie nicht, waive gibt frei', () => {
  let s = { ...start(2, { free: true }), scores: [9900, 0, 9950, 0] };
  s = ok(roll(s, 0, [1, 2, 3, 4, 6, 6]));
  s = ok(bank(pick(s, 0, [0]), 0)); // 100 → 10000, aber unter 350
  s = ok(roll(s, 2, [2, 3, 4, 6, 6, 2])); // Niete (offen)
  s = ok(pass(s, 2));
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.equal(again(s, 2), null, 'Zug des Gasts ist noch anfechtbar');
  const c2 = ok(accuse({ ...s, cheat: { player: 0, kinds: ['low'], banked: 100 } }, 2));
  assert.equal(c2.scores[0], 10000 - 100 - CHEAT_PENALTY);
  assert.equal(c2.winner, 2);
  const next = ok(again(ok(waive(s, 0)), 2));
  assert.equal(next.phase, 'play');
  assert.equal(next.games, 2);
  assert.deepEqual(next.scores, [0, 0, 0, 0]);
  assert.equal(next.starter, 2, 'reihum beginnen');
  assert.equal(regroup(waive(s, 0), 2), null, 'nur der Host');
  assert.equal(ok(regroup(waive(s, 0), 0)).phase, 'setup');
});

test('Computer: legt nur Wertendes heraus, nimmt den Anschluss und hört vernünftig auf', () => {
  const v = { ...start(), rolls: 1, where: Array(6).fill('table'), dice: [1, 5, 2, 3, 4, 6] };
  assert.deepEqual(choosePick(v, 0), { dice: [0, 1, 2, 3, 4, 5], stop: false }); // Straße: Anschluss
  const w = { ...v, dice: [1, 5, 2, 3, 3, 6] };
  assert.deepEqual(choosePick(w, 0).dice, [0], 'nur die Eins, mit fünf weiter');
  assert.equal(options(w).length, 3);
  const x = { ...v, dice: [1, 1, 1, 5, 2, 3], turnPts: 0 };
  assert.equal(choosePick(x, 0).stop, true, '1050 mit 2 Würfeln übrig: aufhören');
  const y = { ...v, dice: [1, 2, 2, 1, 4, 6], where: ['aside', 'aside', 'aside', 'table', 'table', 'table'], turnPts: 200 };
  assert.equal(choosePick(y, 0).stop, false, '300 reicht nicht');
});

// Ganze Partien Computer gegen Computer (turns = Züge aller Spieler)
function play(count, seed, free = false) {
  const rng = rngOf(seed);
  const die = () => 1 + Math.floor(rng() * 6);
  let s = setup(newGame({ free }), 0, count, rng);
  let turns = 0;
  for (let n = 0; n < 20000 && s.phase === 'play'; n++) {
    const seat = s.turn;
    if (s.rolls === 0 || s.bust) {
      s = s.bust ? pass(s, seat) : roll(s, seat, Array.from({ length: 6 }, die));
    } else {
      const c = choosePick(s, seat);
      s = c.dice.reduce((x, i) => toggle(x, seat, i), s);
      s = c.stop ? bank(s, seat) : roll(s, seat, Array.from({ length: 6 }, die));
    }
    assert.ok(s, 'Computer-Zug ungültig');
    if (s.turn !== seat) turns++;
    if (free) assert.equal(s.cheat?.kinds.length ?? 0, 0, 'der Computer spielt nach den Regeln');
  }
  return { ...s, turns };
}

test('Computer gegen Computer: 2, 3 und 4 am Tisch spielen bis 10 000', () => {
  for (const count of [2, 3, 4]) {
    for (let seed = 1; seed <= 8; seed++) {
      const s = play(count, seed * 7 + count, seed % 2 === 0);
      assert.equal(s.phase, 'over', `${count} am Tisch, Seed ${seed}`);
      assert.ok(s.seats.some((p) => s.scores[p] >= GOAL));
      assert.equal(s.winner, leader(s.seats, s.scores));
      assert.ok(s.list.every((e) => e.points >= MIN_BANK));
    }
  }
});

test('Der Computer holt im Schnitt 400–700 Punkte je Zug (Partie zu zweit: etwa 20–30 Züge je Spieler)', () => {
  let points = 0;
  let turns = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const s = play(2, seed);
    points += s.list.reduce((a, e) => a + e.points, 0);
    turns += s.turns;
  }
  const avg = points / turns;
  assert.ok(avg > 400 && avg < 700, `Schnitt ${avg.toFixed(0)}`);
});

test('Statistik (results.js): mehr Punkte gewinnt, Gast sitzt auf humans[1], läuft = undefined', async () => {
  const { OUTCOME } = await import('../src/results.js');
  assert.equal(OUTCOME.Zehntausend({ phase: 'play', scores: [0, 0, 0, 0], humans: [0, 2] }), undefined);
  assert.equal(OUTCOME.Zehntausend({ phase: 'over', scores: [10200, 11000, 9000, 0], humans: [0, 2] }), 0, 'Computer vorn, Host vor Gast');
  assert.equal(OUTCOME.Zehntausend({ phase: 'over', scores: [9000, 0, 10050, 0], humans: [0, 2] }), 1);
  assert.equal(OUTCOME.Zehntausend({ phase: 'over', scores: [10000, 0, 10000, 0], humans: [0, 2] }), null);
});

// Prüfung 21.10.2026: Ende nach der Runde (Wikipedia: nur wer „in der Reihenfolge nach ihm“ dran ist, würfelt noch)
test('10 000 erreicht: nur wer in dieser Runde noch nach ihm dran ist, hat einen letzten Zug', () => {
  let s = { ...start(3), scores: [0, 9000, 9800] }; // Anfänger Sitz 0, dann 1, dann 2
  s = once0(s, 0);
  s = once0(s, 1);
  s = ok(roll(s, 2, [1, 1, 1, 2, 3, 4]));
  s = ok(bank(pick(s, 2, [0, 1, 2]), 2)); // der Letzte der Runde hat 10 800
  assert.equal(s.phase, 'over', 'Runde um – keiner würfelt mehr');
  assert.equal(s.winner, 2);
  let t = { ...start(3), scores: [0, 9800, 9000] };
  t = once0(t, 0);
  t = ok(roll(t, 1, [1, 1, 1, 2, 3, 4]));
  t = ok(bank(pick(t, 1, [0, 1, 2]), 1)); // Sitz 1 hat 10 800
  assert.equal(t.phase, 'play');
  assert.equal(t.turn, 2, 'Sitz 2 kommt in dieser Runde noch');
  t = once0(t, 2);
  assert.equal(t.phase, 'over', 'Sitz 0 (vor ihm dran) würfelt nicht nochmal');
  assert.equal(t.winner, 1);
});
// ein Zug mit einer Niete
function once0(s, seat) {
  return ok(roll(s, seat, [2, 3, 4, 6, 6, 2]));
}

test('Ohne Hilfen: nach einem Fehlalarm mitten im Zug bleibt der Rest des Zugs anfechtbar', () => {
  let s = { ...start(2, { free: true }), scores: [1000, 0, 1000, 0] };
  s = ok(roll(s, 0, [1, 2, 3, 4, 6, 6]));
  s = ok(accuse(s, 2)); // Fehlalarm – bis hier war alles regelgerecht
  assert.equal(s.cheat, null);
  s = ok(bank(pick(s, 0, [0]), 0)); // 100 – unter 350
  assert.ok(s.cheat?.kinds.includes('low'), 'Aufhören unter 350 ist vermerkt');
  const caught = ok(accuse(s, 2));
  assert.ok(caught.events.some((e) => e.type === 'caught'));
  assert.equal(caught.scores[0], 1000 + 100 - 100 - CHEAT_PENALTY);
  let t = { ...start(2, { free: true }), scores: [1000, 0, 1000, 0] };
  t = ok(roll(t, 0, [1, 2, 3, 4, 6, 6]));
  t = ok(twist(ok(accuse(t, 2)), 0, 1)); // nach dem Fehlalarm heimlich gedreht
  assert.deepEqual(t.cheat?.kinds, ['twist']);
});
