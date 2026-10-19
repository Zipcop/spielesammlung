import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, mergeSettings, levelOf, withLevel, loadSettings, saveSettings, DEFAULTS, LEVELS, OPTIONS, NAME_MAX } from '../src/settings.js';

// Speicher wie localStorage, nur im Arbeitsspeicher
function memory() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('Name: Leerraum, Länge, unsichtbare Zeichen', () => {
  assert.equal(cleanName('  Nico  '), 'Nico');
  assert.equal(cleanName('Anna   Maria'), 'Anna Maria');
  assert.equal(cleanName('Anna‮maria'), 'Annamaria'); // Schreibrichtung umkehren
  assert.equal(cleanName('Ni​co\u0000'), 'Nico'); // Null-Breite, Steuerzeichen
  assert.equal(cleanName('a'.repeat(30)), 'a'.repeat(NAME_MAX));
  assert.equal(cleanName('😀'.repeat(20)), '😀'.repeat(NAME_MAX)); // Emoji nicht halbieren
  assert.equal(cleanName('<b>Tom</b>'), 'bTom/b');
  assert.equal(cleanName('a'.repeat(NAME_MAX - 1) + ' bc'), 'a'.repeat(NAME_MAX - 1)); // kein Leerzeichen am Ende nach dem Kürzen
  assert.equal(cleanName('José Müller'), 'José Müller'); // zerlegter Akzent wird zum normalen é
  assert.equal(cleanName('Z͓͔͑͒a͕͖lgo'), 'Zalgo'); // gestapelte Akzente weg
  assert.equal(cleanName(' '.repeat(300) + 'Nico'), ''); // Riesentext: nur die ersten 200 Zeichen zählen
});

test('Name: ungültig ergibt leeren Text', () => {
  for (const bad of [undefined, null, 42, {}, ['Nico'], '', '   ', '‮​', '<>']) assert.equal(cleanName(bad), '');
});

test('Zusammenführen: Standard, gültige Werte übernehmen, Unsinn verwerfen', () => {
  assert.deepEqual(mergeSettings(null), DEFAULTS);
  assert.deepEqual(mergeSettings('kaputt'), DEFAULTS);
  assert.deepEqual(mergeSettings([1, 2]), DEFAULTS);
  const s = mergeSettings({ name: ' Nico ', scale: 0.3, shadows: 'soft', shadowSize: 4096, bloom: 'ja', ao: true, extra: 1, __proto__: { fps: true } });
  assert.equal(s.name, 'Nico');
  assert.equal(s.scale, DEFAULTS.scale);
  assert.equal(s.shadowSize, 4096);
  assert.equal(s.bloom, DEFAULTS.bloom);
  assert.equal(s.ao, true);
  assert.equal(s.fps, false);
  assert.deepEqual(Object.keys(s), Object.keys(DEFAULTS));
});

test('Stufen: nur erlaubte Werte, Standard ist Mittel, eigene Mischung erkannt', () => {
  for (const level of Object.values(LEVELS)) {
    for (const [key, v] of Object.entries(level)) assert.ok(OPTIONS[key].includes(v), key);
  }
  assert.equal(levelOf(DEFAULTS), 'mittel');
  for (const level of Object.keys(LEVELS)) assert.equal(levelOf(withLevel(DEFAULTS, level)), level);
  assert.equal(levelOf({ ...DEFAULTS, dust: false }), null);
  const ultra = withLevel({ ...DEFAULTS, name: 'Nico', fps: true }, 'ultra');
  assert.equal(ultra.name, 'Nico'); // Name und FPS-Anzeige bleiben
  assert.equal(ultra.fps, true);
  assert.equal(ultra.ao, true);
});

test('Laden und Speichern', () => {
  const store = memory();
  assert.deepEqual(loadSettings(store), DEFAULTS); // noch nichts gespeichert
  saveSettings({ ...withLevel(DEFAULTS, 'niedrig'), name: 'Anna' }, store);
  const back = loadSettings(store);
  assert.equal(back.name, 'Anna');
  assert.equal(levelOf(back), 'niedrig');

  store.setItem('spielesammlung-einstellungen', '{kein json');
  assert.deepEqual(loadSettings(store), DEFAULTS);
  const blocked = { getItem: () => { throw new Error('gesperrt'); }, setItem: () => { throw new Error('gesperrt'); } };
  assert.deepEqual(loadSettings(blocked), DEFAULTS);
  assert.doesNotThrow(() => saveSettings(DEFAULTS, blocked));
});
