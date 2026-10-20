// Rommé „Ohne Hilfen“: regelwidrige Züge gehen durch, „Geschummelt!“ nimmt den ganzen Zug zurück (+2 Strafkarten),
// Fehlalarm kostet den Ankläger 1 Karte. Zu zweit und allein (der Computer schummelt und ruft dann selbst) –
// mit Regeln (free = false) ändert sich nichts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, newGame, draw, meld, layoff, swap, undo, discard, accuse, again, waive, isOut, arrange, viewFor, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from '../src/romme/game.js';
import { computerMove, cheatMoves } from '../src/romme/ai.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../src/schummeln.js';

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spieler 0 ist dran und zieht gleich (damit der Stand am Zuganfang stimmt); Rest des Blatts im Stapel, oberste = d3b
function setup({ hands, melds = [], opened = [true, true], free = true, turns = 6 }) {
  const used = new Set([...hands.flat(), ...melds.flatMap((m) => m.cards), 'd2b', 'd3b']);
  const s = {
    ...newGame(1, Math.random, { free }),
    hands, melds, opened, turns, turn: 0, phase: 'draw', pile: ['d2b'],
    talon: [...makeDeck().filter((c) => !used.has(c)), 'd3b'],
    events: [], seq: 10,
  };
  return draw(s, 0, 'talon');
}

const all = (s) => [...s.hands.flat(), ...s.melds.flatMap((m) => m.cards), ...s.pile, ...s.talon].sort();
const DECK = makeDeck().sort();
const run = (owner, suit, low, cards) => ({ owner, kind: 'run', suit, low, cards });

// Aktion wie vom Computer bzw. Gast anwenden (wie in romme/index.js)
function apply(s, player, { t, arg }, rng) {
  if (t === 'draw') return draw(s, player, arg?.from, rng);
  if (t === 'meld') return meld(s, player, arg?.cards, arg?.hint);
  if (t === 'layoff') return layoff(s, player, arg?.card, arg?.index, arg?.end);
  if (t === 'swap') return swap(s, player, arg?.card, arg?.index);
  if (t === 'undo') return undo(s, player);
  if (t === 'discard') return discard(s, player, arg?.card);
  return null;
}

test('mit Regeln (free = false) bleibt alles gesperrt, „Geschummelt!“ gibt es nicht', () => {
  const s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']], free: false });
  assert.equal(meld(s, 0, ['h2a', 's9a', 'cKa']), null);
  assert.equal(discard(s, 0, 'h2a').cheat, null);
  assert.equal(accuse(discard(s, 0, 'h2a'), 1), null);
});

test('ohne Hilfen: Schummel-Figur, unpassendes Anlegen und falscher Joker-Tausch gehen durch', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a', 'c5a'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'xr1', 'h7a'])], opened: [false, true] });
  s = meld(s, 0, ['h2a', 's9a', 'cKa']); // keine Figur, nicht herausgekommen
  assert.equal(s.melds[1].kind, 'free');
  assert.equal(s.opened[0], true);
  assert.equal(s.clean, false);
  s = layoff(s, 0, 'd7a', 0); // passt nicht an Herz 5–7
  assert.deepEqual(s.melds[0].cards, ['h5a', 'xr1', 'h7a', 'd7a']);
  assert.equal(s.melds[0].kind, 'free');
  const t = setup({ hands: [['c5a', 'h9a', 'sQa'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'xr1', 'h7a'])] });
  const u = swap(t, 0, 'c5a', 0); // Kreuz 5 statt Herz 6
  assert.ok(u.hands[0].includes('xr1'));
  assert.deepEqual(u.melds[0].cards, ['h5a', 'c5a', 'h7a']);
  assert.equal(u.clean, false);
  // eine Karte muss trotzdem zum Ablegen übrig bleiben
  assert.equal(meld(setup({ hands: [['h2a', 's9a', 'cKa'], []] }), 0, ['h2a', 's9a', 'cKa', 'd3b']), null);
});

test('regelgerechter Zug + „Geschummelt!“ = Fehlalarm: der Ankläger zieht 1 Karte', () => {
  let s = setup({ hands: [['h7a', 's7a', 'c7b', 'd9a', 'cKa'], ['c3a', 'h4b']] });
  s = meld(s, 0, ['h7a', 's7a', 'c7b']);
  s = discard(s, 0, 'cKa');
  assert.deepEqual(s.cheat.player, 0);
  assert.equal(s.cheat.legal, true);
  assert.equal(accuse(s, 0), null); // nicht gegen sich selbst
  const f = accuse(s, 1);
  assert.equal(f.hands[1].length, 2 + FALSE_ALARM_PENALTY);
  assert.equal(f.cheat, null);
  assert.equal(f.turn, 1);
  assert.equal(f.phase, 'draw'); // ziehen muss er trotzdem noch
  assert.deepEqual(f.events[0], { type: 'fehlalarm', player: 1 });
  assert.deepEqual(all(f), DECK);
  assert.equal(accuse(f, 1), null); // nur einmal
});

test('regelwidriger Zug erwischt: ganzer Zug zurück, 2 Strafkarten, der Schummler spielt neu', () => {
  const s0 = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']], opened: [false, true] });
  let s = meld(s0, 0, ['h2a', 's9a', 'cKa']);
  s = discard(s, 0, 'd3b'); // auch die gezogene Karte gleich wieder weg
  assert.equal(s.cheat.legal, false);
  const c = accuse(s, 1, seeded(1));
  assert.equal(c.turn, 0);
  assert.equal(c.phase, 'play');
  assert.deepEqual(c.melds, []);
  assert.deepEqual(c.pile, ['d2b']);
  assert.equal(c.opened[0], false);
  assert.equal(c.hands[0].length, s0.hands[0].length + CHEAT_PENALTY);
  assert.ok(['h2a', 's9a', 'cKa', 'd7a', 'd3b'].every((x) => c.hands[0].includes(x)));
  assert.deepEqual(c.events[0], { type: 'caught', player: 0, by: 1, why: 'Herz 2, Pik 9, Kreuz König ist keine Figur' });
  assert.equal(c.events.filter((e) => e.why === 'strafe').length, CHEAT_PENALTY);
  assert.equal(c.cheat, null);
  assert.deepEqual(all(c), DECK);
  // „Zug zurücksetzen“ behält die Strafkarten
  const m = meld(c, 0, ['h2a', 's9a', 'cKa']);
  assert.equal(undo(m, 0).hands[0].length, c.hands[0].length);
  // und dieser Zug lässt sich wieder anprangern – zweimal erwischt im selben Zug (Befund der zweiten Prüfung: Absturz)
  const again2 = discard(m, 0, 'd7a');
  assert.equal(again2.cheat.legal, false);
  const c2 = accuse(again2, 1, seeded(5));
  assert.equal(c2.hands[0].length, c.hands[0].length + CHEAT_PENALTY);
  assert.deepEqual(c2.melds, []);
  assert.equal(c2.turn, 0);
  assert.deepEqual(all(c2), DECK);
  assert.equal(undo(meld(c2, 0, ['h2a', 's9a', 'cKa']), 0).hands[0].length, c2.hands[0].length);
});

test('Frist: wer zieht, hat den Zug hingenommen; auch nach „Zug zurücksetzen“ ist der Zug wieder sauber', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  s = discard(meld(s, 0, ['h2a', 's9a', 'cKa']), 0, 'd7a');
  const later = draw(s, 1, 'talon');
  assert.equal(later.cheat, null);
  assert.equal(accuse(later, 1), null);
  // geschummelt, dann zurückgenommen, dann sauber gespielt
  let t = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  t = undo(meld(t, 0, ['h2a', 's9a', 'cKa']), 0);
  assert.equal(t.clean, true);
  assert.equal(discard(t, 0, 'd7a').cheat.legal, true);
});

test('typische Schummeleien zählen: Ablagekarte gleich wieder ablegen, mit zu wenig Punkten herauskommen', () => {
  // Ablagekarte genommen und gleich wieder abgelegt
  const base = { ...newGame(1, Math.random, { free: true }), hands: [['h2a', 'cKa'], ['c3a']], melds: [], turn: 0, phase: 'draw', pile: ['d2b', 'sQa'], talon: makeDeck().filter((c) => !['h2a', 'cKa', 'c3a', 'd2b', 'sQa'].includes(c)), opened: [true, true], turns: 6 };
  const a = discard(draw(base, 0, 'pile'), 0, 'sQa');
  assert.equal(a.cheat.legal, false);
  // nur 21 Punkte ausgelegt, dann abgelegt
  let b = setup({ hands: [['h7a', 's7a', 'c7b', 'd9a'], ['c3a']], opened: [false, true] });
  b = meld(b, 0, ['h7a', 's7a', 'c7b']);
  assert.deepEqual(b.fresh, [0]); // mit Regeln vorläufig
  b = discard(b, 0, 'd9a');
  assert.equal(b.opened[0], true);
  assert.equal(b.cheat.legal, false);
});

test('Sieg mit Schummelzug: angeprangert geht die Runde weiter, die Punkte sind wieder weg', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['xr1', 'sAa']] });
  s = meld(s, 0, ['h2a', 's9a', 'cKa', 'd3b']);
  s = discard(s, 0, 'd7a');
  assert.equal(s.winner, 0);
  assert.equal(s.score[0], 31);
  assert.equal(rematchBlocked(s, 0), true); // der Schummler kann die Anklage nicht wegklicken
  assert.equal(rematchBlocked(s, 1), false);
  const c = accuse(s, 1, seeded(2));
  assert.equal(c.winner, null);
  assert.deepEqual(c.score, [0, 0]);
  assert.equal(c.turn, 0);
  assert.deepEqual(all(c), DECK);
});

test('Sicht des Gastes: nur wer zuletzt gezogen hat – nicht ob regelwidrig und nicht der Stand davor', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] });
  s = discard(meld(s, 0, ['h2a', 's9a', 'cKa']), 0, 'd7a');
  const v = viewFor(s, 1);
  assert.deepEqual(v.cheat, { player: 0 });
  assert.equal(v.turnStart, null);
  assert.ok(!JSON.stringify(v).includes('"legal"'));
  const w = viewFor(setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['c3a']] }), 1);
  assert.equal(w.turnStart, null);
  assert.ok(!JSON.stringify(w).includes('h2a'));
});

test('erster Zug des Anfängers (ohne Ziehen) lässt sich anprangern, nächste Runde bleibt ohne Hilfen', () => {
  let s = newGame(0, seeded(9), { free: true });
  const hand = s.hands[0];
  s = meld(s, 0, hand.slice(0, 3)); // in der ersten Runde wird nicht ausgelegt
  s = discard(s, 0, hand[3]);
  assert.equal(s.cheat.legal, false);
  const c = accuse(s, 1, seeded(3));
  assert.equal(c.hands[0].length, 14 + CHEAT_PENALTY);
  assert.deepEqual(c.melds, []);
  assert.deepEqual(c.pile, []);
  assert.deepEqual(all(c), DECK);
  const end = { ...c, winner: 1 };
  assert.equal(again(end).free, true);
});

test('waive: der andere lässt den letzten Zug gelten – Frist zu, Revanche frei (nur der andere, nur ohne Hilfen)', () => {
  let s = setup({ hands: [['h2a', 's9a', 'cKa', 'd7a'], ['xr1', 'sAa']] });
  s = discard(meld(s, 0, ['h2a', 's9a', 'cKa', 'd3b']), 0, 'd7a'); // Sieg mit Schummelzug
  assert.equal(waive(s, 0), null); // nicht der Schummler selbst
  const w = waive(s, 1);
  assert.equal(w.cheat, null);
  assert.equal(w.winner, 0);
  assert.equal(rematchBlocked(w, 0), false);
  assert.equal(accuse(w, 1), null);
  assert.equal(waive(w, 1), null); // nichts mehr offen
  assert.equal(waive(discard(setup({ hands: [['h2a', 'cKa'], ['c3a']], free: false }), 0, 'h2a'), 1), null);
});

test('„(draußen)“ ohne Hilfen schon nach der ersten Auslage – auch unter 30 Punkten', () => {
  const hands = [['h7a', 's7a', 'c7b', 'd9a'], ['c3a']];
  const before = setup({ hands, opened: [false, true] });
  assert.equal(isOut(before, 0), false);
  const s = meld(before, 0, ['h7a', 's7a', 'c7b']); // 21 Punkte: regelgerecht noch nicht draußen
  assert.equal(s.opened[0], false);
  assert.equal(isOut(s, 0), true);
  assert.equal(isOut(viewFor(s, 1), 0), true); // auch der andere sieht es so
  const t = meld(setup({ hands, opened: [false, true], free: false }), 0, ['h7a', 's7a', 'c7b']);
  assert.equal(isOut(t, 0), false); // mit Regeln erst ab 30 Punkten
  assert.equal(isOut(t, 1), true);
});

test('ohne Hilfen bleibt jede Figur so liegen, wie sie gelegt wurde – gültig oder nicht; angelegt wird am angeklickten Ende', () => {
  const hands = [['h7a', 'h5a', 'h6a', 'h4a', 'h9a', 'h8a', 'cKa'], ['c3a']];
  let s = meld(setup({ hands }), 0, ['h7a', 'h5a', 'h6a']);
  assert.deepEqual(s.melds[0].cards, ['h7a', 'h5a', 'h6a']);
  assert.equal(s.melds[0].kind, 'run'); // geprüft wird trotzdem die Figur
  assert.equal(s.clean, true);
  s = layoff(s, 0, 'h4a', 0, 'high'); // passt vorn, liegt aber hinten (dort angeklickt)
  assert.deepEqual(s.melds[0].cards, ['h7a', 'h5a', 'h6a', 'h4a']);
  assert.equal(s.melds[0].low, 4);
  assert.equal(s.clean, true);
  s = layoff(s, 0, 'h8a', 0, 'low');
  assert.deepEqual(s.melds[0].cards, ['h8a', 'h7a', 'h5a', 'h6a', 'h4a']);
  assert.equal(s.clean, true);
  s = layoff(s, 0, 'cKa', 0, 'low'); // passt nicht – liegt genauso am angeklickten Ende
  assert.deepEqual(s.melds[0].cards, ['cKa', 'h8a', 'h7a', 'h5a', 'h6a', 'h4a']);
  assert.equal(s.clean, false);
  // mit Regeln ordnet das Spiel weiter selbst
  let r = meld(setup({ hands, free: false }), 0, ['h7a', 'h5a', 'h6a']);
  assert.deepEqual(r.melds[0].cards, ['h5a', 'h6a', 'h7a']);
  r = layoff(r, 0, 'h4a', 0, 'high');
  assert.deepEqual(r.melds[0].cards, ['h4a', 'h5a', 'h6a', 'h7a']);
});

test('ohne Hilfen gilt der Joker an der Stelle, an der er liegt; Tausch an einer ungeordnet gelegten Reihe', () => {
  let j = meld(setup({ hands: [['xr1', 'h5a', 'h6a', 'cKa'], ['h7a', 'd9a', 'c2a']] }), 0, ['xr1', 'h5a', 'h6a']);
  assert.equal(j.melds[0].low, 4); // Joker vorn = Herz 4 (die beste Lage wäre Joker = Herz 7)
  assert.equal(meld(setup({ hands: [['xr1', 'h5a', 'h6a', 'cKa'], ['c3a']], free: false }), 0, ['xr1', 'h5a', 'h6a']).melds[0].low, 5);
  j = draw(discard(j, 0, 'cKa'), 1, 'talon');
  j = layoff(j, 1, 'h7a', 0, 'high'); // Herz 7 passt an Joker-5-6
  assert.deepEqual(j.melds[0].cards, ['xr1', 'h5a', 'h6a', 'h7a']);
  assert.equal(j.clean, true);
  // ungeordnet gelegt: Joker steht für Herz 6 – der Tausch findet ihn trotzdem und lässt die Lage stehen
  let w = meld(setup({ hands: [['h7a', 'h5a', 'xr1', 'h6a', 'cKa'], ['c3a']] }), 0, ['h7a', 'h5a', 'xr1']);
  assert.deepEqual(w.melds[0].cards, ['h7a', 'h5a', 'xr1']);
  w = swap(w, 0, 'h6a', 0);
  assert.deepEqual(w.melds[0].cards, ['h7a', 'h5a', 'h6a']);
  assert.ok(w.hands[0].includes('xr1'));
  assert.equal(w.clean, true);
});

// Befund der Prüfung 20.10.2026: Ohne Hilfen tauscht das Spiel genau den angetippten Joker – nie still den passenden
test('ohne Hilfen: Tausch nimmt genau den angetippten Joker – steht er für eine andere Karte, ist es geschummelt', () => {
  const m = meld(setup({ hands: [['xr1', 'h5a', 'h6a', 'xb2', 'h7a', 'cKa'], ['c3a']] }), 0, ['xr1', 'h5a', 'h6a', 'xb2']); // Joker = Herz 4 und 7
  const wrong = swap(m, 0, 'h7a', 0, 'xr1'); // Herz 7 auf den vorderen Joker (Herz 4)
  assert.deepEqual(wrong.melds[0].cards, ['h7a', 'h5a', 'h6a', 'xb2']);
  assert.ok(wrong.hands[0].includes('xr1'));
  assert.equal(wrong.clean, false);
  const right = swap(m, 0, 'h7a', 0, 'xb2'); // auf den hinteren Joker (Herz 7)
  assert.deepEqual(right.melds[0].cards, ['xr1', 'h5a', 'h6a', 'h7a']);
  assert.equal(right.clean, true);
  // Satz mit zwei Jokern: beide stehen für fehlende Farben – jeder darf getauscht werden
  const set = meld(setup({ hands: [['hKa', 'sKa', 'xr1', 'xb2', 'cKa', 'd4a'], ['c3a']] }), 0, ['hKa', 'sKa', 'xr1', 'xb2']);
  const second = swap(set, 0, 'cKa', 0, 'xb2');
  assert.deepEqual(second.melds[0].cards, ['hKa', 'sKa', 'xr1', 'cKa']);
  assert.equal(second.clean, true);
  assert.equal(swap(set, 0, 'cKa', 0, 'h5a'), null); // keine Joker-Karte angetippt
});

test('allein: Computer schummelt plausibel – zu wenig Punkte zum Herauskommen oder eine unpassende Karte angelegt', () => {
  // noch nicht draußen, nur ein Satz Zweien (6 Punkte): auslegen und trotzdem ablegen
  let a = setup({ hands: [['c2a', 's2a', 'h2a', 'dKa', 's9b'], ['h4a']], opened: [false, true] });
  const moves = cheatMoves(viewFor(a, 0), 0);
  assert.deepEqual(moves.map((m) => m.t), ['meld', 'discard']);
  for (const m of moves) a = apply(a, 0, m);
  assert.equal(a.opened[0], true);
  assert.equal(a.cheat.legal, false);
  // draußen: eine Karte an eine Figur, an die sie nicht passt – danach legt er wie immer ab
  let b = setup({ hands: [['c9a', 'dKa', 'sQa'], ['h4a']], melds: [run(1, 'h', 5, ['h5a', 'h6a', 'h7a'])] });
  const lay = cheatMoves(viewFor(b, 0), 0);
  assert.deepEqual(lay.map((m) => m.t), ['layoff']);
  b = apply(b, 0, lay[0]);
  assert.equal(b.melds[0].kind, 'free');
  b = apply(b, 0, computerMove(viewFor(b, 0), 0));
  assert.equal(b.cheat.legal, false);
  assert.deepEqual(all(b), DECK);
  // nichts Plausibles möglich: erste Runde, oder draußen ohne Figur auf dem Tisch
  assert.equal(cheatMoves(viewFor(setup({ hands: [['c2a', 's2a', 'h2a', 'dKa'], ['h4a']], opened: [false, false], turns: 1 }), 0), 0), null);
  assert.equal(cheatMoves(viewFor(setup({ hands: [['c9a', 'dKa', 'sQa'], ['h4a']] }), 0), 0), null);
});

test('allein ohne Hilfen spielt der Computer von sich aus regelgerecht (sonst passte jede Karte überall) und legt ordentlich', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const rng = seeded(seed);
    let s = newGame(seed % 2, rng, { free: true });
    for (let k = 0; k < 3000 && s.winner === null; k++) {
      const p = s.turn;
      s = apply(s, p, computerMove(viewFor(s, p), p), rng);
      assert.ok(s);
      if (s.events.some((e) => e.type === 'discard')) assert.equal(s.cheat.legal, true);
      for (const e of s.events.filter((x) => x.type === 'meld')) assert.deepEqual(e.cards, arrange(e.cards, s.melds[e.index]).cards);
    }
    assert.notEqual(s.winner, null);
  }
  // Herz 4 kommt vorn an Herz 5–7 (ohne Hilfen bliebe sie dort liegen, wo er sie hinlegt)
  const s = setup({ hands: [['h4a', 'cKa', 's9a'], ['c3a']], melds: [run(1, 'h', 5, ['h5a', 'h6a', 'h7a'])] });
  assert.deepEqual(apply(s, 0, computerMove(viewFor(s, 0), 0)).melds[0].cards, ['h4a', 'h5a', 'h6a', 'h7a']);
});

// Ablauf wie in romme/index.js – hier für beide Seiten: Zug des anderen einmal prüfen (rufen oder gelten lassen),
// beim Ziehen entscheiden, ob in diesem Zug geschummelt wird, und statt des Ablegens den Schummelzug spielen
test('allein ohne Hilfen: Computer schummelt und ruft – Runden enden, keine Karte geht verloren, keine Revanche-Sperre', () => {
  const seen = { cheats: 0, caught: 0, alarms: 0, waived: 0 };
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    let s = newGame(seed % 2, rng, { free: true });
    let plan = [];
    let cheating = false;
    let judged = null;
    for (let k = 0; k < 5000; k++) {
      const c = s.cheat;
      if (c && c !== judged) {
        judged = c;
        if (cpuAccuses(!c.legal, rng)) {
          s = accuse(s, 1 - c.player, rng);
          seen[s.events[0].type === 'caught' ? 'caught' : 'alarms']++;
          continue;
        }
        if (s.winner !== null) {
          s = waive(s, 1 - c.player);
          seen.waived++;
        }
      }
      if (s.winner !== null) break;
      const p = s.turn;
      const v = viewFor(s, p);
      let m = plan.shift() ?? computerMove(v, p);
      if (m.t === 'draw') cheating = cpuCheats(rng);
      if (m.t === 'discard' && cheating) {
        cheating = false;
        plan = cheatMoves(v, p) ?? [];
        if (plan.length) seen.cheats++;
        m = plan.shift() ?? m;
      }
      s = apply(s, p, m, rng);
      assert.ok(s, `Aktion ${m.t} gültig (Partie ${seed})`);
    }
    assert.notEqual(s.winner, null);
    assert.deepEqual(all(s), DECK);
    assert.equal(rematchBlocked(s, 0) || rematchBlocked(s, 1), false);
  }
  assert.ok(seen.cheats > 0 && seen.caught > 0, JSON.stringify(seen));
});

// Vorgabe 20.10.2026 („Dann soll auch erklärt werden was falsch war“): Der Grund bleibt beim Host, bis „Geschummelt!“
// trifft – dann steht er im caught-Ereignis (why). Höchstens zwei Gründe, mit „ und “ verbunden.
const whyOf = (s, card = 'd9a') => discard(s, 0, card).cheat.why;

test('Grund: ungültige Figur – Lücke, zweimal dieselbe Farbe/Karte, gemischte Farben/Werte, über das Ass, zu viele, nur Joker', () => {
  const fig = (cards) => whyOf(meld(setup({ hands: [[...cards, 'd9a'], ['c3a']] }), 0, cards));
  assert.equal(fig(['h7a', 'h4a', 'h5a']), 'Reihe Herz 4-5-7 hat eine Lücke');
  assert.equal(fig(['h4a', 'xr1', 'h8a']), 'Reihe Herz 4-8-Joker hat eine Lücke');
  assert.equal(fig(['sKa', 'hKa', 'sKb']), 'Satz König mit zweimal Pik');
  assert.equal(fig(['h5a', 'h6a', 'h5b']), 'Reihe Herz 5-5-6 hat zweimal Herz 5');
  assert.equal(fig(['h4a', 'h5a', 's6a']), 'Reihe Herz 4, Herz 5, Pik 6 hat verschiedene Farben');
  assert.equal(fig(['hKa', 'sKa', 'cQa']), 'Satz Herz König, Pik König, Kreuz Dame hat verschiedene Werte');
  assert.equal(fig(['h2a', 's9a', 'cKa']), 'Herz 2, Pik 9, Kreuz König ist keine Figur');
  assert.equal(fig(['hKa', 'hAa', 'h2a']), 'Herz König-Ass-2 ist keine Reihe');
  assert.equal(fig(['hKa', 'sKa', 'cKa', 'dKa', 'xr1']), 'Satz König mit 5 statt höchstens 4 Karten');
  assert.equal(fig(['xr1', 'xb2', 'xr3']), 'Figur nur aus Jokern');
  // gültig gelegt (auch ungeordnet) = kein Grund
  assert.equal(whyOf(meld(setup({ hands: [['h7a', 'h5a', 'h6a', 'd9a'], ['c3a']] }), 0, ['h7a', 'h5a', 'h6a'])), null);
});

test('Grund: Herauskommen unter 30 (Joker zählt wie die ersetzte Karte), erste Runde, vor dem Herauskommen angelegt', () => {
  const out = { opened: [false, true] };
  // Herz 5-6-Joker-8: Joker = Herz 7 → 26 Punkte
  assert.equal(whyOf(meld(setup({ hands: [['h5a', 'h6a', 'xr1', 'h8a', 'd9a'], ['c3a']], ...out }), 0, ['h5a', 'h6a', 'xr1', 'h8a'])),
    'erstes Auslegen hat nur 26 statt 30 Punkte');
  // 21 Punkte gültig, dann eine Schummel-Figur: zwei Gründe
  let s = meld(setup({ hands: [['h7a', 's7a', 'c7b', 'h2a', 's9a', 'cKa', 'd9a'], ['c3a']], ...out }), 0, ['h7a', 's7a', 'c7b']);
  s = meld(s, 0, ['h2a', 's9a', 'cKa']);
  assert.equal(whyOf(s), 'Herz 2, Pik 9, Kreuz König ist keine Figur und erstes Auslegen hat nur 21 statt 30 Punkte');
  // erste Runde: nur ziehen und ablegen – mehr als zwei Gründe werden gekürzt, gleiche nur einmal genannt
  const first = { opened: [false, false], turns: 1 };
  assert.equal(whyOf(meld(setup({ hands: [['h2a', 's9a', 'cKa', 'd9a'], ['c3a']], ...first }), 0, ['h2a', 's9a', 'cKa'])),
    'in der ersten Runde schon ausgelegt und Herz 2, Pik 9, Kreuz König ist keine Figur');
  let f = meld(setup({ hands: [['h7a', 's7a', 'c7b', 'h2a', 's9a', 'cKa', 'd9a'], ['c3a']], ...first }), 0, ['h7a', 's7a', 'c7b']);
  f = meld(f, 0, ['h2a', 's9a', 'cKa']);
  assert.equal(f.faults.length, 3);
  assert.equal(whyOf(f), 'in der ersten Runde schon ausgelegt und erstes Auslegen hat nur 21 statt 30 Punkte');
  const table = [run(1, 'h', 5, ['h5a', 'h6a', 'h7a'])];
  assert.equal(whyOf(layoff(setup({ hands: [['h4a', 'd9a'], ['c3a']], melds: table, ...first }), 0, 'h4a', 0)), 'in der ersten Runde schon angelegt');
  assert.equal(whyOf(layoff(setup({ hands: [['h4a', 'd9a'], ['c3a']], melds: table, ...out }), 0, 'h4a', 0)), 'vor dem Herauskommen angelegt');
  // vorläufiger Satz Neunen (27) durch regelwidriges Anlegen auf 36 – dann ist nur das Anlegen falsch, nicht die Punkte
  const nines = meld(setup({ hands: [['h9a', 's9a', 'c9a', 'd9b', 'd9a'], ['c3a']], ...out }), 0, ['h9a', 's9a', 'c9a']);
  assert.equal(whyOf(layoff(nines, 0, 'd9b', 0)), 'vor dem Herauskommen angelegt');
});

test('Grund: unpassend angelegt, falscher Joker-Tausch, Ablagekarte gleich wieder abgelegt, eingetauschter Joker behalten', () => {
  const runTable = [run(1, 'h', 4, ['h4a', 'h5a', 'h6a'])];
  const setTable = [{ owner: 1, kind: 'set', cards: ['sKa', 'hKa', 'xr1'] }];
  assert.equal(whyOf(layoff(setup({ hands: [['s9a', 'd9a'], ['c3a']], melds: runTable }), 0, 's9a', 0)), 'Pik 9 passt nicht an Herz 4 bis 6');
  assert.equal(whyOf(layoff(setup({ hands: [['s9a', 'd9a'], ['c3a']], melds: setTable }), 0, 's9a', 0, 'low')), 'Pik 9 passt nicht an Satz König');
  // Joker vorn = Herz 4, hinten = Herz 7: Herz 7 auf den vorderen getippt
  const m = meld(setup({ hands: [['xr1', 'h5a', 'h6a', 'xb2', 'h7a', 'd9a'], ['c3a']] }), 0, ['xr1', 'h5a', 'h6a', 'xb2']);
  const wrong = swap(m, 0, 'h7a', 0, 'xr1');
  assert.equal(whyOf(layoff(wrong, 0, 'xr1', 0, 'high')), 'Herz 7 ersetzt den Joker für Herz 4 nicht');
  assert.equal(whyOf(wrong), 'Herz 7 ersetzt den Joker für Herz 4 nicht und eingetauschter Joker nicht im selben Zug ausgelegt');
  // Satz: falscher Wert bzw. Farbe schon da
  assert.equal(whyOf(swap(setup({ hands: [['cQa', 'd9a', 'c2a'], ['c3a']], melds: setTable }), 0, 'cQa', 0, 'xr1'), 'c2a'),
    'Kreuz Dame ersetzt den Joker im Satz König nicht und eingetauschter Joker nicht im selben Zug ausgelegt');
  assert.match(whyOf(swap(setup({ hands: [['sKb', 'd9a'], ['c3a']], melds: setTable }), 0, 'sKb', 0, 'xr1')), /^Pik König liegt schon im Satz König und /);
  // richtig getauscht, aber den Joker abgelegt bzw. behalten
  const right = swap(m, 0, 'h7a', 0, 'xb2');
  assert.equal(right.clean, true);
  assert.equal(whyOf(right, 'xb2'), 'eingetauschter Joker nicht im selben Zug ausgelegt');
  assert.equal(whyOf(right), 'eingetauschter Joker nicht im selben Zug ausgelegt');
  // von der Ablage genommen und gleich wieder abgelegt
  const base = { ...newGame(1, Math.random, { free: true }), hands: [['h2a', 'cKa'], ['c3a']], melds: [], turn: 0, phase: 'draw', pile: ['d2b', 'sQa'], talon: makeDeck().filter((c) => !['h2a', 'cKa', 'c3a', 'd2b', 'sQa'].includes(c)), opened: [true, true], turns: 6 };
  assert.equal(discard(draw(base, 0, 'pile'), 0, 'sQa').cheat.why, 'die genommene Ablagekarte gleich wieder abgelegt');
});

test('Grund nur beim Host und erst im caught-Ereignis; „Zug zurücksetzen“ löscht ihn; auch der Computer bekommt einen', () => {
  const m = meld(setup({ hands: [['h2a', 's9a', 'cKa', 'd9a'], ['c3a']] }), 0, ['h2a', 's9a', 'cKa']);
  assert.deepEqual(m.faults, ['Herz 2, Pik 9, Kreuz König ist keine Figur']);
  const s = discard(m, 0, 'd9a');
  for (const v of [viewFor(m, 0), viewFor(m, 1), viewFor(s, 0), viewFor(s, 1)]) assert.ok(!JSON.stringify(v).includes('keine Figur'));
  assert.deepEqual(viewFor(s, 1).cheat, { player: 0 });
  const c = accuse(s, 1, seeded(4));
  assert.equal(c.events[0].why, 'Herz 2, Pik 9, Kreuz König ist keine Figur');
  assert.deepEqual(c.faults, []);
  assert.equal(discard(undo(m, 0), 0, 'd9a').cheat.why, null);
  // Computer schummelt mit zu wenig Punkten (Satz Zweien)
  let a = setup({ hands: [['c2a', 's2a', 'h2a', 'dKa', 's9b'], ['h4a']], opened: [false, true] });
  for (const step of cheatMoves(viewFor(a, 0), 0)) a = apply(a, 0, step);
  assert.equal(a.cheat.why, 'erstes Auslegen hat nur 6 statt 30 Punkte');
});

// Jeder erwischte Zug hat einen Grund – Zufallszüge ohne Hilfen (auch Unsinn): Grund nie leer, höchstens zwei
test('Zufallszüge ohne Hilfen: regelwidrig ⇔ Grund vorhanden, nie mehr als zwei, erwischt trägt ihn', () => {
  let caught = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const rng = seeded(seed);
    const pick = (list) => list[Math.floor(rng() * list.length)];
    let s = newGame(seed % 2, rng, { free: true });
    for (let k = 0; k < 400 && s.winner === null; k++) {
      const p = s.turn;
      if (s.cheat && s.cheat.player !== p && rng() < 0.3) {
        const c = accuse(s, p, rng);
        if (c.events[0].type === 'caught') {
          caught++;
          assert.equal(c.events[0].why, s.cheat.why);
        }
        s = c;
        continue;
      }
      if (s.phase === 'draw') {
        s = draw(s, p, rng() < 0.3 ? 'pile' : 'talon', rng) ?? draw(s, p, 'talon', rng) ?? draw(s, p, 'pile', rng);
        continue;
      }
      const hand = s.hands[p];
      const r = rng();
      let next = null;
      if (r < 0.2) next = meld(s, p, [...hand].sort(() => rng() - 0.5).slice(0, 3 + Math.floor(rng() * 2)));
      else if (r < 0.4 && s.melds.length) next = layoff(s, p, pick(hand), Math.floor(rng() * s.melds.length), pick(['low', 'high']));
      else if (r < 0.5 && s.melds.length) {
        const i = Math.floor(rng() * s.melds.length);
        next = swap(s, p, pick(hand), i, s.melds[i].cards.find((c) => c[0] === 'x') ?? null);
      } else if (r < 0.55) next = undo(s, p);
      else {
        next = discard(s, p, pick(hand));
        if (next) {
          const { legal, why } = next.cheat;
          if (legal) assert.equal(why, null);
          else assert.ok(typeof why === 'string' && why.length && why.split(' und ').length <= 2, why);
        }
      }
      if (next) s = next;
    }
    assert.deepEqual(all(s), DECK);
  }
  assert.ok(caught > 20, `erwischt: ${caught}`);
});

// Prüfung 20.10.2026: Spielstand von vor den Gründen (ohne faults) – Fortsetzen darf nicht abstürzen
test('alter Spielstand ohne faults: ablegen geht weiter – auch wenn der Zug schon geschummelt war', () => {
  const s = setup({ hands: [['h5a', 'h6a', 'h7a', 'cKa'], ['c3a']] });
  const { faults, ...old } = s;
  assert.equal(discard(old, 0, 'cKa').cheat.legal, true);
  const dirty = discard({ ...old, clean: false }, 0, 'cKa'); // vor dem Speichern schon regelwidrig gespielt
  assert.equal(dirty.cheat.legal, false);
  assert.equal(typeof dirty.cheat.why, 'string');
});
