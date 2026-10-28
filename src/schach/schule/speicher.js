// Schach-Schule: Fortschritt auf diesem PC (localStorage) und die Fortschritts-Seite als reine Rechnung.
// Fremde Speicher (Schach-Rätsel, Lernstand des Tägliches-Rätsel-Teils, Elo) werden nur gelesen – und vorsichtig,
// denn sie können fehlen oder eine andere Form haben.
import { CHAPTERS, levelOf } from './lernpfad.js';
import { ENDGAMES } from './endspiele.js';
import { OPENINGS } from './eroeffnungen.js';
import { MASTER_GAMES } from './meister.js';

export const KEY = 'spielesammlung-schach-schule';
const RAETSEL = 'spielesammlung-schach-raetsel';
const LERNEN = 'spielesammlung-schach-lernen';

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const num = (x) => (Number.isFinite(x) ? x : 0);

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

// Einträge eines Teils: nur Objekte bzw. passende Werte, jeweils sauber gemacht
const each = (x, keep, fix = (v) => v) => Object.fromEntries(Object.entries(obj(x)).filter(([, v]) => keep(v)).map(([k, v]) => [k, fix(v)]));
const isObj = (v) => v === obj(v);

// Eigener Speicher – was nicht passt, fällt auf den Anfangswert zurück (auch innen: Sterne, Zähler, Punkte)
export function cleanSchule(saved) {
  const s = obj(saved);
  return {
    path: each(s.path, isObj, (v) => ({ ...v, stars: [1, 2, 3].includes(v.stars) ? v.stars : 0, runs: num(v.runs) })),
    endgames: each(s.endgames, (v) => v === true),
    openings: each(s.openings, isObj, (v) => ({ runs: num(v.runs), streak: num(v.streak), best: num(v.best), errors: num(v.errors), sure: v.sure === true })),
    coords: { w: num(obj(s.coords).w), b: num(obj(s.coords).b) },
    blind: num(s.blind),
    master: each(s.master, Number.isFinite),
  };
}

export const loadSchule = () => cleanSchule(read(KEY));

export function saveSchule(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher gilt der Fortschritt nur bis zum Neuladen
  }
}

export const loadOthers = () => ({ raetsel: read(RAETSEL), lernen: read(LERNEN) });

// Alles für die Fortschritts-Seite. schule = cleanSchule(…), raetsel / lernen = rohe fremde Speicher (oder null),
// elo = loadElo(), history = loadEloHistory()
export function summary({ schule, raetsel, lernen, elo, history }) {
  const r = obj(raetsel);
  const rating = (m) => (Number.isFinite(obj(r[m]).rating) ? { rating: r[m].rating, games: num(r[m].games), solved: num(r[m].solved) } : null);
  const daily = obj(obj(lernen).daily);
  const { level, toNext, stars } = levelOf(schule.path);
  return {
    elo: { rating: num(elo?.rating), games: num(elo?.games) },
    curve: (history ?? []).map((e) => e.rating),
    puzzles: { solve: rating('solve'), choose: rating('choose') },
    path: { level, toNext, stars, max: CHAPTERS.length * 3, done: CHAPTERS.filter((c) => schule.path[c.id]?.stars > 0).length, total: CHAPTERS.length },
    endgames: { done: ENDGAMES.filter((e) => schule.endgames[e.id]).length, total: ENDGAMES.length },
    openings: { sure: OPENINGS.filter((o) => schule.openings[o.id]?.sure).length, total: OPENINGS.length },
    coords: schule.coords,
    blind: schule.blind,
    master: { played: MASTER_GAMES.filter((g) => schule.master[g.id] !== undefined).length, total: MASTER_GAMES.length },
    daily: Number.isFinite(daily.streak) ? { streak: daily.streak, best: num(daily.best) } : null,
  };
}

// Kurve als SVG-Punkte in einem Kasten w × h (mit Rand pad). values = Elo-Zahlen der Reihe nach
export function curvePoints(values, w, h, pad = 4) {
  if (!values.length) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = values.length > 1 ? (w - 2 * pad) / (values.length - 1) : 0;
  return values.map((v, i) => `${Math.round((pad + i * step) * 10) / 10},${Math.round((h - pad - ((v - lo) / span) * (h - 2 * pad)) * 10) / 10}`).join(' ');
}
