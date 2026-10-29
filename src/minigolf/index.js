// Minigolf-Partie: verbindet Spielstand (rules.js), Anlage mit Physik (scene.js), Seitenfeld (panel.js), Computer (ai.js)
// und Netz. Der Host hält den Spielstand. Wer schlägt, rechnet die Physik selbst, streamt den Ball ('golf') und meldet
// das Ergebnis (Gast → Host: { t: 'shot', arg: report }). Zielen sieht der andere live ('aim').
// Bedienung wie Billard: Maus zeigt die Richtung (Shift = fein), linke Maustaste drücken = Richtung steht, Maus vom Ziel
// weg ziehen = Schläger holt aus (je weiter, desto stärker), loslassen = Schlag, Esc = abbrechen.
// Kamera: folgt dem Ball (room.focus), je Bahn eine Startansicht hinter dem Abschlag, „Übersicht“ zeigt die ganze Bahn schräg von oben.
// free = „Ohne Hilfen“: Schläge selbst eintragen, Ball verlegen (rules.js). Allein schummelt der Computer ab und zu
// (einmal je Bahn: Ball verlegen oder einen Schlag zu wenig eintragen – geht das Verlegen nicht, trägt er falsch ein) und
// prüft jeden Eintrag/jedes Verlegen des Menschen einmal, nur diesen neuesten Zug (schummeln.js).
import { newGame, applyShot, applyClaim, applyMove, accuse, waive, again, forGuest, ballOf, total, onLane, MAX_SCORE } from './rules.js';
import { COURSE, MAX_STROKES, teeView, overView } from './course.js';
import { plan, cheatSpot, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses, rematchBlocked } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const POWER_DEAD = 6; // die ersten Pixel zählen nicht (Zittern)
const POWER_PX = 300; // px für volle Kraft
const FINE = 0.1; // Shift: der Zielpunkt geht nur ein Zehntel des Mauswegs mit
const MIN_POWER = 0.015; // weniger ausgeholt = kein Schlag
const STROKE_S = 0.12; // Schläger schwingt nach dem Loslassen vor, dann trifft er den Ball
const THINK_MS = 700; // Computer überlegt kurz
const AIM_SHOW_MS = 900; // … und zeigt, wohin er zielt
const ACCUSE_MS = 900;
const CLAIM_MS = 1100;
const AIM_SEND_MS = 66; // Zielen 15-mal pro Sekunde an den anderen
const LOG = 3;
const LEVEL_KEY = 'spielesammlung-minigolf-stufe';

function loadLevel() {
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    const n = Number(raw);
    return raw !== null && Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1;
  } catch {
    return 1;
  }
}

export function startMinigolf({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (forGuest)
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let rolling = false; // mein Ball rollt gerade
  let charging = null; // { x, y, back, power } – Maustaste gedrückt: Richtung steht, Ziehen entlang back = Kraft
  let stroke = null; // { power, t } – losgelassen, der Schläger schwingt vor
  let aimAngle = 0;
  let last = null; // letzte Mausposition
  let fine = null; // Zielpunkt mit Shift (geht langsamer als die Maus)
  let lastAimSend = 0;
  let moving = false; // ohne Hilfen: nächster Klick legt den Ball dorthin
  let overview = false; // Kamera: Übersicht über die Bahn statt dem Ball folgen
  let viewKey = null; // Bahn und Spieler der zuletzt gesetzten Startansicht
  let cheered = false;
  let timer = null;
  let stopped = false;
  let thinking = false; // Computer rechnet gerade Probeschläge
  let statusShown = '';
  let log = [];
  const judged = new WeakSet(); // allein ohne Hilfen: schon geprüfte Einträge/Verlegungen des Menschen
  let sly = null; // allein ohne Hilfen: { key, how } – so schummelt der Computer auf dieser Bahn

  const who = (p) => (p === me ? 'Du' : solo ? 'Computer' : names.other());
  const verb = (p, du, er) => (p === me ? du : er);
  board.activate(true);
  board.ready(); // Physik schon laden, solange die Kamera hinfliegt
  board.onSettled = () => render();

  const panel = createPanel($('golf-panel'), {
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
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
    onOverview: () => {
      overview = !overview;
      setCamera(true);
    },
    onMove: () => {
      moving = !moving && canMove();
      board.setGhost(null);
      render();
    },
    onClaim: (n) => act('claim', n),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Minigolf"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'shot') return applyShot(state, p, arg);
    if (type === 'move') return applyMove(state, p, arg);
    if (type === 'claim') return applyClaim(state, p, arg);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'start' && next.seq === 0) {
      log = [];
      cheered = false;
      sly = null;
    }
    const fresh = next.seq !== state?.seq || next.round !== state?.round;
    state = next;
    if (fresh) {
      const line = describe(next);
      if (line) log = [line, ...log].slice(0, LOG);
    }
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: forGuest(state) });
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
      else render();
    } else {
      waiting = true;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (stopped) return;
    if (msg.t === 'golf') return board.applyRemote(msg);
    if (msg.t === 'aim') {
      if (state && state.turn !== me && Number.isFinite(msg.a) && Number.isFinite(msg.p)) board.setAim({ angle: msg.a, power: Math.min(Math.max(msg.p, 0), 1) });
      else if (msg.a === null) board.setAim(null);
      return;
    }
    if (!isHost && msg.t === 'state') {
      waiting = false;
      setState(msg.state);
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, other, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  const running = () => !!state && !state.result && !waiting;
  const myTurn = () => running() && state.turn === me && !rolling && !board.busy() && !thinking;
  const canAim = () => myTurn() && state.phase === 'play' && !moving;
  const canMove = () => !!state?.free && myTurn() && state.phase === 'play';

  // --- Schlag ---
  async function shoot(angle, power, player = me, phase = null) {
    rolling = true;
    board.setAim(null);
    if (player === me) send({ t: 'aim', a: null, p: 0 });
    panel.setPower(null);
    render();
    const report = await board.strike(angle, power, phase);
    rolling = false;
    if (stopped || !report) return;
    if (player === me) act('shot', report);
    else commit(applyShot(state, player, report) ?? state);
  }

  // --- Computer (nur allein) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Eintrag/jedes Verlegen des Menschen einmal prüfen, bevor der Computer selbst etwas tut
    if (s.free && s.cheat?.player === me && !judged.has(s.cheat)) {
      judged.add(s.cheat);
      if (cpuAccuses(!s.cheat.last)) return later(ACCUSE_MS, () => commit(accuse(state, other) ?? state));
      if (s.result) return later(ACCUSE_MS, () => commit(waive(state, other) ?? state));
    }
    if (s.result || s.turn !== other) return;
    const key = `${s.round}-${s.hole}`;
    if (s.free && sly?.key !== key) sly = { key, how: cpuCheats() ? (Math.random() < 0.5 ? 'move' : 'claim') : null };
    if (s.phase === 'claim') {
      return later(CLAIM_MS, () => {
        const { truth } = state.claim;
        const n = sly?.how && truth > 1 ? truth - 1 : truth; // auch, wenn sich der Ball nicht verlegen ließ
        commit(applyClaim(state, other, n) ?? state);
      });
    }
    later(THINK_MS, cpuShot);
  }

  async function cpuShot() {
    await board.ready();
    if (stopped) return;
    const physics = board.physics();
    if (sly?.how === 'move') {
      const spot = cheatSpot(physics, state);
      if (spot) {
        sly.how = null; // einmal je Bahn
        const moved = applyMove(state, other, spot);
        if (moved) return commit(moved);
      }
    }
    const at = state;
    thinking = true;
    render();
    const choice = await runPlan(plan(physics, state, lvl));
    thinking = false;
    if (stopped || state !== at || !choice) return render();
    board.setAim({ angle: choice.angle, power: choice.power });
    render();
    timer = setTimeout(() => !stopped && state === at && shoot(choice.angle, choice.power, other, choice.phase), AIM_SHOW_MS);
  }

  // Probeschläge in Häppchen rechnen, damit das Bild weiterläuft
  function runPlan(it) {
    return new Promise((resolve) => {
      const run = () => {
        if (stopped) return resolve(null);
        const t = performance.now();
        for (;;) {
          const { value, done } = it.next();
          if (done) return resolve(value);
          if (performance.now() - t > 14) break;
        }
        setTimeout(run, 0);
      };
      run();
    });
  }

  // Erst wenn der Ball liegt, kurz warten, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy() || rolling) timer = setTimeout(tick, 60);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // --- Kamera ---
  // Neue Bahn oder anderer Spieler: Startansicht hinter dem Abschlag. Sonst folgt der Blick dem Ball (onFrame).
  function setCamera(force = false) {
    if (!state) return;
    const key = `${state.round}-${state.hole}-${state.turn}`;
    if (!force && key === viewKey) return;
    if (key !== viewKey) overview = false;
    viewKey = key;
    room.setView(overview ? overView(state.hole) : teeView(state.hole));
  }

  // --- Anzeige ---
  function render() {
    if (stopped) return;
    if (!waiting) board.sync(state);
    if (!state) return;
    const s = state;
    if (!board.busy()) setCamera();
    if (!canMove()) moving = false;
    if (!moving) board.setGhost(null);
    const won = s.result?.winner === me;
    if (won && !cheered) board.celebrate(s.hole);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && !!s.cheat && s.cheat.player !== me && !waiting });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict), verdict.type === 'caught');
    panel.render({
      hole: s.hole,
      holeName: COURSE[s.hole].name,
      players: [0, 1].map((p) => ({
        name: p === me ? 'Du' : solo ? 'Computer' : names.other(),
        cells: s.scores[p].map((n, h) => (n !== null ? String(n) : h === s.hole && s.turn === p && s.count && (p === me || !s.free) ? `(${s.count})` : '')),
        total: String(total(s, p)),
        turn: !s.result && s.turn === p,
      })),
      status: statusText(),
      log,
      end: s.result ? endInfo() : null,
      free: !!s.free,
      claim: !waiting && s.phase === 'claim' && s.claim?.player === me && !board.busy(),
      canMove: canMove(),
      moving,
      overview,
      level: lvl,
    });
    if (!charging) panel.setPower(canAim() ? 0 : null);
    statusShown = statusText();
  }

  function statusText() {
    const s = state;
    if (s.result) return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (rolling || board.rolling()) return 'Der Ball rollt …';
    if (s.phase === 'claim') return s.claim.player === me ? 'Bahn fertig – trag deine Schläge ein' : `${who(s.claim.player)} trägt ein …`;
    if (s.turn !== me) return thinking ? 'Der Computer überlegt …' : solo ? 'Der Computer ist dran …' : `${names.other()} ist dran …`;
    if (board.busy()) return '…';
    if (moving) return 'Ball verlegen: Stelle auf der Bahn anklicken – Esc = abbrechen';
    return `Du bist dran – ${s.count + 1}. Schlag`;
  }

  // Neuigkeit eines Stands als eine Zeile (ohne Hilfen sieht man die Schläge des anderen nicht mitgezählt)
  function describe(s) {
    const parts = [];
    for (const e of s.events) {
      if (e.type === 'start') parts.push(`Runde ${s.round}: ${s.starter === me ? 'du fängst' : `${who(s.starter)} fängt`} an.`);
      else if (e.type === 'shot') {
        const hidden = s.free && e.by !== me;
        if (e.out) parts.push(`${who(e.by)}: Ball von der Bahn – Strafschlag${e.count >= MAX_STROKES ? `, damit Schluss: ${MAX_SCORE} notiert` : ', zurück an die Schlagstelle'}.`);
        else if (e.holed) parts.push(hidden ? `${who(e.by)} locht ein.` : `${who(e.by)} ${verb(e.by, 'lochst', 'locht')} ein – ${e.count === 1 ? 'mit dem ersten Schlag!' : `${e.count} Schläge`}.`);
        else if (e.count >= MAX_STROKES) parts.push(`${who(e.by)}: ${MAX_STROKES} Schläge, nicht drin – ${MAX_SCORE} notiert.`);
      } else if (e.type === 'claim') parts.push(`${who(e.by)} ${verb(e.by, 'trägst', 'trägt')} ${e.n} auf Bahn ${e.hole + 1} ein.`);
      else if (e.type === 'move' && e.by === me) parts.push('Ball verlegt.');
      else if (e.type === 'hole') parts.push(`Weiter auf Bahn ${e.hole + 1}: ${COURSE[e.hole].name}.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    if (s.result) parts.push(s.result.winner === null ? 'Unentschieden!' : s.result.winner === me ? 'Gewonnen!' : `${who(s.result.winner)} gewinnt.`);
    return parts.join(' ');
  }

  // e = { caught, player (bekommt die Strafe), by (hat gerufen), why }
  function verdictText(e) {
    if (e.caught) {
      const penalty = e.fixed ? 'Eintrag berichtigt, dazu 2 Strafschläge' : '2 Strafschläge';
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ ' : ''}Erwischt! Du hast geschummelt: ${e.why}. ${penalty}.`;
      return `Erwischt! ${who(e.player)} hat geschummelt: ${e.why}. ${penalty}.`;
    }
    if (e.player === me) return 'Fehlalarm! Da war alles in Ordnung – du bekommst 1 Strafschlag.';
    return solo ? 'Der Computer ruft „Geschummelt!“ – Fehlalarm, bei dir war alles in Ordnung. Er bekommt 1 Strafschlag.'
      : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt 1 Strafschlag.`;
  }

  function endInfo() {
    const { winner } = state.result;
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    const name = solo ? 'Computer' : names.other();
    const pen = state.penalty.some((n) => n) ? ` (mit Strafschlägen: du ${state.penalty[me]}, ${name} ${state.penalty[other]})` : '';
    const blocked = rematchBlocked(state, me) ? ` Revanche erst, wenn ${name} deinen letzten Eintrag geprüft hat.` : '';
    return { title, text: `Schläge: du ${total(state, me)}, ${name} ${total(state, other)}${pen}. Siege: du ${state.wins[me]} : ${state.wins[other]} ${name}.${blocked}` };
  }

  // --- Eingaben ---
  function onMove(e) {
    const [dx, dy] = last ? [e.clientX - last.x, e.clientY - last.y] : [0, 0];
    last = { x: e.clientX, y: e.clientY };
    if (moving) {
      const spot = canMove() ? board.pickFloor(room.rayFrom(e)) : null;
      const ok = spot && onLane(state.hole, spot);
      board.setGhost(ok ? spot : null);
      canvas.style.cursor = ok ? 'pointer' : 'not-allowed';
      return;
    }
    if (!canAim() || stroke) return;
    if (charging) {
      if (!(e.buttons & 1)) return cancel(); // Taste außerhalb des Fensters losgelassen
      const along = (e.clientX - charging.x) * charging.back.x + (e.clientY - charging.y) * charging.back.y;
      charging.power = Math.min(Math.max((along - POWER_DEAD) / POWER_PX, 0), 1);
    } else {
      const point = e.shiftKey ? (fine = { clientX: (fine?.clientX ?? e.clientX - dx) + dx * FINE, clientY: (fine?.clientY ?? e.clientY - dy) + dy * FINE }) : ((fine = null), e);
      const spot = board.pickAim(room.rayFrom(point));
      if (spot) {
        const b = ballOf(state);
        if (Math.hypot(spot[0] - b[0], spot[1] - b[2]) > 0.02) aimAngle = Math.atan2(-(spot[1] - b[2]), spot[0] - b[0]);
      }
    }
    showAim();
  }

  // Richtung „vom Ziel weg“ auf dem Bildschirm als Einheitsvektor
  function backOnScreen() {
    const b = ballOf(state);
    const a = room.toScreen(board.toWorld(b));
    const c = room.toScreen(board.toWorld([b[0] - Math.cos(aimAngle) * 0.2, b[1], b[2] + Math.sin(aimAngle) * 0.2]));
    const len = a && c ? Math.hypot(c.x - a.x, c.y - a.y) : 0;
    return len > 1 ? { x: (c.x - a.x) / len, y: (c.y - a.y) / len } : { x: 0, y: 1 };
  }

  function showAim(power = charging?.power ?? 0) {
    board.setAim({ angle: aimAngle, power });
    if (charging) panel.setPower(power);
    const now = performance.now();
    if (now - lastAimSend > AIM_SEND_MS) {
      lastAimSend = now;
      send({ t: 'aim', a: Math.round(aimAngle * 10000) / 10000, p: Math.round(power * 100) / 100 });
    }
  }

  function onDown(e) {
    if (e.button !== 0 || e.target !== canvas) return;
    if (moving) {
      const spot = canMove() ? board.pickFloor(room.rayFrom(e)) : null;
      if (spot && onLane(state.hole, spot)) {
        moving = false;
        board.setGhost(null);
        act('move', spot);
      }
      return;
    }
    if (!canAim() || stroke) return;
    charging = { x: e.clientX, y: e.clientY, back: backOnScreen(), power: 0 };
    canvas.setPointerCapture(e.pointerId); // Ziehen geht weiter, auch über dem Seitenfeld
  }

  function onUp(e) {
    if (e.button !== 0 || !charging) return;
    const { power } = charging;
    charging = null;
    if (power < MIN_POWER || !canAim()) return cancel();
    stroke = { power, t: 0 };
  }

  function cancel() {
    charging = null;
    lastAimSend = 0;
    if (canAim()) showAim(0);
    render();
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (charging) cancel();
    if (moving) {
      moving = false;
      board.setGhost(null);
      canvas.style.cursor = '';
      render();
    }
  }

  const forget = () => (last = null);
  const noSelect = (e) => e.button === 0 && e.preventDefault();

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerleave', forget);
  canvas.addEventListener('mousedown', noSelect);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    if (stroke) {
      // Schläger schwingt vor und trifft den Ball – dann rechnet die Physik mit der Kraft vom Loslassen
      stroke.t += dt;
      if (stroke.t < STROKE_S) showAim(stroke.power * (1 - stroke.t / STROKE_S));
      else {
        const { power } = stroke;
        stroke = null;
        shoot(aimAngle, power);
      }
    }
    if (state && !overview) room.focus(board.ballWorld()); // Blick folgt dem Ball (auch beim Ausrollen)
    if (state && statusShown !== statusText()) render();
  });

  if (isHost) commit(resume ?? newGame({ starter: Math.random() < 0.5 ? 0 : 1, free }));
  setTimeout(() => !stopped && setCamera(true), 0); // nach room.setView(golf0/golf1) in main.js

  return {
    handle,
    refresh: () => render(),
    view: () => state,
    stop() {
      stopped = true;
      clearTimeout(timer);
      cheat.remove();
      board.onSettled = null;
      board.activate(false);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', forget);
      canvas.removeEventListener('mousedown', noSelect);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
