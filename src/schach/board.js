// Schachbrett mit Staunton-Figuren auf dem Spieltisch. Kennt keine Regeln: zeigt den Stand
// (Stellung, letzter Zug, Schach, geschlagene Figuren), lässt Figuren gleiten und sagt, welches
// Feld unter der Maus liegt. Maße in Zentimetern – die Gruppe ist auf 1/100 skaliert (Szene in Metern).
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { createPieceGeometries } from './pieces.js';
import { chessBoardTexture, glowTexture, woodTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { setGlow } from '../glow.js';
import { BADGES } from './badges.js';

const SQ = 5; // Feldgröße
const BORDER = 0.5; // Rahmen = halbes Feld
const SIZE = (8 + 2 * BORDER) * SQ;
const THICK = 1.8; // Brettdicke
const MOVE_S = 0.45; // Dauer eines Zugs
const HOP = 4; // so hoch springt der Springer
const LIFT = 6; // geschlagene Figuren werden angehoben und beiseitegestellt
const ORDER = 'qrbnp'; // neben dem Brett: wertvollste zuerst
const FILES = 'abcdefgh';
const START = new Chess().fen();

// Feldmitte in Brett-Koordinaten: Weiß sitzt auf der +z-Seite, die a-Linie liegt links (−x)
function spot(square) {
  return new THREE.Vector3((FILES.indexOf(square[0]) - 3.5) * SQ, THICK, (3.5 - (square[1] - 1)) * SQ);
}

// Platz für die k-te geschlagene Figur einer Farbe: auf dem Tisch links neben dem, der sie geschlagen hat
function besideSpot(color, k) {
  const side = color === 'b' ? -1 : 1; // schwarze Figuren schlägt Weiß, und Weiß sitzt auf +z
  return new THREE.Vector3(side * (SIZE / 2 + 3.2 + Math.floor(k / 8) * 4), 0, -side * (19 - (k % 8) * 4.2));
}

export function createChessBoard(parent) {
  const group = new THREE.Group();
  group.scale.setScalar(0.01);
  parent.add(group);

  const top = new THREE.MeshStandardMaterial({ map: chessBoardTexture(BORDER), roughness: 0.35 });
  const edge = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#3b2213', boards: 1 }), roughness: 0.45 });
  const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(SIZE, THICK, SIZE), [edge, edge, top, edge, edge, edge]);
  boardMesh.position.y = THICK / 2;
  boardMesh.castShadow = boardMesh.receiveShadow = true;
  group.add(boardMesh);

  const geometries = createPieceGeometries();
  // Figuren-Sets (Design dieses PCs). Metall braucht mehr Spiegelung, sonst wirkt es im dunklen Zimmer stumpf.
  const SETS = {
    holz: { w: { color: 0xe8cd9b, roughness: 0.42, metalness: 0, clearcoat: 0.5, envMapIntensity: 1 }, b: { color: 0x2a1a12, roughness: 0.36, metalness: 0, clearcoat: 0.75, envMapIntensity: 1 } },
    marmor: { w: { color: 0xf1eee6, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 }, b: { color: 0x202127, roughness: 0.16, metalness: 0, clearcoat: 1, envMapIntensity: 2 } },
    metall: { w: { color: 0xd8d9de, roughness: 0.28, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 }, b: { color: 0xc59a3c, roughness: 0.3, metalness: 1, clearcoat: 0.2, envMapIntensity: 8 } },
  };
  const dress = (material, look) => {
    const { color, ...rest } = look;
    material.color.setHex(color);
    Object.assign(material, rest);
  };
  const woods = {
    w: new THREE.MeshPhysicalMaterial({ color: 0xe8cd9b, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    b: new THREE.MeshPhysicalMaterial({ color: 0x2a1a12, roughness: 0.36, clearcoat: 0.75, clearcoatRoughness: 0.22 }),
  };
  const pieces = new THREE.Group();
  const marks = new THREE.Group();
  group.add(pieces, marks);

  let shown = null; // zuletzt angezeigter Spielstand
  let anims = [];
  let ui = { selected: null, targets: [], arrow: null };
  let hover = null;

  // --- Figuren ---
  // square = Feld auf dem Brett, null = geschlagen (steht daneben)
  function addPiece(color, type, square) {
    const m = new THREE.Mesh(geometries[type], woods[color].clone()); // eigenes Material fürs Aufleuchten
    m.castShadow = m.receiveShadow = true;
    m.rotation.y = color === 'b' ? Math.PI : 0; // Springer: Weiß schaut nach links, Schwarz aus seiner Sicht auch
    m.userData = { color, type, square };
    pieces.add(m);
    return m;
  }

  const at = (square) => pieces.children.find((p) => p.userData.square === square);

  function rebuild(fen, captured) {
    finish();
    hover = null; // Figuren werden neu angelegt
    setGlow('hover', []);
    pieces.children.forEach((p) => p.material.dispose());
    pieces.clear();
    for (const row of new Chess(fen, { skipValidation: true }).board()) { // ohne Hilfen sind auch regelwidrige Stellungen möglich
      for (const p of row) if (p) addPiece(p.color, p.type, p.square).position.copy(spot(p.square));
    }
    for (const c of captured) addPiece(c[0], c[1], null);
    layoutBeside(false);
  }

  // Geschlagene Figuren ordentlich neben das Brett stellen
  function layoutBeside(animate) {
    for (const color of ['w', 'b']) {
      pieces.children
        .filter((p) => p.userData.square === null && p.userData.color === color)
        .sort((a, b) => ORDER.indexOf(a.userData.type) - ORDER.indexOf(b.userData.type))
        .forEach((p, k) => {
          const to = besideSpot(color, k);
          if (!animate) return p.position.copy(to);
          if (p.position.distanceTo(to) > 0.01) glide(p, to, p.position.y > 0.5 ? LIFT : 0); // gerade vom Brett genommen → anheben
        });
    }
  }

  // Einen Zug ausführen: Figur gleitet (Springer hüpft), Geschlagenes kommt neben das Brett
  function step(fenBefore, uci, state) {
    finish();
    let m;
    try {
      m = new Chess(fenBefore, { skipValidation: true }).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return forcedStep(uci, state); // regelwidriger Zug (ohne Hilfen)
    }
    const mover = at(m.from);
    const victim = m.captured && at(m.isEnPassant() ? m.to[0] + m.from[1] : m.to);
    if (!mover || (m.captured && !victim)) return rebuild(state.fen, state.captured); // Anzeige passt nicht → neu aufbauen
    if (victim) victim.userData.square = null;
    if (m.isKingsideCastle() || m.isQueensideCastle()) {
      const [from, to] = m.isKingsideCastle() ? ['h', 'f'] : ['a', 'd'];
      const rook = at(from + m.from[1]);
      rook.userData.square = to + m.from[1];
      glide(rook, spot(rook.userData.square), 0, 0.2, (instant) => instant || playHit('wood', 0.6));
    }
    mover.userData.square = m.to;
    glide(mover, spot(m.to), m.piece === 'n' ? HOP : 0, m.captured ? 0.15 : 0, (instant) => {
      if (m.promotion) {
        mover.geometry = geometries[m.promotion];
        mover.userData.type = m.promotion;
      }
      if (!instant) playHit('wood', m.captured ? 1 : 0.75);
    });
    layoutBeside(true);
  }

  // Regelwidriger Zug: Figur hüpft einfach hinüber, Geschlagenes kommt neben das Brett. Sonderfälle
  // (Umwandlung, mitgenommener Turm) werden direkt aus dem Stand aufgebaut.
  function forcedStep(uci, state) {
    const [from, to] = [uci.slice(0, 2), uci.slice(2, 4)];
    const mover = at(from);
    const special = uci.length > 4 || (mover?.userData.type === 'k' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2);
    if (!mover || special) return rebuild(state.fen, state.captured);
    const victim = at(to);
    if (victim) victim.userData.square = null;
    mover.userData.square = to;
    glide(mover, spot(to), HOP, victim ? 0.15 : 0, (instant) => instant || playHit('wood', victim ? 1 : 0.75));
    layoutBeside(true);
  }

  // --- Bewegung ---
  function glide(mesh, to, hop = 0, delay = 0, onEnd) {
    anims = anims.filter((a) => a.mesh !== mesh);
    anims.push({ mesh, from: mesh.position.clone(), to: to.clone(), hop, t: -delay / MOVE_S, onEnd });
  }

  function update(dt) {
    for (const a of anims) {
      a.t = Math.min(a.t + dt / MOVE_S, 1);
      const t = Math.max(a.t, 0);
      a.mesh.position.lerpVectors(a.from, a.to, t * t * (3 - 2 * t));
      a.mesh.position.y += Math.sin(t * Math.PI) * a.hop;
      if (a.t === 1) a.onEnd?.(false);
    }
    anims = anims.filter((a) => a.t < 1);
  }

  // Laufende Bewegungen sofort beenden (z. B. wenn schon der nächste Zug kommt)
  function finish() {
    for (const a of anims) {
      a.mesh.position.copy(a.to);
      a.onEnd?.(true);
    }
    anims = [];
  }

  // --- Markierungen: letzter Zug, Schach, gewählte Figur, erlaubte Ziele, Tipp-Pfeil ---
  const mat = (color, opacity, map = null) => new THREE.MeshBasicMaterial({ color, opacity, map, transparent: true, depthWrite: false });
  const LOOK = {
    last: mat(0xffc531, 0.55),
    selected: mat(0x8fe07a, 0.5),
    target: mat(0x2f8f3f, 0.75),
    check: mat(0xff2a10, 0.95, glowTexture()),
    arrow: Object.assign(mat(0x2f8fff, 0.75), { depthTest: false }), // Pfeil liegt sichtbar über den Figuren
  };
  const flat = (size) => new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
  const SHAPES = {
    square: flat(SQ),
    glow: flat(SQ * 1.6),
    dot: new THREE.CircleGeometry(0.85, 24).rotateX(-Math.PI / 2),
    ring: new THREE.RingGeometry(1.95, 2.45, 40).rotateX(-Math.PI / 2),
  };

  function drawMarks() {
    marks.children.filter((m) => m.userData.own).forEach((m) => m.geometry.dispose());
    marks.clear();
    const put = (shape, look, square, lift) => {
      const m = new THREE.Mesh(SHAPES[shape], LOOK[look]);
      m.position.copy(spot(square));
      m.position.y += lift;
      marks.add(m);
    };
    if (shown?.last) for (const sq of [shown.last.from, shown.last.to]) put('square', 'last', sq, 0.05);
    if (shown?.check) {
      const chess = new Chess(shown.fen, { skipValidation: true });
      put('glow', 'check', chess.findPiece({ type: 'k', color: chess.turn() })[0], 0.07);
    }
    if (ui.selected) put('square', 'selected', ui.selected, 0.09);
    for (const t of ui.targets) put(t.capture ? 'ring' : 'dot', 'target', t.to, 0.11);
    if (ui.arrow) marks.add(arrow(ui.arrow.slice(0, 2), ui.arrow.slice(2, 4)));
  }

  // Flacher Pfeil von Feld zu Feld (Tipp des Orakels)
  function arrow(from, to) {
    const a = spot(from);
    const b = spot(to);
    const len = a.distanceTo(b) - 1;
    const [w, head, hw] = [0.55, 2, 1.6];
    const s = new THREE.Shape();
    s.moveTo(0.8, -w);
    s.lineTo(len - head, -w);
    s.lineTo(len - head, -hw);
    s.lineTo(len, 0);
    s.lineTo(len - head, hw);
    s.lineTo(len - head, w);
    s.lineTo(0.8, w);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), LOOK.arrow);
    m.position.set(a.x, THICK + 0.15, a.z);
    m.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    m.renderOrder = 1; // nach den übrigen Markierungen zeichnen
    m.userData.own = true;
    return m;
  }

  // --- Plakette der Zuganalyse über dem Zielfeld (wie bei chess.com) ---
  const badgeTextures = {};
  const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, toneMapped: false }));
  badge.scale.set(3.4, 3.4, 1);
  badge.renderOrder = 3; // immer sichtbar, auch vor Figuren
  badge.visible = false;
  badge.raycast = () => {}; // nie anklickbar – Sprites brauchen sonst eine Kamera am Strahl (Konfetti-Landung in effects.js hat keine)
  group.add(badge);

  function badgeTexture(kind) {
    if (!badgeTextures[kind]) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = BADGES[kind].color;
      g.beginPath();
      g.arc(64, 64, 56, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = '#fff';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = 'bold 60px Arial, "Segoe UI Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(BADGES[kind].symbol, 64, 68);
      badgeTextures[kind] = new THREE.CanvasTexture(c);
      badgeTextures[kind].colorSpace = THREE.SRGBColorSpace;
    }
    return badgeTextures[kind];
  }

  function setBadge(square, kind) {
    badge.visible = !!(square && kind);
    if (!badge.visible) return;
    badge.material.map = badgeTexture(kind);
    badge.material.needsUpdate = true;
    badge.position.copy(spot(square));
    badge.position.y += 10.5; // über der höchsten Figur
  }

  // --- Abgleich mit dem Spielstand ---
  function sync(s) {
    if (!s || s === shown) return;
    const sameMoves = (n) => shown && s.white === shown.white && shown.moves.length === n && shown.moves.every((m, i) => m === s.moves[i]);
    group.rotation.y = s.white === 0 ? 0 : Math.PI; // eigene Farbe zum eigenen Platz (Host sitzt auf +z)
    if (sameMoves(s.moves.length - 1)) step(shown.fen, s.moves.at(-1), s);
    else if (!sameMoves(s.moves.length)) rebuild(s.fen, s.captured);
    shown = s;
    drawMarks();
  }

  function reset() {
    shown = null;
    ui = { selected: null, targets: [], arrow: null };
    hover = null;
    setGlow('hover', []);
    setGlow('selected', []);
    group.rotation.y = 0;
    badge.visible = false;
    rebuild(START, []);
    drawMarks();
  }

  reset();

  return {
    group,
    sync,
    reset,
    update,
    busy: () => anims.length > 0, // eine Figur gleitet noch
    loose: () => [...pieces.children], // Figuren fliegen beim Umwerfen einzeln (tisch.js)
    // Design dieses PCs: Figuren-Set (settings.js)
    setDesign(s) {
      const set = SETS[s.chessSet] ?? SETS.holz;
      for (const c of ['w', 'b']) dress(woods[c], set[c]);
      for (const p of pieces.children) dress(p.material, set[p.userData.color]);
    },
    setBadge, // Plakette der Zuganalyse: setBadge('e4', 'best'), setBadge(null) = weg
    // ui = { selected: Feld, targets: [{ to, capture }], arrow: 'e2e4' }
    setMarks(next) {
      ui = next;
      setGlow('selected', ui.selected ? [at(ui.selected)] : []);
      drawMarks();
    },
    // Figur unter der Maus leicht aufleuchten lassen
    setHover(square) {
      if (square === hover) return;
      hover = square;
      setGlow('hover', square ? [at(square)] : []);
      for (const p of pieces.children) p.material.emissive.setHex(square && p.userData.square === square ? 0x3a2a12 : 0x000000);
    },
    // Feld unter der Maus (Figur oder Brett) oder null
    pickSquare(raycaster) {
      const onBoard = pieces.children.filter((p) => p.userData.square);
      const hit = raycaster.intersectObjects([...onBoard, boardMesh], false)[0];
      if (!hit) return null;
      if (hit.object !== boardMesh) return hit.object.userData.square;
      return squareAt(hit.point);
    },
    squareAt,
  };

  // Feld unter einem Punkt (Welt), z. B. wo eine Figur aus der Hand abgestellt wird – oder null (neben dem Brett)
  function squareAt(point) {
    const p = group.worldToLocal(point.clone()).divideScalar(SQ);
    const f = Math.floor(p.x + 4);
    const r = Math.floor(4 - p.z);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null;
  }
}
