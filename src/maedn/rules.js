// Mensch ärgere Dich nicht für vier Farben als reine Funktionen. Der Host hält den Spielstand:
// Jede Aktion liefert einen neuen Zustand oder null (ungültig, z. B. nicht dran oder Figur darf nicht ziehen).
//
// Regeln nach der Schmidt-Spiele-Anleitung („Das beliebte Original“, Ausgabe 110 Jahre, Art. 49277):
// - Jeder hat 4 Figuren: eine steht zu Beginn auf dem eigenen A-Feld (Startfeld), drei auf den B-Feldern (Haus).
// - Reihum im Uhrzeigersinn würfeln und eine eigene Figur um die Augenzahl vorziehen. Eigene und fremde
//   Figuren dürfen übersprungen werden. Wer genau auf einer fremden Figur landet, schlägt sie (sie geht zurück
//   auf ihr B-Feld). Laut Grundregel kein Schlagzwang (hier aber Hausregel, siehe unten). Auf einem Feld steht immer
//   nur eine Figur – auf eine eigene darf man nicht.
// - Aus dem Haus nur mit einer 6 aufs A-Feld. Solange noch Figuren im Haus warten, muss das A-Feld frei gemacht
//   werden, sobald es geht (auch mit einer 6).
// - Nach einer 6 darf man nach dem Zug nochmal würfeln – nicht, wenn die 6 nicht gezogen werden konnte,
//   und nicht, wenn damit die letzte Figur ins Ziel kam.
// - Nach einer ganzen Runde geht es in die eigenen Zielfelder a–d, nur mit passendem Wurf. Im Ziel darf
//   übersprungen werden. Kann keine Figur ziehen, verfällt der Zug.
// - Wer zuerst alle 4 Figuren im Ziel hat, gewinnt; die anderen dürfen um die nächsten Plätze weiterspielen.
// Dazu die Spielvariante „Dreimal würfeln“ aus derselben Anleitung: Wer keine Figur auf der Laufbahn hat und
// im Ziel nicht mehr vorrücken kann, darf bis zu dreimal würfeln, um eine 6 zu bekommen.
// Hausregeln (Nico 19.10.2026): Bei einer 6 darf man wählen – neue Figur heraus oder eine andere ziehen (die
// Anleitung schreibt das Herauskommen vor). Schlagzwang (Variante der Anleitung): Kann eine Figur schlagen, muss
// geschlagen werden – das geht allen anderen Pflichten vor (Anleitung: „wann immer es möglich ist“).
// Ohne Hilfen gilt ein nicht genutzter Schlag als Regelverstoß, den der andere anprangern kann.
// Farbwahl: Jeder Mensch sucht sich vorher eine Farbe aus (pick). Der Host sitzt immer auf Sitz 0; die Farben
// liegen wie auf dem Brett reihum, also wird das Brett so gedreht, dass seine Farbe vor ihm liegt (colors).
//
// „Ohne Hilfen“ (free): Nach dem Wurf darf ein Mensch jede eigene Figur auf ein beliebiges Feld voraus setzen
// (move mit { piece, to }). Nichts geschieht von selbst: Auch ohne passenden Wurf zieht er selbst oder gibt weiter
// (pass), und nochmal würfeln geht jederzeit – war es nicht erlaubt, gilt der Rest des Zugs als geschummelt (tainted).
// Bis der andere Mensch selbst würfelt, kann er „Geschummelt!“ rufen (accuse) – ist er fertig oder setzt aus, bis sein
// Zug übersprungen wird. Stimmt es, gehen die regelwidrig gezogenen Figuren zurück ins Haus, von ihnen
// geschlagene Figuren zurück auf ihr Feld (wenn es frei ist), und ein laufender Zug des Schummlers ist vorbei.
// Fehlalarm: Der Ankläger setzt einmal aus.
// Zu zweit ziehen die Computer immer regelgerecht und rufen nicht. Allein (ein Mensch, Nico 20.10.2026) schummeln die
// Computer selbst (move mit { piece, to }) und prangern an: Ihre Züge sammeln sich bis zum nächsten Wurf des Menschen,
// den Zug des Menschen prüft der Computer, der als Nächster würfelt (nach Spielende: waive oder accuse).
//
// Plätze (Sitz 0–3) reihum im Uhrzeigersinn, von oben gesehen: 0 = Host (+z), 1 = links, 2 = gegenüber, 3 = rechts.
// Figuren-Stand je Sitz: HOUSE (-1) = im Haus, 0–39 = Felder seit dem eigenen A-Feld, 40–43 = Zielfelder a–d.

export const SEATS = 4;
export const PIECES = 4;
export const TRACK = 40; // Felder der Laufbahn
export const GOAL = TRACK; // erstes Zielfeld (a)
export const LAST = TRACK + PIECES - 1; // letztes Zielfeld (d)
export const HOUSE = -1;
export const TRIES = 3; // „Dreimal würfeln“

const next = (seat) => (seat + 1) % SEATS;

// Ohne Hilfen: Wer schummeln und anprangern darf – Menschen, allein auch die Computer
const takesPart = (s, player) => s.free && (s.humans.includes(player) || s.humans.length === 1);
// Partei: jeder Mensch für sich, die Computer zusammen – anprangern kann man nur die andere Partei
const side = (s, player) => (s.humans.includes(player) ? player : 'cpu');
const freeHuman = (s, player) => s.free && s.humans.includes(player);

// Aktion an die offenen Züge der eigenen Partei hängen (bad = regelwidriger Eintrag oder null)
function record(s, player, bad) {
  const open = s.cheat && side(s, s.cheat.player) === side(s, player) ? s.cheat.bad : [];
  const entry = bad && (s.humans.includes(player) ? bad : { ...bad, player });
  return { player, bad: entry ? [...open, entry] : open };
}

// Feld der Laufbahn (0–39, gezählt ab dem A-Feld von Sitz 0) für einen Figuren-Stand – im Haus/Ziel null
export function fieldOf(seat, pos) {
  return pos >= 0 && pos < TRACK ? (seat * (TRACK / SEATS) + pos) % TRACK : null;
}

// humans = Sitze, an denen Menschen spielen (die übrigen spielt der Computer) · colors = Farbe je Sitz (0–3, Index in COLORS)
export function newGame({ humans = [0], starter = 0, free = false, colors = [0, 1, 2, 3] } = {}) {
  return {
    colors: [...colors],
    free, // ohne Hilfen: Schummeln möglich
    // Züge der Partei, die zuletzt gezogen hat, solange man sie anprangern kann: { player, bad: [{ piece, hits }] } –
    // piece null = „Weiter“ trotz möglichem Zug; allein bei den Computern zusätzlich player je Eintrag (mehrere ziehen)
    cheat: null,
    tainted: false, // ohne Hilfen: in diesem Zug unerlaubt nochmal gewürfelt
    skip: [], // Sitze, die ihren nächsten Zug aussetzen (Fehlalarm)
    humans: [...humans],
    starter,
    turn: starter,
    phase: 'roll', // roll = würfeln · move = Figur wählen · over = vorbei
    die: null, // gewürfelte Zahl, solange gezogen werden muss
    tries: 0, // Würfe ohne Zug in Folge (für „Dreimal würfeln“)
    pieces: Array.from({ length: SEATS }, () => [0, HOUSE, HOUSE, HOUSE]),
    places: [], // Sitze in der Reihenfolge, in der sie fertig wurden
    seq: 0, // zählt die Aktionen (Anzeige spielt sonst falsche Animationen ab)
    events: [{ type: 'start', player: starter }], // was die letzte Aktion bewirkt hat
  };
}

// Revanche: der Nächste im Uhrzeigersinn fängt an
export function again(s) {
  return s.phase === 'over' ? newGame({ humans: s.humans, starter: next(s.starter), free: s.free, colors: s.colors }) : null;
}

// Sitze aus den gewählten Farben: Der Host sitzt auf Sitz 0, die Farben folgen reihum wie auf dem Brett.
// guest = Farbe des Gasts oder null (allein) → guestSeat = Sitz des Gasts (1 links, 2 gegenüber, 3 rechts)
export function seating(host, guest = null) {
  return { colors: [0, 1, 2, 3].map((k) => (host + k) % SEATS), guestSeat: guest === null ? null : (guest - host + SEATS) % SEATS };
}

// Vor dem Spiel: jeder Mensch (players = 1 allein, 2 zu zweit) sucht sich eine Farbe aus
export function newPick({ players = 1, starter = 0, free = false } = {}) {
  return { phase: 'colors', picks: Array(players).fill(null), starter, free, seq: 0, events: [{ type: 'colors' }] };
}

// player = 0 Host, 1 Gast · color = 0–3. Vergebene Farbe → null. Haben alle gewählt, beginnt das Spiel.
export function pick(s, player, color) {
  if (s.phase !== 'colors' || !Number.isInteger(player) || player < 0 || player >= s.picks.length) return null;
  if (!Number.isInteger(color) || color < 0 || color >= SEATS || s.picks.some((c, p) => p !== player && c === color)) return null;
  const picks = s.picks.map((c, p) => (p === player ? color : c));
  if (picks.includes(null)) return { ...s, picks, seq: s.seq + 1, events: [{ type: 'pick', player, color }] };
  const { colors, guestSeat } = seating(picks[0], picks[1] ?? null);
  return newGame({ humans: guestSeat === null ? [0] : [0, guestSeat], starter: s.starter, free: s.free, colors });
}

// Zielstand einer Figur mit dieser Augenzahl, ohne Pflichten (null = geht nicht)
function reach(mine, i, die) {
  const p = mine[i];
  const to = p === HOUSE ? (die === 6 ? 0 : null) : p + die;
  if (to === null || to > LAST || mine.includes(to)) return null; // zu weit oder eigene Figur steht dort
  return to;
}

// Steht auf diesem Stand von player (Laufbahn) eine fremde Figur?
function hitsAt(all, player, to) {
  const field = fieldOf(player, to);
  return field !== null && all.some((theirs, q) => q !== player && theirs.some((p) => fieldOf(q, p) === field));
}

// Ohne Hilfen: Figur darf auf jedes Feld voraus, das nicht schon eine eigene Figur besetzt
function placeable(mine, piece, to) {
  return Number.isInteger(piece) && piece >= 0 && piece < PIECES && Number.isInteger(to) && to > mine[piece] && to <= LAST && !mine.includes(to);
}

// Figuren (Index 0–3), die der Spieler mit dem aktuellen Wurf ziehen darf. Figuren im Haus sind gleich –
// es wird nur die erste angeboten.
export function legalMoves(s, player = s.turn) {
  if (s.phase !== 'move' || s.turn !== player) return [];
  return movesFor(s.pieces, player, s.die);
}

function movesFor(all, player, die) {
  const mine = all[player];
  const can = (i) => reach(mine, i, die) !== null;
  const firstHome = mine.indexOf(HOUSE);
  const onStart = mine.indexOf(0);
  // alles, was mit dem Wurf geht – bei einer 6 auch eine neue Figur heraus (freie Wahl)
  const options = mine.map((_, i) => i).filter((i) => can(i) && (mine[i] !== HOUSE || i === firstHome));
  const hitting = options.filter((i) => hitsAt(all, player, reach(mine, i, die)));
  if (hitting.length) return hitting; // Schlagzwang geht vor
  if (firstHome >= 0 && onStart >= 0 && can(onStart)) return [onStart]; // Pflicht: A-Feld räumen
  return options;
}

// Darf bis zu dreimal würfeln: keine Figur auf der Laufbahn, und die Figuren im Ziel können nicht mehr vorrücken
export function mayRollThrice(mine) {
  if (mine.some((p) => p >= 0 && p < TRACK)) return false;
  return mine.every((p) => p < GOAL || Array.from({ length: LAST - p }, (_, k) => p + 1 + k).every((f) => mine.includes(f)));
}

// Würfeln. value = Augenzahl, die der Würfel des Spielers zeigt (1–6).
// Ohne Hilfen würfelt ein Mensch auch statt zu ziehen nochmal – erlaubt nur bei „Dreimal würfeln“.
// keep = allein ohne Hilfen: Der Computer bleibt auch ohne erlaubten Zug in der Zugphase, um zu schummeln.
export function roll(s, player, value, keep = false) {
  const reroll = s.phase === 'move' && freeHuman(s, player);
  if ((s.phase !== 'roll' && !reroll) || s.turn !== player || !Number.isInteger(value) || value < 1 || value > 6) return null;
  if (reroll) {
    const allowed = !legalMoves(s, player).length && mayRollThrice(s.pieces[player]) && s.tries + 1 < TRIES;
    return { ...s, die: value, tries: s.tries + 1, tainted: s.tainted || !allowed, seq: s.seq + 1, events: [{ type: 'roll', player, value, again: true }] };
  }
  // Wer würfelt, verzichtet auf die Anklage gegen die andere Partei
  const closes = s.cheat && takesPart(s, player) && side(s, s.cheat.player) !== side(s, player);
  const base = { ...s, die: value, seq: s.seq + 1, events: [{ type: 'roll', player, value }], cheat: closes ? null : s.cheat };
  if (movesFor(s.pieces, player, value).length || freeHuman(s, player) || (keep === true && takesPart(s, player))) return { ...base, phase: 'move' };
  const tries = s.tries + 1;
  if (mayRollThrice(s.pieces[player]) && tries < TRIES) {
    return { ...base, die: null, tries, events: [...base.events, { type: 'retry', player, tries }] };
  }
  return nextTurn({ ...base, events: [...base.events, { type: 'pass', player }] });
}

// Figur ziehen. arg = Index 0–3 der eigenen Figur – ohne Hilfen auch { piece, to }: beliebiges freies Feld voraus
export function move(s, player, arg) {
  if (s.phase !== 'move') return null; // z. B. noch Farbwahl
  const free = takesPart(s, player) && typeof arg === 'object' && arg !== null;
  const piece = free ? arg.piece : arg;
  if (player !== s.turn || s.phase !== 'move' || !(free ? placeable(s.pieces[player], piece, arg.to) : legalMoves(s, player).includes(piece))) return null;
  const from = s.pieces[player][piece];
  const to = free ? arg.to : reach(s.pieces[player], piece, s.die);
  // Figuren im Haus sind gleich – regelgerecht ist der Zug, wenn eine Figur vom selben Stand dorthin dürfte
  const legal = !s.tainted && legalMoves(s, player).some((i) => s.pieces[player][i] === from && reach(s.pieces[player], i, s.die) === to);
  const pieces = s.pieces.map((mine) => [...mine]);
  pieces[player][piece] = to;
  const events = [{ type: 'move', player, piece, from, to, die: s.die }];

  // Schlagen: steht eine fremde Figur auf dem Zielfeld, geht sie zurück ins Haus
  const field = fieldOf(player, to);
  if (field !== null) {
    pieces.forEach((theirs, q) => {
      if (q === player) return;
      theirs.forEach((p, j) => {
        if (fieldOf(q, p) !== field) return;
        theirs[j] = HOUSE;
        events.push({ type: 'hit', player: q, piece: j, from: p, by: player });
      });
    });
  }

  let cheat = s.cheat; // zu zweit ziehen Computer regelgerecht und ändern nichts daran
  if (takesPart(s, player)) {
    // Ein noch offener eigener Schummelzug (z. B. vor der 6) bleibt anfechtbar
    const hits = events.filter((e) => e.type === 'hit').map(({ player: q, piece: j, from: at }) => ({ player: q, piece: j, from: at }));
    cheat = record(s, player, legal ? null : { piece, hits });
  }
  let state = { ...s, pieces, die: null, tries: 0, seq: s.seq + 1, events, cheat };
  if (pieces[player].every((p) => p >= GOAL)) {
    state = finish(state, player);
    if (state.phase === 'over') return state;
    return nextTurn(state);
  }
  if (s.die === 6) return { ...state, phase: 'roll', events: [...events, { type: 'six', player }] }; // nochmal würfeln
  return nextTurn(state);
}

// Ohne Hilfen: Zug abgeben („Weiter“) – regelgerecht nur, wenn keine Figur ziehen kann
export function pass(s, player) {
  if (s.phase !== 'move' || s.turn !== player || !freeHuman(s, player)) return null;
  const legal = !s.tainted && !legalMoves(s, player).length;
  const cheat = record(s, player, legal ? null : { piece: null, hits: [] });
  return nextTurn({ ...s, cheat, seq: s.seq + 1, events: [{ type: 'weiter', player, die: s.die }] });
}

// Allein: Der Computer lässt die Frist gegen den Menschen verstreichen (nach Spielende würfelt keiner mehr)
export function waive(s, player) {
  if (!s.cheat || !takesPart(s, player) || side(s, s.cheat.player) === side(s, player)) return null;
  return { ...s, cheat: null, seq: s.seq + 1, events: [] };
}

// „Geschummelt!“ – player prangert die letzten Züge der anderen Partei an, solange er nicht selbst gewürfelt hat.
export function accuse(s, player) {
  const c = s.cheat;
  if (!c || !takesPart(s, player) || side(s, c.player) === side(s, player)) return null;
  const base = { ...s, cheat: null, seq: s.seq + 1 };
  if (!c.bad.length) {
    const events = [{ type: 'fehlalarm', player }];
    if (s.turn === player && s.phase === 'roll') return nextTurn({ ...base, events: [...events, { type: 'skipped', player }] }); // setzt sofort aus
    return { ...base, skip: [...s.skip, player], events };
  }
  const pieces = s.pieces.map((mine) => [...mine]);
  const cheaters = [...new Set(c.bad.map((b) => b.player ?? c.player))];
  const events = cheaters.map((q) => ({ type: 'caught', player: q, by: player }));
  for (const { piece, player: q = c.player } of c.bad) {
    if (piece === null || pieces[q][piece] === HOUSE) continue; // „Weiter“ oder schon wieder im Haus (geschlagen)
    events.push({ type: 'home', player: q, piece, from: pieces[q][piece] });
    pieces[q][piece] = HOUSE;
  }
  // „Weiter“ trotz möglichem Zug: keine Figur muss zurück – dafür setzt der Schummler einmal aus (eigene Festlegung)
  const sitOut = cheaters.filter((q) => q !== s.turn && !s.skip.includes(q) && c.bad.some((b) => b.piece === null && (b.player ?? c.player) === q));
  events.push(...sitOut.map((q) => ({ type: 'sitout', player: q })));
  for (const { player: q, piece: j, from } of c.bad.flatMap((b) => b.hits)) {
    const field = fieldOf(q, from);
    if (pieces[q][j] !== HOUSE || pieces.some((mine, k) => mine.some((p) => fieldOf(k, p) === field))) continue; // schon draußen oder Feld besetzt
    pieces[q][j] = from;
    events.push({ type: 'back', player: q, piece: j, to: from });
  }
  // Wer nicht mehr alle Figuren im Ziel hat, ist auch nicht mehr fertig
  const places = s.places.filter((q) => pieces[q].every((p) => p >= GOAL));
  // Kam eine Figur des Spielers am Zug zurück aufs Feld, gilt „Dreimal würfeln“ nicht mehr
  const state = { ...base, pieces, places, events, skip: [...s.skip, ...sitOut], tries: mayRollThrice(pieces[s.turn]) ? s.tries : 0 };
  if (s.phase === 'over') {
    const open = [0, 1, 2, 3].filter((q) => !places.includes(q));
    if (open.length === 1) return { ...state, places: [...places, open[0]] }; // bleibt vorbei
    if (s.humans.every((h) => places.includes(h))) return state;
  }
  if (s.phase === 'over') return nextTurn({ ...state, turn: c.player });
  if (cheaters.includes(s.turn)) return nextTurn(state); // Zug des Schummlers ist vorbei
  if (s.phase === 'move' && !legalMoves(state).length) return nextTurn(state); // Figur zurückgekehrt, kein Zug mehr möglich
  return state;
}

// Spieler hat alle Figuren im Ziel. Ende, wenn alle Menschen fertig sind oder nur noch einer übrig ist.
function finish(s, player) {
  const places = [...s.places, player];
  const events = [...s.events, { type: 'finish', player, place: places.length }];
  const open = [0, 1, 2, 3].filter((q) => !places.includes(q));
  const humansDone = s.humans.length > 0 && s.humans.every((h) => places.includes(h));
  if (open.length > 1 && !humansDone) return { ...s, places, events };
  if (open.length === 1) places.push(open[0]); // der Letzte bekommt den letzten Platz
  return { ...s, places, events: [...events, { type: 'over' }], phase: 'over', die: null };
}

// Der Nächste im Uhrzeigersinn, der noch Figuren draußen hat – wer aussetzen muss, wird einmal übersprungen.
// Wird ein Mensch übersprungen (fertig oder aussetzen), ist seine Anklage-Frist vorbei wie nach einem eigenen Wurf.
function nextTurn(s) {
  let turn = next(s.turn);
  let cheat = s.cheat;
  const skip = [...s.skip];
  const events = [...s.events];
  while (s.places.includes(turn) || skip.includes(turn)) {
    if (!s.places.includes(turn)) {
      skip.splice(skip.indexOf(turn), 1);
      events.push({ type: 'skipped', player: turn });
    }
    if (cheat && s.humans.includes(turn) && side(s, cheat.player) !== side(s, turn)) cheat = null;
    turn = next(turn);
  }
  return { ...s, turn, skip, cheat, phase: 'roll', die: null, tries: 0, tainted: false, events: [...events, { type: 'turn', player: turn }] };
}

// Wohin die Figur mit dem aktuellen Wurf käme (für die Vorschau), sonst null
export function targetOf(s, player, piece) {
  return legalMoves(s, player).includes(piece) ? reach(s.pieces[player], piece, s.die) : null;
}
