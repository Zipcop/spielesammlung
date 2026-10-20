// Eigenes Deck dieses PCs (Deckbau): { name, list } in localStorage. Ungültige oder fremde Daten fallen weg.
// Rein (kein DOM), damit es sich mit node --test prüfen lässt.
import { deckProblem, isCardId, sortIds } from './cards.js';

const KEY = 'spielesammlung-kartenduell-deck';
export const NAME_MAX = 24;

export const cleanDeckName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Mein Deck';

// → { name, list } (list kann unfertig sein – dann ist es noch kein spielbares Deck) oder null
export function loadDeck(storage) {
  try {
    storage ??= localStorage;
    const d = JSON.parse(storage.getItem(KEY));
    if (!d || !Array.isArray(d.list)) return null;
    return { name: cleanDeckName(d.name), list: sortIds(d.list.filter(isCardId)).slice(0, 60) };
  } catch {
    return null;
  }
}

export function saveDeck(deck, storage) {
  const d = { name: cleanDeckName(deck.name), list: sortIds(deck.list.filter(isCardId)) };
  try {
    storage ??= localStorage;
    storage.setItem(KEY, JSON.stringify(d));
  } catch {
    // ohne Speicher gilt das Deck eben nur bis zum Neuladen
  }
  return d;
}

// Spielbar? (genau 40 Karten, höchstens 3 bzw. 1 Kopie)
export const playable = (deck) => !!deck && !deckProblem(deck.list);
