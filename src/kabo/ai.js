// Computer für Kabo: sieht nur seine Sicht (viewFor) mit seinem Gedächtnis (seen) und macht je Aufruf eine Aktion.
// Idee: Unbekannte Karten schätzt er auf den Mittelwert des Blatts (knapp 6). Er tauscht hohe gegen niedrige Karten
// (gezogene oder die offene Ablage), legt Fähigkeiten-Karten lieber ab und sieht damit nach, was er noch nicht kennt,
// tauscht mit Bube/Dame blind, wenn er beim anderen eine deutlich niedrigere Karte kennt, und ruft „Kabo!“, wenn seine
// geschätzte Summe niedrig ist – je länger die Runde dauert, desto eher (sonst endete sie nie). Abwerfen: nur Karten,
// die er sicher kennt (snapMove) – wann, entscheidet index.js (Reaktionszeit).
import { valueOf, nextSeat, sameRank, EMPTY } from './game.js';

export const GUESS = 6; // geschätzter Wert einer unbekannten Karte (Mittel des Blatts: 318 / 54 ≈ 5,9)
export const KABO = 5; // ab so wenig (geschätzt) ruft er „Kabo!“ …
export const KABO_LATE = 12; // … und so hoch kann die Schwelle bis spät in der Runde steigen

// was er über Sitz p weiß: gerade offen Sichtbares, sonst sein Gedächtnis (leere Plätze bleiben EMPTY)
const known = (v, seat, p) => (v.hands[p] ?? []).map((c, i) => (c === EMPTY ? EMPTY : c ?? v.seen?.[p]?.[i] ?? null));
const guessOf = (c) => (c === EMPTY ? 0 : c === null || c === undefined ? GUESS : valueOf(c));
const card = (c) => c !== null && c !== undefined && c !== EMPTY; // sicher bekannte Karte
// geschätzte Summe eines Sitzes aus Sicht von seat
export const estimate = (v, seat, p) => known(v, seat, p).reduce((sum, c) => sum + guessOf(c), 0);

// Eigene Karte, die am meisten bringt, wenn sie weg ist: höchster bekannter Wert, sonst eine unbekannte (null = keine Karte)
function worst(v, seat) {
  const own = known(v, seat, seat);
  let best = -1;
  own.forEach((c, i) => {
    if (c === EMPTY) return;
    if (best < 0 || guessOf(c) > guessOf(own[best]) || (guessOf(c) === guessOf(own[best]) && own[best] !== null && c === null)) best = i;
  });
  return best < 0 ? null : { i: best, value: guessOf(own[best]), unknown: own[best] === null };
}

const others = (v, seat) => v.seats.filter((p) => p !== seat);
const unknownOwn = (v, seat) => known(v, seat, seat).findIndex((c) => c === null);
// fremde Karte, die er noch nicht kennt (erst beim Rufer, dann beim Nächsten reihum)
function unknownOther(v, seat) {
  const order = [];
  for (let p = nextSeat(v, seat); p !== seat; p = nextSeat(v, p)) order.push(p);
  order.sort((a, b) => (b === v.caller) - (a === v.caller));
  for (const p of order) {
    const i = known(v, seat, p).findIndex((c) => c === null);
    if (i >= 0) return { p, i };
  }
  return null;
}
// niedrigste bekannte fremde Karte (locked = auch beim Rufer)
function lowOther(v, seat, locked = false) {
  let out = null;
  for (const p of others(v, seat)) {
    if (p === v.caller && !locked) continue;
    known(v, seat, p).forEach((c, i) => {
      if (card(c) && (!out || valueOf(c) < out.value)) out = { p, i, value: valueOf(c) };
    });
  }
  return out;
}

// Lohnt ein blinder Tausch? Eigene schlechteste gegen die niedrigste bekannte fremde – mit Abstand
function goodSwap(v, seat, locked = false) {
  const w = worst(v, seat);
  const o = lowOther(v, seat, locked);
  return w && o && o.value <= w.value - 3 ? { own: w.i, other: { p: o.p, i: o.i } } : null;
}

const allMoved = (v) => v.seats.every((p) => v.moved.includes(p));
export const kaboAt = (v) => Math.min(KABO_LATE, KABO + Math.floor(v.turns / (2 * v.seats.length)));

// Nächste Aktion: { t: 'ready' } | { t: 'draw' } | { t: 'take', arg: platz } | { t: 'place', arg: platz } | { t: 'drop' }
// | { t: 'ability', arg: { kind, own, other } } | { t: 'done', arg: tauschen? } | { t: 'kabo' }
export function chooseMove(v, seat) {
  if (v.phase === 'peek') return { t: 'ready' };
  const step = v.step;
  if (step === 'start') {
    const mine = estimate(v, seat, seat);
    if (v.caller === null && allMoved(v) && mine <= kaboAt(v) && others(v, seat).every((p) => estimate(v, seat, p) >= mine - 1)) return { t: 'kabo' };
    const top = v.discard.at(-1);
    const w = worst(v, seat);
    const tv = valueOf(top);
    if (w && tv < w.value && (tv <= 2 || w.value - tv >= 5)) return { t: 'take', arg: w.i };
    return { t: 'draw' };
  }
  if (step === 'drawn') {
    const dv = valueOf(v.drawn);
    const w = worst(v, seat);
    if (w && dv < w.value && (dv <= 4 || w.value - dv >= 3)) return { t: 'place', arg: w.i };
    return { t: 'drop' };
  }
  if (step === 'power') {
    const m = power(v, seat, v.power);
    return m ?? { t: 'done', arg: false };
  }
  if (step === 'look' && v.look?.kind === 'king') {
    const [mine, theirs] = v.look.spots;
    const a = guessOf(known(v, seat, seat)[mine.i]);
    const b = guessOf(known(v, seat, theirs.p)[theirs.i]);
    return { t: 'done', arg: b < a && theirs.p !== v.caller };
  }
  return { t: 'done', arg: false };
}

// Fähigkeit sinnvoll nutzen (oder null = auslassen)
function power(v, seat, kind) {
  if (kind === 'own') {
    const i = unknownOwn(v, seat);
    return i >= 0 ? { t: 'ability', arg: { kind, own: i } } : null;
  }
  if (kind === 'other') {
    const o = unknownOther(v, seat);
    return o ? { t: 'ability', arg: { kind, other: o } } : null;
  }
  if (kind === 'swap') {
    const g = goodSwap(v, seat);
    return g ? { t: 'ability', arg: { kind, ...g } } : null;
  }
  if (kind === 'king') {
    const i = unknownOwn(v, seat);
    const own = i >= 0 ? i : worst(v, seat)?.i;
    const o = unknownOther(v, seat) ?? lowOther(v, seat);
    return o && own !== undefined ? { t: 'ability', arg: { kind, own, other: { p: o.p, i: o.i } } } : null;
  }
  return null;
}

// Abwerfen: eine eigene Karte, die er sicher kennt und die zur obersten Ablagekarte passt – { t: 'snap', arg } oder null
export function snapMove(v, seat) {
  if (v.phase !== 'play' || !v.snapOpen || v.caller === seat || !v.seats.includes(seat) || !v.discard.length) return null;
  const top = v.discard.at(-1);
  const i = known(v, seat, seat).findIndex((c) => card(c) && sameRank(c, top));
  return i >= 0 ? { t: 'snap', arg: i } : null;
}

// Ohne Hilfen (allein): ein Schummelzug statt des normalen – oder null, wenn sich keiner lohnt.
// Möglich: zu früh „Kabo!“ mit niedriger Schätzung, heimlich eine eigene unbekannte Karte ansehen, blind tauschen ohne
// Bube/Dame (oder mit einer gesperrten Karte des Rufers), wenn er dort eine deutlich niedrigere kennt.
export function cheatMove(v, seat, rng = Math.random) {
  if (v.phase !== 'play' || v.turn !== seat || !v.free) return null;
  const list = [];
  if (v.step === 'start') {
    if (v.caller === null && !allMoved(v) && estimate(v, seat, seat) <= KABO + 1) list.push({ t: 'kabo' });
    const i = unknownOwn(v, seat);
    if (i >= 0) list.push({ t: 'sneak', arg: { p: seat, i } });
  }
  if (v.step === 'power') {
    const g = goodSwap(v, seat, true);
    if (g && (v.power !== 'swap' || g.other.p === v.caller)) list.push({ t: 'ability', arg: { kind: 'swap', ...g } });
  }
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}
