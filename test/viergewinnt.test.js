// Vier gewinnt (src/viergewinnt/game.js): Standardregeln 7 × 6 und „Ohne Hilfen“ mit Schummeln und Verwarnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, drop, accuse, waive, again, score, forGuest, lineAt, openCols, used, COLS, ROWS, STONES } from '../src/viergewinnt/game.js';
import { rematchBlocked } from '../src/schummeln.js';

// Spalten der Reihe nach, abwechselnd ab dem, der dran ist
const play = (s, cols) => cols.reduce((t, c) => drop(t, t.turn, c), s);

test('neue Partie: leeres Brett 7 × 6, Rot (0) fängt an', () => {
  const s = newGame();
  assert.equal(s.board.length, COLS);
  assert.ok(s.board.every((c) => c.length === 0));
  assert.equal(s.turn, 0);
  assert.equal(s.result, null);
  assert.deepEqual(openCols(s), [0, 1, 2, 3, 4, 5, 6]);
});

test('Stein fällt nach unten, danach ist der andere dran', () => {
  const s = play(newGame(), [3, 3]);
  assert.deepEqual(s.board[3], [0, 1]);
  assert.equal(s.turn, 0);
  assert.deepEqual(s.events, [{ type: 'drop', col: 3, row: 1, color: 1, by: 1 }]);
});

test('ungültig: nicht dran, fremde Farbe, volle oder falsche Spalte', () => {
  const s = newGame();
  assert.equal(drop(s, 1, 0), null);
  assert.equal(drop(s, 0, 0, 1), null);
  assert.equal(drop(s, 0, 7), null);
  assert.equal(drop(s, 0, -1), null);
  assert.equal(drop(s, 0, 2.5), null);
  const full = play(s, [0, 0, 0, 0, 0, 0]);
  assert.equal(full.board[0].length, ROWS);
  assert.equal(drop(full, full.turn, 0), null);
});

test('vier waagrecht, senkrecht und diagonal gewinnen', () => {
  const across = play(newGame(), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(across.result.winner, 0);
  assert.deepEqual(across.result.line, [[0, 0], [1, 0], [2, 0], [3, 0]]);
  const up = play(newGame(), [6, 0, 6, 0, 6, 0, 6]);
  assert.equal(up.result.winner, 0);
  assert.deepEqual(up.result.line, [[6, 0], [6, 1], [6, 2], [6, 3]]);
  // Diagonale ↗ für Gelb: (1,0) (2,1) (3,2) (4,3)
  const diag = play(newGame(), [0, 1, 2, 2, 3, 3, 4, 3, 4, 4, 6, 4]);
  assert.equal(diag.result.winner, 1);
  assert.deepEqual(diag.result.line, [[1, 0], [2, 1], [3, 2], [4, 3]]);
  // Diagonale ↘ für Rot: (0,3) (1,2) (2,1) (3,0)
  const down = play(newGame(), [3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0]);
  assert.equal(down.result.winner, 0);
  assert.deepEqual(down.result.line, [[0, 3], [1, 2], [2, 1], [3, 0]]);
  assert.equal(drop(down, down.turn, 5), null); // nach dem Sieg geht nichts mehr
});

test('fünf in einer Reihe: alle Steine der Reihe gehören zur Linie', () => {
  const s = play(newGame(), [0, 0, 1, 1, 3, 3, 4, 4]); // Rot: 0 1 _ 3 4
  const won = drop(s, 0, 2);
  assert.equal(won.result.line.length, 5);
});

test('volles Brett ohne Vierer = Remis', () => {
  // gefunden per Zufallspartie: füllt das Brett, ohne dass vier gleiche liegen
  const cols = [1, 6, 3, 0, 0, 1, 2, 4, 6, 1, 6, 5, 5, 1, 0, 6, 0, 3, 6, 3, 1, 2, 6, 0, 4, 4, 3, 1, 3, 0, 3, 5, 2, 5, 2, 2, 5, 5, 4, 4, 4, 2];
  let s = play(newGame(), cols.slice(0, -1));
  assert.equal(s.result, null);
  s = drop(s, s.turn, cols.at(-1));
  assert.deepEqual(s.result, { winner: null, reason: 'voll' });
  assert.equal(used(s, 0) + used(s, 1), COLS * ROWS);
});

test('lineAt: leeres Feld oder nur drei → null', () => {
  const s = play(newGame(), [0, 6, 1, 6, 2]);
  assert.equal(lineAt(s.board, 3, 0), null);
  assert.equal(lineAt(s.board, 0, 0), null);
});

test('Revanche: der andere fängt an, Siege zählen weiter', () => {
  const won = play(newGame(), [0, 0, 1, 1, 2, 2, 3]);
  assert.deepEqual(score(won), [1, 0]);
  assert.equal(again(newGame(), 0), null); // läuft noch
  const next = again(won, 1);
  assert.equal(next.starter, 1);
  assert.equal(next.round, 2);
  assert.equal(next.turn, 1);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(next.result, null);
});

// --- Ohne Hilfen ---
const free = () => newGame({ free: true });

test('ohne Hilfen: ehrlicher Stein öffnet eine Frist ohne Grund', () => {
  const s = drop(free(), 0, 3);
  assert.equal(s.cheat.player, 0);
  assert.equal(s.cheat.legal, true);
  assert.deepEqual(s.cheat.why, []);
  assert.equal(s.verdict, null);
});

test('ohne Hilfen: zwei Steine hintereinander gehen durch – erwischt nimmt nur den zweiten heraus', () => {
  const one = drop(free(), 0, 3);
  const two = drop(one, 0, 4);
  assert.ok(two);
  assert.equal(two.turn, 1);
  assert.equal(two.cheat.legal, false);
  assert.equal(rematchBlocked(two, 0), true);
  const c = accuse(two, 1);
  assert.deepEqual(c.board[3], [0]);
  assert.deepEqual(c.board[4], []);
  assert.equal(c.turn, 1); // Gelb ist dran, wie vor dem Schummel-Stein
  assert.deepEqual(c.strikes, [1, 0]);
  assert.deepEqual(c.verdict, { caught: true, player: 0, by: 1, why: 'zwei Steine hintereinander eingeworfen', stones: 1 });
  assert.equal(c.events[0].type, 'caught');
  assert.ok(c.seq > two.seq);
  assert.equal(c.cheat, null);
  assert.equal(accuse(c, 1), null); // nur einmal
});

test('ohne Hilfen: außer der Reihe zu Beginn und mit fremdem Stein – Grund nennt beides', () => {
  const s = drop(free(), 1, 2, 0); // Gelb wirft als Erster einen roten Stein
  assert.ok(s);
  assert.deepEqual(s.cheat.why, ['außer der Reihe eingeworfen', 'mit einem Stein des Gegners (Rot) gespielt']);
  const c = accuse(s, 0);
  assert.equal(c.verdict.why, 'außer der Reihe eingeworfen und mit einem Stein des Gegners (Rot) gespielt');
  assert.deepEqual(c.board[2], []);
  assert.equal(c.turn, 0);
});

test('ohne Hilfen: mehrere Schummel-Steine kommen alle heraus, Grund höchstens zweimal', () => {
  let s = drop(free(), 0, 0, 1); // fremder Stein (Rot ist dran)
  s = drop(s, 0, 1); // zweimal
  s = drop(s, 0, 2); // dreimal
  assert.deepEqual(s.cheat.why, ['mit einem Stein des Gegners (Gelb) gespielt', 'zwei Steine hintereinander eingeworfen']);
  const c = accuse(s, 1);
  assert.ok(c.board.every((col) => col.length === 0));
  assert.equal(c.verdict.stones, 3);
  assert.equal(c.turn, 0);
});

test('ohne Hilfen: Fehlalarm – Verwarnung für den Ankläger, Stein bleibt', () => {
  const s = drop(free(), 0, 3);
  assert.equal(accuse(s, 0), null); // nicht gegen sich selbst
  const f = accuse(s, 1);
  assert.deepEqual(f.board[3], [0]);
  assert.deepEqual(f.strikes, [0, 1]);
  assert.deepEqual(f.verdict, { caught: false, player: 1, by: 1 });
  assert.equal(f.events[0].type, 'fehlalarm');
  assert.equal(f.turn, 1);
});

test('ohne Hilfen: der andere wirft selbst → Frist vorbei', () => {
  const s = play(free(), [0, 1]);
  assert.equal(s.cheat.player, 1);
  assert.equal(accuse(s, 1), null); // Rots letzter Stein kann nicht mehr angeprangert werden
});

test('ohne Hilfen: Schummel-Sieg erwischt → Partie läuft weiter', () => {
  let s = play(free(), [0, 6, 1, 6, 2]); // Rot hat drei unten, Gelb ist dran
  s = drop(s, 0, 3); // Rot wirft außer der Reihe den vierten
  assert.equal(s.result.winner, 0);
  assert.equal(rematchBlocked(s, 0), true);
  assert.equal(again(s, 0), null); // der Schummler darf keine Revanche starten
  const c = accuse(s, 1);
  assert.equal(c.result, null);
  assert.deepEqual(c.board[3], []);
  assert.equal(c.turn, 1);
});

test('ohne Hilfen: dritte Verwarnung verliert', () => {
  let s = free();
  for (let k = 0; k < 2; k++) s = accuse(drop(s, s.turn, 0), 1 - s.turn); // zwei Fehlalarme
  assert.deepEqual(s.strikes, [1, 1]);
  s = accuse(drop(s, 0, 1), 1);
  assert.deepEqual(s.strikes, [1, 2]);
  s = accuse(drop(s, 1, 2), 0);
  assert.deepEqual(s.strikes, [2, 2]);
  s = accuse(drop(s, 0, 3), 1); // dritte für Gelb
  assert.deepEqual(s.result, { winner: 0, reason: 'schummeln' });
});

test('waive: Frist zu, Revanche frei, Ergebnis bleibt', () => {
  const s = play(free(), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(waive(s, 0), null);
  const w = waive(s, 1);
  assert.equal(w.cheat, null);
  assert.equal(w.result.winner, 0);
  assert.equal(rematchBlocked(w, 0), false);
  const next = again(w, 0);
  assert.equal(next.free, true);
  assert.deepEqual(next.strikes, [0, 0]);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(waive(w, 1), null);
});

test('forGuest: Grund und Vorstand bleiben beim Host', () => {
  const s = drop(drop(free(), 0, 3), 0, 4);
  const g = forGuest(s);
  assert.deepEqual(g.cheat, { player: 0 });
  assert.equal(JSON.stringify(g).includes('hintereinander'), false);
  assert.equal(forGuest(newGame()).cheat, undefined);
});

test('Steine einer Farbe alle: kein Stein mehr – wer dran ist und keinen eigenen hat → Remis', () => {
  const fake = Array.from({ length: STONES }, () => ({ col: 0, row: 0, color: 1, by: 0 })); // 21 gelbe sind verbraucht
  const s = { ...free(), moves: fake };
  assert.equal(drop({ ...s, turn: 1 }, 1, 3), null);
  const d = drop(s, 0, 3);
  assert.deepEqual(d.result, { winner: null, reason: 'steine' });
});

// --- Computer (src/viergewinnt/ai.js) ---
test('Computer: gewinnt sofort, wenn er kann, und verhindert den Sieg des Menschen', async () => {
  const { chooseMove, LEVELS } = await import('../src/viergewinnt/ai.js');
  const rng = () => 0.99; // kein Zufallszug
  const win = play(newGame(), [0, 6, 1, 6, 2, 5]); // Rot hat 0 1 2, Gelb blockt nicht – Rot ist dran
  for (let lv = 1; lv < LEVELS.length; lv++) assert.equal(chooseMove(win, 0, lv, rng), 3, `Stufe ${lv}`);
  const block = play(newGame(), [0, 6, 1, 6, 2]); // Gelb ist dran und muss 3 zumachen
  for (let lv = 1; lv < LEVELS.length; lv++) assert.equal(chooseMove(block, 1, lv, rng), 3, `Stufe ${lv}`);
});

test('Computer: Stark und Meister sehen eine Zwickmühle zwei Züge voraus', async () => {
  const { chooseMove } = await import('../src/viergewinnt/ai.js');
  // Rot hat 2 und 3 unten liegen, 1 und 4 sind frei: ein Stein auf 1 oder 4 droht doppelt → Gelb muss jetzt 1 oder 4 nehmen
  const s = play(newGame(), [2, 6, 3]);
  for (const lv of [2, 3]) assert.ok([1, 4].includes(chooseMove(s, 1, lv, () => 0.99)), `Stufe ${lv}`);
});

test('Computer: Schummel-Stein ist ein möglicher Stein', async () => {
  const { cheatMove } = await import('../src/viergewinnt/ai.js');
  const s = play(newGame({ free: true }), [3]);
  const m = cheatMove(s, 1, () => 0.9);
  assert.ok(drop(s, 1, m.col, m.color));
  assert.equal(cheatMove(s, 1, () => 0.9).color, 0); // Stein des Menschen
  assert.deepEqual(cheatMove(s, 1, () => 0.1), { twice: true });
});

test('Computer: jede Stufe nimmt einen Sofortsieg – auch mit Zufall', async () => {
  const { chooseMove, LEVELS } = await import('../src/viergewinnt/ai.js');
  const win = play(newGame(), [0, 6, 1, 6, 2, 5]);
  for (let lv = 0; lv < LEVELS.length; lv++) {
    for (const r of [0, 0.05, 0.3, 0.6]) assert.equal(chooseMove(win, 0, lv, () => r), 3, `Stufe ${lv}, Zufall ${r}`);
  }
});
