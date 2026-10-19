import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { newGame, move, resign, takeBack, again, turnOf, colorOf, legalMoves } from '../src/schach/game.js';

// Züge abwechselnd für den Spieler am Zug ausführen; jeder Zug muss gültig sein
function play(s, list) {
  for (const uci of list.split(' ')) {
    const next = move(s, turnOf(s), uci);
    assert.ok(next, `Zug ${uci} sollte gültig sein`);
    s = next;
  }
  return s;
}

test('neue Partie: Weiß beginnt, Farben je Spieler', () => {
  const s = newGame(1); // Gast hat Weiß
  assert.equal(turnOf(s), 1);
  assert.equal(colorOf(s, 1), 'w');
  assert.equal(colorOf(s, 0), 'b');
  assert.equal(s.fen, new Chess().fen());
  assert.deepEqual(s.moves, []);
  assert.equal(s.last, null);
  assert.equal(s.result, null);
});

test('Host-Prüfung: nicht dran, regelwidrig oder Unsinn → null', () => {
  const s = newGame(0);
  assert.equal(move(s, 1, 'e7e5'), null); // Schwarz ist nicht dran
  assert.equal(move(s, 0, 'e2e5'), null); // Bauer darf nicht 3 Felder
  assert.equal(move(s, 0, 'e1e2'), null); // Feld besetzt
  assert.equal(move(s, 0, 'xyz'), null);
  assert.equal(move(s, 0, ''), null);
  assert.equal(move(s, 0, 42), null);
  assert.equal(move(s, 0, { from: 'e2', to: 'e4' }), null);
  const next = move(s, 0, 'e2e4');
  assert.equal(turnOf(next), 1);
  assert.deepEqual(next.moves, ['e2e4']);
  assert.deepEqual(next.san, ['e4']);
  assert.deepEqual(next.last, { from: 'e2', to: 'e4' });
  assert.deepEqual(s.moves, []); // alter Zustand bleibt unverändert
});

test('Schäfermatt: Ergebnis Matt, Gewinner ist der Spieler mit Weiß', () => {
  const s = play(newGame(1), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
  assert.equal(s.check, true);
  assert.deepEqual(s.result, { winner: 1, reason: 'matt' });
  assert.equal(s.san.at(-1), 'Qxf7#');
  assert.deepEqual(s.captured, ['bp']);
  assert.equal(move(s, turnOf(s), 'e8e7'), null); // nach dem Ende geht nichts mehr
});

test('Rochade kurz', () => {
  const s = play(newGame(0), 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1');
  assert.equal(s.san.at(-1), 'O-O');
  const c = new Chess(s.fen);
  assert.deepEqual(c.get('g1'), { type: 'k', color: 'w' });
  assert.deepEqual(c.get('f1'), { type: 'r', color: 'w' });
});

test('Rochade lang, und nicht mehr nach Königszug', () => {
  const s = play(newGame(0), 'd2d4 d7d5 b1c3 b8c6 c1f4 c8f5 d1d2 d8d7 e1c1');
  assert.equal(s.san.at(-1), 'O-O-O');
  const moved = play(newGame(0), 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1e2 f8c5 e2e1 d7d6');
  assert.equal(move(moved, 0, 'e1g1'), null);
});

test('en passant', () => {
  let s = play(newGame(0), 'e2e4 a7a6 e4e5 d7d5');
  assert.ok(legalMoves(s, 'e5').some((m) => m.to === 'd6' && m.capture));
  s = play(s, 'e5d6');
  assert.equal(s.san.at(-1), 'exd6');
  assert.deepEqual(s.captured, ['bp']);
  assert.equal(new Chess(s.fen).get('d5'), undefined); // geschlagener Bauer ist weg
  // nur direkt danach erlaubt
  const late = play(newGame(0), 'e2e4 a7a6 e4e5 d7d5 h2h3 h7h6');
  assert.ok(!legalMoves(late, 'e5').some((m) => m.to === 'd6'));
});

test('Umwandlung: Figur muss gewählt werden, Springer geht auch', () => {
  const s = play(newGame(0), 'a2a4 b7b5 a4b5 a7a6 b5a6 c8b7 a6b7 b8c6');
  assert.equal(move(s, 0, 'b7a8'), null); // ohne Auswahl ungültig
  assert.equal(move(s, 0, 'b7a8k'), null); // König gibt es nicht
  const options = legalMoves(s, 'b7').filter((m) => m.to === 'a8').map((m) => m.uci).sort();
  assert.deepEqual(options, ['b7a8b', 'b7a8n', 'b7a8q', 'b7a8r']);
  const knight = move(s, 0, 'b7a8n');
  assert.equal(knight.san.at(-1), 'bxa8=N');
  assert.deepEqual(new Chess(knight.fen).get('a8'), { type: 'n', color: 'w' });
  assert.deepEqual(knight.captured, ['bp', 'bp', 'bb', 'br']); // axb5, bxa6, axb7, bxa8
  const queen = move(s, 0, 'b7a8q');
  assert.deepEqual(new Chess(queen.fen).get('a8'), { type: 'q', color: 'w' });
});

test('Patt (Sam Loyd, 10 Züge)', () => {
  const s = play(newGame(0), 'e2e3 a7a5 d1h5 a8a6 h5a5 h7h5 h2h4 a6h6 a5c7 f7f6 c7d7 e8f7 d7b7 d8d3 b7b8 d3h7 b8c8 f7g6 c8e6');
  assert.deepEqual(s.result, { winner: null, reason: 'patt' });
  assert.equal(s.check, false);
});

test('dreifache Wiederholung', () => {
  const s = play(newGame(0), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1');
  assert.equal(s.result, null);
  const end = play(s, 'f6g8'); // Ausgangsstellung zum dritten Mal
  assert.deepEqual(end.result, { winner: null, reason: 'wiederholung' });
});

test('50-Züge-Regel: 100 Halbzüge ohne Bauernzug und ohne Schlagen', () => {
  // Springer wandern, ohne dass sich eine Stellung wiederholt (immer der erste passende Zug)
  let s = newGame(0);
  const seen = new Set([s.fen.split(' ').slice(0, 4).join(' ')]);
  for (let ply = 0; ply < 100; ply++) {
    assert.equal(s.result, null);
    const chess = new Chess(s.fen);
    const next = chess.moves({ verbose: true }).find((m) => {
      if (m.piece === 'p' || m.captured || m.san.includes('+')) return false;
      return !seen.has(m.after.split(' ').slice(0, 4).join(' '));
    });
    assert.ok(next, `kein Zug gefunden bei Halbzug ${ply}`);
    seen.add(next.after.split(' ').slice(0, 4).join(' '));
    s = move(s, turnOf(s), next.lan);
  }
  assert.deepEqual(s.result, { winner: null, reason: 'fuenfzig' });
});

test('Aufgeben: der andere gewinnt, danach nichts mehr', () => {
  const s = play(newGame(0), 'e2e4');
  const r = resign(s, 1);
  assert.deepEqual(r.result, { winner: 0, reason: 'aufgabe' });
  assert.equal(resign(r, 0), null);
  assert.equal(move(r, 1, 'e7e5'), null);
  assert.equal(resign(s, 2), null);
});

test('Revanche tauscht die Farben, vorher nicht möglich', () => {
  const s = play(newGame(0), 'f2f3 e7e5 g2g4 d8h4');
  assert.deepEqual(s.result, { winner: 1, reason: 'matt' }); // Narrenmatt
  assert.equal(again(newGame(0)), null);
  const next = again(s);
  assert.equal(next.white, 1);
  assert.equal(turnOf(next), 1);
  assert.equal(next.result, null);
  assert.deepEqual(next.moves, []);
  assert.equal(again(resign(next, 0)).white, 0); // und wieder zurück
});

test('Zug zurück: Halbzüge entfernen, nur während der Partie', () => {
  const s = play(newGame(0), 'e2e4 e7e5 g1f3');
  const back = takeBack(s, 2);
  assert.deepEqual(back.moves, ['e2e4']);
  assert.equal(back.fen, play(newGame(0), 'e2e4').fen);
  assert.deepEqual(back.last, { from: 'e2', to: 'e4' });
  assert.equal(takeBack(s, 0), null);
  assert.equal(takeBack(s, 4), null);
  assert.deepEqual(takeBack(play(newGame(0), 'e2e4'), 1).moves, []);
  assert.equal(takeBack(resign(s, 0), 1), null); // nach dem Ende nicht mehr
});

test('erlaubte Züge nur für die Seite am Zug', () => {
  const s = newGame(0);
  assert.deepEqual(legalMoves(s, 'e2').map((m) => m.to).sort(), ['e3', 'e4']);
  assert.deepEqual(legalMoves(s, 'e7'), []);
  assert.deepEqual(legalMoves(s, 'e4'), []);
  assert.deepEqual(legalMoves(resign(s, 0), 'e2'), []);
});
