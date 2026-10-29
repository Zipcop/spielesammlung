// Bowling-Partie: verbindet Spielstand (rules.js), Bowlingcenter mit Physik (lane.js), Seitenfeld (panel.js),
// Computer (ai.js) und Netz. Spieler 0 = Host, 1 = Gast bzw. Computer. Der Host hält den Stand, der Gast schickt Wünsche
// (throw, accuse, again), der Host prüft sie und antwortet mit { t: 'state' }. Wer wirft, rechnet die Physik selbst,
// streamt Kugel und Pins ({ t: 'bowl' }) und meldet das Ergebnis; die Kugel in der Hand sieht der andere live ('baim').
// Bedienung: ←/→ (Shift = 5 Bretter) oder Klick auf den Anlauf = Standpunkt; Maus auf der Bahn = Richtung (Linie bis
// zu den Pfeilen). Linke Maustaste halten, Maus nach unten ziehen = ausholen (je weiter, desto schneller, ganz unten
// rutscht man über die Linie = Foul), dann wieder nach oben schieben = Wurf; dabei schräg nach links/rechts = Drall.
// Kamera: hinter dem Werfer, folgt der Kugel bis zu den Pins (room.focus), danach zurück an den Anlauf.
// free = „Ohne Hilfen“: Die Anlage zählt nicht, der Foul-Melder ist aus – jeder trägt selbst ein (rules.js). Allein
// schummelt der Computer ab und zu (übertritt oder schreibt mehr Pins) und prüft jeden Frame des Menschen einmal.
import { newGame, throwBall, accuse, waive, again, score, forGuest, framesOf, marks, position, totalOf, FRAMES, BOARD } from './rules.js';
import { plan, LEVELS } from './ai.js';
import { speedOf, FOUL_TEMPO, RELEASE_Z } from './physics.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const LEVEL_KEY = 'spielesammlung-bowling-stufe';
const THINK_MS = 900;
const ACCUSE_MS = 900;
const SWING_PX = 260; // Maus so weit nach unten = volles Tempo
const DEAD_PX = 6;
const TURN_PX = 12; // so weit wieder nach oben = Vorschwung beginnt
const HOOK_SLOPE = 0.6; // seitlich ÷ vorwärts beim Vorschwung: so schräg = voller Drall
const FORWARD_MIN = 0.35; // Maustaste früher losgelassen = kein Wurf (abgebrochen)
const MAX_ANGLE = 0.07; // höchstens ≈ 4° schräg
const STAND_MAX = 0.45;
const REST = -0.9; // Arm-Winkel beim Zielen (Kugel vor dem Körper), wie lane.js
const BACK = 1.7; // Arm-Winkel ganz ausgeholt
const HAND_BACK = 1.0; // Schulter vor dem letzten Schritt so weit hinter dem Abwurfpunkt
const DROP_S = 0.14; // nach dem Loslassen schwingt der Arm noch zu Ende, dann rollt die Kugel
const AIM_SEND_MS = 66;
const SIDE = 0.3; // Blickziel etwas rechts der Kugel – Bahn links neben dem Seitenfeld (wie room.js bowl0/bowl1)
const VIEW_Y = 0.3; // Höhe des Blickziels (wie room.js bowl0/bowl1)
const DECK_VIEW = -18.5; // Blick auf die Pins (Physik-z)

function loadLevel() {
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    const n = Number(raw);
    return raw !== null && Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1;
  } catch {
    return 1;
  }
}

export function startBowling({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null; // Host: voller Stand · Gast: seine Sicht (forGuest)
  let waiting = false;
  let asked = null;
  let timer = null;
  let hint = '';
  let stopped = false;
  let cheered = false;
  let stand = 0.2; // eigener Standpunkt (x des Abwurfs)
  let aim = 0; // eigene Richtung
  let swing = null; // { x0, y0, pull, low: {x, y}, forward, progress, hook }
  let drop = null; // { t, th, pz, launch, foul } – Arm schwingt nach dem Loslassen zu Ende
  let rolling = false; // eigener Wurf läuft
  let pending = null; // ohne Hilfen: Wurf vorbei, Eintrag steht aus – { report }
  let otherHand = null; // Kugel des anderen (Computer oder Mitspieler) in der Hand
  let cpuSwing = null; // Computer: { t, plan, cheat }
  let cpuCheat = null; // Computer schummelt in diesem Frame: 'over' | 'count' | null
  let lastAimSend = 0;
  let statusShown = '';
  let flashedSeq = null;
  let holdSeq = null; // Kugel ist gerade durch – Blick bleibt auf den Pins, bis der neue Stand da ist
  const judged = new WeakSet();

  const who = (p) => (p === me ? 'Du' : solo ? 'Der Computer' : names.other());
  const nameOf = (p) => (p === me ? `Du (${names.me()})` : solo ? `Computer (${LEVELS[lvl].name})` : names.other());

  const panel = createPanel($('bowl-panel'), {
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
    onClaim: (claim) => {
      if (!pending) return;
      const { report } = pending;
      pending = null;
      act('throw', { report, claim });
    },
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && !state?.result ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Bowling"] .dock [data-hint]') });

  function apply(type, p, arg) {
    if (type === 'throw') return throwBall(state, p, arg?.report, arg?.claim);
    if (type === 'accuse') return accuse(state, p);
    if (type === 'again') return again(state, p);
    return null;
  }

  function setState(next) {
    if (next.events?.[0]?.type === 'start' && next.seq === 0) {
      cheered = false;
      cpuCheat = null;
    }
    // Neuer Stand (z. B. „Geschummelt!“ mitten im Ausholen): angefangener Wurf und offener Eintrag gelten nicht mehr
    if (state && next.seq !== state.seq && (cpuSwing || swing || drop || pending)) {
      cpuSwing = swing = drop = pending = otherHand = null;
      board.setHand(null);
      panel.setSwing(null, null);
    }
    state = next;
    hint = '';
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
      else if (type === 'again') say(blockedText());
      else rejected(type);
    } else {
      waiting = true;
      asked = type;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (stopped) return;
    if (msg.t === 'bowl') return board.applyRemote(msg);
    if (msg.t === 'baim') {
      const ok = ['x', 'a', 'th', 'pz'].every((k) => Number.isFinite(msg[k]));
      if (state && state.turn !== me && ok) {
        otherHand = { player: other, x: clamp(msg.x, -STAND_MAX, STAND_MAX), angle: clamp(msg.a, -MAX_ANGLE, MAX_ANGLE), th: clamp(msg.th, REST, BACK), pz: clamp(msg.pz, RELEASE_Z, RELEASE_Z + HAND_BACK) };
        board.setHand(otherHand);
      }
      return;
    }
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'again' && state.result) hint = blockedText();
      if (same && asked === 'throw') return rejected('throw');
      return render();
    }
    if (isHost && state && !solo) {
      const next = apply(msg.t, other, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // Wurf abgelehnt (Stand unverändert): Pins wieder so hinstellen, wie der Stand sie hat, Blick zurück zum Anlauf
  function rejected(type) {
    if (type === 'throw') {
      board.resync();
      holdSeq = null;
    }
    render();
  }

  const blockedText = () => (solo ? 'Der Computer prüft noch deinen letzten Frame …' : `${names.other()} darf noch „Geschummelt!“ rufen – oder startet die Revanche.`);
  const clamp = (v, a, b) => Math.max(a, Math.min(v, b));

  function say(text) {
    hint = text;
    render();
  }

  // --- Computer (nur allein) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !solo || !state) return;
    const s = state;
    // Ohne Hilfen: jeden Frame des Menschen einmal prüfen, bevor der Computer selbst wirft
    if (s.free && s.cheat?.player === me && (s.turn === other || s.result) && !judged.has(s.cheat)) {
      judged.add(s.cheat);
      if (cpuAccuses(!s.cheat.legal)) return later(ACCUSE_MS, () => commit(accuse(state, other) ?? state));
      if (s.result) return later(ACCUSE_MS, () => commit(waive(state, other) ?? state));
    }
    if (s.result || s.turn !== other) return;
    later(THINK_MS, cpuThrow);
  }

  // Erst wenn alles ruht (Pinsetter fertig), kurz überlegen, dann handeln (ändert sich vorher der Stand, entfällt es)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy() || rolling || cpuSwing) timer = setTimeout(tick, 60);
      else {
        timer = setTimeout(() => {
          if (stopped || state !== at) return;
          if (board.busy() || rolling || cpuSwing) return tick(); // inzwischen läuft doch etwas – nochmal warten
          fn();
        }, ms);
      }
    };
    tick();
  }

  function cpuThrow() {
    if (cpuSwing || rolling || state.result || state.turn !== other) return;
    const at = position(state.rolls[other]);
    if (at.ball === 0) cpuCheat = state.free && cpuCheats() ? (Math.random() < 0.5 ? 'over' : 'count') : null;
    const p = plan(state.pins, lvl);
    if (cpuCheat === 'over' && at.ball === 0) p.tempo = Math.max(p.tempo, FOUL_TEMPO + 0.03); // mit Schwung übertreten
    cpuSwing = { t: 0, plan: p, at: state };
  }

  // Computer schwingt sichtbar: zielen (1 s), ausholen (0,6 s), vorschwingen (0,3 s) – dann rollt die Kugel
  function stepCpu(dt) {
    const c = cpuSwing;
    c.t += dt;
    const { plan: p } = c;
    const thMax = REST + (BACK - REST) * p.tempo;
    let th = REST;
    let pz = RELEASE_Z + HAND_BACK;
    if (c.t > 1) th = REST + (thMax - REST) * Math.min((c.t - 1) / 0.6, 1);
    if (c.t > 1.6) {
      const f = Math.min((c.t - 1.6) / 0.3, 1);
      th = thMax * (1 - f);
      pz = RELEASE_Z + HAND_BACK * (1 - f);
    }
    otherHand = { player: other, x: p.x, angle: p.angle, th, pz };
    board.setHand(otherHand);
    if (c.t < 1.9) return;
    cpuSwing = null;
    otherHand = null;
    if (state !== c.at || state.turn !== other || state.result) return board.setHand(null); // Stand hat sich geändert
    launch(p.x, p.angle, p.tempo, p.hook, other);
  }

  // --- Wurf (eigener oder des Computers) ---
  async function launch(x, angle, tempo, hook, player) {
    const at = state;
    rolling = true;
    board.setHand(null);
    panel.setSwing(null, null);
    render();
    const foul = tempo >= FOUL_TEMPO;
    const out = await board.throwBall({ x, angle, speed: speedOf(tempo), hook });
    rolling = false;
    if (stopped || !out) return;
    // Während des Rollens kam ein neuer Stand (z. B. erwischt: Frame vorbei) – der Wurf zählt nicht, der Pinsetter räumt
    if (state !== at) {
      holdSeq = null;
      return render();
    }
    const report = { pins: out.pins, foul, gutter: out.gutter };
    if (player === me) {
      if (state.free) {
        pending = { report };
        return render();
      }
      return act('throw', { report });
    }
    // Computer: ohne Hilfen trägt er selbst ein – meistens ehrlich
    const left = position(state.rolls[other]).left;
    const down = state.pins.filter((p, n) => p && !out.pins[n]).length;
    const honest = foul ? 'F' : Math.min(out.gutter ? 0 : down, left);
    let claim = honest;
    if (cpuCheat === 'over' && foul) claim = Math.min(down, left);
    else if (cpuCheat === 'count' && honest !== 'F' && honest < left) claim = Math.min(left, honest + 1 + (Math.random() < 0.4 ? 1 : 0));
    commit(throwBall(state, other, report, state.free ? claim : undefined) ?? state);
  }

  // --- Anzeige ---
  function rows() {
    return [0, 1].map((p) => {
      const frames = framesOf(state.rolls[p]);
      const at = position(state.rolls[p]);
      return {
        name: nameOf(p),
        frames: frames.map((fr, f) => (f < FRAMES - 1 && fr.rolls[0].n === 10 ? ['', 'X'] : marks(fr, f))), // Strike im rechten Kästchen wie auf echten Zetteln
        totals: frames.map((fr) => fr.total),
        total: totalOf(state, p),
        wins: score(state)[p],
        turn: !state.result && state.turn === p,
        current: !state.result && state.turn === p && !at.done ? at.frame : null,
      };
    });
  }

  function render() {
    if (!waiting && !rolling) board.sync(state);
    if (!state) return;
    const s = state;
    const list = rows();
    board.setScore({ title: s.result ? 'Partie vorbei' : `Frame ${Math.min(position(s.rolls[s.turn]).frame + 1, FRAMES)}`, rows: list.map((r) => ({ ...r, name: r.name.replace(/^Du \((.*)\)$/, '$1') })) });
    const first = flashedSeq === null; // erstes Bild (auch beim Fortsetzen): alte Meldungen nicht nochmal zeigen
    if (s.seq !== flashedSeq && !first) {
      flashedSeq = s.seq;
      const e = s.events?.[0];
      if (e?.type === 'throw') {
        const text = e.f ? 'FOUL' : e.mark === 'X' ? 'STRIKE!' : e.mark === '/' ? 'SPARE!' : e.gutter && !e.n ? 'RINNE' : null;
        if (text && !s.result) board.flash(text);
      } else if (e?.type === 'caught') board.flash('ERWISCHT!');
    }
    const won = s.result?.winner === me;
    if (won && !cheered) board.celebrate();
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: !!s.free && !!s.cheat && s.cheat.player !== me && !waiting });
    const verdict = s.events?.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (first) flashedSeq = s.seq;
    if (verdict && !first) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict), verdict.type === 'caught');
    panel.render({
      round: `Partie ${s.round ?? 1}`,
      players: list,
      status: statusText(),
      last: lastText(),
      hint,
      level: lvl,
      claim: pending ? { left: position(s.rolls[me]).left } : null,
      end: s.result ? endInfo() : null,
      free: !!s.free,
    });
    if (myTurn()) showHand();
    else if (!otherHand && !cpuSwing) board.setHand(null);
    if (!swing && !drop) panel.setSwing(null, null);
    statusShown = statusText();
  }

  const myTurn = () => !!state && !state.result && state.turn === me && !waiting && !rolling && !pending && !drop && !board.busy();

  function statusText() {
    const s = state;
    if (s.result) return 'Partie vorbei';
    if (waiting) return 'Wird gesendet …';
    if (pending) return 'Pins zählen und selbst eintragen';
    if (rolling || board.rolling()) return 'Die Kugel rollt …';
    if (board.busy()) return 'Der Pinsetter räumt …';
    const at = position(s.rolls[s.turn]);
    const where = `Frame ${at.frame + 1}, ${at.ball + 1}. Wurf`;
    if (s.turn !== me) return `${who(s.turn)} ist dran (${where}) …`;
    return `Du bist dran – ${where}`;
  }

  function lastText() {
    const l = state.last;
    if (!l) return `${who(state.starter)} ${state.starter === me ? 'fängst' : 'fängt'} an.`;
    const w = who(l.player);
    if (l.f) return `${w}: Foul – über die Linie, der Wurf zählt 0.`;
    if (l.mark === 'X') return `${w}: Strike!`;
    if (l.mark === '/') return `${w}: Spare!`;
    if (l.gutter && !l.n) return `${w}: Rinne – 0 Pins.`;
    return `${w}: ${l.n} ${l.n === 1 ? 'Pin' : 'Pins'}.`;
  }

  // e = { caught, player (Schummler bzw. Rufer beim Fehlalarm), by, why, frame }
  function verdictText(e) {
    if (e.caught) {
      const lead = e.player === me && solo ? 'Der Computer ruft „Geschummelt!“ – ' : '';
      return `${lead}Erwischt! ${e.player === me ? 'Du hast' : `${who(e.player)} hat`} geschummelt: ${e.why}. Frame ${e.frame + 1} zählt 0.`;
    }
    if (e.player === me) return `Fehlalarm! Der Frame war in Ordnung – du bekommst 10 Minuspunkte.`;
    return solo ? 'Der Computer ruft „Geschummelt!“ – Fehlalarm, dein Frame war in Ordnung. Er bekommt 10 Minuspunkte.'
      : `Fehlalarm! ${who(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und bekommt 10 Minuspunkte.`;
  }

  function endInfo() {
    const { winner } = state.result;
    const [a, b] = [totalOf(state, me), totalOf(state, other)];
    const title = winner === null ? 'Unentschieden' : winner === me ? 'Gewonnen!' : `${who(winner)} gewinnt`;
    return { title, text: `${a} : ${b} Punkte` };
  }

  // --- Kugel in der Hand ---
  function showHand(th = REST, pz = RELEASE_Z + HAND_BACK) {
    board.setHand({ player: me, x: stand, angle: aim, th, pz });
    const now = performance.now();
    if (now - lastAimSend > AIM_SEND_MS) {
      lastAimSend = now;
      send({ t: 'baim', x: Math.round(stand * 1e4) / 1e4, a: Math.round(aim * 1e5) / 1e5, th: Math.round(th * 1e3) / 1e3, pz: Math.round(pz * 1e3) / 1e3 });
    }
  }

  // Ausholen und Vorschwingen: Arm-Winkel und Schulter aus dem Mausweg
  function swingPose() {
    const thMax = REST + (BACK - REST) * swing.pull;
    if (!swing.forward) return [thMax, RELEASE_Z + HAND_BACK];
    const f = Math.min(swing.progress, 1);
    return [thMax * (1 - f), RELEASE_Z + HAND_BACK * (1 - f)];
  }

  function release() {
    const tempo = swing.pull;
    const hook = swing.hook;
    const [th, pz] = swingPose();
    swing = null;
    drop = { t: 0, th, pz, launch: [stand, aim, tempo, hook] };
  }

  function stepDrop(dt) {
    drop.t += dt;
    const f = Math.min(drop.t / DROP_S, 1);
    showHand(drop.th * (1 - f), drop.pz + (RELEASE_Z - drop.pz) * f);
    if (f < 1) return;
    const [x, a, tempo, hook] = drop.launch;
    drop = null;
    lastAimSend = 0;
    launch(x, a, tempo, hook, me);
  }

  // --- Eingaben ---
  function onMove(e) {
    if (!myTurn()) return;
    if (swing) {
      if (!(e.buttons & 1)) return cancel();
      const dy = e.clientY - swing.y0;
      if (!swing.forward) {
        if (dy > swing.low.y - swing.y0) swing.low = { x: e.clientX, y: e.clientY };
        swing.pull = clamp((swing.low.y - swing.y0 - DEAD_PX) / SWING_PX, 0, 1);
        if (swing.low.y - e.clientY > TURN_PX && swing.pull > 0.02) swing.forward = true;
      }
      if (swing.forward) {
        const back = Math.max(swing.low.y - swing.y0, 1);
        const up = swing.low.y - e.clientY;
        swing.progress = up / back;
        swing.hook = clamp(-(e.clientX - swing.low.x) / Math.max(up, 30) / HOOK_SLOPE, -1, 1);
      }
      panel.setSwing(swing.pull, swing.forward ? swing.hook : 0);
      const [th, pz] = swingPose();
      showHand(th, pz);
      if (swing.forward && swing.progress >= 1) release();
      return;
    }
    const spot = board.pickFloor(room.rayFrom(e));
    if (!spot) return;
    if (spot[1] > 0.05) {
      canvas.style.cursor = 'ew-resize'; // Anlauf: Klick = hier hinstellen
      return;
    }
    canvas.style.cursor = 'crosshair';
    aim = clamp(Math.atan2(spot[0] - stand, RELEASE_Z - spot[1]), -MAX_ANGLE, MAX_ANGLE);
    showHand();
  }

  function onDown(e) {
    if (e.button !== 0 || !myTurn() || e.target !== canvas) return;
    const spot = board.pickFloor(room.rayFrom(e));
    if (spot && spot[1] > 0.05) {
      stand = clamp(spot[0], -STAND_MAX, STAND_MAX);
      showHand();
      return;
    }
    swing = { x0: e.clientX, y0: e.clientY, pull: 0, low: { x: e.clientX, y: e.clientY }, forward: false, progress: 0, hook: 0 };
    canvas.setPointerCapture(e.pointerId);
    panel.setSwing(0, 0);
  }

  function onUp(e) {
    if (e.button !== 0 || !swing) return;
    if (swing.forward && swing.progress >= FORWARD_MIN && myTurn()) return release();
    cancel();
  }

  function cancel() {
    swing = null;
    lastAimSend = 0;
    panel.setSwing(null, null);
    if (myTurn()) showHand();
  }

  function onKey(e) {
    if (e.key === 'Escape' && swing) return cancel();
    if (!myTurn() || swing || !['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a' ? -1 : 1;
    stand = clamp(stand + dir * BOARD * (e.shiftKey ? 5 : 1), -STAND_MAX, STAND_MAX);
    showHand();
  }

  const noSelect = (e) => e.button === 0 && e.preventDefault(); // Ziehen markiert sonst Text im Seitenfeld

  // Kamera: folgt der rollenden Kugel, zeigt dann die Pins, sonst den Werfer am Anlauf
  function focusPoint() {
    if (board.rolling()) {
      const b = board.ballWorld();
      const deck = board.toWorld([0, DECK_VIEW]).z;
      return b.set(b.x + SIDE, VIEW_Y, Math.max(b.z, deck));
    }
    if (board.busy() || pending || waiting || (state && holdSeq === state.seq)) {
      return board.toWorld([0, DECK_VIEW], VIEW_Y).setX(board.toWorld([SIDE, 0]).x);
    }
    const x = state?.turn === me || !otherHand ? stand : otherHand.x;
    return board.toWorld([x + SIDE, RELEASE_Z], VIEW_Y);
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('mousedown', noSelect);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => {
    board.update(dt);
    if (drop) stepDrop(dt);
    if (cpuSwing) stepCpu(dt);
    if (board.rolling()) holdSeq = state?.seq ?? null;
    room.focus(focusPoint());
    if (state && statusShown !== statusText()) render(); // z. B. Pinsetter fertig
  });

  if (isHost) commit(resume ?? newGame({ starter: 0, free }));

  return {
    handle,
    refresh: render,
    view: () => state,
    stop() {
      stopped = true;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('mousedown', noSelect);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}

