// 2D-Ansicht Schach (src/schach/flach.js): Feld ↔ Lage auf dem flachen Brett, Figuren aus der FEN, Pfeile und
// eigene Zeichnungen mit der rechten Maustaste. Nico 28.10.2026: „zwischen 2D und 3D hin und her schalten“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { squareXY, squareAtXY, piecesOf, arrowShape, toggleDrawing, drawColor, DRAW_COLORS, pieceSvg, SHAPES } from '../src/schach/flach.js';

const ALL = [...'abcdefgh'].flatMap((f) => [...'12345678'].map((r) => f + r));

test('Weiß unten: a1 links unten, h8 rechts oben – gedreht genau umgekehrt', () => {
  assert.deepEqual(squareXY('a1'), { x: 0, y: 7 });
  assert.deepEqual(squareXY('h8'), { x: 7, y: 0 });
  assert.deepEqual(squareXY('e4'), { x: 4, y: 4 });
  assert.deepEqual(squareXY('a1', true), { x: 7, y: 0 });
  assert.deepEqual(squareXY('h8', true), { x: 0, y: 7 });
  assert.deepEqual(squareXY('e4', true), { x: 3, y: 3 });
});

test('Feld an einer Stelle: jede Feldmitte und Ecke führt zurück zum Feld, daneben gibt es keins', () => {
  for (const flipped of [false, true]) {
    for (const sq of ALL) {
      const { x, y } = squareXY(sq, flipped);
      assert.equal(squareAtXY(x + 0.5, y + 0.5, flipped), sq);
      assert.equal(squareAtXY(x, y, flipped), sq);
      assert.equal(squareAtXY(x + 0.999, y + 0.999, flipped), sq);
    }
    for (const [x, y] of [[-0.01, 3], [8, 3], [3, -0.2], [3, 8.5], [NaN, 1]]) assert.equal(squareAtXY(x, y, flipped), null);
  }
});

test('Helle und dunkle Felder: a1 dunkel, h1 hell – in beiden Richtungen', () => {
  const dark = (sq, flipped) => {
    const { x, y } = squareXY(sq, flipped);
    return (x + y) % 2 === 1; // so färbt board2d.js die Felder
  };
  for (const flipped of [false, true]) {
    assert.equal(dark('a1', flipped), true);
    assert.equal(dark('h1', flipped), false);
    assert.equal(dark('d1', flipped), false); // Dame auf ihrer Farbe
  }
});

test('Figuren aus der FEN: Grundstellung mit 32 Figuren an den richtigen Feldern', () => {
  const pieces = piecesOf(new Chess().fen());
  assert.equal(pieces.length, 32);
  const at = (sq) => pieces.find((p) => p.square === sq);
  assert.deepEqual(at('e1'), { square: 'e1', color: 'w', type: 'k' });
  assert.deepEqual(at('d8'), { square: 'd8', color: 'b', type: 'q' });
  assert.deepEqual(at('g1'), { square: 'g1', color: 'w', type: 'n' });
  assert.deepEqual(at('c7'), { square: 'c7', color: 'b', type: 'p' });
  assert.equal(at('e4'), undefined);
  // gleich wie chess.js – auch nach ein paar Zügen
  const chess = new Chess();
  for (const m of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5']) chess.move(m);
  const want = chess.board().flat().filter(Boolean).map((p) => `${p.square}${p.color}${p.type}`).sort();
  assert.deepEqual(piecesOf(chess.fen()).map((p) => `${p.square}${p.color}${p.type}`).sort(), want);
});

test('Figuren aus der FEN: auch regelwidrige Stellungen (ohne Hilfen)', () => {
  const pieces = piecesOf('8/8/8/8/8/8/8/KK5q w - - 0 1');
  assert.deepEqual(pieces.map((p) => p.square + p.color + p.type), ['a1wk', 'b1wk', 'h1bq']);
});

test('Pfeil gerade: von Feldmitte zu Feldmitte, Spitze genau auf dem Ziel', () => {
  const { line, head } = arrowShape('e2e4');
  assert.deepEqual(line, [[4.5, 6.5], [4.5, 4.5 + 0.5]]); // Schaft endet am Fuß der Spitze (0,5 Felder davor)
  assert.deepEqual(head[0], [4.5, 4.5]);
  // Spitze quer zur Richtung, gleich breit nach beiden Seiten
  assert.deepEqual([head[1][1], head[2][1]], [5, 5]);
  assert.ok(Math.abs(head[1][0] - 4.5 + (head[2][0] - 4.5)) < 1e-9);
  assert.ok(Math.abs(Math.abs(head[1][0] - head[2][0]) - 0.58) < 1e-9);
  // gedreht: derselbe Zug zeigt nach unten
  const turned = arrowShape('e2e4', true);
  assert.deepEqual(turned.line[0], [3.5, 1.5]);
  assert.deepEqual(turned.head[0], [3.5, 3.5]);
});

test('Pfeil schräg: Schaft und Spitze liegen auf der Diagonale', () => {
  const { line, head } = arrowShape('a1h8');
  assert.deepEqual(line[0], [0.5, 7.5]);
  const [x, y] = line[1];
  assert.ok(Math.abs(x + y - 8) < 0.01, 'auf der Diagonale');
  assert.ok(Math.abs(Math.hypot(7.5 - x, 0.5 - y) - 0.5) < 0.01, 'Spitze 0,5 lang');
  assert.deepEqual(head[0], [7.5, 0.5]);
});

test('Springer-Pfeil geknickt: erst der lange Schenkel, dann der kurze', () => {
  const g1f3 = arrowShape('g1f3'); // zwei hoch, eins nach links
  assert.equal(g1f3.line.length, 3);
  assert.deepEqual(g1f3.line[0], [6.5, 7.5]);
  assert.deepEqual(g1f3.line[1], [6.5, 5.5]); // Knick über g3
  assert.deepEqual(g1f3.line[2], [5.5 + 0.5, 5.5]); // waagerecht zum Ziel
  assert.deepEqual(g1f3.head[0], [5.5, 5.5]);
  const b1d2 = arrowShape('b1d2'); // zwei nach rechts, eins hoch
  assert.deepEqual(b1d2.line[1], [3.5, 7.5]); // Knick auf d1
  assert.deepEqual(b1d2.line[2], [3.5, 7.5 - 0.5]);
  assert.deepEqual(b1d2.head[0], [3.5, 6.5]);
  // gedreht bleibt der Knick am selben Feld (g3)
  const turned = arrowShape('g1f3', true);
  assert.deepEqual(turned.line[1], [1.5, 2.5]);
  // kein Springerzug → gerade
  assert.equal(arrowShape('g1e3').line.length, 2);
  assert.equal(arrowShape('a1a3').line.length, 2);
});

test('Eigene Zeichnungen: Farbe je Taste, dasselbe nochmal = weg, andere Farbe = umgefärbt', () => {
  assert.equal(drawColor({}), 'gruen');
  assert.equal(drawColor({ shiftKey: true }), 'rot');
  assert.equal(drawColor({ ctrlKey: true }), 'blau');
  assert.equal(drawColor({ altKey: true }), 'gelb');
  for (const c of ['gruen', 'rot', 'blau', 'gelb']) assert.match(DRAW_COLORS[c], /^#[0-9a-f]{6}$/);

  let list = [];
  list = toggleDrawing(list, { from: 'e2', to: 'e4', color: 'gruen' });
  list = toggleDrawing(list, { from: 'd4', to: 'd4', color: 'rot' }); // Feld markiert
  assert.equal(list.length, 2);
  list = toggleDrawing(list, { from: 'e2', to: 'e4', color: 'blau' });
  assert.deepEqual(list, [{ from: 'e2', to: 'e4', color: 'blau' }, { from: 'd4', to: 'd4', color: 'rot' }]);
  list = toggleDrawing(list, { from: 'e2', to: 'e4', color: 'blau' });
  assert.deepEqual(list, [{ from: 'd4', to: 'd4', color: 'rot' }]);
  list = toggleDrawing(list, { from: 'e4', to: 'e2', color: 'rot' }); // Gegenrichtung ist ein eigener Pfeil
  assert.equal(list.length, 2);
});

test('Selbst gezeichnete Figuren: alle sechs Arten in beiden Farben, nur Pfade, keine Schriftzeichen', () => {
  assert.deepEqual(Object.keys(SHAPES).sort(), [...'bknpqr'].sort());
  for (const color of ['w', 'b']) {
    for (const type of 'kqrbnp') {
      const s = pieceSvg(color, type);
      assert.match(s, /^<svg viewBox="0 0 100 100"/);
      assert.equal((s.match(/<path /g) ?? []).length, SHAPES[type].length);
      assert.doesNotMatch(s, /<text|[♔-♟]/);
    }
  }
  assert.notEqual(pieceSvg('w', 'k'), pieceSvg('b', 'k'));
});
