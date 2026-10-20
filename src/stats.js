// Statistik zu zweit: wer wie oft gewonnen hat – je Spiel und je Paar (Spielernamen). Nur Partien übers Netz.
// Gespeichert als Liste von Ergebnissen in localStorage (dauerhaft) und sessionStorage („Heute“, bis der Tab zu ist).
// Der Host meldet jedes Ergebnis an den Gast; beim Verbinden tauschen beide ihre Liste für das Paar aus (merge) –
// so stehen auf beiden PCs dieselben Zahlen, auch wenn mal eine Meldung verloren ging.
// Ergebnis: { id, game, at (Ende der Partie), v (letzte Änderung), a, b (Namen, a < b), w (Sieger-Name, '' = Remis, null = gilt nicht) }
// Gleiche id (im selben Paar) = dieselbe Runde: die neuere Fassung (v) gewinnt – so lassen sich Ergebnisse berichtigen
// (z. B. nach „Geschummelt!“). Zurücksetzen = eine Marke je Paar (game RESET, at = Zeitpunkt): Älteres des Paars fällt weg.
// Rein (kein DOM), damit es sich mit node --test prüfen lässt.
import { cleanName } from './settings.js';

const KEY = 'spielesammlung-statistik';
const MAX = 10000; // höchstens so viele Ergebnisse – die ältesten fallen weg
const DAY = 86400000;
export const RESET = '*'; // game der Rücksetz-Marke
const keyOf = (e) => `${e.id}
${e.a}
${e.b}`;

// „Heute“: dieselbe Liste in sessionStorage – bleibt beim Neuladen, ist weg, wenn der Tab zu ist.
// Zugriff erst beim Aufruf, damit ein gesperrter Speicher im try von loadStats/mergeStats landet.
export const today = { getItem: (k) => sessionStorage.getItem(k), setItem: (k, v) => sessionStorage.setItem(k, v) };

const text = (x) => typeof x === 'string' && x.length > 0 && x.length <= 40;

// Fremdes oder kaputtes fällt weg; Namen wie beim Empfang gesäubert
function clean(e) {
  if (!e || typeof e !== 'object' || !text(e.id) || !text(e.game) || !Number.isFinite(e.at) || !Number.isFinite(e.v)) return null;
  if (Math.max(e.at, e.v) > Date.now() + DAY) return null; // aus der Zukunft – ließe sich sonst nie berichtigen oder zurücksetzen
  const [a, b] = [cleanName(e.a), cleanName(e.b)];
  if (!a || !b || a >= b) return null;
  if (e.w !== null && e.w !== '' && cleanName(e.w) !== a && cleanName(e.w) !== b) return null;
  return { id: e.id, game: e.game, at: e.at, v: e.v, a, b, w: e.w === null || e.w === '' ? e.w : cleanName(e.w) };
}

export function loadStats(storage) {
  try {
    storage ??= localStorage;
    const all = JSON.parse(storage.getItem(KEY));
    return Array.isArray(all) ? all.map(clean).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Ergebnisse dazunehmen (eigene oder vom anderen PC) – gibt die neue Liste zurück
export function mergeStats(entries, storage) {
  try {
    storage ??= localStorage;
    const byKey = new Map(loadStats(storage).map((e) => [keyOf(e), e]));
    for (const e of (Array.isArray(entries) ? entries : []).slice(0, MAX).map(clean).filter(Boolean)) {
      const k = keyOf(e);
      if (!byKey.has(k) || byKey.get(k).v < e.v) byKey.set(k, e);
    }
    const reset = new Map([...byKey.values()].filter((e) => e.game === RESET).map((e) => [`${e.a}
${e.b}`, e.at]));
    const kept = (e) => e.game === RESET || !(e.at <= reset.get(`${e.a}
${e.b}`)); // vor dem Zurücksetzen gespielt → weg
    const all = [...byKey.values()].filter(kept).sort((x, y) => x.at - y.at).slice(-MAX);
    storage.setItem(KEY, JSON.stringify(all));
    return all;
  } catch {
    return []; // ohne Speicher gibt es eben keine Statistik
  }
}

// Paar in fester Reihenfolge – gleiche Namen (oder unbekannter Mitspieler) zählen nicht
export function pairOf(x, y) {
  const [a, b] = [cleanName(x), cleanName(y)];
  return a && b && a !== b ? (a < b ? [a, b] : [b, a]) : null;
}

// Neues Ergebnis: winner = Name des Siegers, '' = Remis, null = gilt nicht (zurückgenommen oder zurückgesetzt)
export function entry({ id, game, me, other, winner, at, now = Date.now() }) {
  const pair = pairOf(me, other);
  return pair && { id, game, at: at ?? now, v: now, a: pair[0], b: pair[1], w: winner };
}

// Zurücksetzen: alles, was das Paar bis jetzt gespielt hat, fällt weg – die Marke geht beim Abgleich zum anderen PC
// und gilt dort auch für Ergebnisse, die hier nie angekommen sind
export function resetPair(a, b, storage, now = Date.now()) {
  return mergeStats([{ id: 'reset', game: RESET, at: now, v: now, a, b, w: null }], storage);
}

// Ergebnisse eines Paars (für den Austausch beim Verbinden)
export const ofPair = (entries, [a, b]) => entries.filter((e) => e.a === a && e.b === b);

// Zählung je Spiel für ein Paar: { [Spiel]: { wins: { [Name]: n }, draws, last } } – last = Zeitpunkt der letzten Partie
export function tally(entries, [a, b]) {
  const out = {};
  for (const e of ofPair(entries, [a, b])) {
    if (e.w === null || e.game === RESET) continue;
    const t = (out[e.game] ??= { wins: { [a]: 0, [b]: 0 }, draws: 0, last: 0 });
    if (e.w === '') t.draws++;
    else t.wins[e.w]++;
    t.last = Math.max(t.last, e.at);
  }
  return out;
}

// Alle Paare, die schon gespielt haben – das mit dem eigenen Namen zuerst, dann das zuletzt gespielte
export function pairs(entries, me) {
  const last = new Map();
  for (const e of entries) {
    if (e.w === null || e.game === RESET) continue;
    const key = `${e.a}\n${e.b}`;
    last.set(key, Math.max(last.get(key) ?? 0, e.at));
  }
  const mine = (key) => key.split('\n').includes(me);
  return [...last.keys()].sort((x, y) => mine(y) - mine(x) || last.get(y) - last.get(x)).map((key) => key.split('\n'));
}

// Runden einer Partie aus den Spielständen des Hosts verfolgen. outcome = Ergebnis des Stands:
// undefined = läuft noch, 0 = Host gewinnt, 1 = Gast gewinnt, null = Remis.
// track = { id, w }: id der aktuellen Runde (null = noch keine), w = schon gemeldetes Ergebnis (undefined = keins).
// Gibt den neuen track zurück, dazu report: zu meldendes Ergebnis (0/1/null) oder 'void' (Runde geht doch weiter).
// reverted = der Stand kam von einem erwischten Schummelzug – das Spielende ist zurückgenommen, die Runde läuft weiter.
// Sonst heißt „läuft wieder“ nach einem Ende: neue Runde („Nochmal“), das alte Ergebnis bleibt.
export function step({ id, w }, outcome, reverted, newId) {
  const track = { id, w }; // ohne alten report
  if (outcome !== undefined) {
    if (outcome === track.w) return track;
    return { id: track.id ?? newId(), w: outcome, report: outcome };
  }
  if (track.w === undefined) return track;
  return reverted ? { id: track.id, w: undefined, report: 'void' } : { id: null, w: undefined };
}
