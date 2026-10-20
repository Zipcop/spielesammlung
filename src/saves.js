// Gespeicherte Partien zu zweit: Der Host legt nach jedem Zug den vollen Spielstand hier ab (localStorage, nur dieser PC).
// Reißt die Verbindung ab oder wird der Browser geschlossen, kann er die letzte Partie je Spiel später fortsetzen.
// Rein (kein DOM), damit es sich mit node --test prüfen lässt.

const KEY = 'spielesammlung-spielstaende';

// { [Spielname]: { state, at } } – at = Zeitpunkt in ms. Kaputtes fällt weg.
export function loadSaves(storage) {
  try {
    storage ??= localStorage;
    const all = JSON.parse(storage.getItem(KEY));
    const ok = ([, s]) => s && typeof s.state === 'object' && s.state !== null && Number.isFinite(s.at);
    return all && typeof all === 'object' ? Object.fromEntries(Object.entries(all).filter(ok)) : {};
  } catch {
    return {};
  }
}

// track = Stand der Statistik zu dieser Partie (stats.js step) – damit ein Fortsetzen nichts doppelt zählt
export function storeSave(name, state, storage, now = Date.now(), track) {
  try {
    storage ??= localStorage;
    storage.setItem(KEY, JSON.stringify({ ...loadSaves(storage), [name]: { state, at: now, ...(track && { track }) } }));
  } catch {
    // ohne Speicher lässt sich die Partie eben nicht fortsetzen
  }
}

// „Mo., 20.10., 21:14“ – für den Fortsetzen-Knopf
export function savedAt(at) {
  return new Date(at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
