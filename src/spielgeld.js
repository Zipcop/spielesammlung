// Spielgeld-Konto dieses PCs – eins für alle Casino-Spiele (Texas Hold'em, später Blackjack). Nico 20.10.2026: Man geht
// mit dem ganzen Konto an den Tisch; wer bei 0 ist, leiht sich Geld von der Bank, und es wird mitgezählt, wie viel.
// Gespeichert nur hier im Browser (localStorage). Rein (kein DOM), damit es sich mit node --test prüfen lässt.
//
// link = welche Runde den Stand zuletzt geschrieben hat (z. B. die Poker-Runde zu zweit). Schreibt eine andere Runde
// oder ein anderes Spiel, weiß die alte beim Fortsetzen, dass sich das Konto inzwischen geändert hat.

const KEY = 'spielesammlung-spielgeld';
export const START = 1000; // Startguthaben
export const LOAN = 1000; // so viel leiht die Bank auf einmal

const fresh = () => ({ chips: START, borrowed: 0, loans: 0, link: null });
const count = (x) => (Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

// → { chips, borrowed (Summe aller Kredite), loans (Anzahl), link }
export function loadMoney(storage) {
  try {
    storage ??= localStorage;
    const m = JSON.parse(storage.getItem(KEY));
    if (!m || typeof m !== 'object' || !Number.isFinite(m.chips)) return fresh();
    return { chips: count(m.chips), borrowed: count(m.borrowed), loans: count(m.loans), link: typeof m.link === 'string' ? m.link : null };
  } catch {
    return fresh();
  }
}

function store(m, storage) {
  try {
    storage ??= localStorage;
    storage.setItem(KEY, JSON.stringify(m));
  } catch {
    // ohne Speicher gilt der Stand eben nur bis zum Neuladen
  }
  return m;
}

// Neuer Kontostand aus einer Runde (link = deren Kennung)
export const setChips = (chips, link = null, storage) => store({ ...loadMoney(storage), chips: count(chips), link }, storage);

// Bei der Bank leihen – nur, wenn nichts mehr da ist. null = geht nicht
export function borrowMoney(storage) {
  const m = loadMoney(storage);
  if (m.chips > 0) return null;
  return store({ chips: m.chips + LOAN, borrowed: m.borrowed + LOAN, loans: m.loans + 1, link: null }, storage);
}

// „1.250“ – Chips mit Tausenderpunkt
export const formatChips = (n) => Math.round(n).toLocaleString('de-DE');
