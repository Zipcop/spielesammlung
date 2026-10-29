// Schiedsrichter (rein, ohne Grafik): treibt die Physik Schritt für Schritt und wendet die Regeln an – Tor, Puck neu hinlegen,
// 7-Sekunden-Regel, ohne Hilfen die Verstöße merken. Nur der Host (bzw. allein der eigene PC) und die Tests benutzen ihn.
// Der Spielstand selbst bleibt rein (rules.js); tick() liefert den neuen Stand und ob er gemeldet werden muss.
import { goal, sevenSeconds, foul, serveSpot, halfOf, overLine, clampMallet, SEVEN_S, RM, R } from './rules.js';
import { STEP, MAX_MALLET } from './physics.js';

export const GOAL_PAUSE = 1.2; // s – Puck liegt im Schlitz, dann kommt er beim Getroffenen wieder heraus
export const FOUL_PAUSE = 0.8; // s – nach 7 Sekunden oder einer Strafe

export function createReferee(physics) {
  let clock = 0;
  let placed = null; // Schlüssel des zuletzt hingelegten Pucks (Partie + reset)
  let pauseUntil = 0;
  let half = null; // Hälfte, in der der Puck gerade liegt, und seit wann
  let since = 0;
  const crossing = [false, false]; // ohne Hilfen: Schläger gerade über der Mittellinie

  const keyOf = (s) => `${s.round}-${s.reset}`;

  // Neuer Stand von außen (Start, Fortsetzen, Revanche, Anklage): Puck je nach Lage neu hinlegen
  function sync(s, { instant = false } = {}) {
    if (keyOf(s) === placed) return;
    placed = keyOf(s);
    clock = Math.max(clock, s.clock ?? 0);
    if (instant || s.reset === 0) return place(s);
    if (physics.held() !== null) physics.hold(physics.held(), false); // erst loslassen, dann ruht der Puck
    if (!physics.parked()) physics.park();
    pauseUntil = clock + (s.events.some((e) => e.type === 'goal') ? GOAL_PAUSE : FOUL_PAUSE);
  }

  function place(s) {
    pauseUntil = 0;
    if (physics.held() !== null) physics.hold(physics.held(), false);
    if (s.winner !== null) { // Partie vorbei: Puck ruht in der Mitte
      physics.setPuck(0, 0);
      return physics.park();
    }
    let [x, z] = serveSpot(s.serve);
    const m = physics.mallet(s.serve);
    if (Math.hypot(m.x - x, m.z - z) < RM + R + 0.02) x = m.x > 0 ? -0.2 : 0.2; // nicht unter den Schläger legen
    physics.setPuck(x, z);
    half = halfOf(z);
    since = clock;
  }

  // Ein Physikschritt. inputs = { targets: [[x,z],[x,z]], speeds?: [m/s, m/s], top?: [bool, bool] }.
  // Liefert { state, changed, sounds, goal }: changed = Stand hat sich hörbar geändert (Host meldet ihn dem Gast)
  function tick(s, inputs) {
    sync(s);
    clock += STEP;
    let state = s;
    let changed = false;
    const use = (next) => { // mehrere Ereignisse im selben Schritt (z. B. Verstoß und Tor): alle behalten
      if (!next) return;
      state = changed ? { ...next, events: [...state.events, ...next.events] } : next;
      changed = true;
    };
    for (const p of [0, 1]) {
      const target = clampMallet(p, inputs.targets[p], state.free);
      physics.setTarget(p, target, inputs.speeds?.[p] ?? MAX_MALLET);
    }
    // Topping (nur ohne Hilfen): Taste gedrückt und Schläger am Puck = festhalten
    for (const p of [0, 1]) {
      const want = !!inputs.top?.[p] && state.free && state.winner === null && pauseUntil === 0;
      if (want && physics.held() === null && physics.hold(p, true)) use(foul(state, p, 'topping', clock));
      else if (!want && physics.held() === p) physics.hold(p, false);
      else if (want && physics.held() === p) state = { ...state, fouls: refresh(state.fouls, p) }; // hält noch fest: Verstoß bleibt frisch
    }
    const out = physics.step();
    if (pauseUntil && clock >= pauseUntil) place(state);
    // Ohne Hilfen: Schläger über der Mittellinie
    if (state.free && state.winner === null) { // nach dem Ende zählt nichts mehr
      for (const p of [0, 1]) {
        const over = overLine(p, physics.mallet(p).z);
        if (over && !crossing[p]) use(foul(state, p, 'linie', clock));
        else if (over) state = { ...state, fouls: refresh(state.fouls, p) };
        crossing[p] = over;
      }
    }
    if (out.goal !== null && state.winner === null && pauseUntil === 0) {
      use(goal(state, out.goal, clock));
      placed = keyOf(state);
      pauseUntil = clock + GOAL_PAUSE;
      half = null;
    }
    // 7-Sekunden-Regel: Puck liegt durchgehend in einer Hälfte
    const puck = physics.puck();
    const h = pauseUntil || physics.parked() ? null : halfOf(puck.z);
    if (h !== half) [half, since] = [h, clock];
    else if (h !== null && clock - since > SEVEN_S && state.winner === null) {
      since = clock;
      const next = sevenSeconds(state, h, clock);
      use(next);
      if (next && !state.free) {
        placed = keyOf(state);
        physics.park();
        pauseUntil = clock + FOUL_PAUSE;
      }
    }
    if (changed) state = { ...state, clock };
    return { state, changed, sounds: out.sounds, goal: out.goal };
  }

  function refresh(fouls, p) {
    const f = [...fouls];
    if (f[p]) f[p] = { ...f[p], at: clock };
    return f;
  }

  return {
    sync,
    tick,
    clock: () => clock,
    paused: () => pauseUntil > 0,
    // Sekunden, die der Puck schon in der Hälfte von p liegt (für die Anzeige), sonst 0
    holding: (p) => (half === p ? clock - since : 0),
  };
}
