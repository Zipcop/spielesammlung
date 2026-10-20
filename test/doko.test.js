// Doppelkopf-Regeln (src/doko/game.js) nach den DDV-Turnierspielregeln, Stand 21.02.2026
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, eyesOf, faceOf, newGame, reserve, play, announce, canAnnounce, announceOptions, legalCards, trickWinner, isTrump,
  trumpsOf, settle, viewFor, knownParties, partyOf, accuse, again, waive, SOLOS, HAND_SIZE,
} from '../src/doko/game.js';

// Kleiner Zufallsgenerator mit Startwert, damit Tests immer gleich laufen
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// Vier Hände aus Kartenbildern ('cQ' …) – erstes Vorkommen bekommt 'a', zweites 'b'
function handsOf(...faces) {
  const seen = new Map();
  return faces.map((list) => list.map((f) => {
    const n = (seen.get(f) ?? 0) + 1;
    seen.set(f, n);
    return f + (n === 1 ? 'a' : 'b');
  }));
}

// Feste Verteilung, alle 48 Karten: Sitz 0 und 2 je eine Kreuz-Dame
const FIXED = handsOf(
  ['cQ', 'hT', 'sQ', 'dJ', 'dA', 'dK', 'cA', 'cT', 'c9', 'sA', 'hA', 'h9'],
  ['hT', 'hQ', 'cJ', 'sJ', 'dT', 'd9', 'cA', 'cK', 'sT', 'sK', 's9', 'hK'],
  ['cQ', 'sQ', 'dQ', 'hJ', 'dA', 'dT', 'cT', 'cK', 'sA', 'sT', 'hA', 'h9'],
  ['hQ', 'dQ', 'cJ', 'sJ', 'hJ', 'dJ', 'dK', 'd9', 'c9', 'sK', 's9', 'hK'],
);

const fresh = (hands = FIXED, extra = {}) => ({ ...newGame({ dealer: 3, ...extra }), hands: hands.map((h) => [...h]) });
const allGesund = (s) => {
  for (let i = 0; i < 4; i++) s = reserve(s, s.turn, 'gesund');
  return s;
};

// Spielt immer die erste erlaubte Karte (bzw. eine zufällige)
function playOut(s, rng = null) {
  while (s.phase === 'play') {
    const legal = legalCards(s.hands[s.turn], s.trick, s.kind);
    s = play(s, s.turn, rng ? legal[Math.floor(rng() * legal.length)] : legal[0]);
    assert.ok(s);
  }
  return s;
}

test('Blatt: 48 Karten, jede doppelt, 240 Augen', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 48);
  assert.equal(new Set(deck).size, 48);
  assert.equal(new Set(deck.map(faceOf)).size, 24);
  assert.equal(deck.reduce((n, c) => n + eyesOf(c), 0), 240);
  const s = newGame({ dealer: 0 }, seeded(1));
  assert.deepEqual(s.hands.map((h) => h.length), [12, 12, 12, 12]);
  assert.equal(new Set(s.hands.flat()).size, 48);
  assert.equal(s.turn, 1); // links vom Geber
});

test('Trumpf-Reihenfolge Normalspiel und Soli (TSR 2.3)', () => {
  assert.deepEqual(trumpsOf('normal'), ['hT', 'cQ', 'sQ', 'hQ', 'dQ', 'cJ', 'sJ', 'hJ', 'dJ', 'dA', 'dT', 'dK', 'd9']);
  assert.deepEqual(trumpsOf('diamonds'), trumpsOf('normal'));
  assert.equal(trumpsOf('hearts').length, 12); // 24 Trumpfkarten
  assert.deepEqual(trumpsOf('hearts').slice(-3), ['hA', 'hK', 'h9']);
  assert.deepEqual(trumpsOf('clubs').slice(-4), ['cA', 'cT', 'cK', 'c9']);
  assert.deepEqual(trumpsOf('queens'), ['cQ', 'sQ', 'hQ', 'dQ']);
  assert.deepEqual(trumpsOf('fleischlos'), []);
  assert.ok(!isTrump('dAa', 'clubs')); // Karo ist beim Kreuz-Solo Fehl
  assert.ok(isTrump('hTa', 'spades'));
  assert.ok(!isTrump('hTa', 'queens'));
});

test('Stich: höchster Trumpf, sonst höchste Karte der Farbe – gleiche Karten: die erste (auch Herz-10)', () => {
  const t = (...cs) => cs.map((c, p) => ({ p, c }));
  assert.equal(trickWinner(t('cAa', 'cTa', 'c9a', 'cKa'), 'normal'), 0);
  assert.equal(trickWinner(t('cAa', 'cAb', 'd9a', 'cKa'), 'normal'), 2); // Karo 9 ist Trumpf
  assert.equal(trickWinner(t('hTa', 'hTb', 'cQa', 'dJa'), 'normal'), 0); // erste Herz-10 sticht die zweite
  assert.equal(trickWinner(t('d9a', 'hAa', 'sAa', 'cAa'), 'normal'), 0); // abwerfen sticht nicht
  assert.equal(trickWinner(t('hAa', 'hKa', 'hTa', 'h9a'), 'normal'), 2); // Herz-10 ist Trumpf
  assert.equal(trickWinner(t('hAa', 'hKa', 'hTa', 'h9a'), 'queens'), 0); // beim Damensolo nicht: Ass > 10
  assert.equal(trickWinner(t('sKa', 'sQa', 'sJa', 'sAa'), 'fleischlos'), 3);
  assert.equal(trickWinner(t('sKa', 'sQa', 'sJa', 'cAa'), 'jacks'), 2);
});

test('Bedienen: Trumpf auf Trumpf, Fehl auf Fehl, sonst frei (TSR 5.2)', () => {
  const hand = ['cAa', 'c9a', 'hAa', 'dAa', 'cQa'];
  assert.deepEqual(legalCards(hand, [{ p: 0, c: 'cKa' }], 'normal'), ['cAa', 'c9a']);
  assert.deepEqual(legalCards(hand, [{ p: 0, c: 'd9a' }], 'normal'), ['dAa', 'cQa']);
  assert.deepEqual(legalCards(hand, [{ p: 0, c: 'hTa' }], 'normal'), ['dAa', 'cQa']); // Herz-10 fordert Trumpf, kein Herz
  assert.deepEqual(legalCards(hand, [{ p: 0, c: 'sAa' }], 'normal'), hand);
  assert.deepEqual(legalCards(hand, [{ p: 0, c: 'dKa' }], 'clubs'), ['dAa']); // Karo ist Fehl beim Kreuz-Solo
  assert.deepEqual(legalCards(hand, [], 'normal'), hand);
});

test('Vorbehaltsabfrage: alle gesund = Normalspiel, Re sind die Kreuz-Damen', () => {
  const s = allGesund(fresh());
  assert.equal(s.phase, 'play');
  assert.equal(s.contract.type, 'normal');
  assert.deepEqual(s.re.sort(), [0, 2]);
  assert.equal(s.turn, 0); // Geber 3 → links davon Sitz 0 spielt auf
  assert.equal(partyOf(s, 0), 0);
  assert.equal(partyOf(s, 1), 1);
});

test('Hochzeit nur mit beiden Kreuz-Damen; Solo geht vor, der weiter vorn Sitzende zuerst', () => {
  assert.equal(reserve(fresh(), 0, 'wedding'), null); // Sitz 0 hat nur eine
  const two = handsOf(
    ['cQ', 'cQ', 'sQ', 'dJ', 'dA', 'dK', 'cA', 'cT', 'c9', 'sA', 'hA', 'h9'],
    ['hT', 'hQ', 'cJ', 'sJ', 'dT', 'd9', 'cA', 'cK', 'sT', 'sK', 's9', 'hK'],
    ['hT', 'sQ', 'dQ', 'hJ', 'dA', 'dT', 'cT', 'cK', 'sA', 'sT', 'hA', 'h9'],
    ['hQ', 'dQ', 'cJ', 'sJ', 'hJ', 'dJ', 'dK', 'd9', 'c9', 'sK', 's9', 'hK'],
  );
  let s = fresh(two);
  s = reserve(s, 0, 'wedding');
  s = reserve(s, 1, 'gesund');
  s = reserve(s, 2, 'jacks');
  s = reserve(s, 3, 'queens');
  assert.deepEqual(s.contract, { type: 'solo', kind: 'jacks', player: 2 });
  assert.equal(s.turn, 0); // auch beim Lustsolo spielt der linke Nachbar des Gebers auf
  // stille Hochzeit: alle gesund, einer hat beide Kreuz-Damen
  s = allGesund(fresh(two));
  assert.equal(s.contract.type, 'silent');
  assert.deepEqual(s.re, [0]);
  assert.equal(viewFor(s, 1).contract.type, 'normal'); // die anderen merken nichts
  assert.equal(viewFor(s, 0).contract.type, 'silent');
  assert.deepEqual(viewFor(s, 1).calls, ['gesund', 'gesund', 'gesund', 'gesund']);
});

test('Hochzeit: Partner ist, wer den ersten fremden Stich macht – sonst Karo-Solo nach drei Stichen', () => {
  const two = handsOf(
    ['cQ', 'cQ', 'hT', 'hT', 'sQ', 'sQ', 'hQ', 'hQ', 'dQ', 'dQ', 'cA', 'cA'],
    ['cJ', 'sJ', 'dT', 'd9', 'cK', 'cK', 'sT', 'sK', 's9', 'hK', 'h9', 'h9'],
    ['cJ', 'sJ', 'hJ', 'dA', 'dT', 'cT', 's9', 'sA', 'sA', 'sT', 'hA', 'hA'],
    ['hJ', 'dJ', 'dJ', 'dA', 'dK', 'dK', 'd9', 'c9', 'c9', 'sK', 'cT', 'hK'],
  );
  let s = fresh(two);
  s = reserve(s, 0, 'wedding');
  for (const p of [1, 2, 3]) s = reserve(s, p, 'gesund');
  assert.equal(s.contract.type, 'wedding');
  assert.equal(canAnnounce(s, 0, 1), false); // vor dem Klärungsstich keine Ansage
  const card = (p, f) => s.hands[p].find((c) => faceOf(c) === f);
  // Stich 1: Hochzeiter gewinnt
  for (const [p, f] of [[0, 'hT'], [1, 'cJ'], [2, 'cJ'], [3, 'hJ']]) s = play(s, p, card(p, f));
  assert.equal(s.contract.partner, null);
  // Stich 2 und 3: wieder der Hochzeiter
  for (const [p, f] of [[0, 'cA'], [1, 'cK'], [2, 'cT'], [3, 'c9']]) s = play(s, p, card(p, f));
  assert.equal(s.tricks.at(-1).winner, 0);
  for (const [p, f] of [[0, 'cA'], [1, 'cK'], [2, 's9'], [3, 'c9']]) s = play(s, p, card(p, f)); // Sitz 2 hat kein Kreuz mehr
  assert.equal(s.contract.type, 'solo'); // drei Stiche selbst → Karo-Solo
  assert.equal(s.contract.wedding, true);
  assert.equal(s.contract.clarified, 3);
  // Ansage jetzt mit 9 Karten noch erlaubt (11 − 2 nach Klärungsstich 3)
  assert.equal(canAnnounce(s, 0, 1), true);
  assert.equal(canAnnounce(s, 1, 1), true);

  // Variante: Sitz 2 macht den zweiten Stich
  s = fresh(two);
  s = reserve(s, 0, 'wedding');
  for (const p of [1, 2, 3]) s = reserve(s, p, 'gesund');
  for (const [p, f] of [[0, 'cA'], [1, 'cK'], [2, 'cT'], [3, 'c9']]) s = play(s, p, card(p, f));
  for (const [p, f] of [[0, 'hQ'], [1, 'sJ'], [2, 'sJ'], [3, 'dJ']]) s = play(s, p, card(p, f));
  assert.equal(s.contract.partner, null);
  for (const [p, f] of [[0, 'cA'], [1, 'cK'], [2, 'dA'], [3, 'c9']]) s = play(s, p, card(p, f));
  assert.equal(s.contract.partner, 2); // gestochen mit Karo-Ass
  assert.equal(s.contract.clarified, 3);
  assert.deepEqual(s.re, [0, 2]);
  assert.deepEqual(knownParties(viewFor(s, 1)), [0, 1, 0, 1]);
});

test('Ansagen: Re mit 11 Karten, keine 90 mit 10, Erwiderung eine Karte später, verspätete Partei ohne Absage (TSR 6)', () => {
  let s = allGesund(fresh());
  assert.deepEqual(announceOptions(s, 0), [1, 2, 3, 4, 5]); // 12 Karten: alles erlaubt (übersprungen)
  // erster Stich gespielt → 11 Karten
  for (let i = 0; i < 4; i++) s = play(s, s.turn, legalCards(s.hands[s.turn], s.trick, s.kind)[0]);
  assert.ok(canAnnounce(s, 0, 1));
  s = announce(s, 0, 1);
  assert.deepEqual(s.ann, [1, 0]);
  assert.equal(announce(s, 2, 1), null); // Partner kann nicht nochmal „Re“
  // zweiter Stich → 10 Karten: Kontra wäre als Erstansage zu spät, als Erwiderung auf „Re“ (11) noch erlaubt
  for (let i = 0; i < 4; i++) s = play(s, s.turn, legalCards(s.hands[s.turn], s.trick, s.kind)[0]);
  assert.ok(canAnnounce(s, 0, 2)); // keine 90 mit 10 Karten
  assert.ok(canAnnounce(s, 1, 1));
  assert.ok(!canAnnounce(s, 1, 2)); // Erwiderung nur „Kontra“
  s = announce(s, 1, 1);
  assert.deepEqual(s.late, [false, true]);
  assert.ok(!canAnnounce(s, 3, 2)); // nach verspäteter Erwiderung keine Absage
  s = announce(s, 2, 2); // Re: keine 90
  assert.deepEqual(s.ann, [2, 1]);
  // dritter Stich → 9 Karten: keine 60 erlaubt, keine 30 (8) übersprungen ginge nicht ohne keine 60 (9)
  for (let i = 0; i < 4; i++) s = play(s, s.turn, legalCards(s.hands[s.turn], s.trick, s.kind)[0]);
  assert.deepEqual(announceOptions(s, 0), [3, 4, 5]);
  for (let i = 0; i < 4; i++) s = play(s, s.turn, legalCards(s.hands[s.turn], s.trick, s.kind)[0]);
  assert.deepEqual(announceOptions(s, 0), []); // 8 Karten, keine 60 (9) verpasst
  assert.deepEqual(knownParties(viewFor(s, 3)).slice(0, 3), [0, 1, 0]);
});

// Stand mit fertigen Stichen bauen: eyes je Partei über die Augen der Stiche
function finished({ type = 'normal', re = [0, 2], ann = [0, 0], tricks, player }) {
  const contract = type === 'normal' ? { type, kind: 'normal' } : { type, kind: 'normal', player };
  return { contract, re, ann, tricks };
}
// zwölf Stiche aus Kartenbildern: [Gewinner, ...Kartenbilder ab Sitz 0]
const T = (winner, ...faces) => ({ winner, cards: faces.map((f, p) => ({ p, c: `${f}a` })), eyes: faces.reduce((n, f) => n + eyesOf(`${f}a`), 0) });

test('Abrechnung: Normalspiel mit Doppelkopf und gefangenem Fuchs (TSR 7.2.3)', () => {
  const tricks = [
    T(0, 'cA', 'cT', 'cA', 'cK'), // 35 Re
    T(0, 'sA', 'sT', 'sA', 'sT'), // 42 Re → Doppelkopf
    T(1, 'hA', 'hA', 'hK', 'hK'), // 30 Kontra
    T(1, 'dA', 'd9', 'dK', 'dQ'), // 18 Kontra, Fuchs von Sitz 0 gefangen
    T(2, 'cK', 'c9', 'cT', 'dJ'), // 16 Re
    T(3, 'sK', 's9', 'sK', 'dJ'), // 10 Kontra
    T(2, 'h9', 'h9', 'hJ', 'd9'), // 2 Re
    T(1, 'dT', 'hT', 'dK', 's9'), // 24 Kontra
    T(3, 'dQ', 'cJ', 'sJ', 'hQ'), // 10 Kontra
    T(0, 'sQ', 'sJ', 'dT', 'c9'), // 15 Re
    T(1, 'hJ', 'hT', 'c9', 'cJ'), // 14 Kontra
    T(2, 'dA', 'hQ', 'cQ', 'sQ'), // 20 Re
  ];
  const r = settle(finished({ tricks }));
  assert.deepEqual(r.eyes, [131, 106]); // Testkarten frei gewählt, daher nicht 240
  assert.equal(r.winner, 0);
  const texts = r.lines.map((l) => `${l.party}:${l.text}`);
  assert.ok(texts.includes('0:gewonnen'));
  assert.ok(texts.includes('0:Doppelkopf (42 Augen)'));
  assert.ok(texts.includes('1:Fuchs gefangen'));
  assert.equal(r.value, 1 + 1 - 1);
  assert.deepEqual(r.points, [1, -1, 1, -1]);
});

test('Abrechnung: Absagen, Gewinnstufen und erreichte Augen gegen Absagen', () => {
  // ohne echte Karten: Augen direkt über Stiche mit passender Summe
  const t = (winner, eyes) => ({ winner, cards: [{ p: 0, c: 'c9a' }, { p: 1, c: 'c9b' }, { p: 2, c: 's9a' }, { p: 3, c: 's9b' }], eyes });
  const game = (reEyes, ann, extra = {}) => settle(finished({ ann, tricks: [t(0, reEyes), t(1, 240 - reEyes), ...Array(10).fill(t(0, 0))], ...extra }));
  // nur Kontra angesagt: Re gewinnt schon mit 120 (TSR 7.1.1 Nr. 4)
  assert.equal(game(120, [0, 1]).winner, 0);
  assert.equal(game(120, [0, 0]).winner, 1);
  assert.equal(game(120, [1, 1]).winner, 1);
  // Re sagt keine 90: braucht 151
  let r = game(151, [2, 0]);
  assert.equal(r.winner, 0);
  assert.equal(r.value, 1 + 1 + 2 + 1); // gewonnen, unter 90, Re, keine 90
  r = game(150, [2, 0]);
  assert.equal(r.winner, 1); // Kontra hat 90 gegen keine 90
  assert.equal(r.value, -(1 + 2 + 1 + 1)); // gewonnen, Re angesagt, keine 90 abgesagt, gegen die Kreuz-Damen
  // Kontra sagt keine 90, Re holt 120: Re gewinnt (mind. 90) + 120 gegen keine 90
  r = game(120, [0, 2]);
  assert.equal(r.winner, 0);
  assert.equal(r.value, 1 + 2 + 1 + 1);
  // beide sagen keine 90, Re 140: keiner gewinnt (TSR 7.1.3), nur Re bekommt „120 gegen keine 90“
  r = game(140, [2, 2]);
  assert.equal(r.winner, null);
  assert.equal(r.value, 1);
  // schwarz abgesagt und alle Stiche
  const black = settle(finished({ ann: [5, 0], tricks: Array(12).fill(t(0, 20)) }));
  assert.equal(black.winner, 0);
  assert.equal(black.value, 1 + 4 + 2 + 4);
});

test('Solo zählt dreifach, ohne Sonderpunkte', () => {
  const t = (winner, eyes) => ({ winner, cards: [{ p: 0, c: 'dAa' }, { p: 1, c: 'c9b' }, { p: 2, c: 's9a' }, { p: 3, c: 's9b' }], eyes });
  const r = settle(finished({ type: 'solo', re: [1], player: 1, tricks: [t(1, 130), t(0, 110), ...Array(10).fill(t(1, 0))] }));
  assert.equal(r.winner, 0);
  assert.equal(r.value, 1);
  assert.deepEqual(r.points, [-1, 3, -1, -1]); // Fuchs zählt nicht
});

test('Zufallspartien: Augen 240, Punkte gehen auf, bekannte Parteien stimmen immer', () => {
  const rng = seeded(7);
  for (let g = 0; g < 400; g++) {
    let s = newGame({ dealer: g % 4 }, rng);
    while (s.phase === 'reserve') {
      const opts = ['gesund', 'gesund', 'gesund', 'gesund', 'gesund', 'gesund', ...SOLOS];
      if (s.hands[s.turn].filter((c) => faceOf(c) === 'cQ').length === 2) opts.push('wedding', 'wedding', 'wedding');
      s = reserve(s, s.turn, opts[Math.floor(rng() * opts.length)]);
    }
    while (s.phase === 'play') {
      for (const p of [0, 1, 2, 3]) {
        const opts = announceOptions(s, p);
        if (opts.length && rng() < 0.05) s = announce(s, p, opts[0]);
      }
      const legal = legalCards(s.hands[s.turn], s.trick, s.kind);
      s = play(s, s.turn, legal[Math.floor(rng() * legal.length)]);
      // Wissen der Spieler stimmt mit der Wahrheit überein
      for (const v of [0, 1, 2, 3]) {
        const known = knownParties(viewFor(s, v), v);
        known.forEach((k, p) => k === null || assert.equal(k, s.re.includes(p) ? 0 : 1, `Spiel ${g}, Sicht ${v}, Sitz ${p}`));
      }
    }
    assert.equal(s.tricks.length, HAND_SIZE);
    assert.equal(s.result.eyes[0] + s.result.eyes[1], 240);
    assert.equal(s.result.points.reduce((a, b) => a + b, 0), 0);
    const parity = new Set(s.result.points.map((x) => Math.abs(x) % 2));
    assert.equal(parity.size, 1); // Gerade-Ungerade-Regel (TSR 7.3.3)
  }
});

test('Sicht: fremde Karten nur als Anzahl, Re-Partei erst am Ende', () => {
  const s = allGesund(fresh());
  const v = viewFor(s, 2);
  assert.ok(Array.isArray(v.hands[2]));
  assert.deepEqual(v.hands.filter((h, p) => p !== 2), [12, 12, 12]);
  assert.equal(v.re, null);
  const end = playOut(s);
  assert.deepEqual(viewFor(end, 1).re, end.re);
});

test('Ohne Hilfen: Nichtbedienen geht durch – erwischt −12/+4, Fehlalarm −3/+1, auch nach dem Spielende', () => {
  let s = allGesund(fresh(FIXED, { free: true }));
  // Sitz 0 spielt Kreuz-Ass, Sitz 1 hat Kreuz, wirft aber Pik ab
  s = play(s, 0, 'cAa');
  assert.equal(play({ ...s, free: false }, 1, 'sTa'), null);
  s = play(s, 1, 'sTa');
  assert.equal(s.revokes.length, 1);
  assert.equal(viewFor(s, 2).revokes.length, 0);
  // Fehlalarm gegen Sitz 3
  const alarm = accuse(s, 2, 3);
  assert.deepEqual(alarm.score, [1, 1, -3, 1]);
  // erwischt
  const caught = accuse(s, 0, 1);
  assert.equal(caught.phase, 'over');
  assert.deepEqual(caught.score, [4, -12, 4, 4]);
  assert.equal(accuse(caught, 2, 1), null);
  // erst nach dem Spiel erwischt: das Ergebnis wird ersetzt
  const end = playOut(s);
  assert.equal(end.phase, 'over');
  assert.equal(again(end, 1), null); // der Schummler kann das nächste Spiel nicht selbst starten
  assert.ok(again(end, 0));
  const late = accuse(end, 3, 1);
  assert.deepEqual(late.score, [4, -12, 4, 4]);
  assert.equal(late.list.length, 1);
  assert.ok(again(waive(end), 1)); // Computer hat geprüft und lässt es gelten
});

test('Ohne Hilfen beim Solo: schummelt ein Gegenspieler, bekommt nur der Solist die Punkte', () => {
  let s = fresh(FIXED, { free: true });
  s = reserve(s, 0, 'gesund');
  s = reserve(s, 1, 'gesund');
  s = reserve(s, 2, 'queens');
  s = reserve(s, 3, 'gesund');
  s = play(s, 0, 'cAa');
  s = play(s, 1, 'sTa'); // hat Kreuz
  assert.deepEqual(accuse(s, 2, 1).score, [0, -12, 12, 0]);
});

test('Ohne Hilfen: Fehlalarm nach Spielende, danach erwischt – Liste und Stand passen zusammen', () => {
  let s = allGesund(fresh(FIXED, { free: true }));
  s = play(s, 0, 'cAa');
  s = play(s, 1, 'sTa'); // hat Kreuz
  const alarm = accuse(playOut(s), 0, 3);
  const caught = accuse(alarm, 0, 1);
  assert.deepEqual(caught.list.map((r) => r.title), ['Fehlalarm', 'Nicht bedient – erwischt']);
  const total = [0, 1, 2, 3].map((p) => caught.list.reduce((n, r) => n + r.points[p], 0));
  assert.deepEqual(total, caught.score);
});

test('Ohne Hilfen: Abwerfen auf Trumpf verrät keine Partei', () => {
  let s = allGesund(fresh(FIXED, { free: true }));
  s = play(s, 0, 'dJa');
  s = play(s, 1, 'dTa');
  s = play(s, 2, 'sAb'); // Re, hat noch Trumpf
  assert.equal(knownParties(s, 1)[2], null);
  assert.equal(knownParties(s, 3)[2], null);
});

test('Ohne Hilfen zu zweit: gesperrt ist nur, wen der andere Mensch noch erwischen kann', () => {
  const start = () => {
    let s = allGesund(fresh(FIXED, { free: true, humans: [0, 2], dealer: 2 }));
    s = play(s, 3, 'c9b');
    return play(s, 0, 'sAa'); // hat Kreuz
  };
  let one = play(start(), 1, 'cAb');
  one = playOut(play(one, 2, 'cTb'));
  assert.equal(again(one, 0), null);
  assert.ok(again(one, 2));
  let both = play(start(), 1, 'cAb');
  both = playOut(play(both, 2, 'sAb')); // hat auch Kreuz
  assert.ok(again(both, 0));
  assert.ok(again(both, 2));
});
