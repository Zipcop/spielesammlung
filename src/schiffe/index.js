// Schiffe-versenken-Partie: verbindet Spielstand (game.js), Koffer (board.js), Seitenfeld (panel.js), Computer (ai.js) und
// Netz. Spieler 0 = Host (blauer Koffer, +z), 1 = Gast bzw. Computer (rot, −z). Der Host hält den vollen Stand und schickt
// dem Gast nur dessen Sicht (viewFor); der Gast schickt Wünsche (place, shoot, answer, move, accuse, again), der Host prüft
// sie und antwortet mit { t: 'state' }.
// Aufstellen: Schiffe im eigenen Meer ziehen (anklicken = drehen) oder „Zufällig“, dann „Fertig“ – gemeldet wird erst die
// fertige Flotte, vorher sieht der andere nichts. Schießen: Loch im Zielraster (Deckel) anklicken – oder einen Stecker aus
// dem Fach nehmen und ins Loch stecken (tisch.js).
// free = „Ohne Hilfen“: Der Beschossene antwortet selbst im Seitenfeld (die wahre Antwort ist vorgewählt, jede andere geht
// auch), Schießen geht jederzeit, eigene Schiffe lassen sich auch mitten im Spiel verschieben. „Geschummelt!“ prüft alles,
// was der andere seit der letzten Anklage getan hat. Allein schummelt der Computer ab und zu (lügt bei einem Treffer
// „Wasser“ oder schießt zweimal) und schaut sich die Züge des Menschen an (schummeln.js): nach jedem Zug des Menschen mit
// LOOK Wahrscheinlichkeit, hat der Mensch gewonnen, immer einmal am Ende.
import { newGame, place, shoot, answer, move, accuse, waive, again, cheated, score, viewFor, randomFleet, cleanFleet, fits, cellsOf, judge, answerText, cellName, FLEET, N } from './game.js';
import { chooseShot, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { createPlates, seatLabels, across } from '../plates.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 650; // so lange zielt der Computer, nachdem der Stecker steckt
const ACCUSE_MS = 800;
// Allein ohne Hilfen: So oft schaut der Computer nach einem Zug des Menschen genauer hin. Eine Partie hat rund 50 Züge je
// Spieler – bei jedem Zug geprüft, brächten schon die seltenen Fehlalarme (5 %) den Computer meist auf drei Verwarnungen.
const LOOK = 0.25;
const LOG = 4;
const LEVEL_KEY = 'spielesammlung-schiffe-stufe';
const DRAG_PX = 6; // ab so viel Mausweg wird aus dem Anklicken (drehen) ein Ziehen
// Namensschilder links neben jedem Koffer (rechts steht das Fach) – das des anderen liegt seitlich hinter dem Deckel
// frei im Blick. Einmal je Brett angelegt (das Brett gibt es nur einmal, startSchiffe läuft je Partie).
const PLATE = { x: -26, z: 16 };
let plates = null;

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return Number.isInteger(n) && n >= 0 && n < LEVELS.length && localStorage.getItem(LEVEL_KEY) !== null ? n : 1;
  } catch {
    return 1;
  }
}

// Alle Antworten, die man geben kann: Wasser, Treffer – Schiff, Versenkt – Schiff
const ANSWERS = [{ res: 'wasser', ship: null }, ...['treffer', 'versenkt'].flatMap((res) => FLEET.map((_, ship) => ({ res, ship })))].map((a) => ({ ...a, label: answerText(a) }));

export function startSchiffe({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (viewFor)
  let mine = null; // meine Sicht davon
  let draft = null; // eigene Flotte beim Aufstellen, noch nicht gemeldet
  let drag = null; // Schiff in der Hand: { k, ship, grab (Feld im Schiff), moved, x0, y0 }
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let log = [];
  let cheered = false;
  let stopped = false;
  // allein ohne Hilfen: geprüfte Listen des Menschen, Schummel-Vorsatz des Computers (lügen bzw. gleich nochmal schießen)
  const judged = new WeakSet();
  let endJudged = false;
  let lie = false;
  let extra = false;

  const who = (p) => (p === me ? 'Du' : solo ? 'Computer' : names.other());
  const otherName = () => (solo ? 'Computer' : names.other());

  const panel = createPanel($('sv-panel'), {
    solo,
    onLevel: (n) => {
      lvl = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch {
        // ohne Speicher gilt die Stufe eben nur bis zum Neuladen
      }
      render();
    },
    onRandom: () => {
      if (!canArrange() || mine.phase !== 'setup') return;
      draft = randomFleet();
      render();
    },
    onReady: () => {
      if (!draft || !cleanFleet(draft, { overlap: !!mine?.free })) return say('So geht das nicht – Schiffe liegen übereinander.');
      act('place', { fleet: draft });
    },
    onAnswer: (a) => a && act('answer', { res: a.res, ship: a.ship }),
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !mine?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Schiffe versenken"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'place') return place(state, p, arg?.fleet);
    if (type === 'shoot') return shoot(state, p, arg?.x, arg?.y);
    if (type === 'answer') return answer(state, p, arg);
    if (type === 'move') return move(state, p, arg?.k, arg?.ship);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    return null;
  }

  function setState(next) {
    const start = next.events[0]?.type === 'start' && !(state && !state.result && state.seq === next.seq && state.round === next.round);
    if (start) {
      log = [];
      cheered = false;
      draft = null;
      endJudged = lie = extra = false;
    }
    const fresh = start || next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, me) : state;
    if (mine.phase === 'setup' && !mine.ready[me] && !draft) draft = randomFleet(); // fertig zum Anpassen oder gleich „Fertig“
    if (fresh && describe(mine)) log = [describe(mine), ...log].slice(0, LOG);
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 1) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
      else if (type === 'again') say(blockedText());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'again' && state.result) hint = blockedText();
      asked = null;
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 1) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  const blockedText = () => (solo ? 'Der Computer prüft noch deine Züge …' : `${otherName()} darf noch „Geschummelt!“ rufen – oder startet die Revanche.`);

  // --- Computer (nur allein, Spieler 1) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    if (s.phase === 'setup' && !s.fleets[1]) return commit(place(s, 1, randomFleet()));
    if (s.phase !== 'play') return;
    if (s.free && s.result) {
      // Ende: hat der Mensch gewonnen, prüft der Computer ihn einmal – danach ist die Frist zu (Revanche frei)
      if (s.result.winner !== me || !s.open[me] || endJudged) return;
      endJudged = true;
      return later(ACCUSE_MS, () => commit((cpuAccuses(cheated(state, me)) ? accuse(state, 1) : waive(state, 1)) ?? state));
    }
    if (s.result) return;
    if (s.free && s.pending?.by === me) {
      // Bevor der Computer auf den Schuss antwortet, schaut er sich manchmal den Zug des Menschen an
      const rec = s.open[me];
      if (rec && !judged.has(rec)) {
        judged.add(rec);
        if (Math.random() < LOOK && cpuAccuses(cheated(s, me))) return later(ACCUSE_MS, () => commit(accuse(state, 1) ?? state));
      }
      return later(THINK_MS, () => {
        const shot = state.shots[me].find((t) => t.res === null);
        const { truth } = shot;
        const fib = lie && truth.res !== 'wasser'; // gelogen wird nur bei einem Treffer: „Wasser“
        if (fib) lie = false;
        commit(answer(state, 1, fib ? { res: 'wasser', ship: null } : truth) ?? state);
      });
    }
    if (s.free && s.pending) return; // wartet auf die Antwort des Menschen
    if (s.free && extra && s.turn === me) {
      return later(THINK_MS, () => {
        extra = false;
        const { x, y } = chooseShot(viewFor(state, 1), 1, lvl);
        commit(shoot(state, 1, x, y) ?? state); // zweimal hintereinander
      });
    }
    if (s.turn !== 1) return;
    later(THINK_MS, () => {
      if (state.free && cpuCheats()) Math.random() < 0.5 ? (lie = true) : (extra = true);
      const { x, y } = chooseShot(viewFor(state, 1), 1, lvl);
      commit(shoot(state, 1, x, y) ?? state);
    });
  }

  // Erst wenn die Stecker stecken, kurz zielen, dann schießen (ändert sich vorher der Stand, entfällt der Aufruf)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // --- Eingaben ---
  const own = () => mine?.fleets[me] ?? draft;
  const running = () => !!mine && mine.phase === 'play' && !mine.result && !waiting;
  const canShoot = () => running() && !(mine.free && mine.pending) && (mine.free || mine.turn === me);
  const canArrange = () => !!mine && !waiting && ((mine.phase === 'setup' && !mine.ready[me]) || (!!mine.free && running()));
  const shotAlready = (c) => mine.shots[me].some((t) => t.x === c.x && t.y === c.y);

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function tryShoot(c) {
    if (!mine || waiting) return false;
    if (mine.result) return false;
    if (mine.phase === 'setup') return say(mine.ready[me] ? `${otherName()} stellt noch auf …` : 'Erst die Flotte aufstellen und „Fertig“ drücken.');
    if (mine.free && mine.pending) return say(mine.pending.by === me ? `Warte auf die Antwort von ${otherName()} …` : 'Erst antworten – rechts im Seitenfeld.');
    if (!mine.free && mine.turn !== me) return say(`${who(mine.turn)} ist dran.`);
    if (shotAlready(c)) return say(`Auf ${cellName(c.x, c.y)} hast du schon geschossen.`);
    act('shoot', c);
    return true;
  }

  // Stecker mit der Hand ins Zielraster gesteckt (tisch.js) = Schuss. point liegt auf dem Deckel oder dahinter;
  // das Loch ergibt sich aus der Blickrichtung dorthin.
  board.onPlace = (mesh, point) => {
    const peg = board.pegOf(mesh);
    if (!peg || peg.placed || peg.seat !== me) return peg ? 'back' : null;
    const at = room.toScreen(point);
    const cell = at ? board.lidCell(room.rayFrom({ clientX: at.x, clientY: at.y }), me) : null;
    if (!cell) return null; // liegt einfach auf dem Tisch
    board.prefer(mesh);
    return tryShoot(cell) ? 'move' : 'back';
  };

  // Schiff so, dass es ganz auf dem Brett liegt
  function clampShip(ship, k) {
    const len = FLEET[k].len;
    const maxX = ship.dir === 'h' ? N - len : N - 1;
    const maxY = ship.dir === 'v' ? N - len : N - 1;
    return { x: Math.min(Math.max(ship.x, 0), maxX), y: Math.min(Math.max(ship.y, 0), maxY), dir: ship.dir };
  }

  // Passt Schiff k so in die eigene Flotte? (ohne Hilfen dürfen Schiffe übereinanderliegen)
  function fitsIn(ship, k) {
    if (!fits(ship, k)) return false;
    if (mine.free) return true;
    const taken = new Set(own().flatMap((s, j) => (j === k ? [] : cellsOf(s, j).map(([x, y]) => y * N + x))));
    return cellsOf(ship, k).every(([x, y]) => !taken.has(y * N + x));
  }

  // gedreht um das gepackte Feld
  function turned(ship, k, grab) {
    const [gx, gy] = cellsOf(ship, k)[grab];
    const dir = ship.dir === 'h' ? 'v' : 'h';
    return clampShip({ x: dir === 'h' ? gx - grab : gx, y: dir === 'v' ? gy - grab : gy, dir }, k);
  }

  function holdDrag() {
    board.hold(me, drag.k, drag.ship, !fitsIn(drag.ship, drag.k));
  }

  const onDown = (e) => {
    if (e.button !== 0 || !canArrange()) return;
    const ray = room.rayFrom(e);
    const k = board.pickShip(ray, me);
    if (k === null) return;
    e.preventDefault(); // der Tisch schiebt dann nicht das ganze Brett (tisch.js)
    const ship = own()[k];
    const pt = board.seaPoint(ray, me);
    const along = pt ? Math.round(ship.dir === 'h' ? pt.x - ship.x : pt.y - ship.y) : 0;
    drag = { k, ship: { ...ship }, grab: Math.min(Math.max(along, 0), FLEET[k].len - 1), moved: false, x0: e.clientX, y0: e.clientY };
    board.setGhost(me, null);
  };

  const onDragMove = (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
    drag.moved = true;
    const pt = board.seaPoint(room.rayFrom(e), me);
    if (!pt) return;
    const gx = Math.round(pt.x);
    const gy = Math.round(pt.y);
    drag.ship = clampShip({ x: drag.ship.dir === 'h' ? gx - drag.grab : gx, y: drag.ship.dir === 'v' ? gy - drag.grab : gy, dir: drag.ship.dir }, drag.k);
    canvas.style.cursor = 'grabbing';
    holdDrag();
  };

  const onUp = (e) => {
    if (!drag || e.button !== 0) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = '';
    const ship = d.moved ? d.ship : turned(own()[d.k], d.k, d.grab);
    if (!canArrange()) return render();
    if (!fitsIn(ship, d.k)) return say(d.moved ? 'Da liegt schon ein Schiff.' : 'Zum Drehen ist dort kein Platz.');
    if (mine.phase === 'setup') {
      draft = draft.map((s, j) => (j === d.k ? ship : s));
      return render();
    }
    const was = own()[d.k];
    if (ship.x === was.x && ship.y === was.y && ship.dir === was.dir) return render();
    act('move', { k: d.k, ship });
  };

  // beim Ziehen: R, Leertaste oder Mausrad drehen das Schiff (das Mausrad zoomt dann nicht)
  const onKey = (e) => {
    if (!drag || !(e.key === 'r' || e.key === 'R' || e.code === 'Space')) return;
    e.preventDefault();
    e.stopPropagation();
    drag.ship = turned(drag.ship, drag.k, drag.grab);
    drag.moved = true;
    holdDrag();
  };
  const onWheel = (e) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    drag.ship = turned(drag.ship, drag.k, drag.grab);
    drag.moved = true;
    holdDrag();
  };

  const onMove = (e) => {
    if (drag) return;
    const overShip = canArrange() && board.pickShip(room.rayFrom(e), me) !== null;
    const cell = canShoot() && !board.busy() ? board.lidCell(room.rayFrom(e), me) : null;
    const usable = cell && !shotAlready(cell);
    board.setGhost(me, usable ? cell : null);
    canvas.style.cursor = overShip ? 'grab' : usable ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!mine || board.busy()) return;
    const cell = board.lidCell(room.rayFrom(e), me);
    if (cell) tryShoot(cell);
  };

  // --- Anzeige ---
  function render() {
    if (!mine) return;
    const s = mine;
    board.sync(s, me, own());
    plates ??= createPlates(board.group, 2);
    plates.set(seatLabels(2, { mySeat: me, humans: solo ? [me] : [0, 1], me: names.me(), other: names.other(), cpu: () => `Computer (${LEVELS[lvl].name})` }), {
      at: (p) => across(p, PLATE.x, PLATE.z), view: me ? Math.PI : 0, turn: s.phase === 'play' && !s.result ? s.turn : null,
    });
    if (drag) holdDrag();
    if (!canShoot()) board.setGhost(me, null);
    const won = s.result?.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && s.phase === 'play' && !!s.open?.[other] && !waiting });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict, s), verdict.type === 'caught');
    const wins = score(s);
    panel.render({
      players: [0, 1].map((p) => ({
        name: `${p === 0 ? 'Blau' : 'Rot'} – ${p === me ? 'Du' : solo ? `Computer (${LEVELS[lvl].name})` : names.other()}`,
        wins: wins[p],
        strikes: s.strikes?.[p] ?? 0,
        turn: s.phase === 'play' && !s.result && s.turn === p,
      })),
      status: statusText(),
      hint,
      level: lvl,
      setup: s.phase === 'setup' && !s.ready[me] && !waiting,
      answer: answerBox(),
      fleets: s.phase === 'play' ? fleets() : null,
      log,
      end: s.result ? endInfo() : null,
      free: !!s.free,
    });
  }

  function statusText() {
    const s = mine;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (s.phase === 'setup') return !s.ready[me] ? 'Stell deine Flotte auf' : solo ? 'Der Computer stellt auf …' : `${otherName()} stellt noch auf …`;
    if (s.free && s.pending) return s.pending.by === me ? `Warte auf die Antwort von ${otherName()} …` : `${otherName()} schießt auf ${cellName(s.pending.x, s.pending.y)} – antworte!`;
    if (s.turn === me) return 'Du bist dran – schieß!';
    return solo ? 'Der Computer zielt …' : `${otherName()} ist dran …`;
  }

  // Ohne Hilfen: Antwort auf den Schuss des anderen – die Wahrheit ist vorgewählt
  function answerBox() {
    const s = mine;
    if (!s.free || !s.pending || s.pending.by !== other || s.result || waiting) return null;
    const { x, y } = s.pending;
    const before = s.shots[other].filter((t) => t.res !== null);
    const truth = judge(own(), before, x, y);
    return {
      key: `${s.round}-${x}-${y}`,
      text: `${otherName()} schießt auf ${cellName(x, y)}. Was sagst du?`,
      options: ANSWERS,
      pick: ANSWERS.findIndex((a) => a.res === truth.res && a.ship === truth.ship),
    };
  }

  // Beide Flotten mit Treffern: die eigene nach der Wahrheit, die fremde nach den Antworten
  function fleets() {
    const s = mine;
    const hitsOn = (fleet, shots, k) => {
      const shot = new Set(shots.map((t) => t.y * N + t.x));
      return cellsOf(fleet[k], k).filter(([x, y]) => shot.has(y * N + x)).length;
    };
    const ownShips = FLEET.map((f, k) => {
      const hits = hitsOn(own(), s.shots[other], k);
      return { name: f.name, len: f.len, hits, sunk: hits === f.len };
    });
    const theirFleet = s.fleets[other];
    const theirs = FLEET.map((f, k) => {
      if (theirFleet) { // am Ende offen
        const hits = hitsOn(theirFleet, s.shots[me], k);
        return { name: f.name, len: f.len, hits, sunk: hits === f.len };
      }
      const said = s.shots[me].filter((t) => t.ship === k);
      return { name: f.name, len: f.len, hits: Math.min(said.length, f.len), sunk: said.some((t) => t.res === 'versenkt') };
    });
    return [{ title: 'Deine Flotte', ships: ownShips }, { title: solo ? 'Computer' : `Flotte von ${otherName()}`, ships: theirs }];
  }

  function describe(s) {
    const parts = [];
    for (const e of s.events) {
      if (e.type === 'start') parts.push(`Partie ${s.round ?? 1}: Flotten aufstellen – ${s.starter === me ? 'du schießt' : `${who(s.starter)} schießt`} zuerst.`);
      else if (e.type === 'ready' && !(s.events.some((x) => x.type === 'go'))) parts.push(e.by === me ? 'Du bist bereit.' : `${who(e.by)} ist bereit.`);
      else if (e.type === 'go') parts.push(`Alle Schiffe stehen – ${s.turn === me ? 'du schießt' : `${who(s.turn)} schießt`} zuerst.`);
      else if (e.type === 'shot') parts.push(`${who(e.by)} ${e.by === me ? 'schießt' : 'schießt'} auf ${cellName(e.x, e.y)}${e.res ? `: ${answerText(e)}${e.res === 'versenkt' ? '!' : '.'}` : ' …'}`);
      else if (e.type === 'answer') parts.push(`${who(e.by)} ${e.by === me ? 'sagst' : 'sagt'}: „${answerText(e)}“.`);
      else if (e.type === 'move') parts.push('Du hast ein Schiff verschoben.');
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e, s));
    }
    if (s.result?.reason === 'flotte' && !s.events.some((e) => e.type === 'caught' || e.type === 'fehlalarm')) {
      parts.push(s.result.winner === me ? 'Die ganze Flotte ist versenkt – gewonnen!' : `${who(s.result.winner)} hat deine ganze Flotte versenkt.`);
    }
    return parts.join(' ');
  }

  // e = { caught, player (bekommt die Verwarnung), by (hat gerufen), why } · s = Stand danach
  function verdictText(e, s) {
    const out = s.result?.reason === 'schummeln' ? ' Das ist die dritte – Partie verloren.' : s.result?.reason === 'aberkannt' ? ' Der Sieg ist damit verloren.' : '';
    if (e.caught) {
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ – ' : ''}Erwischt! Du hast geschummelt: ${e.why}. Alles wird richtiggestellt, dazu eine Verwarnung.${out}`;
      return `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}. Alles wird richtiggestellt, dazu eine Verwarnung.${out}`;
    }
    if (e.player === me) return `Fehlalarm! ${otherName()} hat nicht geschummelt – du bekommst eine Verwarnung.${out}`;
    if (solo) return `Der Computer ruft „Geschummelt!“ – Fehlalarm, du warst ehrlich. Er bekommt eine Verwarnung.${out}`;
    return `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt eine Verwarnung.${out}`;
  }

  function endInfo() {
    const { winner, reason } = mine.result;
    const wins = score(mine);
    const title = winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const why = { flotte: 'Die ganze Flotte ist versenkt.', schummeln: 'Dritte Verwarnung.', aberkannt: 'Mit Schummeln gewonnen und erwischt.' }[reason];
    const open = mine.free && mine.open?.[other] ? ' Jetzt liegen alle Schiffe offen – stimmt etwas nicht, „Geschummelt!“.' : '';
    return { title, text: `${why} Stand: du ${wins[me]} : ${wins[other]} ${otherName()}.${open}` };
  }

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ starter: 0, free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => state,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
      plates?.set([]);
    },
  };
}
