// Kniffel „Ohne Hilfen“ (Nico 20.10.2026): kein Bonus-Countdown, Summen erst am Ende,
// Zusatz-Kniffel (+50) sagt man selbst an – falsch angesagt = Schummeln, vergessen = eigener Verlust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as kniffel from '../src/kniffel/game.js';
import { FIELDS, MAX } from '../src/kniffel/rules.js';
import { createSheet } from '../src/kniffel/sheet.js';

// Kniffel-Feld schon mit 50 belegt, dann gewürfelt – fünf Sechsen = Zusatz-Kniffel
function rolled(dice, { free = true, card = { kniffel: 50 } } = {}) {
  return kniffel.applyRoll({ ...kniffel.newGame(0, { free }), cards: [card, {}] }, 0, dice);
}

test('ohne Hilfen: Zusatz-Kniffel zählt nur, wenn man ihn selbst ansagt – vergessen ist kein Schummeln', () => {
  const forgot = kniffel.scoreField(rolled([6, 6, 6, 6, 6]), 0, 'sechser', 30);
  assert.equal(forgot.extra[0], 0);
  assert.equal(forgot.cheat.legal, true);

  const said = kniffel.scoreField(rolled([6, 6, 6, 6, 6]), 0, 'sechser', 30, true);
  assert.equal(said.extra[0], 1);
  assert.equal(said.cheat.legal, true);
  assert.deepEqual(kniffel.scores(said), [50 + 30 + 50, 0]);
  const alarm = kniffel.accuse(said, 1); // stimmt alles → Fehlalarm, die 50 bleiben
  assert.equal(alarm.extra[0], 1);
  assert.equal(alarm.verdict.caught, false);
});

test('ohne Hilfen: falsch angesagter Zusatz-Kniffel ist Schummeln – erwischt: Feld 0, die 50 sind weg', () => {
  const s = kniffel.scoreField(rolled([6, 6, 6, 6, 5]), 0, 'sechser', 24, true);
  assert.equal(s.extra[0], 1); // angesagt = erst einmal gutgeschrieben
  assert.equal(s.cheat.legal, false);
  const caught = kniffel.accuse(s, 1);
  assert.equal(caught.cards[0].sechser, 0);
  assert.equal(caught.extra[0], 0);
  assert.deepEqual(caught.verdict, { caught: true, player: 0, by: 1, field: 'sechser', extra: true });

  const missed = kniffel.applyRoll(s, 1, [1, 2, 3, 4, 5]); // nicht erwischt → die 50 bleiben
  assert.equal(missed.extra[0], 1);
  assert.equal(kniffel.accuse(missed, 1), null);
});

test('ohne Hilfen: der erste Kniffel ist kein Zusatz-Kniffel', () => {
  const s = kniffel.scoreField(rolled([4, 4, 4, 4, 4], { card: {} }), 0, 'kniffel', 50, true);
  assert.equal(s.cheat.legal, false);
  assert.equal(kniffel.accuse(s, 1).extra[0], 0);
});

test('ohne Hilfen: die Ansage muss true oder false sein (der Gast schickt sie an den Host)', () => {
  const s = rolled([6, 6, 6, 6, 6]);
  for (const bad of ['true', 1, null, {}]) assert.equal(kniffel.scoreField(s, 0, 'sechser', 30, bad), null);
  const sent = JSON.parse(JSON.stringify({ field: 'sechser', claim: 30, extra: true })); // so kommt die Nachricht an
  assert.equal(kniffel.scoreField(s, 0, sent.field, sent.claim, sent.extra).extra[0], 1);
});

test('mit Hilfen: Zusatz-Kniffel wird weiter automatisch gutgeschrieben, eine Ansage ändert nichts', () => {
  assert.equal(kniffel.scoreField(rolled([6, 6, 6, 6, 6], { free: false }), 0, 'sechser').extra[0], 1);
  const s = kniffel.scoreField(rolled([1, 2, 3, 4, 6], { free: false }), 0, 'chance', undefined, true);
  assert.equal(s.extra[0], 0);
  assert.equal(s.cheat, null);
});

// --- Block (sheet.js) mit einem Mini-DOM: jedes Element ist ein schlichtes Objekt, das sich Text und Kinder merkt ---

function node(props = {}) {
  return {
    textContent: '', className: '', children: [], parentElement: {},
    classList: { add() {}, toggle() {} },
    focus() {},
    append(...c) { this.children.push(...c); },
    replaceChildren(...c) { this.children = c; this.textContent = c.map((n) => n.textContent).join(''); },
    ...props,
  };
}
globalThis.document = { createElement: (tag) => node({ tagName: tag.toUpperCase() }) };

function sheetFor(me = 0) {
  const nodes = new Map();
  const root = { querySelector: (sel) => nodes.get(sel) ?? nodes.set(sel, node()).get(sel) };
  const sheet = createSheet(root, { me, onPick() {} });
  const cell = (p, key) => root.querySelector(`td[data-player="${p}"][data-key="${key}"]`);
  return { sheet, cell, text: (p, key) => String(cell(p, key).textContent) };
}

const find = (n, pred) => (pred(n) ? n : n.children?.map((c) => find(c, pred)).find(Boolean));
const SUMS = ['upper', 'bonus', 'lower', 'total'];
const midGame = (free) => ({ ...kniffel.newGame(0, { free }), cards: [{ einser: 3, sechser: 24, chance: 20 }, { zweier: 4 }] });

test('Block ohne Hilfen: während des Spiels keine Summen und kein „noch X“ bis zum Bonus', () => {
  const { sheet, text } = sheetFor();
  sheet.render(midGame(true), false, ['A', 'B']);
  for (const p of [0, 1]) for (const key of SUMS) assert.equal(text(p, key), '', `${key} bei Spieler ${p}`);
  assert.equal(text(0, 'einser'), '3'); // eingetragene Punkte bleiben sichtbar
});

test('Block ohne Hilfen: am Ende wird automatisch zusammengezählt', () => {
  const full = Object.fromEntries(FIELDS.map((f) => [f, MAX[f]]));
  const s = { ...kniffel.newGame(0, { free: true }), cards: [full, { ...full, sechser: 0 }], extra: [1, 0], penalty: [0, 10], over: true };
  const { sheet, text } = sheetFor();
  sheet.render(s, false, ['A', 'B']);
  assert.equal(text(0, 'upper'), '105');
  assert.equal(text(0, 'bonus'), '35');
  assert.equal(text(1, 'bonus'), '35'); // 75 oben
  assert.equal(text(0, 'lower'), '235');
  assert.deepEqual([text(0, 'total'), text(1, 'total')], kniffel.scores(s).map(String));
});

test('Block mit Hilfen: Summen und Bonus-Countdown bleiben', () => {
  const { sheet, text } = sheetFor();
  sheet.render(midGame(false), false, ['A', 'B']);
  assert.equal(text(0, 'upper'), '27');
  assert.equal(text(0, 'bonus'), `noch ${63 - 27}`);
  assert.equal(text(0, 'total'), '47');
});

test('Block ohne Hilfen: Zusatz-Kniffel beim Eintragen selbst ankreuzen', () => {
  const claim = (tick, key = 'Enter') => {
    const { sheet, cell } = sheetFor();
    let got = 'offen';
    sheet.askClaim('sechser', (...a) => (got = a));
    const input = find(cell(0, 'sechser'), (n) => n.type === 'number');
    const box = find(cell(0, 'extra'), (n) => n.type === 'checkbox'); // Haken in der eigenen Zusatz-Kniffel-Zeile
    assert.ok(box, 'Kästchen für den Zusatz-Kniffel');
    input.value = '30';
    box.checked = tick;
    input.onkeydown({ key, stopPropagation() {} });
    return got;
  };
  assert.deepEqual(claim(true), [30, true]);
  assert.deepEqual(claim(false), [30, false]);
  assert.deepEqual(claim(true, 'Escape'), [null]);
});

test('Block ohne Hilfen: auch „+50“ anklicken setzt den Haken', () => {
  const { sheet, cell } = sheetFor();
  sheet.askClaim('sechser', () => {});
  const extra = cell(0, 'extra');
  const box = find(extra, (n) => n.type === 'checkbox');
  find(extra, (n) => n.onclick).onclick({ target: find(extra, (n) => n.textContent === ' +50') });
  assert.equal(box.checked, true);
});

// Browser-Befund 20.10.2026: Ein onclick-Handler, der false zurückgibt, bricht den Klick ab – der Browser nimmt den
// Haken dann wieder weg. Direkt aufs Kästchen geklickt, darf der Handler also nichts zurückgeben (und nichts umschalten).
test('Block ohne Hilfen: Klick direkt aufs Kästchen wird nicht abgebrochen', () => {
  const { sheet, cell } = sheetFor();
  sheet.askClaim('sechser', () => {});
  const extra = cell(0, 'extra');
  const box = find(extra, (n) => n.type === 'checkbox');
  box.checked = true; // so hat der Browser den Haken beim Klick schon gesetzt
  assert.notEqual(find(extra, (n) => n.onclick).onclick({ target: box }), false);
  assert.equal(box.checked, true);
});
