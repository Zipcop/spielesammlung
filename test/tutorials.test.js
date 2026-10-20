// Spielanleitungen (src/tutorials.js): Nico wünscht sich zu jedem Spiel eine kurze bebilderte Anleitung („Buchseite“).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { TUTORIALS } from '../src/tutorials.js';
import { PLAYABLE } from '../src/games.js';

test('Jedes spielbare Spiel hat eine Anleitung mit 3–8 Abschnitten und mindestens einem Bild', () => {
  for (const name of PLAYABLE.keys()) {
    const sections = TUTORIALS[name];
    assert.ok(sections, `Anleitung fehlt: ${name}`);
    assert.ok(sections.length >= 3 && sections.length <= 8, `${name}: ${sections.length} Abschnitte`);
    assert.ok(sections.some((s) => s.img), `${name}: kein Bild`);
  }
});

test('Jeder Abschnitt hat Überschrift und kurzen Text, Bilder gibt es wirklich', () => {
  for (const [name, sections] of Object.entries(TUTORIALS)) {
    for (const s of sections) {
      assert.ok(typeof s.title === 'string' && s.title.length > 2, `${name}: Überschrift`);
      assert.ok(typeof s.text === 'string' && s.text.length > 20 && s.text.length < 360, `${name}: Text „${s.title}“`);
      if (s.img) assert.ok(existsSync(new URL(`../public/anleitung/${s.img}`, import.meta.url)), `${name}: Bild ${s.img} fehlt`);
    }
  }
});
