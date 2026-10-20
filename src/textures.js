// Prozedurale Texturen (Canvas) – keine Bilddateien, also auch keine Lizenzfragen.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);

export function canvasTexture(w, h, draw, { repeat, color = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  tex.anisotropy = 8;
  return tex;
}

// Maserung: viele leicht gewellte Linien in unterschiedlicher Helligkeit
function grain(g, x, y, w, h, lines) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < lines; i++) {
    const ly = y + Math.random() * h;
    const amp = rand(1, 5);
    const freq = rand(0.004, 0.014);
    const phase = rand(0, 10);
    g.strokeStyle = Math.random() < 0.55
      ? `rgba(30, 15, 5, ${rand(0.05, 0.2)})`
      : `rgba(220, 160, 100, ${rand(0.03, 0.1)})`;
    g.lineWidth = rand(0.5, 2.5);
    g.beginPath();
    for (let lx = x; lx <= x + w; lx += 16) g.lineTo(lx, ly + Math.sin(lx * freq + phase) * amp);
    g.stroke();
  }
  g.restore();
}

// Holz mit Brettern: boards = Anzahl Bretter übereinander, joints = versetzte Stöße wie beim Dielenboden
export function woodTexture({ base = '#7a4a28', boards = 4, joints = false, size = 1024, repeat } = {}) {
  return canvasTexture(size, size, (g, w, h) => {
    const bh = h / boards;
    for (let b = 0; b < boards; b++) {
      const shade = rand(-14, 14);
      g.fillStyle = base;
      g.fillRect(0, b * bh, w, bh);
      g.fillStyle = shade > 0 ? `rgba(255, 220, 180, ${shade / 140})` : `rgba(0, 0, 0, ${-shade / 100})`;
      g.fillRect(0, b * bh, w, bh);
      grain(g, 0, b * bh, w, bh, 70);
      g.fillStyle = 'rgba(15, 8, 3, 0.55)';
      g.fillRect(0, b * bh - 1, w, 2);
      if (joints) {
        const x = ((b * 0.37) % 1) * w;
        g.fillRect(x - 1, b * bh, 2, bh);
      }
    }
  }, { repeat });
}

// base = Grundfarbe, ink = Farbe von Streifen und Muster (r, g, b)
export function wallpaperTexture({ base = '#3d4636', ink = '205, 170, 100' } = {}) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = `rgba(${ink}, 0.10)`;
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 3, h);
    g.fillStyle = `rgba(${ink}, 0.16)`;
    for (let y = 16; y < h; y += 64) {
      for (let x = 16; x < w; x += 32) {
        g.beginPath();
        g.ellipse(x + ((y / 64) % 2) * 16, y, 4, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(0, 0, 0, ${rand(0, 0.06)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  }, { repeat: [10, 4] });
}

// field = Innenfeld, border = breites Band, gold = Zierlinien und Rauten
export function rugTexture({ field = '#6e2219', border = '#1f2a44', gold = '200, 150, 62' } = {}) {
  return canvasTexture(1024, 768, (g, w, h) => {
    g.fillStyle = field;
    g.fillRect(0, 0, w, h);
    const band = (inset, width, color) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
    };
    // Rautenmuster im Innenfeld
    g.strokeStyle = `rgba(${gold}, 0.35)`;
    g.lineWidth = 3;
    for (let x = -h; x < w + h; x += 70) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
      g.stroke();
    }
    g.fillStyle = field; // Rand frei lassen
    g.fillRect(0, 0, w, 96);
    g.fillRect(0, h - 96, w, 96);
    g.fillRect(0, 0, 96, h);
    g.fillRect(w - 96, 0, 96, h);
    band(30, 26, border);
    band(62, 8, `rgb(${gold})`);
    band(90, 4, `rgb(${gold})`);
    // Webstruktur
    for (let i = 0; i < 40000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0, 0, 0, ${rand(0, 0.12)})` : `rgba(255, 220, 180, ${rand(0, 0.05)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    }
  });
}

// Filz in den Farben aus FELTS (Würfelschale, Würfelteller, Casino-Tisch)
export const FELTS = { gruen: ['#1d5a3c', '150, 220, 170'], rot: ['#6a1a1e', '230, 150, 150'], blau: ['#1b3a66', '150, 180, 230'] };

const feltCache = new Map();
// Dieselbe Filz-Textur für alle, die denselben Filz wollen
export function feltOf(name) {
  if (!feltCache.has(name)) feltCache.set(name, feltTexture(name));
  return feltCache.get(name);
}

export function feltTexture(name = 'gruen') {
  const [base, light] = FELTS[name] ?? FELTS.gruen;
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60000; i++) {
      g.fillStyle = Math.random() < 0.5 ? `rgba(0, 0, 0, ${rand(0, 0.1)})` : `rgba(${light}, ${rand(0, 0.05)})`;
      g.fillRect(Math.random() * w, Math.random() * h, rand(1, 3), 1);
    }
  }, { repeat: [2, 2] });
}

// Nachthimmel fürs Fenster
export function nightTexture() {
  return canvasTexture(256, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1230');
    sky.addColorStop(1, '#25305a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255, 255, 230, ${rand(0.3, 0.9)})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.8, 1.5, 1.5);
    }
    const moon = g.createRadialGradient(180, 110, 4, 180, 110, 60);
    moon.addColorStop(0, 'rgba(255, 250, 225, 1)');
    moon.addColorStop(0.3, 'rgba(255, 250, 225, 0.9)');
    moon.addColorStop(0.35, 'rgba(200, 210, 255, 0.25)');
    moon.addColorStop(1, 'rgba(200, 210, 255, 0)');
    g.fillStyle = moon;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#05070f'; // Baumsilhouetten
    for (let x = 0; x < w; x += 18) {
      const th = rand(40, 110);
      g.beginPath();
      g.moveTo(x - 14, h);
      g.lineTo(x + 4, h - th);
      g.lineTo(x + 22, h);
      g.fill();
    }
  });
}

// Bild an der Wand: Abendlandschaft
export function paintingTexture() {
  return canvasTexture(512, 384, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, '#2c3e63');
    sky.addColorStop(1, '#d98e4a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const hill = (y, color, amp) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.012 + amp) * amp * 6);
      g.lineTo(w, h);
      g.fill();
    };
    hill(h * 0.55, '#4b4a5e', 3);
    hill(h * 0.68, '#2f3b2c', 2);
    hill(h * 0.8, '#1d2619', 4);
  });
}

// Kniffel-Block als Deko auf dem Tisch
export function blockTexture() {
  return canvasTexture(256, 360, (g, w, h) => {
    g.fillStyle = '#f3ecdc';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3261e';
    g.fillRect(0, 0, w, 54);
    g.fillStyle = '#fff6e0';
    g.font = 'bold 34px Georgia';
    g.textAlign = 'center';
    g.fillText('KNIFFEL', w / 2, 39);
    g.strokeStyle = 'rgba(60, 40, 20, 0.5)';
    g.lineWidth = 1;
    for (let y = 70; y < h; y += 19) {
      g.beginPath();
      g.moveTo(10, y);
      g.lineTo(w - 10, y);
      g.stroke();
    }
    for (const x of [110, 160, 210]) {
      g.beginPath();
      g.moveTo(x, 60);
      g.lineTo(x, h - 10);
      g.stroke();
    }
  });
}

// Schachbrett von oben, aus Sicht von Weiß (a1 unten links): Ahorn- und Nussbaumfelder,
// dunkler Rahmen mit Buchstaben und Zahlen – für Schwarz zusätzlich auf dem Kopf.
// border = Rahmenbreite im Verhältnis zur Feldgröße
export function chessBoardTexture(border) {
  return canvasTexture(1024, 1024, (g, w) => {
    const sq = w / (8 + 2 * border);
    const edge = sq * border;
    g.fillStyle = '#3b2213';
    g.fillRect(0, 0, w, w);
    grain(g, 0, 0, w, w, 160);
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const x = edge + f * sq;
        const y = edge + (7 - r) * sq;
        g.fillStyle = (f + r) % 2 ? '#dcb987' : '#6e4122';
        g.fillRect(x, y, sq, sq);
        grain(g, x, y, sq, sq, 14);
      }
    }
    g.strokeStyle = 'rgba(230, 200, 150, 0.7)'; // feine Einlegearbeit um die Felder
    g.lineWidth = 3;
    g.strokeRect(edge - 5, edge - 5, 8 * sq + 10, 8 * sq + 10);

    g.fillStyle = 'rgba(235, 210, 165, 0.85)';
    g.font = `${Math.round(edge * 0.5)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const label = (text, x, y, flip) => {
      g.save();
      g.translate(x, y);
      if (flip) g.rotate(Math.PI);
      g.fillText(text, 0, 0);
      g.restore();
    };
    for (let k = 0; k < 8; k++) {
      const along = edge + (k + 0.5) * sq;
      label('abcdefgh'[k], along, w - edge / 2, false);
      label('abcdefgh'[k], along, edge / 2, true);
      label(String(8 - k), edge / 2, along, false);
      label(String(8 - k), w - edge / 2, along, true);
    }
  });
}

// Weicher runder Schein (z. B. rot unter dem König im Schach)
export function glowTexture() {
  return canvasTexture(128, 128, (g, w) => {
    const glow = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.45, 'rgba(255, 255, 255, 0.6)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, w);
  });
}

// Vorderseite einer Spielschachtel: Name groß, Kategorie klein, spielbare mit grünem Punkt
// 384 px breit reicht auch auf 4K-Bildschirmen und spart bei ~80 Schachteln Grafikspeicher – gezeichnet wird in 512er-Maßen
export function boxLabelTexture(name, category, color, playable, aspect) {
  return canvasTexture(384, Math.round(384 / aspect), (g) => {
    g.scale(384 / 512, 384 / 512);
    const [w, h] = [512, 512 / aspect];
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const shade = g.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255, 236, 200, 0.6)';
    g.lineWidth = 3;
    g.strokeRect(8, 8, w - 16, h - 16);

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff3dc';
    const r = h * 0.13; // grüner Punkt oben rechts (spielbar) – der Name bleibt links und rechts davon frei
    const room = playable ? w - 2 * (18 + r * 2.6) - 10 : w - 70;
    let size = h * 0.48;
    do {
      g.font = `bold ${size}px Georgia, serif`;
      size -= 2;
    } while (g.measureText(name).width > room && size > 16);
    g.fillText(name, w / 2, h * 0.44);
    g.font = `${Math.round(h * 0.14)}px Georgia, serif`;
    g.fillStyle = 'rgba(255, 236, 200, 0.75)';
    g.fillText(category.toUpperCase(), w / 2, h * 0.8);

    if (playable) {
      g.fillStyle = '#4fbf5a';
      g.strokeStyle = '#fff3dc';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(w - 18 - r * 1.6, 18 + r * 1.6, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  });
}

// Messingschild für eine Fach-Spalte
export function plaqueTexture(text) {
  return canvasTexture(320, 64, (g, w, h) => {
    const brass = g.createLinearGradient(0, 0, 0, h);
    brass.addColorStop(0, '#d8b46a');
    brass.addColorStop(1, '#9a7434');
    g.fillStyle = brass;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3a2810';
    g.font = 'bold 30px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
};

// Würfel-Designs: [Grundfarbe, Augenfarbe]
export const DICE_STYLES = { weiss: ['#f6f1e7', '#151515'], elfenbein: ['#ead9b2', '#3b2414'], rot: ['#a8221b', '#f6f1e7'], schwarz: ['#1d1d1f', '#f2efe8'] };
const diceCache = new Map();

// Alle 6 Seiten in einem Design (zwischengespeichert)
export function diceFaces(style = 'weiss') {
  if (!diceCache.has(style)) diceCache.set(style, [1, 2, 3, 4, 5, 6].map((v) => pipTextures(v, ...(DICE_STYLES[style] ?? DICE_STYLES.weiss))));
  return diceCache.get(style);
}

// Würfelseite: Farbe + Bump-Map (Augen leicht vertieft)
export function pipTextures(value, paperColor = '#f6f1e7', pipColor = '#151515') {
  const draw = (paper, pip) => (g, w) => {
    g.fillStyle = paper;
    g.fillRect(0, 0, w, w);
    for (const [x, y] of PIPS[value]) {
      const grad = g.createRadialGradient(x * w, y * w, 0, x * w, y * w, 22);
      grad.addColorStop(0, pip);
      grad.addColorStop(0.8, pip);
      grad.addColorStop(1, paper);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x * w, y * w, 22, 0, Math.PI * 2);
      g.fill();
    }
  };
  return {
    map: canvasTexture(256, 256, draw(paperColor, pipColor)),
    bumpMap: canvasTexture(256, 256, draw('#ffffff', '#000000'), { color: false }),
  };
}

// Himmel fürs Fenster bei Tag: Blau mit Wolken, Wiese und Bäumen
export function dayTexture() {
  return canvasTexture(256, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5e9ad8');
    sky.addColorStop(0.75, '#bfe0f4');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { // Wolken aus weichen Kreisen
      const cx = rand(0, w);
      const cy = rand(40, h * 0.5);
      for (let k = 0; k < 7; k++) {
        const r = rand(14, 30);
        const blob = g.createRadialGradient(cx + k * 12 - 36, cy + rand(-6, 6), 0, cx + k * 12 - 36, cy, r);
        blob.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
        blob.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = blob;
        g.fillRect(0, 0, w, h);
      }
    }
    g.fillStyle = '#5f8f3e';
    g.fillRect(0, h * 0.86, w, h);
    for (let x = 0; x < w; x += 22) { // Laubbäume
      const ty = h * 0.86 - rand(30, 70);
      g.fillStyle = '#3d5f2a';
      g.beginPath();
      g.ellipse(x + 10, ty, rand(12, 18), rand(22, 34), 0, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// Himmel am Abend: Sonnenuntergang mit dunklen Bäumen
export function eveningTexture() {
  return canvasTexture(256, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2b2c5a');
    sky.addColorStop(0.45, '#b4566b');
    sky.addColorStop(0.75, '#f0a050');
    sky.addColorStop(1, '#f6c46a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(90, h * 0.8, 6, 90, h * 0.8, 90);
    sun.addColorStop(0, 'rgba(255, 236, 170, 1)');
    sun.addColorStop(0.25, 'rgba(255, 210, 120, 0.8)');
    sun.addColorStop(1, 'rgba(255, 160, 80, 0)');
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1220';
    for (let x = 0; x < w; x += 18) {
      const th = rand(40, 110);
      g.beginPath();
      g.moveTo(x - 14, h);
      g.lineTo(x + 4, h - th);
      g.lineTo(x + 22, h);
      g.fill();
    }
  });
}

// Bruchstein für den Kamin
export function stoneTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#4a4440';
    g.fillRect(0, 0, w, h);
    const rows = 7;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rand(20, 50) : 0;
      while (x < w) {
        const sw = rand(60, 110);
        const tone = Math.round(rand(95, 150));
        g.fillStyle = `rgb(${tone}, ${tone - 8}, ${tone - 16})`;
        g.beginPath();
        g.roundRect(x + 3, r * rh + 3, sw - 6, rh - 6, 10);
        g.fill();
        for (let i = 0; i < 80; i++) {
          g.fillStyle = `rgba(0, 0, 0, ${rand(0, 0.12)})`;
          g.fillRect(x + rand(4, sw - 8), r * rh + rand(4, rh - 8), 3, 2);
        }
        x += sw;
      }
    }
  }, { repeat: [1, 1] });
}
