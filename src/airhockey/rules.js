// Air-Hockey: Maße und Spielstand als reine Funktionen (kein DOM, kein Rapier) – geprüft mit node --test (test/airhockey.test.js).
// Regeln nach USAA (Zusammenfassung auf Wikipedia/„Air hockey“): Wer zuerst 7 Tore hat, gewinnt die Partie. Nach einem Tor
// bekommt der Getroffene den Puck. Liegt der Puck 7 Sekunden in einer Hälfte, ohne dass er über die Mittellinie geht, ist das
// ein Foul – der andere bekommt den Puck. Schläger über die Mittellinie und „Topping“ (Puck mit dem Schläger festhalten) sind
// verboten. Spieler 0 = Host verteidigt das Tor auf +z, Spieler 1 = Gast bzw. Computer das Tor auf −z.
// free = „Ohne Hilfen“: Mittellinie, Topping und 7 Sekunden prüft niemand von selbst – jeder Verstoß wird gemerkt (fouls),
// der andere kann „Geschummelt!“ rufen: erwischt = Strafe, Fehlalarm = kleine Strafe (accuse).

// Maße in Metern: Turniertisch 8 Fuß (USAA/AHPA: nur 8-Fuß-Tische für Turniere). Außenmaß 99,5″ × 51,5″ ≈ 2,53 × 1,31 m
// (Händlerangaben zum Dynamo Pro Style); Spielfläche, Torschlitz und Banden daraus abgeleitet (eigene Festlegung).
export const TABLE = {
  L: 2.3, // Länge der Spielfläche (entlang z)
  W: 1.1, // Breite der Spielfläche (entlang x)
  GOAL: 0.25, // Breite des Torschlitzes
  RAIL: 0.1, // Breite der Bande (Holz/Alu um die Spielfläche)
  CORNER: 0.08, // Ecken innen gerundet (wie bei echten Tischen – dort klemmt der Puck nicht fest)
};
export const R = 0.04125; // Puck: 3¼″ Durchmesser (Dynamo-Turnierpuck)
export const RM = 0.0505; // Schläger (Mallet): knapp 4″ Durchmesser
export const WIN = 7; // Tore bis zum Sieg
export const SEVEN_S = 7; // Sekunden, die der Puck höchstens in einer Hälfte liegen darf
export const ACCUSE_S = 5; // so lange nach einem Verstoß kann „Geschummelt!“ ihn noch erwischen
export const ALARMS_PER_POINT = 2; // jeder zweite Fehlalarm = Strafpunkt für den anderen
export const WHY = {
  linie: 'Schläger über der Mittellinie',
  topping: 'Puck mit dem Schläger festgehalten (Topping)',
  sieben: 'Puck länger als 7 Sekunden in der eigenen Hälfte gehalten',
};

// Neue Partie. starter = wer zuerst den Puck hat (Anwurf/Münzwurf), wins/round laufen über die Revanchen weiter
export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  return {
    score: [0, 0],
    wins: [...wins],
    round,
    starter,
    serve: starter, // wer den Puck gerade hat bzw. zuletzt bekam
    reset: 0, // zählt hoch, wenn der Puck neu in eine Hälfte gelegt wird (Tor, 7 Sekunden, Strafe)
    winner: null,
    free: !!free,
    fouls: [null, null], // je Spieler der letzte Verstoß { why, at } (nur ohne Hilfen)
    lastGoal: null, // { by, at } – letztes Tor
    alarms: [0, 0], // Fehlalarme je Spieler (nur zur Anzeige)
    clock: 0, // Spielzeit in Sekunden (rechnet der Host)
    seq: 0,
    events: [{ type: 'start', by: starter }],
  };
}

const bump = (s, events, extra = {}) => ({ ...s, ...extra, seq: s.seq + 1, events });
const over = (score) => (score[0] >= WIN ? 0 : score[1] >= WIN ? 1 : null);

// Tor für scorer (Puck im Tor des anderen). Der Getroffene bekommt den Puck.
export function goal(s, scorer, clock = s.clock) {
  if (s.winner !== null || (scorer !== 0 && scorer !== 1)) return null;
  const score = [...s.score];
  score[scorer]++;
  const winner = over(score);
  const wins = [...s.wins];
  if (winner !== null) wins[winner]++;
  return bump(s, [{ type: 'goal', by: scorer }], {
    score, winner, wins, serve: 1 - scorer, reset: s.reset + 1, clock, lastGoal: { by: scorer, at: clock },
  });
}

// Puck lag 7 Sekunden in der Hälfte von p. Mit Hilfen: Foul, der andere bekommt den Puck. Ohne Hilfen: nur gemerkt.
export function sevenSeconds(s, p, clock = s.clock) {
  if (s.winner !== null || (p !== 0 && p !== 1)) return null;
  if (s.free) return foul(s, p, 'sieben', clock);
  return bump(s, [{ type: 'sieben', by: p }], { serve: 1 - p, reset: s.reset + 1, clock });
}

// Ohne Hilfen: Verstoß von p merken (why = Schlüssel aus WHY). Mit Hilfen geht das nicht – der Tisch lässt es nicht zu.
export function foul(s, p, why, clock = s.clock) {
  if (!s.free || s.winner !== null || (p !== 0 && p !== 1) || !WHY[why]) return null;
  const fouls = [...s.fouls];
  fouls[p] = { why, at: clock };
  return bump(s, [{ type: 'foul', by: p, why }], { fouls, clock });
}

// Hat p in den letzten ACCUSE_S Sekunden gegen eine Regel verstoßen?
export const recentFoul = (s, p, clock = s.clock) => {
  const f = s.fouls?.[p];
  return f && clock - f.at <= ACCUSE_S ? f : null;
};

// „Geschummelt!“ von by gegen den anderen. Erwischt: ein Tor des Schummlers in den letzten ACCUSE_S Sekunden zählt nicht,
// dazu ein Strafpunkt (Tor) für by; der Schummler bekommt den Puck. Ein zurückgenommenes Siegtor öffnet die Partie wieder.
// Fehlalarm: Das Spiel läuft einfach weiter (kein Anhalten – sonst wäre der Ruf eine Notbremse vor dem eigenen Tor);
// jeder zweite Fehlalarm desselben Rufers ist ein Strafpunkt (Tor) für den anderen, dann bekommt der Rufer den Puck wie nach einem Tor.
export function accuse(s, by, clock = s.clock) {
  if (!s.free || (by !== 0 && by !== 1)) return null;
  const cheat = 1 - by;
  const f = recentFoul(s, cheat, clock);
  if (s.winner !== null && !(f && s.winner === cheat)) return null; // nach dem Ende nur noch gegen den Sieger, solange es frisch ist
  if (!f) {
    const alarms = [...s.alarms];
    alarms[by]++;
    if (alarms[by] % ALARMS_PER_POINT) return bump(s, [{ type: 'fehlalarm', by, player: by, penalty: false }], { alarms, clock });
    const score = [...s.score];
    score[cheat]++;
    const winner = over(score);
    const wins = [...s.wins];
    if (winner !== null) wins[winner]++;
    return bump(s, [{ type: 'fehlalarm', by, player: by, penalty: true }], { alarms, score, winner, wins, serve: by, reset: s.reset + 1, clock });
  }
  const score = [...s.score];
  const wins = [...s.wins];
  if (s.winner !== null) wins[s.winner]--;
  const annulled = s.lastGoal?.by === cheat && clock - s.lastGoal.at <= ACCUSE_S;
  if (annulled) score[cheat]--;
  score[by]++;
  const winner = score[by] >= WIN ? by : over(score); // beide auf 7 (Siegtor zählt noch): der Rufer gewinnt
  if (winner !== null) wins[winner]++;
  const fouls = [...s.fouls];
  fouls[cheat] = null;
  return bump(s, [{ type: 'caught', by, player: cheat, why: WHY[f.why], annulled }], {
    score, wins, winner, fouls, serve: cheat, reset: s.reset + 1, clock, lastGoal: annulled ? null : s.lastGoal,
  });
}

// Ohne Hilfen: so viele Sekunden muss der Sieger noch auf die Revanche warten (sein letzter Verstoß verjährt), sonst 0
export const againWait = (s, by, clock = s.clock) => {
  const f = s.free && by === s.winner ? recentFoul(s, by, clock) : null;
  return f ? ACCUSE_S - (clock - f.at) : 0;
};

// Revanche: der Verlierer der letzten Partie fängt an. Ohne Hilfen wartet der Sieger, bis sein letzter Verstoß verjährt ist.
export function again(s, by, clock = s.clock) {
  if (s.winner === null) return null;
  if (s.free && by === s.winner && recentFoul(s, by, clock)) return null;
  return newGame({ starter: 1 - s.winner, free: s.free, wins: s.wins, round: s.round + 1 });
}

// Wo der Puck nach einem Tor/Foul hingelegt wird: Mitte der Hälfte von p (Host +z)
export const serveSpot = (p) => [0, (p === 0 ? 1 : -1) * TABLE.L / 4];

// Hälfte, in der ein Punkt liegt (Host +z) – genau auf der Linie: keine
export const halfOf = (z) => (z > 0 ? 0 : z < 0 ? 1 : null);

// Wohin darf der Schläger von p? Mit Hilfen bleibt er ganz in der eigenen Hälfte (Rand berührt höchstens die Mittellinie),
// ohne Hilfen reicht er bis REACH über die Linie. Liefert [x, z] innerhalb der Banden.
export const REACH = 0.3;
export function clampMallet(p, [x, z], free = false) {
  const { L, W } = TABLE;
  const cx = Math.min(Math.max(x, -W / 2 + RM), W / 2 - RM);
  const near = free ? -REACH : RM; // so weit darf die Mitte an die Linie heran (positiv = diesseits)
  const side = p === 0 ? 1 : -1;
  const own = Math.min(Math.max(z * side, near), L / 2 - RM);
  return roundCorner(cx, own * side, RM);
}

// In den gerundeten Ecken: Mitte eines Körpers mit Radius r höchstens CORNER − r vom Bogenmittelpunkt
export function roundCorner(x, z, r) {
  const { L, W, CORNER } = TABLE;
  const [ax, az] = [W / 2 - CORNER, L / 2 - CORNER];
  const [dx, dz] = [Math.abs(x) - ax, Math.abs(z) - az];
  const d = Math.hypot(dx, dz);
  if (dx <= 0 || dz <= 0 || d <= CORNER - r) return [x, z];
  const k = (CORNER - r) / d;
  return [Math.sign(x) * (ax + dx * k), Math.sign(z) * (az + dz * k)];
}

// Mitte des Schlägers über der Mittellinie (mehr als halb drüben)?
export const overLine = (p, z) => (p === 0 ? z < 0 : z > 0);
