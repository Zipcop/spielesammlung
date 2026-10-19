// Einstellungen dieses PCs: Spielername, Grafik und Effekte. Werden nur hier im Browser gespeichert
// (localStorage) und nicht übertragen – nur der Name geht beim Verbinden an den Mitspieler.
// Rein (kein DOM, kein three.js), damit es sich mit node --test prüfen lässt.

const KEY = 'spielesammlung-einstellungen';
export const NAME_MAX = 16;

// Grafik-Stufen. Jede Stufe legt Grafik und Effekte fest; einzelne Schalter weichen davon ab („Eigene“).
// Niedrig: für schwache PCs (Onboard-Grafik) – weniger Pixel, keine Nachbearbeitung. Weiche statt harter Schatten,
// weil harte auf den Figuren treppig/gestreift aussehen und kaum schneller sind (gemessen 19.10.2026).
// Mittel (Standard): dazu volle Auflösung, Kantenglättung und die günstigen Effekte.
// Hoch: schärfer auf skalierten Bildschirmen, feinere Schatten. Ultra: dazu die teure Umgebungsverdeckung.
export const LEVELS = {
  niedrig: { scale: 0.75, maxDpr: 1, shadows: 'soft', shadowSize: 1024, aa: false, bloom: false, ao: false, dust: false, outline: false, confetti: true },
  mittel: { scale: 1, maxDpr: 1, shadows: 'soft', shadowSize: 1024, aa: true, bloom: true, ao: false, dust: true, outline: true, confetti: true },
  hoch: { scale: 1, maxDpr: 1.5, shadows: 'soft', shadowSize: 2048, aa: true, bloom: true, ao: false, dust: true, outline: true, confetti: true },
  ultra: { scale: 1, maxDpr: 2, shadows: 'soft', shadowSize: 4096, aa: true, bloom: true, ao: true, dust: true, outline: true, confetti: true },
};

// name '' = noch nicht gefragt · free = als Host „Ohne Hilfen“ spielen (Schummeln erlaubt)
// Designs: Zimmer, Tageszeit und Spielmaterial – jeder PC sieht sein eigenes Design
export const DESIGN_DEFAULTS = { room: 'wohnzimmer', daytime: 'nacht', dice: 'weiss', felt: 'gruen', chessSet: 'holz', cardBack: 'rot' };
export const DEFAULTS = { name: '', ...LEVELS.mittel, fps: false, free: false, ...DESIGN_DEFAULTS };

// Erlaubte Werte je Einstellung – alles andere (z. B. von Hand verändert) fällt auf den Standard zurück
const ON_OFF = [false, true];
export const OPTIONS = {
  scale: [0.5, 0.75, 1],
  maxDpr: [1, 1.5, 2],
  shadows: ['off', 'hard', 'soft'],
  shadowSize: [512, 1024, 2048, 4096],
  aa: ON_OFF,
  bloom: ON_OFF,
  ao: ON_OFF,
  dust: ON_OFF,
  outline: ON_OFF,
  confetti: ON_OFF,
  fps: ON_OFF,
  free: ON_OFF,
  room: ['wohnzimmer', 'kamin', 'casino'],
  daytime: ['tag', 'abend', 'nacht'],
  dice: ['weiss', 'elfenbein', 'rot', 'schwarz'],
  felt: ['gruen', 'rot', 'blau'],
  chessSet: ['holz', 'marmor', 'metall'],
  cardBack: ['rot', 'blau', 'gruen'],
};

// Spielername: Steuer- und unsichtbare Zeichen (z. B. Schreibrichtungs-Umkehr), übrig gebliebene Akzent-Zeichen
// (gestapelt ragen sie über die Zeile) und < > entfernen, Leerraum zusammenfassen, höchstens NAME_MAX Zeichen.
// Ungültig → ''. Gilt für eigene Eingabe und Empfang (dort erst grob kürzen – der andere PC könnte Riesentext schicken).
export function cleanName(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text.slice(0, 200).normalize('NFC').replace(/[\p{C}\p{M}<>]/gu, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(cleaned); // Array.from: Emoji nicht zerteilen
  return chars.slice(0, NAME_MAX).join('').trim();
}

// Gespeichertes mit dem Standard zusammenführen: nur bekannte Schlüssel mit erlaubtem Wert übernehmen
export function mergeSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, standard]) => [
    key,
    !Object.hasOwn(s, key) ? standard : key === 'name' ? cleanName(s.name) : OPTIONS[key].includes(s[key]) ? s[key] : standard,
  ]));
}

// Welche Stufe passt genau? null = eigene Mischung
export function levelOf(s) {
  return Object.keys(LEVELS).find((level) => Object.entries(LEVELS[level]).every(([key, v]) => s[key] === v)) ?? null;
}

export function withLevel(s, level) {
  return { ...s, ...LEVELS[level] };
}

// storage: zum Testen austauschbar; ohne Speicher (z. B. gesperrt) gilt der Standard
export function loadSettings(storage) {
  try {
    storage ??= localStorage;
    return mergeSettings(JSON.parse(storage.getItem(KEY)));
  } catch {
    return mergeSettings(null);
  }
}

export function saveSettings(s, storage) {
  try {
    storage ??= localStorage;
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher gelten die Einstellungen eben nur bis zum Neuladen
  }
}
