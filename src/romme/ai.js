// Computer-Gegner für Rommé. Er bekommt nur seine Sicht (viewFor) – vom Mitspieler kennt er wie ein Mensch nur die
// Kartenzahl, vom Nachziehstapel nur die Höhe. Jeder Aufruf liefert die nächste Aktion; der Zug wird jedes Mal aus dem
// aktuellen Stand neu geplant: ziehen, herauskommen (≥ 30 Punkte), Figuren auslegen, anlegen, Joker holen, ablegen.
// Ohne Hilfen spielt er von sich aus regelgerecht; schummeln kann er nur gezielt (cheatMoves).
import {
  extend, swapIn, meld, layoff, swap, arrange, isJoker, suitOf, rankOf, cardPoints, discardable, canMeld, openPoints, OPEN_MIN,
} from './game.js';
import { RANKS } from '../karten/cards.js';

const LIMIT = 40000; // so viele Schritte darf die Suche nach der besten Auslage höchstens machen
const posOf = (rank) => RANKS.indexOf(rank) + 2;
const valueAt = (pos) => (pos === 1 ? 1 : pos === 14 ? 11 : Math.min(pos, 10));
const rankValue = (rank) => (rank === 'A' ? 11 : Math.min(posOf(rank), 10));

// Alle Figuren, die sich aus den Handkarten legen lassen: { real, jokers (Anzahl), hint, value }
function candidates(real, jokers) {
  const out = [];
  const byRank = new Map();
  const bySuit = new Map();
  for (const c of real) {
    const r = byRank.get(rankOf(c)) ?? new Map();
    r.set(suitOf(c), c); // je Farbe eine Karte: im Satz die letzte, in der Reihe die erste – so passen zwei gleiche in beides
    byRank.set(rankOf(c), r);
    const s = bySuit.get(suitOf(c)) ?? new Map();
    const pos = rankOf(c) === 'A' ? 'A' : posOf(rankOf(c));
    s.set(pos, [...(s.get(pos) ?? []), c]);
    bySuit.set(suitOf(c), s);
  }
  // Sätze: jede Auswahl von Farben, mit Jokern auf 3 oder 4 aufgefüllt
  for (const [rank, suits] of byRank) {
    const cards = [...suits.values()];
    for (let mask = 1; mask < 1 << cards.length; mask++) {
      const pick = cards.filter((_, i) => mask & (1 << i));
      for (let j = Math.max(0, 3 - pick.length); j <= Math.min(jokers, 4 - pick.length); j++) {
        out.push({ real: pick, jokers: j, hint: { kind: 'set' }, value: (pick.length + j) * rankValue(rank) });
      }
    }
  }
  // Reihen: jedes Fenster lo … hi einer Farbe, Lücken mit Jokern
  for (const [suit, at] of bySuit) {
    const aces = at.get('A') ?? [];
    for (let lo = 1; lo <= 12; lo++) {
      for (let hi = lo + 2; hi <= 14; hi++) {
        const pick = [];
        let missing = 0;
        for (let p = lo; p <= hi; p++) {
          const c = p === 1 ? aces[0] : p === 14 ? aces[lo === 1 ? 1 : 0] : at.get(p)?.[0];
          if (c) pick.push(c);
          else missing++;
        }
        if (!pick.length || missing > jokers) continue;
        let value = 0;
        for (let p = lo; p <= hi; p++) value += valueAt(p);
        out.push({ real: pick, jokers: missing, hint: { kind: 'run', low: lo }, value, suit });
      }
    }
  }
  return out;
}

// Beste Auswahl sich nicht überschneidender Figuren: möglichst viele Karten, dann möglichst viele Punkte.
// need = Punkte, die noch zum Herauskommen fehlen · keep = Karten, die man ablegen darf (eine muss übrig bleiben,
// null = egal) · minJokers = so viele Joker müssen mit hinein (eingetauschte).
export function bestPacking(hand, { need = 0, keep = null, minJokers = 0 } = {}) {
  const real = hand.filter((c) => !isJoker(c));
  const jokers = hand.filter(isJoker).length;
  const index = new Map(real.map((c, i) => [c, i]));
  const byFirst = real.map(() => []);
  for (const m of candidates(real, jokers)) byFirst[Math.min(...m.real.map((c) => index.get(c)))].push(m);
  const freeJokers = keep ? hand.filter((c) => isJoker(c) && keep.has(c)).length : jokers;
  const used = new Set();
  const chosen = [];
  let best = { melds: [], cards: 0, value: 0 };
  let nodes = 0;

  const better = (cards, value) => cards > best.cards || (cards === best.cards && value > best.value);
  // Bleibt eine Karte zum Ablegen übrig? Joker in Figuren sind zuerst die eingetauschten, dann die freien.
  const keeps = (jokersLeft) => !keep || real.some((c) => !used.has(c) && keep.has(c)) || Math.min(freeJokers, jokersLeft) > 0;

  function search(i, jokersLeft, cards, value) {
    if (++nodes > LIMIT) return;
    if (chosen.length && value >= need && jokers - jokersLeft >= minJokers && better(cards, value) && keeps(jokersLeft)) {
      best = { melds: [...chosen], cards, value };
    }
    while (i < real.length && used.has(real[i])) i++;
    if (i >= real.length) return;
    let open = 0;
    for (let k = i; k < real.length; k++) if (!used.has(real[k])) open++;
    if (cards + open + jokersLeft < best.cards) return; // mehr geht hier nicht mehr
    for (const m of byFirst[i]) {
      if (m.jokers > jokersLeft || m.real.some((c) => used.has(c))) continue;
      m.real.forEach((c) => used.add(c));
      chosen.push(m);
      search(i + 1, jokersLeft - m.jokers, cards + m.real.length + m.jokers, value + m.value);
      chosen.pop();
      m.real.forEach((c) => used.delete(c));
    }
    search(i + 1, jokersLeft, cards, value); // Karte i bleibt auf der Hand
  }

  search(0, jokers, 0, 0);
  return [...best.melds].sort((a, b) => b.value - a.value); // die wertvollste zuerst – die reicht oft schon zum Herauskommen
}

// Aktion für eine Figur aus bestPacking: Joker auswählen – eingetauschte zuerst, dann einer von der Ablage
// (beide darf man nicht ablegen), freie zuletzt
function meldAction(v, me, m) {
  const hand = v.hands[me];
  const free = (c) => isJoker(c) && !v.swapped.includes(c);
  const jokers = [...v.swapped.filter((j) => hand.includes(j)), ...hand.filter((c) => free(c) && c === v.taken), ...hand.filter((c) => free(c) && c !== v.taken)];
  const cards = [...m.real, ...jokers.slice(0, m.jokers)];
  return { t: 'meld', arg: { cards: arrange(cards, m.hint)?.cards ?? cards, hint: m.hint } }; // geordnet – ohne Hilfen bleibt sie so liegen
}

// Erste Figur, an die die Karte passt (Joker lieber hinten) – mit dem Ende, an das sie gehört (ohne Hilfen liegt sie dort)
function findLayoff(v, me, card) {
  for (let index = 0; index < v.melds.length; index++) {
    for (const end of isJoker(card) ? ['high', 'low'] : [null]) {
      const next = layoff(v, me, card, index, end);
      if (next) return { t: 'layoff', arg: { card, index, end: next.melds[index].low < v.melds[index].low ? 'low' : 'high' } };
    }
  }
  return null;
}

// Nach einem Tausch: lässt sich der Joker im selben Zug wieder auslegen oder anlegen?
function jokerUsable(v, me, joker) {
  const hand = v.hands[me];
  return bestPacking(hand, { keep: new Set(discardable(v, hand)), minJokers: 1 }).length > 0 || !!findLayoff(v, me, joker);
}

// Wie nützlich ist eine Karte auf der Hand? (Ansätze für Sätze und Reihen; hoch = behalten)
function keepScore(v, me, card) {
  if (isJoker(card)) return 1000;
  const hand = v.hands[me];
  const pos = (c) => (rankOf(c) === 'A' ? [1, 14] : [posOf(rankOf(c))]);
  let score = 0;
  for (const o of hand) {
    if (o === card || isJoker(o)) continue;
    if (rankOf(o) === rankOf(card) && suitOf(o) !== suitOf(card)) score += 10;
    else if (suitOf(o) === suitOf(card)) {
      const d = Math.min(...pos(o).flatMap((p) => pos(card).map((q) => Math.abs(p - q))));
      score += d === 1 ? 10 : d === 2 ? 5 : 0;
    }
  }
  // passt an eine ausliegende Figur → der Mitspieler könnte sie von der Ablage nehmen und anlegen
  if (v.opened[1 - me] && v.melds.some((m) => extend(m, card) || swapIn(m, card))) score += 15;
  return score - cardPoints(card) * (v.opened[me] ? 0.8 : 0.3); // hohe Karten kosten am Ende Punkte – vorher helfen sie beim Herauskommen
}

function chooseDiscard(v, me) {
  const options = discardable(v, v.hands[me]);
  return options.reduce((best, c) => (keepScore(v, me, c) < keepScore(v, me, best) ? c : best));
}

// Ziehen: oberste Ablagekarte, wenn sie ein Joker ist, sich anlegen lässt oder eine Figur vervollständigt, die man
// auch legen darf (sie selbst darf man danach nicht ablegen – sonst tauschen zwei Computer endlos dieselbe Karte)
function drawStep(v, me) {
  const top = v.pile.at(-1);
  if (!top) return { t: 'draw', arg: { from: 'talon' } };
  if (!v.talon && v.pile.length < 2) return { t: 'draw', arg: { from: 'pile' } }; // nichts mehr zum Mischen
  const hand = v.hands[me];
  const rules = { keep: new Set(hand), need: v.opened[me] ? 0 : OPEN_MIN };
  // Joker immer – nur nicht mit fast leerer Hand, wenn er gerade nirgends hinpasst (sonst wandert er endlos hin und her)
  const useful = (isJoker(top) && hand.length >= 4)
    || (v.opened[me] && v.melds.some((m) => extend(m, top)))
    || (v.turns >= 1 && count(bestPacking([...hand, top], rules)) > count(bestPacking(hand, rules)));
  return { t: 'draw', arg: { from: useful ? 'pile' : 'talon' } };
}

const count = (melds) => melds.reduce((n, m) => n + m.real.length + m.jokers, 0);

function playStep(v, me) {
  const hand = v.hands[me];
  if (canMeld(v, me)) {
    const keep = new Set(discardable(v, hand));
    const swapped = v.swapped.filter((j) => hand.includes(j));
    const opened = v.opened[me];
    const pack = bestPacking(hand, { need: opened ? 0 : OPEN_MIN - openPoints(v), keep, minJokers: swapped.length });
    if (pack.length) return meldAction(v, me, pack[0]);
    if (!opened) return v.fresh.length ? { t: 'undo' } : discardStep(v, me);
    for (const j of swapped) {
      const a = findLayoff(v, me, j);
      if (a) return a;
    }
    if (swapped.length) return { t: 'undo' }; // Joker lässt sich doch nicht unterbringen – Zug zurück
    const real = hand.filter((c) => !isJoker(c));
    for (const c of real) {
      const a = findLayoff(v, me, c);
      if (a) return a;
    }
    // Joker holen, wenn er sich gleich wieder unterbringen lässt (dann ist eine Handkarte weniger da)
    for (const c of real) {
      for (let index = 0; index < v.melds.length; index++) {
        const next = swap(v, me, c, index);
        if (next && jokerUsable(next, me, next.swapped.at(-1))) return { t: 'swap', arg: { card: c, index } };
      }
    }
    // eigene Joker nur anlegen, wenn danach höchstens eine Karte zum Ablegen übrig ist – dann ist die Runde gewonnen
    if (real.filter((c) => keep.has(c)).length <= 1) {
      for (const j of hand.filter(isJoker)) {
        const a = findLayoff(v, me, j);
        if (a) return a;
      }
    }
  }
  return discardStep(v, me);
}

const discardStep = (v, me) => ({ t: 'discard', arg: { card: chooseDiscard(v, me) } });

// Nächste Aktion als Nachricht wie vom Gast: { t: 'draw' | 'meld' | 'layoff' | 'swap' | 'undo' | 'discard', arg }
export function computerMove(v, me) {
  if (v.free) v = { ...v, free: false }; // er prüft nach den Regeln – ohne Hilfen ginge sonst jedes Anlegen durch
  return v.phase === 'draw' ? drawStep(v, me) : playStep(v, me);
}

// Allein ohne Hilfen (Nico 20.10.2026): statt des Ablegens ein plausibler Schummelzug – noch nicht draußen: eine Figur
// unter 30 Punkten auslegen und trotzdem ablegen; draußen: die Karte, die er sonst abgelegt hätte, an eine Figur, an die
// sie nicht passt (lieber eine derselben Farbe bzw. desselben Werts). Aktionen wie computerMove oder null (nichts möglich).
export function cheatMoves(v, me) {
  v = { ...v, free: false };
  if (!canMeld(v, me) || v.fresh.length) return null;
  const hand = v.hands[me];
  const keep = new Set(discardable(v, hand));
  if (!v.opened[me]) {
    const [m] = bestPacking(hand, { keep });
    const a = m && meldAction(v, me, m);
    const next = a && meld(v, me, a.arg.cards, a.arg.hint);
    return next?.fresh.length ? [a, discardStep(next, me)] : null;
  }
  if (keep.size < 2) return null; // danach muss noch eine Karte zum Ablegen bleiben
  const card = chooseDiscard(v, me);
  if (isJoker(card)) return null;
  const near = (m) => (m.kind === 'set' ? m.cards.some((c) => !isJoker(c) && rankOf(c) === rankOf(card)) : m.suit === suitOf(card));
  const index = v.melds.map((m, i) => i)
    .filter((i) => !['low', 'high'].some((end) => layoff(v, me, card, i, end)))
    .sort((a, b) => near(v.melds[b]) - near(v.melds[a]))[0];
  return index === undefined ? null : [{ t: 'layoff', arg: { card, index, end: 'high' } }];
}
