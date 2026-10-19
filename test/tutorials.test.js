// Rundgänge (src/tutorials.js): Nico wünscht sich zu jedem Spiel einen kurzen geführten Rundgang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUTORIALS } from '../src/tutorials.js';
import { PLAYABLE } from '../src/games.js';

test('Jedes spielbare Spiel hat einen Rundgang mit 3–6 Schritten', () => {
  for (const name of PLAYABLE.keys()) {
    const steps = TUTORIALS[name];
    assert.ok(steps, `Rundgang fehlt: ${name}`);
    assert.ok(steps.length >= 3 && steps.length <= 6, `${name}: ${steps.length} Schritte`);
  }
});

test('Jeder Schritt hat Überschrift und Text, zeigt höchstens auf eine Stelle', () => {
  for (const [name, steps] of Object.entries(TUTORIALS)) {
    for (const s of steps) {
      assert.ok(typeof s.title === 'string' && s.title.length > 2, `${name}: Überschrift`);
      assert.ok(typeof s.text === 'string' && s.text.length > 20 && s.text.length < 320, `${name}: Text „${s.title}“`);
      assert.ok(!(s.at && s.el), `${name}: „${s.title}“ zeigt auf zwei Stellen`);
    }
  }
});
