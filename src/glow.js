// Was gerade leuchten soll (Maus drüber, ausgewählt). Schrank und Spiele tragen hier ihre Teile ein,
// graphics.js zeichnet einen leuchtenden Umriss darum – wenn der Effekt eingeschaltet ist.
const sources = new Map();

// key = Quelle ('hover', 'selected', 'shelf'), objects = Meshes (leer = nichts)
export function setGlow(key, objects) {
  sources.set(key, objects.filter(Boolean));
}

export function glowObjects() {
  return [...sources.values()].flat();
}
