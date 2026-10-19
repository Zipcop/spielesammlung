import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winningChances, winPercent, expected, flip, classify, isSacrifice, positionSymbol } from '../src/schach/oracle.js';

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('Gewinnchance: ausgeglichen 50 %, symmetrisch, gedeckelt', () => {
  assert.equal(winPercent({ cp: 0 }), 50);
  // 2 / (1 + e^(−0,00368208 · 100)) − 1 = 0,18203 → 50 + 50 · 0,18203 = 59,10 %
  near(winPercent({ cp: 100 }), 59.1);
  near(winPercent({ cp: 100 }) + winPercent({ cp: -100 }), 100, 1e-9);
  assert.equal(winPercent({ cp: 5000 }), winPercent({ cp: 1000 })); // Deckel ±1000
  assert.equal(winPercent({ mate: 3 }), winPercent({ cp: 1000 }));
  assert.equal(winPercent({ mate: -2 }), winPercent({ cp: -1000 }));
  assert.equal(winPercent({ mate: 0 }), winPercent({ cp: -1000 })); // Matt in 0 = schon matt
  assert.equal(winningChances(1e6), 1);
});

test('erwartete Punkte: Matt zählt voll, sonst Lichess-Kurve ohne Deckel', () => {
  assert.equal(expected({ cp: 0 }), 0.5);
  assert.equal(expected({ mate: 2 }), 1);
  assert.equal(expected({ mate: -1 }), 0);
  assert.equal(expected({ mate: 0 }), 0);
  near(expected({ cp: 100 }), 0.591, 0.001);
  assert.ok(expected({ cp: 2000 }) > expected({ cp: 1000 })); // kein Deckel
  assert.deepEqual(flip({ cp: 35 }), { cp: -35 });
  assert.deepEqual(flip({ mate: 2 }), { mate: -2 });
});

// Grundfall: ausgeglichen vorher, zweitbester Zug etwas schlechter, kein Sonderfall
const base = { before: { cp: 0 }, second: { cp: -20 }, best: false, book: false, sacrifice: false, recapture: false, gift: 0, beforeGift: 0.5 };
const kind = (patch) => classify({ ...base, ...patch });

test('Stufen nach chess.com: 0,02 / 0,05 / 0,10 / 0,20 verlorene erwartete Punkte', () => {
  // verloren: −10 cp ≈ 0,009 · −25 ≈ 0,023 · −60 ≈ 0,055 · −120 ≈ 0,109 · −250 ≈ 0,215
  assert.equal(kind({ after: { cp: -10 } }), 'ausgezeichnet');
  assert.equal(kind({ after: { cp: -25 } }), 'gut');
  assert.equal(kind({ after: { cp: -60 } }), 'ungenau');
  assert.equal(kind({ after: { cp: -120 } }), 'fehler');
  assert.equal(kind({ after: { cp: -250 } }), 'patzer');
  assert.equal(kind({ after: { cp: 0 }, best: true }), 'best');
  assert.equal(kind({ after: { cp: -5 }, second: null }), 'best'); // nur ein Zug möglich
  assert.equal(kind({ after: { cp: -400 }, book: true }), 'buch'); // Buch geht vor
});

test('Matt: zulassen = Patzer, verzögern = kein Fehler', () => {
  assert.equal(kind({ before: { cp: 50 }, after: { mate: -2 } }), 'patzer');
  assert.equal(kind({ before: { cp: -1500 }, after: { mate: -4 } }), 'ausgezeichnet'); // war eh verloren (chess.com-Modell; Lichess sagte „Ungenauigkeit“)
  assert.equal(kind({ before: { mate: 2 }, after: { cp: 300 }, second: { mate: 3 } }), 'patzer'); // Matt verschenkt
  assert.equal(kind({ before: { mate: 2 }, after: { mate: 5 }, second: { mate: 3 } }), 'ausgezeichnet');
});

test('Brillant: gutes Figurenopfer, nicht schlecht danach, ohne Zug nicht schon völlig gewonnen', () => {
  const sac = { before: { cp: 50 }, after: { cp: 60 }, second: { cp: -200 }, best: true, sacrifice: true };
  assert.equal(kind(sac), 'brillant');
  assert.equal(kind({ ...sac, sacrifice: false }), 'grossartig'); // einziger guter Zug (Abstand ≥ 0,10, sonst verloren)
  assert.equal(kind({ ...sac, second: { mate: 3 } }), 'best'); // Alternative gewinnt sowieso
  assert.equal(kind({ ...sac, before: { cp: -200 }, after: { cp: -200 } }), 'best'); // danach schlecht
  assert.equal(kind({ ...sac, best: false, after: { cp: 0 } }), 'gut'); // zu viel verloren (≈ 0,046) für „fast bester Zug“
});

test('Großartig: einziger guter Zug, aber kein bloßes Zurückschlagen', () => {
  const only = { before: { cp: 30 }, after: { cp: 30 }, second: { cp: -200 }, best: true };
  assert.equal(kind(only), 'grossartig');
  assert.equal(kind({ ...only, recapture: true }), 'best');
  assert.equal(kind({ ...only, second: { cp: -20 } }), 'best'); // Alternative fast gleich gut
  assert.equal(kind({ ...only, second: { cp: -100 } }), 'best'); // Alternative schlechter, aber auch noch offen
  // Matt aus gewonnener Stellung: die Alternative gewinnt auch → nur „Bester Zug“
  assert.equal(kind({ before: { mate: 1 }, after: { mate: 1 }, second: { cp: 300 }, best: true }), 'best');
  // offen → gewonnen (z. B. hängende Figur nehmen), sonst bliebe es offen
  assert.equal(kind({ before: { cp: 250 }, after: { cp: 250 }, second: { cp: 0 }, best: true }), 'grossartig');
});

test('Verpasster Gewinn: Geschenk des Gegners wieder hergegeben', () => {
  const chance = { before: { cp: 250 }, second: { cp: 220 }, gift: 0.2, beforeGift: 0.5 };
  assert.equal(kind({ ...chance, after: { cp: 0 } }), 'verpasst');
  assert.equal(kind({ ...chance, after: { cp: -50 } }), 'verpasst'); // etwas schlechter als vor dem Geschenk (≈ 0,05)
  assert.equal(kind({ ...chance, after: { cp: -300 } }), 'patzer'); // deutlich schlechter (≈ 0,25) → eigener Patzer
  // aus einer echten Testpartie (Stockfish, Tiefe 14): Geschenk 0,630 − 0,236, danach 0,183
  assert.equal(classify({ ...base, before: { cp: 145 }, after: { cp: -407 }, second: { cp: 100 }, gift: 0.394, beforeGift: 0.236 }), 'verpasst');
  assert.equal(kind({ ...chance, after: { cp: 0 }, gift: 0.02 }), 'patzer'); // kein Geschenk → normaler Fehler
});

test('Figurenopfer erkennen', () => {
  // Läufer schlägt h7 mit Schach, Springer f6 und König decken → Läufer gegen Bauer
  assert.equal(isSacrifice('rnbq1rk1/ppp2ppp/4pn2/3p4/3P4/3BPN2/PPP2PPP/RNBQK2R w KQ - 0 6', 'd3h7'), true);
  // Läufer tauscht gegen Springer → kein Opfer
  assert.equal(isSacrifice('rnbqkb1r/pppppppp/5n2/6B1/3P4/8/PPP1PPPP/RN1QKBNR w KQkq - 2 3', 'g5f6'), false);
  assert.equal(isSacrifice('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4'), false);
  // Dame schlägt gedeckten Bauern f7 → Dame weg
  assert.equal(isSacrifice('r1bqkbnr/pppp1ppp/2n5/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 2 3', 'h5f7'), true);
  // Bauer ungedeckt stehen lassen (nur 1 Bauerneinheit) zählt nicht als Figurenopfer
  assert.equal(isSacrifice('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'g1f3'), false);
  assert.equal(isSacrifice('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e5'), false); // regelwidrig
  // Schon vorher verloren ist kein Opfer: Gabel Sc7+ – der König muss weg, der Turm fällt bei jedem Zug
  assert.equal(isSacrifice('r3k3/2N5/8/8/7q/8/5PPP/6K1 b - - 0 1', 'e8d7'), false);
  // Bauerngabel: einer der beiden Springer geht so oder so verloren
  assert.equal(isSacrifice('4k3/8/2n1n3/3P4/8/8/8/4K3 b - - 0 1', 'c6e5'), false);
  // Springer gegen Bauer – auch wenn sich anderswo gedeckte Türme gegenüberstehen
  assert.equal(isSacrifice('3r4/ppk3pp/5p2/4p3/8/5N2/PPK2PPP/3R4 w - - 0 1', 'f3e5'), true);
});

test('Stellungssymbole aus Sicht von Weiß (0,3 / 0,7 / 1,5 Bauern)', () => {
  assert.equal(positionSymbol({ cp: 0 }), '=');
  assert.equal(positionSymbol({ cp: 30 }), '=');
  assert.equal(positionSymbol({ cp: 50 }), '⩲');
  assert.equal(positionSymbol({ cp: -50 }), '⩱');
  assert.equal(positionSymbol({ cp: 100 }), '±');
  assert.equal(positionSymbol({ cp: -150 }), '∓');
  assert.equal(positionSymbol({ cp: 200 }), '+−');
  assert.equal(positionSymbol({ cp: -1000 }), '−+');
  assert.equal(positionSymbol({ mate: 3 }), '+−');
  assert.equal(positionSymbol({ mate: -1 }), '−+');
});

test('Eröffnungsbuch (Lichess-Liste): Stellung → Name, Zwischenstellungen zählen als Buch', async () => {
  const { readFileSync } = await import('node:fs');
  const { Chess } = await import('chess.js');
  const book = JSON.parse(readFileSync(new URL('../src/schach/openings.json', import.meta.url)));
  const key = (moves) => {
    const c = new Chess();
    moves.split(' ').forEach((m) => c.move(m));
    return c.fen().split(' ').slice(0, 2).join(' ');
  };
  assert.equal(book[key('e4 e5 Nf3 Nc6 Bc4')], 'Italian Game');
  assert.equal(book[key('e4')], "King's Pawn Game");
  assert.ok(key('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4') in book);
  assert.equal(book[key('a3 h6 h3 a6')], undefined); // Unsinn steht nicht im Buch
});
