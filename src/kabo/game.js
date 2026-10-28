// Kabo (Volksspiel der Cambio-/Golf-Familie mit normalem Rommé-Blatt) für 2–4 als reine Funktionen. Der Host hält den
// vollen Spielstand: Jede Aktion liefert einen neuen Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei
// Schwimmen: 0 = Host (+z), 1 = links (−x), 2 = gegenüber (−z, der Gast), 3 = rechts (+x). Zu zweit sitzen 0 und 2, zu
// dritt 0, 1, 2. Freie Sitze spielt der Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln (Festlegungen für dieses Spiel, nach den Cambio-Volksregeln – Quellen in der Übergabe): 52 Karten + 2 Joker.
// Werte: Joker 0, roter König −1, Ass 1, 2–10 die Augen, Bube, Dame und schwarzer König 10. Jeder bekommt 4 Karten
// verdeckt im 2 × 2-Raster (Platz 0 und 1 = nahe Reihe, 2 und 3 = hintere), die erste Karte vom Stapel kommt offen auf
// die Ablage. Zu Beginn sieht jeder einmal seine beiden nahen Karten an – danach zählt nur noch das Gedächtnis.
// Startspieler wird ausgelost, jede Runde fängt der Nächste an. Ein Zug: (a) vom Stapel ziehen (nur der Ziehende sieht
// die Karte) und gegen eine eigene Karte tauschen (die alte kommt offen auf die Ablage) oder direkt ablegen – dann gilt
// die Fähigkeit der Karte (freiwillig): 7/8 eine eigene Karte ansehen, 9/10 eine fremde ansehen, Bube/Dame eine eigene
// gegen eine fremde blind tauschen, schwarzer König eine eigene und eine fremde ansehen und danach wahlweise tauschen.
// (b) die oberste Ablagekarte nehmen und gegen eine eigene tauschen (ohne Fähigkeit). Statt eines Zuges „Kabo!“ rufen,
// sobald jeder einmal dran war: Jeder andere hat noch genau einen Zug, die Karten des Rufers sind gesperrt (nicht
// tauschbar), dann wird aufgedeckt. Jeder schreibt seine Kartensumme; hat der Rufer allein die niedrigste, schreibt er 0,
// sonst seine Summe + 10. Ist der Stapel leer, wird die Ablage ohne die oberste Karte gemischt. Die Partie endet, wenn
// einer 100 oder mehr hat – es gewinnt der niedrigste Stand (Gleichstand = mehrere Sieger).
// Bewusst weggelassen: Abwerfen gleicher Karten außer der Reihe (Echtzeit-Wettlauf).
//
// „Ohne Hilfen“ (free): Nach jedem Ablegen, Tauschen oder Nehmen kommt der Schritt „Fähigkeit“ – jede der vier geht,
// auch ohne passende Karte. Schummeln (merkt sich nur der Host, mit kurzem Grund): Fähigkeit ohne frisch gezogene
// passende Karte, „heimlich ansehen“ (eine beliebige Karte im eigenen Zug), gesperrte Karten des Rufers tauschen und
// „Kabo!“, bevor jeder dran war. Jeder Zug ist anfechtbar, bis ein anderer etwas tut (am Rundenende bis zur nächsten
// Runde). Erwischt: der ganze Zug wird zurückgenommen, der Schummler setzt ihn aus und bekommt 10 Strafpunkte.
// Fehlalarm: 5 Strafpunkte für den Ankläger.
import { makeDeck, shuffle, rankOf, isRed, isJoker, cardName, JOKERS } from '../karten/cards.js';

export const SEAT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
export const GOAL = 100; // ab so vielen Punkten ist die Partie vorbei
export const MISS = 10; // Kabo gerufen, aber nicht allein am niedrigsten
export const CAUGHT = 10; // beim Schummeln erwischt
export const FALSE_ALARM = 5; // „Geschummelt!“ zu Unrecht
export const NEAR = [0, 1]; // die beiden nahen Karten – die sieht jeder zu Beginn an
export const KINDS = ['own', 'other', 'swap', 'king'];
export { cardName };

// Kartenwert: Joker 0, roter König −1, Ass 1, Bube/Dame/schwarzer König 10, sonst die Augen
export function valueOf(c) {
  if (isJoker(c)) return 0;
  const r = rankOf(c);
  if (r === 'K') return isRed(c) ? -1 : 10;
  if (r === 'A') return 1;
  return 'TJQ'.includes(r) ? 10 : Number(r);
}

// Fähigkeit beim direkten Ablegen: own = eigene ansehen, other = fremde ansehen, swap = blind tauschen,
// king = eigene und fremde ansehen, dann wahlweise tauschen
export function powerOf(c) {
  if (!c || isJoker(c)) return null;
  const r = rankOf(c);
  if (r === '7' || r === '8') return 'own';
  if (r === '9' || r === 'T') return 'other';
  if (r === 'J' || r === 'Q') return 'swap';
  return r === 'K' && !isRed(c) ? 'king' : null;
}

export const sumOf = (hand) => hand.reduce((sum, c) => sum + valueOf(c), 0);
export const fullDeck = () => [...makeDeck('2'), ...JOKERS];
export const DECK = 54;

// nächster Sitz im Uhrzeigersinn, der mitspielt
export function nextSeat(s, seat) {
  for (let k = 1; k <= 4; k++) {
    const p = (seat + k) % 4;
    if (s.seats.includes(p)) return p;
  }
  return seat;
}

const withHand = (hands, seat, hand) => hands.map((h, p) => (p === seat ? hand : h));
const emptySeen = () => [0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => [null, null, null, null]));
const copySeen = (seen) => seen.map((x) => x.map((h) => [...h]));
const validSpot = (s, o) => !!o && typeof o === 'object' && s.seats.includes(o.p) && Number.isInteger(o.i) && o.i >= 0 && o.i < 4;
const validOwn = (i) => Number.isInteger(i) && i >= 0 && i < 4;

// --- Neue Partie ---
// Erst wählt der Host, wie viele am Tisch sitzen (setup), dann wird ausgeteilt. humans = Sitze der Menschen.
export function newGame({ humans = [0], free = false, seq = 0 } = {}) {
  return {
    seq,
    events: [{ type: 'setup' }],
    phase: 'setup', // setup → peek (nahe Karten ansehen) → play → over (Runde vorbei) → peek …
    humans,
    free,
    count: null,
    seats: [],
    scores: [0, 0, 0, 0], // Gesamtstand der Partie
    done: false,
    winners: [], // bei Gleichstand mehrere
    winner: null, // einziger Sieger oder null
    games: 0,
    round: 0,
    starter: null,
    turn: null,
    step: null, // im Zug: start → drawn (gezogen) → power (Fähigkeit) → look (ansehen) → nächster
    hands: [[], [], [], []], // je 4 Karten, Platz 0/1 nah, 2/3 hinten
    talon: [],
    discard: [], // offen, die letzte liegt oben
    drawn: null, // frisch gezogene Karte
    power: null, // Fähigkeit, die gerade erlaubt ist (null = keine)
    look: null, // { seat, kind, spots: [{ p, i }] } – wer gerade welche Karten ansieht
    ready: [], // haben ihre nahen Karten angesehen
    moved: [], // waren in dieser Runde schon dran
    turns: 0, // Züge in dieser Runde
    caller: null, // wer „Kabo!“ gerufen hat
    fines: [0, 0, 0, 0], // Strafpunkte dieser Runde (ohne Hilfen)
    seen: emptySeen(), // seen[wer][sitz][platz] = zuletzt gesehene Karte – das Gedächtnis (nur für den Computer)
    secret: null, // ohne Hilfen: heimlich angesehen { seat, p, i }
    result: null,
    cheat: null, // ohne Hilfen: anfechtbarer Zug { player, legal, prev, why } – nur beim Host
  };
}

// Spielerzahl wählen (nur der Host, Sitz 0) – gleich danach wird ausgeteilt
export function setup(s, seat, count, rng = Math.random) {
  if (s.phase !== 'setup' || seat !== 0 || !SEAT_SETS[count]) return null;
  return match({ ...s, count }, rng);
}

// Neue Partie mit dieser Spielerzahl: alle bei 0, der erste Startspieler wird ausgelost
function match(s, rng) {
  const seats = SEAT_SETS[s.count];
  const first = seats[Math.floor(rng() * seats.length)];
  return deal({ ...s, seats, scores: [0, 0, 0, 0], done: false, winners: [], winner: null, games: s.games + 1, round: 0 }, rng, first);
}

function deal(s, rng, starter) {
  const deck = shuffle(fullDeck(), rng);
  const hands = [[], [], [], []];
  let k = 0;
  for (const p of s.seats) hands[p] = deck.slice(k, (k += 4));
  const seen = emptySeen();
  for (const p of s.seats) for (const i of NEAR) seen[p][p][i] = hands[p][i];
  return {
    ...s,
    phase: 'peek',
    round: s.round + 1,
    starter,
    turn: null,
    step: null,
    hands,
    discard: [deck[k]],
    talon: deck.slice(k + 1),
    drawn: null,
    power: null,
    look: null,
    ready: s.seats.filter((p) => !s.humans.includes(p)), // der Computer hat gleich hingesehen
    moved: [],
    turns: 0,
    caller: null,
    fines: [0, 0, 0, 0],
    seen,
    secret: null,
    result: null,
    cheat: null,
    seq: s.seq + 1,
    events: [{ type: 'deal', starter, top: deck[k] }],
  };
}

// --- Nahe Karten angesehen: „Gesehen“. Sind alle so weit, geht es los. ---
export function ready(s, seat) {
  if (s.phase !== 'peek' || !s.seats.includes(seat) || s.ready.includes(seat)) return null;
  const done = [...s.ready, seat];
  const next = { ...s, ready: done, seq: s.seq + 1, events: [{ type: 'ready', player: seat }] };
  if (!s.seats.every((p) => done.includes(p))) return next;
  return { ...next, phase: 'play', turn: s.starter, step: 'start', events: [...next.events, { type: 'start', player: s.starter }] };
}

// Gemeinsamer Anfang jeder Aktion im Zug: anfechtbar machen (ohne Hilfen), Heimliches vergessen, Zähler hoch.
// Heimlich angesehen, bevor der Zug sichtbar begann (secret.early): das zählt erst jetzt zum Zug.
function touch(s, seat) {
  const next = begin(s, seat);
  return { ...(s.secret?.early ? mark(next, SNEAK) : next), secret: null, seq: s.seq + 1 };
}

const onTurn = (s, seat, step) => s.phase === 'play' && s.turn === seat && s.step === step;

// --- (a) Vom Stapel ziehen. Ist er leer, wird die Ablage ohne die oberste Karte gemischt. ---
export function draw(s, seat, rng = Math.random) {
  if (!onTurn(s, seat, 'start')) return null;
  let next = touch(s, seat);
  const events = [];
  if (!next.talon.length) {
    const top = next.discard.at(-1);
    next = { ...next, talon: shuffle(next.discard.slice(0, -1), rng), discard: [top] };
    events.push({ type: 'mixed', count: next.talon.length });
  }
  const drawn = next.talon.at(-1);
  return { ...next, talon: next.talon.slice(0, -1), drawn, step: 'drawn', events: [...events, { type: 'draw', player: seat }] };
}

// Gezogene Karte gegen eigene Karte i tauschen – die alte kommt offen auf die Ablage
export function place(s, seat, i) {
  if (!onTurn(s, seat, 'drawn') || !validOwn(i)) return null;
  const old = s.hands[seat][i];
  const hand = s.hands[seat].map((c, k) => (k === i ? s.drawn : c));
  const seen = copySeen(s.seen);
  for (const x of [0, 1, 2, 3]) seen[x][seat][i] = x === seat ? s.drawn : null;
  const next = { ...touch(s, seat), hands: withHand(s.hands, seat, hand), discard: [...s.discard, old], drawn: null, seen };
  return after(next, seat, [{ type: 'place', player: seat, i, card: old }], null);
}

// Gezogene Karte direkt ablegen – dann darf ihre Fähigkeit genutzt werden
export function drop(s, seat) {
  if (!onTurn(s, seat, 'drawn')) return null;
  const card = s.drawn;
  const next = { ...touch(s, seat), discard: [...s.discard, card], drawn: null };
  return after(next, seat, [{ type: 'drop', player: seat, card }], powerOf(card));
}

// --- (b) Oberste Ablagekarte nehmen und gegen eigene Karte i tauschen (ohne Fähigkeit) ---
export function take(s, seat, i) {
  if (!onTurn(s, seat, 'start') || !validOwn(i) || !s.discard.length) return null;
  const card = s.discard.at(-1);
  const old = s.hands[seat][i];
  const hand = s.hands[seat].map((c, k) => (k === i ? card : c));
  const seen = copySeen(s.seen);
  for (const x of [0, 1, 2, 3]) seen[x][seat][i] = card; // alle haben gesehen, was er genommen hat
  const next = { ...touch(s, seat), hands: withHand(s.hands, seat, hand), discard: [...s.discard.slice(0, -1), old], seen };
  return after(next, seat, [{ type: 'take', player: seat, i, card, old }], null);
}

// Nach dem Ablegen: Fähigkeit (wenn erlaubt) oder der Nächste. Ohne Hilfen kommt der Schritt „Fähigkeit“ immer.
function after(s, seat, events, power) {
  if (power || s.free) return { ...s, step: 'power', power, events };
  return endTurn(s, seat, events);
}

// --- Fähigkeit nutzen: { kind, own: eigener Platz, other: { p, i } } ---
const WHAT = { own: 'eine eigene Karte angesehen', other: 'eine fremde Karte angesehen', swap: 'blind getauscht', king: 'zwei Karten angesehen (König)' };
export const LOCKED = 'gesperrte Karten des Kabo-Rufers getauscht';

export function ability(s, seat, { kind, own, other } = {}) {
  if (!onTurn(s, seat, 'power') || !KINDS.includes(kind)) return null;
  if (kind !== 'other' && !validOwn(own)) return null;
  if (kind !== 'own' && (!validSpot(s, other) || other.p === seat)) return null;
  const fits = kind === s.power || (s.power === 'king' && (kind === 'own' || kind === 'other')); // weniger als der König darf
  const locked = kind === 'swap' && other.p === s.caller;
  if ((!fits || locked) && !s.free) return null;
  let next = touch(s, seat);
  if (!fits) next = mark(next, `ohne passende Karte ${WHAT[kind]}`);
  if (locked) next = mark(next, LOCKED);
  next = { ...next, power: null };
  if (kind === 'swap') return endTurn(swapCards(next, seat, own, other), seat, [{ type: 'swap', player: seat, own, other }]);
  const spots = [...(kind === 'other' ? [] : [{ p: seat, i: own }]), ...(kind === 'own' ? [] : [{ p: other.p, i: other.i }])];
  const seen = copySeen(next.seen);
  for (const x of spots) seen[seat][x.p][x.i] = s.hands[x.p][x.i];
  return { ...next, seen, step: 'look', look: { seat, kind, spots }, events: [{ type: 'look', player: seat, kind, spots }] };
}

// Eigene Karte own gegen fremde Karte other tauschen – wer wusste, was wo lag, weiß es danach am neuen Platz
function swapCards(s, seat, own, other) {
  const mine = s.hands[seat][own];
  const theirs = s.hands[other.p][other.i];
  let hands = withHand(s.hands, seat, s.hands[seat].map((c, k) => (k === own ? theirs : c)));
  hands = withHand(hands, other.p, hands[other.p].map((c, k) => (k === other.i ? mine : c)));
  const seen = copySeen(s.seen);
  for (const x of [0, 1, 2, 3]) [seen[x][seat][own], seen[x][other.p][other.i]] = [seen[x][other.p][other.i], seen[x][seat][own]];
  return { ...s, hands, seen };
}

// --- Fertig: Fähigkeit auslassen (Schritt power) oder Ansehen beenden (Schritt look). Nach dem König: swap = tauschen. ---
export function done(s, seat, swap = false) {
  if (s.phase !== 'play' || s.turn !== seat || (s.step !== 'power' && s.step !== 'look')) return null;
  if (swap && (s.step !== 'look' || s.look.kind !== 'king')) return null;
  if (s.step === 'power') {
    const next = touch(s, seat);
    return endTurn(next, seat, s.power ? [{ type: 'skip', player: seat }] : []);
  }
  const [mine, theirs] = s.look.kind === 'king' ? s.look.spots : [];
  const locked = swap && theirs.p === s.caller;
  if (locked && !s.free) return null;
  let next = { ...touch(s, seat), look: null };
  if (locked) next = mark(next, LOCKED);
  if (!swap) return endTurn(next, seat, [{ type: 'seen', player: seat }]);
  return endTurn(swapCards(next, seat, mine.i, theirs), seat, [{ type: 'swap', player: seat, own: mine.i, other: theirs, king: true }]);
}

// --- „Kabo!“ statt eines Zuges: frühestens, wenn jeder einmal dran war ---
export function kabo(s, seat) {
  if (!onTurn(s, seat, 'start') || s.caller !== null) return null;
  const early = !s.seats.every((p) => s.moved.includes(p));
  if (early && !s.free) return null;
  let next = touch(s, seat);
  if (early) next = mark(next, '„Kabo!“ gerufen, bevor jeder einmal dran war');
  return endTurn({ ...next, caller: seat }, seat, [{ type: 'kabo', player: seat }]);
}

// --- Ohne Hilfen: im eigenen Zug heimlich eine beliebige Karte ansehen (sehen nur der Schummler und der Host) ---
// Hat sein Zug noch nicht sichtbar begonnen, bleibt der Zug davor anfechtbar – sonst verriete der wechselnde
// „Geschummelt!“-Knopf den anderen das heimliche Ansehen. Es zählt dann ab seiner nächsten Aktion (touch).
const SNEAK = 'heimlich eine Karte angesehen';
export function sneak(s, seat, spot) {
  if (!s.free || s.phase !== 'play' || s.turn !== seat || !validSpot(s, spot)) return null;
  const early = s.cheat?.player !== seat;
  const next = early ? { ...s, seq: s.seq + 1 } : mark(touch(s, seat), SNEAK);
  const seen = copySeen(next.seen);
  seen[seat][spot.p][spot.i] = s.hands[spot.p][spot.i];
  return { ...next, seen, secret: { seat, p: spot.p, i: spot.i, early }, events: [{ type: 'sneak', player: seat }] };
}

// Zug vorbei: der Nächste ist dran – kommt der Kabo-Rufer wieder an die Reihe, wird aufgedeckt
function endTurn(s, seat, events) {
  const next = { ...s, step: null, power: null, look: null, drawn: null, moved: [...new Set([...s.moved, seat])], turns: s.turns + 1 };
  const p = nextSeat(s, seat);
  if (s.caller !== null && p === s.caller) return finish(next, events);
  return { ...next, turn: p, step: 'start', events };
}

// Rundenende: alle Karten offen, jeder schreibt seine Summe (+ Strafen); der Rufer 0 oder Summe + 10
function finish(s, events) {
  const sums = [0, 1, 2, 3].map((p) => (s.seats.includes(p) ? sumOf(s.hands[p]) : null));
  const low = Math.min(...s.seats.map((p) => sums[p]));
  const alone = s.caller !== null && sums[s.caller] === low && s.seats.filter((p) => sums[p] === low).length === 1;
  const points = sums.map((x, p) => (x === null ? null : (p === s.caller ? (alone ? 0 : x + MISS) : x) + s.fines[p]));
  const scores = s.scores.map((x, p) => x + (points[p] ?? 0));
  const result = { sums, points, caller: s.caller, alone, fines: [...s.fines] };
  return settle({ ...s, phase: 'over', turn: null, step: null, scores, result, events: [...events, { type: 'over', caller: s.caller, alone }] });
}

// Partie vorbei? Wer 100 erreicht, beendet sie – es gewinnt der niedrigste Stand
function settle(s) {
  const done = s.seats.some((p) => s.scores[p] >= GOAL);
  if (!done) return { ...s, done: false, winners: [], winner: null };
  const low = Math.min(...s.seats.map((p) => s.scores[p]));
  const winners = s.seats.filter((p) => s.scores[p] === low);
  return { ...s, done: true, winners, winner: winners.length === 1 ? winners[0] : null };
}

// Nächste Runde (der Nächste fängt an) – oder nach dem Ende eine neue Partie. Wer zuletzt geschummelt hat, startet sie
// nicht, solange man ihn noch erwischen kann.
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  const base = { ...s, cheat: null };
  return s.done ? match(base, rng) : deal(base, rng, nextSeat(s, s.starter));
}

// Andere Spielerzahl (nur der Host): zurück zur Auswahl
export function regroup(s, seat) {
  if (s.phase !== 'over' || seat !== 0 || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1 });
}

// --- Ohne Hilfen ---
// Jeder Zug ist anfechtbar (prev = Stand davor), bis ein anderer etwas tut. Alle Schritte eines Zuges gehören zusammen.
function begin(s, seat) {
  if (!s.free || s.cheat?.player === seat) return s;
  return { ...s, cheat: { player: seat, legal: true, prev: { ...s, cheat: null }, why: [] } };
}

const mark = (s, why) => ({ ...s, cheat: { ...s.cheat, legal: false, why: [...new Set([...s.cheat.why, why])] } });

// „Geschummelt!“ gegen den offenen Zug. Erwischt: der Zug wird zurückgenommen, der Schummler setzt ihn aus und bekommt
// 10 Strafpunkte. Fehlalarm: 5 Strafpunkte für den Ankläger (nach dem Rundenende gleich auf den Stand).
// target = wessen Zug gemeint ist: Hat inzwischen ein anderer gespielt, gilt die Anklage nicht (null).
export function accuse(s, by, target) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !s.seats.includes(by)) return null;
  if (target !== undefined && target !== c.player) return null;
  if (!c.legal) {
    const why = c.why.slice(0, 2).join(' und ');
    const prev = c.prev;
    const fines = prev.fines.map((x, p) => (p === c.player ? x + CAUGHT : x));
    const events = [{ type: 'caught', player: c.player, by, why }];
    // Begann der Zug erst nach einer gezogenen Karte (nach einem Fehlalarm mitten im Zug), kommt sie auf die Ablage
    const discard = prev.drawn ? [...prev.discard, prev.drawn] : prev.discard;
    return endTurn({ ...prev, discard, fines, secret: null, seq: s.seq + 1 }, c.player, events);
  }
  const events = [{ type: 'fehlalarm', player: by, target: c.player }];
  if (s.phase === 'over') {
    const scores = s.scores.map((x, p) => (p === by ? x + FALSE_ALARM : x));
    const result = { ...s.result, fines: s.result.fines.map((x, p) => (p === by ? x + FALSE_ALARM : x)), points: s.result.points.map((x, p) => (p === by ? x + FALSE_ALARM : x)) };
    return settle({ ...s, scores, result, cheat: null, seq: s.seq + 1, events });
  }
  return { ...s, fines: s.fines.map((x, p) => (p === by ? x + FALSE_ALARM : x)), cheat: null, seq: s.seq + 1, events };
}

// Den offenen Zug gelten lassen (allein: der Computer am Rundenende) – sonst hielte er die nächste Runde auf
export const waive = (s, seat) => (s.free && s.cheat && s.cheat.player !== seat ? { ...s, cheat: null } : null);

// Was ein Sitz sehen darf: alle Karten verdeckt (null) – außer den eigenen nahen beim Ansehen zu Beginn, den Karten, die
// er gerade (per Fähigkeit oder heimlich) ansieht, und nach der Runde allen. Die gezogene Karte sieht nur, wer zieht.
// Das Gedächtnis (seen) bekommt nur der Computer; heimliches Ansehen sieht nur der Schummler.
export function viewFor(s, seat) {
  const over = s.phase === 'over';
  const open = (p, i) => over
    || (s.phase === 'peek' && p === seat && NEAR.includes(i) && !s.ready.includes(seat))
    || (s.look?.seat === seat && s.look.spots.some((x) => x.p === p && x.i === i))
    || (s.secret?.seat === seat && s.secret.p === p && s.secret.i === i);
  return {
    ...s,
    hands: s.hands.map((h, p) => h.map((c, i) => (open(p, i) ? c : null))),
    talon: s.talon.length,
    drawn: s.drawn && (s.turn === seat ? s.drawn : '??'),
    seen: s.humans.includes(seat) ? null : s.seen[seat],
    secret: s.secret?.seat === seat ? s.secret : null,
    events: s.events.filter((e) => e.type !== 'sneak' || e.player === seat),
    cheat: s.cheat && { player: s.cheat.player },
  };
}
