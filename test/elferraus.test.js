// Elfer raus (src/elferraus/game.js, ai.js): Regeln nach der Ravensburger-Anleitung, Sichten, „Ohne Hilfen“, Computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, setup, play, draw, end, again, regroup, accuse, waive, viewFor, playable, canDraw, canEnd, fits, makeDeck,
  points, nextSeat, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from '../src/elferraus/game.js';
import { chooseMove, cheatMove, worth } from '../src/elferraus/ai.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const row = (mid, left = [], right = []) => ({ mid, left, right });
// Fester Stand mitten im Spiel: zwei Spieler (Sitze 0 und 2), Rot liegt bis 10 und 12
function fixed({ hand0, hand2, talon = ['g1', 'g2', 'g3', 'g4'], free = false, rows } = {}) {
  return {
    ...newGame({ humans: [0, 2], free }),
    phase: 'play', count: 2, seats: [0, 2], colors: ['r', 'y', 'g'], round: 1,
    hands: [hand0, [], hand2, []], talon,
    rows: rows ?? { r: row(true, ['r10'], ['r12']), y: row(false), g: row(false) },
    starter: 2, turn: 0,
  };
}

test('Karten: 80 bzw. zu zweit 60 ohne Blau, je 1–20', () => {
  assert.equal(makeDeck(4).length, 80);
  assert.equal(new Set(makeDeck(4)).size, 80);
  assert.equal(makeDeck(2).length, 60);
  assert.ok(!makeDeck(2).some((c) => c[0] === 'b'));
  assert.ok(makeDeck(3).includes('b20') && makeDeck(3).includes('r1'));
});

test('Austeilen: 20/20/15 Karten, Rest als Stapel, der rote Elfer (sonst Gelb, Grün, Blau) liegt und der Nächste ist dran', () => {
  for (const [n, size, talon] of [[2, 20, 19], [3, 20, 19], [4, 15, 19]]) {
    for (let seed = 1; seed <= 30; seed++) {
      const s = setup(newGame(), 0, n, seeded(seed));
      const e = s.events[0];
      assert.equal(e.type, 'deal');
      const all = [...s.seats.flatMap((p) => s.hands[p]), ...s.talon, e.first];
      assert.equal(all.length, n === 2 ? 60 : 80);
      assert.equal(new Set(all).size, all.length);
      assert.equal(s.talon.length, n === 2 ? talon + 1 : 80 - n * size); // ohne die ausgelegte 11
      for (const p of s.seats) assert.equal(s.hands[p].length + (p === e.starter ? 1 : 0), size);
      // kein höherrangiger Elfer in einer Hand
      const order = ['r11', 'y11', 'g11', 'b11'];
      for (const c of order.slice(0, order.indexOf(e.first))) assert.ok(s.talon.includes(c), `${c} müsste im Stapel sein`);
      assert.equal(s.turn, nextSeat(s.seats, e.starter));
      assert.ok(s.rows[e.first[0]].mid);
    }
  }
  assert.deepEqual(SEATS(2), [0, 2]);
  assert.deepEqual(SEATS(3), [0, 1, 2]);
});
const SEATS = (n) => setup(newGame(), 0, n, seeded(7)).seats;

test('Nur der Host wählt die Spielerzahl', () => {
  assert.equal(setup(newGame(), 2, 2), null);
  assert.equal(setup(newGame(), 0, 5), null);
});

test('Anlegen: an die oberste Karte abwärts bis 1 oder aufwärts bis 20, Elfer öffnen eine neue Reihe', () => {
  const rows = { r: row(true, ['r10', 'r9'], []), y: row(false) };
  assert.ok(fits(rows, 'r8'));
  assert.ok(fits(rows, 'r12'));
  assert.ok(!fits(rows, 'r7'));
  assert.ok(!fits(rows, 'r13'));
  assert.ok(fits(rows, 'y11'));
  assert.ok(!fits(rows, 'y10'));
  assert.ok(!fits(rows, 'g11')); // Farbe nicht im Spiel
});

test('Mehrere Karten in einem Zug, „Fertig“ erst nach einer Karte; nichts passt mehr → der Nächste ist dran', () => {
  let s = fixed({ hand0: ['r9', 'r8', 'r13', 'y5'], hand2: ['g7'] });
  assert.equal(end(s, 0), null); // es passt etwas – nicht einfach weitergeben
  assert.equal(draw(s, 0), null); // und auch nicht ziehen
  s = play(s, 0, 'r9');
  assert.equal(s.turn, 0);
  assert.ok(canEnd(s, 0));
  s = play(s, 0, 'r8');
  s = play(s, 0, 'r13'); // jetzt passt nichts mehr (y5)
  assert.equal(s.turn, 2);
  assert.deepEqual(s.rows.r.left, ['r10', 'r9', 'r8']);
  assert.deepEqual(s.rows.r.right, ['r12', 'r13']);
  assert.equal(s.events.at(-1).type, 'end');
});

test('Karten zurückhalten ist erlaubt: nach einer Karte „Fertig“, obwohl noch etwas passt', () => {
  let s = play(fixed({ hand0: ['r9', 'r8', 'y5'], hand2: ['g7'] }), 0, 'r9');
  s = end(s, 0);
  assert.equal(s.turn, 2);
  assert.deepEqual(s.hands[0], ['r8', 'y5']);
});

test('Nachziehen: bis zu 3 Karten; passt eine, wird nur sie gelegt und der Zug ist vorbei', () => {
  let s = fixed({ hand0: ['y5'], hand2: ['g7', 'g8'], talon: ['g1', 'r13', 'g4', 'y3'] });
  assert.ok(canDraw(s, 0));
  s = draw(s, 0); // y3
  assert.equal(s.turn, 0);
  assert.equal(end(s, 0), null); // weiterziehen ist Pflicht
  s = draw(s, 0); // g4
  s = draw(s, 0); // r13 passt
  assert.deepEqual(playable(s, 0), ['r13']);
  assert.equal(draw(s, 0), null);
  assert.equal(play(s, 0, 'y5'), null);
  s = play(s, 0, 'r13');
  assert.equal(s.turn, 2);
  assert.deepEqual(s.hands[0], ['y5', 'y3', 'g4']);
});

test('Nach 3 Karten ohne Treffer ist der Nächste dran; Stapel leer = passen', () => {
  let s = fixed({ hand0: ['y5'], hand2: ['g7'], talon: ['g1', 'g2', 'g3', 'g4'] });
  s = draw(draw(draw(s, 0), 0), 0);
  assert.equal(s.turn, 2);
  assert.equal(s.hands[0].length, 4);
  let t = fixed({ hand0: ['y5'], hand2: ['g7'], talon: [] });
  assert.equal(draw(t, 0), null);
  assert.ok(canEnd(t, 0));
  t = end(t, 0);
  assert.equal(t.turn, 2);
  // Stapel wird beim Ziehen leer: Zug endet sofort
  let u = fixed({ hand0: ['y5'], hand2: ['g7'], talon: ['g4'] });
  u = draw(u, 0);
  assert.equal(u.turn, 2);
});

test('Wer zuerst keine Karte mehr hat, gewinnt – die anderen schreiben ihre Restpunkte auf', () => {
  let s = fixed({ hand0: ['r9'], hand2: ['g7', 'y20'] });
  s = play(s, 0, 'r9');
  assert.equal(s.phase, 'over');
  assert.equal(s.result.winner, 0);
  assert.deepEqual(s.result.points, [0, 0, 27, 0]);
  assert.deepEqual(s.score, [0, 0, 27, 0]);
  assert.equal(s.list.length, 1);
  const n = again(s, 2, seeded(3));
  assert.equal(n.round, 2);
  assert.deepEqual(n.score, [0, 0, 27, 0]);
  const r = regroup(s, 0);
  assert.equal(r.phase, 'setup');
  assert.equal(regroup(s, 2), null);
  assert.equal(points(['r1', 'b20']), 21);
});

test('Sicht: fremde Hände nur als Anzahl, gezogene Karte nur für den Ziehenden, nach der Runde alles offen', () => {
  const s = draw(fixed({ hand0: ['y5'], hand2: ['g7'] }), 0);
  const v2 = viewFor(s, 2);
  assert.equal(v2.hands[0], 2);
  assert.equal(v2.talon, 3);
  assert.equal(v2.fresh, null);
  assert.equal(v2.events[0].card, null);
  assert.equal(viewFor(s, 0).events[0].card, 'g4');
  const over = play(fixed({ hand0: ['r9'], hand2: ['g7'] }), 0, 'r9');
  assert.deepEqual(viewFor(over, 0).hands[2], ['g7']);
});

test('Ohne Hilfen: regelwidrige Züge gehen durch, „Geschummelt!“ nimmt den ganzen Zug zurück + 2 Strafkarten, mit Grund', () => {
  const start = fixed({ hand0: ['r9', 'r5', 'y5'], hand2: ['g7'], free: true, talon: ['g1', 'g2', 'g3', 'g4', 'g5'] });
  let s = play(start, 0, 'r9');
  s = play(s, 0, 'r5'); // ohne Anschluss
  assert.deepEqual(s.rows.r.left, ['r10', 'r9', 'r5']);
  s = draw(s, 0); // nach dem Anlegen gezogen
  s = end(s, 0);
  assert.equal(s.turn, 2);
  assert.deepEqual(viewFor(s, 2).cheat, { player: 0 });
  const c = accuse(s, 2);
  assert.equal(c.events[0].type, 'caught');
  assert.equal(c.events[0].why, 'Rot 5 passt nicht an Rot 9 und nach dem Anlegen noch gezogen');
  assert.equal(c.turn, 0);
  assert.deepEqual(c.rows, start.rows);
  assert.deepEqual(c.hands[0], ['r9', 'r5', 'y5', 'g5', 'g4']);
  assert.equal(c.hands[0].length, 3 + CHEAT_PENALTY);
  assert.equal(c.cheat, null);
});

test('Ohne Hilfen: weitere Verstöße mit Grund – nicht nachziehen, nichts legen, mehr als 3 ziehen, ohne Elfer anlegen', () => {
  const why = (s, by = 2) => accuse(s, by).events[0].why;
  const base = (o = {}) => fixed({ hand0: ['y5'], hand2: ['g7'], free: true, talon: ['g1', 'g2', 'g3', 'g4', 'g5'], ...o });
  assert.equal(why(end(base(), 0)), 'nicht nachgezogen, obwohl nichts passte');
  assert.equal(why(end(draw(base(), 0), 0)), 'nur 1 statt bis zu 3 Karten nachgezogen');
  assert.equal(why(draw(draw(draw(draw(base(), 0), 0), 0), 0)), '4 Karten gezogen statt höchstens 3');
  assert.equal(why(end(base({ hand0: ['r9', 'y5'] }), 0)), 'nichts angelegt, obwohl eine Karte passte');
  assert.equal(why(play(base(), 0, 'y5')), 'Gelb 5 gelegt, bevor Gelb 11 lag');
  assert.equal(why(draw(base({ hand0: ['r9', 'y5'] }), 0)), 'gezogen, obwohl eine Karte passte');
});

test('Ohne Hilfen: Fehlalarm kostet den Ankläger 1 Karte; anfechtbar nur bis der Nächste etwas tut', () => {
  let s = play(fixed({ hand0: ['r9', 'y5'], hand2: ['g7', 'g8'], free: true }), 0, 'r9');
  s = end(s, 0);
  const f = accuse(s, 2);
  assert.equal(f.events[0].type, 'fehlalarm');
  assert.equal(f.hands[2].length, 2 + FALSE_ALARM_PENALTY);
  assert.equal(f.cheat, null);
  const later = draw(s, 2); // der Nächste hat etwas getan
  assert.equal(later.cheat.player, 2);
  assert.equal(accuse(later, 2), null); // sich selbst anklagen geht nicht
  const back = accuse(later, 0);
  assert.equal(back.events[0].type, 'fehlalarm'); // Zug von 2 war bisher regelgerecht
});

test('Ohne Hilfen: Sieg mit Schummelzug lässt sich noch anfechten; der Schummler startet die nächste Runde nicht', () => {
  const s = play(fixed({ hand0: ['r5'], hand2: ['g7'], free: true }), 0, 'r5');
  assert.equal(s.phase, 'over');
  assert.equal(again(s, 0), null);
  assert.equal(regroup(s, 0), null);
  const c = accuse(s, 2);
  assert.equal(c.phase, 'play');
  assert.equal(c.result, null);
  assert.deepEqual(c.score, [0, 0, 0, 0]);
  assert.ok(waive(s, 2));
  assert.ok(again(waive(s, 2), 0, seeded(1)));
  // Fehlalarm nach Rundenende: die Strafkarte zählt als Punkte
  const fair = play(fixed({ hand0: ['r9'], hand2: ['g7'], free: true }), 0, 'r9');
  const f = accuse(fair, 2);
  assert.equal(f.result.points[2], 7 + 4); // g7 + gezogene g4
  assert.equal(f.list[0].points[2], 11);
});

test('Ohne Hilfen: Anklage gilt nur dem gemeinten Zug – hat inzwischen ein anderer gespielt, zählt sie nicht', () => {
  let s = end(fixed({ hand0: ['r9', 'y5'], hand2: ['g7', 'g8'], free: true }), 0); // 0 hält Rot 9 zurück
  assert.equal(accuse(s, 2, 0).events[0].type, 'caught');
  s = draw(s, 2); // der Nächste hat schon gezogen – jetzt ist sein Zug offen
  assert.equal(accuse(s, 0, 2).events[0].type, 'fehlalarm');
  assert.equal(accuse(s, 2, 0), null); // Gast meinte noch den Zug von 0: zu spät, kein Fehlalarm
});

test('Ohne Hilfen: Strafkarte nach einem Patt-Ende kann den Sieger ändern', () => {
  let s = fixed({ hand0: ['r5'], hand2: ['r3', 'g7'], free: true, talon: [], rows: { r: row(true, ['r10', 'r9', 'r4'], []), y: row(false), g: row(false) } });
  s = end(end(s, 0), 2);
  assert.equal(s.result.winner, 0); // 5 gegen 10 Punkte
  s = { ...s, talon: ['g20'] }; // (Stapel nur für den Test wieder gefüllt)
  const f = accuse(s, 0); // Fehlalarm? Nein – 2 hat nicht nachgezogen, obwohl nichts passte: erwischt
  assert.equal(f.events[0].type, 'caught');
  const t = { ...s, cheat: { ...s.cheat, legal: true } };
  const g = accuse(t, 0); // Fehlalarm: 0 zieht g20 → 25 Punkte, jetzt ist 2 vorn
  assert.equal(g.result.points[0], 25);
  assert.equal(g.result.winner, 2);
});

test('Geht gar nichts mehr (Stapel leer, eine Runde ohne Anlegen), endet die Runde – vorn ist, wer weniger Punkte hat', () => {
  let s = fixed({ hand0: ['r5'], hand2: ['r3', 'g7'], free: true, talon: [], rows: { r: row(true, ['r10', 'r9', 'r4'], []), y: row(false), g: row(false) } });
  s = end(s, 0);
  s = end(s, 2);
  assert.equal(s.phase, 'over');
  assert.equal(s.result.out, false);
  assert.equal(s.result.winner, 0);
});

test('Computer: hält einen Elfer zurück, wenn er in dieser Farbe nichts hat, und legt lieber eigene Ketten', () => {
  const v = viewFor(fixed({ hand0: ['y11', 'r9', 'r8', 'r7', 'g3'], hand2: ['g7'] }), 0);
  assert.ok(worth(v, 0, 'y11') < 0);
  assert.ok(worth(v, 0, 'r9') > 0);
  assert.deepEqual(chooseMove(v, 0), { t: 'play', arg: 'r9' });
  // nach der Kette hört er auf, statt den Elfer zu verschenken
  let s = fixed({ hand0: ['y11', 'r9', 'g3', 'g15', 'r20'], hand2: ['g7', 'g8', 'g9', 'g10'] });
  s = play(s, 0, 'r9');
  assert.deepEqual(chooseMove(viewFor(s, 0), 0), { t: 'end' });
  // im Endspiel (anderer hat nur noch wenige Karten) legt er alles
  let e = fixed({ hand0: ['y11', 'r9', 'g3', 'g15', 'r20'], hand2: ['g7', 'g8'] });
  e = play(e, 0, 'r9');
  assert.deepEqual(chooseMove(viewFor(e, 0), 0), { t: 'play', arg: 'y11' });
});

test('Computer-Partien zu 2, 3 und 4 laufen durch – mit und ohne Hilfen, jede Aktion gültig', () => {
  for (const n of [2, 3, 4]) {
    for (const free of [false, true]) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = seeded(seed * 31 + n);
        let s = setup(newGame({ free }), 0, n, rng);
        let steps = 0;
        while (s.phase === 'play') {
          assert.ok(steps++ < 2000, 'Partie hängt');
          const seat = s.turn;
          const v = viewFor(s, seat);
          if (free && s.cheat && s.cheat.player !== seat && rng() < 0.3) {
            s = accuse(s, seat);
            assert.ok(s);
            continue;
          }
          const m = (free && !v.played && !v.drawn && rng() < 0.15 && cheatMove(v, seat, rng)) || chooseMove(v, seat);
          const next = m.t === 'play' ? play(s, seat, m.arg) : m.t === 'draw' ? draw(s, seat) : end(s, seat);
          assert.ok(next, `ungültig: ${JSON.stringify(m)} (n=${n}, free=${free}, seed=${seed})`);
          s = next;
        }
        assert.equal(s.phase, 'over');
        if (!free) assert.equal(s.result.out, true);
      }
    }
  }
});

// Ablauf in index.js (Review 21.10.2026): Der Gast ruft „Geschummelt!“, der Host antwortet – danach darf ein ganz
// normaler neuer Stand nicht mehr „Zu spät“ zeigen.
test('index.js Gast: „Zu spät“ nur als Antwort auf die eigene Anklage, nicht bei jedem weiteren Stand', async () => {
  const { ui, base: io } = await import('../test-stubs/index-harness.js');
  const { startElferRaus } = await import('../src/elferraus/index.js');
  const sent = [];
  const g = startElferRaus({ ...io, me: 1, free: true, send: (m) => sent.push(m) });
  const s = setup(newGame({ humans: [0, 2], free: true }), 0, 2, seeded(5));
  const view = (extra) => ({ ...viewFor(s, 2), ...extra });
  g.handle({ t: 'state', state: view({ cheat: { player: 0 } }) });
  ui.cheat.onAccuse();
  assert.equal(sent.at(-1).t, 'accuse');
  g.handle({ t: 'state', state: view({ seq: s.seq + 1, cheat: null, events: [{ type: 'fehlalarm', player: 2, target: 0 }] }) });
  assert.equal(ui.shown.hint, '');
  g.handle({ t: 'state', state: view({ seq: s.seq + 2, cheat: null, events: [] }) }); // z. B. der nächste Zug des Hosts
  assert.equal(ui.shown.hint, '', 'kein hängender „Zu spät“-Hinweis');
  g.handle({ t: 'state', state: view({ seq: s.seq + 3, cheat: { player: 0 }, events: [] }) });
  ui.cheat.onAccuse();
  g.handle({ t: 'state', state: view({ seq: s.seq + 4, cheat: null, events: [] }) }); // Anklage kam zu spät
  assert.match(ui.shown.hint, /Zu spät/);
  g.stop();
});
