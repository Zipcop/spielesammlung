// Computer-Gegner für Air-Hockey (rein, ohne Grafik – auch in den Tests): ein „Gehirn“, das jeden Physikschritt den Puck
// sieht und ein Ziel für seinen Schläger nennt. Die Stufen unterscheiden sich in Reaktionszeit (er sieht den Puck so viel
// später), Tempo des Schlägers, Vorhersage der Puckbahn (gerade oder mit Banden) und Zielgenauigkeit.
// Gerechnet wird in der eigenen Sicht: eigenes Tor auf +z, das Tor des Gegners auf −z (Spieler 1 wird gespiegelt).
import { TABLE, R, RM, clampMallet } from './rules.js';

const { L, W } = TABLE;
export const LEVELS = [
  { name: 'Anfänger', reaction: 0.24, speed: 2.2, strike: 2.4, bounce: false, err: 0.13, bank: 0 },
  { name: 'Fortgeschritten', reaction: 0.15, speed: 3.4, strike: 3.8, bounce: false, err: 0.07, bank: 0.15 },
  { name: 'Profi', reaction: 0.09, speed: 4.6, strike: 5.2, bounce: true, err: 0.035, bank: 0.35 },
  { name: 'Meister', reaction: 0.05, speed: 5.6, strike: 6, bounce: true, err: 0.015, bank: 0.5 },
];
const DEFEND = L / 2 - 0.13; // Abwehrlinie vor dem eigenen Tor
const HOME = L / 2 - 0.22; // Grundstellung

// Wo kreuzt der Puck die Linie z = line? Mit bounce an den Längsbanden gespiegelt, sonst gerade weiter (bis zur Bande)
export function crossing(puck, line, bounce) {
  if (puck.vz <= 0.05) return null;
  const t = (line - puck.z) / puck.vz;
  if (t < 0) return null;
  const x = puck.x + puck.vx * t;
  const half = W / 2 - R;
  if (!bounce) return { x: Math.min(Math.max(x, -half), half), t };
  const span = 4 * half; // eine Bande hin und zurück = ein Spiegel-Zyklus
  let u = (((x + half) % span) + span) % span;
  if (u > 2 * half) u = span - u;
  return { x: u - half, t };
}

// p = Spieler (0: Tor auf +z, 1: Tor auf −z), level = Index in LEVELS, rng = Zufall (Tests: fester Startwert)
export function createBrain(p, level = 1, rng = Math.random) {
  const lv = () => LEVELS[Math.min(Math.max(level, 0), LEVELS.length - 1)];
  const flip = p === 0 ? 1 : -1;
  const seen = []; // [Zeit, Puck] – der Computer sieht den Puck mit Verzögerung
  let clock = 0;
  let err = 0;
  let lastDir = 0;
  let aim = 0; // Ziel-x am gegnerischen Tor (Bandenschuss: weit außen gespiegelt)
  let striking = 0; // Sekunden, die der laufende Schuss noch durchzieht
  let push = null; // Richtung eines Befreiungsschlags (Puck in der Ecke oder zu lange liegen geblieben)
  let slow = 0; // so lange liegt der Puck schon langsam auf meiner Seite

  function newAim() {
    const l = lv();
    err = (rng() * 2 - 1) * l.err;
    aim = rng() < l.bank ? (rng() < 0.5 ? -1 : 1) * (W - 2 * R) : (rng() * 2 - 1) * 0.06; // gespiegelt über eine Längsbande
  }
  newAim();

  return {
    setLevel(n) {
      level = n;
    },
    // view = { puck: {x,z,vx,vz}, mallet: {x,z} } in Tisch-Koordinaten, dt = Schritt.
    // reach: ohne Hilfen darf er diesmal über die Mittellinie (schummelt). Liefert { target: [x, z], speed }.
    think(view, dt, { reach = false } = {}) {
      const l = lv();
      clock += dt;
      seen.push([clock, { ...view.puck }]);
      while (seen.length > 2 && seen[1][0] <= clock - l.reaction) seen.shift();
      const raw = seen[0][1];
      // eigene Sicht: Tor auf +z
      const puck = { x: raw.x * flip, z: raw.z * flip, vx: raw.vx * flip, vz: raw.vz * flip };
      const me = { x: view.mallet.x * flip, z: view.mallet.z * flip };
      const dir = Math.sign(puck.vz);
      if (dir !== lastDir && dir !== 0) {
        lastDir = dir;
        newAim();
      }
      const local = choose(puck, me, l, reach, dt);
      const [x, z] = clampMallet(0, [local.target[0], local.target[1]], reach);
      return { target: [x * flip, z * flip], speed: local.speed };
    },
  };

  function choose(puck, me, l, reach, dt) {
    const speed = Math.hypot(puck.vx, puck.vz);
    const mine = puck.z > (reach ? -0.25 : 0) - R; // Puck auf meiner Seite (ohne Hilfen auch knapp drüben)
    // Schnell auf mein Tor zu und noch vor der Abwehrlinie: abfangen
    if (puck.vz > 1.2 && puck.z < DEFEND - 0.05 && !(mine && speed < 1.6)) {
      striking = 0;
      const c = crossing(puck, DEFEND, l.bounce);
      const x = (c ? c.x : puck.x) + err;
      return { target: [x, DEFEND], speed: l.speed };
    }
    slow = mine && speed < 0.6 ? slow + dt : 0;
    if (mine) {
      const back = R + RM + 0.03;
      // Puck in der Ecke (hinter ihn kommt man nicht) oder liegt zu lange: direkt durch ihn hindurch schlagen
      const [bx, bz] = clampMallet(0, [puck.x, puck.z + back]);
      const stuck = puck.z + back - bz > 0.03 && speed < 0.6;
      // Erst ein Stück Anlauf zurück, dann kräftig – aus der Ecke prallt der Puck so über beide Banden heraus
      if (push || stuck || slow > 2.2) {
        if (!push) {
          const dx = puck.x - me.x;
          const dz = puck.z - me.z;
          const n = Math.hypot(dx, dz) || 1;
          push = { dir: [dx / n, dz / n], t: 0, from: [puck.x, puck.z] };
          slow = 0;
        }
        push.t += dt;
        const { dir, from, t } = push;
        if (t > 0.5) push = null;
        if (t < 0.25) return { target: [from[0] - dir[0] * 0.17, from[1] - dir[1] * 0.17], speed: l.speed };
        return { target: [puck.x + dir[0] * 0.25, puck.z + dir[1] * 0.25], speed: l.strike };
      }
      // Schuss: hinter den Puck, dann in Richtung Ziel durchziehen
      const goalX = aim;
      const ax = goalX - puck.x;
      const az = -L / 2 - puck.z;
      const len = Math.hypot(ax, az);
      const d = [ax / len, az / len];
      const behind = [puck.x - d[0] * back, puck.z - d[1] * back];
      const rel = [me.x - puck.x, me.z - puck.z];
      const along = rel[0] * d[0] + rel[1] * d[1]; // < 0: Schläger steht hinter dem Puck
      const side = Math.abs(rel[0] * d[1] - rel[1] * d[0]);
      if (striking > 0 || (along < -(R + RM) * 0.7 && side < 0.035 + l.err * 0.3)) {
        striking = striking > 0 ? striking - dt : 0.18;
        return { target: [puck.x + d[0] * 0.3 + err * 0.3, puck.z + d[1] * 0.3], speed: l.strike };
      }
      // steht der Schläger vor dem Puck (zwischen Puck und gegnerischem Tor), seitlich um ihn herum
      if (along > -0.01) {
        const off = me.x > puck.x ? 1 : -1;
        return { target: [puck.x + off * (R + RM + 0.06), behind[1] + 0.05], speed: l.speed };
      }
      return { target: behind, speed: l.speed };
    }
    striking = 0;
    // Puck beim Gegner: zurück in die Grundstellung, leicht zur Puckseite
    return { target: [puck.x * 0.35, HOME], speed: l.speed * 0.7 };
  }
}
