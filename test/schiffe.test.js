// Schiffe versenken (src/schiffe/game.js, ai.js): Hasbro-Regeln 10 × 10 mit 5 Schiffen, Computer in drei Stufen
// (Partien bis zum Ende) und „Ohne Hilfen“ mit Lügen, Extraschüssen, verschobenen Schiffen und Verwarnungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, shoot, answer, move, accuse, waive, again, cheated, score, viewFor, judge, cleanFleet, randomFleet, overlaps,
  cellsOf, shipAt, cellName, FLEET, N, MAX_STRIKES,
} from '../src/schiffe/game.js';
import { cpuCheats, cpuAccuses } from '../src/schummeln.js';
import { chooseShot, LEVELS } from '../src/schiffe/ai.js';

// Flotte untereinander links: Reihe A Träger (A1–A5), C Schlachtschiff, E Zerstörer, G U-Boot, I Patrouillenboot
const LEFT = [{ x: 0, y: 0, dir: 'h' }, { x: 0, y: 2, dir: 'h' }, { x: 0, y: 4, dir: 'h' }, { x: 0, y: 6, dir: 'h' }, { x: 0, y: 8, dir: 'h' }];
const cells = (fleet) => fleet.flatMap((s, k) => cellsOf(s, k));
// zufällige Zahlen, aber wiederholbar
function seeded(n) {
  let x = n;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}
const ready = (opts) => place(place(newGame(opts), 0, LEFT), 1, LEFT);

test('Flotte: 5 Schiffe mit 17 Feldern, Feldnamen A1–J10', () => {
  assert.deepEqual(FLEET.map((f) => f.len), [5, 4, 3, 3, 2]);
  assert.equal(FLEET.reduce((n, f) => n + f.len, 0), 17);
  assert.equal(cellName(0, 0), 'A1');
  assert.equal(cellName(9, 9), 'J10');
  assert.equal(cellName(3, 3), 'D4');
});

test('Aufstellen: nur gerade, auf dem Brett, nicht übereinander – berühren erlaubt', () => {
  assert.ok(cleanFleet(LEFT));
  const touching = [{ x: 0, y: 0, dir: 'h' }, { x: 0, y: 1, dir: 'h' }, { x: 0, y: 2, dir: 'h' }, { x: 0, y: 3, dir: 'h' }, { x: 0, y: 4, dir: 'h' }];
  assert.ok(cleanFleet(touching), 'berühren ist erlaubt');
  assert.equal(cleanFleet([{ x: 6, y: 0, dir: 'h' }, ...LEFT.slice(1)]), null, 'über den Rand');
  assert.equal(cleanFleet([{ x: 0, y: 6, dir: 'v' }, ...LEFT.slice(1)]), null, 'senkrecht über den Rand (A–J)');
  assert.equal(cleanFleet([{ x: 0, y: 0, dir: 'd' }, ...LEFT.slice(1)]), null, 'schräg');
  assert.equal(cleanFleet(LEFT.slice(0, 4)), null, 'ein Schiff fehlt');
  assert.equal(cleanFleet([{ x: 0, y: 0, dir: 'v' }, ...LEFT.slice(1)]), null, 'übereinander');
  assert.ok(cleanFleet([{ x: 0, y: 0, dir: 'v' }, ...LEFT.slice(1)], { overlap: true }));
  assert.equal(cleanFleet([{ x: 0.5, y: 0, dir: 'h' }, ...LEFT.slice(1)]), null);
  for (let i = 0; i < 200; i++) assert.ok(cleanFleet(randomFleet(seeded(i))), 'Zufall ist regelgerecht');
});

test('Start: beide stellen verdeckt auf, erst dann wird geschossen', () => {
  const s = newGame();
  assert.equal(s.phase, 'setup');
  assert.equal(shoot(s, 0, 0, 0), null);
  const one = place(s, 1, LEFT);
  assert.equal(one.phase, 'setup');
  assert.equal(place(one, 1, LEFT), null, 'nur einmal');
  assert.deepEqual(viewFor(one, 0).ready, [false, true]);
  assert.equal(viewFor(one, 0).fleets[1], null, 'fremde Flotte bleibt verdeckt');
  const both = place(one, 0, LEFT);
  assert.equal(both.phase, 'play');
  assert.deepEqual(both.events, [{ type: 'ready', by: 0 }, { type: 'go' }]);
  assert.equal(place(newGame(), 0, [{ x: 0, y: 0, dir: 'v' }, ...LEFT.slice(1)]), null);
});

test('Schießen: abwechselnd ein Schuss, auch nach Treffer; Wasser / Treffer mit Name / versenkt', () => {
  let s = ready();
  assert.equal(shoot(s, 1, 0, 0), null, 'nicht dran');
  s = shoot(s, 0, 0, 0);
  assert.deepEqual(s.events, [{ type: 'shot', by: 0, x: 0, y: 0, res: 'treffer', ship: 0 }]);
  assert.equal(s.turn, 1, 'nach dem Treffer ist der andere dran');
  assert.equal(shoot(s, 0, 1, 0), null);
  s = shoot(s, 1, 9, 9);
  assert.equal(s.events[0].res, 'wasser');
  assert.equal(s.events[0].ship, null);
  assert.equal(shoot(s, 0, 0, 0), null, 'Feld schon beschossen');
  assert.equal(shoot(s, 0, 10, 0), null);
  // Patrouillenboot (I1, I2) versenken
  s = shoot(s, 0, 0, 8);
  s = shoot(s, 1, 9, 8);
  s = shoot(s, 0, 1, 8);
  assert.deepEqual(s.events[0], { type: 'shot', by: 0, x: 1, y: 8, res: 'versenkt', ship: 4 });
  assert.equal(s.result, null);
});

test('Ganze Flotte versenkt = gewonnen, Revanche: der andere schießt zuerst', () => {
  let s = ready();
  const targets = cells(LEFT);
  let miss = 0;
  for (const [x, y] of targets) {
    s = shoot(s, 0, x, y);
    if (s.result) break;
    s = shoot(s, 1, 5 + (miss % 5), Math.floor(miss++ / 5));
  }
  assert.deepEqual(s.result, { winner: 0, reason: 'flotte' });
  assert.equal(s.shots[0].length, 17);
  assert.equal(shoot(s, 1, 9, 9), null);
  const v = viewFor(s, 1);
  assert.deepEqual(v.fleets[0], LEFT, 'am Ende wird aufgedeckt');
  assert.deepEqual(score(s), [1, 0]);
  const next = again(s, 1);
  assert.equal(next.starter, 1);
  assert.equal(next.turn, 1);
  assert.equal(next.round, 2);
  assert.deepEqual(next.wins, [1, 0]);
  assert.equal(next.phase, 'setup');
  assert.equal(again(ready(), 0), null, 'läuft noch');
});

test('judge und shipAt: versenkt erst mit dem letzten Feld', () => {
  assert.deepEqual(judge(LEFT, [], 4, 4), { res: 'wasser', ship: null });
  assert.deepEqual(judge(LEFT, [{ x: 0, y: 6 }, { x: 1, y: 6 }], 2, 6), { res: 'versenkt', ship: 3 });
  assert.deepEqual(judge(LEFT, [{ x: 0, y: 6 }], 2, 6), { res: 'treffer', ship: 3 });
  assert.equal(shipAt(LEFT, 3, 2), 1);
  assert.equal(shipAt(LEFT, 9, 9), -1);
});

// --- Computer ---
function cpuGame(levels, seed) {
  const rng = seeded(seed);
  let s = place(place(newGame({ starter: seed % 2 }), 0, randomFleet(rng)), 1, randomFleet(rng));
  const used = [0, 0];
  while (!s.result) {
    const p = s.turn;
    const { x, y } = chooseShot(viewFor(s, p), p, levels[p], rng);
    s = shoot(s, p, x, y);
    assert.ok(s, `Computer schießt ungültig (${x}, ${y})`);
    used[p]++;
    assert.ok(used[p] <= N * N);
  }
  return { winner: s.result.winner, shots: used[s.result.winner] };
}

test('Computer gegen Computer: jede Stufe spielt bis zum Ende', () => {
  for (const [i] of LEVELS.entries()) {
    for (let seed = 1; seed <= 4; seed++) {
      const r = cpuGame([i, i], seed * 7 + i);
      assert.ok(r.winner === 0 || r.winner === 1);
      assert.ok(r.shots >= 17 && r.shots <= 100);
    }
  }
});

test('Stufen: Stark braucht im Schnitt weniger Schüsse als Mittel, Mittel weniger als Leicht', () => {
  const avg = (level) => {
    let sum = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const rng = seeded(seed * 31 + level);
      let s = place(place(newGame(), 0, randomFleet(rng)), 1, randomFleet(rng));
      let n = 0;
      while (!s.result) { // nur Spieler 0 schießt, Spieler 1 wartet (schießt aufs immer gleiche Feld nicht – daher Zug direkt zurück)
        const { x, y } = chooseShot(viewFor(s, 0), 0, level, rng);
        s = shoot(s, 0, x, y);
        n++;
        if (!s.result) s = { ...s, turn: 0 };
      }
      sum += n;
    }
    return sum / 30;
  };
  const [easy, mid, hard] = [avg(0), avg(1), avg(2)];
  assert.ok(mid < easy - 10, `Mittel ${mid} gegen Leicht ${easy}`);
  assert.ok(hard < mid - 3, `Stark ${hard} gegen Mittel ${mid}`);
});

test('Stark und Mittel jagen nach einem Treffer am Schiff weiter', () => {
  let s = ready();
  s = shoot(s, 0, 2, 4); // Treffer Zerstörer E3
  s = shoot(s, 1, 9, 9);
  for (const level of [1, 2]) {
    for (let i = 0; i < 20; i++) {
      const { x, y } = chooseShot(viewFor(s, 0), 0, level, Math.random);
      assert.equal(Math.abs(x - 2) + Math.abs(y - 4), 1, `Stufe ${level}: Nachbarfeld`);
    }
  }
});

// --- Ohne Hilfen ---
const free = () => ready({ free: true });

test('ohne Hilfen: Schuss wartet auf die Antwort des Beschossenen', () => {
  let s = free();
  s = shoot(s, 0, 0, 0);
  assert.deepEqual(s.pending, { by: 0, x: 0, y: 0 });
  assert.equal(s.shots[0][0].res, null);
  assert.equal(shoot(s, 1, 5, 5), null, 'erst antworten');
  assert.equal(answer(s, 0, { res: 'wasser' }), null, 'nur der Beschossene');
  assert.equal(answer(s, 1, { res: 'treffer' }), null, 'Treffer braucht den Namen');
  assert.equal(answer(s, 1, { res: 'wasser', ship: 2 }), null);
  s = answer(s, 1, { res: 'treffer', ship: 0 });
  assert.deepEqual(s.events, [{ type: 'answer', by: 1, x: 0, y: 0, res: 'treffer', ship: 0 }]);
  assert.equal(s.pending, null);
  assert.equal(s.turn, 1);
  // Sicht: die Wahrheit hinter der Antwort sieht der Schütze nicht, home nie
  const v = viewFor(s, 0);
  assert.equal(v.shots[0][0].truth, undefined);
  assert.equal(v.home, undefined);
  assert.deepEqual(v.open, [{}, {}]);
});

test('ohne Hilfen: Lüge erwischt – Antwort berichtigt, Verwarnung, Grund nennt Feld und Antwort', () => {
  let s = free();
  s = shoot(s, 0, 0, 0);
  s = answer(s, 1, { res: 'wasser' });
  const c = accuse(s, 0);
  assert.equal(c.verdict.caught, true);
  assert.equal(c.verdict.player, 1);
  assert.equal(c.verdict.why, 'auf A1 „Wasser“ statt „Treffer – Flugzeugträger“ gesagt');
  assert.deepEqual(c.strikes, [0, 1]);
  assert.equal(c.shots[0][0].res, 'treffer');
  assert.equal(c.shots[0][0].ship, 0);
  assert.equal(c.open[1], null);
  assert.equal(c.turn, 1, 'wer dran war, bleibt dran');
  assert.equal(accuse(c, 0), null, 'nichts Neues zu prüfen');
  assert.equal(c.events[0].type, 'caught');
});

test('ohne Hilfen: Fehlalarm kostet den Ankläger eine Verwarnung, die dritte die Partie', () => {
  let s = free();
  s = shoot(s, 0, 0, 0);
  s = answer(s, 1, { res: 'treffer', ship: 0 });
  const f = accuse(s, 0);
  assert.deepEqual(f.verdict, { caught: false, player: 0, by: 0 });
  assert.deepEqual(f.strikes, [1, 0]);
  assert.equal(f.events[0].type, 'fehlalarm');
  let t = { ...f, strikes: [MAX_STRIKES - 1, 0] };
  t = shoot(t, 1, 5, 5);
  t = answer(t, 0, { res: 'wasser' });
  t = accuse(t, 0); // Spieler 1 hat ehrlich geschossen → Fehlalarm, dritte Verwarnung
  assert.deepEqual(t.result, { winner: 1, reason: 'schummeln' });
});

test('ohne Hilfen: zweimal geschossen – erwischt nimmt den Extraschuss heraus', () => {
  let s = free();
  s = shoot(s, 0, 9, 9);
  s = answer(s, 1, { res: 'wasser' });
  s = shoot(s, 0, 9, 8); // nochmal, obwohl 1 dran ist
  assert.ok(s);
  assert.equal(s.pending.by, 0);
  const c = accuse(s, 1);
  assert.equal(c.verdict.why, 'zweimal hintereinander geschossen');
  assert.deepEqual(c.shots[0].map((t) => cellName(t.x, t.y)), ['J10']);
  assert.equal(c.pending, null);
  assert.equal(c.turn, 1);
  // außer der Reihe zu Beginn
  const d = shoot(free(), 1, 3, 3);
  assert.equal(accuse(answer(d, 0, { res: 'wasser' }), 0).verdict.why, 'außer der Reihe geschossen');
});

test('ohne Hilfen: Schiff verschoben – erwischt kommt es zurück, Antworten nach der Wahrheit', () => {
  let s = free();
  s = shoot(s, 0, 0, 0);
  s = answer(s, 1, { res: 'treffer', ship: 0 });
  s = move(s, 1, 0, { x: 5, y: 9, dir: 'h' }); // Träger aus dem Schussfeld
  assert.equal(viewFor(s, 0).events.length, 0, 'der andere merkt das Verschieben nicht');
  assert.deepEqual(viewFor(s, 1).events, [{ type: 'move', by: 1 }]);
  s = shoot(s, 1, 9, 9);
  s = answer(s, 0, { res: 'wasser' });
  s = shoot(s, 0, 1, 0); // trifft jetzt nichts mehr
  s = answer(s, 1, { res: 'wasser' }); // stimmt sogar (nach dem Verschieben)
  const c = accuse(s, 0);
  assert.equal(c.verdict.why, 'Flugzeugträger verschoben');
  assert.deepEqual(c.fleets[1][0], LEFT[0]);
  assert.equal(c.shots[0][1].res, 'treffer', 'B1 ist nach dem Zurückschieben wieder ein Treffer');
  // zurückgeschoben vor der Anklage = nichts passiert
  let t = move(free(), 1, 0, { x: 5, y: 9, dir: 'h' });
  t = move(t, 1, 0, LEFT[0]);
  assert.equal(accuse(t, 0).verdict.caught, false);
});

test('ohne Hilfen: Schiff weg- und zurückgeschoben, dazwischen „Wasser“ – trotzdem erwischt', () => {
  let s = free();
  s = move(s, 1, 0, { x: 5, y: 9, dir: 'h' }); // Träger aus Reihe A weg
  s = shoot(s, 0, 2, 0); // A3 – jetzt leer
  s = answer(s, 1, { res: 'wasser' }); // passt zur verschobenen Flotte, keine Lüge
  s = move(s, 1, 0, LEFT[0]); // und zurück
  assert.equal(cheated(s, 1), true);
  const c = accuse(s, 0);
  assert.equal(c.verdict.caught, true);
  assert.equal(c.verdict.why, 'auf A3 „Wasser“ statt „Treffer – Flugzeugträger“ gesagt');
  assert.equal(c.shots[0][0].res, 'treffer');
  assert.equal(c.shots[0][0].ship, 0);
  // ehrlich nach einem erwischten Extraschuss: „versenkt“ ohne den Extraschuss bleibt ehrlich
  let t = free();
  t = answer(shoot(t, 0, 0, 4), 1, { res: 'treffer', ship: 2 }); // E1
  t = answer(shoot(t, 0, 1, 4), 1, { res: 'treffer', ship: 2 }); // E2, zweimal hintereinander
  t = answer(shoot(t, 1, 9, 9), 0, { res: 'wasser' });
  t = answer(shoot(t, 0, 2, 4), 1, { res: 'versenkt', ship: 2 }); // E3
  t = accuse(t, 1);
  assert.equal(t.verdict.caught, true);
  assert.deepEqual(t.shots[0].map((x) => cellName(x.x, x.y)), ['E1', 'E3']);
  t = answer(shoot(t, 1, 9, 8), 0, { res: 'wasser' });
  assert.equal(accuse(t, 0).verdict.caught, false, 'Antworten von 1 passen weiter zur Flotte');
});

test('ohne Hilfen: übereinander aufgestellt – erwischt werden die Schiffe neu verteilt', () => {
  const stacked = [{ x: 0, y: 0, dir: 'h' }, { x: 0, y: 0, dir: 'h' }, { x: 0, y: 0, dir: 'v' }, { x: 0, y: 6, dir: 'h' }, { x: 0, y: 8, dir: 'h' }];
  let s = place(place(newGame({ free: true }), 0, LEFT), 1, stacked);
  assert.equal(s.phase, 'play');
  s = shoot(s, 0, 4, 4);
  s = answer(s, 1, { res: 'wasser' });
  const c = accuse(s, 0, seeded(3));
  assert.equal(c.verdict.why, 'Schiffe übereinander aufgestellt');
  assert.equal(overlaps(c.fleets[1]), false);
  assert.deepEqual(c.fleets[1][0], stacked[0], 'das erste bleibt liegen');
  assert.ok(!cells(c.fleets[1]).some(([x, y]) => x === 4 && y === 4), 'nicht auf schon beschossene Felder');
});

test('ohne Hilfen: echte letzte Versenkung beendet sofort – wer dabei geschummelt hat, verliert danach', () => {
  let s = free();
  const targets = cells(LEFT);
  let row = 0;
  for (const [i, [x, y]] of targets.entries()) {
    s = shoot(s, 0, x, y);
    if (s.result) break;
    s = answer(s, 1, { res: i === 3 ? 'wasser' : 'treffer', ship: i === 3 ? null : shipAt(LEFT, x, y) }); // einmal gelogen
    s = shoot(s, 1, 5 + (row % 5), Math.floor(row++ / 5));
    s = answer(s, 0, { res: 'wasser' });
  }
  assert.deepEqual(s.result, { winner: 0, reason: 'flotte' });
  assert.equal(s.pending, null);
  assert.equal(again(s, 0), null, 'der Sieger kann noch erwischt werden');
  const c = accuse(s, 0); // Verlierer hat gelogen
  assert.equal(c.verdict.caught, true);
  assert.deepEqual(c.result, { winner: 0, reason: 'flotte' }, 'Sieg bleibt');
  assert.ok(again(c, 1));
  // Sieger schummelt (zweimal geschossen) und wird nach dem Ende erwischt → verliert
  let w = free();
  w = shoot(w, 0, 9, 9);
  w = answer(w, 1, { res: 'wasser' });
  w = shoot(w, 0, 9, 8); // Extraschuss
  w = answer(w, 1, { res: 'wasser' });
  w = { ...w, shots: [[...w.shots[0], ...targets.slice(0, 16).map(([x, y]) => ({ x, y, res: 'treffer', ship: shipAt(LEFT, x, y) }))], w.shots[1]] };
  w = shoot(w, 0, ...targets[16]);
  assert.equal(w.result.winner, 0);
  const lost = accuse(w, 1);
  assert.deepEqual(lost.result, { winner: 1, reason: 'aberkannt' });
  assert.ok(again(lost, 0));
});

test('ohne Hilfen: Revanche nimmt die Siege mit, normal ohne Schummel-Felder', () => {
  const s = newGame();
  assert.equal(s.free, undefined);
  assert.equal(s.open, undefined);
  const f = newGame({ free: true });
  assert.deepEqual(f.strikes, [0, 0]);
  assert.equal(answer(ready(), 1, { res: 'wasser' }), null, 'normal antwortet das Spiel');
  assert.equal(move(ready(), 1, 0, { x: 5, y: 9, dir: 'h' }), null);
  assert.equal(accuse(ready(), 0), null);
});

test('ohne Hilfen allein: cheated sagt dem Computer die Wahrheit, waive schließt die Frist ohne Verwarnung', () => {
  let s = free();
  s = shoot(s, 0, 0, 0);
  assert.equal(cheated(s, 0), false, 'ehrlicher Schuss');
  s = answer(s, 1, { res: 'wasser' });
  assert.equal(cheated(s, 1), true, 'gelogen');
  assert.equal(cheated(ready(), 0), false, 'normal gibt es nichts zu prüfen');
  const w = waive(s, 0);
  assert.equal(w.open[1], null);
  assert.deepEqual(w.strikes, [0, 0]);
  assert.equal(accuse(w, 0), null, 'nichts mehr offen');
  assert.equal(waive(ready(), 0), null);
});

// Allein ohne Hilfen wie in index.js: der Computer (1) lügt mal „Wasser“ bei Treffern oder schießt zweimal und prüft den
// Menschen nach jedem Zug mit 25 %, am Ende immer; der „Mensch“ (0) schummelt hier auch ab und zu und ruft selten
function soloFree(seed) {
  const rng = seeded(seed);
  let s = place(place(newGame({ free: true }), 0, randomFleet(rng)), 1, randomFleet(rng));
  let [lie, extra, steps] = [false, false, 0];
  const judged = new Set();
  const fire = (p) => {
    const { x, y } = chooseShot(viewFor(s, p), p, 2, rng);
    return shoot(s, p, x, y);
  };
  while (!s.result && steps++ < 2000) {
    if (s.pending) {
      const by = s.pending.by;
      const shot = s.shots[by].find((t) => t.res === null);
      if (by === 0) {
        if (s.open[0] && !judged.has(s.seq) && (judged.add(s.seq), rng() < 0.25) && cpuAccuses(cheated(s, 0), rng)) { s = accuse(s, 1, rng); continue; }
        const fib = lie && shot.truth.res !== 'wasser';
        if (fib) lie = false;
        s = answer(s, 1, fib ? { res: 'wasser', ship: null } : shot.truth);
      } else s = answer(s, 0, rng() < 0.05 ? { res: 'wasser', ship: null } : shot.truth); // der Mensch lügt selten
      continue;
    }
    if (s.open[1] && rng() < 0.03) { s = accuse(s, 0, rng); continue; }
    if (extra && s.turn === 0) { extra = false; s = fire(1); continue; }
    if (s.turn === 1 && cpuCheats(rng)) rng() < 0.5 ? (lie = true) : (extra = true);
    s = fire(s.turn === 1 && rng() < 0.03 ? 0 : s.turn); // ab und zu schießt der Mensch außer der Reihe
    assert.ok(s, 'Schuss geht immer');
  }
  return s;
}

test('ohne Hilfen allein: Partien mit Lügen, Extraschüssen und Anklagen enden sauber', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let s = soloFree(seed);
    assert.ok(s.result, `Partie ${seed} endet`);
    assert.ok(s.strikes.every((n) => n <= MAX_STRIKES));
    if (s.open[0] && s.result.winner === 0) s = cpuAccuses(cheated(s, 0), seeded(seed)) ? accuse(s, 1) : waive(s, 1);
    assert.ok(s.result);
    assert.ok(again(s, 0) || again(s, 1), 'Revanche geht');
  }
});
