import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyShot, placeCue, targets, freeSpot, again, rack, R, TABLE, HEAD, FOOT } from '../src/billard/rules.js';

// Stand ohne Anstoß, mit vorgegebenen Gruppen und versenkten Kugeln
function midGame({ groups = [null, null], pocketed = [], turn = 0 } = {}) {
  const s = newGame({ rng: () => 0.5 });
  const positions = Object.fromEntries(Object.entries(s.positions).filter(([n]) => !pocketed.includes(Number(n))));
  return { ...s, isBreak: false, groups, pocketed, turn, positions };
}

// Ergebnis eines Stoßes: alles bleibt liegen, außer was versenkt wurde
const shot = (s, { first = 1, rail = true, pocketed = [] } = {}) => ({ first, rail, pocketed, positions: { ...s.positions } });

test('Aufbau: 15 Kugeln im Dreieck am Fußpunkt, 8 in der Mitte, Weiße am Kopfpunkt, nichts überlappt', () => {
  const p = rack(() => 0.3);
  assert.deepEqual(Object.keys(p).map(Number).sort((a, b) => a - b), [...Array(16).keys()]);
  assert.deepEqual(p[0], HEAD);
  const apex = Object.values(p).find(([x]) => Math.abs(x - FOOT[0]) < 1e-9);
  assert.ok(apex);
  const third = Object.entries(p).filter(([, [x]]) => x > FOOT[0] + 3 * R && x < FOOT[0] + 4.5 * R);
  assert.equal(third.find(([, [, z]]) => Math.abs(z) < 1e-9)[0], '8');
  const list = Object.values(p);
  for (let i = 0; i < list.length; i++) for (let k = i + 1; k < list.length; k++) assert.ok(Math.hypot(list[i][0] - list[k][0], list[i][1] - list[k][1]) >= 2 * R);
  for (const [x, z] of list) assert.ok(Math.abs(x) < TABLE.L / 2 && Math.abs(z) < TABLE.W / 2);
});

test('Anstoß: versenkte Kugel → weiter, Tisch bleibt offen', () => {
  const s = newGame({ rng: () => 0.5 });
  const next = applyShot(s, 0, shot(s, { pocketed: [3] }));
  assert.equal(next.turn, 0);
  assert.deepEqual(next.groups, [null, null]);
  assert.equal(next.isBreak, false);
  assert.equal(next.positions[3], undefined);
});

test('Anstoß: 8 versenkt → wird wieder aufgesetzt, Partie läuft weiter', () => {
  const s = newGame({ rng: () => 0.5 });
  const next = applyShot(s, 0, shot(s, { pocketed: [8] }));
  assert.equal(next.winner, null);
  assert.ok(next.positions[8]);
  assert.ok(!next.pocketed.includes(8));
});

test('Offener Tisch: erste regelgerecht versenkte Kugel bestimmt die Gruppen', () => {
  const s = midGame();
  const next = applyShot(s, 1, { ...shot(s, { first: 12, pocketed: [12] }), positions: s.positions });
  assert.equal(next, null); // nicht dran
  const ok = applyShot(s, 0, shot(s, { first: 12, pocketed: [12] }));
  assert.deepEqual(ok.groups, ['halbe', 'volle']);
  assert.equal(ok.turn, 0);
});

test('Offener Tisch: zuerst die 8 getroffen = Foul', () => {
  const s = midGame();
  const next = applyShot(s, 0, shot(s, { first: 8 }));
  assert.equal(next.last.foul, 'Zuerst eine falsche Kugel getroffen');
  assert.equal(next.turn, 1);
  assert.equal(next.ballInHand, true);
});

test('Fouls: Weiße versenkt, nichts getroffen, fremde Kugel zuerst, keine Bande', () => {
  const s = midGame({ groups: ['volle', 'halbe'] });
  const scratch = applyShot(s, 0, shot(s, { first: 2, pocketed: [0] }));
  assert.equal(scratch.last.foul, 'Weiße versenkt');
  assert.equal(scratch.positions[0], undefined); // der andere legt sie neu hin
  assert.equal(scratch.ballInHand, true);
  assert.equal(applyShot(s, 0, shot(s, { first: null })).last.foul, 'Keine Kugel getroffen');
  assert.equal(applyShot(s, 0, shot(s, { first: 11 })).last.foul, 'Zuerst eine falsche Kugel getroffen');
  assert.equal(applyShot(s, 0, shot(s, { first: 2, rail: false })).last.foul, 'Nach dem Treffen keine Bande berührt');
  const clean = applyShot(s, 0, shot(s, { first: 2, rail: false, pocketed: [2] })); // versenkt reicht statt Bande
  assert.equal(clean.last.foul, null);
  assert.equal(clean.turn, 0);
});

test('Fremde Kugel versenkt ohne eigene → Wechsel, aber kein Foul', () => {
  const s = midGame({ groups: ['volle', 'halbe'] });
  const next = applyShot(s, 0, shot(s, { first: 3, pocketed: [10] }));
  assert.equal(next.last.foul, null);
  assert.equal(next.turn, 1);
  assert.ok(next.pocketed.includes(10));
});

test('Die 8: zu früh = verloren, nach der eigenen Gruppe = gewonnen, mit Foul = verloren', () => {
  const early = midGame({ groups: ['volle', 'halbe'] });
  assert.equal(applyShot(early, 0, shot(early, { first: 2, pocketed: [8] })).winner, 1);

  const cleared = midGame({ groups: ['volle', 'halbe'], pocketed: [1, 2, 3, 4, 5, 6, 7] });
  assert.deepEqual(targets(cleared, 0), [8]);
  const won = applyShot(cleared, 0, shot(cleared, { first: 8, pocketed: [8] }));
  assert.equal(won.winner, 0);
  assert.equal(won.last.eight, 'gewonnen');
  assert.equal(applyShot(cleared, 0, shot(cleared, { first: 8, pocketed: [8, 0] })).winner, 1);
  assert.equal(applyShot(cleared, 0, shot(cleared, { first: 10, pocketed: [8] })).winner, 1); // falsche Kugel zuerst
});

test('Letzte eigene und die 8 im selben Stoß = verloren (8 erst, wenn die Gruppe vorher weg war)', () => {
  const s = midGame({ groups: ['volle', 'halbe'], pocketed: [1, 2, 3, 4, 5, 6] });
  assert.equal(applyShot(s, 0, shot(s, { first: 7, pocketed: [7, 8] })).winner, 1);
});

test('Ball in Hand: Weiße nur an freie Stelle auf dem Tisch, nur wer dran ist', () => {
  const s = applyShot(midGame({ groups: ['volle', 'halbe'] }), 0, shot(midGame(), { first: 2, pocketed: [0] }));
  assert.equal(placeCue(s, 0, [0, 0]), null); // nicht dran
  assert.equal(placeCue(s, 1, [TABLE.L, 0]), null); // neben dem Tisch
  assert.equal(placeCue(s, 1, s.positions[1]), null); // auf einer Kugel
  const placed = placeCue(s, 1, [-0.5, 0.1]);
  assert.deepEqual(placed.positions[0], [-0.5, 0.1]);
  assert.ok(freeSpot(s, [-0.5, 0.1]));
});

test('Unsinnige Meldungen werden abgelehnt, Revanche wechselt den Anstoß', () => {
  const s = midGame();
  for (const bad of [null, {}, { first: 99, rail: true, pocketed: [], positions: {} }, { first: 1, rail: 'ja', pocketed: [], positions: {} }, { first: 1, rail: true, pocketed: [16], positions: {} }, { first: 1, rail: true, pocketed: [], positions: { 3: [NaN, 0] } }]) {
    assert.equal(applyShot(s, 0, bad), null);
  }
  const over = { ...s, winner: 0, breaker: 0 };
  assert.equal(again(over).breaker, 1);
  assert.equal(again(s), null);
});

// --- Befunde der Prüfung vom 19.10.2026 ---
test('Anstoß: nur die 8 versenkt → aufgesetzt, der Anstoßende stößt weiter (WPA 3.4)', () => {
  const s = newGame({ rng: () => 0.5 });
  const next = applyShot(s, 0, shot(s, { pocketed: [8] }));
  assert.equal(next.turn, 0);
  assert.equal(next.last.foul, null);
});

test('Meldung muss zu den Kugeln passen: keine verschwindet, keine kommt zurück', () => {
  const s = midGame({ groups: ['volle', 'halbe'], pocketed: [2] });
  const { 5: gone, ...missing } = s.positions;
  assert.ok(gone);
  assert.equal(applyShot(s, 0, { first: 1, rail: true, pocketed: [], positions: missing }), null);
  assert.equal(applyShot(s, 0, { first: 1, rail: true, pocketed: [], positions: { ...s.positions, 2: [0.3, 0.3] } }), null);
  assert.equal(applyShot(s, 0, { first: 1, rail: true, pocketed: [2], positions: s.positions }), null);
});

test('Ball in Hand: erst hinlegen, dann stoßen', () => {
  const s = { ...midGame({ groups: ['volle', 'halbe'] }), ballInHand: true };
  assert.equal(applyShot(s, 0, shot(s)), null);
  const placed = placeCue(s, 0, [-0.6, 0.2]);
  assert.equal(placed.ballInHand, false);
  assert.ok(applyShot(placed, 0, shot(placed, { first: 3 })));
});
