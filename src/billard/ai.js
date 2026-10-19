// Computer-Gegner beim Billard: sucht für jede erlaubte Kugel und jede Tasche den Stoß über die
// „Geisterkugel“ (dort muss die Weiße die Kugel treffen), prüft, ob der Weg frei ist, und nimmt den
// leichtesten. Etwas Streuung macht ihn schlagbar. Ohne guten Stoß: die nächste erlaubte Kugel direkt anspielen.
// Rein (kein three.js) – Richtung wie table.js: angle 0 = +x, Richtung (cos a, −sin a) in (x, z).
import { TABLE, R, targets, freeSpot } from './rules.js';

const { L, W } = TABLE;
const AIM = [[-L / 2, -W / 2, false], [0, -W / 2 - 0.01, true], [L / 2, -W / 2, false], [-L / 2, W / 2, false], [0, W / 2 + 0.01, true], [L / 2, W / 2, false]];

const angleOf = (dx, dz) => Math.atan2(-dz, dx);

// Abstand von Punkt p zur Strecke a–b
function distToSegment([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

const clear = (s, from, to, skip) => Object.entries(s.positions)
  .every(([n, p]) => skip.includes(Number(n)) || distToSegment(p, from, to) >= 2 * R * 0.98);

// Beste Stöße von der Weißen aus (sortiert), jeweils { angle, power, score }
function candidates(s, player, cue) {
  const must = targets(s, player);
  const balls = Object.keys(s.positions).map(Number).filter((n) => n !== 0 && (must ? must.includes(n) : n !== 8));
  const out = [];
  for (const n of balls) {
    const b = s.positions[n];
    for (const [px, pz, side] of AIM) {
      const ux = px - b[0];
      const uz = pz - b[1];
      const d2 = Math.hypot(ux, uz);
      if (side && Math.abs(uz) / d2 < 0.45) continue; // flach in die Mitteltasche geht nicht
      const ghost = [b[0] - (ux / d2) * 2 * R, b[1] - (uz / d2) * 2 * R];
      if (Math.abs(ghost[0]) > L / 2 - R || Math.abs(ghost[1]) > W / 2 - R) continue;
      const vx = ghost[0] - cue[0];
      const vz = ghost[1] - cue[1];
      const d1 = Math.hypot(vx, vz);
      if (d1 < 1e-6) continue;
      const cos = (vx * ux + vz * uz) / (d1 * d2);
      if (cos < 0.3) continue; // Schnitt steiler als ~72°
      if (!clear(s, cue, ghost, [0, n]) || !clear(s, b, [px, pz], [0, n])) continue;
      out.push({ angle: angleOf(vx, vz), power: Math.min(0.85, Math.max(0.22, 0.2 + 0.28 * (d1 + d2) + (1 - cos) * 0.25)), score: cos * cos / (d1 + 1.5 * d2) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// skill 0–1: wie genau gezielt wird. Liefert { angle, power, place } (place = neue Lage der Weißen bei „Ball in Hand“)
export function chooseShot(s, player, { skill = 0.7, rng = Math.random } = {}) {
  let cue = s.positions[0];
  let place = null;
  if (s.ballInHand || !cue) {
    let best = null;
    for (let i = 0; i < 80; i++) {
      const spot = [(rng() - 0.5) * (L - 4 * R), (rng() - 0.5) * (W - 4 * R)];
      if (!freeSpot(s, spot, 0)) continue;
      const top = candidates({ ...s, positions: { ...s.positions, 0: spot } }, player, spot)[0];
      if (top && (!best || top.score > best.score)) best = { ...top, spot };
    }
    place = best?.spot ?? findFree(s);
    cue = place;
  }
  const shots = s.isBreak ? [] : candidates({ ...s, positions: { ...s.positions, 0: cue } }, player, cue);
  const spread = (1 - skill) * 0.045 + 0.003;
  const jitter = () => (rng() + rng() + rng() - 1.5) * spread;
  if (s.isBreak) {
    const apex = Object.values(s.positions).filter((p) => p !== s.positions[0]).reduce((a, p) => (p[0] < a[0] ? p : a), [Infinity, 0]);
    return { angle: angleOf(apex[0] - cue[0], apex[1] - cue[1]) + jitter() * 0.3, power: 1, place };
  }
  if (shots.length) return { angle: shots[0].angle + jitter(), power: shots[0].power, place };
  // Kein sauberer Stoß: nächste erlaubte Kugel direkt anspielen
  const must = targets(s, player);
  const near = Object.entries(s.positions)
    .filter(([n]) => Number(n) !== 0 && (must ? must.includes(Number(n)) : Number(n) !== 8))
    .map(([, p]) => p)
    .sort((a, b) => Math.hypot(a[0] - cue[0], a[1] - cue[1]) - Math.hypot(b[0] - cue[0], b[1] - cue[1]))[0];
  const goal = near ?? [0, 0];
  return { angle: angleOf(goal[0] - cue[0], goal[1] - cue[1]) + jitter(), power: 0.45, place };
}

function findFree(s) {
  for (let x = -L / 4; x < L / 2; x += 2 * R) if (freeSpot(s, [x, 0], 0)) return [x, 0];
  return [-L / 4, 0];
}
