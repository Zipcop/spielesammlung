// Dame (deutsche Dame, 8 × 8) als reine Funktionen. Der Host hält den Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig, z. B. nicht dran oder regelwidrig). Spieler 0 = Host, 1 = Gast bzw. Computer.
//
// Regeln (Schmidt Spiele „8 Reise-Spiele“, Simba „99 Spielesammlung“, de.wikipedia.org/wiki/Dame_(Spiel),
// en.wikipedia.org/wiki/Draughts – Tabelle „German draughts“: fliegende Damen, Steine schlagen nicht rückwärts):
// - Je 12 Steine auf den dunklen Feldern der ersten drei Reihen, jeder hat ein dunkles Eckfeld links. Weiß beginnt.
// - Steine ziehen schräg ein Feld vorwärts und schlagen nur vorwärts: über einen schräg benachbarten Gegner auf das
//   freie Feld direkt dahinter. Geht es von dort weiter, wird weitergeschlagen (Mehrfachschlagen, auch im Zickzack).
// - Schlagzwang: Kann man schlagen, muss man – welche Schlagfolge, ist frei; die gewählte muss man zu Ende schlagen.
// - Geschlagene Steine kommen erst nach dem Zug vom Brett und dürfen nicht zweimal übersprungen werden.
// - Erreicht ein Stein die letzte Reihe, wird er zur Dame (Doppelstein); damit endet der Zug.
// - Die Dame zieht und schlägt vorwärts und rückwärts beliebig weit über freie Felder; nach dem Schlagen landet
//   sie auf einem beliebigen freien Feld dahinter (Schmidt: „muss aber nicht auf dem nächsten freien Feld … landen“).
// - Verloren hat, wer keinen Stein mehr hat oder nicht mehr ziehen kann.
// - Remis (gewählt nach den Turnierregeln der FMJD, z. B. lidraughts.org/variant/standard): dieselbe Stellung zum
//   dritten Mal, oder 25 Züge je Seite (50 Halbzüge) nur mit Damen und ohne Schlagen.
//
// „Ohne Hilfen“ (free): Jeder Zug entlang einer Schräge geht durch – rückwärts, mehrere Felder, rückwärts schlagen,
// Schlagzwang übergehen, Mehrfachschlagen abbrechen, nicht oder falsch zur Dame machen (crown). Über eigene oder schon
// geschlagene Steine springen geht auch dann nicht. Bis der andere selbst zieht, kann er „Geschummelt!“ rufen
// (accuse): Stimmt es, wird der Zug zurückgenommen, der Schummler muss neu ziehen und bekommt eine Verwarnung; sonst
// trifft die Verwarnung den Ankläger (wie Schach und Mühle). Bei der dritten Verwarnung ist die Partie verloren.
//
// Felder k = r * 8 + c: Reihe r = 0 beim Gast (hinten), 7 beim Host; Spalte c = 0 links aus Sicht des Hosts.
// Dunkel sind die Felder mit r + c ungerade. Inhalt: null = leer, 0/1 = Stein von Spieler 0/1, 2/3 = Dame von 0/1.

export const PIECES = 12;
export const MAX_STRIKES = 3;
export const QUIET_LIMIT = 50; // Halbzüge nur mit Damen, ohne Schlagen → Remis

export const REASONS = {
  steine: 'Keine Steine mehr',
  blockiert: 'Kein Zug mehr möglich',
  wiederholung: 'Dreimal dieselbe Stellung',
  zuege: '25 Züge nur mit Damen, ohne Schlagen',
  schummeln: 'Dritte Verwarnung',
};

const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const dark = (k) => ((k >> 3) + (k & 7)) % 2 === 1;
const isSquare = (k) => Number.isInteger(k) && k >= 0 && k < 64;
export const ownerOf = (x) => x & 1;
export const isKing = (x) => x >= 2;
export const forward = (p) => (p === 0 ? -1 : 1); // Spieler 0 zieht zur Reihe 0, Spieler 1 zur Reihe 7
export const lastRow = (p) => (p === 0 ? 0 : 7);
const FORWARD_DIRS = [[0, 1], [2, 3]];

// RAYS[k][d] = Felder von k aus in Richtung DIRS[d] bis zum Rand
export const RAYS = Array.from({ length: 64 }, (_, k) => DIRS.map(([dr, dc]) => {
  const out = [];
  for (let r = (k >> 3) + dr, c = (k & 7) + dc; r >= 0 && r < 8 && c >= 0 && c < 8; r += dr, c += dc) out.push(r * 8 + c);
  return out;
}));

export function startBoard() {
  return Array.from({ length: 64 }, (_, k) => (!dark(k) ? null : k < 24 ? 1 : k >= 40 ? 0 : null));
}

// Alle vollständigen Schlagfolgen des Steins auf from: { path, took, crown }. taken = schon geschlagene Steine
// (liegen noch, dürfen nicht nochmal übersprungen werden). Ändert board nur vorübergehend.
export function jumpsFrom(board, from, taken = []) {
  const piece = board[from];
  const p = piece & 1;
  const king = piece >= 2;
  const dirs = king ? [0, 1, 2, 3] : FORWARD_DIRS[p];
  const out = [];
  const took = [...taken];
  const path = [from];
  board[from] = null;
  const walk = (at) => {
    let more = false;
    for (const d of dirs) {
      const ray = RAYS[at][d];
      let i = 0;
      if (king) while (i < ray.length && board[ray[i]] === null) i++;
      const victim = ray[i];
      if (victim === undefined || board[victim] === null || (board[victim] & 1) === p || took.includes(victim)) continue;
      for (let j = i + 1; j < ray.length && board[ray[j]] === null; j++) {
        more = true;
        took.push(victim);
        path.push(ray[j]);
        walk(ray[j]);
        took.pop();
        path.pop();
        if (!king) break; // ein Stein landet direkt dahinter
      }
    }
    // Steine schlagen nur vorwärts: auf der letzten Reihe geht es nie weiter – der Zug endet mit der Umwandlung
    if (!more && took.length > taken.length) out.push({ path: [...path], took: took.slice(taken.length), crown: !king && at >> 3 === lastRow(p) });
  };
  walk(from);
  board[from] = piece;
  return out;
}

function stepsFrom(board, from) {
  const piece = board[from];
  const p = piece & 1;
  const king = piece >= 2;
  const out = [];
  for (const d of king ? [0, 1, 2, 3] : FORWARD_DIRS[p]) {
    for (const to of RAYS[from][d]) {
      if (board[to] !== null) break;
      out.push({ path: [from, to], took: [], crown: !king && to >> 3 === lastRow(p) });
      if (!king) break;
    }
  }
  return out;
}

// Alle regelgerechten Züge von p auf diesem Brett (Schlagzwang: gibt es Schlagfolgen, nur diese)
export function legalMoves(board, p) {
  const jumps = [];
  for (let k = 0; k < 64; k++) if (board[k] !== null && (board[k] & 1) === p) jumps.push(...jumpsFrom(board, k));
  if (jumps.length) return jumps;
  const out = [];
  for (let k = 0; k < 64; k++) if (board[k] !== null && (board[k] & 1) === p) out.push(...stepsFrom(board, k));
  return out;
}

// Zug auf einem Brett ausführen (neues Brett)
export function applyMove(board, m) {
  const b = board.slice();
  const piece = b[m.path[0]];
  b[m.path[0]] = null;
  for (const t of m.took) b[t] = null;
  b[m.path[m.path.length - 1]] = m.crown ? piece | 2 : piece;
  return b;
}

// Prüft einen Weg (Felder, die der Stein nacheinander anläuft) auf dem Brett: null = so geht es gar nicht
// (kein schräger Weg, Feld besetzt, über eigene oder schon geschlagene Steine), sonst
// { took, to, crown, king, why: [Regelverstöße] }. crown undefined = so, wie die Regel es verlangt.
export function inspect(board, p, path, crown) {
  if (!Array.isArray(path) || path.length < 2 || path.length > 24 || !path.every(isSquare)) return null;
  const piece = board[path[0]];
  if (piece === null || piece === undefined || (piece & 1) !== p) return null;
  const king = piece >= 2;
  const b = board.slice();
  b[path[0]] = null;
  const took = [];
  const why = new Set();
  let at = path[0];
  for (let n = 1; n < path.length; n++) {
    const to = path[n];
    const dr = (to >> 3) - (at >> 3);
    const dc = (to & 7) - (at & 7);
    if (!dark(to) || dr === 0 || Math.abs(dr) !== Math.abs(dc) || b[to] !== null) return null;
    const d = DIRS.findIndex(([r, c]) => r === Math.sign(dr) && c === Math.sign(dc));
    const crossed = RAYS[at][d].slice(0, Math.abs(dr) - 1).filter((k) => b[k] !== null);
    if (crossed.some((k) => (b[k] & 1) === p || took.includes(k))) return null;
    const back = Math.sign(dr) !== forward(p);
    if (!crossed.length) {
      if (path.length > 2) return null; // ohne Schlagen gibt es nur einen einzelnen Schritt
      if (!king && back) why.add('mit einem Stein rückwärts gezogen');
      if (!king && Math.abs(dr) > 1) why.add('mit einem Stein mehr als ein Feld gezogen');
    } else {
      if (crossed.length > 1) why.add('mehrere Steine auf einmal übersprungen');
      if (!king && back) why.add('mit einem Stein rückwärts geschlagen');
      if (!king && crossed.length === 1 && Math.abs(dr) !== 2) why.add('mit einem Stein wie eine Dame geschlagen');
      took.push(...crossed);
    }
    at = to;
  }
  if (!took.length && legalMoves(board, p).some((m) => m.took.length)) why.add('nicht geschlagen, obwohl Schlagzwang war');
  const promoted = !king && at >> 3 === lastRow(p);
  if (took.length && !promoted) {
    b[at] = piece;
    if (jumpsFrom(b, at, took).length) why.add('beim Mehrfachschlagen zu früh aufgehört');
  }
  const crowned = crown === undefined ? promoted : !!crown && !king;
  if (promoted && !crowned) why.add('den Stein auf der letzten Reihe nicht zur Dame gemacht');
  if (crowned && !promoted) why.add('einen Stein zur Dame gemacht, der die letzte Reihe nicht erreicht hat');
  return { took, to: at, crown: crowned, king, why: [...why] };
}

// white = welcher Spieler Weiß hat und anfängt (0 oder 1)
export function newGame({ white = 0, free = false } = {}) {
  const board = startBoard();
  return {
    white,
    free,
    board,
    turn: white,
    last: null, // letzter Zug: { player, path, took, crown }
    quiet: 0, // Halbzüge nur mit Damen ohne Schlagen
    positions: [keyOf(board, white)], // Stellungen seit dem letzten Stein-Zug oder Schlagen, für die Wiederholung
    result: null, // { winner: 0 | 1 | null, reason }
    strikes: [0, 0], // Verwarnungen (ohne Hilfen)
    // Zug des Spielers, der zuletzt dran war, solange man ihn anprangern kann (ohne Hilfen):
    // { player, why: [Gründe], prev: Stand vor dem Zug } – why und prev nur beim Host (forGuest)
    cheat: null,
    verdict: null, // Ergebnis von „Geschummelt!“: { caught, player (bekommt die Verwarnung), by, why }
    seq: 0,
    events: [{ type: 'start', player: white }],
  };
}

export const keyOf = (board, turn) => `${board.map((x) => (x === null ? '.' : x)).join('')}${turn}`;

// Revanche: die Farben werden getauscht
export function again(s) {
  return s.result ? newGame({ white: 1 - s.white, free: s.free }) : null;
}

const mayAct = (s, p) => !s.result && (p === 0 || p === 1) && s.turn === p;

// Zug spielen: move = { path: [von, Landefeld, …], crown } – crown nur ohne Hilfen (sonst gilt die Regel)
export function play(s, p, move) {
  if (!mayAct(s, p) || !move) return null;
  const check = inspect(s.board, p, move.path, s.free ? move.crown : undefined);
  if (!check || (check.why.length && !s.free)) return null;
  const { took, crown, king } = check;
  const path = [...move.path];
  const board = applyMove(s.board, { path, took, crown });
  const o = 1 - p;
  let next = { ...s, verdict: null, board, turn: o, seq: s.seq + 1 };
  if (s.free) next.cheat = { player: p, why: check.why, prev: { ...s, cheat: null, verdict: null } };
  next.last = { player: p, path, took, crown };
  const reset = took.length > 0 || !king;
  next.quiet = reset ? 0 : s.quiet + 1;
  const key = keyOf(board, o);
  next.positions = reset ? [key] : [...s.positions, key];
  const events = [{ type: 'move', player: p, from: path[0], to: check.to, took: took.length, crown }];
  let result = null;
  if (!board.some((x) => x !== null && (x & 1) === o)) result = { winner: p, reason: 'steine' };
  else if (!legalMoves(board, o).length) result = { winner: p, reason: 'blockiert' };
  else if (next.positions.filter((x) => x === key).length >= 3) result = { winner: null, reason: 'wiederholung' };
  else if (next.quiet >= QUIET_LIMIT) result = { winner: null, reason: 'zuege' };
  if (result) events.push({ type: 'over', ...result });
  next = { ...next, result, events };
  return next;
}

// Steine von p, die jetzt regelgerecht ziehen können (bei Schlagzwang nur die, die schlagen können)
export function movable(s, p) {
  if (s.result || s.turn !== p) return [];
  return [...new Set(legalMoves(s.board, p).map((m) => m.path[0]))];
}

// Muss p gerade schlagen?
export const mustJump = (s, p) => legalMoves(s.board, p).some((m) => m.took.length > 0);

// Regelgerechte Züge, die mit diesem Weg beginnen (für Anzeige und Klicks Schritt für Schritt)
export function continuations(s, p, path) {
  if (s.result || s.turn !== p) return [];
  return legalMoves(s.board, p).filter((m) => path.length <= m.path.length && path.every((k, i) => m.path[i] === k));
}

// „Geschummelt!“ – nur gegen den letzten Zug des anderen, solange er danach nicht selbst gezogen hat
export function accuse(s, p) {
  const c = s.cheat;
  if (!s.free || !c || c.player === p || (p !== 0 && p !== 1) || (s.turn !== p && !s.result)) return null;
  const caught = c.why.length > 0;
  const guilty = caught ? c.player : p;
  const base = caught ? c.prev : { ...s, cheat: null }; // erwischt: Stand vor dem Zug, der Schummler ist wieder dran
  const strikes = base.strikes.map((n, q) => (q === guilty ? n + 1 : n));
  const out = strikes[guilty] >= MAX_STRIKES ? { winner: 1 - guilty, reason: 'schummeln' } : null;
  const result = caught ? out : base.result ?? out;
  // erwischt: erst jetzt wird der Grund für beide sichtbar (höchstens zwei, mit „und“)
  const verdict = { caught, player: guilty, by: p, ...(caught && { why: c.why.slice(0, 2).join(' und ') }) };
  return {
    ...base, strikes, result, verdict, seq: s.seq + 1,
    events: [{ type: caught ? 'caught' : 'fehlalarm', ...verdict }, ...(result && result !== base.result ? [{ type: 'over', ...result }] : [])],
  };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche nach Spielende)
export function waive(s, p) {
  const c = s.cheat;
  if (!s.free || !c || c.player === p || (p !== 0 && p !== 1)) return null;
  return { ...s, cheat: null };
}

// Was der Gast sehen darf: ob der letzte Zug regelgerecht war, muss er selbst merken
export const forGuest = (s) => (s.free ? { ...s, cheat: s.cheat && { player: s.cheat.player } } : s);
