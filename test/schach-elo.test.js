// Schach-Elo (src/schach/elo.js): Rechnung wie FIDE (K 40/20, Remis ½), Stockfish-Stärken, Elo zu zweit aus der Statistik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateGame, skillFor, strengthFor, coachFor, pairElo, recordGame, loadElo, coachElo, setCoachElo, diffText, START_ELO, HANDICAP, LEVELS } from '../src/schach/elo.js';
import { mergeStats, loadStats, resetPair } from '../src/stats.js';

// Speicher wie localStorage
const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), clear: () => m.clear() };
};

test('Elo nach einer Partie: Sieg, Remis, Niederlage, K = 40 bzw. 20', () => {
  const fresh = { rating: 1200, games: 0 };
  assert.deepEqual(rateGame(fresh, 1200, 1), { rating: 1220, games: 1 });
  assert.deepEqual(rateGame(fresh, 1200, 0.5), { rating: 1200, games: 1 });
  assert.deepEqual(rateGame(fresh, 1200, 0), { rating: 1180, games: 1 });
  assert.equal(rateGame({ rating: 1200, games: 30 }, 1200, 1).rating, 1210); // ab der 31. Partie K = 20
  // E = 1 / (1 + 10^((1600 − 1200) / 400)) = 1/11 ≈ 0,0909 → Sieg +36,4, Niederlage −3,6, Remis +16,4
  assert.equal(rateGame(fresh, 1600, 1).rating, 1236);
  assert.equal(rateGame(fresh, 1600, 0).rating, 1196);
  assert.equal(rateGame(fresh, 1600, 0.5).rating, 1216);
  assert.equal(diffText(12), '+12');
  assert.equal(diffText(-8), '−8');
  assert.equal(diffText(0), '±0');
});

test('Skill Level zur UCI_Elo wie in Stockfish (search.h)', () => {
  assert.equal(skillFor(1320), 0); // −0,31 → auf 0 begrenzt
  assert.ok(Math.abs(skillFor(3190) - 18.378) < 0.001); // 37,2473 − 40,8525 + 22,2943 − 0,311438
  assert.ok(Math.abs(skillFor(2000) - 4.185) < 0.01);
  assert.equal(skillFor(1000), 0); // darunter gibt es keine UCI_Elo
  for (let e = 1320; e < 3190; e += 10) assert.ok(skillFor(e + 10) >= skillFor(e), `steigt bei ${e}`);
});

test('Stärken: ab 1320 UCI_Elo mit der Suchtiefe, in der Stockfish wählt; darunter Skill 0 mit Zufallszügen', () => {
  assert.deepEqual(strengthFor(1600), { options: { UCI_LimitStrength: true, UCI_Elo: 1600 }, go: 'depth 3 movetime 3000', random: 0 });
  assert.equal(strengthFor(1320).go, 'depth 1 movetime 3000');
  assert.equal(strengthFor(3190).go, 'depth 19 movetime 3000');
  assert.equal(strengthFor(4000).options.UCI_Elo, 3190);
  const low = strengthFor(1000);
  assert.deepEqual(low.options, { UCI_LimitStrength: false, 'Skill Level': 0 });
  assert.equal(low.go, 'depth 1');
  // je schwächer, desto mehr Zufallszüge; die Messpunkte selbst treffen genau
  let last = 0;
  for (let e = 1300; e >= 800; e -= 50) {
    const p = strengthFor(e).random;
    assert.ok(p > 0 && p < 1 && p >= last, `${e}: ${p}`);
    last = p;
  }
  for (const [e, p] of HANDICAP) if (e < 1320) assert.equal(strengthFor(e).random, p);
  assert.equal(strengthFor(500).random, HANDICAP.at(-1)[1]); // unter dem schwächsten Messpunkt bleibt es dabei
});

test('Stufen haben feste Elo-Zahlen, aufsteigend, alle als UCI_Elo spielbar', () => {
  assert.deepEqual(LEVELS.map((l) => l.elo), [1320, 1600, 2000, 2400, 3190]);
  for (const l of LEVELS) assert.equal(strengthFor(l.elo).options.UCI_Elo, l.elo);
});

test('Coach-Stärke: eigene Elo auf 50 gerundet, 800 … 3150', () => {
  assert.equal(coachFor(1212), 1200);
  assert.equal(coachFor(1238), 1250);
  assert.equal(coachFor(500), 800);
  assert.equal(coachFor(4000), 3150);
});

test('Elo je PC: Start 1200, Partie werten, Änderung merken, Coach wächst mit', () => {
  globalThis.localStorage = memory();
  try {
    assert.deepEqual(loadElo(), { rating: START_ELO, games: 0, coach: null, last: null });
    assert.equal(coachElo(), 1200);
    setCoachElo(1420);
    assert.equal(coachElo(), 1400);
    recordGame(1600, 1); // gegen den Computer: Coach bleibt, wie er eingestellt ist
    assert.deepEqual(loadElo(), { rating: 1236, games: 1, coach: 1400, last: { before: 1200, after: 1236 } });
    recordGame(1400, 0, true); // gegen den Coach: er stellt sich auf die neue Zahl ein
    const s = loadElo();
    // E = 1/(1+10^((1400−1236)/400)) ≈ 0,2805 → −11,2
    assert.equal(s.rating, 1225);
    assert.deepEqual(s.last, { before: 1236, after: 1225 });
    assert.equal(s.coach, 1250); // 1225 → auf 50 gerundet
    localStorage.setItem('spielesammlung-schach-elo', '{kaputt');
    assert.equal(loadElo().rating, 1200);
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(loadElo().rating, 1200); // ohne Speicher: Startwert
});

test('Elo zu zweit aus der Statistik: zeitlich sortiert, Remis, zurückgenommene zählen nicht, nur Schach des Paars', () => {
  const e = (id, at, w, game = 'Schach', a = 'Anna', b = 'Nico') => ({ id, game, at, v: at, a, b, w });
  assert.deepEqual(pairElo([], ['Anna', 'Nico']), { Anna: 1200, Nico: 1200, games: 0 });
  const list = [
    e('2', 2000, ''), // Remis – kommt in der Liste zuerst, zählt aber als zweite Partie
    e('1', 1000, 'Nico'),
    e('3', 3000, null), // zurückgenommen
    e('4', 4000, 'Anna', 'Kniffel'),
    e('5', 5000, 'Nico', 'Schach', 'Anna', 'Paul'),
  ];
  // 1. Nico gewinnt: 1220 / 1180. 2. Remis: E(Nico) = 1/(1+10^(−40/400)) ≈ 0,5573 → −2,3 bzw. +2,3
  assert.deepEqual(pairElo(list, ['Anna', 'Nico']), { Anna: 1182, Nico: 1218, games: 2 });
});

test('Elo zu zweit mit echter Statistik-Liste (stats.js) und Zurücksetzen', () => {
  const store = memory();
  const win = (id, at, w) => ({ id, game: 'Schach', at, v: at, a: 'Anna', b: 'Nico', w });
  mergeStats([win('a', 1000, 'Anna'), win('b', 2000, 'Anna'), win('c', 3000, 'Nico')], store);
  const before = pairElo(loadStats(store), ['Anna', 'Nico']);
  assert.equal(before.games, 3);
  assert.ok(before.Anna > 1200 && before.Nico < 1200);
  resetPair('Anna', 'Nico', store, 4000);
  assert.deepEqual(pairElo(loadStats(store), ['Anna', 'Nico']), { Anna: 1200, Nico: 1200, games: 0 });
});
