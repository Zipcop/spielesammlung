// Mäxchen (src/maexchen/game.js, ai.js): Rangfolge, Ansagen, Glauben/Aufdecken, Leben, Ausscheiden, Sicht je Spieler,
// „Ohne Hilfen“ (Schummeln und Anklagen) und ein paar Simulationen, ob der Computer sinnvoll spielt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, roll, announce, believe, doubt, accept, peek, accuse, again, waive, viewFor, valueOf, rankOf, claimName, alive,
  CLAIMS, LIVES, MAEXCHEN, chanceOf,
} from '../src/maexchen/game.js';
import { chooseDecision, chooseClaim, truthChance, claimDist, observe, wantsReroll } from '../src/maexchen/ai.js';

// kleiner fester Zufall für reproduzierbare Läufe
function rngOf(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}
const start = (opts = {}) => newGame({ starter: 0, ...opts });
const seq = (s, ...steps) => steps.reduce((x, f) => {
  const next = f(x);
  assert.ok(next, 'Schritt ungültig');
  return next;
}, s);

test('Wert und Rangfolge: höhere Zahl ist die Zehnerstelle, 21 ist das Höchste', () => {
  assert.equal(valueOf([3, 5]), 53);
  assert.equal(valueOf([1, 2]), 21);
  assert.equal(valueOf([4, 4]), 44);
  assert.ok(rankOf(31) < rankOf(32) && rankOf(65) < rankOf(11));
  assert.ok(rankOf(11) < rankOf(66) && rankOf(66) < rankOf(21));
  assert.equal(CLAIMS.length, 21);
  assert.equal(claimName(21), 'Mäxchen');
  assert.equal(claimName(33), 'Dreierpasch');
  assert.equal(claimName(54), '54');
  const total = CLAIMS.reduce((a, v) => a + chanceOf(v), 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'alle 36 Würfe verteilt');
});

test('Ablauf: würfeln, ansagen, der Nächste ist dran und entscheidet', () => {
  let s = start();
  assert.equal(s.phase, 'roll');
  assert.equal(s.turn, 0);
  assert.equal(announce(s, 0, 31), null, 'erst würfeln');
  assert.equal(roll(s, 1, [1, 1]), null, 'nicht am Zug');
  assert.equal(roll(s, 0, [7, 1]), null, 'kein Würfel');
  s = roll(s, 0, [3, 1]);
  assert.equal(s.phase, 'announce');
  assert.equal(roll(s, 0, [6, 6]), null, 'normal nur einmal würfeln');
  assert.equal(announce(s, 0, 12), null, 'kein gültiger Wert');
  s = announce(s, 0, 42); // gelogen – erlaubt
  assert.equal(s.phase, 'decide');
  assert.equal(s.turn, 1);
  assert.equal(announce(s, 1, 41), null);
  s = believe(s, 1);
  assert.equal(s.phase, 'roll');
  s = roll(s, 1, [5, 2]);
  assert.equal(announce(s, 1, 42), null, 'muss höher sein');
  assert.equal(announce(s, 1, 41), null, 'muss höher sein');
  s = announce(s, 1, 52);
  assert.equal(s.turn, 2);
});

test('Aufdecken: Lügner verliert, berechtigter Zweifel kostet nichts – und umgekehrt; der Sieger beginnt', () => {
  const lie = seq(start(), (s) => roll(s, 0, [3, 1]), (s) => announce(s, 0, 54), (s) => doubt(s, 1));
  assert.equal(lie.lives[0], LIVES - 1);
  assert.equal(lie.lives[1], LIVES);
  assert.equal(lie.turn, 1, 'Sieger beginnt');
  assert.equal(lie.phase, 'roll');
  assert.deepEqual(lie.shown.dice, [3, 1]);
  assert.equal(lie.events[0].truth, false);

  const truth = seq(start(), (s) => roll(s, 0, [5, 4]), (s) => announce(s, 0, 54), (s) => doubt(s, 1));
  assert.equal(truth.lives[1], LIVES - 1, 'gleich hoch = Zweifler verliert');
  assert.equal(truth.turn, 0);
  const more = seq(start(), (s) => roll(s, 0, [6, 6]), (s) => announce(s, 0, 54), (s) => doubt(s, 1));
  assert.equal(more.lives[1], LIVES - 1, 'höher als angesagt = Zweifler verliert');
});

test('Mäxchen: aufgedeckt kostet es doppelt, ohne Aufdecken glauben 1 Leben', () => {
  const real = seq(start(), (s) => roll(s, 0, [2, 1]), (s) => announce(s, 0, 21));
  assert.equal(believe(real, 1), null, 'Mäxchen kann niemand überbieten');
  assert.equal(doubt(real, 1).lives[1], LIVES - 2);
  const fake = seq(start(), (s) => roll(s, 0, [6, 6]), (s) => announce(s, 0, 21));
  assert.equal(doubt(fake, 1).lives[0], LIVES - 2);
  const took = accept(fake, 1);
  assert.equal(took.lives[1], LIVES - 1);
  assert.equal(took.turn, 0, 'der Ansager beginnt');
  assert.equal(took.shown, null, 'nicht aufgedeckt');
  assert.equal(took.dice, null, 'der Wurf bleibt geheim');
  assert.equal(accept(seq(start(), (s) => roll(s, 0, [6, 6]), (s) => announce(s, 0, 66)), 1), null, 'nur beim Mäxchen');
});

test('Ausscheiden, Reihenfolge ohne Ausgeschiedene, Spielende und neue Partie', () => {
  let s = newGame({ starter: 0, lives: 1 });
  s = seq(s, (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 65), (x) => doubt(x, 1)); // 0 lügt → raus
  assert.deepEqual(alive(s), [1, 2, 3]);
  assert.deepEqual(s.out, [0]);
  assert.ok(s.events.some((e) => e.type === 'out' && e.player === 0));
  assert.equal(s.phase, 'over', 'der einzige Mensch ist raus');
  assert.equal(s.winner, null);

  let t = newGame({ starter: 3, lives: 1, humans: [0, 2] });
  t = seq(t, (x) => roll(x, 3, [3, 1]), (x) => announce(x, 3, 65), (x) => doubt(x, 0)); // 3 raus, 0 beginnt
  assert.equal(t.turn, 0);
  t = seq(t, (x) => roll(x, 0, [4, 1]), (x) => announce(x, 0, 41), (x) => believe(x, 1), (x) => roll(x, 1, [6, 5]), (x) => announce(x, 1, 65));
  assert.equal(t.turn, 2);
  t = seq(t, (x) => believe(x, 2), (x) => roll(x, 2, [1, 1]), (x) => announce(x, 2, 11));
  assert.equal(t.turn, 0, 'Sitz 3 ist raus und wird übersprungen');
  t = doubt(t, 0); // 11 stimmt → 0 raus, übrig 1 und 2
  assert.equal(t.phase, 'roll');
  t = seq(t, (x) => roll(x, 2, [2, 2]), (x) => announce(x, 2, 22), (x) => doubt(x, 1));
  assert.equal(t.phase, 'over');
  assert.equal(t.winner, 2);
  const next = again(t, 0, rngOf(1));
  assert.equal(next.phase, 'roll');
  assert.equal(next.turn, 2, 'Sieger beginnt die neue Partie');
  assert.deepEqual(next.lives, [LIVES, LIVES, LIVES, LIVES]);
  assert.equal(next.games, 2);
  assert.equal(again(next, 0), null);
});

test('Mit zwei oder drei Sitzen', () => {
  let s = newGame({ seats: [0, 2], starter: 0 });
  assert.deepEqual(s.lives, [LIVES, 0, LIVES, 0]);
  s = seq(s, (x) => roll(x, 0, [4, 2]), (x) => announce(x, 0, 42));
  assert.equal(s.turn, 2);
  let t = newGame({ seats: [0, 1, 3], starter: 1 });
  t = seq(t, (x) => roll(x, 1, [4, 2]), (x) => announce(x, 1, 42));
  assert.equal(t.turn, 3);
});

test('Sicht: verdeckte Würfel sieht nur, wer gewürfelt hat; aufgedeckt sehen alle', () => {
  const s = seq(start({ free: true }), (x) => roll(x, 0, [6, 3]));
  assert.deepEqual(viewFor(s, 0).dice, [6, 3]);
  assert.equal(viewFor(s, 1).dice, null);
  assert.equal(viewFor(s, 2).dice, null);
  const told = announce(s, 0, 63);
  assert.equal(viewFor(told, 1).dice, null);
  const peeked = peek(told, 1);
  assert.deepEqual(viewFor(peeked, 1).dice, [6, 3]);
  assert.equal(viewFor(peeked, 2).dice, null);
  assert.deepEqual(viewFor(peeked, 2).peeked, [], 'wer gelinst hat, verrät die Sicht nicht');
  assert.deepEqual(viewFor(peeked, 2).cheats, []);
  const open = doubt(told, 1);
  assert.deepEqual(viewFor(open, 3).shown.dice, [6, 3]);
  assert.equal(viewFor(open, 0).dice, null, 'nach der Runde ist der alte Wurf weg');
});

test('Ohne Hilfen: zu niedrig ansagen, nachwürfeln und linsen gehen durch und werden vermerkt', () => {
  assert.equal(peek(seq(start(), (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 31)), 1), null, 'normal nicht');
  let s = seq(start({ free: true }), (x) => roll(x, 0, [3, 1]));
  s = roll(s, 0, [6, 6]);
  assert.ok(s, 'nachwürfeln geht');
  assert.deepEqual(s.cheats.map((c) => c.kind), ['reroll']);
  s = seq(s, (x) => announce(x, 0, 66), (x) => peek(x, 1));
  assert.equal(peek(s, 1), null, 'einmal reicht');
  assert.equal(peek(s, 2), null, 'nur wer am Zug ist');
  s = seq(s, (x) => believe(x, 1), (x) => roll(x, 1, [4, 1]), (x) => announce(x, 1, 41));
  assert.deepEqual(s.cheats.map((c) => [c.player, c.kind]), [[0, 'reroll'], [1, 'peek'], [1, 'low']]);
  // Mäxchen glauben und trotzdem weiter: nur ohne Hilfen
  const m = seq(start({ free: true }), (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 21), (x) => believe(x, 1), (x) => roll(x, 1, [2, 1]), (x) => announce(x, 1, 21));
  assert.equal(m.cheats.at(-1).kind, 'low', 'Mäxchen auf Mäxchen ist nicht höher');
});

test('Ohne Hilfen: Geschummelt! – erwischt kostet den Schummler ein Leben, Fehlalarm den Rufer', () => {
  const s = seq(start({ free: true }), (x) => roll(x, 0, [3, 1]), (x) => roll(x, 0, [6, 6]), (x) => announce(x, 0, 66));
  const caught = accuse(s, 1, 0);
  assert.equal(caught.lives[0], LIVES - 1);
  assert.deepEqual(caught.events[0], { type: 'caught', player: 0, by: 1, kinds: ['reroll'] });
  assert.equal(caught.turn, 1, 'wer richtig gerufen hat, beginnt');
  assert.deepEqual(caught.cheats, []);
  const wrong = accuse(s, 2, 3);
  assert.equal(wrong.lives[2], LIVES - 1);
  assert.equal(wrong.events[0].type, 'fehlalarm');
  assert.equal(wrong.turn, 3);
  assert.equal(accuse(s, 1, 1), null);
  assert.equal(accuse(seq(start(), (x) => roll(x, 0, [3, 1])), 1, 0), null, 'nur ohne Hilfen');
  // nach dem Aufdecken bleibt die Schummelei der Runde anklagbar, bis neu gewürfelt wird
  const shown = doubt(s, 1);
  assert.equal(accuse(shown, 2, 0).events[0].type, 'caught');
  const rolled = roll(shown, shown.turn, [2, 2]);
  assert.equal(accuse(rolled, 2, 0).events[0].type, 'fehlalarm', 'neue Runde – alte Schummelei verjährt');
});

test('Ohne Hilfen: Schummeln in der letzten Runde bleibt nach Spielende anklagbar, der Schummler startet nicht neu', () => {
  // zu zweit (Menschen 0 und 2), alle 1 Leben: Gast linst und deckt auf – Host ist raus, Spiel vorbei
  let s = newGame({ starter: 0, lives: 1, humans: [0, 2], seats: [0, 2], free: true });
  s = seq(s, (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 54), (x) => peek(x, 2), (x) => doubt(x, 2));
  assert.equal(s.phase, 'over');
  assert.equal(s.winner, 2);
  assert.equal(again(s, 2), null, 'der Schummler kann nicht sofort neu starten');
  assert.ok(again(s, 0), 'der andere schon (verzichtet damit)');
  const caught = accuse(s, 0, 2);
  assert.equal(caught.events[0].type, 'caught', 'der Ausgeschiedene darf noch rufen');
  assert.equal(caught.lives[2], 0);
  assert.equal(caught.phase, 'over');
  assert.equal(caught.winner, null, 'keiner hat mehr Leben');
  assert.ok(again(caught, 2), 'nach dem Urteil geht es weiter');
  // allein: erst wenn der Computer die Runde geprüft hat (waive)
  let t = newGame({ seats: [0, 1], starter: 1, lives: 1, free: true });
  t = seq(t, (x) => roll(x, 1, [3, 1]), (x) => announce(x, 1, 54), (x) => peek(x, 0), (x) => doubt(x, 0));
  assert.equal(t.winner, 0);
  assert.equal(again(t, 0), null);
  assert.ok(again(waive(t), 0));
  assert.equal(waive(waive(t)), null);
  const late = accuse(t, 1, 0);
  assert.equal(late.events[0].type, 'caught');
  assert.equal(late.winner, null);
});

// --- Computer ---

test('Ansage-Modell: Wahrheit wenn möglich, sonst knapp darüber; Verteilungen summieren zu 1', () => {
  for (let p = -1; p < 20; p++) {
    for (let r = 0; r < 21; r++) {
      const d = claimDist(r, p);
      const sum = d.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `r ${r} p ${p}`);
      d.forEach((x, i) => x > 0 && assert.ok(i > p, 'nur höhere Ansagen'));
    }
  }
  assert.ok(truthChance(rankOf(31), -1) > 0.95, '31 zur Eröffnung stimmt fast sicher');
  assert.ok(truthChance(rankOf(66), rankOf(55)) < 0.3, '66 auf 55 ist meist gelogen');
  assert.ok(truthChance(rankOf(53), rankOf(52)) < truthChance(rankOf(53), -1), 'knapp über der Vorgabe ist verdächtiger');
});

test('Computer: sagt nur Gültiges an, deckt offensichtliche Lügen auf, glaubt Kleines', () => {
  const rng = rngOf(7);
  for (let k = 0; k < 300; k++) {
    let s = start();
    s = seq(s, (x) => roll(x, 0, [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)]));
    const v = viewFor(s, 0);
    assert.ok(announce(s, 0, chooseClaim(v, rng)), 'Eröffnung gültig');
  }
  const small = seq(start(), (x) => roll(x, 0, [3, 2]), (x) => announce(x, 0, 32));
  let believed = 0;
  for (let k = 0; k < 200; k++) if (chooseDecision(viewFor(small, 1), rng) === 'believe') believed++;
  assert.ok(believed > 180, `32 zur Eröffnung glaubt er (${believed}/200)`);
  // weiß er es (gelinst), entscheidet er sicher richtig
  const lie = seq(start(), (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 64));
  assert.equal(chooseDecision(viewFor(lie, 1), rng, 31), 'doubt');
  assert.equal(wantsReroll({ claims: [{ by: 1, value: 64 }], dice: [3, 1] }), true);
  assert.equal(wantsReroll({ claims: [{ by: 1, value: 64 }], dice: [6, 6] }), false);
});

test('Computer: merkt sich Dauer-Bluffer und deckt ihre Mäxchen dann öfter auf', () => {
  const rng = rngOf(11);
  const s = seq(start(), (x) => roll(x, 0, [3, 1]), (x) => announce(x, 0, 21));
  const rate = (memo) => {
    let n = 0;
    for (let k = 0; k < 400; k++) if (chooseDecision(viewFor(s, 1), rng, null, memo) === 'doubt') n++;
    return n / 400;
  };
  const fresh = rate({});
  const memo = {};
  for (let k = 0; k < 8; k++) observe(memo, [{ type: 'announce', player: 0, value: 21 }]);
  observe(memo, [{ type: 'doubt', claimer: 0, truth: false }, { type: 'doubt', claimer: 0, truth: false }]);
  const wary = rate(memo);
  assert.ok(fresh < 0.25, `anfangs meist geglaubt (${fresh})`);
  assert.ok(wary > 0.6, `nach vielen Mäxchen-Bluffs meist aufgedeckt (${wary})`);
});

// Ganze Partien: Strategie = { claim(v, rng), decide(v, rng, memo) }
function playGame(strategies, rng) {
  let s = newGame({ seats: [0, 1, 2, 3], humans: [0, 1, 2, 3] }, rng);
  const memo = {};
  for (let guard = 0; guard < 5000 && s.phase !== 'over'; guard++) {
    const p = s.turn;
    const v = viewFor(s, p);
    let next;
    if (s.phase === 'roll') next = roll(s, p, [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)]);
    else if (s.phase === 'announce') next = announce(s, p, strategies[p].claim(v, rng));
    else {
      const d = strategies[p].decide(v, rng, memo);
      next = d === 'believe' ? believe(s, p) : d === 'accept' ? accept(s, p) : doubt(s, p);
    }
    assert.ok(next, `Zug ungültig: ${s.phase}`);
    observe(memo, next.events);
    s = next;
  }
  assert.equal(s.phase, 'over');
  return s.winner;
}

const AI = { claim: chooseClaim, decide: (v, rng, memo) => chooseDecision(v, rng, null, memo) };
// naiv: sagt die Wahrheit, wenn sie reicht, sonst das Nächsthöhere; glaubt immer (Mäxchen: ohne Aufdecken)
const NAIVE = {
  claim: (v) => {
    const prev = v.claims.at(-1)?.value;
    const mine = valueOf(v.dice);
    return prev === undefined || rankOf(mine) > rankOf(prev) ? mine : CLAIMS[rankOf(prev) + 1];
  },
  decide: (v) => (v.claims.at(-1).value === MAEXCHEN ? 'accept' : 'believe'),
};
// misstrauisch: deckt alles auf
const DOUBTER = { claim: NAIVE.claim, decide: () => 'doubt' };

test('Simulation: der Computer schlägt naive und misstrauische Spieler deutlich', () => {
  const rng = rngOf(2026);
  for (const [name, other] of [['naiv', NAIVE], ['misstrauisch', DOUBTER]]) {
    let wins = 0;
    const games = 200;
    for (let g = 0; g < games; g++) {
      const ai = g % 4; // Sitz wechselt
      const w = playGame([0, 1, 2, 3].map((p) => (p === ai ? AI : other)), rng);
      if (w === ai) wins++;
    }
    assert.ok(wins / games > 0.4, `gegen ${name}: ${wins}/${games} gewonnen (fair wären 25 %)`);
  }
});
