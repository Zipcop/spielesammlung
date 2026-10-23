// Namensschilder (src/plates.js): welcher Name auf welchem Platz steht und wo das Schild liegt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatLabels, seatSide, across } from '../src/plates.js';

const REL = ['', 'links', 'gegenüber', 'rechts'];

test('Vier Sitze allein: eigener Name, Computer wie im Seitenfeld', () => {
  const cpu = (s) => `Computer ${REL[s]}`;
  assert.deepEqual(seatLabels(4, { mySeat: 0, humans: [0], me: 'Nico', other: 'Anna', cpu }),
    ['Nico', 'Computer links', 'Computer gegenüber', 'Computer rechts']);
});

test('Zu zweit: Host und Gast sehen beide Namen, leere Plätze ohne Schild', () => {
  const taken = (s) => [0, 2].includes(s);
  assert.deepEqual(seatLabels(4, { mySeat: 0, humans: [0, 2], me: 'Nico', other: 'Anna', taken }), ['Nico', '', 'Anna', '']);
  assert.deepEqual(seatLabels(4, { mySeat: 2, humans: [0, 2], me: 'Anna', other: 'Nico', taken }), ['Nico', '', 'Anna', '']);
});

test('Ohne eigenen Namen steht „Du“, ohne Namen des Mitspielers „Mitspieler“', () => {
  assert.deepEqual(seatLabels(2, { mySeat: 1, humans: [0, 1], me: '', other: '' }), ['Mitspieler', 'Du']);
  assert.deepEqual(seatLabels(2, { mySeat: 0, humans: [0], me: 'Nico', other: 'Anna' }), ['Nico', 'Computer']);
});

test('Ecke: rechts neben dem Platz, beim rechten Nachbarn des Zuschauers links (zum Zuschauer hin)', () => {
  assert.deepEqual([0, 1, 2, 3].map((s) => seatSide(s, 0)), [1, 1, 1, -1]);
  assert.deepEqual([0, 1, 2, 3].map((s) => seatSide(s, 2)), [1, -1, 1, 1]);
});

test('Zwei Plätze gegenüber: Lage gespiegelt', () => {
  assert.deepEqual(across(0, -22, 10), { x: -22, y: 0, z: 10 });
  assert.deepEqual(across(1, -22, 10, 2), { x: 22, y: 2, z: -10 });
});
