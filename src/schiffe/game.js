// Schiffe versenken als reine Funktionen (kein DOM, kein three.js). Der Host hält den Spielstand: Jede Aktion liefert
// einen neuen Zustand oder null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer. Jeder sieht nur viewFor(state, p).
//
// Regeln nach Hasbro „Battleship“ (Anleitung F4527, 2022): 10 × 10 Felder, Reihen A–J, Spalten 1–10. Jeder stellt verdeckt
// 5 Schiffe auf – Flugzeugträger 5, Schlachtschiff 4, Zerstörer 3, U-Boot 3, Patrouillenboot 2 –, nur waagrecht oder
// senkrecht, nicht über den Rand und nicht übereinander (berühren dürfen sie sich). Abwechselnd genau ein Schuss je Zug,
// auch nach einem Treffer. Antwort: „Wasser“ oder „Treffer“ mit dem Namen des Schiffs; sind alle Felder eines Schiffs
// getroffen, „versenkt“. Wer zuerst die ganze Flotte des anderen versenkt, gewinnt.
// Schiff = { x, y, dir }: x = Spalte 0–9 (1–10), y = Reihe 0–9 (A–J), dir 'h' = nach rechts, 'v' = nach unten (zu J).
// Flotte = 5 Schiffe in der Reihenfolge von FLEET.
//
// „Ohne Hilfen“ (free, zu zweit oder allein gegen den Computer): Der Beschossene antwortet selbst (answer) – und darf lügen. Schießen geht auch
// außer der Reihe, Schiffe dürfen beim Aufstellen übereinanderliegen und sich mitten in der Partie verschieben (move).
// Geprüft wird nichts. „Geschummelt!“ (accuse) prüft alles, was der andere seit der letzten Anklage gegen ihn getan hat –
// jederzeit, auch nach dem Ende: Erwischt = alles wird richtiggestellt (Schiffe zurück, falsche Antworten berichtigt,
// Extraschüsse raus) und eine Verwarnung; wer nach seinem Sieg erwischt wird, verliert die Partie. Fehlalarm = eine
// Verwarnung für den Ankläger. Drei Verwarnungen = verloren. Ist die Flotte wirklich versenkt, endet die Partie sofort.

export const N = 10;
export const MAX_STRIKES = 3;
export const ROWS = 'ABCDEFGHIJ';
export const FLEET = [
  { name: 'Flugzeugträger', len: 5 },
  { name: 'Schlachtschiff', len: 4 },
  { name: 'Zerstörer', len: 3 },
  { name: 'U-Boot', len: 3 },
  { name: 'Patrouillenboot', len: 2 },
];
export const RESULTS = ['wasser', 'treffer', 'versenkt'];

// Feldname wie auf dem Brett, z. B. „D4“
export const cellName = (x, y) => `${ROWS[y]}${x + 1}`;
const key = (x, y) => y * N + x;
const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < N && y >= 0 && y < N;

// Felder eines Schiffs (k = Nummer in FLEET) als [x, y]
export const cellsOf = (ship, k) => Array.from({ length: FLEET[k].len }, (_, i) => (ship.dir === 'h' ? [ship.x + i, ship.y] : [ship.x, ship.y + i]));

// Liegt das Schiff ganz auf dem Brett?
export function fits(ship, k) {
  if (!ship || (ship.dir !== 'h' && ship.dir !== 'v') || !FLEET[k]) return false;
  return cellsOf(ship, k).every(([x, y]) => inside(x, y));
}

// Schiff, das auf Feld (x, y) liegt (Nummer in FLEET), sonst -1
export function shipAt(fleet, x, y) {
  return fleet.findIndex((ship, k) => cellsOf(ship, k).some(([a, b]) => a === x && b === y));
}

// Liegen zwei Schiffe übereinander?
export function overlaps(fleet) {
  const seen = new Set();
  for (const [k, ship] of fleet.entries()) {
    for (const [x, y] of cellsOf(ship, k)) {
      if (seen.has(key(x, y))) return true;
      seen.add(key(x, y));
    }
  }
  return false;
}

// Flotte bereinigt ({ x, y, dir } je Schiff) oder null, wenn sie nicht passt. overlap = übereinander erlaubt (ohne Hilfen)
export function cleanFleet(fleet, { overlap = false } = {}) {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return null;
  const out = fleet.map((s) => (s && typeof s === 'object' ? { x: s.x, y: s.y, dir: s.dir } : null));
  if (!out.every((s, k) => fits(s, k))) return null;
  return overlap || !overlaps(out) ? out : null;
}

// Zufällige, regelgerechte Flotte (Schiffe dürfen sich berühren). avoid = Felder, die frei bleiben sollen (Set aus key)
export function randomFleet(rng = Math.random, avoid = new Set()) {
  for (;;) {
    const used = new Set(avoid);
    const fleet = [];
    for (const k of FLEET.keys()) {
      const ship = placeOne(k, used, rng);
      if (!ship) break;
      fleet.push(ship);
      for (const [x, y] of cellsOf(ship, k)) used.add(key(x, y));
    }
    if (fleet.length === FLEET.length) return fleet;
  }
}

// Ein Schiff auf freie Felder legen (null = geht nicht)
function placeOne(k, used, rng) {
  const spots = [];
  for (const dir of ['h', 'v']) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ship = { x, y, dir };
        if (fits(ship, k) && cellsOf(ship, k).every(([a, b]) => !used.has(key(a, b)))) spots.push(ship);
      }
    }
  }
  return spots.length ? spots[Math.floor(rng() * spots.length)] : null;
}

// Wahre Antwort auf einen Schuss (x, y) gegen fleet, wenn vorher schon auf before geschossen wurde (Liste aus { x, y })
export function judge(fleet, before, x, y) {
  const k = shipAt(fleet, x, y);
  if (k < 0) return { res: 'wasser', ship: null };
  const hit = new Set([...before.map((s) => key(s.x, s.y)), key(x, y)]);
  return { res: cellsOf(fleet[k], k).every(([a, b]) => hit.has(key(a, b))) ? 'versenkt' : 'treffer', ship: k };
}

// Sind alle Schiffe von fleet durch die Schüsse getroffen?
export function allSunk(fleet, shots) {
  const hit = new Set(shots.map((s) => key(s.x, s.y)));
  return fleet.every((ship, k) => cellsOf(ship, k).every(([x, y]) => hit.has(key(x, y))));
}

// Antwort als Text, z. B. „Treffer – Zerstörer“
export function answerText({ res, ship }) {
  if (res === 'wasser') return 'Wasser';
  return `${res === 'versenkt' ? 'Versenkt' : 'Treffer'} – ${FLEET[ship]?.name ?? '?'}`;
}

// starter = wer zuerst schießt · wins = Siege aus früheren Partien · round = Nummer der Partie
// fleets[p] = Flotte (null = stellt noch auf) · shots[p] = Schüsse VON p auf den anderen: { x, y, res, ship }
export function newGame({ starter = 0, free = false, wins = [0, 0], round = 1 } = {}) {
  const s = { phase: 'setup', starter, turn: starter, fleets: [null, null], shots: [[], []], result: null, wins: [...wins], round, seq: 0, events: [{ type: 'start' }] };
  // pending = Schuss, auf den die Antwort fehlt · home = Flotte beim Start bzw. bei der letzten Prüfung
  // open[p] = was p seit der letzten Anklage gegen ihn getan hat: { why = Verstöße, extra = Extraschüsse [x, y] } oder null
  return free ? { ...s, free: true, last: null, pending: null, home: [null, null], open: [null, null], strikes: [0, 0], verdict: null } : s;
}

const valid = (p) => p === 0 || p === 1;
const step = (s, patch, events) => ({ ...s, ...patch, seq: s.seq + 1, events, ...(s.free && { verdict: null }) });
const withAt = (list, i, v) => list.map((x, k) => (k === i ? v : x));

// Flotte aufstellen: setzt sie und meldet „bereit“. Sind beide bereit, beginnt das Schießen.
export function place(s, p, fleet) {
  if (s.phase !== 'setup' || !valid(p) || s.fleets[p]) return null;
  const clean = cleanFleet(fleet, { overlap: !!s.free });
  if (!clean) return null;
  const fleets = withAt(s.fleets, p, clean);
  if (!fleets.every(Boolean)) return step(s, { fleets }, [{ type: 'ready', by: p }]);
  const go = { fleets, phase: 'play' };
  // ohne Hilfen: Übereinander-Aufstellen ist der erste Verstoß. Beide haben von Anfang an eine offene Liste – sonst
  // verriete der „Geschummelt!“-Knopf, wer geschummelt hat.
  if (s.free) Object.assign(go, { home: fleets, open: fleets.map((f) => ({ why: overlaps(f) ? ['Schiffe übereinander aufgestellt'] : [], extra: [] })) });
  return step(s, go, [{ type: 'ready', by: p }, { type: 'go' }]);
}

const shotAt = (list, x, y) => list.findIndex((t) => t.x === x && t.y === y);
const note = (rec, why, extra) => ({ why: [...(rec?.why ?? []), ...(why ? [why] : [])], extra: [...(rec?.extra ?? []), ...(extra ? [extra] : [])] });

// Schuss von p auf Feld (x, y) der anderen Flotte
export function shoot(s, p, x, y) {
  if (s.phase !== 'play' || s.result || !valid(p) || !inside(x, y) || shotAt(s.shots[p], x, y) >= 0) return null;
  const o = 1 - p;
  const truth = judge(s.fleets[o], s.shots[p], x, y);
  if (!s.free) {
    if (p !== s.turn) return null;
    const shots = withAt(s.shots, p, [...s.shots[p], { x, y, ...truth }]);
    const result = allSunk(s.fleets[o], shots[p]) ? { winner: p, reason: 'flotte' } : null;
    return step(s, { shots, turn: o, result }, [{ type: 'shot', by: p, x, y, ...truth }]);
  }
  if (s.pending) return null; // erst antworten
  const why = p === s.turn ? null : s.last === p ? 'zweimal hintereinander geschossen' : 'außer der Reihe geschossen';
  const open = withAt(s.open, p, note(s.open[p], why, why && [x, y]));
  const done = allSunk(s.fleets[o], [...s.shots[p], { x, y }]); // die letzte Antwort gibt das Spiel – die Partie ist aus
  const shot = done ? { x, y, ...truth, truth } : { x, y, res: null, ship: null, truth };
  const shots = withAt(s.shots, p, [...s.shots[p], shot]);
  const patch = { shots, open, turn: o, last: p, pending: done ? null : { by: p, x, y } };
  if (done) patch.result = { winner: p, reason: 'flotte' };
  return step(s, patch, [{ type: 'shot', by: p, x, y, ...(done && truth) }]);
}

// Ohne Hilfen: Antwort des Beschossenen p auf den offenen Schuss – { res, ship }, gelogen geht auch
export function answer(s, p, arg) {
  const { res, ship = null } = arg ?? {};
  if (!s.free || s.result || !s.pending || s.pending.by !== 1 - p || !RESULTS.includes(res)) return null;
  if (res === 'wasser' ? ship !== null : !(Number.isInteger(ship) && FLEET[ship])) return null;
  const o = 1 - p;
  const i = shotAt(s.shots[o], s.pending.x, s.pending.y);
  const shot = s.shots[o][i];
  const lie = res !== shot.truth.res || ship !== shot.truth.ship;
  const why = lie && `auf ${cellName(shot.x, shot.y)} „${answerText({ res, ship })}“ statt „${answerText(shot.truth)}“ gesagt`;
  const shots = withAt(s.shots, o, withAt(s.shots[o], i, { ...shot, res, ship }));
  const open = withAt(s.open, p, note(s.open[p], why));
  return step(s, { shots, open, pending: null }, [{ type: 'answer', by: p, x: shot.x, y: shot.y, res, ship }]);
}

// Ohne Hilfen: eigenes Schiff k mitten in der Partie woandershin legen (nie erlaubt – geprüft wird es erst bei der Anklage)
export function move(s, p, k, ship) {
  if (!s.free || s.phase !== 'play' || s.result || !valid(p) || !Number.isInteger(k) || !fits(ship, k)) return null;
  const fleet = withAt(s.fleets[p], k, { x: ship.x, y: ship.y, dir: ship.dir });
  return step(s, { fleets: withAt(s.fleets, p, fleet), open: withAt(s.open, p, note(s.open[p])) }, [{ type: 'move', by: p }]);
}

const same = (a, b) => a.x === b.x && a.y === b.y && a.dir === b.dir;

// Alle Verstöße von p seit der letzten Anklage gegen ihn
function faults(s, p) {
  const moved = s.fleets[p].flatMap((ship, k) => (same(ship, s.home[p][k]) ? [] : [`${FLEET[k].name} verschoben`]));
  if (s.open[p].why.length || moved.length) return [...s.open[p].why, ...moved];
  // Schiff weg- und wieder zurückgeschoben: Antworten aus der Zwischenzeit passen nicht zur Flotte (Wasser/Treffer, Schiff)
  return s.shots[1 - p].flatMap((t) => {
    if (t.res === null) return [];
    const k = shipAt(s.fleets[p], t.x, t.y);
    if ((k < 0 ? null : k) === t.ship) return [];
    return [`auf ${cellName(t.x, t.y)} „${answerText(t)}“ statt „${answerText(k < 0 ? { res: 'wasser' } : { res: 'treffer', ship: k })}“ gesagt`];
  });
}

// Hat p seit der letzten Anklage gegen ihn geschummelt? (allein: so prüft der Computer, schummeln.js)
export const cheated = (s, p) => !!(s.free && s.open?.[p] && faults(s, p).length);

// Allein: Der Computer ruft am Ende nicht – die Frist des Menschen ist zu (sonst blockiert sie die Revanche)
export function waive(s, by) {
  if (!s.free || !valid(by) || !s.open?.[1 - by]) return null;
  return { ...s, open: withAt(s.open, 1 - by, null), seq: s.seq + 1, events: [] };
}

// Grund für die Meldung: höchstens zwei Verstöße, mit „ und “ verbunden (mehr: „ … und mehr“)
export const whyText = (why) => why.slice(0, 2).join(' und ') + (why.length > 2 ? ' und mehr' : '');

// „Geschummelt!“ von q gegen den anderen – geht, solange der seit der letzten Anklage etwas getan hat. rng: für das
// Neu-Legen übereinander aufgestellter Schiffe.
export function accuse(s, q, rng = Math.random) {
  if (!s.free || s.phase !== 'play' || !valid(q) || !s.open[1 - q]) return null;
  const p = 1 - q;
  const why = faults(s, p);
  const caught = why.length > 0;
  const guilty = caught ? p : q;
  const base = caught ? correct(s, p, rng) : s;
  const strikes = s.strikes.map((n, k) => (k === guilty ? n + 1 : n));
  let result = base.result;
  if (caught && s.result?.winner === p) result = { winner: q, reason: 'aberkannt' }; // mit Schummeln gewonnen
  if (!result && strikes[guilty] >= MAX_STRIKES) result = { winner: 1 - guilty, reason: 'schummeln' };
  const verdict = { caught, player: guilty, by: q, ...(caught && { why: whyText(why) }) };
  return { ...base, strikes, result, open: withAt(s.open, p, null), verdict, seq: s.seq + 1, events: [{ type: caught ? 'caught' : 'fehlalarm', ...verdict }] };
}

// Erwischt: Flotte von p zurück auf den letzten geprüften Stand (übereinander Liegendes neu verteilt), seine Extraschüsse
// raus, alle Antworten auf die Schüsse des anderen nach der Wahrheit berichtigt
function correct(s, p, rng) {
  const q = 1 - p;
  const fleet = unstack(s.home[p], s.shots[q], rng);
  const extra = new Set(s.open[p].extra.map(([x, y]) => key(x, y)));
  const mine = s.shots[p].filter((t) => !extra.has(key(t.x, t.y)));
  const pending = s.pending && !(s.pending.by === p && extra.has(key(s.pending.x, s.pending.y))) ? s.pending : null;
  const theirs = s.shots[q].map((t, i) => {
    const truth = judge(fleet, s.shots[q].slice(0, i), t.x, t.y);
    return t.res === null ? { ...t, truth } : { ...t, ...truth, truth };
  });
  const shots = p === 0 ? [mine, theirs] : [theirs, mine];
  let result = s.result?.winner === q ? s.result : null; // ein Sieg des anderen bleibt
  if (!result && allSunk(fleet, theirs.filter((t) => t.res !== null))) result = { winner: q, reason: 'flotte' };
  // wer dran ist, bleibt (ein Extraschuss hat den Zug schon an den anderen gegeben)
  return { ...s, fleets: withAt(s.fleets, p, fleet), home: withAt(s.home, p, fleet), shots, pending: result ? null : pending, result };
}

// Übereinanderliegende Schiffe neu legen: auf freie Felder, auf die der andere noch nicht geschossen hat
function unstack(fleet, shots, rng) {
  if (!overlaps(fleet)) return fleet;
  const used = new Set(shots.map((t) => key(t.x, t.y)));
  const out = [];
  for (const [k, ship] of fleet.entries()) {
    const cells = cellsOf(ship, k).map(([x, y]) => key(x, y));
    const free = (c) => !out.some((o, j) => cellsOf(o, j).some(([x, y]) => key(x, y) === c));
    const next = cells.every(free) ? ship : placeOne(k, new Set([...used, ...out.flatMap((o, j) => cellsOf(o, j).map(([x, y]) => key(x, y)))]), rng)
      ?? placeOne(k, new Set(out.flatMap((o, j) => cellsOf(o, j).map(([x, y]) => key(x, y)))), rng);
    out.push(next);
  }
  return out;
}

// Siege einschließlich der laufenden, beendeten Partie
export const score = (s) => s.wins.map((n, p) => n + (s.result?.winner === p ? 1 : 0));

// Revanche: der andere schießt zuerst, die Siege zählen weiter. Ohne Hilfen startet der Sieger sie nicht, solange er
// noch erwischt werden kann – der andere darf (er verzichtet damit).
export function again(s, by) {
  if (!s.result || !valid(by) || (s.free && s.open[by] && s.result.winner === by)) return null;
  return newGame({ starter: 1 - s.starter, free: !!s.free, wins: score(s), round: (s.round ?? 1) + 1 });
}

// Was Spieler p sehen darf: die fremde Flotte erst am Ende, die Wahrheit hinter gelogenen Antworten auch erst dann,
// verschobene Schiffe des anderen gar nicht. ready = wer schon aufgestellt hat.
export function viewFor(s, p) {
  const over = !!s.result;
  const v = {
    ...s,
    fleets: s.fleets.map((f, i) => (i === p || over ? f : null)),
    ready: s.fleets.map(Boolean),
    shots: s.shots.map((list) => list.map(({ truth, ...t }) => (over && truth ? { ...t, truth } : t))),
    events: s.events.filter((e) => !(e.type === 'move' && e.by !== p)),
  };
  if (!s.free) return v;
  delete v.home;
  return { ...v, open: s.open.map((r) => (r ? {} : null)) };
}
