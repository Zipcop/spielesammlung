// Staub im Lichtkegel der Hängelampe (src/effects.js): jedes Körnchen hat in jedem Bild eine gültige Farbe.
// Eine ungültige Zahl (NaN) verteilt der Lichtschein (Bloom) über das ganze Bild – es wird für ein Bild schwarz,
// das Licht scheint zu flackern (gemessen 19.10.2026: 30 von 464 Bildern schwarz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('../test-stubs/spiel-hooks.mjs', import.meta.url);
const { createDust } = await import('../src/effects.js');

test('Staub: Farben und Lagen bleiben gültige Zahlen, auch wenn Körnchen neu entstehen', () => {
  let points = null;
  const dust = createDust({ add: (p) => (points = p) }, 1.72);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.4, 1.1);
  const { color, position } = points.geometry.attributes;
  for (let frame = 0; frame < 3000; frame++) {
    dust.update(1 / 10, camera); // große Schritte: viele Körnchen verlassen den Kegel und entstehen neu
    const bad = [...color.array, ...position.array].findIndex((v) => !Number.isFinite(v));
    assert.equal(bad, -1, `Bild ${frame}: ungültiger Wert an Stelle ${bad}`);
  }
});
