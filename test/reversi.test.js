// Reversi (src/reversi/game.js): Standardregeln 8 × 8 und „Ohne Hilfen“ mit Schummeln und Verwarnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, move, place, unplace, flip, done, pass, turnOf, accuse, waive, again, score, forGuest, flipsFor, legalMoves,
  colorOf, countOf, squareName,
} from '../src/reversi/game.js';
import { chooseMove, cheatTurn, LEVELS } from '../src/reversi/ai.js';
import { rematchBlocked } from '../src/schummeln.js';

const sq = (name) => 'abcdefgh'.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
const at = (s, names) => names.split(' ').reduce((t, n) => move(t, t.turn, sq(n)), s);
// Brett aus Feldnamen: { B: 'a1 c3', W: 'b1' }
function boardOf({ B = '', W = '' }) {
  const b = Array(64).fill(null);
  for (const n of B.split(' ').filter(Boolean)) b[sq(n)] = 0;
  for (const n of W.split(' ').filter(Boolean)) b[sq(n)] = 1;
  return b;
}

test('Startaufstellung: d4/e5 weiß, e4/d5 schwarz, Schwarz (Spieler 0) fängt an', () => {
  const s = newGame();
  assert.equal(s.board[sq('d4')], 1);
  assert.equal(s.board[sq('e5')], 1);
  assert.equal(s.board[sq('e4')], 0);
  assert.equal(s.board[sq('d5')], 0);
  assert.equal(s.board.filter((v) => v !== null).length, 4);
  assert.equal(s.turn, 0);
  assert.equal(colorOf(s, 0), 0);
  assert.deepEqual(legalMoves(s.board, 0).map(squareName).sort(), ['c4', 'd3', 'e6', 'f5']);
});

test('Zug dreht die eingeschlossenen Steine um, dann ist der andere dran', () => {
  const s = at(newGame(), 'd3');
  assert.equal(s.board[sq('d3')], 0);
  assert.equal(s.board[sq('d4')], 0);
  assert.equal(countOf(s, 0), 4);
  assert.equal(countOf(s, 1), 1);
  assert.equal(s.turn, 1);
  assert.equal(s.last, sq('d3'));
  assert.deepEqual(s.events, [{ type: 'move', by: 0, at: sq('d3'), flips: [sq('d4')] }]);
});

test('ungültig: nicht dran, besetzt, schließt nichts ein, außerhalb', () => {
  const s = newGame();
  assert.equal(move(s, 1, sq('d3')), null);
  assert.equal(move(s, 0, sq('d4')), null);
  assert.equal(move(s, 0, sq('a1')), null);
  assert.equal(move(s, 0, 64), null);
  assert.equal(move(s, 0, -1), null);
  assert.equal(move(s, 0, 2.5), null);
  assert.equal(place(s, 0, sq('a1')), null); // „Ohne Hilfen“-Schritte gibt es im normalen Spiel nicht
});

test('Einschließen in mehrere Richtungen auf einmal, aber nicht über Lücken', () => {
  const b = boardOf({ B: 'd6 f4 f6', W: 'd5 e4 e5' });
  assert.deepEqual(flipsFor(b, sq('d4'), 0).map(squareName).sort(), ['d5', 'e4', 'e5']);
  const gap = boardOf({ B: 'a1 d1', W: 'b1' }); // c1 frei: b1 ist nicht zwischen a1 und d1 eingeschlossen
  assert.deepEqual(flipsFor(gap, sq('c1'), 0).map(squareName), ['b1']);
  assert.deepEqual(flipsFor(gap, sq('e1'), 0), []);
});

test('wer nicht ziehen kann, setzt aus – kann keiner mehr, ist Schluss', () => {
  const s = { ...newGame(), board: boardOf({ B: 'a1 a3', W: 'b1 b3' }) };
  const t = move(s, 0, sq('c1'));
  assert.equal(t.turn, 0, 'Weiß kann nicht und setzt aus');
  assert.deepEqual(t.events[1], { type: 'pass', by: 1 });
  const end = move(t, 0, sq('c3'));
  assert.equal(countOf(end, 1), 0);
  assert.deepEqual(end.result, { winner: 0, reason: 'zu', count: [6, 0] });
  assert.equal(move(end, end.turn, sq('h8')), null);
});

test('Zufallspartien enden spätestens nach 60 Zügen, Sieger hat mehr Steine', () => {
  for (let g = 0; g < 40; g++) {
    let s = newGame({ starter: g % 2 });
    let n = 0;
    while (!s.result) {
      const opts = legalMoves(s.board, colorOf(s, s.turn));
      s = move(s, s.turn, opts[Math.floor(Math.random() * opts.length)]);
      assert.ok(s, 'immer ein gültiger Zug');
      n++;
    }
    assert.ok(n <= 60);
    const [a, b] = [countOf(s, 0), countOf(s, 1)];
    assert.deepEqual(s.result.count, [a, b]);
    assert.equal(s.result.winner, a === b ? null : a > b ? 0 : 1);
  }
});

test('Revanche: der andere fängt an und spielt Schwarz, Siege zählen weiter', () => {
  const s = { ...newGame(), board: boardOf({ B: 'a1 a3', W: 'b1 b3' }) };
  const end = at(s, 'c1 c3');
  assert.deepEqual(score(end), [1, 0]);
  const next = again(end, 1);
  assert.equal(next.starter, 1);
  assert.equal(next.turn, 1);
  assert.equal(colorOf(next, 1), 0);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(next.round, 2);
  assert.equal(again(newGame(), 0), null, 'nur nach Spielende');
});

// --- Ohne Hilfen ---

test('ohne Hilfen: setzen, umdrehen, fertig – regelgerecht, Fehlalarm kostet den Rufer', () => {
  let s = newGame({ free: true });
  assert.equal(move(s, 0, sq('d3')), null, 'ohne Hilfen wird Schritt für Schritt gezogen');
  s = place(s, 0, sq('d3'));
  assert.equal(s.board[sq('d4')], 1, 'umgedreht wird nicht von selbst');
  assert.equal(place(s, 0, sq('c4')), null, 'nur ein Stein je Zug');
  s = flip(s, 0, sq('d4'));
  assert.equal(s.board[sq('d4')], 0);
  s = done(s, 0);
  assert.equal(s.turn, 1);
  assert.equal(s.cheat.legal, true);
  const t = accuse(s, 1);
  assert.equal(t.verdict.caught, false);
  assert.deepEqual(t.strikes, [0, 1]);
  assert.equal(t.board[sq('d4')], 0, 'Zug bleibt');
  assert.equal(t.turn, 1);
});

test('ohne Hilfen: Stein ohne Einschließen geht durch, erwischt = Zug zurück + Verwarnung', () => {
  const before = newGame({ free: true });
  const s = done(place(before, 0, sq('a1')), 0);
  assert.equal(s.board[sq('a1')], 0);
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(s.cheat.why, ['Stein gesetzt, ohne etwas einzuschließen']);
  const t = accuse(s, 1);
  assert.equal(t.verdict.caught, true);
  assert.equal(t.verdict.why, 'Stein gesetzt, ohne etwas einzuschließen');
  assert.deepEqual(t.board, before.board);
  assert.equal(t.turn, 0, 'der Schummler ist wieder dran');
  assert.deepEqual(t.strikes, [1, 0]);
  assert.equal(accuse(t, 1), null, 'nur einmal');
});

test('ohne Hilfen: zu wenig oder zu viel umgedreht – die Meldung nennt es', () => {
  const s = newGame({ free: true, starter: 0 });
  const missing = done(place(s, 0, sq('d3')), 0);
  assert.deepEqual(missing.cheat.why, ['einen eingeschlossenen Stein nicht umgedreht']);
  const extra = turnOf(s, 0, sq('d3'), [sq('d4'), sq('e5')]);
  assert.deepEqual(extra.cheat.why, ['einen Stein umgedreht, der nicht eingeschlossen war']);
  assert.equal(accuse(extra, 1).verdict.why, 'einen Stein umgedreht, der nicht eingeschlossen war');
  assert.equal(extra.seq, s.seq + 1, 'ganzer Zug in einem Schritt = eine Aktion (das Brett spielt ihn ab)');
  const both = turnOf(s, 0, sq('a1'), [sq('d4'), sq('e5')]);
  assert.equal(accuse(both, 1).verdict.why, 'Stein gesetzt, ohne etwas einzuschließen und 2 Steine umgedreht, die nicht eingeschlossen waren');
});

test('ohne Hilfen: zweimal umdrehen = wie vorher, Stein wieder wegnehmen', () => {
  const s = place(newGame({ free: true }), 0, sq('d3'));
  const twice = flip(flip(s, 0, sq('e5')), 0, sq('e5'));
  assert.deepEqual(twice.board, s.board);
  assert.deepEqual(twice.open.flipped, []);
  assert.equal(flip(s, 0, sq('d3')), null, 'den gesetzten Stein nicht');
  assert.equal(flip(s, 0, sq('a1')), null, 'leeres Feld nicht');
  assert.equal(flip(s, 1, sq('d4')), null, 'nur wer dran ist');
  const back = unplace(flip(s, 0, sq('d4')), 0);
  assert.deepEqual(back.board, newGame().board);
  assert.equal(back.open, null);
  assert.equal(back.turn, 0);
});

test('ohne Hilfen: Aussetzen trotz Zug ist Schummeln, ehrliches Aussetzen nicht', () => {
  const s = pass(newGame({ free: true }), 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.cheat.why, ['ausgesetzt, obwohl ein Zug möglich war']);
  const t = accuse(s, 1);
  assert.equal(t.turn, 0);
  assert.deepEqual(t.strikes, [1, 0]);
  const stuck = { ...newGame({ free: true }), board: boardOf({ B: 'a1 a3', W: 'b1 b3' }), turn: 1 };
  assert.equal(pass(stuck, 1).cheat.legal, true);
});

test('ohne Hilfen: beide setzen aus = Partie vorbei', () => {
  const s = pass(pass(newGame({ free: true }), 0), 1);
  assert.equal(s.result.reason, 'zu');
  assert.equal(s.result.winner, null);
  const t = accuse(s, 0); // Weiß hätte ziehen können
  assert.equal(t.result, null);
  assert.equal(t.turn, 1);
});

test('ohne Hilfen: die Frist endet, sobald der andere setzt oder aussetzt', () => {
  const s = done(place(newGame({ free: true }), 0, sq('a1')), 0);
  const t = place(s, 1, sq('h8'));
  assert.equal(t.cheat, null);
  assert.equal(accuse(t, 1), null);
  assert.equal(pass(s, 1).cheat.player, 1);
  assert.equal(accuse(s, 0), null, 'nicht gegen sich selbst');
});

test('ohne Hilfen: dritte Verwarnung = verloren', () => {
  let s = newGame({ free: true });
  for (let k = 0; k < 3; k++) s = accuse(done(place(s, 0, sq('a1')), 0), 1);
  assert.deepEqual(s.strikes, [3, 0]);
  assert.deepEqual(s.result, { winner: 1, reason: 'schummeln' });
});

test('ohne Hilfen: Gast sieht nicht, ob geschummelt wurde · Revanche gesperrt für den Schummler', () => {
  const s = pass(pass(newGame({ free: true }), 0), 1); // Weiß setzt trotz Zug aus → Partie vorbei, Frist offen
  assert.ok(s.result);
  assert.deepEqual(forGuest(s).cheat, { player: 1 });
  assert.ok(rematchBlocked(s, 1));
  assert.equal(again(s, 1), null);
  assert.equal(again(s, 0).round, 2, 'der andere verzichtet damit');
  const open = forGuest(place(newGame({ free: true }), 0, sq('d3')));
  assert.deepEqual(open.open, { at: sq('d3'), flipped: [] });
  assert.equal(waive(s, 0).cheat, null);
  assert.equal(forGuest(newGame()).cheat, undefined);
});

// --- Computer ---

// fester Zufall für wiederholbare Tests
const seeded = (n) => () => ((n = (n * 16807) % 2147483647) / 2147483647);

test('Computer: zieht immer regelgerecht, −1 wenn er aussetzen muss', () => {
  for (let lv = 0; lv < 2; lv++) {
    const s = newGame();
    assert.ok(legalMoves(s.board, 0).includes(chooseMove(s.board, 0, lv)));
  }
  assert.equal(chooseMove(boardOf({ B: 'a1 a3', W: 'b1 b3' }), 1, 1), -1);
});

test('Computer: nimmt eine Ecke, wenn er sie bekommt', () => {
  // Weiß kann a1 (schließt b2 ein) oder d6/… – a1 ist klar besser
  const b = boardOf({ B: 'b2 d4 e4 d5', W: 'c3 e5 f6' });
  assert.ok(legalMoves(b, 1).includes(sq('a1')));
  assert.equal(chooseMove(b, 1, 1, () => 0.99), sq('a1'), LEVELS[1].name); // 0,99 = kein Zufallszug
});

test('Computer: rechnet das Ende exakt (Meister) – so gut wie die vollständige Suche', () => {
  const rng = seeded(3);
  // Endwert für Spieler p bei bestem Spiel beider (vollständig durchgerechnet mit game.js)
  const best = (s, p) => {
    if (s.result) return countOf(s, p) - countOf(s, 1 - p);
    const vals = legalMoves(s.board, colorOf(s, s.turn)).map((k) => best(move(s, s.turn, k), p));
    return s.turn === p ? Math.max(...vals) : Math.min(...vals);
  };
  for (let g = 0; g < 6; g++) {
    let s = newGame();
    while (!s.result && s.board.filter((v) => v === null).length > 7) {
      const opts = legalMoves(s.board, colorOf(s, s.turn));
      s = move(s, s.turn, opts[Math.floor(rng() * opts.length)]);
    }
    if (s.result) continue;
    const p = s.turn;
    const pick = chooseMove(s.board, colorOf(s, p), 3, rng);
    assert.equal(best(move(s, p, pick), p), best(s, p), `Partie ${g}`);
  }
});

test('Computer: Mittel schlägt Anfänger fast immer', () => {
  const rng = seeded(42);
  let won = 0;
  for (let g = 0; g < 6; g++) {
    let s = newGame({ starter: g % 2 });
    const lvOf = (p) => (p === 0 ? 1 : 0); // Spieler 0 = Mittel
    while (!s.result) s = move(s, s.turn, chooseMove(s.board, colorOf(s, s.turn), lvOf(s.turn), rng));
    if (s.result.winner === 0) won++;
  }
  assert.ok(won >= 5, `Mittel gewann ${won} von 6`);
});

test('Computer schummelt: Ecke ohne Einschließen oder ein Stein zu viel umgedreht', () => {
  const s = turnOf(newGame({ free: true }), 0, sq('d3'), [sq('d4')]); // Weiß ist dran
  const sly = cheatTurn(s, 1, sq('c3'), () => 0.9); // keine Ecke gewählt → Zug c3 und d3 gleich mit umgedreht
  assert.equal(sly.at, sq('c3'));
  assert.deepEqual(sly.flips, [sq('d4'), sq('d3')]);
  const t = turnOf(s, 1, sly.at, sly.flips);
  assert.equal(t.cheat.legal, false);
  const corner = cheatTurn(s, 1, sq('c3'), () => 0.1);
  assert.ok([0, 7, 56, 63].includes(corner.at));
  assert.deepEqual(corner.flips, []);
});
