import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, draw, meld, layoff, swap, undo, discard, again, viewFor, makeDeck, isJoker, NOBODY } from '../src/romme/game.js';
import { computerMove, bestPacking } from '../src/romme/ai.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nachricht wie vom Gast anwenden (wie in romme/index.js)
function apply(s, player, { t, arg }, rng) {
  if (t === 'draw') return draw(s, player, arg?.from, rng);
  if (t === 'meld') return meld(s, player, arg?.cards, arg?.hint);
  if (t === 'layoff') return layoff(s, player, arg?.card, arg?.index, arg?.end);
  if (t === 'swap') return swap(s, player, arg?.card, arg?.index);
  if (t === 'undo') return undo(s, player);
  if (t === 'discard') return discard(s, player, arg?.card);
  return null;
}

const all = (s) => [...s.hands.flat(), ...s.melds.flatMap((m) => m.cards), ...s.pile, ...s.talon].sort();
const DECK = makeDeck().sort();

// Einfacher Gegner: zieht vom Stapel, legt nie aus, wirft eine zufällige Karte ab
function simple(v, me, rng) {
  if (v.phase === 'draw') return { t: 'draw', arg: { from: v.talon || v.pile.length < 2 ? (v.talon ? 'talon' : 'pile') : 'talon' } };
  const options = v.hands[me].filter((c) => c !== v.taken);
  return { t: 'discard', arg: { card: options[Math.floor(rng() * options.length)] } };
}

function playGame(seed, players) {
  const rng = seeded(seed);
  let s = newGame(seed % 2, rng);
  const stats = { actions: {}, turns: 0, maxPerTurn: 0, shuffles: 0 };
  let perTurn = 0;
  for (let step = 0; step < 6000 && s.winner === null; step++) {
    const p = s.turn;
    const v = viewFor(s, p);
    const msg = players[p](v, p, rng);
    const next = apply(s, p, msg, rng);
    assert.ok(next, `Spiel ${seed}, Schritt ${step}: ungültige Aktion ${JSON.stringify(msg)}`);
    stats.actions[msg.t] = (stats.actions[msg.t] ?? 0) + 1;
    if (next.events.some((e) => e.type === 'shuffle')) stats.shuffles++;
    perTurn = next.turn === p && next.winner === null ? perTurn + 1 : 0;
    stats.maxPerTurn = Math.max(stats.maxPerTurn, perTurn);
    s = next;
    assert.deepEqual(all(s), DECK, `Spiel ${seed}: Karte verloren oder doppelt`);
    for (const m of s.melds) assert.ok(m.cards.length >= 3);
  }
  stats.turns = s.turns;
  return { s, stats };
}

test('Computer gegen Computer: nur gültige Züge, keine Karte geht verloren, jede Runde endet', () => {
  const ai = (v, me) => computerMove(v, me);
  const totals = { actions: {}, turns: [], maxPerTurn: 0, shuffles: 0, wins: [0, 0] };
  for (let seed = 1; seed <= 300; seed++) {
    const { s, stats } = playGame(seed, [ai, ai]);
    assert.notEqual(s.winner, null, `Spiel ${seed} endet nicht`);
    if (s.events.at(-1).type === 'win') assert.equal(s.hands[s.winner].length, 0);
    else assert.equal(s.events.at(-1).type, 'exhausted'); // Stapel zweimal aufgebraucht
    if (s.winner !== NOBODY) totals.wins[s.winner]++;
    totals.turns.push(stats.turns);
    totals.maxPerTurn = Math.max(totals.maxPerTurn, stats.maxPerTurn);
    totals.shuffles += stats.shuffles;
    for (const [k, n] of Object.entries(stats.actions)) totals.actions[k] = (totals.actions[k] ?? 0) + n;
  }
  totals.turns.sort((a, b) => a - b);
  console.log('Züge je Runde (Median/Max):', totals.turns[150], totals.turns.at(-1), 'Aktionen:', totals.actions, 'max. Aktionen in einem Zug:', totals.maxPerTurn, 'Mischen:', totals.shuffles, 'Siege:', totals.wins);
  assert.ok(totals.actions.swap > 0, 'Joker-Tausch kommt vor');
  assert.ok(totals.actions.layoff > 0, 'Anlegen kommt vor');
  assert.ok(totals.maxPerTurn < 40);
});

test('Computer schlägt einen Gegner, der nie auslegt', () => {
  const ai = (v, me) => computerMove(v, me);
  let wins = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { s } = playGame(seed, seed % 2 ? [ai, simple] : [simple, ai]);
    if (s.winner === (seed % 2 ? 0 : 1)) wins++;
  }
  assert.equal(wins, 40);
});

test('Computer sieht nur seine Sicht und spielt mehrere Runden hintereinander', () => {
  const rng = seeded(99);
  let s = newGame(0, rng);
  for (let round = 0; round < 3; round++) {
    for (let step = 0; step < 6000 && s.winner === null; step++) {
      const v = viewFor(s, s.turn);
      assert.equal(typeof v.hands[1 - s.turn], 'number');
      assert.equal(typeof v.talon, 'number');
      s = apply(s, s.turn, computerMove(v, s.turn), rng);
      assert.ok(s);
    }
    assert.notEqual(s.winner, null);
    const total = s.score[0] + s.score[1];
    s = again(s, rng);
    assert.equal(s.score[0] + s.score[1], total);
  }
});

// Stand aus Sicht des Computers (Spieler 1) mitten im Spiel
function view(extra) {
  return { ...viewFor({ ...newGame(0), turn: 1, phase: 'play', turns: 6, opened: [true, true], ...extra }, 1), events: [] };
}

test('Endspiel aus der Prüfung: keine Ablagekarte ohne Nutzen, Joker anlegen gewinnt, genommener Joker kommt in die Figur', () => {
  const sets = [
    { owner: 0, kind: 'set', cards: ['c7a', 's7a', 'h7a', 'd7a'] },
    { owner: 1, kind: 'set', cards: ['cKa', 'sKa', 'hKa', 'dKa'] },
  ];
  // nimmt die Kreuz 2 nicht – er könnte sie nicht auslegen und müsste die andere 2 abwerfen (endloses Tauschen)
  const a = view({ phase: 'draw', hands: [['h4a'], ['xb1', 's2a']], melds: sets, pile: ['d9a', 'c2a'] });
  assert.deepEqual(computerMove(a, 1), { t: 'draw', arg: { from: 'talon' } });
  // fast leere Hand: Joker von der Ablage nur, wenn er irgendwo hinpasst
  const b = view({ phase: 'draw', hands: [['h4a'], ['xb1', 's2a']], melds: sets, pile: ['d9a', 'xr1'] });
  assert.deepEqual(computerMove(b, 1), { t: 'draw', arg: { from: 'talon' } });
  // nur Joker auf der Hand und eine Reihe offen: einen anlegen, dann ist die Runde mit dem anderen gewonnen
  const run = { owner: 0, kind: 'run', suit: 'h', low: 3, cards: ['h3a', 'h4a', 'h5a'] };
  const c = view({ hands: [['c4a'], ['xr1', 'xb2']], melds: [...sets, run], taken: 'xb2', pile: ['d9a'] });
  const m = computerMove(c, 1);
  assert.equal(m.t, 'layoff');
  const after = layoff(c, 1, m.arg.card, m.arg.index, m.arg.end);
  const last = computerMove(after, 1);
  assert.equal(last.t, 'discard');
  assert.equal(discard(after, 1, last.arg.card).winner, 1);
  // genommener Joker muss in die Figur, sonst wäre das Auslegen ungültig
  const d = view({ hands: [['c4a'], ['hQa', 'hKa', 'xr1', 'xb1', 's9a']], melds: [], opened: [true, false], taken: 'xb1', pile: ['d9a'] });
  const mm = computerMove(d, 1);
  assert.equal(mm.t, 'meld');
  assert.ok(mm.arg.cards.includes('xb1'));
  assert.ok(meld(d, 1, mm.arg.cards, mm.arg.hint));
});

test('Auslage-Suche: findet 30 Punkte aus zwei Figuren, nutzt zwei gleiche Karten in Satz und Reihe', () => {
  const hand = ['h5a', 'h6a', 'h7a', 'h7b', 's7a', 'c7a', 'd2a'];
  const pack = bestPacking(hand, { keep: new Set(hand) });
  assert.equal(pack.reduce((n, m) => n + m.real.length + m.jokers, 0), 6);
  const open = bestPacking(['h2a', 'h3a', 'h4a', 'sKa', 'cKa', 'dKa', 'h9b'], { need: 30, keep: new Set(['h9b']) });
  assert.equal(open.length, 2);
  assert.equal(bestPacking(['h2a', 'h3a', 'h4a', 'h9b'], { need: 30 }).length, 0); // nur 9 Punkte
  // eine Karte muss zum Ablegen bleiben
  const tight = bestPacking(['h2a', 'h3a', 'h4a'], { keep: new Set(['h2a', 'h3a', 'h4a']) });
  assert.equal(tight.length, 0);
  // eingetauschter Joker muss mit hinein
  const j = bestPacking(['h5a', 'h6a', 'xr1', 'sKa', 'cQa'], { keep: new Set(['h5a', 'h6a', 'sKa', 'cQa']), minJokers: 1 });
  assert.ok(j.some((m) => m.jokers === 1));
  assert.ok(!isJoker(j[0].real[0]));
});
