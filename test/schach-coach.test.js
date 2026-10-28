// Coach (src/schach/coach.js): Sätze nur aus Fakten der Stellung und der Stockfish-Variante – hier an festen Stellungen
// mit bekannter Hauptvariante geprüft (ohne Engine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { explainThreat, explainBetter, lineFacts, praise, warns, evalText, german } from '../src/schach/coach.js';

test('Hängende Figur: ungedeckt, Zug, was er gewinnt', () => {
  // Schwarz am Zug, der weiße Läufer e5 ist ungedeckt
  const t = explainThreat('4k3/8/2n5/4B3/8/8/8/4K3 b - - 0 1', ['c6e5', 'e1e2'], { cp: 300 });
  assert.equal(t.text, 'Pass auf – dein Läufer auf e5 ist ungedeckt: Ich kann jetzt **Sxe5** spielen und gewinne ihn.');
  assert.equal(t.threat, true);
  assert.equal(t.uci, 'c6e5');
  // Dame: „sie“
  assert.match(explainThreat('4k3/8/2n5/4Q3/8/8/8/4K3 b - - 0 1', ['c6e5', 'e1e2'], { cp: 900 }).text, /deine Dame auf e5 ist ungedeckt: .* gewinne sie\./);
});

test('Gabel: Springer greift König und Turm an und gewinnt den Turm', () => {
  const t = explainThreat('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d7', 'c7a8', 'd7c6'], { cp: 500 });
  assert.equal(t.text, 'Pass auf – nach deinem Zug kann ich jetzt **Sc7+** spielen – Schach! – und gewinne deinen Turm. '
    + 'Das ist eine Gabel: Mein Springer greift deinen König und deinen Turm gleichzeitig an.');
  const f = lineFacts('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d7', 'c7a8', 'd7c6']);
  assert.deepEqual(f.fork, ['k', 'r']);
  assert.equal(f.gain, 5);
  assert.equal(f.check, true);
});

test('Doppelangriff der Dame heißt nicht Gabel', () => {
  // Dame d4 greift die ungedeckten Türme a7 und h8 über beide Diagonalen an, der König steht weit weg
  const fen = '7r/r7/8/8/8/6k1/8/1K1Q4 w - - 0 1';
  const f = lineFacts(fen, ['d1d4', 'g3f3', 'd4a7']);
  assert.deepEqual(f.fork, ['r', 'r']);
  assert.equal(explainThreat(fen, ['d1d4', 'g3f3', 'd4a7'], { cp: 500 }).text,
    'Pass auf – nach deinem Zug kann ich jetzt **Dd4** spielen und gewinne deinen Turm. Das ist ein Doppelangriff: Meine Dame greift zwei Türme gleichzeitig an.');
});

test('Matt in 1 und Matt in n', () => {
  assert.equal(explainThreat('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8'], { mate: 1 }).text, 'Pass auf – nach deinem Zug kann ich jetzt **Ta8#** spielen: Schachmatt!');
  assert.equal(explainThreat('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', ['f3f7'], { mate: 1 }).text,
    'Pass auf – nach deinem Zug kann ich jetzt **Dxf7#** spielen: Schachmatt!');
  // Matt in 2: Kb6, dann Th8#
  const t = explainThreat('k7/8/2K5/8/8/8/8/7R w - - 0 1', ['c6b6', 'a8b8', 'h1h8'], { mate: 2 });
  assert.equal(t.text, 'Pass auf – nach deinem Zug kann ich jetzt **Kb6** spielen und setze dich in 2 Zügen matt.');
  assert.equal(explainBetter('k7/8/2K5/8/8/8/8/7R w - - 0 1', ['c6b6', 'a8b8', 'h1h8'], { mate: 2 }, { cp: 900 }, null).text,
    'Besser wäre **Kb6** gewesen – damit setzt du in 2 Zügen matt.');
  assert.equal(explainBetter('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ['a1a8'], { mate: 1 }, { cp: 500 }, null).text, 'Besser wäre **Ta8#** gewesen – das ist Schachmatt!');
});

test('Tausch mit Gewinn: Turm gegen Springer', () => {
  const t = explainThreat('3rk3/8/2N5/8/8/8/8/4K3 w - - 0 1', ['c6d8', 'e8d8', 'e1e2'], { cp: 250 });
  assert.equal(t.text, 'Pass auf – nach deinem Zug kann ich jetzt **Sxd8** spielen und gewinne Material: deinen Turm gegen meinen Springer.');
  assert.equal(lineFacts('3rk3/8/2N5/8/8/8/8/4K3 w - - 0 1', ['c6d8', 'e8d8', 'e1e2']).gain, 2);
});

test('Gedeckte Figur: kein „ungedeckt“, kein Gewinn – nur der beste Zug mit Bewertung', () => {
  // Sxe5 dxe5: Springer gegen Bauer – kein Materialgewinn
  const fen = 'rnbqkbnr/ppp2ppp/3p4/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1';
  const f = lineFacts(fen, ['f3e5', 'd6e5', 'b1c3']);
  assert.equal(f.unguarded, null);
  assert.equal(f.gain, -2);
  const t = explainThreat(fen, ['f3e5', 'd6e5', 'b1c3'], { cp: 40 });
  assert.equal(t.threat, false);
  assert.equal(t.text, 'Mein bester Zug darauf wäre **Sxe5** (Stockfish für dich: −0,4).');
  assert.equal(explainThreat(fen, ['b1c3', 'g8f6'], { cp: 180 }).text, 'Nach deinem Zug spiele ich **Sc3** und stehe danach besser (Stockfish für dich: −1,8).');
});

test('Umwandlung', () => {
  const t = explainThreat('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', ['b7b8q', 'e8d7'], { cp: 900 });
  assert.equal(t.text, 'Pass auf – nach deinem Zug kann ich jetzt **b8=D+** spielen – Schach! Dabei wird mein Bauer zur Dame.');
  assert.equal(t.threat, true);
  assert.equal(lineFacts('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', ['b7b8q', 'e8d7']).gain, 8);
});

test('Besser wäre …: Material, Gabel, „verlierst kein Material“, sonst nur die Bewertung', () => {
  const b = explainBetter('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', ['b5c7', 'e8d7', 'c7a8', 'd7c6'], { cp: 500 }, { cp: 0 }, null);
  assert.equal(b.text, 'Besser wäre **Sc7+** gewesen, weil du damit meinen Turm gewinnst und weil dein Springer damit meinen König und meinen Turm '
    + 'gleichzeitig angreift (Gabel) (Stockfish für dich: +5,0 statt 0,0).');
  assert.equal(b.uci, 'b5c7');
  // Drohung war echt, der bessere Zug verliert nichts
  const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
  assert.equal(explainBetter(fen, ['g1f3', 'b8c6'], { cp: 30 }, { cp: -280 }, { threat: true }).text,
    'Besser wäre **Sf3** gewesen – damit verlierst du kein Material (Stockfish für dich: +0,3 statt −2,8).');
  assert.equal(explainBetter(fen, ['g1f3', 'b8c6'], { cp: 30 }, { cp: -20 }, { threat: false }).text, 'Besser wäre **Sf3** gewesen (Stockfish für dich: +0,3 statt −0,2).');
});

test('Variante passt nicht zur Stellung → nichts sagen', () => {
  assert.equal(lineFacts('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['a1a8']), null);
  assert.equal(explainThreat('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['a1a8'], { cp: 0 }), null);
  // gültiger Anfang zählt
  assert.equal(lineFacts('4k3/8/8/8/8/8/8/4K3 w - - 0 1', ['e1e2', 'a1a1']).san, 'Ke2');
});

test('Lob nur ab und zu; Warnung bei ?!, ?, ??, ✗', () => {
  assert.ok(praise('brillant', 0));
  assert.ok(praise('grossartig', 0));
  assert.equal(praise('best', 2), null);
  assert.ok(praise('best', 3));
  assert.notEqual(praise('best', 3, 0), praise('best', 3, 1)); // Satz wechselt
  assert.equal(praise('gut', 9), null);
  assert.equal(praise('ausgezeichnet', 9), null);
  for (const k of ['ungenau', 'fehler', 'patzer', 'verpasst']) assert.equal(warns(k), true);
  for (const k of ['best', 'gut', 'buch', 'brillant']) assert.equal(warns(k), false);
});

test('Bewertungstext und deutsche Kurzschrift', () => {
  assert.equal(evalText({ cp: 34 }), '+0,3');
  assert.equal(evalText({ cp: -280 }), '−2,8');
  assert.equal(evalText({ cp: 2 }), '0,0');
  assert.equal(evalText({ mate: 3 }), 'du setzt in 3 matt');
  assert.equal(evalText({ mate: -2 }), 'du wirst in 2 matt');
  assert.equal(german('Nxe5+'), 'Sxe5+');
  assert.equal(german('Qd8=Q'), 'Dd8=D');
  assert.equal(german('O-O'), 'O-O');
});

// --- Prüfung 28.10.2026: Fehler, die mit echten Stockfish-Varianten auftraten ---

test('Material erst an einer ruhigen Stelle: 6. Halbzug schlägt, der 7. schlägt zurück', () => {
  // exf3 gewinnt den Läufer; im 6. Halbzug nimmt Schwarz g3, im 7. schlägt Weiß zurück → unterm Strich nur ein Bauer
  const fen = 'rn1qkb1r/pp1n1p2/2p1p3/3p2pp/P2P3P/1P3bP1/1BP1PPB1/RN1QR1K1 w - - 0 14';
  const pv = ['e2f3', 'g5h4', 'f3f4', 'f8d6', 'b1d2', 'h4g3', 'f2g3', 'd7f6'];
  assert.equal(explainThreat(fen, pv, { cp: 300 }).text,
    'Pass auf – nach deinem Zug kann ich jetzt **exf3** spielen und gewinne Material: deinen Läufer gegen meinen Bauern.');
});

test('Gabel nur, wenn die gabelnde Figur nicht einfach geschlagen wird', () => {
  // dxe5 greift Sf6 und d6 an – aber Sd7xe5 schlägt sofort zurück: kein Grund „Gabel“
  const b = explainBetter('r1bqk2r/1p1n1pbp/p1pp1np1/4p3/3PP3/1P1Q1N1P/P1P1BPP1/RNB1K2R w KQkq - 0 9',
    ['d4e5', 'd7e5', 'f3e5', 'd6e5', 'c1e3', 'd8d3', 'e2d3', 'c8e6', 'b1d2'], { cp: 20 }, { cp: -340 }, { threat: true });
  assert.doesNotMatch(b.text, /Gabel/);
  // Df5+ greift König und Dame an, aber Dxf5 Sxf5 ist nur ein Damentausch
  const fen = 'r2k3r/2p3pp/2P1Q2n/p3N2q/P4p2/1P1K3P/R2B1PP1/1B5R b - - 1 25';
  const t = explainThreat(fen, ['h5f5', 'e6f5', 'h6f5', 'd2f4', 'f5e7', 'a2d2', 'd8c8'], { cp: -1140 });
  assert.equal(t.threat, false);
  assert.doesNotMatch(t.text, /Doppelangriff/);
  assert.deepEqual(lineFacts(fen, ['h5f5', 'e6f5']).fork, []);
});

test('Umwandlung erst später in der Variante: „Danach“, nicht „Dabei“', () => {
  const t = explainThreat('8/1P2k3/8/8/8/8/5K2/8 w - - 1 2', ['f2f3', 'e7d6', 'b7b8q', 'd6e6', 'b8b4'], { cp: 1177 });
  assert.equal(t.text, 'Pass auf – nach deinem Zug kann ich jetzt **Kf3** spielen. Danach wird mein Bauer zur Dame.');
});

test('coachView gibt dem Coach die volle Stockfish-Variante (nicht nur die 6 Halbzüge der Anzeige)', async () => {
  // analysis.js ohne Browser: Stockfish (engine.js) und openings.json durch Stellvertreter ersetzen
  register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, context, next) {
  if (!context.parentURL?.endsWith('/src/schach/analysis.js')) return next(spec, context);
  if (spec === './engine.js') return { url: 'data:text/javascript,' + encodeURIComponent('export const createEngine = () => ({ analyse: (fen) => globalThis.fakeStockfish(fen), stop() {} });'), shortCircuit: true };
  if (spec === './openings.json') return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  return next(spec, context);
}`)}`);
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const reply = ['e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6', 'e1g1']; // nach 1.e4: 8 Halbzüge
  globalThis.fakeStockfish = async (fen) => (fen === start
    ? { best: 'e2e4', score: { cp: 30 }, lines: [{ score: { cp: 30 }, pv: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6', 'd7c6'] }] }
    : { best: 'e7e5', score: { cp: -30 }, lines: [{ score: { cp: -30 }, pv: reply }] });
  const { createAnalyst } = await import('../src/schach/analysis.js');
  let changed;
  const ready = new Promise((resolve) => (changed = resolve));
  const analyst = createAnalyst({ onChange: () => analyst.coachView(0) && changed() });
  analyst.update({ moves: ['e2e4'], result: null }, true);
  await ready;
  const cv = analyst.coachView(0);
  assert.deepEqual(cv.reply, reply);
  assert.equal(cv.better.length, 8);
  analyst.stop();
  delete globalThis.fakeStockfish;
});
