// Mensch ärgere Dich nicht „Ohne Hilfen“: Figur auf ein beliebiges Feld voraus setzen, „Geschummelt!“ bis zum eigenen Wurf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, roll, move, pass, accuse, waive, again, legalMoves, HOUSE } from '../src/maedn/rules.js';
import { cheatMove } from '../src/maedn/ai.js';
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

// --- Nico 20.10.2026: Ohne Hilfen nimmt das Spiel nichts ab – und geht auch allein gegen die Computer ---

// Ein Mensch (Sitz 0) gegen drei Computer
function solo({ pieces = {}, turn = 0, places = [] } = {}) {
  const s = newGame({ humans: [0], starter: turn, free: true });
  return { ...s, places, pieces: [0, 1, 2, 3].map((q) => pieces[q] ?? [H, H, H, H]) };
}

test('Ohne Hilfen gibt das Spiel nicht von selbst weiter: ohne passenden Wurf ziehen (geschummelt) oder „Weiter“', () => {
  const r = roll(setup({ pieces: { 0: [H, H, H, H] } }), 0, 3);
  assert.equal(r.phase, 'move'); // mit Hilfen: nochmal würfeln bzw. verfällt
  assert.equal(r.turn, 0);
  assert.equal(r.tries, 0);
  assert.deepEqual(move(r, 0, { piece: 1, to: 0 }).cheat.bad, [{ piece: 1, hits: [] }]); // ohne 6 heraus
  const w = pass(r, 0);
  assert.equal(w.turn, 1);
  assert.equal(w.events[0].type, 'weiter');
  assert.deepEqual(w.cheat, { player: 0, bad: [] }); // regelgerecht – anprangern wäre Fehlalarm
  // mit Hilfen bleibt alles wie bisher
  const strict = roll(setup({ pieces: { 0: [H, H, H, H] }, free: false }), 0, 3);
  assert.equal(strict.phase, 'roll');
  assert.equal(strict.tries, 1);
  assert.equal(pass(strict, 0), null);
});

test('Ohne Hilfen: „Weiter“, obwohl eine Figur ziehen kann, ist Schummeln', () => {
  const r = rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 3);
  assert.equal(pass(r, 2), null); // nicht dran
  const w = pass(r, 0);
  assert.deepEqual(w.cheat.bad, [{ piece: null, hits: [] }]);
  const c = accuse(w, 2);
  assert.deepEqual(types(c), ['caught', 'sitout']); // keine Figur gezogen – dafür setzt der Schummler einmal aus
  assert.equal(c.pieces[0][0], 5);
  assert.deepEqual(c.skip, [0]);
});

test('Ohne Hilfen: nochmal würfeln – bis zu dreimal, wenn keine Figur draußen ist; sonst gilt der Rest des Zugs als Schummeln', () => {
  const second = roll(roll(setup({ pieces: { 0: [H, H, H, H] } }), 0, 2), 0, 4);
  assert.equal(second.phase, 'move');
  assert.equal(second.tries, 1);
  const third = roll(second, 0, 6);
  assert.equal(third.tries, 2);
  assert.deepEqual(move(third, 0, { piece: 0, to: 0 }).cheat.bad, []); // dritter Wurf eine 6 – regelgerecht heraus
  const fourth = roll(roll(second, 0, 1), 0, 6);
  assert.deepEqual(move(fourth, 0, { piece: 0, to: 0 }).cheat.bad, [{ piece: 0, hits: [] }]);

  // Figur draußen: ein zweiter Wurf ist nicht erlaubt
  const again6 = roll(rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 2), 0, 6);
  assert.equal(again6.phase, 'move');
  const out = move(again6, 0, { piece: 1, to: 0 }); // mit der 6 heraus – passt zum Wurf, aber der Wurf war geschummelt
  assert.deepEqual(out.cheat.bad, [{ piece: 1, hits: [] }]);
  assert.equal(out.phase, 'roll'); // die 6 zählt, bis jemand „Geschummelt!“ ruft
  assert.equal(move(rolled(out, 0, 1), 0, 1).cheat.bad.length, 2); // auch der Rest des Zugs (A-Feld räumen wäre regelgerecht)
  const next = pass(rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 2), 0);
  assert.equal(next.tainted, false); // der nächste Zug ist wieder sauber
});

test('Nochmal würfeln statt ziehen und „Weiter“ gibt es nur ohne Hilfen und nur für Menschen', () => {
  const strict = rolled(setup({ pieces: { 0: [5, H, H, H] }, free: false }), 0, 3);
  assert.equal(roll(strict, 0, 4), null);
  const cpu = rolled(setup({ pieces: { 1: [5, H, H, H] }, turn: 1 }), 1, 3);
  assert.equal(roll(cpu, 1, 4), null);
  assert.equal(pass(cpu, 1), null);
  const soloCpu = rolled(solo({ pieces: { 1: [5, H, H, H] }, turn: 1 }), 1, 3);
  assert.equal(roll(soloCpu, 1, 4), null);
  assert.equal(pass(soloCpu, 1), null);
});

test('Allein ohne Hilfen: Computer dürfen schummeln – der Mensch erwischt sie bis zu seinem eigenen Wurf', () => {
  const s = solo({ pieces: { 0: [20, H, H, H], 1: [5, H, H, H], 2: [5, H, H, H] }, turn: 1 });
  const m1 = move(rolled(s, 1, 3), 1, { piece: 0, to: 9 }); // Computer 1 schummelt
  assert.deepEqual(m1.cheat, { player: 1, bad: [{ piece: 0, hits: [], player: 1 }] });
  const m2 = move(rolled(m1, 2, 2), 2, 0); // Computer 2 zieht regelgerecht – die Frist läuft weiter
  assert.equal(m2.cheat.player, 2);
  assert.equal(m2.cheat.bad.length, 1);
  assert.equal(accuse(m2, 3), null); // Computer prangern keine Computer an
  const c = accuse(m2, 0);
  assert.deepEqual(types(c), ['caught', 'home']);
  assert.equal(c.events[0].player, 1);
  assert.equal(c.pieces[1][0], H);
  assert.equal(c.turn, 3); // Computer 3 ist weiter dran

  const toHuman = roll(roll(roll(m2, 3, 1), 3, 2), 3, 3); // Computer 3 hat nichts draußen
  assert.equal(toHuman.turn, 0);
  assert.ok(toHuman.cheat); // Würfe der Computer schließen die Frist nicht
  const own = roll(toHuman, 0, 4);
  assert.equal(own.cheat, null);
  assert.equal(accuse(own, 0), null);
});

test('Allein ohne Hilfen: der Computer am Zug darf den Menschen anprangern – würfelt er, ist die Frist vorbei', () => {
  const s = solo({ pieces: { 0: [5, H, H, H], 1: [10, H, H, H] } });
  const m = move(rolled(s, 0, 3), 0, { piece: 0, to: 9 });
  assert.equal(m.turn, 1);
  const c = accuse(m, 1);
  assert.equal(c.pieces[0][0], H);
  assert.equal(c.turn, 1);
  assert.equal(c.phase, 'roll');
  assert.equal(roll(m, 1, 2).cheat, null); // gewürfelt = verzichtet

  const f = accuse(move(rolled(s, 0, 3), 0, 0), 1); // regelgerecht gezogen
  assert.deepEqual(types(f), ['fehlalarm', 'skipped', 'turn']); // der Computer setzt sofort aus
  assert.equal(f.turn, 2);

  // zu zweit rufen die Computer weiterhin nicht
  assert.equal(accuse(move(rolled(setup({ pieces: { 0: [5, H, H, H] } }), 0, 3), 0, { piece: 0, to: 9 }), 1), null);
});

test('Allein nach Spielende: der Computer prangert an oder lässt die Frist verstreichen (waive)', () => {
  const m = move(rolled(solo({ pieces: { 0: [40, 41, 42, 35] } }), 0, 3), 0, { piece: 3, to: 43 });
  assert.equal(m.phase, 'over');
  assert.equal(rematchBlocked(m, 0), true);
  assert.equal(waive(m, 0), null); // nicht der Schummler selbst
  const w = waive(m, 1);
  assert.equal(w.cheat, null);
  assert.equal(w.phase, 'over');
  assert.equal(rematchBlocked(w, 0), false);
  assert.equal(waive(w, 1), null);
  const c = accuse(m, 1);
  assert.equal(c.phase, 'roll');
  assert.equal(c.pieces[0][3], H);
});

test('Schummelzug des Computers: ein Feld weiter als gewürfelt oder ohne 6 heraus – am liebsten mit Schlag', () => {
  // Gelb steht auf Stand 19 = Feld 9 von Sitz 1
  const s = rolled(solo({ pieces: { 0: [19, H, H, H], 1: [5, H, H, H] }, turn: 1 }), 1, 3);
  assert.deepEqual(cheatMove(s, 1, () => 0), { piece: 0, to: 9 });
  const m = move(s, 1, cheatMove(s, 1, () => 0));
  assert.equal(m.pieces[0][0], H);
  assert.equal(m.cheat.bad.length, 1);
  // nichts draußen: ohne 6 heraus – dafür bleibt der Computer nach dem Wurf in der Zugphase (keep), nur allein ohne Hilfen
  const home = roll(solo({ turn: 1 }), 1, 2, true);
  assert.equal(home.phase, 'move');
  assert.deepEqual(cheatMove(home, 1, () => 0), { piece: 0, to: 0 });
  assert.equal(move(home, 1, cheatMove(home, 1, () => 0)).cheat.bad.length, 1);
  assert.equal(roll(solo({ turn: 1 }), 1, 2).phase, 'roll'); // ohne keep wie bisher: nochmal würfeln
  assert.equal(roll(setup({ turn: 1 }), 1, 2, true).phase, 'roll'); // zu zweit schummeln Computer nicht
  // nie auf eine eigene Figur, nie über d hinaus
  for (let k = 0; k < 20; k++) {
    const t = cheatMove({ ...solo({ pieces: { 1: [5, 9, 39, H] }, turn: 1 }), phase: 'move', die: 3 }, 1);
    assert.ok(t.to !== 9 && t.to <= 43, JSON.stringify(t));
  }
  assert.equal(cheatMove({ ...solo({ pieces: { 1: [40, 41, 42, 43] }, turn: 1 }), phase: 'move', die: 1 }, 1), null);
});
