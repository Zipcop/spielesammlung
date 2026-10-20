import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winningChances, winPercent, expected, flip, classify, isSacrifice, positionSymbol, moveAccuracy, gameAccuracy, turningPoint, scoreText } from '../src/schach/oracle.js';

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

test('Schwellen: Ungenauigkeit ab 0,05 und Fehler ab 0,10 erwarteten Punkten (= Lichess 0,1 / 0,2 winningChances)', () => {
  // vorher +100 cp (0,5910); Zug kostet genau so viel, dass knapp unter / knapp über der Grenze verloren wird
  const cpFor = (e) => Math.log(e / (1 - e)) / 0.00368208; // Umkehrung von expected()
  const lose = (loss) => kind({ before: { cp: 100 }, second: { cp: 80 }, after: { cp: cpFor(expected({ cp: 100 }) - loss) } });
  assert.equal(lose(0.049), 'gut');
  assert.equal(lose(0.051), 'ungenau');
  assert.equal(lose(0.099), 'ungenau');
  assert.equal(lose(0.101), 'fehler');
  assert.equal(lose(0.199), 'fehler');
  assert.equal(lose(0.201), 'patzer'); // chess.com: Patzer erst ab 0,20 (Lichess schon ab 0,15)
  // Lichess-Skala: winningChances-Verlust = doppelter Verlust an erwarteten Punkten
  near(winningChances(100) - winningChances(cpFor(expected({ cp: 100 }) - 0.05)), 0.1, 1e-9);
});

test('Genauigkeit je Zug: Lichess-Kurve, 100 ohne Verlust, nie unter 0', () => {
  // 103,1668 · e^(−0,043544 · Δ) − 3,1669 + 1: Δ 0 → 101 → gedeckelt 100; Δ 10: 103,1668 · 0,64698 − 2,1669 = 64,58; Δ 50: 103,1668 · 0,11336 − 2,1669 = 9,53
  assert.equal(moveAccuracy(50, 60), 100);
  assert.equal(moveAccuracy(50, 50), 100);
  near(moveAccuracy(60, 50), 103.1668100711649 * Math.exp(-0.4354415386753951) - 2.166924740191411, 1e-9);
  near(moveAccuracy(60, 50), 64.58, 0.01);
  near(moveAccuracy(80, 30), 9.53, 0.01);
  assert.equal(moveAccuracy(100, 0), 0);
});

test('Genauigkeit der Partie: fehlerlos 100 %, Patzer drücken nur die eigene Seite', () => {
  assert.deepEqual(gameAccuracy([50]), { w: null, b: null });
  const steady = Array(21).fill(50);
  assert.deepEqual(gameAccuracy(steady), { w: 100, b: 100 });
  // Weiß patzt im 5. Halbzug (Index 4): seine Gewinnchance fällt von 50 auf 10, danach bleibt es so
  const wins = steady.map((v, k) => (k <= 4 ? 50 : 10));
  const acc = gameAccuracy(wins);
  assert.equal(acc.b, 100);
  assert.ok(acc.w < 90 && acc.w > 20, `Weiß ${acc.w}`);
  // Probe von Hand: 21 Stellungen → Fenster 2; Zug 4 hat Gewicht σ(50, 10) = 20 → 12 (gedeckelt), die anderen 0,5.
  // Weiß: Züge 0, 2, 4 … 18 = 10 Züge, einer mit a = moveAccuracy(50, 10), Rest 100.
  const a = moveAccuracy(50, 10);
  const weighted = (9 * 100 * 0.5 + a * 12) / (9 * 0.5 + 12);
  const harmonic = 10 / (9 / 100 + 1 / a);
  near(acc.w, (weighted + harmonic) / 2, 1e-9);
  // unbekannte Bewertung: dieser Zug fällt weg, kein Absturz
  assert.equal(gameAccuracy([50, null, 50]).w, null);
  assert.equal(gameAccuracy([50, null, 50]).b, null);
});

test('Wendepunkt: größte Verschiebung durch Fehler/Patzer, aus meiner Sicht', () => {
  const wins = [50, 52, 48, 80, 78, 20, 22];
  const verdicts = ['best', 'gut', 'patzer', 'gut', 'patzer', 'best'];
  assert.deepEqual(turningPoint(wins, verdicts, 'w'), { index: 4, from: 78, to: 20 }); // 58 Punkte > 32
  assert.deepEqual(turningPoint(wins, verdicts, 'b'), { index: 4, from: 22, to: 80 });
  assert.equal(turningPoint(wins, verdicts.map(() => 'ungenau'), 'w'), null); // nur Ungenauigkeiten → kein Wendepunkt
  assert.equal(turningPoint([50, null, 40], ['fehler', 'patzer'], 'w'), null);
});

test('Genauigkeit der Partie: längere Partie (Fenster 4) und Patzer von Schwarz', () => {
  // 41 Stellungen → Fenster (41 − 1) / 10 = 4, die ersten 2 Züge bekommen das erste Fenster mit
  const wins = Array(41).fill(50).map((v, k) => (k <= 7 ? 50 : 90)); // Schwarz patzt mit Halbzug 8 (Index 7): 50 → 90 für Weiß
  const acc = gameAccuracy(wins);
  assert.equal(acc.w, 100);
  // Probe von Hand: Gewicht von Zug 7 = σ des Fensters wins[7..10] = (50, 90, 90, 90) → Mittel 80, σ = √((900 + 3 · 100) / 4) = √300 ≈ 17,3 → 12.
  // Übrige schwarze Züge: Fenster ohne Sprung → σ 0 → 0,5; oder mit Sprung (Fenster ab 5, 6) → auch 12.
  const deviation = (a) => Math.sqrt(a.reduce((s, x) => s + (x - a.reduce((t, y) => t + y, 0) / a.length) ** 2, 0) / a.length);
  const windows = [wins.slice(0, 4), wins.slice(0, 4), ...Array.from({ length: 38 }, (_, k) => wins.slice(k, k + 4))];
  const black = [];
  for (let i = 1; i < 40; i += 2) black.push([moveAccuracy(100 - wins[i], 100 - wins[i + 1]), Math.max(0.5, Math.min(12, deviation(windows[i])))]);
  assert.equal(black.length, 20);
  assert.equal(black[3][1], 12); // Zug 7
  const weighted = black.reduce((s, [a, w]) => s + a * w, 0) / black.reduce((s, [, w]) => s + w, 0);
  const harmonic = 20 / black.reduce((s, [a]) => s + 1 / Math.max(1, a), 0);
  near(acc.b, (weighted + harmonic) / 2, 1e-9);
  assert.ok(acc.b < 80, `Schwarz ${acc.b}`);
});

test('Bewertung als Text: Bauern mit Komma, Vorzeichen, Matt', () => {
  assert.equal(scoreText({ cp: 43 }), '+0,4');
  assert.equal(scoreText({ cp: -125 }), '−1,3'); // 1,25 → 1,3 (toFixed rundet hier auf)
  assert.equal(scoreText({ cp: 0 }), '0,0');
  assert.equal(scoreText({ cp: -4 }), '0,0'); // kein „−0,0“
  assert.equal(scoreText({ cp: 1000 }), '+10,0');
  assert.equal(scoreText({ mate: 3 }), '#3');
  assert.equal(scoreText({ mate: -2 }), '#−2');
});
