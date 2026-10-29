// Darts-Partie als reine Funktionen (kein DOM). Der Host hält den Stand: Jede Aktion liefert einen neuen Zustand oder
// null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer.
//
// Regeln (WDF/DDV, Steel-Darts „x01 Double Out“): Jeder startet mit 501 (oder 301) und zieht seine Punkte ab. Eine
// Aufnahme sind 3 Pfeile. Das Leg gewinnt, wer genau auf 0 kommt und mit dem letzten Pfeil ein Doppel trifft (Bull = Doppel
// 25). „Bust“ (überworfen): unter 0, genau 1 oder 0 ohne Doppel – die ganze Aufnahme zählt nicht, der Rest bleibt wie vor
// der Aufnahme, die übrigen Pfeile verfallen. Nur Pfeile, die in der Scheibe stecken, zählen.
// Eigene Festlegungen: Modus 501 oder 301, Best of 1, 3 oder 5 Legs (wählt der Host vor dem Start). Das erste Leg beginnt
// ein zufälliger Spieler, danach abwechselnd; bei der Revanche fängt der andere an. Nach jeder Aufnahme zieht der Werfer
// seine Pfeile („Pfeile ziehen“), erst dann ist der andere dran.
//
// „Ohne Hilfen“ (free): Es rechnet niemand mit – wie an der Kreidetafel trägt der Werfer beim Ziehen die Punkte seiner
// Aufnahme selbst ein (0 bei Bust). Er darf auch früher ziehen. Falsch eingetragen (zu viel oder zu wenig, falsches
// Checkout) = geschummelt. Bis der andere selbst wirft (bzw. „Nächstes Leg“ oder Revanche drückt) kann er „Geschummelt!“
// rufen: Stimmt es, zählt die Aufnahme 0 (ein falsches Checkout wird zurückgenommen) und der Schummler hat in seiner
// nächsten Aufnahme einen Pfeil weniger. Fehlalarm: Der Ankläger hat in seiner nächsten Aufnahme (das ist die, die er
// gleich beginnt) einen Pfeil weniger. Strafen zählen zusammen, mindestens 1 Pfeil bleibt.
import { scoreAt, RING, HANG } from './rules.js';
import { rematchBlocked } from '../schummeln.js';

export const MODES = [501, 301];
export const LEGS = [1, 3, 5]; // Best of
export const DARTS = 3;
export const MAX_VISIT = 180;
const HISTORY = 6;
const ON = ['board', 'surround', 'floor'];
const isPlayer = (p) => p === 0 || p === 1;

// starter = wer das erste Leg beginnt
export function newGame({ free = false, mode = 501, bestOf = 3, starter = 0, wins = [0, 0], round = 0, seq = 0, phase = 'setup' } = {}) {
  const s = {
    seq,
    round, // Nummer der Partie (Revanche zählt hoch)
    wins, // gewonnene Partien bisher
    phase, // setup → play → over (ohne Hilfen auch legover: Checkout eingetragen, der andere bestätigt mit „Nächstes Leg“)
    mode,
    bestOf,
    starter,
    legStarter: starter,
    turn: starter,
    rest: [mode, mode],
    legs: [0, 0],
    visitStart: mode, // Rest des Werfers vor dieser Aufnahme
    darts: [], // Pfeile dieser Aufnahme: { p: [x, y, z], d: [dx, dy, dz], on, hit: { label, points, double } }
    done: null, // Aufnahme fertig, Pfeile ziehen: null | 'bust' | 'checkout' | 'full'
    stats: [{ darts: 0, points: 0 }, { darts: 0, points: 0 }], // für den 3-Dart-Schnitt dieser Partie
    history: [], // letzte Aufnahmen (neueste zuerst): { player, points, bust, labels }
    winner: null,
    free,
    events: [{ type: phase === 'setup' ? 'setup' : 'start' }],
  };
  return free ? { ...s, short: [0, 0], cheat: null, verdict: null } : s;
}

// Host wählt Modus und Länge, dann geht es los
export function setup(s, by, { mode, bestOf } = {}) {
  if (s.phase !== 'setup' || by !== 0 || !MODES.includes(mode) || !LEGS.includes(bestOf)) return null;
  return newGame({ free: s.free, mode, bestOf, starter: s.starter, wins: s.wins, round: s.round + 1, seq: s.seq + 1, phase: 'play' });
}

export const legsToWin = (s) => (s.bestOf + 1) / 2;
export const dartsAllowed = (s, p) => DARTS - (s.free ? s.short[p] : 0);
const canThrow = (s, p) => s.phase === 'play' && s.turn === p && !s.done && s.darts.length < dartsAllowed(s, p);

// Meldung des werfenden PCs prüfen: Lage der Spitze (physics.js: x rechts, y ab Boden, z vor der Scheibe) und Richtung
function cleanDart(report) {
  const { p, d, on } = report ?? {};
  const nums = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  if (!nums(p) || !nums(d) || !ON.includes(on) || p.some((v) => Math.abs(v) > 4)) return null;
  const r = Math.hypot(p[0], p[1] - HANG.bull);
  if (on === 'board' && (r > RING.edge + 0.002 || Math.abs(p[2]) > 0.01)) return null;
  const round = (a) => a.map((v) => Math.round(v * 100000) / 100000);
  const q = round(p);
  const hit = on === 'board' ? scoreAt(q[0], q[1] - HANG.bull) : { label: 'Miss', points: 0, double: false };
  return { p: q, d: round(d), on, hit };
}

// Wertung einer Aufnahme nach den Regeln: { points, bust, checkout }
export function judgeVisit(start, darts) {
  let rest = start;
  for (const { hit } of darts) {
    rest -= hit.points;
    if (rest < 0 || rest === 1 || (rest === 0 && !hit.double)) return { points: 0, bust: true, checkout: false };
    if (rest === 0) return { points: start, bust: false, checkout: true };
  }
  return { points: start - rest, bust: false, checkout: false };
}

// Ein Pfeil ist geflogen (report vom Werfer)
export function throwDart(s, by, report) {
  if (!canThrow(s, by)) return null;
  const dart = cleanDart(report);
  if (!dart) return null;
  const darts = [...s.darts, dart];
  const base = { ...s, darts, seq: s.seq + 1, events: [{ type: 'dart', player: by, label: dart.hit.label }] };
  if (s.free) {
    // ohne Hilfen rechnet niemand: der Wurf des anderen beendet nur die Frist für „Geschummelt!“
    return { ...base, cheat: s.cheat && s.cheat.player !== by ? null : s.cheat, verdict: null };
  }
  const v = judgeVisit(s.visitStart, darts);
  const rest = s.rest.map((r, p) => (p === by ? (v.bust ? s.visitStart : s.visitStart - v.points) : r));
  if (v.checkout) {
    const legs = s.legs.map((l, p) => (p === by ? l + 1 : l));
    const won = legs[by] >= legsToWin(s);
    if (!won) return { ...base, rest, legs, done: 'checkout' };
    // Partie gewonnen: die Siegeraufnahme gleich buchen (gezogen wird am Ende nicht mehr, die Pfeile bleiben stecken)
    return { ...base, ...booked(base, by, v.points, false), rest, legs, done: 'checkout', phase: 'over', winner: by, wins: s.wins.map((w, p) => (p === by ? w + 1 : w)) };
  }
  return { ...base, rest, done: v.bust ? 'bust' : darts.length >= DARTS ? 'full' : null };
}

// Statistik und Verlauf nach einer Aufnahme (ohne Hilfen ohne die echten Felder – die soll man selbst ablesen)
function booked(s, by, points, bust) {
  const stats = s.stats.map((x, p) => (p === by ? { darts: x.darts + s.darts.length, points: x.points + points } : x));
  const history = [{ player: by, points, bust, labels: s.free ? [] : s.darts.map((d) => d.hit.label) }, ...s.history].slice(0, HISTORY);
  return { stats, history };
}

// Neues Leg (oder Ende): Reste zurück, der andere beginnt
function nextLeg(s) {
  const legStarter = 1 - s.legStarter;
  return { ...s, phase: 'play', rest: [s.mode, s.mode], legStarter, turn: legStarter, visitStart: s.mode, darts: [], done: null, events: [{ type: 'leg', starter: legStarter }] };
}

// Pfeile ziehen = Aufnahme beenden. claim = ohne Hilfen die selbst eingetragenen Punkte (0–180, höchstens der Rest und
// nie Rest 1 – überworfen trägt man 0 ein). Am Partie-Ende wird nicht mehr gezogen.
export function pull(s, by, claim) {
  if (!isPlayer(by) || s.turn !== by || s.phase !== 'play' || !s.darts.length) return null;
  if (s.free) return pullFree(s, by, claim);
  if (!s.done) return null;
  const v = judgeVisit(s.visitStart, s.darts);
  const next = { ...s, ...booked(s, by, v.points, v.bust), seq: s.seq + 1 };
  if (s.done === 'checkout') return nextLeg(next);
  const other = 1 - by;
  return { ...next, darts: [], done: null, turn: other, visitStart: s.rest[other], events: [{ type: 'pull', player: by }] };
}

// Ohne Hilfen: eingetragen wird, was der Werfer sagt. Ob es stimmt, weiß nur der Host (cheat.legal).
function pullFree(s, by, claim) {
  const rest = s.rest[by];
  if (!Number.isInteger(claim) || claim < 0 || claim > MAX_VISIT || rest - claim < 0 || rest - claim === 1) return null;
  const truth = judgeVisit(s.visitStart, s.darts);
  const legal = claim === truth.points;
  const why = legal ? '' : claim === rest ? `kein gültiges Checkout (${truth.bust ? 'überworfen' : `geworfen ${truth.points}`})`
    : truth.checkout ? `Checkout nicht eingetragen (${claim} statt ${truth.points})`
      : truth.bust ? `überworfen, trotzdem ${claim} eingetragen` : `${claim} eingetragen, geworfen ${truth.points}`;
  const before = { ...s, darts: [], done: null, cheat: null, verdict: null }; // so war es vor dem Eintrag (für „erwischt“)
  const rests = s.rest.map((r, p) => (p === by ? r - claim : r));
  const short = s.short.map((n, p) => (p === by ? 0 : n));
  const next = {
    ...s, ...booked(s, by, claim, claim === 0), rest: rests, short, darts: [], done: null, seq: s.seq + 1,
    cheat: { player: by, legal, why, claim, before }, verdict: null, events: [{ type: 'claim', player: by, points: claim }],
  };
  const other = 1 - by;
  if (rests[by] !== 0) return { ...next, turn: other, visitStart: s.rest[other] };
  const legs = s.legs.map((l, p) => (p === by ? l + 1 : l));
  if (legs[by] >= legsToWin(s)) return { ...next, legs, phase: 'over', winner: by, wins: s.wins.map((w, p) => (p === by ? w + 1 : w)) };
  return { ...next, legs, phase: 'legover' }; // der andere startet das nächste Leg (oder ruft „Geschummelt!“)
}

// Ohne Hilfen nach einem eingetragenen Checkout: der andere startet das nächste Leg
export function nextLegFree(s, by) {
  if (!s.free || s.phase !== 'legover' || s.turn === by || !isPlayer(by)) return null;
  return nextLeg({ ...s, cheat: null, verdict: null, seq: s.seq + 1 });
}

// „Geschummelt!“ – gegen den letzten Eintrag des anderen
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !isPlayer(by)) return null;
  const cap = (n) => Math.min(n + 1, DARTS - 1);
  const verdict = { by, player: c.player, caught: !c.legal, why: c.why };
  if (c.legal) { // Fehlalarm: Ankläger hat nächstes Mal einen Pfeil weniger; nach einem Checkout geht es gleich ins nächste Leg
    const next = { ...s, short: s.short.map((n, p) => (p === by ? cap(n) : n)), cheat: null, verdict, seq: s.seq + 1, events: [{ type: 'fehlalarm', ...verdict }] };
    return s.phase === 'legover' ? { ...nextLeg(next), events: next.events } : next;
  }
  // Erwischt: Stand von vor dem Eintrag, die Aufnahme zählt 0, dann ist der Ankläger dran
  const b = c.before;
  const stats = s.stats.map((x, p) => (p === c.player ? { ...x, points: x.points - c.claim } : x));
  const history = s.history.map((h, i) => (i === 0 && h.player === c.player ? { ...h, points: 0, bust: true, caught: true } : h));
  return {
    ...b, stats, history, turn: by, visitStart: b.rest[by], short: s.short.map((n, p) => (p === c.player ? cap(n) : n)),
    cheat: null, verdict, seq: s.seq + 1, events: [{ type: 'caught', ...verdict }],
  };
}

// Computer (allein) lässt den Eintrag des Menschen gelten – Frist vorbei
export function waive(s, by) {
  if (!s.free || !s.cheat || s.cheat.player === by || !isPlayer(by)) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Revanche: gleiche Einstellungen, der andere fängt an. Host darf stattdessen neu einstellen (regroup).
export function again(s, by) {
  if (s.phase !== 'over' || !isPlayer(by) || rematchBlocked(s, by)) return null;
  return newGame({ free: s.free, mode: s.mode, bestOf: s.bestOf, starter: 1 - s.starter, wins: s.wins, round: s.round + 1, seq: s.seq + 1, phase: 'play' });
}
export function regroup(s, by) {
  if (s.phase !== 'over' || by !== 0 || rematchBlocked(s, by)) return null;
  return newGame({ free: s.free, mode: s.mode, bestOf: s.bestOf, starter: 1 - s.starter, wins: s.wins, round: s.round, seq: s.seq + 1 });
}

// 3-Dart-Schnitt
export const average = (s, p) => (s.stats[p].darts ? (s.stats[p].points / s.stats[p].darts) * 3 : 0);

// Gast-Sicht: Ob ein Eintrag stimmt (und was wirklich getroffen wurde), weiß ohne Hilfen nur der Host
export function forGuest(s) {
  if (!s.free) return s;
  return { ...s, darts: s.darts.map(({ hit, ...d }) => d), cheat: s.cheat && { player: s.cheat.player } };
}
