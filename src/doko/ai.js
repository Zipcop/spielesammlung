// Computer-Spieler für Doppelkopf. Sieht nur seine eigene Sicht (viewFor): eigene Karten, gespielte Stiche, Ansagen.
// Spielt nach Faustregeln, wie man sie am Tisch lernt: Fehl-Asse in der ersten Runde vorspielen, dem sicheren Partner
// Augen „schmieren“ (Fuchs, Zehnen), gegen den Gegner billig übernehmen, Fuchs nicht verschenken, wer nicht bedienen
// kann, sticht wertvolle Stiche ab (ein kleiner Trumpf reicht, solange die Späteren bedienen müssen) oder wirft wertlose
// Karten. Ansagen und Soli nach Kartenstärke – Grenzen unten, Grundsätzliches prüft test/doko-ai.test.js.
import {
  faceOf, suitOf, rankOf, eyesOf, keyOf as keyOfCard, power as powerOf, beats, trickWinner, legalCards, knownParties, partyOf,
  announceOptions, trumpsOf, makeDeck, play, SOLOS,
} from './game.js';

// Grenzen – eingestellt mit Computer-gegen-Computer-Partien, alle vier mit Vorausschau (20.10.2026):
// Re ab strength() 12 (Re gewinnt dann 73 %), Kontra 3 mehr (ab 15: 75 %). „Keine 90“ ab 18 (≥ 151 Augen in 93 %),
// hat der Partner schon angesagt, reichen 15. Solo nur mit klar positivem Erwartungswert, gewonnen in 75–85 % – so
// spielt in knapp 6 % der Spiele jemand ein Solo; der Solist sagt Re an, wenn er 1 über der Grenze liegt. Stille
// Hochzeit statt Hochzeit erst ab strength() 18 (darunter bringt die Hochzeit klar mehr).
export const ANNOUNCE_AT = 12;
export const KONTRA_MORE = 3;
export const ABSAGE_AT = 18;
export const ABSAGE_MATE = 3;
export const SOLO_AT = { queens: 19, jacks: 19, fleischlos: 14, clubs: 27.5, spades: 27.5, hearts: 25.5, diamonds: 27.5 }; // soloStrength()
export const SOLO_RE = 1;
export const SILENT_AT = 18;

const ALL = makeDeck();
// Nachschlagetabellen je Spielart – dieselben Werte wie in game.js, nur schneller (die Vorausschau fragt sehr oft)
const table = (f) => Object.fromEntries(['normal', ...SOLOS].map((k) => [k, new Map(ALL.map((c) => [c, f(c, k)]))]));
const POWER = table(powerOf);
const KEY = table(keyOfCard);
const power = (c, kind) => POWER[kind].get(c);
const keyOf = (c, kind) => KEY[kind].get(c);
const isTrump = (c, kind) => KEY[kind].get(c) === 't';
const played = (v) => [...v.tricks.flatMap((t) => t.cards), ...v.trick];

// --- Vorbehalt ---
export function chooseCall(v, seat) {
  const hand = v.hands[seat];
  let best = null;
  for (const kind of SOLOS) {
    const margin = soloStrength(hand, kind) - SOLO_AT[kind];
    if (margin >= 0 && (!best || margin > best.margin)) best = { kind, margin };
  }
  if (best) return best.kind;
  if (hand.filter((c) => faceOf(c) === 'cQ').length === 2) return strength(hand, 'normal') >= SILENT_AT ? 'gesund' : 'wedding'; // sehr stark → stille Hochzeit
  return 'gesund';
}

// Wie gut eignet sich die Hand als Solo dieser Art? (Trümpfe nach Rang, Fehl-Asse, Fehlfarben ohne Stütze kosten)
export function soloStrength(hand, kind) {
  const trumps = trumpsOf(kind);
  let sc = 0;
  for (const c of hand) {
    const i = trumps.indexOf(faceOf(c));
    if (i >= 0) sc += Math.max(1, 3.2 - (i * 2.2) / Math.max(trumps.length, 1)) * (trumps.length <= 4 ? 1.35 : 1);
  }
  for (const s of ['c', 's', 'h', 'd']) {
    const fehl = hand.filter((c) => !isTrump(c, kind) && suitOf(c) === s).map(rankOf);
    if (!fehl.length) {
      if (trumps.length) sc += 0.6; // Fehl frei: kann abstechen
      continue;
    }
    const aces = fehl.filter((r) => r === 'A').length;
    sc += aces * (kind === 'fleischlos' ? 2.6 : 1.6);
    if (kind === 'fleischlos' && aces === 2) sc += fehl.filter((r) => r === 'T').length * 2; // Zehnen hinter beiden Assen
    sc -= Math.max(0, fehl.length - aces * 2) * (kind === 'fleischlos' ? 0.5 : 0.9); // Karten, die Stiche abgeben
  }
  return sc;
}

// Stärke für Ansagen im Normalspiel (eigene Partei): Trümpfe, hohe Trümpfe, Fehl-Asse, Fehl frei
export function strength(hand, kind) {
  const trumps = trumpsOf(kind);
  let sc = 0;
  for (const c of hand) {
    const i = trumps.indexOf(faceOf(c));
    if (i >= 0) sc += i === 0 ? 2.6 : i <= 2 ? 2.1 : i <= 4 ? 1.5 : 1;
    else if (rankOf(c) === 'A') sc += 1.4;
  }
  for (const s of ['c', 's', 'h']) if (!hand.some((c) => !isTrump(c, kind) && suitOf(c) === s)) sc += 0.8;
  return sc;
}

// --- Ansagen ---
// Re/Kontra, wenn die Partei so meist ≥ 70 % gewinnt; Kontra braucht mehr (ohne Kreuz-Dame). „Keine 90“ nur bei sehr
// starker Hand – hat der Partner schon angesagt, reicht etwas weniger. Solist: wenn das Solo klar über der Grenze liegt.
export function chooseAnnounce(v, seat) {
  const options = announceOptions(v, seat);
  if (!options.length) return null;
  const party = partyOf(v, seat);
  const own = v.ann[party];
  const c = v.contract;
  const hand = v.hands[seat];
  const solo = c.type === 'solo' || c.type === 'silent';
  if (solo && c.player !== seat) return null; // Gegenspieler eines Solos sagen nicht an
  // Stärke des ganzen Blatts (auch schon gespielte Karten), dazu die Augen der eigenen Partei (soweit bekannt) über bzw.
  // unter 10 je Stich
  const cards = [...hand, ...played(v).filter((x) => x.p === seat).map((x) => x.c)];
  const known = knownParties(v, seat);
  const ours = v.tricks.filter((t) => known[t.winner] === party).reduce((n, t) => n + t.eyes, 0);
  const later = (ours - 10 * v.tricks.length) / 12;
  if (c.type === 'silent') return own === 0 && options.includes(1) ? 1 : null; // gewählt nur mit sehr starker Hand
  if (c.type === 'solo') {
    const sc = soloStrength(cards, c.kind) + later;
    return own === 0 && options.includes(1) && sc >= SOLO_AT[c.kind] + SOLO_RE ? 1 : null;
  }
  const sc = strength(cards, v.kind) + later + (party === 1 ? -KONTRA_MORE : 0);
  if (own === 0 && options.includes(1) && sc >= ANNOUNCE_AT) return 1;
  const mate = v.says.some((x) => x.party === party && x.player !== seat);
  if (own === 1 && options.includes(2) && sc + (mate ? ABSAGE_MATE : 0) >= ABSAGE_AT) return 2;
  return null;
}

// --- Karte wählen ---
// cheat = ohne Hilfen darf er auch nicht bedienen (allein, ab und zu)
export function chooseCard(v, seat, cheat = false) {
  const hand = v.hands[seat];
  const legal = cheat ? [...hand] : legalCards(hand, v.trick, v.kind);
  if (legal.length === 1) return legal[0];
  const ctx = context(v, seat);
  return v.trick.length ? follow(ctx, legal) : lead(ctx, legal);
}

function context(v, seat) {
  const kind = v.kind;
  const hand = v.hands[seat];
  const seen = new Set([...played(v).map((x) => x.c), ...hand]);
  const unseen = ALL.filter((c) => !seen.has(c));
  const known = knownParties(v, seat);
  const me = known[seat] ?? partyOf(v, seat);
  const friend = (p) => (p === seat ? true : me === null || known[p] === null ? null : known[p] === me);
  // wer in welcher „Farbe“ (Trumpf oder Fehlfarbe) blank ist – aus nicht bedienten Stichen
  const voids = [new Set(), new Set(), new Set(), new Set()];
  for (const t of [...v.tricks.map((t) => t.cards), v.trick]) {
    if (!t.length) continue;
    const led = keyOf(t[0].c, kind);
    for (const x of t.slice(1)) if (keyOf(x.c, kind) !== led) voids[x.p].add(led);
  }
  // Solist (auch der stille Hochzeiter – nur er weiß davon)
  const soloist = (v.contract.type === 'solo' || v.contract.type === 'silent') && v.contract.player === seat;
  return { v, seat, kind, hand, unseen, known, me, friend, voids, soloist };
}

// Wie ungern gibt man eine Karte her? (Augen zählen, hohe Trümpfe sind mehr wert, als ihre Augen sagen)
function keep(ctx, c) {
  const t = isTrump(c, ctx.kind);
  return eyesOf(c) + (t ? (power(c, ctx.kind) - 86) * 0.9 : 0) + (faceOf(c) === 'dA' && t ? 6 : 0);
}

// Kann nach mir noch jemand diese Karte schlagen? (keine höhere Karte mehr unterwegs bzw. keiner blank)
function safe(ctx, c, after) {
  const k = keyOf(c, ctx.kind);
  const higher = ctx.unseen.some((u) => keyOf(u, ctx.kind) === k && power(u, ctx.kind) > power(c, ctx.kind));
  if (higher) return false;
  if (k === 't') return true;
  const rest = ctx.unseen.filter((u) => keyOf(u, ctx.kind) === k).length;
  const trumpsOut = ctx.unseen.some((u) => isTrump(u, ctx.kind));
  return !trumpsOut || (after.every((p) => !ctx.voids[p].has(k)) && rest >= 2 * after.length);
}

function lead(ctx, legal) {
  const { kind, unseen } = ctx;
  const trumps = legal.filter((c) => isTrump(c, kind));
  const fehl = legal.filter((c) => !isTrump(c, kind));
  const others = [1, 2, 3].map((k) => (ctx.seat + k) % 4);
  const trumpsOut = unseen.filter((u) => isTrump(u, kind)).length;
  // Solist: Trümpfe ziehen, solange die Gegner noch welche haben und ich die höchsten habe
  if (ctx.soloist && trumps.length && trumpsOut) {
    const top = trumps.reduce((a, b) => (power(a, kind) >= power(b, kind) ? a : b));
    if (safe(ctx, top, others)) return top;
  }
  // Fehl-Ass, das voraussichtlich durchgeht
  const aces = fehl.filter((c) => rankOf(c) === 'A' && safe(ctx, c, others));
  if (aces.length) return aces.reduce((a, b) => (count(ctx, a) <= count(ctx, b) ? a : b)); // aus der kürzeren Farbe
  // Solist ohne Trümpfe beim Gegner: sichere Karten ablaufen lassen
  const sure = legal.filter((c) => safe(ctx, c, others));
  if (sure.length && (ctx.soloist || trumpsOut === 0)) return sure.reduce((a, b) => (eyesOf(a) >= eyesOf(b) ? a : b));
  // Re mit sehr vielen Trümpfen spielt einen kleinen Trumpf (Partner kann übernehmen), Kontra eher Fehl – gemessen hilft
  // das auch dem stillen Hochzeiter
  if (trumps.length >= 6 && ctx.me === 0 && ctx.v.contract.type !== 'solo') {
    const low = trumps.filter((c) => faceOf(c) !== 'dA');
    if (low.length) return low.reduce((a, b) => (power(a, kind) <= power(b, kind) ? a : b));
  }
  if (ctx.soloist && trumps.length >= 5) { // Solist: ein mittlerer Trumpf
    const mid = trumps.filter((c) => faceOf(c) !== 'dA').sort((a, b) => power(a, kind) - power(b, kind));
    if (mid.length) return mid[Math.floor(mid.length / 2)];
  }
  // sonst: billigste Karte, lieber aus einer kurzen Fehlfarbe (macht frei zum Abstechen), Fuchs nie
  const pool = fehl.length ? fehl : legal;
  return pool.reduce((a, b) => (keep(ctx, a) + count(ctx, a) * 0.8 <= keep(ctx, b) + count(ctx, b) * 0.8 ? a : b));
}

const count = (ctx, c) => ctx.hand.filter((x) => keyOf(x, ctx.kind) === keyOf(c, ctx.kind)).length;

function follow(ctx, legal) {
  const { v, kind, friend } = ctx;
  const trick = v.trick;
  const winnerSeat = trickWinner(trick, kind);
  const best = trick.find((x) => x.p === winnerSeat).c;
  const after = [1, 2, 3].map((k) => (ctx.seat + k) % 4).filter((p) => !trick.some((x) => x.p === p));
  const eyes = trick.reduce((n, x) => n + eyesOf(x.c), 0);
  const ally = friend(winnerSeat);
  const enemiesAfter = after.filter((p) => friend(p) !== true);
  const cheapest = (list) => list.reduce((a, b) => (keep(ctx, a) <= keep(ctx, b) ? a : b));
  const richest = (list) => list.reduce((a, b) => (eyesOf(a) * 2 - keep(ctx, a) >= eyesOf(b) * 2 - keep(ctx, b) ? a : b));
  const bestSafe = trick.length && (enemiesAfter.length === 0 || safe(ctx, best, enemiesAfter));

  // Partner liegt sicher vorn → Augen dazugeben (schmieren), aber keine hohen Trümpfe verschwenden
  if (ally === true && bestSafe) {
    const cheapRich = legal.filter((c) => !isTrump(c, kind) || power(c, kind) <= 90 || faceOf(c) === 'dA');
    return richest(cheapRich.length ? cheapRich : legal);
  }
  const winning = legal.filter((c) => beats(c, best, kind));
  if (winning.length) {
    // Fehlfarbe abstechen: Wer nach mir noch Karten dieser Farbe hat, muss bedienen – dann reicht ein kleiner Trumpf
    const led = keyOf(trick[0].c, kind);
    const rest = ctx.unseen.filter((u) => keyOf(u, kind) === led).length;
    const follows = led !== 't' && enemiesAfter.every((p) => !ctx.voids[p].has(led)) && rest >= enemiesAfter.length;
    const sure = winning.filter((c) => enemiesAfter.length === 0 || safe(ctx, c, enemiesAfter) || (follows && isTrump(c, kind)));
    const worth = eyes + 8 * after.length >= 10 || ally === false;
    if (sure.length && worth) return cheapest(sure);
    // unsicher: als Letzter oder bei viel Augen versuchen, sonst lieber nicht teuer verlieren
    if (!enemiesAfter.length || eyes >= 14) return cheapest(winning);
  }
  // Nicht gewinnbar (oder nicht lohnend): billig abwerfen – Fuchs und hohe Trümpfe behalten
  if (ally === true) return richest(legal); // Partner liegt vorn, aber noch nicht sicher – trotzdem etwas Augen
  return cheapest(legal);
}

// --- Vorausschau (Monte-Carlo): Jede erlaubte Karte wird in mehreren möglichen Verteilungen der unbekannten Karten
// zu Ende gespielt (alle nach den Faustregeln oben); gewählt wird die Karte mit dem besten Durchschnitt. Die Verteilungen
// passen zu allem, was er weiß: wer welche Farbe nicht mehr hat, wer Re oder Kontra ist. budgetMs begrenzt die Rechenzeit.
// Standard 40 Stichproben: auf einem Desktop-Kern im Mittel 50 ms je Zug, budgetMs kappt die ersten Züge (max. ~160 ms)
export function searchCard(v, seat, { samples = 40, budgetMs = 150, rng = Math.random } = {}) {
  const legal = legalCards(v.hands[seat], v.trick, v.kind);
  if (legal.length === 1) return legal[0];
  const fallback = chooseCard(v, seat);
  const sum = new Map(legal.map((c) => [c, 0]));
  const start = Date.now();
  let n = 0;
  while (n < samples && (n < 6 || Date.now() - start < budgetMs)) {
    const world = sampleWorld(v, seat, rng);
    if (!world) break;
    for (const c of legal) sum.set(c, sum.get(c) + rollout(world, seat, c));
    n++;
  }
  if (!n) return fallback;
  return legal.reduce((a, b) => (sum.get(b) > sum.get(a) + 1e-9 ? b : a), fallback);
}

// Ein Spiel ab hier zu Ende spielen; Wert für meine Partei: Augen plus Spielpunkte (die zählen am Ende)
function rollout(world, seat, card) {
  let s = play(world, seat, card);
  while (s.phase === 'play') s = play(s, s.turn, chooseCard(s, s.turn));
  const party = s.re.includes(seat) ? 0 : 1;
  return s.result.eyes[party] + 25 * s.result.points[seat] / ((s.contract.type === 'solo' || s.contract.type === 'silent') && s.contract.player === seat ? 3 : 1);
}

// Eine mögliche Verteilung der Karten, die ich nicht sehe – oder null, wenn keine passende gefunden wird
export function sampleWorld(v, seat, rng = Math.random) {
  const ctx = context(v, seat);
  const others = [0, 1, 2, 3].filter((p) => p !== seat);
  const need = Object.fromEntries(others.map((p) => [p, v.hands[p]]));
  const playedQ = (p) => played(v).some((x) => x.p === p && faceOf(x.c) === 'cQ');
  const normal = v.contract.type === 'normal' || (v.contract.type === 'wedding' && v.contract.partner === null);
  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = Object.fromEntries(others.map((p) => [p, []]));
    const fits = (p, c) => hands[p].length < need[p] && !ctx.voids[p].has(keyOf(c, ctx.kind));
    const cards = shuffleWith(ctx.unseen, rng);
    // Kreuz-Damen zuerst: wer als Re bekannt ist (und noch keine gelegt hat), muss eine haben – bekannte Kontras keine
    const queens = cards.filter((c) => faceOf(c) === 'cQ');
    let ok = true;
    if (normal) {
      const wedding = v.contract.type === 'wedding' ? v.contract.player : null;
      const must = wedding !== null ? [wedding, wedding].filter((p) => p !== seat) : others.filter((p) => ctx.known[p] === 0 && !playedQ(p));
      for (const p of must.slice(0, queens.length)) {
        const q = queens.shift();
        if (!fits(p, q)) ok = false;
        else hands[p].push(q);
      }
      for (const q of queens) {
        const can = others.filter((p) => fits(p, q) && ctx.known[p] !== 1 && (wedding === null || p === wedding));
        if (!can.length) ok = false;
        else hands[can[Math.floor(rng() * can.length)]].push(q);
      }
    }
    if (!ok) continue;
    const rest = cards.filter((c) => !normal || faceOf(c) !== 'cQ');
    // Karten mit den wenigsten möglichen Empfängern zuerst verteilen
    rest.sort((a, b) => others.filter((p) => !ctx.voids[p].has(keyOf(a, ctx.kind))).length - others.filter((p) => !ctx.voids[p].has(keyOf(b, ctx.kind))).length);
    for (const c of rest) {
      const can = others.filter((p) => fits(p, c));
      if (!can.length) {
        ok = false;
        break;
      }
      // Platz nach freien Stellen gewichten, damit am Ende niemand zu viele Karten übrig hat
      const room = can.map((p) => need[p] - hands[p].length);
      let pick = rng() * room.reduce((a, b) => a + b, 0);
      let k = 0;
      while (pick >= room[k]) pick -= room[k++];
      hands[can[k]].push(c);
    }
    if (!ok) continue;
    return worldOf(v, seat, hands);
  }
  return null;
}

function worldOf(v, seat, hands) {
  const all = [0, 1, 2, 3].map((p) => (p === seat ? [...v.hands[seat]] : hands[p]));
  const c = v.contract;
  let re;
  if (c.type === 'solo' || c.type === 'silent') re = [c.player];
  else if (c.type === 'wedding') re = c.partner === null ? [c.player] : [c.player, c.partner];
  else re = [0, 1, 2, 3].filter((p) => [...all[p], ...played(v).filter((x) => x.p === p).map((x) => x.c)].some((x) => faceOf(x) === 'cQ'));
  return { ...v, hands: all, re, free: false, revokes: [] };
}

function shuffleWith(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const k = Math.floor(rng() * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

// Allein ohne Hilfen: Lohnt sich hier Nichtbedienen? Dann diese (regelwidrige) Karte, sonst null. Lohnend heißt:
// einen Stich mit Augen abstechen, den er ehrlich verlöre – oder eine teure Karte (Fuchs, Zehn, hoher Trumpf) behalten,
// die er sonst dem Gegner geben müsste.
export function cheatCard(v, seat) {
  const hand = v.hands[seat];
  const legal = legalCards(hand, v.trick, v.kind);
  if (!v.trick.length || legal.length === hand.length) return null; // er kann gar nicht falsch bedienen
  const ctx = context(v, seat);
  const c = follow(ctx, hand);
  if (legal.includes(c)) return null;
  const honest = follow(ctx, legal);
  const winner = trickWinner(v.trick, v.kind);
  const best = v.trick.find((x) => x.p === winner).c;
  const wins = (x) => beats(x, best, v.kind);
  const eyes = v.trick.reduce((n, x) => n + eyesOf(x.c), 0);
  if (ctx.friend(winner) === true || wins(honest)) return null; // Partner liegt vorn oder es geht auch ehrlich
  if (wins(c) && eyes >= 10) return c;
  if (keep(ctx, honest) - keep(ctx, c) >= 8) return c;
  return null;
}
