// Billard (8-Ball) als reine Funktionen. Der Host hält den Spielstand; die Physik rechnet der stoßende PC
// und meldet das Ergebnis (report). Spieler 0 = Host, 1 = Gast bzw. Computer.
//
// Regeln nach den Pool-Regeln der WPA („8-Ball“, vereinfacht für zwei Hobbyspieler):
// - Kugeln 1–7 = Volle, 9–15 = Halbe, die 8 = Schwarze. Wer zuerst nach dem Anstoß regelgerecht versenkt,
//   bekommt diese Gruppe (offener Tisch bis dahin). Wer regelgerecht eine eigene Kugel versenkt, stößt weiter.
// - Foul: Weiße versenkt, keine Kugel getroffen, zuerst eine fremde Kugel (bzw. bei offenem Tisch die 8)
//   getroffen, oder nach dem Treffen weder Bande berührt noch etwas versenkt. Nach einem Foul hat der andere
//   „Ball in Hand“: Er legt die Weiße irgendwohin.
// - Die 8 zuletzt: Wer sie versenkt, nachdem die eigene Gruppe schon komplett weg war, und dabei kein Foul
//   macht, gewinnt. Die 8 zu früh oder mit Foul versenkt = verloren.
// Vereinfachungen (für Nico notiert): keine Ansage von Tasche/Kugel, 8 beim Anstoß wird wieder aufgesetzt,
// beim Anstoß zählt nur, ob die Weiße drin ist.

export const TABLE = { L: 1.98, W: 0.99 }; // Spielfläche in Metern (7-Fuß-Tisch), lange Seite entlang x
export const R = 0.028575; // Kugelradius (57,15 mm)
export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
const GROUPS = { volle: SOLIDS, halbe: STRIPES };
export const HEAD = [-TABLE.L / 4, 0]; // Kopfpunkt: hier liegt die Weiße beim Anstoß
export const FOOT = [TABLE.L / 4, 0]; // Fußpunkt: Spitze des Dreiecks

export const groupOf = (n) => (n === 0 ? null : n === 8 ? 'acht' : n < 8 ? 'volle' : 'halbe');
const otherGroup = (g) => (g === 'volle' ? 'halbe' : 'volle');
const other = (p) => 1 - p;

// Dreieck an den Fußpunkt: 8 in die Mitte der dritten Reihe, hinten links und rechts je eine Volle und eine Halbe
export function rack(rng = Math.random) {
  const shuffled = (list) => list.map((n) => [rng(), n]).sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  const solids = shuffled(SOLIDS);
  const stripes = shuffled(STRIPES);
  const corners = rng() < 0.5 ? [solids.pop(), stripes.pop()] : [stripes.pop(), solids.pop()];
  const rest = shuffled([...solids, ...stripes]);
  const order = [];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      if (row === 2 && i === 1) order.push(8);
      else if (row === 4 && i === 0) order.push(corners[0]);
      else if (row === 4 && i === 4) order.push(corners[1]);
      else order.push(rest[k++]);
    }
  }
  const positions = { 0: [...HEAD] };
  const gap = 2 * R + 0.0005;
  let n = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      positions[order[n++]] = [FOOT[0] + row * gap * Math.sqrt(3) / 2, (i - row / 2) * gap];
    }
  }
  return positions;
}

export function newGame({ breaker = 0, rng = Math.random } = {}) {
  return {
    breaker,
    turn: breaker,
    groups: [null, null], // 'volle' | 'halbe' je Spieler
    pocketed: [], // versenkte Kugeln (ohne Weiße)
    positions: rack(rng), // Kugel → [x, z] (Mitte der Spielfläche = 0, 0)
    ballInHand: false, // der Spieler am Zug darf die Weiße frei hinlegen
    isBreak: true,
    winner: null,
    seq: 0,
    last: null, // letzter Stoß zur Anzeige: { player, foul, pocketed, keep, eight }
  };
}

// Welche Kugeln der Spieler zuerst treffen muss (null = egal, nur nicht die 8 – offener Tisch)
export function targets(s, player) {
  const g = s.groups[player];
  if (!g) return null;
  const left = GROUPS[g].filter((n) => !s.pocketed.includes(n));
  return left.length ? left : [8];
}

// Liegt die Kugel ganz auf der Spielfläche und berührt keine andere?
export function freeSpot(s, [x, z], ignore = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > TABLE.L / 2 - R || Math.abs(z) > TABLE.W / 2 - R) return false;
  return Object.entries(s.positions).every(([n, [bx, bz]]) => Number(n) === ignore || Math.hypot(bx - x, bz - z) >= 2 * R - 1e-6);
}

// report = { first, rail, pocketed: [Nummern, 0 = Weiße], positions: { Nummer: [x, z] } (was noch liegt) }
export function applyShot(s, player, report) {
  if (s.winner !== null || s.turn !== player || !validReport(report) || !matches(s, report)) return null;
  if (s.ballInHand || !s.positions[0]) return null; // erst die Weiße hinlegen
  const pocketedNow = [...new Set(report.pocketed.filter((n) => n !== 0 && !s.pocketed.includes(n)))];
  const scratch = report.pocketed.includes(0);
  const own = s.groups[player];
  const clearedBefore = own && GROUPS[own].every((n) => s.pocketed.includes(n));

  let foul = null;
  if (scratch) foul = 'Weiße versenkt';
  else if (report.first === null) foul = 'Keine Kugel getroffen';
  else if (!s.isBreak) {
    const must = targets(s, player);
    if (must ? !must.includes(report.first) : report.first === 8) foul = 'Zuerst eine falsche Kugel getroffen';
    else if (!report.rail && !pocketedNow.length) foul = 'Nach dem Treffen keine Bande berührt';
  }

  const positions = Object.fromEntries(Object.entries(report.positions).filter(([n]) => !report.pocketed.includes(Number(n))));
  const base = { ...s, seq: s.seq + 1, ballInHand: false, isBreak: false };

  // Die 8: beim Anstoß wieder aufsetzen, sonst entscheidet sie die Partie
  let sunk = pocketedNow;
  if (pocketedNow.includes(8)) {
    if (s.isBreak) {
      sunk = pocketedNow.filter((n) => n !== 8);
      positions[8] = spotFree({ ...s, positions }, FOOT);
    } else {
      const win = !foul && clearedBefore;
      return {
        ...base, positions, pocketed: [...s.pocketed, ...pocketedNow], winner: win ? player : other(player),
        last: { player, foul, pocketed: pocketedNow, keep: false, eight: win ? 'gewonnen' : 'verloren' },
      };
    }
  }

  // Offener Tisch: Wer regelgerecht versenkt (nicht beim Anstoß), bekommt die Gruppe der ersten Kugel
  let groups = s.groups;
  if (!own && !s.isBreak && !foul && sunk.length) {
    const g = groupOf(sunk[0]);
    groups = player === 0 ? [g, otherGroup(g)] : [otherGroup(g), g];
  }
  const mine = groups[player];
  // Weiter stößt, wer regelgerecht eigene Kugeln versenkt – beim Anstoß auch, wenn nur die 8 fiel (WPA 8-Ball 3.4)
  const eightOnBreak = s.isBreak && pocketedNow.includes(8);
  const keep = !foul && (eightOnBreak || sunk.some((n) => (mine ? groupOf(n) === mine : true)));

  return {
    ...base,
    positions,
    pocketed: [...s.pocketed, ...sunk],
    groups,
    turn: keep ? player : other(player),
    ballInHand: !!foul,
    last: { player, foul, pocketed: sunk, keep, eight: null },
  };
}

// Ball in Hand: Weiße an einen freien Platz legen (nur der Spieler am Zug, nur wenn erlaubt)
export function placeCue(s, player, spot) {
  if (s.winner !== null || s.turn !== player || !s.ballInHand || !Array.isArray(spot) || !freeSpot(s, spot, 0)) return null;
  return { ...s, positions: { ...s.positions, 0: [spot[0], spot[1]] }, ballInHand: false, seq: s.seq + 1 };
}

export function again(s) {
  return s.winner === null ? null : newGame({ breaker: other(s.breaker) });
}

// Nächster freier Platz auf der Längsachse ab spot (zum Wiederaufsetzen)
function spotFree(s, spot) {
  for (let dx = 0; dx < TABLE.L / 2; dx += R / 2) {
    for (const x of [spot[0] + dx, spot[0] - dx]) if (freeSpot(s, [x, spot[1]], 8)) return [x, spot[1]];
  }
  return [...spot];
}

// Jede Kugel, die vorher lag, liegt danach noch oder ist versenkt – keine verschwindet, keine kommt zurück
function matches(s, r) {
  const before = Object.keys(s.positions).map(Number);
  const after = Object.keys(r.positions).map(Number);
  return before.every((n) => after.includes(n) || r.pocketed.includes(n))
    && after.every((n) => before.includes(n))
    && r.pocketed.every((n) => before.includes(n));
}

function validReport(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.pocketed) || typeof r.rail !== 'boolean') return false;
  if (!(r.first === null || (Number.isInteger(r.first) && r.first >= 1 && r.first <= 15))) return false;
  if (!r.pocketed.every((n) => Number.isInteger(n) && n >= 0 && n <= 15)) return false;
  if (!r.positions || typeof r.positions !== 'object') return false;
  return Object.entries(r.positions).every(([n, p]) => {
    const k = Number(n);
    return Number.isInteger(k) && k >= 0 && k <= 15 && Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  });
}
