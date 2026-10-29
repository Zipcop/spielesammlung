// Minigolfanlage draußen: eigene Gruppe direkt in room.scene bei COURSE_AT (weit weg vom Zimmer) mit eigener Sonne,
// Himmel und Dunst. 9 Bahnen aus course.js, der Ball, der Schläger und die Ziellinie. Die Physik (physics.js, Rapier)
// läuft nur beim schlagenden PC; er streamt die Lage des Balls und der Mühlenflügel, beim anderen wird nur angezeigt.
// Maße in Metern (echte Größe). Koordinaten wie course.js (Bezug der Anlage).
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { COURSE, COURSE_AT, FLOOR, R, CUP_R, MILL_SPEED, MILL_PERIOD } from './course.js';
import { createPhysics, STEP } from './physics.js';
import { ballOf } from './rules.js';
import { woodTexture, stoneTexture } from '../textures.js';
import { playHit } from '../sound.js';
import { buildPark, concreteTexture, laneFeltTexture, skyTexture, signTexture, HAZE } from './park.js';

export const BALL_COLORS = ['#e0482f', '#2f6fd0']; // Host rot, Gast/Computer blau
const SEND_EVERY = 8; // 30 Meldungen pro Sekunde an den Mitspieler
const PULL = 0.22; // m – so weit holt der Schläger bei voller Kraft aus
const SUNK_Y = R - 0.034; // Ball im Loch: Mitte so weit über der Lochkante – nur die Kuppe schaut heraus
const SOUND_IDS = ['putt', 'clack', 'wood', 'cup', 'rim', 'splash', 'felt'];
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export function createMinigolfBoard(scene, { onStream }) {
  const group = new THREE.Group();
  group.position.set(COURSE_AT[0], 0, COURSE_AT[1]);
  scene.add(group);
  // Anlage, Licht und Himmel erst beim ersten Spiel bauen (spart beim Start der App die vielen Canvas-Texturen)
  let holes = [];
  let sun = null;
  let sky = null;
  let design = null;
  const fog = new THREE.Fog(HAZE, 22, 34); // Kamera-Fernebene 30 m: dahinter verschwindet alles im Dunst
  function build() {
    if (sun) return;
    buildPark(group);
    holes = COURSE.map((hole) => buildHole(group, hole));
    sun = addLights(group);
    sky = skyTexture();
    if (design) api.setDesign(design);
  }

  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 20), new THREE.MeshPhysicalMaterial({ color: BALL_COLORS[0], roughness: 0.35, clearcoat: 0.6 }));
  ball.castShadow = true;
  ball.visible = false;
  group.add(ball);
  const ghost = new THREE.Mesh(ball.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
  ghost.visible = false;
  group.add(ghost);
  const putter = buildPutter();
  group.add(putter);
  const guide = buildGuide();
  group.add(guide);
  const confetti = createBurst(group);

  let state = null;
  let shot = null; // eigener Schlag mit Physik
  let pending = null; // Computer wartet auf den passenden Flügelwinkel
  let remote = null; // Schlag des Mitspielers (gestreamte Lagen)
  let anim = null; // Ball fällt ins Loch oder von der Bahn
  let aim = null; // { angle, power }
  let mill = 0; // angezeigter Flügelwinkel (läuft ständig)

  // --- Physik (erst beim ersten Schlag geladen) ---
  let physics = null;
  let loading = null;
  function ready() {
    loading ??= (async () => {
      const RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      physics = createPhysics(RAPIER);
    })();
    return loading;
  }

  // Eigener Schlag: angle = Richtung (0 = +x), power 0–1, phase = Flügelwinkel, auf den gewartet wird (Computer).
  // Liefert das Ergebnis für die Regeln: { holed, out, pos }
  async function strike(angle, power, phase = null) {
    await ready();
    if (shot || pending) return null;
    return new Promise((resolve) => {
      pending = { angle, power, phase, resolve, waited: 0 };
    });
  }

  function begin() {
    const { angle, power, resolve } = pending;
    pending = null;
    aim = null;
    drawAim();
    const sim = physics.start(state.hole, ballOf(state), angle, power, { phase: mill, rotation: ball.quaternion });
    playHit('putt', 0.25 + power * 0.75);
    shot = { sim, resolve, acc: 0, hits: [['putt', round(0.25 + power * 0.75, 2)]], event: null };
  }

  function stepPhysics(dt) {
    shot.acc = Math.min(shot.acc + dt, 16 * STEP);
    while (shot && shot.acc >= STEP) {
      shot.acc -= STEP;
      const { sounds, event } = physics.step(shot.sim);
      for (const [kind, strength] of sounds) {
        playHit(kind, strength);
        shot.hits.push([kind, round(strength, 2)]);
      }
      if (event === 'holed' || event === 'out') shot.event = event;
      const b = shot.sim.body;
      ball.position.copy(b.translation());
      ball.quaternion.copy(b.rotation());
      mill = physics.millAngle(shot.sim);
      if (shot.sim.steps % SEND_EVERY === 0) send(false);
      if (physics.done(shot.sim)) {
        if (!shot.event && shot.sim.holed) shot.event = 'holed'; // über dem Loch liegen geblieben
        send(true);
        const report = physics.finish(shot.sim);
        const { resolve, event } = shot;
        shot = null;
        startAnim(event);
        resolve(report);
      }
    }
  }

  function send(final) {
    const p = ball.position;
    const q = ball.quaternion;
    onStream({ t: 'golf', p: [round(p.x, 4), round(p.y, 4), round(p.z, 4), round(q.x, 4), round(q.y, 4), round(q.z, 4), round(q.w, 4)], m: round(mill, 4), s: shot.hits.map(([k, v]) => [SOUND_IDS.indexOf(k), v]), ...(final ? { final: true, e: shot.event } : {}) });
    shot.hits = [];
  }

  // Einlochen: Ball sinkt ins Loch · Von der Bahn: fällt auf den Rasen bzw. ins Wasser, dann zurück an die Schlagstelle
  function startAnim(event) {
    if (!event || !state) return;
    const [cx, cy, cz] = COURSE[state.hole].cup;
    const from = ball.position.clone();
    const to = event === 'holed' ? new THREE.Vector3(cx, cy + SUNK_Y, cz) : new THREE.Vector3(from.x, COURSE[state.hole].gaps.length && from.y < FLOOR ? 0.03 : R, from.z);
    anim = { event, from, to, t: 0, length: event === 'holed' ? 0.25 : 0.35, hold: event === 'holed' ? 0.9 : 0.7 };
  }

  function stepAnim(dt) {
    anim.t += dt;
    const k = Math.min(anim.t / anim.length, 1);
    ball.position.lerpVectors(anim.from, anim.to, anim.event === 'out' ? k * k : 1 - (1 - k) * (1 - k));
    if (anim.t < anim.length + anim.hold) return;
    anim = null;
    if (api.onSettled) api.onSettled(); // index.js zeichnet neu (Gast: erst, wenn der Host geantwortet hat)
    else sync(state);
  }

  // --- Schlag des Mitspielers anzeigen ---
  function applyRemote(msg) {
    if (!Array.isArray(msg.p) || msg.p.length !== 7 || !msg.p.every(Number.isFinite) || !Number.isFinite(msg.m)) return;
    aim = null;
    drawAim();
    remote ??= { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    remote.pos.fromArray(msg.p, 0);
    remote.quat.fromArray(msg.p, 3);
    mill = msg.m;
    ball.visible = true;
    for (const [k, strength] of Array.isArray(msg.s) ? msg.s : []) if (SOUND_IDS[k]) playHit(SOUND_IDS[k], Math.min(Math.max(Number(strength) || 0, 0), 1));
    if (!msg.final) return;
    ball.position.copy(remote.pos);
    ball.quaternion.copy(remote.quat);
    remote = null;
    startAnim(msg.e === 'holed' || msg.e === 'out' ? msg.e : null);
  }

  // --- Anordnung passend zum Spielstand ---
  function sync(s) {
    state = s;
    if (!s || shot || remote || anim) return;
    const playing = s.phase === 'play' && !s.result;
    ball.visible = playing;
    ball.material.color.set(BALL_COLORS[s.turn]);
    if (playing) ball.position.set(...ballOf(s));
    drawAim();
  }

  // Schläger hinter dem Ball, Ziellinie davor
  function drawAim() {
    const show = !!(aim && state && ball.visible && !shot && !remote && !anim);
    putter.visible = guide.visible = show;
    if (!show) return;
    const dir = new THREE.Vector3(Math.cos(aim.angle), 0, -Math.sin(aim.angle));
    putter.position.copy(ball.position).addScaledVector(dir, -(R + 0.018 + aim.power * PULL));
    putter.position.y = ball.position.y - R;
    putter.rotation.y = aim.angle;
    guide.position.copy(ball.position).setY(ball.position.y - R + 0.004);
    guide.rotation.y = aim.angle;
    guide.scale.set(0.5 + aim.power * 1.6, 1, 1);
  }

  function update(dt) {
    if (pending) {
      // Computer an der Mühle: schlagen, wenn die Flügel dort stehen, wo er es geplant hat (höchstens 4 s warten)
      pending.waited += dt;
      const wrap = (a) => ((a % MILL_PERIOD) + MILL_PERIOD) % MILL_PERIOD;
      const off = state && COURSE[state.hole].mill && pending.phase !== null ? Math.abs(wrap(mill) - wrap(pending.phase)) : 0;
      if (Math.min(off, MILL_PERIOD - off) < MILL_SPEED * dt * 1.5 || pending.waited > 4) begin();
    }
    if (shot) stepPhysics(dt);
    else if (!remote) mill += MILL_SPEED * dt;
    if (remote) {
      const k = 1 - Math.exp(-dt * 30);
      ball.position.lerp(remote.pos, k);
      ball.quaternion.slerp(remote.quat, k);
    }
    if (anim) stepAnim(dt);
    for (const h of holes) if (h.mill) h.mill.rotation.x = mill;
    confetti.update(dt);
  }

  function reset() {
    if (shot) {
      physics.finish(shot.sim);
      shot = null;
    }
    pending?.resolve(null);
    pending = remote = anim = aim = null;
    state = null;
    ball.visible = ghost.visible = putter.visible = guide.visible = false;
  }

  let saved = null;
  const api = {
    group,
    onSettled: null, // Ball liegt nach Einlochen/Herunterfallen fertig da
    noTisch: true, // die Anlage wird nicht umgeworfen (tisch.js)
    ready,
    physics: () => physics,
    sync,
    update,
    reset,
    applyRemote,
    strike,
    busy: () => !!(shot || remote || anim || pending),
    rolling: () => !!(shot || remote),
    millAngle: () => mill,
    // Ziel des Spielers am Zug (auch beim Mitspieler sichtbar); null = ausblenden
    setAim(next) {
      aim = next;
      drawAim();
    },
    // Ball verlegen (ohne Hilfen): halbdurchsichtiger Ball an der Stelle unter der Maus, null = weg
    setGhost(pos) {
      ghost.visible = !!pos;
      if (pos) ghost.position.set(...pos);
    },
    // Ballmitte (Bezug der Anlage) → Welt, z. B. für die Kamera
    toWorld: ([x, y, z]) => group.localToWorld(new THREE.Vector3(x, y, z)),
    ballWorld: () => group.localToWorld(ball.position.clone()),
    // Punkt auf der waagrechten Ebene durch die Ballmitte unter der Maus: [x, z] oder null
    pickAim(raycaster) {
      const height = group.localToWorld(ball.position.clone()).y;
      const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), new THREE.Vector3());
      if (!hit) return null;
      const local = group.worldToLocal(hit);
      return [local.x, local.z];
    },
    // Bahnfläche der aktuellen Bahn unter der Maus: neue Ballmitte [x, y, z] oder null
    pickFloor(raycaster) {
      if (!state) return null;
      const hit = raycaster.intersectObjects(holes[state.hole].floors, false)[0];
      if (!hit) return null;
      const p = group.worldToLocal(hit.point.clone());
      return [round(p.x, 4), round(p.y + R, 4), round(p.z, 4)];
    },
    // Sieg: Konfetti über dem Loch der Bahn
    celebrate(n) {
      const [x, y, z] = COURSE[n].cup;
      confetti.burst(new THREE.Vector3(x, y, z));
    },
    // Himmel und Dunst nur, solange gespielt wird (das Zimmer hat seinen eigenen Hintergrund)
    activate(on) {
      if (on) build();
      if (on && !saved) {
        saved = { background: scene.background, fog: scene.fog };
        scene.background = sky;
        scene.fog = fog;
      } else if (!on && saved) {
        scene.background = saved.background;
        scene.fog = saved.fog;
        saved = null;
      }
    },
    // Grafik-Stufe: Schattenkarte der Sonne
    setDesign(s) {
      design = s;
      if (!sun) return;
      sun.castShadow = s.shadows !== 'off';
      const size = Math.max(1024, s.shadowSize ?? 2048);
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      sun.shadow.radius = s.shadows === 'soft' ? 3 : 1;
    },
  };
  return api;
}

// Sonne mit Schatten über der ganzen Anlage, dazu Himmelslicht
function addLights(group) {
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a6a2a, 1.1);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-2 + 12, 22, 9);
  sun.target.position.set(-2, 0, 0);
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -18;
  cam.right = cam.top = 18;
  cam.near = 2;
  cam.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.mapSize.set(2048, 2048);
  group.add(sun, sun.target);
  return sun;
}

function mesh(geometry, material, shadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}

// Quader aus course.js (Mitte c, halbe Maße, Drehung um die Hochachse)
function boxMesh({ c, half, yaw }, material) {
  const m = mesh(new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2), material);
  m.position.set(...c);
  m.rotation.y = yaw;
  return m;
}

// Flächen-UV = x/z in Metern (Texturen wiederholen sich je Meter, wie bei den Bahnplatten)
function planarUV(geometry) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i);
    uv[i * 2 + 1] = -pos.getZ(i);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

let stoneMat = null;
let woodMat = null;
const surfaces = new Map();

// Eine Bahn: Platte, Banden, Hindernisse, Loch, Abschlag und Schild. floors = Flächen, auf die man den Ball legen kann
function buildHole(group, hole) {
  const g = new THREE.Group();
  group.add(g);
  stoneMat ??= new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.85 });
  woodMat ??= new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#9a6a3c', boards: 5 }), roughness: 0.7 });
  const key = hole.surface + hole.color; // gleiche Bahnfarbe = dieselbe Textur
  if (!surfaces.has(key)) surfaces.set(key, hole.surface === 'filz' ? laneFeltTexture(hole.color) : concreteTexture(hole.color));
  const top = new THREE.MeshStandardMaterial({ map: surfaces.get(key), roughness: hole.surface === 'filz' ? 0.95 : 0.75 });
  const side = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.9 });
  const curb = new THREE.MeshStandardMaterial({ color: hole.surface === 'filz' ? 0x3a3f44 : 0xd8d4c8, roughness: 0.6, metalness: hole.surface === 'filz' ? 0.3 : 0 });
  const floors = [];

  // Platte: Umriss nach oben gezogen; mit Graben einzelne Rechtecke wie in der Physik
  const plate = (pts) => {
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: FLOOR, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const m = mesh(geo, [top, side]);
    g.add(m);
    floors.push(m);
  };
  if (hole.gaps.length) {
    for (const f of hole.floors) {
      const [hx, , hz] = f.half;
      const corners = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => [f.c[0] + a * Math.cos(f.yaw) + b * Math.sin(f.yaw), f.c[2] - a * Math.sin(f.yaw) + b * Math.cos(f.yaw)]);
      plate(corners);
    }
    // Wassergraben
    const water = new THREE.MeshStandardMaterial({ color: 0x2f6f8a, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.9 });
    for (const [a, b] of hole.gaps) {
      const [x0, , z0] = hole.frame.point(a, -0.66);
      const [x1, , z1] = hole.frame.point(b, 0.66);
      const w = mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), 0.02, Math.abs(z1 - z0)), water, false);
      w.position.set((x0 + x1) / 2, 0.035, (z0 + z1) / 2);
      w.receiveShadow = true;
      g.add(w);
      const bed = mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), 0.01, Math.abs(z1 - z0)), new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 1 }), false);
      bed.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
      g.add(bed);
    }
  } else plate(hole.poly);

  // Banden; Filzbahnen haben obendrauf ein Stahlrohr
  for (const w of hole.walls) {
    g.add(boxMesh(w, curb));
    if (hole.surface === 'filz') {
      const tube = mesh(new THREE.CylinderGeometry(0.022, 0.022, w.half[0] * 2, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.8 }));
      tube.position.set(w.c[0], w.c[1] + w.half[1], w.c[2]);
      tube.rotation.y = w.yaw;
      g.add(tube);
    }
  }
  // Steine, Tunnel, Mühlenhaus
  for (const b of hole.blocks) g.add(boxMesh(b, b.look === 'house' ? woodMat : stoneMat));
  for (const { pts } of hole.stones) g.add(mesh(planarUV(new ConvexGeometry(pts.map((p) => new THREE.Vector3(...p)))), stoneMat));
  if (hole.tunnel) {
    // Röhre: halbrundes Dach über dem Durchlass, Rest des Riegels als Steinmauer
    const { u, v, w, len } = hole.tunnel;
    const [x, , z] = hole.frame.point(u, v);
    const arch = mesh(new THREE.CylinderGeometry(w / 2 + 0.04, w / 2 + 0.04, len, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6a6460, roughness: 0.8, side: THREE.DoubleSide }));
    arch.position.set(x, FLOOR + 0.12, z);
    arch.rotation.y = hole.yaw;
    g.add(arch);
    const lid = mesh(new THREE.BoxGeometry(len, 0.06, w + 0.08), stoneMat);
    lid.position.set(x, FLOOR + 0.27, z);
    lid.rotation.y = hole.yaw;
    g.add(lid);
  }
  // Wellen, Rampen, Steg, Schräge, Vulkan
  for (const w of hole.waves) {
    const m = mesh(new THREE.CylinderGeometry(w.r, w.r, w.half * 2, 64), top);
    m.position.set(...w.c);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(w.axis[0], 0, w.axis[1]));
    g.add(m);
    floors.push(m);
  }
  for (const pts of hole.hulls) {
    const m = mesh(planarUV(new ConvexGeometry(pts.map((p) => new THREE.Vector3(...p)))), hole.gaps.length ? woodMat : top);
    g.add(m);
    floors.push(m);
  }
  let mill = null;
  if (hole.mill) mill = buildMill(g, hole);

  // Loch: dunkle Öffnung mit Metallrand, Abschlag: Gummimatte
  const [cx, cy, cz] = hole.cup;
  const cup = mesh(new THREE.CircleGeometry(CUP_R, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 }), false);
  cup.position.set(cx, cy + 0.0015, cz);
  g.add(cup);
  const rim = mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.007, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.8 }), false);
  rim.position.set(cx, cy + 0.0018, cz);
  g.add(rim);
  const [tx, , tz] = hole.tee;
  const mat = mesh(new THREE.BoxGeometry(0.34, 0.006, 0.34), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 }), false);
  mat.position.set(tx, FLOOR + 0.003, tz);
  mat.rotation.y = hole.yaw;
  mat.receiveShadow = true;
  g.add(mat);
  // Schild mit Nummer und Namen links vor dem Abschlag
  const [sx, , sz] = hole.frame.point(-0.45, -0.95);
  const post = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), woodMat); // endet unter dem Schild
  post.position.set(sx, 0.4, sz);
  g.add(post);
  const board = mesh(new THREE.BoxGeometry(0.62, 0.3, 0.03), new THREE.MeshStandardMaterial({ map: signTexture(`${hole.n + 1}`, hole.name), roughness: 0.6 }));
  board.position.set(sx, 0.95, sz);
  board.rotation.y = hole.yaw - Math.PI / 2; // Schild schaut zum Spieler am Abschlag
  g.add(board);
  return { floors, mill };
}

// Mühle: Haus über dem Durchlass, vier Flügel aus Holzlatten drehen um die Bahnachse
function buildMill(g, hole) {
  const m = hole.mill;
  const [x, y, z] = m.c;
  const wall = new THREE.MeshStandardMaterial({ color: 0xc9a47a, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x8c3b2a, roughness: 0.7 });
  const house = new THREE.Group();
  const [hx, , hz] = hole.frame.point(4.35 + 0.15, 0);
  house.position.set(hx, FLOOR + 0.25, hz);
  house.rotation.y = hole.yaw;
  const body = mesh(new THREE.BoxGeometry(0.5, 0.7, 1.24), wall);
  body.position.y = 0.35;
  house.add(body);
  const cap = mesh(new THREE.ConeGeometry(0.75, 0.45, 4), roof);
  cap.position.y = 0.92;
  cap.rotation.y = Math.PI / 4;
  cap.scale.set(0.5, 1, 1.15);
  house.add(cap);
  g.add(house);

  const hub = new THREE.Group();
  hub.position.set(x, y, z);
  hub.rotation.y = m.yaw;
  const spin = new THREE.Group();
  hub.add(spin);
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#7a4a28', boards: 2 }), roughness: 0.7 });
  const sail = new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.9, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const blade = new THREE.Group();
    blade.rotation.x = a;
    const spar = mesh(new THREE.BoxGeometry(m.thick, m.len, 0.03), wood);
    spar.position.y = -m.len / 2;
    blade.add(spar);
    const cloth = mesh(new THREE.BoxGeometry(m.thick * 0.6, m.len * 0.8, m.width - 0.03), sail);
    cloth.position.set(0, -m.len * 0.55, 0.0);
    blade.add(cloth);
    spin.add(blade);
  }
  spin.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 16).rotateZ(Math.PI / 2), wood));
  g.add(hub);
  return spin;
}

// Schläger: Kopf am Boden (lokal +x = Schlagrichtung), Schaft schräg nach links oben zum Spieler
function buildPutter() {
  const p = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.85 });
  const head = mesh(new THREE.BoxGeometry(0.03, 0.035, 0.11), steel);
  head.position.y = 0.0175;
  p.add(head);
  const len = 0.75;
  const shaftDir = new THREE.Vector3(-0.25, 0.8, -0.55).normalize(); // schräg nach links hinten zum Spieler
  const shaft = mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 8), steel);
  shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), shaftDir);
  shaft.position.copy(shaftDir.clone().multiplyScalar(len / 2)).setY(shaftDir.y * len / 2 + 0.03);
  p.add(shaft);
  const grip = mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.25, 10), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 }));
  grip.quaternion.copy(shaft.quaternion);
  grip.position.copy(shaftDir.clone().multiplyScalar(len - 0.1)).setY(shaftDir.y * (len - 0.1) + 0.03);
  p.add(grip);
  p.visible = false;
  return p;
}

// Ziellinie: gestrichelt vor dem Ball (Länge wächst mit der Kraft – scale.x)
function buildGuide() {
  const points = [];
  for (let i = 0; i < 12; i++) points.push(new THREE.Vector3(R + i * 0.1, 0, 0), new THREE.Vector3(R + i * 0.1 + 0.05, 0, 0));
  const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  line.visible = false;
  return line;
}

// Kleines Konfetti über dem Loch (eigener Sieg-Effekt – room.celebrate wirft es am Zimmertisch)
function createBurst(group) {
  const COUNT = 160;
  const colors = [0xd8343a, 0xf2b630, 0x3d7fd9, 0x45a957, 0xe86fb0, 0xf4efe2];
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 0.045), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6 }), COUNT);
  m.visible = false;
  m.frustumCulled = false;
  const tint = new THREE.Color();
  for (let i = 0; i < COUNT; i++) m.setColorAt(i, tint.setHex(colors[i % colors.length]));
  group.add(m);
  const dummy = new THREE.Object3D();
  let pieces = [];
  let age = 0;
  return {
    burst(at) {
      age = 0;
      m.visible = true;
      pieces = Array.from({ length: COUNT }, () => ({
        pos: at.clone().add(new THREE.Vector3(0, 0.1, 0)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
        spin: 3 + Math.random() * 8,
        floor: at.y + 0.002,
      }));
    },
    update(dt) {
      if (!m.visible) return;
      age += dt;
      const shrink = THREE.MathUtils.clamp(1 - (age - 6) / 1.5, 0, 1);
      pieces.forEach((p, i) => {
        if (p.pos.y > p.floor) {
          p.vel.y -= 9.81 * dt;
          p.vel.multiplyScalar(Math.exp(-4 * dt));
          p.pos.addScaledVector(p.vel, dt);
          p.rot.x += p.spin * dt;
          p.rot.y += p.spin * 0.7 * dt;
          if (p.pos.y <= p.floor) {
            p.pos.y = p.floor;
            p.rot.set(-Math.PI / 2, 0, Math.random() * 6);
          }
        }
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.setScalar(shrink);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      if (shrink === 0) m.visible = false;
    },
  };
}
