// Erzeugt src/schach/openings.json aus der Lichess-Eröffnungsliste (github.com/lichess-org/chess-openings,
// Lizenz CC0 – frei verwendbar). Aufruf (braucht Internet): node scripts/openings.mjs
// Inhalt: Stellung (Figuren + Seite am Zug) → Name. Auch Zwischenstellungen einer Eröffnung zählen als
// Buch; sie bekommen den Namen nur, wenn die Liste sie selbst als Eröffnung führt (sonst '').
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const SOURCE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const book = {};

for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const rows = (await (await fetch(`${SOURCE}${file}.tsv`)).text()).trim().split('\n').slice(1);
  for (const row of rows) {
    const [, name, pgn] = row.split('\t');
    const chess = new Chess();
    for (const san of pgn.replace(/\d+\.\s*/g, '').trim().split(/\s+/)) {
      chess.move(san);
      const key = chess.fen().split(' ').slice(0, 2).join(' ');
      book[key] ??= '';
    }
    book[chess.fen().split(' ').slice(0, 2).join(' ')] = name;
  }
}

writeFileSync(new URL('../src/schach/openings.json', import.meta.url), JSON.stringify(book));
console.log(Object.keys(book).length, 'Stellungen');
