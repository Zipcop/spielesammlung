// Schach-Schule (src/schach/schule/): reine Logik – Lernpfad (Sterne, Freischalten, Level, Übungen je Kapitel),
// Endspiel-Ziele, Eröffnungslinien, Koordinaten und Blind-Übung, Meisterpartien, Stellungs-Editor, Fortschritt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess, validateFen } from 'chess.js';
import { CHAPTERS, PER_CHAPTER, starsFor, unlocked, levelOf, finishChapter, nextChapter, exercisesOf, totalStars } from '../src/schach/schule/lernpfad.js';
import { ENDGAMES, judge } from '../src/schach/schule/endspiele.js';
import { OPENINGS, SURE_STREAK, uciOf, isMine, check, finishRun, toRepeat } from '../src/schach/schule/eroeffnungen.js';
import { ALL, randomSquare, recordRound, attacks, blindTask, fenOf } from '../src/schach/schule/koordinaten.js';
import { MASTER_GAMES, MAX_POINTS, movesOf, isGuess, guessCount, guessPoints, stepAt, recordGame } from '../src/schach/schule/meister.js';
import { START, EMPTY, placeOn, pieceAt, setTurn, checkFen, castlingFor, evalWhite, explainBest } from '../src/schach/schule/editor.js';
import { cleanSchule, summary, curvePoints } from '../src/schach/schule/speicher.js';
import { stateOf, moveText } from '../src/schach/schule/brett.js';
import { isRight, puzzleFrom, positionOf } from '../src/schach/puzzle.js';

const DATA = JSON.parse(readFileSync(new URL('../src/schach/schule/kapitel.json', import.meta.url)));
const BOOK = JSON.parse(readFileSync(new URL('../src/schach/openings.json', import.meta.url)));
const key = (fen) => fen.split(' ').slice(0, 2).join(' ');
const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
// Zufall zum Nachrechnen (immer gleich)
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

// --- Lernpfad ---
test('Sterne: ohne Fehler 3, mit 1–2 Fehlern 2, sonst 1', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(starsFor), [3, 2, 2, 1, 1]);
});

test('Freischalten: erstes Kapitel immer, danach ab 1 Stern im vorigen', () => {
  assert.equal(unlocked({}, 0), true);
  assert.equal(unlocked({}, 1), false);
  assert.equal(unlocked({ [CHAPTERS[0].id]: { stars: 1 } }, 1), true);
  assert.equal(unlocked({ [CHAPTERS[0].id]: { stars: 1 } }, 2), false);
});

test('Kapitel abschließen: bester Lauf zählt, neues Kapitel frei, Level-Aufstieg je 3 Sterne', () => {
  const a = finishChapter({}, 'matt1', 4); // 1 Stern
  assert.equal(a.stars, 1);
  assert.equal(a.opened, CHAPTERS[1].id);
  assert.equal(a.levelUp, false);
  const b = finishChapter(a.path, 'matt1', 0); // jetzt 3 Sterne → Level 2
  assert.equal(b.path.matt1.stars, 3);
  assert.equal(b.better, true);
  assert.equal(b.opened, null); // war schon frei
  assert.equal(b.levelUp, true);
  assert.deepEqual(levelOf(b.path), { level: 2, toNext: 3, stars: 3 });
  const c = finishChapter(b.path, 'matt1', 5); // schlechterer Lauf ändert die Sterne nicht
  assert.equal(c.path.matt1.stars, 3);
  assert.equal(c.path.matt1.runs, 3);
  assert.equal(totalStars(c.path), 3);
  assert.equal(nextChapter(c.path), CHAPTERS[1].id);
  assert.equal(nextChapter({}), 'matt1');
});

test('Jedes Kapitel hat genau 8 Übungen zum Thema, leichte zuerst, Lösung spielbar', () => {
  const ids = new Set();
  for (const c of CHAPTERS) {
    const list = exercisesOf(DATA, c.id);
    assert.equal(list.length, PER_CHAPTER, c.id);
    for (let i = 1; i < list.length; i++) assert.ok(list[i][3] >= list[i - 1][3], `${c.id}: nicht aufsteigend`);
    for (const row of list) {
      assert.ok(!ids.has(row[0]), `${row[0]} doppelt`);
      ids.add(row[0]);
      const chess = new Chess(row[1]);
      const moves = row[2].split(' ');
      chess.move(parse(moves[0]));
      assert.ok(c.pick({ themes: row[4].split(' '), piece: chess.get(moves[1].slice(0, 2)).type }), `${c.id}: ${row[0]} passt nicht zum Thema`);
      for (const m of moves.slice(1)) chess.move(parse(m));
      const p = puzzleFrom(row);
      for (let k = 1; k < p.line.length; k += 2) assert.ok(isRight(p, k, p.line[k]), `${row[0]}: Lösungszug ${k}`);
    }
    if (c.example === 'auto') {
      const ex = puzzleFrom(DATA.examples[c.id]);
      assert.ok(!ids.has(ex.id), 'Beispiel ist keine Übung');
      assert.ok(positionOf(ex, ex.line.slice(0, 2)).fen);
    }
  }
});

test('Beispielstellungen der Kapitel sind gültig, der erste Pfeil ist ein erlaubter Zug', () => {
  for (const c of CHAPTERS) {
    if (c.example === 'auto') continue;
    assert.ok(validateFen(c.example.fen).ok, c.id);
    const chess = new Chess(c.example.fen);
    const m = chess.move({ ...parse(c.example.arrows[0]), promotion: 'q' }); // Pfeil ohne Umwandlungsfigur
    if (/ist (ein ersticktes )?matt/i.test(c.example.note)) assert.ok(chess.isCheckmate(), `${c.id}: Matt behauptet`);
    assert.ok(m, c.id);
  }
});

// --- Endspiele ---
test('Alle Endspiel-Stellungen sind gültig und noch nicht entschieden', () => {
  for (const e of ENDGAMES) {
    assert.ok(validateFen(e.fen).ok, e.id);
    const chess = new Chess(e.fen);
    assert.ok(!chess.isGameOver(), e.id);
    assert.ok(['mate', 'promote', 'draw'].includes(e.goal));
    assert.ok(e.limit > 0);
    assert.equal(judge(e, []).state, null, e.id);
  }
});

test('Endspiel-Ziel: Matt erreicht, Patt verfehlt', () => {
  const dame = ENDGAMES.find((e) => e.id === 'dame-matt2'); // 7k/8/5K2/8/8/8/8/1Q6 w: Db7! Kg8 Dg7#
  assert.equal(judge(dame, ['b1b7'], { mate: 1 }).state, null);
  assert.equal(judge(dame, ['b1b7', 'h8g8', 'b7g7']).state, 'done');
  assert.equal(judge(dame, ['b1b8', 'h8h7'], null).state, null);
  assert.equal(judge(dame, ['b1b8'], { mate: 2 }).state, 'failed'); // 1 + 2 > 2
  assert.equal(judge(dame, ['b1b8'], { cp: 900 }).state, 'failed'); // kein Matt mehr in Sicht
  // Patt: Weiß Kf6, Dg6?? – Schwarz Kh8 kann nicht ziehen
  const patt = { ...ENDGAMES.find((e) => e.id === 'dame'), fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1' };
  const r = judge(patt, ['g1g6']);
  assert.equal(r.state, 'failed');
  assert.match(r.text, /Patt/);
});

test('Endspiel-Ziel: Umwandeln mit sicherem Gewinn, Gewinn verspielt, Remis halten', () => {
  const quadrat = ENDGAMES.find((e) => e.id === 'quadrat'); // 8/8/8/5k2/P7/8/8/7K w
  const run = ['a4a5', 'f5e5', 'a5a6', 'e5d6', 'a6a7', 'd6c7', 'a7a8q'];
  assert.equal(judge(quadrat, run, { cp: 900 }).state, null); // Schwarz ist noch dran
  assert.equal(judge(quadrat, [...run, 'c7b6']).state, 'done');
  assert.equal(judge(quadrat, ['h1g2'], { cp: 0 }).state, 'failed');
  assert.equal(judge(quadrat, ['a4a5'], { cp: 700 }).state, null);
  const halten = ENDGAMES.find((e) => e.id === 'halten'); // Schwarz hält: Kf5!
  assert.equal(judge(halten, ['e5d5'], { cp: -590 }).state, 'failed');
  assert.equal(judge(halten, ['e5f5'], { cp: 0 }).state, null);
  // gehalten: nach `moves` eigenen Zügen ohne Verlust (hier ein kurzes Beispiel mit moves = 2)
  const kurz = { ...halten, fen: '4k3/8/8/4P3/8/8/8/4K3 b - - 0 1', moves: 2, limit: 2 };
  assert.equal(judge(kurz, ['e8d7'], { cp: 0 }).state, null);
  assert.equal(judge(kurz, ['e8d7', 'e1e2', 'd7e6'], { cp: 0 }).state, 'done');
  assert.equal(judge(kurz, ['e8d7', 'e1e2', 'd7e6'], null).state, null); // ohne Bewertung noch nicht
  // Matt durch den Gegner = verloren
  const lucena = ENDGAMES.find((e) => e.id === 'lucena');
  assert.equal(judge(lucena, ['c1c2'], { cp: -629 }).state, 'failed');
  assert.equal(judge(lucena, ['c1d1'], { cp: 491 }).state, null);
});

// --- Eröffnungen ---
test('Jede Eröffnungslinie steht Zug für Zug im Eröffnungsbuch und trägt den erwarteten Namen', () => {
  const ids = new Set();
  for (const op of OPENINGS) {
    assert.ok(!ids.has(op.id));
    ids.add(op.id);
    const chess = new Chess();
    let name = '';
    for (const san of op.line.split(' ')) {
      chess.move(san);
      assert.ok(key(chess.fen()) in BOOK, `${op.id}: ${san} nicht im Buch`);
      name = BOOK[key(chess.fen())] || name;
    }
    assert.ok(name.startsWith(op.book), `${op.id}: „${name}“`);
  }
  assert.ok(OPENINGS.filter((o) => o.side === 'w').length >= 5 && OPENINGS.filter((o) => o.side === 'b').length >= 5);
});

test('Eröffnung üben: eigene Züge, richtig/falsch, Serie bis sicher, Fehler wiederholen', () => {
  const it = OPENINGS.find((o) => o.id === 'italienisch');
  assert.equal(isMine(it, 0), true);
  assert.equal(isMine(it, 1), false);
  assert.equal(uciOf(it)[0], 'e2e4');
  assert.equal(check(it, 0, 'e2e4'), true);
  assert.equal(check(it, 0, 'd2d4'), false);
  assert.equal(check(it, 0, 'e2e5'), false); // regelwidrig
  assert.equal(check(OPENINGS.find((o) => o.id === 'spanisch'), 8, 'e1g1'), true); // Rochade als Königszug
  let p = finishRun({}, 'italienisch', 2);
  assert.deepEqual(p.italienisch, { runs: 1, streak: 0, best: 0, errors: 2, sure: false });
  assert.equal(toRepeat(p), 'italienisch');
  for (let i = 0; i < SURE_STREAK; i++) p = finishRun(p, 'italienisch', 0);
  assert.equal(p.italienisch.sure, true);
  assert.equal(toRepeat(p), null);
  p = finishRun(p, 'italienisch', 1);
  assert.equal(p.italienisch.sure, false);
  assert.equal(p.italienisch.best, SURE_STREAK);
});

// --- Koordinaten und Blind ---
test('Koordinaten: 64 Felder, Zufallsfeld nie zweimal hintereinander, Rekord je Farbe', () => {
  assert.equal(new Set(ALL).size, 64);
  const r = seeded(7);
  let last = null;
  for (let i = 0; i < 200; i++) {
    const sq = randomSquare(r, last);
    assert.notEqual(sq, last);
    assert.ok(ALL.includes(sq));
    last = sq;
  }
  const a = recordRound({ w: 10, b: 0 }, 'w', 8);
  assert.deepEqual(a, { records: { w: 10, b: 0 }, best: false });
  const b = recordRound(a.records, 'b', 3);
  assert.deepEqual(b, { records: { w: 10, b: 3 }, best: true });
});

test('Blind: Angriffe stimmen mit chess.js überein, Antwort etwa zur Hälfte „Ja“', () => {
  const r = seeded(42);
  let yes = 0;
  for (let i = 0; i < 400; i++) {
    const t = blindTask(r);
    assert.ok(t.pieces.length >= 3 && t.pieces.length <= 5);
    assert.equal(new Set(t.pieces.map((p) => p.square)).size, t.pieces.length);
    assert.match(t.question, /^Kann (die (weiße|schwarze) Dame|der (weiße|schwarze) (Turm|Läufer|Springer|Bauer)) auf [a-h][1-8] (die (weiße|schwarze) Dame|den (weißen|schwarzen) (Turm|Läufer|Springer|Bauern)) auf [a-h][1-8] schlagen\?$/);
    // chess.js: Könige in eine freie Ecke dazu (sie verdecken nichts Wichtiges, wenn das Feld frei bleibt)
    const chess = new Chess(fenOf(t.pieces), { skipValidation: true });
    const attacker = t.pieces[0];
    const hit = chess.attackers(t.to, attacker.color).includes(t.from);
    assert.equal(t.answer, hit, `${fenOf(t.pieces)} ${t.from}→${t.to}`);
    if (t.answer) yes++;
  }
  assert.ok(yes > 120 && yes < 280, `Ja: ${yes}`);
  assert.equal(attacks([{ square: 'a1', color: 'w', type: 'r' }, { square: 'a4', color: 'b', type: 'p' }], 'a1', 'a8'), false);
  assert.equal(attacks([{ square: 'e4', color: 'w', type: 'p' }], 'e4', 'd5'), true);
  assert.equal(attacks([{ square: 'e4', color: 'b', type: 'p' }], 'e4', 'd5'), false);
});

// --- Meisterpartien ---
test('Alle Meisterpartien lassen sich mit chess.js komplett nachspielen', () => {
  for (const g of MASTER_GAMES) {
    const chess = new Chess();
    for (const san of movesOf(g)) chess.move(san);
    if (movesOf(g).at(-1).endsWith('#')) assert.ok(chess.isCheckmate(), g.id);
    assert.ok(guessCount(g) >= 10, g.id);
    assert.ok(isGuess(g, g.from), `${g.id}: erster Ratezug gehört dem Sieger`);
    assert.ok(/^\d{4}$/.test(g.where.slice(-4)) && Number(g.where.slice(-4)) < 1950, g.id);
  }
  const s = stepAt(MASTER_GAMES[0], 0);
  assert.deepEqual(s.move, { uci: 'e2e4', san: 'e4' });
  assert.equal(stepAt(MASTER_GAMES[0], movesOf(MASTER_GAMES[0]).length).move, null);
});

test('Zug raten: Meisterzug = 10, gleich gut = 10, schlechter = weniger', () => {
  assert.equal(guessPoints({ same: true }), MAX_POINTS);
  assert.equal(guessPoints({ same: false, master: { cp: 50 }, mine: { cp: 60 } }), 10);
  assert.equal(guessPoints({ same: false, master: { cp: 50 }, mine: { cp: 30 } }), 10);
  assert.equal(guessPoints({ same: false, master: { cp: 100 }, mine: { cp: 60 } }), 7);
  assert.equal(guessPoints({ same: false, master: { cp: 200 }, mine: { cp: 100 } }), 4);
  assert.equal(guessPoints({ same: false, master: { cp: 300 }, mine: { cp: 100 } }), 2);
  assert.equal(guessPoints({ same: false, master: { mate: 1 }, mine: { cp: -300 } }), 0);
  assert.equal(guessPoints({ same: false, master: { mate: 1 }, mine: { mate: 3 } }), 10); // anderes Matt
  assert.deepEqual(recordGame({ oper: 50 }, 'oper', 40), { best: { oper: 50 }, record: false });
  assert.deepEqual(recordGame({}, 'oper', 40), { best: { oper: 40 }, record: true });
});

// --- Analysebrett ---
test('Editor: Figuren setzen und entfernen, Rochaderechte passen sich an', () => {
  let f = placeOn(START, 'e2', null);
  assert.equal(pieceAt(f, 'e2'), null);
  assert.equal(f.split(' ')[2], 'KQkq');
  f = placeOn(f, 'h1', null);
  assert.equal(f.split(' ')[2], 'Qkq');
  f = placeOn(f, 'e4', 'N');
  assert.equal(pieceAt(f, 'e4'), 'N');
  assert.equal(setTurn(f, 'b').split(' ')[1], 'b');
  assert.equal(castlingFor('4k3/8/8/8/8/8/8/R3K2R', 'KQkq'), 'KQ');
  assert.equal(castlingFor('4k3/8/8/8/8/8/8/R3K2R', '-'), '-');
  assert.equal(placeOn(EMPTY, 'a1', 'R').split(' ')[2], 'Q'); // Aufbau: König e1 + Turm a1 = Rochade erlaubt
  assert.equal(placeOn(placeOn(EMPTY, 'e1', null), 'a1', 'R').split(' ')[2], '-'); // ohne König auf e1 keine
});

test('FEN prüfen: gültig, ergänzt und ungültig mit Grund', () => {
  assert.deepEqual(checkFen(START), { ok: true, fen: START });
  assert.equal(checkFen('4k3/8/8/8/8/8/8/4K3').fen, '4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(checkFen('4k3/8/8/8/8/8/8/4K2R w KQkq - 0 1').fen, '4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  const bad = (fen, re) => {
    const r = checkFen(fen);
    assert.equal(r.ok, false, fen);
    assert.match(r.error, re);
  };
  bad('', /Keine/);
  bad('8/8/8/8/8/8/8/8 w - - 0 1', /genau einen König/);
  bad('4k3/8/8/8/8/8/8/4KK2 w - - 0 1', /genau einen König/);
  bad('P3k3/8/8/8/8/8/8/4K3 w - - 0 1', /Bauern/);
  bad('4k3/8/8/8/8/8/8/4K3 x - - 0 1', /Am Zug/);
  bad('4k3/8/8/8/8/8/8/4K3/8 w - - 0 1', /8 Reihen/);
  bad('4k3/9/8/8/8/8/8/4K3 w - - 0 1', /8 Reihen/);
  bad('4k3/4R3/8/8/8/8/8/6K1 w - - 0 1', /Schwarz steht im Schach/);
  bad('4k3/PPPPPPPP/P7/8/8/8/8/4K3 w - - 0 1', /Mehr als 8 Bauern/);
});

test('Bewertungstext und Satz zum besten Zug', () => {
  assert.equal(evalWhite({ cp: 40 }, 'w'), '+0,4');
  assert.equal(evalWhite({ cp: 40 }, 'b'), '−0,4');
  assert.equal(evalWhite({ mate: 2 }, 'b'), 'Schwarz setzt in 2 matt');
  assert.equal(explainBest('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['d1d8'], { mate: 1 }), 'Bester Zug für Weiß: **Td8#** – Schachmatt!');
  assert.match(explainBest('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d7', 'c7a8'], { cp: 500 }), /Sc7\+\*\* – er gibt Schach und greift mit dem Springer mehrere Figuren gleichzeitig an \(Gabel\)/);
  assert.match(explainBest('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', ['d1d5'], { cp: 400 }), /schlägt einen Springer, der ungedeckt ist/);
  assert.equal(explainBest(START, [], null), null);
});

// --- Brett und Fortschritt ---
test('Spielstand fürs Brett und Zugliste mit Nummern', () => {
  const s = stateOf(START, ['e2e4', 'e7e5', 'g1f3'], 1);
  assert.equal(s.white, 1);
  assert.deepEqual(s.last, { from: 'g1', to: 'f3' });
  assert.equal(moveText(s.san, (x) => x.replace('N', 'S'), START), '1. e4 e5 2. Sf3');
  assert.equal(moveText(['Nc6'], (x) => x, s.fen), '2… Nc6');
});

test('Fortschritt: kaputte oder fehlende fremde Speicher stören nicht', () => {
  const schule = cleanSchule({ path: { matt1: { stars: 2 } }, coords: { w: 'x' }, endgames: { dame: true }, openings: { londoner: { sure: true } }, master: { oper: 70 } });
  assert.deepEqual(schule.coords, { w: 0, b: 0 });
  const s = summary({ schule, raetsel: { solve: { rating: 1100, games: 5, solved: 3 }, choose: 'kaputt' }, lernen: { daily: { streak: 4, best: 6 } }, elo: { rating: 1234, games: 3 }, history: [{ at: 1, rating: 1200 }, { at: 2, rating: 1234 }] });
  assert.deepEqual(s.puzzles, { solve: { rating: 1100, games: 5, solved: 3 }, choose: null });
  assert.deepEqual(s.daily, { streak: 4, best: 6 });
  assert.equal(s.path.stars, 2);
  assert.equal(s.endgames.done, 1);
  assert.equal(s.openings.sure, 1);
  assert.equal(s.master.played, 1);
  assert.deepEqual(s.curve, [1200, 1234]);
  const none = summary({ schule: cleanSchule(null), raetsel: null, lernen: [], elo: null, history: null });
  assert.equal(none.daily, null);
  assert.equal(none.puzzles.solve, null);
  assert.equal(none.elo.rating, 0);
  assert.equal(curvePoints([], 100, 50), '');
  assert.equal(curvePoints([1000, 1100], 100, 50, 0), '0,50 100,0');
});

test('Eigener Speicher: kaputte Einträge innen werden zu sauberen Zahlen', () => {
  const s = cleanSchule({ path: { matt1: { stars: '3' }, gabel: 7, ungedeckt: { stars: 2, runs: 1 } }, openings: { italienisch: 5, spanisch: { streak: 'x', sure: true } }, master: { oper: 'x', peru: 90 }, endgames: { dame: 'ja', turm: true }, blind: '9' });
  assert.deepEqual(levelOf(s.path), { level: 1, toNext: 1, stars: 2 });
  assert.equal(s.path.ungedeckt.runs, 1);
  assert.deepEqual(Object.keys(s.openings), ['spanisch']);
  assert.deepEqual(s.openings.spanisch, { runs: 0, streak: 0, best: 0, errors: 0, sure: true });
  assert.deepEqual(finishRun(s.openings, 'spanisch', 0).spanisch.runs, 1);
  assert.deepEqual(s.master, { peru: 90 });
  assert.deepEqual(s.endgames, { turm: true });
  assert.equal(s.blind, 0);
});

test('Level: mit allen Sternen kein „noch … bis zum nächsten Level“ mehr', () => {
  const all = Object.fromEntries(CHAPTERS.map((c) => [c.id, { stars: 3 }]));
  assert.deepEqual(levelOf(all), { level: 1 + CHAPTERS.length, toNext: 0, stars: CHAPTERS.length * 3 });
});

test('Elo-Verlauf: jede gewertete Partie kommt in einen eigenen Eintrag, der alte Elo-Speicher bleibt gleich', async () => {
  const { recordGame: rec, loadElo, loadEloHistory, HISTORY_KEY } = await import('../src/schach/elo.js');
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
  try {
    assert.deepEqual(loadEloHistory(), []);
    rec(1600, 1);
    rec(1600, 0);
    const h = loadEloHistory();
    assert.equal(h.length, 2);
    assert.equal(h[1].rating, loadElo().rating);
    assert.deepEqual(Object.keys(loadElo()).sort(), ['coach', 'games', 'last', 'rating']);
    data.set(HISTORY_KEY, '{kaputt');
    assert.deepEqual(loadEloHistory(), []);
  } finally {
    delete globalThis.localStorage;
  }
});
