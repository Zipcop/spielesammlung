// Mensch ärgere Dich nicht „Ohne Hilfen“: Figur auf ein beliebiges Feld voraus setzen, „Geschummelt!“ bis zum eigenen Wurf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, roll, move, accuse, again, legalMoves, HOUSE } from '../src/maedn/rules.js';
import { rematchBlocked } from '../src/schummeln.js';

const H = HOUSE;

// Zwei Menschen (Sitz 0 und 2), Computer auf 1 und 3; nicht genannte Sitze haben alle Figuren im Haus
function setup({ pieces = {}, turn = 0, places = [], free = true } = {}) {
  const s = newGame({ humans: [0, 2], starter: turn, free });
  return { ...s, places, pieces: [0, 1, 2, 3].map((q) => pieces[q] ?? [H, H, H, H]) };
}

function rolled(s, player, value) {
  const r = roll(s, player, value);
  assert.equal(r?.phase, 'move', `Wurf ${value} von Sitz ${player} muss einen Zug erlauben`);
  return r;
}

const types = (s) => s.events.map((e) => e.type);

test('Ohne Hilfen: beliebiges Feld voraus – nie rückwärts, nie über d hinaus, nie auf eine eigene Figur', () => {
  const r = rolled(setup({ pieces: { 0: [5, 12, 40, H] } }), 0, 3);
  const m = move(r, 0, { piece: 0, to: 9 });
  assert.equal(m.pieces[0][0], 9);
  assert.deepEqual(m.cheat, { player: 0, bad: [{ piece: 0, hits: [] }] });
  for (const bad of [{ piece: 0, to: 4 }, { piece: 0, to: 5 }, { piece: 0, to: 44 }, { piece: 0, to: 7.5 }, { piece: 0, to: 12 }, { piece: 0, to: 40 }, { piece: 7, to: 9 }, { piece: '0', to: 9 }, {}]) {
    assert.equal(move(r, 0, bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(move(r, 0, { piece: 0, to: 8 }).cheat, { player: 0, bad: [] }); // genau gewürfelt = regelgerecht
});

test('Nur ohne Hilfen und nur für Menschen – Computer ziehen immer regelgerecht', () => {
  const strict = rolled(setup({ pieces: { 0: [5, H, H, H] }, free: false }), 0, 3);
  assert.equal(move(strict, 0, { piece: 0, to: 9 }), null);
  assert.equal(move(strict, 0, 0).cheat, null);
  const cpu = rolled(setup({ pieces: { 1: [5, H, H, H] }, turn: 1 }), 1, 3);
  assert.equal(move(cpu, 1, { piece: 0, to: 9 }), null);
  assert.equal(move(cpu, 1, 0).cheat, null);
});

test('Figuren im Haus sind gleich: mit der 6 irgendeine heraus ist regelgerecht, ohne 6 nicht', () => {
  const s = setup({ pieces: { 0: [10, H, H, H] } });
  assert.deepEqual(move(rolled(s, 0, 6), 0, { piece: 3, to: 0 }).cheat.bad, []);
  assert.deepEqual(move(rolled(s, 0, 5), 0, { piece: 2, to: 0 }).cheat.bad, [{ piece: 2, hits: [] }]);
});

test('Erwischt: Figur zurück ins Haus, geschlagene Figur zurück auf ihr Feld', () => {
  // Sitz 2 steht auf Feld 29 seines Wegs = Feld 9 von Sitz 0
  const s = setup({ pieces: { 0: [5, H, H, H], 2: [29, H, H, H] } });
  const m = move(rolled(s, 0, 3), 0, { piece: 0, to: 9 });
  assert.equal(m.pieces[2][0], H);
  assert.equal(m.turn, 1);
  assert.equal(accuse(m, 0), null); // nicht sich selbst
  assert.equal(accuse(m, 1), null); // Computer rufen nicht
  const c = accuse(m, 2);
  assert.equal(c.pieces[0][0], H);
  assert.equal(c.pieces[2][0], 29);
  assert.deepEqual(types(c), ['caught', 'home', 'back']);
  assert.equal(c.turn, 1); // der Computer ist weiter dran
  assert.equal(c.cheat, null);
  assert.equal(c.seq, m.seq + 1);
});

test('Schummeln vor der 6: bleibt nach dem nächsten eigenen Zug anfechtbar, erwischt ist der Zug vorbei', () => {
  const s = setup({ pieces: { 0: [5, H, H, H] } });
  const m = move(rolled(s, 0, 6), 0, { piece: 0, to: 13 }); // regelgerecht wäre 5 + 6 = 11 (oder neue Figur heraus)
  assert.equal(m.turn, 0);
  assert.equal(m.phase, 'roll');
  const caughtNow = accuse(m, 2);
  assert.equal(caughtNow.pieces[0][0], H);
  assert.equal(caughtNow.turn, 1); // kein weiterer Wurf für den Schummler
  const later = move(rolled(m, 0, 2), 0, 0); // regelgerecht hinterher
  assert.deepEqual(later.cheat.bad, [{ piece: 0, hits: [] }]);
  assert.equal(accuse(later, 2).pieces[0][0], H);
});

test('Fehlalarm: der Ankläger setzt einmal aus – sofort, wenn er gerade würfeln müsste', () => {
  const m = move(rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 3), 0, 0);
  const f = accuse(m, 2);
  assert.deepEqual(types(f), ['fehlalarm']);
  assert.deepEqual(f.skip, [2]);
  assert.equal(accuse(f, 2), null); // pro Zug nur einmal
  // Computer 1 hat nichts draußen: dreimal würfeln ohne 6, dann wäre 2 dran – setzt aber aus
  const passed = roll(roll(roll(f, 1, 1), 1, 2), 1, 3);
  assert.equal(passed.turn, 3);
  assert.deepEqual(passed.skip, []);
  assert.ok(passed.events.some((e) => e.type === 'skipped' && e.player === 2));

  const onTurn = { ...setup({ turn: 2 }), cheat: { player: 0, bad: [] } };
  const now = accuse(onTurn, 2);
  assert.equal(now.turn, 3);
  assert.deepEqual(now.skip, []);
});

test('Wer würfelt, verzichtet auf die Anklage – Computer-Züge dazwischen schließen sie nicht', () => {
  const s = setup({ pieces: { 0: [5, H, H, H], 1: [5, H, H, H], 2: [10, H, H, H] } });
  const m = move(rolled(s, 0, 3), 0, { piece: 0, to: 9 });
  const cpu = move(rolled(m, 1, 2), 1, 0);
  assert.equal(cpu.turn, 2);
  assert.equal(cpu.cheat.player, 0); // noch offen
  const own = roll(cpu, 2, 1);
  assert.equal(own.cheat, null);
  assert.equal(accuse(own, 2), null);
});

test('Erwischt nach Spielende: der Schummler ist nicht mehr fertig, das Spiel geht weiter', () => {
  const s = setup({ pieces: { 0: [40, 41, 42, 35], 2: [40, 41, 42, 43] }, places: [2] });
  const m = move(rolled(s, 0, 3), 0, { piece: 3, to: 43 });
  assert.equal(m.phase, 'over');
  assert.equal(rematchBlocked(m, 0), true); // Schummler kann die Anklage nicht per Revanche wegklicken
  assert.equal(rematchBlocked(m, 2), false);
  const c = accuse(m, 2);
  assert.equal(c.phase, 'roll');
  assert.deepEqual(c.places, [2]);
  assert.equal(c.pieces[0][3], H);
  assert.equal(c.turn, 1);
});

test('Erwischt: kann der Computer danach nicht mehr ziehen, verfällt sein Zug', () => {
  // Sitz 0 springt von 6 auf 8 und schlägt dort Figur 1 von Sitz 1 (Feld 38 ihres Wegs = 8)
  const s = setup({ pieces: { 0: [6, H, H, H], 1: [36, 38, 40, 42] } });
  const m = move(rolled(s, 0, 1), 0, { piece: 0, to: 8 });
  assert.equal(m.pieces[1][1], H);
  const r = rolled(m, 1, 2); // einziger Zug: 36 → 38 (schlägt den Schummler)
  assert.deepEqual(legalMoves(r), [0]);
  const c = accuse(r, 2);
  assert.equal(c.pieces[1][1], 38); // zurück auf ihr Feld – jetzt ist alles blockiert
  assert.deepEqual(legalMoves({ ...c, turn: 1, phase: 'move', die: 2 }), []);
  assert.equal(c.turn, 2);
  assert.equal(c.phase, 'roll');
});

// --- Befunde der Prüfung vom 19.10.2026 ---
test('Fertiger Ankläger: Frist endet, wenn sein Platz übersprungen wird – Schummelzüge sammeln sich nicht über Runden', () => {
  const s = setup({ pieces: { 0: [5, H, H, H], 1: [5, H, H, H], 2: [40, 41, 42, 43] }, places: [2] });
  const m = move(rolled(s, 0, 3), 0, { piece: 0, to: 9 });
  assert.ok(accuse(m, 2)); // während der Computer dran ist, geht es noch
  const cpu = move(rolled(m, 1, 2), 1, 0); // Sitz 2 ist fertig und wird übersprungen
  assert.equal(cpu.turn, 3);
  assert.equal(cpu.cheat, null);
  assert.equal(accuse(cpu, 2), null);
});

test('Aussetzender Ankläger: Frist endet mit dem übersprungenen Zug', () => {
  const s = { ...setup({ pieces: { 0: [9, H, H, H] }, turn: 1 }), skip: [2], cheat: { player: 0, bad: [{ piece: 0, hits: [] }] } };
  const passed = roll(roll(roll(s, 1, 1), 1, 2), 1, 3); // Computer 1 hat nichts draußen
  assert.equal(passed.turn, 3);
  assert.equal(passed.cheat, null);
  assert.equal(accuse(passed, 2), null);
});

test('Zug merkt sich den Wurf (für den Verlauf: „würfelt eine 3 und zieht“)', () => {
  const m = move(rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 3), 0, { piece: 0, to: 9 });
  assert.equal(m.events[0].die, 3);
});

test('Revanche behält „Ohne Hilfen“', () => {
  assert.equal(again({ ...setup(), phase: 'over' }).free, true);
  assert.equal(again({ ...setup({ free: false }), phase: 'over' }).free, false);
});
