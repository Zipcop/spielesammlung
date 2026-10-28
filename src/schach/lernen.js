// Lernen mit Schach-Rätseln (Nico 28.10.2026) – reine Logik ohne Anzeige, Speicher je PC:
// - Tagesrätsel: jeden Tag dasselbe Rätsel aus puzzles.json (nach Datum, passend zur eigenen Wertung ±200),
//   Serie = Tage in Folge gelöst, dazu der Bestwert.
// - Rätsel-Sturm: 3 Minuten, die Rätsel werden immer schwerer, 3 Fehler = vorbei, Rekord.
// - Schwächen-Profil: richtig/falsch je Lichess-Thema (normale Rätsel, Tagesrätsel, Sturm).
// - Meine Fehler: Fehler und Patzer aus eigenen Partien (und verpasste Rätsel) als Rätsel, wiederholt mit Abstand
//   1 → 3 → 7 Tage, dann erledigt; falsch → wieder ab 1 Tag.
// - Erfolge: schlichte Abzeichen aus diesen Zahlen.
// - Nullzug für „Drohung zeigen“ (Schach): gleiche Stellung, aber der Gegner ist am Zug.
// Speicher-Vertrag (die Fortschritts-Seite der Schach-Schule liest ihn mit loadLernen()):
// { daily: { streak, best, last, solved: [Datum …], pick, tried, shown }, motifs: { Thema: { right, wrong } },
//   mistakes: [{ id, fen, best, theme?, due, step, … }], storm: { best, runs }, solved, cleared } – Datum 'YYYY-MM-DD'.
import { Chess } from 'chess.js';
import { PICKABLE } from './puzzle.js';
import { expected } from './oracle.js';

const KEY = 'spielesammlung-schach-lernen';
export const DAILY_WINDOW = 200; // Tagesrätsel: Wertung ±200 um die eigene
export const INTERVALS = [1, 3, 7]; // Tage bis zur nächsten Wiederholung nach 1, 2, 3 richtigen Antworten
export const MIN_TRIES = 5; // Schwächen-Profil: Thema erst ab so vielen Versuchen
export const STORM_MS = 3 * 60 * 1000;
export const STORM_LIVES = 3;
const STORM_START = 700; // Wertung des ersten Sturm-Rätsels …
const STORM_STEP = 50; // … und so viel schwerer wird jedes weitere
const MAX_MISTAKES = 200; // ältere fallen raus
const MAX_DAYS = 400; // so viele Tage merkt sich die Liste der gelösten Tagesrätsel
export const MISTAKE_KINDS = new Set(['fehler', 'patzer', 'verpasst']); // diese Einstufungen werden Rätsel (badges.js)
const ALSO_OK = 0.05; // zweitbester Zug zählt auch, wenn er höchstens so viel schlechter ist (Grenze „Gut“, oracle.js)

// --- Datum: immer Ortszeit, gespeichert als 'YYYY-MM-DD' ---
const pad = (n) => String(n).padStart(2, '0');
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Tage dazurechnen – über UTC, damit Sommer-/Winterzeit nichts verschiebt
export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s);
const count = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

export const fresh = () => ({
  daily: { streak: 0, best: 0, last: null, solved: [], pick: null, tried: null, shown: null }, // tried/shown: Tag des ersten Versuchs / der gezeigten Lösung
  motifs: {},
  mistakes: [],
  storm: { best: 0, runs: 0 },
  solved: null, // alle gelösten Rätsel; null = noch nie gespeichert (raetsel.js übernimmt dann den alten Zähler)
  cleared: 0,
});

// Gespeicherten Stand prüfen – was nicht passt, fällt auf den Anfangswert zurück. Die Serie gilt nur, wenn zuletzt
// heute oder gestern gelöst wurde (sonst ist sie gerissen und steht auf 0).
export function normalize(raw, today = dayOf()) {
  const out = fresh();
  if (!raw || typeof raw !== 'object') return out;
  const d = raw.daily ?? {};
  out.daily = {
    streak: count(d.streak),
    best: count(d.best),
    last: isDay(d.last) ? d.last : null,
    solved: Array.isArray(d.solved) ? d.solved.filter(isDay).slice(-MAX_DAYS) : [],
    pick: isDay(d.pick?.date) && typeof d.pick.id === 'string' ? { date: d.pick.date, id: d.pick.id } : null,
    tried: isDay(d.tried) ? d.tried : null,
    shown: isDay(d.shown) ? d.shown : null,
  };
  out.daily.streak = currentStreak(out.daily, today);
  out.daily.best = Math.max(out.daily.best, out.daily.streak);
  for (const [theme, c] of Object.entries(raw.motifs ?? {})) {
    if (c && typeof c === 'object') out.motifs[theme] = { right: count(c.right), wrong: count(c.wrong) };
  }
  // Stellung und Lösungszug müssen zusammenpassen (sonst stürzt das Rätsel ab); Nebenfelder mit falschem Typ fallen weg
  const text = (s) => (typeof s === 'string' ? s : undefined);
  out.mistakes = (Array.isArray(raw.mistakes) ? raw.mistakes : [])
    .filter((m) => m && typeof m.id === 'string' && typeof m.fen === 'string' && typeof m.best === 'string' && isDay(m.due) && sanOf(m.fen, m.best))
    .map((m) => ({
      ...m,
      step: Math.min(INTERVALS.length, count(m.step)),
      also: Array.isArray(m.also) ? m.also.filter((u) => typeof u === 'string') : [],
      played: text(m.played) ?? null,
      date: isDay(m.date) ? m.date : m.due,
      theme: text(m.theme),
      puzzle: text(m.puzzle),
    }));
  out.storm = { best: count(raw.storm?.best), runs: count(raw.storm?.runs) };
  out.solved = Number.isFinite(raw.solved) ? count(raw.solved) : null;
  out.cleared = count(raw.cleared);
  return out;
}

export function loadLernen(today = dayOf()) {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)), today);
  } catch {
    return fresh(); // kein Speicher oder kaputter Eintrag
  }
}

export function saveLernen(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ohne Speicher gilt der Lernstand nur bis zum Neuladen
  }
}

// --- Tagesrätsel ---
// Zahl aus dem Datum (FNV-1a) – derselbe Tag gibt auf jedem PC dieselbe Zahl
function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

// Rätsel des Tages: aus allen Rätseln mit Wertung ±200 um meine (kein passendes → Fenster wird breiter)
// eines nach dem Datum. Gleicher Tag + gleiche Wertung = gleiches Rätsel.
export function dailyPuzzle(list, day, rating) {
  for (let width = DAILY_WINDOW; width < 4000; width += 100) {
    const pool = list.filter((row) => Math.abs(row[3] - rating) <= width);
    if (pool.length) return pool[hash(day) % pool.length];
  }
  return null;
}

// Rätsel des Tages einmal festhalten: Ändert sich die Wertung im Lauf des Tages, bleibt es dasselbe.
// Liefert { daily, row } – daily mit pick für heute.
export function pickDaily(daily, list, day, rating) {
  const kept = daily.pick?.date === day && list.find((row) => row[0] === daily.pick.id);
  const row = kept || dailyPuzzle(list, day, rating);
  return { daily: { ...daily, pick: row ? { date: day, id: row[0] } : null }, row };
}

// Serie, wie sie heute steht: zuletzt heute oder gestern gelöst → läuft weiter, sonst gerissen (0)
export function currentStreak(daily, today) {
  return daily.last === today || daily.last === addDays(today, -1) ? daily.streak : 0;
}

// Tagesrätsel heute gelöst: Serie +1 (gestern auch gelöst) oder neu ab 1; zweimal am Tag zählt einmal
export function solveDaily(daily, today) {
  if (daily.last === today) return daily;
  const streak = daily.last === addDays(today, -1) ? daily.streak + 1 : 1;
  return { ...daily, streak, best: Math.max(daily.best, streak), last: today, solved: [...daily.solved, today].slice(-MAX_DAYS) };
}

export const dailyDone = (daily, today) => daily.last === today;

// Kurzer Hinweis am Rätsel-Tisch
export function dayHint(data, today = dayOf()) {
  const streak = currentStreak(data.daily, today);
  const done = dailyDone(data.daily, today);
  const serie = streak ? `Serie: ${streak} ${streak === 1 ? 'Tag' : 'Tage'}` : 'Noch keine Serie';
  const due = dueCount(data.mistakes, today);
  return `Tagesrätsel: ${done ? 'heute gelöst ✓' : 'noch offen'} · ${serie}${data.daily.best ? ` (Bestwert ${data.daily.best})` : ''}${due ? ` · ${due} Fehler fällig` : ''}`;
}

// --- Schwächen-Profil ---
export function recordMotifs(motifs, themes, right) {
  const out = { ...motifs };
  for (const t of new Set(themes)) {
    const c = out[t] ?? { right: 0, wrong: 0 };
    out[t] = right ? { ...c, right: c.right + 1 } : { ...c, wrong: c.wrong + 1 };
  }
  return out;
}

// Themen mit genug Versuchen, schlechteste Quote zuerst: [{ theme, right, wrong, tries, percent }].
// only = Themen, die in Frage kommen (Standard: die im Rätsel-Panel wählbaren)
export function weaknesses(motifs, { min = MIN_TRIES, only = PICKABLE } = {}) {
  return only
    .map((theme) => ({ theme, ...(motifs[theme] ?? { right: 0, wrong: 0 }) }))
    .map((c) => ({ ...c, tries: c.right + c.wrong, percent: c.right + c.wrong ? Math.round((100 * c.right) / (c.right + c.wrong)) : 0 }))
    .filter((c) => c.tries >= min)
    .sort((a, b) => a.right / a.tries - b.right / b.tries || b.tries - a.tries);
}

// „Gezielt üben“: Thema mit der schlechtesten Quote – oder null (noch kein Thema mit genug Versuchen)
export const focusTheme = (motifs) => weaknesses(motifs)[0]?.theme ?? null;

// --- Meine Fehler (Wiederholen mit Abstand) ---
const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' '); // ohne Zugzähler: gleiche Stellung = gleicher Fehler
const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const sanOf = (fen, uci) => {
  try {
    return new Chess(fen).move(parse(uci)).san;
  } catch {
    return null;
  }
};

// Fehler aus einer Partie. view = analysis.view(meine Farbe, false) – nur meine Züge sind eingestuft,
// coachView = analysis.coachView (Stellung davor, Stockfishs beste Variante, zweitbester Zug).
// Liefert neue Einträge (Stellung vor dem Zug, Lösung = bester Zug). Noch nicht gerechnete Züge fehlen einfach.
export function collectMistakes(view, coachView, moves, today) {
  const out = [];
  view.verdicts.forEach((kind, i) => {
    if (!MISTAKE_KINDS.has(kind)) return;
    const cv = coachView(i);
    if (!cv?.better?.length || cv.fenBefore.split(' ')[1] !== view.mine) return; // nur eigene Züge
    const best = cv.better[0];
    if (best === moves[i]) return; // sollte bei Fehler/Patzer nicht vorkommen
    const second = cv.second;
    const also = second && second.uci !== best && second.uci !== moves[i] && expected(cv.best) - expected(second.score) <= ALSO_OK ? [second.uci] : [];
    out.push({
      id: `${fenKey(cv.fenBefore)} ${best}`,
      fen: cv.fenBefore,
      best,
      also,
      due: today,
      step: 0,
      src: 'partie',
      kind,
      played: sanOf(cv.fenBefore, moves[i]),
      date: today,
    });
  });
  return out;
}

// Verpasstes Rätsel (Rätsel lösen, Tagesrätsel) für die Wiederholung: Stellung nach dem Zug des Gegners, Lösung =
// erster Lösungszug; puzzle = Kennung, damit es später als ganzes Rätsel wiederkommt
export function puzzleMistake(p, today) {
  const chess = new Chess(p.fen);
  chess.move(parse(p.line[0]));
  return { id: `lichess ${p.id}`, fen: chess.fen(), best: p.line[1], theme: p.themes[0], due: today, step: 0, src: 'raetsel', puzzle: p.id, date: today };
}

// Neue Fehler dazu – schon vorhandene (gleiche Kennung) bleiben, wie sie sind; zu viele → die ältesten fallen raus
export function addMistakes(list, entries) {
  const have = new Set(list.map((m) => m.id));
  const added = entries.filter((m) => !have.has(m.id) && have.add(m.id));
  return [...list, ...added].slice(-MAX_MISTAKES);
}

// Antwort auf einen gespeicherten Fehler: richtig → nächster Abstand (1, 3, 7 Tage), nach dem letzten erledigt (null);
// falsch → wieder ab vorn, morgen nochmal. Noch nicht fällig und richtig → bleibt, wie er ist (nur geübt).
export function reviewMistake(m, right, today) {
  if (!right) return { ...m, step: 0, due: addDays(today, INTERVALS[0]) };
  if (m.due > today) return m;
  if (m.step >= INTERVALS.length) return null;
  return { ...m, step: m.step + 1, due: addDays(today, INTERVALS[m.step]) };
}

export const dueCount = (list, today) => list.filter((m) => m.due <= today).length;

// Reihenfolge zum Üben: fällige zuerst (älteste zuerst), danach die übrigen nach Fälligkeit
export const mistakeQueue = (list, today) => list.map((m, i) => ({ m, i })).sort((a, b) => (a.m.due > b.m.due) - (a.m.due < b.m.due) || a.i - b.i).map(({ m }) => m);

// Gespeicherter Fehler → Rätsel für raetsel.js. Aus einer Partie: ein Zug, kein Vorzug des Gegners (lead 0);
// aus einem Lichess-Rätsel (row = Datenzeile, falls noch da): das ganze Rätsel wie gewohnt (lead 1).
export function mistakePuzzle(m, row = null) {
  if (row) return { id: row[0], fen: row[1], line: row[2].split(' '), rating: row[3], themes: row[4] ? row[4].split(' ') : [], color: row[1].split(' ')[1] === 'w' ? 'b' : 'w', lead: 1, mistake: m };
  return { id: m.id, fen: m.fen, line: [m.best], also: m.also ?? [], rating: null, themes: m.theme ? [m.theme] : [], color: m.fen.split(' ')[1], lead: 0, mistake: m };
}

// Zug richtig? Wie puzzle.js isRight, dazu beim ersten Zug eines Partie-Fehlers der fast gleich gute zweitbeste Zug
export const alsoRight = (p, k, uci) => k === 0 && !!p.also?.includes(uci);

// --- Rätsel-Sturm ---
export const stormTarget = (i) => STORM_START + i * STORM_STEP; // Wertung des i-ten Rätsels (0 = erstes)

// Sturm-Rätsel Nummer i: noch nicht gesehen, Wertung höchstens ±25 um das Ziel (die Fenster der Rätsel überlappen
// nicht – jedes ist mindestens so schwer wie das vorige); nichts da → Fenster wird breiter
export function stormPick(list, i, seen, random = Math.random) {
  const target = stormTarget(i);
  const fresh = list.filter((row) => !seen.has(row[0]));
  const from = fresh.length ? fresh : list;
  for (let width = STORM_STEP / 2; width < 4000; width += STORM_STEP / 2) {
    const near = from.filter((row) => Math.abs(row[3] - target) <= width);
    if (near.length) return near[Math.floor(random() * near.length)];
  }
  return null;
}
export const stormStart = (now) => ({ start: now, score: 0, errors: 0, index: 0, over: false });

// Ein Rätsel des Sturms ist fertig (richtig gelöst oder Fehlzug) – nach 3 Fehlern ist Schluss
export function stormStep(storm, right) {
  const errors = storm.errors + (right ? 0 : 1);
  return { ...storm, score: storm.score + (right ? 1 : 0), errors, index: storm.index + 1, over: errors >= STORM_LIVES };
}

export const stormLeft = (storm, now) => Math.max(0, STORM_MS - (now - storm.start)); // Restzeit in ms

// Sturm vorbei: Rekord und Anzahl merken
export const stormEnd = (rec, score) => ({ best: Math.max(rec.best, score), runs: rec.runs + 1 });

// --- Erfolge (eigene, schlichte Abzeichen) ---
export const ACHIEVEMENTS = [
  { id: 'tag1', label: 'Erstes Tagesrätsel', symbol: '☀', test: (d) => d.daily.solved.length >= 1 },
  { id: 'serie3', label: '3 Tage in Folge', symbol: '☀3', test: (d) => d.daily.best >= 3 },
  { id: 'serie7', label: '7-Tage-Serie', symbol: '☀7', test: (d) => d.daily.best >= 7 },
  { id: 'serie30', label: '30-Tage-Serie', symbol: '☀30', test: (d) => d.daily.best >= 30 },
  { id: 'r10', label: '10 Rätsel gelöst', symbol: '10', test: (d) => (d.solved ?? 0) >= 10 },
  { id: 'r100', label: '100 Rätsel gelöst', symbol: '100', test: (d) => (d.solved ?? 0) >= 100 },
  { id: 'r500', label: '500 Rätsel gelöst', symbol: '500', test: (d) => (d.solved ?? 0) >= 500 },
  { id: 'sturm10', label: 'Sturm 10+', symbol: '⚡10', test: (d) => d.storm.best >= 10 },
  { id: 'sturm20', label: 'Sturm 20+', symbol: '⚡20', test: (d) => d.storm.best >= 20 },
  { id: 'fehler1', label: 'Ersten eigenen Fehler bereinigt', symbol: '✓', test: (d) => d.cleared >= 1 },
  { id: 'fehler10', label: '10 eigene Fehler bereinigt', symbol: '✓10', test: (d) => d.cleared >= 10 },
];

export const earned = (data) => ACHIEVEMENTS.filter((a) => a.test(data)).map((a) => a.id);

// Neu dazugekommene Erfolge zwischen zwei Ständen (für die Meldung)
export const newAchievements = (before, after) => {
  const had = new Set(earned(before));
  return ACHIEVEMENTS.filter((a) => a.test(after) && !had.has(a.id));
};

// --- „Drohung zeigen“: Nullzug ---
// Gleiche Stellung, aber die andere Seite ist am Zug: en passant gilt nicht mehr (das Recht hätte nur der jetzt
// Ziehende gehabt), Halbzugzähler +1, nach Schwarz beginnt ein neuer Zug. Wer gerade im Schach steht, kann nicht
// „aussetzen“ (der König wäre schlagbar) → null.
export function nullMoveFen(fen) {
  if (new Chess(fen).inCheck()) return null;
  const part = fen.split(' ');
  const black = part[1] === 'b';
  part[1] = black ? 'w' : 'b';
  part[3] = '-';
  part[4] = String(Number(part[4] ?? 0) + 1);
  part[5] = String(Number(part[5] ?? 1) + (black ? 1 : 0));
  return part.join(' ');
}
