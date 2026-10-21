// Computer für Schiffe versenken: sieht nur seine Sicht (viewFor) – eigene Schüsse mit den Antworten (Wasser, Treffer mit
// Schiffsname, versenkt). Stufen: Leicht schießt blind, Mittel jagt nach einem Treffer die Nachbarfelder ab (in der Linie,
// sobald zwei Treffer liegen), Stark rechnet für jedes Feld aus, wie viele Lagen der übrigen Schiffe dort hindurchgehen
// (Wahrscheinlichkeitskarte) – mit Treffern nur für die angeschossenen Schiffe.
import { N, FLEET, cellsOf, fits } from './game.js';

export const LEVELS = [
  { name: 'Leicht' },
  { name: 'Mittel' },
  { name: 'Stark' },
];

const key = (x, y) => y * N + x;
const pick = (list, rng) => list[Math.floor(rng() * list.length)];
const NEXT = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Was p über die Flotte des anderen weiß: cell[key] = undefined (offen), -1 (Wasser) oder Schiffsnummer (Treffer)
function knowledge(v, p) {
  const cell = new Map();
  const sunk = new Set();
  for (const t of v.shots[p]) {
    if (t.res === null) continue; // Antwort steht noch aus
    cell.set(key(t.x, t.y), t.res === 'wasser' ? -1 : t.ship);
    if (t.res === 'versenkt') sunk.add(t.ship);
  }
  const shot = new Set(v.shots[p].map((t) => key(t.x, t.y)));
  return { cell, sunk, shot };
}

const openCells = (k) => {
  const out = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!k.shot.has(key(x, y))) out.push([x, y]);
  return out;
};

// Treffer auf Schiffe, die noch schwimmen: { schiff: [[x, y], …] }
function wounded(k) {
  const out = new Map();
  for (const [c, ship] of k.cell) {
    if (ship < 0 || k.sunk.has(ship)) continue;
    if (!out.has(ship)) out.set(ship, []);
    out.get(ship).push([c % N, Math.floor(c / N)]);
  }
  return out;
}

// Mittel: Nachbarn der Treffer – liegen zwei auf einer Linie, nur die Enden der Linie
function hunt(k) {
  const out = [];
  for (const hits of wounded(k).values()) {
    const line = hits.length > 1 && (hits.every(([, y]) => y === hits[0][1]) ? [[1, 0], [-1, 0]] : hits.every(([x]) => x === hits[0][0]) ? [[0, 1], [0, -1]] : null);
    for (const [x, y] of hits) {
      for (const [dx, dy] of line || NEXT) {
        const [a, b] = [x + dx, y + dy];
        if (a >= 0 && a < N && b >= 0 && b < N && !k.shot.has(key(a, b))) out.push([a, b]);
      }
    }
  }
  return out;
}

// Stark: Zahl der möglichen Lagen je offenem Feld
function density(k) {
  const hurt = wounded(k);
  const ships = hurt.size ? [...hurt.keys()] : [...FLEET.keys()].filter((s) => !k.sunk.has(s));
  const count = new Map();
  for (const s of ships) {
    const hits = hurt.get(s) ?? [];
    for (const dir of ['h', 'v']) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const ship = { x, y, dir };
          if (!fits(ship, s)) continue;
          const cells = cellsOf(ship, s).map(([a, b]) => key(a, b));
          // kein Wasser, kein Treffer eines anderen Schiffs, alle eigenen Treffer drin
          if (cells.some((c) => k.cell.has(c) && k.cell.get(c) !== s)) continue;
          if (!hits.every(([a, b]) => cells.includes(key(a, b)))) continue;
          for (const c of cells) if (!k.shot.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
        }
      }
    }
  }
  return count;
}

// Nächster Schuss für p in Sicht v → { x, y } · rng zum Testen austauschbar
export function chooseShot(v, p, level = 1, rng = Math.random) {
  const k = knowledge(v, p);
  const open = openCells(k);
  if (level >= 2) {
    const count = density(k);
    const top = Math.max(0, ...count.values());
    const best = top ? [...count].filter(([, n]) => n === top).map(([c]) => [c % N, Math.floor(c / N)]) : open;
    const [x, y] = pick(best, rng);
    return { x, y };
  }
  const near = level === 1 ? hunt(k) : [];
  const [x, y] = pick(near.length ? near : open, rng);
  return { x, y };
}
