// Air-Hockey-Partie in Echtzeit: verbindet Spielstand (rules.js), Schiedsrichter + Physik (referee.js, physics.js), Tisch
// (table.js), Seitenfeld (panel.js), Computer (ai.js) und Netz. Spieler 0 = Host (Tor auf +z, rot), 1 = Gast bzw. Computer (blau).
// Netz: Der Host rechnet die Physik verbindlich (240 Schritte/s). Der Gast schickt 60-mal pro Sekunde seine Schlägerlage
// ({ t: 'ahm', x, z, c, top } – c = seine Uhrzeit), der Host streamt 60-mal pro Sekunde Puck und Schläger
// ({ t: 'ah', p, c, h, s, … } – c/h: welche Gast-Lage er zuletzt hatte und seit wie vielen ms). Der Gast sieht seinen Schläger sofort
// und sagt den Puck mit eigener Physik voraus: Jede Lage vom Host rechnet er um die Umlaufzeit nach vorn – mit seinen eigenen
// Schlägerlagen aus dieser Zeit, genau so, wie der Host sie bekommen wird. Sprünge werden weich ausgeglichen.
// Spielstand (Tore, Verstöße) wie überall: Host hält ihn, schickt { t: 'state' }; Gast-Wünsche: 'accuse', 'again'.
// free = „Ohne Hilfen“: Schläger reicht über die Mittellinie, rechte Maustaste hält den Puck fest (Topping), 7 Sekunden ohne Pfiff –
// der andere kann „Geschummelt!“ (oder G) drücken. Allein schummelt der Computer ab und zu und prüft den Menschen (schummeln.js).
import { newGame, accuse, again, againWait, clampMallet, halfOf, recentFoul, TABLE, WHY, SEVEN_S, ACCUSE_S, ALARMS_PER_POINT, REACH, RM } from './rules.js';
import { createReferee } from './referee.js';
import { STEP, MAX_MALLET } from './physics.js';
import { createBrain, LEVELS } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { playHit } from '../sound.js';

const $ = (id) => document.getElementById(id);
const { L, W } = TABLE;
const SEND_S = 1 / 60; // so oft gehen Lagen über das Netz (beide Richtungen)
const HISTORY_MS = 600; // Gast: so weit reichen die eigenen Schlägerlagen zurück
const MAX_AHEAD = 72; // Gast: höchstens so viele Schritte vorausrechnen (300 ms Umlaufzeit)
const SNAP = 0.6; // m – größere Abweichung der Vorhersage: springen statt gleiten
const SMOOTH = 12; // je Sekunde – so schnell gleicht der Gast kleine Abweichungen aus (große schneller, je 10 cm einmal mehr)
const GUESS = 0.12; // m – so weit schreibt der Gast den Schläger des Hosts höchstens in die Zukunft fort
const LOG = 3;
const LEVEL_KEY = 'spielesammlung-airhockey-stufe';
const ACCUSE_GAP_MS = 1500; // nach einer Anklage so lange kein neuer Ruf
const SOUND = { mallet: 'puck', rail: 'rail', goal: 'slot' };
const HOME = (p) => [0, (p === 0 ? 1 : -1) * (L / 2 - 0.2)];
const round = (v) => Math.round(v * 10000) / 10000;

function loadLevel() {
  try {
    const raw = localStorage.getItem(LEVEL_KEY);
    const n = Number(raw);
    return raw !== null && Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1;
  } catch {
    return 1;
  }
}

export function startAirhockey({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = 1 - me;
  let lvl = loadLevel();
  let state = null;
  let physics = null; // Host: verbindliche Welt · Gast: Vorhersage
  let referee = null;
  let brain = null;
  let acc = 0;
  let sendAcc = 0;
  let mouse = null; // Ziel des eigenen Schlägers (Tisch-Koordinaten, ungeklemmt)
  let top = false; // rechte Maustaste gedrückt (Topping, nur ohne Hilfen)
  let stopped = false;
  let cheered = false;
  let log = [];
  let statusShown = '';
  let lastAccuse = 0;
  let changedAt = 0; // wann sich der Stand zuletzt geändert hat (für „Tor!“ im Status)
  let timer = null;
  let frozen = false; // Verbindung unterbrochen: alles steht (pause)
  // Host: letzte Lage des Gasts
  const remote = { target: HOME(1), top: false, c: null, at: 0 };
  const streamSounds = [];
  // Gast: Vorhersage
  const history = []; // [Zeit ms, x, z] je Physikschritt
  let simTime = 0;
  let offset = [0, 0]; // sichtbare Abweichung des Pucks, die weich verschwindet
  let snap = null; // letzte Lage vom Host
  let rival = null; // Gast: Schläger des Hosts { x, z, vx, vz, at } – wird in die Zukunft fortgeschrieben
  let lastSound = 0;
  const halfSince = { half: null, at: 0 }; // Gast: seit wann der Puck in einer Hälfte liegt (nur für die Anzeige)
  // Computer (allein, ohne Hilfen)
  let reachUntil = 0; // bis dahin darf er über die Mittellinie (schummelt)
  let chance = false; // gerade schon über das Schummeln entschieden (Puck nah an der Linie)
  const judged = new Set(); // schon geprüfte Verstöße/Tore des Menschen

  const who = (p) => (p === me ? 'Du' : solo ? 'Computer' : names.other());
  const whom = (p) => (p === me ? 'dich' : solo ? 'den Computer' : names.other());

  const panel = createPanel($('ah-panel'), {
    solo,
    onLevel: (n) => {
      lvl = n;
      brain?.setLevel(n);
      try {
        localStorage.setItem(LEVEL_KEY, String(n));
      } catch {
        // ohne Speicher gilt die Stufe eben nur bis zum Neuladen
      }
      render();
    },
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && state?.winner === null ? ask('Partie beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => tryAccuse(), hint: document.querySelector('[data-game="Air-Hockey"] .dock [data-hint]') });

  // --- Spielstand ---
  function setState(next) {
    const fresh = !state || next.seq !== state.seq || next.round !== state.round;
    if (next.round !== state?.round) {
      log = [];
      cheered = false;
    }
    state = next;
    if (fresh) {
      changedAt = performance.now();
      const line = describe(next);
      if (line) log = [line, ...log].slice(0, LOG);
    }
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    if (solo) judge();
  }

  function apply(type, p) {
    const clock = referee?.clock() ?? state.clock;
    if (type === 'accuse') return accuse(state, p, clock);
    if (type === 'again') return again(state, p, clock);
    return null;
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type) {
    if (!state) return;
    if (isHost) {
      const next = apply(type, me);
      if (next) commit(next);
      else render();
    } else send({ t: type });
  }

  function tryAccuse() {
    if (!state?.free || performance.now() - lastAccuse < ACCUSE_GAP_MS) return;
    lastAccuse = performance.now();
    act('accuse');
  }

  function handle(msg) {
    if (stopped) return;
    if (msg.t === 'ah') return isHost ? undefined : onSnapshot(msg);
    if (msg.t === 'ahm') {
      if (!isHost || !Number.isFinite(msg.x) || !Number.isFinite(msg.z)) return;
      remote.target = [msg.x, msg.z];
      remote.top = msg.top === true;
      if (Number.isFinite(msg.c)) [remote.c, remote.at] = [msg.c, performance.now()];
      return;
    }
    if (!isHost && msg.t === 'state') {
      setState(msg.state);
      return render();
    }
    if (isHost && state && !solo && (msg.t === 'accuse' || msg.t === 'again')) {
      const next = apply(msg.t, 1);
      if (next) commit(next);
      else send({ t: 'state', state }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Host: Physik verbindlich ---
  function hostStep() {
    const targets = [];
    const speeds = [MAX_MALLET, MAX_MALLET];
    const tops = [false, false];
    targets[me] = mouse ?? HOME(me);
    tops[me] = top;
    if (solo) {
      const now = referee.clock();
      const plan = brain.think({ puck: physics.puck(), mallet: physics.mallet(other) }, STEP, { reach: state.free && now < reachUntil });
      targets[other] = plan.target;
      speeds[other] = plan.speed;
      if (state.free) maybeCheat(now);
    } else {
      targets[other] = remote.target;
      speeds[other] = MAX_MALLET; // dieselbe Grenze wie für den eigenen Schläger
      tops[other] = remote.top;
    }
    const out = referee.tick(state, { targets, speeds, top: tops });
    for (const [kind, strength, by] of out.sounds) {
      playHit(SOUND[kind], strength);
      if (!solo) streamSounds.push([kind, Math.round(strength * 100) / 100, by]);
    }
    if (out.changed) commit(out.state);
    else state = out.state; // z. B. Verstoß bleibt frisch, solange er andauert
  }

  // Computer schummelt (ohne Hilfen): liegt der Puck langsam knapp hinter der Mittellinie beim Menschen, entscheidet er einmal,
  // ob er über die Linie langt
  function maybeCheat(now) {
    const p = physics.puck();
    const near = halfOf(p.z) === me && Math.abs(p.z) < REACH - RM && Math.hypot(p.vx, p.vz) < 1.5;
    if (near && !chance) {
      chance = true;
      if (cpuCheats()) reachUntil = now + 1.5;
    } else if (!near) chance = false;
  }

  // Computer prüft den Menschen (allein, ohne Hilfen): jeden neuen Verstoß einmal (erwischt jedes zweite Mal) und jedes Tor
  // des Menschen (ohne Verstoß ruft er selten trotzdem – Fehlalarm)
  function judge() {
    const s = state;
    if (!s.free) return;
    const key = `${s.round}-${s.seq}`;
    if (judged.has(key)) return;
    judged.add(key);
    // im selben Schritt können Verstoß und Tor zusammen kommen – der Verstoß wird dann geprüft, ein Fehlalarm nicht gewürfelt
    const foul = s.events.some((e) => e.type === 'foul' && e.by === me);
    const scored = s.events.some((e) => e.type === 'goal' && e.by === me);
    const call = foul ? cpuAccuses(true) : scored && !recentFoul(s, me) ? cpuAccuses(false) : false;
    if (!call) return;
    clearTimeout(timer);
    const round = s.round;
    timer = setTimeout(() => {
      if (stopped || !state || state.round !== round) return; // inzwischen Revanche: die Anklage gilt nicht mehr
      const next = accuse(state, other, referee.clock());
      if (next) commit(next);
    }, 500 + Math.random() * 900);
  }

  function hostFrame(dt) {
    acc = Math.min(acc + dt, 0.1);
    while (acc >= STEP && !stopped) {
      acc -= STEP;
      hostStep();
    }
    const p = physics.puck();
    board.show([p.x, p.z], [0, 1].map((i) => [physics.mallet(i).x, physics.mallet(i).z]));
    if (solo) return;
    sendAcc += dt;
    if (sendAcc < SEND_S) return;
    sendAcc %= SEND_S;
    const m = [0, 1].map((i) => physics.mallet(i));
    const c = remote.c;
    send({
      t: 'ah',
      p: [p.x, p.z, p.vx, p.vz, m[0].x, m[0].z, m[1].x, m[1].z, m[0].vx, m[0].vz, m[1].vx, m[1].vz].map(round),
      c, // letzte Gast-Lage, mit der gerechnet wurde …
      h: c === null ? 0 : Math.round(performance.now() - remote.at), // … und wie lange schon
      held: physics.held(),
      g: physics.parked() || referee.paused(),
      s: streamSounds.splice(0),
    });
  }

  // --- Gast: Vorhersage ---
  function guestFrame(dt) {
    const now = performance.now();
    acc = Math.min(acc + dt, 0.1);
    while (acc >= STEP) {
      acc -= STEP;
      simTime = now - acc * 1000;
      guestStep();
    }
    const fast = SMOOTH * (1 + Math.hypot(...offset) / 0.1);
    offset = offset.map((v) => v * Math.exp(-dt * fast));
    const p = physics.puck();
    board.show([p.x + offset[0], p.z + offset[1]], [0, 1].map((i) => [physics.mallet(i).x, physics.mallet(i).z]));
    sendAcc += dt;
    if (sendAcc < SEND_S) return;
    sendAcc %= SEND_S;
    const m = physics.mallet(me);
    send({ t: 'ahm', x: round(m.x), z: round(m.z), c: Math.round(simTime * 10) / 10, top });
  }

  function guestStep() {
    const free = !!state?.free;
    physics.setTarget(me, clampMallet(me, mouse ?? HOME(me), free), MAX_MALLET);
    if (rival) physics.setTarget(other, guess(simTime - rival.at + rival.ahead), MAX_MALLET * 1.5);
    const out = physics.step();
    for (const [kind, strength, by] of out.sounds) {
      if (kind !== 'mallet' || by !== me || simTime - lastSound < 60) continue;
      lastSound = simTime; // eigenen Schlag sofort hören – alles andere kommt mit den Lagen vom Host
      playHit('puck', strength);
    }
    const m = physics.mallet(me);
    history.push([simTime, m.x, m.z]);
    while (history.length && history[0][0] < simTime - HISTORY_MS) history.shift();
  }

  // Schläger des Hosts ms Millisekunden nach seiner letzten Lage (gerade fortgeschrieben, höchstens GUESS weit)
  function guess(ms) {
    const t = ms / 1000;
    const k = Math.min(1, GUESS / (Math.hypot(rival.vx, rival.vz) * t || 1));
    return clampMallet(other, [rival.x + rival.vx * t * k, rival.z + rival.vz * t * k], !!state?.free);
  }

  // Eigene Schlägerlage zur Zeit t (ms) aus der Liste
  function mineAt(t) {
    let best = history[history.length - 1];
    for (const h of history) {
      if (h[0] >= t) {
        best = h;
        break;
      }
    }
    return best ? [best[1], best[2]] : HOME(me);
  }

  function onSnapshot(msg) {
    if (!physics || !Array.isArray(msg.p) || msg.p.length !== 12 || !msg.p.every(Number.isFinite)) return;
    snap = msg;
    for (const [kind, strength, by] of Array.isArray(msg.s) ? msg.s : []) {
      if (SOUND[kind] && !(kind === 'mallet' && by === me)) playHit(SOUND[kind], Number(strength) || 0);
    }
    const [px, pz, vx, vz] = msg.p;
    const shown = physics.puck();
    shown.x += offset[0];
    shown.z += offset[1];
    const mo = [msg.p[4 + other * 2], msg.p[5 + other * 2]];
    const mm = [msg.p[4 + me * 2], msg.p[5 + me * 2]];
    physics.placeMallet(other, ...mo);
    const held = msg.held === 0 || msg.held === 1 ? msg.held : null;
    if (physics.held() !== held && physics.held() !== null) physics.hold(physics.held(), false);
    // Umlaufzeit: von unserer Lage c bis jetzt, abzüglich der Zeit, die sie beim Host lag
    const ahead = Number.isFinite(msg.c) ? Math.round((simTime - msg.c - (Number(msg.h) || 0)) / (STEP * 1000)) : 0;
    const n = Math.min(Math.max(ahead, 0), MAX_AHEAD);
    const start = simTime - n * STEP * 1000;
    rival = { x: mo[0], z: mo[1], vx: msg.p[8 + other * 2], vz: msg.p[9 + other * 2], at: simTime, ahead: n * STEP * 1000 };
    const nowMine = physics.mallet(me);
    physics.placeMallet(me, ...mm);
    physics.setPuck(px, pz, vx, vz);
    if (held !== null && physics.held() === null) physics.hold(held, true);
    if (msg.g) physics.park();
    else {
      for (let i = 1; i <= n; i++) {
        physics.setTarget(me, mineAt(start + i * STEP * 1000), MAX_MALLET * 3);
        physics.setTarget(other, guess(i * STEP * 1000), MAX_MALLET * 3);
        physics.step();
      }
    }
    if (n === 0 || msg.g) physics.placeMallet(me, nowMine.x, nowMine.z); // ohne Vorausrechnung: eigener Schläger bleibt, wo er ist
    const p = physics.puck();
    offset = [shown.x - p.x, shown.z - p.z];
    if (Math.hypot(...offset) > SNAP || msg.g) offset = [0, 0];
    const h = msg.g ? null : halfOf(pz); // Puck im Tor oder Pause: Balken von vorn, sobald er wieder liegt
    if (h !== halfSince.half) [halfSince.half, halfSince.at] = [h, performance.now()];
  }

  // --- Anzeige ---
  function render() {
    if (!state) return;
    const s = state;
    board.setScore(s.score);
    const won = s.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    cheat.update({ free: !!s.free, canAccuse: canAccuse() });
    const verdict = s.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${s.round}-${s.seq}`, verdictText(verdict), verdict.type === 'caught');
    panel.render({
      players: [0, 1].map((p) => ({
        name: p === me ? `Du (${names.me()})` : solo ? `Computer (${LEVELS[lvl].name})` : names.other(),
        score: s.score[p],
        wins: s.wins[p],
        alarms: s.alarms?.[p] ?? 0,
      })),
      me,
      status: statusText(),
      level: lvl,
      log,
      end: s.winner === null ? null : {
        title: s.winner === me ? 'Gewonnen!' : `${who(s.winner)} gewinnt`,
        text: `${s.score[me]} : ${s.score[other]} – Partien: du ${s.wins[me]} : ${s.wins[other]} ${solo ? 'Computer' : names.other()}`,
        wait: waitAgain(),
      },
      free: !!s.free,
    });
    statusShown = uiKey();
  }

  // „Geschummelt!“ geht während der Partie – nach dem Ende nur noch kurz gegen den Sieger (ein frischer Verstoß kostet sein Siegtor)
  const canAccuse = () => !!state?.free && (state.winner === null || (state.winner === other && performance.now() - changedAt < ACCUSE_S * 1000));
  // Ohne Hilfen: Sekunden, bis der Sieger Revanche starten darf (sein letzter Verstoß kann noch erwischt werden)
  const waitAgain = () => (state?.winner === me ? Math.ceil(againWait(state, me, state.clock + (performance.now() - changedAt) / 1000)) : 0);
  const uiKey = () => `${statusText()}|${canAccuse()}|${waitAgain()}`;

  function statusText() {
    const s = state;
    if (!physics) return 'Tisch wird vorbereitet …';
    if (frozen) return 'Verbindung unterbrochen – das Spiel steht';
    if (s.winner !== null) return 'Partie vorbei';
    const e = s.events[0];
    if (e?.type === 'goal' && performance.now() - changedAt < 1600) return e.by === me ? 'Tor! Du triffst.' : `Tor für ${who(e.by) === 'Du' ? 'dich' : who(e.by)} …`;
    const p = physics.puck();
    return halfOf(p.z) === me ? 'Puck bei dir – schieß ihn ins Tor gegenüber' : solo ? 'Der Computer hat den Puck …' : `${names.other()} hat den Puck …`;
  }

  // Zeile für den Verlauf (Verstöße bleiben geheim – die muss der andere selbst bemerken)
  function describe(s) {
    return s.events.map((e) => line(s, e)).filter(Boolean).join(' ');
  }

  function line(s, e) {
    const score = `(${s.score[me]} : ${s.score[other]})`;
    if (e.type === 'start') return `Partie ${s.round}: ${e.by === me ? 'du hast' : `${who(e.by)} hat`} den Puck.`;
    if (e.type === 'goal') return `${e.by === me ? 'Tor für dich' : `Tor für ${who(e.by)}`} ${score}${s.winner !== null ? ' – Partie vorbei.' : '.'}`;
    if (e.type === 'sieben') return `7 Sekunden: ${e.by === me ? 'du hast' : `${who(e.by)} hat`} den Puck zu lange gehalten – er geht an ${whom(1 - e.by)}.`;
    if (e.type === 'caught' || e.type === 'fehlalarm') return verdictText(e);
    return '';
  }

  // e = { type, by (hat gerufen), player (Schummler bzw. Rufer beim Fehlalarm), why, annulled }
  function verdictText(e) {
    if (e.type === 'caught') {
      if (e.player === me) return `${solo ? 'Der Computer ruft „Geschummelt!“ – ' : ''}Erwischt! ${WHY_TEXT(e.why)}.${e.annulled ? ' Dein Tor zählt nicht,' : ''} ${who(e.by)} bekommt einen Strafpunkt.`;
      return `Erwischt! ${who(e.player)}: ${WHY_TEXT(e.why)}.${e.annulled ? ' Das Tor zählt nicht, du' : ' Du'} bekommst einen Strafpunkt.`;
    }
    // Fehlalarm: es geht einfach weiter; jeder zweite kostet ein Tor (penalty)
    const rest = e.penalty ? `Das ist der ${ALARMS_PER_POINT}. – Strafpunkt für ${e.player === me ? (solo ? 'den Computer' : names.other()) : 'dich'}.` : 'Es geht weiter.';
    if (e.player === me) return `Fehlalarm! Da war nichts. ${rest}`;
    return solo ? `Der Computer ruft „Geschummelt!“ – Fehlalarm, du hast sauber gespielt. ${rest}`
      : `Fehlalarm! ${names.other()} hat zu Unrecht „Geschummelt!“ gerufen. ${rest}`;
  }

  // --- Eingaben ---
  const onMove = (e) => {
    const spot = board.pick(room.rayFrom(e));
    if (!spot) return;
    mouse = spot;
    const inside = Math.abs(spot[0]) < W / 2 + 0.15 && Math.abs(spot[1]) < L / 2 + 0.15;
    canvas.style.cursor = inside ? 'none' : ''; // über dem Tisch ist der Schläger der Mauszeiger
  };
  const onDown = (e) => {
    if (e.button !== 2) return;
    top = true;
  };
  const onUp = (e) => {
    if (e.button === 2) top = false;
  };
  const onKey = (e) => {
    if ((e.key === 'g' || e.key === 'G') && !e.repeat && !e.target.closest?.('input, select, textarea')) tryAccuse();
  };
  const onBlur = () => (top = false);

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', onBlur);
  const stopFrames = room.onFrame((dt) => {
    if (!physics || stopped) return;
    if (frozen) {
      if (statusShown !== uiKey()) render();
      return;
    }
    if (isHost && state) hostFrame(dt);
    else if (!isHost) guestFrame(dt);
    if (!state) return;
    // 7-Sekunden-Balken: wie lange liegt der Puck schon bei mir?
    const held = isHost ? referee.holding(me) : halfSince.half === me && !snap?.g ? (performance.now() - halfSince.at) / 1000 : 0;
    panel.setClock(state.winner === null && held > 0 ? held / SEVEN_S : null);
    if (statusShown !== uiKey()) render();
  });

  board.ready().then(() => {
    if (stopped) return;
    physics = board.newPhysics();
    for (const p of [0, 1]) physics.placeMallet(p, ...HOME(p));
    physics.setPuck(0, 0);
    physics.park();
    if (isHost) {
      referee = createReferee(physics);
      if (solo) brain = createBrain(other, lvl);
      commit(resume ?? newGame({ starter: Math.random() < 0.5 ? 0 : 1, free })); // Anwurf: der Zufall entscheidet (Münzwurf)
    } else render();
  });

  // Nur beim Entwickeln: Zugriff für die Browser-Tests (headless Chrome)
  if (import.meta.env?.DEV) {
    window.airhockey = {
      me, state: () => state, physics: () => physics, offset: () => offset,
      shown: () => physics && [physics.puck().x + (isHost ? 0 : offset[0]), physics.puck().z + (isHost ? 0 : offset[1])],
      screen: (x, z) => room.toScreen(board.toWorld([x, z])),
    };
  }

  return {
    handle,
    refresh: () => render(),
    // Verbindung weg (main.js): Physik und Uhr stehen, bis sie wieder da ist – sonst liefe das Spiel gegen einen stillen Schläger weiter.
    // Nach dem Neuverbinden startet der Host die Partie mit dem letzten Stand neu (Puck wird frisch hingelegt).
    pause(on = true) {
      frozen = on;
      acc = 0;
      sendAcc = 0;
      render();
    },
    view: () => state,
    stop() {
      stopped = true;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      canvas.style.cursor = '';
      stopFrames();
      physics?.free();
      physics = null;
      board.reset();
    },
  };
}

const WHY_TEXT = (why) => (Object.values(WHY).includes(why) ? why : 'Regelverstoß');
