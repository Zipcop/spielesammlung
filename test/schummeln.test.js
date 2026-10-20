// „Ohne Hilfen“: regelwidrige Züge sind erlaubt, „Geschummelt!“ deckt sie bis zum nächsten Zug auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mau from '../src/maumau/game.js';
import * as kniffel from '../src/kniffel/game.js';
import * as schach from '../src/schach/game.js';
import { makeDeck } from '../src/karten/cards.js';

// --- Mau-Mau ---

function mauSetup({ hands, pile, turn = 0, free = true, ...rest }) {
  const used = [...hands.flat(), ...pile];
  return {
    ...mau.newGame(0, Math.random, { free }),
    hands,
    pile,
    talon: makeDeck('7').filter((c) => !used.includes(c)),
    turn,
    ...rest,
  };
}

test('Mau-Mau mit Hilfen: unpassende Karte bleibt verboten, kein Anprangern', () => {
  const s = mauSetup({ hands: [['c9', 'sK', 'dA'], ['h8', 'h9']], pile: ['hT'], free: false });
  assert.equal(mau.play(s, 0, { card: 'c9' }), null);
  const ok = mau.play(s, 0, { card: 'dA' }) ?? mau.play(s, 0, { card: 'sK' });
  assert.equal(ok, null); // keine passt – Herz 10 liegt
  assert.equal(mau.accuse(s, 1), null);
});

test('Mau-Mau ohne Hilfen: unpassende Karte geht, Anprangern → zurück auf die Hand + 2 Strafkarten', () => {
  const s = mauSetup({ hands: [['c9', 'sK', 'dA'], ['h8', 'h9']], pile: ['hT'] });
  const cheated = mau.play(s, 0, { card: 'c9' });
  assert.ok(cheated);
  assert.equal(cheated.turn, 1);
  assert.deepEqual(cheated.cheat.player, 0);
  assert.equal(cheated.cheat.legal, false);
  assert.equal(mau.accuse(cheated, 0), null); // sich selbst anprangern geht nicht

  const caught = mau.accuse(cheated, 1);
  assert.deepEqual(caught.pile, ['hT']);
  assert.equal(caught.hands[0].length, 3 + mau.CHEAT_PENALTY);
  assert.ok(caught.hands[0].includes('c9'));
  assert.equal(caught.turn, 0); // der Schummler ist wieder dran
  assert.equal(caught.cheat, null);
  assert.equal(caught.events[0].type, 'caught');
  assert.equal(mau.accuse(caught, 1), null); // nur einmal
});

test('Mau-Mau ohne Hilfen: Fehlalarm kostet den Ankläger 1 Karte', () => {
  const s = mauSetup({ hands: [['h9', 'sK', 'dA'], ['h8', 'c7']], pile: ['hT'] });
  const fair = mau.play(s, 0, { card: 'h9' });
  assert.equal(fair.cheat.legal, true);
  const alarm = mau.accuse(fair, 1);
  assert.equal(alarm.hands[1].length, 2 + mau.FALSE_ALARM_PENALTY);
  assert.deepEqual(alarm.pile, ['hT', 'h9']); // Zug bleibt
  assert.equal(alarm.turn, 1);
  assert.equal(alarm.events[0].type, 'fehlalarm');
});

test('Mau-Mau ohne Hilfen: Anprangern nur bis zum nächsten Zug', () => {
  const s = mauSetup({ hands: [['c9', 'sK', 'dA'], ['h8', 'h9']], pile: ['hT'] });
  const cheated = mau.play(s, 0, { card: 'c9' });
  const answered = mau.draw(cheated, 1);
  assert.equal(answered.cheat, null);
  assert.equal(mau.accuse(answered, 1), null);
});

test('Mau-Mau ohne Hilfen: 7 mit anderer Karte überdeckt – ohne Anprangern muss niemand ziehen', () => {
  const s = mauSetup({ hands: [['c9', 'sK', 'dA'], ['h8', 'h9']], pile: ['h7'], sevens: 1 });
  const dodged = mau.play(s, 0, { card: 'sK' });
  assert.equal(dodged.sevens, 0);
  assert.equal(dodged.cheat.legal, false);
  const caught = mau.accuse(dodged, 1);
  assert.equal(caught.sevens, 1); // die 7 gilt wieder
  assert.deepEqual(caught.pile, ['h7']);
});

test('Mau-Mau ohne Hilfen: gezogene Karte darf man immer behalten oder legen', () => {
  const s = mauSetup({ hands: [['c9', 'sK'], ['h8', 'h9']], pile: ['hT'] });
  s.talon = [...s.talon.filter((c) => c !== 'cQ'), 'cQ']; // oben liegt Kreuz Dame, passt nicht auf Herz 10
  const drawn = mau.draw(s, 0);
  assert.equal(drawn.drawn, 'cQ');
  assert.equal(drawn.turn, 0); // ohne Hilfen verrät das Spiel nicht, dass sie nicht passt
  const played = mau.play(drawn, 0, { card: 'cQ' });
  assert.equal(played.cheat.legal, false);
});

test('Mau-Mau ohne Hilfen: Sieg mit Schummelkarte lässt sich noch anfechten', () => {
  const s = mauSetup({ hands: [['c9'], ['h8', 'h9']], pile: ['hT'] });
  const won = mau.play(s, 0, { card: 'c9' });
  assert.equal(won.winner, 0);
  const caught = mau.accuse(won, 1);
  assert.equal(caught.winner, null);
  assert.equal(caught.hands[0].length, 1 + mau.CHEAT_PENALTY);
});

test('Mau-Mau: der Gast sieht nicht, ob geschummelt wurde', () => {
  const s = mauSetup({ hands: [['c9', 'sK', 'dA'], ['h8', 'h9']], pile: ['hT'] });
  const cheated = mau.play(s, 0, { card: 'c9' });
  const view = mau.viewFor(cheated, 1);
  assert.deepEqual(view.cheat, { player: 0 });
  assert.equal(JSON.stringify(view).includes('sK'), false); // auch nicht über den alten Stand
});

test('Mau-Mau: Revanche behält den Modus', () => {
  const s = mauSetup({ hands: [['c9'], ['h8']], pile: ['hT'] });
  const won = mau.play(s, 0, { card: 'c9' });
  assert.equal(mau.again(won).free, true);
});

// --- Kniffel ---

test('Kniffel mit Hilfen: Punkte rechnet das Spiel, höchstens 3 Würfe, kein Anprangern', () => {
  let s = kniffel.newGame(0);
  s = kniffel.applyRoll(s, 0, [1, 1, 1, 2, 3]);
  s = kniffel.scoreField(s, 0, 'fullHouse', 25);
  assert.equal(s.cards[0].fullHouse, 0);
  assert.equal(s.cheat, null);
  assert.equal(kniffel.accuse(s, 1), null);
});

test('Kniffel ohne Hilfen: falsche Punkte erwischt → Feld wird mit 0 gestrichen', () => {
  let s = kniffel.newGame(0, { free: true });
  s = kniffel.applyRoll(s, 0, [1, 1, 1, 2, 3]);
  assert.equal(kniffel.scoreField(s, 0, 'fullHouse'), null); // ohne Hilfen muss man die Punkte angeben
  s = kniffel.scoreField(s, 0, 'fullHouse', 25);
  assert.equal(s.cards[0].fullHouse, 25);
  assert.equal(s.cheat.legal, false);
  s = kniffel.accuse(s, 1);
  assert.equal(s.cards[0].fullHouse, 0);
  assert.deepEqual(s.verdict, { caught: true, player: 0, by: 1, field: 'fullHouse', why: 'Full House: 25 statt 0 Punkte' }); // 1-1-1-2-3 ist kein Full House
  assert.equal(s.turn, 1); // der Zug ist trotzdem vorbei
});

test('Kniffel ohne Hilfen: vierter Wurf ist möglich, zählt aber als Schummeln', () => {
  let s = kniffel.newGame(0, { free: true });
  for (let i = 0; i < 4; i++) s = kniffel.applyRoll(s, 0, [6, 6, 6, 6, 6]);
  assert.equal(s.rolls, 4);
  s = kniffel.scoreField(s, 0, 'kniffel', 50);
  assert.equal(s.cheat.legal, false);
  assert.equal(kniffel.accuse(s, 1).cards[0].kniffel, 0);
});

test('Kniffel ohne Hilfen: Fehlalarm kostet 10 Punkte, Anprangern nur bis zum nächsten Wurf', () => {
  let s = kniffel.newGame(0, { free: true });
  s = kniffel.applyRoll(s, 0, [2, 2, 2, 5, 5]);
  s = kniffel.scoreField(s, 0, 'fullHouse', 25);
  assert.equal(s.cheat.legal, true);
  const alarm = kniffel.accuse(s, 1);
  assert.equal(alarm.cards[0].fullHouse, 25);
  assert.deepEqual(kniffel.scores(alarm), [25, -kniffel.FALSE_ALARM_POINTS]);

  const later = kniffel.applyRoll(s, 1, [1, 2, 3, 4, 5]);
  assert.equal(later.cheat, null);
  assert.equal(kniffel.accuse(later, 1), null);
});

test('Kniffel ohne Hilfen: unsinnige Eingaben werden abgelehnt', () => {
  let s = kniffel.newGame(0, { free: true });
  s = kniffel.applyRoll(s, 0, [2, 2, 2, 5, 5]);
  for (const claim of [-1, 2.5, kniffel.MAX_CLAIM + 1, '25', null]) assert.equal(kniffel.scoreField(s, 0, 'chance', claim), null);
});

// --- Schach ---

const turn = (s) => schach.turnOf(s);

test('Schach ohne Hilfen: regelwidriger Zug geht, Anprangern nimmt ihn zurück und verwarnt', () => {
  let s = schach.newGame(0, { free: true });
  s = schach.move(s, turn(s), 'e2e4');
  assert.equal(s.cheat.legal, true);
  s = schach.move(s, turn(s), 'd8h4'); // Dame springt über den eigenen Bauern
  assert.ok(s);
  assert.equal(s.cheat.legal, false);
  assert.equal(s.cheat.player, 1);
  const caught = schach.accuse(s, 0);
  assert.equal(caught.fen.split(' ')[0], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  assert.equal(turn(caught), 1); // Schwarz muss neu ziehen
  assert.deepEqual(caught.strikes, [0, 1]);
  assert.equal(caught.verdict.caught, true);
  assert.equal(caught.result, null);
});

test('Schach ohne Hilfen: Fehlalarm verwarnt den Ankläger, dritte Verwarnung verliert', () => {
  let s = schach.newGame(0, { free: true });
  for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3']) {
    s = schach.move(s, turn(s), uci);
    s = schach.accuse(s, turn(s)) ?? s; // Weiß-Züge prangert Schwarz zu Unrecht an
  }
  assert.equal(s.strikes[1] >= 1, true);
  let t = schach.newGame(0, { free: true });
  for (let i = 0; i < 3; i++) {
    t = schach.move(t, turn(t), i % 2 ? 'f3g1' : 'g1f3');
    t = schach.accuse(t, 1);
    if (!t.result) t = schach.move(t, turn(t), i % 2 ? 'f6g8' : 'g8f6');
  }
  assert.deepEqual(t.strikes, [0, 3]);
  assert.deepEqual(t.result, { winner: 0, reason: 'schummeln' });
});

test('Schach ohne Hilfen: unmögliche Züge bleiben verboten', () => {
  const s = schach.newGame(0, { free: true });
  assert.equal(schach.move(s, 0, 'e7e5'), null); // fremde Figur
  assert.equal(schach.move(s, 0, 'd1d2'), null); // auf eigene Figur
  assert.equal(schach.move(s, 0, 'e3e4'), null); // leeres Feld
  assert.equal(schach.move(s, 1, 'e7e5'), null); // nicht dran
});

test('Schach ohne Hilfen: Könige werden nicht geschlagen, Bauern wandeln auf der letzten Reihe um', () => {
  let s = schach.newGame(0, { free: true });
  assert.equal(schach.move(s, 0, 'd1e8'), null);
  s = schach.move(s, 0, 'a2a7'); // Bauer „schlägt“ quer übers Brett
  assert.equal(s.captured.at(-1), 'bp');
  s = schach.move(s, 1, 'g8f6');
  s = schach.move(s, 0, 'a7b8n'); // Umwandlung in einen Springer
  assert.equal(s.fen.split(' ')[0].startsWith('rN'), true);
});

test('Schach ohne Hilfen: Anprangern nur bis zum nächsten Zug, Revanche behält den Modus', () => {
  let s = schach.newGame(0, { free: true });
  s = schach.move(s, 0, 'e2e5'); // drei Felder
  s = schach.move(s, 1, 'e7e6');
  assert.equal(s.cheat.player, 1); // der weiße Schummelzug ist nicht mehr anfechtbar
  assert.equal(schach.accuse(s, 1), null);
  assert.deepEqual(schach.accuse(s, 0).strikes, [1, 0]); // Weiß gegen den fairen schwarzen Zug = Fehlalarm
  s = schach.resign(s, 0);
  assert.equal(schach.again(s).free, true);
});

test('Schach ohne Hilfen: dreifache Wiederholung wird selbst gezählt', () => {
  let s = schach.newGame(0, { free: true });
  for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) s = schach.move(s, turn(s), uci);
  assert.deepEqual(s.result, { winner: null, reason: 'wiederholung' });
});

test('Schach mit Hilfen: unverändert regelstreng', () => {
  const s = schach.newGame(0);
  assert.equal(schach.move(s, 0, 'e2e5'), null);
  assert.equal(schach.accuse(s, 1), null);
  assert.equal(s.free, undefined);
});

// --- Befunde der Prüfung vom 19.10.2026 ---
import { rematchBlocked } from '../src/schummeln.js';

test('Schach ohne Hilfen: ein König im Schach kann trotzdem nicht geschlagen werden', () => {
  let s = { ...schach.newGame(0, { free: true }), fen: '4k3/4r3/8/8/8/8/4N3/4K3 w - - 0 1', positions: [] };
  s = schach.move(s, 0, 'e2c3'); // gefesselter Springer – regelwidrig, König steht danach im Schach
  assert.ok(s);
  assert.equal(schach.move(s, 1, 'e7e1'), null);
});

test('Schach ohne Hilfen: „Rochade“ nur vom Ausgangsfeld mit freier Bahn – sonst verschwindet nichts', () => {
  let s = { ...schach.newGame(0, { free: true }), fen: 'r3k3/8/8/8/8/8/8/R2QK3 w Qq - 0 1', positions: [] };
  s = schach.move(s, 0, 'e1c1'); // Dame auf d1 im Weg → nur der König zieht
  assert.equal(s.fen.split(' ')[0], 'r3k3/8/8/8/8/8/8/R1KQ4');
  let t = { ...schach.newGame(0, { free: true }), fen: '4k3/8/8/8/8/2K1q2R/8/8 w - - 0 1', positions: [] };
  t = schach.move(t, 0, 'c3e3'); // König nicht auf e1: kein Turm mitnehmen, schwarze Dame wird geschlagen
  assert.equal(t.fen.split(' ')[0], '4k3/8/8/8/8/4K2R/8/8');
  assert.deepEqual(t.captured.at(-1), 'bq');
  let o = { ...schach.newGame(0, { free: true }), fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1', positions: [] };
  o = schach.move(o, 0, 'e1g1');
  assert.equal(o.san.at(-1), 'O-O');
});

test('Mau-Mau ohne Hilfen: Schummel-8 bleibt anfechtbar, auch wenn der Schummler gleich weiterspielt', () => {
  const s = mauSetup({ hands: [['c8', 'cK', 'sA'], ['h7', 'h9']], pile: ['hT'] });
  const eight = mau.play(s, 0, { card: 'c8' }); // Kreuz 8 auf Herz 10 – passt nicht, 8 = nochmal dran
  assert.equal(eight.turn, 0);
  const again = mau.play(eight, 0, { card: 'cK' }); // legal hinterher
  assert.equal(again.cheat.legal, false); // der Schummelzug ist noch offen
  const caught = mau.accuse(again, 1);
  assert.deepEqual(caught.pile, ['hT']); // beide Karten zurück
  assert.equal(caught.hands[0].length, 3 + mau.CHEAT_PENALTY);
});

test('Revanche: wer zuletzt gezogen hat, kann die offene Anklage nicht wegklicken – der andere schon', () => {
  const s = mauSetup({ hands: [['c9'], ['h8']], pile: ['hT'] });
  const won = mau.play(s, 0, { card: 'c9' });
  assert.equal(rematchBlocked(won, 0), true);
  assert.equal(rematchBlocked(won, 1), false);
  assert.equal(rematchBlocked({ ...won, free: false }, 0), false);
});

// --- Nico 20.10.2026: Ohne Hilfen auch allein – der Computer schummelt ab und zu und ruft „Geschummelt!“ ---
import { cpuCheats, cpuAccuses, CPU_CHEAT, CPU_CATCH, CPU_FALSE_ALARM } from '../src/schummeln.js';

test('Computer allein ohne Hilfen: schummelt selten, erwischt jeden zweiten Schummelzug, selten Fehlalarm', () => {
  assert.deepEqual([CPU_CHEAT, CPU_CATCH, CPU_FALSE_ALARM], [0.12, 0.5, 0.05]);
  assert.equal(cpuCheats(() => 0.119), true);
  assert.equal(cpuCheats(() => 0.12), false);
  assert.equal(cpuAccuses(true, () => 0.499), true);
  assert.equal(cpuAccuses(true, () => 0.5), false);
  assert.equal(cpuAccuses(false, () => 0.049), true);
  assert.equal(cpuAccuses(false, () => 0.05), false);
});
