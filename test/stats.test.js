// Statistik zu zweit (src/stats.js, src/results.js): Zählen je Paar und Spiel, Abgleich zwischen den PCs,
// Berichtigen und Zurücksetzen, Runden verfolgen (kein Doppelzählen beim Fortsetzen) und Ergebnis je Spiel lesen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStats, mergeStats, pairOf, entry, resetPair, ofPair, tally, pairs, step } from '../src/stats.js';
import { OUTCOME, reverted } from '../src/results.js';
import { PLAYABLE } from '../src/games.js';
import * as kniffel from '../src/kniffel/game.js';
import * as schach from '../src/schach/game.js';
import * as vier from '../src/viergewinnt/game.js';

function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
}

const win = (id, game, winner, at = 1000, me = 'Nico', other = 'Denisa') => entry({ id, game, me, other, winner, now: at });

test('Paar: feste Reihenfolge, gleiche oder fehlende Namen zählen nicht', () => {
  assert.deepEqual(pairOf('Nico', 'Denisa'), ['Denisa', 'Nico']);
  assert.deepEqual(pairOf('Denisa', 'Nico'), ['Denisa', 'Nico']);
  assert.equal(pairOf('Nico', 'Nico'), null);
  assert.equal(pairOf('Nico', ''), null);
  assert.equal(entry({ id: 'x', game: 'Schach', me: 'Nico', other: '', winner: 'Nico' }), null);
});

test('Zählen je Spiel: Siege, Remis, letzte Partie', () => {
  const store = memory();
  mergeStats([win('1', 'Schach', 'Nico', 1000), win('2', 'Schach', 'Denisa', 2000), win('3', 'Schach', 'Nico', 3000), win('4', 'Schach', '', 4000), win('5', 'Kniffel', 'Denisa', 500)], store);
  const t = tally(loadStats(store), ['Denisa', 'Nico']);
  assert.deepEqual(t.Schach, { wins: { Denisa: 1, Nico: 2 }, draws: 1, last: 4000 });
  assert.deepEqual(t.Kniffel, { wins: { Denisa: 1, Nico: 0 }, draws: 0, last: 500 });
  assert.deepEqual(tally(loadStats(store), ['Anna', 'Nico']), {}); // anderes Paar: nichts
});

test('Abgleich: gleiche id zählt einmal, die neuere Fassung gewinnt – beide PCs haben danach dasselbe', () => {
  const host = memory();
  const guest = memory();
  mergeStats([win('1', 'Mühle', 'Nico', 1000)], host);
  mergeStats([win('1', 'Mühle', 'Nico', 1000)], guest); // Meldung kam an
  mergeStats([win('2', 'Mühle', 'Denisa', 2000)], host); // Meldung ging verloren
  mergeStats([win('1', 'Mühle', 'Nico', 1000)], host); // doppelt gemeldet
  // beim nächsten Verbinden: beide schicken ihre Liste
  mergeStats(ofPair(loadStats(host), ['Denisa', 'Nico']), guest);
  mergeStats(ofPair(loadStats(guest), ['Denisa', 'Nico']), host);
  assert.deepEqual(loadStats(host), loadStats(guest));
  assert.deepEqual(tally(loadStats(guest), ['Denisa', 'Nico']).Mühle.wins, { Denisa: 1, Nico: 1 });
  // Berichtigung (neuer v) ersetzt, alte Fassung (kleiner v) nicht
  mergeStats([{ ...win('2', 'Mühle', 'Nico', 2000), v: 5000 }], host);
  mergeStats([win('2', 'Mühle', 'Denisa', 2000)], host);
  assert.deepEqual(tally(loadStats(host), ['Denisa', 'Nico']).Mühle.wins, { Denisa: 0, Nico: 2 });
});

test('Zurücksetzen: Marke je Paar, zieht beim anderen PC mit – auch für Ergebnisse, die nur dort stehen', () => {
  const a = memory();
  const b = memory();
  const list = [win('1', 'Dame', 'Nico'), win('2', 'Dame', 'Denisa'), win('3', 'Dame', 'Anna', 1000, 'Anna', 'Nico')];
  mergeStats(list, a);
  mergeStats([...list, win('4', 'Dame', 'Denisa', 1500)], b); // Meldung 4 kam bei a nie an
  mergeStats([{ ...win('5', 'Dame', '', 1200), w: null }], a); // zurückgenommen – zählt nicht
  resetPair('Denisa', 'Nico', a, 9000);
  assert.deepEqual(tally(loadStats(a), ['Denisa', 'Nico']), {});
  assert.equal(ofPair(loadStats(a), ['Denisa', 'Nico']).length, 1); // nur die Marke bleibt – die Liste wächst nicht
  assert.deepEqual(tally(loadStats(a), ['Anna', 'Nico']).Dame.wins, { Anna: 1, Nico: 0 }); // anderes Paar bleibt
  mergeStats(ofPair(loadStats(a), ['Denisa', 'Nico']), b);
  assert.deepEqual(tally(loadStats(b), ['Denisa', 'Nico']), {});
  mergeStats(ofPair(loadStats(b), ['Denisa', 'Nico']), a); // nichts kommt zurück
  assert.deepEqual(tally(loadStats(a), ['Denisa', 'Nico']), {});
  mergeStats([win('6', 'Dame', 'Nico', 9500)], a); // danach gespielt: zählt wieder
  assert.deepEqual(tally(loadStats(a), ['Denisa', 'Nico']).Dame.wins, { Denisa: 0, Nico: 1 });
  assert.deepEqual(pairs(loadStats(a), 'Nico'), [['Denisa', 'Nico'], ['Anna', 'Nico']]);
});

test('Gleiche Runden-id bei anderem Paar überschreibt nichts', () => {
  const store = memory();
  mergeStats([win('r1', 'Schach', 'Nico', 1000), { ...win('r1', 'Schach', null, 2000, 'Nico', 'Anna'), w: null }], store);
  assert.deepEqual(tally(loadStats(store), ['Denisa', 'Nico']).Schach.wins, { Denisa: 0, Nico: 1 });
});

test('Kaputtes oder Fremdes fällt weg (auch vom anderen PC)', () => {
  const store = memory();
  assert.deepEqual(loadStats(store), []);
  store.setItem('spielesammlung-statistik', '{kaputt');
  assert.deepEqual(loadStats(store), []);
  mergeStats([
    null, 'x', { id: '1' },
    { id: '2', game: 'Schach', at: 1, v: 1, a: 'Nico', b: 'Denisa', w: 'Nico' }, // falsche Reihenfolge
    { id: '3', game: 'Schach', at: 1, v: 1, a: 'Denisa', b: 'Nico', w: 'Anna' }, // Sieger nicht im Paar
    { id: '4', game: 'Schach', at: 1, v: 1, a: 'Denisa', b: 'Denisa', w: '' },
    { id: 'x'.repeat(41), game: 'Schach', at: 1, v: 1, a: 'Denisa', b: 'Nico', w: '' },
    { id: '5', game: 'Schach', at: 1, v: 1, a: 'Denisa', b: 'Nico‮', w: 'Nico' }, // unsichtbares Zeichen wird gesäubert
    { id: '7', game: 'Schach', at: 1, v: Date.now() + 2 * 86400000, a: 'Denisa', b: 'Nico', w: 'Nico' }, // aus der Zukunft
  ], store);
  assert.deepEqual(loadStats(store), [{ id: '5', game: 'Schach', at: 1, v: 1, a: 'Denisa', b: 'Nico', w: 'Nico' }]);
  assert.deepEqual(mergeStats([win('6', 'Schach', 'Nico')], { getItem: () => null, setItem: () => { throw new Error('voll'); } }), []);
});

test('Paare: das eigene zuerst, sonst das zuletzt gespielte', () => {
  const list = [win('1', 'Schach', 'Nico', 1000), win('2', 'Schach', 'Anna', 3000, 'Anna', 'Ben'), win('3', 'Schach', 'Nico', 2000, 'Nico', 'Zoe')];
  assert.deepEqual(pairs(list, 'Nico'), [['Nico', 'Zoe'], ['Denisa', 'Nico'], ['Anna', 'Ben']]);
});

test('Runden verfolgen: Ende zählt einmal, Nochmal = neue Runde, Fortsetzen zählt nicht doppelt', () => {
  let n = 0;
  const id = () => `r${++n}`;
  let t = { id: null, w: undefined };
  t = step(t, undefined, false, id); // läuft
  assert.deepEqual(t, { id: null, w: undefined });
  t = step(t, 0, false, id); // Host gewinnt
  assert.deepEqual(t, { id: 'r1', w: 0, report: 0 });
  const { report, ...saved } = t; // so liegt es im Spielstand (saves.js)
  assert.deepEqual(step(saved, 0, false, id), saved); // derselbe Stand noch einmal (z. B. fortgesetzt): nichts
  t = step(saved, null, false, id); // nach Anklage doch Remis (Kniffel: Feld gestrichen) – dieselbe Runde
  assert.deepEqual(t, { id: 'r1', w: null, report: null });
  t = step(t, undefined, false, id); // „Nochmal“
  assert.deepEqual(t, { id: null, w: undefined });
  t = step(t, 1, false, id);
  assert.deepEqual(t, { id: 'r2', w: 1, report: 1 });
  t = step(t, undefined, true, id); // Schummelzug zum Sieg erwischt – Runde läuft weiter, Ergebnis gilt nicht
  assert.deepEqual(t, { id: 'r2', w: undefined, report: 'void' });
  t = step(t, undefined, false, id);
  assert.deepEqual(t, { id: 'r2', w: undefined });
  t = step(t, 0, false, id); // jetzt gewinnt der andere – dieselbe id, ersetzt das alte Ergebnis
  assert.deepEqual(t, { id: 'r2', w: 0, report: 0 });
  assert.deepEqual(step({ id: null, w: undefined }, 1, false, id), { id: 'r3', w: 1, report: 1 }); // alter Speicherstand ohne track
});

test('Ergebnis je Spiel: alle spielbaren Spiele zu zweit haben eins', () => {
  const twoPlayer = [...PLAYABLE].filter(([, g]) => !g.alone).map(([name]) => name);
  const missing = twoPlayer.filter((name) => !OUTCOME[name]);
  assert.deepEqual(missing.filter((name) => name !== 'Elfer raus' && name !== "Texas Hold'em"), []); // die beiden werden gerade gebaut – Anschluss in results.js
});

test('Ergebnis lesen: Kniffel, Schach, Vier gewinnt', () => {
  const k = kniffel.newGame(0);
  assert.equal(OUTCOME.Kniffel(k), undefined);
  assert.equal(OUTCOME.Kniffel({ ...k, over: true }), kniffel.winner({ ...k, over: true }));

  const s = schach.newGame(0);
  assert.equal(OUTCOME.Schach(s), undefined);
  assert.equal(OUTCOME.Schach(schach.resign(s, 0)), 1); // Host gibt auf → Gast gewinnt
  assert.equal(OUTCOME.Schach({ ...s, result: { winner: null, reason: 'patt' } }), null);

  let v = vier.newGame({ starter: 0 });
  for (const col of [0, 1, 0, 1, 0, 1]) v = vier.drop(v, v.turn, col);
  assert.equal(OUTCOME['Vier gewinnt'](v), undefined);
  v = vier.drop(v, 0, 0);
  assert.equal(OUTCOME['Vier gewinnt'](v), 0);
  assert.equal(OUTCOME['Vier gewinnt'](vier.again(v, 1)), undefined);
});

test('Ergebnis lesen: Spiele mit Computer-Mitspielern – wer von beiden Menschen besser war', () => {
  // MÄDN: Host Sitz 0, Gast humans[1]; wer früher fertig ist
  assert.equal(OUTCOME['Mensch ärgere dich nicht']({ phase: 'over', humans: [0, 2], places: [1, 2, 0, 3] }), 1);
  assert.equal(OUTCOME['Mensch ärgere dich nicht']({ phase: 'over', humans: [0, 3], places: [0, 1, 2, 3] }), 0);
  assert.equal(OUTCOME['Mensch ärgere dich nicht']({ phase: 'move', humans: [0, 2], places: [1] }), undefined);
  // Doppelkopf: Spielpunkte Sitz 0 gegen Sitz 2
  assert.equal(OUTCOME.Doppelkopf({ phase: 'over', result: { points: [2, -2, 2, -2] } }), null); // gleiche Partei
  assert.equal(OUTCOME.Doppelkopf({ phase: 'over', result: { points: [3, -3, -3, 3] } }), 0);
  assert.equal(OUTCOME.Doppelkopf({ phase: 'over', result: { points: [-1, -1, 3, -1] } }), 1); // Solo
  assert.equal(OUTCOME.Doppelkopf({ phase: 'play', result: null }), undefined);
  // Mäxchen: noch dabei vor später ausgeschieden
  assert.equal(OUTCOME.Mäxchen({ phase: 'over', winner: 2, out: [1, 0, 3], lives: [0, 0, 1, 0] }), 1);
  assert.equal(OUTCOME.Mäxchen({ phase: 'over', winner: 1, out: [3, 2, 0], lives: [0, 1, 0, 0] }), 0); // Host schied später aus als der Gast
  assert.equal(OUTCOME.Mäxchen({ phase: 'over', winner: 3, out: [2, 0, 1], lives: [0, 0, 0, 1] }), 0);
  assert.equal(OUTCOME.Mäxchen({ phase: 'over', winner: null, out: [2, 0], lives: [0, 2, 0, 1] }), 0); // nur Computer übrig
  assert.equal(OUTCOME.Mäxchen({ phase: 'over', winner: null, out: [1, 3, 2, 0], lives: [0, 0, 0, 0] }), 1); // Host als Letzter erwischt
  // Rommé: Unentschieden bei leerem Stapel
  assert.equal(OUTCOME.Rommé({ winner: -1 }), null);
  assert.equal(OUTCOME.Rommé({ winner: 1 }), 1);
  assert.equal(OUTCOME.Rommé({ winner: null }), undefined);
});

test('Erwischter Schummelzug wird erkannt, neue Runde nicht', () => {
  assert.equal(reverted({ verdict: { caught: true } }), true);
  assert.equal(reverted({ events: [{ type: 'drop' }, { type: 'caught', player: 1 }] }), true);
  assert.equal(reverted({ verdict: { caught: false }, events: [{ type: 'fehlalarm' }] }), false);
  assert.equal(reverted(vier.newGame({ starter: 1, free: true })), false);
  assert.equal(reverted(schach.newGame(1, { free: true })), false);
});

test('Ohne Hilfen, echte Spielstände: Schummel-Sieg erwischt → gilt nicht, die Runde läuft weiter', () => {
  let n = 0;
  const id = () => `r${++n}`;
  let s = vier.newGame({ starter: 0, free: true });
  let t = { id: null, w: undefined };
  for (let i = 0; i < 4; i++) {
    s = vier.drop(s, 0, 0); // Host wirft viermal hintereinander – geschummelt
    t = step(t, OUTCOME['Vier gewinnt'](s), reverted(s), id);
  }
  assert.equal(t.report, 0); // erst einmal gewonnen
  s = vier.accuse(s, 1); // Gast ruft „Geschummelt!“
  assert.equal(OUTCOME['Vier gewinnt'](s), undefined);
  t = step(t, OUTCOME['Vier gewinnt'](s), reverted(s), id);
  assert.deepEqual(t, { id: 'r1', w: undefined, report: 'void' });
});
