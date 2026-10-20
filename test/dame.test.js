// Dame (src/dame/game.js): Aufstellung, Ziehen, Schlagzwang, Mehrfachschlagen, Dame, Spielende, Remis, „Ohne Hilfen“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, play, accuse, waive, again, forGuest, legalMoves, inspect, movable, mustJump, continuations, startBoard,
  dark, QUIET_LIMIT,
} from '../src/dame/game.js';
import { chooseMove, cheatMove } from '../src/dame/ai.js';

// Feld aus Schachnotation (Sicht des Hosts): a–h = Spalte 0–7, 8–1 = Reihe 0–7 (a1 = unten links beim Host)
const sq = (n) => (8 - Number(n[1])) * 8 + (n.charCodeAt(0) - 97);
const path = (...ns) => ns.map(sq);
// Stellung bauen: w/b = Steine von Spieler 0/1, W/B = Damen
function setup({ w = [], b = [], W = [], B = [], turn = 0, free = false } = {}) {
  const s = newGame({ free, white: turn });
  const board = Array(64).fill(null);
  for (const n of w) board[sq(n)] = 0;
  for (const n of b) board[sq(n)] = 1;
  for (const n of W) board[sq(n)] = 2;
  for (const n of B) board[sq(n)] = 3;
  return { ...s, board, positions: [] };
}

test('Aufstellung: je 12 Steine auf dunklen Feldern, dunkles Eckfeld links unten', () => {
  const b = startBoard();
  assert.equal(b.filter((x) => x === 0).length, 12);
  assert.equal(b.filter((x) => x === 1).length, 12);
  b.forEach((x, k) => x !== null && assert.ok(dark(k)));
  assert.ok(dark(sq('a1')) && dark(sq('h8'))); // links vom Host und links vom Gast
  assert.equal(b[sq('a1')], 0);
  assert.equal(b[sq('h8')], 1);
  const s = newGame({ white: 1 });
  assert.equal(s.turn, 1); // Weiß fängt an
  assert.equal(legalMoves(s.board, 1).length, 7); // 7 Eröffnungszüge
});

test('Ziehen: Stein schräg ein Feld vorwärts, nicht rückwärts, nicht weiter', () => {
  let s = setup({ w: ['c3'], b: ['h8'] });
  assert.deepEqual(legalMoves(s.board, 0).map((m) => m.path).sort(), [path('c3', 'b4'), path('c3', 'd4')].sort());
  assert.equal(play(s, 0, { path: path('c3', 'b2') }), null); // rückwärts
  assert.equal(play(s, 0, { path: path('c3', 'e5') }), null); // zu weit
  assert.equal(play(s, 1, { path: path('h8', 'g7') }), null); // nicht dran
  s = play(s, 0, { path: path('c3', 'd4') });
  assert.equal(s.board[sq('d4')], 0);
  assert.equal(s.turn, 1);
});

test('Schlagen: nur vorwärts, Schlagzwang, Mehrfachschlagen im Zickzack', () => {
  // Weiß c3 kann d4 schlagen, dann f6 → Zickzack über e5? Aufbau: b auf d4 und d6 → c3×e5×c7
  let s = setup({ w: ['c3', 'g3'], b: ['d4', 'd6', 'h8'] });
  const moves = legalMoves(s.board, 0);
  assert.deepEqual(moves.map((m) => m.path), [path('c3', 'e5', 'c7')]); // Schlagzwang: nur dieser Zug
  assert.equal(play(s, 0, { path: path('g3', 'h4') }), null); // Schlagzwang übergangen
  assert.equal(play(s, 0, { path: path('c3', 'e5') }), null); // zu früh aufgehört
  s = play(s, 0, { path: path('c3', 'e5', 'c7') });
  assert.equal(s.board[sq('d4')], null);
  assert.equal(s.board[sq('d6')], null);
  assert.equal(s.board[sq('c7')], 0);
  // Rückwärts schlagen gibt es für Steine nicht
  s = setup({ w: ['e5'], b: ['d4', 'h8'] });
  assert.ok(!mustJump(s, 0));
});

test('Freie Wahl der Schlagfolge (keine Mehrheitspflicht)', () => {
  const s = setup({ w: ['c3', 'g3'], b: ['d4', 'f4', 'f6', 'h8'] });
  const paths = legalMoves(s.board, 0).map((m) => m.path.join());
  assert.ok(paths.includes(path('c3', 'e5', 'g7').join())); // zwei Steine
  assert.ok(paths.includes(path('g3', 'e5', 'g7').join())); // auch zwei
  const one = setup({ w: ['c3', 'a3'], b: ['d4', 'b4', 'f6', 'h8'] });
  const lens = legalMoves(one.board, 0).map((m) => m.took.length);
  assert.ok(lens.includes(1) && lens.includes(2)); // a3×c5 (1) und c3×e5×g7 (2) sind beide erlaubt
  assert.ok(play(one, 0, { path: path('a3', 'c5') }));
});

test('Umwandlung: letzte Reihe = Dame, der Zug endet dort', () => {
  let s = setup({ w: ['a7'], b: ['h4'] });
  s = play(s, 0, { path: path('a7', 'b8') });
  assert.equal(s.board[sq('b8')], 2);
  assert.ok(s.last.crown);
  // Schlagend auf die letzte Reihe: Dame, kein Weiterschlagen (Steine schlagen nur vorwärts)
  s = setup({ w: ['b6'], b: ['c7', 'a1'] });
  const [m] = legalMoves(s.board, 0);
  assert.deepEqual(m.path, path('b6', 'd8'));
  assert.ok(m.crown);
  // Spieler 1 wandelt auf Reihe 1 um
  s = setup({ w: ['h8'], b: ['b2'], turn: 1 });
  s = play(s, 1, { path: path('b2', 'a1') });
  assert.equal(s.board[sq('a1')], 3);
});

test('Dame: fliegt vor- und rückwärts, schlägt aus der Ferne, landet beliebig dahinter', () => {
  let s = setup({ W: ['a1'], b: ['h8', 'h6'] });
  assert.equal(legalMoves(s.board, 0).length, 6); // b2 … g7
  s = setup({ W: ['a1'], b: ['d4', 'a7'] });
  const lands = legalMoves(s.board, 0).map((m) => m.path[1]).sort((a, b) => a - b);
  assert.deepEqual(lands, [sq('h8'), sq('g7'), sq('f6'), sq('e5')].sort((a, b) => a - b));
  // Zwei Steine direkt hintereinander: kein Schlag
  s = setup({ W: ['a1'], b: ['d4', 'e5', 'a7'] });
  assert.ok(!mustJump(s, 0));
  // Rückwärts schlagen und weiter
  s = setup({ W: ['f6'], b: ['d4', 'b4', 'h8'] });
  const m = legalMoves(s.board, 0);
  assert.ok(m.some((x) => x.took.length === 2 && x.path[1] === sq('c3'))); // landet sie auf c3, muss sie weiterschlagen
  assert.ok(!m.some((x) => x.path.length === 2 && x.path[1] === sq('c3')));
  assert.ok(m.some((x) => x.path.join() === path('f6', 'a1').join())); // dahinter frei landen ist erlaubt
});

test('Türkischer Schlag: geschlagene Steine bleiben bis zum Zugende und blockieren', () => {
  // Dame b2 schlägt c3 und landet auf d4 – ringsum weitere Gegner; c3 darf nicht zweimal geschlagen werden
  const s = setup({ W: ['b2'], b: ['c3', 'e3', 'e5', 'c5', 'h8'] });
  const moves = legalMoves(s.board, 0);
  for (const m of moves) assert.equal(new Set(m.took).size, m.took.length);
  assert.ok(moves.some((m) => m.took.length >= 2));
  // Der geschlagene Stein liegt noch: Dame a1 schlägt c3 (landet d4), schlägt e5 zurück Richtung … c3 ist dann im Weg
  const t = setup({ W: ['a1'], b: ['c3', 'e5', 'f2', 'h8'] });
  for (const m of legalMoves(t.board, 0)) assert.ok(!m.took.includes(sq('c3')) || m.took.indexOf(sq('c3')) === m.took.lastIndexOf(sq('c3')));
});

test('Gleichheit: jeder erzeugte Zug ist erlaubt, inspect findet keinen Verstoß (Zufallspartien)', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let g = 0; g < 40; g++) {
    let s = newGame({ white: g % 2 });
    for (let n = 0; n < 150 && !s.result; n++) {
      const moves = legalMoves(s.board, s.turn);
      for (const m of moves) {
        const c = inspect(s.board, s.turn, m.path);
        assert.ok(c, `Zug ${m.path}`);
        assert.deepEqual(c.why, [], `Zug ${m.path}: ${c.why}`);
        assert.deepEqual([...c.took].sort(), [...m.took].sort());
        assert.equal(c.crown, m.crown);
      }
      const m = moves[Math.floor(rng() * moves.length)];
      s = play(s, s.turn, { path: m.path });
      assert.ok(s);
    }
  }
});

test('Spielende: keine Steine oder kein Zug mehr', () => {
  let s = setup({ w: ['c3'], b: ['d4'] });
  s = play(s, 0, { path: path('c3', 'e5') });
  assert.deepEqual(s.result, { winner: 0, reason: 'steine' });
  // Schwarz a7 blockiert durch Weiß b6 (c5 besetzt dahinter)
  s = setup({ w: ['b6', 'c5', 'h2'], b: ['a7'] });
  s = play(s, 0, { path: path('h2', 'g3') });
  assert.deepEqual(s.result, { winner: 0, reason: 'blockiert' });
  assert.equal(play(s, 1, { path: path('a7', 'b6') }), null);
});

test('Remis: dreimal dieselbe Stellung, 25 Züge je Seite nur mit Damen', () => {
  let s = setup({ W: ['a1'], B: ['h2'] });
  const loop = [[0, 'a1', 'b2'], [1, 'h2', 'g1'], [0, 'b2', 'a1'], [1, 'g1', 'h2']];
  for (let i = 0; i < 12 && !s.result; i++) {
    const [p, a, b] = loop[i % 4];
    s = play(s, p, { path: path(a, b) });
  }
  assert.deepEqual(s.result, { winner: null, reason: 'wiederholung' });
  s = { ...setup({ W: ['a1'], B: ['h8'], w: ['c3'] }), quiet: QUIET_LIMIT - 1 };
  const z = play(s, 0, { path: path('a1', 'b2') });
  assert.deepEqual(z.result, { winner: null, reason: 'zuege' });
  const y = play(s, 0, { path: path('c3', 'd4') }); // Stein gezogen: Zählung beginnt neu
  assert.equal(y.quiet, 0);
  assert.equal(y.result, null);
});

test('Ohne Hilfen: regelwidrige Züge gehen durch und nennen den Verstoß', () => {
  const s = setup({ w: ['c3', 'g3', 'e5'], b: ['d4', 'f6', 'h8'], free: true });
  const cases = [
    [{ path: path('g3', 'h4') }, 'nicht geschlagen, obwohl Schlagzwang war'],
    [{ path: path('e5', 'f4') }, 'mit einem Stein rückwärts gezogen'],
    [{ path: path('c3', 'b4') }, 'nicht geschlagen, obwohl Schlagzwang war'],
    [{ path: path('e5', 'c3') }, null], // besetzt → geht gar nicht
    [{ path: path('g3', 'e1') }, 'mit einem Stein rückwärts gezogen'],
  ];
  for (const [mv, why] of cases) {
    const n = play(s, 0, mv);
    if (why === null) assert.equal(n, null);
    else assert.ok(n.cheat.why.includes(why), `${mv.path}: ${n.cheat.why}`);
  }
  // Stein schlägt rückwärts, Dame-Sprung mit einem Stein, Mehrfachschlagen abgebrochen, Umwandlung vergessen/erfunden
  let n = play(setup({ w: ['e5'], b: ['d4', 'h8'], free: true }), 0, { path: path('e5', 'c3') });
  assert.deepEqual(n.cheat.why, ['mit einem Stein rückwärts geschlagen']);
  n = play(setup({ w: ['a1'], b: ['c3', 'h8'], free: true }), 0, { path: path('a1', 'e5') });
  assert.ok(n.cheat.why.includes('mit einem Stein wie eine Dame geschlagen'));
  n = play(setup({ w: ['c3'], b: ['d4', 'd6', 'h8'], free: true }), 0, { path: path('c3', 'e5'), crown: false });
  assert.deepEqual(n.cheat.why, ['beim Mehrfachschlagen zu früh aufgehört']);
  n = play(setup({ w: ['a7'], b: ['h4'], free: true }), 0, { path: path('a7', 'b8'), crown: false });
  assert.deepEqual(n.cheat.why, ['den Stein auf der letzten Reihe nicht zur Dame gemacht']);
  assert.equal(n.board[sq('b8')], 0);
  n = play(setup({ w: ['c5'], b: ['h4'], free: true }), 0, { path: path('c5', 'b6'), crown: true });
  assert.deepEqual(n.cheat.why, ['einen Stein zur Dame gemacht, der die letzte Reihe nicht erreicht hat']);
  assert.equal(n.board[sq('b6')], 2);
  // Regelgerecht ohne Hilfen: keine Gründe
  n = play(setup({ w: ['a7'], b: ['h4'], free: true }), 0, { path: path('a7', 'b8'), crown: true });
  assert.deepEqual(n.cheat.why, []);
  // Über eigene Steine geht es nie
  assert.equal(play(setup({ W: ['a1'], w: ['c3'], b: ['h8'], free: true }), 0, { path: path('a1', 'e5') }), null);
  // Ohne free: alles Regelwidrige abgelehnt
  assert.equal(play(setup({ w: ['e5'], b: ['h8'] }), 0, { path: path('e5', 'd4') }), null);
});

test('Geschummelt!: erwischt = Zug zurück + Verwarnung, Fehlalarm = Verwarnung für den Rufer, 3 = verloren', () => {
  let s = setup({ w: ['e5', 'a1'], b: ['d4', 'h8'], free: true });
  s = play(s, 0, { path: path('e5', 'c3') }); // rückwärts geschlagen
  assert.equal(accuse(s, 0), null); // eigener Zug
  const caught = accuse(s, 1);
  assert.equal(caught.turn, 0);
  assert.equal(caught.board[sq('d4')], 1); // Stein ist wieder da
  assert.deepEqual(caught.strikes, [1, 0]);
  assert.ok(caught.verdict.caught && caught.verdict.why.includes('rückwärts'));
  // Fehlalarm
  let t = play(setup({ w: ['a1'], b: ['h8'], free: true }), 0, { path: path('a1', 'b2') });
  t = accuse(t, 1);
  assert.deepEqual(t.strikes, [0, 1]);
  assert.equal(t.verdict.caught, false);
  assert.equal(t.turn, 1); // Zug bleibt, Rufer ist dran
  assert.equal(accuse(t, 1), null); // nur einmal
  // dritte Verwarnung
  let u = { ...setup({ w: ['e5', 'a1'], b: ['d4', 'h8'], free: true }), strikes: [2, 0] };
  u = accuse(play(u, 0, { path: path('e5', 'c3') }), 1);
  assert.deepEqual(u.result, { winner: 1, reason: 'schummeln' });
  // Zug, der das Spiel beendet, kann noch angeprangert werden
  let v = play(setup({ w: ['e5'], b: ['d4'], free: true }), 0, { path: path('e5', 'c3') });
  assert.ok(v.result);
  v = accuse(v, 1);
  assert.equal(v.result, null);
  assert.equal(v.board[sq('d4')], 1);
  // waive schließt die Frist, forGuest verrät nichts
  const w = play(setup({ w: ['e5', 'a1'], b: ['d4', 'h8'], free: true }), 0, { path: path('e5', 'c3') });
  assert.equal(forGuest(w).cheat.why, undefined);
  assert.equal(waive(w, 1).cheat, null);
});

test('Revanche tauscht die Farben, Hilfsfunktionen', () => {
  const s = setup({ w: ['c3'], b: ['d4', 'h8'] });
  assert.deepEqual(movable(s, 0), [sq('c3')]);
  assert.equal(continuations(s, 0, path('c3')).length, 1);
  const end = play(setup({ w: ['c3'], b: ['d4'] }), 0, { path: path('c3', 'e5') });
  const r = again(end);
  assert.equal(r.white, 1);
  assert.equal(r.turn, 1);
  assert.equal(again(newGame()), null);
});

test('Computer: nimmt Pflichtschläge, schlägt den besseren Zug, bleibt in der Zeit', () => {
  // Schlagzwang
  let s = setup({ w: ['c3', 'g3'], b: ['d4', 'h8'], turn: 1 });
  for (const level of [0, 1, 2]) {
    const m = chooseMove({ ...s, turn: 0 }, 0, { level, rng: () => 0.5 });
    assert.deepEqual(m.path, path('c3', 'e5'));
  }
  // Schwer gewinnt eine einfache Stellung: Dame gegen einzelnen Stein
  let g = setup({ W: ['d4'], b: ['b6'], turn: 0 });
  for (let i = 0; i < 40 && !g.result; i++) g = play(g, g.turn, chooseMove(g, g.turn, { level: 2 }));
  assert.equal(g.result?.winner, 0);
  // Startstellung: Schwer antwortet in gut 1,5 s
  const t = Date.now();
  assert.ok(chooseMove(newGame(), 0, { level: 2 }));
  assert.ok(Date.now() - t < 2500);
});

test('Computer schummelt plausibel: Schlagzwang übergehen oder rückwärts schlagen', () => {
  const s = setup({ w: ['e5', 'a3'], b: ['d4', 'h8'], free: true });
  const m = cheatMove(s, 0, () => 0.3);
  assert.ok(m);
  const n = play(s, 0, m);
  assert.ok(n && n.cheat.why.length > 0, String(n?.cheat.why));
});

test('Computer: Mittel schlägt Leicht', () => {
  let wins = 0;
  let seed = 3;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let g = 0; g < 4; g++) {
    let s = newGame({ white: g % 2 });
    for (let i = 0; i < 200 && !s.result; i++) {
      const level = s.turn === 0 ? 1 : 0;
      s = play(s, s.turn, chooseMove(s, s.turn, { level, rng }));
    }
    if (s.result?.winner === 0) wins++;
  }
  assert.ok(wins >= 3, `nur ${wins} von 4`);
});
