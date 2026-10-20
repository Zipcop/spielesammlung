// Kartenduell als reine Funktionen: zwei Spieler, je ein Deck mit 40 Karten (cards.js). Der Host hält den vollen
// Spielstand, jede Aktion liefert einen neuen Zustand oder null (ungültig). Sitz 0 = Host (+z), Sitz 1 = Gast bzw.
// Computer (−z). Jeder sieht nur viewFor(state, sitz).
//
// Regeln (vereinfacht, Nico 20.10.2026 – angelehnt an das Prinzip früher Sammelkarten-Duelle):
// - 8000 LP, 5 Startkarten. Wer anfängt, entscheidet das Los; er zieht im ersten Zug keine Karte und darf nicht angreifen.
// - Zug: Ziehen (1 Karte) → Haupt 1 → Kampf → Haupt 2 → Ende (mehr als 6 Handkarten: abwerfen bis 6).
// - Hauptphase: 1 Normalbeschwörung je Zug – offen in Angriff oder verdeckt in Verteidigung (setzen). Stufe 5–6 braucht
//   1 Tribut, ab 7 zwei. Position einmal je Zug wechseln, nicht im Zug der Beschwörung und nicht nach einem Angriff;
//   ein verdecktes Monster umdrehen (Flip) zählt als Wechsel. Zauber aktivieren oder Zauber/Fallen verdeckt setzen
//   (5 Zonen; Feldzauber in die Feldzone). Fallen erst ab dem Zug nach dem Setzen.
// - Kampf: Jedes offene Monster in Angriff greift einmal an – ein Monster des Gegners oder direkt, wenn er keins hat.
//   Gegen Angriff: höhere ATK zerstört die niedrigere, der Unterschied geht von den LP des Verlierers ab; gleich =
//   beide zerstört. Gegen Verteidigung: ATK > DEF zerstört ohne Schaden, ATK < DEF kostet den Angreifer den Unterschied.
//   Ein verdeckter Verteidiger wird dabei aufgedeckt.
// - Einfache Reaktion statt langer Ketten: Greift jemand an oder beschwört offen, darf der andere genau eine passende
//   Falle aktivieren (oder nichts) – das Fenster gibt es, sobald er eine verdeckte Karte liegen hat.
// - Verloren hat, wer 0 LP hat oder zu Beginn seines Zugs keine Karte mehr ziehen kann.
//
// „Ohne Hilfen“ (free, Nico 20.10.2026): Ziehen ist ein eigener Klick. Erlaubt, aber Schummeln: zu wenige Tribute,
// zweite Normalbeschwörung, Falle im Zug des Setzens, Angriff im ersten Zug oder zweimal mit demselben Monster,
// Position zweimal (bzw. im Beschwörungszug oder nach dem Angriff) gewechselt, eine Karte zu viel gezogen.
// Ob ein Zug regelwidrig war, merkt sich nur der Host (cheat). Anfechtbar ist alles ab dem ersten Schummeln, bis
// der andere selbst etwas tut. Erwischt: alles ab dort zurück, 500 LP Strafe. Fehlalarm: der Rufer verliert 300 LP.
import { CARD, DECKS, DECK_SIZE, deckProblem, tributesFor } from './cards.js';
import { shuffle } from '../karten/cards.js';

export const LP_START = 8000;
export const HAND_START = 5;
export const HAND_MAX = 6;
export const ZONES = 5;
export const CHEAT_PENALTY = 500;
export const FALSE_ALARM_PENALTY = 300;
export const STEP_NAMES = { main1: 'Hauptphase 1', battle: 'Kampfphase', main2: 'Hauptphase 2' };

export const ownerOf = (u) => (u < DECK_SIZE ? 0 : 1);
export const cardOf = (s, u) => CARD[s.cards[u]] ?? null; // null = verdeckt / unbekannt
const nameOf = (s, u) => cardOf(s, u)?.name ?? 'Karte';

// --- Neue Partie: erst wählt jeder sein Deck ---
export function newGame({ humans = [0], free = false, seq = 0, wins = [0, 0], round = 0 } = {}) {
  return {
    seq,
    events: [{ type: 'setup' }],
    phase: 'setup', // setup → duel → over
    humans,
    free,
    picks: [null, null], // { name, list }
    cards: {}, // uid → Karten-id (0–39 Sitz 0, 40–79 Sitz 1)
    lp: [LP_START, LP_START],
    deck: [[], []], // gezogen wird vom Ende
    hand: [[], []],
    grave: [[], []],
    mon: [empty(), empty()], // null | { u, pos: 'atk' | 'def', up, since, changed, attacked }
    st: [empty(), empty()], // null | { u, up, since, eq }
    field: [null, null], // null | { u }
    turn: null,
    turnNo: 0,
    step: null, // main1 | battle | main2
    summoned: false,
    drawn: 0,
    boost: {}, // uid → ATK bis Zugende
    shield: [false, false], // in diesem Zug kein Kampfschaden
    pending: null, // { type: 'react', who, trigger, attacker, target, summoned } | { type: 'discard', who }
    starter: null,
    winner: null,
    why: '',
    wins,
    round,
    rand: 1,
    cheat: null, // ohne Hilfen: { player, legal, prev, why } – nur beim Host
  };
}

function empty() {
  return Array(ZONES).fill(null);
}

// Deck wählen: { deck: 'glut' } oder { name, list } (eigenes Deck, 40 Karten). Sind beide gewählt, geht es los.
export function pickDeck(s, seat, pick, rng = Math.random) {
  if (s.phase !== 'setup' || (seat !== 0 && seat !== 1) || s.picks[seat]) return null;
  const fixed = typeof pick?.deck === 'string' && Object.hasOwn(DECKS, pick.deck) && DECKS[pick.deck];
  const chosen = fixed ? { name: fixed.name, list: [...fixed.list] } : { name: String(pick?.name ?? 'Eigenes Deck').slice(0, 24), list: pick?.list };
  if (deckProblem(chosen.list)) return null;
  const picks = s.picks.map((p, i) => (i === seat ? chosen : p));
  const next = { ...s, picks, seq: s.seq + 1, events: [{ type: 'pick', p: seat }] };
  return picks.every(Boolean) ? deal(next, rng) : next;
}

function deal(s, rng) {
  const n = { ...newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, wins: s.wins, round: s.round + 1 }), picks: s.picks };
  for (const p of [0, 1]) {
    const ids = shuffle(s.picks[p].list, rng);
    ids.forEach((id, i) => (n.cards[p * DECK_SIZE + i] = id));
    n.deck[p] = ids.map((_, i) => p * DECK_SIZE + i);
    n.hand[p] = n.deck[p].splice(-HAND_START).reverse();
  }
  n.phase = 'duel';
  n.starter = rng() < 0.5 ? 0 : 1;
  n.rand = Math.floor(rng() * 2 ** 31) + 1;
  n.events = [{ type: 'deal', starter: n.starter }];
  return startTurn(n, n.starter);
}

// Nächste Partie mit denselben Decks; wer zuletzt geschummelt hat, startet sie nicht, solange man ihn noch erwischen kann
export function again(s, seat, rng = Math.random) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  return deal({ ...s, cheat: null }, rng);
}

// Andere Decks wählen (beide neu)
export function regroup(s, seat) {
  if (s.phase !== 'over' || (s.free && s.cheat?.player === seat)) return null;
  return newGame({ humans: s.humans, free: s.free, seq: s.seq + 1, wins: s.wins, round: s.round });
}

// --- Hilfen zum Rechnen ---
// Arbeitskopie: alles, was Aktionen verändern, frisch kopiert (cheat.prev bleibt, wie er ist)
function copy(s) {
  return {
    ...s,
    lp: [...s.lp],
    deck: s.deck.map((a) => [...a]),
    hand: s.hand.map((a) => [...a]),
    grave: s.grave.map((a) => [...a]),
    mon: s.mon.map((z) => z.map((x) => x && { ...x })),
    st: s.st.map((z) => z.map((x) => x && { ...x })),
    field: s.field.map((x) => x && { ...x }),
    cards: { ...s.cards },
    boost: { ...s.boost },
    shield: [...s.shield],
    wins: [...s.wins],
    seq: s.seq + 1,
    events: [],
  };
}

// Wo liegt eine Karte? { where: 'mon' | 'st' | 'field' | 'hand' | 'deck' | 'grave', p, i }
export function locate(s, u) {
  for (const p of [0, 1]) {
    let i = s.mon[p].findIndex((x) => x?.u === u);
    if (i >= 0) return { where: 'mon', p, i, slot: s.mon[p][i] };
    i = s.st[p].findIndex((x) => x?.u === u);
    if (i >= 0) return { where: 'st', p, i, slot: s.st[p][i] };
    if (s.field[p]?.u === u) return { where: 'field', p, i: 0, slot: s.field[p] };
    for (const where of ['hand', 'deck', 'grave']) {
      i = s[where][p].indexOf(u);
      if (i >= 0) return { where, p, i };
    }
  }
  return null;
}

const monsters = (s, p) => s.mon[p].filter(Boolean);
const faceUp = (s, p) => monsters(s, p).filter((m) => m.up);
const hasSet = (s, p) => s.st[p].some((x) => x && !x.up);

// Aktuelle ATK/DEF mit allem, was gerade wirkt (Ausrüstung, Feld, Dauerzauber, Aura, Schub bis Zugende)
export function statOf(s, u, key) {
  const c = cardOf(s, u);
  const at = locate(s, u);
  if (!c || c.kind !== 'monster') return 0;
  let v = c[key];
  if (at?.where !== 'mon' || !at.slot.up) return v;
  const p = at.p;
  if (key === 'atk') v += s.boost[u] ?? 0;
  for (const z of [0, 1]) {
    for (const x of s.st[z]) {
      if (!x?.up) continue;
      const e = cardOf(s, x.u);
      if (e.sub === 'equip' && x.eq === u) v += e.fx[key] + (key === 'atk' && e.fx.attr === c.attr ? e.fx.bonus : 0);
      if (e.sub === 'cont' && z === p && key === 'atk') v += e.fx.atk;
    }
    const f = s.field[z] && cardOf(s, s.field[z].u);
    for (const b of f?.fx.buffs ?? []) if (b.attrs.includes(c.attr)) v += b[key];
  }
  if (key === 'atk') {
    for (const m of faceUp(s, p)) {
      const fx = cardOf(s, m.u).fx;
      if (m.u !== u && fx?.op === 'aura' && fx.attr === c.attr) v += fx.atk;
    }
  }
  return Math.max(0, v);
}
export const atkOf = (s, u) => statOf(s, u, 'atk');
export const defOf = (s, u) => statOf(s, u, 'def');
const fxOf = (s, u) => cardOf(s, u)?.fx ?? null;
const hasStatic = (s, u, op) => fxOf(s, u)?.on === 'static' && fxOf(s, u).op === op;

// Zufall im Spiel (z. B. „zufällige verdeckte Karte“) – Startwert liegt im Stand, damit alles nachvollziehbar bleibt
function roll(n) {
  let t = (n.rand = (n.rand + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- Karten bewegen (auf der Arbeitskopie n) ---
function take(n, u) {
  const at = locate(n, u);
  if (!at) return null;
  if (at.where === 'mon') n.mon[at.p][at.i] = null;
  else if (at.where === 'st') n.st[at.p][at.i] = null;
  else if (at.where === 'field') n.field[at.p] = null;
  else n[at.where][at.p].splice(at.i, 1);
  if (at.where === 'mon') { // Ausrüstung fällt mit
    for (const z of [0, 1]) {
      n.st[z].forEach((x, i) => {
        if (x?.eq === u) {
          n.st[z][i] = null;
          n.grave[ownerOf(x.u)].push(x.u);
          n.events.push({ type: 'grave', u: x.u });
        }
      });
    }
  }
  delete n.boost[u];
  return at;
}

function toGrave(n, u, type = 'destroy') {
  if (!take(n, u)) return;
  n.grave[ownerOf(u)].push(u);
  n.events.push({ type, u });
}

function toHand(n, u) {
  if (!take(n, u)) return;
  n.hand[ownerOf(u)].push(u);
  n.events.push({ type: 'bounce', u });
}

function drawCards(n, p, k) {
  for (let i = 0; i < k && n.deck[p].length; i++) {
    const u = n.deck[p].pop();
    n.hand[p].push(u);
    n.events.push({ type: 'draw', p, u });
  }
}

function changeLp(n, p, delta) {
  if (!delta || n.phase !== 'duel') return;
  n.lp[p] = Math.max(0, n.lp[p] + delta);
  n.events.push({ type: 'lp', p, n: delta });
}

function checkWin(n) {
  if (n.phase !== 'duel') return n;
  const out = [0, 1].filter((p) => n.lp[p] <= 0);
  if (!out.length) return n;
  return finish(n, out.length === 2 ? null : 1 - out[0], out.length === 2 ? 'Beide haben keine LP mehr.' : 'Keine LP mehr');
}

function finish(n, winner, why) {
  n.phase = 'over';
  n.winner = winner;
  n.why = why;
  n.pending = null;
  if (winner !== null) n.wins[winner]++;
  n.events.push({ type: 'over', winner, why });
  return n;
}

// --- Zugablauf ---
function startTurn(n, p) {
  n.turn = p;
  n.turnNo++;
  n.step = 'main1';
  n.summoned = false;
  n.drawn = 0;
  n.boost = {};
  n.shield = [false, false];
  n.pending = null;
  n.events.push({ type: 'turn', p, no: n.turnNo });
  if (n.turnNo === 1) return n;
  if (!n.deck[p].length) return finish(n, 1 - p, 'Keine Karte mehr zum Ziehen');
  if (!n.free) {
    drawCards(n, p, 1);
    n.drawn = 1;
  }
  return n;
}

function endTurn(n) {
  n.pending = null;
  return startTurn(n, 1 - n.turn);
}

const mainStep = (s) => s.step === 'main1' || s.step === 'main2';
const myMove = (s, seat) => s.phase === 'duel' && s.turn === seat && !s.pending;

// Ohne Hilfen: Erste Aktion eines Spielers schließt die Anklage-Frist des anderen und öffnet seine eigene.
// prev = Stand vor dem ersten Schummeln – dorthin geht es zurück, wenn er erwischt wird.
function begin(s, seat, fault) {
  let cheat = s.cheat;
  if (s.free && cheat?.player !== seat) cheat = { player: seat, legal: true, prev: null, why: [] };
  if (s.free && fault) {
    cheat = { ...cheat, legal: false, prev: cheat.prev ?? { ...s, cheat: null }, why: [...new Set([...(cheat.why ?? []), fault])] }; // why fehlt in der Sicht (viewFor)
  }
  return cheat;
}

// Gemeinsamer Rahmen: faults = Gründe (Schummeln) – im normalen Modus ungültig, ohne Hilfen erlaubt und gemerkt
function act(s, seat, faults, run) {
  const fault = faults.find(Boolean) ?? '';
  if (fault && !s.free) return null;
  const n = copy(s);
  n.cheat = begin(s, seat, fault);
  const out = run(n);
  return out === null ? null : checkWin(out);
}

// --- Aktionen ---
// Ziehen (nur ohne Hilfen ein eigener Klick – sonst zieht das Spiel zu Zugbeginn selbst)
export function draw(s, seat) {
  if (!s.free || !myMove(s, seat) || !s.deck[seat].length) return null;
  const allowed = s.turnNo === 1 ? 0 : 1;
  return act(s, seat, [s.drawn >= allowed && 'eine Karte zu viel gezogen'], (n) => {
    drawCards(n, seat, 1);
    n.drawn++;
    return n;
  });
}

// Normalbeschwörung: set = verdeckt in Verteidigung. tributes = eigene Monster, die dafür auf den Friedhof gehen.
export function summon(s, seat, u, { set = false, tributes = [] } = {}) {
  const c = cardOf(s, u);
  if (!myMove(s, seat) || !mainStep(s) || !s.hand[seat].includes(u) || c?.kind !== 'monster') return null;
  const need = tributesFor(c.level);
  const own = new Set(monsters(s, seat).map((m) => m.u));
  if (new Set(tributes).size !== tributes.length || tributes.length > need || !tributes.every((t) => own.has(t))) return null;
  if (s.mon[seat].filter(Boolean).length - tributes.length >= ZONES) return null;
  const faults = [
    tributes.length < need && (set ? 'ein Monster mit zu wenigen Tributen verdeckt gesetzt' // verdeckt: Name und Stufe bleiben geheim
      : `${c.name} (Stufe ${c.level}) mit ${tributes.length === 0 ? 'keinem' : tributes.length} statt ${need} Tribut${need > 1 ? 'en' : ''} beschworen`),
    s.summoned && 'zweite Normalbeschwörung in einem Zug',
  ];
  return act(s, seat, faults, (n) => {
    for (const t of tributes) toGrave(n, t, 'tribute');
    take(n, u);
    const i = n.mon[seat].indexOf(null);
    n.mon[seat][i] = { u, pos: set ? 'def' : 'atk', up: !set, since: n.turnNo, changed: null, attacked: null };
    n.summoned = true;
    n.events.push({ type: 'summon', p: seat, u, set });
    if (set) return n;
    if (c.fx?.on === 'summon') effect(n, seat, c.fx, { source: u });
    if (n.phase === 'duel' && locate(n, u)?.where === 'mon' && hasSet(n, 1 - seat)) n.pending = { type: 'react', who: 1 - seat, trigger: 'summon', summoned: u };
    return n;
  });
}

// Verdecktes Monster umdrehen (Flipbeschwörung) – kommt in Angriff, der Effekt wirkt
export function flip(s, seat, u) {
  const at = locate(s, u);
  if (!myMove(s, seat) || !mainStep(s) || at?.where !== 'mon' || at.p !== seat || at.slot.up) return null;
  const faults = [
    at.slot.since === s.turnNo && 'im selben Zug gesetzt und gleich umgedreht',
    at.slot.changed === s.turnNo && 'Position zweimal in einem Zug gewechselt',
  ];
  return act(s, seat, faults, (n) => {
    Object.assign(n.mon[seat][at.i], { up: true, pos: 'atk', changed: n.turnNo });
    n.events.push({ type: 'flip', u });
    const fx = fxOf(n, u);
    if (fx?.on === 'flip') effect(n, seat, fx, { source: u });
    return n;
  });
}

// Offenes Monster: Angriff ↔ Verteidigung
export function position(s, seat, u) {
  const at = locate(s, u);
  if (!myMove(s, seat) || !mainStep(s) || at?.where !== 'mon' || at.p !== seat || !at.slot.up) return null;
  const faults = [
    at.slot.since === s.turnNo && 'Position im Zug der Beschwörung gewechselt',
    at.slot.changed === s.turnNo && 'Position zweimal in einem Zug gewechselt',
    at.slot.attacked === s.turnNo && 'nach dem Angriff die Position gewechselt',
  ];
  return act(s, seat, faults, (n) => {
    const m = n.mon[seat][at.i];
    m.pos = m.pos === 'atk' ? 'def' : 'atk';
    m.changed = n.turnNo;
    n.events.push({ type: 'position', u });
    return n;
  });
}

// Zauber oder Falle verdeckt setzen (Feldzauber nicht – die werden gleich aktiviert)
export function setCard(s, seat, u) {
  const c = cardOf(s, u);
  if (!myMove(s, seat) || !mainStep(s) || !s.hand[seat].includes(u) || !c || c.kind === 'monster' || c.sub === 'field') return null;
  if (!s.st[seat].includes(null)) return null;
  return act(s, seat, [], (n) => {
    take(n, u);
    n.st[seat][n.st[seat].indexOf(null)] = { u, up: false, since: n.turnNo, eq: null };
    n.events.push({ type: 'set', p: seat, u });
    return n;
  });
}

// Ziele einer Karte (target aus cards.js) aus Sicht von seat
export function targetsFor(s, seat, c, self = null) {
  if (!c?.target) return [];
  const opp = 1 - seat;
  if (c.target === 'opp') return monsters(s, opp).map((m) => m.u);
  if (c.target === 'own') return faceUp(s, seat).map((m) => m.u);
  if (c.target === 'small') return [...faceUp(s, 0), ...faceUp(s, 1)].filter((m) => atkOf(s, m.u) <= 1500).map((m) => m.u);
  if (c.target === 'st') return [0, 1].flatMap((p) => [...s.st[p], s.field[p]].filter((x) => x && x.u !== self).map((x) => x.u));
  return [];
}

// Lässt sich der Effekt überhaupt ausführen? (Wiederkehr braucht ein Monster im Friedhof und eine freie Zone)
function workable(s, seat, c, ctx) {
  const fx = c.fx;
  if (fx.op === 'revive') return s.grave[seat].some((u) => cardOf(s, u).kind === 'monster') && s.mon[seat].includes(null);
  if (fx.op === 'destroySummoned') return atkOf(s, ctx.summoned) >= fx.min;
  return true;
}

// Zauber (aus der Hand oder gesetzt) bzw. gesetzte Falle aktivieren. target = uid, wenn die Karte ein Ziel braucht.
export function activate(s, seat, u, target = null) {
  const c = cardOf(s, u);
  const at = locate(s, u);
  if (s.phase !== 'duel' || !c || c.kind === 'monster' || !at || at.p !== seat) return null;
  const fromHand = at.where === 'hand';
  if (!fromHand && (at.where !== 'st' || at.slot.up)) return null;
  const pend = s.pending?.type === 'react' && s.pending.who === seat ? s.pending : null;
  if (c.kind === 'spell') {
    if (!myMove(s, seat) || !mainStep(s)) return null;
    if (fromHand && c.sub !== 'field' && !s.st[seat].includes(null)) return null;
  } else {
    if (fromHand) return null;
    const ok = pend ? c.trigger === 'any' || c.trigger === pend.trigger : c.trigger === 'any' && myMove(s, seat) && mainStep(s);
    if (!ok) return null;
  }
  const ctx = { source: u, target, attacker: pend?.attacker, summoned: pend?.summoned };
  if (c.target ? !targetsFor(s, seat, c, u).includes(target) : target !== null) return null;
  if (!workable(s, seat, c, ctx)) return null;
  const faults = [c.kind === 'trap' && at.slot.since === s.turnNo && `${c.name} im selben Zug aktiviert, in dem sie gesetzt wurde`];
  return act(s, seat, faults, (n) => {
    n.events.push({ type: 'activate', p: seat, u, target });
    if (c.sub === 'field') {
      if (n.field[seat]) toGrave(n, n.field[seat].u, 'grave');
      take(n, u);
      n.field[seat] = { u };
    } else if (fromHand) {
      take(n, u);
      n.st[seat][n.st[seat].indexOf(null)] = { u, up: true, since: n.turnNo, eq: null };
    } else n.st[seat][at.i].up = true;
    if (c.sub === 'equip') n.st[seat][n.st[seat].findIndex((x) => x?.u === u)].eq = target;
    else if (c.sub !== 'field' && c.sub !== 'cont') effect(n, seat, c.fx, ctx);
    if (c.kind === 'trap' || c.sub === 'normal') {
      if (locate(n, u)) toGrave(n, u, 'grave');
    }
    if (pend) return resolvePending(checkWin(n), pend); // Falle hat schon entschieden (z. B. Gegenschlag) → kein Kampf mehr
    return n;
  });
}

// Keine Reaktion
export function pass(s, seat) {
  const pend = s.pending;
  if (s.phase !== 'duel' || pend?.type !== 'react' || pend.who !== seat) return null;
  const n = copy(s);
  n.cheat = s.cheat;
  n.events.push({ type: 'pass', p: seat });
  return checkWin(resolvePending(n, pend));
}

function resolvePending(n, pend) {
  n.pending = null;
  if (n.phase !== 'duel' || pend.trigger !== 'attack') return n;
  if (n.negated) {
    n.negated = false;
    n.step = 'main2'; // Kampfphase vorbei
    return n;
  }
  return battle(n, pend.attacker, pend.target);
}

// Angriff: target = Monster des Gegners oder null (direkt)
export function attack(s, seat, u, target = null) {
  const at = locate(s, u);
  if (!myMove(s, seat) || s.step !== 'battle' || at?.where !== 'mon' || at.p !== seat || !at.slot.up || at.slot.pos !== 'atk') return null;
  const opp = 1 - seat;
  if (target === null) {
    if (monsters(s, opp).length && !hasStatic(s, u, 'direct')) return null;
  } else if (locate(s, target)?.where !== 'mon' || ownerOfSlot(s, target) !== opp) return null;
  const faults = [
    s.turnNo === 1 && 'im ersten Zug des Duells angegriffen',
    at.slot.attacked === s.turnNo && `zweimal mit ${nameOf(s, u)} angegriffen`,
  ];
  return act(s, seat, faults, (n) => {
    n.mon[seat][at.i].attacked = n.turnNo;
    n.events.push({ type: 'attack', p: seat, u, target });
    if (hasSet(n, opp)) {
      n.pending = { type: 'react', who: opp, trigger: 'attack', attacker: u, target };
      return n;
    }
    return battle(n, u, target);
  });
}

const ownerOfSlot = (s, u) => locate(s, u)?.p;

// Kampf ausrechnen (Arbeitskopie n). Fällt der Angreifer oder das Ziel vorher weg, verpufft der Angriff.
function battle(n, u, target) {
  const a = locate(n, u);
  if (a?.where !== 'mon' || !a.slot.up || a.slot.pos !== 'atk') return n;
  const p = a.p;
  const opp = 1 - p;
  if (target === null) {
    if (monsters(n, opp).length && !hasStatic(n, u, 'direct')) return n; // inzwischen steht ein Monster da
    hit(n, opp, atkOf(n, u));
    n.events.push({ type: 'battle', u, target: null });
    return n;
  }
  const d = locate(n, target);
  if (d?.where !== 'mon' || d.p !== opp) return n;
  const flipped = !d.slot.up;
  if (flipped) {
    n.mon[opp][d.i].up = true;
    n.events.push({ type: 'flip', u: target });
  }
  const atk = atkOf(n, u);
  const dead = [];
  if (d.slot.pos === 'atk') {
    const other = atkOf(n, target);
    if (atk > other) {
      dead.push(target);
      hit(n, opp, atk - other);
    } else if (atk < other) {
      dead.push(u);
      hit(n, p, other - atk);
    } else if (atk > 0) dead.push(u, target);
  } else {
    const def = defOf(n, target);
    if (atk > def) {
      dead.push(target);
      if (hasStatic(n, u, 'pierce')) hit(n, opp, atk - def);
    } else if (atk < def) hit(n, p, def - atk);
  }
  n.events.push({ type: 'battle', u, target });
  for (const x of dead) toGrave(n, x);
  if (checkWin(n).phase !== 'duel') return n; // Kampfschaden entscheidet vor den Effekten danach
  for (const x of dead) {
    const fx = fxOf(n, x);
    if (fx?.on === 'death') effect(n, ownerOf(x), fx, { source: x });
  }
  const fx = fxOf(n, target);
  if (flipped && fx?.on === 'flip') effect(n, opp, fx, { source: target });
  return n;
}

function hit(n, p, dmg) {
  if (dmg > 0 && !n.shield[p]) changeLp(n, p, -dmg);
}

// Effekt ausführen: seat = wem er gehört, ctx = { source, target, attacker, summoned }
function effect(n, seat, fx, ctx) {
  const opp = 1 - seat;
  const strongest = (p) => [...monsters(n, p)].sort((a, b) => atkOf(n, b.u) - atkOf(n, a.u))[0]?.u;
  switch (fx.op) {
    case 'draw': return drawCards(n, seat, fx.n);
    case 'heal': return changeLp(n, seat, fx.n);
    case 'burn': return changeLp(n, opp, -fx.n);
    case 'destroy': return locate(n, ctx.target) && toGrave(n, ctx.target);
    case 'destroyStrongest': {
      const u = strongest(opp);
      return u !== undefined && toGrave(n, u);
    }
    case 'bounceStrongest': {
      const u = strongest(opp);
      return u !== undefined && toHand(n, u);
    }
    case 'destroyRandomSet': {
      const set = n.st[opp].filter((x) => x && !x.up);
      return set.length && toGrave(n, set[Math.floor(roll(n) * set.length)].u);
    }
    case 'destroyAllOppST':
      for (const x of [...n.st[opp], n.field[opp]]) if (x) toGrave(n, x.u);
      return;
    case 'boost':
      n.boost[ctx.target] = (n.boost[ctx.target] ?? 0) + fx.n;
      return n.events.push({ type: 'boost', u: ctx.target, n: fx.n });
    case 'revive': {
      const best = n.grave[seat].filter((u) => cardOf(n, u).kind === 'monster').sort((a, b) => cardOf(n, b).atk - cardOf(n, a).atk)[0];
      const i = n.mon[seat].indexOf(null);
      if (best === undefined || i < 0) return;
      take(n, best);
      n.mon[seat][i] = { u: best, pos: fx.pos, up: true, since: n.turnNo, changed: null, attacked: null };
      return n.events.push({ type: 'revive', p: seat, u: best });
    }
    case 'destroyAttacker': return locate(n, ctx.attacker) && toGrave(n, ctx.attacker);
    case 'negateAttack':
      n.negated = true;
      return n.events.push({ type: 'negate' });
    case 'noDamage':
      n.shield[seat] = true;
      return;
    case 'weakenAttacker':
      n.boost[ctx.attacker] = (n.boost[ctx.attacker] ?? 0) - fx.n;
      return n.events.push({ type: 'boost', u: ctx.attacker, n: -fx.n });
    case 'burnHalfAttacker': return changeLp(n, opp, -Math.floor(atkOf(n, ctx.attacker) / 2));
    case 'destroySummoned': return locate(n, ctx.summoned)?.where === 'mon' && toGrave(n, ctx.summoned);
    case 'bounceSummoned': return locate(n, ctx.summoned)?.where === 'mon' && toHand(n, ctx.summoned);
    default:
  }
}

// Weiter zur nächsten Phase: 'battle' (aus Haupt 1), 'main2' (aus dem Kampf), 'end' (Zug beenden)
export function nextStep(s, seat, to) {
  if (!myMove(s, seat)) return null;
  const ok = (to === 'battle' && s.step === 'main1') || (to === 'main2' && s.step === 'battle') || to === 'end';
  if (!ok) return null;
  const n = copy(s);
  n.cheat = s.cheat;
  if (to !== 'end') {
    n.step = to;
    n.events.push({ type: 'step', step: to });
    return n;
  }
  if (n.hand[seat].length > HAND_MAX) {
    n.pending = { type: 'discard', who: seat };
    n.events.push({ type: 'step', step: 'end' });
    return n;
  }
  return endTurn(n);
}

// Ende des Zugs mit mehr als 6 Handkarten: eine abwerfen (so lange, bis es 6 sind)
export function discard(s, seat, u) {
  if (s.phase !== 'duel' || s.pending?.type !== 'discard' || s.pending.who !== seat || !s.hand[seat].includes(u)) return null;
  const n = copy(s);
  n.cheat = s.cheat;
  toGrave(n, u, 'discard');
  return n.hand[seat].length > HAND_MAX ? n : endTurn(n);
}

// --- Ohne Hilfen ---
// „Geschummelt!“: Erwischt → alles ab dem ersten Schummeln zurück, 500 LP Strafe. Fehlalarm → der Rufer verliert 300 LP.
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1) || s.phase === 'setup') return null;
  if (!c.legal) {
    const why = c.why.slice(0, 2).join(' und ');
    const n = { ...copy(c.prev), cheat: null, seq: s.seq + 1 }; // prev ist noch mitten im Duell – ein Schummel-Sieg zählt nicht
    n.events = [{ type: 'caught', player: c.player, by, why }];
    changeLp(n, c.player, -CHEAT_PENALTY);
    return checkWin(n);
  }
  const n = copy(s);
  n.cheat = null;
  n.events = [{ type: 'fehlalarm', player: by, target: c.player }, { type: 'lp', p: by, n: -FALSE_ALARM_PENALTY }];
  n.lp[by] = Math.max(0, n.lp[by] - FALSE_ALARM_PENALTY); // nach dem Ende ändert das am Sieger nichts mehr (checkWin)
  return checkWin(n);
}

// Den offenen Zug gelten lassen (allein: der Computer am Ende) – sonst hielte er den anderen von der Revanche ab
export const waive = (s, seat) => (s.free && s.cheat && s.cheat.player !== seat ? { ...s, cheat: null } : null);

// --- Sicht eines Spielers ---
// Verdeckt bleiben: beide Decks, die Hand des anderen und seine verdeckten Karten. Karten heißen nur nach Nummer (uid);
// die Nummern sind nach dem Mischen vergeben und verraten nichts. Ereignisse tragen nur Nummern.
export function viewFor(s, seat) {
  const opp = 1 - seat;
  const hidden = new Set([...s.deck[0], ...s.deck[1], ...s.hand[opp]]);
  for (const x of [...s.mon[opp], ...s.st[opp]]) if (x && !x.up) hidden.add(x.u);
  const cards = {};
  for (const [u, id] of Object.entries(s.cards)) if (!hidden.has(Number(u))) cards[u] = id;
  return {
    ...s,
    cards,
    picks: s.picks.map((p, i) => p && (i === seat ? p : { name: s.phase === 'setup' ? '' : p.name })), // fremdes Deck erst ab dem Austeilen
    rand: null,
    cheat: s.cheat && { player: s.cheat.player },
  };
}

// --- Was gerade geht (klappt auch mit der Sicht des Spielers; free = false prüft streng nach Regeln) ---
// Alle Aktionen eines Sitzes als { t, u, target, set, tributes } – für Computer, Hervorheben und Tests
export function moves(s, seat, { strict = true } = {}) {
  const v = strict ? { ...s, free: false } : s;
  const out = [];
  const tryMove = (m) => {
    if (apply(v, seat, m)) out.push(m);
  };
  if (s.phase !== 'duel') return out;
  if (s.pending) {
    if (s.pending.who !== seat) return out;
    if (s.pending.type === 'discard') {
      for (const u of s.hand[seat]) tryMove({ t: 'discard', u });
      return out;
    }
    out.push({ t: 'pass' });
    for (const x of s.st[seat]) if (x && !x.up) for (const target of candidates(s, seat, x.u)) tryMove({ t: 'activate', u: x.u, target });
    return out;
  }
  if (s.turn !== seat) return out;
  if (!strict) tryMove({ t: 'draw' });
  const own = monsters(s, seat).map((m) => m.u);
  for (const u of s.hand[seat]) {
    const c = cardOf(s, u);
    if (!c) continue;
    if (c.kind === 'monster') {
      for (const tributes of combos(own, tributesFor(c.level))) {
        tryMove({ t: 'summon', u, set: false, tributes });
        tryMove({ t: 'summon', u, set: true, tributes });
      }
    } else {
      tryMove({ t: 'set', u });
      if (c.kind === 'spell') for (const target of candidates(s, seat, u)) tryMove({ t: 'activate', u, target });
    }
  }
  for (const x of s.st[seat]) if (x && !x.up) for (const target of candidates(s, seat, x.u)) tryMove({ t: 'activate', u: x.u, target });
  for (const m of monsters(s, seat)) {
    tryMove({ t: 'flip', u: m.u });
    tryMove({ t: 'position', u: m.u });
    tryMove({ t: 'attack', u: m.u, target: null });
    for (const o of monsters(s, 1 - seat)) tryMove({ t: 'attack', u: m.u, target: o.u });
  }
  for (const to of ['battle', 'main2', 'end']) tryMove({ t: 'step', to });
  return out;
}

const candidates = (s, seat, u) => {
  const c = cardOf(s, u);
  return c?.target ? targetsFor(s, seat, c, u) : [null];
};

// Alle Auswahlen von k Stück aus list
function combos(list, k) {
  if (k === 0) return [[]];
  if (list.length < k) return [];
  const [first, ...rest] = list;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}

// Aktion als Daten anwenden (Netz, Computer, moves)
export function apply(s, seat, m, rng = Math.random) {
  switch (m?.t) {
    case 'pick': return pickDeck(s, seat, m.pick, rng);
    case 'draw': return draw(s, seat);
    case 'summon': return summon(s, seat, m.u, { set: !!m.set, tributes: Array.isArray(m.tributes) ? m.tributes : [] });
    case 'flip': return flip(s, seat, m.u);
    case 'position': return position(s, seat, m.u);
    case 'set': return setCard(s, seat, m.u);
    case 'activate': return activate(s, seat, m.u, m.target ?? null);
    case 'pass': return pass(s, seat);
    case 'attack': return attack(s, seat, m.u, m.target ?? null);
    case 'step': return nextStep(s, seat, m.to);
    case 'discard': return discard(s, seat, m.u);
    case 'accuse': return accuse(s, seat);
    case 'again': return again(s, seat, rng);
    case 'regroup': return regroup(s, seat);
    default: return null;
  }
}
