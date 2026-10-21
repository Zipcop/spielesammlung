// Kalaha als reine Funktionen (kein DOM, kein three.js). Der Host hält den Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer. Regeln nach de.wikipedia „Kalaha“:
// je 6 Mulden und rechts davon ein Kalaha (Gewinnmulde) je Spieler, zu Beginn gleich viele Steine in jeder Mulde
// (hier 3–6 wählbar, Standard 4). Zug: alle Steine einer eigenen Mulde nehmen und einzeln gegen den Uhrzeigersinn in die
// folgenden Mulden säen – ins eigene Kalaha ja, das gegnerische wird übersprungen. Letzter Stein im eigenen Kalaha =
// nochmal ziehen. Letzter Stein in einer eigenen, vorher leeren Mulde und gegenüber liegen Steine = beides ins eigene
// Kalaha (Fang). Sind nach einem Zug die Mulden eines Spielers leer, ist Schluss: Jeder legt die Steine, die noch in
// seinen Mulden liegen, ins eigene Kalaha. Mehr Steine im Kalaha gewinnt, gleich viele = Remis.
// pits[0–5] = Mulden von Spieler 0 (von ihm aus links nach rechts), pits[6] = sein Kalaha, pits[7–12] = Mulden von
// Spieler 1 (von ihm aus links nach rechts), pits[13] = sein Kalaha. Gesät wird mit steigender Nummer (gegen den
// Uhrzeigersinn, von oben gesehen); gegenüber von Mulde i liegt 12 − i.
//
// „Ohne Hilfen“ (free): Ein Zug ist wie am echten Brett mehrere Schritte – Mulde leeren (take, die Steine sind dann in
// der Hand), Stein für Stein in beliebige Mulden legen (drop), wer mag fangen (capture) oder heimlich einen Stein
// umlegen (shift), fertig (done). Geprüft wird nichts. Ob man nochmal dran ist, entscheidet, wo der letzte Stein lag.
// Bis der andere selbst eine Mulde leert, kann er „Geschummelt!“ rufen (accuse) – auch über mehrere Züge am Stück
// (nochmal dran) hinweg: Stimmt es, kommen alle diese Züge zurück und der Schummler bekommt eine Verwarnung; sonst trifft
// die Verwarnung den Ankläger. Bei der dritten ist die Partie verloren.
import { rematchBlocked } from '../schummeln.js';

export const HOLES = 6;
export const STORE = [6, 13];
export const SEEDS = [3, 4, 5, 6];
export const DEFAULT_SEEDS = 4;
export const MAX_STRIKES = 3;

export const ownerOf = (i) => (i <= 6 ? 0 : 1);
export const isStore = (i) => i === 6 || i === 13;
export const opposite = (i) => 12 - i;
export const pitsOf = (p) => Array.from({ length: HOLES }, (_, k) => p * 7 + k);
const isPit = (i) => Number.isInteger(i) && i >= 0 && i < 14;

// Name einer Mulde für den Verlauf: „deine 3. Mulde“ zählt vom Spieler aus von links
export const holeNo = (i) => (i % 7) + 1;

// Nächste Mulde beim Säen für Spieler p (das gegnerische Kalaha wird übersprungen)
export function nextPit(i, p) {
  const j = (i + 1) % 14;
  return j === STORE[1 - p] ? (j + 1) % 14 : j;
}

export const startPits = (seeds = DEFAULT_SEEDS) => Array.from({ length: 14 }, (_, i) => (isStore(i) ? 0 : seeds));

// Ein Zug nach den Regeln: { pits (danach, mit Fang), path (Mulde je Stein), capture: { at, opp, n } | null, bonus }
export function sow(pits, p, from) {
  const b = [...pits];
  let n = b[from];
  b[from] = 0;
  let i = from;
  const path = [];
  while (n-- > 0) {
    i = nextPit(i, p);
    b[i]++;
    path.push(i);
  }
  let capture = null;
  if (!isStore(i) && ownerOf(i) === p && b[i] === 1 && b[opposite(i)] > 0) {
    const opp = opposite(i);
    capture = { at: i, opp, n: b[opp] + 1 };
    b[STORE[p]] += b[opp] + 1;
    b[i] = b[opp] = 0;
  }
  return { pits: b, path, capture, bonus: i === STORE[p] };
}

export const legalMoves = (pits, p) => pitsOf(p).filter((i) => pits[i] > 0);
export const sideEmpty = (pits, p) => pitsOf(p).every((i) => pits[i] === 0);
export const total = (pits) => pits.reduce((a, b) => a + b, 0);

// starter = wer anfängt · seeds = Steine je Mulde · wins = Siege aus früheren Partien · round = Nummer der Partie
export function newGame({ starter = 0, seeds = DEFAULT_SEEDS, free = false, wins = [0, 0], round = 1 } = {}) {
  const n = SEEDS.includes(seeds) ? seeds : DEFAULT_SEEDS;
  const s = { pits: startPits(n), seeds: n, starter, turn: starter, last: null, moves: 0, result: null, wins: [...wins], round, seq: 0, events: [{ type: 'start' }] };
  return free ? { ...s, free: true, open: null, strikes: [0, 0], cheat: null, verdict: null } : s;
}

// Steine je Mulde ändern – nur der Host (bzw. allein der Mensch), solange in dieser Partie noch nichts gesät ist
export function setSeeds(s, by, n) {
  if (by !== 0 || s.result || s.moves || s.open || !SEEDS.includes(n) || n === s.seeds) return null;
  return { ...s, pits: startPits(n), seeds: n, seq: s.seq + 1, events: [{ type: 'seeds', n }] };
}

// Nach einem Zug: Ist eine Seite leer, räumt jeder seine Reststeine ins eigene Kalaha → { pits, result, events }
function finish(pits) {
  if (!sideEmpty(pits, 0) && !sideEmpty(pits, 1)) return null;
  const b = [...pits];
  const events = [];
  for (const p of [0, 1]) {
    const n = pitsOf(p).reduce((a, i) => a + b[i], 0);
    if (!n) continue;
    for (const i of pitsOf(p)) b[i] = 0;
    b[STORE[p]] += n;
    events.push({ type: 'sweep', by: p, n });
  }
  const store = [b[STORE[0]], b[STORE[1]]];
  return { pits: b, events, result: { winner: store[0] === store[1] ? null : store[0] > store[1] ? 0 : 1, reason: 'leer', store } };
}

// Normaler Zug: Mulde from leeren und säen. Letzter Stein im eigenen Kalaha = nochmal dran.
export function move(s, by, from) {
  if (s.free || s.result || by !== s.turn || !pitsOf(by).includes(from) || !s.pits[from]) return null;
  const r = sow(s.pits, by, from);
  const events = [{ type: 'move', by, from, path: r.path, capture: r.capture, bonus: r.bonus }];
  const next = { ...s, pits: r.pits, last: r.path.at(-1), moves: s.moves + 1, seq: s.seq + 1, events };
  const end = finish(r.pits);
  if (end) return { ...next, pits: end.pits, result: end.result, events: [...events, ...end.events] };
  return { ...next, turn: r.bonus ? by : 1 - by };
}

// --- Ohne Hilfen ---

const mine = (s, by) => s.free && !s.result && by === s.turn;

// Eigene Mulde leeren – die Steine sind in der Hand. Leert der andere, ist die Frist für „Geschummelt!“ vorbei;
// ist derselbe nochmal dran, bleibt sie offen.
export function take(s, by, from) {
  if (!mine(s, by) || s.open || !pitsOf(by).includes(from) || !s.pits[from]) return null;
  const prev = s.cheat && s.cheat.player !== by ? { ...s, cheat: null, verdict: null } : { ...s, verdict: null };
  const pits = [...s.pits];
  const hand = pits[from];
  pits[from] = 0;
  return { ...prev, pits, open: { from, hand, drops: [], shifts: [], captures: [], prev }, seq: s.seq + 1, events: [{ type: 'take', by, from, n: hand }] };
}

// Steine zurück in die Mulde (noch keiner gelegt)
export function untake(s, by) {
  const o = s.open;
  if (!mine(s, by) || !o || o.drops.length || o.shifts.length || o.captures.length) return null;
  return { ...o.prev, seq: s.seq + 1, events: [{ type: 'untake', by, from: o.from }] };
}

// Einen Stein aus der Hand in eine beliebige Mulde (auch ein Kalaha) legen
export function drop(s, by, at) {
  const o = s.open;
  if (!mine(s, by) || !o || !o.hand || !isPit(at)) return null;
  const pits = [...s.pits];
  pits[at]++;
  return { ...s, pits, last: at, open: { ...o, hand: o.hand - 1, drops: [...o.drops, at] }, seq: s.seq + 1, events: [{ type: 'drop', by, at }] };
}

// Fang: Steine der Mulde at und der gegenüberliegenden ins eigene Kalaha (at = Mulde, kein Kalaha)
export function capture(s, by, at) {
  const o = s.open;
  if (!mine(s, by) || !o || o.hand || !isPit(at) || isStore(at) || !s.pits[at]) return null;
  const pits = [...s.pits];
  const opp = opposite(at);
  const n = pits[at] + pits[opp];
  pits[STORE[by]] += n;
  pits[at] = pits[opp] = 0;
  return { ...s, pits, open: { ...o, captures: [...o.captures, at] }, seq: s.seq + 1, events: [{ type: 'capture', by, at, opp, n }] };
}

// Einen Stein mit der Hand von Mulde from nach to umlegen (z. B. ins eigene Kalaha schmuggeln)
export function shift(s, by, from, to) {
  const o = s.open;
  if (!mine(s, by) || !o || !isPit(from) || !isPit(to) || from === to || !s.pits[from]) return null;
  const pits = [...s.pits];
  pits[from]--;
  pits[to]++;
  return { ...s, pits, open: { ...o, shifts: [...o.shifts, [from, to]] }, seq: s.seq + 1, events: [{ type: 'shift', by, from, to }] };
}

const same = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

// Was an einem Zug ohne Hilfen regelwidrig war (leer = alles richtig). Fang vergessen ist kein Schummeln – nur Pech.
export function violations(prev, by, o) {
  const rule = sow(prev.pits, by, o.from);
  const why = [];
  if (o.drops.includes(STORE[1 - by])) why.push('das gegnerische Kalaha nicht übersprungen');
  else if (!same(o.drops, rule.path)) why.push('falsch gesät');
  const sneaked = o.shifts.filter(([, to]) => to === STORE[by]).length;
  if (sneaked) why.push(sneaked === 1 ? 'einen Stein ins eigene Kalaha geschmuggelt' : `${sneaked} Steine ins eigene Kalaha geschmuggelt`);
  if (o.shifts.length > sneaked) why.push('heimlich Steine umgelegt');
  const fair = rule.capture && same(o.drops, rule.path) ? [rule.capture.at] : [];
  if (o.captures.length && !same(o.captures, fair)) why.push('gefangen, ohne dass es erlaubt war');
  return why;
}

// Zug fertig (alle Steine gelegt): versteckt festhalten, ob er regelgerecht war. Lag der letzte Stein im eigenen
// Kalaha, bleibt derselbe dran. Ist danach eine Seite leer, ist Schluss.
export function done(s, by) {
  const o = s.open;
  if (!mine(s, by) || !o || o.hand) return null;
  const why = violations(o.prev, by, o);
  const bonus = o.drops.at(-1) === STORE[by];
  const c = s.cheat?.player === by ? s.cheat : null; // nochmal dran: alle Züge am Stück zählen zusammen
  const cheat = { player: by, legal: !why.length && (c?.legal ?? true), why: [...(c?.why ?? []), ...why], prev: c?.prev ?? { ...o.prev, cheat: null } };
  const events = [{ type: 'done', by, from: o.from, bonus, captured: o.captures.length > 0 }];
  const next = { ...s, open: null, turn: bonus ? by : 1 - by, moves: s.moves + 1, seq: s.seq + 1, events, cheat };
  const end = finish(s.pits);
  return end ? { ...next, pits: end.pits, result: end.result, events: [...events, ...end.events] } : next;
}

// Ein ganzer Zug ohne Hilfen in einem Schritt (Computer): plan = { from, drops, captures?, shifts? } – zählt als eine
// Aktion (seq + 1), damit das Brett ihn abspielt
export function turnOf(s, by, plan) {
  const steps = [(t) => take(t, by, plan.from), ...plan.drops.map((at) => (t) => drop(t, by, at)),
    ...(plan.captures ?? []).map((at) => (t) => capture(t, by, at)), ...(plan.shifts ?? []).map(([from, to]) => (t) => shift(t, by, from, to)), (t) => done(t, by)];
  let next = s;
  const events = [];
  for (const step of steps) {
    next = next && step(next);
    if (next) events.push(...next.events);
  }
  return next && { ...next, seq: s.seq + 1, events };
}

// Der regelgerechte Zug als Plan (für den Computer ohne Hilfen)
export function planOf(pits, p, from) {
  const r = sow(pits, p, from);
  return { from, drops: r.path, captures: r.capture ? [r.capture.at] : [] };
}

// Grund für die Meldung: höchstens zwei Verstöße, mit „ und “ verbunden
export const whyText = (why) => why.slice(0, 2).join(' und ');

// „Geschummelt!“ – nur gegen den anderen, solange er die Frist noch offen hat
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  const guilty = c.legal ? by : c.player;
  const base = c.legal ? s : c.prev; // erwischt: Stand vor dem Schummel-Zug, der Schummler ist wieder dran
  const strikes = s.strikes.map((n, p) => (p === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln', store: [base.pits[6], base.pits[13]] } : null;
  const verdict = { caught: !c.legal, player: guilty, by, ...(!c.legal && { why: whyText(c.why) }) };
  return { ...base, strikes, result: base.result ?? out, cheat: null, verdict, seq: s.seq + 1, events: [{ type: c.legal ? 'fehlalarm' : 'caught', ...verdict }] };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche)
export function waive(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Siege einschließlich der laufenden, beendeten Partie
export const score = (s) => s.wins.map((n, p) => n + (s.result?.winner === p ? 1 : 0));

// Revanche: der andere fängt an, gleich viele Steine je Mulde, die Siege zählen weiter
export function again(s, by) {
  if (!s.result || rematchBlocked(s, by)) return null;
  return newGame({ starter: 1 - s.starter, seeds: s.seeds, free: !!s.free, wins: score(s), round: (s.round ?? 1) + 1 });
}

// Was der Gast sehen darf: ob der letzte Zug regelgerecht war, muss er selbst merken
export function forGuest(s) {
  if (!s.free) return s;
  const o = s.open;
  return { ...s, cheat: s.cheat && { player: s.cheat.player }, open: o && { from: o.from, hand: o.hand, drops: o.drops, shifts: o.shifts, captures: o.captures } };
}
