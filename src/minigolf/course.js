// Minigolfanlage als reine Daten (kein three.js, kein Rapier): 9 Bahnen mit Boden, Banden, Hindernissen, Abschlag,
// Loch und Laufweg. physics.js baut daraus die Rapier-Welt, scene.js die Grafik, ai.js plant damit – alle sehen dieselben Maße.
// Koordinaten in Metern im Bezug der Anlage (Gruppe in room.scene bei COURSE_AT, weit weg vom Zimmer). y = Höhe über dem Rasen.
// Je Bahn ein eigenes Bahnsystem: u = vom Abschlag zum Loch, v = quer (nach rechts), h = Höhe über der Bahnfläche.
// Maße angelehnt an Betonbahnen (rund 1,25 m breit, Lochdurchmesser höchstens 120 mm laut Internationalen Spielregeln 2.11).

export const COURSE_AT = [-60, 0]; // Mitte der Anlage in der Welt (x, z) – Bowling liegt bei +60
export const FLOOR = 0.1; // Oberkante der Bahnplatte über dem Rasen
export const R = 0.0205; // Ballradius (Ø 41 mm)
export const CUP_R = 0.05; // Lochradius (Ø 100 mm) – so weit muss die Ballmitte über dem Loch sein
export const WALL_T = 0.06; // Bandenstärke
export const WALL_H = 0.08; // Banden so hoch über der Bahnfläche
export const HOLES = 9;
export const MAX_STROKES = 6; // danach ist Schluss: nicht eingelocht = 7 (Internationale Spielregeln 9.1)

// Mühle (Bahn 6): Flügel drehen um die Bahnachse, Winkel = phase + MILL_SPEED · t
export const MILL_SPEED = 1.1; // Bogenmaß pro Sekunde
export const MILL_PERIOD = Math.PI / 2; // vier Flügel – alle 90° sieht es gleich aus

const W = 0.6; // halbe Bahnbreite (1,2 m)

// Bahnen: Abschlag bei u = 0, Umriss als Vieleck (u, v), Hindernisse in Bahnkoordinaten. path = Laufweg zum Loch (für den Computer).
const DEFS = [
  {
    name: 'Engstelle', surface: 'beton', color: '#5f8a6a', at: [-13, -2.4], dir: [0, -1],
    outline: [[-0.6, -W], [7.4, -W], [7.4, W], [-0.6, W]],
    // Trichter aus zwei Keilen: dazwischen bleibt eine 24 cm schmale Gasse
    stones: [[[3.0, -W], [3.6, -0.12], [3.6, -W]], [[3.0, W], [3.6, W], [3.6, 0.12]]].map((foot) => ({ foot, h: 0.12 })),
    cup: [6.3, 0], path: [[0, 0], [3.3, 0], [3.8, 0], [6.3, 0]],
  },
  {
    name: 'Wellen', surface: 'beton', color: '#4f7aa0', at: [-9.6, -2.4], dir: [0, -1],
    outline: [[-0.6, -W], [9.4, -W], [9.4, W], [-0.6, W]],
    // drei Wellen quer über die Bahn: flache Zylinder, je 5 cm hoch
    waves: [2.6, 4.1, 5.6].map((u) => ({ u, r: 0.6, top: 0.05 })),
    cup: [8.2, 0.25], path: [[0, 0], [8.2, 0.25]],
  },
  {
    name: 'Kurve', surface: 'filz', color: '#2f6b3a', at: [-6.2, -2.4], dir: [0, -1],
    // rechtwinklig nach rechts, die äußere Ecke ist abgeschrägt (Bande als Spiegel)
    outline: [[-0.6, -W], [5.0, -W], [5.6, 0], [5.6, 4.4], [4.4, 4.4], [4.4, W], [-0.6, W]],
    blocks: [{ u: 2.6, v: 0.25, lu: 0.16, lv: 0.16, h: 0.12 }], // kleiner Stein im Weg
    cup: [5.0, 3.6], path: [[0, 0], [4.9, 0.1], [5.0, 3.6]],
  },
  {
    name: 'Rampe', surface: 'beton', color: '#a35c45', at: [0.4, -2.4], dir: [0, -1],
    outline: [[-0.6, -W], [8.0, -W], [8.0, W], [-0.6, W]], wallH: 0.22,
    // Auffahrt 1,2 m auf ein 12 cm hohes Plateau mit dem Loch – zu schwach rollt zurück
    hulls: [prism([[4.0, 0, -W], [5.2, 0.12, -W], [8.0, 0.12, -W]], null, W)],
    cup: [6.9, 0, 0.12], path: [[0, 0], [4.0, 0], [6.9, 0]],
  },
  {
    name: 'Tunnel', surface: 'beton', color: '#7a6e9c', at: [3.8, -2.4], dir: [0, -1],
    outline: [[-0.6, -W], [8.4, -W], [8.4, W], [-0.6, W]],
    // Querriegel mit einer 16 cm schmalen Röhre links der Mitte
    blocks: [{ u: 4.2, v: -0.465, lu: 0.8, lv: 0.27, h: 0.3, tunnel: true }, { u: 4.2, v: 0.215, lu: 0.8, lv: 0.77, h: 0.3, tunnel: true }],
    tunnel: { u: 4.2, v: -0.25, w: 0.16, len: 0.8 },
    cup: [7.3, 0.2], path: [[0, 0], [3.5, -0.25], [4.9, -0.25], [7.3, 0.2]],
  },
  {
    name: 'Mühle', surface: 'filz', color: '#2f6b3a', at: [9.0, 2.4], dir: [0, 1],
    outline: [[-0.6, -W], [8.4, -W], [8.4, W], [-0.6, W]],
    // Mühlenhaus mit 20 cm Durchlass, davor drehen sich vier Flügel bis knapp über die Bahn
    blocks: [{ u: 4.35, v: -0.35, lu: 0.3, lv: 0.5, h: 0.25, house: true }, { u: 4.35, v: 0.35, lu: 0.3, lv: 0.5, h: 0.25, house: true }],
    mill: { u: 4.13, h: 0.68, len: 0.66, width: 0.17, thick: 0.03 },
    cup: [7.2, 0], path: [[0, 0], [3.9, 0], [4.8, 0], [7.2, 0]],
  },
  {
    name: 'Brücke', surface: 'beton', color: '#5f8a6a', at: [5.4, 2.4], dir: [0, 1],
    outline: [[-0.6, -W], [9.0, -W], [9.0, W], [-0.6, W]],
    // Wassergraben quer über die Bahn, nur ein 30 cm schmaler Steg ohne Geländer führt hinüber
    gaps: [[4.0, 5.4]],
    hulls: [prism([[3.2, 0, -0.15], [3.8, 0.08, -0.15], [5.6, 0.08, -0.15], [6.2, 0, -0.15]], null, 0.15)],
    cup: [8.0, -0.3], path: [[0, 0], [3.0, 0], [6.4, 0], [8.0, -0.3]],
  },
  {
    name: 'Schräge', surface: 'filz', color: '#2f6b3a', at: [1.8, 2.4], dir: [0, 1],
    outline: [[-0.6, -W], [9.4, -W], [9.4, W], [-0.6, W]], wallH: 0.17,
    // Mittelteil quer geneigt: rechts 9 cm hoch, links auf Bahnhöhe – der Ball läuft nach links weg
    hulls: [slope(2.0, 3.4, 6.0, 7.4, 0.09)],
    cup: [8.6, 0.3], path: [[0, 0], [8.6, 0.3]],
  },
  {
    name: 'Vulkan', surface: 'beton', color: '#a35c45', at: [-2.0, 2.4], dir: [0, 1],
    outline: [[-0.6, -0.8], [9.0, -0.8], [9.0, 0.8], [-0.6, 0.8]], wallH: 0.1,
    // Kegelstumpf mit dem Loch oben: zu schwach rollt zurück, zu stark auf der anderen Seite hinunter
    hulls: [cone(6.0, 0, 0.78, 0.34, 0.12)],
    cup: [6.0, 0, 0.12], path: [[0, 0], [6.0, 0]],
  },
];

// Keil/Prisma über einem Umriss in der Bahnebene: pts = [u, v] (Höhe h) oder [u, h, v] (Profil, quer bis v1)
function prism(pts, h, v1) {
  if (h !== null) return pts.flatMap(([u, v]) => [[u, v, -0.02], [u, v, h]]);
  return pts.flatMap(([u, hh, v0]) => [[u, v0, -0.02], [u, v0, hh], [u, v1, -0.02], [u, v1, hh]]);
}

// Querneigung: von u0 bis u1 steigt die rechte Seite auf hMax, bis u2 bleibt sie, bis u3 geht sie zurück
function slope(u0, u1, u2, u3, hMax) {
  const pts = [];
  for (const u of [u0, u1, u2, u3]) {
    const top = u === u1 || u === u2 ? hMax : 0;
    pts.push([u, -W, -0.02], [u, W, -0.02], [u, -W, 0], [u, W, top]);
  }
  return pts;
}

// Kegelstumpf (24 Ecken)
function cone(u, v, r0, r1, h) {
  const pts = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    pts.push([u + Math.cos(a) * r0, v + Math.sin(a) * r0, -0.02], [u + Math.cos(a) * r0, v + Math.sin(a) * r0, 0], [u + Math.cos(a) * r1, v + Math.sin(a) * r1, h]);
  }
  return pts;
}

// --- Umrechnung Bahn → Anlage ---
function frame(at, dir) {
  const [dx, dz] = dir;
  const [nx, nz] = [-dz, dx]; // quer, nach rechts gesehen vom Abschlag
  const yaw = Math.atan2(-dz, dx); // Drehung um die Hochachse wie three.js (lokales +x zeigt in Spielrichtung)
  const point = (u, v, h = 0) => [at[0] + u * dx + v * nx, FLOOR + h, at[1] + u * dz + v * nz];
  return { point, yaw, d: [dx, dz], n: [nx, nz] };
}

const round = (x) => Math.round(x * 1e6) / 1e6;

// Hindernis-Quader (Bahnkoordinaten Mitte u, v, Länge lu, Breite lv, Höhe h) als Quader im Anlagenbezug
function blockBox(f, b) {
  const [x, , z] = f.point(b.u, b.v);
  return { c: [x, FLOOR + b.h / 2, z], half: [b.lu / 2, b.h / 2, b.lv / 2], yaw: f.yaw, role: 'block', look: b.tunnel ? 'tunnel' : b.house ? 'house' : 'stone' };
}

// Banden außen um das Vieleck (Anlagenbezug, Liste von [x, z]): je Kante ein Quader, Ecken überlappen
function wallsAround(poly, top) {
  let area = 0;
  poly.forEach(([x0, z0], i) => {
    const [x1, z1] = poly[(i + 1) % poly.length];
    area += x0 * z1 - x1 * z0;
  });
  const sign = area > 0 ? 1 : -1;
  return poly.map(([x0, z0], i) => {
    const [x1, z1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const [ex, ez] = [(x1 - x0) / len, (z1 - z0) / len];
    const [ox, oz] = [ez * sign, -ex * sign]; // nach außen
    const h = top + 0.04; // reicht 4 cm in die Platte hinein
    return {
      c: [round((x0 + x1) / 2 + (ox * WALL_T) / 2), FLOOR + top - h / 2, round((z0 + z1) / 2 + (oz * WALL_T) / 2)],
      half: [len / 2 + WALL_T / 2, h / 2, WALL_T / 2], yaw: Math.atan2(-ez, ex), role: 'wall',
    };
  });
}

function build(def, i) {
  const f = frame(def.at, def.dir);
  const toXZ = ([u, v]) => {
    const [x, , z] = f.point(u, v);
    return [round(x), round(z)];
  };
  const poly = def.outline.map(toXZ);
  const wallTop = def.wallH ?? WALL_H;
  const us = def.outline.map(([u]) => u);
  const vs = def.outline.map(([, v]) => v);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  // Bahnplatte(n) in Bahnkoordinaten: das ganze Rechteck um den Umriss, an Gräben unterbrochen
  const cuts = [u0, ...(def.gaps ?? []).flat(), u1];
  const floors = [];
  for (let k = 0; k < cuts.length; k += 2) {
    const [a, b] = [cuts[k], cuts[k + 1]];
    const [x, , z] = f.point((a + b) / 2, (v0 + v1) / 2);
    floors.push({ c: [x, FLOOR / 2, z], half: [(b - a) / 2, FLOOR / 2, (v1 - v0) / 2], yaw: f.yaw, role: 'floor', u: [a, b] });
  }
  const hulls = (def.hulls ?? []).map((pts) => pts.map(([u, v, h]) => f.point(u, v, h).map(round)));
  // Hindernisse als Prisma (Keile): wirken wie Banden; Grundriss für die Prüfung beim Ablegen
  const stones = (def.stones ?? []).map(({ foot, h }) => ({
    pts: prism(foot, h).map(([u, v, hh]) => f.point(u, v, hh).map(round)),
    foot: foot.map(toXZ),
  }));
  const waves = (def.waves ?? []).map((w) => {
    const [x, , z] = f.point(w.u, (v0 + v1) / 2);
    return { c: [x, FLOOR + w.top - w.r, z], r: w.r, half: (v1 - v0) / 2, axis: f.n, u: w.u };
  });
  const mill = def.mill && { c: f.point(def.mill.u, 0, def.mill.h), axis: f.d, yaw: f.yaw, len: def.mill.len, width: def.mill.width, thick: def.mill.thick };
  const [cu, cv, ch = 0] = def.cup;
  const tee = f.point(0, 0);
  return {
    n: i,
    name: def.name,
    surface: def.surface,
    color: def.color,
    yaw: f.yaw,
    dir: f.d,
    side: f.n,
    poly,
    outline: def.outline,
    frame: f,
    wallTop,
    floors,
    walls: wallsAround(poly, wallTop),
    blocks: (def.blocks ?? []).map((b) => blockBox(f, b)),
    hulls,
    stones,
    waves,
    mill,
    gaps: def.gaps ?? [],
    tunnel: def.tunnel ?? null,
    tee: tee.map(round),
    cup: f.point(cu, cv, ch).map(round),
    path: def.path.map(toXZ),
  };
}

export const COURSE = DEFS.map(build);

// --- Hilfen für Regeln und Computer (rein) ---

// Liegt der Punkt (x, z) innerhalb der Bahn (Umriss) und nicht in einem Hindernis? Am Hindernis liegt die Ballmitte gut R
// vor der Kante (an einer Ecke schräg davor, ≥ 0,7 R je Achse) – deshalb zählt erst, was tiefer als R/2 hineinragt: alles,
// was die Physik erreichen kann, ist gültig, ein Ball mitten im Stein nicht.
export function inLane(hole, p) {
  return inPoly(hole.poly, p) && !hole.stones.some((s) => inPoly(s.foot, p)) && !hole.blocks.some((b) => inBox(b, p, R / 2));
}

// Grundriss eines gedrehten Quaders, um margin vergrößert
function inBox({ c, half, yaw }, [x, z], margin) {
  const [dx, dz] = [x - c[0], z - c[2]];
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return Math.abs(lx) < half[0] + margin && Math.abs(lz) < half[2] + margin;
}

function inPoly(p, [x, z]) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const segDist = ([px, pz], [ax, az], [bx, bz]) => {
  const [dx, dz] = [bx - ax, bz - az];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1e-12)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

// Abstand der Ballmitte zur nächsten Bande (Innenkante)
export function wallGap(hole, p) {
  return Math.min(...hole.poly.map((a, i) => segDist(p, a, hole.poly[(i + 1) % hole.poly.length])));
}

// Restweg zum Loch entlang des Laufwegs (Meter): Abstand zum Weg + Rest des Wegs ab dem nächsten Punkt darauf
export function toGo(hole, [x, z]) {
  const path = hole.path;
  let best = Infinity;
  let rest = 0;
  for (let i = path.length - 2; i >= 0; i--) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const [dx, dz] = [bx - ax, bz - az];
    const len = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len || 1e-12)));
    const off = Math.hypot(x - (ax + t * dx), z - (az + t * dz));
    const total = off * 1.5 + (1 - t) * len + rest;
    if (total < best) best = total;
    rest += len;
  }
  return best;
}

// Kamera je Bahn (room.js VIEWS): golfT1 … = hinter dem Abschlag mit Blick auf den Ball (er bleibt beim Folgen in der
// Bildmitte), golfO1 … = die ganze Bahn schräg von oben (seitlich versetzt).
// place = Grenzen der freien Kamera an der Anlage (camera.js)
export const PLACE = { at: [COURSE_AT[0] - 2, COURSE_AT[1]], pan: 13.5, cam: 16, yMax: 11, dist: 14 };
const world = ([x, y, z]) => [round(x + COURSE_AT[0]), round(y), round(z + COURSE_AT[1])];
export const teeView = (n) => `golfT${n + 1}`;
export const overView = (n) => `golfO${n + 1}`;
export const GOLF_VIEWS = Object.fromEntries(COURSE.flatMap((hole) => {
  const [x, , z] = hole.tee;
  const [dx, dz] = hole.dir;
  const [nx, nz] = hole.side;
  // Übersicht: von der rechten Seite der Bahn – der Abschlag liegt links im Bild, das Loch rechts (Seitenfeld rechts)
  const xs = hole.poly.map(([px]) => px);
  const zs = hole.poly.map(([, pz]) => pz);
  const [mx, mz] = [(Math.min(...xs) + Math.max(...xs)) / 2 + dx * 0.8, (Math.min(...zs) + Math.max(...zs)) / 2 + dz * 0.8];
  return [
    [teeView(hole.n), [world([x - dx * 3.4, FLOOR + 1.45, z - dz * 3.4]), world([x, FLOOR, z]), PLACE]],
    [overView(hole.n), [world([mx + nx * 4, FLOOR + 7.8, mz + nz * 4]), world([mx, FLOOR, mz]), PLACE]],
  ];
}));
GOLF_VIEWS.golf0 = GOLF_VIEWS.golf1 = GOLF_VIEWS[teeView(0)];
