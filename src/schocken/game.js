// Schocken für 2–4 als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen Zustand
// oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei Doppelkopf: 0 = Host (+z), 1 = links (−x), 2 = gegenüber
// (−z, der Gast), 3 = rechts (+x). Zu zweit sitzen 0 und 2, zu dritt 0, 1, 2. Freie Sitze spielt der Computer.
// Jeder sieht nur viewFor(state, sitz): Was unter einem fremden Becher liegt, erst beim Aufdecken.
//
// Regeln (de.wikipedia.org/wiki/Schocken, abgerufen 21.10.2026): Jeder hat Becher und drei Würfel. Reihum würfelt jeder
// bis zu dreimal; wie oft, legt der Erste der Runde fest – mehr darf danach keiner. Einsen dürfen herausgelegt werden,
// der Rest wird neu geworfen; fallen in einem Wurf (nicht dem letzten) zwei Sechsen, darf man eine davon zur Eins drehen
// (drei Sechsen → zwei Einsen), die andere kommt zurück in den Becher. Am Ende der Runde wird aufgedeckt. Rangfolge:
// einfacher Wurf („Hausnummer“, 2-2-1 bis 6-6-5) < Straße < General (drei gleiche) < Schock 2 … Schock 6 (1-1-2 … 1-1-6)
// < Schock aus (1-1-1). Gleiches: der spätere Wurf ist niedriger, außer er brauchte weniger Würfe. Der Niedrigste bekommt
// so viele Deckel, wie der Höchste wert ist (Hausnummer 1, Straße 2, General 3, Schock x = x), erst aus der Mitte,
// ist sie leer, vom Höchsten; Schock aus: alle – die Hälfte ist sofort verloren. Ist die Mitte leer, spielen nur noch,
// die Deckel haben. Wer alle 13 hat, verliert die Hälfte; zwei Hälften, haben verschiedene je eine verloren, spielen
// die beiden ein Finale. Die nächste Runde beginnt, wer die letzte verloren hat.
//
// Eigene Festlegungen (Varianten schwanken je Quelle): 13 Deckel je Hälfte; jede Straße kostet 2 Deckel, höhere Straßen
// schlagen niedrigere; Sechsen umdrehen ist erlaubt; herausgelegte Einsen liegen offen und dürfen wieder in den Becher;
// das Finale beginnt der Verlierer der 2. Hälfte, die erste Runde ein zufälliger Spieler; die nächste Partie beginnt
// der Verlierer. Verloren hat die Partie, wer zwei Hälften (oder das Finale) verliert.
//
// „Ohne Hilfen“ (free): Nichts wird geprüft – man darf öfter würfeln, als die Runde erlaubt, auch andere Würfel als
// Einsen herauslegen, Sechsen falsch umdrehen (eine einzelne, im letzten Wurf, ohne weiterzuwerfen) und Würfel unter
// dem eigenen Becher heimlich drehen. Vermerkt wird es nur beim Host. „Geschummelt!“ mit Wahl des Spielers geht in der
// laufenden Runde und nach dem Aufdecken, bis die nächste Runde beginnt: Erwischt = der Schummler verliert die Runde,
// Fehlalarm = der Rufer verliert sie (er bekommt die Deckel für den höchsten Wurf der anderen).

export const STONES = 13;
export const MAX_ROLLS = 3;
export const SEAT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export const CHEAT_NAMES = {
  more: 'öfter gewürfelt als erlaubt',
  keep: 'eine andere Zahl als die Eins herausgelegt',
  flip: 'Sechsen falsch umgedreht',
  twist: 'einen Würfel heimlich gedreht',
};

const isDie = (d) => Number.isInteger(d) && d >= 1 && d <= 6;
const none3 = () => [false, false, false];
const at = (list, p, value) => list.map((x, k) => (k === p ? value : x));

// --- Wert eines Wurfs ---
// rank: je höher, desto besser · stones: so viele Deckel kostet er den Niedrigsten · name: zum Anzeigen
export function judge(dice) {
  const [a, b, c] = [...dice].sort((x, y) => y - x);
  if (a === 1) return { kind: 'schockaus', rank: 500, stones: STONES, name: 'Schock aus' };
  if (b === 1 && c === 1) return { kind: 'schock', rank: 400 + a, stones: a, name: `Schock ${a}` };
  if (a === b && b === c) return { kind: 'general', rank: 300 + a, stones: 3, name: `General (${a}-${a}-${a})` };
  if (a - b === 1 && b - c === 1) return { kind: 'strasse', rank: 200 + a, stones: 2, name: `Straße ${c}-${b}-${a}` };
  return { kind: 'zahl', rank: 100 + (a * 100 + b * 10 + c) / 1000, stones: 1, name: `${a}${b}${c}` };
}

// Ist Wurf von p besser als der von q? (gleicher Wert: weniger Würfe, dann wer früher dran war)
export function beats(s, p, q) {
  const [x, y] = [judge(s.dice[p]).rank, judge(s.dice[q]).rank];
  if (x !== y) return x > y;
  if (s.done[p] !== s.done[q]) return s.done[p] < s.done[q];
  return s.order.indexOf(p) < s.order.indexOf(q);
}

// Rangliste der Runde, Bester zuerst
export const ranking = (s, seats = s.order) => [...seats].sort((p, q) => (beats(s, p, q) ? -1 : beats(s, q, p) ? 1 : 0));
export const maxRolls = (s) => s.limit ?? MAX_ROLLS;

// --- Neues Spiel: erst wählt der Host, wie viele am Tisch sitzen (setup) ---
export function newGame({ humans = [0], free = false, seq = 0, games = 1, count = null, starter = null } = {}, rng = Math.random) {
  const s = {
    seq,
    events: [{ type: 'setup' }],
    games,
    phase: 'setup', // setup → play → over
    humans: [...humans],
    free,
    count: null,
    seats: [],
    half: 1, // 1, 2 – oder 3 = Finale
    halves: [], // Verlierer je Hälfte
    pot: STONES, // Deckel in der Mitte
    stones: [0, 0, 0, 0],
    active: [], // wer in dieser Hälfte noch mitspielt
    round: 0,
    order: [], // Reihenfolge dieser Runde (der Erste legt die Wurfzahl fest)
    turn: null,
    limit: null, // Würfe des Ersten – mehr darf in dieser Runde keiner
    rolls: 0, // Würfe des Spielers am Zug
    dice: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]],
    out: [none3(), none3(), none3(), none3()], // herausgelegt (liegt offen neben dem Becher)
    fresh: none3(), // im letzten Wurf gefallen (nur die darf man umdrehen)
    flipped: false, // in diesem Wurf schon umgedreht
    mustRoll: false, // nach dem Umdrehen muss die Sechs zurück in den Becher – also weiterwerfen
    done: [null, null, null, null], // so oft hat jeder in dieser Runde gewürfelt (fertig)
    shown: null, // aufgedeckte Runde { dice, results, high, low, stones, from } – bleibt, bis neu gewürfelt wird
    forced: null, // ohne Hilfen: Verlierer dieser Runde nach einer Anklage
    cheats: [], // ohne Hilfen: { player, kind, seq } – nur beim Host
    undo: null, // ohne Hilfen: Stand vor dem Aufdecken – solange die Runde noch angefochten werden kann (nur Host)
    loser: null, // wer die Partie verloren hat
    waived: false,
  };
  return count ? setup(s, 0, count, rng, starter) : s;
}

// Spielerzahl wählen (nur der Host, Sitz 0) – gleich danach geht es los
export function setup(s, seat, count, rng = Math.random, starter = null) {
  if (s.phase !== 'setup' || seat !== 0 || !SEAT_SETS[count]) return null;
  const seats = SEAT_SETS[count];
  const first = seats.includes(starter) ? starter : seats[Math.floor(rng() * seats.length)];
  const next = { ...s, phase: 'play', count, seats, active: [...seats], seq: s.seq + 1, events: [{ type: 'start', player: first }] };
  return startRound(next, first);
}

// Neue Runde: der Starter und dann reihum alle, die in dieser Hälfte noch dabei sind
function startRound(s, starter) {
  const from = s.seats.indexOf(starter);
  const order = [...s.seats.slice(from), ...s.seats.slice(0, from)].filter((p) => s.active.includes(p));
  return {
    ...s, round: s.round + 1, order, turn: order[0], limit: null, rolls: 0, out: [none3(), none3(), none3(), none3()], fresh: none3(),
    flipped: false, mustRoll: false, done: [null, null, null, null], forced: null,
  };
}

const onTurn = (s, seat) => s.phase === 'play' && s.turn === seat;
const bump = (s, events, extra) => ({ ...s, ...extra, seq: s.seq + 1, events });
const cheat = (s, seat, kinds) => (kinds.length ? [...s.cheats, ...kinds.map((kind) => ({ player: seat, kind, seq: s.seq + 1 }))] : s.cheats);
const badKeep = (s, seat) => s.out[seat].some((o, k) => o && s.dice[seat][k] !== 1);

// --- Würfeln (Augenzahlen aus der Physik dessen, der würfelt; herausgelegte behalten ihre Zahl) ---
export function roll(s, seat, values) {
  if (!onTurn(s, seat) || !Array.isArray(values) || values.length !== 3 || !values.every(isDie)) return null;
  const thrown = s.out[seat].map((o) => !o);
  if (!thrown.some(Boolean)) return null; // nichts im Becher
  const faults = [];
  if (s.rolls >= maxRolls(s)) faults.push('more');
  if (s.rolls > 0 && badKeep(s, seat)) faults.push('keep');
  if (faults.length && !s.free) return null;
  // erster Wurf einer neuen Runde: das Aufgedeckte wird weggeräumt, alte Schummeleien sind verjährt
  const first = s.rolls === 0 && s.turn === s.order[0];
  const base = first ? { ...s, shown: null, cheats: [], undo: null } : s;
  const dice = at(s.dice, seat, s.dice[seat].map((d, k) => (thrown[k] ? values[k] : d)));
  let next = bump(base, [{ type: 'roll', player: seat, n: s.rolls + 1 }], {
    dice, fresh: thrown, rolls: s.rolls + 1, flipped: false, mustRoll: false, cheats: cheat(base, seat, faults),
  });
  if (!s.free && next.rolls >= maxRolls(next)) next = finish(next, seat, next.events); // letzter erlaubter Wurf: fertig
  return next;
}

// --- Würfel herauslegen bzw. zurück in den Becher (nur Einsen dürfen raus) ---
export function toggle(s, seat, k) {
  if (!onTurn(s, seat) || s.rolls === 0 || !(k >= 0 && k < 3)) return null;
  const out = !s.out[seat][k];
  if (out && s.dice[seat][k] !== 1 && !s.free) return null;
  return bump(s, [], { out: at(s.out, seat, s.out[seat].map((o, i) => (i === k ? out : o))) });
}

// --- Zwei Sechsen aus einem Wurf: eine wird zur Eins (drei → zwei), die andere muss nochmal in den Becher ---
export function flip(s, seat) {
  if (!onTurn(s, seat) || s.rolls === 0 || s.flipped) return null;
  const sixes = [0, 1, 2].filter((k) => s.fresh[k] && !s.out[seat][k] && s.dice[seat][k] === 6);
  if (!sixes.length) return null;
  const legal = sixes.length >= 2 && s.rolls < maxRolls(s);
  if (!legal && !s.free) return null;
  const turned = sixes.slice(0, sixes.length >= 3 ? 2 : 1);
  const dice = at(s.dice, seat, s.dice[seat].map((d, k) => (turned.includes(k) ? 1 : d)));
  const out = at(s.out, seat, s.out[seat].map((o, k) => o || turned.includes(k)));
  return bump(s, [{ type: 'flip', player: seat, n: turned.length }], {
    dice, out, flipped: true, mustRoll: sixes.length > turned.length, cheats: cheat(s, seat, legal ? [] : ['flip']),
  });
}

// --- Fertig: so bleibt der Wurf liegen (der Erste legt damit die Wurfzahl der Runde fest) ---
export function stand(s, seat) {
  if (!onTurn(s, seat) || s.rolls === 0) return null;
  const faults = [];
  if (s.mustRoll) faults.push('flip');
  if (badKeep(s, seat)) faults.push('keep');
  if (faults.length && !s.free) return null;
  return finish({ ...s, cheats: cheat(s, seat, faults) }, seat, []);
}

// --- Ohne Hilfen: einen eigenen Würfel heimlich auf die nächste Zahl drehen ---
export function twist(s, seat, k) {
  if (!s.free || !onTurn(s, seat) || s.rolls === 0 || !(k >= 0 && k < 3)) return null;
  const dice = at(s.dice, seat, s.dice[seat].map((d, i) => (i === k ? (d % 6) + 1 : d)));
  return bump(s, [{ type: 'twist', player: seat }], { dice, cheats: cheat(s, seat, ['twist']) });
}

// Spieler fertig: der Nächste ist dran – oder alle sind durch, dann wird aufgedeckt (before = Ereignisse dieser Aktion)
function finish(s, seat, before) {
  const done = at(s.done, seat, s.rolls);
  const limit = s.limit ?? (seat === s.order[0] ? Math.min(s.rolls, MAX_ROLLS) : null); // geschummelte Würfe erlauben keinem mehr
  const events = [...before, { type: 'stand', player: seat, n: s.rolls }];
  const next = { ...s, done, limit, rolls: 0, fresh: none3(), flipped: false, mustRoll: false, seq: s.seq + 1, events };
  const after = s.order[s.order.indexOf(seat) + 1];
  if (after !== undefined) return { ...next, turn: after };
  return resolve(next);
}

// --- Aufdecken: der Niedrigste bekommt die Deckel für den höchsten Wurf ---
function resolve(s) {
  const pre = { ...s, undo: null };
  const list = ranking(s);
  const low = s.forced ?? list.at(-1);
  const high = list.find((p) => p !== low);
  const best = judge(s.dice[high]);
  const results = s.order.map((p) => ({ player: p, ...judge(s.dice[p]), n: s.done[p] }));
  let { pot, stones } = s;
  let given = 0;
  let from = 'pot';
  if (best.kind === 'schockaus') {
    given = STONES - stones[low];
    stones = [0, 1, 2, 3].map((p) => (p === low ? STONES : 0));
    pot = 0;
    from = 'all';
  } else if (pot > 0) {
    given = Math.min(best.stones, pot);
    pot -= given;
    stones = at(stones, low, stones[low] + given);
  } else {
    given = Math.min(best.stones, stones[high]);
    from = high;
    stones = stones.map((x, p) => (p === high ? x - given : p === low ? x + given : x));
  }
  const shown = { dice: s.dice.map((d) => [...d]), results, high, low, stones: given, from, forced: s.forced !== null };
  const events = [...s.events, { type: 'reveal', high, low, stones: given, from, value: best.name, forced: s.forced !== null }];
  const active = pot === 0 ? s.active.filter((p) => stones[p] > 0) : s.active;
  const next = { ...s, pot, stones, active, shown, undo: s.free ? pre : null, turn: null, events };
  if (stones[low] === STONES) return endHalf(next, low);
  return startRound(next, low);
}

// Hälfte verloren: zweite Hälfte, Finale oder Spielende
function endHalf(s, loser) {
  const halves = [...s.halves, loser];
  const events = [...s.events, { type: 'half', player: loser, half: s.half }];
  const fresh = { ...s, halves, pot: STONES, stones: [0, 0, 0, 0], events };
  if (s.half === 1) return startRound({ ...fresh, half: 2, active: [...s.seats] }, loser);
  if (s.half === 2 && halves[0] !== halves[1]) {
    return startRound({ ...fresh, half: 3, active: s.seats.filter((p) => halves.includes(p)) }, loser);
  }
  return { ...s, halves, phase: 'over', turn: null, loser, events: [...events, { type: 'over', loser, double: s.half === 2 }] };
}

// --- Ohne Hilfen: „Geschummelt!“ gegen einen Mitspieler ---
// In der laufenden Runde und nach dem Aufdecken (bis die nächste Runde beginnt): Erwischt = der Schummler verliert die
// Runde, Fehlalarm = der Rufer. Ist schon aufgedeckt, wird die Runde mit dem neuen Verlierer noch einmal ausgewertet.
export function accuse(s, by, target) {
  if (!s.free || by === target || s.phase === 'setup') return null;
  const base = s.undo ?? s;
  if (!base.order.includes(by) || !base.order.includes(target)) return null;
  if (!s.undo && s.phase !== 'play') return null;
  const kinds = [...new Set(s.cheats.filter((c) => c.player === target).map((c) => c.kind))];
  const caught = kinds.length > 0;
  // reopened: nach Spielende kann auch ein Fehlalarm die letzte Runde neu entscheiden – die Statistik nimmt das Ende dann zurück
  const event = caught ? { type: 'caught', player: target, by, kinds } : { type: 'fehlalarm', player: by, target, reopened: s.phase === 'over' };
  const loser = caught ? target : by;
  // nur die Schummeleien des Erwischten sind abgegolten – die anderer bleiben anfechtbar
  const cheats = s.cheats.filter((c) => c.player !== target);
  if (s.undo) return resolve({ ...base, forced: loser, cheats, seq: s.seq + 1, events: [event] });
  return bump(s, [event], { forced: loser, cheats });
}

// Allein nach Spielende: Der Computer hat die letzte Runde geprüft und lässt sie gelten
export const waive = (s) => (s.free && s.phase === 'over' && !s.waived ? { ...s, waived: true } : null);

// Nächste Partie (gleiche Spielerzahl, der Verlierer beginnt). Wer in der letzten Runde geschummelt hat, startet sie nicht
// selbst, solange man ihn noch erwischen kann: allein, bis der Computer geprüft hat, zu zweit startet der andere.
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over') return null;
  // zu zweit: haben beide geschummelt, darf jeder (sonst ginge es nicht weiter)
  const watched = s.humans.length === 1 ? !s.waived : s.humans.some((p) => p !== seat && !s.cheats.some((c) => c.player === p));
  if (s.free && watched && s.cheats.some((c) => c.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, games: s.games + 1, count: s.count, starter: s.loser }, rng);
}

// Andere Spielerzahl (nur der Host): zurück zur Auswahl
export function regroup(s, seat) {
  if (s.phase !== 'over' || seat !== 0 || (s.free && !s.waived && s.cheats.some((c) => c.player === seat))) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, games: s.games + 1 });
}

// --- Sicht eines Spielers: fremde Würfel unter dem Becher erst beim Aufdecken; Schummeleien kennt nur der Host ---
export function viewFor(s, seat) {
  return {
    ...s,
    dice: s.dice.map((d, p) => (p === seat ? d : d.map((v, k) => (s.out[p][k] ? v : null)))),
    cheats: [],
    undo: null,
    events: s.events.filter((e) => e.type !== 'twist' || e.player === seat),
  };
}
