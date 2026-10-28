// Elo-Zahl beim Schach – reine Rechnung plus Speicher je PC. Quellen:
// - Formel wie bei den Rätseln (puzzle.js rate): E = 1 / (1 + 10^((Gegner − ich) / 400)), K = 40 für die ersten
//   30 Partien, danach 20 (FIDE-Wertungsordnung, handbook.fide.com/chapter/B022024, 8.3.3). Remis = ½ Punkt.
// - Stärke des Computers: Stockfish-Option UCI_Elo (1320–3190, „anchored to CCRL 40/4“, kalibriert bei 60 s + 0,6 s –
//   Stockfish-Doku). Stockfish rechnet sie in einen Skill Level um (src/search.h, struct Skill):
//   level = 37,2473·e³ − 40,8525·e² + 22,2943·e − 0,311438 mit e = (Elo − 1320) / 1870, begrenzt auf 0…19,
//   und wählt seinen Zug in Suchtiefe 1 + ganzzahliger Teil von level (time_to_pick). Wir suchen genau so tief –
//   dann spielt er wie bei der Kalibrierung, nur schneller.
// - Unter 1320: Skill Level 0 und mit Wahrscheinlichkeit p ein zufälliger erlaubter Zug.
//   p je Elo haben wir selbst gemessen (Stockfish gegen Stockfish, siehe HANDICAP) – eine Schätzung auf derselben Skala.
// Alle Zahlen sind Computer-Elo (CCRL-Skala), keine FIDE- oder Lichess-Zahl.
import { rate } from './puzzle.js';

export const START_ELO = 1200;
export const LOWEST = 1320; // kleinste UCI_Elo
export const HIGHEST = 3190; // größte UCI_Elo
export const COACH_MIN = 400; // Auswahl beim Coach: 400 … 3150 in 50er-Schritten
export const COACH_MAX = 3150;
export const COACH_STEP = 50;

// Computer-Stufen mit fester Elo (CCRL-Skala, strengthFor): ab 1320 über UCI_LimitStrength + UCI_Elo, darunter mit
// Zufallszügen (HANDICAP). Nico 28.10.2026: 1320 ist für einen Anfänger viel zu stark – deshalb Stufen ab 400.
export const LEVELS = [
  { name: 'Anfänger', elo: 400 },
  { name: 'Einsteiger', elo: 700 },
  { name: 'Leicht', elo: 1000 },
  { name: 'Mittel', elo: 1320 },
  { name: 'Fortgeschritten', elo: 1600 },
  { name: 'Stark', elo: 2000 },
  { name: 'Experte', elo: 2400 },
  { name: 'Meister', elo: 3190 },
];

// Unter 1320: [Elo, p Zufallszug] – gemessen am 28.10.2026: Stockfish 19 lite-single, Skill Level 0 in Tiefe 1 (= 1320)
// gegen dasselbe mit Zufallszügen, je 400 Partien: p 0,1 → −238 (95 %: −198…−285), p 0,2 → −370 (−320…−435),
// p 0,3 → −507 (−441…−609). Darunter in Ketten (p gegen p + 0,2, je 400 Partien): 0,3 → 0,5 −263 (−221…−313),
// 0,5 → 0,7 −231 (−191…−278), 0,7 → 0,9 −198 (−159…−241) – die Unsicherheit wächst mit jedem Glied.
// Dazwischen geradlinig; unter 121 bleibt es bei p 0,9.
export const HANDICAP = [[1320, 0], [1082, 0.1], [950, 0.2], [813, 0.3], [550, 0.5], [319, 0.7], [121, 0.9]];

// Neue Zahl nach einer Partie: me = { rating, games }, score = 1 Sieg, 0,5 Remis, 0 Niederlage
export const rateGame = (me, opponent, score) => rate(me, opponent, score);

// Skill Level, den Stockfish für diese UCI_Elo benutzt (wie search.h)
export function skillFor(elo) {
  const e = (Math.max(LOWEST, Math.min(HIGHEST, elo)) - LOWEST) / (HIGHEST - LOWEST);
  return Math.max(0, Math.min(19, ((37.2473 * e - 40.8525) * e + 22.2943) * e - 0.311438));
}

// Stockfish-Einstellungen für eine Stärke: { options, go, random } – random = Wahrscheinlichkeit eines Zufallszugs
export function strengthFor(elo) {
  if (elo >= LOWEST) {
    const e = Math.min(HIGHEST, Math.round(elo));
    return { options: { UCI_LimitStrength: true, UCI_Elo: e }, go: `depth ${1 + Math.floor(skillFor(e))} movetime 3000`, random: 0 };
  }
  const at = Math.max(elo, HANDICAP.at(-1)[0]); // unter dem schwächsten Messpunkt bleibt es dabei
  const k = HANDICAP.findIndex(([x]) => x <= at); // erster Messpunkt darunter (HANDICAP fällt)
  const [[e1, p1], [e2, p2]] = [HANDICAP[k - 1], HANDICAP[k]];
  const p = p1 + ((e1 - at) / (e1 - e2)) * (p2 - p1);
  return { options: { UCI_LimitStrength: false, 'Skill Level': 0 }, go: 'depth 1', random: Math.round(p * 100) / 100 };
}

// Coach-Stärke zur eigenen Zahl: auf 50 gerundet, innerhalb der Auswahl
export const coachFor = (rating) => Math.max(COACH_MIN, Math.min(COACH_MAX, Math.round(rating / COACH_STEP) * COACH_STEP));

// Elo zu zweit aus der Statistik (stats.js): Schach-Partien des Paars [a, b] der Zeit nach, beide starten bei 1200.
// Zurückgenommene Ergebnisse (w = null) zählen nicht. Liefert { [a]: Zahl, [b]: Zahl, games }.
export function pairElo(entries, [a, b]) {
  let x = { rating: START_ELO, games: 0 };
  let y = { rating: START_ELO, games: 0 };
  const games = entries.filter((e) => e.game === 'Schach' && e.a === a && e.b === b && e.w !== null).sort((p, q) => p.at - q.at);
  for (const e of games) {
    const score = e.w === '' ? 0.5 : e.w === a ? 1 : 0;
    [x, y] = [rateGame(x, y.rating, score), rateGame(y, x.rating, 1 - score)];
  }
  return { [a]: x.rating, [b]: y.rating, games: games.length };
}

// --- Speicher je PC: { rating, games, coach (eingestellte Coach-Stärke oder null), last: { before, after } } ---
const KEY = 'spielesammlung-schach-elo';
const fresh = () => ({ rating: START_ELO, games: 0, coach: null, last: null });

export function loadElo() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return Number.isFinite(s?.rating) && Number.isFinite(s?.games) ? { ...fresh(), ...s } : fresh();
  } catch {
    return fresh();
  }
}

function store(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher (z. B. privates Fenster) wird nichts gemerkt – die Zahl bleibt beim Startwert
  }
}

// Partie gegen den Computer oder Coach werten. coach = true: der Coach stellt sich auf die neue Zahl ein
export function recordGame(opponent, score, coach = false) {
  const s = loadElo();
  const next = rateGame(s, opponent, score);
  const out = { ...s, ...next, last: { before: s.rating, after: next.rating }, coach: coach ? coachFor(next.rating) : s.coach };
  store(out);
  addHistory(next.rating);
  return out;
}

// Verlauf für die Elo-Kurve der Schach-Schule (seit 28.10.2026): eigener Eintrag, damit der Speicher oben gleich bleibt.
// [{ at: Zeitpunkt, rating }], höchstens HISTORY_MAX Einträge
export const HISTORY_KEY = 'spielesammlung-schach-elo-verlauf';
const HISTORY_MAX = 300;

export function loadEloHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(list) ? list.filter((e) => Number.isFinite(e?.at) && Number.isFinite(e?.rating)) : [];
  } catch {
    return [];
  }
}

function addHistory(rating) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([...loadEloHistory(), { at: Date.now(), rating }].slice(-HISTORY_MAX)));
  } catch {
    // ohne Speicher keine Kurve
  }
}

// Eingestellte Coach-Stärke (Standard: eigene Zahl gerundet)
export const coachElo = (s = loadElo()) => s.coach ?? coachFor(s.rating);
export function setCoachElo(elo) {
  store({ ...loadElo(), coach: coachFor(elo) });
}

// Änderung als Text: '+12', '−8', '±0'
export const diffText = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');
