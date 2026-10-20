// Schach „Ohne Hilfen“ allein gegen den Computer (Nico 20.10.2026): Schummelzüge des Computers, Verzicht auf die
// Anklage und keine Hilfen mehr (kein „Schach!“, kein +/# auf dem Zettel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, move, accuse, again, takeBack, turnOf, waive, cheatMove, anyMove, kingExposed } from '../src/schach/game.js';
import { rematchBlocked } from '../src/schummeln.js';

const free = (fen) => ({ ...newGame(0, { free: true }), fen, positions: [] }); // Spieler 0 = Weiß
const play = (s, list) => list.split(' ').reduce((t, uci) => move(t, turnOf(t), uci), s);
const RNG = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((v) => () => v);

test('allein ohne Hilfen: neue Partie mit Verwarnungen, Zurücknehmen bleibt aus', () => {
  const s = newGame(1, { free: true }); // Computer (1) hat Weiß
  assert.equal(s.free, true);
  assert.deepEqual(s.strikes, [0, 0]);
  assert.equal(takeBack(move(s, 1, 'e2e4'), 1), null);
});

test('waive: der Computer verzichtet – die Frist ist zu, die Revanche frei', () => {
  const s = play(newGame(0, { free: true }), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7'); // Schäfermatt durch den Menschen
  assert.deepEqual(s.result, { winner: 0, reason: 'matt' });
  assert.equal(rematchBlocked(s, 0), true);
  assert.equal(waive(s, 0), null); // den eigenen Zug kann man nicht „durchwinken“
  const w = waive(s, 1);
  assert.equal(w.cheat, null);
  assert.deepEqual(w.result, s.result);
  assert.deepEqual(w.strikes, [0, 0]);
  assert.equal(rematchBlocked(w, 0), false);
  assert.equal(again(w).free, true);
  assert.equal(waive(w, 1), null); // nichts mehr offen
  assert.equal(waive(play(newGame(0), 'e2e4'), 1), null); // mit Hilfen gibt es keine Frist
});

test('ohne Hilfen: kein +/# auf dem Zettel und kein „Schach“ im Zustand – Matt beendet trotzdem', () => {
  const legal = play(newGame(0, { free: true }), 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
  assert.equal(legal.san.at(-1), 'Qxf7');
  assert.equal(legal.check, false);
  const check = play(newGame(0, { free: true }), 'e2e4 f7f6 d1h5');
  assert.equal(check.san.at(-1), 'Qh5');
  assert.equal(check.check, false);
  assert.equal(check.result, null);
  const cheat = move(free('7k/6pp/8/8/8/8/P7/R5K1 w - - 0 1'), 0, 'a1a8'); // Turm springt über den Bauern: Grundreihenmatt
  assert.equal(cheat.cheat.legal, false);
  assert.equal(cheat.san.at(-1), 'Ra8');
  assert.equal(cheat.check, false);
  assert.deepEqual(cheat.result, { winner: 0, reason: 'matt' });
  assert.equal(play(newGame(0), 'e2e4 f7f6 d1h5').san.at(-1), 'Qh5+'); // mit Hilfen unverändert
});

test('Schummelzug des Computers: ein Feld zu weit, regelwidrig, über move()', () => {
  for (const fen of [newGame(0).fen, 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', '4k3/8/3r4/3p4/8/8/8/3QK3 w - - 0 1']) {
    const s = free(fen);
    for (const rng of RNG) {
      const uci = cheatMove(s, rng);
      assert.ok(uci, fen);
      const next = move(s, turnOf(s), uci);
      assert.ok(next, uci);
      assert.equal(next.cheat.legal, false, uci);
      assert.equal(next.cheat.player, turnOf(s));
    }
  }
  const pawns = free(newGame(0).fen);
  assert.match(cheatMove(pawns, () => 0), /^[a-h]2[a-h]5$/); // Bauer drei Felder statt zwei
});

test('Schummelzug: am liebsten mit Schlagen, nie auf eine eigene Figur oder einen König', () => {
  const s = free('4k3/8/3r4/3p4/8/8/8/3QK3 w - - 0 1'); // Dame springt über den Bauern und schlägt den Turm
  for (const rng of RNG) assert.equal(cheatMove(s, rng), 'd1d6');
  assert.deepEqual(move(s, 0, 'd1d6').captured, ['br']);
  // Turm bis a7 schlägt, ein Feld weiter stünde der König; Läufer, König und Bauern haben nichts „zu weit“
  assert.equal(cheatMove(free('k7/p7/8/8/8/6pp/6PP/R5BK w - - 0 1'), () => 0), null);
});

test('regelwidrige Stellung: steht der König des Menschen im Schach, zieht der Computer irgendetwas Erlaubtes', () => {
  const start = free('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1');
  assert.equal(kingExposed(start), false);
  const s = move(start, 0, 'e2c3'); // gefesselter Springer – der weiße König steht jetzt im Schach
  assert.equal(kingExposed(s), true);
  for (const rng of RNG) {
    const uci = anyMove(s, rng);
    assert.notEqual(uci, 'e7e1');
    const next = move(s, 1, uci);
    assert.ok(next, uci);
    assert.equal(next.cheat.legal, true);
  }
});

// Befund der Prüfung 20.10.2026: Stockfish lehnt jede Stellung ab, in der der König der Seite, die nicht am Zug ist,
// angegriffen wird – auch wenn chess.js keinen erlaubten Königsschlag anbietet (gedecktes Feld, gefesselter Angreifer).
test('kingExposed: König neben den König auf ein gedecktes Feld gestellt – angegriffen, obwohl kein erlaubter Schlag', () => {
  const k = move(free('8/7k/5K2/5P2/8/8/8/8 w - - 0 1'), 0, 'f6g6');
  assert.equal(k.cheat.legal, false);
  assert.equal(kingExposed(k), true);
  assert.equal(anyMove(k) !== null, true);
  assert.equal(kingExposed(move(free('8/7k/5K2/5P2/8/8/8/8 w - - 0 1'), 0, 'f6e6')), false); // regelgerecht
  // einziger erlaubter Zug wäre der Königsschlag: anyMove hilft nicht – darum ruft der Computer hier immer
  const only = move(free('7k/5Kpp/8/8/8/8/8/8 w - - 0 1'), 0, 'f7g8');
  assert.equal(kingExposed(only), true);
});

test('allein ohne Hilfen: der Computer ruft – erwischt, der Mensch zieht neu; dann erwischt der Mensch ihn', () => {
  let s = move(newGame(0, { free: true }), 0, 'e2e5'); // drei Felder
  const caught = accuse(s, 1);
  assert.deepEqual(caught.verdict, { caught: true, player: 0, by: 1, why: 'ein Bauer zieht höchstens zwei Felder vor' });
  assert.equal(turnOf(caught), 0);
  s = move(caught, 0, 'e2e4');
  s = move(s, 1, cheatMove(s, () => 0));
  const back = accuse(s, 0);
  assert.deepEqual(back.strikes, [1, 1]);
  assert.equal(turnOf(back), 1); // der Computer muss neu ziehen
});

// Nico 20.10.2026: „Dann soll auch erklärt werden was falsch war“ – Grund versteckt im cheat, erst beim Erwischen im verdict
const why = (fen, uci) => {
  const s = free(fen);
  const next = move(s, turnOf(s), uci);
  assert.equal(next.cheat.legal, false, uci);
  return next.cheat.why;
};

test('Grund: König im Schach – stand drin und bleibt es, stünde danach drin', () => {
  assert.equal(why('4k3/4r3/8/8/8/8/P7/4K3 w - - 0 1', 'a2a3'), 'der König stand im Schach und bleibt es');
  assert.equal(why('4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1', 'e2c3'), 'der König stünde danach im Schach'); // gefesselt
  assert.equal(why('4k3/3r4/8/8/8/8/8/4K3 w - - 0 1', 'e1d1'), 'der König stünde danach im Schach');
  assert.equal(why('4k3/4r3/8/8/8/8/8/4K3 w - - 0 1', 'e1e2'), 'der König stünde danach im Schach'); // König zieht im Schach weiter ins Schach
});

test('Grund: der Weg ist nicht frei', () => {
  assert.equal(why('7k/6pp/8/8/8/8/P7/R5K1 w - - 0 1', 'a1a8'), 'der Weg ist nicht frei'); // Turm über den Bauern
  assert.equal(why('4k3/8/3r4/3p4/8/8/8/3QK3 w - - 0 1', 'd1d6'), 'der Weg ist nicht frei'); // Dame über den Bauern
  assert.equal(why('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1', 'e2e4'), 'der Weg ist nicht frei'); // Bauer zwei Felder über eine Figur
});

test('Grund: so zieht die Figur nicht', () => {
  const fen = '4k3/8/8/8/8/8/8/1NBQK3 w - - 0 1';
  assert.equal(why(fen, 'c1c4'), 'so zieht ein Läufer nicht');
  assert.equal(why(fen, 'b1b3'), 'so zieht ein Springer nicht');
  assert.equal(why(fen, 'd1e3'), 'so zieht eine Dame nicht');
  assert.equal(why(fen, 'e1e3'), 'so zieht ein König nicht');
  assert.equal(why('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1b3'), 'so zieht ein Turm nicht');
  assert.equal(why('4k3/8/8/8/8/8/8/3K4 w - - 0 1', 'd1f1'), 'so zieht ein König nicht'); // zwei Felder, aber nicht vom Startfeld
  // falsch gezogen und der König bleibt im Schach: beide Gründe
  assert.equal(why('4k3/4r3/8/8/8/8/8/2B1K3 w - - 0 1', 'c1c4'), 'so zieht ein Läufer nicht und der König stand im Schach und bleibt es');
});

test('Grund: Bauern – schlägt nur schräg, zieht nur geradeaus vor', () => {
  assert.equal(why('4k3/8/8/8/4p3/4P3/8/4K3 w - - 0 1', 'e3e4'), 'ein Bauer schlägt nur schräg');
  assert.equal(why('4k3/8/4p3/4P3/8/8/8/4K3 b - - 0 1', 'e6e5'), 'ein Bauer schlägt nur schräg'); // Schwarz zieht nach unten
  assert.equal(why(newGame(0).fen, 'e2e5'), 'ein Bauer zieht höchstens zwei Felder vor');
  assert.equal(why('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', 'e3e5'), 'ein Bauer zieht nur ein Feld vor');
  assert.equal(why(newGame(0).fen, 'e2d3'), 'ein Bauer zieht nur zum Schlagen schräg');
  assert.equal(why('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', 'e3e2'), 'ein Bauer zieht nur vorwärts');
  assert.equal(why('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1', 'e3d3'), 'so zieht ein Bauer nicht');
});

test('Grund: Rochade nicht erlaubt – und warum', () => {
  assert.equal(why('4k3/8/8/8/8/8/8/4K2R w - - 0 1', 'e1g1'), 'Rochade nicht erlaubt, König oder Turm hat schon gezogen');
  assert.equal(why('4k3/8/8/8/8/8/8/4KB1R w K - 0 1', 'e1g1'), 'Rochade nicht erlaubt, der Weg ist nicht frei');
  assert.equal(why('r3k3/8/8/8/8/8/8/4K3 b - - 0 1', 'e8c8'), 'Rochade nicht erlaubt, König oder Turm hat schon gezogen');
  assert.equal(why('4k3/4r3/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'), 'Rochade nicht erlaubt, der König stand im Schach');
  assert.equal(why('4k3/5r2/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'), 'Rochade nicht erlaubt, der König zöge durch Schach');
  assert.equal(why('4k3/6r1/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'), 'Rochade nicht erlaubt, der König stünde danach im Schach');
});

test('Grund: versteckt bis zum Erwischen, dann im verdict – beim Fehlalarm keiner', () => {
  const s = move(free('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 0, 'c1c4');
  assert.equal(s.verdict, null);
  const caught = accuse(s, 1);
  assert.deepEqual(caught.verdict, { caught: true, player: 0, by: 1, why: 'so zieht ein Läufer nicht' });
  assert.equal(caught.cheat, null);
  const legal = move(free('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'), 0, 'c1e3');
  assert.equal(legal.cheat.legal, true);
  assert.deepEqual(accuse(legal, 1).verdict, { caught: false, player: 1, by: 1 });
});
