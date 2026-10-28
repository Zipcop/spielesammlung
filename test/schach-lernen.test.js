// Lernen mit Schach-Rätseln (src/schach/lernen.js): Tagesrätsel, Serie, Sturm, Wiederholen mit Abstand,
// Schwächen-Profil, eigene Fehler aus der Analyse, Nullzug für „Drohung zeigen“ (+ Satz aus coach.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { puzzleFrom, isRight, PICKABLE } from '../src/schach/puzzle.js';
import { threatText } from '../src/schach/coach.js';
import {
  dayOf, addDays, normalize, fresh, dailyPuzzle, pickDaily, solveDaily, currentStreak, dailyDone, dayHint, DAILY_WINDOW,
  recordMotifs, weaknesses, focusTheme, collectMistakes, puzzleMistake, addMistakes, reviewMistake, mistakeQueue,
  mistakePuzzle, alsoRight, dueCount, stormTarget, stormPick, stormStart, stormStep, stormLeft, stormEnd, STORM_MS, STORM_LIVES,
  earned, newAchievements, nullMoveFen,
} from '../src/schach/lernen.js';

const LIST = JSON.parse(readFileSync(new URL('../src/schach/puzzles.json', import.meta.url)));

test('Datum: Ortszeit als YYYY-MM-DD, Tage rechnen über Monats-, Jahres- und Schaltjahrgrenzen und Zeitumstellung', () => {
  assert.equal(dayOf(new Date(2026, 9, 28, 23, 59)), '2026-10-28');
  assert.equal(dayOf(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // Schaltjahr
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-03-28', 1), '2026-03-29'); // Sommerzeit beginnt am 29.03.2026
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // Winterzeit am 25.10.2026
  assert.equal(addDays('2026-10-28', 7), '2026-11-04');
});

test('Tagesrätsel: gleicher Tag + gleiche Wertung = gleiches Rätsel, immer im Fenster ±200', () => {
  const a = dailyPuzzle(LIST, '2026-10-28', 1200);
  assert.deepEqual(dailyPuzzle(LIST, '2026-10-28', 1200), a);
  assert.ok(Math.abs(a[3] - 1200) <= DAILY_WINDOW);
  const days = Array.from({ length: 30 }, (_, i) => addDays('2026-10-01', i));
  const rows = days.map((d) => dailyPuzzle(LIST, d, 1500));
  assert.ok(rows.every((r) => Math.abs(r[3] - 1500) <= 200), 'alle im Fenster');
  assert.ok(new Set(rows.map((r) => r[0])).size >= 25, 'fast jeden Tag ein anderes');
  // ganz unten/oben: Fenster wird breiter, aber es gibt trotzdem eins
  assert.ok(dailyPuzzle(LIST, '2026-10-28', 100));
  assert.ok(dailyPuzzle(LIST, '2026-10-28', 3500));
  assert.equal(dailyPuzzle([], '2026-10-28', 1200), null);
});

test('Tagesrätsel bleibt den ganzen Tag gleich, auch wenn sich die Wertung ändert – am nächsten Tag neu', () => {
  const first = pickDaily(fresh().daily, LIST, '2026-10-28', 1200);
  const later = pickDaily(first.daily, LIST, '2026-10-28', 1650);
  assert.equal(later.row[0], first.row[0]);
  const tomorrow = pickDaily(later.daily, LIST, '2026-10-29', 1650);
  assert.equal(tomorrow.daily.pick.date, '2026-10-29');
  assert.ok(Math.abs(tomorrow.row[3] - 1650) <= 200);
});

test('Serie: Tage in Folge, über Monats- und Jahreswechsel; Lücke = neu ab 1; zweimal am Tag zählt einmal', () => {
  let d = fresh().daily;
  for (const day of ['2026-12-30', '2026-12-31', '2027-01-01']) d = solveDaily(d, day);
  assert.equal(d.streak, 3);
  assert.equal(solveDaily(d, '2027-01-01'), d); // gleicher Tag
  d = solveDaily(d, '2027-01-02');
  assert.equal(d.streak, 4);
  assert.equal(d.best, 4);
  d = solveDaily(d, '2027-01-04'); // 03.01. ausgelassen
  assert.equal(d.streak, 1);
  assert.equal(d.best, 4);
  assert.deepEqual(d.solved, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-04']);
  let m = fresh().daily;
  for (const day of ['2026-10-30', '2026-10-31', '2026-11-01']) m = solveDaily(m, day);
  assert.equal(m.streak, 3);
  // wie sie heute steht: gestern gelöst = läuft noch, vorgestern = gerissen
  assert.equal(currentStreak(m, '2026-11-02'), 3);
  assert.equal(currentStreak(m, '2026-11-03'), 0);
  assert.equal(dailyDone(m, '2026-11-01'), true);
  assert.equal(dailyDone(m, '2026-11-02'), false);
  // beim Laden steht eine gerissene Serie auf 0, der Bestwert bleibt
  const loaded = normalize({ daily: m }, '2026-11-05');
  assert.equal(loaded.daily.streak, 0);
  assert.equal(loaded.daily.best, 3);
  assert.match(dayHint(normalize({ daily: m }, '2026-11-02'), '2026-11-02'), /noch offen · Serie: 3 Tage \(Bestwert 3\)/);
  assert.match(dayHint(normalize({ daily: m }, '2026-11-01'), '2026-11-01'), /heute gelöst ✓/);
});

test('Gespeicherter Stand: Unsinn fällt auf Anfangswerte zurück', () => {
  assert.deepEqual(normalize(null), fresh());
  assert.deepEqual(normalize('kaputt'), fresh());
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const n = normalize({ daily: { streak: -3, solved: ['x', '2026-10-28'] }, motifs: { fork: { right: '2', wrong: 1 } }, mistakes: [{ id: 1 }, { id: 'a', fen: start, best: 'e2e4', due: '2026-10-28', step: 9 }], storm: { best: 'viel' } }, '2026-10-28');
  assert.equal(n.daily.streak, 0);
  assert.deepEqual(n.daily.solved, ['2026-10-28']);
  assert.deepEqual(n.motifs.fork, { right: 0, wrong: 1 });
  assert.equal(n.mistakes.length, 1);
  assert.equal(n.mistakes[0].step, 3);
  assert.equal(n.storm.best, 0);
  assert.equal(n.solved, null);
});

test('Gespeicherte Fehler: kaputte Stellung oder Lösung fällt weg, falsche Nebenfelder stürzen nichts ab', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const base = { due: '2026-10-28', step: 0 };
  const n = normalize({ mistakes: [
    { ...base, id: 'fen', fen: 'kaputt', best: 'e2e4' }, // keine Stellung
    { ...base, id: 'zug', fen: start, best: 'e2e5' }, // Lösung nicht erlaubt
    { ...base, id: 'ok', fen: start, best: 'e2e4', also: 5, played: 7, date: 3, theme: {}, puzzle: 9, src: 'partie' },
  ] }, '2026-10-28');
  assert.deepEqual(n.mistakes.map((m) => m.id), ['ok']);
  const [m] = n.mistakes;
  const p = mistakePuzzle(m);
  assert.doesNotThrow(() => alsoRight(p, 0, 'd2d4'));
  assert.equal(isRight(p, 0, 'e2e4'), true);
  assert.deepEqual(m.also, []);
  assert.equal(m.played, null);
  assert.equal(m.date, '2026-10-28'); // dann gilt die Fälligkeit
  assert.equal(m.theme, undefined);
  assert.equal(m.puzzle, undefined);
});

test('Rätsel-Sturm: immer schwerer, 3 Fehler = vorbei, 3 Minuten, Rekord', () => {
  assert.ok(stormTarget(1) > stormTarget(0));
  assert.ok(stormTarget(20) >= stormTarget(0) + 1000);
  let s = stormStart(1000);
  assert.equal(stormLeft(s, 1000), STORM_MS);
  assert.equal(STORM_MS, 180000);
  for (const right of [true, true, false, true, false]) s = stormStep(s, right);
  assert.deepEqual({ score: s.score, errors: s.errors, index: s.index, over: s.over }, { score: 3, errors: 2, index: 5, over: false });
  s = stormStep(s, false);
  assert.equal(STORM_LIVES, 3);
  assert.equal(s.over, true);
  assert.equal(stormLeft(s, 1000 + 179000), 1000);
  assert.equal(stormLeft(s, 1000 + 200000), 0);
  assert.deepEqual(stormEnd({ best: 5, runs: 2 }, 3), { best: 5, runs: 3 });
  assert.deepEqual(stormEnd({ best: 5, runs: 2 }, 9), { best: 9, runs: 3 });
  // jedes Rätsel mindestens so schwer wie das vorige, keins doppelt
  const seen = new Set();
  const rows = Array.from({ length: 30 }, (_, i) => {
    const row = stormPick(LIST, i, seen);
    seen.add(row[0]);
    return row;
  });
  assert.equal(seen.size, 30);
  rows.slice(1).forEach((r, i) => assert.ok(r[3] >= rows[i][3], `${r[3]} nach ${rows[i][3]}`));
});

test('Wiederholen mit Abstand: richtig → 1, 3, 7 Tage → erledigt; falsch → wieder ab 1 Tag', () => {
  const day = '2026-10-28';
  let m = { id: 'x', fen: 'f', best: 'e2e4', due: day, step: 0 };
  m = reviewMistake(m, true, day);
  assert.deepEqual([m.step, m.due], [1, '2026-10-29']);
  m = reviewMistake(m, true, '2026-10-29');
  assert.deepEqual([m.step, m.due], [2, '2026-11-01']);
  m = reviewMistake(m, true, '2026-11-01');
  assert.deepEqual([m.step, m.due], [3, '2026-11-08']);
  assert.equal(reviewMistake(m, true, '2026-11-08'), null); // erledigt
  const wrong = reviewMistake(m, false, '2026-11-08');
  assert.deepEqual([wrong.step, wrong.due], [0, '2026-11-09']);
  // zu früh geübt: richtig ändert nichts, falsch setzt zurück
  assert.equal(reviewMistake(m, true, '2026-11-02'), m);
  assert.equal(reviewMistake(m, false, '2026-11-02').due, '2026-11-03');
  // fällige zuerst
  const list = [{ id: 'a', due: '2026-11-05' }, { id: 'b', due: '2026-10-20' }, { id: 'c', due: '2026-10-28' }, { id: 'd', due: '2026-10-20' }];
  assert.deepEqual(mistakeQueue(list, day).map((x) => x.id), ['b', 'd', 'c', 'a']);
  assert.equal(dueCount(list, day), 3);
});

test('Fehler sammeln: doppelte bleiben einmal, höchstens 200', () => {
  const e = (id) => ({ id, fen: 'f', best: 'e2e4', due: '2026-10-28', step: 0 });
  const a = addMistakes([e('a')], [e('a'), e('b'), e('b')]);
  assert.deepEqual(a.map((m) => m.id), ['a', 'b']);
  const many = addMistakes([], Array.from({ length: 250 }, (_, i) => e(`m${i}`)));
  assert.equal(many.length, 200);
  assert.equal(many[0].id, 'm50'); // die ältesten fallen raus
});

test('Schwächen-Profil: Quote je Thema, erst ab 5 Versuchen, schlechtestes zuerst → „Gezielt üben“', () => {
  let m = {};
  const add = (themes, right, n) => {
    for (let i = 0; i < n; i++) m = recordMotifs(m, themes, right);
  };
  add(['fork', 'endgame'], true, 2);
  add(['fork'], false, 3); // Gabel 2/5 = 40 %
  add(['pin'], true, 3);
  add(['pin', 'pin'], false, 2); // doppelt genanntes Thema zählt einmal → Fesselung 3/5 = 60 %
  add(['skewer'], false, 4); // nur 4 Versuche – noch nicht im Profil
  add(['doubleCheck'], false, 9); // nicht wählbar im Panel
  assert.deepEqual(m.pin, { right: 3, wrong: 2 });
  const w = weaknesses(m);
  assert.deepEqual(w.map((x) => [x.theme, x.percent]), [['fork', 40], ['pin', 60]]);
  assert.equal(focusTheme(m), 'fork');
  assert.ok(PICKABLE.includes(focusTheme(m)));
  assert.equal(focusTheme({}), null);
  assert.deepEqual(weaknesses(m, { only: ['doubleCheck'] }).map((x) => x.percent), [0]);
});

// 1. e4 e5 2. Dh5 Sc6 3. Lc4 Sf6?? 4. Dxf7# – ich habe Schwarz
const GAME = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
const fens = (() => {
  const c = new Chess();
  const out = [c.fen()];
  for (const m of GAME) {
    c.move({ from: m.slice(0, 2), to: m.slice(2, 4) });
    out.push(c.fen());
  }
  return out;
})();

test('Eigene Fehler aus der Analyse: nur Fehler/Patzer/Verpasst meiner Züge, Stellung davor, Lösung = bester Zug', () => {
  const view = { mine: 'b', verdicts: [null, 'buch', null, 'gut', 'patzer', 'patzer', null] };
  const coachView = (i) => ({
    fenBefore: fens[i],
    better: i === 5 ? ['g7g6', 'h5f7'] : ['e1g1'],
    best: { cp: -40 },
    second: i === 5 ? { uci: 'd8e7', score: { cp: -55 } } : null,
  });
  const found = collectMistakes(view, coachView, GAME, '2026-10-28');
  assert.equal(found.length, 1, 'Zug 4 (Weiß) ist nicht meiner');
  const [m] = found;
  assert.equal(m.fen, fens[5]);
  assert.equal(m.best, 'g7g6');
  assert.deepEqual(m.also, ['d8e7']); // nur 15 Hundertstel schlechter → zählt auch
  assert.equal(m.played, 'Nf6');
  assert.equal(m.kind, 'patzer');
  assert.equal(m.step, 0);
  assert.equal(m.due, '2026-10-28');
  // zweitbester deutlich schlechter → nur der beste zählt; noch nicht gerechnet → fehlt
  const far = collectMistakes(view, (i) => ({ ...coachView(i), second: { uci: 'd8e7', score: { cp: -400 } } }), GAME, '2026-10-28');
  assert.deepEqual(far[0].also, []);
  assert.deepEqual(collectMistakes(view, () => null, GAME, '2026-10-28'), []);
  // als Rätsel: ich bin am Zug (Schwarz), kein Vorzug des Gegners
  const p = mistakePuzzle(m);
  assert.equal(p.lead, 0);
  assert.equal(p.color, 'b');
  assert.equal(isRight(p, 0, 'g7g6'), true);
  assert.equal(isRight(p, 0, 'd8e7') || alsoRight(p, 0, 'd8e7'), true);
  assert.equal(isRight(p, 0, 'g8f6') || alsoRight(p, 0, 'g8f6'), false);
});

test('Verpasstes Rätsel kommt in die Wiederholung – später wieder als ganzes Rätsel', () => {
  const row = ['0000D', '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', 'd3d6 f8d8 d6d8 f6d8', 1529, 'endgame'];
  const p = puzzleFrom(row);
  const m = puzzleMistake(p, '2026-10-28');
  assert.equal(m.best, 'f8d8');
  assert.equal(m.puzzle, '0000D');
  assert.equal(m.theme, 'endgame');
  assert.equal(new Chess(m.fen).turn(), 'b'); // nach dem Zug des Gegners
  const again = mistakePuzzle(m, row);
  assert.equal(again.lead, 1);
  assert.deepEqual(again.line, p.line);
  const alone = mistakePuzzle(m); // Datenzeile nicht mehr da → nur der erste Zug
  assert.equal(isRight(alone, 0, 'f8d8'), true);
});

test('Erfolge: aus den Zahlen, neue werden erkannt', () => {
  const a = fresh();
  assert.deepEqual(earned(a), []);
  const b = { ...a, daily: { ...a.daily, best: 7, solved: ['2026-10-28'] }, solved: 100, storm: { best: 21, runs: 4 }, cleared: 1 };
  assert.deepEqual(earned(b), ['tag1', 'serie3', 'serie7', 'r10', 'r100', 'sturm10', 'sturm20', 'fehler1']);
  assert.deepEqual(newAchievements({ ...b, storm: { best: 19, runs: 3 } }, b).map((x) => x.id), ['sturm20']);
});

test('Nullzug: anderes Zugrecht, en passant weg, Zähler weiter – im Schach nicht möglich', () => {
  // nach 1. e4: Schwarz am Zug, en-passant-Feld e3
  const after = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
  assert.equal(nullMoveFen(after), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2');
  const white = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  assert.equal(nullMoveFen(white), 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 3');
  assert.doesNotThrow(() => new Chess(nullMoveFen(white)));
  // en passant mitten im Spiel: weißer Bauer e5 könnte d6 schlagen – nach dem Nullzug nicht mehr
  const ep = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
  assert.equal(nullMoveFen(ep).split(' ')[3], '-');
  // Weiß steht im Schach (Lb4+) → kein Nullzug
  assert.equal(nullMoveFen('rnbqk1nr/pppp1ppp/8/4p3/1b1P4/8/PPP1PPPP/RNBQKBNR w KQkq - 1 3'), null);
});

test('Drohung als Satz (coach.js): ungedeckte Figur, Matt, keine echte Drohung', () => {
  // Ich (Weiß) bin am Zug, mein Läufer e5 ist ungedeckt – nach dem Nullzug schlägt der Springer ihn
  const pass = nullMoveFen('6k1/8/2n5/4B3/8/8/8/6K1 w - - 0 40');
  const t = threatText(pass, ['c6e5'], { cp: 320 });
  assert.equal(t.uci, 'c6e5');
  assert.equal(t.threat, true);
  assert.equal(t.text, 'Droht **Sxe5** und gewinnt deinen Läufer auf e5 (ungedeckt).');
  // Grundreihe: Schwarz droht Td1#
  const mate = nullMoveFen('3r2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 30');
  assert.equal(threatText(mate, ['d8d1'], { mate: 1 }).text, 'Droht **Td1#** – Schachmatt!');
  // ruhige Stellung: kein Gewinn
  const calm = nullMoveFen('6k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 30');
  const c = threatText(calm, ['g8f8'], { cp: 0 });
  assert.equal(c.threat, false);
  assert.match(c.text, /^Keine akute Drohung – sein bester Zug wäre \*\*Kf8\*\*\.$/);
});
