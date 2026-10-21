// Schocken (src/schocken/game.js, ai.js): Rangfolge, Ablauf einer Runde (Wurfzahl des Ersten, Einsen herauslegen,
// Sechsen umdrehen), Aufdecken und Deckel verteilen, Hälften und Finale, Sicht je Spieler, „Ohne Hilfen“ (Schummeln
// und Anklagen) und Computer-gegen-Computer-Partien bis zum Ende.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, roll, toggle, flip, stand, twist, accuse, waive, again, regroup, viewFor, judge, ranking, STONES,
} from '../src/schocken/game.js';
import { chooseMove } from '../src/schocken/ai.js';

function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const ok = (s) => {
  assert.ok(s, 'Schritt ungültig');
  return s;
};
const start = (count = 2, opts = {}) => setup(newGame(opts), 0, count, Math.random, 0);
// Ein Spieler würfelt einmal und hört auf
function once(s, seat, dice) {
  const r = ok(roll(s, seat, dice));
  return r.turn === seat && r.rolls > 0 ? ok(stand(r, seat)) : r;
}

test('Rangfolge: Hausnummer < Straße < General < Schock 2 … 6 < Schock aus, Deckel je Wurf', () => {
  const r = (d) => judge(d);
  assert.equal(r([2, 2, 1]).name, '221');
  assert.equal(r([6, 6, 5]).stones, 1);
  assert.ok(r([2, 2, 1]).rank < r([6, 6, 5]).rank);
  assert.ok(r([6, 6, 5]).rank < r([1, 2, 3]).rank);
  assert.equal(r([3, 1, 2]).kind, 'strasse');
  assert.equal(r([3, 1, 2]).stones, 2);
  assert.ok(r([1, 2, 3]).rank < r([4, 5, 6]).rank);
  assert.ok(r([4, 5, 6]).rank < r([2, 2, 2]).rank);
  assert.equal(r([5, 5, 5]).stones, 3);
  assert.ok(r([6, 6, 6]).rank < r([1, 1, 2]).rank);
  assert.equal(r([1, 6, 1]).name, 'Schock 6');
  assert.equal(r([1, 6, 1]).stones, 6);
  assert.ok(r([1, 1, 6]).rank < r([1, 1, 1]).rank);
  assert.equal(r([1, 1, 1]).name, 'Schock aus');
  assert.equal(r([6, 6, 1]).kind, 'zahl');
});

test('Runde: der Erste legt die Wurfzahl fest, mehr darf keiner; Einsen raus, andere nicht', () => {
  let s = start(3);
  assert.deepEqual(s.order, [0, 1, 2]);
  assert.equal(stand(s, 0), null, 'erst würfeln');
  s = ok(roll(s, 0, [1, 4, 2]));
  assert.equal(toggle(s, 0, 1), null, 'nur Einsen');
  s = ok(toggle(s, 0, 0));
  s = ok(roll(s, 0, [5, 1, 1])); // Würfel 0 bleibt die Eins
  assert.deepEqual(s.dice[0], [1, 1, 1]);
  s = ok(stand(s, 0));
  assert.equal(s.limit, 2);
  assert.equal(s.turn, 1);
  s = ok(roll(s, 1, [2, 3, 5]));
  s = ok(roll(s, 1, [2, 3, 4])); // zweiter Wurf = Grenze → fertig
  assert.equal(s.turn, 2);
  assert.equal(roll(s, 1, [1, 1, 1]), null);
  s = ok(roll(s, 2, [6, 6, 6]));
  s = ok(stand(s, 2));
  // aufgedeckt: Schock aus von Sitz 0 – der Niedrigste (Straße 2-3-4 vs General → Sitz 1) bekommt alle Deckel
  assert.equal(s.shown.high, 0);
  assert.equal(s.shown.low, 1);
  assert.deepEqual(s.halves, [1], 'Schock aus: Hälfte sofort verloren');
  assert.equal(s.half, 2);
  assert.equal(s.pot, STONES);
  assert.equal(s.turn, 1, 'der Verlierer beginnt');
});

test('Gleichstand: der spätere Wurf ist niedriger – außer mit weniger Würfen', () => {
  let s = start(3);
  s = ok(roll(s, 0, [3, 3, 2]));
  s = ok(roll(s, 0, [6, 5, 4])); // Straße im 2. Wurf
  s = ok(stand(s, 0));
  s = ok(roll(s, 1, [4, 6, 5])); // Straße im 1. Wurf – besser
  s = ok(stand(s, 1));
  s = ok(roll(s, 2, [2, 2, 1]));
  s = ok(roll(s, 2, [2, 2, 1]));
  assert.deepEqual(ranking({ ...s, done: [2, 1, 2, null] }, [0, 1, 2]), [1, 0, 2]);
  assert.equal(s.shown.high, 1);
  assert.equal(s.shown.low, 2);
  assert.equal(s.shown.stones, 2);
  assert.equal(s.stones[2], 2);
  assert.equal(s.pot, STONES - 2);
});

test('Sechsen umdrehen: zwei Sechsen → eine Eins, die andere muss nochmal; nicht im letzten Wurf', () => {
  let s = start(2);
  s = ok(roll(s, 0, [6, 6, 3]));
  s = ok(flip(s, 0));
  assert.deepEqual(s.dice[0], [1, 6, 3]);
  assert.deepEqual(s.out[0], [true, false, false]);
  assert.equal(s.mustRoll, true);
  assert.equal(stand(s, 0), null, 'die Sechs muss zurück in den Becher');
  assert.equal(flip(s, 0), null, 'nur einmal je Wurf');
  s = ok(roll(s, 0, [1, 1, 4]));
  assert.deepEqual(s.dice[0], [1, 1, 4]);
  s = ok(roll(s, 0, [1, 6, 6])); // dritter Wurf – fertig
  assert.equal(s.turn, 2);
  let t = ok(roll(start(2), 0, [6, 6, 6]));
  t = ok(flip(t, 0));
  assert.deepEqual(t.dice[0], [1, 1, 6], 'drei Sechsen → zwei Einsen');
  assert.equal(flip(ok(roll(start(2), 0, [6, 5, 3])), 0), null, 'eine Sechs reicht nicht');
});

test('Zweite Phase: Mitte leer – Deckel vom Höchsten, wer keine hat, ist raus; alle 13 = Hälfte verloren', () => {
  let s = { ...start(3), pot: 1, stones: [5, 4, 3, 0] };
  s = ok(roll(s, 0, [1, 1, 5])); // Schock 5
  s = ok(stand(s, 0));
  s = once(s, 1, [6, 4, 2]);
  s = ok(roll(s, 2, [3, 2, 2])); // Grenze 1 Wurf: gleich fertig – aufgedeckt
  // Mitte hatte nur 1 Deckel – mehr gibt es nicht
  assert.equal(s.pot, 0);
  assert.deepEqual(s.stones, [5, 4, 4, 0]);
  assert.equal(s.shown.stones, 1);
  assert.deepEqual(s.active, [0, 1, 2]);
  s = { ...s, stones: [0, 9, 4, 0], active: [1, 2], order: [2, 1], turn: 2 };
  s = ok(roll(s, 2, [1, 1, 6]));
  s = ok(stand(s, 2));
  s = once(s, 1, [2, 3, 5]);
  assert.equal(s.shown.from, 2, 'vom Höchsten');
  assert.equal(s.shown.stones, 4, 'Sitz 2 hatte nur noch 4');
  assert.deepEqual(s.stones, [0, 0, 0, 0], 'Sitz 1 hat alle 13: neue Hälfte, alles zurück in die Mitte');
  assert.deepEqual(s.halves, [1]);
});

test('Zwei Hälften, verschiedene Verlierer: Finale nur zu zweit; gleicher Verlierer: Spielende', () => {
  const base = { ...start(3), half: 2, halves: [0], pot: 0, stones: [0, 10, 3, 0], active: [1, 2], order: [1, 2], turn: 1 };
  let s = ok(roll(base, 1, [2, 4, 6]));
  s = ok(stand(s, 1));
  s = once(s, 2, [1, 1, 3]); // Schock 3 → 3 Deckel von Sitz 2 zu Sitz 1 = 13
  assert.deepEqual(s.halves, [0, 1]);
  assert.equal(s.half, 3);
  assert.deepEqual(s.active, [0, 1]);
  assert.deepEqual(s.order, [1, 0], 'der Verlierer der 2. Hälfte beginnt');
  const same = { ...base, halves: [1] };
  let t = ok(roll(same, 1, [2, 4, 6]));
  t = ok(stand(t, 1));
  t = once(t, 2, [1, 1, 3]);
  assert.equal(t.phase, 'over');
  assert.equal(t.loser, 1);
  assert.ok(t.events.some((e) => e.type === 'over' && e.double));
});

test('Sicht: fremde Würfel unter dem Becher erst beim Aufdecken, herausgelegte sieht jeder', () => {
  let s = start(2);
  s = ok(roll(s, 0, [1, 4, 2]));
  s = ok(toggle(s, 0, 0));
  const g = viewFor(s, 2);
  assert.deepEqual(g.dice[0], [1, null, null]);
  assert.deepEqual(viewFor(s, 0).dice[0], [1, 4, 2]);
  s = ok(stand(s, 0));
  s = once(s, 2, [5, 5, 3]);
  assert.deepEqual(viewFor(s, 2).shown.dice[0], [1, 4, 2]);
});

test('Ohne Hilfen: zu oft würfeln, falsch herauslegen, falsch umdrehen, heimlich drehen – alles vermerkt', () => {
  let s = start(2, { free: true });
  s = ok(roll(s, 0, [6, 5, 3]));
  s = ok(flip(s, 0)); // nur eine Sechs
  s = ok(toggle(s, 0, 1)); // Fünf heraus
  s = ok(twist(s, 0, 2)); // 3 → 4
  s = ok(roll(s, 0, [2, 2, 2])); // nur Würfel 2 fällt
  s = ok(roll(s, 0, [2, 2, 1]));
  s = ok(stand(s, 0));
  assert.equal(s.limit, 3);
  s = ok(roll(s, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [1, 1, 1])); // vierter Wurf
  const kinds = (p) => [...new Set(s.cheats.filter((c) => c.player === p).map((c) => c.kind))].sort();
  assert.deepEqual(kinds(0), ['flip', 'keep', 'twist']);
  assert.deepEqual(kinds(2), ['more']);
  assert.deepEqual(viewFor(s, 2).cheats, [], 'nur der Host weiß es');
  assert.equal(twist(start(2), 0, 0), null, 'mit Hilfen nicht');
});

test('Ohne Hilfen: Anklage in der Runde und nach dem Aufdecken – erwischt verliert der Schummler die Runde', () => {
  let s = start(3, { free: true });
  s = ok(roll(s, 0, [1, 1, 2]));
  s = ok(stand(s, 0)); // Schock 2, limit 1
  s = ok(roll(s, 1, [4, 4, 4]));
  s = ok(roll(s, 1, [4, 4, 4])); // zweiter Wurf über die Grenze
  s = ok(stand(s, 1));
  s = ok(roll(s, 2, [6, 5, 3]));
  s = ok(stand(s, 2)); // aufgedeckt: Sitz 2 hat die Hausnummer – normal Verlierer
  assert.equal(s.shown.low, 2);
  assert.equal(s.stones[2], 2);
  const caught = ok(accuse(s, 2, 1));
  assert.equal(caught.shown.low, 1, 'der Schummler verliert die Runde');
  assert.deepEqual(caught.stones, [0, 2, 0, 0]);
  assert.equal(caught.pot, STONES - 2);
  assert.ok(caught.events.some((e) => e.type === 'caught' && e.kinds.includes('more')));
  assert.deepEqual(caught.order[0], 1, 'der Verlierer beginnt');
  const alarm = ok(accuse(s, 1, 0));
  assert.equal(alarm.shown.low, 1, 'Fehlalarm: der Rufer verliert die Runde');
  assert.ok(alarm.events.some((e) => e.type === 'fehlalarm'));
  // in der laufenden Runde: der Verlierer steht fest, die Runde läuft weiter
  let r = ok(roll(caught, 1, [2, 3, 3]));
  assert.equal(r.undo, null, 'mit dem ersten Wurf der neuen Runde ist die alte erledigt');
  r = ok(accuse(r, 0, 2));
  assert.equal(r.forced, 0, 'Fehlalarm: Sitz 2 hat nichts getan');
  r = ok(stand(r, 1));
  r = once(r, 2, [1, 1, 6]);
  r = once(r, 0, [1, 1, 5]);
  assert.equal(r.shown.low, 0);
});

test('Nach Spielende: wer zuletzt geschummelt hat, startet die nächste Partie nicht; waive gibt frei', () => {
  const base = { ...start(2, { free: true }), half: 3, halves: [0, 2], pot: 0, stones: [10, 0, 3, 0], active: [0, 2], order: [2, 0], turn: 2 };
  let s = ok(roll(base, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [3, 3, 4]));
  s = ok(roll(s, 2, [1, 1, 1])); // vierter Wurf: Schock aus
  s = ok(stand(s, 2));
  s = once(s, 0, [6, 5, 3]);
  assert.equal(s.phase, 'over');
  assert.equal(s.loser, 0);
  assert.equal(again(s, 2), null, 'der Schummler nicht – der andere schon');
  assert.ok(again(s, 0));
  const caught = ok(accuse(s, 0, 2));
  assert.equal(caught.phase, 'play', 'nach Spielende erwischt: neu ausgewertet – das Finale geht weiter');
  assert.deepEqual(caught.stones, [9, 0, 4, 0]);
  const solo = { ...s, humans: [0] };
  assert.equal(again({ ...solo, cheats: [{ player: 0, kind: 'more' }] }, 0), null);
  assert.ok(again(ok(waive({ ...solo, cheats: [{ player: 0, kind: 'more' }] })), 0));
  const next = again(s, 0);
  assert.equal(next.games, 2);
  assert.equal(next.order[0], 0, 'der Verlierer beginnt');
  assert.equal(regroup(s, 2), null);
  assert.equal(ok(regroup(s, 0)).phase, 'setup');
});

test('Computer: Einsen raus, Sechsen umdrehen, mit Straße/General/Schock aufhören, kleinen Schock nachwürfeln', () => {
  const s = ok(roll(start(2), 0, [1, 4, 2]));
  assert.deepEqual(chooseMove(s, 0), { t: 'toggle', arg: 0 });
  assert.deepEqual(chooseMove(ok(toggle(s, 0, 0)), 0), { t: 'roll' });
  assert.deepEqual(chooseMove(ok(roll(start(2), 0, [6, 3, 6])), 0), { t: 'flip' });
  assert.deepEqual(chooseMove(ok(roll(start(2), 0, [4, 6, 5])), 0), { t: 'stand' });
  assert.deepEqual(chooseMove(ok(roll(start(2), 0, [1, 5, 1])), 0), { t: 'stand' });
  assert.deepEqual(chooseMove(ok(roll(start(2), 0, [1, 2, 1])), 0), { t: 'toggle', arg: 0 });
  const f = ok(flip(ok(roll(start(2), 0, [6, 6, 1])), 0));
  assert.deepEqual(chooseMove(f, 0), { t: 'toggle', arg: 2 }, 'nach dem Umdrehen erst die andere Eins heraus');
});

// Ganze Partien Computer gegen Computer
function play(count, seed, free = false) {
  const rng = rngOf(seed);
  const die = () => 1 + Math.floor(rng() * 6);
  let s = setup(newGame({ free }), 0, count, rng);
  let rounds = 0;
  for (let n = 0; n < 50000 && s.phase === 'play'; n++) {
    const seat = s.turn;
    const m = chooseMove(viewFor(s, seat), seat);
    const before = s.round;
    s = m.t === 'roll' ? roll(s, seat, [die(), die(), die()]) : m.t === 'stand' ? stand(s, seat) : m.t === 'flip' ? flip(s, seat) : toggle(s, seat, m.arg);
    assert.ok(s, `Computer-Zug ungültig: ${JSON.stringify(m)}`);
    if (s.round !== before) rounds++;
    if (free) assert.equal(s.cheats.length, 0, 'der Computer spielt nach den Regeln');
    const total = s.pot + s.stones.reduce((a, b) => a + b, 0);
    assert.equal(total, STONES, 'es gibt immer genau 13 Deckel');
  }
  return { ...s, rounds };
}

test('Computer gegen Computer: 2, 3 und 4 am Tisch spielen bis zum Verlierer', () => {
  for (const count of [2, 3, 4]) {
    for (let seed = 1; seed <= 10; seed++) {
      const s = play(count, seed * 11 + count, seed % 2 === 0);
      assert.equal(s.phase, 'over', `${count} am Tisch, Seed ${seed}`);
      assert.ok(s.seats.includes(s.loser));
      assert.ok(s.halves.length === 2 || s.halves.length === 3);
      assert.equal(s.halves.at(-1), s.loser);
      assert.ok(s.rounds >= 2);
    }
  }
});

test('Statistik (results.js): wer die Partie verliert, ist hinten – sonst weniger verlorene Hälften', async () => {
  const { OUTCOME } = await import('../src/results.js');
  assert.equal(OUTCOME.Schocken({ phase: 'play', halves: [], loser: null, humans: [0, 2] }), undefined);
  assert.equal(OUTCOME.Schocken({ phase: 'over', halves: [0, 0], loser: 0, humans: [0, 2] }), 1);
  assert.equal(OUTCOME.Schocken({ phase: 'over', halves: [2, 1, 2], loser: 2, humans: [0, 2] }), 0);
  assert.equal(OUTCOME.Schocken({ phase: 'over', halves: [0, 1, 1], loser: 1, humans: [0, 2] }), 1, 'Computer verliert, der Host hat eine Hälfte verloren');
  assert.equal(OUTCOME.Schocken({ phase: 'over', halves: [3, 3], loser: 3, humans: [0, 2] }), null);
});

// Prüfung 21.10.2026
test('Ohne Hilfen: würfelt der Erste zu oft, dürfen die anderen trotzdem nur 3', () => {
  let s = start(2, { free: true });
  for (let i = 0; i < 4; i++) s = ok(roll(s, 0, [2, 3, 5]));
  s = ok(stand(s, 0));
  assert.equal(s.limit, 3);
  for (let i = 0; i < 3; i++) s = ok(roll(s, 2, [2, 3, 5]));
  assert.ok(!s.cheats.some((c) => c.player === 2));
  s = ok(roll(s, 2, [2, 3, 5]));
  assert.ok(s.cheats.some((c) => c.player === 2 && c.kind === 'more'));
});

test('Ohne Hilfen: Anklage gegen einen Schummler wäscht einen anderen nicht rein', () => {
  let s = start(3, { free: true });
  s = ok(roll(s, 0, [2, 3, 5]));
  s = ok(twist(s, 0, 0)); // Sitz 0 schummelt
  s = ok(stand(s, 0));
  s = ok(roll(s, 1, [2, 3, 5]));
  s = ok(roll(s, 1, [2, 3, 5])); // Sitz 1 würfelt über die Grenze
  s = ok(stand(s, 1));
  s = ok(accuse(s, 2, 1)); // erwischt
  assert.equal(s.forced, 1);
  s = ok(accuse(s, 2, 0));
  assert.ok(s.events.some((e) => e.type === 'caught' && e.player === 0), 'auch Sitz 0 hat geschummelt – kein Fehlalarm');
  assert.equal(s.forced, 0);
  assert.equal(ok(accuse(s, 2, 0)).events[0].type, 'fehlalarm', 'abgegolten ist abgegolten');
});

test('Zu zweit nach Spielende: haben beide geschummelt, darf jeder die nächste Partie starten', () => {
  const base = { ...start(2, { free: true, humans: [0, 2] }), half: 3, halves: [0, 2], pot: 0, stones: [10, 0, 3, 0], active: [0, 2], order: [2, 0], turn: 2 };
  let s = ok(roll(base, 2, [1, 1, 2]));
  s = ok(twist(s, 2, 2)); // Schock 3
  s = ok(stand(s, 2));
  s = ok(roll(s, 0, [6, 5, 3]));
  s = ok(twist(s, 0, 2)); // 6-5-4 – bekommt die letzten 3 Deckel
  s = ok(stand(s, 0));
  assert.equal(s.phase, 'over');
  assert.ok(again(s, 0) && again(s, 2), 'kein Hänger');
});

test('Statistik: öffnet ein Fehlalarm nach Spielende die Partie wieder, nimmt reverted das alte Ende zurück', async () => {
  const { reverted } = await import('../src/results.js');
  const base = { ...start(2, { free: true }), half: 3, halves: [0, 2], pot: 0, stones: [10, 0, 3, 0], active: [0, 2], order: [2, 0], turn: 2 };
  let s = once(base, 2, [1, 1, 1]); // Schock aus, ehrlich
  s = once(s, 0, [6, 5, 3]);
  assert.equal(s.phase, 'over');
  const alarm = ok(accuse(s, 2, 0)); // Sitz 0 hat nicht geschummelt: Fehlalarm, Sitz 2 verliert die Runde
  assert.equal(alarm.events[0].type, 'fehlalarm');
  assert.equal(alarm.phase, 'play', 'die Partie läuft wieder');
  assert.equal(reverted(alarm), true);
});
