// Memory (src/memory/game.js): Grundregeln nach Ravensburger, Sicht je Spieler und „Ohne Hilfen“ mit Schummeln.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, flip, pass, pocket, peek, accuse, waive, again, regroup, score, viewFor, pairsOf, left, SIZES, SETS, SET_KEYS,
} from '../src/memory/game.js';
import { rematchBlocked } from '../src/schummeln.js';

// fester Zufall, damit die Tests immer gleich mischen
const seeded = (n = 1) => () => ((n = (n * 16807) % 2147483647) / 2147483647);
const start = (opt = {}, size = 12) => setup(newGame(opt), 0, { size, set: 'tiere' }, seeded(7));
const where = (s, m) => s.tiles.flatMap((x, k) => (x === m && s.owner[k] === null ? [k] : []));
// zwei verschiedene verdeckte Plätze
function miss(s) {
  const a = s.tiles.findIndex((m, k) => s.owner[k] === null);
  const b = s.tiles.findIndex((m, k) => s.owner[k] === null && m !== s.tiles[a]);
  return [a, b];
}

test('Motiv-Sätze: je 24 verschiedene Namen', () => {
  for (const key of SET_KEYS) {
    assert.equal(SETS[key].items.length, 24, key);
    assert.equal(new Set(SETS[key].items).size, 24, key);
  }
});

test('Auswahl: nur der Host, nur erlaubte Größen und Motive', () => {
  const s = newGame();
  assert.equal(s.phase, 'setup');
  assert.equal(setup(s, 1, { size: 12, set: 'tiere' }), null);
  assert.equal(setup(s, 0, { size: 10, set: 'tiere' }), null);
  assert.equal(setup(s, 0, { size: 12, set: 'autos' }), null);
  for (const size of SIZES) {
    const d = setup(s, 0, { size, set: 'formen' }, seeded());
    assert.equal(d.phase, 'play');
    assert.equal(d.tiles.length, 2 * size);
    for (let m = 0; m < size; m++) assert.equal(d.tiles.filter((x) => x === m).length, 2);
    assert.equal(d.turn, 0);
    assert.equal(d.round, 1);
  }
});

test('Paar: behalten und nochmal; verschieden: bleiben offen, der andere ist dran', () => {
  let s = start();
  const [a, b] = where(s, 3);
  s = flip(s, 0, a);
  assert.deepEqual(s.open, [a]);
  assert.equal(s.turn, 0);
  s = flip(s, 0, b);
  assert.equal(s.owner[a], 0);
  assert.equal(s.owner[b], 0);
  assert.equal(pairsOf(s, 0), 1);
  assert.equal(s.turn, 0, 'nach einem Paar nochmal');
  assert.deepEqual(s.open, []);
  assert.deepEqual(s.events.map((e) => e.type), ['flip', 'pair']);

  const [c, d] = miss(s);
  s = flip(flip(s, 0, c), 0, d);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.shown, [c, d]);
  assert.deepEqual(s.open, []);
  assert.equal(s.owner[c], null);
  // der Nächste deckt auf: die beiden drehen sich um
  const e = s.tiles.findIndex((m, k) => s.owner[k] === null && k !== c && k !== d);
  const t = flip(s, 1, e);
  assert.deepEqual(t.shown, []);
  assert.deepEqual(t.events[0], { type: 'cover', tiles: [c, d] });
  // ein gerade gezeigtes Kärtchen darf er wieder aufdecken
  assert.ok(flip(s, 1, c));
});

test('ungültig: nicht dran, schon weg, schon offen, drittes Kärtchen', () => {
  let s = start();
  const [a, b] = where(s, 0);
  assert.equal(flip(s, 1, a), null);
  assert.equal(flip(s, 0, -1), null);
  assert.equal(flip(s, 0, 24), null);
  assert.equal(flip(s, 0, 1.5), null);
  s = flip(s, 0, a);
  assert.equal(flip(s, 0, a), null);
  s = flip(s, 0, b);
  assert.equal(flip(s, 0, a), null, 'eingesteckt');
  // normale Regeln: kein Weiter, Einstecken, Linsen
  assert.equal(pass(s, 0), null);
  assert.equal(pocket(s, 0), null);
  assert.equal(peek(s, 0, miss(s)[0]), null);
  assert.equal(accuse(s, 1), null);
});

test('Partie bis zum Ende: mehr Paare gewinnen, gleich viele = Remis', () => {
  // Host räumt alles ab
  let s = start();
  for (let m = 0; m < 12; m++) {
    const [a, b] = where(s, m);
    s = flip(flip(s, 0, a), 0, b);
  }
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.result, { winner: 0, pairs: [12, 0] });
  assert.deepEqual(score(s), [1, 0]);
  assert.equal(flip(s, 0, 0), null);
  // Host 6 Paare, Fehlgriff, Gast 6 Paare → 6 : 6
  let t = start();
  for (let m = 0; m < 12; m++) {
    const p = t.turn;
    const [a, b] = where(t, m);
    t = flip(flip(t, p, a), p, b);
    if (m === 5) {
      const [c, d] = miss(t);
      t = flip(flip(t, p, c), p, d);
    }
  }
  assert.deepEqual(t.result, { winner: null, pairs: [6, 6] });
  assert.equal(left(t), 0);
});

test('Revanche: der andere fängt an, Siege zählen weiter; Andere Größe nur Host', () => {
  let s = start({}, 12);
  for (let m = 0; m < 12; m++) {
    const [a, b] = where(s, m);
    s = flip(flip(s, 0, a), 0, b);
  }
  assert.equal(again(start(), 0), null, 'Partie läuft noch');
  const r = again(s, 1, seeded(3));
  assert.equal(r.phase, 'play');
  assert.equal(r.turn, 1);
  assert.equal(r.starter, 1);
  assert.deepEqual(r.wins, [1, 0]);
  assert.equal(r.round, 2);
  assert.equal(r.tiles.length, 24);
  assert.ok(r.seq > s.seq);
  assert.equal(regroup(s, 1), null);
  const g = regroup(s, 0);
  assert.equal(g.phase, 'setup');
  assert.deepEqual(g.wins, [1, 0]);
  const h = setup(g, 0, { size: 24, set: 'obst' }, seeded());
  assert.equal(h.tiles.length, 48);
  assert.equal(h.turn, 1, 'auch nach der Auswahl fängt der andere an');
  assert.equal(h.round, 2);
});

test('Sicht: verdeckte Motive kennt nur der Host-Stand', () => {
  let s = start();
  const v0 = viewFor(s, 1);
  assert.ok(v0.tiles.every((m) => m === null));
  const [a] = where(s, 5);
  s = flip(s, 0, a);
  const v = viewFor(s, 1);
  assert.equal(v.tiles[a], 5);
  assert.equal(v.tiles.filter((m) => m !== null).length, 1);
  assert.equal(JSON.stringify(v).includes('"prev"'), false);
});

test('Ohne Hilfen: Paar geht von selbst, nach zwei verschiedenen „Weiter“', () => {
  let s = start({ free: true });
  const [a, b] = where(s, 2);
  s = flip(flip(s, 0, a), 0, b);
  assert.equal(pairsOf(s, 0), 1);
  assert.equal(s.cheat.legal, true);
  const [c, d] = miss(s);
  s = flip(flip(s, 0, c), 0, d);
  assert.equal(s.turn, 0, 'wartet auf Weiter');
  assert.deepEqual(s.open, [c, d]);
  s = pass(s, 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.open, []);
  assert.deepEqual(s.shown, []);
  assert.deepEqual(s.events[0], { type: 'pass', by: 0, tiles: [c, d] });
  assert.equal(s.cheat.legal, true);
  // Fehlalarm: der Ankläger (noch ohne Paar) gibt nichts ab
  const f = accuse(s, 1);
  assert.equal(f.verdict.caught, false);
  assert.equal(f.verdict.player, 1);
  assert.equal(f.verdict.gift, null);
  assert.equal(f.turn, 1);
  assert.equal(accuse(f, 1), null, 'Frist ist zu');
});

test('Ohne Hilfen: drittes Kärtchen – erwischt, alles zurück, ein Paar an den Ankläger, der ist dran', () => {
  let s = start({ free: true });
  const [a, b] = where(s, 1);
  s = flip(flip(s, 0, a), 0, b); // ehrliches Paar
  const before = s;
  const [c, d] = miss(s);
  s = flip(flip(s, 0, c), 0, d);
  const partner = where(s, s.tiles[c]).find((k) => k !== c);
  s = flip(s, 0, partner); // drittes – passt zu c
  assert.equal(s.owner[c], 0);
  assert.equal(pairsOf(s, 0), 2);
  assert.equal(s.cheat.legal, false);
  assert.deepEqual(viewFor(s, 1).cheat, { player: 0 });
  assert.equal(accuse(s, 0), null, 'nicht gegen sich selbst');
  const t = accuse(s, 1);
  assert.equal(t.verdict.caught, true);
  assert.equal(t.verdict.why, 'ein drittes Kärtchen aufgedeckt');
  assert.deepEqual(t.verdict.gift, [a, b]);
  assert.equal(t.turn, 1);
  assert.equal(pairsOf(t, 0), 0);
  assert.equal(pairsOf(t, 1), 1);
  assert.equal(t.owner[a], 1);
  assert.equal(t.owner[c], null, 'zurück auf dem Tisch');
  assert.deepEqual(t.open, []);
  assert.equal(t.events[0].type, 'caught');
  assert.equal(t.cheat, null);
  assert.equal(before.owner[c], null);
});

test('Ohne Hilfen: ungleiches Paar einstecken und linsen', () => {
  let s = start({ free: true });
  const [c, d] = miss(s);
  s = flip(flip(s, 0, c), 0, d);
  s = pocket(s, 0);
  assert.equal(s.owner[c], 0);
  assert.equal(s.turn, 0, 'wie bei einem Paar nochmal');
  assert.match(s.cheat.why[0], /zwei verschiedene Kärtchen als Paar eingesteckt \(.+ und .+\)/);
  // linsen: nur der Linsende sieht das Motiv
  const k = s.tiles.findIndex((m, x) => s.owner[x] === null);
  s = peek(s, 0, k);
  assert.equal(s.events[0].motif, s.tiles[k]);
  assert.equal(viewFor(s, 0).events[0].motif, s.tiles[k]);
  assert.equal(viewFor(s, 1).events[0].motif, null);
  assert.equal(viewFor(s, 1).tiles[k], null);
  assert.equal(peek(s, 1, k), null, 'nicht dran');
  assert.equal(s.cheat.why.length, 2);
  s = pass(s, 0); // Weiter ohne aufzudecken – auch das ist ein Verstoß
  assert.ok(s.cheat.why.includes('kein Kärtchen aufgedeckt'));
  assert.equal(rematchBlocked(s, 0), true);
  const t = accuse(s, 1);
  assert.equal(t.verdict.caught, true);
  assert.equal(t.verdict.why.split(' und ').length >= 2, true);
  assert.equal(pairsOf(t, 0), 0, 'das ungleiche Paar liegt wieder');
  assert.equal(t.owner[c], null);
  assert.equal(t.turn, 1);
});

test('Ohne Hilfen: Schummeln beendet die Partie – Anklage nimmt das Ende zurück; Fehlalarm danach zählt neu', () => {
  // 12 Paare, Host räumt 11 ehrlich ab, dann steckt er zwei verschiedene ein → keine zwei gleichen mehr → Ende
  let s = start({ free: true });
  for (let m = 0; m < 10; m++) {
    const [a, b] = where(s, m);
    s = flip(flip(s, 0, a), 0, b);
  }
  const [x] = where(s, 10);
  const [y] = where(s, 11);
  s = pocket(flip(flip(s, 0, x), 0, y), 0);
  assert.equal(s.phase, 'over', 'nur noch eine 10 und eine 11 – kein Paar mehr möglich');
  assert.deepEqual(s.result.pairs, [11, 0]);
  assert.equal(again(s, 0), null, 'Schummler startet keine Revanche');
  const t = accuse(s, 1);
  assert.equal(t.phase, 'play');
  assert.equal(t.result, null);
  assert.equal(t.turn, 1);
  assert.equal(pairsOf(t, 1), 1);
  // allein: der Computer lässt den Zug gelten
  const w = waive(s, 1);
  assert.equal(w.cheat, null);
  assert.ok(again(w, 0, seeded()));

  // ehrliches Ende, dann Fehlalarm: der Ankläger gibt ein Paar ab, das Ergebnis zählt neu
  let e = start({ free: true });
  for (let m = 0; m < 12; m++) {
    const p = e.turn;
    const [a, b] = where(e, m);
    e = flip(flip(e, p, a), p, b);
    if (m === 5) {
      const [c, d] = miss(e);
      e = pass(flip(flip(e, p, c), p, d), p);
    }
  }
  assert.deepEqual(e.result.pairs, [6, 6]);
  const by = 1 - e.cheat.player;
  const f = accuse(e, by);
  assert.equal(f.verdict.caught, false);
  assert.equal(f.result.winner, 1 - by);
  assert.equal(f.result.pairs[by], 5);
});
