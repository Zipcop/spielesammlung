import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { START_RATING, THEMES, PICKABLE, puzzleFrom, positionOf, isRight, rate, pickPuzzle, choicesFor } from '../src/schach/puzzle.js';

const LIST = JSON.parse(readFileSync(new URL('../src/schach/puzzles.json', import.meta.url)));

// Grundreihe: Schwarz zieht Kh8, dann setzen Ta8# und Tb8# beide matt
const MATE = puzzleFrom(['test1', '6k1/5ppp/8/8/8/8/8/RR4K1 b - - 0 1', 'g8h8 a1a8', 900, 'mateIn1 backRankMate']);
// Echtes Lichess-Rätsel aus der Datenbank (Kennung 0000D): Dd6 wird mit Td8 gefesselt …
const REAL = puzzleFrom(['0000D', '5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27', 'd3d6 f8d8 d6d8 f6d8', 1529, 'endgame']);

test('Rätsel lesen: Spieler ist die Seite nach dem ersten Zug', () => {
  assert.equal(MATE.color, 'w');
  assert.deepEqual(MATE.line, ['g8h8', 'a1a8']);
  assert.equal(REAL.color, 'b');
  assert.deepEqual(REAL.themes, ['endgame']);
});

test('Stellung für das Brett: Spielerfarbe vorn, letzter Zug, Matt', () => {
  const start = positionOf(REAL, []);
  assert.equal(start.white, 1); // Spieler hat Schwarz → Brett dreht sich
  assert.equal(start.last, null);
  const end = positionOf(REAL, REAL.line);
  assert.deepEqual(end.last, { from: 'f6', to: 'd8' });
  assert.deepEqual(end.captured.sort(), ['b', 'w'].map((c) => (c === 'w' ? 'wq' : 'br')).sort()); // Dame gegen Turm
  assert.equal(positionOf(MATE, ['g8h8', 'a1a8']).mate, true);
});

test('Zug prüfen: Lösung oder jedes Matt ist richtig', () => {
  assert.equal(isRight(MATE, 1, 'a1a8'), true);
  assert.equal(isRight(MATE, 1, 'b1b8'), true); // anderes Matt – wie bei Lichess
  assert.equal(isRight(MATE, 1, 'a1a7'), false);
  assert.equal(isRight(MATE, 1, 'a1h1'), false); // regelwidrig
  assert.equal(isRight(REAL, 1, 'f8d8'), true);
  assert.equal(isRight(REAL, 1, 'b6f2'), false);
  assert.equal(isRight(REAL, 3, 'f6d8'), true);
});

test('Wertung wie Elo: K = 40 die ersten 30 Rätsel, dann 20; Raten bei vier Antworten eingerechnet', () => {
  const fresh = { rating: START_RATING, games: 0 };
  assert.deepEqual(rate(fresh, 1000, true), { rating: 1020, games: 1 }); // E = 0,5 → 40 · 0,5
  assert.deepEqual(rate(fresh, 1000, false), { rating: 980, games: 1 });
  assert.equal(rate({ rating: 1000, games: 30 }, 1000, true).rating, 1010); // K = 20
  assert.equal(rate(fresh, 1400, true).rating, 1036); // E = 1/(1+10) ≈ 0,0909 → +36,4
  assert.equal(rate(fresh, 1000, true, 4).rating, 1015); // E' = 1/4 + 3/4 · 0,5 = 0,625 → +15
  assert.equal(rate(fresh, 1000, false, 4).rating, 975);
});

test('Nächstes Rätsel: Thema, noch nicht gesehen, Wertung möglichst nah', () => {
  const rows = [['a', '', '', 1000, 'fork'], ['b', '', '', 1050, 'pin'], ['c', '', '', 1600, 'fork'], ['d', '', '', 1080, 'fork']];
  const pick = (rating, theme, seen = []) => pickPuzzle(rows, rating, theme, new Set(seen), () => 0)[0];
  assert.equal(pick(1000, 'fork'), 'a');
  assert.equal(pick(1000, 'fork', ['a']), 'd');
  assert.equal(pick(1000, 'fork', ['a', 'd']), 'c'); // Fenster wird breiter
  assert.equal(pick(1000, 'fork', ['a', 'c', 'd']), 'a'); // alle gesehen → von vorn
  assert.equal(pick(1060, 'pin'), 'b');
  assert.equal(pick(1600, 'mix'), 'c');
  assert.equal(pickPuzzle(rows, 1000, 'skewer', new Set()), null);
});

test('Bester Zug?: vier Antworten, genau eine richtig, kein anderes Matt dabei', () => {
  for (let seed = 0; seed < 5; seed++) {
    let x = seed / 5;
    const random = () => (x = (x * 9301 + 0.49297) % 1);
    const list = choicesFor(MATE, random);
    assert.equal(list.length, 4);
    assert.deepEqual(list.filter((c) => c.right).map((c) => c.uci), ['a1a8']);
    assert.ok(!list.some((c) => c.uci === 'b1b8'), 'Tb8# wäre auch richtig');
    assert.equal(new Set(list.map((c) => c.uci)).size, 4);
  }
});

test('Rätseldaten (Lichess, CC0): Züge regelgerecht, Themen bekannt, genug je Thema', () => {
  assert.ok(LIST.length >= 3000, `${LIST.length} Rätsel`);
  for (const row of LIST) {
    const p = puzzleFrom(row);
    const chess = new Chess(p.fen);
    for (const m of p.line) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); // wirft bei Fehler
    assert.ok(p.line.length >= 2 && p.line.length % 2 === 0, p.id);
    assert.ok(p.themes.every((t) => t in THEMES), p.id);
    assert.ok(p.rating >= 300 && p.rating <= 3300, p.id);
  }
  for (const t of PICKABLE) assert.ok(LIST.filter((r) => r[4].split(' ').includes(t)).length >= 150, t);
  // Stichprobe: „Bester Zug?“ findet überall den Lösungszug und drei falsche
  for (const row of LIST.filter((_, i) => i % 25 === 0)) {
    const list = choicesFor(puzzleFrom(row));
    assert.equal(list.filter((c) => c.right).length, 1, row[0]);
    assert.ok(list.length >= 2, row[0]);
  }
});
