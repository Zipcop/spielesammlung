// Start: npm test (node --test, keine zusätzliche Abhängigkeit)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, MAX, scoreDice, scoreOptions, isKniffel, isJoker, totals } from '../src/kniffel/rules.js';

const score = (field, dice) => scoreDice(dice, field);

test('13 Felder', () => {
  assert.equal(FIELDS.length, 13);
});

test('oben: nur die passende Augenzahl zählt', () => {
  const dice = [3, 3, 5, 1, 3];
  assert.equal(score('einser', dice), 1);
  assert.equal(score('zweier', dice), 0);
  assert.equal(score('dreier', dice), 9);
  assert.equal(score('vierer', dice), 0);
  assert.equal(score('fuenfer', dice), 5);
  assert.equal(score('sechser', [6, 6, 6, 6, 6]), 30);
});

test('Beispiel aus der Anleitung: drei Fünfen + zwei Dreien', () => {
  const dice = [5, 3, 5, 3, 5];
  assert.equal(score('fuenfer', dice), 15);
  assert.equal(score('dreier', dice), 6);
  assert.equal(score('dreierpasch', dice), 21);
  assert.equal(score('fullHouse', dice), 25);
});

test('Dreierpasch: mindestens drei gleiche, Summe aller Augen', () => {
  assert.equal(score('dreierpasch', [2, 2, 2, 5, 6]), 17);
  assert.equal(score('dreierpasch', [4, 4, 4, 4, 1]), 17); // vier gleiche zählen auch
  assert.equal(score('dreierpasch', [6, 6, 6, 6, 6]), 30);
  assert.equal(score('dreierpasch', [2, 2, 3, 3, 6]), 0);
});

test('Viererpasch: mindestens vier gleiche, Summe aller Augen', () => {
  assert.equal(score('viererpasch', [4, 4, 4, 4, 1]), 17);
  assert.equal(score('viererpasch', [1, 1, 1, 1, 1]), 5);
  assert.equal(score('viererpasch', [4, 4, 4, 1, 1]), 0);
});

test('Full House: drei gleiche + zwei gleiche andere = 25', () => {
  assert.equal(score('fullHouse', [4, 4, 4, 1, 1]), 25);
  assert.equal(score('fullHouse', [1, 4, 1, 4, 1]), 25);
  assert.equal(score('fullHouse', [4, 4, 4, 4, 1]), 0);
  assert.equal(score('fullHouse', [4, 4, 1, 1, 2]), 0);
  assert.equal(score('fullHouse', [5, 5, 5, 5, 5]), 0); // Kniffel ist kein Full House (ohne Joker)
});

test('Kleine Straße: vier aufeinanderfolgende = 30', () => {
  assert.equal(score('kleineStrasse', [1, 2, 3, 4, 3]), 30); // Beispiel aus der Anleitung
  assert.equal(score('kleineStrasse', [6, 5, 4, 3, 6]), 30);
  assert.equal(score('kleineStrasse', [2, 3, 4, 5, 1]), 30); // große Straße enthält eine kleine
  assert.equal(score('kleineStrasse', [1, 2, 3, 5, 6]), 0); // Lücke
  assert.equal(score('kleineStrasse', [1, 1, 2, 2, 3]), 0);
});

test('Große Straße: fünf aufeinanderfolgende = 40', () => {
  assert.equal(score('grosseStrasse', [2, 3, 4, 5, 6]), 40);
  assert.equal(score('grosseStrasse', [5, 1, 4, 2, 3]), 40);
  assert.equal(score('grosseStrasse', [1, 2, 3, 4, 6]), 0);
  assert.equal(score('grosseStrasse', [1, 2, 3, 4, 4]), 0);
});

test('Kniffel: fünf gleiche = 50', () => {
  assert.equal(score('kniffel', [3, 3, 3, 3, 3]), 50);
  assert.equal(score('kniffel', [3, 3, 3, 3, 2]), 0);
  assert.ok(isKniffel([1, 1, 1, 1, 1]));
  assert.ok(!isKniffel([1, 1, 1, 1, 2]));
});

test('Chance: Summe aller Augen', () => {
  assert.equal(score('chance', [1, 2, 3, 4, 6]), 16);
  assert.equal(score('chance', [1, 1, 1, 1, 1]), 5);
  assert.equal(score('chance', [6, 6, 6, 6, 6]), 30);
});

test('scoreOptions: nur freie Felder', () => {
  const options = scoreOptions([1, 2, 3, 4, 5], { einser: 1, grosseStrasse: 40 });
  assert.equal(Object.keys(options).length, 11);
  assert.equal(options.einser, undefined);
  assert.equal(options.grosseStrasse, undefined);
  assert.equal(options.kleineStrasse, 30);
  assert.equal(options.chance, 15);
});

test('gestrichenes Feld (0) gilt als belegt', () => {
  const options = scoreOptions([2, 2, 2, 2, 2], { kniffel: 0 });
  assert.equal(options.kniffel, undefined);
});

test('Joker: zweiter Kniffel → jedes freie Feld mit Höchstpunktzahl', () => {
  const card = { kniffel: 50 };
  const dice = [2, 2, 2, 2, 2];
  assert.ok(isJoker(dice, card));
  const options = scoreOptions(dice, card);
  assert.equal(options.sechser, 30); // egal, mit welcher Augenzahl der Kniffel gewürfelt wurde
  assert.equal(options.zweier, 10);
  assert.equal(options.fullHouse, 25);
  assert.equal(options.kleineStrasse, 30);
  assert.equal(options.grosseStrasse, 40);
  assert.equal(options.chance, 30);
  for (const [field, points] of Object.entries(options)) assert.equal(points, MAX[field]);
});

test('kein Joker, wenn der Kniffel gestrichen wurde', () => {
  const card = { kniffel: 0 };
  const dice = [4, 4, 4, 4, 4];
  assert.ok(!isJoker(dice, card));
  const options = scoreOptions(dice, card);
  assert.equal(options.vierer, 20);
  assert.equal(options.fullHouse, 0);
  assert.equal(options.grosseStrasse, 0);
  assert.equal(options.chance, 20);
});

test('Bonus: 35 ab 63 Punkten oben, 62 reicht nicht', () => {
  // 3 von jeder Zahl = 63
  const exact = { einser: 3, zweier: 6, dreier: 9, vierer: 12, fuenfer: 15, sechser: 18 };
  assert.deepEqual(totals(exact), { upper: 63, bonus: 35, lower: 0, extra: 0, total: 98 });
  const short = { ...exact, einser: 2 };
  assert.equal(totals(short).bonus, 0);
  assert.equal(totals(short).total, 62);
});

test('Summen inkl. Zusatz-Kniffel', () => {
  const card = { sechser: 30, fullHouse: 25, kniffel: 50, chance: 0 };
  assert.deepEqual(totals(card, 2), { upper: 30, bonus: 0, lower: 75, extra: 100, total: 205 });
  assert.equal(totals({}).total, 0);
});

test('Höchstpunktzahl ohne Zusatz-Kniffel: 375', () => {
  const card = { ...MAX, einser: 5, zweier: 10, dreier: 15, vierer: 20, fuenfer: 25, sechser: 30 };
  assert.equal(totals(card).total, 375);
});
