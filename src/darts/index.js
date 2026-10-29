// Darts-Partie (501/301 Double Out): verbindet Spielstand (game.js), Scheibe mit Physik (board.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Der Host hält den Stand, der Gast schickt Wünsche (setup, throw, pull, next, accuse, again,
// regroup), der Host prüft sie und antwortet mit { t: 'state' }. Wer wirft, rechnet die Physik selbst, streamt den Pfeil
// ({ t: 'dart' }) und meldet, wo er steckt (throw); die Punkte rechnet der Host aus dieser Lage. Zielen sieht der andere
// live ({ t: 'aim' }). Beide sehen die Scheibe aus derselben festen Sicht von der Abwurflinie (room.js darts0/darts1).
// Werfen (wurf.js): Maus = zielen (die Hand zittert leicht), linke Maustaste drücken = Ziel steht, Maus zügig nach oben
// schnippen und dabei loslassen. Esc = abbrechen. Leertaste = Pfeile ziehen.
// free = „Ohne Hilfen“: Punkte selbst eintragen (game.js). Allein schummelt der Computer ab und zu beim Eintragen und
// prüft jeden Eintrag des Menschen einmal (schummeln.js).
import { newGame, setup, throwDart, pull, nextLegFree, accuse, waive, again, regroup, forGuest, judgeVisit, dartsAllowed, legsToWin, average } from './game.js';
import { checkout, centerOf } from './rules.js';
import { chooseTarget, fakeClaim, LEVELS } from './ai.js';
import { RELEASE } from './physics.js';
import { readFlick, validFlick, throwVelocity, cpuVelocity, tremor, flickText } from './wurf.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 700; // Computer: Pause vor dem Wurf
const AIM_MS = 650; // Computer zeigt so lange, wohin er zielt
const PULL_MS = 1600; // Computer zieht seine Pfeile nach dieser Pause
const ACCUSE_MS = 900;
const AIM_SEND_MS = 66;
const SAMPLE_MS = 300; // so viel Mausweg merken (die Messung braucht die letzten 60 ms)
const LEVEL_KEY = 'spielesammlung-darts-stufe';

function loadLevel() {
  try {
    const n = Number(localStorage.getItem(LEVEL_KEY));
    return localStorage.getItem(LEVEL_KEY) !== null && Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1;
  } catch {
    return 1;
  }
}

export function startDarts({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const cpu = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (forGuest)
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let timer = null;
  let stopped = false;
  let cheered = false;
  let feedback = null; // Rückmeldung zum eigenen letzten Wurf
  let aim = null; // Punkt unter der Maus auf der Scheibe [x, y]
  let charging = null; // Maustaste gedrückt: { aim, samples }
  let throwing = false; // eigener Pfeil ist unterwegs
  let clock = 0; // s – fürs Zittern
  let lastAimSend = 0;
  let aimShown = false; // der andere sieht gerade meinen Zielpunkt
  const judged = new WeakSet(); // allein ohne Hilfen: schon geprüfte Einträge des Menschen

  const who = (p) => (p === me ? 'Du' : solo ? 'Computer' : names.other());
  const hint = document.querySelector('[data-game="Darts"] .dock [data-hint]');
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint });
  const panel = createPanel($('dt-panel'), {
    solo,
    onSetup: (pick) => act('setup', pick),
    onLevel: (n) => {
      lvl = n;
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch {
        // ohne Speicher gilt die Stufe eben nur bis zum Neuladen
      }
      render();
    },
    onPull: () => act('pull'),
    onClaim: (claim) => {
      const rest = state?.rest[me];
      if (rest !== undefined && (claim > rest || rest - claim === 1)) {
        feedback = `${claim} geht nicht – Rest ${rest}${rest - claim === 1 ? ' würde 1' : ' würde unter 0'}. Das ist überworfen: 0 eintragen.`;
        return render();
      }
      act('pull', { claim });
    },
    onNext: () => act('next'),
    onAgain: () => act('again'),
    onRegroup: () => act('regroup'),
    onLeave: (confirm) => (confirm && state?.phase !== 'over' ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });

  function apply(type, p, arg) {
    if (type === 'setup') return setup(state, p, arg ?? {});
    if (type === 'throw') return throwDart(state, p, arg);
    if (type === 'pull') return pull(state, p, arg?.claim);
    if (type === 'next') return nextLegFree(state, p);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    if (type === 'regroup') return regroup(state, p);
    return null;
  }

  function commit(next) {
    state = next;
    if (!solo) send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting || stopped || (type === 'accuse' && throwing)) return; // eigener Pfeil fliegt: erst melden, dann anklagen
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
    if (msg.t === 'dart') return board.applyRemote(msg);
    if (msg.t === 'aim') {
      const ok = Array.isArray(msg.a) && msg.a.length === 2 && msg.a.every((v) => Number.isFinite(v) && Math.abs(v) < 1);
      if (state && state.turn !== me) board.setAim(ok ? msg.a : null, 1 - me);
      return;
    }
    if (!isHost && msg.t === 'state') {
      state = msg.state;
      waiting = false;
      throwing = false;
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, 1, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Computer (nur allein) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Eintrag des Menschen einmal prüfen
    if (s.free && s.cheat?.player === me && !judged.has(s.cheat)) {
      judged.add(s.cheat);
      if (cpuAccuses(!s.cheat.legal)) return later(ACCUSE_MS, () => commit(accuse(state, cpu) ?? state));
    }
    if (s.free && s.cheat?.player === me && s.phase === 'legover') return later(ACCUSE_MS, () => commit(nextLegFree(state, cpu) ?? state));
    if (s.free && s.cheat?.player === me && s.phase === 'over') return later(ACCUSE_MS, () => commit(waive(state, cpu) ?? state));
    if (s.phase !== 'play' || s.turn !== cpu) return;
    const truth = judgeVisit(s.visitStart, s.darts);
    const allowed = dartsAllowed(s, cpu);
    const over = s.free ? s.darts.length > 0 && (s.darts.length >= allowed || truth.bust || truth.checkout) : !!s.done;
    if (over) {
      return later(PULL_MS, () => {
        let claim;
        if (state.free) {
          const fake = cpuCheats() ? fakeClaim(truth, state.darts.map((d) => d.hit.label), state.visitStart) : null;
          claim = fake ?? truth.points;
        }
        commit(pull(state, cpu, claim) ?? state);
      });
    }
    later(THINK_MS, async () => {
      const rest = state.free ? state.rest[cpu] - truth.points : state.rest[cpu];
      const target = centerOf(chooseTarget(rest, allowed - state.darts.length));
      board.setAim(target, cpu);
      const at = state;
      await Promise.all([board.ready(), new Promise((r) => setTimeout(r, AIM_MS))]);
      if (stopped || state !== at) return;
      const v = cpuVelocity(RELEASE, target, LEVELS[lvl].sigma, Math.random, board.aim);
      const report = await board.throwDart(RELEASE, v, cpu);
      if (stopped || state !== at || !report) return;
      commit(throwDart(state, cpu, report) ?? state);
    });
  }

  // Erst wenn nichts mehr fliegt, kurz warten, dann handeln (ändert sich vorher der Stand, entfällt der Aufruf)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // --- Anzeige ---
  const running = () => !!state && state.phase === 'play' && !waiting;
  const myTurn = () => running() && state.turn === me && !throwing && !board.busy();
  const canThrow = () => myTurn() && !state.done && state.darts.length < dartsAllowed(state, me);

  function render() {
    if (!waiting && !throwing) board.sync(state); // Gast: eigenen Pfeil nicht wegnehmen, bis der Host antwortet
    if (!state) return;
    const v = state;
    const won = v.phase === 'over' && v.winner === me;
    if (won && !cheered) board.celebrate();
    cheered = won;
    cheat.update({ free: !!v.free, canAccuse: !!v.free && !!v.cheat && v.cheat.player !== me && !waiting && !throwing });
    const ev = v.events?.[0];
    if (v.verdict && (ev?.type === 'caught' || ev?.type === 'fehlalarm')) cheat.say(`${v.round}-${v.seq}`, verdictText(v.verdict), v.verdict.caught);
    const need = legsToWin(v);
    const inVisit = v.phase !== 'setup' && v.darts.length > 0;
    const allowed = dartsAllowed(v, v.turn);
    const live = v.phase === 'play' && !v.done;
    const left = allowed - v.darts.length;
    const route = !v.free && live && left > 0 ? checkout(v.rest[v.turn], left) : null;
    panel.render({
      format: v.phase === 'setup' ? 'Einstellungen' : `${v.mode} · Double Out · Best of ${v.bestOf}${v.round > 1 ? ` · Partie ${v.round}` : ''}`,
      players: [0, 1].map((p) => ({
        name: p === me ? `Du (${names.me()})` : solo ? `Computer (${LEVELS[lvl].name})` : names.other(),
        rest: v.rest[p],
        legs: v.legs[p],
        need,
        avg: `Schnitt ${average(v, p).toFixed(1)}${v.wins[0] + v.wins[1] ? ` · Siege ${v.wins[p]}` : ''}`,
        turn: v.phase !== 'setup' && v.phase !== 'over' && v.turn === p,
      })),
      visit: v.phase === 'setup' ? null : {
        slots: [0, 1, 2].map((i) => (i < v.darts.length ? dartText(v.darts[i]) : i >= allowed ? '✕' : undefined)),
        sum: v.free || !inVisit ? '' : v.done === 'bust' ? 'Bust' : String(v.visitStart - v.rest[v.turn]),
      },
      checkout: route?.join(' · ') ?? null,
      status: statusText(),
      feedback: v.turn === me ? feedback : null, // Rückmeldung nur zur eigenen Aufnahme
      setup: v.phase === 'setup' ? { mine: isHost, mode: v.mode, bestOf: v.bestOf } : null,
      actions: actionsNow(),
      level: lvl,
      log: v.history.map(logText),
      end: v.phase === 'over' ? {
        title: v.winner === me ? 'Du gewinnst!' : `${who(v.winner)} gewinnt`,
        text: `Legs ${v.legs[v.winner]}:${v.legs[1 - v.winner]} · Schnitt ${average(v, v.winner).toFixed(1)}`,
        regroup: isHost,
      } : null,
    });
    if (!charging) panel.setTempo(canThrow() ? 0 : null);
  }

  // Ohne Hilfen bleibt das getroffene Feld verborgen – man liest es an der Scheibe ab
  const dartText = (d) => (state.free || !d.hit ? '●' : d.hit.label === 'Miss' ? 'daneben' : d.hit.label);

  function actionsNow() {
    const v = state;
    if (waiting || throwing) return null;
    if (v.phase === 'legover' && v.turn !== me) return { next: true };
    if (v.phase !== 'play' || v.turn !== me || board.busy()) return null;
    if (v.free) return v.darts.length ? { claim: true } : null;
    return v.done ? { pull: true } : null;
  }

  function statusText() {
    const v = state;
    if (v.phase === 'setup') return isHost ? 'Modus und Legs wählen, dann „Los geht’s“' : `${names.other()} stellt die Partie ein …`;
    if (v.phase === 'over') return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (throwing || board.flying()) return 'Der Pfeil fliegt …';
    if (v.phase === 'legover') return v.turn === me ? `Checkout eingetragen – ${who(1 - me)} startet das nächste Leg …` : `${who(v.turn)} hat ein Checkout eingetragen – „Nächstes Leg“ oder „Geschummelt!“`;
    if (v.turn !== me) return v.done ? `${who(v.turn)} zieht die Pfeile …` : solo ? 'Der Computer wirft …' : `${who(v.turn)} wirft …`;
    const allowed = dartsAllowed(v, me);
    const throwHint = `Pfeil ${v.darts.length + 1} von ${allowed}: zielen, Maustaste drücken, Maus nach oben schnippen und dabei loslassen`;
    if (v.free) return v.darts.length < allowed ? `${throwHint}${v.darts.length ? ' – oder schon Punkte eintragen' : ''}` : 'Punkte dieser Aufnahme eintragen (Bust = 0)';
    if (v.done === 'bust') return 'Überworfen! Die Aufnahme zählt nicht – Pfeile ziehen (Leertaste)';
    if (v.done === 'checkout') return 'Checkout! Leg gewonnen – Pfeile ziehen (Leertaste)';
    if (v.done) return 'Pfeile ziehen (Leertaste)';
    return throwHint;
  }

  function logText(h) {
    const pts = h.caught ? '0 (erwischt)' : h.bust ? (state.free ? '0' : 'Bust') : String(h.points);
    return `${who(h.player)}: ${pts}${h.labels.length ? ` – ${h.labels.map((l) => (l === 'Miss' ? '–' : l)).join(' ')}` : ''}`;
  }

  // Strafe = ein Pfeil weniger in der nächsten Aufnahme des Bestraften (Strafen zählen zusammen, mindestens 1 Pfeil)
  function verdictText(vd) {
    const caller = vd.by === me ? 'Du rufst' : `${who(vd.by)} ruft`;
    const punished = vd.caught ? vd.player : vd.by;
    const n = dartsAllowed(state, punished);
    const penalty = `${punished === me ? 'Du hast' : `${who(punished)} hat`} in der nächsten Aufnahme nur ${n} ${n === 1 ? 'Pfeil' : 'Pfeile'}.`;
    if (vd.caught) return `${caller} „Geschummelt!“ – erwischt: ${vd.why}. Die Aufnahme zählt 0. ${penalty}`;
    return `${caller} „Geschummelt!“ – Fehlalarm, der Eintrag stimmte. ${penalty}`;
  }

  // --- Werfen ---
  async function doThrow(at, flick) {
    throwing = true;
    canvas.style.cursor = '';
    feedback = flickText(flick);
    hideAim();
    render();
    await board.ready();
    if (stopped) return;
    const v = throwVelocity(RELEASE, at, flick, Math.random, board.aim);
    const report = await board.throwDart(RELEASE, v, me);
    if (stopped) return;
    if (!report) {
      throwing = false;
      return render();
    }
    if (isHost) throwing = false;
    act('throw', report); // Gast: throwing bleibt bis zur Antwort des Hosts (der Pfeil bleibt so lange sichtbar stecken)
  }

  function hideAim() {
    board.setAim(null);
    if (aimShown) send({ t: 'aim', a: null });
    aimShown = false;
  }

  function onMove(e) {
    if (charging) {
      if (!(e.buttons & 1)) return cancel(); // Taste außerhalb des Fensters losgelassen
      sample(e);
      const f = readFlick(charging.samples);
      panel.setTempo(f ? Math.max(f.ratio, 0) : 0);
      return;
    }
    if (!canThrow()) {
      canvas.style.cursor = '';
      return;
    }
    const spot = board.pickBoard(room.rayFrom(e));
    aim = spot && Math.hypot(...spot) < 0.5 ? spot : null;
    canvas.style.cursor = aim ? 'none' : '';
  }

  function sample(e) {
    const t = performance.now();
    charging.samples.push({ t, x: e.clientX, y: e.clientY });
    while (charging.samples.length > 2 && t - charging.samples[1].t > SAMPLE_MS) charging.samples.shift();
  }

  function onDown(e) {
    if (e.button !== 0 || e.target !== canvas || !canThrow() || !aim) return;
    const [tx, ty] = tremor(clock, me);
    charging = { aim: [aim[0] + tx, aim[1] + ty], samples: [] };
    sample(e);
    board.setAim(charging.aim, me);
    canvas.setPointerCapture(e.pointerId); // Schnippen geht weiter, auch wenn die Maus über das Seitenfeld rutscht
  }

  function onUp(e) {
    if (e.button !== 0 || !charging) return;
    sample(e);
    const flick = readFlick(charging.samples);
    const at = charging.aim;
    charging = null;
    if (!canThrow()) return render();
    if (!validFlick(flick)) {
      feedback = 'Kein Wurf – beim Loslassen die Maus zügig nach oben schnippen';
      return render();
    }
    doThrow(at, flick);
  }

  function cancel() {
    charging = null;
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape' && charging) return cancel();
    if (e.code !== 'Space' || e.repeat || !state || e.target.closest?.('input, textarea, select')) return;
    const a = actionsNow();
    if (a?.pull) {
      e.preventDefault();
      act('pull');
    }
  }

  const noSelect = (e) => e.button === 0 && e.preventDefault(); // Schnippen markiert sonst Text im Seitenfeld
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('mousedown', noSelect);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  let shownStatus = '';
  const stopFrames = room.onFrame((dt) => {
    clock += dt;
    board.update(dt);
    if (!state) return;
    // eigener Zielpunkt zittert mit der Hand; der andere sieht ihn mit
    if (canThrow() && aim && !charging) {
      const [tx, ty] = tremor(clock, me);
      const at = [aim[0] + tx, aim[1] + ty];
      board.setAim(at, me);
      const now = performance.now();
      if (now - lastAimSend > AIM_SEND_MS) {
        lastAimSend = now;
        aimShown = true;
        send({ t: 'aim', a: at.map((x) => Math.round(x * 10000) / 10000) });
      }
    } else if (aimShown && !charging) hideAim();
    const text = statusText();
    if (text !== shownStatus) {
      shownStatus = text;
      render(); // z. B. Pfeil steckt, Computer ist fertig
    }
  });

  if (isHost) commit(resume ?? newGame({ free, starter: Math.random() < 0.5 ? 0 : 1 })); // wer das erste Leg beginnt, entscheidet der Zufall
  board.ready(); // Physik schon laden

  return {
    handle,
    refresh: () => render(),
    stop() {
      stopped = true;
      clearTimeout(timer);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('mousedown', noSelect);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      cheat.remove();
      stopFrames();
      board.reset();
    },
  };
}
