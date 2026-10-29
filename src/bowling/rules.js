// Bowling (10 Pins) als reine Funktionen (kein DOM, kein three.js). Der Host hält den Spielstand: Jede Aktion liefert
// einen neuen Zustand oder null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer. Zu zweit abwechselnd je ein Frame.
// Regeln nach USBC/World Bowling: 10 Frames, je Frame bis zu 2 Würfe; Strike (alle 10 mit dem 1. Wurf) = 10 + die
// nächsten zwei Würfe, Spare (Rest mit dem 2. Wurf) = 10 + der nächste Wurf; im 10. Frame nach Strike oder Spare
// bis zu 3 Würfe. Foul (übertreten): Der Wurf zählt, aber keine Pins; was er umwarf, wird wieder aufgestellt.
// Kugel in der Rinne, bevor sie die Pins erreicht: ebenso keine Pins (illegaler Pinfall).
//
// „Ohne Hilfen“ (free): Die Anlage zählt nicht und der Foul-Melder ist aus – der Werfer trägt jeden Wurf selbst ein
// (Pins oder „F“). Falsch eingetragen (z. B. mehr Pins, oder trotz Übertreten Pins statt F) ist Schummeln. Bis der
// andere seinen nächsten Wurf macht, kann er „Geschummelt!“ rufen: erwischt = der ganze Frame zählt 0 (und ist vorbei),
// Fehlalarm = der Rufer bekommt 10 Minuspunkte.
import { rematchBlocked } from '../schummeln.js';

// Maße in Metern (USBC-Spezifikation): Foul-Linie bis Mitte Kegel 1 = 60 ft, Bahnbreite 41,5 in, Rinne 9,25 in,
// Anlauf mindestens 15 ft, Pin 15 in hoch und bis 4,766 in dick, Pin-Abstand 12 in, Kugel bis 8,595 in Durchmesser
export const LANE = { length: 18.288, width: 1.0541, gutter: 0.235, approach: 4.572, boards: 39 };
export const PIN = { h: 0.381, r: 0.0605, mass: 1.55 };
export const BALL = { r: 0.1092, mass: 6.8 }; // 15 Pfund
export const BOARD = LANE.width / LANE.boards;
export const FRAMES = 10;
export const FALSE_ALARM_POINTS = 10;
const SPACING = 0.3048;
const ROW = SPACING * Math.sqrt(3) / 2;

// Pin-Plätze [x, z]: x quer (0 = Bahnmitte, + = rechts vom Werfer aus), z längs (Foul-Linie 0, Pins bei −18,3 m)
// Reihenfolge = Pin-Nummer 1–10: 1 vorn, dann 2 3, 4 5 6, 7 8 9 10 (von links nach rechts)
export const SPOTS = [[0, 0], [-0.5, 1], [0.5, 1], [-1, 2], [0, 2], [1, 2], [-1.5, 3], [-0.5, 3], [0.5, 3], [1.5, 3]]
  .map(([col, row]) => [Math.round(col * SPACING * 1e4) / 1e4, Math.round((-LANE.length - row * ROW) * 1e4) / 1e4]);
export const fullRack = () => SPOTS.map((p) => [...p]);

// rolls = eingetragene Würfe eines Spielers: { n: Pins, f: true bei Foul }
export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  const s = {
    starter, turn: starter, rolls: [[], []], pins: fullRack(), penalty: [0, 0],
    result: null, wins: [...wins], round, seq: 0, last: null, events: [{ type: 'start' }],
  };
  return free ? { ...s, free: true, cheat: null, verdict: null } : s;
}

// Würfe in Frames aufteilen: [{ rolls: [Würfe], total: laufende Summe oder null (Bonus steht noch aus) }]
export function framesOf(rolls) {
  const frames = [];
  let i = 0;
  let sum = 0;
  for (let f = 0; f < FRAMES && i < rolls.length; f++) {
    const a = rolls[i];
    const b = rolls[i + 1];
    let take;
    if (f < FRAMES - 1) take = a.n === 10 ? 1 : 2;
    else take = a.n === 10 || (b && a.n + b.n === 10) ? 3 : 2;
    const own = rolls.slice(i, i + take);
    const pins = own.reduce((t, r) => t + r.n, 0);
    // Bonus: Strike zählt die nächsten zwei, Spare den nächsten Wurf (im 10. Frame liegen sie im Frame selbst)
    const need = f < FRAMES - 1 ? (a.n === 10 ? 2 : b && a.n + b.n === 10 ? 1 : 0) : 0;
    const bonus = rolls.slice(i + own.length, i + own.length + need);
    const complete = own.length === take && bonus.length === need;
    sum += pins + bonus.reduce((t, r) => t + r.n, 0);
    frames.push({ rolls: own, total: complete ? sum : null });
    i += own.length;
  }
  return frames;
}

// Wo steht ein Spieler? frame (0–9), ball (0–2), left = so viele Pins stehen laut Eintrag, done = alle 10 Frames fertig
export function position(rolls) {
  const frames = framesOf(rolls);
  const last = frames.at(-1);
  const closed = (fr, f) => fr.rolls.length === (f < FRAMES - 1 ? (fr.rolls[0].n === 10 ? 1 : 2) : fr.rolls[0].n === 10 || (fr.rolls[1] && fr.rolls[0].n + fr.rolls[1].n === 10) ? 3 : 2);
  if (!last) return { frame: 0, ball: 0, left: 10, done: false };
  const f = frames.length - 1;
  if (closed(last, f)) return f === FRAMES - 1 ? { frame: f, ball: 0, left: 0, done: true } : { frame: f + 1, ball: 0, left: 10, done: false };
  const [a, b] = last.rolls;
  if (f < FRAMES - 1 || last.rolls.length === 1) return { frame: f, ball: last.rolls.length, left: a.n === 10 ? 10 : 10 - a.n, done: false };
  // 10. Frame, 3. Wurf: nach Strike + Strike oder Spare frisch aufgestellt, nach Strike + Rest der Rest
  return { frame: f, ball: 2, left: a.n === 10 && b.n !== 10 ? 10 - b.n : 10, done: false };
}

// Punkte (ohne die noch offenen Boni) abzüglich Fehlalarme
export function totalOf(s, p) {
  const frames = framesOf(s.rolls[p]);
  const done = frames.filter((fr) => fr.total !== null).at(-1);
  return (done?.total ?? 0) - (s.penalty?.[p] ?? 0);
}

export const isOver = (s) => s.rolls.every((r) => position(r).done);

function finished(s) {
  if (!isOver(s)) return null;
  const [a, b] = [totalOf(s, 0), totalOf(s, 1)];
  return { winner: a === b ? null : a > b ? 0 : 1 };
}

// Lagen der stehenden Pins prüfen: Array mit 10 Einträgen, null = liegt, [x, z] = steht (auf dem Pin-Deck)
const onDeck = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) < 0.6 && p[1] < -17.9 && p[1] > -19.3;
const isPins = (list, before) => Array.isArray(list) && list.length === 10 && list.every((p, i) => (p === null ? true : before[i] !== null && onDeck(p)));

// Wurf eintragen. report = Ergebnis der Physik beim Werfer: { pins: Lagen danach, foul, gutter }.
// claim (nur ohne Hilfen) = selbst eingetragen: Pins 0–left oder 'F'
export function throwBall(s, player, report, claim) {
  if (s.result || player !== s.turn || !report || typeof report !== 'object') return null;
  const { pins, foul = false, gutter = false } = report;
  if (!isPins(pins, s.pins) || typeof foul !== 'boolean' || typeof gutter !== 'boolean') return null;
  const at = position(s.rolls[player]);
  const down = s.pins.filter((p, i) => p !== null && pins[i] === null).length;
  const truth = foul ? 'F' : Math.min(gutter ? 0 : down, at.left);
  if (s.free && !(claim === 'F' || (Number.isInteger(claim) && claim >= 0 && claim <= at.left))) return null;
  const said = s.free ? claim : truth;
  const entry = said === 'F' ? { n: 0, f: true } : { n: said };
  const rolls = s.rolls.map((r, p) => (p === player ? [...r, entry] : r));
  const after = position(rolls[player]);
  const closed = after.frame !== at.frame || after.done;
  const turn = closed && !position(rolls[1 - player]).done ? 1 - player : player;
  // Nächste Aufstellung: neuer Frame, Strike oder Spare im 10. = alle 10; Foul/Rinne = was vorher stand; sonst was steht.
  // Ohne Hilfen weiß die Anlage nichts vom Foul (Melder aus): Sie stellt nur nach einem eingetragenen „F“ wieder auf –
  // sonst verriete das Wiederaufstellen jedes verschwiegene Übertreten
  const respot = s.free ? said === 'F' : foul || gutter;
  const next = closed || after.left === 10 ? fullRack() : respot ? s.pins : pins;
  const sign = marks(framesOf(rolls[player])[at.frame], at.frame)[at.ball];
  // ohne Hilfen keine Rinnen-Angabe: sie stammt aus der Physik und verriete einen falschen Eintrag
  const last = { player, frame: at.frame, ball: at.ball, n: entry.n, f: !!entry.f, gutter: !s.free && gutter, mark: sign === 'X' || sign === '/' ? sign : null };
  let out = { ...s, rolls, turn, pins: next.map((p) => (p ? [...p] : null)), last, seq: s.seq + 1, events: [{ type: 'throw', ...last }] };
  out.result = finished(out);
  if (!s.free) return out;
  // Frist für „Geschummelt!“: gilt für den ganzen Frame, bis der andere wirft
  const why = said === truth ? null : truthText(said, truth);
  const c = s.cheat?.player === player && s.cheat.frame === at.frame ? s.cheat : null;
  const cheat = { player, frame: at.frame, legal: (c?.legal ?? true) && !why, why: c?.why ?? why ?? null };
  return { ...out, cheat, verdict: null };
}

function truthText(said, truth) {
  if (truth === 'F') return `übergetreten und trotzdem ${said} ${said === 1 ? 'Pin' : 'Pins'} eingetragen`;
  if (said === 'F') return `„F“ eingetragen, obwohl nicht übergetreten (${truth} ${truth === 1 ? 'Pin' : 'Pins'})`;
  return `${said} ${said === 1 ? 'Pin' : 'Pins'} eingetragen, gefallen ${truth === 1 ? 'war' : 'waren'} ${truth}`;
}

// „Geschummelt!“ – gegen den letzten Frame des anderen, solange er offen ist
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || (by !== 0 && by !== 1) || c.player !== 1 - by) return null;
  if (c.legal) {
    const penalty = s.penalty.map((n, p) => (p === by ? n + FALSE_ALARM_POINTS : n));
    const verdict = { caught: false, player: by, by };
    const out = { ...s, penalty, cheat: null, verdict, seq: s.seq + 1, events: [{ type: 'fehlalarm', ...verdict }] };
    return { ...out, result: s.result ? finished(out) : null };
  }
  // Erwischt: der Frame wird gestrichen (0, 0) – lief er noch, ist er damit vorbei und der andere ist dran
  const cheater = c.player;
  const frames = framesOf(s.rolls[cheater]);
  const kept = frames.slice(0, c.frame).flatMap((fr) => fr.rolls);
  const later = frames.slice(c.frame + 1).flatMap((fr) => fr.rolls);
  const rolls = s.rolls.map((r, p) => (p === cheater ? [...kept, { n: 0 }, { n: 0 }, ...later] : r));
  const running = position(s.rolls[cheater]).frame === c.frame && !position(s.rolls[cheater]).done && s.turn === cheater;
  const verdict = { caught: true, player: cheater, by, why: c.why, frame: c.frame };
  const out = {
    ...s, rolls, cheat: null, verdict, seq: s.seq + 1, events: [{ type: 'caught', ...verdict }],
    ...(running && { turn: position(rolls[by]).done ? cheater : by, pins: fullRack() }),
  };
  return { ...out, result: finished(out) };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche)
export function waive(s, by) {
  if (!s.free || !s.cheat || s.cheat.player === by) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Siege einschließlich der laufenden, beendeten Partie
export const score = (s) => s.wins.map((n, p) => n + (s.result?.winner === p ? 1 : 0));

// Revanche: der andere fängt an, die Siege zählen weiter. Wer noch erwischt werden kann, startet sie nicht selbst.
export function again(s, by) {
  if (!s.result || rematchBlocked(s, by)) return null;
  return newGame({ starter: 1 - s.starter, free: !!s.free, wins: score(s), round: (s.round ?? 1) + 1 });
}

// Was der Gast sehen darf: ob der letzte Frame regelgerecht war, muss er selbst merken
export const forGuest = (s) => (s.free && s.cheat ? { ...s, cheat: { player: s.cheat.player, frame: s.cheat.frame } } : s);

// Zeichen für den Spielzettel: X Strike, / Spare, F Foul, – kein Pin, sonst die Zahl
export function marks(fr, f) {
  const out = [];
  fr.rolls.forEach((r, k) => {
    const prev = fr.rolls[k - 1];
    // frisch aufgestellt: 1. Wurf; im 10. Frame der 2. nach Strike, der 3. nach Strike + Strike oder nach Spare
    const [a, b] = fr.rolls;
    const fresh = k === 0 || (f === FRAMES - 1 && (k === 1 ? a.n === 10 : a.n === 10 ? b.n === 10 : a.n + b.n === 10));
    if (r.f) out.push('F');
    else if (r.n === 10 && fresh) out.push('X');
    else if (!fresh && prev.n + r.n === 10 && r.n > 0) out.push('/');
    else out.push(r.n === 0 ? '–' : String(r.n));
  });
  return out;
}
