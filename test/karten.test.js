import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDeck, shuffle, cardName, isCard, isJoker, isRed, suitOf, rankOf } from '../src/karten/cards.js';

test('Blatt: 32 und 52 Karten, jede genau einmal', () => {
  const small = makeDeck('7');
  const full = makeDeck('2');
  assert.equal(small.length, 32);
  assert.equal(new Set(small).size, 32);
  assert.equal(full.length, 52);
  assert.equal(new Set(full).size, 52);
  assert.ok(small.every((c) => full.includes(c)));
  assert.ok(!small.includes('h6'));
  assert.ok(full.every(isCard));
});

test('Namen und Farben', () => {
  assert.equal(cardName('h7'), 'Herz 7');
  assert.equal(cardName('sT'), 'Pik 10');
  assert.equal(cardName('cJ'), 'Kreuz Bube');
  assert.equal(cardName('dA'), 'Karo Ass');
  assert.equal(cardName('hQ'), 'Herz Dame');
  assert.equal(suitOf('dK'), 'd');
  assert.equal(rankOf('dK'), 'K');
  assert.ok(isRed('h2') && isRed('dA') && !isRed('cA') && !isRed('s9'));
  for (const bad of ['', 'x7', 'h1', 'h77', 7, null, '<b>']) assert.equal(isCard(bad), false);
  assert.equal(cardName('xr'), 'Joker');
  assert.ok(isJoker('xr') && isJoker('xb') && !isJoker('h7') && !isJoker('x') && !isCard('xr'));
  assert.ok(!makeDeck('2').some(isJoker)); // Joker legt nur Rommé dazu
});

test('Mischen: gleiche Karten, neue Reihenfolge, Original bleibt', () => {
  const deck = makeDeck('7');
  const mixed = shuffle(deck);
  assert.deepEqual([...mixed].sort(), [...deck].sort());
  assert.notDeepEqual(mixed, deck); // 1 : 32! – praktisch nie gleich
  assert.deepEqual(deck, makeDeck('7'));
  // gleicher Zufall → gleiches Ergebnis
  const rng = () => 0.5;
  assert.deepEqual(shuffle(deck, rng), shuffle(deck, rng));
});
