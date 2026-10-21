// Zehntausend für 2–4 als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei Doppelkopf: 0 = Host (+z), 1 = links (−x),
// 2 = gegenüber (−z, der Gast), 3 = rechts (+x). Zu zweit sitzen 0 und 2, zu dritt 0, 1, 2. Freie Sitze spielt der
// Computer. Alles liegt offen auf dem Tisch – viewFor versteckt nur, ob jemand geschummelt hat.
//
// Regeln (de.wikipedia.org/wiki/Zehntausend_(Spiel), abgerufen 21.10.2026): Einsen zählen 100, Fünfen 50, drei gleiche
// die Augenzahl mal 100 (drei Einsen 1000); jeder weitere gleiche Würfel verdoppelt (Verdoppel-Regel: vier Zweien 400,
// fünf Einsen 4000); Straße 1–6 = 2000. Nach jedem Wurf mindestens einen wertenden Würfel herauslegen, dann aufhören
// (Punkte gutschreiben) oder mit dem Rest weiterwürfeln. Ein Wurf ohne Wertung („Niete“) kostet alle Punkte dieses
// Zugs. Sind alle sechs Würfel gewertet, geht es mit allen sechs weiter („Anschluss“). Wer zuerst 10 000 hat, beendet
// das Spiel – wer in der Runde nach ihm noch dran ist, bekommt noch einen Zug; die meisten Punkte gewinnen.
//
// Eigene Festlegungen (Varianten schwanken je Quelle): sechs Würfel; drei Paare = 1500 (wie „Zehntausend Rückwärts“
// bei Wikipedia, auch vier gleiche + ein Paar); Kombinationen zählen nur aus einem Wurf; Aufhören erst ab 350 Punkten
// im Zug (wie „Verschärft“), Mehrlinge müssen dafür nicht „bewiesen“ werden. Gleichstand am Ende = gemeinsamer Sieg.
//
// „Ohne Hilfen“ (free): Nichts wird geprüft – man darf auch Würfel ohne Wertung herauslegen (z. B. für den Anschluss),
// nichts herauslegen, nach einer Niete weiterwürfeln oder Punkte aufschreiben, unter 350 aufhören und Würfel heimlich
// drehen. Ob ein Zug regelwidrig war, merkt sich nur der Host (cheat). Der Zug ist anfechtbar, bis der Nächste würfelt
// (nach Spielende: bis zur nächsten Partie). Erwischt: Die Punkte dieses Zugs verfallen und es gibt 500 Strafpunkte
// (läuft der Zug noch, ist er vorbei); Fehlalarm: der Rufer verliert 250 Punkte. Weniger als 0 gibt es nicht.

export const DICE = 6;
export const GOAL = 10000;
export const MIN_BANK = 350;
export const STRAIGHT = 2000;
export const PAIRS = 1500;
export const CHEAT_PENALTY = 500;
export const FALSE_ALARM_PENALTY = 250;
export const SEAT_SETS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const TRIPLE = [0, 1000, 200, 300, 400, 500, 600]; // drei gleiche je Augenzahl
export const CHEAT_NAMES = {
  none: 'nichts herausgelegt',
  junk: 'Würfel ohne Wertung herausgelegt',
  reroll: 'nach einer Niete weitergewürfelt',
  bust: 'nach einer Niete Punkte aufgeschrieben',
  low: `unter ${MIN_BANK} Punkten aufgehört`,
  twist: 'einen Würfel heimlich gedreht',
};

const isDie = (d) => Number.isInteger(d) && d >= 1 && d <= 6;
const fill = (v) => Array(DICE).fill(v);
export const nextSeat = (seats, seat) => seats[(seats.indexOf(seat) + 1) % seats.length];

// Punkte einer Auswahl von Würfeln (aus einem Wurf): points = was sie bringt, junk = Würfel, die nichts zählen
export function scoreOf(values) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of values) c[v]++;
  let points = 0;
  let junk = 0;
  for (let v = 1; v <= 6; v++) {
    const n = c[v];
    if (n >= 3) points += TRIPLE[v] * 2 ** (n - 3);
    else if (v === 1) points += 100 * n;
    else if (v === 5) points += 50 * n;
    else junk += n;
  }
  if (values.length === DICE && c.slice(1).every((n) => n === 1)) return { points: STRAIGHT, junk: 0 };
  if (values.length === DICE && c.every((n) => n % 2 === 0) && PAIRS > points) return { points: PAIRS, junk: 0 };
  return { points, junk };
}
// Bringt dieser Wurf überhaupt etwas?
export const scores = (values) => scoreOf(values).points > 0;

export const selected = (s) => [0, 1, 2, 3, 4, 5].filter((i) => s.marked[i]);
export const pickOf = (s) => scoreOf(selected(s).map((i) => s.dice[i]));
export const onTable = (s) => [0, 1, 2, 3, 4, 5].filter((i) => s.where[i] === 'table');
// Welche Würfel der nächste Wurf nimmt: am Zuganfang alle, sonst alle nicht herausgelegten (Anschluss: wieder alle)
export function thrownBy(s) {
  if (s.rolls === 0) return fill(true);
  const out = s.where.map((w, i) => w === 'aside' || s.marked[i]);
  return out.every(Boolean) ? fill(true) : out.map((o) => !o);
}

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
    starter: null,
    turn: null,
    by: null, // wem die Würfel gerade gehören (wer zuletzt geworfen hat)
    dice: [1, 2, 3, 4, 5, 6],
    where: fill('cup'), // je Würfel: 'cup' | 'table' (aus dem letzten Wurf) | 'aside' (in diesem Zug herausgelegt)
    marked: fill(false), // zum Herauslegen gewählt (zählt beim nächsten Wurf bzw. beim Aufhören)
    picks: [], // in diesem Zug herausgelegt: { dice: [Nummern], points }
    turnPts: 0,
    rolls: 0, // Würfe in diesem Zug
    bust: false, // letzter Wurf ohne Wertung (ohne Hilfen bleibt der Zug dann offen, bis man weitergibt)
    scores: [0, 0, 0, 0],
    final: null, // wer zuerst 10 000 erreicht hat – die anderen haben noch einen Zug
    winner: null, // Sitz oder null (Gleichstand)
    list: [], // Gutschriften: { player, points }
    cheat: null, // ohne Hilfen: anfechtbarer Zug { player, kinds, banked } – nur beim Host
  };
  return count ? setup(s, 0, count, rng, starter) : s;
}

// Spielerzahl wählen (nur der Host, Sitz 0) – gleich danach geht es los
export function setup(s, seat, count, rng = Math.random, starter = null) {
  if (s.phase !== 'setup' || seat !== 0 || !SEAT_SETS[count]) return null;
  const seats = SEAT_SETS[count];
  const first = seats.includes(starter) ? starter : seats[Math.floor(rng() * seats.length)];
  return {
    ...s, phase: 'play', count, seats, starter: first, turn: first, seq: s.seq + 1, events: [{ type: 'start', player: first }],
  };
}

const onTurn = (s, seat) => s.phase === 'play' && s.turn === seat;
const bump = (s, events, extra) => ({ ...s, ...extra, seq: s.seq + 1, events });

// --- Würfeln (Augenzahlen aus der Physik dessen, der würfelt; nicht geworfene Würfel behalten ihre Zahl) ---
// Vorher Gewähltes wird herausgelegt; ohne Hilfen geht auch Regelwidriges (vermerkt).
export function roll(s, seat, values) {
  if (!onTurn(s, seat) || !Array.isArray(values) || values.length !== DICE || !values.every(isDie)) return null;
  const faults = [];
  let { where, picks, turnPts } = s;
  const events = [];
  if (s.rolls > 0) {
    const sel = selected(s);
    const pick = pickOf(s);
    if (s.bust) faults.push('reroll');
    if (!sel.length) faults.push('none');
    else if (pick.junk) faults.push('junk');
    if (faults.length && !s.free) return null;
    where = where.map((w, i) => (s.marked[i] ? 'aside' : w));
    if (sel.length) picks = [...picks, { dice: sel, points: pick.points }];
    turnPts += pick.points;
    if (sel.length) events.push({ type: 'pick', player: seat, points: pick.points, total: turnPts });
    if (where.every((w) => w === 'aside')) events.push({ type: 'anschluss', player: seat });
  }
  const thrown = thrownBy(s);
  const dice = s.dice.map((d, i) => (thrown[i] ? values[i] : d));
  where = where.map((w, i) => (thrown[i] ? 'table' : w));
  const got = scoreOf(dice.filter((_, i) => thrown[i])).points;
  let next = mark(begin(s, seat), faults);
  events.push({ type: 'roll', player: seat, dice: thrown.map((t, i) => (t ? dice[i] : null)), bust: !got });
  next = bump(next, events, { dice, where, picks, turnPts, marked: fill(false), rolls: s.rolls + 1, by: seat, bust: !got });
  if (!got && !s.free) return endTurn(next, 0, [...events, { type: 'bust', player: seat, lost: turnPts }]);
  return next;
}

// --- Würfel zum Herauslegen wählen / abwählen (nur aus dem letzten Wurf) ---
export function toggle(s, seat, i) {
  if (!onTurn(s, seat) || s.rolls === 0 || s.where[i] !== 'table') return null;
  return { ...s, marked: s.marked.map((m, k) => (k === i ? !m : m)), seq: s.seq + 1, events: [] };
}

// --- Aufhören: das Gewählte herauslegen und die Punkte des Zugs gutschreiben ---
export function bank(s, seat) {
  if (!onTurn(s, seat) || s.rolls === 0) return null;
  const sel = selected(s);
  const pick = pickOf(s);
  const total = s.turnPts + pick.points;
  const faults = [];
  if (s.bust) faults.push('bust');
  if (!sel.length) faults.push('none');
  else if (pick.junk) faults.push('junk');
  if (total < MIN_BANK) faults.push('low');
  if (faults.length && !s.free) return null;
  let next = mark(begin(s, seat), faults); // begin: nach einem Fehlalarm mitten im Zug wieder anfechtbar
  if (next.cheat) next = { ...next, cheat: { ...next.cheat, banked: total } };
  next = {
    ...next,
    where: s.where.map((w, i) => (s.marked[i] ? 'aside' : w)),
    marked: fill(false),
    picks: sel.length ? [...s.picks, { dice: sel, points: pick.points }] : s.picks,
  };
  return endTurn(next, total, [{ type: 'bank', player: seat, points: total }]);
}

// --- Ohne Hilfen: nach einer Niete den Zug selbst abgeben (mit Hilfen passiert das von allein) ---
export function pass(s, seat) {
  if (!onTurn(s, seat) || !s.bust) return null;
  return endTurn(s, 0, [{ type: 'bust', player: seat, lost: s.turnPts }]);
}

// --- Ohne Hilfen: einen Würfel aus dem letzten Wurf heimlich auf die nächste Zahl drehen ---
export function twist(s, seat, i) {
  if (!s.free || !onTurn(s, seat) || s.rolls === 0 || s.where[i] !== 'table') return null;
  const dice = s.dice.map((d, k) => (k === i ? (d % 6) + 1 : d));
  const bust = !scores(onTable(s).map((k) => dice[k]));
  return { ...mark(begin(s, seat), ['twist']), dice, bust, seq: s.seq + 1, events: [{ type: 'twist', player: seat }] };
}

// Zug vorbei: Punkte gutschreiben, der Nächste ist dran – oder das Spiel ist aus (events = alle Ereignisse dieser Aktion)
function endTurn(s, points, events) {
  const seat = s.turn;
  const add = (list, n) => list.map((x, p) => (p === seat ? x + n : x));
  const scoresNow = add(s.scores, points);
  const final = s.final ?? (scoresNow[seat] >= GOAL ? seat : null);
  const next = nextSeat(s.seats, seat);
  const all = [...events];
  if (final !== null && final !== s.final) all.push({ type: 'goal', player: seat });
  const base = {
    ...s, scores: scoresNow, final, list: points ? [...s.list, { player: seat, points }] : s.list,
    turnPts: 0, rolls: 0, bust: false, marked: fill(false), seq: s.seq + 1,
  };
  // Die Runde ist um, wenn wieder der Anfänger dran wäre – wer vor dem mit 10 000 dran war, würfelt nicht nochmal
  if (final !== null && next === s.starter) {
    const winner = leader(s.seats, scoresNow);
    return { ...base, phase: 'over', turn: null, winner, events: [...all, { type: 'over', winner }] };
  }
  return { ...base, turn: next, events: all };
}

// Wer vorn liegt (bei Gleichstand keiner)
export function leader(seats, list) {
  const top = Math.max(...seats.map((p) => list[p]));
  const best = seats.filter((p) => list[p] === top);
  return best.length === 1 ? best[0] : null;
}

// --- Ohne Hilfen ---
// Erste Aktion eines Zugs: ab hier ist dieser Zug anfechtbar, der des Vorgängers nicht mehr
function begin(s, seat) {
  if (!s.free || s.cheat?.player === seat) return s;
  return { ...s, cheat: { player: seat, kinds: [], banked: 0 } };
}
const mark = (s, kinds) => (kinds.length && s.cheat ? { ...s, cheat: { ...s.cheat, kinds: [...new Set([...s.cheat.kinds, ...kinds])] } } : s);

// „Geschummelt!“ gegen den offenen Zug (der Rufer muss selbst am Tisch sitzen)
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !s.seats.includes(by) || s.phase === 'setup') return null;
  const minus = (list, p, n) => list.map((x, k) => (k === p ? Math.max(0, x - n) : x));
  if (!c.kinds.length) {
    const scoresNow = minus(s.scores, by, FALSE_ALARM_PENALTY);
    const event = { type: 'fehlalarm', player: by, target: c.player, lost: FALSE_ALARM_PENALTY };
    return settle({ ...s, scores: scoresNow, cheat: null, seq: s.seq + 1, events: [event] });
  }
  const lost = c.banked + CHEAT_PENALTY;
  const scoresNow = minus(s.scores, c.player, lost);
  const event = { type: 'caught', player: c.player, by, kinds: c.kinds, lost };
  let next = { ...s, scores: scoresNow, cheat: null, seq: s.seq + 1, events: [event] };
  // Wer durch den Schummelzug die 10 000 geschafft hatte und jetzt wieder darunter liegt, hat sie nicht mehr
  if (next.phase === 'play' && next.final === c.player && scoresNow[c.player] < GOAL) next = { ...next, final: null };
  if (next.phase === 'play' && next.turn === c.player) {
    return endTurn({ ...next, turnPts: 0 }, 0, [event]); // sein Zug ist vorbei – ohne Punkte
  }
  return settle(next);
}
// Nach Spielende: Sieger neu bestimmen
const settle = (s) => (s.phase === 'over' ? { ...s, winner: leader(s.seats, s.scores) } : s);

// Den offenen Zug gelten lassen (allein: der Computer nach Spielende) – sonst hielte er die nächste Partie auf
export const waive = (s, seat) => (s.free && s.cheat && s.cheat.player !== seat ? { ...s, cheat: null } : null);

// Nächste Partie mit gleicher Spielerzahl; es beginnt der Nächste nach dem letzten Anfänger. Wer zuletzt gezogen hat,
// startet sie nicht selbst, solange man seinen Zug noch anfechten kann.
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, games: s.games + 1, count: s.count, starter: nextSeat(s.seats, s.starter) }, rng);
}

// Andere Spielerzahl (nur der Host): zurück zur Auswahl
export function regroup(s, seat) {
  if (s.phase !== 'over' || seat !== 0 || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, games: s.games + 1 });
}

// Alles liegt offen – nur ob jemand geschummelt hat, weiß allein der Host
export const viewFor = (s) => ({ ...s, cheat: s.cheat && { player: s.cheat.player } });
