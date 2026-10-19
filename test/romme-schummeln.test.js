// Rommé „Ohne Hilfen“: regelwidrige Züge gehen durch, „Geschummelt!“ nimmt den ganzen Zug zurück (+2 Strafkarten),
// Fehlalarm kostet den Ankläger 1 Karte. Nur zu zweit – mit Regeln (free = false) ändert sich nichts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, newGame, draw, meld, layoff, swap, undo, discard, accuse, again, viewFor, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from '../src/romme/game.js';
import { rematchBlocked } from '../src/schummeln.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spieler 0 ist dran und zieht gleich (damit der Stand am Zuganfang stimmt); Rest des Blatts im Stapel, oberste = d3b
function setup({ hands, melds = [], opened = [true, true], free = true, turns = 6 }) {
  const used = new Set([...hands.flat(), ...melds.flatMap((m) => m.cards), 'd2b', 'd3b']);
  const s = {
    ...newGame(1, Math.random, { free }),
    hands, melds, opened, turns, turn: 0, phase: 'draw', pile: ['d2b'],
    talon: [...makeDeck().filter((c) => !used.has(c)), 'd3b'],
    events: [], seq: 10,
  };
  return draw(s, 0, 'talon');
}

const all = (s) => [...s.hands.flat(), ...s.melds.flatMap((m) => m.cards), ...s.pile, ...s.talon].sort();
const DECK = makeDeck().sort();
const run = (owner, suit, low, cards) => ({ owner, kind: 'run', suit, low, cards });

test('mit Regeln (free = false) bleibt alles gesperrt, „Geschummelt!“ gibt es nicht', () => {
  const s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']], free: false });
  assert.equal(meld(s, 0, ['h2a', 's9a', 'cKa']), null);
  assert.equal(discard(s, 0, 'h2a').cheat, null);
  assert.equal(accuse(discard(s, 0, 'h2a'), 1), null);
});

test('ohne Hilfen: Schummel-Figur, unpassendes Anlegen und falscher Joker-Tausch gehen durch', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a', 'c5a'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'xr1', 'h7a'])], opened: [false, true] });
  s = meld(s, 0, ['h2a', 's9a', 'cKa']); // keine Figur, nicht herausgekommen
  assert.equal(s.melds[1].kind, 'free');
  assert.equal(s.opened[0], true);
  assert.equal(s.clean, false);
  s = layoff(s, 0, 'd7a', 0); // passt nicht an Herz 5–7
  assert.deepEqual(s.melds[0].cards, ['h5a', 'xr1', 'h7a', 'd7a']);
  assert.equal(s.melds[0].kind, 'free');
  const t = setup({ hands: [['c5a', 'h9a', 'sQa'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'xr1', 'h7a'])] });
  const u = swap(t, 0, 'c5a', 0); // Kreuz 5 statt Herz 6
  assert.ok(u.hands[0].includes('xr1'));
  assert.deepEqual(u.melds[0].cards, ['h5a', 'c5a', 'h7a']);
  assert.equal(u.clean, false);
  // eine Karte muss trotzdem zum Ablegen übrig bleiben
  assert.equal(meld(setup({ hands: [['h2a', 's9a', 'cKa'], []] }), 0, ['h2a', 's9a', 'cKa', 'd3b']), null);
});

test('regelgerechter Zug + „Geschummelt!“ = Fehlalarm: der Ankläger zieht 1 Karte', () => {
  let s = setup({ hands: [['h7a', 's7a', 'c7b', 'd9a', 'cKa'], ['c3a', 'h4b']] });
  s = meld(s, 0, ['h7a', 's7a', 'c7b']);
  s = discard(s, 0, 'cKa');
  assert.deepEqual(s.cheat.player, 0);
  assert.equal(s.cheat.legal, true);
  assert.equal(accuse(s, 0), null); // nicht gegen sich selbst
  const f = accuse(s, 1);
  assert.equal(f.hands[1].length, 2 + FALSE_ALARM_PENALTY);
  assert.equal(f.cheat, null);
  assert.equal(f.turn, 1);
  assert.equal(f.phase, 'draw'); // ziehen muss er trotzdem noch
  assert.deepEqual(f.events[0], { type: 'fehlalarm', player: 1 });
  assert.deepEqual(all(f), DECK);
  assert.equal(accuse(f, 1), null); // nur einmal
});

test('regelwidriger Zug erwischt: ganzer Zug zurück, 2 Strafkarten, der Schummler spielt neu', () => {
  const s0 = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']], opened: [false, true] });
  let s = meld(s0, 0, ['h2a', 's9a', 'cKa']);
  s = discard(s, 0, 'd3b'); // auch die gezogene Karte gleich wieder weg
  assert.equal(s.cheat.legal, false);
  const c = accuse(s, 1, seeded(1));
  assert.equal(c.turn, 0);
  assert.equal(c.phase, 'play');
  assert.deepEqual(c.melds, []);
  assert.deepEqual(c.pile, ['d2b']);
  assert.equal(c.opened[0], false);
  assert.equal(c.hands[0].length, s0.hands[0].length + CHEAT_PENALTY);
  assert.ok(['h2a', 's9a', 'cKa', 'd7a', 'd3b'].every((x) => c.hands[0].includes(x)));
  assert.deepEqual(c.events[0], { type: 'caught', player: 0, by: 1 });
  assert.equal(c.events.filter((e) => e.why === 'strafe').length, CHEAT_PENALTY);
  assert.equal(c.cheat, null);
  assert.deepEqual(all(c), DECK);
  // „Zug zurücksetzen“ behält die Strafkarten
  const m = meld(c, 0, ['h2a', 's9a', 'cKa']);
  assert.equal(undo(m, 0).hands[0].length, c.hands[0].length);
  // und dieser Zug lässt sich wieder anprangern
  assert.equal(discard(m, 0, 'd7a').cheat.legal, false);
});

test('Frist: wer zieht, hat den Zug hingenommen; auch nach „Zug zurücksetzen“ ist der Zug wieder sauber', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  s = discard(meld(s, 0, ['h2a', 's9a', 'cKa']), 0, 'd7a');
  const later = draw(s, 1, 'talon');
  assert.equal(later.cheat, null);
  assert.equal(accuse(later, 1), null);
  // geschummelt, dann zurückgenommen, dann sauber gespielt
  let t = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  t = undo(meld(t, 0, ['h2a', 's9a', 'cKa']), 0);
  assert.equal(t.clean, true);
  assert.equal(discard(t, 0, 'd7a').cheat.legal, true);
});

test('typische Schummeleien zählen: Ablagekarte gleich wieder ablegen, mit zu wenig Punkten herauskommen', () => {
  // Ablagekarte genommen und gleich wieder abgelegt
  const base = { ...newGame(1, Math.random, { free: true }), hands: [['h2a', 'cKa'], ['c3a']], melds: [], turn: 0, phase: 'draw', pile: ['d2b', 'sQa'], talon: makeDeck().filter((c) => !['h2a', 'cKa', 'c3a', 'd2b', 'sQa'].includes(c)), opened: [true, true], turns: 6 };
  const a = discard(draw(base, 0, 'pile'), 0, 'sQa');
  assert.equal(a.cheat.legal, false);
  // nur 21 Punkte ausgelegt, dann abgelegt
  let b = setup({ hands: [['h7a', 's7a', 'c7b', 'd9a'], ['c3a']], opened: [false, true] });
  b = meld(b, 0, ['h7a', 's7a', 'c7b']);
  assert.deepEqual(b.fresh, [0]); // mit Regeln vorläufig
  b = discard(b, 0, 'd9a');
  assert.equal(b.opened[0], true);
  assert.equal(b.cheat.legal, false);
});

test('Sieg mit Schummelzug: angeprangert geht die Runde weiter, die Punkte sind wieder weg', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['xr1', 'sAa']] });
  s = meld(s, 0, ['h2a', 's9a', 'cKa', 'd3b']);
  s = discard(s, 0, 'd7a');
  assert.equal(s.winner, 0);
  assert.equal(s.score[0], 31);
  assert.equal(rematchBlocked(s, 0), true); // der Schummler kann die Anklage nicht wegklicken
  assert.equal(rematchBlocked(s, 1), false);
  const c = accuse(s, 1, seeded(2));
  assert.equal(c.winner, null);
  assert.deepEqual(c.score, [0, 0]);
  assert.equal(c.turn, 0);
  assert.deepEqual(all(c), DECK);
});

test('Sicht des Gastes: nur wer zuletzt gezogen hat – nicht ob regelwidrig und nicht der Stand davor', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  s = discard(meld(s, 0, ['h2a', 's9a', 'cKa']), 0, 'd7a');
  const v = viewFor(s, 1);
  assert.deepEqual(v.cheat, { player: 0 });
  assert.equal(v.turnStart, null);
  assert.ok(!JSON.stringify(v).includes('"legal"'));
  const w = viewFor(setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] }), 1);
  assert.equal(w.turnStart, null);
  assert.ok(!JSON.stringify(w).includes('h2a'));
});

test('erster Zug des Anfängers (ohne Ziehen) lässt sich anprangern, nächste Runde bleibt ohne Hilfen', () => {
  let s = newGame(0, seeded(9), { free: true });
  const hand = s.hands[0];
  s = meld(s, 0, hand.slice(0, 3)); // in der ersten Runde wird nicht ausgelegt
  s = discard(s, 0, hand[3]);
  assert.equal(s.cheat.legal, false);
  const c = accuse(s, 1, seeded(3));
  assert.equal(c.hands[0].length, 14 + CHEAT_PENALTY);
  assert.deepEqual(c.melds, []);
  assert.deepEqual(c.pile, []);
  assert.deepEqual(all(c), DECK);
  const end = { ...c, winner: 1 };
  assert.equal(again(end).free, true);
});
