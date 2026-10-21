// Computer für Memory (src/memory/ai.js): sieht nur seine Sicht, merkt sich je nach Stufe, spielt Partien zu Ende.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, setup, flip, viewFor, peek } from '../src/memory/game.js';
import { LEVELS, remember, fade, chooseFlip, known, peekTarget } from '../src/memory/ai.js';

const seeded = (n = 1) => () => ((n = (n * 16807) % 2147483647) / 2147483647);

// Partie Computer gegen Computer bis zum Ende; levels = Stufe je Spieler. Gibt den Endstand und die Zahl der Züge zurück.
function duel(levels, { size = 18, seed = 1, free = false } = {}) {
  const rng = seeded(seed);
  let s = setup(newGame({ free }), 0, { size, set: 'tiere' }, rng);
  const mem = [new Map(), new Map()];
  let steps = 0;
  let turn = null;
  while (s.phase === 'play' && steps < 2000) {
    const p = s.turn;
    if (p !== turn) {
      mem[p] = fade(mem[p], levels[p], rng);
      turn = p;
    }
    const v = viewFor(s, p);
    // Gast-Sicht: verdeckte Motive gibt es dort nicht
    assert.ok(v.tiles.every((m, k) => m === null || s.owner[k] !== null || s.open.includes(k) || s.shown.includes(k)));
    const k = chooseFlip(v, mem[p], rng);
    const next = flip(s, p, k);
    assert.ok(next, `Zug ${steps}: ungültiges Kärtchen ${k}`);
    s = next;
    for (const q of [0, 1]) mem[q] = remember(mem[q], viewFor(s, q).events, levels[q], q, rng);
    steps++;
  }
  return { s, steps };
}

test('Computer gegen Computer: jede Partie geht ordentlich zu Ende', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const size of [12, 18, 24]) {
      const { s } = duel([seed % 3, (seed + 1) % 3], { size, seed });
      assert.equal(s.phase, 'over');
      assert.equal(s.result.pairs[0] + s.result.pairs[1], size);
      assert.ok(s.owner.every((o) => o !== null));
    }
  }
});

test('Stufen: wer sich mehr merkt, gewinnt öfter und braucht weniger Züge', () => {
  let strong = 0;
  let weak = 0;
  const moves = [0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const first = seed % 2; // abwechselnd fängt der Starke bzw. der Schwache an (Starter ist immer Spieler 0)
    const { s } = duel(first ? [2, 0] : [0, 2], { size: 18, seed });
    const w = s.result.winner;
    if (w === null) continue;
    if ((w === 0) === !!first) strong++;
    else weak++;
  }
  assert.ok(strong > weak * 2, `Fast perfekt ${strong} : Vergesslich ${weak}`);
  for (const lvl of [0, 2]) {
    for (let seed = 1; seed <= 40; seed++) moves[lvl ? 1 : 0] += duel([lvl, lvl], { size: 18, seed }).steps;
  }
  assert.ok(moves[1] < moves[0], `Züge Fast perfekt ${moves[1]} < Vergesslich ${moves[0]}`);
});

test('Gedächtnis: merkt Aufgedecktes, vergisst Eingestecktes; deckt ein bekanntes Paar auf', () => {
  const always = () => 0;
  let mem = remember(new Map(), [{ type: 'flip', by: 0, i: 3, motif: 7 }, { type: 'flip', by: 0, i: 9, motif: 2 }], 2, 1, always);
  assert.deepEqual([...mem], [[3, 7], [9, 2]]);
  mem = remember(mem, [{ type: 'pair', by: 0, tiles: [9, 11] }], 2, 1, always);
  assert.deepEqual([...mem], [[3, 7]]);
  assert.equal(fade(mem, 0, () => 0.1).size, 0, 'Vergesslich: rng 0,1 < 0,3 → weg');
  assert.equal(fade(mem, 2, () => 0.1).size, 1);

  // Stand: Computer (1) ist dran und kennt Platz 3 (Motiv 7) – das zweite 7 sucht er sich gleich
  let s = setup(newGame(), 0, { size: 12, set: 'formen' }, seeded(5));
  const sevens = s.tiles.flatMap((m, k) => (m === 7 ? [k] : []));
  s = { ...s, turn: 1 };
  const v = viewFor(s, 1);
  const pairMem = new Map([[sevens[0], 7], [sevens[1], 7]]);
  assert.ok(sevens.includes(chooseFlip(v, pairMem, seeded())));
  // erstes Kärtchen offen, das passende gemerkt
  const s2 = flip(s, 1, sevens[0]);
  assert.equal(chooseFlip(viewFor(s2, 1), new Map([[sevens[1], 7]]), seeded()), sevens[1]);
  // ohne Gedächtnis: nie ein schon bekanntes, nicht passendes Kärtchen
  const other = s.tiles.findIndex((m) => m !== 7);
  for (let n = 1; n < 30; n++) assert.notEqual(chooseFlip(viewFor(s2, 1), new Map([[other, s.tiles[other]]]), seeded(n)), other);
  assert.equal(known(viewFor(s2, 1), new Map()).get(sevens[0]), 7, 'offen = bekannt');
});

test('Ohne Hilfen: Linsen-Ziel nur, wenn das passende unbekannt ist – danach weiß er es sicher', () => {
  let s = setup(newGame({ free: true }), 0, { size: 12, set: 'tiere' }, seeded(9));
  s = { ...s, turn: 1 };
  const first = 0;
  s = flip(s, 1, first);
  const k = peekTarget(viewFor(s, 1), new Map(), seeded());
  assert.ok(Number.isInteger(k) && k !== first);
  const p = peek(s, 1, k);
  const mem = remember(new Map(), viewFor(p, 1).events, 0, 1, () => 0.99); // Vergesslich, Würfel sagt „nicht gemerkt“ – gelinst zählt trotzdem
  assert.equal(mem.get(k), s.tiles[k]);
  const match = s.tiles.findIndex((m, x) => x !== first && m === s.tiles[first]);
  assert.equal(peekTarget(viewFor(s, 1), new Map([[match, s.tiles[first]]]), seeded()), null);
  assert.equal(LEVELS.length, 3);
});
