// Mäxchen für 2–4 Spieler als reine Funktionen. Der Host hält den vollen Spielstand: Jede Aktion liefert einen neuen
// Zustand oder null (ungültig). Sitze 0–3 im Uhrzeigersinn wie bei Doppelkopf: 0 = Host (+z), 1 = links (−x),
// 2 = gegenüber (−z, der Gast), 3 = rechts (+x). Freie Sitze spielt der Computer. Jeder sieht nur viewFor(state, sitz).
//
// Regeln (de.wikipedia.org/wiki/Mäxchen, abgerufen 20.10.2026): zwei Würfel verdeckt unter dem Becher, die höhere Zahl
// ist die Zehnerstelle. Rangfolge 31 < 32 < 41 < … < 65 < Einerpasch < … < Sechserpasch < 21 (Mäxchen). Wer würfelt,
// schaut heimlich und sagt einen Wert an – auch gelogen –, der höher sein muss als die Ansage davor. Der Nächste glaubt
// (und würfelt dann selbst, ohne nachzusehen) oder deckt auf: Ist der Wurf mindestens so hoch wie angesagt, verliert
// der Zweifler, sonst der Ansager. Die neue Runde beginnt, wer die alte gewonnen hat (Wikipedia: Grundvariante).
// Leben wie beim dänischen „Meier“ (en.wikipedia.org/wiki/Mia_(game)): jeder hat 6, wer keins mehr hat, scheidet aus;
// den Mäxchen darf man ohne Aufdecken glauben und verliert dann 1 Leben. Nicos Vorgabe (20.10.2026): Geht es beim
// Aufdecken um ein angesagtes Mäxchen, verliert der Verlierer doppelt (2 Leben) – egal ob Lügner oder Zweifler.
//
// „Ohne Hilfen“ (free): Lügen gehört zum Spiel und ist kein Schummeln. Schummeln ist (vermerkt, sieht nur der Host):
// eine Ansage, die nicht höher ist als die davor ('low'), nach dem Ansehen nochmal würfeln ('reroll') und vor dem
// Glauben/Aufdecken unter den Becher des Vorgängers linsen ('peek'). Wer „Geschummelt!“ ruft, wählt einen Spieler: Hat
// der in dieser Runde (bzw. der eben aufgedeckten, solange noch keiner neu gewürfelt hat) geschummelt, verliert er
// 1 Leben, sonst der Rufer (Fehlalarm). Danach beginnt eine neue Runde beim, der nicht verloren hat.

export const LIVES = 6;
export const SEATS = [0, 1, 2, 3];
export const MAEXCHEN = 21;
// alle Werte, die man ansagen kann – vom niedrigsten zum höchsten
export const CLAIMS = [31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65, 11, 22, 33, 44, 55, 66, 21];
const RANK = new Map(CLAIMS.map((v, i) => [v, i]));
export const rankOf = (v) => RANK.get(v) ?? -1;
export const isClaim = (v) => RANK.has(v);
// [3, 5] → 53 · [1, 2] → 21 · [4, 4] → 44
export const valueOf = ([a, b]) => Math.max(a, b) * 10 + Math.min(a, b);
const isDie = (d) => Number.isInteger(d) && d >= 1 && d <= 6;
const PASCH = ['', 'Einer', 'Zweier', 'Dreier', 'Vierer', 'Fünfer', 'Sechser'];
export const claimName = (v) => (v === MAEXCHEN ? 'Mäxchen' : v % 11 === 0 ? `${PASCH[v / 11]}pasch` : String(v));
export const higher = (v, than) => than === null || than === undefined || rankOf(v) > rankOf(than);
// Wahrscheinlichkeit, genau diesen Wert zu würfeln (36 gleich wahrscheinliche Würfe)
export const chanceOf = (v) => (v % 11 === 0 ? 1 : 2) / 36;
export const CHEAT_NAMES = { low: 'nicht höher angesagt', reroll: 'heimlich nachgewürfelt', peek: 'unter den Becher gelinst' };

export const alive = (s) => s.seats.filter((p) => s.lives[p] > 0);
export const lastClaim = (s) => s.claims.at(-1) ?? null;
// nächster Sitz im Uhrzeigersinn, der noch Leben hat
export function nextAlive(s, seat) {
  for (let k = 1; k <= 4; k++) {
    const p = (seat + k) % 4;
    if (s.seats.includes(p) && s.lives[p] > 0) return p;
  }
  return seat;
}

// --- Neues Spiel ---
// seats = Sitze am Tisch (2–4), humans = Sitze der Menschen (Host 0, Gast 2) – fürs Spielende und die Anzeige
export function newGame({ seats = SEATS, humans = [0], free = false, lives = LIVES, starter = null, seq = 0, games = 1 } = {}, rng = Math.random) {
  const first = starter ?? seats[Math.floor(rng() * seats.length)];
  return {
    seq,
    events: [{ type: 'start', player: first }],
    games,
    seats: [...seats],
    humans: [...humans],
    free,
    lives: [0, 1, 2, 3].map((p) => (seats.includes(p) ? lives : 0)),
    round: 1,
    phase: 'roll', // roll → announce → decide → (roll …) – bis jemand aufdeckt; 'over' am Ende
    turn: first,
    claims: [], // Ansagen dieser Runde: { by, value }
    dice: null, // Würfel unter dem Becher
    roller: null, // wer sie gewürfelt hat
    rolls: 0, // wie oft der Spieler am Zug in diesem Zug gewürfelt hat
    peeked: [], // wer heimlich unter den Becher geschaut hat
    shown: null, // aufgedeckter Wurf { dice, by } – bleibt liegen, bis neu gewürfelt wird
    cheats: [], // ohne Hilfen: { player, kind, seq }
    out: [], // ausgeschieden, in dieser Reihenfolge
    winner: null,
  };
}

const bump = (s, events, extra) => ({ ...s, ...extra, seq: s.seq + 1, events });
const turnOf = (s, seat, phase) => s.phase === phase && s.turn === seat;

// --- Würfeln (Augenzahlen kommen aus der Physik dessen, der würfelt) ---
// Am Zug in Phase 'roll'. Ohne Hilfen auch nochmal nach dem Ansehen (Phase 'announce') – das ist Schummeln.
export function roll(s, seat, dice) {
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every(isDie)) return null;
  const again = turnOf(s, seat, 'announce');
  if (!turnOf(s, seat, 'roll') && !(again && s.free)) return null;
  const fresh = !s.claims.length && !again; // erster Wurf einer neuen Runde: alte Schummeleien sind verjährt
  const cheats = fresh ? [] : again ? [...s.cheats, { player: seat, kind: 'reroll', seq: s.seq + 1 }] : s.cheats;
  return bump(s, [{ type: 'roll', player: seat, again }], {
    phase: 'announce', dice: [...dice], roller: seat, rolls: s.rolls + 1, peeked: [], shown: null, cheats,
  });
}

// --- Ansagen: muss höher sein als die Ansage davor (ohne Hilfen geht auch das durch – Schummeln) ---
export function announce(s, seat, value) {
  if (!turnOf(s, seat, 'announce') || !isClaim(value)) return null;
  const prev = lastClaim(s)?.value ?? null;
  const low = !higher(value, prev);
  if (low && !s.free) return null;
  const cheats = low ? [...s.cheats, { player: seat, kind: 'low', seq: s.seq + 1 }] : s.cheats;
  return bump(s, [{ type: 'announce', player: seat, value }], {
    phase: 'decide', turn: nextAlive(s, seat), claims: [...s.claims, { by: seat, value }], rolls: 0, peeked: [], cheats,
  });
}

// --- Glauben: dann würfelt man selbst (ohne nachzusehen). Den Mäxchen kann niemand überbieten – nur ohne Hilfen. ---
export function believe(s, seat) {
  if (!turnOf(s, seat, 'decide')) return null;
  if (lastClaim(s).value === MAEXCHEN && !s.free) return null;
  return bump(s, [{ type: 'believe', player: seat }], { phase: 'roll' });
}

// --- Aufdecken ---
export function doubt(s, seat) {
  if (!turnOf(s, seat, 'decide')) return null;
  const claim = lastClaim(s);
  const value = valueOf(s.dice);
  const truth = rankOf(value) >= rankOf(claim.value);
  const loser = truth ? seat : claim.by;
  const lost = claim.value === MAEXCHEN ? 2 : 1;
  const event = { type: 'doubt', player: seat, claimer: claim.by, value: claim.value, dice: [...s.dice], truth, loser, lost };
  return endRound({ ...s, shown: { dice: [...s.dice], by: s.roller } }, [event], loser, lost, truth ? claim.by : seat);
}

// --- Mäxchen ohne Aufdecken glauben: 1 Leben weg, der Ansager beginnt ---
export function accept(s, seat) {
  if (!turnOf(s, seat, 'decide') || lastClaim(s).value !== MAEXCHEN) return null;
  const claimer = lastClaim(s).by;
  return endRound(s, [{ type: 'accept', player: seat, claimer }], seat, 1, claimer);
}

// --- Ohne Hilfen: heimlich unter den Becher schauen, bevor man glaubt oder aufdeckt (bzw. nach dem Glauben würfelt) ---
export function peek(s, seat) {
  if (!s.free || s.turn !== seat || !s.dice || !s.claims.length || s.roller === seat || s.peeked.includes(seat)) return null;
  if (s.phase !== 'decide' && s.phase !== 'roll') return null;
  return bump(s, [{ type: 'peek', player: seat }], {
    peeked: [...s.peeked, seat], cheats: [...s.cheats, { player: seat, kind: 'peek', seq: s.seq + 1 }],
  });
}

// --- Ohne Hilfen: „Geschummelt!“ gegen einen Mitspieler ---
// Auch nach Spielende (die letzte Runde kann ja durch Schummeln entschieden sein) – dann zählt das Urteil obendrauf
// und Sieger/Spielende werden neu bestimmt; ausgeschiedene Menschen dürfen dann noch rufen und angeklagt werden.
export function accuse(s, by, target) {
  if (!s.free || by === target || !s.seats.includes(by) || !s.seats.includes(target)) return null;
  if (s.phase !== 'over' && (!alive(s).includes(by) || !alive(s).includes(target))) return null;
  const kinds = [...new Set(s.cheats.filter((c) => c.player === target).map((c) => c.kind))];
  const caught = kinds.length > 0;
  const loser = caught ? target : by;
  const event = caught ? { type: 'caught', player: target, by, kinds } : { type: 'fehlalarm', player: by, target };
  return endRound({ ...s, cheats: [], waived: false }, [event], loser, 1, caught ? by : target);
}

// Allein nach Spielende: Der Computer hat die letzte Runde geprüft und lässt sie gelten
export const waive = (s) => (s.free && s.phase === 'over' && !s.waived ? { ...s, waived: true } : null);

const cleared = { claims: [], dice: null, roller: null, rolls: 0, peeked: [] }; // was nicht aufgedeckt wurde, bleibt geheim

// Runde vorbei: loser verliert lost Leben, starter beginnt die nächste (ist er draußen, sein Nächster)
function endRound(s, events, loser, lost, starter) {
  const lives = s.lives.map((x, p) => (p === loser ? Math.max(0, x - lost) : x));
  const gone = s.lives[loser] > 0 && lives[loser] === 0;
  const out = gone ? [...s.out, loser] : s.out;
  const all = [...events, ...(gone ? [{ type: 'out', player: loser }] : [])];
  const next = { ...s, lives, out };
  const left = alive(next);
  if (left.length <= 1 || !left.some((p) => s.humans.includes(p))) {
    const winner = left.length === 1 ? left[0] : null;
    return bump(next, [...all, { type: 'over', winner }], { phase: 'over', turn: null, winner, ...cleared });
  }
  return bump(next, all, { phase: 'roll', turn: lives[starter] > 0 ? starter : nextAlive(next, starter), round: s.round + 1, ...cleared });
}

// Nächste Partie: es beginnt der Sieger der letzten (sonst ein zufälliger Spieler). Wer in der letzten Runde
// geschummelt hat, startet sie nicht selbst, solange man ihn noch erwischen kann: allein, bis der Computer geprüft hat
// (waive), zu zweit startet der andere Mensch (und verzichtet damit) – wie bei Doppelkopf.
export function again(s, player, rng = Math.random) {
  if (s.phase !== 'over') return null;
  const watched = s.humans.length === 1 ? !s.waived : s.humans.some((p) => p !== player);
  if (s.free && watched && s.cheats.some((c) => c.player === player)) return null;
  return newGame({ seats: s.seats, humans: s.humans, free: s.free, starter: s.winner, seq: s.seq + 1, games: s.games + 1 }, rng);
}

// Kann seat diese Würfel gerade sehen? Wer gewürfelt hat, wer gelinst hat – und alle, wenn aufgedeckt ist
export const seesDice = (s, seat) => !!s.dice && (s.roller === seat || s.peeked.includes(seat));

// --- Sicht eines Spielers ---
// Verdeckte Würfel nur für den, der sie gewürfelt oder gelinst hat; Schummeleien kennt nur der Host. Wie oft der
// andere gewürfelt hat, sieht man am Tisch (der Becher wackelt zweimal), aber nicht im Spielstand.
export function viewFor(s, seat) {
  return {
    ...s,
    dice: seesDice(s, seat) ? s.dice : null,
    rolls: s.turn === seat ? s.rolls : 0,
    peeked: s.peeked.filter((p) => p === seat),
    cheats: [],
    events: s.events.filter((e) => e.type !== 'peek' || e.player === seat).map((e) => (e.type === 'roll' && e.player !== seat ? { ...e, again: false } : e)),
  };
}
