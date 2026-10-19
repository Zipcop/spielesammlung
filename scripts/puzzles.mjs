// Erzeugt src/schach/puzzles.json aus der Lichess-Rätseldatenbank (database.lichess.org, Lizenz CC0 –
// frei verwendbar). Aufruf (braucht Internet, lädt ca. 9 MB): node scripts/puzzles.mjs
// Die Datei (gut 300 MB) ist im pzstd-Format: vor jedem zstd-Block steht ein „skippable frame“ mit dessen Länge.
// Wir laden nur den ersten Block (ca. 180.000 Rätsel; nach Kennung sortiert, die Kennungen sind zufällig –
// also eine zufällige Stichprobe) und ziehen daraus je Thema und Wertungsbereich gleich viele gut geprüfte Rätsel.
// Ausgabe: [[Kennung, FEN, Züge, Wertung, Themen], …] – nur Themen, die wir anzeigen (THEMES in puzzle.js).
import { writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { THEMES, PICKABLE } from '../src/schach/puzzle.js';

const SOURCE = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const PER_BUCKET = 34; // je Thema und 200er-Wertungsbereich
const BANDS = 12; // 400–2800
const MIN_PLAYS = 300; // oft genug gespielt …
const MAX_DEVIATION = 80; // … dass die Wertung sicher ist
const MIN_POPULARITY = 80; // von den Spielern gut bewertet (−100 bis 100)

const range = async (from, to) => Buffer.from(await (await fetch(SOURCE, { headers: { Range: `bytes=${from}-${to}` } })).arrayBuffer());
const head = await range(0, 11);
if (head.readUInt32LE(0) !== 0x184d2a50) throw new Error('Unerwartetes Dateiformat');
const size = head.readUInt32LE(8);
const rows = zstdDecompressSync(await range(12, 11 + size)).toString().split('\n');
rows.pop(); // letzte Zeile des Blocks kann angeschnitten sein (oder ist leer)
const columns = rows.shift().split(',');
const col = (name) => columns.indexOf(name);

const filled = new Map(); // "Thema Bereich" → Anzahl
const out = [];
for (const row of rows) {
  const f = row.split(',');
  const [rating, deviation, popularity, plays] = ['Rating', 'RatingDeviation', 'Popularity', 'NbPlays'].map((c) => Number(f[col(c)]));
  if (!(plays >= MIN_PLAYS && deviation <= MAX_DEVIATION && popularity >= MIN_POPULARITY)) continue; // so fällt auch NaN heraus
  const themes = f[col('Themes')].split(' ');
  const band = Math.min(BANDS - 1, Math.max(0, Math.floor((rating - 400) / 200)));
  const buckets = themes.filter((t) => PICKABLE.includes(t)).map((t) => `${t} ${band}`);
  if (!buckets.some((b) => (filled.get(b) ?? 0) < PER_BUCKET)) continue;
  for (const b of buckets) filled.set(b, (filled.get(b) ?? 0) + 1);
  out.push([f[col('PuzzleId')], f[col('FEN')], f[col('Moves')], rating, themes.filter((t) => t in THEMES).join(' ')]);
}

writeFileSync(new URL('../src/schach/puzzles.json', import.meta.url), JSON.stringify(out));
console.log(rows.length, 'Rätsel gelesen,', out.length, 'übernommen');
for (const t of PICKABLE) console.log(t.padEnd(18), Array.from({ length: BANDS }, (_, b) => String(filled.get(`${t} ${b}`) ?? 0).padStart(3)).join(''));
