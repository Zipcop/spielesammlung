// MÄDN-Partie: verbindet Spielstand (rules.js), Brett (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Vier Farben: Zuerst sucht sich jeder Mensch eine Farbe aus. Der Host sitzt immer auf Sitz 0 (+z), das Brett wird
// passend gedreht; der Gast sitzt bei seiner Farbe (gegenüber oder an der Seite). Freie Sitze spielt der Computer.
// Der Host hält den Spielstand, würfelt und zieht für die Computer und führt Pflichtzüge (nur eine Möglichkeit)
// selbst aus. Der Gast würfelt mit eigener Physik (Wurf wird gestreamt) und schickt Wünsche (roll, move, accuse, again).
// free = „Ohne Hilfen“: nichts leuchtet, nichts zieht oder gibt von selbst weiter – Figur anklicken, dann ein beliebiges
// Feld voraus, oder „Weiter“; nochmal würfeln geht immer. Allein schummeln die Computer ab und zu und rufen „Geschummelt!“.
import { newPick, pick, roll, move, pass, accuse, waive, again, legalMoves, targetOf, HOUSE, GOAL, LAST } from './rules.js';
import { chooseMove, cheatMove } from './ai.js';
import { createPanel } from './panel.js';
import { COLORS } from './print.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);
const VIEW = ['maedn0', 'maednL', 'maedn1', 'maednR']; // Kamera je Sitz (room.js)
const THINK_MS = 650; // Computer überlegt kurz, bevor er würfelt oder zieht
const AUTO_MS = 700; // Pflichtzug: kurz zeigen, was gewürfelt wurde
const LOG = 4; // Zeilen im Verlauf
const fields = (n) => (n === 1 ? '1 Feld' : `${n} Felder`);

// Was der Gast sehen darf: ob die letzten Züge regelgerecht waren, muss er selbst merken
const forGuest = (s) => (s.free ? { ...s, tainted: false, cheat: s.cheat && { player: s.cheat.player } } : s);

// names = { me(), other() } aus main.js (Spielernamen, können sich während der Partie ändern)
export function startMaedn({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  let mine = me === 0 ? 0 : 2; // mein Sitz – beim Gast erst nach der Farbwahl sicher
  let viewSeat = mine; // Sitz, an dem die Kamera steht (main.js stellt den Gast zuerst gegenüber hin)
  let state = null;
  let rolling = false; // mein Würfel rollt gerade
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let timer = null;
  let log = [];
  let wasBusy = false;
  let cheered = false;
  let stopped = false;
  let selected = -1; // ohne Hilfen: angeklickte eigene Figur, wartet auf ihr Zielfeld
  let games = 0; // zählt die Partien (damit eine Meldung aus einer früheren Partie nicht verschluckt wird)

  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Mensch ärgere dich nicht"] [data-hint]') });
  const panel = createPanel($('md-panel'), {
    solo,
    onRoll: throwDie,
    onPass: () => act('pass'),
    onAgain: () => act('again'),
    onPick: (color) => act('pick', color),
    onLeave: (confirm) => (confirm && state?.phase !== 'over' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });

  const colorOf = (seat) => COLORS[state?.colors?.[seat] ?? seat];
  const name = (seat) => colorOf(seat)?.name ?? '?';
  const who = (seat) => (seat === mine ? 'Du' : !state.humans.includes(seat) ? 'Computer' : names?.other() || 'Mitspieler');
  const label = (seat) => `${name(seat)} (${who(seat)})`;

  // who = 0 Host, 1 Gast
  function apply(type, who, arg) {
    if (type === 'pick') return pick(state, who, arg);
    if (state.phase === 'colors') return null;
    const seat = who === 0 ? 0 : state.humans[1];
    if (seat === undefined) return null;
    if (type === 'roll') return roll(state, seat, arg);
    if (type === 'move') return move(state, seat, arg);
    if (type === 'pass') return pass(state, seat);
    if (type === 'accuse') return accuse(state, seat);
    if (type === 'again') return rematchBlocked(state, seat) ? null : again(state);
    return null;
  }

  function setState(next) {
    const fresh = next.events[0]?.type === 'start';
    if (fresh) {
      log = [];
      cheered = false;
      games++;
    }
    const changed = fresh || next.seq !== state?.seq; // derselbe Stand nochmal (z. B. nach ungültigem Wunsch) → kein neuer Verlauf
    state = next;
    if (next.humans) mine = me === 0 ? 0 : next.humans[1];
    if (mine !== viewSeat) { // Gast hat eine Farbe neben der des Hosts → Kamera an seine Seite (auch bei fortgesetzter Partie)
      viewSeat = mine;
      room.setView(VIEW[mine]);
    }
    const lines = changed ? describe(next.events) : '';
    if (lines) log = [lines, ...log].slice(0, LOG);
  }

  function commit(next) {
    setState(next);
    send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, 0, arg);
      if (next) commit(next);
    } else {
      waiting = true;
      send({ t: type, arg });
      render();
    }
  }

  // ohne Hilfen auch statt zu ziehen (nochmal würfeln – ob das erlaubt war, prüft der Mitspieler)
  const canRoll = () => state && (state.phase === 'roll' || (state.free && state.phase === 'move')) && state.turn === mine && !rolling && !waiting && !board.busy();
  const canPass = () => !!state?.free && state.phase === 'move' && state.turn === mine && !rolling && !waiting && !board.busy();

  // byHand = Würfel mit der Maus gepackt: schütteln (dragDie), loslassen (releaseDie) = Wurf
  async function throwDie(byHand = false) {
    if (!canRoll()) return;
    rolling = true;
    render();
    let value = null;
    try {
      value = await (byHand ? board.grabDie(mine) : board.roll(mine));
    } finally {
      rolling = false;
    }
    if (stopped) return;
    act('roll', value);
    render();
  }

  function handle(msg) {
    if (stopped) return;
    if (msg.t === 'dice') return board.applyRemote(msg);
    if (!isHost && msg.t === 'state') {
      waiting = false;
      setState(msg.state);
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // Host: Computer würfeln und ziehen lassen, Pflichtzüge ausführen – erst, wenn das Brett ruhig ist.
  // Allein ohne Hilfen prüft der Computer, der als Nächster würfelt, vorher einmal den Zug des Menschen
  // (nach Spielende Sitz 1 – allein immer ein Computer), und er schummelt ab und zu selbst.
  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || state.phase === 'colors') return;
    const seat = state.turn;
    const cpu = !state.humans.includes(seat);
    const cheating = solo && state.free;
    const judge = cheating && !!state.cheat && state.humans.includes(state.cheat.player);
    const caught = () => cpuAccuses(state.cheat.bad.length > 0);
    if (state.phase === 'over') {
      if (judge) later(THINK_MS, () => commit(caught() ? accuse(state, 1) : waive(state, 1)));
      return;
    }
    const options = legalMoves(state);
    if (state.phase === 'move' && (cpu || (options.length === 1 && !state.free))) { // ohne Hilfen zieht jeder selbst
      later(cpu ? THINK_MS : AUTO_MS, () => {
        // ohne erlaubten Zug ist er nur hier, weil er schummeln will (keep beim Wurf)
        const sly = cpu && cheating && (!options.length || cpuCheats()) ? cheatMove(state, seat) : null;
        commit(move(state, seat, sly ?? (cpu ? chooseMove(state) : options[0])));
      });
    } else if (state.phase === 'roll' && cpu) {
      later(THINK_MS, async () => {
        if (judge && caught()) return commit(accuse(state, seat));
        const value = await board.roll(seat);
        if (stopped) return;
        // Kein erlaubter Zug (z. B. alle im Haus): allein schummelt er manchmal trotzdem heraus –
        // entschieden nur beim ersten Wurf, damit „Dreimal würfeln“ nicht dreimal so oft schummeln lässt
        const keep = cheating && state.tries === 0 && cpuCheats() && !!cheatMove({ ...state, die: value }, seat);
        // Kam während des Wurfs „Geschummelt!“, gilt der gezeigte Wurf trotzdem, solange der Computer noch würfeln soll
        const next = state.turn === seat && state.phase === 'roll' ? roll(state, seat, value, keep) : null;
        if (next) commit(next);
      });
    }
  }

  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => state === at && fn(), ms);
    };
    tick();
  }

  // --- Anzeige ---
  function render() {
    board.sync(state);
    if (!state) return;
    const labels = state.phase === 'colors' ? [] : seatLabels(4, { mySeat: mine, humans: state.humans, me: names?.me(), other: names?.other(), cpu: () => 'Computer' });
    board.names(labels, state.phase === 'over' ? null : state.turn, viewSeat);
    if (state.phase === 'colors') return renderPick();
    const myTurn = state.turn === mine && state.phase !== 'over';
    const options = myTurn && state.phase === 'move' && !waiting ? legalMoves(state, mine) : [];
    if (!state.free || !myTurn || state.phase !== 'move') selected = -1; // Zug vorbei oder abgegeben (ohne Hilfen auch ohne erlaubten Zug wählbar)
    board.setMovable(mine, state.free ? (selected >= 0 ? [selected] : []) : options); // ohne Hilfen leuchtet nur die gewählte
    if (state.free ? selected < 0 : !options.length) board.setHover(mine, -1, null);
    // nicht mehr, sobald der eigene Würfel rollt – der Wurf beendet die Frist
    cheat.update({ free: state.free, canAccuse: !!state.cheat && state.cheat.player !== mine && state.humans.includes(mine) && !waiting && !rolling });
    sayVerdict();
    const over = state.phase === 'over';
    if (!over) cheered = false; // nach „Geschummelt!“ kann ein beendetes Spiel weitergehen
    if (over && state.places[0] === mine && !cheered) {
      cheered = true;
      room.celebrate?.(me);
    }
    panel.render({
      players: state.pieces.map((p, seat) => ({
        name: label(seat),
        color: colorOf(seat).css,
        goal: p.filter((pos) => pos >= GOAL).length,
        out: p.filter((pos) => pos !== HOUSE && pos < GOAL).length,
        turn: !over && seat === state.turn,
        place: state.places.indexOf(seat) + 1,
      })),
      status: statusText(myTurn, options),
      canRoll: canRoll(),
      canPass: canPass(),
      // ohne Hilfen zählt niemand die Versuche mit
      rollText: state.free ? (myTurn && state.phase === 'move' ? 'Nochmal würfeln' : 'Würfeln')
        : state.tries > 0 && myTurn ? `Würfeln · Versuch ${state.tries + 1} von 3` : 'Würfeln',
      log,
      free: state.free,
      end: over ? {
        title: state.places[0] === mine ? 'Gewonnen – alle Figuren im Ziel!' : `${label(state.places[0])} gewinnt`,
        places: state.places.map((seat) => label(seat)),
      } : null,
    });
  }

  // Vor dem Spiel: Farbe aussuchen (der Mitspieler sieht, was schon vergeben ist)
  function renderPick() {
    board.setMovable(mine, []);
    board.setHover(mine, -1, null);
    cheat.update({ free: state.free, canAccuse: false });
    const own = state.picks[me] ?? null;
    const other = state.picks.length > 1 ? state.picks[1 - me] ?? null : null;
    const otherName = names?.other() || 'Mitspieler';
    panel.choose({
      status: waiting ? 'Wird gesendet …' : own === null ? 'Such dir eine Farbe aus' : `Warte, bis ${otherName} eine Farbe gewählt hat …`,
      picks: { mine: own, other, otherName },
      free: state.free,
    });
  }

  function statusText(myTurn, options) {
    if (state.phase === 'over') return 'Spiel vorbei';
    if (rolling) return 'Der Würfel rollt …';
    if (waiting) return 'Wird gesendet …';
    if (!myTurn) return `${label(state.turn)} ist dran …`;
    if (state.phase === 'roll') return state.tries > 0 ? 'Noch keine 6 – nochmal würfeln!' : 'Du bist dran – würfle!';
    if (state.free) return selected >= 0 ? `Du hast eine ${state.die} – jetzt das Zielfeld anklicken (Esc = abwählen)` : `Du hast eine ${state.die} – eigene Figur anklicken, dann ihr Zielfeld · oder „Weiter“`;
    if (options.length === 1) return `Du hast eine ${state.die} – deine Figur zieht …`;
    return `Du hast eine ${state.die} – klick eine leuchtende Figur`;
  }

  // „Geschummelt!“ – Ergebnis einmal groß einblenden
  // (allein schummeln und rufen mehrere Computer – dann mit Farbe, z. B. „Grün (Computer)“)
  function sayVerdict() {
    const caught = state.events.filter((e) => e.type === 'caught');
    const alarm = state.events.find((e) => e.type === 'fehlalarm');
    const key = `${games}:${state.seq}`;
    const named = (seat) => (state.humans.includes(seat) ? who(seat) : label(seat));
    if (caught.length) {
      const n = state.events.filter((e) => e.type === 'home').length;
      const mineCaught = caught.some((e) => e.player === mine);
      const out = state.events.some((e) => e.type === 'sitout') ? ` – ${mineCaught ? 'du setzt' : `${named(caught[0].player)} setzt`} einmal aus` : ''; // „Weiter“ trotz möglichem Zug
      const back = n === 1 ? ' – die Figur muss zurück ins Haus' : n > 1 ? ` – ${n} Figuren müssen zurück ins Haus` : out;
      const guilty = mineCaught ? 'Du hast' : `${caught.map((e) => named(e.player)).join(' und ')} ${caught.length > 1 ? 'haben' : 'hat'}`;
      // was falsch war (Nico 20.10.2026) – bei mehreren Computern je Farbe
      const why = caught.length > 1 ? ` (${caught.map((e) => `${name(e.player)}: ${e.why}`).join('; ')})` : caught[0].why ? `: ${caught[0].why}` : '';
      cheat.say(key, `Erwischt! ${guilty} geschummelt${why}${back}.`, true);
    } else if (alarm) {
      const penalty = state.phase === 'over' ? 'hat sich geirrt.' : 'einmal aus.'; // nach Spielende gibt es nichts mehr auszusetzen
      cheat.say(key, `Fehlalarm! ${alarm.player === mine ? `Du ${state.phase === 'over' ? 'hast' : 'setzt'}` : `${named(alarm.player)} ${state.phase === 'over' ? 'hat' : 'setzt'}`} ${penalty}`, false);
    }
  }

  // Was die letzte Aktion bewirkt hat, in einem Satz
  function describe(events) {
    const parts = [];
    let rolled = null;
    for (const e of events) {
      const n = e.player === undefined ? '' : name(e.player); // „over“ hat keinen Spieler
      if (e.type === 'start') parts.push(`Neues Spiel – ${name(e.player)} fängt an.`);
      else if (e.type === 'roll' && e.again) parts.push(`${n} würfelt nochmal.`);
      else if (e.type === 'roll') rolled = e;
      else if (e.type === 'weiter') parts.push(`${n} würfelt eine ${e.die} und gibt weiter.`);
      else if (e.type === 'retry') parts.push(`${n} würfelt eine ${rolled.value} – noch ${3 - e.tries === 1 ? 'ein Versuch' : `${3 - e.tries} Versuche`}.`);
      else if (e.type === 'pass') parts.push(`${n} würfelt eine ${rolled.value} – kein Zug möglich.`);
      else if (e.type === 'move') {
        // ohne Hilfen nennt der Verlauf nur den Wurf, nicht die gezogenen Felder – nachzählen muss man selbst
        const count = state.free ? '' : ` ${fields(e.to - e.from)}`;
        const thrown = state.free ? `${n} würfelt eine ${e.die} und` : n;
        parts.push(e.from === HOUSE ? `${thrown} kommt${state.free ? '' : ' mit der 6'} heraus.`
          : e.to >= GOAL && e.from < GOAL ? `${thrown} zieht${count} ins Ziel.`
            : `${thrown} zieht${count}.`);
      } else if (e.type === 'hit') parts.push(`${name(e.by)} schlägt ${n}!`);
      else if (e.type === 'six') parts.push('Sechs – nochmal!');
      else if (e.type === 'finish') parts.push(`${n} ist fertig – Platz ${e.place}!`);
      else if (e.type === 'caught') parts.push(`${name(e.by)} ruft „Geschummelt!“ – ${n} ist erwischt${e.why ? ` (${e.why})` : ''}!`);
      else if (e.type === 'home') parts.push(`${n} muss zurück ins Haus.`);
      else if (e.type === 'back') parts.push(`${n} kommt zurück aufs Feld.`);
      else if (e.type === 'fehlalarm') parts.push(`${n} ruft „Geschummelt!“ – Fehlalarm.`);
      else if (e.type === 'skipped') parts.push(`${n} setzt aus.`);
      else if (e.type === 'sitout') parts.push(`${n} setzt beim nächsten Mal aus.`);
    }
    return parts.join(' ');
  }

  // --- Eingaben: leuchtende Figur anklicken = ziehen · Würfelteller anklicken oder Leertaste = würfeln ---
  // (ohne Hilfen: eigene Figur anklicken, dann Zielfeld)
  // Gibt es nur eine Möglichkeit, zieht der Host die Figur selbst – dann ist nichts anzuklicken.
  const movable = () => {
    const options = state && state.turn === mine && state.phase === 'move' && !waiting && !board.busy() ? legalMoves(state, mine) : [];
    return options.length > 1 ? options : [];
  };

  // Ohne Hilfen: jede eigene Figur, die noch vorwärts kann · Zielfeld = beliebiges Feld voraus ohne eigene Figur
  const freeTurn = () => state?.free && state.turn === mine && state.phase === 'move' && !waiting && !board.busy();
  const ownPieces = () => [0, 1, 2, 3].filter((i) => state.pieces[mine][i] < LAST);
  const freeTarget = (ray) => {
    const to = selected >= 0 ? board.pickField(ray, mine) : null;
    return to !== null && to > state.pieces[mine][selected] && !state.pieces[mine].includes(to) ? to : null;
  };

  // Würfel mit der Hand: drücken (Spiel nimmt den Klick, nicht tisch.js), über 18 px ziehen = in die Hand,
  // schütteln, loslassen = Wurf. Ein Klick ohne Ziehen würfelt wie bisher.
  let pressed = null;
  let grabbing = false;
  let handled = false; // das Drücken wurde zum Wurf aus der Hand – der Klick danach würfelt nicht noch einmal
  const DRAG_PX = 18;
  const onDown = (e) => {
    if (e.button !== 0) return;
    handled = false;
    if (!canRoll() || !board.hitDie(room.rayFrom(e))) return;
    e.preventDefault();
    pressed = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e) => {
    if (e.button !== 0) return;
    pressed = null;
    if (!grabbing) return;
    grabbing = false;
    canvas.style.cursor = '';
    board.releaseDie();
  };

  // Figur mit der Hand abgestellt (tisch.js): auf einem Feld = Zug, sonst zurück; neben dem Brett bleibt sie liegen.
  // Antwort: 'move' (Spiel zieht), 'back' (Figur fliegt zurück) oder null
  board.onPlace = (mesh, point) => {
    const p = board.pieceOf(mesh);
    if (!p || !state?.pieces) return null;
    const { field, onBoard } = board.fieldAt(point, mine);
    if (!onBoard) return null;
    if (p.seat !== mine || state.turn !== mine || state.phase !== 'move' || waiting || field === null) return 'back';
    const own = state.pieces[mine];
    const from = own[p.piece];
    if (field === from) return 'back';
    if (state.free) { // ohne Hilfen: jedes freie Feld voraus – ob es stimmt, prüft der Mitspieler
      if (field < from || own.includes(field)) return 'back';
      selected = -1;
      act('move', { piece: p.piece, to: field });
      return 'move';
    }
    // Figuren im Haus sind gleich – gezogen wird die, die das Spiel dafür vorsieht
    const i = legalMoves(state, mine).find((k) => own[k] === from && targetOf(state, mine, k) === field);
    if (i === undefined) return 'back';
    act('move', i);
    return 'move';
  };

  const onMove = (e) => {
    const ray = room.rayFrom(e);
    if (pressed && !grabbing && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) {
      grabbing = handled = true;
      canvas.style.cursor = 'grabbing';
      throwDie(true);
    }
    if (grabbing) return board.dragDie(ray);
    if (freeTurn()) {
      const piece = board.pickPiece(ray, mine, ownPieces(), selected >= 0);
      const to = piece < 0 ? freeTarget(ray) : null;
      board.setHover(mine, to !== null ? selected : -1, to);
      canvas.style.cursor = piece >= 0 || to !== null || (canRoll() && board.hitTray(ray)) ? 'pointer' : '';
      return;
    }
    const options = movable();
    const piece = options.length ? board.pickPiece(ray, mine, options) : -1;
    board.setHover(mine, piece, piece >= 0 ? targetOf(state, mine, piece) : null);
    canvas.style.cursor = piece >= 0 || (canRoll() && board.hitTray(ray)) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (handled) {
      handled = false;
      return;
    }
    const ray = room.rayFrom(e);
    if (freeTurn()) {
      // Ist schon eine Figur gewählt, zählt bei eigenen Figuren nur der Kegel selbst – die große Klickfläche
      // würde sonst Felder dahinter verdecken
      const piece = board.pickPiece(ray, mine, ownPieces(), selected >= 0);
      const to = piece < 0 ? freeTarget(ray) : null;
      if (piece >= 0) selected = piece === selected ? -1 : piece; // nochmal anklicken = abwählen
      else if (to !== null) {
        const chosen = selected;
        selected = -1;
        return act('move', { piece: chosen, to });
      } else if (canRoll() && board.hitTray(ray)) return throwDie(); // nochmal würfeln
      return render();
    }
    const options = movable();
    const piece = options.length ? board.pickPiece(ray, mine, options) : -1;
    if (piece >= 0) return act('move', piece);
    if (canRoll() && board.hitTray(ray)) throwDie();
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && selected >= 0) {
      selected = -1;
      return render();
    }
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    throwDie();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp); // auch wenn die Maus beim Loslassen neben dem Fenster ist
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    const busy = board.busy();
    if (busy !== wasBusy) render(); // Knopf und Leuchten erst freigeben, wenn alles steht
    wasBusy = busy;
  });

  if (isHost) commit(resume ?? newPick({ players: solo ? 1 : 2, starter: Math.floor(Math.random() * 4), free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    stop() {
      stopped = true;
      clearTimeout(timer);
      board.onPlace = null;
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
