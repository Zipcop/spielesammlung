// Kartenduell – Kartenbilder, selbst gezeichnet (Canvas 2D) – keine Bilddateien, kein three.js.
// Eigener Fantasy-Rahmen je Kartenart (Nico 20.10.2026): Monster Bronze (Normal-Monster sandfarben, Effekt-Monster
// kupfrig-dunkel), Zauber Türkis, Falle Weinrot. Oben Name mit Element-Edelstein (Sechseck), darunter Stufe als goldene
// Rauten, großes Bildfeld mit eigenem Motiv vor Element-Hintergrund, Typzeile, Pergament-Textfeld, ATK/DEF-Plaketten.
// Motive aus Bausteinen (part = schattierte Fläche, tube/taper = Glieder, Flügel, Augen, Flammen) zusammengesetzt.
// Deterministisch: Zufall nur aus rng(id) – jede Karte sieht immer gleich aus.
import { CARD } from './cards.js';

export const FACE = { w: 512, h: 716 }; // 63 × 88 mm
const IMG = { x: 40, y: 120, w: 432, h: 320 }; // Bildfeld ≈ 45 % der Höhe
const W = IMG.w;
const H = IMG.h;
const TAU = Math.PI * 2;

// ---------- Grundwerkzeug ----------

// Kleiner Zufallsgenerator (mulberry32), Startwert aus der Karten-id
function rng(id) {
  let s = 2166136261;
  for (const ch of String(id)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const tones = new Map();
// Farbe aufhellen (t > 0, Richtung Weiß) oder abdunkeln (t < 0, Richtung Schwarz)
function tone(hex, t) {
  if (hex[0] !== '#') return 'rgba(0,0,0,0.6)';
  const key = hex + t;
  let c = tones.get(key);
  if (!c) {
    const m = t < 0 ? 0 : 255;
    const a = Math.abs(t);
    c = `rgb(${rgbOf(hex).map((v) => Math.round(v + (m - v) * a)).join(',')})`;
    tones.set(key, c);
  }
  return c;
}
const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;

const paths = new Map();
const P = (d) => {
  let p = paths.get(d);
  if (!p) paths.set(d, (p = new Path2D(d)));
  return p;
};
const ell = (x, y, rx, ry, rot = 0) => {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, rot, 0, TAU);
  return p;
};
const poly = (pts) => {
  const p = new Path2D();
  for (let i = 0; i < pts.length; i += 2) p[i ? 'lineTo' : 'moveTo'](pts[i], pts[i + 1]);
  p.closePath();
  return p;
};
// Blatt/Feder: von (x, y) in Richtung ang, Länge len, halbe Breite w
function leafP(x, y, len, ang, w) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const mx = x + c * len * 0.5;
  const my = y + s * len * 0.5;
  const p = new Path2D();
  p.moveTo(x, y);
  p.quadraticCurveTo(mx - s * w * 1.6, my + c * w * 1.6, x + c * len, y + s * len);
  p.quadraticCurveTo(mx + s * w * 1.6, my - c * w * 1.6, x, y);
  return p;
}

function lin(g, x0, y0, x1, y1, cols) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
  return gr;
}
function rad(g, x, y, r0, r1, cols) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1);
  cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
  return gr;
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
// Zeichnen in eigenem Koordinatensystem: verschoben, gedreht, skaliert, gespiegelt
function at(g, x, y, s, fn, rot = 0, flip = false) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  g.scale(flip ? -s : s, s);
  fn();
  g.restore();
}

// Zustand des gerade gezeichneten Bildes: Grundmatrix und Lichtverlauf (Licht von oben links)
let S = null;

// Schattierte Fläche: Grundfarbe, dunkle Innenkante (Rundung), Licht von oben links, Umriss
function part(g, d, col, o = {}) {
  const p = typeof d === 'string' ? P(d) : d;
  g.fillStyle = col;
  g.fill(p);
  g.save();
  g.clip(p);
  const e = o.edge ?? 1;
  if (e) {
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.lineWidth = 18 * e;
    g.stroke(p);
    g.lineWidth = 7 * e;
    g.stroke(p);
  }
  const sh = o.shine ?? 1;
  if (sh) {
    const m = g.getTransform();
    g.setTransform(S.base);
    g.globalAlpha = sh;
    g.fillStyle = S.light;
    g.fillRect(0, 0, W, H);
    g.setTransform(m);
  }
  g.restore();
  const line = o.line ?? 2.5;
  if (line) {
    g.lineJoin = 'round';
    g.strokeStyle = o.ink ?? tone(col, -0.6);
    g.lineWidth = line;
    g.stroke(p);
  }
  return p;
}
// Fläche ohne Schattierung (Glanz, Muster)
function flat(g, d, col) {
  g.fillStyle = col;
  g.fill(typeof d === 'string' ? P(d) : d);
}
function line(g, d, col, w, cap = 'round') {
  g.lineCap = cap;
  g.lineJoin = 'round';
  g.strokeStyle = col;
  g.lineWidth = w;
  g.stroke(typeof d === 'string' ? P(d) : d);
}

// Rundes Glied (Arm, Bein, Ast): Umriss, Farbe, Schatten unten rechts, Glanz oben links
function tube(g, d, w, col, o = {}) {
  const p = typeof d === 'string' ? P(d) : d;
  line(g, p, o.ink ?? tone(col, -0.6), w + 5);
  line(g, p, col, w);
  g.save();
  g.translate(w * 0.16, w * 0.16);
  line(g, p, tone(col, -0.22), w * 0.5);
  g.translate(-w * 0.36, -w * 0.36);
  line(g, p, tone(col, 0.3), w * 0.26);
  g.restore();
}

// Spitz zulaufendes Glied entlang einer kubischen Kurve c = [x0,y0, x1,y1, x2,y2, x3,y3], Breite w0 → w1
function taper(g, c, w0, w1, col, o = {}) {
  const n = o.n ?? 20;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    pts.push([a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7], w0 + (w1 - w0) * t]);
  }
  g.lineCap = 'round';
  const pass = (color, f, ox) => {
    g.strokeStyle = color;
    for (let i = 1; i <= n; i++) {
      const [x0, y0, wa] = pts[i - 1];
      const [x1, y1] = pts[i];
      g.lineWidth = Math.max(0.5, f(wa));
      g.beginPath();
      g.moveTo(x0 + ox * wa, y0 + ox * wa);
      g.lineTo(x1 + ox * wa, y1 + ox * wa);
      g.stroke();
    }
  };
  pass(o.ink ?? tone(col, -0.6), (w) => w + 5, 0);
  pass(col, (w) => w, 0);
  pass(tone(col, -0.22), (w) => w * 0.45, 0.17);
  pass(o.hl ?? tone(col, 0.32), (w) => w * 0.22, -0.2);
  if (o.dots) {
    g.fillStyle = o.dots;
    for (let i = 2; i < n; i += 2) {
      const [x, y, w] = pts[i];
      g.beginPath();
      g.arc(x + w * 0.22, y + w * 0.22, w * 0.16, 0, TAU);
      g.fill();
    }
  }
  return pts;
}

// Weicher Lichtfleck
function glow(g, x, y, r, col, a = 1, add = false) {
  if (add) {
    g.save();
    g.globalCompositeOperation = 'lighter';
  }
  g.fillStyle = rad(g, x, y, 0, r, [rgba(col, a), rgba(col, a * 0.35), rgba(col, 0)]);
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  if (add) g.restore();
}
function shadow(g, x, y, rx, ry) {
  g.fillStyle = rad(g, x, y, 0, rx, ['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']);
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}
// Vierzackiger Funkelstern
function sparkle(g, x, y, r, col = '#ffffff') {
  glow(g, x, y, r * 1.6, col, 0.5, true);
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
}
function sparkles(g, r, n, x0, y0, x1, y1, col, size = 7) {
  for (let i = 0; i < n; i++) sparkle(g, x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), size * (0.4 + r() * 0.8), col);
}
// Glutfunken (hell, additiv)
function embers(g, r, n, x0 = 0, y0 = 0, x1 = W, y1 = H, col = '#ffa040') {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    const s = 1.5 + r() * 3;
    glow(g, x, y, s * 3, col, 0.7);
    g.fillStyle = '#fff1b0';
    g.beginPath();
    g.arc(x, y, s * 0.6, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Flamme: Fuß (x, y), Breite w, Höhe h, lean = Neigung der Spitze; drei Schichten, additiv
function flamePath(x, y, w, h, lean) {
  const p = new Path2D();
  p.moveTo(x - w / 2, y);
  p.bezierCurveTo(x - w / 2, y - h * 0.45, x - w * 0.12 + lean * 0.3, y - h * 0.62, x + lean, y - h);
  p.bezierCurveTo(x + w * 0.16 + lean * 0.3, y - h * 0.6, x + w / 2, y - h * 0.42, x + w / 2, y);
  p.bezierCurveTo(x + w / 2, y + w * 0.42, x - w / 2, y + w * 0.42, x - w / 2, y);
  return p;
}
function fire(g, x, y, w, h, lean = 0, add = true) {
  g.save();
  if (add) g.globalCompositeOperation = 'lighter';
  flat(g, flamePath(x, y, w, h, lean), rad(g, x, y - h * 0.2, 0, h, ['rgba(255,120,30,0.9)', 'rgba(230,50,10,0.75)', 'rgba(180,20,0,0)']));
  flat(g, flamePath(x, y + w * 0.05, w * 0.68, h * 0.72, lean * 0.7), rad(g, x, y - h * 0.15, 0, h * 0.7, ['rgba(255,210,80,0.95)', 'rgba(255,140,30,0.6)', 'rgba(255,100,0,0)']));
  flat(g, flamePath(x, y + w * 0.08, w * 0.36, h * 0.42, lean * 0.4), rad(g, x, y - h * 0.08, 0, h * 0.4, ['rgba(255,255,220,1)', 'rgba(255,230,140,0.7)', 'rgba(255,200,80,0)']));
  g.restore();
}
// Feueratem: Kette heller Bälle von (x0, y0) nach (x1, y1), wird breiter
function breath(g, x0, y0, x1, y1, w) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const r = 10 + w * t;
    g.fillStyle = rad(g, x, y, 0, r, ['rgba(255,250,200,0.55)', 'rgba(255,160,40,0.4)', 'rgba(220,50,0,0)']);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  g.restore();
}

// Auge: glühend (Monster) oder niedlich (rund mit Glanzpunkt)
function eye(g, x, y, r, col = '#ffd23a', kind = 'glow') {
  if (kind === 'cute') {
    flat(g, ell(x, y, r, r * 1.1), '#fffdf6');
    line(g, ell(x, y, r, r * 1.1), '#2a1a0e', r * 0.22);
    flat(g, ell(x + r * 0.12, y + r * 0.1, r * 0.66, r * 0.74), col);
    flat(g, ell(x + r * 0.15, y + r * 0.14, r * 0.36, r * 0.42), '#140a04');
    flat(g, ell(x - r * 0.12, y - r * 0.2, r * 0.22, r * 0.22), '#ffffff');
    return;
  }
  glow(g, x, y, r * 3.2, col, 0.55, true);
  flat(g, ell(x, y, r, r * 0.8), col);
  flat(g, ell(x, y, r * 0.55, r * 0.45), tone(col, 0.6));
  if (kind === 'slit') flat(g, ell(x, y, r * 0.18, r * 0.72), '#1a0a04');
}

// Fledermausflügel: Wurzel (0, 0), reicht nach oben links
const BAT = 'M0,0 L-30,-80 L-60,-130 L-150,-152 Q-120,-118 -172,-96 Q-128,-66 -162,-40 Q-114,-32 -108,6 Q-52,-6 0,0 Z';
function batWing(g, x, y, s, rot, col, flip = false) {
  at(g, x, y, s, () => {
    part(g, BAT, col, { line: 3, edge: 1.2 });
    const bone = tone(col, -0.25);
    tube(g, 'M0,0 L-30,-80 L-60,-130', 8, bone);
    tube(g, 'M-60,-130 L-150,-152 M-60,-130 L-172,-96 M-60,-130 L-162,-40 M-60,-130 L-108,6', 3.5, bone);
    part(g, 'M-62,-132 L-70,-150 L-56,-138 Z', '#eee0c0', { edge: 0, line: 1.5 });
  }, rot, flip);
}

// Federflügel: Wurzel (0, 0), reicht nach links; Schwungfedern außen, Deckfedern innen
function featherWing(g, x, y, s, rot, col, flip = false) {
  at(g, x, y, s, () => {
    for (let i = 9; i >= 0; i--) {
      const t = i / 9;
      const bx = -14 - t * 164;
      const by = -6 - t * 40 + t * t * 14;
      part(g, leafP(bx, by, 62 + t * 40, Math.PI * (0.56 + t * 0.4), 9), i % 2 ? col : tone(col, -0.1), { edge: 0.35, line: 1.6 });
      line(g, poly([bx, by, bx + Math.cos(Math.PI * (0.56 + t * 0.4)) * (50 + t * 34), by + Math.sin(Math.PI * (0.56 + t * 0.4)) * (50 + t * 34)]), tone(col, -0.35), 1.2);
    }
    part(g, 'M14,16 C-14,-30 -100,-64 -188,-54 C-150,-24 -86,6 -4,36 Z', tone(col, 0.16), { line: 2 });
    for (let i = 0; i < 6; i++) part(g, leafP(-16 - i * 26, -2 - i * 7, 34, Math.PI * 0.66, 7), tone(col, 0.06), { edge: 0.3, line: 1.2 });
  }, rot, flip);
}

// Insektenflügel (Fee): durchscheinend, mit Adern
function fairyWing(g, x, y, len, wid, rot, col) {
  at(g, x, y, 1, () => {
    const p = ell(len / 2, 0, len / 2, wid);
    flat(g, p, lin(g, 0, 0, len, 0, [rgba(col, 0.85), rgba(col, 0.45)]));
    line(g, p, tone(col, -0.45), 2.5);
    line(g, `M0,0 L${len * 0.95},0 M${len * 0.3},0 L${len * 0.7},${-wid * 0.7} M${len * 0.3},0 L${len * 0.7},${wid * 0.7}`, tone(col, -0.3), 1.4);
    flat(g, ell(len * 0.55, -wid * 0.35, len * 0.25, wid * 0.22), 'rgba(255,255,255,0.6)');
  }, rot);
}

// Zahnrad (Mitte x, y, Radius r, Zähne n)
function gearP(x, y, r, n, depth = 0.22) {
  const p = new Path2D();
  for (let i = 0; i < n * 4; i++) {
    const a = (i / (n * 4)) * TAU;
    const rr2 = i % 4 < 2 ? r : r * (1 - depth);
    p[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  p.closePath();
  return p;
}
function gear(g, x, y, r, n, col, rot = 0) {
  at(g, x, y, 1, () => {
    part(g, gearP(0, 0, r, n), col, { edge: 0.5 });
    part(g, ell(0, 0, r * 0.45, r * 0.45), tone(col, -0.15), { edge: 0.3 });
    flat(g, ell(0, 0, r * 0.16, r * 0.16), '#1a140c');
  }, rot);
}

// Stein/Felsen als Vieleck mit hellerer Oberkante
function rock(g, pts, col) {
  part(g, poly(pts), col, { edge: 0.8 });
}

// ---------- Figur von vorn (Mensch, Elf, Kobold …) ----------
// Füße bei (0, 0), Kopfmitte bei (0, −216). o: Farben, Kleidung, Armhaltung (Ellbogen, Hand), Zusatzteile
function figure(g, o) {
  const sx = o.wide ?? 1;
  const cloth = o.cloth ?? '#7a2a1e';
  const skin = o.skin ?? '#e5b48a';
  const sh = 42 * sx;
  const armL = o.armL ?? [[-58, -126], [-62, -78]];
  const armR = o.armR ?? [[58, -126], [62, -78]];
  o.back?.(g);
  if (o.cape) part(g, `M${-sh},-180 C${-sh - 28},-120 ${-sh - 48},-50 ${-sh - 54},0 L${sh + 54},0 C${sh + 48},-50 ${sh + 28},-120 ${sh},-180 Z`, o.cape);
  if (o.robe) {
    part(g, `M${-34 * sx},-112 C${-46 * sx},-70 ${-62 * sx},-30 ${-72 * sx},-2 C${-30 * sx},8 ${30 * sx},8 ${72 * sx},-2 C${62 * sx},-30 ${46 * sx},-70 ${34 * sx},-112 Z`, o.robe);
    if (o.trim) line(g, `M${-72 * sx},-4 C${-30 * sx},6 ${30 * sx},6 ${72 * sx},-4`, o.trim, 5);
  } else if (!o.noLegs) {
    const leg = o.legs ?? tone(cloth, -0.3);
    for (const s of [-1, 1]) tube(g, `M${s * 18 * sx},-104 L${s * 24 * sx},-16`, 26 * sx, leg);
    for (const s of [-1, 1]) part(g, `M${s * 12 * sx},-24 L${s * 36 * sx},-24 C${s * 46 * sx},-16 ${s * 46 * sx},0 ${s * 38 * sx},0 L${s * 10 * sx},0 Z`, o.boots ?? '#3a2616', { edge: 0.4 });
  }
  part(g, `M${-sh},-182 C${-sh - 6},-150 ${-36 * sx},-124 ${-34 * sx},-100 L${34 * sx},-100 C${36 * sx},-124 ${sh + 6},-150 ${sh},-182 C${18 * sx},-194 ${-18 * sx},-194 ${-sh},-182 Z`, o.body ?? cloth);
  o.chest?.(g);
  if (o.belt) part(g, `M${-36 * sx},-114 L${36 * sx},-114 L${36 * sx},-101 L${-36 * sx},-101 Z`, o.belt, { edge: 0.3, line: 2 });
  const sleeve = o.sleeve ?? o.body ?? cloth;
  for (const [s, a] of [[-1, armL], [1, armR]]) tube(g, `M${s * (sh - 8)},-172 L${a[0][0]},${a[0][1]} L${a[1][0]},${a[1][1]}`, 20 * sx, sleeve);
  if (o.pads) for (const s of [-1, 1]) part(g, `M${s * (sh - 26)},-190 C${s * (sh + 4)},-200 ${s * (sh + 22)},-182 ${s * (sh + 18)},-158 C${s * sh},-164 ${s * (sh - 18)},-168 ${s * (sh - 26)},-190 Z`, o.pads);
  const hands = { l: armL[1], r: armR[1] };
  o.hold?.(g, hands);
  for (const h of [hands.l, hands.r]) part(g, ell(h[0], h[1], 11, 11), o.hand ?? skin, { edge: 0.4, line: 2 });
  o.front?.(g, hands);
  g.save();
  g.translate(0, -186);
  g.scale(o.hs ?? 1, o.hs ?? 1);
  if (o.headFn) o.headFn(g);
  else head(g, o);
  g.restore();
}

// Kopf: Hals bei (0, 0), Kopfmitte (0, −30)
function head(g, o) {
  const skin = o.skin ?? '#e5b48a';
  if (o.hairBack) part(g, o.hairBack, o.hair);
  tube(g, 'M0,6 L0,-10', 18, skin);
  if (o.hood) part(g, 'M-36,-20 C-40,-70 -16,-82 0,-82 C16,-82 40,-70 36,-20 C30,6 -30,6 -36,-20 Z', o.hood);
  if (o.dark) {
    part(g, ell(0, -28, 19, 23), '#07040c', { edge: 0, shine: 0, line: 0 });
    for (const s of [-1, 1]) eye(g, s * 8, -32, 4, o.eyes ?? '#c060ff');
    return;
  }
  part(g, ell(0, -30, 23, 27), skin);
  for (const s of [-1, 1]) {
    flat(g, ell(s * 9, -32, 3.4, 4), '#24160c');
    flat(g, ell(s * 9 - 1, -33.5, 1.2, 1.2), '#ffffff');
    line(g, `M${s * 15},-41 L${s * 4},-39`, o.brow ?? tone(o.hair ?? '#4a2a14', -0.2), 2.6);
  }
  line(g, 'M0,-30 L-2,-21 L2,-20', tone(skin, -0.35), 2);
  line(g, 'M-7,-12 Q0,-9 7,-12', tone(skin, -0.45), 2);
  if (o.hairTop) part(g, o.hairTop, o.hair);
  if (o.beard) part(g, 'M-23,-28 C-25,-4 -14,14 0,18 C14,14 25,-4 23,-28 C16,-18 8,-16 0,-18 C-8,-16 -16,-18 -23,-28 Z', o.beard);
  o.headExtra?.(g);
}

// ---------- Drache (Seitenansicht, schaut nach rechts, Körpermitte bei 0,0) ----------
const DR = {
  body: 'M-75,15 C-78,-25 -30,-48 25,-42 C70,-36 92,-5 80,28 C68,58 10,66 -35,58 C-62,52 -74,38 -75,15 Z',
  belly: 'M-48,54 C-6,64 50,56 74,30 C80,18 82,6 80,-4 C70,28 26,44 -48,44 Z',
  neck: 'M28,-34 C40,-72 62,-102 92,-124 L114,-104 C90,-86 76,-58 72,-6 Z',
  head: 'M84,-126 C94,-146 124,-148 140,-134 L178,-122 C187,-118 187,-108 179,-105 L150,-99 C138,-90 110,-88 96,-98 C86,-104 80,-116 84,-126 Z',
  jaw: 'M98,-100 C118,-94 144,-94 170,-102 C162,-90 138,-82 112,-86 C104,-88 98,-94 98,-100 Z',
  mouth: 'M98,-100 L178,-108 L168,-80 Z',
  horn1: 'M96,-138 C84,-162 66,-174 44,-178 C64,-162 76,-148 86,-128 Z',
  horn2: 'M112,-144 C106,-164 94,-176 78,-184 C94,-168 100,-154 100,-140 Z',
  legF: 'M48,28 C40,52 46,70 56,80 L86,84 C88,77 80,73 70,71 C66,60 70,46 76,28 Z',
  legB: 'M-62,8 C-90,22 -88,58 -66,70 C-70,76 -72,82 -64,86 L-30,86 C-30,80 -38,77 -46,74 C-30,60 -26,38 -34,12 Z',
  tail: 'M-70,22 C-110,46 -150,44 -178,18 C-186,10 -196,6 -206,8 C-196,18 -188,30 -176,40 C-146,66 -104,68 -60,50 Z',
  spade: 'M-200,14 L-232,-8 L-222,18 L-236,36 Z',
};
const SPIKES = [[-58, -30, -0.9], [-32, -42, -0.5], [-4, -47, -0.25], [24, -46, 0], [42, -62, 0.25], [56, -86, 0.4], [72, -106, 0.55]];

function dragonHead(g, col, o = {}) {
  const horn = o.horn ?? '#eadcb8';
  part(g, DR.horn2, tone(horn, -0.25), { edge: 0.5 });
  if (o.jaw) {
    part(g, DR.mouth, '#4a0c08', { edge: 0.4 });
    at(g, 100, -100, 1, () => {
      g.rotate(o.jaw);
      g.translate(-100, 100);
      part(g, DR.jaw, tone(col, -0.1));
      for (let x = 120; x <= 160; x += 13) part(g, `M${x},-95 L${x + 5},-104 L${x + 10},-95 Z`, '#fff6e0', { edge: 0, line: 1 });
    });
  } else part(g, DR.jaw, tone(col, -0.1));
  part(g, DR.head, col);
  if (o.jaw) for (let x = 124; x <= 168; x += 12) part(g, `M${x},-101 L${x + 4},-91 L${x + 8},-101 Z`, '#fff6e0', { edge: 0, line: 1 });
  part(g, DR.horn1, horn, { edge: 0.5 });
  line(g, 'M118,-136 C126,-140 136,-136 142,-130', tone(col, -0.5), 3);
  eye(g, 128, -124, 6, o.eye ?? '#ffe066', 'slit');
  flat(g, ell(172, -114, 3, 2), '#1a0a04');
}

function dragon(g, o) {
  const col = o.col;
  const wing = o.wing ?? tone(col, -0.2);
  const far = tone(col, -0.3);
  const ws = o.ws ?? 1;
  if (o.spread) batWing(g, 40, -46, 1.05 * ws, 0.25, tone(wing, -0.18), true);
  else batWing(g, 16, -46, 0.9 * ws, 0.38, tone(wing, -0.22));
  if (!o.fly) at(g, 14, -4, 1, () => {
    part(g, DR.legF, far);
    part(g, DR.legB, far);
  });
  part(g, DR.tail, col);
  part(g, DR.spade, tone(col, -0.15), { edge: 0.4 });
  for (const [x, y, a] of SPIKES) at(g, x, y, 1, () => part(g, 'M-8,6 L-2,-16 L8,6 Z', o.spike ?? tone(col, -0.35), { edge: 0.3, line: 1.5 }), a - 0.5);
  part(g, DR.body, col);
  const belly = o.belly ?? tone(col, 0.42);
  const bp = part(g, DR.belly, belly, { edge: 0.5 });
  g.save();
  g.clip(bp);
  for (let x = -40; x < 80; x += 14) line(g, `M${x},30 L${x - 6},66`, rgba('#000000', 0.22), 2);
  g.restore();
  if (o.fly) {
    part(g, 'M-50,40 C-70,60 -96,70 -118,66 C-100,58 -86,48 -72,30 Z', col);
    part(g, 'M50,40 C44,58 30,70 12,74 C24,62 34,50 38,34 Z', col);
  } else {
    part(g, DR.legB, col);
    part(g, DR.legF, col);
    for (const x of [-64, -52, -40, 58, 70, 82]) part(g, `M${x},84 L${x + 4},92 L${x + 8},84 Z`, '#efe4c8', { edge: 0, line: 1 });
  }
  part(g, DR.neck, col);
  const np = P(DR.neck);
  g.save();
  g.clip(np);
  for (let i = 0; i < 6; i++) line(g, `M${72 - i * 3},${-14 - i * 16} L${100 - i * 4},${-30 - i * 14}`, rgba('#000000', 0.18), 2);
  g.restore();
  batWing(g, -2, -40, 1.05 * ws, o.spread ? -0.1 : 0, wing);
  dragonHead(g, col, o);
}

// Schlangenkopf (Seeschlange, Leviathan, Wyrm), schaut nach links, Mitte (0, 0)
function serpentHead(g, col, o = {}) {
  const fin = o.fin ?? tone(col, 0.25);
  part(g, 'M10,-20 C30,-60 60,-70 80,-66 C64,-50 58,-34 52,-14 Z', fin, { edge: 0.5 });
  part(g, 'M-6,-26 C6,-56 26,-72 44,-76 C34,-56 30,-40 28,-22 Z', tone(fin, -0.12), { edge: 0.5 });
  if (o.open) {
    part(g, 'M-70,6 L20,0 L-56,40 Z', '#3a0a10', { edge: 0.3 });
    part(g, 'M-58,30 C-30,34 0,26 22,10 C18,32 -8,48 -50,46 Z', tone(col, -0.12));
    for (let x = -50; x < 6; x += 12) part(g, `M${x},${33 - (x + 50) * 0.18} L${x + 5},${22 - (x + 50) * 0.18} L${x + 10},${31 - (x + 50) * 0.18} Z`, '#fff8e8', { edge: 0, line: 1 });
  }
  part(g, 'M-78,0 C-80,-14 -60,-28 -30,-32 C0,-36 30,-28 40,-6 C46,10 34,24 10,24 L-44,18 C-62,16 -78,12 -78,0 Z', col);
  if (o.open) for (let x = -66; x < 0; x += 12) part(g, `M${x},${12 + (x + 66) * 0.12} L${x + 5},${24 + (x + 66) * 0.12} L${x + 10},${13 + (x + 66) * 0.12} Z`, '#fff8e8', { edge: 0, line: 1 });
  line(g, 'M-40,-26 C-30,-34 -14,-34 -4,-26', tone(col, -0.5), 3);
  eye(g, -20, -18, 7, o.eye ?? '#9fffe8', 'slit');
  flat(g, ell(-70, -8, 3, 2), '#081016');
}

// ---------- Hintergründe ----------
function vgrad(g, cols) {
  g.fillStyle = lin(g, 0, 0, 0, H, cols);
  g.fillRect(0, 0, W, H);
}
function ridge(g, r, base, amp, col, step) {
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W + step; x += step) g.lineTo(x, base - r() * amp);
  g.lineTo(W, H);
  g.closePath();
  g.fillStyle = col;
  g.fill();
}
function stars(g, r, n, yMax = H * 0.7) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.6})`;
    g.beginPath();
    g.arc(r() * W, r() * yMax, 0.6 + r() * 1.4, 0, TAU);
    g.fill();
  }
}
function cloud(g, x, y, s, col = '#ffffff', a = 0.85) {
  for (const [dx, dy, rr2] of [[-40, 6, 26], [-14, -10, 34], [20, -4, 30], [46, 8, 22], [0, 12, 26]]) {
    g.fillStyle = rad(g, x + dx * s, y + dy * s, 0, rr2 * s, [rgba(col, a), rgba(col, a * 0.8), rgba(col, 0)]);
    g.beginPath();
    g.arc(x + dx * s, y + dy * s, rr2 * s, 0, TAU);
    g.fill();
  }
}
function rays(g, x, y, n, col, a, r0 = 0) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = rgba(col, a);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU + r0;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, 600, a0, a0 + TAU / n / 2);
    g.closePath();
    g.fill();
  }
  g.restore();
}
function trees(g, r, n, y, h, col) {
  for (let i = 0; i < n; i++) {
    const x = (i + r() * 0.6) * (W / n);
    const th = h * (0.7 + r() * 0.5);
    g.fillStyle = col;
    g.fillRect(x - 3, y - th * 0.4, 6, th * 0.4 + 10);
    g.beginPath();
    g.ellipse(x, y - th * 0.55, th * 0.28, th * 0.4, 0, 0, TAU);
    g.fill();
  }
}
function pines(g, r, n, y, h, col) {
  g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = (i + r() * 0.7) * (W / n);
    const th = h * (0.7 + r() * 0.5);
    g.beginPath();
    g.moveTo(x, y - th);
    g.lineTo(x + th * 0.28, y);
    g.lineTo(x - th * 0.28, y);
    g.closePath();
    g.fill();
  }
}
function bubbles(g, r, n) {
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * H;
    const s = 2 + r() * 6;
    line(g, ell(x, y, s, s), 'rgba(210,245,255,0.45)', 1.4);
    flat(g, ell(x - s * 0.35, y - s * 0.35, s * 0.25, s * 0.25), 'rgba(255,255,255,0.6)');
  }
}
function waterRays(g, r) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const x = 40 + r() * (W - 80);
    const w = 18 + r() * 30;
    g.fillStyle = lin(g, 0, 0, 0, H, ['rgba(190,240,255,0.16)', 'rgba(190,240,255,0)']);
    g.beginPath();
    g.moveTo(x - w / 2, 0);
    g.lineTo(x + w / 2, 0);
    g.lineTo(x + w * 1.6 - 60, H);
    g.lineTo(x - w * 1.2 - 60, H);
    g.closePath();
    g.fill();
  }
  g.restore();
}
function seaFloor(g, r, col = '#0d2a30') {
  g.beginPath();
  g.moveTo(0, H);
  for (let x = 0; x <= W; x += 24) g.lineTo(x, 292 + Math.sin(x * 0.03) * 6 + r() * 4);
  g.lineTo(W, H);
  g.closePath();
  g.fillStyle = col;
  g.fill();
}
function magicCircle(g, x, y, rx, ry, col, a) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.strokeStyle = rgba(col, a);
  g.lineWidth = 2.5;
  for (const k of [1, 0.84, 0.5]) {
    g.beginPath();
    g.arc(0, 0, rx * k, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a0) * rx * 0.86, Math.sin(a0) * rx * 0.86);
    g.lineTo(Math.cos(a0) * rx * (i % 2 ? 0.94 : 0.98), Math.sin(a0) * rx * (i % 2 ? 0.94 : 0.98));
    g.stroke();
  }
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a0 = (i / 6) * TAU - Math.PI / 2;
    g[i ? 'lineTo' : 'moveTo'](Math.cos(a0) * rx * 0.84, Math.sin(a0) * rx * 0.84);
  }
  g.stroke();
  g.restore();
}

// Hintergrund je Element bzw. Szene; Licht = Farbe des Streiflichts auf den Figuren
const BGS = {
  feuer: ['255,190,120', (g, r) => {
    vgrad(g, ['#2a0604', '#6a1406', '#b8380c', '#ee7a26']);
    glow(g, W / 2, H + 30, 300, '#ffb347', 0.5);
    ridge(g, r, 236, 50, '#4a1008', 32);
    ridge(g, r, 272, 26, '#2a0804', 24);
    embers(g, r, 20);
  }],
  asche: ['255,175,130', (g, r) => {
    vgrad(g, ['#1a1212', '#3a2522', '#70392a', '#b0582e']);
    ridge(g, r, 262, 34, '#2a1612', 30);
    for (let i = 0; i < 26; i++) flat(g, ell(r() * W, r() * H, 1.5 + r() * 2.5, 1 + r()), 'rgba(200,190,185,0.35)');
    embers(g, r, 14);
  }],
  wasser: ['170,230,255', (g, r) => {
    vgrad(g, ['#13658a', '#0b3d60', '#062440', '#03111f']);
    waterRays(g, r);
    bubbles(g, r, 14);
    seaFloor(g, r);
  }],
  tiefsee: ['120,190,255', (g, r) => {
    vgrad(g, ['#062436', '#031422', '#020b14', '#01060b']);
    for (let i = 0; i < 40; i++) flat(g, ell(r() * W, r() * H, 1 + r() * 1.5, 1 + r() * 1.5), 'rgba(180,230,255,0.25)');
    bubbles(g, r, 6);
  }],
  meer: ['210,230,255', (g, r) => {
    g.fillStyle = lin(g, 0, 0, 0, 176, ['#1a2440', '#3e5478', '#b88a6a']);
    g.fillRect(0, 0, W, 176);
    glow(g, 300, 176, 160, '#ffc48a', 0.4);
    g.fillStyle = lin(g, 0, 176, 0, H, ['#2a5878', '#123450', '#081a2c']);
    g.fillRect(0, 176, W, H - 176);
    for (let i = 0; i < 18; i++) {
      const y = 182 + r() * 120;
      const x = r() * W;
      line(g, `M${x - 20},${y} Q${x},${y - 4} ${x + 20},${y}`, 'rgba(200,230,255,0.25)', 1.5);
    }
  }],
  erde: ['255,245,200', (g, r) => {
    vgrad(g, ['#d5e3a2', '#90b05a', '#4c6c2c', '#2a3a17']);
    glow(g, 110, 30, 180, '#fff6c8', 0.5);
    trees(g, r, 9, 230, 120, 'rgba(70,104,48,0.8)');
    trees(g, r, 7, 262, 150, 'rgba(40,66,28,0.9)');
    g.fillStyle = lin(g, 0, 268, 0, H, ['#4a3a1c', '#2a2010']);
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, 280);
    g.quadraticCurveTo(W / 2, 258, W, 284);
    g.lineTo(W, H);
    g.fill();
    for (let i = 0; i < 22; i++) {
      const x = r() * W;
      const y = 280 + r() * 36;
      line(g, `M${x},${y} l-4,-10 M${x},${y} l1,-12 M${x},${y} l5,-9`, 'rgba(120,160,60,0.8)', 1.6);
    }
  }],
  wind: ['255,255,255', (g, r) => {
    vgrad(g, ['#3f97d4', '#8fc8ea', '#d4ecf0', '#eef6e4']);
    glow(g, 90, 40, 140, '#ffffff', 0.5);
    cloud(g, 70, 70, 1.1);
    cloud(g, 330, 50, 0.9);
    cloud(g, 380, 210, 0.8, '#ffffff', 0.6);
    g.fillStyle = 'rgba(140,190,140,0.8)';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, 290);
    g.quadraticCurveTo(140, 262, 260, 286);
    g.quadraticCurveTo(360, 300, W, 280);
    g.lineTo(W, H);
    g.fill();
    for (let i = 0; i < 6; i++) {
      const x = r() * W * 0.8;
      const y = 40 + r() * 220;
      line(g, `M${x},${y} C${x + 60},${y - 10} ${x + 120},${y + 6} ${x + 150},${y - 8} c10,-6 6,-20 -6,-16`, 'rgba(255,255,255,0.55)', 2 + r() * 2);
    }
  }],
  licht: ['255,250,215', (g) => {
    g.fillStyle = rad(g, W / 2, H * 0.42, 0, 300, ['#fffdf0', '#fbe8a6', '#e8b850', '#9a6a1c']);
    g.fillRect(0, 0, W, H);
    rays(g, W / 2, H * 0.42, 18, '#ffffff', 0.12);
  }],
  finster: ['200,160,255', (g, r) => {
    vgrad(g, ['#07030f', '#1c0b30', '#34154c', '#4a1f5e']);
    stars(g, r, 40);
    for (let i = 0; i < 4; i++) flat(g, ell(r() * W, 180 + r() * 120, 120 + r() * 80, 18 + r() * 14), rad(g, 0, 0, 0, 1, ['rgba(150,90,210,0.12)', 'rgba(150,90,210,0.12)']));
    ridge(g, r, 286, 18, '#140820', 36);
  }],
  nacht: ['190,210,255', (g, r) => {
    vgrad(g, ['#050b1e', '#11234a', '#25416f', '#3c5a86']);
    stars(g, r, 50);
  }],
  magie: ['200,255,245', (g, r) => {
    g.fillStyle = rad(g, W / 2, H / 2, 0, 290, ['#bdfff2', '#56d0c2', '#177878', '#052e34']);
    g.fillRect(0, 0, W, H);
    magicCircle(g, W / 2, H / 2, 150, 150, '#e8fff8', 0.22);
    sparkles(g, r, 10, 0, 0, W, H, '#e8fffa', 6);
  }],
  falle: ['255,180,200', (g, r) => {
    g.fillStyle = rad(g, W / 2, H * 0.45, 0, 300, ['#8a2a40', '#5a1226', '#2e0712', '#14030a']);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      let x = r() * W;
      let y = r() * H;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) g.lineTo((x += (r() - 0.5) * 60), (y += (r() - 0.5) * 60));
      g.strokeStyle = 'rgba(255,120,150,0.12)';
      g.lineWidth = 2;
      g.stroke();
    }
  }],
  sturm: ['210,220,255', (g, r) => {
    vgrad(g, ['#0e1220', '#222a3e', '#3a4560', '#55607c']);
    for (let i = 0; i < 6; i++) cloud(g, r() * W, 20 + r() * 50, 1.2 + r() * 0.6, '#151a28', 0.9);
    ridge(g, r, 288, 16, '#1a1f2c', 40);
  }],
};

// ---------- Motive (Bildkoordinaten 0 … 432 × 0 … 320) ----------
const MOTIFS = {
  // --- Glut (Feuer) ---
  g01: ['feuer', (g, r) => { // Glutwelpe: kleiner Drache, niest Funken
    shadow(g, 216, 294, 110, 12);
    at(g, 216, 196, 1, () => {
      const c = '#e2582a';
      batWing(g, -36, -20, 0.44, 0.3, '#b03a1c');
      batWing(g, 36, -20, 0.44, -0.3, '#b03a1c', true);
      taper(g, [40, 84, 110, 100, 142, 64, 120, 30], 24, 8, c);
      part(g, 'M116,34 L106,8 L132,22 Z', '#b03a1c', { edge: 0.3 });
      part(g, 'M-58,82 C-74,30 -54,-22 -8,-30 C36,-36 62,2 62,42 C62,72 40,94 0,94 C-30,94 -54,92 -58,82 Z', c);
      const bp = part(g, 'M-30,88 C-40,52 -26,12 4,2 C32,8 40,44 32,80 C20,92 -14,94 -30,88 Z', '#f7c66e', { edge: 0.5 });
      g.save();
      g.clip(bp);
      for (const y of [24, 42, 60, 78]) line(g, `M-40,${y} Q4,${y + 8} 44,${y}`, 'rgba(120,60,10,0.35)', 2);
      g.restore();
      for (const s of [-1, 1]) {
        part(g, ell(s * 40, 90, 25, 11), c);
        for (const k of [-10, 0, 10]) part(g, ell(s * 40 + k, 99, 3, 4), '#fff1d0', { edge: 0, line: 1 });
      }
      tube(g, 'M-38,8 C-48,28 -38,44 -24,50', 16, c);
      tube(g, 'M40,6 C50,26 42,42 28,50', 16, c);
      for (const s of [-1, 1]) part(g, `M${s * 60},-92 L${s * 90},-108 L${s * 76},-84 L${s * 96},-74 L${s * 64},-66 Z`, '#f7a64e', { edge: 0.4 });
      part(g, 'M-64,-78 C-68,-124 -30,-144 4,-144 C44,-144 72,-120 68,-80 C66,-50 36,-36 2,-36 C-36,-36 -62,-50 -64,-78 Z', c);
      for (const s of [-1, 1]) part(g, `M${s * 34},-130 C${s * 46},-152 ${s * 40},-168 ${s * 28},-176 C${s * 28},-158 ${s * 20},-146 ${s * 16},-136 Z`, '#f3e2b4', { edge: 0.4 });
      part(g, ell(2, -62, 36, 21), '#f08a50', { edge: 0.5 });
      for (const s of [-1, 1]) flat(g, ell(2 + s * 13, -66, 4, 3), '#4a1406');
      for (const s of [-1, 1]) {
        line(g, `M${s * 28 - 14},-98 Q${s * 28},-110 ${s * 28 + 14},-98`, '#3a1206', 4.5);
        glow(g, s * 46, -74, 12, '#ff7a8a', 0.5);
      }
      line(g, 'M-10,-50 Q2,-42 14,-50', '#4a1406', 3);
    });
    // Funkenschauer aus der Nase
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      const a = -0.4 + r() * 1.4;
      const d = 30 + r() * 120;
      const x = 232 + Math.cos(a) * d;
      const y = 132 + Math.sin(a) * d * 0.7;
      if (i % 3) sparkle(g, x, y, 4 + r() * 6, '#ffe08a');
      else glow(g, x, y, 8, '#ffa040', 0.9);
    }
    g.restore();
  }],
  g02: ['feuer', (g, r) => { // Funkenechse: Echse mit Funkenkamm
    rock(g, [0, 320, 0, 286, 60, 270, 150, 262, 250, 266, 340, 258, 432, 278, 432, 320], '#4a2418');
    at(g, 222, 238, 1.4, () => {
      const c = '#c63c1c';
      part(g, 'M-55,-12 C-110,-15 -150,-30 -150,-58 C-150,-74 -128,-80 -120,-66 C-136,-60 -136,-44 -118,-34 C-95,-20 -75,-10 -50,8 Z', c);
      tube(g, 'M-30,-4 L-14,10 L-22,24', 10, tone(c, -0.3));
      tube(g, 'M56,-6 L72,8 L66,22', 10, tone(c, -0.3));
      part(g, 'M-62,-8 C-50,-32 20,-36 62,-24 C82,-18 92,-8 90,4 C72,14 0,16 -60,8 Z', c);
      part(g, 'M70,-24 C84,-40 120,-38 142,-24 C150,-18 148,-8 140,-6 C120,-2 95,0 78,0 Z', c);
      line(g, 'M96,-8 C110,-6 126,-8 140,-10', tone(c, -0.55), 2);
      eye(g, 112, -24, 5, '#ffe14a', 'slit');
      tube(g, 'M-36,2 C-50,12 -56,20 -48,32', 11, c);
      tube(g, 'M50,2 C40,14 44,24 56,32', 11, c);
      for (const [x, y] of [[-54, 34], [62, 34]]) for (const k of [-6, 0, 6]) tube(g, `M${x},${y} l${k},6`, 3, c);
      for (let i = 0; i < 9; i++) flat(g, ell(-50 + i * 14, -12 + (i % 2) * 6, 4, 3), 'rgba(255,214,90,0.8)');
      for (let i = 0; i < 10; i++) fire(g, -50 + i * 13, -26 - Math.sin(i * 0.4) * 5, 9, 14 + (i % 3) * 6, -3);
    });
    embers(g, r, 14, 120, 40, 360, 200, '#ffd050');
  }],
  g03: ['asche', (g, r) => { // Aschefuchs: grauer Fuchs, Schwanzspitze glüht
    shadow(g, 210, 296, 130, 12);
    at(g, 205, 204, 1, () => {
      const c = '#8e8580';
      const tail = part(g, 'M-62,-2 C-122,8 -172,-22 -176,-82 C-178,-112 -160,-132 -140,-128 C-150,-100 -140,-60 -100,-40 C-80,-30 -62,-28 -46,-24 Z', c);
      g.save();
      g.clip(tail);
      glow(g, -158, -118, 60, '#ff7a20', 0.95, true);
      g.restore();
      fire(g, -152, -120, 26, 44, -6);
      for (const [a, b] of [[-46, 18], [44, 18]]) tube(g, `M${a},${b} L${a - 4 + (a > 0 ? 6 : 0)},60 L${a + 2},90`, 11, tone(c, -0.3));
      part(g, 'M-72,4 C-72,-26 -30,-36 10,-33 C46,-31 72,-21 74,4 C76,28 40,38 0,36 C-40,36 -72,30 -72,4 Z', c);
      part(g, 'M46,-26 C72,-16 80,10 68,30 C58,20 50,4 46,-26 Z', '#d8d2ca', { edge: 0.4 });
      part(g, 'M48,-28 C54,-54 70,-70 92,-72 C108,-73 118,-64 124,-56 L156,-44 C160,-41 158,-36 152,-35 L120,-30 C104,-22 80,-16 62,-8 Z', c);
      part(g, 'M110,-38 C128,-36 142,-35 152,-35 L120,-29 C112,-30 108,-34 110,-38 Z', '#e8e2da', { edge: 0.2 });
      part(g, 'M92,-72 L106,-102 L112,-66 Z', tone(c, -0.3), { edge: 0.4 });
      part(g, 'M76,-68 L84,-104 L100,-72 Z', c, { edge: 0.4 });
      flat(g, poly([82, -72, 85, -94, 94, -73]), '#3a2a26');
      eye(g, 106, -57, 4.5, '#ff8a2a', 'slit');
      flat(g, ell(156, -40, 4, 3.5), '#1a1210');
      for (const [a, b, c2] of [[-52, 20, 'M-56,60 C-60,72 -60,82 -54,92'], [46, 22, 'M50,60 C52,72 54,82 52,92']]) {
        tube(g, `M${a},${b} C${a - 6},44 ${a - 8},62 ${a - 2},92`, 12, c);
        tube(g, c2, 12, '#2e2624');
      }
      for (let i = 0; i < 7; i++) line(g, `M${-50 + i * 14},${-24 + (i % 2) * 4} l8,6`, 'rgba(60,50,48,0.5)', 2);
    });
    embers(g, r, 10, 20, 60, 160, 200);
  }],
  g04: ['feuer', (g, r) => { // Schmiedeknecht: Schmied mit Hammer am Amboss
    shadow(g, 260, 300, 110, 12);
    at(g, 262, 302, 0.95, () => figure(g, {
      wide: 1.2, cloth: '#8c2f1e', skin: '#d99a6c', legs: '#4a3020', belt: '#3a2010',
      chest: (g2) => part(g2, 'M-32,-164 L32,-164 L44,-40 L-44,-40 Z', '#6b4524', { edge: 0.6 }),
      armR: [[76, -196], [64, -246]], armL: [[-64, -128], [-96, -100]],
      hold: (g2) => {
        tube(g2, 'M64,-230 L60,-300', 10, '#7a5230');
        part(g2, 'M30,-318 L94,-318 L98,-290 L26,-290 Z', '#5a5a64', { edge: 0.6 });
        tube(g2, 'M-96,-100 L-150,-70', 6, '#4a4a52');
      },
      hair: '#3a2010', beard: '#3a2010',
      headExtra: (g2) => line(g2, 'M-20,-50 Q0,-60 20,-50', 'rgba(255,255,255,0.35)', 4),
    }));
    part(g, 'M54,222 L176,222 C174,236 154,240 144,244 L144,262 L164,288 L70,288 L92,262 L92,244 C80,240 60,236 54,222 Z', '#3c3c46');
    part(g, 'M56,222 C34,222 20,228 10,238 C28,238 46,238 66,236 Z', '#33333c', { edge: 0.4 });
    flat(g, P('M60,222 L172,222 L170,227 L62,227 Z'), 'rgba(255,255,255,0.25)');
    glow(g, 116, 216, 50, '#ffb040', 0.9, true);
    part(g, 'M84,210 L150,210 C156,210 156,220 150,220 L84,220 Z', '#ffcc60', { edge: 0, shine: 0, ink: '#b84a10' });
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * (0.15 + r() * 0.7);
      const d = 20 + r() * 80;
      const x = 118 + Math.cos(a) * d;
      const y = 210 + Math.sin(a) * d;
      line(g, `M${x},${y} l${Math.cos(a) * 8},${Math.sin(a) * 8}`, '#ffe08a', 2.5);
    }
    g.restore();
  }],
  g05: ['feuer', (g) => { // Lavagolem: Steinriese mit glühenden Rissen
    shadow(g, 216, 300, 150, 14);
    const c = '#4e3c36';
    for (const f of [1, -1]) {
      const X = (x) => (f > 0 ? x : 432 - x);
      rock(g, [X(150), 302, X(158), 232, X(206), 226, X(202), 302], tone(c, -0.1));
    }
    rock(g, [120, 120, 162, 82, 270, 80, 312, 118, 300, 202, 262, 240, 172, 240, 132, 202], c);
    for (const f of [1, -1]) {
      const X = (x) => (f > 0 ? x : 432 - x);
      rock(g, [X(124), 116, X(92), 140, X(78), 212, X(96), 262, X(134), 262, X(140), 214, X(152), 160], tone(c, 0.05));
      rock(g, [X(80), 256, X(138), 256, X(146), 296, X(76), 296], tone(c, -0.05));
    }
    rock(g, [188, 92, 196, 56, 238, 54, 248, 90, 232, 104, 202, 104], tone(c, 0.08));
    const cracks = [
      'M216,100 L208,130 L222,150 L210,182 L226,214', 'M160,110 L180,140 L170,170', 'M270,104 L258,140 L276,172 L264,206',
      'M100,150 L112,184 L102,222', 'M332,150 L320,184 L330,222', 'M176,240 L182,270 L174,300', 'M256,240 L250,272 L258,300',
    ];
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const d of cracks) {
      line(g, d, 'rgba(255,90,10,0.35)', 12);
      line(g, d, '#ff8a20', 4.5);
      line(g, d, '#fff0a0', 1.6);
    }
    glow(g, 216, 160, 46, '#ff7a10', 0.7);
    g.restore();
    for (const x of [206, 226]) eye(g, x, 80, 5, '#ffcc30');
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const x of [96, 124, 308, 336]) line(g, `M${x},296 q-3,10 0,18`, '#ff8a20', 4);
    g.restore();
  }],
  g06: ['feuer', (g, r) => { // Flammenschwinge: fliegender Feuerdrache
    at(g, 236, 200, 0.86, () => {
      for (let i = 0; i < 4; i++) at(g, -210 - i * 26, 14 + i * 4, 1 - i * 0.15, () => fire(g, 0, 0, 34, 70), -1.45);
      dragon(g, { col: '#d8481e', wing: '#f08a2a', fly: true, spread: true, ws: 1.1, spike: '#ffcc60' });
    }, -0.16);
    embers(g, r, 18, 0, 0, W, H, '#ffd060');
  }],
  g07: ['feuer', (g, r) => { // Glutpriesterin: Priesterin mit Flammenstab
    shadow(g, 216, 300, 90, 10);
    at(g, 216, 302, 0.98, () => figure(g, {
      robe: '#9a2416', trim: '#f0c050', cloth: '#b8321c', skin: '#e8b88a', belt: '#f0c050', cape: '#5a120c',
      hair: '#5a1a0e',
      hairBack: 'M-24,-52 C-36,-30 -38,10 -30,36 C-18,42 18,42 30,36 C38,10 36,-30 24,-52 Z',
      hairTop: 'M-25,-36 C-26,-58 -10,-62 0,-62 C10,-62 26,-58 25,-36 C18,-48 8,-50 0,-48 C-8,-50 -18,-48 -25,-36 Z',
      headExtra: (g2) => {
        line(g2, 'M-22,-50 Q0,-58 22,-50', '#f0c050', 4);
        part(g2, 'M-6,-56 L0,-66 L6,-56 L0,-50 Z', '#ff5030', { edge: 0, line: 1.5, ink: '#7a2010' });
      },
      armL: [[-62, -130], [-70, -120]], armR: [[72, -170], [86, -222]],
      hold: (g2) => {
        tube(g2, 'M-70,-20 L-70,-270', 8, '#6a3a1a');
        part(g2, 'M-84,-270 L-56,-270 L-62,-252 L-78,-252 Z', '#f0c050', { edge: 0.3 });
      },
    }));
    fire(g, 147, 40, 30, 60, 4);
    glow(g, 300, 86, 46, '#ffa030', 0.8, true);
    fire(g, 300, 94, 36, 56, 2);
    embers(g, r, 12, 60, 20, 380, 220);
  }],
  g08: ['feuer', (g) => { // Feuerspeier: Drache spuckt Feuer
    rock(g, [10, 320, 30, 286, 120, 276, 240, 282, 270, 320], '#3a1208');
    at(g, 150, 210, 0.78, () => dragon(g, { col: '#9a2a1a', wing: '#7a1e12', jaw: 0.42, belly: '#d8925a' }));
    breath(g, 292, 132, 430, 176, 70);
  }],
  g09: ['feuer', (g, r) => { // Vulkanwyrm: Wurm steigt aus dem Vulkan
    part(g, 'M0,320 L130,166 L180,150 L250,152 L300,170 L432,320 Z', '#2c1410', { edge: 0.6 });
    glow(g, 214, 150, 90, '#ff8a20', 0.9, true);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const d of ['M190,154 C180,200 150,240 140,320', 'M232,154 C246,210 270,250 300,320']) {
      line(g, d, 'rgba(255,100,20,0.4)', 12);
      line(g, d, '#ffa030', 4);
    }
    g.restore();
    taper(g, [214, 168, 170, 60, 300, 20, 300, 110], 58, 34, '#6a1c10', { hl: '#ff9a40' });
    at(g, 292, 118, 0.85, () => serpentHead(g, '#7a2414', { open: true, eye: '#ffd040', fin: '#c04a20' }), 0.35);
    embers(g, r, 22, 120, 0, 360, 170, '#ffc040');
  }],
  g10: ['feuer', (g, r) => { // Sonnenglutdrache: goldener Drache vor der Sonne
    glow(g, 290, 100, 170, '#fff0a0', 0.9, true);
    flat(g, ell(290, 100, 78, 78), rad(g, 290, 100, 0, 78, ['#fffbe0', '#ffd860', '#ff9a20']));
    rays(g, 290, 100, 22, '#fff0b0', 0.1);
    at(g, 196, 212, 0.86, () => dragon(g, { col: '#e8a830', wing: '#d9722a', spread: true, belly: '#fff0b8', horn: '#fff6dc', eye: '#ff4a20', spike: '#b85a10' }));
    embers(g, r, 12, 0, 0, W, H, '#ffe080');
  }],
  // --- Tiefsee (Wasser) ---
  t01: ['wasser', (g, r) => { // Nebelqualle: leuchtende Qualle im Nebel
    for (let i = 0; i < 4; i++) flat(g, ell(216, 80 + i * 60, 260, 22), 'rgba(220,240,255,0.08)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = 150 + i * 16;
      const a = r() * 6;
      let d = `M${x},150`;
      for (let k = 1; k <= 8; k++) d += ` Q${x + Math.sin(a + k) * 18},${150 + k * 18 - 9} ${x + Math.sin(a + k * 1.3) * 8},${150 + k * 18}`;
      line(g, d, 'rgba(220,170,255,0.55)', 2.4);
    }
    for (const x of [192, 216, 240]) {
      let d = `M${x},150`;
      for (let k = 1; k <= 5; k++) d += ` Q${x + (k % 2 ? 14 : -14)},${150 + k * 20 - 10} ${x},${150 + k * 20}`;
      line(g, d, 'rgba(255,190,240,0.6)', 8);
    }
    glow(g, 216, 110, 120, '#d090ff', 0.45);
    const bell = P('M136,150 C136,90 176,58 216,58 C256,58 296,90 296,150 C276,160 256,148 236,158 C216,148 196,160 176,150 C156,160 146,156 136,150 Z');
    flat(g, bell, rad(g, 200, 90, 10, 120, ['rgba(255,230,255,0.9)', 'rgba(210,140,255,0.6)', 'rgba(140,80,220,0.4)']));
    line(g, bell, 'rgba(255,230,255,0.9)', 2.5);
    for (const [x, y] of [[190, 110], [242, 110], [216, 96]]) line(g, ell(x, y, 12, 8), 'rgba(255,200,255,0.7)', 3);
    flat(g, ell(186, 84, 26, 12, -0.4), 'rgba(255,255,255,0.45)');
    g.restore();
  }],
  t02: ['wasser', (g) => { // Krabbenwächter: Krabbe mit erhobenen Scheren
    at(g, 216, 226, 1, () => {
      const c = '#d2552e';
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) tube(g, `M${s * (60 + i * 14)},10 L${s * (110 + i * 14)},${20 + i * 6} L${s * (130 + i * 10)},${62 + i * 4}`, 10, tone(c, -0.15));
      for (const s of [-1, 1]) {
        tube(g, `M${s * 80},-10 L${s * 120},-50 L${s * 112},-96`, 18, c);
        at(g, s * 110, -100, 1, () => {
          part(g, 'M-28,10 C-48,-20 -40,-62 -12,-82 C-6,-60 6,-50 22,-46 C30,-30 26,0 -28,10 Z', c);
          part(g, 'M22,-46 C30,-70 18,-92 0,-100 C14,-80 12,-62 2,-50 Z', tone(c, -0.08));
        }, s * 0.2, s < 0);
      }
      for (const s of [-1, 1]) {
        tube(g, `M${s * 18},-48 L${s * 24},-82`, 6, c);
        part(g, ell(s * 24, -88, 9, 9), '#1a120e', { edge: 0 });
        flat(g, ell(s * 24 - 3, -91, 3, 3), '#ffffff');
      }
      part(g, 'M-110,0 C-110,-50 -60,-72 0,-72 C60,-72 110,-50 110,0 C90,26 -90,26 -110,0 Z', c);
      part(g, 'M-50,-40 C-30,-56 30,-56 50,-40 C40,-12 20,6 0,12 C-20,6 -40,-12 -50,-40 Z', tone(c, 0.15), { edge: 0.5 });
      for (const [x, y] of [[-76, -24], [76, -24], [-30, -60], [30, -60], [0, -20]]) part(g, ell(x, y, 6, 5), tone(c, 0.3), { edge: 0, line: 1.5 });
      line(g, 'M-14,14 L-6,20 M14,14 L6,20', '#5a1a0a', 3);
    });
  }],
  t03: ['wasser', (g, r) => { // Riffflitzer: flinker Streifenfisch am Riff
    for (const [x, c] of [[60, '#e86a8a'], [360, '#f0905a'], [400, '#c85aa0']]) {
      taper(g, [x, 300, x - 10, 250, x + 20, 230, x + 4, 200], 14, 6, c);
      taper(g, [x, 280, x + 30, 260, x + 40, 240, x + 34, 222], 10, 4, c);
    }
    part(g, ell(130, 300, 50, 26), '#b07a4a', { edge: 0.6 });
    for (let i = 0; i < 4; i++) line(g, `M${92 + i * 20},292 q10,-10 20,0`, 'rgba(60,30,10,0.4)', 2);
    for (let i = 0; i < 5; i++) line(g, `M${30 + r() * 60},${120 + i * 22} l${90 + r() * 40},0`, 'rgba(220,250,255,0.5)', 3);
    at(g, 236, 156, 1.2, () => {
      const c = '#f4c430';
      part(g, 'M-84,0 L-128,-36 C-120,-12 -120,12 -128,36 Z', '#3a66c8');
      part(g, 'M-30,-28 C-10,-58 20,-56 30,-34 Z', '#3a66c8');
      part(g, 'M-20,26 C-6,48 12,46 20,30 Z', '#3a66c8');
      const b = part(g, 'M-90,0 C-60,-38 20,-42 70,-14 C84,-6 88,0 84,6 C60,30 -40,34 -90,0 Z', c);
      g.save();
      g.clip(b);
      for (const x of [-50, -10, 30]) flat(g, `M${x},-50 L${x + 14},-50 L${x + 4},50 L${x - 10},50 Z`, '#2a56b8');
      g.restore();
      line(g, b, '#5a3a06', 2.5);
      eye(g, 56, -6, 8, '#3a2a10', 'cute');
      line(g, 'M78,6 L86,4', '#5a3a06', 2);
    });
    bubbles(g, r, 6);
  }],
  t04: ['wasser', (g, r) => { // Muschelritter: Ritter mit Muschelschild
    shadow(g, 230, 300, 100, 10);
    at(g, 236, 302, 0.95, () => figure(g, {
      cloth: '#2f6278', body: '#4a8aa0', legs: '#2f6278', boots: '#24404e', pads: '#6ab0c4', belt: '#c8a050', sleeve: '#3f7f95',
      armL: [[-60, -128], [-74, -112]], armR: [[60, -124], [70, -96]],
      hold: (g2) => {
        tube(g2, 'M70,0 L70,-290', 7, '#c8a050');
        part(g2, 'M54,-290 L58,-320 L64,-294 L70,-326 L76,-294 L82,-320 L86,-290 Z', '#d8b860', { edge: 0.3 });
      },
      front: () => at(g, -78, -120, 1.1, () => {
        const p = part(g, 'M0,52 C-24,52 -60,30 -62,-6 C-64,-40 -36,-62 0,-64 C36,-62 64,-40 62,-6 C60,30 24,52 0,52 Z', '#f2c9b0');
        g.save();
        g.clip(p);
        for (let i = -4; i <= 4; i++) line(g, `M0,48 L${i * 18},-70`, 'rgba(160,80,60,0.5)', 3);
        g.restore();
        part(g, 'M-16,46 L16,46 L10,60 L-10,60 Z', '#e0a890', { edge: 0.3 });
        part(g, ell(0, 4, 8, 8), '#fff8f4', { edge: 0.3 });
      }),
      headFn: (g2) => {
        tube(g2, 'M0,6 L0,-10', 18, '#e5b48a');
        part(g2, 'M-26,-14 C-28,-56 -14,-64 0,-64 C14,-64 28,-56 26,-14 Z', '#4a8aa0');
        part(g2, 'M-4,-62 C10,-90 30,-96 46,-90 C30,-80 18,-70 10,-58 Z', '#6ab0c4', { edge: 0.4 });
        flat(g2, P('M-18,-36 L18,-36 L16,-28 L-16,-28 Z'), '#0a1a22');
        line(g2, 'M0,-24 L0,-12', '#24404e', 4);
      },
    }));
    bubbles(g, r, 5);
  }],
  t05: ['wasser', (g) => { // Riffhai: Hai mit offenem Maul
    at(g, 226, 160, 0.98, () => {
      const c = '#5c7b94';
      part(g, 'M-165,10 C-185,-20 -200,-50 -216,-78 C-206,-30 -200,0 -212,48 C-196,30 -180,20 -165,10 Z', tone(c, -0.1));
      part(g, 'M-20,-44 C-5,-90 10,-110 30,-120 C25,-90 32,-60 50,-38 Z', c);
      part(g, 'M100,18 C120,26 140,24 168,14 C150,36 120,44 98,32 Z', '#5a1a1e', { edge: 0.4 });
      part(g, 'M-170,10 C-120,-40 0,-55 90,-30 C130,-18 160,-2 172,14 C140,18 116,20 100,18 C70,30 30,44 0,46 C-60,46 -110,36 -170,10 Z', c);
      part(g, 'M-120,24 C-60,40 0,46 60,38 C80,34 92,26 100,20 C90,34 60,48 0,50 C-60,50 -100,40 -120,24 Z', '#e6eef2', { edge: 0.4 });
      part(g, 'M100,32 C120,44 150,38 166,18 C150,24 124,26 100,20 Z', tone(c, -0.05));
      for (let x = 108; x < 166; x += 10) {
        part(g, `M${x},${18 + (x - 100) * -0.05} L${x + 4},${28} L${x + 8},${18 + (x - 100) * -0.06} Z`, '#ffffff', { edge: 0, line: 1 });
        part(g, `M${x},${31} L${x + 4},${22} L${x + 8},${31} Z`, '#ffffff', { edge: 0, line: 1 });
      }
      part(g, 'M20,30 C10,60 -10,80 -36,92 C-20,70 -15,50 -10,32 Z', tone(c, -0.08));
      for (const x of [56, 66, 76]) line(g, `M${x},-14 Q${x - 6},0 ${x},14`, tone(c, -0.45), 2.5);
      flat(g, ell(114, -8, 5, 5), '#0a1016');
      flat(g, ell(113, -10, 1.6, 1.6), '#ffffff');
    });
  }],
  t06: ['meer', (g) => { // Gezeitensirene: Meerjungfrau auf dem Felsen, ruft eine Welle
    part(g, 'M50,320 C60,252 116,214 196,210 C280,206 336,240 356,320 Z', '#3e444e', { edge: 0.8 });
    at(g, 196, 302, 0.95, () => {
      taper(g, [0, -104, 60, -70, 90, -20, 160, -8], 54, 16, '#2a9a8a', { hl: '#9af0dc' });
      part(g, 'M152,-6 C170,-40 196,-44 210,-34 C192,-24 188,-12 200,12 C180,4 166,2 152,-6 Z', '#3ac0a8');
      figure(g, {
        noLegs: true, body: '#e8c0a4', skin: '#e8c0a4', sleeve: '#e8c0a4',
        chest: (g2) => {
          for (const s2 of [-1, 1]) part(g2, ell(s2 * 16, -150, 15, 12), '#e888a8', { edge: 0.4 });
          part(g2, 'M-36,-112 C-20,-96 20,-96 36,-112 L34,-98 C20,-86 -20,-86 -34,-98 Z', '#3ac0a8', { edge: 0.3 });
        },
        hair: '#1a8a90',
        hairBack: 'M-24,-56 C-50,-30 -56,20 -46,60 C-30,54 -24,30 -24,10 L24,10 C26,30 32,46 42,52 C54,20 46,-30 24,-56 Z',
        hairTop: 'M-25,-36 C-28,-60 -10,-64 0,-64 C14,-64 30,-56 26,-30 C18,-46 6,-50 -4,-48 C-12,-46 -20,-42 -25,-36 Z',
        armL: [[-66, -136], [-84, -108]], armR: [[70, -196], [94, -238]],
        headExtra: (g2) => part(g2, 'M14,-60 C24,-74 36,-70 34,-58 C28,-62 20,-60 14,-60 Z', '#f8e0c0', { edge: 0.2 }),
      });
    });
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [d, w] of [['M246,96 C230,40 300,10 340,40 C372,64 350,104 318,96 C298,90 304,66 322,70', 7], ['M262,110 C300,130 360,120 390,80', 4]]) {
      line(g, d, 'rgba(120,230,255,0.35)', w * 3);
      line(g, d, 'rgba(200,255,250,0.9)', w);
    }
    g.restore();
    for (let i = 0; i < 4; i++) part(g, `M${i * 120 - 20},306 C${i * 120 + 20},280 ${i * 120 + 70},286 ${i * 120 + 100},306 L${i * 120 + 100},320 L${i * 120 - 20},320 Z`, '#2a6a8a', { edge: 0.4, ink: '#bfe8f8', line: 2 });
  }],
  t07: ['tiefsee', (g, r) => { // Tiefseeangler: Anglerfisch mit Leuchtköder
    at(g, 196, 180, 1, () => {
      const c = '#3e4c5c';
      part(g, 'M-118,0 L-170,-40 C-162,-10 -162,10 -170,40 Z', tone(c, -0.15));
      tube(g, 'M-10,-96 C20,-150 90,-160 136,-130', 5, '#5a6878');
      part(g, 'M-120,0 C-120,-80 -40,-110 30,-96 C90,-82 120,-40 118,0 C115,50 70,90 0,92 C-70,92 -120,60 -120,0 Z', c);
      part(g, 'M40,-10 C70,-22 110,-18 126,4 C112,40 80,62 44,56 C60,30 58,10 40,-10 Z', '#14080c', { edge: 0.3 });
      for (let i = 0; i < 7; i++) {
        part(g, `M${52 + i * 10},${-12 + i * -0.5} L${56 + i * 10},${8} L${60 + i * 10},${-12} Z`, '#f0e8d8', { edge: 0, line: 1 });
        part(g, `M${50 + i * 9},${54 - i * 3} L${55 + i * 9},${30 - i * 3} L${60 + i * 9},${52 - i * 3} Z`, '#f0e8d8', { edge: 0, line: 1 });
      }
      part(g, 'M-30,40 C-50,70 -40,90 -16,96 C-20,80 -14,60 -10,44 Z', tone(c, -0.1));
      eye(g, 30, -52, 7, '#e8f060');
      for (let i = 0; i < 6; i++) flat(g, ell(-80 + i * 24, -20 + (i % 2) * 30, 4, 4), 'rgba(140,200,255,0.4)');
    });
    glow(g, 336, 54, 70, '#a0f0ff', 0.6, true);
    flat(g, ell(336, 54, 11, 11), '#f0ffff');
    glow(g, 336, 54, 22, '#ffffff', 0.9, true);
    sparkles(g, r, 4, 300, 20, 380, 90, '#d0ffff', 5);
  }],
  t08: ['meer', (g) => { // Seeschlange: Windungen ragen aus dem Meer
    const c = '#2f8a7a';
    for (const [x, w] of [[30, 70], [130, 80]]) taper(g, [x, 232, x + 10, 150, x + w - 10, 150, x + w, 232], 30, 30, c, { hl: '#9ae8d0' });
    taper(g, [250, 240, 262, 170, 300, 120, 312, 96], 38, 28, c, { hl: '#9ae8d0' });
    at(g, 316, 84, 1.0, () => serpentHead(g, c, { open: true, fin: '#5ad0b0' }), 0.1);
    g.fillStyle = lin(g, 0, 224, 0, H, ['#1e4a68', '#0a2238']);
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 18) g.lineTo(x, 228 + Math.sin(x * 0.08) * 5);
    g.lineTo(W, H);
    g.fill();
    for (const x of [30, 100, 130, 210, 250, 290]) line(g, `M${x - 16},${230} q16,-10 32,0`, 'rgba(230,250,255,0.8)', 3);
    for (let i = 0; i < 10; i++) line(g, `M${i * 46},${262 + (i % 3) * 16} q14,-6 28,0`, 'rgba(200,230,255,0.35)', 2);
  }],
  t09: ['tiefsee', (g, r) => { // Kraken der Tiefe: Riesenkrake
    const c = '#9a3a5a';
    const arms = [
      [180, 170, 120, 220, 40, 210, 30, 130], [190, 180, 160, 260, 80, 300, 40, 290], [205, 186, 200, 260, 160, 320, 130, 300],
      [228, 186, 236, 260, 290, 320, 310, 290], [242, 180, 290, 260, 360, 300, 400, 280], [252, 170, 320, 220, 400, 200, 410, 120],
    ];
    for (const a of arms) {
      taper(g, a, 30, 6, c, { dots: '#f0c0d0', hl: '#e888a8' });
    }
    part(g, 'M140,170 C130,90 170,30 216,30 C262,30 302,90 292,170 C270,196 162,196 140,170 Z', c);
    for (const s of [-1, 1]) {
      part(g, ell(216 + s * 40, 150, 22, 18), '#f8e8a0', { edge: 0.4 });
      flat(g, ell(216 + s * 40, 150, 5, 15), '#140806');
    }
    for (let i = 0; i < 8; i++) flat(g, ell(170 + r() * 90, 60 + r() * 60, 4 + r() * 4, 3 + r() * 3), 'rgba(255,200,220,0.35)');
    bubbles(g, r, 8);
  }],
  t10: ['meer', (g, r) => { // Urozean-Leviathan: Riesenkopf aus der Welle
    for (let i = 0; i < 4; i++) cloud(g, 40 + i * 120, 30, 1.4, '#141c30', 0.85);
    const c = '#1d4f7a';
    taper(g, [40, 260, 60, 150, 140, 120, 200, 140], 70, 64, c, { hl: '#6ac8f0' });
    at(g, 236, 150, 1.55, () => serpentHead(g, c, { open: true, fin: '#2a8ab8', eye: '#a0fff0' }), -0.1, true);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) line(g, `M${70 + i * 22},${200 - i * 14} l12,-4`, 'rgba(120,240,255,0.7)', 3);
    g.restore();
    part(g, 'M0,320 L0,240 C60,200 120,250 180,236 C240,222 270,180 330,200 C380,214 410,250 432,240 L432,320 Z', '#1a4a6a', { ink: '#d8f4ff', line: 3 });
    for (let i = 0; i < 14; i++) flat(g, ell(r() * W, 236 + r() * 30, 4 + r() * 8, 2 + r() * 3), 'rgba(240,250,255,0.7)');
  }],
  // --- Wildwald (Erde, Wind) ---
  w01: ['erde', (g) => { // Eichhornspäher: Eichhörnchen mit Fernrohr
    taper(g, [0, 280, 120, 266, 300, 280, 432, 262], 26, 20, '#6a4426');
    at(g, 210, 262, 1, () => {
      const c = '#c0622a';
      const tail = part(g, 'M-30,0 C-90,-10 -120,-70 -96,-130 C-80,-170 -30,-180 -20,-150 C-50,-140 -66,-110 -56,-80 C-46,-50 -20,-30 -10,-10 Z', c);
      g.save();
      g.clip(tail);
      for (let i = 0; i < 8; i++) line(g, `M${-100 + i * 6},${-150 + i * 18} q20,-4 40,6`, 'rgba(255,200,140,0.45)', 3);
      g.restore();
      part(g, 'M-34,0 C-46,-40 -30,-80 4,-84 C36,-84 44,-40 34,0 Z', c);
      part(g, 'M-12,-4 C-20,-30 -10,-60 8,-62 C26,-60 28,-30 22,-4 Z', '#f4dcb0', { edge: 0.4 });
      part(g, ell(-20, 2, 18, 8), c, { edge: 0.4 });
      part(g, ell(26, 2, 18, 8), c, { edge: 0.4 });
      part(g, 'M-24,-100 C-26,-130 0,-140 18,-132 C36,-124 42,-104 32,-90 C22,-78 -18,-78 -24,-100 Z', c);
      for (const [x, s] of [[-14, -1], [22, 1]]) part(g, `M${x - 8},-128 L${x + s * 4},-156 L${x + 8},-126 Z`, c, { edge: 0.3 });
      part(g, ell(40, -100, 8, 6), '#f4dcb0', { edge: 0.3 });
      flat(g, ell(46, -101, 3, 2.5), '#2a140a');
      eye(g, -6, -108, 6, '#3a1a08', 'cute');
      part(g, 'M10,-118 L64,-132 L68,-118 L14,-104 Z', '#c8a040', { edge: 0.4 });
      part(g, ell(66, -125, 5, 8, -0.3), '#7a5a20', { edge: 0.2 });
      flat(g, ell(66, -125, 3, 5, -0.3), 'rgba(200,240,255,0.9)');
      tube(g, 'M8,-60 C20,-80 26,-96 30,-112', 10, c);
      tube(g, 'M-8,-56 C10,-70 28,-82 44,-118', 10, c);
    });
  }],
  w02: ['erde', (g, r) => { // Dornenigel: Igel mit Stachelkleid (und einem Apfel)
    shadow(g, 216, 292, 140, 12);
    const cx = 210;
    const cy = 282;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 34; i++) {
        const a = Math.PI * (1.02 + (i / 33) * 0.9) + k * 0.03;
        const rad0 = 70 + k * 16;
        const len = 46 + r() * 16;
        const x0 = cx + Math.cos(a) * rad0;
        const y0 = cy + Math.sin(a) * rad0 * 0.95;
        const x1 = cx + Math.cos(a) * (rad0 + len);
        const y1 = cy + Math.sin(a) * (rad0 + len) * 0.95;
        line(g, `M${x0},${y0} L${x1},${y1}`, '#2a1a10', 7);
        line(g, `M${x0},${y0} L${x1},${y1}`, k === 2 ? '#a08060' : '#5a4030', 4);
        flat(g, ell(x1, y1, 2, 2), '#f0e0c0');
      }
    }
    part(g, 'M110,290 C110,230 160,200 220,200 C280,200 320,240 324,290 Z', '#5a4030', { edge: 0.6 });
    part(g, 'M300,236 C336,232 370,250 384,268 C374,284 340,292 310,288 C296,272 292,250 300,236 Z', '#d8b48a');
    flat(g, ell(384, 266, 7, 6), '#1a100a');
    eye(g, 336, 252, 6, '#2a1a0a', 'cute');
    part(g, ell(312, 238, 9, 7), '#c09a70', { edge: 0.3 });
    for (const x of [300, 350]) part(g, ell(x, 292, 12, 6), '#c8a07a', { edge: 0.3 });
    part(g, ell(176, 150, 22, 21), '#c8302a');
    tube(g, 'M176,130 L180,120', 3, '#5a3a1a');
    part(g, leafP(180, 124, 22, -0.3, 6), '#5aa040', { edge: 0.2, line: 1.2 });
    flat(g, ell(168, 142, 6, 4, -0.5), 'rgba(255,255,255,0.5)');
    for (let i = 0; i < 6; i++) part(g, leafP(30 + r() * 380, 292 + r() * 20, 18, r() * 6, 6), r() > 0.5 ? '#c87a2a' : '#a0522a', { edge: 0.2, line: 1 });
  }],
  w03: ['erde', (g, r) => { // Moosgnom: Gnom mit Moosmütze
    shadow(g, 216, 300, 80, 10);
    at(g, 216, 302, 0.82, () => figure(g, {
      wide: 1.15, hs: 1.55, robe: '#6a5232', cloth: '#7a5a34', skin: '#e8b090', belt: '#3a2a14', armL: [[-62, -120], [-80, -96]], armR: [[60, -130], [80, -112]],
      hold: (g2) => {
        tube(g2, 'M80,-10 L80,-200', 7, '#6a4426');
        glow(g2, 80, -210, 30, '#80ff80', 0.8, true);
        part(g2, 'M80,-232 L92,-210 L80,-190 L68,-210 Z', '#7af07a', { edge: 0.3 });
      },
      beard: '#e8ecd8',
      headExtra: (g2) => {
        part(g2, ell(0, -24, 7, 6), '#e06a5a', { edge: 0.3 });
        part(g2, 'M-34,-40 C-40,-70 -18,-88 4,-88 C30,-88 44,-70 36,-40 C20,-48 -20,-48 -34,-40 Z', '#4f7a2e');
        for (let i = 0; i < 9; i++) part(g2, ell(-30 + i * 8, -44 - (i % 2) * 4, 7, 5), '#6aa040', { edge: 0.2, line: 1 });
        part(g2, 'M12,-90 C10,-102 28,-104 30,-92 Z', '#d8402a', { edge: 0.2, line: 1.2 });
        tube(g2, 'M21,-92 L21,-84', 4, '#f0e8d0');
      },
    }));
    for (let i = 0; i < 5; i++) {
      const x = 40 + r() * 350;
      part(g, `M${x - 10},292 C${x - 12},278 ${x + 12},278 ${x + 10},292 Z`, '#c84a2a', { edge: 0.2, line: 1.2 });
      tube(g, `M${x},292 L${x},302`, 4, '#f0e8d0');
    }
  }],
  w04: ['erde', (g) => { // Waldläuferin: Bogenschützin mit Kapuze
    shadow(g, 216, 300, 90, 10);
    at(g, 222, 302, 0.98, () => figure(g, {
      cloth: '#3e6a2e', body: '#6a4a2a', sleeve: '#3e6a2e', legs: '#4a3a24', boots: '#2a1c10', belt: '#3a2610', cape: '#2e5a26',
      hood: '#3e7a32', skin: '#e8b88a', hair: '#8a4a1a',
      hairTop: 'M-24,-36 C-24,-54 -10,-60 0,-60 C12,-60 24,-54 24,-36 C14,-46 -6,-48 -24,-36 Z',
      back: (g2) => {
        part(g2, 'M18,-196 L42,-206 L72,-118 L50,-110 Z', '#6a4426');
        for (let i = 0; i < 3; i++) {
          line(g2, `M${28 + i * 8},-200 L${20 + i * 8},-240`, '#c8b080', 3);
          part(g2, `M${16 + i * 8},-236 L${20 + i * 8},-252 L${26 + i * 8},-238 Z`, i % 2 ? '#e8e0d0' : '#c83a2a', { edge: 0, line: 1 });
        }
      },
      armL: [[-66, -146], [-92, -150]], armR: [[60, -130], [70, -92]],
      hold: (g2) => {
        line(g2, 'M-88,-252 L-88,-48', '#f0e8d0', 1.6);
        tube(g2, 'M-86,-252 C-130,-200 -130,-100 -86,-48', 7, '#7a4a20');
        tube(g2, 'M70,-92 L96,-40', 3, '#c8b080');
      },
      headExtra: (g2) => part(g2, 'M-30,-40 C-28,-68 28,-68 30,-40 L32,-54 C28,-82 -28,-82 -32,-54 Z', '#3e7a32', { edge: 0.4 }),
    }));
  }],
  w05: ['nacht', (g, r) => { // Nordwolf: sitzender Wolf heult den Mond an
    flat(g, ell(330, 74, 46, 46), rad(g, 318, 64, 4, 50, ['#ffffff', '#e8eef8', '#b8c4d8']));
    glow(g, 330, 74, 110, '#c8d8ff', 0.35, true);
    pines(g, r, 9, 270, 100, '#0c1a30');
    part(g, 'M0,320 L0,270 C80,250 160,262 230,268 C300,262 380,250 432,262 L432,320 Z', '#d8e4f0', { edge: 0.4 });
    shadow(g, 190, 296, 120, 10);
    at(g, 196, 294, 1, () => {
      const c = '#9aa3b4';
      part(g, 'M-60,-20 C-100,-22 -140,-12 -164,-28 C-156,-4 -114,8 -60,4 Z', tone(c, -0.08));
      part(g, 'M22,-96 L18,-4 L34,-4 L38,-90 Z', tone(c, -0.3));
      part(g, 'M-80,-30 C-90,-80 -60,-140 -10,-170 C10,-182 40,-180 56,-160 C66,-130 60,-100 50,-80 C40,-50 20,-30 -10,-14 C-40,-4 -76,-4 -80,-30 Z', c);
      part(g, 'M-98,-4 C-106,-50 -82,-92 -42,-92 C-6,-92 10,-62 4,-32 C0,-12 -20,0 -40,0 L-92,0 Z', c);
      part(g, 'M-22,0 C-22,-12 10,-14 20,-6 L20,1 Z', tone(c, -0.05), { edge: 0.3 });
      part(g, 'M40,-100 C44,-70 44,-30 48,-6 L64,-6 C68,-2 66,2 60,2 L30,2 C30,-30 26,-70 24,-96 Z', c);
      part(g, 'M0,-170 C10,-200 30,-226 50,-238 L78,-214 C66,-200 60,-180 58,-156 Z', c);
      part(g, 'M26,-176 C60,-166 66,-124 54,-92 C44,-112 34,-134 26,-176 Z', '#d8dde6', { edge: 0.4 });
      at(g, 60, -232, 1, () => {
        part(g, 'M-16,-22 L-12,-48 L4,-28 Z', tone(c, -0.1), { edge: 0.3 });
        part(g, 'M8,4 L48,0 C42,12 26,18 8,12 Z', tone(c, -0.15));
        part(g, 'M-26,-8 C-26,-26 -6,-34 12,-30 L50,-18 C56,-15 56,-7 50,-5 L16,4 C4,12 -18,12 -26,2 Z', c);
        flat(g, ell(52, -12, 3.5, 3), '#14181e');
        line(g, 'M-2,-20 Q4,-24 10,-20', '#2a3040', 2.5);
      }, -0.9);
      for (let i = 0; i < 6; i++) line(g, `M${-60 + i * 16},${-120 + i * 14} l10,8`, 'rgba(255,255,255,0.35)', 2);
    });
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) line(g, `M${250 + i * 14},${40 - i * 4} q14,-14 8,-30`, 'rgba(220,235,255,0.5)', 2.5);
    g.restore();
    stars(g, r, 10);
  }],
  w06: ['erde', (g, r) => { // Wildkeiler: angreifender Keiler
    for (let i = 0; i < 6; i++) cloud(g, 40 + r() * 80, 260 + r() * 30, 0.5 + r() * 0.3, '#d8c8a0', 0.55);
    at(g, 210, 216, 1, () => {
      const c = '#5a4232';
      tube(g, 'M-40,30 L-48,72', 16, tone(c, -0.3));
      tube(g, 'M52,30 L62,72', 16, tone(c, -0.3));
      part(g, 'M-88,6 C-96,0 -104,-8 -100,-16 C-94,-10 -90,-8 -86,-4 Z', c);
      part(g, 'M-90,10 C-92,-30 -60,-52 -10,-58 C30,-62 70,-50 86,-26 C96,-8 92,24 70,36 C30,48 -50,48 -80,34 C-88,28 -90,20 -90,10 Z', c);
      let d = 'M-64,-46';
      for (let i = 0; i < 12; i++) d += ` L${-58 + i * 12},${-66 - (i % 2) * 8 + Math.sin(i * 0.4) * 6} L${-52 + i * 12},${-52 + Math.sin(i * 0.4) * 2}`;
      part(g, d + ' L-60,-40 Z', tone(c, -0.35), { edge: 0.3 });
      part(g, 'M70,-36 C96,-40 120,-24 140,0 L150,18 C152,26 144,30 136,28 L112,30 C96,30 80,22 70,10 Z', c);
      part(g, ell(148, 20, 7, 10, -0.4), '#c89a88', { edge: 0.3 });
      part(g, 'M118,24 C126,6 136,-2 146,-10 C140,6 134,18 126,30 Z', '#fff8e8', { edge: 0.3 });
      part(g, 'M78,-34 L88,-62 L100,-34 Z', tone(c, -0.15), { edge: 0.4 });
      eye(g, 104, -12, 4, '#ff4020');
      tube(g, 'M-50,30 C-56,46 -60,60 -58,78', 18, c);
      tube(g, 'M40,32 C44,48 50,60 54,78', 18, c);
      for (const x of [-58, 54]) part(g, ell(x, 82, 10, 6), '#1a1210', { edge: 0 });
    });
    for (let i = 0; i < 5; i++) line(g, `M${10 + r() * 60},${140 + i * 24} l${50 + r() * 30},0`, 'rgba(255,255,255,0.5)', 3);
  }],
  w07: ['wind', (g) => { // Sturmfalke: Falke mit ausgebreiteten Schwingen
    at(g, 216, 170, 1, () => {
      const c = '#7a5a3a';
      featherWing(g, -24, -30, 0.95, 0.2, c);
      featherWing(g, 24, -30, 0.95, -0.2, c, true);
      part(g, 'M-20,56 L-38,108 L0,118 L38,108 L20,56 Z', tone(c, -0.1));
      for (const y of [76, 92, 106]) line(g, `M${-30 + (y - 70) * 0.1},${y} L${30 - (y - 70) * 0.1},${y}`, 'rgba(30,20,10,0.5)', 3);
      part(g, 'M-26,-50 C-38,-20 -34,30 -20,60 L20,60 C34,30 38,-20 26,-50 C18,-66 -18,-66 -26,-50 Z', c);
      const ch = part(g, 'M-18,-36 C-26,-10 -22,30 -12,52 L12,52 C22,30 26,-10 18,-36 Z', '#ece0c4', { edge: 0.4 });
      g.save();
      g.clip(ch);
      for (let y = -26; y < 52; y += 10) for (let x = -14; x <= 14; x += 9) flat(g, ell(x + (y % 20 ? 4 : 0), y, 2.4, 3.4), 'rgba(90,60,30,0.6)');
      g.restore();
      for (const s of [-1, 1]) {
        tube(g, `M${s * 10},56 L${s * 14},72`, 6, '#e8c040');
        for (const k of [-6, 0, 6]) line(g, `M${s * 14},72 l${k},8`, '#2a2010', 3);
      }
      part(g, ell(0, -68, 24, 24), '#4a3a2e');
      part(g, 'M-14,-60 C-16,-48 -8,-40 0,-40 C8,-40 16,-48 14,-60 C8,-56 -8,-56 -14,-60 Z', '#ece0c4', { edge: 0.3 });
      for (const s of [-1, 1]) {
        part(g, ell(s * 11, -72, 7, 7), '#f0c030', { edge: 0.2, line: 1.5 });
        flat(g, ell(s * 11, -72, 3.5, 3.5), '#140a04');
        flat(g, ell(s * 11 - 1.5, -73.5, 1.2, 1.2), '#ffffff');
        line(g, `M${s * 4},-80 L${s * 20},-78`, '#2a1a10', 3);
      }
      part(g, 'M-7,-64 L7,-64 L3,-48 L0,-44 L-3,-48 Z', '#e8c040', { edge: 0.2, line: 1.5 });
      flat(g, P('M-3,-50 L3,-50 L0,-44 Z'), '#2a2010');
    });
  }],
  w08: ['erde', (g, r) => { // Mooswächter: moosbewachsener Steinriese, sitzt im Weg
    shadow(g, 216, 300, 170, 14);
    const c = '#6c6c62';
    const moss = '#5a8a32';
    part(g, 'M108,300 C92,220 120,140 216,128 C312,140 340,220 324,300 Z', c);
    for (const f of [1, -1]) {
      const X = (x) => (f > 0 ? x : 432 - x);
      rock(g, [X(120), 150, X(80), 170, X(62), 240, X(70), 286, X(112), 286, X(118), 230, X(140), 186], tone(c, 0.06));
      rock(g, [X(54), 272, X(116), 270, X(124), 302, X(48), 302], tone(c, -0.05));
      part(g, `M${X(120)},152 C${X(96)},150 ${X(78)},164 ${X(70)},184 C${X(90)},176 ${X(110)},172 ${X(136)},178 Z`, moss, { edge: 0.4 });
    }
    part(g, 'M130,180 C150,140 190,128 216,128 C242,128 282,140 302,180 C280,166 250,160 216,164 C182,160 152,166 130,180 Z', moss);
    part(g, 'M166,138 C162,88 190,62 216,62 C242,62 270,88 266,138 C254,156 178,156 166,138 Z', tone(c, 0.08));
    part(g, 'M162,104 C168,70 194,56 216,56 C238,56 264,70 270,104 C250,92 232,90 216,94 C200,90 182,92 162,104 Z', moss);
    for (let i = 0; i < 14; i++) part(g, ell(170 + r() * 92, 70 + r() * 28, 5 + r() * 5, 4 + r() * 3), r() > 0.5 ? '#78a840' : '#4a7a2a', { edge: 0.2, line: 1 });
    for (let i = 0; i < 16; i++) {
      const x = r() > 0.5 ? 120 + r() * 50 : 262 + r() * 50;
      part(g, ell(x, 146 + r() * 40, 5 + r() * 6, 4 + r() * 4), r() > 0.5 ? '#78a840' : '#4a7a2a', { edge: 0.2, line: 1 });
    }
    part(g, 'M180,108 L252,108 L248,118 L184,118 Z', tone(c, -0.3), { edge: 0 });
    for (const x of [198, 234]) {
      flat(g, ell(x, 124, 10, 7), '#1a1a14');
      eye(g, x, 124, 6, '#9aff60');
    }
    line(g, 'M200,144 L232,144', '#2a2a22', 3);
    for (const d of ['M180,200 L194,230 L184,262', 'M252,196 L240,236']) line(g, d, 'rgba(30,30,24,0.55)', 3);
    for (let i = 0; i < 4; i++) {
      const x = 30 + i * 120 + r() * 20;
      for (let k = 0; k < 6; k++) part(g, leafP(x, 304, 40 + r() * 20, -Math.PI * (0.25 + k * 0.1), 7), '#3a7a2a', { edge: 0.2, line: 1.2 });
    }
    for (const x of [150, 286]) {
      part(g, `M${x - 12},236 C${x - 14},220 ${x + 14},220 ${x + 12},236 Z`, '#e0c890', { edge: 0.2, line: 1.2 });
      tube(g, `M${x},236 L${x},248`, 5, '#f0e8d0');
    }
  }],
  w09: ['erde', (g) => { // Grauer Grizzly: aufgerichteter, brüllender Bär
    shadow(g, 216, 302, 140, 12);
    const c = '#6e665e';
    for (const x of [168, 264]) part(g, ell(x, 294, 36, 14), tone(c, -0.1));
    taper(g, [150, 150, 118, 126, 100, 104, 92, 76], 46, 32, c);
    taper(g, [282, 150, 314, 126, 332, 104, 340, 76], 46, 32, c);
    part(g, 'M124,300 C104,220 118,150 160,120 C190,100 242,100 272,120 C314,150 328,220 308,300 Z', c);
    part(g, ell(216, 222, 58, 66), tone(c, 0.22), { edge: 0.5 });
    for (const x of [92, 340]) {
      part(g, ell(x, 66, 26, 22), c);
      for (const k of [-14, -5, 5, 14]) part(g, `M${x + k - 4},50 C${x + k - 4},38 ${x + k + 2},32 ${x + k + 6},30 C${x + k + 4},38 ${x + k + 4},44 ${x + k + 4},50 Z`, '#f4ecd8', { edge: 0, line: 1.2 });
    }
    for (const x of [176, 256]) {
      part(g, ell(x, 62, 15, 14), c);
      flat(g, ell(x, 63, 7, 7), '#3a302a');
    }
    part(g, 'M166,112 C160,72 188,50 216,50 C244,50 272,72 266,112 C262,138 242,152 216,152 C190,152 170,138 166,112 Z', c);
    part(g, ell(216, 122, 31, 25), tone(c, 0.32), { edge: 0.4 });
    part(g, 'M196,124 C200,152 232,152 236,124 C226,132 206,132 196,124 Z', '#3a0a0a', { edge: 0.3 });
    for (const x of [200, 228]) part(g, `M${x},126 L${x + 4},138 L${x + 8},127 Z`, '#fff8e8', { edge: 0, line: 1 });
    part(g, ell(216, 106, 11, 7), '#1a1410', { edge: 0 });
    for (const s of [-1, 1]) {
      flat(g, ell(216 + s * 20, 88, 4, 4), '#140c08');
      line(g, `M${216 + s * 30},${78} L${216 + s * 10},${86}`, '#2a221c', 4);
    }
    for (let i = 0; i < 12; i++) line(g, `M${140 + (i % 6) * 30},${170 + Math.floor(i / 6) * 60} l6,10`, 'rgba(255,255,255,0.25)', 2);
  }],
  w10: ['erde', (g, r) => { // Uralter Baumhüter: Baumriese mit Gesicht
    const bark = '#6a4a2e';
    const leaf = (n, x0, y0, x1, y1) => {
      for (let i = 0; i < n; i++) part(g, ell(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 22 + r() * 18, 16 + r() * 12), ['#3e7a2a', '#4f8f32', '#2f6a22'][i % 3], { edge: 0.5, line: 1.5 });
    };
    leaf(26, 40, 0, 392, 120);
    for (const [a, b] of [[[180, 300, 140, 310, 110, 312, 70, 320], 30], [[252, 300, 290, 310, 330, 312, 370, 320], 30]]) taper(g, a, b, 10, bark);
    taper(g, [178, 176, 130, 150, 100, 120, 64, 96], 36, 12, bark);
    taper(g, [254, 176, 300, 150, 330, 116, 366, 92], 36, 12, bark);
    taper(g, [110, 130, 104, 110, 90, 98, 80, 80], 10, 4, bark);
    taper(g, [320, 126, 330, 106, 344, 96, 352, 76], 10, 4, bark);
    const tr = part(g, 'M148,320 C164,262 172,200 166,120 L266,120 C260,200 268,262 284,320 Z', bark);
    g.save();
    g.clip(tr);
    for (let i = 0; i < 9; i++) {
      const x = 160 + i * 14;
      line(g, `M${x},120 C${x + 6},180 ${x - 6},240 ${x + 2 * (i - 4)},320`, 'rgba(30,18,8,0.45)', 2.5);
    }
    g.restore();
    leaf(9, 60, 60, 160, 110);
    leaf(9, 270, 60, 380, 106);
    part(g, 'M174,190 C194,170 238,170 258,190 C238,184 194,184 174,190 Z', tone(bark, -0.35), { edge: 0 });
    for (const x of [196, 236]) {
      flat(g, ell(x, 200, 13, 9), '#1a0e06');
      eye(g, x, 200, 6, '#ffb030');
    }
    part(g, 'M206,214 C212,206 220,206 226,214 L222,228 L210,228 Z', tone(bark, 0.1), { edge: 0.4 });
    part(g, ell(216, 250, 20, 11), '#1a0e06', { edge: 0 });
    for (let i = 0; i < 9; i++) part(g, ell(196 + i * 5, 266 + (i % 3) * 6, 7, 9), '#5a8a32', { edge: 0.2, line: 1 });
    sparkles(g, r, 8, 40, 120, 400, 300, '#f8ffb0', 5);
  }],
  // --- Licht und Finsternis ---
  n01: ['licht', (g, r) => { // Lichtfee: Fee mit Flügeln und Zauberstab
    glow(g, 216, 160, 150, '#ffffff', 0.5, true);
    at(g, 216, 290, 0.8, () => {
      for (const s of [-1, 1]) {
        fairyWing(g, s * 8, -168, 150, 40, s < 0 ? -2.6 : -0.54, '#8fd8ff');
        fairyWing(g, s * 8, -150, 108, 28, s < 0 ? 2.7 : 0.44, '#ffa8e0');
      }
      figure(g, {
        robe: '#f8d8ea', trim: '#ffffff', cloth: '#f0c0d8', skin: '#f6d2b8', sleeve: '#f6d2b8', hair: '#f0c040',
        hairBack: 'M-24,-52 C-40,-30 -40,10 -32,34 C-20,40 20,40 32,34 C40,10 40,-30 24,-52 Z',
        hairTop: 'M-25,-34 C-28,-60 -10,-64 0,-64 C14,-64 28,-58 25,-32 C16,-46 4,-50 -6,-46 C-14,-44 -20,-40 -25,-34 Z',
        armL: [[-50, -146], [-44, -118]], armR: [[64, -182], [76, -226]],
        hold: (g2) => {
          line(g2, 'M76,-226 L84,-270', '#f8f0d0', 4);
          sparkle(g2, 85, -276, 16, '#fffbd0');
        },
        headExtra: (g2) => {
          for (const s of [-1, 1]) glow(g2, s * 13, -20, 7, '#ff8aa8', 0.5);
          for (const x of [-12, 0, 12]) flat(g2, ell(x, -60, 4, 4), '#ffffff');
        },
      });
    });
    sparkles(g, r, 14, 50, 20, 380, 290, '#fffbe0', 7);
  }],
  n02: ['finster', (g, r) => { // Schattenkobold: grinsender Kobold mit Dolch
    glow(g, 216, 190, 150, '#7a30c0', 0.45, true);
    shadow(g, 216, 300, 90, 10);
    at(g, 216, 302, 0.78, () => figure(g, {
      hs: 1.75, cloth: '#3a2a3a', body: '#4a3448', legs: '#2a1e2a', boots: '#1a121a', skin: '#7a9a5a', belt: '#6a4a2a',
      armL: [[-62, -126], [-80, -150]], armR: [[64, -120], [80, -96]],
      hold: (g2) => part(g2, 'M74,-96 L84,-170 L94,-96 Z', '#c8ccd8', { edge: 0.3 }),
      headFn: (g2) => {
        const s0 = '#7a9a5a';
        for (const s of [-1, 1]) part(g2, `M${s * 18},-40 L${s * 66},-58 L${s * 22},-20 Z`, s0, { edge: 0.4 });
        part(g2, ell(0, -30, 26, 26), s0);
        part(g2, 'M-4,-34 C2,-30 6,-20 0,-12 C-2,-18 -6,-24 -4,-34 Z', tone(s0, -0.15), { edge: 0.2 });
        for (const s of [-1, 1]) {
          eye(g2, s * 11, -36, 5, '#ffe040', 'slit');
          line(g2, `M${s * 20},-46 L${s * 4},-40`, '#1a2210', 3);
        }
        part(g2, 'M-16,-14 Q0,-2 16,-14 Q0,-8 -16,-14 Z', '#1a0a0a', { edge: 0, line: 1.5 });
        line(g2, 'M-12,-12 L-9,-8 L-6,-11 L-3,-7 L0,-10 L3,-7 L6,-11 L9,-8 L12,-12', '#fff8e0', 1.5);
      },
    }));
    for (let i = 0; i < 5; i++) line(g, `M${110 + i * 50},${300 - r() * 20} C${100 + i * 50},${240} ${130 + i * 50},${220} ${116 + i * 50},${170}`, 'rgba(160,90,220,0.35)', 6);
  }],
  n03: ['finster', (g, r) => { // Knochenritter: Skelett mit Schwert und Schild
    for (let i = 0; i < 4; i++) part(g, `M${30 + i * 110},300 L${30 + i * 110},${262 - (i % 2) * 10} C${30 + i * 110},${248} ${60 + i * 110},${248} ${60 + i * 110},${262 - (i % 2) * 10} L${60 + i * 110},300 Z`, '#3a3448', { edge: 0.4 });
    shadow(g, 216, 300, 100, 10);
    at(g, 216, 302, 0.95, () => {
      const bone = '#e8e0c8';
      const iron = '#6a6a74';
      part(g, 'M-44,-180 C-80,-120 -96,-50 -100,0 L-80,-14 L-66,2 L-48,-16 L-30,4 L-10,-12 L10,4 L30,-14 L48,4 L66,-12 L82,2 L100,0 C96,-50 80,-120 44,-180 Z', '#5a1a24');
      for (const s of [-1, 1]) {
        tube(g, `M${s * 16},-100 L${s * 20},-56`, 9, bone);
        tube(g, `M${s * 20},-52 L${s * 22},-16`, 8, bone);
        part(g, ell(s * 20, -54, 8, 7), bone, { edge: 0.3 });
        part(g, `M${s * 8},-26 L${s * 34},-26 C${s * 42},-16 ${s * 42},0 ${s * 34},0 L${s * 6},0 Z`, iron, { edge: 0.4 });
      }
      part(g, 'M-30,-112 C-20,-94 20,-94 30,-112 L22,-90 L-22,-90 Z', bone, { edge: 0.3 });
      tube(g, 'M0,-100 L0,-182', 8, bone);
      for (let i = 0; i < 5; i++) {
        const y = -172 + i * 13;
        for (const s of [-1, 1]) tube(g, `M${s * 3},${y} C${s * 28},${y - 4} ${s * 34},${y + 6} ${s * 28},${y + 12}`, 5, bone);
      }
      tube(g, 'M-40,-176 L-56,-140 L-66,-104', 8, bone);
      tube(g, 'M40,-176 L54,-206 L44,-240', 8, bone);
      part(g, 'M44,-240 L120,-308 L126,-302 L52,-232 Z', '#b8bcc8', { edge: 0.3 });
      part(g, 'M30,-246 L60,-226 L56,-220 L26,-240 Z', '#8a6a2a', { edge: 0.3 });
      for (const [x, y] of [[-66, -104], [44, -240]]) part(g, ell(x, y, 9, 9), bone, { edge: 0.3 });
      for (const s of [-1, 1]) part(g, `M${s * 22},-194 C${s * 50},-204 ${s * 64},-186 ${s * 60},-160 C${s * 44},-168 ${s * 30},-172 ${s * 22},-194 Z`, iron);
      at(g, -72, -112, 1, () => {
        part(g, ell(0, 0, 40, 46), '#4a3a30');
        line(g, ell(0, 0, 40, 46), '#7a7a84', 6);
        part(g, ell(0, 0, 12, 12), '#8a8a94', { edge: 0.3 });
        line(g, 'M-20,-30 L-6,-10 L-16,10', 'rgba(20,10,10,0.6)', 2.5);
      });
      at(g, 0, -216, 1, () => {
        part(g, 'M-22,-2 C-26,-40 26,-40 22,-2 C22,10 14,16 12,24 L-12,24 C-14,16 -22,10 -22,-2 Z', bone);
        for (const s of [-1, 1]) {
          flat(g, ell(s * 9, -2, 7, 8), '#120a0a');
          eye(g, s * 9, -2, 3, '#ff4040');
        }
        flat(g, P('M0,6 L-4,14 L4,14 Z'), '#120a0a');
        line(g, 'M-10,20 L10,20 M-6,17 L-6,24 M0,17 L0,24 M6,17 L6,24', '#4a3a2a', 1.5);
        part(g, 'M-26,-6 C-30,-44 30,-44 26,-6 L18,-10 C14,-26 -14,-26 -18,-10 Z', iron);
        part(g, 'M-4,-38 L0,-58 L4,-38 Z', iron, { edge: 0.2 });
      });
    });
    for (let i = 0; i < 6; i++) flat(g, ell(r() * W, 290 + r() * 20, 30, 6), 'rgba(140,110,200,0.15)');
  }],
  n04: ['licht', (g) => { // Uhrwerkwächter: Zahnrad-Wächter
    gear(g, 80, 70, 50, 12, '#d8b860', 0.2);
    gear(g, 360, 90, 40, 10, '#d8b860', 0.1);
    gear(g, 380, 250, 34, 9, '#c8a850', 0.3);
    shadow(g, 216, 300, 100, 10);
    at(g, 216, 302, 0.95, () => {
      const brass = '#c0903a';
      const steel = '#8a9098';
      part(g, 'M48,-190 L96,-212 L104,-196 L60,-174 Z', steel);
      part(g, ell(104, -206, 14, 22, 0.3), brass, { edge: 0.4 });
      for (const s of [-1, 1]) {
        part(g, `M${s * 42},-100 L${s * 16},-100 L${s * 18},-14 L${s * 44},-14 Z`, brass);
        part(g, ell(s * 30, -58, 12, 12), steel, { edge: 0.4 });
        part(g, `M${s * 54},-16 L${s * 8},-16 L${s * 6},0 L${s * 58},0 Z`, steel);
      }
      part(g, 'M-62,-206 L62,-206 L54,-100 L-54,-100 Z', brass);
      for (const [x, y] of [[-54, -198], [54, -198], [-48, -110], [48, -110]]) flat(g, ell(x, y, 3, 3), '#5a4010');
      gear(g, 0, -154, 36, 12, steel, 0.12);
      tube(g, 'M-58,-196 L-84,-150 L-92,-120', 16, steel);
      tube(g, 'M58,-196 L84,-150 L86,-108', 16, steel);
      for (const [x, y] of [[-84, -150], [84, -150]]) part(g, ell(x, y, 10, 10), brass, { edge: 0.3 });
      at(g, -96, -112, 1, () => {
        part(g, ell(0, 0, 40, 40), brass);
        part(g, ell(0, 0, 31, 31), '#fbf4e0', { edge: 0.4 });
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          line(g, `M${Math.cos(a) * 24},${Math.sin(a) * 24} L${Math.cos(a) * 29},${Math.sin(a) * 29}`, '#3a2a10', 2);
        }
        line(g, 'M0,0 L0,-20 M0,0 L14,6', '#2a1a08', 3);
      });
      part(g, ell(86, -104, 12, 12), steel, { edge: 0.3 });
      tube(g, 'M0,-206 L0,-214', 14, steel);
      part(g, 'M-34,-260 L34,-260 L30,-212 L-30,-212 Z', brass);
      eye(g, 0, -240, 10, '#40f0ff');
      line(g, ell(0, -240, 13, 13), '#5a4010', 3);
      line(g, 'M-14,-222 L14,-222 M-14,-217 L14,-217', '#5a4010', 2);
      tube(g, 'M0,-260 L0,-282', 4, steel);
      part(g, ell(0, -286, 6, 6), '#ff5030', { edge: 0.2 });
    });
  }],
  n05: ['licht', (g) => { // Torhüter des Lichts: Wächter vor dem Lichttor
    part(g, 'M60,320 L60,90 C60,8 372,8 372,90 L372,320 L318,320 L318,100 C318,52 114,52 114,100 L114,320 Z', '#d8ccb0');
    for (let y = 100; y < 320; y += 30) for (const x of [60, 318]) line(g, `M${x},${y} L${x + 54},${y}`, 'rgba(90,70,40,0.4)', 2);
    glow(g, 216, 170, 130, '#ffffff', 0.7, true);
    shadow(g, 216, 300, 100, 10);
    at(g, 216, 302, 0.92, () => figure(g, {
      cloth: '#d8d0c0', body: '#eee6d6', sleeve: '#d8d0c0', legs: '#c8c0b0', boots: '#a89060', pads: '#e0b040', cape: '#3050a0', belt: '#e0b040',
      chest: (g2) => sparkle(g2, 0, -150, 18, '#f0c040'),
      armL: [[-58, -130], [-70, -120]], armR: [[60, -126], [72, -112]],
      hold: (g2) => {
        tube(g2, 'M72,0 L72,-300', 7, '#8a6a3a');
        part(g2, 'M72,-286 C104,-292 114,-262 104,-236 L72,-248 Z', '#d0d4dc', { edge: 0.4 });
        part(g2, 'M66,-298 L72,-322 L78,-298 Z', '#d0d4dc', { edge: 0.2 });
      },
      front: () => {
        const p = part(g, 'M-118,-200 L-30,-200 L-30,-64 C-30,-34 -74,-14 -74,-14 C-74,-14 -118,-34 -118,-64 Z', '#f4efe4');
        line(g, p, '#e0b040', 5);
        sparkle(g, -74, -118, 26, '#e8b030');
      },
      headFn: (g2) => {
        tube(g2, 'M0,6 L0,-10', 18, '#e5b48a');
        part(g2, 'M-26,-10 C-28,-58 28,-58 26,-10 Z', '#eee6d6');
        flat(g2, P('M-16,-34 L16,-34 L13,-26 L-13,-26 Z'), '#2a2010');
        glow(g2, 0, -30, 20, '#fff6c0', 0.6, true);
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) part(g2, leafP(s * 22, -34 + i * 6, 36 - i * 6, s < 0 ? Math.PI + 0.7 - i * 0.2 : -0.7 + i * 0.2, 6), '#ffffff', { edge: 0.2, line: 1.4 });
        line(g2, 'M0,-56 L0,-22', '#e0b040', 3);
      },
    }));
  }],
  n06: ['finster', (g, r) => { // Schattenmagier: Kapuzenmagier mit Schattenkugel
    glow(g, 216, 170, 160, '#6a20b0', 0.4, true);
    shadow(g, 216, 300, 100, 10);
    at(g, 216, 302, 0.98, () => figure(g, {
      robe: '#2e1a44', trim: '#a070e0', cloth: '#3a2256', cape: '#1a0e2a', hood: '#3a2256', dark: true, eyes: '#d070ff', hand: '#c8b0d8', belt: '#a070e0',
      armL: [[-74, -170], [-88, -204]], armR: [[60, -126], [72, -112]],
      hold: (g2) => {
        tube(g2, 'M72,0 L72,-286', 7, '#2a1a1a');
        part(g2, 'M72,-286 C52,-300 52,-326 72,-336 C62,-322 64,-302 82,-292 Z', '#c0a0ff', { edge: 0.2 });
      },
      front: () => {
        glow(g, -90, -230, 60, '#c060ff', 0.9, true);
        flat(g, ell(-90, -230, 24, 24), rad(g, -98, -238, 2, 26, ['#ffe8ff', '#c060ff', '#4a1080']));
      },
    }));
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = 40 + r() * 350;
      const y = 40 + r() * 200;
      line(g, `M${x - 8},${y - 10} L${x},${y + 10} L${x + 8},${y - 10} M${x - 6},${y} L${x + 6},${y}`, 'rgba(200,120,255,0.6)', 2.5);
    }
    g.restore();
  }],
  // --- Zauber ---
  s01: ['feuer', (g, r) => { // Feuerball
    for (let i = 10; i >= 0; i--) {
      const t = i / 10;
      at(g, 170 + t * 190, 212 - t * 190, 1 - t * 0.6, () => fire(g, 0, 0, 90, 150), 0.75);
    }
    glow(g, 170, 212, 130, '#ff8a20', 0.8, true);
    flat(g, ell(170, 212, 60, 60), rad(g, 160, 200, 4, 62, ['#fffde0', '#ffd040', '#ff7010', '#c02000']));
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) line(g, `M${130 + i * 10},${190 + i * 14} q30,-30 60,-10`, 'rgba(255,255,200,0.6)', 3);
    g.restore();
    embers(g, r, 20, 60, 20, 420, 300, '#ffd060');
  }],
  s02: ['erde', (g, r) => { // Heilquelle: leuchtende Quelle im Steinbecken
    part(g, ell(216, 266, 156, 42), '#7a7a70');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      part(g, ell(216 + Math.cos(a) * 140, 266 + Math.sin(a) * 34, 20, 12), i % 2 ? '#8a8a7e' : '#6e6e64', { edge: 0.3, line: 1.5 });
    }
    flat(g, ell(216, 262, 124, 26), rad(g, 216, 262, 10, 124, ['#e0fff8', '#60e0d0', '#1a8a8a']));
    for (const k of [0.4, 0.7, 1]) line(g, ell(216, 262, 124 * k, 26 * k), 'rgba(255,255,255,0.45)', 1.5);
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = lin(g, 0, 40, 0, 262, ['rgba(160,255,240,0)', 'rgba(160,255,240,0.5)']);
    g.fillRect(196, 40, 40, 222);
    for (const s of [-1, 1]) for (const k of [50, 90]) line(g, `M216,120 Q${216 + s * k * 0.8},${80} ${216 + s * k},${250}`, 'rgba(190,255,250,0.65)', 3);
    g.restore();
    sparkles(g, r, 14, 120, 40, 312, 240, '#f0fff8', 6);
    for (let i = 0; i < 8; i++) part(g, leafP(40 + r() * 352 * (i % 2 ? 0.2 : 1), 300 + r() * 16, 40, -Math.PI * (0.3 + r() * 0.4), 8), '#4a9a3a', { edge: 0.2, line: 1.2 });
  }],
  s03: ['sturm', (g, r) => { // Blitzschlag
    const pts = [[260, 0]];
    for (let i = 1; i <= 8; i++) pts.push([260 - i * 9 + (r() - 0.5) * 50, i * 36]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (const [x, y] of pts.slice(1)) d += ` L${x},${y}`;
    const [bx, by] = pts[3];
    const branch = `M${bx},${by} L${bx + 40},${by + 30} L${bx + 34},${by + 60} L${bx + 70},${by + 96}`;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgba(150,180,255,0.12)';
    g.fillRect(0, 0, W, H);
    for (const p of [d, branch]) {
      line(g, p, 'rgba(120,160,255,0.3)', 22);
      line(g, p, 'rgba(190,215,255,0.8)', 8);
      line(g, p, '#ffffff', 3);
    }
    const [ex, ey] = pts[8];
    glow(g, ex, ey, 110, '#c8dcff', 0.9);
    g.restore();
    flat(g, ell(ex, ey + 10, 80, 14), rad(g, ex, ey + 10, 4, 80, ['rgba(20,20,30,0.7)', 'rgba(20,20,30,0)']));
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI * (0.08 + r() * 0.84);
      const dd = 30 + r() * 70;
      sparkle(g, ex + Math.cos(a) * dd, ey + Math.sin(a) * dd, 5 + r() * 6, '#dce8ff');
    }
  }],
  s04: ['wind', (g, r) => { // Sturmbö: Wirbelsturm reißt Karten mit
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const y = 20 + t * 260;
      const rx = 130 * (1 - t) + 16;
      const x = 216 + Math.sin(t * 5) * 22 * t;
      flat(g, ell(x, y, rx, rx * 0.22), `rgba(150,160,175,${0.25 + t * 0.2})`);
      line(g, ell(x, y, rx, rx * 0.22), 'rgba(255,255,255,0.6)', 2);
    }
    for (let i = 0; i < 5; i++) cloud(g, 130 + r() * 170, 290 + r() * 20, 0.5, '#c8b890', 0.6);
    for (let i = 0; i < 7; i++) {
      const x = 60 + r() * 310;
      const y = 30 + r() * 230;
      at(g, x, y, 1, () => {
        part(g, poly([-12, -17, 12, -17, 12, 17, -12, 17]), i % 2 ? '#2c8c84' : '#8a2a40', { edge: 0.2, line: 1.5, ink: '#f0e0b0' });
        line(g, poly([-7, -12, 7, -12, 7, 12, -7, 12]), 'rgba(255,230,170,0.7)', 1.2);
      }, r() * 3);
    }
    for (let i = 0; i < 8; i++) part(g, leafP(40 + r() * 350, 30 + r() * 250, 16, r() * 6, 5), '#5aa040', { edge: 0.2, line: 1 });
  }],
  s05: ['magie', (g) => { // Weiser Blick: großes Auge
    rays(g, 216, 160, 16, '#ffffff', 0.12, 0.1);
    magicCircle(g, 216, 160, 140, 140, '#ffffff', 0.35);
    const lens = P('M70,160 C140,70 292,70 362,160 C292,250 140,250 70,160 Z');
    flat(g, lens, rad(g, 216, 160, 20, 150, ['#ffffff', '#f4ead8', '#cfc0a0']));
    g.save();
    g.clip(lens);
    flat(g, ell(216, 160, 58, 58), rad(g, 216, 160, 6, 58, ['#fff4a0', '#40c8b0', '#0a5a5a']));
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      line(g, `M${216 + Math.cos(a) * 22},${160 + Math.sin(a) * 22} L${216 + Math.cos(a) * 54},${160 + Math.sin(a) * 54}`, 'rgba(10,60,60,0.35)', 2);
    }
    flat(g, ell(216, 160, 22, 22), '#06120f');
    flat(g, ell(198, 142, 12, 9), 'rgba(255,255,255,0.9)');
    g.restore();
    line(g, lens, '#3a2a10', 4);
    line(g, 'M70,160 C140,62 292,62 362,160', '#e8c060', 6);
    for (let i = 1; i < 8; i++) {
      const t = i / 8;
      const x = 70 + t * 292;
      const y = 160 - Math.sin(t * Math.PI) * 74;
      line(g, `M${x},${y} L${x + (t - 0.5) * 20},${y - 22}`, '#3a2a10', 3);
    }
  }],
  s06: ['magie', (g, r) => { // Kraftschub: Faust mit Aura
    glow(g, 216, 160, 150, '#ffe060', 0.7, true);
    for (let i = 0; i < 9; i++) fire(g, 120 + i * 24, 250 - Math.sin((i / 8) * Math.PI) * 60, 34, 120 + r() * 50, (i - 4) * 4);
    part(g, 'M178,320 L186,214 L254,214 L262,320 Z', '#d8a07a');
    part(g, 'M180,236 L260,236 L262,256 L178,256 Z', '#e0b040', { edge: 0.3 });
    part(g, 'M158,150 C158,118 282,118 282,150 L286,214 C286,236 158,236 156,214 Z', '#e0aa82');
    for (let i = 0; i < 4; i++) part(g, ell(176 + i * 30, 136, 17, 20), '#e8b48c', { edge: 0.5 });
    for (let i = 0; i < 3; i++) line(g, `M${191 + i * 30},${150} L${191 + i * 30},${176}`, 'rgba(90,40,20,0.5)', 2);
    part(g, 'M156,184 C152,160 214,162 238,178 C242,194 222,202 202,200 L160,198 Z', '#e0aa82');
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, y] of [[100, 120], [332, 120], [216, 40]]) line(g, `M${x - 18},${y + 14} L${x},${y - 4} L${x + 18},${y + 14}`, 'rgba(255,240,150,0.9)', 6);
    g.restore();
  }],
  s07: ['asche', (g, r) => { // Flammenklinge: brennendes Schwert
    at(g, 216, 168, 1, () => {
      for (let i = 0; i < 7; i++) fire(g, (i % 2 ? 10 : -10), 70 - i * 30, 34, 60 + r() * 30, (i % 2 ? 6 : -6));
      const blade = part(g, 'M-13,82 L-13,-118 L0,-152 L13,-118 L13,82 Z', '#c8ccd4');
      g.save();
      g.clip(blade);
      flat(g, P('M0,-152 L13,-118 L13,82 L0,82 Z'), 'rgba(40,40,60,0.25)');
      g.restore();
      line(g, 'M0,-120 L0,70', 'rgba(80,80,100,0.6)', 3);
      g.save();
      g.globalCompositeOperation = 'lighter';
      line(g, 'M-13,80 L-13,-118 L0,-152 L13,-118 L13,80', 'rgba(255,140,40,0.7)', 5);
      g.restore();
      for (let i = 0; i < 5; i++) fire(g, (i % 2 ? -12 : 12), 40 - i * 36, 22, 44, (i % 2 ? -5 : 5));
      part(g, 'M-60,80 C-40,70 40,70 60,80 L56,94 C40,88 -40,88 -56,94 Z', '#e0b040');
      tube(g, 'M0,96 L0,134', 14, '#5a2a14');
      for (let y = 102; y < 134; y += 8) line(g, `M-7,${y} L7,${y + 4}`, '#2a1408', 2);
      part(g, ell(0, 144, 12, 12), '#e0b040', { edge: 0.4 });
      part(g, ell(0, 144, 5, 5), '#d02030', { edge: 0 });
    }, 0.5);
    embers(g, r, 18, 60, 20, 380, 300, '#ffc040');
  }],
  s08: ['wasser', (g, r) => { // Muschelpanzer: Muschel als Brustpanzer
    for (const s of [-1, 1]) {
      tube(g, `M${216 + s * 110},150 C${216 + s * 150},140 ${216 + s * 190},120 ${216 + s * 240},110`, 14, '#6a4426');
      part(g, `M${216 + s * 132},134 L${216 + s * 150},134 L${216 + s * 150},156 L${216 + s * 132},156 Z`, '#c8a050', { edge: 0.2 });
    }
    const hx = 216;
    const hy = 284;
    const p = new Path2D();
    p.moveTo(hx - 26, hy);
    p.lineTo(hx - 128, 154);
    for (let i = 0; i < 9; i++) {
      const a0 = Math.PI * (1.12 + (i / 9) * 0.76);
      const a1 = Math.PI * (1.12 + ((i + 1) / 9) * 0.76);
      const am = (a0 + a1) / 2;
      p.quadraticCurveTo(hx + Math.cos(am) * 250, hy + Math.sin(am) * 250, hx + Math.cos(a1) * 228, hy + Math.sin(a1) * 228);
    }
    p.lineTo(hx + 26, hy);
    p.closePath();
    part(g, p, '#f2cdb8');
    g.save();
    g.clip(p);
    for (let i = 0; i <= 9; i++) {
      const a = Math.PI * (1.12 + (i / 9) * 0.76);
      line(g, `M${hx},${hy} L${hx + Math.cos(a) * 240},${hy + Math.sin(a) * 240}`, 'rgba(150,80,70,0.5)', 3);
    }
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = lin(g, 100, 60, 330, 280, ['rgba(120,255,240,0.25)', 'rgba(255,160,220,0.2)', 'rgba(120,200,255,0.25)']);
    g.fill(p);
    for (let k = 0; k < 3; k++) line(g, ell(hx, hy, 70 + k * 50, 70 + k * 50), 'rgba(255,255,255,0.18)', 2);
    g.restore();
    part(g, `M${hx - 40},${hy} L${hx + 40},${hy} L${hx + 30},${hy + 24} L${hx - 30},${hy + 24} Z`, '#e0a890', { edge: 0.3 });
    glow(g, hx, hy - 10, 24, '#ffffff', 0.7, true);
    part(g, ell(hx, hy - 8, 12, 12), '#fdf6f0', { edge: 0.3 });
    bubbles(g, r, 6);
  }],
  s09: ['finster', (g) => { // Krallenring: Goldring mit Krallen um einen Rubin
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const d = `M${110 + i * 46},40 C${150 + i * 46},120 ${190 + i * 46},200 ${210 + i * 46},290`;
      line(g, d, 'rgba(255,60,60,0.3)', 16);
      line(g, d, 'rgba(255,170,150,0.9)', 4);
    }
    g.restore();
    const gold = lin(g, 120, 0, 312, 0, GOLD);
    line(g, 'M126,222 C126,186 306,186 306,222', '#5a3a08', 30);
    line(g, 'M126,222 C126,186 306,186 306,222', gold, 22);
    glow(g, 216, 140, 70, '#ff3050', 0.7, true);
    for (const s of [-1, 1]) {
      part(g, `M${216 + s * 18},190 C${216 + s * 52},170 ${216 + s * 52},120 ${216 + s * 30},96 C${216 + s * 36},124 ${216 + s * 32},150 ${216 + s * 8},168 Z`, '#d8a840');
      part(g, `M${216 + s * 30},96 L${216 + s * 18},112 L${216 + s * 26},118 Z`, '#fff4d8', { edge: 0, line: 1.2 });
    }
    const gemP = poly([216, 104, 240, 116, 248, 142, 236, 166, 216, 174, 196, 166, 184, 142, 192, 116]);
    part(g, gemP, '#d01e3c');
    line(g, poly([216, 122, 230, 132, 230, 152, 216, 160, 202, 152, 202, 132]), 'rgba(255,200,210,0.6)', 1.5);
    flat(g, poly([200, 118, 214, 110, 208, 130]), 'rgba(255,255,255,0.7)');
    line(g, 'M126,222 C126,262 306,262 306,222', '#5a3a08', 30);
    line(g, 'M126,222 C126,262 306,262 306,222', gold, 22);
    line(g, 'M140,236 C170,252 262,252 292,236', 'rgba(255,250,220,0.8)', 4);
  }],
  s10: ['feuer', (g, r) => { // Glutfeld: Vulkanlandschaft mit Lavastrom
    part(g, 'M200,206 L290,92 L322,86 L352,92 L432,190 L432,206 Z', '#2a1410', { edge: 0.6 });
    glow(g, 320, 88, 60, '#ffa030', 0.9, true);
    for (let i = 0; i < 4; i++) cloud(g, 290 + i * 26, 50 - i * 14, 0.5, '#3a2a28', 0.6);
    g.fillStyle = lin(g, 0, 200, 0, H, ['#3a1a12', '#1e0c08']);
    g.fillRect(0, 200, W, H - 200);
    const lava = P('M296,200 C276,228 210,222 168,248 C120,276 120,300 70,320 L250,320 C250,296 236,282 260,262 C290,240 330,232 336,200 Z');
    flat(g, lava, lin(g, 0, 200, 0, 320, ['#ff8a20', '#ffd060', '#ff6a10']));
    g.save();
    g.clip(lava);
    for (let i = 0; i < 9; i++) {
      const x = 120 + r() * 200;
      const y = 214 + r() * 100;
      flat(g, ell(x, y, 14 + r() * 16, 4 + r() * 4, -0.4), 'rgba(120,30,0,0.45)');
    }
    g.restore();
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 18;
    g.strokeStyle = 'rgba(255,120,20,0.35)';
    g.stroke(lava);
    g.restore();
    rock(g, [0, 320, 0, 230, 40, 214, 90, 236, 60, 320], '#1a0a06');
    rock(g, [432, 320, 432, 240, 400, 226, 360, 260, 350, 320], '#1a0a06');
    embers(g, r, 24, 0, 0, W, H, '#ffb040');
  }],
  s11: ['wasser', (g, r) => { // Tiefseegrund: Riff mit Korallen und Tang
    part(g, 'M0,320 L0,250 C80,236 160,262 240,248 C320,236 380,250 432,244 L432,320 Z', '#c8b088', { edge: 0.5 });
    for (let i = 0; i < 5; i++) {
      const x = 20 + i * 96 + r() * 20;
      taper(g, [x, 300, x - 20, 220, x + 30, 160, x + 6, 60 + r() * 40], 12, 5, '#2a7a3a', { hl: '#6ac070' });
    }
    for (const [x, c] of [[90, '#e86a8a'], [300, '#f0905a'], [370, '#c85aa0'], [200, '#f06a50']]) {
      taper(g, [x, 280, x - 10, 230, x + 20, 210, x + 4, 180], 16, 6, c);
      taper(g, [x, 262, x + 30, 240, x + 40, 220, x + 36, 200], 11, 4, c);
      taper(g, [x, 256, x - 30, 240, x - 40, 226, x - 38, 208], 10, 4, c);
    }
    part(g, ell(150, 280, 40, 24), '#d8a050', { edge: 0.6 });
    for (let i = 0; i < 4; i++) line(g, `M${118 + i * 16},276 q8,-10 16,0`, 'rgba(90,50,10,0.45)', 2);
    at(g, 260, 292, 1, () => {
      const p = new Path2D();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const rr2 = i % 2 ? 7 : 18;
        p[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr2, Math.sin(a) * rr2 * 0.6);
      }
      p.closePath();
      part(g, p, '#f0703a', { edge: 0.3 });
    });
    for (let i = 0; i < 4; i++) {
      const x = 60 + r() * 300;
      const y = 50 + r() * 120;
      at(g, x, y, 0.6 + r() * 0.4, () => {
        part(g, 'M-20,0 C-10,-12 14,-12 22,0 C14,12 -10,12 -20,0 Z M-20,0 L-32,-10 L-30,10 Z', '#f0c040', { edge: 0.3, line: 1.5 });
        flat(g, ell(12, -2, 2.4, 2.4), '#1a1a1a');
      }, 0, i % 2 === 1);
    }
  }],
  s12: ['erde', (g, r) => { // Urwald: Riesenbäume, Lianen, Farne
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(255,250,200,0.12)';
      const x = 100 + i * 70;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 30, 0);
      g.lineTo(x + 80, H);
      g.lineTo(x + 20, H);
      g.fill();
    }
    g.restore();
    for (const [x, w] of [[50, 70], [380, 80], [230, 36]]) {
      part(g, `M${x - w / 2},320 C${x - w / 2 + 6},200 ${x - w / 2 + 8},80 ${x - w / 2 + 4},0 L${x + w / 2 - 4},0 C${x + w / 2 - 8},80 ${x + w / 2 - 6},200 ${x + w / 2},320 Z`, '#4a3420');
      for (let k = 0; k < 4; k++) line(g, `M${x - w / 4 + k * (w / 6)},0 L${x - w / 4 + k * (w / 6) + 4},320`, 'rgba(20,12,4,0.35)', 2);
    }
    for (let i = 0; i < 6; i++) {
      const x = 70 + i * 58;
      const len = 120 + r() * 120;
      line(g, `M${x},0 C${x + 20},${len * 0.4} ${x - 20},${len * 0.7} ${x + 6},${len}`, '#3a6a24', 4);
      for (let k = 1; k < 5; k++) part(g, leafP(x + (k % 2 ? 6 : -6), (len * k) / 5, 16, k % 2 ? 0.4 : 2.7, 5), '#5aa040', { edge: 0.2, line: 1 });
    }
    for (let i = 0; i < 5; i++) {
      const x = 20 + i * 100 + r() * 20;
      for (let k = 0; k < 7; k++) part(g, leafP(x, 320, 60 + r() * 30, -Math.PI * (0.15 + k * 0.12), 9), k % 2 ? '#3e8a2e' : '#4f9a36', { edge: 0.3, line: 1.2 });
    }
    for (let i = 0; i < 3; i++) flat(g, ell(216, 200 + i * 40, 260, 14), 'rgba(240,255,230,0.12)');
  }],
  s13: ['nacht', (g, r) => { // Wiederkehr: Grabstein, aus dem Licht aufsteigt
    part(g, 'M0,320 L0,270 C100,250 330,250 432,270 L432,320 Z', '#1e2a24', { edge: 0.4 });
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = lin(g, 0, 0, 0, 280, ['rgba(255,240,170,0.05)', 'rgba(255,240,170,0.45)']);
    g.beginPath();
    g.moveTo(186, 0);
    g.lineTo(246, 0);
    g.lineTo(300, 280);
    g.lineTo(132, 280);
    g.fill();
    g.restore();
    const st = part(g, 'M170,284 L170,180 C170,140 262,140 262,180 L262,284 Z', '#8a8a92');
    g.save();
    g.clip(st);
    line(g, 'M240,150 L230,190 L244,214', 'rgba(30,30,40,0.5)', 2);
    g.restore();
    g.save();
    g.globalCompositeOperation = 'lighter';
    line(g, 'M216,176 L216,246 M196,196 L216,210 L236,196 M200,236 L232,236', 'rgba(150,230,255,0.9)', 5);
    g.restore();
    glow(g, 216, 92, 70, '#e8fff8', 0.8, true);
    const soul = P('M216,40 C246,70 244,112 216,124 C188,112 186,70 216,40 Z');
    g.save();
    g.globalCompositeOperation = 'lighter';
    flat(g, soul, rad(g, 216, 96, 4, 50, ['rgba(255,255,255,0.95)', 'rgba(180,240,255,0.6)', 'rgba(120,200,255,0.1)']));
    g.restore();
    for (const s of [-1, 1]) flat(g, ell(216 + s * 8, 96, 3, 4), '#3a6a8a');
    sparkles(g, r, 12, 140, 20, 300, 260, '#fff8d0', 6);
    for (let i = 0; i < 20; i++) {
      const x = r() * W;
      line(g, `M${x},${282 + r() * 30} l-3,-10 M${x},${290} l3,-12`, 'rgba(90,140,90,0.8)', 1.6);
    }
  }],
  s14: ['asche', (g) => { // Kriegstrommel: große Trommel mit Schlegeln
    for (const s of [-1, 1]) {
      tube(g, `M${216 + s * 150},320 L${216 + s * 150},40`, 6, '#5a3a1a');
      part(g, `M${216 + s * 150},44 L${216 + s * 150 - s * 80},50 C${216 + s * 150 - s * 70},80 ${216 + s * 150 - s * 86},100 ${216 + s * 150 - s * 76},130 L${216 + s * 150},120 Z`, '#a01c1c');
      part(g, ell(216 + s * 150 - s * 38, 88, 12, 12), '#e0b040', { edge: 0.3 });
    }
    part(g, 'M116,172 L116,272 C116,316 316,316 316,272 L316,172 Z', '#8a2a1a');
    for (const y of [180, 280]) line(g, `M116,${y} C116,${y + 32} 316,${y + 32} 316,${y}`, '#c8a050', 8);
    let d = '';
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = 120 + t * 192;
      const top = 196 + Math.sin(t * Math.PI) * 26;
      const bot = 286 + Math.sin(t * Math.PI) * 24;
      d += `${i ? 'L' : 'M'}${x},${i % 2 ? bot : top} `;
    }
    line(g, d, '#e8d8b0', 4);
    part(g, ell(216, 172, 100, 28), '#e8d8b0');
    line(g, ell(216, 172, 100, 28), '#c8a050', 6);
    taper(g, [120, 60, 160, 90, 190, 120, 220, 150], 10, 8, '#6a4426');
    taper(g, [312, 60, 272, 90, 242, 120, 212, 150], 10, 8, '#6a4426');
    for (const x of [120, 312]) part(g, ell(x, 60, 14, 14), '#e8d8b0', { edge: 0.4 });
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) line(g, `M${216 + s * (120 + k * 22)},150 Q${216 + s * (134 + k * 22)},200 ${216 + s * (120 + k * 22)},250`, 'rgba(255,200,120,0.6)', 4);
    g.restore();
  }],
  // --- Fallen ---
  f01: ['falle', (g) => { // Spiegelschild: Strahl prallt am Spiegel ab
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [d, c] of [['M0,30 L210,170', '255,80,140'], ['M210,170 L432,40', '140,220,255']]) {
      line(g, d, `rgba(${c},0.3)`, 26);
      line(g, d, `rgba(${c},0.8)`, 9);
      line(g, d, '#ffffff', 3);
    }
    g.restore();
    part(g, ell(216, 176, 106, 112), '#b08a30');
    const face = ell(216, 176, 90, 96);
    flat(g, face, lin(g, 130, 90, 300, 270, ['#f4f8ff', '#9aa4b8', '#e8eef8', '#6a7488', '#d0d8e8']));
    g.save();
    g.clip(face);
    g.globalCompositeOperation = 'lighter';
    for (const x of [150, 200]) {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(x, 60);
      g.lineTo(x + 26, 60);
      g.lineTo(x - 30, 290);
      g.lineTo(x - 56, 290);
      g.fill();
    }
    g.restore();
    line(g, face, '#5a4010', 3);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      part(g, ell(216 + Math.cos(a) * 98, 176 + Math.sin(a) * 104, 6, 6), '#f0d070', { edge: 0.2, line: 1.2 });
    }
    sparkle(g, 210, 170, 30, '#ffffff');
  }],
  f02: ['falle', (g, r) => { // Stolperdraht: Draht mit Glöckchen, ein Stiefel stolpert
    part(g, 'M0,320 L0,250 C120,236 300,236 432,248 L432,320 Z', '#3a2a1a', { edge: 0.4 });
    for (let i = 0; i < 26; i++) {
      const x = r() * W;
      const y = 250 + r() * 60;
      line(g, `M${x},${y} l-3,-9 M${x},${y} l3,-10`, 'rgba(100,140,60,0.8)', 1.6);
    }
    for (const x of [60, 372]) {
      part(g, `M${x - 9},278 L${x - 9},196 L${x},184 L${x + 9},196 L${x + 9},278 Z`, '#8a6a42');
      line(g, `M${x - 9},210 L${x + 9},214`, '#4a3420', 2);
    }
    line(g, 'M60,206 Q216,222 372,206', '#d8d8e0', 2.5);
    line(g, 'M216,214 L216,224', '#a0a0a8', 2);
    part(g, 'M204,240 C204,226 228,226 228,240 L232,246 L200,246 Z', '#e0b040', { edge: 0.3 });
    flat(g, ell(216, 248, 4, 4), '#7a5a10');
    for (const s of [-1, 1]) line(g, `M${216 + s * 18},${232} l${s * 10},-4 M${216 + s * 20},${242} l${s * 12},0`, 'rgba(255,230,150,0.9)', 2);
    at(g, 160, 196, 1, () => {
      part(g, 'M-26,-110 L22,-110 L26,-30 C44,-28 70,-22 78,-8 L80,6 L-30,6 Z', '#5a3a20');
      part(g, 'M-32,4 L82,4 L82,16 L-32,16 Z', '#2a1a10', { edge: 0.2 });
      line(g, 'M-24,-84 L20,-84 M-24,-60 L22,-60', 'rgba(30,20,10,0.5)', 3);
    }, 0.35);
    for (let i = 0; i < 4; i++) line(g, `M${100 + i * 8},${110 - i * 14} l-30,-6`, 'rgba(255,255,255,0.4)', 3);
  }],
  f03: ['falle', (g, r) => { // Dornengrube: Grube mit Spießen
    part(g, 'M0,320 L0,120 C140,104 300,104 432,120 L432,320 Z', '#4a3a24', { edge: 0.3 });
    for (let i = 0; i < 30; i++) {
      const x = r() * W;
      const y = 124 + r() * 190;
      line(g, `M${x},${y} l-3,-9 M${x},${y} l3,-10`, 'rgba(110,150,60,0.8)', 1.6);
    }
    const pit = ell(216, 216, 156, 62);
    flat(g, pit, rad(g, 216, 230, 10, 160, ['#000000', '#120804', '#3a2412']));
    g.save();
    g.clip(pit);
    for (let i = 0; i < 11; i++) {
      const x = 90 + i * 24;
      const y = 262 - Math.abs(i - 5) * 4;
      part(g, `M${x - 8},${y} L${x},${y - 64 + (i % 2) * 14} L${x + 8},${y} Z`, '#a8a8b4', { edge: 0.2, line: 1.5 });
    }
    flat(g, P('M60,190 C120,160 312,160 372,190 L372,150 L60,150 Z'), 'rgba(0,0,0,0.5)');
    g.restore();
    line(g, pit, '#2a1a0a', 5);
    at(g, 216, 160, 1, () => part(g, 'M-110,-8 L40,-14 L60,-2 L50,8 L-108,10 Z', '#9a7a4a'), -0.12);
    at(g, 300, 250, 1, () => part(g, 'M-70,-7 L60,-10 L54,8 L-66,10 Z', '#8a6a3a'), 0.5);
    for (let i = 0; i < 6; i++) part(g, leafP(120 + r() * 200, 150 + r() * 120, 16, r() * 6, 5), r() > 0.5 ? '#c87a2a' : '#a0522a', { edge: 0.2, line: 1 });
  }],
  f04: ['wasser', (g, r) => { // Strudel: Wasserwirbel von oben
    g.save();
    g.translate(216, 170);
    g.scale(1, 0.62);
    flat(g, ell(0, 0, 260, 260), rad(g, 0, 0, 4, 260, ['#000a14', '#04304a', '#0a5a7a', '#1a7a9a']));
    for (let k = 0; k < 6; k++) {
      let d = '';
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const a = k * (TAU / 6) + t * 5.2;
        const rr2 = 14 + t * 230;
        d += `${i ? 'L' : 'M'}${Math.cos(a) * rr2},${Math.sin(a) * rr2} `;
      }
      line(g, d, 'rgba(220,250,255,0.55)', 4);
      line(g, d, 'rgba(255,255,255,0.8)', 1.5);
    }
    g.restore();
    for (let i = 0; i < 20; i++) {
      const a = r() * TAU;
      const d = 60 + r() * 150;
      flat(g, ell(216 + Math.cos(a) * d, 170 + Math.sin(a) * d * 0.62, 3 + r() * 5, 2), 'rgba(255,255,255,0.7)');
    }
    at(g, 290, 220, 1, () => part(g, 'M-40,-6 L40,-8 L36,8 L-38,8 Z', '#8a6a3a'), 0.7);
  }],
  f05: ['falle', (g, r) => { // Schutzkuppel: Pfeile prallen an der Kuppel ab
    part(g, 'M0,320 L0,262 C140,250 300,250 432,262 L432,320 Z', '#3a2a2a', { edge: 0.4 });
    rock(g, [186, 270, 190, 230, 206, 220, 226, 220, 242, 230, 246, 270], '#6a5a5a');
    flat(g, poly([200, 222, 216, 200, 232, 222]), '#8a3a3a');
    const dome = P('M70,272 C70,90 362,90 362,272 Z');
    g.save();
    g.globalCompositeOperation = 'lighter';
    flat(g, dome, rad(g, 216, 272, 40, 190, ['rgba(120,220,255,0.06)', 'rgba(120,220,255,0.2)', 'rgba(200,250,255,0.45)']));
    g.save();
    g.clip(dome);
    for (let y = 100; y < 280; y += 24) for (let x = 60; x < 380; x += 28) line(g, poly([x, y, x + 14, y - 8, x + 28, y, x + 28, y + 16, x + 14, y + 24, x, y + 16]), 'rgba(200,250,255,0.18)', 1.2);
    g.restore();
    line(g, 'M70,272 C70,90 362,90 362,272', 'rgba(220,255,255,0.9)', 3);
    g.restore();
    for (const [x, y, a] of [[60, 70, 0.6], [380, 80, 2.5], [40, 180, 0.1], [400, 170, 3.0]]) {
      at(g, x, y, 1, () => {
        line(g, 'M-40,0 L20,0', '#8a6a3a', 3);
        part(g, 'M20,-6 L34,0 L20,6 Z', '#b0b0bc', { edge: 0, line: 1.2 });
        part(g, 'M-40,0 L-50,-8 L-34,0 L-50,8 Z', '#e8e0d0', { edge: 0, line: 1 });
      }, a);
    }
    for (const [x, y] of [[112, 128], [320, 130], [86, 196], [346, 194]]) sparkle(g, x, y, 14, '#e0faff');
    sparkles(g, r, 4, 100, 120, 330, 250, '#e0faff', 5);
  }],
  f06: ['finster', (g, r) => { // Schwächungsfluch: Fluchzeichen bricht ein Schwert
    g.save();
    g.globalCompositeOperation = 'lighter';
    magicCircle(g, 216, 160, 130, 130, '#c060ff', 0.7);
    g.restore();
    at(g, 216, 160, 1, () => {
      part(g, 'M-12,-110 L0,-136 L12,-110 L12,-20 L4,-8 L10,6 L12,70 L-12,70 L-12,0 L-4,-12 L-12,-24 Z', '#a8acb8');
      line(g, 'M-4,-60 L6,-40 L-2,-26', 'rgba(20,10,30,0.7)', 2);
      part(g, 'M-50,70 C-30,62 30,62 50,70 L46,82 C30,76 -30,76 -46,82 Z', '#6a5a3a');
      tube(g, 'M0,84 L0,118', 12, '#3a2a2a');
      part(g, ell(0, 126, 10, 10), '#6a5a3a', { edge: 0.3 });
    }, 0.12);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      line(g, `M${216 + Math.cos(a) * 120},${160 + Math.sin(a) * 120} Q${216 + Math.cos(a + 1) * 40},${160 + Math.sin(a + 1) * 40} ${216 + Math.cos(a + 2) * 20},${160 + Math.sin(a + 2) * 60}`, 'rgba(190,90,255,0.55)', 7);
    }
    for (const [x, y] of [[96, 250], [336, 250]]) line(g, `M${x},${y - 40} L${x},${y} M${x - 14},${y - 14} L${x},${y} L${x + 14},${y - 14}`, 'rgba(230,140,255,0.9)', 6);
    g.restore();
    sparkles(g, r, 6, 60, 40, 370, 280, '#e0a0ff', 5);
  }],
  f07: ['falle', (g, r) => { // Bannrune: Runenstein mit leuchtendem Bannzeichen
    part(g, 'M0,320 L0,262 C140,250 300,250 432,262 L432,320 Z', '#2a1e22', { edge: 0.4 });
    g.save();
    g.globalCompositeOperation = 'lighter';
    magicCircle(g, 216, 278, 170, 34, '#ff8aa8', 0.8);
    g.restore();
    part(g, 'M166,282 L156,120 C160,70 200,40 228,46 C262,52 280,100 276,140 L270,282 Z', '#7a7480');
    line(g, 'M190,90 L200,120 L192,150', 'rgba(30,20,30,0.4)', 2);
    const rune = 'M216,92 L216,240 M188,166 L216,136 L244,166 L216,196 Z M196,104 L216,92 L236,104 M196,228 L216,240 L236,228';
    g.save();
    g.globalCompositeOperation = 'lighter';
    line(g, rune, 'rgba(255,60,110,0.35)', 18);
    line(g, rune, '#ff90b0', 6);
    line(g, rune, '#fff0f4', 2);
    g.restore();
    sparkles(g, r, 10, 80, 60, 360, 270, '#ffc0d0', 6);
  }],
  f08: ['finster', (g, r) => { // Letzter Ruf: Kriegshorn ruft einen Geisterkrieger
    g.save();
    g.globalCompositeOperation = 'lighter';
    const ghost = P('M300,40 C330,40 344,64 340,92 C366,100 384,130 386,170 C370,200 360,240 330,270 C320,240 300,230 290,260 C280,230 260,236 250,262 C232,230 226,190 230,160 C232,126 252,102 272,96 C262,66 274,40 300,40 Z');
    flat(g, ghost, rad(g, 304, 140, 10, 150, ['rgba(180,240,255,0.6)', 'rgba(120,200,255,0.35)', 'rgba(80,140,255,0.05)']));
    line(g, ghost, 'rgba(200,250,255,0.6)', 2);
    for (const s of [-1, 1]) flat(g, ell(302 + s * 10, 72, 5, 4), 'rgba(255,255,255,0.95)');
    line(g, 'M276,56 C290,30 314,30 328,56', 'rgba(200,250,255,0.7)', 5);
    for (let k = 0; k < 4; k++) line(g, `M${150 + k * 22},${200 - k * 22} q${30},${-6} ${46},${30}`, 'rgba(255,220,160,0.6)', 4);
    g.restore();
    taper(g, [30, 300, 50, 250, 110, 214, 180, 186], 16, 58, '#c8a878', { hl: '#f4e8d0' });
    part(g, ell(32, 300, 9, 7, -0.8), '#c8a050', { edge: 0.3 });
    for (const t of [0.35, 0.65, 0.9]) {
      const x = 40 + (170 - 40) * t;
      const y = 290 - (290 - 190) * t;
      line(g, ell(x, y, 8 + t * 18, 6 + t * 16, -0.7), '#c8a050', 5);
    }
    part(g, ell(180, 186, 24, 32, -0.75), '#2a1a0e', { edge: 0.3 });
    line(g, ell(180, 186, 24, 32, -0.75), '#c8a050', 5);
    sparkles(g, r, 8, 220, 30, 400, 280, '#d0f4ff', 5);
  }],
  f09: ['falle', (g, r) => { // Gegenschlag: Schild fängt den Hieb und schlägt zurück
    at(g, 330, 70, 1, () => {
      part(g, 'M-8,0 L-8,150 L0,170 L8,150 L8,0 Z', '#c8ccd4');
      part(g, 'M-36,-4 L36,-4 L32,8 L-32,8 Z', '#a08040');
      tube(g, 'M0,-8 L0,-40', 10, '#5a2a14');
    }, 0.75);
    part(g, ell(190, 196, 96, 100), '#7a4a26');
    for (let i = -3; i <= 3; i++) line(g, `M${190 + i * 26},${100 + Math.abs(i) * 6} L${190 + i * 26},${292 - Math.abs(i) * 6}`, 'rgba(40,20,8,0.4)', 2);
    line(g, ell(190, 196, 92, 96), '#a8a8b0', 9);
    part(g, ell(190, 196, 22, 22), '#b8b8c0', { edge: 0.4 });
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU;
      line(g, `M${246 + Math.cos(a) * 14},${150 + Math.sin(a) * 14} L${246 + Math.cos(a) * (40 + (i % 2) * 30)},${150 + Math.sin(a) * (40 + (i % 2) * 30)}`, 'rgba(255,230,140,0.9)', 3);
    }
    glow(g, 246, 150, 50, '#fff0b0', 0.9);
    const arrow = 'M200,300 C300,330 420,260 400,150';
    line(g, arrow, 'rgba(255,90,90,0.35)', 18);
    line(g, arrow, '#ff8a6a', 6);
    g.restore();
    part(g, 'M384,140 L404,104 L420,148 Z', '#ff8a6a', { edge: 0, line: 2, ink: '#7a1a10' });
    sparkles(g, r, 4, 220, 110, 300, 200, '#fff6d0', 5);
  }],
  f10: ['falle', (g, r) => { // Felsriss: Boden reißt auf, Glut in der Tiefe
    part(g, 'M0,320 L0,110 C140,96 300,96 432,110 L432,320 Z', '#8a6e48', { edge: 0.3 });
    for (let i = 0; i < 24; i++) {
      const x = r() * W;
      const y = 116 + r() * 200;
      line(g, `M${x},${y} l-3,-9 M${x},${y} l3,-10`, 'rgba(110,150,60,0.8)', 1.6);
    }
    part(g, 'M20,320 L84,240 L106,252 L156,190 L172,204 L226,140 L246,150 L298,100 L330,96 L292,164 L272,160 L222,228 L206,218 L158,286 L138,278 L120,320 Z', '#5a4428', { edge: 0.4 });
    const crack = P('M30,320 L90,250 L110,262 L160,200 L176,214 L230,150 L250,160 L300,110 L320,104 L282,170 L262,166 L214,232 L198,222 L150,290 L130,282 L110,320 Z');
    flat(g, crack, lin(g, 0, 110, 0, 320, ['#3a0a04', '#ff6a10', '#ffd060']));
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(255,120,30,0.35)';
    g.stroke(crack);
    g.restore();
    line(g, crack, '#2a1a0a', 3);
    for (const d of ['M180,210 L120,180 L90,190', 'M240,160 L300,180 L340,170', 'M120,270 L60,240']) line(g, d, '#2a1a0a', 2.5);
    for (let i = 0; i < 8; i++) {
      const x = 120 + r() * 180;
      const y = 140 + r() * 140;
      rock(g, [x, y, x + 14, y - 6, x + 22, y + 8, x + 6, y + 14], '#6a5038');
    }
    for (let i = 0; i < 5; i++) cloud(g, 80 + r() * 260, 120 + r() * 120, 0.4, '#c8b090', 0.4);
    embers(g, r, 12, 100, 120, 330, 300, '#ffb040');
  }],
};

// ---------- Rahmen und Schrift ----------
const KINDS = {
  normal: { metal: ['#8a6a3a', '#e8cc94', '#a88350', '#f6e2b4', '#7a5c30'], ink: '#4a3218', grain: '#ffffff' },
  effect: { metal: ['#5a2a12', '#c27a45', '#73391b', '#de9a62', '#4a200d'], ink: '#3a170a', grain: '#ffd8b0' },
  spell: { metal: ['#0b4f52', '#4fd1c2', '#11706f', '#8eeadd', '#093f42'], ink: '#06302f', grain: '#d8fff8' },
  trap: { metal: ['#4a0c1c', '#b03d58', '#5e1428', '#cf6a82', '#3a0814'], ink: '#2c0610', grain: '#ffd0dc' },
};
const GOLD = ['#7a5410', '#f6d77a', '#b8862a', '#fff0b8', '#8a6316'];
const ELEM = { feuer: '#e8452a', wasser: '#2f8fe0', erde: '#b07a2a', wind: '#4cc488', licht: '#f2cf48', finster: '#8a3fd0' };

// Zeichen im Edelstein: Element bzw. Zauber/Falle (weiß, Mitte x, y, Größe s)
function symbol(g, key, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s / 10, s / 10);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const D = {
    feuer: () => g.fill(P('M0,-11 C4,-6 8,-2 7,4 C6,9 2,11 0,11 C-4,11 -7,8 -7,4 C-7,0 -4,-2 -3,-6 C-1,-3 0,-2 0,-11 Z')),
    wasser: () => g.fill(P('M0,-11 C3,-5 8,0 8,4 C8,9 4,11 0,11 C-4,11 -8,9 -8,4 C-8,0 -3,-5 0,-11 Z')),
    erde: () => g.fill(P('M-11,8 L-4,-6 L0,0 L4,-9 L11,8 Z')),
    wind: () => {
      g.lineWidth = 2.6;
      g.stroke(P('M-10,-4 L4,-4 C9,-4 9,-10 4,-10 M-10,2 L8,2 C13,2 13,9 7,9 M-6,8 L-1,8'));
    },
    licht: () => {
      g.beginPath();
      g.arc(0, 0, 5, 0, TAU);
      g.fill();
      g.lineWidth = 2.2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5);
        g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
        g.stroke();
      }
    },
    finster: () => g.fill(P('M3,-11 C-5,-10 -10,-4 -10,2 C-10,8 -4,12 3,11 C-3,8 -6,4 -6,0 C-6,-5 -2,-9 3,-11 Z')),
    spell: () => g.fill(P('M0,-12 Q1.5,-1.5 12,0 Q1.5,1.5 0,12 Q-1.5,1.5 -12,0 Q-1.5,-1.5 0,-12 Z')),
    trap: () => {
      g.fill(P('M-2.5,-11 L2.5,-11 L1.5,4 L-1.5,4 Z'));
      g.beginPath();
      g.arc(0, 8.5, 2.4, 0, TAU);
      g.fill();
    },
  };
  D[key]?.();
  g.restore();
}

// Sechseckiger Edelstein mit Schliff und Goldfassung
function gem(g, x, y, r, col, key) {
  const hex = (rad2) => {
    const p = new Path2D();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      p[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rad2, y + Math.sin(a) * rad2);
    }
    p.closePath();
    return p;
  };
  g.fillStyle = lin(g, x, y - r, x, y + r, GOLD);
  g.fill(hex(r + 4));
  g.strokeStyle = '#3a2408';
  g.lineWidth = 1.5;
  g.stroke(hex(r + 4));
  g.fillStyle = rad(g, x - r * 0.3, y - r * 0.4, 1, r * 1.3, [tone(col, 0.55), col, tone(col, -0.55)]);
  g.fill(hex(r));
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 1.2;
  g.stroke(hex(r * 0.55));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55);
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.stroke();
  }
  symbol(g, key, x, y + 0.5, r * 0.62);
  flat(g, ell(x - r * 0.38, y - r * 0.5, r * 0.22, r * 0.12, -0.5), 'rgba(255,255,255,0.7)');
}

function frame(g, k, r) {
  rr(g, 0, 0, FACE.w, FACE.h, 28);
  g.fillStyle = '#140d07';
  g.fill();
  rr(g, 7, 7, 498, 702, 22);
  g.fillStyle = lin(g, 0, 0, FACE.w * 0.6, FACE.h, k.metal);
  g.fill();
  // feine gebürstete Maserung
  g.save();
  g.clip();
  g.strokeStyle = rgba(k.grain, 0.06);
  g.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const y = r() * FACE.h;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(FACE.w, y + (r() - 0.5) * 30);
    g.stroke();
  }
  g.restore();
  rr(g, 14, 14, 484, 688, 16);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 2;
  g.stroke();
  rr(g, 16, 16, 480, 684, 15);
  g.strokeStyle = 'rgba(255,245,220,0.3)';
  g.lineWidth = 1;
  g.stroke();
}

function namePlate(g, c, k) {
  rr(g, 24, 22, 464, 58, 12);
  g.fillStyle = lin(g, 0, 22, 0, 80, [tone(k.ink, 0.15), k.ink, tone(k.ink, -0.35)]);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = lin(g, 24, 0, 488, 0, GOLD);
  g.stroke();
  rr(g, 29, 27, 454, 48, 9);
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,240,200,0.22)';
  g.stroke();
  const key = c.kind === 'monster' ? c.attr : c.kind;
  gem(g, 60, 51, 20, c.kind === 'monster' ? ELEM[c.attr] : c.kind === 'spell' ? '#2fbfae' : '#c8364e', key);
  // Name: so groß wie möglich, notfalls kleiner oder schmaler
  const maxW = 376;
  let size = 40;
  g.font = `bold ${size}px Georgia, serif`;
  while (g.measureText(c.name).width > maxW && size > 24) g.font = `bold ${--size}px Georgia, serif`;
  const tw = g.measureText(c.name).width;
  g.save();
  g.translate(286, 53);
  if (tw > maxW) g.scale(maxW / tw, 1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillText(c.name, 1.5, 2);
  g.fillStyle = '#fbf0d4';
  g.fillText(c.name, 0, 0);
  g.restore();
}

// Raute (Stufenzeichen)
function rhomb(g, x, y, rw, rh) {
  const p = poly([x, y - rh, x + rw, y, x, y + rh, x - rw, y]);
  g.fillStyle = lin(g, x - rw, y - rh, x + rw, y + rh, GOLD);
  g.fill(p);
  flat(g, poly([x, y - rh, x - rw, y, x, y]), 'rgba(255,255,230,0.45)');
  flat(g, poly([x, y + rh, x + rw, y, x, y]), 'rgba(90,50,0,0.35)');
  g.strokeStyle = '#4a2c06';
  g.lineWidth = 1.5;
  g.stroke(p);
}

function levelRow(g, n) {
  const step = 31;
  const total = (n - 1) * step;
  const x0 = 256 - total / 2;
  rr(g, x0 - 26, 87, total + 52, 28, 14);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();
  g.strokeStyle = 'rgba(255,235,180,0.3)';
  g.lineWidth = 1;
  g.stroke();
  for (let i = 0; i < n; i++) rhomb(g, x0 + i * step, 101, 11, 13);
}

const SUB = { normal: '', equip: 'Ausrüstung', field: 'Feld', cont: 'Dauerzauber' };
const TRIG = { attack: 'bei Angriff', summon: 'bei Beschwörung', any: 'jederzeit' };
function kindRow(g, c) {
  const text = c.kind === 'spell' ? ['Zauber', SUB[c.sub]].filter(Boolean).join(' · ') : `Falle · ${TRIG[c.trigger]}`;
  g.font = 'bold 21px Georgia, serif';
  const tw = g.measureText(text).width;
  rr(g, 256 - tw / 2 - 22, 87, tw + 44, 28, 14);
  g.fillStyle = 'rgba(0,0,0,0.38)';
  g.fill();
  g.strokeStyle = 'rgba(255,235,180,0.35)';
  g.lineWidth = 1;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fbf0d4';
  g.fillText(text, 256, 102);
}

function picture(g, c, r) {
  const { x, y, w, h } = IMG;
  rr(g, x - 8, y - 8, w + 16, h + 16, 6);
  g.fillStyle = '#140c06';
  g.fill();
  g.save();
  rr(g, x, y, w, h, 3);
  g.clip();
  g.translate(x, y);
  const [bgKey, draw] = MOTIFS[c.id] ?? [c.kind === 'trap' ? 'falle' : 'magie', () => {}];
  const [L, bg] = BGS[bgKey];
  S = {
    base: g.getTransform(),
    light: rad(g, W * 0.3, H * 0.08, 0, 420, [`rgba(${L},0.5)`, `rgba(${L},0.16)`, `rgba(${L},0)`, 'rgba(0,0,0,0.14)', 'rgba(0,0,0,0.32)']),
  };
  bg(g, r);
  draw(g, r);
  g.fillStyle = rad(g, W / 2, H / 2, 140, 300, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.45)']);
  g.fillRect(0, 0, W, H);
  g.restore();
  // Zierrahmen: goldene Doppellinie, Rauten in den Ecken
  g.strokeStyle = lin(g, x, y, x + w, y + h, GOLD);
  g.lineWidth = 3;
  g.strokeRect(x - 4.5, y - 4.5, w + 9, h + 9);
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1.5;
  g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  for (const [cx, cy] of [[x - 4, y - 4], [x + w + 4, y - 4], [x - 4, y + h + 4], [x + w + 4, y + h + 4]]) rhomb(g, cx, cy, 8, 8);
}

// Typzeile als Band mit spitzen Enden
function typeLine(g, c, k) {
  const text = c.fx ? `${c.type} · Effekt` : c.type;
  g.font = 'bold 21px Georgia, serif';
  const tw = g.measureText(text).width + 50;
  const x0 = 256 - tw / 2;
  const p = poly([x0, 463, x0 + 14, 449, x0 + tw - 14, 449, x0 + tw, 463, x0 + tw - 14, 477, x0 + 14, 477]);
  g.fillStyle = lin(g, 0, 449, 0, 477, [tone(k.ink, 0.15), tone(k.ink, -0.3)]);
  g.fill(p);
  g.strokeStyle = lin(g, x0, 0, x0 + tw, 0, GOLD);
  g.lineWidth = 2;
  g.stroke(p);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fbf0d4';
  g.fillText(text, 256, 464);
}

// Zeilen umbrechen (an Leerzeichen)
function wrap(g, text, maxW) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const t = cur ? `${cur} ${word}` : word;
    if (cur && g.measureText(t).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Pergament mit Text: größte Schrift, die passt (mindestens 17 px)
function textBox(g, c, y, h, big, r) {
  const x = 34;
  const w = 444;
  rr(g, x, y, w, h, 8);
  g.fillStyle = lin(g, 0, y, 0, y + h, ['#f8efd8', '#efe1bc', '#e2cf9e']);
  g.fill();
  g.save();
  g.clip();
  for (let i = 0; i < 90; i++) flat(g, ell(x + r() * w, y + r() * h, 1 + r() * 3, 0.6 + r()), 'rgba(120,80,30,0.07)');
  g.fillStyle = rad(g, x + w / 2, y + h / 2, h * 0.3, w * 0.62, ['rgba(0,0,0,0)', 'rgba(110,70,20,0.18)']);
  g.fillRect(x, y, w, h);
  if (c.kind !== 'monster') {
    g.globalAlpha = 0.09;
    symbol(g, c.kind, x + w / 2, y + h / 2, 70);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,0)';
  }
  g.restore();
  g.strokeStyle = '#3a2610';
  g.lineWidth = 2;
  rr(g, x, y, w, h, 8);
  g.stroke();
  rr(g, x + 5, y + 5, w - 10, h - 10, 5);
  g.strokeStyle = 'rgba(140,100,40,0.45)';
  g.lineWidth = 1;
  g.stroke();
  const style = c.kind === 'monster' && !c.fx ? 'italic ' : '';
  const text = c.text.replace(/(\d) (?=LP|ATK|DEF|Karte)/g, '$1\u00a0');
  const maxW = w - 36;
  let size = big;
  let lines;
  for (; size >= 17; size--) {
    g.font = `${style}${size}px Georgia, serif`;
    lines = wrap(g, text, maxW);
    if (lines.length * size * 1.24 <= h - 20 && lines.every((l) => g.measureText(l).width <= maxW)) break;
  }
  size = Math.max(size, 17);
  g.font = `${style}${size}px Georgia, serif`;
  // gleich lange Zeilen: so schmal umbrechen, wie es ohne zusätzliche Zeile geht
  for (let mw = maxW - 8; lines.length > 1 && mw > maxW * 0.7; mw -= 8) {
    const l2 = wrap(g, text, mw);
    if (l2.length > lines.length) break;
    lines = l2;
  }
  const lh = size * 1.24;
  const y0 = y + h / 2 - ((lines.length - 1) * lh) / 2;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#2b1d0e';
  lines.forEach((l, i) => g.fillText(l, x + w / 2, y0 + i * lh));
  // Zierlinien über und unter dem Text (nur wenn Platz ist)
  const room = (h - lines.length * lh) / 2;
  if (room > 40) {
    for (const yy of [y0 - lh / 2 - room / 2, y0 + (lines.length - 0.5) * lh + room / 2]) {
      g.strokeStyle = lin(g, x + 60, 0, x + w - 60, 0, ['rgba(120,80,30,0)', 'rgba(120,80,30,0.55)', 'rgba(120,80,30,0)']);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x + 60, yy);
      g.lineTo(x + w - 60, yy);
      g.stroke();
      flat(g, poly([x + w / 2, yy - 6, x + w / 2 + 6, yy, x + w / 2, yy + 6, x + w / 2 - 6, yy]), 'rgba(120,80,30,0.6)');
    }
  }
}

// Zahlen mit Versalziffern (Georgia hat Mediävalziffern)
const NUM_FONT = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

// ATK/DEF-Plaketten (Sechseck mit spitzen Seiten), Schwert bzw. Schild als Zeichen
function stats(g, c, k) {
  for (const [i, label, val] of [[0, 'ATK', c.atk], [1, 'DEF', c.def]]) {
    const x = 34 + i * 228;
    const y = 624;
    const w = 216;
    const h = 66;
    const p = poly([x + 18, y, x + w - 18, y, x + w, y + h / 2, x + w - 18, y + h, x + 18, y + h, x, y + h / 2]);
    g.fillStyle = lin(g, 0, y, 0, y + h, [tone(k.ink, 0.2), k.ink, tone(k.ink, -0.4)]);
    g.fill(p);
    g.strokeStyle = lin(g, x, y, x + w, y + h, GOLD);
    g.lineWidth = 3;
    g.stroke(p);
    g.save();
    g.translate(x + 28, y + h / 2);
    g.scale(0.85, 0.85);
    g.fillStyle = lin(g, -12, -16, 12, 16, GOLD);
    g.strokeStyle = '#3a2408';
    g.lineWidth = 1.2;
    const icon = i === 0 ? P('M-2,-17 L2,-17 L2.5,6 L8,6 L8,9 L2,9 L2,14 L4,17 L-4,17 L-2,14 L-2,9 L-8,9 L-8,6 L-2.5,6 Z') : P('M0,-15 L12,-10 C12,4 8,12 0,16 C-8,12 -12,4 -12,-10 Z');
    g.fill(icon);
    g.stroke(icon);
    g.restore();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = 'bold 19px Georgia, serif';
    g.fillStyle = '#f2cf6a';
    g.fillText(label, x + 44, y + h / 2 + 1);
    g.textAlign = 'right';
    g.font = `bold 40px ${NUM_FONT}`;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(String(val), x + w - 20 + 1.5, y + h / 2 + 3.5);
    g.fillStyle = '#fbf0d4';
    g.fillText(String(val), x + w - 20, y + h / 2 + 2);
  }
}

// ---------- Schnittstelle ----------

// Ganze Vorderseite der Karte id auf den Kontext g (0, 0 bis w, h); unbekannte id → Rückseite
export function drawCard(g, id, w = FACE.w, h = FACE.h) {
  if (typeof id !== 'string' || !Object.hasOwn(CARD, id)) return drawBack(g, w, h);
  const c = CARD[id];
  const r = rng(id);
  const k = KINDS[c.kind === 'monster' ? (c.fx ? 'effect' : 'normal') : c.kind];
  g.save();
  g.scale(w / FACE.w, h / FACE.h);
  frame(g, k, r);
  namePlate(g, c, k);
  if (c.kind === 'monster') levelRow(g, c.level);
  else kindRow(g, c);
  picture(g, c, r);
  if (c.kind === 'monster') {
    typeLine(g, c, k);
    textBox(g, c, 486, 130, 27, r);
    stats(g, c, k);
  } else textBox(g, c, 452, 238, 34, r);
  g.restore();
}

// Rückseite des Kartenduells: dunkel, Bronze/Gold, Emblem mit sechs Element-Steinen
export function drawBack(g, w = FACE.w, h = FACE.h) {
  const r = rng('rueckseite');
  g.save();
  g.scale(w / FACE.w, h / FACE.h);
  frame(g, KINDS.effect, r);
  rr(g, 22, 22, 468, 672, 14);
  g.fillStyle = rad(g, 256, 358, 30, 420, ['#3a2614', '#1e130a', '#0c0704']);
  g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(240,200,120,0.08)';
  g.lineWidth = 1.5;
  for (let d = -716; d < 1300; d += 28) {
    g.beginPath();
    g.moveTo(d, 0);
    g.lineTo(d + 716, 716);
    g.moveTo(d, 716);
    g.lineTo(d + 716, 0);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = lin(g, 22, 22, 490, 694, GOLD);
  g.lineWidth = 3;
  rr(g, 32, 32, 448, 652, 10);
  g.stroke();
  g.lineWidth = 1.2;
  rr(g, 40, 40, 432, 636, 7);
  g.stroke();
  for (const [x, y] of [[40, 40], [472, 40], [40, 676], [472, 676]]) rhomb(g, x, y, 10, 10);
  const cx = 256;
  const cy = 330;
  // gekreuzte Klingen
  for (const s of [-1, 1]) {
    g.save();
    g.translate(cx, cy);
    g.rotate(s * 0.62);
    const blade = P('M-7,-170 L0,-190 L7,-170 L7,110 L-7,110 Z');
    g.fillStyle = lin(g, -7, 0, 7, 0, ['#9aa0a8', '#f4f6f8', '#7a8088']);
    g.fill(blade);
    g.strokeStyle = '#2a2a30';
    g.lineWidth = 1.5;
    g.stroke(blade);
    g.fillStyle = lin(g, -30, 0, 30, 0, GOLD);
    g.fillRect(-30, 110, 60, 10);
    g.fillRect(-5, 120, 10, 34);
    g.beginPath();
    g.arc(0, 160, 8, 0, TAU);
    g.fill();
    g.restore();
  }
  // Achtzackiger Stern
  const star = new Path2D();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU - Math.PI / 2;
    const rad2 = i % 2 ? 78 : 128;
    star[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad2, cy + Math.sin(a) * rad2);
  }
  star.closePath();
  g.fillStyle = lin(g, cx - 128, cy - 128, cx + 128, cy + 128, GOLD);
  g.fill(star);
  g.strokeStyle = '#3a2408';
  g.lineWidth = 2;
  g.stroke(star);
  g.beginPath();
  g.arc(cx, cy, 84, 0, TAU);
  g.fillStyle = rad(g, cx, cy, 10, 84, ['#3a1a0e', '#1a0c06']);
  g.fill();
  g.strokeStyle = lin(g, cx - 84, cy, cx + 84, cy, GOLD);
  g.lineWidth = 4;
  g.stroke();
  Object.entries(ELEM).forEach(([key, col], i) => {
    const a = (i / 6) * TAU - Math.PI / 2;
    gem(g, cx + Math.cos(a) * 60, cy + Math.sin(a) * 60, 12, col, key);
  });
  g.beginPath();
  g.arc(cx, cy, 30, 0, TAU);
  g.fillStyle = rad(g, cx - 8, cy - 10, 2, 34, ['#ffe9a0', '#e0a02a', '#7a4a08']);
  g.fill();
  g.strokeStyle = '#3a2408';
  g.lineWidth = 2;
  g.stroke();
  g.save();
  g.translate(cx, cy);
  g.fillStyle = '#5a2a06';
  g.fill(P('M0,-20 L5,-5 L20,0 L5,5 L0,20 L-5,5 L-20,0 L-5,-5 Z'));
  g.restore();
  // Schriftzug
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 40px Georgia, serif';
  g.letterSpacing = '6px';
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.fillText('KARTENDUELL', cx + 2, 556 + 3);
  g.fillStyle = lin(g, 0, 536, 0, 576, GOLD);
  g.fillText('KARTENDUELL', cx, 556);
  g.letterSpacing = '0px';
  g.strokeStyle = lin(g, 120, 0, 392, 0, ['rgba(240,200,110,0)', '#f0c86e', 'rgba(240,200,110,0)']);
  g.lineWidth = 2;
  for (const y of [528, 586]) {
    g.beginPath();
    g.moveTo(110, y);
    g.lineTo(402, y);
    g.stroke();
  }
  rhomb(g, cx, 528, 7, 7);
  rhomb(g, cx, 586, 7, 7);
  g.restore();
}

// Karte (id) bzw. Rückseite (id = null) passend skaliert auf ein beliebig großes <canvas> malen
export function paintCard(canvas, id) {
  const g = canvas.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (id == null) drawBack(g, canvas.width, canvas.height);
  else drawCard(g, id, canvas.width, canvas.height);
}
