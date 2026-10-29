// Bowling-Regeln ohne Browser: Wertung (Strike, Spare, 10. Frame, Foul), Ablauf frame-weise zu zweit,
// Aufstellung der Pins, „Ohne Hilfen“ (selbst eintragen, Geschummelt!, Fehlalarm) und Revanche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, throwBall, accuse, waive, again, framesOf, position, totalOf, marks, forGuest, SPOTS, FALSE_ALARM_POINTS } from '../src/bowling/rules.js';

const R = (...ns) => ns.map((n) => (n === 'F' ? { n: 0, f: true } : { n }));
const total = (rolls) => framesOf(rolls).at(-1).total;

// Pins nach einem Wurf: die ersten k stehenden (nach Nummer) fallen
function report(s, k, extra = {}) {
  let left = k;
  const pins = s.pins.map((p) => (p && left-- > 0 ? null : p));
  return { pins, foul: false, gutter: false, ...extra };
}

test('Wertung: 300, alles Spare 5/5, alles 9-0, gemischtes Beispiel', () => {
  assert.equal(total(R(...Array(12).fill(10))), 300);
  assert.equal(total(R(...Array(21).fill(5))), 150);
  assert.equal(total(R(...Array(10).fill([9, 0]).flat())), 90);
  // Beispiel: X, 7/, 9-, X, -8, 8/, -6, X, X, X81 = 167 (Standardbeispiel der Bowling-Wertung)
  assert.equal(total(R(10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1)), 167);
  assert.equal(framesOf(R(10, 7)).at(0).total, null, 'Strike wartet auf zwei Würfe');
  assert.equal(framesOf(R(10, 7, 3)).at(0).total, 20);
});

test('10. Frame: nach Strike oder Spare drei Würfe, sonst zwei; Pins links', () => {
  const nine = Array(18).fill(0);
  assert.deepEqual(position(R(...nine, 10)), { frame: 9, ball: 1, left: 10, done: false });
  assert.deepEqual(position(R(...nine, 10, 4)), { frame: 9, ball: 2, left: 6, done: false });
  assert.deepEqual(position(R(...nine, 3, 7)), { frame: 9, ball: 2, left: 10, done: false });
  assert.equal(position(R(...nine, 3, 6)).done, true);
  assert.equal(position(R(...nine, 10, 10, 10)).done, true);
  assert.deepEqual(marks(framesOf(R(...nine, 10, 3, 7)).at(9), 9), ['X', '3', '/']);
  assert.deepEqual(marks(framesOf(R(...nine, 'F', 10, 10)).at(9), 9), ['F', '/', 'X']);
  assert.deepEqual(marks(framesOf(R(0, 0)).at(0), 0), ['–', '–']);
});

test('Ablauf zu zweit: frame-weise abwechselnd, nach dem Strike gleich der andere, Pins neu aufgestellt', () => {
  let s = newGame({ starter: 0 });
  s = throwBall(s, 0, report(s, 10));
  assert.equal(s.turn, 1);
  assert.equal(s.last.mark, 'X');
  assert.equal(s.pins.filter(Boolean).length, 10);
  assert.equal(throwBall(s, 0, report(s, 3)), null, 'nicht dran');
  s = throwBall(s, 1, report(s, 7));
  assert.equal(s.turn, 1, 'zweiter Wurf im Frame');
  assert.equal(s.pins.filter(Boolean).length, 3, 'die drei stehen noch');
  s = throwBall(s, 1, report(s, 3));
  assert.equal(s.last.mark, '/');
  assert.equal(s.turn, 0);
  assert.equal(s.pins.filter(Boolean).length, 10);
});

test('Foul im ersten Wurf: zählt 0, die Pins werden wieder aufgestellt – alle 10 im zweiten = Spare', () => {
  let s = newGame();
  s = throwBall(s, 0, report(s, 6, { foul: true }));
  assert.deepEqual(s.rolls[0], [{ n: 0, f: true }]);
  assert.equal(s.pins.filter(Boolean).length, 10, 'umgeworfene Pins wieder aufgestellt');
  s = throwBall(s, 0, report(s, 10));
  assert.equal(s.last.mark, '/');
  // Rinne vor den Pins: keine Pins, auch wenn welche fielen
  let g = newGame();
  g = throwBall(g, 0, report(g, 2, { gutter: true }));
  assert.deepEqual(g.rolls[0], [{ n: 0 }]);
});

test('Ungültige Meldungen werden abgelehnt (umgefallener Pin steht wieder, Lage außerhalb)', () => {
  let s = newGame();
  s = throwBall(s, 0, report(s, 4));
  const bad = s.pins.map((p, i) => (p ? p : SPOTS[i]));
  assert.equal(throwBall(s, 0, { pins: bad, foul: false, gutter: false }), null);
  assert.equal(throwBall(s, 0, { pins: s.pins.map((p) => (p ? [5, 0] : null)), foul: false, gutter: false }), null);
  assert.equal(throwBall(s, 0, { pins: [1, 2] }), null);
});

test('Ganze Partie: Ende nach 10 Frames beider, Sieger nach Punkten, Revanche mit Wechsel', () => {
  let s = newGame({ starter: 1 });
  let guard = 0;
  while (!s.result && guard++ < 100) s = throwBall(s, s.turn, report(s, s.turn === 0 ? 10 : 4));
  assert.ok(s.result);
  assert.equal(totalOf(s, 0), 300);
  assert.equal(totalOf(s, 1), 80);
  assert.equal(s.result.winner, 0);
  const r = again(s, 1);
  assert.equal(r.starter, 0);
  assert.deepEqual(r.wins, [1, 0]);
});

test('Ohne Hilfen: selbst eintragen, Schummeln erwischt = Frame 0, Fehlalarm = 10 Minuspunkte', () => {
  let s = newGame({ free: true });
  assert.equal(throwBall(s, 0, report(s, 7)), null, 'ohne Eintrag geht nichts');
  s = throwBall(s, 0, report(s, 7), 9); // 7 gefallen, 9 eingetragen
  assert.equal(s.cheat.legal, false);
  assert.equal(forGuest(s).cheat.legal, undefined, 'der Gast sieht nicht, ob es stimmt');
  assert.equal(accuse(s, 0), null, 'nicht gegen sich selbst');
  const caught = accuse(s, 1);
  assert.equal(caught.verdict.caught, true);
  assert.match(caught.verdict.why, /9 Pins eingetragen, gefallen waren 7/);
  assert.deepEqual(caught.rolls[0], [{ n: 0 }, { n: 0 }]);
  assert.equal(caught.turn, 1, 'Frame vorbei, der andere ist dran');
  assert.equal(caught.pins.filter(Boolean).length, 10);
  // ehrlich und trotzdem gerufen
  let h = newGame({ free: true });
  h = throwBall(h, 0, report(h, 10), 10);
  const alarm = accuse(h, 1);
  assert.equal(alarm.verdict.caught, false);
  assert.equal(totalOf(alarm, 1), -FALSE_ALARM_POINTS);
  // Übertreten mit ausgeschaltetem Melder: Pins eintragen = Schummeln, „F“ = ehrlich
  let o = newGame({ free: true });
  o = throwBall(o, 0, report(o, 8, { foul: true }), 8);
  assert.equal(o.cheat.legal, false);
  assert.match(o.cheat.why, /übergetreten/);
  let f = newGame({ free: true });
  f = throwBall(f, 0, report(f, 8, { foul: true }), 'F');
  assert.equal(f.cheat.legal, true);
});

test('Ohne Hilfen: Frist endet mit dem Wurf des anderen, Revanche gesperrt solange offen', () => {
  let s = newGame({ free: true });
  s = throwBall(s, 0, report(s, 3), 5);
  s = throwBall(s, 0, report(s, 2), 2);
  assert.equal(s.cheat.legal, false, 'der Frame bleibt anprangerbar');
  s = throwBall(s, 1, report(s, 4), 4);
  assert.equal(s.cheat.player, 1);
  assert.equal(accuse(s, 1), null, 'Frist für Spieler 0 ist vorbei');
  const w = waive(s, 0);
  assert.equal(w.cheat, null);
});

test('Statistik zu zweit: Ergebnis aus dem Spielstand, erwischter Schummel-Sieg gilt nicht', async () => {
  const { OUTCOME, reverted } = await import('../src/results.js');
  // k Pins umwerfen (höchstens so viele wie stehen) und ehrlich eintragen – oder claim statt der Wahrheit
  const honest = (s, k, claim) => {
    const n = Math.min(k, s.pins.filter(Boolean).length, position(s.rolls[s.turn]).left);
    return throwBall(s, s.turn, report(s, n), claim ?? n);
  };
  let s = newGame({ free: true });
  assert.equal(OUTCOME.Bowling(s), undefined, 'läuft noch');
  while (!s.result) s = honest(s, s.turn === 0 ? 9 : 8);
  assert.equal(OUTCOME.Bowling(s), 0);
  assert.equal(reverted(accuse(s, 0)), false, 'Fehlalarm nimmt nichts zurück');
  // Spieler 1 liegt knapp zurück und trägt im letzten Frame einen Strike ein, obwohl nur 3 fielen
  let t = newGame({ free: true });
  while (!t.result) {
    const lastFrame = t.turn === 1 && position(t.rolls[1]).frame === 9 && position(t.rolls[1]).ball === 0;
    t = honest(t, 3, lastFrame ? 10 : undefined); // je 3 + 3 = 60, Spieler 1 mit Schummel-Strike 54 + 16 = 70
  }
  assert.equal(OUTCOME.Bowling(t), 1, 'mit dem Schummel-Strike gewinnt Spieler 1');
  const caught = accuse(t, 0);
  assert.equal(caught.verdict.caught, true);
  assert.equal(reverted(caught), true);
  assert.equal(OUTCOME.Bowling(caught), 0, 'erwischt: Frame 10 zählt 0, Spieler 0 gewinnt');
});

test('10. Frame: Strike, dann 0 oder Foul und alle 10 = Spare (nicht Strike)', () => {
  const nine = Array(18).fill(0);
  assert.deepEqual(marks(framesOf(R(...nine, 10, 0, 10)).at(9), 9), ['X', '–', '/']);
  assert.deepEqual(marks(framesOf(R(...nine, 10, 'F', 10)).at(9), 9), ['X', 'F', '/']);
  assert.deepEqual(marks(framesOf(R(...nine, 10, 10, 10)).at(9), 9), ['X', 'X', 'X']);
  assert.deepEqual(marks(framesOf(R(...nine, 0, 10, 10)).at(9), 9), ['–', '/', 'X']);
  // auch die Meldung des Wurfs (für „STRIKE!“/„SPARE!“) stimmt
  let s = newGame();
  for (let f = 0; f < 9; f++) for (const p of [0, 1]) { s = throwBall(s, p, report(s, 0)); s = throwBall(s, p, report(s, 0)); }
  s = throwBall(s, 0, report(s, 10));
  s = throwBall(s, 0, report(s, 0));
  s = throwBall(s, 0, report(s, 10));
  assert.equal(s.last.mark, '/');
  assert.equal(totalOf(s, 0), 20);
});

test('Ohne Hilfen: kein Foul-Melder – nach verschwiegenem Übertreten bleiben die Pins liegen, nach „F“ neu aufgestellt', () => {
  let s = newGame({ free: true });
  const lied = throwBall(s, 0, report(s, 6, { foul: true }), 6);
  assert.equal(lied.pins.filter(Boolean).length, 4, 'Anlage merkt nichts');
  const honestF = throwBall(s, 0, report(s, 6, { foul: true }), 'F');
  assert.equal(honestF.pins.filter(Boolean).length, 10, 'eingetragenes F: wieder aufgestellt');
  // die wahre Pinzahl und die Rinne stehen nicht im Stand, den der Gast bekommt
  const g = forGuest(throwBall(s, 0, report(s, 3, { gutter: true }), 3));
  assert.equal(g.last.down, undefined);
  assert.equal(g.last.gutter, false);
  assert.equal(g.events[0].gutter, false);
  assert.equal(g.cheat.legal, undefined);
  // mit Hilfen bleibt alles wie gehabt: Foul stellt wieder auf
  let n = newGame();
  n = throwBall(n, 0, report(n, 6, { foul: true }));
  assert.equal(n.pins.filter(Boolean).length, 10);
});
