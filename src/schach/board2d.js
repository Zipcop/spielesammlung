// 2D-Ansicht für Schach (Nico 28.10.2026: „während des Spiels zwischen 2D und 3D hin und her schalten“): ein flaches
// Brett mit selbst gezeichneten Figuren (flach.js) als HTML/SVG über der abgedunkelten 3D-Szene. withFlatView legt es
// als dünne Schicht um das 3D-Brett: Jeder Aufruf (sync, setMarks, setBadge, names, setHover, reset) geht an beide
// Bretter, Umschalten zeigt also sofort denselben Stand. Eingaben im 2D-Brett landen in denselben Wegen wie Klicks und
// das Hinstellen im 3D (onClick = Feld angeklickt, onDrop = Figur von → nach gezogen, onHover = Feld unter der Maus).
// Den Klack beim Ziehen spielt das 3D-Brett, das dahinter mitzieht (gleiche Dauer).
// Rechte Maustaste im 2D-Brett = eigene Pfeile und Markierungen (nur auf diesem PC, gehen nicht übers Netz).
import './board2d.css';
import { BADGES } from './badges.js';
import { squareXY, squareAtXY, piecesOf, arrowShape, pieceSvg, toggleDrawing, drawColor, DRAW_COLORS } from './flach.js';

const KEY = 'spielesammlung-schach-ansicht'; // '2d' oder '3d' – je PC gemerkt
const MOVE_MS = 450; // wie MOVE_S im 3D-Brett
const DRAG_PX = 4; // ab so viel Weg ist ein Klick ein Ziehen
const MOVE_WAIT_MS = 2500; // wie im 3D (tisch.js): so lange wartet eine abgestellte Figur auf den Zug, dann zurück
const ORDER = 'qrbnp'; // Geschlagene: wertvollste zuerst
const GAME_ARROW = '#2f8fff'; // Tipp-Pfeil wie im 3D
const NS = 'http://www.w3.org/2000/svg';

export function loadView() {
  try {
    return localStorage.getItem(KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

function saveView(view) {
  try {
    localStorage.setItem(KEY, view);
  } catch {
    // ohne Speicher gilt die Wahl nur bis zum Neuladen
  }
}

// SVG-Element mit Attributen
function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const pts = (list) => list.map((p) => p.join(',')).join(' ');

// me = Spieler dieses PCs (0/1): Hat er Schwarz, steht Schwarz unten
export function createFlatBoard({ me = 0, onClick, onDrop, onHover } = {}) {
  const root = document.createElement('div');
  root.className = 'c2d';
  root.hidden = true;
  root.innerHTML = `
    <div class="c2d-wrap">
      <div class="c2d-name" data-side="top"><span></span><i></i></div>
      <div class="c2d-board">
        <svg class="c2d-under" viewBox="0 0 8 8">
          <defs><radialGradient id="c2d-check"><stop offset="0" stop-color="#ff2a10" /><stop offset="0.45" stop-color="#ff2a10" stop-opacity="0.8" /><stop offset="1" stop-color="#ff2a10" stop-opacity="0" /></radialGradient></defs>
          <g data-squares></g><g data-marks></g><g data-coords></g>
        </svg>
        <div class="c2d-pieces"></div>
        <svg class="c2d-over" viewBox="0 0 8 8"><g data-targets></g><g data-arrows></g><g data-drawn></g></svg>
        <div class="c2d-badge" hidden></div>
      </div>
      <div class="c2d-name" data-side="bottom"><span></span><i></i></div>
    </div>`;
  const q = (name) => root.querySelector(`[data-${name}]`);
  const boardEl = root.querySelector('.c2d-board');
  const piecesBox = root.querySelector('.c2d-pieces');
  const badgeEl = root.querySelector('.c2d-badge');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) q('squares').append(svg('rect', { x, y, width: 1, height: 1, class: (x + y) % 2 ? 'dark' : 'light' }));
  (document.getElementById('scene') ?? document.body.firstChild).after(root); // gleich hinter der Leinwand: alles andere liegt darüber

  let shown = null; // zuletzt angezeigter Spielstand
  let flipped = false;
  let ui = { selected: null, targets: [], arrow: null };
  let hover = null;
  let badge = null; // { square, kind }
  let plates = null; // { labels, turn, viewer }
  let drawn = []; // eigene Zeichnungen { from, to, color }
  let drawing = null; // rechte Maustaste gedrückt: { from, to, color }
  let drag = null; // Figur mit der Maus gepackt: { from, el, x, y, moving, over }
  let dropped = null; // Feld, auf das gerade eine Figur gezogen wurde (gleitet dann nicht nochmal hin)
  const els = new Map(); // Feld → Figur

  // --- Figuren ---
  function place(el, square) {
    const { x, y } = squareXY(square, flipped);
    el.style.left = `${x * 12.5}%`;
    el.style.top = `${y * 12.5}%`;
  }

  function rebuild() {
    cancelDrag();
    piecesBox.textContent = '';
    els.clear();
    for (const p of piecesOf(shown.fen)) {
      const el = document.createElement('div');
      el.className = 'c2d-piece';
      el.innerHTML = pieceSvg(p.color, p.type);
      place(el, p.square);
      piecesBox.append(el);
      els.set(p.square, el);
    }
    drawCoords();
  }

  // Figur gleitet vom alten aufs neue Feld (sie steht schon dort, die Bewegung läuft rückwärts aus)
  function slide(square, from, delay = 0) {
    const el = els.get(square);
    if (!el) return;
    const a = squareXY(from, flipped);
    const b = squareXY(square, flipped);
    el.animate([{ transform: `translate(${(a.x - b.x) * 100}%, ${(a.y - b.y) * 100}%)` }, { transform: 'none' }], { duration: MOVE_MS, delay, easing: 'ease-in-out', fill: 'backwards' });
  }

  // Einen Zug zeigen: neue Stellung aufbauen, gezogene Figur (und bei der Rochade den Turm) gleiten lassen
  function step(uci) {
    const [from, to] = [uci.slice(0, 2), uci.slice(2, 4)];
    rebuild();
    if (dropped !== to) slide(to, from);
    const king = piecesOf(shown.fen).find((p) => p.square === to)?.type === 'k';
    const df = to.charCodeAt(0) - from.charCodeAt(0);
    if (king && Math.abs(df) === 2) slide((df > 0 ? 'f' : 'd') + to[1], (df > 0 ? 'h' : 'a') + to[1]); // Turm springt über den König
  }

  function sync(s) {
    if (!s || s === shown) return;
    const prev = shown;
    const sameMoves = (n) => prev && s.white === prev.white && prev.moves.length === n && prev.moves.every((m, i) => m === s.moves[i]);
    shown = s;
    flipped = s.white !== me; // eigene Farbe unten (Spieler 0 = dieser PC beim Host, allein und im Rätsel)
    if (sameMoves(s.moves.length - 1)) step(s.moves.at(-1));
    else if (!sameMoves(s.moves.length) || prev.fen !== s.fen || dropped) rebuild(); // dropped: Zug wurde abgelehnt
    dropped = null;
    drawMarks();
    drawNames();
  }

  // --- Markierungen ---
  function drawCoords() {
    const g = q('coords');
    g.textContent = '';
    for (let i = 0; i < 8; i++) {
      const file = squareAtXY(i, 7, flipped)[0];
      const rank = squareAtXY(0, i, flipped)[1];
      g.append(Object.assign(svg('text', { x: i + 0.95, y: 7.93, 'text-anchor': 'end', class: i % 2 ? 'ink-dark' : 'ink-light' }), { textContent: file }));
      g.append(Object.assign(svg('text', { x: 0.05, y: i + 0.23, class: i % 2 ? 'ink-light' : 'ink-dark' }), { textContent: rank }));
    }
  }

  function drawMarks() {
    for (const name of ['marks', 'targets', 'arrows', 'drawn']) q(name).textContent = '';
    if (!shown) return;
    const box = (square, attrs) => {
      const { x, y } = squareXY(square, flipped);
      q('marks').append(svg('rect', { x, y, width: 1, height: 1, ...attrs }));
    };
    const center = (square) => {
      const { x, y } = squareXY(square, flipped);
      return { cx: x + 0.5, cy: y + 0.5 };
    };
    if (shown.last) for (const sq of [shown.last.from, shown.last.to]) box(sq, { class: 'last' });
    if (shown.check) {
      const turn = shown.fen.split(' ')[1];
      const king = piecesOf(shown.fen).find((p) => p.type === 'k' && p.color === turn);
      if (king) box(king.square, { fill: 'url(#c2d-check)' });
    }
    if (ui.selected) box(ui.selected, { class: 'selected' });
    if (hover && hover !== ui.selected) box(hover, { class: 'hover' });
    if (drag?.moving && drag.over) box(drag.over, { class: 'over' });
    for (const t of ui.targets ?? []) {
      q('targets').append(svg('circle', { ...center(t.to), r: t.capture ? 0.44 : 0.15, class: t.capture ? 'c2d-ring' : 'c2d-dot' }));
    }
    // Pfeile des Spiels (Tipp, Rückblick) und anderer Helfer (arrows: [{ uci, color }]) – kräftig mit hellem Rand
    const game = [...(ui.arrow ? [{ uci: ui.arrow, color: GAME_ARROW }] : []), ...(ui.arrows ?? [])];
    for (const a of game) q('arrows').append(arrow(a.uci, a.color ?? GAME_ARROW, 0.2, 0.9, true));
    for (const c of ui.circles ?? []) q('arrows').append(svg('circle', { ...center(c.square), r: 0.44, fill: 'none', stroke: c.color ?? GAME_ARROW, 'stroke-width': 0.08, opacity: 0.9 }));
    // eigene Zeichnungen: halb durchsichtig und schmaler – so unterscheiden sie sich von den Pfeilen des Spiels
    for (const d of drawing ? toggleDrawing(drawn, drawing) : drawn) {
      const color = DRAW_COLORS[d.color];
      if (d.from === d.to) q('drawn').append(svg('circle', { ...center(d.from), r: 0.45, fill: 'none', stroke: color, 'stroke-width': 0.07, opacity: 0.55 }));
      else q('drawn').append(arrow(d.from + d.to, color, 0.15, 0.5, false));
    }
  }

  function arrow(uci, color, width, opacity, rim) {
    const { line, head } = arrowShape(uci, flipped);
    const g = svg('g', { opacity });
    const shaft = (stroke, w) => svg('polyline', { points: pts(line), fill: 'none', stroke, 'stroke-width': w, 'stroke-linejoin': 'round' });
    const tip = (stroke, w) => svg('polygon', { points: pts(head), fill: stroke, stroke, 'stroke-width': w, 'stroke-linejoin': 'round' });
    if (rim) g.append(shaft('#fff', width + 0.08), tip('#fff', 0.08));
    g.append(shaft(color, width), tip(color, 0.001));
    return g;
  }

  function drawBadge() {
    badgeEl.hidden = !badge;
    if (!badge) return;
    const { x, y } = squareXY(badge.square, flipped);
    badgeEl.style.left = `${(x + 1) * 12.5}%`;
    badgeEl.style.top = `${y * 12.5}%`;
    badgeEl.style.background = BADGES[badge.kind].color;
    badgeEl.textContent = BADGES[badge.kind].symbol;
  }

  // Namen über und unter dem Brett (unten der Zuschauer), daneben, was er geschlagen hat
  function drawNames() {
    for (const side of ['top', 'bottom']) {
      const el = q(`side="${side}"`);
      const color = plates && (side === 'bottom' ? plates.viewer : 1 - plates.viewer); // 0 = Weiß, 1 = Schwarz
      el.style.visibility = plates ? '' : 'hidden';
      if (!plates) continue;
      el.classList.toggle('turn', plates.turn === color);
      el.querySelector('span').textContent = plates.labels[color] ?? '';
      const taken = (shown?.captured ?? []).filter((c) => c[0] === (color === 0 ? 'b' : 'w')).sort((a, b) => ORDER.indexOf(a[1]) - ORDER.indexOf(b[1]));
      const key = taken.join();
      const box = el.querySelector('i');
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = taken.map((c) => pieceSvg(c[0], c[1])).join('');
      }
    }
  }

  // --- Eingaben ---
  // Brett im 3D umgeworfen (tisch.js): das Spiel nimmt bis „Aufbauen“ keine Klicks an – im 2D genauso
  const resting = () => document.body.classList.contains('tisch-chaos');
  const squareOf = (e) => {
    const r = boardEl.getBoundingClientRect();
    return squareAtXY(((e.clientX - r.left) / r.width) * 8, ((e.clientY - r.top) / r.height) * 8, flipped);
  };

  function cancelDrag() {
    if (!drag) return;
    const { el, from } = drag;
    drag = null;
    el.classList.remove('dragging');
    const was = el.style.transform;
    el.style.transform = '';
    if (was && el.isConnected) {
      place(el, from);
      el.animate([{ transform: was }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
    }
  }

  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('pointerdown', (e) => {
    if (e.button === 2) { // Pfeil oder Markierung beginnen
      const sq = squareOf(e);
      drawing = sq ? { from: sq, to: sq, color: drawColor(e) } : null;
      if (drawing) root.setPointerCapture(e.pointerId);
      return drawMarks();
    }
    if (e.button !== 0 || resting()) return;
    drawn = []; // Linksklick löscht die eigenen Zeichnungen
    const sq = squareOf(e);
    onClick?.(sq); // wie ein Klick im 3D – das Spiel antwortet mit setMarks
    const el = sq && ui.selected === sq && els.get(sq);
    if (el) {
      drag = { from: sq, el, x: e.clientX, y: e.clientY, moving: false, over: null };
      const r = boardEl.getBoundingClientRect(); // Feld statt Figur messen: Die Figur kann gerade noch gleiten
      const s = r.width / 8;
      const { x, y } = squareXY(sq, flipped);
      el.style.transformOrigin = `${e.clientX - r.left - x * s}px ${e.clientY - r.top - y * s}px`; // gepackter Punkt
      for (const a of el.getAnimations()) a.finish(); // gleitet sie noch (gleich wieder gepackt), läge die Animation über dem Ziehen
      root.setPointerCapture(e.pointerId);
    }
    drawMarks();
  });

  root.addEventListener('pointermove', (e) => {
    if (drawing) {
      const sq = squareOf(e);
      if (sq && sq !== drawing.to) {
        drawing.to = sq;
        drawMarks();
      }
      return;
    }
    if (drag) {
      if (!drag.moving && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > DRAG_PX) {
        drag.moving = true;
        drag.el.classList.add('dragging');
      }
      if (!drag.moving) return;
      // Weg seit dem Greifen: Die Figur bleibt mit dem gepackten Punkt unter der Maus (Vergrößern um genau diesen Punkt)
      drag.el.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px) scale(1.12)`;
      root.style.cursor = 'grabbing';
      const over = squareOf(e);
      if (over !== drag.over) {
        drag.over = over;
        drawMarks();
      }
      return;
    }
    root.style.cursor = onHover?.(squareOf(e)) || '';
  });

  root.addEventListener('pointerup', (e) => {
    if (e.button === 2 && drawing) {
      const sq = squareOf(e);
      if (sq) drawn = toggleDrawing(drawn, { ...drawing, to: sq }); // daneben losgelassen = nichts
      drawing = null;
      return drawMarks();
    }
    if (e.button !== 0 || !drag) return;
    const { from, el, moving } = drag;
    root.style.cursor = '';
    if (!moving) {
      drag = null;
      return drawMarks();
    }
    const to = squareOf(e);
    dropped = to;
    drag = null;
    el.classList.remove('dragging');
    const answer = to && to !== from && !resting() ? onDrop?.(from, to) : 'back'; // 'move' = Zug, sonst zurück aufs Feld
    if (answer === 'move' && el.isConnected && shown && els.get(from) === el) {
      el.style.transform = ''; // Gast: Figur bleibt auf dem Ziel, bis der Host antwortet
      place(el, to);
      const was = shown;
      setTimeout(() => {
        if (shown !== was || els.get(from) !== el) return; // gezogen (oder neu aufgebaut)
        dropped = null; // das Spiel hat nicht gezogen (z. B. ohne Hilfen auf eine eigene Figur) → zurück aufs Feld
        place(el, from);
      }, MOVE_WAIT_MS);
    } else if (answer !== 'move') {
      dropped = null;
      drag = { from, el };
      cancelDrag();
    }
    drawMarks();
  });

  root.addEventListener('pointercancel', () => {
    drawing = null;
    cancelDrag();
    drawMarks();
  });

  return {
    sync,
    // ui = { selected, targets: [{ to, capture }], arrow: 'e2e4', arrows: [{ uci, color }], circles: [{ square, color }] }
    setMarks(next) {
      ui = next;
      drawMarks();
    },
    setHover(square) {
      if (square === hover) return;
      hover = square;
      drawMarks();
    },
    setBadge(square, kind) {
      badge = square && kind ? { square, kind } : null;
      drawBadge();
    },
    // labels = [Weiß, Schwarz], turn = 0/1 oder null, viewer = 0/1 (Farbe des Zuschauers)
    names(labels, turn, viewer) {
      plates = labels?.some(Boolean) ? { labels, turn, viewer } : null;
      drawNames();
    },
    reset() {
      shown = null;
      ui = { selected: null, targets: [], arrow: null };
      hover = badge = plates = null;
      drawn = [];
      drawing = null;
      dropped = null;
      cancelDrag();
      piecesBox.textContent = '';
      els.clear();
      drawMarks();
      drawBadge();
      drawNames();
    },
    show(on) {
      if (!on) {
        drawing = null;
        cancelDrag();
        drawMarks();
      }
      root.hidden = !on;
    },
    remove: () => root.remove(),
  };
}

// Umschalter 2D ↔ 3D um das 3D-Brett: liefert ein Brett mit derselben Schnittstelle (alle Aufrufe gehen an beide),
// dazu Knopf „2D/3D“ neben dem „?“ und Taste V. handlers = { me, onClick, onDrop, onHover } für die 2D-Eingaben.
// Zusätzlich: flat (das 2D-Brett) und removeFlat() (beim Spielende aufrufen).
export function withFlatView(board, handlers) {
  const flat = createFlatBoard(handlers);
  const button = document.createElement('button');
  button.className = 'icon c2d-switch';
  const help = document.getElementById('btn-help');
  if (help) help.after(button);
  else document.body.append(button);
  let on = false;
  function set(next) {
    on = next;
    flat.show(on);
    button.textContent = on ? '3D' : '2D';
    button.title = on ? 'Zurück zum 3D-Tisch (Taste V)' : 'Flaches 2D-Brett (Taste V)';
    button.setAttribute('aria-label', button.title);
    saveView(on ? '2d' : '3d');
  }
  button.onclick = () => set(!on);
  const onKey = (e) => {
    if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    set(!on);
  };
  window.addEventListener('keydown', onKey);
  set(loadView() === '2d');

  const extra = {
    flat,
    removeFlat() {
      window.removeEventListener('keydown', onKey);
      button.remove();
      flat.remove();
    },
  };
  return new Proxy(board, {
    get(target, key) {
      if (key in extra) return extra[key];
      const value = target[key];
      if (typeof value !== 'function' || typeof flat[key] !== 'function') return value;
      return (...args) => {
        const result = value(...args);
        flat[key](...args);
        return result;
      };
    },
  });
}
