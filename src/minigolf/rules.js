// Minigolf als reine Funktionen. Der Host hält den Spielstand; die Physik rechnet der schlagende PC und meldet das
// Ergebnis (report). Spieler 0 = Host, 1 = Gast bzw. Computer.
//
// Regeln nach den Internationalen Spielregeln (IntSpR 2.1, Stand 01/2026, WMF/ÖBGV), für zwei Hobbyspieler vereinfacht:
// - 9 Bahnen, jede wird vom Abschlag aus gespielt. Wer dran ist, spielt die Bahn ganz zu Ende (IntSpR 11.2: erst wenn der
//   Vorspieler fertig ist), dann der andere. Wer auf einer Bahn anfängt, wechselt von Bahn zu Bahn.
// - Jeder Schlag zählt einen Punkt. Ist der Ball nach dem 6. Schlag nicht im Loch, wird ein weiterer Punkt angerechnet:
//   höchstens 7 je Bahn (IntSpR 9.1).
// - Verlässt der Ball die Bahn (über die Bande, in den Graben, vom Steg), kommt er an die Stelle zurück, von der er
//   geschlagen wurde, und es gibt einen Strafschlag (Festlegung für Nico; IntSpR 8.8 setzt ihn ohne Strafe dort ein,
//   wo er die Bahn verlassen hat).
// - Sieger: die wenigsten Schläge über alle 9 Bahnen, gleich viele = unentschieden.
// „Ohne Hilfen“ (free): Die Schläge einer Bahn trägt man selbst ein (auch falsch), und der Ball lässt sich vor dem Schlag
// verlegen. Erlaubt ist das nur wie beim echten Ablegen (IntSpR 8.8: Ablegen an der Bahnbegrenzung): einmal je Schlag,
// höchstens 20 cm, nur wenn er an einer Bande liegt (Hindernisse zählen nicht), und gerade von ihr weg.
// Der andere kann „Geschummelt!“ rufen, bis er selbst etwas tut:
// erwischt = Eintrag berichtigt und 2 Strafschläge, Fehlalarm = 1 Strafschlag für den Rufer.
import { COURSE, HOLES, MAX_STROKES, FLOOR, R, inLane, wallGap } from './course.js';
import { rematchBlocked } from '../schummeln.js';

export const CAUGHT_PENALTY = 2;
export const FALSE_ALARM_PENALTY = 1;
export const MOVE_MAX = 0.2; // Ablegen: höchstens so weit (m)
export const MOVE_WALL = 0.03; // … und nur, wenn der Ball so nah (Luft zwischen Ball und Bande) an der Bande liegt
export const MOVE_AWAY = 0.8; // … gerade von der Bande weg: der Abstand zur Bande wächst um mindestens 80 % des Wegs
export const MAX_SCORE = MAX_STROKES + 1;

const other = (p) => 1 - p;
const firstOf = (starter, hole) => (hole % 2 === 0 ? starter : other(starter));

export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  const s = {
    hole: 0, // Bahn 0–8
    starter, // fängt auf Bahn 1 an, dann abwechselnd
    turn: starter,
    count: 0, // Schläge (mit Strafschlägen) des Spielers am Zug auf dieser Bahn
    ball: null, // Ballmitte [x, y, z] im Bezug der Anlage, null = am Abschlag
    scores: [Array(HOLES).fill(null), Array(HOLES).fill(null)],
    penalty: [0, 0], // Strafschläge fürs Schummeln (zählen zur Summe)
    phase: 'play', // play | claim (ohne Hilfen: Schläge selbst eintragen)
    claim: null, // { player, truth }
    result: null, // { winner: 0 | 1 | null }
    wins,
    round,
    seq: 0,
    events: [{ type: 'start' }],
  };
  return free ? { ...s, free: true, cheat: null, verdict: null } : s;
}

// Summe eines Spielers (eingetragene Bahnen + Strafschläge)
export const total = (s, p) => s.scores[p].reduce((a, n) => a + (n ?? 0), 0) + s.penalty[p];

// Wo der Ball des Spielers am Zug liegt (Ballmitte)
export function ballOf(s) {
  if (s.ball) return s.ball;
  const [x, , z] = COURSE[s.hole].tee;
  return [x, FLOOR + R, z];
}

const finite = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
// Ruhelage auf der Bahn: innerhalb des Umrisses, auf Höhe einer Bahnfläche (Plateau, Steg, Kegel bis 15 cm)
export const onLane = (hole, p) => finite(p) && inLane(COURSE[hole], [p[0], p[2]]) && p[1] >= FLOOR + R - 0.01 && p[1] <= FLOOR + R + 0.16;

function validReport(s, r) {
  if (!r || typeof r !== 'object' || typeof r.holed !== 'boolean' || typeof r.out !== 'boolean' || (r.holed && r.out)) return false;
  return r.holed || r.out || onLane(s.hole, r.pos);
}

// Ohne Hilfen: Tut der andere selbst etwas, kann er den letzten Schummelzug nicht mehr anprangern
const waived = (s, by) => (s.free && s.cheat && s.cheat.player !== by ? { cheat: null } : {});

// Ein Schlag: report = { holed, out, pos } (pos = Ruhelage der Ballmitte)
export function applyShot(s, player, report) {
  if (s.result || s.phase !== 'play' || s.turn !== player || !validReport(s, report)) return null;
  const count = s.count + 1 + (report.out ? 1 : 0); // draußen: Strafschlag, Ball zurück an die Schlagstelle
  const base = { ...s, ...waived(s, player), ...(s.free ? { moved: false } : {}), seq: s.seq + 1, events: [{ type: 'shot', by: player, hole: s.hole, count, holed: report.holed, out: report.out }] };
  if (report.holed) return endHole(base, player, count);
  if (count >= MAX_STROKES) return endHole(base, player, MAX_SCORE);
  return { ...base, count, ball: report.out ? s.ball : report.pos.map((x) => Math.round(x * 10000) / 10000) };
}

// Bahn für den Spieler fertig: mit Hilfen gleich eintragen, ohne Hilfen trägt er selbst ein
function endHole(s, player, truth) {
  if (s.free) return { ...s, count: truth, phase: 'claim', claim: { player, truth } };
  return advance(s, player, truth);
}

// Ergebnis eintragen, dann der andere oder die nächste Bahn
function advance(s, player, value) {
  const scores = s.scores.map((row, p) => (p === player ? row.map((n, h) => (h === s.hole ? value : n)) : row));
  const next = { ...s, scores, count: 0, ball: null, phase: 'play', claim: null };
  if (scores[other(player)][s.hole] === null) return { ...next, turn: other(player) };
  if (s.hole + 1 < HOLES) {
    const hole = s.hole + 1;
    return { ...next, hole, turn: firstOf(s.starter, hole), events: [...s.events, { type: 'hole', hole }] };
  }
  return finished(next);
}

function finished(s) {
  const [a, b] = [total(s, 0), total(s, 1)];
  const winner = a === b ? null : a < b ? 0 : 1;
  const old = s.result?.winner;
  const wins = s.wins.map((w, p) => w - (old === p ? 1 : 0) + (winner === p ? 1 : 0));
  return { ...s, result: { winner }, wins };
}

// Ohne Hilfen: eigene Schläge der Bahn eintragen (1–7)
export function applyClaim(s, player, n) {
  if (!s.free || s.phase !== 'claim' || s.claim?.player !== player || !Number.isInteger(n) || n < 1 || n > MAX_SCORE) return null;
  const { truth } = s.claim;
  const why = n === truth ? null : `${n} statt ${truth} Schläge auf Bahn ${s.hole + 1} eingetragen`;
  const fix = n === truth ? null : { hole: s.hole, truth };
  const marked = { ...s, cheat: record(s, player, why, fix), seq: s.seq + 1, events: [{ type: 'claim', by: player, hole: s.hole, n }] };
  return advance(marked, player, n);
}

// Ohne Hilfen: Ball vor dem Schlag verlegen (pos = neue Ballmitte)
// Erlaubt ist nur das Ablegen: einmal je Lage (bis zum nächsten Schlag), höchstens 20 cm, der Ball lag an der Bande
// (Hindernisse zählen nicht) und kommt gerade von ihr weg – sonst ließe er sich Stück für Stück an der Bande entlangschieben.
export function applyMove(s, player, pos) {
  if (!s.free || s.result || s.phase !== 'play' || s.turn !== player || !onLane(s.hole, pos)) return null;
  const from = ballOf(s);
  const dist = Math.hypot(pos[0] - from[0], pos[2] - from[2]);
  if (dist < 0.005) return null;
  const hole = COURSE[s.hole];
  const gap = wallGap(hole, [from[0], from[2]]) - R;
  const away = wallGap(hole, [pos[0], pos[2]]) - R - gap;
  const cm = Math.round(dist * 100);
  const why = s.moved ? `Ball vor demselben Schlag noch einmal verlegt (${cm} cm)`
    : dist > MOVE_MAX ? `Ball um ${cm} cm verlegt`
      : gap > MOVE_WALL ? `Ball um ${cm} cm verlegt (lag nicht an der Bande)`
        : away < MOVE_AWAY * dist ? `Ball um ${cm} cm verlegt (nicht gerade von der Bande weg)` : null;
  return { ...s, ball: pos.map((x) => Math.round(x * 10000) / 10000), moved: true, cheat: record(s, player, why, null), seq: s.seq + 1, events: [{ type: 'move', by: player }] };
}

// Schummelzüge seit dem letzten Zug des anderen sammeln (why = versteckter Grund, nur beim Host – forGuest entfernt ihn)
function record(s, by, why, fix) {
  const c = s.cheat?.player === by ? s.cheat : null;
  return {
    player: by,
    legal: (c?.legal ?? true) && !why,
    last: !why, // nur der neueste Zug (allein prüft der Computer jeden Zug einmal – nicht die alten nochmal)
    why: [...(c?.why ?? []), ...(why ? [why] : [])],
    fixes: [...(c?.fixes ?? []), ...(fix ? [fix] : [])],
  };
}

// „Geschummelt!“: by klagt den anderen an
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1)) return null;
  const caught = !c.legal;
  const guilty = caught ? c.player : by;
  let scores = s.scores;
  for (const { hole, truth } of caught ? c.fixes : []) scores = scores.map((row, p) => (p === c.player ? row.map((n, h) => (h === hole ? truth : n)) : row));
  const penalty = s.penalty.map((n, p) => (p === guilty ? n + (caught ? CAUGHT_PENALTY : FALSE_ALARM_PENALTY) : n));
  // gleiche Gründe zusammenfassen (z. B. 13-mal hintereinander verlegt), sonst wird die Meldung endlos
  const count = new Map();
  for (const w of c.why) count.set(w, (count.get(w) ?? 0) + 1);
  const why = [...count].map(([w, n]) => (n > 1 ? `${w} (${n}-mal)` : w)).join(', ');
  const verdict = { caught, player: guilty, by, why: caught ? why : '', fixed: caught && c.fixes.length > 0 };
  const next = { ...s, scores, penalty, cheat: null, verdict, seq: s.seq + 1, events: [{ type: caught ? 'caught' : 'fehlalarm', ...verdict }] };
  return s.result ? finished(next) : next;
}

// Der andere lässt den letzten Zug gelten (allein: Computer hat geprüft und nichts gesagt)
export function waive(s, by) {
  if (!s.free || !s.cheat || s.cheat.player === by) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Revanche: der andere fängt an, die Siege laufen weiter
export function again(s, by) {
  if (!s.result || rematchBlocked(s, by)) return null;
  return newGame({ starter: other(s.starter), free: !!s.free, wins: s.wins, round: s.round + 1 });
}

// Was der Gast sehen darf: beim Schummeln nur, wer zuletzt etwas getan hat
export const forGuest = (s) => (s.free && s.cheat ? { ...s, cheat: { player: s.cheat.player } } : s);
