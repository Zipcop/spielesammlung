// Abzeichen der Zuganalyse (wie bei chess.com): Name, Zeichen und Farbe – für den Partiezettel (HTML)
// und die runde Plakette über dem Zielfeld auf dem Brett (board.js).
export const BADGES = {
  brillant: { label: 'Brillant', symbol: '!!', color: '#1baca6' },
  grossartig: { label: 'Großartiger Zug', symbol: '!', color: '#5b8bb0' },
  best: { label: 'Bester Zug', symbol: '★', color: '#5c9a32' },
  ausgezeichnet: { label: 'Ausgezeichnet', symbol: '👍', color: '#96bc4b' },
  gut: { label: 'Gut', symbol: '✓', color: '#86a77a' },
  buch: { label: 'Buchzug', symbol: '📖', color: '#a88764' },
  ungenau: { label: 'Ungenauigkeit', symbol: '?!', color: '#e6b422' },
  fehler: { label: 'Fehler', symbol: '?', color: '#e58f2a' },
  patzer: { label: 'Patzer', symbol: '??', color: '#ca3431' },
  verpasst: { label: 'Verpasster Gewinn', symbol: '✗', color: '#e7799a' },
};

// Bei diesen Einstufungen zeigt der Zettel „besser war …“
export const NEGATIVE = new Set(['ungenau', 'fehler', 'patzer', 'verpasst']);
