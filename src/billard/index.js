// Billard-Partie (8-Ball): verbindet Spielstand (rules.js), Tisch mit Physik (table.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Der Host hält den Spielstand. Wer stößt, rechnet die Physik selbst, streamt die
// Kugeln und meldet das Ergebnis (Gast → Host: { t: 'shot', arg: report }). Zielen sieht der andere live ('aim').
// Bedienung: Maus zeigt die Richtung, linke Maustaste gedrückt halten = Kraft, loslassen = Stoß, Esc = abbrechen.
import { newGame, applyShot, placeCue, again, targets, freeSpot, SOLIDS, STRIPES } from './rules.js';
import { chooseShot } from './ai.js';
import { createPanel } from './panel.js';

const $ = (id) => document.getElementById(id);
const CHARGE_S = 1.3; // Kraft füllt sich so lange (und läuft dann zurück)
const THINK_MS = 1000; // Computer überlegt kurz
const AIM_SHOW_MS = 900; // Computer zeigt kurz, wohin er zielt
const AIM_SEND_MS = 66; // Zielen 15-mal pro Sekunde an den anderen
const GROUP_NAME = { volle: 'Volle (1–7)', halbe: 'Halbe (9–15)' };
const listOf = { volle: SOLIDS, halbe: STRIPES };

export function startBillard({ room, board, canvas, me, send, onLeave, ask, level, names }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = () => (solo ? 'Computer' : names.other());
  const nameOf = (p) => (p === me ? 'Du' : other());
  let state = null;
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let rolling = false; // meine Kugeln rollen gerade
  let charging = null; // { start } – Maustaste gedrückt, Kraft lädt (nach der Uhr, nicht nach Bildern)
  let aimAngle = 0;
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
    // Kamera schaut zur weißen Kugel, sobald alles liegt (beim „Ball in Hand“ auf die Tischmitte)
    if (!rolling && !board.busy()) room.focus(board.toWorld(state.positions[0] ?? [0, 0]));
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
    return `Du bist dran (${goal}) – zielen, Maustaste halten = Kraft, loslassen = Stoß`;
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
    if (!myTurn()) return;
    const spot = board.pickBed(room.rayFrom(e));
    if (!spot) return;
    if (placingNow()) {
      board.setPlacing(spot);
      canvas.style.cursor = freeSpot(state, spot, 0) ? 'pointer' : 'not-allowed';
      return;
    }
    const cue = state.positions[0];
    aimAngle = Math.atan2(-(spot[1] - cue[1]), spot[0] - cue[0]);
    showAim();
  }

  function showAim() {
    const power = charging ? chargeNow() : 0;
    board.setAim({ angle: aimAngle, power });
    const now = performance.now();
    if (now - lastAimSend > AIM_SEND_MS) {
      lastAimSend = now;
      send({ t: 'aim', a: Math.round(aimAngle * 10000) / 10000, p: Math.round(power * 100) / 100 });
    }
  }

  // Kraft läuft hoch und wieder runter, solange die Taste gedrückt ist
  const chargeNow = () => {
    const k = ((performance.now() - charging.start) / 1000 / CHARGE_S) % 2;
    return Math.max(0.03, k < 1 ? k : 2 - k);
  };

  function onDown(e) {
    if (e.button !== 0 || !myTurn() || e.target !== canvas) return;
    if (placingNow()) {
      const spot = board.pickBed(room.rayFrom(e));
      if (spot && freeSpot(state, spot, 0)) {
        board.setPlacing(null);
        act('place', [Math.round(spot[0] * 10000) / 10000, Math.round(spot[1] * 10000) / 10000]);
      }
      return;
    }
    charging = { start: performance.now() };
  }

  function onUp(e) {
    if (e.button !== 0 || !charging) return;
    const power = chargeNow();
    charging = null;
    if (myTurn()) shoot(aimAngle, power);
  }

  function onKey(e) {
    if (e.key === 'Escape' && charging) {
      charging = null;
      showAim();
      render();
    }
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    if (charging) {
      panel.setPower(chargeNow());
      showAim();
    }
    if (state && statusShown !== statusText()) render(); // z. B. nach dem Ausrollen beim Zuschauer
  });

  if (isHost) commit(newGame({ breaker: Math.random() < 0.5 ? 0 : 1 })); // wer anstößt, entscheidet der Zufall

  return {
    handle,
    refresh: () => render(),
    stop() {
      stopped = true;
      clearTimeout(timer);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
