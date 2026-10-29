// Air-Hockey-Regeln (rein): Tore bis 7, Puck zum Getroffenen, 7-Sekunden-Regel, Schläger-Grenzen, Revanche
// und „Ohne Hilfen“: Verstöße merken, erwischt (Strafpunkt, Tor zählt nicht), Fehlalarm, Sieg wieder offen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, goal, sevenSeconds, foul, accuse, again, againWait, recentFoul, clampMallet, overLine, serveSpot, TABLE, RM, WIN, ACCUSE_S, REACH } from '../src/airhockey/rules.js';
import { crossing } from '../src/airhockey/ai.js';
import { OUTCOME, reverted } from '../src/results.js';

const goals = (s, list) => list.reduce((x, p) => goal(x, p), s);

test('Tor: Punkt für den Schützen, der Getroffene bekommt den Puck', () => {
  const s = goal(newGame({ starter: 0 }), 0);
  assert.deepEqual(s.score, [1, 0]);
  assert.equal(s.serve, 1);
  assert.equal(s.reset, 1);
  assert.equal(s.winner, null);
  assert.ok(serveSpot(1)[1] < 0, 'Puck kommt in die Hälfte des Gasts (−z)');
});

test('Wer zuerst 7 Tore hat, gewinnt – danach zählt kein Tor mehr, Revanche: der Verlierer fängt an', () => {
  const s = goals(newGame({ starter: 0 }), [1, 1, 0, 1, 1, 1, 0, 1, 1]);
  assert.deepEqual(s.score, [2, WIN]);
  assert.equal(s.winner, 1);
  assert.deepEqual(s.wins, [0, 1]);
  assert.equal(goal(s, 0), null);
  assert.equal(OUTCOME['Air-Hockey'](s), 1);
  assert.equal(OUTCOME['Air-Hockey'](newGame()), undefined);
  const r = again(s, 0);
  assert.deepEqual(r.score, [0, 0]);
  assert.deepEqual(r.wins, [0, 1]);
  assert.equal(r.serve, 0);
  assert.equal(r.round, 2);
});

test('7 Sekunden in der eigenen Hälfte: mit Hilfen bekommt der andere den Puck', () => {
  const s = sevenSeconds(newGame({ starter: 0 }), 0);
  assert.equal(s.serve, 1);
  assert.equal(s.reset, 1);
  assert.equal(s.events[0].type, 'sieben');
});

test('Schläger: mit Hilfen ganz in der eigenen Hälfte und innerhalb der Banden, ohne Hilfen ein Stück drüber', () => {
  const { L, W } = TABLE;
  assert.deepEqual(clampMallet(0, [9, -9]), [W / 2 - RM, RM]);
  assert.deepEqual(clampMallet(1, [-9, 9]), [-W / 2 + RM, -RM]);
  assert.deepEqual(clampMallet(0, [0, 9]), [0, L / 2 - RM]);
  assert.deepEqual(clampMallet(0, [0, -9], true), [0, -REACH]);
  assert.equal(overLine(0, -0.01), true);
  assert.equal(overLine(1, -0.01), false);
});

test('Mit Hilfen gibt es weder Verstöße noch Anklagen', () => {
  const s = newGame();
  assert.equal(foul(s, 0, 'linie'), null);
  assert.equal(accuse(s, 1), null);
});

test('Ohne Hilfen: 7 Sekunden werden nur gemerkt, „Geschummelt!“ erwischt – Strafpunkt, der Schummler bekommt den Puck', () => {
  let s = newGame({ starter: 0, free: true });
  s = sevenSeconds(s, 0, 10);
  assert.equal(s.serve, 0, 'kein Foul von selbst');
  assert.equal(recentFoul(s, 0, 12).why, 'sieben');
  const c = accuse(s, 1, 12);
  assert.deepEqual(c.score, [0, 1]);
  assert.equal(c.serve, 0);
  assert.equal(c.events[0].type, 'caught');
  assert.match(c.events[0].why, /7 Sekunden/);
  assert.equal(reverted(c), true);
  assert.equal(recentFoul(c, 0, 12), null, 'der Verstoß ist abgegolten');
});

test('Ohne Hilfen: Fehlalarm hält nichts an (keine Notbremse), jeder zweite ist ein Strafpunkt für den anderen', () => {
  const s = foul(newGame({ starter: 1, free: true }), 0, 'linie', 10);
  const late = accuse(s, 1, 10 + ACCUSE_S + 0.1);
  assert.equal(late.events[0].type, 'fehlalarm');
  assert.equal(late.events[0].penalty, false);
  assert.deepEqual(late.score, [0, 0]);
  assert.equal(late.serve, s.serve, 'Puck bleibt, wo er ist');
  assert.equal(late.reset, s.reset, 'nicht neu hingelegt – das Spiel läuft weiter');
  assert.deepEqual(late.alarms, [0, 1]);
  const second = accuse(late, 1, 20);
  assert.equal(second.events[0].penalty, true);
  assert.deepEqual(second.score, [1, 0], 'Strafpunkt für den Beschuldigten');
  assert.equal(second.serve, 1, 'der Rufer bekommt den Puck wie nach einem Gegentor');
  assert.equal(second.reset, late.reset + 1);
  assert.deepEqual(second.alarms, [0, 2]);
  const third = accuse(second, 1, 30);
  assert.deepEqual(third.score, [1, 0], 'der dritte kostet wieder nichts');
});

test('Ohne Hilfen: Fehlalarm-Strafpunkt kann die Partie entscheiden', () => {
  let s = goals(newGame({ free: true }), [0, 0, 0, 0, 0, 0]);
  s = accuse(accuse(s, 1, 1), 1, 2);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.wins, [1, 0]);
});

test('Ohne Hilfen: Revanche-Wartezeit des Siegers', () => {
  let s = goals(newGame({ free: true }), [0, 0, 0, 0, 0, 0]);
  s = foul(s, 0, 'linie', 10);
  s = goal(s, 0, 12);
  assert.equal(againWait(s, 0, 12), 3);
  assert.equal(againWait(s, 1, 12), 0, 'der Verlierer wartet nie');
  assert.equal(againWait(s, 0, 16), 0);
  assert.ok(again(s, 0, 15.1));
});

test('Ohne Hilfen: Tor mit frischem Verstoß zählt nicht, auch das Siegtor – die Partie geht weiter', () => {
  let s = newGame({ starter: 0, free: true });
  s = goals(s, [0, 0, 0, 0, 0, 0]);
  s = foul(s, 0, 'topping', 20);
  s = goal(s, 0, 21);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.wins, [1, 0]);
  assert.equal(again(s, 0, 22), null, 'der Sieger wartet, bis die Anklage verjährt ist');
  const c = accuse(s, 1, 22);
  assert.deepEqual(c.score, [6, 1], 'Siegtor weg, Strafpunkt für den Rufer');
  assert.equal(c.winner, null);
  assert.deepEqual(c.wins, [0, 0]);
  assert.equal(c.events[0].annulled, true);
  assert.equal(OUTCOME['Air-Hockey'](c), undefined);
  // nach dem Ende ohne frischen Verstoß: keine Anklage mehr
  const done = goal(goals(newGame({ free: true }), [1, 1, 1, 1, 1, 1]), 1, 50);
  assert.equal(accuse(done, 0, 51), null);
  assert.ok(again(done, 1, 51));
});

test('Computer-Vorhersage: Puckbahn mit Bandenabprall gespiegelt', () => {
  const half = TABLE.W / 2 - 0.04125;
  const straight = crossing({ x: 0, z: 0, vx: 1, vz: 1 }, 0.3, true);
  assert.ok(Math.abs(straight.x - 0.3) < 1e-9);
  const bank = crossing({ x: 0, z: 0, vx: 1, vz: 1 }, half + 0.2, true);
  assert.ok(Math.abs(bank.x - (half - 0.2)) < 1e-9, 'einmal an der Bande gespiegelt');
  assert.equal(crossing({ x: 0, z: 0, vx: 1, vz: -1 }, 0.5, true), null, 'fliegt weg');
});

test('Ohne Hilfen: nach dem Ende gibt es keine neuen Verstöße mehr', () => {
  const done = goals(newGame({ free: true }), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(done.winner, 0);
  assert.equal(foul(done, 0, 'linie', 99), null);
});
