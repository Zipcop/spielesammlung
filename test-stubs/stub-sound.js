// Stellvertreter für src/sound.js in test/tisch.test.js – merkt sich nur, was erklingen würde
export const heard = [];
export function playHit(kind, strength) {
  heard.push([kind, strength]);
}
