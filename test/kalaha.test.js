// Kalaha (src/kalaha/game.js): Regeln nach de.wikipedia „Kalaha“ und „Ohne Hilfen“ mit Schummeln und Verwarnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setSeeds, move, take, untake, drop, capture, shift, done, turnOf, planOf, accuse, waive, again, score, forGuest,
  sow, legalMoves, nextPit, opposite, total, STORE,
} from '../src/kalaha/game.js';
import { chooseMove, cheatTurn, LEVELS } from '../src/kalaha/ai.js';
import { rematchBlocked } from '../src/schummeln.js';
import { OUTCOME } from '../src/results.js';

// Stand mit bestimmten Mulden: pits = 14 Zahlen
const withPits = (pits, extra = {}) => ({ ...newGame(extra), pits, ...extra.at });

test('Aufbau: 6 Mulden je Spieler mit 4 Steinen, Kalahas leer, 3–6 wählbar, Spieler 0 fängt an', () => {
  const s = newGame();
  assert.deepEqual(s.pits, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(s.turn, 0);
  assert.equal(newGame({ seeds: 3 }).pits[0], 3);
  assert.equal(total(newGame({ seeds: 6 }).pits), 72);
  assert.equal(newGame({ seeds: 9 }).seeds, 4); // ungültig → Standard
  assert.equal(opposite(0), 12);
  assert.equal(opposite(5), 7);
});

test('Steine je Mulde ändern: nur Spieler 0 und nur vor dem ersten Zug', () => {
  const s = newGame();
  const t = setSeeds(s, 0, 6);
  assert.deepEqual(t.pits, [6, 6, 6, 6, 6, 6, 0, 6, 6, 6, 6, 6, 6, 0]);
  assert.equal(t.seq, s.seq + 1);
  assert.equal(setSeeds(s, 1, 6), null);
  assert.equal(setSeeds(s, 0, 7), null);
  assert.equal(setSeeds(move(s, 0, 0), 0, 6), null);
});

test('Säen gegen den Uhrzeigersinn, eigenes Kalaha ja, gegnerisches übersprungen', () => {
  assert.equal(nextPit(5, 0), 6);
  assert.equal(nextPit(12, 0), 0); // Spieler 0 überspringt Kalaha 13
  assert.equal(nextPit(5, 1), 7); // Spieler 1 überspringt Kalaha 6
  assert.equal(nextPit(12, 1), 13);
  const pits = [0, 0, 0, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0];
  const r = sow(pits, 0, 5);
  assert.deepEqual(r.path, [6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
  assert.equal(r.pits[13], 0);
  assert.deepEqual(r.capture, { at: 2, opp: 10, n: 3 }); // letzter in der leeren Mulde 2, gegenüber 10 liegen 2
  assert.equal(r.pits[6], 4);
});

test('Letzter Stein im eigenen Kalaha: nochmal dran', () => {
  const s = move(newGame(), 0, 2); // 4 Steine aus Mulde 3: 3, 4, 5, Kalaha
  assert.deepEqual(s.pits, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
  assert.equal(s.turn, 0);
  assert.equal(s.events[0].bonus, true);
  const t = move(s, 0, 0);
  assert.equal(t.turn, 1);
  assert.equal(move(t, 0, 1), null); // nicht dran
});

test('Fang: letzter Stein in eigener leerer Mulde, gegenüber liegen Steine', () => {
  const pits = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0];
  const s = move(withPits(pits), 0, 0); // landet in Mulde 1 (leer), gegenüber Mulde 11 mit 3
  assert.deepEqual(s.events[0].capture, { at: 1, opp: 11, n: 4 });
  assert.equal(s.pits[6], 4);
  // gegenüber leer = kein Fang
  const r = sow([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0], 0, 0);
  assert.equal(r.capture, null);
  // Mulde war nicht leer = kein Fang
  assert.equal(sow([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0], 0, 0).capture, null);
  // in einer gegnerischen leeren Mulde = kein Fang
  assert.equal(sow([0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 0, 0], 0, 5).capture, null);
});

test('Ende: eine Seite leer → Reste ins eigene Kalaha, mehr gewinnt, gleich = Remis', () => {
  const s = move(withPits([0, 0, 0, 0, 0, 1, 10, 2, 0, 0, 0, 0, 1, 5]), 0, 5);
  assert.deepEqual(s.result, { winner: 0, reason: 'leer', store: [11, 8] });
  assert.deepEqual(s.events.map((e) => e.type), ['move', 'sweep']);
  assert.equal(OUTCOME.Kalaha(s), 0);
  const tie = move(withPits([0, 0, 0, 0, 0, 1, 7, 2, 0, 0, 0, 0, 1, 5]), 0, 5);
  assert.equal(tie.result.winner, null);
  assert.equal(OUTCOME.Kalaha(tie), null);
  assert.equal(OUTCOME.Kalaha(newGame()), undefined);
});

test('Zufallspartien: Steine bleiben erhalten, die Partie endet, Sieger hat mehr im Kalaha', () => {
  for (let g = 0; g < 200; g++) {
    let s = newGame({ seeds: 3 + (g % 4) });
    const sum = total(s.pits);
    for (let n = 0; n < 500 && !s.result; n++) {
      const moves = legalMoves(s.pits, s.turn);
      assert.ok(moves.length, 'wer dran ist, kann ziehen');
      s = move(s, s.turn, moves[Math.floor(Math.random() * moves.length)]);
      assert.equal(total(s.pits), sum);
    }
    assert.ok(s.result);
    const [a, b] = s.result.store;
    assert.equal(a + b, sum);
    assert.equal(s.result.winner, a === b ? null : a > b ? 0 : 1);
  }
});

test('Revanche: der andere fängt an, Steinzahl bleibt, Siege zählen weiter', () => {
  const s = move(withPits([0, 0, 0, 0, 0, 1, 10, 2, 0, 0, 0, 0, 1, 5], { seeds: 5 }), 0, 5);
  const r = again(s, 1);
  assert.equal(r.starter, 1);
  assert.equal(r.turn, 1);
  assert.equal(r.seeds, 5);
  assert.deepEqual(r.wins, [1, 0]);
  assert.equal(r.round, 2);
  assert.deepEqual(score(r), [1, 0]);
  assert.equal(again(newGame(), 0), null);
});

// --- Ohne Hilfen ---
const free = () => newGame({ free: true });
const sowFree = (s, by, from, drops) => drops.reduce((t, at) => drop(t, by, at), take(s, by, from));

test('ohne Hilfen: Mulde leeren, Stein für Stein legen, fertig – regelgerecht, Fehlalarm kostet den Rufer', () => {
  let s = sowFree(free(), 0, 0, [1, 2, 3, 4]);
  assert.equal(s.open.hand, 0);
  assert.equal(move(free(), 0, 0), null); // normale Züge gibt es ohne Hilfen nicht
  s = done(s, 0);
  assert.equal(s.turn, 1);
  assert.equal(s.cheat.legal, true);
  const a = accuse(s, 1);
  assert.deepEqual(a.strikes, [0, 1]);
  assert.equal(a.verdict.caught, false);
  assert.deepEqual(a.pits, s.pits);
  assert.equal(accuse(s, 0), null); // nicht gegen sich selbst
});

test('ohne Hilfen: falsch gesät, gegnerisches Kalaha, geschmuggelt, Fang ohne Recht – erwischt = Zug zurück', () => {
  const s0 = free();
  const wrong = done(sowFree(s0, 0, 1, [2, 3, 4, 6]), 0); // Mulde 5 übersprungen, letzter im Kalaha
  assert.equal(wrong.turn, 0); // der letzte Stein lag im eigenen Kalaha → nochmal (geprüft wird nicht)
  assert.deepEqual(wrong.cheat.why, ['falsch gesät']);
  const caught = accuse(wrong, 1);
  assert.equal(caught.verdict.why, 'falsch gesät');
  assert.deepEqual(caught.pits, s0.pits);
  assert.equal(caught.turn, 0);
  assert.deepEqual(caught.strikes, [1, 0]);

  const far = withPits([0, 0, 0, 0, 0, 9, 0, 1, 1, 1, 1, 1, 1, 0], { free: true });
  const skip = done(sowFree(far, 0, 5, [6, 7, 8, 9, 10, 11, 12, 13, 0]), 0);
  assert.deepEqual(skip.cheat.why, ['das gegnerische Kalaha nicht übersprungen']);

  const sneak = done(shift(sowFree(s0, 0, 0, [1, 2, 3, 4]), 0, 9, 6), 0);
  assert.deepEqual(sneak.cheat.why, ['einen Stein ins eigene Kalaha geschmuggelt']);
  assert.equal(accuse(sneak, 1).verdict.why, 'einen Stein ins eigene Kalaha geschmuggelt');

  const grab = done(capture(sowFree(s0, 0, 0, [1, 2, 3, 4]), 0, 4), 0); // Mulde 4 war nicht leer
  assert.deepEqual(grab.cheat.why, ['gefangen, ohne dass es erlaubt war']);
  assert.equal(grab.pits[6], 4 + 5);
});

test('ohne Hilfen: richtiger Fang ist erlaubt, vergessener Fang ist kein Schummeln', () => {
  const s = withPits([1, 0, 0, 0, 0, 3, 0, 1, 0, 0, 0, 3, 0, 0], { free: true });
  const ok = done(capture(sowFree(s, 0, 0, [1]), 0, 1), 0);
  assert.equal(ok.cheat.legal, true);
  assert.equal(ok.pits[6], 4);
  const forgot = done(sowFree(s, 0, 0, [1]), 0);
  assert.equal(forgot.cheat.legal, true);
  assert.equal(forgot.pits[6], 0);
});

test('ohne Hilfen: zurücklegen, nochmal dran zählt zusammen, Frist endet erst, wenn der andere leert', () => {
  const s = free();
  const t = take(s, 0, 3);
  assert.equal(untake(t, 0).pits[3], 4);
  assert.equal(untake(drop(t, 0, 4), 0), null);
  assert.equal(done(t, 0), null); // Steine noch in der Hand
  // geschummelt, dann nochmal dran (ehrlich) – der Ankläger holt beide Züge zurück
  const a = done(sowFree(s, 0, 0, [1, 2, 3, 6]), 0); // Mulde 4 übersprungen, letzter im Kalaha
  assert.equal(a.turn, 0);
  const b = done(sowFree(a, 0, 5, [6, 7, 8, 9]), 0);
  assert.equal(b.turn, 1);
  assert.equal(b.cheat.legal, false);
  const back = accuse(b, 1);
  assert.deepEqual(back.pits, s.pits);
  assert.equal(back.turn, 0);
  // leert der andere selbst, ist die Frist vorbei
  const c = take(b, 1, 7);
  assert.equal(c.cheat, null);
  assert.equal(accuse(c, 1), null);
});

test('ohne Hilfen: dritte Verwarnung = verloren · Gast sieht nicht, ob geschummelt wurde · Revanche gesperrt', () => {
  let s = free();
  for (let k = 0; k < 3; k++) {
    s = done(sowFree(s, 0, 0, [1, 2, 3, 6]), 0);
    s = accuse(s, 1);
  }
  assert.deepEqual(s.result, { winner: 1, reason: 'schummeln', store: [0, 0] });
  assert.equal(OUTCOME.Kalaha(s), 1);
  const t = done(sowFree(free(), 0, 0, [1, 2, 3, 4]), 0);
  const g = forGuest(t);
  assert.deepEqual(g.cheat, { player: 0 });
  const open = forGuest(take(free(), 0, 0));
  assert.equal(open.open.prev, undefined);
  assert.equal(open.open.hand, 4);
  // Partie vorbei, Schummler darf die Revanche nicht starten, solange der andere noch rufen kann
  const end = done(sowFree(withPits([0, 0, 0, 0, 0, 1, 10, 2, 0, 0, 0, 0, 1, 5], { free: true }), 0, 5, [6]), 0);
  assert.ok(end.result);
  assert.equal(rematchBlocked(end, 0), true);
  assert.equal(again(end, 0), null);
  assert.ok(again(end, 1));
  assert.ok(again(waive(end, 1), 0));
});

test('Computer: zieht regelgerecht und nimmt ein „nochmal“, wenn es zum Sieg führt', () => {
  const s = newGame();
  for (let lv = 0; lv < LEVELS.length - 1; lv++) assert.ok(legalMoves(s.pits, 0).includes(chooseMove(s.pits, 0, lv)));
  // erst Mulde 5 (1 Stein ins Kalaha, nochmal), dann Mulde 4 in die leere Mulde 5 mit Fang – und die Partie ist gewonnen
  const pits = [0, 0, 0, 0, 1, 1, 22, 1, 0, 0, 0, 0, 1, 22];
  for (const lv of [1, 2, 3]) assert.equal(chooseMove(pits, 0, lv, () => 0.99), 5);
  assert.equal(chooseMove([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0, 1), -1);
});

test('Computer: nimmt einen großen Fang', () => {
  const pits = [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0].map((n, i) => n || ([7, 8, 9].includes(i) ? 1 : 0));
  assert.equal(chooseMove(pits, 0, 2), 2); // Mulde 3 → leere Mulde 4, gegenüber 9 Steine
});

test('Computer gegen Computer: Partien laufen bis zum Ende, Stark schlägt Anfänger meistens', () => {
  let strong = 0;
  for (let g = 0; g < 10; g++) {
    let s = newGame({ starter: g % 2 });
    const lv = [2, 0]; // Spieler 0 Stark, Spieler 1 Anfänger
    for (let n = 0; n < 400 && !s.result; n++) s = move(s, s.turn, chooseMove(s.pits, s.turn, lv[s.turn]));
    assert.ok(s.result);
    if (s.result.winner === 0) strong++;
  }
  assert.ok(strong >= 8, `Stark gewinnt nur ${strong} von 10`);
});

test('Computer ohne Hilfen: ganzer Zug in einem Schritt, Schummel-Plan wird erkannt', () => {
  const s = free();
  const t = turnOf(s, 0, planOf(s.pits, 0, 2));
  assert.equal(t.seq, s.seq + 1);
  assert.equal(t.cheat.legal, true);
  assert.equal(t.turn, 0);
  assert.deepEqual(t.events.map((e) => e.type), ['take', 'drop', 'drop', 'drop', 'drop', 'done']);
  const sly = cheatTurn(s, 0, 0);
  assert.ok(sly);
  const c = turnOf(s, 0, sly);
  assert.equal(c.cheat.legal, false);
  assert.equal(total(c.pits), 48);
  // ganze Partie Computer gegen Computer ohne Hilfen, einer schummelt immer
  let g = free();
  for (let n = 0; n < 400 && !g.result; n++) {
    const p = g.turn;
    const m = chooseMove(g.pits, p, 1);
    g = turnOf(g, p, (p === 1 && cheatTurn(g, p, m)) || planOf(g.pits, p, m));
    if (g.cheat && !g.cheat.legal && !g.result) g = accuse(g, 1 - p);
    else if (g.cheat && !g.result) g = waive(g, 1 - p);
  }
  assert.ok(g.result);
  assert.equal(total(g.pits), 48);
  assert.ok(g.result.reason === 'schummeln' || g.result.reason === 'leer');
});

test('Kalaha-Nummern: Spieler 0 → 6, Spieler 1 → 13', () => {
  assert.deepEqual(STORE, [6, 13]);
});
