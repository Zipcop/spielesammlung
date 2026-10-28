// Erzeugt src/schach/schule/kapitel.json – die Übungen des Lernpfads der Schach-Schule – aus der Lichess-Rätseldatenbank
// (database.lichess.org, Lizenz CC0 – frei verwendbar). Aufruf (braucht Internet, lädt ca. 9 MB): node scripts/schule-raetsel.mjs
// Wie scripts/puzzles.mjs: nur der erste zstd-Block der Datei (ca. 180.000 Rätsel, zufällige Stichprobe). Je Kapitel
// (lernpfad.js, pick) PER_CHAPTER gut geprüfte, leichte Rätsel (Wertung MIN–MAX, höchstens drei eigene Züge),
// gleichmäßig über die Wertung verteilt; dazu für Kapitel mit example: 'auto' ein weiteres leichtes als Beispielstellung.
// Ausgabe: { chapters: { id: [[Kennung, FEN, Züge, Wertung, Themen], …] }, examples: { id: [ … ] } }
import { writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { Chess } from 'chess.js';
import { CHAPTERS, PER_CHAPTER } from '../src/schach/schule/lernpfad.js';

const SOURCE = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const MIN = 500; // leicht …
const MAX = 1500; // … bis mittel
const MAX_PLIES = 6; // Gegnerzug + höchstens drei eigene Züge
const MIN_PLAYS = 300; // oft genug gespielt …
const MAX_DEVIATION = 85; // … dass die Wertung sicher ist
const MIN_POPULARITY = 80; // von den Spielern gut bewertet (−100 bis 100)

const range = async (from, to) => Buffer.from(await (await fetch(SOURCE, { headers: { Range: `bytes=${from}-${to}` } })).arrayBuffer());
const head = await range(0, 11);
if (head.readUInt32LE(0) !== 0x184d2a50) throw new Error('Unerwartetes Dateiformat');
const size = head.readUInt32LE(8);
const rows = zstdDecompressSync(await range(12, 11 + size)).toString().split('\n');
rows.pop(); // letzte Zeile des Blocks kann angeschnitten sein (oder ist leer)
const columns = rows.shift().split(',');
const col = (name) => columns.indexOf(name);

const pool = [];
for (const row of rows) {
  const f = row.split(',');
  const [rating, deviation, popularity, plays] = ['Rating', 'RatingDeviation', 'Popularity', 'NbPlays'].map((c) => Number(f[col(c)]));
  if (!(plays >= MIN_PLAYS && deviation <= MAX_DEVIATION && popularity >= MIN_POPULARITY && rating >= MIN && rating <= MAX)) continue;
  const moves = f[col('Moves')].split(' ');
  if (moves.length > MAX_PLIES) continue;
  const chess = new Chess(f[col('FEN')]);
  chess.move({ from: moves[0].slice(0, 2), to: moves[0].slice(2, 4), promotion: moves[0][4] });
  const piece = chess.get(moves[1].slice(0, 2))?.type; // Figur des ersten eigenen Zugs
  pool.push({ id: f[col('PuzzleId')], fen: f[col('FEN')], moves: f[col('Moves')], rating, themes: f[col('Themes')].split(' '), piece });
}

const used = new Set(); // jedes Rätsel nur in einem Kapitel
const out = { chapters: {}, examples: {} };
for (const c of CHAPTERS) {
  const fits = pool.filter((r) => c.pick(r) && !used.has(r.id)).sort((a, b) => a.rating - b.rating);
  if (fits.length < PER_CHAPTER + 1) throw new Error(`${c.id}: nur ${fits.length} Rätsel`);
  // gleichmäßig über die Wertung verteilt, leichte zuerst
  const chosen = Array.from({ length: PER_CHAPTER }, (_, k) => fits[Math.round((k * (fits.length - 2)) / (PER_CHAPTER - 1)) + 1]);
  if (c.example === 'auto') chosen.unshift(fits[0]); // das leichteste wird die Beispielstellung
  for (const r of chosen) used.add(r.id);
  const row = (r) => [r.id, r.fen, r.moves, r.rating, r.themes.join(' ')];
  if (c.example === 'auto') out.examples[c.id] = row(chosen.shift());
  out.chapters[c.id] = chosen.map(row);
  console.log(c.id.padEnd(14), String(fits.length).padStart(5), 'passend, Wertung', chosen.map((r) => r.rating).join(' '));
}

writeFileSync(new URL('../src/schach/schule/kapitel.json', import.meta.url), JSON.stringify(out));
console.log(rows.length, 'Rätsel gelesen');
