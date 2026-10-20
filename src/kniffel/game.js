// Spielablauf als reine Funktionen. Der Host hält den Spielstand: Jede Aktion liefert einen
// neuen Zustand oder null (ungültig, z. B. nicht dran). Spieler 0 = Host, 1 = Gast.
//
// „Ohne Hilfen“ (free): Man trägt die Punkte selbst ein und darf auch öfter als dreimal würfeln.
// Bis zum ersten Wurf des anderen kann der „Geschummelt!“ rufen (accuse): Stimmt es (falsche Punkte, mehr als
// 3 Würfe oder falsch angesagter Zusatz-Kniffel), wird das Feld mit 0 gestrichen und ein angesagter Zusatz-Kniffel
// fällt weg; sonst bekommt der Ankläger 10 Minuspunkte.
import { FIELDS, isJoker, scoreOptions, totals } from './rules.js';

export const ROLLS_PER_TURN = 3;
export const MAX_CLAIM = 99; // höchste Zahl, die man ohne Hilfen eintragen kann
export const FALSE_ALARM_POINTS = 10;

export function newGame(starter = 0, { free = false } = {}) {
  return {
    starter,
    turn: starter,
    rolls: 0, // Würfe im aktuellen Zug
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    cards: [{}, {}], // Feld → Punkte
    extra: [0, 0], // Anzahl Zusatz-Kniffel
    penalty: [0, 0], // Minuspunkte für Fehlalarme
    over: false,
    free, // ohne Hilfen: Schummeln möglich
    cheat: null, // letzter Eintrag, solange man ihn anprangern kann: { player, legal, field, extra }
    verdict: null, // Ergebnis der letzten Anklage – für die Anzeige
  };
}

export function canRoll(s, player) {
  return !s.over && s.turn === player && (s.free || s.rolls < ROLLS_PER_TURN) && !s.held.every(Boolean);
}

export function canHold(s, player) {
  return !s.over && s.turn === player && s.rolls > 0 && (s.free || s.rolls < ROLLS_PER_TURN);
}

export function toggleHold(s, player, i) {
  if (!canHold(s, player) || !(i >= 0 && i < 5)) return null;
  const held = s.held.map((h, k) => (k === i ? !h : h));
  return { ...s, held, cheat: null, verdict: null };
}

// values = Ergebnis der Physik beim werfenden Spieler; behaltene Würfel bleiben unverändert
export function applyRoll(s, player, values) {
  if (!canRoll(s, player) || !isDiceList(values)) return null;
  const dice = s.dice.map((d, i) => (s.held[i] ? d : values[i]));
  return { ...s, dice, rolls: s.rolls + 1, cheat: null, verdict: null };
}

// claim = ohne Hilfen die selbst eingetragenen Punkte; mit Hilfen rechnet das Spiel
// said = ohne Hilfen selbst angesagter Zusatz-Kniffel (+50): falsch angesagt = Schummeln, vergessen = eigener Verlust
export function scoreField(s, player, field, claim, said = false) {
  const card = s.cards[player];
  if (s.over || s.turn !== player || s.rolls === 0 || !FIELDS.includes(field) || card[field] !== undefined) return null;
  if (s.free && !(Number.isInteger(claim) && claim >= 0 && claim <= MAX_CLAIM)) return null;
  if (typeof said !== 'boolean') return null;
  const correct = scoreOptions(s.dice, card)[field];
  const points = s.free ? claim : correct;
  const joker = isJoker(s.dice, card);
  const credit = s.free ? said : joker; // Zusatz-Kniffel, der gutgeschrieben wird
  const cards = s.cards.map((c, p) => (p === player ? { ...c, [field]: points } : c));
  const extra = s.extra.map((n, p) => (p === player && credit ? n + 1 : n));
  const over = cards.every((c) => FIELDS.every((f) => c[f] !== undefined));
  const legal = points === correct && s.rolls <= ROLLS_PER_TURN && (!said || joker);
  return {
    ...s,
    cards,
    extra,
    over,
    turn: over ? s.turn : 1 - s.turn,
    rolls: 0,
    held: [false, false, false, false, false],
    cheat: s.free ? { player, legal, field, extra: credit } : null,
    verdict: null,
  };
}

// „Geschummelt!“ – nur gegen den letzten Eintrag des anderen, bevor danach gewürfelt wurde.
export function accuse(s, player) {
  const c = s.cheat;
  if (!s.free || !c || c.player === player || (player !== 0 && player !== 1)) return null;
  if (!c.legal) {
    const cards = s.cards.map((card, p) => (p === c.player ? { ...card, [c.field]: 0 } : card));
    const extra = s.extra.map((n, p) => (p === c.player && c.extra ? n - 1 : n));
    return { ...s, cards, extra, cheat: null, verdict: { caught: true, player: c.player, by: player, field: c.field, ...(c.extra && { extra: true }) } };
  }
  const penalty = s.penalty.map((n, p) => (p === player ? n + FALSE_ALARM_POINTS : n));
  return { ...s, penalty, cheat: null, verdict: { caught: false, player, by: player } };
}

export function scores(s) {
  return s.cards.map((card, p) => totals(card, s.extra[p]).total - (s.penalty?.[p] ?? 0));
}

// Gewinner: 0 oder 1, bei Gleichstand null
export function winner(s) {
  const [a, b] = scores(s);
  return a === b ? null : a > b ? 0 : 1;
}

function isDiceList(values) {
  return Array.isArray(values) && values.length === 5 && values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6);
}
