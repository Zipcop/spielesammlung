// Memory als reine Funktionen (kein DOM, kein three.js). Der Host hält den vollen Spielstand: Jede Aktion liefert einen
// neuen Zustand oder null (ungültig). Spieler 0 = Host, 1 = Gast bzw. Computer. Jeder sieht nur viewFor(state, p).
//
// Regeln nach der Ravensburger-Anleitung „memory®“ (Grundregel, z. B. Spielanleitung 21204 auf ravensburger.de):
// Alle Kärtchen liegen gut gemischt verdeckt aus. Wer dran ist, deckt zwei auf. Zwei gleiche: Er behält das Paar und
// deckt gleich noch zwei auf. Zwei verschiedene: Sie werden wieder umgedreht, der Nächste ist dran. Wer am Ende die
// meisten Paare hat, gewinnt.
//
// Eigene Festlegungen: Größe (12, 18 oder 24 Paare) und Motiv-Satz wählt der Host vor dem Austeilen. Gleich viele Paare
// = Remis. Zwei verschiedene Kärtchen bleiben offen liegen, bis der Nächste sein erstes Kärtchen aufdeckt (so sehen
// beide sie in Ruhe) – dann drehen sie sich von selbst um. Bei der Revanche fängt der andere an, die Siege zählen weiter.
//
// „Ohne Hilfen“ (free): Ein Paar wandert weiter von selbst zum Spieler, nach zwei verschiedenen Kärtchen drückt er aber
// selbst „Weiter“ (dreht sie um, der andere ist dran). Dazu gehen drei Schummeleien: heimlich unter ein Kärtchen linsen
// (nur er sieht das Motiv, der andere sieht das Kärtchen kurz hochkommen), ein drittes Kärtchen aufdecken und zwei
// verschiedene Kärtchen als Paar einstecken. Ob etwas regelwidrig war, weiß nur der Host (cheat, mit kurzem Grund).
// Bis der andere selbst etwas tut (aufdecken, linsen, „Weiter“), kann er „Geschummelt!“ rufen (accuse): Stimmt es, wird alles seit dem
// ersten Schummeln zurückgenommen (Kärtchen wieder verdeckt an ihrem Platz), der Schummler gibt ein Paar an den Ankläger
// ab und der Ankläger ist dran. Fehlalarm: Der Ankläger gibt ein Paar ab (wer noch keins hat, gibt nichts).
import { shuffle } from '../karten/cards.js';
import { rematchBlocked } from '../schummeln.js';

export const SIZES = [12, 18, 24]; // Paare
export const GRID = { 12: [6, 4], 18: [6, 6], 24: [8, 6] }; // Spalten × Reihen

// Motiv-Sätze: je 24 Motive (Namen für den Verlauf), gezeichnet in motifs.js
export const SETS = {
  tiere: {
    name: 'Tiere',
    items: ['Katze', 'Hund', 'Maus', 'Schwein', 'Bär', 'Fuchs', 'Hase', 'Eule', 'Frosch', 'Löwe', 'Panda', 'Kuh',
      'Küken', 'Pinguin', 'Fisch', 'Marienkäfer', 'Schnecke', 'Biene', 'Elefant', 'Affe', 'Schaf', 'Igel', 'Schildkröte', 'Schmetterling'],
  },
  obst: {
    name: 'Obst & Gemüse',
    items: ['Apfel', 'Birne', 'Kirschen', 'Banane', 'Weintrauben', 'Erdbeere', 'Zitrone', 'Orange', 'Wassermelone', 'Ananas',
      'Karotte', 'Pilz', 'Tomate', 'Paprika', 'Pflaume', 'Kiwi', 'Mais', 'Aubergine', 'Brokkoli', 'Avocado', 'Zwiebel',
      'Erbsenschote', 'Radieschen', 'Kürbis'],
  },
  formen: {
    name: 'Formen',
    items: ['roter Kreis', 'blauer Kreis', 'grüner Kreis', 'rotes Quadrat', 'blaues Quadrat', 'grünes Quadrat',
      'rotes Dreieck', 'blaues Dreieck', 'grünes Dreieck', 'roter Stern', 'blauer Stern', 'grüner Stern',
      'rotes Herz', 'blaues Herz', 'grünes Herz', 'rote Raute', 'blaue Raute', 'grüne Raute',
      'roter Mond', 'blauer Mond', 'grüner Mond', 'roter Tropfen', 'blauer Tropfen', 'grüner Tropfen'],
  },
};
export const SET_KEYS = Object.keys(SETS);
export const motifName = (set, m) => SETS[set]?.items[m] ?? '?';

const isPlayer = (p) => p === 0 || p === 1;

// --- Neue Partie: erst wählt der Host Größe und Motive (setup), dann wird ausgeteilt ---
// wins = Siege aus früheren Partien · round = Nummer der letzten Partie · starter = wer die nächste anfängt
export function newGame({ free = false, seq = 0, wins = [0, 0], round = 0, starter = 0, size = 18, set = 'tiere' } = {}) {
  const s = {
    seq,
    events: [{ type: 'setup' }],
    phase: 'setup', // setup → play → over
    size, // Paare
    set,
    starter,
    turn: null,
    tiles: [], // Motiv je Platz (0 … size−1, jedes zweimal)
    owner: [], // je Platz: wer das Kärtchen eingesteckt hat (null = liegt noch)
    piles: [[], []], // eingesteckte Plätze je Spieler, der Reihe nach (immer zwei = ein Paar)
    open: [], // in diesem Zug aufgedeckt
    shown: [], // zwei verschiedene aus dem letzten Zug – drehen sich beim nächsten Aufdecken um
    result: null, // { winner: 0 | 1 | null, pairs: [a, b] }
    wins: [...wins],
    round,
  };
  return free ? { ...s, free: true, cheat: null, verdict: null } : s;
}

// Größe und Motive wählen (nur der Host) – gleich danach wird ausgeteilt
export function setup(s, by, { size, set } = {}, rng = Math.random) {
  if (s.phase !== 'setup' || by !== 0 || !SIZES.includes(size) || !SETS[set]) return null;
  return deal({ ...s, size, set }, rng);
}

function deal(s, rng) {
  const tiles = shuffle([...Array(s.size).keys(), ...Array(s.size).keys()], rng);
  return {
    ...s,
    phase: 'play',
    round: s.round + 1,
    turn: s.starter,
    tiles,
    owner: tiles.map(() => null),
    piles: [[], []],
    open: [],
    shown: [],
    result: null,
    ...(s.free && { cheat: null, verdict: null }),
    seq: s.seq + 1,
    events: [{ type: 'deal', starter: s.starter }],
  };
}

export const pairsOf = (s, p) => s.piles[p].length / 2;
export const left = (s) => s.owner.filter((o) => o === null).length;
const onTable = (s, i) => Number.isInteger(i) && i >= 0 && i < s.tiles.length && s.owner[i] === null;

// --- Aktionen ---
// Kärtchen i aufdecken. Das erste Aufdecken eines Zugs dreht die offenen vom letzten Zug wieder um.
export function flip(s, by, i) {
  if (s.phase !== 'play' || by !== s.turn || !onTable(s, i) || s.open.includes(i)) return null;
  const why = [];
  if (s.open.length >= 2) why.push('ein drittes Kärtchen aufgedeckt');
  if (why.length && !s.free) return null;
  const events = [];
  if (s.shown.length) events.push({ type: 'cover', tiles: s.shown });
  events.push({ type: 'flip', by, i, motif: s.tiles[i] });
  let next = { ...s, shown: [], open: [...s.open, i], seq: s.seq + 1, events };
  const j = s.open.find((k) => s.tiles[k] === s.tiles[i]);
  if (j !== undefined) next = take(next, by, [j, i], 'pair');
  else if (next.open.length === 2 && !s.free) {
    // zwei verschiedene: bleiben offen liegen, der andere ist dran
    next = { ...next, turn: 1 - by, open: [], shown: next.open, events: [...next.events, { type: 'miss', by }] };
  }
  return s.free ? { ...next, cheat: record(s, by, why), verdict: null } : next;
}

// Ohne Hilfen: nach zwei verschiedenen Kärtchen „Weiter“ – die offenen drehen sich um, der andere ist dran
export function pass(s, by) {
  if (!s.free || s.phase !== 'play' || by !== s.turn) return null;
  const why = [];
  if (s.open.length < 2) why.push(s.open.length ? 'nur ein Kärtchen aufgedeckt' : 'kein Kärtchen aufgedeckt');
  const covered = [...s.shown, ...s.open];
  const next = { ...s, turn: 1 - by, open: [], shown: [], seq: s.seq + 1, events: [{ type: 'pass', by, tiles: covered }] };
  return { ...next, cheat: record(s, by, why), verdict: null };
}

// Ohne Hilfen: die zwei offenen Kärtchen als Paar einstecken – sind sie verschieden, ist es geschummelt
export function pocket(s, by) {
  if (!s.free || s.phase !== 'play' || by !== s.turn || s.open.length !== 2) return null;
  const [a, b] = s.open;
  const why = s.tiles[a] === s.tiles[b] ? [] : [`zwei verschiedene Kärtchen als Paar eingesteckt (${motifName(s.set, s.tiles[a])} und ${motifName(s.set, s.tiles[b])})`];
  const next = take({ ...s, shown: [], seq: s.seq + 1, events: [] }, by, [a, b], 'pocket');
  return { ...next, cheat: record(s, by, why), verdict: null };
}

// Ohne Hilfen: heimlich unter ein verdecktes Kärtchen linsen (nur in viewFor des Linsenden steht das Motiv)
export function peek(s, by, i) {
  if (!s.free || s.phase !== 'play' || by !== s.turn || !onTable(s, i) || s.open.includes(i) || s.shown.includes(i)) return null;
  const next = { ...s, seq: s.seq + 1, events: [{ type: 'peek', by, i, motif: s.tiles[i] }] };
  return { ...next, cheat: record(s, by, ['heimlich unter ein Kärtchen gelinst']), verdict: null };
}

// Paar einstecken: die Plätze gehören by, er ist nochmal dran. Lässt sich kein Paar mehr bilden (nur nach Schummeln
// möglich – oder alles ist weg), ist die Partie vorbei.
function take(s, by, pair, type) {
  const owner = s.owner.map((o, k) => (pair.includes(k) ? by : o));
  const piles = s.piles.map((pl, p) => (p === by ? [...pl, ...pair] : pl));
  const next = { ...s, owner, piles, open: s.open.filter((k) => !pair.includes(k)), events: [...s.events, { type, by, tiles: pair }] };
  return canPair(next) ? next : finish(next);
}

// Liegen noch zwei gleiche auf dem Tisch?
function canPair(s) {
  const seen = new Set();
  for (let k = 0; k < s.tiles.length; k++) {
    if (s.owner[k] !== null) continue;
    if (seen.has(s.tiles[k])) return true;
    seen.add(s.tiles[k]);
  }
  return false;
}

const outcome = (s) => {
  const pairs = [pairsOf(s, 0), pairsOf(s, 1)];
  return { winner: pairs[0] === pairs[1] ? null : pairs[0] > pairs[1] ? 0 : 1, pairs };
};

function finish(s) {
  return { ...s, phase: 'over', turn: null, result: outcome(s), events: [...s.events, { type: 'over' }] };
}

// --- Ohne Hilfen: Anklage-Frist ---
// Offene Frist des Spielers: Macht er weiter (nächstes Kärtchen, Paar …), läuft sie weiter; prev = Stand vor dem ersten
// Schummel-Schritt. why = versteckter Grund (nur beim Host, viewFor entfernt ihn).
function record(s, by, why) {
  const clean = { ...s, cheat: null, verdict: null };
  const c = s.cheat?.player === by ? s.cheat : null;
  if (!c) return { player: by, legal: !why.length, why, prev: clean };
  return { player: by, legal: c.legal && !why.length, why: [...new Set([...c.why, ...why])], prev: c.legal ? clean : c.prev };
}

// Grund für die Meldung: höchstens zwei Verstöße, mit „ und “ verbunden
export const whyText = (why) => why.slice(0, 2).join(' und ');

// Ein Paar (das zuletzt eingesteckte) von from an to – wer keins hat, gibt nichts
function give(s, from, to) {
  if (!s.piles[from].length) return { s, tiles: null };
  const pair = s.piles[from].slice(-2);
  const piles = s.piles.map((pl, p) => (p === from ? pl.slice(0, -2) : p === to ? [...pl, ...pair] : pl));
  const owner = s.owner.map((o, k) => (pair.includes(k) ? to : o));
  return { s: { ...s, piles, owner }, tiles: pair };
}

// „Geschummelt!“ – nur gegen den anderen, solange seine Frist offen ist
export function accuse(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !isPlayer(by)) return null;
  const guilty = c.legal ? by : c.player;
  let base = c.legal ? s : { ...c.prev, open: [], shown: [], turn: by }; // erwischt: alles zurück, der Ankläger ist dran
  const gift = give(base, guilty, 1 - guilty);
  base = gift.s;
  if (base.phase === 'over') base = { ...base, result: outcome(base) };
  const verdict = { caught: !c.legal, player: guilty, by, gift: gift.tiles, ...(!c.legal && { why: whyText(c.why) }) };
  const covered = c.legal ? [] : [...new Set([...s.open, ...s.shown])];
  return { ...base, cheat: null, verdict, seq: s.seq + 1, events: [{ type: c.legal ? 'fehlalarm' : 'caught', ...verdict, covered }] };
}

// Allein: Der Computer ruft nicht – die Frist ist zu (sonst blockiert rematchBlocked die Revanche)
export function waive(s, by) {
  const c = s.cheat;
  if (!s.free || !c || c.player === by || !isPlayer(by)) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// Siege einschließlich der laufenden, beendeten Partie
export const score = (s) => s.wins.map((n, p) => n + (s.result?.winner === p ? 1 : 0));

// Revanche: gleiche Größe und Motive, der andere fängt an, die Siege zählen weiter.
// Wer noch erwischt werden kann, startet sie nicht selbst.
export function again(s, by, rng = Math.random) {
  if (s.phase !== 'over' || !isPlayer(by) || rematchBlocked(s, by)) return null;
  return deal({ ...newGame({ free: !!s.free, seq: s.seq, wins: score(s), round: s.round, starter: 1 - s.starter, size: s.size, set: s.set }) }, rng);
}

// Andere Größe oder Motive (nur der Host): zurück zur Auswahl, die Siege zählen weiter
export function regroup(s, by) {
  if (s.phase !== 'over' || by !== 0 || rematchBlocked(s, by)) return null;
  return newGame({ free: !!s.free, seq: s.seq + 1, wins: score(s), round: s.round, starter: 1 - s.starter, size: s.size, set: s.set });
}

// Was Spieler p sehen darf: Motive nur von offenen und eingesteckten Kärtchen (am Ende alle), beim Linsen nur der
// Linsende. Vom anfechtbaren Zug nur, wer ihn gemacht hat.
export function viewFor(s, p) {
  const visible = (k) => s.phase === 'over' || s.owner[k] !== null || s.open.includes(k) || s.shown.includes(k);
  return {
    ...s,
    tiles: s.tiles.map((m, k) => (visible(k) ? m : null)),
    events: s.events.map((e) => (e.type === 'peek' && e.by !== p ? { ...e, motif: null } : e)),
    ...(s.free && { cheat: s.cheat && { player: s.cheat.player } }),
  };
}
