// Billard-Partie (8-Ball): verbindet Spielstand (rules.js), Tisch mit Physik (table.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Der Host hält den Spielstand. Wer stößt, rechnet die Physik selbst, streamt die
// Kugeln und meldet das Ergebnis (Gast → Host: { t: 'shot', arg: report }). Zielen sieht der andere live ('aim').
// Bedienung (Nico 20.10.2026): Maus zeigt die Richtung (Shift = fein), linke Maustaste drücken = Richtung steht,
// dann die Maus vom Ziel weg ziehen = Queue zurückziehen (je weiter, desto stärker), loslassen = Stoß, Esc = abbrechen.
import { newGame, applyShot, placeCue, again, targets, freeSpot, SOLIDS, STRIPES } from './rules.js';
import { chooseShot } from './ai.js';
import { createPanel } from './panel.js';

const $ = (id) => document.getElementById(id);
// Kraft = Mausweg in Bildschirm-Pixeln entlang des Queues, vom Ziel weg – in jeder Kameraansicht gleich (auf dem Tuch
// gemessen waren es je nach Zoom und Blickwinkel 60 px = 26 % oder 32 px = 75 %). Die ersten Pixel zählen nicht (Zittern).
const POWER_DEAD = 6;
const POWER_PX = 300; // px für volle Kraft
const FINE = 0.1; // Shift: der Zielpunkt geht nur ein Zehntel des Mauswegs mit
const FINE_RELEASE = 20; // nach Shift bleibt der Zielpunkt stehen, bis die Maus so viele px weiter ist (kein Sprung)
const MIN_POWER = 0.02; // weniger zurückgezogen = kein Stoß (abgebrochen)
const STROKE_S = 0.09; // Queue schnellt nach dem Loslassen vor, dann trifft er die Weiße
const THINK_MS = 1000; // Computer überlegt kurz
const AIM_SHOW_MS = 900; // Computer zeigt kurz, wohin er zielt
const AIM_SEND_MS = 66; // Zielen 15-mal pro Sekunde an den anderen
const GROUP_NAME = { volle: 'Volle (1–7)', halbe: 'Halbe (9–15)' };
const listOf = { volle: SOLIDS, halbe: STRIPES };

export function startBillard({ room, board, canvas, me, send, onLeave, ask, level, names, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = () => (solo ? 'Computer' : names.other());
  const nameOf = (p) => (p === me ? 'Du' : other());
  let state = null;
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let rolling = false; // meine Kugeln rollen gerade
  let charging = null; // { x, y, back, power } – Maustaste gedrückt bei x/y: Richtung steht, Ziehen entlang back = Kraft
  let stroke = null; // { power, t } – losgelassen, der Queue schnellt vor
  let aimAngle = 0;
  let last = null; // letzte Mausposition { x, y }
  let fine = null; // Zielpunkt mit Shift { clientX, clientY } (geht langsamer als die Maus)
  let hold = null; // nach Shift: { x, y, at } – Maus bei x/y, gezielt wird weiter auf at
  let lastAimSend = 0;
  let cheered = false;
  let timer = null;
  let stopped = false;
  let statusShown = ''; // zuletzt angezeigter Status – ändert er sich (z. B. Kugeln liegen), wird neu gezeichnet

  const panel = createPanel($('bil-panel'), {
    solo,
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && state?.winner === null ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });

  function apply(type, player, arg) {
    if (type === 'shot') return applyShot(state, player, arg);
    if (type === 'place') return placeCue(state, player, arg);
    if (type === 'again') return again(state);
    return null;
  }

  function commit(next) {
    state = next;
    send({ t: 'state', state });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    if (solo) computerTurn();
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
    if (msg.t === 'bil') return board.applyRemote(msg);
    if (msg.t === 'aim') {
      if (state && state.turn !== me && Number.isFinite(msg.a) && Number.isFinite(msg.p)) board.setAim({ angle: msg.a, power: Math.min(Math.max(msg.p, 0), 1) });
      else if (msg.a === null) board.setAim(null);
      return;
    }
    if (!isHost && msg.t === 'state') {
      state = msg.state;
      waiting = false;
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 1 - me, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  const myTurn = () => state && state.winner === null && state.turn === me && !waiting && !rolling && !board.busy();
  const placingNow = () => myTurn() && (state.ballInHand || !state.positions[0]);

  // --- Stoß ---
  async function shoot(angle, power, player = me) {
    rolling = true;
    board.setAim(null);
    if (player === me) send({ t: 'aim', a: null, p: 0 });
    panel.setPower(null);
    render();
    const report = await board.strike(angle, power);
    rolling = false;
    if (stopped || !report) return;
    if (player === me) act('shot', report);
    else if (isHost) {
      const next = applyShot(state, player, report);
      if (next) commit(next);
    }
  }

  // Computer (allein): Weiße hinlegen falls nötig, kurz zielen, stoßen
  function computerTurn() {
    clearTimeout(timer);
    if (!state || state.winner !== null || state.turn === me) return;
    timer = setTimeout(() => {
      const plan = chooseShot(state, 1 - me, { skill: 0.72 });
      if (plan.place) {
        const placed = placeCue(state, 1 - me, plan.place);
        if (placed) {
          state = placed;
          render();
        }
      }
      board.setAim({ angle: plan.angle, power: plan.power });
      timer = setTimeout(() => shoot(plan.angle, plan.power, 1 - me), AIM_SHOW_MS);
    }, THINK_MS);
  }

  // --- Anzeige ---
  function render() {
    if (!waiting) board.sync(state); // Gast: nach dem Stoß nicht auf den alten Stand zurückspringen, bis der Host antwortet
    if (!state) return;
    const players = [0, 1].map((p) => {
      const g = state.groups[p];
      return {
        name: p === me ? `Du (${names.me()})` : solo ? 'Computer' : other(),
        group: g ? GROUP_NAME[g] : state.isBreak ? 'Anstoß' : 'offen',
        left: g ? listOf[g].filter((n) => !state.pocketed.includes(n)) : [],
        turn: state.winner === null && state.turn === p,
      };
    });
    const won = state.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    panel.render({
      players,
      status: statusText(),
      last: lastText(),
      end: state.winner === null ? null : {
        title: state.winner === me ? 'Du gewinnst!' : `${other()} gewinnt`,
        text: state.last?.eight === 'gewonnen' ? `Die 8 regelgerecht versenkt.` : `Die 8 ${state.last?.foul ? `mit Foul (${state.last.foul})` : 'zu früh'} versenkt.`,
      },
    });
    if (!charging) panel.setPower(myTurn() && !placingNow() ? 0 : null);
    statusShown = statusText();
  }

  function statusText() {
    if (state.winner !== null) return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (rolling || board.busy()) return 'Die Kugeln rollen …';
    if (state.turn !== me) return solo ? 'Der Computer ist dran …' : `${other()} ist dran …`;
    if (placingNow()) return 'Ball in Hand: Weiße mit der Maus hinlegen (klicken)';
    const must = targets(state, me);
    const goal = state.isBreak ? 'Anstoß' : must?.length === 1 && must[0] === 8 ? 'jetzt die 8' : must ? GROUP_NAME[state.groups[me]] : 'Tisch offen';
    return `Du bist dran (${goal}) – zielen, Maustaste halten und vom Ziel weg ziehen = Kraft, loslassen = Stoß`;
  }

  function lastText() {
    const l = state.last;
    if (!l) return state.isBreak ? `${nameOf(state.turn)} stößt an.` : '';
    if (l.eight) return '';
    const mine = l.player === me;
    const sunk = l.pocketed.length ? l.pocketed.join(', ') : 'nichts';
    if (l.foul) {
      const inHand = state.turn === me ? 'Du hast' : `${other()} hat`;
      return `${mine ? 'Dein Foul' : `Foul von ${other()}`}: ${l.foul}. ${inHand} Ball in Hand.`;
    }
    return `${mine ? 'Du versenkst' : `${other()} versenkt`} ${sunk}${l.keep ? ' und stößt weiter.' : '.'}`;
  }

  // --- Eingaben ---
  function onMove(e) {
    const [dx, dy] = last ? [e.clientX - last.x, e.clientY - last.y] : [0, 0]; // vor dem Abbruch merken – sonst springt das feine Zielen
    last = { x: e.clientX, y: e.clientY };
    if (!myTurn() || stroke) return;
    if (placingNow()) {
      const spot = board.pickBed(room.rayFrom(e));
      if (!spot) return;
      board.setPlacing(spot);
      canvas.style.cursor = freeSpot(state, spot, 0) ? 'pointer' : 'not-allowed';
      return;
    }
    if (charging) {
      if (!(e.buttons & 1)) return cancel(); // Taste außerhalb des Fensters losgelassen
      // Richtung steht – wie weit ist die Maus auf dem Bildschirm entlang des Queues vom Ziel weg gewandert?
      const along = (e.clientX - charging.x) * charging.back.x + (e.clientY - charging.y) * charging.back.y;
      charging.power = Math.min(Math.max((along - POWER_DEAD) / POWER_PX, 0), 1);
    } else {
      const spot = board.pickBed(room.rayFrom(aimPoint(e, dx, dy)));
      if (spot) {
        const cue = state.positions[0];
        aimAngle = Math.atan2(-(spot[1] - cue[1]), spot[0] - cue[0]);
      }
    }
    showAim();
  }

  // Punkt, auf den gezielt wird: sonst die Maus selbst. Mit Shift ein eigener Punkt, der nur ein Zehntel des Mauswegs
  // mitgeht; nach dem Loslassen von Shift bleibt er stehen, bis die Maus ein Stück weiterbewegt wurde.
  function aimPoint(e, dx, dy) {
    if (e.shiftKey) {
      const from = fine ?? hold?.at ?? { clientX: e.clientX - dx, clientY: e.clientY - dy };
      [fine, hold] = [{ clientX: from.clientX + dx * FINE, clientY: from.clientY + dy * FINE }, null];
      return fine;
    }
    if (fine) [hold, fine] = [{ x: e.clientX, y: e.clientY, at: fine }, null];
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < FINE_RELEASE) return hold.at;
    hold = null;
    return e;
  }

  // Richtung „vom Ziel weg“ (zum Ende des Queues) auf dem Bildschirm als Einheitsvektor
  function backOnScreen() {
    const cue = state.positions[0];
    const a = room.toScreen(board.toWorld(cue));
    const b = room.toScreen(board.toWorld([cue[0] - Math.cos(aimAngle) * 0.1, cue[1] + Math.sin(aimAngle) * 0.1]));
    const len = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    return len > 1 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 1 }; // Kugel nicht im Bild: nach unten ziehen
  }

  // power = wie weit der Queue zurückgezogen ist (0–1), auch beim Mitspieler zu sehen
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
    if (e.button !== 0 || !myTurn() || stroke || e.target !== canvas) return;
    if (placingNow()) {
      const spot = board.pickBed(room.rayFrom(e));
      if (spot && freeSpot(state, spot, 0)) {
        board.setPlacing(null);
        act('place', [Math.round(spot[0] * 10000) / 10000, Math.round(spot[1] * 10000) / 10000]);
      }
      return;
    }
    charging = { x: e.clientX, y: e.clientY, back: backOnScreen(), power: 0 };
    canvas.setPointerCapture(e.pointerId); // Ziehen geht weiter, auch wenn die Maus über das Seitenfeld rutscht
  }

  function onUp(e) {
    if (e.button !== 0 || !charging) return;
    const { power } = charging;
    charging = null;
    if (power < MIN_POWER || !myTurn()) return cancel();
    stroke = { power, t: 0 };
  }

  function cancel() {
    charging = null;
    lastAimSend = 0; // der andere soll den Abbruch gleich sehen, nicht erst beim nächsten Zielen
    if (myTurn()) showAim(0);
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape' && charging) cancel();
  }

  const forget = () => (last = null); // Maus verlässt das Bild – beim Zurückkommen nicht den ganzen Weg als Zug werten
  const noSelect = (e) => e.button === 0 && e.preventDefault(); // Ziehen markiert sonst Text im Seitenfeld

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerleave', forget);
  canvas.addEventListener('mousedown', noSelect);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    if (stroke) {
      // Queue schnellt vor, trifft die Weiße – dann rechnet die Physik mit der Kraft vom Loslassen
      stroke.t += dt;
      if (stroke.t < STROKE_S) showAim(stroke.power * (1 - stroke.t / STROKE_S));
      else {
        const { power } = stroke;
        stroke = null;
        shoot(aimAngle, power);
      }
    }
    if (state && statusShown !== statusText()) render(); // z. B. nach dem Ausrollen beim Zuschauer
  });

  if (isHost) commit(resume ?? newGame({ breaker: Math.random() < 0.5 ? 0 : 1 })); // wer anstößt, entscheidet der Zufall

  return {
    handle,
    refresh: () => render(),
    stop() {
      stopped = true;
      clearTimeout(timer);
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
