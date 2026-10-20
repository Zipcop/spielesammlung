// Doppelkopf für vier als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn: 0 = Host (+z), 1 = links von ihm (−x), 2 = gegenüber (−z,
// der Gast), 3 = rechts (+x). Freie Sitze spielt der Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln: Turnier-Spielregeln (TSR) des Deutschen Doppelkopf-Verbands, Stand 21.02.2026 (doko-verband.de) – Nico
// 20.10.2026: „Turnierregeln“. 48 Karten (Neun bis Ass, jede doppelt), je 12. Vorbehaltsabfrage ab dem linken Nachbarn
// des Gebers: „gesund“ oder Vorbehalt (Hochzeit nur mit beiden Kreuz-Damen, oder ein Solo); Solo geht vor Hochzeit,
// bei mehreren Soli der weiter vorn Sitzende (TSR 4.1). Keiner meldet etwas: Normalspiel – die beiden mit einer
// Kreuz-Dame sind Re, wer beide hat, spielt eine „stille Hochzeit“ (allein, Wertung wie Solo, TSR 4.4.5).
// Hochzeit: Partner ist, wer innerhalb der ersten drei Stiche als Erster (außer dem Hochzeiter) einen Stich macht;
// macht der Hochzeiter alle drei selbst, spielt er Karo-Solo (TSR 4.4.3). Aufspiel zum ersten Stich hat immer der linke
// Nachbar des Gebers. Bedienen: Trumpf auf Trumpf, Fehlfarbe auf Fehlfarbe, sonst beliebig. Zwei gleiche Karten: die
// zuerst gelegte sticht – auch bei der Herz-10 (TSR 5.3.3). Ansagen „Re“/„Kontra“ mit mindestens 11 Karten in der
// Hand, Absagen „keine 90/60/30“ und „schwarz“ mit mindestens 10/9/8/7; Erwiderung („Kontra“ auf „Re“ und umgekehrt)
// noch mit einer Karte weniger, als die Gegenpartei brauchte; bei der Hochzeit erst nach dem Klärungsstich und je
// späterem Klärungsstich eine Karte weniger (TSR 6). Wertung nach TSR 7 (Plus-Minus), Sonderpunkte nur im Normalspiel
// (Gegen die Kreuz-Damen, Doppelkopf ≥ 40 Augen, Fuchs gefangen, Karlchen macht den letzten Stich), Solo dreifach.
//
// Abweichungen, mit Nico abgesprochen (20.10.2026): laufende Liste statt fester Runde – also kein Pflichtsolo, jedes
// Solo ist ein Lustsolo (TSR 4.3.1 verlangt vorher ein Pflichtsolo); kein Abkürzen (TSR 5.4). Eigene Vereinfachung: Wer
// „Vorbehalt“ sagt, legt dabei schon fest, was er spielen will (die zweite Fragerunde der TSR entfällt, das Ergebnis
// ist dasselbe). Geber wechselt nach jedem Spiel im Uhrzeigersinn.
//
// „Ohne Hilfen“ (free): Jede Handkarte lässt sich legen, auch ohne zu bedienen (Nichtbedienen wird vermerkt, sieht
// aber nur der Host). Bis zum nächsten Spiel kann jeder einen Mitspieler anklagen (accuse, Nico 20.10.2026: „bis
// Spielende“): Hat der nicht bedient, endet das Spiel – er bekommt −12 (+3 je Absage der Gegenpartei), die anderen je
// ein Drittel davon; schummelt ein Gegenspieler des Solisten, bekommt nur der Solist die Punkte (TSR 9.4.3/9.4.4).
// Fehlalarm: Ankläger −3, die anderen je +1 (wie ein geringfügiger Regelverstoß, TSR 9.3.2).
import { SUITS, shuffle } from '../karten/cards.js';

export const SEATS = 4;
export const HAND_SIZE = 12;
export const RANKS = ['9', 'J', 'Q', 'K', 'T', 'A'];
export const EYES = { 9: 0, J: 2, Q: 3, K: 4, T: 10, A: 11 };
export const SOLOS = ['queens', 'jacks', 'fleischlos', 'clubs', 'spades', 'hearts', 'diamonds'];
export const SOLO_NAMES = {
  queens: 'Damensolo', jacks: 'Bubensolo', fleischlos: 'Fleischloser', clubs: 'Kreuz-Solo', spades: 'Pik-Solo', hearts: 'Herz-Solo', diamonds: 'Karo-Solo',
};
export const LEVEL_NAMES = ['', '', 'keine 90', 'keine 60', 'keine 30', 'schwarz']; // 1 = „Re“ bzw. „Kontra“
export const PENALTY = 12; // Nichtbedienen erwischt (TSR 9.4.3)
export const FALSE_ALARM = 3; // Fehlalarm (TSR 9.3.2)
const NEED = [0, 11, 10, 9, 8, 7]; // so viele Karten muss man für die Stufe noch in der Hand haben (TSR 6.2.2, 6.3.4)
const TARGET = [0, 0, 151, 181, 211, 240]; // so viele Augen braucht, wer bis zu dieser Stufe abgesagt hat (TSR 7.1)
const AGAINST = [0, 0, 90, 60, 30, 0]; // so viele Augen reichen der Gegenpartei dann (bei „schwarz“: ein Stich)

// Kartentexte: Farbe + Wert + Blatt a/b ('cQa' = Kreuz-Dame aus dem ersten Blatt). Die ersten beiden Zeichen sind das Kartenbild.
export const faceOf = (c) => c.slice(0, 2);
export const suitOf = (c) => c[0];
export const rankOf = (c) => c[1];
export const eyesOf = (c) => EYES[c[1]];

export function makeDeck() {
  const cards = [];
  for (const deck of ['a', 'b']) for (const s of SUITS) for (const r of RANKS) cards.push(s + r + deck);
  return cards;
}
const DECK = new Set(makeDeck());
export const isCard = (c) => typeof c === 'string' && DECK.has(c);

// --- Trümpfe und Rangfolge (TSR 2.3) ---
// kind = 'normal' (Normalspiel, Hochzeit, stille Hochzeit – wie Karo-Solo) oder eine Soloart
const NORMAL_TRUMPS = ['hT', 'cQ', 'sQ', 'hQ', 'dQ', 'cJ', 'sJ', 'hJ', 'dJ'];
const SOLO_SUIT = { clubs: 'c', spades: 's', hearts: 'h', diamonds: 'd', normal: 'd' };
export function trumpsOf(kind) {
  if (kind === 'queens') return ['cQ', 'sQ', 'hQ', 'dQ'];
  if (kind === 'jacks') return ['cJ', 'sJ', 'hJ', 'dJ'];
  if (kind === 'fleischlos') return [];
  const s = SOLO_SUIT[kind];
  return [...NORMAL_TRUMPS, ...['A', 'T', 'K', '9'].map((r) => s + r).filter((f) => f !== 'hT')];
}
const TRUMP_RANK = Object.fromEntries(['normal', ...SOLOS].map((k) => [k, new Map(trumpsOf(k).map((f, i) => [f, i]))]));
const FEHL = ['A', 'T', 'K', 'Q', 'J', '9']; // Fehlfarben, höchste zuerst (was Trumpf ist, fehlt dort)

export const isTrump = (c, kind) => TRUMP_RANK[kind].has(faceOf(c));
// „Farbe“ fürs Bedienen: 't' = Trumpf, sonst die Fehlfarbe
export const keyOf = (c, kind) => (isTrump(c, kind) ? 't' : suitOf(c));
// Stärke einer Karte (größer = höher): Trümpfe über allen Fehlkarten
export const power = (c, kind) => (isTrump(c, kind) ? 100 - TRUMP_RANK[kind].get(faceOf(c)) : 10 - FEHL.indexOf(rankOf(c)));

// Sticht a (später gelegt) die bisher höchste Karte b? Gleiche Karten: die erste bleibt vorn (TSR 5.3.3)
export function beats(a, b, kind) {
  const ta = isTrump(a, kind);
  if (ta || isTrump(b, kind)) return ta && power(a, kind) > power(b, kind);
  return suitOf(a) === suitOf(b) && power(a, kind) > power(b, kind);
}

// trick = [{ p, c }] in Legereihenfolge → Sitz, dem der Stich gehört (bzw. der gerade vorn liegt)
export function trickWinner(trick, kind) {
  let best = trick[0];
  for (const x of trick.slice(1)) if (beats(x.c, best.c, kind)) best = x;
  return best.p;
}

// Was man legen darf (Bedienpflicht, TSR 5.2)
export function legalCards(hand, trick, kind) {
  if (!trick.length) return [...hand];
  const led = keyOf(trick[0].c, kind);
  const same = hand.filter((c) => keyOf(c, kind) === led);
  return same.length ? same : [...hand];
}

export const nextSeat = (p) => (p + 1) % SEATS;
const withAt = (list, i, value) => list.map((x, k) => (k === i ? value : x));
const countFace = (cards, face) => cards.filter((c) => faceOf(c) === face).length;
// Reihenfolge der Abfrage und des ersten Aufspiels: links vom Geber beginnend
export const orderFrom = (dealer) => [1, 2, 3, 4].map((k) => (dealer + k) % SEATS);

// --- Neues Spiel ---
// humans = Sitze der Menschen (Host 0, Gast 2) – nur für die Anzeige und die Computer wichtig
export function newGame({ dealer = 0, humans = [0], score = [0, 0, 0, 0], list = [], free = false, round = 1, seq = 0 } = {}, rng = Math.random) {
  const deck = shuffle(makeDeck(), rng);
  // viermal je drei Karten, beim linken Nachbarn des Gebers beginnend (TSR 3.3.7)
  const hands = [[], [], [], []];
  let k = 0;
  for (let packet = 0; packet < 4; packet++) for (const p of orderFrom(dealer)) hands[p].push(...deck.slice(k, (k += 3)));
  return {
    seq,
    events: [{ type: 'deal', dealer }],
    round,
    dealer,
    humans,
    free,
    phase: 'reserve', // reserve → play → over
    turn: orderFrom(dealer)[0],
    hands,
    calls: [null, null, null, null], // 'gesund' | 'wedding' | Soloart – die anderen sehen nur „Vorbehalt“
    contract: null, // { type: 'normal' | 'wedding' | 'silent' | 'solo', kind, player, partner, clarified }
    kind: 'normal', // Rangfolge der Karten
    re: null, // Sitze der Re-Partei (nur beim Host bekannt)
    trick: [],
    tricks: [], // { cards: [{ p, c }], winner, eyes }
    ann: [0, 0], // höchste Ansage von Re und Kontra: 1 = Re/Kontra, 2 = keine 90 … 5 = schwarz
    late: [false, false], // Partei hat nur per Erwiderung angesagt → keine Absagen mehr (TSR 6.4.4)
    says: [], // { player, party, level } in der Reihenfolge der Ansagen
    score,
    list, // Spielliste: { round, title, points }
    result: null,
    revokes: [], // ohne Hilfen: wer nicht bedient hat (nur beim Host)
    waived: false, // ohne Hilfen: der Computer hat das Spiel geprüft und lässt es gelten
  };
}

// --- Vorbehaltsabfrage ---
export function reserve(s, seat, choice) {
  if (s.phase !== 'reserve' || s.turn !== seat) return null;
  if (choice !== 'gesund' && choice !== 'wedding' && !SOLOS.includes(choice)) return null;
  if (choice === 'wedding' && countFace(s.hands[seat], 'cQ') < 2) return null;
  const calls = withAt(s.calls, seat, choice);
  const next = { ...s, calls, seq: s.seq + 1, events: [{ type: 'call', player: seat, call: choice === 'gesund' ? 'gesund' : 'vorbehalt' }] };
  if (calls.includes(null)) return { ...next, turn: nextSeat(seat) };
  return startPlay(next);
}

// Alle haben sich geäußert: Spielart festlegen (TSR 4.1.5 – Solo vor Hochzeit, weiter vorn vor weiter hinten)
function startPlay(s) {
  const order = orderFrom(s.dealer);
  const soloist = order.find((p) => SOLOS.includes(s.calls[p]));
  const wedding = order.find((p) => s.calls[p] === 'wedding');
  const silent = order.find((p) => countFace(s.hands[p], 'cQ') === 2);
  let contract;
  if (soloist !== undefined) contract = { type: 'solo', kind: s.calls[soloist], player: soloist };
  else if (wedding !== undefined) contract = { type: 'wedding', kind: 'normal', player: wedding, partner: null, clarified: null };
  else if (silent !== undefined) contract = { type: 'silent', kind: 'normal', player: silent };
  else contract = { type: 'normal', kind: 'normal' };
  const re = contract.type === 'normal' ? order.filter((p) => s.hands[p].some((c) => faceOf(c) === 'cQ')) : [contract.player];
  return {
    ...s,
    phase: 'play',
    contract,
    kind: contract.kind,
    re,
    turn: order[0],
    events: [...s.events, { type: 'contract', contract: contract.type === 'silent' ? { type: 'normal', kind: 'normal' } : contract }],
  };
}

// --- Parteien ---
const playedBy = (s, seat) => [...s.tricks.flatMap((t) => t.cards), ...s.trick].filter((x) => x.p === seat).map((x) => x.c);

// Partei eines Sitzes, wie er selbst sie kennt (funktioniert auf dem vollen Stand und auf seiner Sicht):
// 0 = Re, 1 = Kontra, null = noch offen (Hochzeit vor dem Klärungsstich, außer beim Hochzeiter)
export function partyOf(s, seat) {
  const c = s.contract;
  if (!c) return null;
  if (c.type === 'solo' || c.type === 'silent') return seat === c.player ? 0 : 1;
  if (c.type === 'wedding') return seat === c.player || seat === c.partner ? 0 : c.partner === null ? null : 1;
  const own = [...(Array.isArray(s.hands[seat]) ? s.hands[seat] : []), ...playedBy(s, seat)];
  return own.some((c) => faceOf(c) === 'cQ') ? 0 : 1;
}

// Was alle wissen (ohne Blick in fremde Hände): Partei je Sitz oder null. viewer = wer fragt (kennt seine eigene).
// Nur sichere Schlüsse – keiner, der bei einer stillen Hochzeit falsch wäre.
export function knownParties(s, viewer = null) {
  const out = [null, null, null, null];
  const c = s.contract;
  if (!c) return out;
  if (c.type === 'solo' || c.type === 'silent') {
    if (c.type === 'solo' || silentShown(s) || viewer === c.player) return out.map((_, p) => (p === c.player ? 0 : 1));
  }
  if (c.type === 'wedding') {
    out[c.player] = 0;
    if (c.partner !== null) return out.map((_, p) => (p === c.player || p === c.partner ? 0 : 1));
    return out;
  }
  // Normalspiel (für alle außer dem stillen Hochzeiter sieht die stille Hochzeit so aus)
  for (const x of s.says) out[x.player] = x.party;
  for (const t of [...s.tricks.map((t) => t.cards), s.trick]) {
    if (!t.length) continue;
    for (const x of t) if (faceOf(x.c) === 'cQ') out[x.p] = 0;
    // kein Trumpf mehr → keine Kreuz-Dame (ohne Hilfen gilt das nicht: dort darf man trotz Trumpf abwerfen)
    if (!s.free && isTrump(t[0].c, s.kind)) for (const x of t) if (!isTrump(x.c, s.kind) && out[x.p] === null) out[x.p] = 1;
  }
  if (viewer !== null) {
    const mine = partyOf(s, viewer);
    out[viewer] = mine;
    // Wer eine Kreuz-Dame hat, erkennt den Partner an der anderen
    if (mine === 0 && Array.isArray(s.hands[viewer]) && countFace([...s.hands[viewer], ...playedBy(s, viewer)], 'cQ') === 1) {
      const other = [0, 1, 2, 3].find((p) => p !== viewer && playedBy(s, p).some((x) => faceOf(x) === 'cQ'));
      if (other !== undefined) return out.map((_, p) => (p === viewer || p === other ? 0 : 1));
    }
  }
  const re = out.flatMap((x, p) => (x === 0 ? [p] : []));
  if (re.length === 2) return out.map((x, p) => (re.includes(p) ? 0 : 1)); // zwei verschiedene Kreuz-Damen-Besitzer → Rest Kontra
  return out;
}

// Stille Hochzeit verrät sich, wenn derselbe Spieler die zweite Kreuz-Dame legt (TSR 4.4.5)
const silentShown = (s) => s.contract?.type === 'silent' && countFace(playedBy(s, s.contract.player), 'cQ') === 2;

// --- Ansagen und Absagen (TSR 6) ---
// Karten, um die sich die Zeitpunkte bei der Hochzeit verschieben (Klärungsstich 2 → 1, 3 → 2)
const shiftOf = (s) => (s.contract?.clarified ? s.contract.clarified - 1 : 0);

export function canAnnounce(s, seat, level) {
  if (s.phase !== 'play' || !Number.isInteger(level) || level < 1 || level > 5) return false;
  const c = s.contract;
  if (c.type === 'wedding' && c.partner === null) return false; // erst nach dem Klärungsstich (TSR 6.4.2)
  const party = partyOf(s, seat);
  if (party === null) return false;
  const own = s.ann[party];
  const opp = s.ann[1 - party];
  if (level <= own || (own > 0 && s.late[party])) return false;
  const cards = Array.isArray(s.hands[seat]) ? s.hands[seat].length : s.hands[seat];
  const shift = shiftOf(s);
  if (cards >= NEED[own + 1] - shift) return true; // übersprungene Stufen müssen auch noch erlaubt sein (TSR 6.4.3)
  return own === 0 && level === 1 && opp > 0 && cards >= NEED[opp] - shift - 1; // Erwiderung (TSR 6.4.4)
}

export const announceOptions = (s, seat) => [1, 2, 3, 4, 5].filter((l) => canAnnounce(s, seat, l));

export function announce(s, seat, level) {
  if (!canAnnounce(s, seat, level)) return null;
  const party = partyOf(s, seat);
  const cards = s.hands[seat].length;
  const late = s.ann[party] === 0 && cards < NEED[1] - shiftOf(s);
  return {
    ...s,
    ann: withAt(s.ann, party, level),
    late: late ? withAt(s.late, party, true) : s.late,
    says: [...s.says, { player: seat, party, level }],
    seq: s.seq + 1,
    events: [{ type: 'announce', player: seat, party, level }],
  };
}

// --- Spielen ---
export function play(s, seat, card) {
  if (s.phase !== 'play' || s.turn !== seat || !Array.isArray(s.hands[seat]) || !s.hands[seat].includes(card)) return null;
  const legal = legalCards(s.hands[seat], s.trick, s.kind).includes(card);
  if (!legal && !s.free) return null;
  const trick = [...s.trick, { p: seat, c: card }];
  const next = {
    ...s,
    hands: withAt(s.hands, seat, s.hands[seat].filter((c) => c !== card)),
    trick,
    turn: nextSeat(seat),
    seq: s.seq + 1,
    events: [{ type: 'play', player: seat, card }],
  };
  if (!legal) next.revokes = [...s.revokes, revokeOf(s, seat)];
  return trick.length < SEATS ? next : finishTrick(next);
}

// Nichtbedienen vermerken – mit allem, was die Strafe braucht, so wie es in diesem Moment ist
function revokeOf(s, seat) {
  const c = s.contract;
  const party = s.re.includes(seat) ? 0 : 1;
  const solo = c.type === 'solo' || silentShown(s); // stille Hochzeit: erst ab der zweiten Kreuz-Dame wie beim Solo (TSR 4.4.5)
  return {
    player: seat, trick: s.tricks.length, key: keyOf(s.trick[0].c, s.kind), absagen: Math.max(0, s.ann[1 - party] - 1), soloist: solo ? c.player : null,
  };
}

// Hat der Spieler die Farbe, die er nicht bedient hat, später doch gelegt? Dann kann es jeder am Tisch sehen.
export function revealed(s, r) {
  const later = [...s.tricks.slice(r.trick + 1).flatMap((t) => t.cards), ...(s.tricks.length > r.trick ? s.trick : [])];
  return later.some((x) => x.p === r.player && keyOf(x.c, s.kind) === r.key);
}

function finishTrick(s) {
  const winner = trickWinner(s.trick, s.kind);
  const eyes = s.trick.reduce((sum, x) => sum + eyesOf(x.c), 0);
  const tricks = [...s.tricks, { cards: s.trick, winner, eyes }];
  const next = clarify({ ...s, trick: [], tricks, turn: winner, events: [...s.events, { type: 'trick', winner, eyes }] });
  return tricks.length === HAND_SIZE ? finish(next) : next;
}

// Hochzeit: Klärungsstich (TSR 4.4.3)
function clarify(s) {
  const c = s.contract;
  if (c.type !== 'wedding' || c.partner !== null) return s;
  const n = s.tricks.length;
  const w = s.tricks.at(-1).winner;
  if (w !== c.player) {
    return { ...s, contract: { ...c, partner: w, clarified: n }, re: [c.player, w], events: [...s.events, { type: 'partner', player: w }] };
  }
  if (n < 3) return s;
  return {
    ...s,
    contract: { type: 'solo', kind: 'diamonds', player: c.player, wedding: true, clarified: 3 },
    kind: 'diamonds',
    events: [...s.events, { type: 'alone', player: c.player }],
  };
}

// --- Abrechnung (TSR 7) ---
const soloLike = (c) => c.type === 'solo' || c.type === 'silent';
const normalGame = (c) => c.type === 'normal' || c.type === 'wedding';

export function settle(s) {
  const party = (p) => (s.re.includes(p) ? 0 : 1);
  const eyes = [0, 0];
  const won = [0, 0];
  for (const t of s.tricks) {
    eyes[party(t.winner)] += t.eyes;
    won[party(t.winner)]++;
  }
  const [reL, koL] = s.ann;
  const wins = (k) => {
    const lv = s.ann[k];
    const opp = s.ann[1 - k];
    if (lv >= 2) return lv === 5 ? won[1 - k] === 0 : eyes[k] >= TARGET[lv];
    if (opp >= 2) return opp === 5 ? won[k] > 0 : eyes[k] >= AGAINST[opp];
    const onlyKontra = koL >= 1 && reL === 0;
    return k === 0 ? eyes[0] >= (onlyKontra ? 120 : 121) : eyes[1] >= (onlyKontra ? 121 : 120);
  };
  const winner = wins(0) ? 0 : wins(1) ? 1 : null;
  const lines = [];
  const add = (k, text, pts = 1, extra = false) => lines.push({ party: k, text, pts, extra }); // extra = Sonderpunkt
  const under = (k) => { // gegen die andere Partei „unter 90 gespielt“ usw. (TSR 7.2.2 a)
    const o = 1 - k;
    if (eyes[o] < 90) add(k, 'unter 90 gespielt');
    if (eyes[o] < 60) add(k, 'unter 60 gespielt');
    if (eyes[o] < 30) add(k, 'unter 30 gespielt');
    if (won[o] === 0) add(k, 'schwarz gespielt');
  };
  const reach = (k) => { // gegen eine Absage der anderen Partei erreicht (TSR 7.2.2 e, f)
    const o = s.ann[1 - k];
    if (o >= 2 && eyes[k] >= 120) add(k, '120 Augen gegen „keine 90“');
    if (o >= 3 && eyes[k] >= 90) add(k, '90 Augen gegen „keine 60“');
    if (o >= 4 && eyes[k] >= 60) add(k, '60 Augen gegen „keine 30“');
    if (o >= 5 && eyes[k] >= 30) add(k, '30 Augen gegen „schwarz“');
  };
  if (winner !== null) {
    add(winner, 'gewonnen');
    under(winner);
    if (reL >= 1) add(winner, '„Re“ angesagt', 2);
    if (koL >= 1) add(winner, '„Kontra“ angesagt', 2);
    for (let l = 2; l <= reL; l++) add(winner, `„${LEVEL_NAMES[l]}“ von Re abgesagt`);
    for (let l = 2; l <= koL; l++) add(winner, `„${LEVEL_NAMES[l]}“ von Kontra abgesagt`);
    reach(winner);
  } else {
    // keiner hat sein abgesagtes Ziel erreicht (TSR 7.1.3): nur a (ohne Grundwert), e, f und Sonderpunkte
    for (const k of [0, 1]) {
      under(k);
      reach(k);
    }
  }
  if (normalGame(s.contract)) { // Sonderpunkte (TSR 7.2.3)
    if (winner === 1) add(1, 'gegen die Kreuz-Damen gewonnen', 1, true);
    s.tricks.forEach((t, i) => {
      const k = party(t.winner);
      if (t.eyes >= 40) add(k, `Doppelkopf (${t.eyes} Augen)`, 1, true);
      for (const x of t.cards) if (faceOf(x.c) === 'dA' && party(x.p) !== k) add(k, 'Fuchs gefangen', 1, true);
      if (i === HAND_SIZE - 1 && faceOf(t.cards.find((x) => x.p === t.winner).c) === 'cJ') add(k, 'Karlchen macht den letzten Stich', 1, true);
    });
  }
  const sum = (k) => lines.filter((l) => l.party === k).reduce((n, l) => n + l.pts, 0);
  const value = sum(0) - sum(1); // aus Sicht von Re
  const points = [0, 1, 2, 3].map((p) => {
    if (soloLike(s.contract)) return p === s.contract.player ? 3 * value : -value;
    return party(p) === 0 ? value : -value;
  });
  return { winner, eyes, won, lines, value, points, re: s.re, contract: s.contract };
}

function finish(s) {
  const result = settle(s);
  return {
    ...s,
    phase: 'over',
    turn: null,
    result,
    score: s.score.map((x, p) => x + result.points[p]),
    list: [...s.list, { round: s.round, title: titleOf(s.contract), points: result.points }],
    events: [...s.events, { type: 'over' }],
  };
}

export function titleOf(c) {
  if (c.type === 'solo') return c.wedding ? 'Hochzeit → Karo-Solo' : SOLO_NAMES[c.kind];
  if (c.type === 'silent') return 'Stille Hochzeit';
  if (c.type === 'wedding') return 'Hochzeit';
  return 'Normalspiel';
}

// --- Ohne Hilfen: anklagen ---
export function accuse(s, by, target) {
  const seats = [0, 1, 2, 3];
  if (!s.free || !seats.includes(by) || !seats.includes(target) || by === target) return null;
  if (s.phase === 'reserve' || s.result?.caught) return null;
  const r = s.revokes.find((x) => x.player === target);
  const undone = s.phase === 'over' ? s.score.map((x, p) => x - s.result.points[p]) : s.score; // Ergebnis gilt nicht mehr
  if (!r) {
    const points = seats.map((p) => (p === by ? -FALSE_ALARM : 1));
    return {
      ...s,
      score: s.score.map((x, p) => x + points[p]),
      list: [...s.list, { round: s.round, title: 'Fehlalarm', points }],
      seq: s.seq + 1,
      events: [{ type: 'fehlalarm', player: by, target }],
    };
  }
  const pen = PENALTY + 3 * r.absagen;
  const points = seats.map((p) => {
    if (p === target) return -pen;
    if (r.soloist !== null && r.soloist !== target) return p === r.soloist ? pen : 0;
    return pen / 3;
  });
  const game = s.phase === 'over' ? s.list.findLastIndex((x) => x.round === s.round && x.title !== 'Fehlalarm') : -1; // Zeile des Spiels
  const list = s.list.filter((_, i) => i !== game);
  return {
    ...s,
    phase: 'over',
    turn: null,
    result: { caught: { player: target, by, trick: r.trick }, points, re: s.re, contract: s.contract },
    score: undone.map((x, p) => x + points[p]),
    list: [...list, { round: s.round, title: 'Nicht bedient – erwischt', points }],
    seq: s.seq + 1,
    events: [{ type: 'caught', player: target, by }],
  };
}

// Computer (allein) hat das fertige Spiel geprüft und lässt es gelten
export const waive = (s) => (s.free && s.phase === 'over' && !s.waived ? { ...s, waived: true } : null);

// Nächstes Spiel – wer nicht bedient hat, kann es nicht selbst starten, solange man ihn noch erwischen kann:
// allein, bis der Computer das Spiel durchgewinkt hat; zu zweit, solange der andere Mensch sauber gespielt hat
export function again(s, player, rng = Math.random) {
  if (s.phase !== 'over') return null;
  const revoked = (p) => s.revokes.some((r) => r.player === p);
  const watched = s.humans.length === 1 ? !s.waived : s.humans.some((p) => p !== player && !revoked(p));
  if (s.free && !s.result?.caught && revoked(player) && watched) return null;
  return newGame({ dealer: nextSeat(s.dealer), humans: s.humans, score: s.score, list: s.list, free: s.free, round: s.round + 1, seq: s.seq + 1 }, rng);
}

// --- Sicht eines Spielers ---
// Eigene Karten offen, sonst nur die Anzahl; Vorbehalte der anderen nur als „vorbehalt“; Parteien und stille Hochzeit
// erst am Ende; ob jemand nicht bedient hat, weiß nur der Host. Am Ende sind alle Karten offen.
export function viewFor(s, seat) {
  const over = s.phase === 'over';
  const c = s.contract;
  const hidden = c?.type === 'silent' && seat !== c.player && !silentShown(s) && !over;
  return {
    ...s,
    hands: s.hands.map((h, p) => (p === seat || over ? h : h.length)),
    calls: s.calls.map((x, p) => (x === null || p === seat || x === 'gesund' ? x : 'vorbehalt')),
    contract: hidden ? { type: 'normal', kind: 'normal' } : c,
    re: over ? s.re : null,
    revokes: [],
  };
}
