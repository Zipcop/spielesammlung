// Minigolf-Regeln (src/minigolf/rules.js) und Anlage (course.js): Schläge zählen, Höchstwert 7, Strafschlag, Reihenfolge,
// Sieger, ohne Hilfen (selbst eintragen, Ball verlegen, „Geschummelt!“), Revanche und Kamera-Ansichten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyShot, applyClaim, applyMove, accuse, waive, again, forGuest, ballOf, total, onLane, MAX_SCORE } from '../src/minigolf/rules.js';
import { COURSE, HOLES, FLOOR, R, inLane, wallGap, toGo, GOLF_VIEWS, teeView, overView } from '../src/minigolf/course.js';
import { OUTCOME } from '../src/results.js';

const holed = { holed: true, out: false, pos: [0, 0, 0] };
const out = { holed: false, out: true, pos: [0, 0, 0] };
// Ball liegt ein Stück vor dem Abschlag auf der Bahn
const lies = (s, k = 1) => {
  const hole = COURSE[s.hole];
  const [x, , z] = hole.tee;
  return { holed: false, out: false, pos: [x + hole.dir[0] * 0.5 * k, FLOOR + R, z + hole.dir[1] * 0.5 * k] };
};
// Spieler am Zug locht mit n Schlägen ein
function play(s, n) {
  const p = s.turn;
  for (let i = 1; i < n; i++) s = applyShot(s, p, lies(s, i));
  return applyShot(s, p, holed);
}

test('Anlage: 9 Bahnen, Abschlag und Loch liegen auf der Bahn, Weg führt zum Loch, keine Bahn überlappt eine andere', () => {
  assert.equal(COURSE.length, HOLES);
  for (const hole of COURSE) {
    assert.ok(inLane(hole, [hole.tee[0], hole.tee[2]]), `${hole.name}: Abschlag`);
    assert.ok(inLane(hole, [hole.cup[0], hole.cup[2]]), `${hole.name}: Loch`);
    assert.ok(toGo(hole, [hole.cup[0], hole.cup[2]]) < 1e-6, `${hole.name}: Weg endet am Loch`);
    assert.ok(toGo(hole, [hole.tee[0], hole.tee[2]]) > 5, `${hole.name}: Bahn zu kurz`);
    assert.ok(hole.walls.length >= 4);
  }
  const box = (h) => {
    const xs = h.poly.map(([x]) => x);
    const zs = h.poly.map(([, z]) => z);
    return [Math.min(...xs) - 0.1, Math.max(...xs) + 0.1, Math.min(...zs) - 0.1, Math.max(...zs) + 0.1];
  };
  // L-förmige Bahn 3: nur die Rechtecke prüfen, die wirklich nebeneinanderliegen
  for (let a = 0; a < HOLES; a++) {
    for (let b = a + 1; b < HOLES; b++) {
      const [A, B] = [box(COURSE[a]), box(COURSE[b])];
      const apart = A[1] < B[0] || B[1] < A[0] || A[3] < B[2] || B[3] < A[2];
      assert.ok(apart, `Bahn ${a + 1} und ${b + 1} überlappen`);
    }
  }
});

test('Hindernisse zählen nicht zur Bahnfläche, Bande wird gemessen', () => {
  const tunnel = COURSE[4];
  const block = tunnel.blocks[1];
  assert.equal(inLane(tunnel, [block.c[0], block.c[2]]), false);
  const narrow = COURSE[0];
  const [x, , z] = narrow.frame.point(3.5, -0.5);
  assert.equal(inLane(narrow, [x, z]), false, 'im Keil');
  const [wx, , wz] = narrow.frame.point(1, 0.6 - R);
  assert.ok(Math.abs(wallGap(narrow, [wx, wz]) - R) < 1e-6);
});

test('Kamera: je Bahn Startansicht und Übersicht mit Grenzen am eigenen Ort (weit weg vom Zimmer)', () => {
  for (const hole of COURSE) {
    for (const name of [teeView(hole.n), overView(hole.n)]) {
      const [pos, target, place] = GOLF_VIEWS[name];
      assert.ok(Math.hypot(pos[0] - place.at[0], pos[2] - place.at[1]) < place.cam * Math.SQRT2, name);
      assert.ok(Math.abs(target[0] - place.at[0]) <= place.pan && Math.abs(target[2] - place.at[1]) <= place.pan, name);
      assert.ok(pos[1] <= place.yMax, `${name} zu hoch`);
      const dist = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
      const pitch = Math.asin((pos[1] - target[1]) / dist);
      assert.ok(pitch >= 0.3 && pitch <= 1.35, `${name}: Neigung ${pitch}`);
      assert.ok(dist <= place.dist, `${name}: Abstand ${dist}`);
      assert.ok(Math.abs(pos[0]) > 40, 'weit weg vom Zimmer');
    }
  }
  assert.deepEqual(GOLF_VIEWS.golf0, GOLF_VIEWS[teeView(0)]);
});

test('Schläge zählen, eingelocht = eingetragen, dann ist der andere dran, danach die nächste Bahn', () => {
  let s = newGame({ starter: 0 });
  assert.deepEqual(ballOf(s), [COURSE[0].tee[0], FLOOR + R, COURSE[0].tee[2]]);
  s = applyShot(s, 0, lies(s));
  assert.equal(s.count, 1);
  assert.equal(applyShot(s, 1, lies(s)), null, 'nicht dran');
  s = applyShot(s, 0, holed);
  assert.equal(s.scores[0][0], 2);
  assert.equal(s.turn, 1);
  assert.equal(s.ball, null);
  s = play(s, 3);
  assert.equal(s.scores[1][0], 3);
  assert.equal(s.hole, 1);
  assert.equal(s.turn, 1, 'auf Bahn 2 fängt der andere an');
  assert.ok(s.events.some((e) => e.type === 'hole' && e.hole === 1));
});

test('Höchstens 6 Schläge: nicht eingelocht = 7 notiert (IntSpR 9.1)', () => {
  let s = newGame({ starter: 0 });
  for (let i = 1; i <= 5; i++) s = applyShot(s, 0, lies(s, i));
  assert.equal(s.count, 5);
  s = applyShot(s, 0, lies(s, 6));
  assert.equal(s.scores[0][0], MAX_SCORE);
  assert.equal(s.turn, 1);
  // mit dem 6. Schlag eingelocht = 6
  let t = newGame({ starter: 0 });
  for (let i = 1; i <= 5; i++) t = applyShot(t, 0, lies(t, i));
  t = applyShot(t, 0, holed);
  assert.equal(t.scores[0][0], 6);
});

test('Ball von der Bahn: zurück an die Schlagstelle und ein Strafschlag – zählt zur Höchstgrenze', () => {
  let s = newGame({ starter: 0 });
  s = applyShot(s, 0, lies(s));
  const before = s.ball;
  s = applyShot(s, 0, out);
  assert.equal(s.count, 3);
  assert.deepEqual(s.ball, before);
  s = applyShot(s, 0, holed);
  assert.equal(s.scores[0][0], 4);
  // 4 Schläge, dann draußen (5 + Strafe = 6): Schluss, 7 notiert
  let t = newGame({ starter: 0 });
  for (let i = 1; i <= 4; i++) t = applyShot(t, 0, lies(t, i));
  t = applyShot(t, 0, out);
  assert.equal(t.scores[0][0], MAX_SCORE);
});

test('Ungültige Meldungen werden abgelehnt (neben der Bahn, unmöglich, kaputt)', () => {
  const s = newGame({ starter: 0 });
  assert.equal(applyShot(s, 0, { holed: false, out: false, pos: [999, FLOOR + R, 0] }), null);
  assert.equal(applyShot(s, 0, { holed: true, out: true, pos: [0, 0, 0] }), null);
  assert.equal(applyShot(s, 0, { holed: false, out: false, pos: [NaN, 0, 0] }), null);
  assert.equal(applyShot(s, 0, null), null);
  const [x, , z] = COURSE[0].tee;
  assert.equal(applyShot(s, 0, { holed: false, out: false, pos: [x, FLOOR + 0.5, z] }), null, 'schwebt');
});

test('Nach 9 Bahnen: weniger Schläge gewinnt, gleich viele = unentschieden, Statistik liest das Ergebnis', () => {
  let s = newGame({ starter: 0 });
  for (let h = 0; h < HOLES; h++) {
    s = play(s, s.turn === 0 ? 2 : 3);
    s = play(s, s.turn === 0 ? 2 : 3);
  }
  assert.deepEqual(s.result, { winner: 0 });
  assert.equal(total(s, 0), 18);
  assert.equal(total(s, 1), 27);
  assert.deepEqual(s.wins, [1, 0]);
  assert.equal(OUTCOME.Minigolf(s), 0);
  assert.equal(OUTCOME.Minigolf(newGame()), undefined);
  assert.equal(applyShot(s, s.turn, holed), null, 'vorbei');
  const next = again(s, 1);
  assert.equal(next.starter, 1);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(next.round, 2);
  let d = newGame({ starter: 1 });
  for (let h = 0; h < HOLES * 2; h++) d = play(d, 2);
  assert.deepEqual(d.result, { winner: null });
  assert.equal(OUTCOME.Minigolf(d), null);
});

test('Ohne Hilfen: Schläge selbst eintragen – falsch eingetragen und erwischt = berichtigt + 2 Strafschläge', () => {
  let s = newGame({ starter: 0, free: true });
  s = applyShot(s, 0, lies(s));
  s = applyShot(s, 0, lies(s, 2));
  s = applyShot(s, 0, holed);
  assert.equal(s.phase, 'claim');
  assert.deepEqual(s.claim, { player: 0, truth: 3 });
  assert.equal(applyShot(s, 0, lies(s)), null, 'erst eintragen');
  assert.equal(applyClaim(s, 1, 2), null, 'nur der Spieler selbst');
  assert.equal(applyClaim(s, 0, 0), null);
  assert.equal(applyClaim(s, 0, 8), null);
  s = applyClaim(s, 0, 2);
  assert.equal(s.scores[0][0], 2);
  assert.equal(s.turn, 1);
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(forGuest(s).cheat, { player: 0 }, 'Gast sieht den Grund nicht');
  assert.equal(accuse(s, 0), null, 'sich selbst anklagen geht nicht');
  const caught = accuse(s, 1);
  assert.equal(caught.scores[0][0], 3);
  assert.deepEqual(caught.penalty, [2, 0]);
  assert.equal(total(caught, 0), 5);
  assert.match(caught.events[0].why, /2 statt 3 Schläge auf Bahn 1/);
  assert.equal(caught.events[0].type, 'caught');
});

test('Ohne Hilfen: ehrlich eingetragen, trotzdem gerufen = Fehlalarm, 1 Strafschlag für den Rufer', () => {
  let s = newGame({ starter: 0, free: true });
  s = applyShot(s, 0, holed);
  s = applyClaim(s, 0, 1);
  assert.equal(s.cheat.legal, true);
  const alarm = accuse(s, 1);
  assert.deepEqual(alarm.penalty, [0, 1]);
  assert.equal(alarm.events[0].type, 'fehlalarm');
  // der andere schlägt selbst – dann geht „Geschummelt!“ nicht mehr
  const played = applyShot(s, 1, lies(s));
  assert.equal(played.cheat, null);
  assert.equal(accuse(played, 1), null);
  assert.equal(waive(s, 0), null);
  assert.equal(waive(s, 1).cheat, null);
});

test('Ohne Hilfen: Ball verlegen – bis 20 cm an der Bande erlaubt, sonst Schummeln; mit Hilfen gar nicht', () => {
  assert.equal(applyMove(newGame({ starter: 0 }), 0, lies(newGame()).pos), null);
  let s = newGame({ starter: 0, free: true });
  const hole = COURSE[0];
  const [x, , z] = hole.frame.point(2, 0.6 - R - 0.005); // liegt an der rechten Bande
  s = { ...s, ball: [x, FLOOR + R, z], count: 1 };
  const [nx, , nz] = hole.frame.point(2, 0.45);
  const ok = applyMove(s, 0, [nx, FLOOR + R, nz]);
  assert.equal(ok.cheat.legal, true);
  const [fx, , fz] = hole.frame.point(4.5, 0);
  const far = applyMove(s, 0, [fx, FLOOR + R, fz]);
  assert.equal(far.cheat.legal, false);
  assert.match(far.cheat.why[0], /Ball um \d+ cm verlegt/);
  assert.equal(accuse(far, 1).penalty[0], 2);
  // mitten auf der Bahn liegt er nicht an der Bande: auch 10 cm sind dann Schummeln
  const mid = { ...s, ball: hole.frame.point(2, 0).map((v, i) => (i === 1 ? FLOOR + R : v)) };
  const [mx, , mz] = hole.frame.point(2.1, 0);
  assert.match(applyMove(mid, 0, [mx, FLOOR + R, mz]).cheat.why[0], /lag nicht an der Bande/);
  assert.equal(applyMove(s, 1, [nx, FLOOR + R, nz]), null, 'nicht dran');
  assert.equal(onLane(0, [999, FLOOR + R, 0]), false);
});

test('Ohne Hilfen: Ablegen nur einmal je Schlag und gerade von der Bande weg – entlang der Bande schieben ist Schummeln', () => {
  const hole = COURSE[0];
  const at = (u, v) => { const [x, , z] = hole.frame.point(u, v); return [x, FLOOR + R, z]; };
  let s = { ...newGame({ starter: 0, free: true }), ball: at(2, 0.6 - R - 0.005), count: 1 };
  // 19 cm an der Bande entlang: kurz genug, aber nicht von der Bande weg
  const along = applyMove(s, 0, at(2.19, 0.6 - R - 0.005));
  assert.equal(along.cheat.legal, false);
  assert.match(along.cheat.why[0], /nicht gerade von der Bande weg/);
  // einmal gerade weg = erlaubt, gleich nochmal = Schummeln (auch wenn es wieder 10 cm wären)
  s = applyMove(s, 0, at(2, 0.45));
  assert.equal(s.cheat.legal, true);
  assert.equal(s.moved, true);
  const again2 = applyMove(s, 0, at(2, 0.35));
  assert.equal(again2.cheat.legal, false);
  assert.match(again2.cheat.why[0], /noch einmal verlegt/);
  assert.equal(again2.cheat.last, false);
  // nach dem nächsten Schlag darf wieder abgelegt werden
  const shot = applyShot(s, 0, { holed: false, out: false, pos: at(3, 0.6 - R - 0.004) });
  assert.equal(shot.moved, false);
  assert.equal(applyMove(shot, 0, at(3, 0.42)).cheat.last, true);
});

test('Ball liegt direkt an einem Hindernis: zählt als auf der Bahn (wie ihn die Physik hinlegt), mitten im Stein nicht', () => {
  const hole = COURSE[4];
  const face = hole.blocks[1].c[2] + hole.blocks[1].half[0]; // Vorderkante des Riegels (Bahn läuft nach −z)
  const [x] = hole.frame.point(4.2, 0.3);
  assert.equal(onLane(4, [x, FLOOR + R, face + R - 0.002]), true, 'angelehnt');
  assert.equal(onLane(4, [x, FLOOR + R, face - 0.05]), false, 'im Riegel');
});

test('Ohne Hilfen: mehrere Schummeleien hintereinander werden zusammen angeklagt, Revanche erst nach der Prüfung', () => {
  let s = newGame({ starter: 0, free: true });
  const hole = COURSE[0];
  const [fx, , fz] = hole.frame.point(4.5, 0);
  s = applyMove(s, 0, [fx, FLOOR + R, fz]);
  s = applyShot(s, 0, holed);
  s = applyClaim(s, 0, 1);
  assert.equal(s.cheat.why.length, 1, 'ehrlicher Eintrag kommt nicht dazu');
  assert.equal(s.cheat.legal, false);
  // ganze Partie zu Ende spielen, der letzte Eintrag ist falsch
  let t = newGame({ starter: 0, free: true });
  for (let h = 0; h < HOLES * 2; h++) {
    const p = t.turn;
    t = applyShot(t, p, lies(t));
    t = applyShot(t, p, holed);
    t = applyClaim(t, p, h === HOLES * 2 - 1 ? 1 : 2);
  }
  assert.ok(t.result);
  const cheater = t.cheat.player;
  assert.equal(again(t, cheater), null, 'wer zuletzt eingetragen hat, startet die Revanche nicht');
  const fixed = accuse(t, 1 - cheater);
  assert.equal(total(fixed, cheater), 18 + 2);
  assert.ok(fixed.result, 'Ergebnis neu berechnet');
  assert.ok(again(fixed, cheater));
});
