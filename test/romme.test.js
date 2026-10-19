import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, newGame, arrange, meldValue, extend, swapIn, draw, meld, layoff, swap, undo, discard, again, viewFor,
  handPoints, cardPoints, isCard, HAND_SIZE, OPEN_MIN, NOBODY,
} from '../src/romme/game.js';

// fester Zufall für wiederholbare Tests
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand mitten im Spiel: Spieler 0 hat gezogen und ist beim Auslegen. Rest des Blatts im Nachziehstapel.
function setup({ hands, melds = [], pile = ['d2b'], talon, opened = [false, false], turn = 0, phase = 'play', turns = 4, ...rest }) {
  const used = [...hands.flat(), ...melds.flatMap((m) => m.cards), ...pile];
  const s = {
    ...newGame(0),
    hands,
    melds,
    pile,
    talon: talon ?? makeDeck().filter((c) => !used.includes(c)),
    opened,
    turn,
    phase,
    turns,
    ...rest,
  };
  return { ...s, start: { hand: s.hands[turn], melds: s.melds, opened: s.opened } };
}

const all = (s) => [...s.hands.flat(), ...s.melds.flatMap((m) => m.cards), ...s.pile, ...s.talon].sort();
const run = (owner, suit, low, cards) => ({ owner, kind: 'run', suit, low, cards });
const set = (owner, cards) => ({ owner, kind: 'set', cards });

test('Blatt: 110 Karten (2 × 52 + 6 Joker), jede genau einmal', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 110);
  assert.equal(new Set(deck).size, 110);
  assert.equal(deck.filter((c) => c[0] === 'x').length, 6);
  assert.ok(deck.includes('h7a') && deck.includes('h7b') && deck.includes('xr1') && deck.includes('xb3'));
  for (const bad of ['h7', 'h7c', 'xr4', '', null, 7, '<b>', ['h7a']]) assert.equal(isCard(bad), false);
});

test('neues Spiel: Anfänger 14 Karten, der andere 13, keine offene Karte, Anfänger legt zuerst ab', () => {
  const s = newGame(1, seeded(3));
  assert.equal(s.hands[1].length, HAND_SIZE + 1);
  assert.equal(s.hands[0].length, HAND_SIZE);
  assert.equal(s.pile.length, 0);
  assert.equal(s.talon.length, 110 - 27);
  assert.deepEqual(all(s), makeDeck().sort());
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'play'); // ohne Ziehen
  assert.equal(draw(s, 1, 'talon'), null);
  assert.deepEqual(s.events, [{ type: 'deal' }]);
});

test('Figuren: Sätze mit verschiedenen Farben, Reihen einer Farbe, Ass vorn oder hinten, kein Umlauf', () => {
  assert.equal(arrange(['h7a', 's7a', 'c7b']).kind, 'set');
  assert.equal(arrange(['h7a', 's7a', 'c7b', 'd7a']).cards.length, 4);
  assert.equal(arrange(['h7a', 'h7b', 's7a']), null); // Farbe doppelt
  assert.equal(arrange(['h7a', 's7a', 'c7b', 'd7a', 'xr1']), null); // mehr als 4
  assert.equal(arrange(['h7a', 's7a']), null); // zu kurz
  assert.deepEqual(arrange(['h4a', 'h3a', 'h2b']), { kind: 'run', suit: 'h', low: 2, cards: ['h2b', 'h3a', 'h4a'] });
  assert.deepEqual(arrange(['hAa', 'h2a', 'h3a']), { kind: 'run', suit: 'h', low: 1, cards: ['hAa', 'h2a', 'h3a'] });
  assert.deepEqual(arrange(['hKa', 'hAa', 'hQa']), { kind: 'run', suit: 'h', low: 12, cards: ['hQa', 'hKa', 'hAa'] });
  assert.equal(arrange(['hKa', 'hAa', 'h2a']), null); // K-A-2 gibt es nicht
  assert.equal(arrange(['h4a', 'h6a', 'h7a']), null); // Lücke
  assert.equal(arrange(['h4a', 'h5a', 's6a']), null); // andere Farbe
  assert.equal(arrange(['h4a', 'h4b', 'h5a']), null); // Wert doppelt
  // Joker füllt die Lücke oder hängt hinten an (mehr Punkte), mit hint auch vorn
  assert.deepEqual(arrange(['h4a', 'xr1', 'h6a']).cards, ['h4a', 'xr1', 'h6a']);
  assert.deepEqual(arrange(['h4a', 'h5a', 'xb2']), { kind: 'run', suit: 'h', low: 4, cards: ['h4a', 'h5a', 'xb2'] });
  assert.deepEqual(arrange(['h4a', 'h5a', 'xb2'], { kind: 'run', low: 3 }).cards, ['xb2', 'h4a', 'h5a']);
  assert.equal(arrange(['h4a', 'h5a', 'xb2'], { kind: 'set' }), null);
  assert.equal(arrange(['xr1', 'xr2', 'xb1']), null); // nur Joker
  // Ass zweimal: nur als ganze Reihe A … A
  const full = ['hAa', 'h2a', 'h3a', 'h4a', 'h5a', 'h6a', 'h7a', 'h8a', 'h9a', 'hTa', 'hJa', 'hQa', 'hKa', 'hAb'];
  assert.equal(arrange(full).cards.length, 14);
  assert.equal(arrange(['hAa', 'hAb', 'h2a']), null);
});

test('Punkte: Ass vorn 1, hinten und im Satz 11, Joker so viel wie die ersetzte Karte', () => {
  assert.equal(meldValue(arrange(['hAa', 'h2a', 'h3a'])), 6);
  assert.equal(meldValue(arrange(['hQa', 'hKa', 'hAa'])), 31);
  assert.equal(meldValue(arrange(['hAa', 'sAa', 'cAb'])), 33);
  assert.equal(meldValue(arrange(['h9a', 'hTa', 'hJa'])), 29);
  assert.equal(meldValue(arrange(['h7a', 's7a', 'xr1'])), 21);
  assert.equal(meldValue(arrange(['hJa', 'xr1', 'hKa'])), 30); // Joker als Dame
  assert.equal(meldValue(arrange(['h5a', 'xr1', 'xb1'])), 18); // 5-6-7 statt Satz (15)
  assert.equal(meldValue(arrange(['hAa', 'xr1', 'xb1'])), 33); // Ass-Satz (33) statt D-K-A (31)
  assert.equal(cardPoints('xr1'), 20);
  assert.equal(cardPoints('sAb'), 11);
  assert.equal(cardPoints('dKa'), 10);
  assert.equal(cardPoints('dTa'), 10);
  assert.equal(cardPoints('c7b'), 7);
  // Rechenbeispiel aus der Spielkarten.com-Anleitung: Ass, König, 2 Damen, 2 Achten, Zehn, Joker = 87
  assert.equal(handPoints(['hAa', 'sKa', 'cQa', 'dQb', 'h8a', 's8b', 'cTa', 'xr2']), 87);
});

test('erste Runde: Anfänger legt nur ab, der andere zieht und legt ab – erst dann wird ausgelegt', () => {
  let s = newGame(0, seeded(7));
  const first = s.hands[0];
  const melds = [['h7a', 's7a', 'c7a'], ['hQa', 'hKa', 'hAa']];
  assert.equal(meld(s, 0, first.slice(0, 3)), null);
  s = discard(s, 0, first[0]);
  assert.ok(s);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'draw');
  assert.equal(discard(s, 1, s.hands[1][0]), null); // erst ziehen
  s = draw(s, 1, 'pile');
  assert.equal(s.hands[1].length, 14);
  assert.equal(s.turns, 1);
  // auch mit passenden Karten noch nicht auslegen
  const t = { ...s, hands: [s.hands[0], [...melds.flat(), ...s.hands[1].filter((c) => !melds.flat().includes(c))]] };
  assert.equal(meld(t, 1, melds[0]), null);
  s = discard(s, 1, s.hands[1].find((c) => c !== s.taken));
  assert.equal(s.turns, 2);
  s = draw(s, 0, 'talon');
  assert.equal(s.phase, 'play');
});

test('Herauskommen: mindestens 30 Punkte, auch aus mehreren Figuren; vorher kein Anlegen, kein Ablegen', () => {
  let s = setup({
    hands: [['h7a', 's7a', 'c7b', 'd2a', 'd3a', 'd4a', 'cKa', 'h9a'], ['sQa', 'sKa', 'sAa']],
    melds: [run(1, 'h', 10, ['hTa', 'hJa', 'hQa'])],
    opened: [false, true],
  });
  s = meld(s, 0, ['h7a', 's7a', 'c7b']); // 21 Punkte
  assert.deepEqual(s.fresh, [1]);
  assert.equal(s.opened[0], false);
  assert.equal(layoff(s, 0, 'h9a', 0), null); // noch nicht draußen
  assert.equal(discard(s, 0, 'cKa'), null); // 21 < 30 liegen – erst weiter auslegen oder zurücknehmen
  const back = undo(s, 0);
  assert.deepEqual(back.hands[0], ['h7a', 's7a', 'c7b', 'd2a', 'd3a', 'd4a', 'cKa', 'h9a']);
  assert.equal(back.melds.length, 1);
  assert.ok(discard(back, 0, 'cKa'));
  s = meld(s, 0, ['d2a', 'd3a', 'd4a']); // + 9 = 30
  assert.equal(s.opened[0], true);
  assert.deepEqual(s.fresh, []);
  assert.deepEqual(s.events.at(-1), { type: 'open', player: 0, points: OPEN_MIN });
  s = layoff(s, 0, 'h9a', 0); // jetzt auch am fremden Satz anlegen – im selben Zug
  assert.deepEqual(s.melds[0].cards, ['h9a', 'hTa', 'hJa', 'hQa']);
  assert.equal(s.melds[0].low, 9);
  s = discard(s, 0, 'cKa');
  assert.equal(s.hands[0].length, 0);
  assert.equal(s.winner, 0); // letzte Karte abgelegt
});

test('zu wenig Punkte reicht nie, auch nicht mit Joker als kleiner Karte', () => {
  const s = setup({ hands: [['h2a', 'h3a', 'xr1', 'cKa', 'sKa'], []] });
  const m = meld(s, 0, ['h2a', 'h3a', 'xr1']); // 2-3-4 = 9
  assert.equal(m.opened[0], false);
  assert.deepEqual(m.fresh, [0]);
  const a = meld(s, 0, ['h2a', 'h3a', 'xr1'], { kind: 'run', low: 1 }); // Joker als Ass vorn: 1-2-3 = 6
  assert.deepEqual(a.melds[0].cards, ['xr1', 'h2a', 'h3a']);
  assert.equal(a.opened[0], false);
  assert.equal(discard(a, 0, 'cKa'), null);
});

test('Anlegen: Reihe an beiden Enden, Ass hinter dem König oder vor der 2, Satz bis 4, Joker an ein Ende', () => {
  const m = run(1, 'h', 11, ['hJa', 'hQa', 'hKa']);
  assert.deepEqual(extend(m, 'hAb').cards, ['hJa', 'hQa', 'hKa', 'hAb']);
  assert.deepEqual(extend(m, 'hTa'), { ...m, low: 10, cards: ['hTa', 'hJa', 'hQa', 'hKa'] });
  assert.equal(extend(m, 'h9a'), null);
  assert.equal(extend(m, 'sAa'), null);
  const low = run(1, 'c', 2, ['c2a', 'c3a', 'c4a']);
  assert.deepEqual(extend(low, 'cAa').cards, ['cAa', 'c2a', 'c3a', 'c4a']);
  assert.equal(extend(extend(low, 'cAa'), 'cAb'), null); // kein Umlauf
  assert.deepEqual(extend(low, 'xr1').cards, ['c2a', 'c3a', 'c4a', 'xr1']); // Joker hinten …
  assert.deepEqual(extend(low, 'xr1', 'low').cards, ['xr1', 'c2a', 'c3a', 'c4a']); // … oder vorn
  assert.deepEqual(extend(run(0, 'c', 12, ['cQa', 'cKa', 'cAa']), 'xr1').cards, ['xr1', 'cQa', 'cKa', 'cAa']); // hinten ist zu
  const three = set(0, ['h7a', 's7a', 'xr1']);
  assert.deepEqual(extend(three, 'd7a').cards, ['s7a', 'h7a', 'd7a', 'xr1']);
  assert.equal(extend(three, 'h7b'), null); // Farbe schon da
  assert.equal(extend(three, 'h8a'), null);
  assert.equal(extend(set(0, ['h7a', 's7a', 'c7a', 'd7a']), 'xr2'), null); // voll
});

test('Anlegen im Spiel: bei sich und beim anderen, nur am Zug, danach muss eine Karte zum Ablegen bleiben', () => {
  const s = setup({
    hands: [['h8a', 'sQa'], ['c3a']],
    melds: [run(1, 'h', 5, ['h5a', 'h6a', 'h7a'])],
    opened: [true, true],
  });
  const t = layoff(s, 0, 'h8a', 0);
  assert.deepEqual(t.melds[0].cards, ['h5a', 'h6a', 'h7a', 'h8a']);
  assert.equal(t.melds[0].owner, 1);
  assert.equal(layoff(s, 1, 'h8a', 0), null); // nicht dran
  assert.equal(layoff(s, 0, 'sQa', 0), null); // passt nicht
  assert.equal(layoff(s, 0, 'h8a', 5), null); // gibt es nicht
  assert.equal(layoff(t, 0, 'sQa', 0), null);
  // letzte Karte darf nicht angelegt werden – sie muss abgelegt werden
  const u = setup({ hands: [['h8a'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'h6a', 'h7a'])], opened: [true, true] });
  assert.equal(layoff(u, 0, 'h8a', 0), null);
  assert.equal(meld(setup({ hands: [['h7a', 's7a', 'c7b'], []], opened: [true, false] }), 0, ['h7a', 's7a', 'c7b']), null);
});

test('Joker tauschen: nur nach dem Herauskommen, passende Karte; der Joker muss im selben Zug wieder raus', () => {
  const base = {
    hands: [['h6a', 'd7a', 'c2a', 'c3a', 'sKa'], ['c9a']],
    melds: [run(1, 'h', 5, ['h5a', 'xr1', 'h7a']), set(1, ['h7b', 's7a', 'xb2'])],
    opened: [true, true],
  };
  let s = setup(base);
  assert.equal(swap(setup({ ...base, opened: [false, true] }), 0, 'h6a', 0), null);
  assert.equal(swap(s, 0, 'h6b', 0), null); // nicht auf der Hand
  assert.equal(swap(s, 0, 'c2a', 0), null); // passt nicht an die Joker-Stelle
  assert.deepEqual(swapIn(base.melds[0], 'h8a'), null);
  s = swap(s, 0, 'h6a', 0);
  assert.deepEqual(s.melds[0].cards, ['h5a', 'h6a', 'h7a']);
  assert.ok(s.hands[0].includes('xr1'));
  assert.deepEqual(s.swapped, ['xr1']);
  assert.equal(discard(s, 0, 'sKa'), null); // Joker noch auf der Hand
  assert.equal(discard(s, 0, 'xr1'), null); // und ablegen gilt nicht
  // Satz: Joker gegen die fehlende Farbe
  const t = swap(s, 0, 'd7a', 1);
  assert.deepEqual(t.melds[1].cards, ['s7a', 'h7b', 'd7a']);
  assert.deepEqual(t.swapped, ['xr1', 'xb2']);
  // Joker wieder auslegen → dann darf abgelegt werden
  let u = meld(s, 0, ['c2a', 'c3a', 'xr1']);
  assert.deepEqual(u.swapped, []);
  assert.ok(discard(u, 0, 'sKa'));
  u = layoff(s, 0, 'xr1', 0);
  assert.deepEqual(u.melds[0].cards, ['h5a', 'h6a', 'h7a', 'xr1']);
  assert.ok(discard(u, 0, 'sKa'));
  // oder alles zurücknehmen
  const back = undo(t, 0);
  assert.deepEqual(back.melds, base.melds);
  assert.deepEqual(back.hands[0], base.hands[0]);
  assert.deepEqual(back.swapped, []);
  assert.ok(discard(back, 0, 'sKa'));
});

test('genommene Ablagekarte darf nicht gleich wieder abgelegt werden', () => {
  let s = setup({ hands: [['h2a', 's9a'], ['c3a', 'cQa']], pile: ['d5a', 'hKa'], phase: 'draw', start: null });
  s = draw(s, 0, 'pile');
  assert.equal(s.taken, 'hKa');
  assert.deepEqual(s.pile, ['d5a']);
  assert.equal(discard(s, 0, 'hKa'), null);
  s = discard(s, 0, 's9a');
  assert.equal(s.taken, null);
  assert.deepEqual(s.pile, ['d5a', 's9a']);
  // nur die genommene Karte behalten geht nicht
  const t = setup({ hands: [['h7a', 's7a', 'c7a', 'hKa'], []], opened: [true, false], taken: 'hKa' });
  assert.equal(meld(t, 0, ['h7a', 's7a', 'c7a']), null);
});

test('Nachziehstapel leer: Ablage ohne oberste Karte gemischt; geht das nicht, bleibt nur die Ablagekarte', () => {
  let s = setup({ hands: [['h2a'], ['c3a']], pile: ['d5a', 's9a', 'hKa'], talon: [], phase: 'draw', start: null });
  s = draw(s, 0, 'talon', seeded(1));
  assert.deepEqual(s.pile, ['hKa']);
  assert.equal(s.talon.length, 1);
  assert.equal(s.hands[0].length, 2);
  assert.equal(s.events[0].type, 'shuffle');
  assert.ok(['d5a', 's9a'].includes(s.events[1].card));
  const t = setup({ hands: [['h2a'], ['c3a']], pile: ['hKa'], talon: [], phase: 'draw', start: null });
  assert.equal(draw(t, 0, 'talon'), null);
  assert.ok(draw(t, 0, 'pile'));
});

test('Stapel zum zweiten Mal aufgebraucht: Runde endet, weniger Restpunkte gewinnt die Differenz (pagat-Hausregel)', () => {
  // erstes Leerwerden: Ablage wird gemischt und gezählt
  let s = setup({ hands: [['h2a', 'cKa'], ['xr1', 'sAa']], pile: ['d5a', 's9a', 'hKa'], talon: [], phase: 'draw', start: null });
  s = draw(s, 0, 'talon', seeded(4));
  assert.equal(s.restocks, 1);
  assert.equal(s.talon.length, 1);
  // genau diese Lage aus der Prüfung: beide mit Joker, nur volle Sätze – niemand kommt weiter
  const stuck = setup({
    hands: [['xr1', 'h4a'], ['xb1']],
    melds: [set(0, ['c7a', 's7a', 'h7a', 'd7a']), set(1, ['cKa', 'sKa', 'hKa', 'dKa'])],
    opened: [true, true], talon: [], restocks: 1, pile: ['d2b', 'c9a'],
  });
  const end = discard(stuck, 0, 'h4a');
  assert.equal(end.winner, NOBODY); // 20 : 20
  assert.equal(end.points, 0);
  assert.deepEqual(end.score, [0, 0]);
  assert.deepEqual(end.events.at(-1), { type: 'exhausted', winner: NOBODY, points: 0 });
  assert.equal(draw(end, 1, 'pile'), null); // vorbei
  assert.ok(again(end));
  const lower = discard({ ...stuck, hands: [['h2a', 'h4a'], ['xb1', 'sQa']] }, 0, 'h4a');
  assert.equal(lower.winner, 0); // 2 gegen 30
  assert.equal(lower.points, 28);
  assert.deepEqual(lower.score, [28, 0]);
  const higher = discard({ ...stuck, hands: [['cQa', 'h4a'], ['h3b']] }, 0, 'h4a');
  assert.equal(higher.winner, 1); // 10 gegen 3
  assert.equal(higher.points, 7);
  // beim ersten Leerwerden geht es weiter (es wird erst gemischt)
  assert.equal(discard({ ...stuck, restocks: 0 }, 0, 'h4a').winner, null);
  // in der Sicht des Gastes (Prüfung vor dem Senden) gibt es dabei keinen Absturz
  assert.ok(discard(viewFor({ ...stuck, turn: 1, hands: [['xr1'], ['xb1', 'h4a']] }, 1), 1, 'h4a'));
});

test('Rundenende: letzte Karte abgelegt gewinnt, Restpunkte des anderen zählen, nächste Runde behält die Punkte', () => {
  let s = setup({ hands: [['h2a', 'cKa'], ['xr1', 'sAa', 'd7a']], melds: [run(0, 'h', 3, ['h3a', 'h4a', 'h5a'])], opened: [true, false], score: [10, 5] });
  s = layoff(s, 0, 'h2a', 0);
  s = discard(s, 0, 'cKa');
  assert.equal(s.winner, 0);
  assert.equal(s.points, 20 + 11 + 7);
  assert.deepEqual(s.score, [48, 5]);
  assert.deepEqual(s.events.at(-1), { type: 'win', player: 0, points: 38 });
  assert.equal(draw(s, 1, 'talon'), null); // vorbei
  assert.equal(discard(s, 1, 'd7a'), null);
  const next = again(s, seeded(2));
  assert.equal(next.starter, 1); // der andere fängt an
  assert.deepEqual(next.score, [48, 5]);
  assert.equal(next.winner, null);
  assert.equal(again(next), null); // läuft noch
});

test('ungültige Eingaben → null, alter Stand bleibt unverändert', () => {
  const s = setup({ hands: [['h7a', 's7a', 'c7b', 'hKa'], ['d2a']], opened: [true, false] });
  for (const bad of [null, undefined, 'h7a', 42, {}, ['h7a'], ['h7a', 'h7a', 's7a'], ['h7a', 's7a', 'zz'], ['h7a', 's7a', 'd2a']]) {
    assert.equal(meld(s, 0, bad), null);
  }
  for (const bad of [null, 'x', 7, ['h7a']]) assert.equal(discard(s, 0, bad), null);
  assert.equal(discard(s, 0, 'd2a'), null); // fremde Karte
  assert.equal(layoff(s, 0, 'hKa', '0'), null);
  assert.equal(layoff(s, 0, 'hKa', -1), null);
  assert.equal(swap(s, 0, 'hKa', 0), null);
  assert.equal(draw(s, 0, 'talon'), null); // schon gezogen
  assert.equal(draw({ ...s, phase: 'draw' }, 0, 'beides'), null);
  assert.equal(undo(s, 0), null); // nichts zurückzunehmen
  assert.equal(meld(s, 1, ['d2a']), null);
  assert.ok(meld(s, 0, ['h7a', 's7a', 'c7b']));
  assert.deepEqual(s.hands[0], ['h7a', 's7a', 'c7b', 'hKa']);
  assert.deepEqual(s.melds, []);
});

test('Sicht: fremde Karten nur als Anzahl, Stapel nur Höhe, gezogene Stapelkarte des anderen ohne Bild', () => {
  let s = newGame(0, seeded(5));
  s = discard(s, 0, s.hands[0][0]);
  const pileCard = s.pile[0];
  const v1 = viewFor(s, 1);
  assert.equal(v1.hands[0], 13);
  assert.deepEqual(v1.hands[1], s.hands[1]);
  assert.equal(v1.talon, s.talon.length);
  assert.equal(v1.start, null);
  const a = draw(s, 1, 'talon');
  assert.equal(viewFor(a, 0).events.at(-1).card, undefined);
  assert.equal(viewFor(a, 1).events.at(-1).card, a.hands[1].at(-1));
  assert.ok(!JSON.stringify(viewFor(a, 0)).includes(a.hands[1].at(-1)) || a.hands[1].at(-1) === pileCard);
  const b = draw(s, 1, 'pile');
  assert.equal(viewFor(b, 0).events.at(-1).card, pileCard); // die Ablagekarte war offen
  assert.equal(viewFor(b, 0).start, null);
  // nach Rundenende sieht jeder die Restkarten des anderen
  const end = setup({ hands: [['h2a', 'cKa'], ['xr1', 'sAa']], melds: [run(0, 'h', 3, ['h3a', 'h4a', 'h5a'])], opened: [true, false] });
  const over = discard(layoff(end, 0, 'h2a', 0), 0, 'cKa');
  assert.deepEqual(viewFor(over, 0).hands[1], ['xr1', 'sAa']);
});
