// Darts (src/darts): Scheibe und Wertung nach WDF/DDV, Checkout-Wege, 501 Double Out mit Bust, Legs, Revanche,
// „Ohne Hilfen“ (selbst eintragen, Geschummelt!, Fehlalarm), Gast-Sicht, Statistik und Computer-Ziele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDER, RING, HANG, scoreAt, centerOf, value, checkout } from '../src/darts/rules.js';
import { newGame, setup, throwDart, pull, accuse, waive, again, regroup, nextLegFree, judgeVisit, forGuest, dartsAllowed, average } from '../src/darts/game.js';
import { chooseTarget, fakeClaim } from '../src/darts/ai.js';
import { OUTCOME, reverted } from '../src/results.js';

// Pfeil, der genau in der Mitte eines Felds steckt (Meldung wie vom werfenden PC)
const at = (label) => {
  const [x, y] = label === 'Miss' ? [0, -0.2] : centerOf(label);
  return { p: [x, y + HANG.bull, 0], d: [0, -0.1, -0.99], on: 'board' };
};
const floor = { p: [0.3, 0, 0.5], d: [1, 0, 0], on: 'floor' };
const play = (opts = {}) => setup(newGame(opts), 0, { mode: opts.mode ?? 501, bestOf: opts.bestOf ?? 3 });
function visit(s, p, labels) {
  for (const l of labels) {
    const next = throwDart(s, p, l === 'floor' ? floor : at(l));
    assert.ok(next, `Wurf ${l} geht nicht`);
    s = next;
  }
  return s;
}

test('Scheibe: Reihenfolge, Maße und Wertung', () => {
  assert.deepEqual(ORDER.slice(0, 5), [20, 1, 18, 4, 13]);
  assert.equal(new Set(ORDER).size, 20);
  assert.equal(HANG.bull, 1.73);
  assert.equal(HANG.oche, 2.37);
  assert.ok(Math.abs(Math.hypot(HANG.bull, HANG.oche) - 2.934) < 0.001); // Diagonale 2,93 m
  assert.ok(Math.abs(RING.trebleOut - RING.trebleIn - 0.008) < 1e-9);
  assert.ok(Math.abs(RING.doubleOut - RING.doubleIn - 0.008) < 1e-9);
  assert.ok(Math.abs(RING.bull * 2 - 0.0127) < 1e-9 && Math.abs(RING.outer * 2 - 0.0318) < 1e-9);
  for (const n of ORDER) for (const k of ['S', 'D', 'T']) assert.equal(scoreAt(...centerOf(`${k}${n}`)).label, `${k}${n}`);
  assert.equal(scoreAt(0, 0).label, 'Bull');
  assert.equal(scoreAt(0, 0).points, 50);
  assert.ok(scoreAt(0, 0).double);
  assert.equal(scoreAt(0, 0.01).label, '25');
  assert.equal(scoreAt(0, 0.05).label, 'S20');
  assert.equal(scoreAt(0.1, 0).label, 'T6'); // rechts liegt die 6
  assert.equal(scoreAt(-0.166, 0).label, 'D11'); // links die 11
  assert.equal(scoreAt(0, -0.103).label, 'T3'); // unten die 3
  assert.equal(scoreAt(0, 0.171).label, 'Miss');
  assert.equal(scoreAt(0, 0.1695).label, 'D20');
  assert.equal(value('T20'), 60);
  assert.equal(value('25'), 25);
});

test('Checkout-Wege: 170 höchstes, Bogey-Zahlen ohne Weg, letzter Pfeil immer ein Doppel', () => {
  assert.deepEqual(checkout(170), ['T20', 'T20', 'Bull']);
  assert.deepEqual(checkout(100), ['T20', 'D20']);
  assert.deepEqual(checkout(40), ['D20']);
  assert.deepEqual(checkout(32), ['D16']);
  assert.deepEqual(checkout(50, 1), ['Bull']);
  assert.deepEqual(checkout(3), ['S1', 'D1']);
  assert.equal(checkout(1), null);
  assert.equal(checkout(171), null);
  assert.equal(checkout(100, 1), null);
  const bogey = [159, 162, 163, 165, 166, 168, 169];
  for (let r = 2; r <= 170; r++) {
    const route = checkout(r);
    if (bogey.includes(r)) assert.equal(route, null, `${r} ist eine Bogey-Zahl`);
    else {
      assert.ok(route && route.length <= 3, `${r} ohne Weg`);
      assert.equal(route.reduce((s, l) => s + value(l), 0), r);
      assert.ok(/^D|^Bull$/.test(route.at(-1)), `${r}: ${route}`);
    }
  }
});

test('501: Punkte abziehen, nach drei Pfeilen ziehen, dann ist der andere dran', () => {
  let s = play();
  assert.equal(s.phase, 'play');
  assert.equal(throwDart(s, 1 - s.turn, at('T20')), null); // nicht dran
  const p = s.turn;
  s = visit(s, p, ['T20', 'T20', 'T20']);
  assert.equal(s.rest[p], 321);
  assert.equal(s.done, 'full');
  assert.equal(throwDart(s, p, at('T20')), null); // nur drei Pfeile
  assert.equal(pull(s, 1 - p), null);
  s = pull(s, p);
  assert.equal(s.turn, 1 - p);
  assert.equal(s.darts.length, 0);
  assert.equal(s.history[0].points, 180);
  assert.equal(average(s, p), 180);
  s = visit(s, 1 - p, ['S5', 'floor', 'S1']); // daneben zählt 0
  assert.equal(s.rest[1 - p], 495);
});

test('Bust: unter 0, auf 1 oder 0 ohne Doppel – Aufnahme zählt nicht, übrige Pfeile verfallen', () => {
  assert.deepEqual(judgeVisit(40, [at('S20'), at('S20')].map((d) => ({ hit: scoreAt(d.p[0], d.p[1] - HANG.bull) }))), { points: 0, bust: true, checkout: false });
  let s = play({ mode: 301 });
  const p = s.turn;
  s = visit(s, p, ['T20', 'T20', 'T20']);
  s = visit(pull(s, p), 1 - p, ['S1', 'S1', 'S1']);
  s = visit(pull(s, 1 - p), p, ['T20', 'S1', 'T20']); // 121 → 0, aber mit Triple: Bust
  assert.equal(s.done, 'bust');
  assert.equal(s.rest[p], 121);
  s = visit(pull(s, p), 1 - p, ['S1']);
  s = visit(pull(visit(s, 1 - p, ['S1', 'S1']), 1 - p), p, ['T20', 'T20']); // 121 − 120 = 1
  assert.equal(s.done, 'bust');
  assert.equal(s.darts.length, 2, 'der dritte Pfeil verfällt');
  assert.equal(throwDart(s, p, at('S1')), null);
});

test('Checkout nur mit Doppel, Legs und Partie, danach Revanche mit dem anderen', () => {
  let s = play({ mode: 301, bestOf: 3, starter: 0 });
  const leg = (s, p) => {
    s = pull(visit(s, p, ['T20', 'T20', 'T20']), p); // 121
    s = pull(visit(s, 1 - p, ['S1', 'S1', 'S1']), 1 - p);
    s = visit(s, p, ['T20', 'T7', 'D20']); // 60 + 21 + 40 = 121
    return s;
  };
  s = leg(s, 0);
  assert.equal(s.done, 'checkout');
  assert.deepEqual(s.legs, [1, 0]);
  assert.equal(s.rest[0], 0);
  s = pull(s, 0);
  assert.equal(s.turn, 1, 'nächstes Leg beginnt der andere');
  assert.deepEqual(s.rest, [301, 301]);
  // 0 ohne Doppel = Bust
  let t = pull(visit(s, 1, ['T20', 'T20', 'T20']), 1);
  t = pull(visit(t, 0, ['S1', 'S1', 'S1']), 0);
  t = visit(t, 1, ['T20', 'S1', 'T20']); // 121 → 0 ohne Doppel → Bust
  assert.equal(t.done, 'bust');
  // Host gewinnt das zweite Leg
  s = pull(visit(s, 1, ['S1', 'S1', 'S1']), 1);
  s = leg(s, 0);
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 0);
  assert.equal(OUTCOME.Darts(s), 0);
  assert.equal(OUTCOME.Darts(play()), undefined);
  const r = again(s, 1);
  assert.equal(r.phase, 'play');
  assert.equal(r.starter, 1);
  assert.deepEqual(r.wins, [1, 0]);
  assert.equal(regroup(s, 1), null, 'nur der Host stellt neu ein');
  assert.equal(regroup(s, 0).phase, 'setup');
});

test('Einstellungen: nur der Host, nur erlaubte Werte; ungültige Meldungen werden abgelehnt', () => {
  const s = newGame();
  assert.equal(setup(s, 1, { mode: 501, bestOf: 3 }), null);
  assert.equal(setup(s, 0, { mode: 401, bestOf: 3 }), null);
  assert.equal(setup(s, 0, { mode: 501, bestOf: 2 }), null);
  const g = setup(s, 0, { mode: 301, bestOf: 5 });
  assert.equal(g.rest[0], 301);
  const p = g.turn;
  assert.equal(throwDart(g, p, { p: [0, 1.73, 0.5], d: [0, 0, -1], on: 'board' }), null); // vor der Scheibe
  assert.equal(throwDart(g, p, { p: [0.3, 1.73, 0], d: [0, 0, -1], on: 'board' }), null); // neben der Scheibe
  assert.equal(throwDart(g, p, { p: [NaN, 1, 0], d: [0, 0, -1], on: 'board' }), null);
  assert.equal(throwDart(g, p, { p: [0, 1, 0], d: [0, 0, -1], on: 'wand' }), null);
  assert.equal(throwDart(g, p, { p: [0.25, 1.73, -0.005], d: [0, 0, -1], on: 'surround' }).darts[0].hit.points, 0);
});

test('Ohne Hilfen: selbst eintragen – richtig, Fehlalarm kostet einen Pfeil, erwischt zählt 0', () => {
  let s = play({ free: true });
  const p = s.turn;
  s = visit(s, p, ['T20', 'S20', 'S1']); // 81
  assert.equal(s.rest[p], 501, 'ohne Hilfen rechnet niemand mit');
  assert.equal(pull(s, p), null, 'Punkte fehlen');
  assert.equal(pull(s, p, 500), null, 'Rest 1 geht nicht');
  const honest = pull(s, p, 81);
  assert.equal(honest.rest[p], 420);
  assert.equal(honest.cheat.legal, true);
  assert.deepEqual(honest.history[0].labels, [], 'Verlauf ohne Felder');
  assert.equal(forGuest(honest).cheat.legal, undefined);
  assert.equal(forGuest(honest).darts.every((d) => !d.hit), true);
  const alarm = accuse(honest, 1 - p);
  assert.equal(alarm.verdict.caught, false);
  assert.equal(dartsAllowed(alarm, 1 - p), 2);
  assert.equal(accuse(honest, p), null, 'nicht gegen sich selbst');
  // gelogen: 121 statt 81
  const lie = pull(s, p, 121);
  assert.equal(lie.cheat.legal, false);
  const caught = accuse(lie, 1 - p);
  assert.equal(caught.verdict.caught, true);
  assert.equal(caught.rest[p], 501, 'Aufnahme zählt 0');
  assert.equal(caught.turn, 1 - p);
  assert.equal(caught.history[0].points, 0);
  assert.equal(caught.stats[p].points, 0);
  assert.equal(dartsAllowed(caught, p), 2, 'Schummler hat nächstes Mal 2 Pfeile');
  assert.ok(reverted(caught));
  // Wurf des anderen beendet die Frist
  const thrown = throwDart(lie, 1 - p, at('S5'));
  assert.equal(thrown.cheat, null);
  assert.equal(accuse(thrown, 1 - p), null);
  // früher ziehen geht ohne Hilfen; zwei Pfeile mit Fehlalarm-Strafe
  let a = visit(alarm, 1 - p, ['S5', 'S5']);
  assert.equal(throwDart(a, 1 - p, at('S5')), null);
  a = pull(a, 1 - p, 10);
  assert.equal(dartsAllowed(a, 1 - p), 3, 'Strafe ist verbüßt');
});

test('Ohne Hilfen: falsches Checkout wird zurückgenommen, richtiges braucht „Nächstes Leg“', () => {
  let s = play({ free: true, mode: 301, bestOf: 3, starter: 0 });
  s = pull(visit(s, 0, ['T20', 'T20', 'T20']), 0, 180);
  s = pull(visit(s, 1, ['S1']), 1, 1);
  let lie = pull(visit(s, 0, ['T20', 'T20', 'S1']), 0, 121); // 121 ohne Doppel – behauptet
  assert.equal(lie.phase, 'legover');
  assert.deepEqual(lie.legs, [1, 0]);
  assert.equal(nextLegFree(lie, 0), null, 'der Werfer startet das nächste Leg nicht selbst');
  const caught = accuse(lie, 1);
  assert.equal(caught.phase, 'play');
  assert.deepEqual(caught.legs, [0, 0]);
  assert.equal(caught.rest[0], 121);
  assert.equal(caught.turn, 1);
  assert.match(caught.verdict.why, /kein gültiges Checkout/);
  const fine = pull(visit(s, 0, ['T20', 'T7', 'D20']), 0, 121);
  assert.equal(fine.cheat.legal, true);
  const next = nextLegFree(fine, 1);
  assert.deepEqual(next.rest, [301, 301]);
  assert.equal(next.turn, 1);
  const wrong = accuse(fine, 1);
  assert.equal(wrong.verdict.caught, false);
  assert.equal(wrong.phase, 'play', 'Fehlalarm nach Checkout: gleich das nächste Leg');
  assert.equal(dartsAllowed(wrong, 1), 2);
  // Partie-Ende: wer eingetragen hat, darf keine Revanche starten, solange die Frist läuft
  let m = play({ free: true, mode: 301, bestOf: 1, starter: 0 });
  m = pull(visit(m, 0, ['T20', 'T20', 'T20']), 0, 180);
  m = pull(visit(m, 1, ['S1']), 1, 1);
  m = pull(visit(m, 0, ['T20', 'T7', 'D20']), 0, 121);
  assert.equal(m.phase, 'over');
  assert.equal(again(m, 0), null);
  assert.ok(again(m, 1));
  assert.equal(OUTCOME.Darts(m), 0);
  assert.ok(waive(m, 1).cheat === null);
});

test('Computer zielt wie ein Spieler: T20 zum Punkten, Checkout-Wege, gute Reste', () => {
  assert.equal(chooseTarget(501, 3), 'T20');
  assert.equal(chooseTarget(170, 3), 'T20');
  assert.equal(chooseTarget(40, 3), 'D20');
  assert.equal(chooseTarget(50, 1), 'Bull');
  assert.equal(chooseTarget(3, 3), 'S1');
  // 1 Pfeil, kein Checkout: lässt einen Rest mit Weg, nie 1 oder weniger
  for (const r of [99, 61, 59, 103, 169]) {
    const t = chooseTarget(r, 1);
    assert.ok(r - value(t) >= 2, `${r}: ${t}`);
    assert.ok(checkout(r - value(t), 3), `${r}: ${t} lässt keinen Weg`);
  }
  // falscher Eintrag ist nie die Wahrheit und lässt keinen Rest 1
  for (let i = 0; i < 50; i++) {
    const c = fakeClaim({ points: 41, bust: false }, ['S20', 'S20', 'S1'], 301, () => i / 50);
    assert.ok(c !== 41 && 301 - c !== 1);
  }
});

test('Partie-Ende: Siegeraufnahme wird gleich gebucht (Schnitt, Verlauf), gezogen wird nicht mehr', () => {
  let s = play({ mode: 301, bestOf: 1, starter: 0 });
  s = pull(visit(s, 0, ['T20', 'T20', 'T20']), 0); // 180 → 121
  s = pull(visit(s, 1, ['S1', 'S1', 'S1']), 1);
  s = visit(s, 0, ['T20', 'T7', 'D20']); // 121 Checkout
  assert.equal(s.phase, 'over');
  assert.equal(s.history[0].points, 121);
  assert.deepEqual(s.history[0].labels, ['T20', 'T7', 'D20']);
  assert.equal(s.stats[0].darts, 6);
  assert.equal(average(s, 0), 150.5); // (180 + 121) / 6 · 3
  assert.equal(s.darts.length, 3, 'Pfeile bleiben stecken');
  assert.equal(pull(s, 0), null);
});

test('Ohne Hilfen: Strafen zählen zusammen, mindestens 1 Pfeil bleibt; Eintrag über dem Rest geht nicht', () => {
  let s = play({ free: true, starter: 0 });
  s = pull(visit(s, 0, ['S20']), 0, 20);
  s = accuse(s, 1); // Fehlalarm: Gast hat 2 Pfeile
  assert.equal(dartsAllowed(s, 1), 2);
  s = pull(visit(s, 1, ['S5']), 1, 5); // verbüßt
  s = pull(visit(s, 0, ['S20']), 0, 20);
  s = accuse(s, 1);
  assert.equal(dartsAllowed(s, 1), 2);
  const t = { ...s, short: [0, 2] };
  assert.equal(dartsAllowed(accuse({ ...t, cheat: { player: 0, legal: true, why: '', claim: 0, before: t } }, 1), 1), 1, 'nie weniger als 1 Pfeil');
  const r = visit(s, 1, ['S5']);
  assert.equal(pull(r, 1, r.rest[1] + 1), null);
  assert.equal(pull(r, 1, r.rest[1] - 1), null);
});
