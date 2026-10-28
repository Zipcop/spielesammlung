// Schach-Schule, Koordinaten- und Blind-Training – reine Logik ohne Anzeige.
// Koordinaten: Ein Feld wird genannt, du klickst es an – ROUND_MS lang, getrennter Rekord für „Weiß unten“ und „Schwarz unten“.
// Blind: Ein paar Figuren stehen BLIND_SHOW_MS lang da, dann verschwinden sie; du beantwortest eine Frage dazu
// („Kann der Läufer auf c4 die Dame auf f7 schlagen?“). BLIND_ROUND Fragen je Runde.
// Eigene Festlegungen (zur Bestätigung): Fehlklick kostet nichts außer Zeit; im Koordinaten-Training sind die
// Buchstaben am 2D-Brett ausgeblendet.

export const ROUND_MS = 30000;
export const BLIND_SHOW_MS = 4000;
export const BLIND_ROUND = 10;
export const FILES = 'abcdefgh';
export const NAMES = { k: 'König', q: 'Dame', r: 'Turm', b: 'Läufer', n: 'Springer', p: 'Bauer' };
const ACC = { k: 'den König', q: 'die Dame', r: 'den Turm', b: 'den Läufer', n: 'den Springer', p: 'den Bauern' };
const COLOR = { w: 'weiße', b: 'schwarze' };

const squareOf = (f, r) => FILES[f] + (r + 1);
const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]) - 1;
export const ALL = Array.from({ length: 64 }, (_, i) => squareOf(i % 8, Math.floor(i / 8)));

// Zufälliges Feld, nicht dasselbe wie zuletzt
export function randomSquare(random = Math.random, not = null) {
  for (;;) {
    const sq = ALL[Math.floor(random() * 64)];
    if (sq !== not) return sq;
  }
}

// Rekord je Farbe: records = { w, b } → neue records und ob es ein neuer Rekord ist
export function recordRound(records, color, score) {
  const old = records?.[color] ?? 0;
  return { records: { ...records, [color]: Math.max(old, score) }, best: score > old };
}

const STEPS = { n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]], k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] };
const RAYS = { r: [[1, 0], [-1, 0], [0, 1], [0, -1]], b: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
RAYS.q = [...RAYS.r, ...RAYS.b];

// Greift die Figur auf from das Feld to an? pieces = [{ square, color, type }] – andere Figuren versperren den Weg
export function attacks(pieces, from, to) {
  const p = pieces.find((x) => x.square === from);
  if (!p || from === to) return false;
  const [f, r] = [fileOf(from), rankOf(from)];
  const [tf, tr] = [fileOf(to), rankOf(to)];
  if (p.type === 'p') return tr - r === (p.color === 'w' ? 1 : -1) && Math.abs(tf - f) === 1;
  if (STEPS[p.type]) return STEPS[p.type].some(([df, dr]) => f + df === tf && r + dr === tr);
  const taken = new Set(pieces.map((x) => x.square));
  for (const [df, dr] of RAYS[p.type]) {
    for (let x = f + df, y = r + dr; x >= 0 && x < 8 && y >= 0 && y < 8; x += df, y += dr) {
      const sq = squareOf(x, y);
      if (sq === to) return true;
      if (taken.has(sq)) break;
    }
  }
  return false;
}

// Felder, die eine Figur auf leerem Brett angreift
const reach = (piece) => ALL.filter((sq) => attacks([piece], piece.square, sq));

// Blind-Aufgabe: { pieces, from, to, question, answer } – Antwort etwa zur Hälfte „Ja“
export function blindTask(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const color = random() < 0.5 ? 'w' : 'b';
  const other = color === 'w' ? 'b' : 'w';
  const type = pick(['q', 'r', 'b', 'n', 'n', 'b', 'r', 'p']);
  let from;
  do from = pick(ALL); while (type === 'p' && (from[1] === '1' || from[1] === '8'));
  const attacker = { square: from, color, type };
  const hits = reach(attacker);
  const wantYes = random() < 0.5;
  const free = ALL.filter((sq) => sq !== from);
  const to = wantYes ? pick(hits) : pick(free.filter((sq) => !hits.includes(sq)));
  const target = { square: to, color: other, type: pick(['q', 'r', 'b', 'n', 'p'].filter((t) => t !== 'p' || (to[1] !== '1' && to[1] !== '8'))) };
  const pieces = [attacker, target];
  const extra = 1 + Math.floor(random() * 3); // 1–3 weitere Figuren, die auch im Weg stehen können
  for (let i = 0; i < extra; i++) {
    const sq = pick(ALL.filter((s) => !pieces.some((x) => x.square === s)));
    const t = pick(['r', 'b', 'n', 'p', 'q'].filter((x) => x !== 'p' || (sq[1] !== '1' && sq[1] !== '8')));
    pieces.push({ square: sq, color: random() < 0.5 ? 'w' : 'b', type: t });
  }
  const question = `Kann ${type === 'q' ? 'die' : 'der'} ${COLOR[color]} ${NAMES[type]} auf ${from} ${ACC[target.type].replace(/^(den|die) /, `$1 ${COLOR[other]}${target.type === 'q' ? ' ' : 'n '}`)} auf ${to} schlagen?`;
  return { pieces, from, to, question, answer: attacks(pieces, from, to) };
}

// Figuren als FEN-Stellung (nur fürs Brett, ohne Könige – das Brett prüft keine Regeln)
export function fenOf(pieces) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = pieces.find((x) => x.square === squareOf(f, r));
      if (!p) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    rows.push(row + (empty || ''));
  }
  return `${rows.join('/')} w - - 0 1`;
}
