// Zwei Effekte als Szenen-Teile (an-/abschaltbar in den Einstellungen):
// - Staub im Lichtkegel der Hängelampe: feine Körnchen schweben langsam und glitzern nur im Licht.
// - Sieg-Konfetti: Schnipsel schießen an der Tischkante des Gewinners hoch, flattern herab und bleiben kurz liegen.
// Maße in Metern wie room.js.
import * as THREE from 'three';
import { canvasTexture } from './textures.js';

const rand = (a, b) => a + Math.random() * (b - a);

// --- Staub ---
const DUST = 420;
const BEAM = { top: 1.66, bottom: 0.8, spread: 0.55 }; // Höhe in m, Öffnung des Kegels (Bogenmaß)
const NEAR = [0.12, 0.35]; // Körnchen dicht vor der Kamera ausblenden (sonst große Flecken)

export function createDust(scene, lampY) {
  const radiusAt = (y) => (lampY - y) * Math.tan(BEAM.spread);
  const pos = new Float32Array(DUST * 3);
  const color = new Float32Array(DUST * 3);
  const motes = Array.from({ length: DUST }, () => spawn({}));

  function spawn(m) {
    m.y = rand(BEAM.bottom, BEAM.top);
    const r = radiusAt(m.y) * Math.sqrt(Math.random());
    const a = rand(0, Math.PI * 2);
    m.x = Math.cos(a) * r;
    m.z = Math.sin(a) * r;
    m.vy = rand(-0.006, 0.004); // m/s: sinkt meist ganz langsam
    m.phase = rand(0, 100);
    m.wobble = rand(0.2, 0.6);
    return m;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  const sprite = canvasTexture(32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.0045, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);

  let time = 0;
  const cam = new THREE.Vector3();
  return {
    group: points,
    update(dt, camera) {
      if (!points.visible) return;
      time += dt;
      camera.getWorldPosition(cam);
      motes.forEach((m, i) => {
        m.y += m.vy * dt;
        m.x += Math.sin(time * m.wobble + m.phase) * 0.004 * dt;
        m.z += Math.cos(time * m.wobble * 0.8 + m.phase) * 0.004 * dt;
        if (m.y < BEAM.bottom || m.y > BEAM.top || Math.hypot(m.x, m.z) > radiusAt(m.y)) spawn(m);
        // erst nach dem Neu-Entstehen messen: außerhalb des Kegels wäre (1 - edge) ** 1.5 keine Zahl (NaN) –
        // die verteilt der Lichtschein übers ganze Bild, das dann schwarz aufblitzt
        const edge = Math.hypot(m.x, m.z) / radiusAt(m.y);
        pos.set([m.x, m.y, m.z], i * 3);
        // hell nur mitten im Licht, sanft funkelnd, oben/unten und dicht an der Kamera ausgeblendet
        const ends = Math.min(1, (m.y - BEAM.bottom) / 0.15, (BEAM.top - m.y) / 0.25);
        const near = THREE.MathUtils.smoothstep(Math.hypot(m.x - cam.x, m.y - cam.y, m.z - cam.z), ...NEAR);
        const b = 2 * (1 - edge) ** 1.5 * ends * near * (0.55 + 0.45 * Math.sin(time * 1.7 + m.phase));
        color.set([b, b * 0.86, b * 0.62], i * 3); // warmes Lampenlicht
      });
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

// --- Konfetti ---
const PIECES = 180;
const COLORS = [0xd8343a, 0xf2b630, 0x3d7fd9, 0x45a957, 0xe86fb0, 0xf4efe2, 0xc89a3c];
const GRAVITY = 9.81;
const DRAG = 6; // Papier bremst stark: fällt mit höchstens ~1,6 m/s
const LIE_S = 6; // so lange liegen die Schnipsel, dann schrumpfen sie weg
const FADE_S = 1.5;

// surfaces = Gruppe, auf deren sichtbaren Teilen Schnipsel landen (Tisch + Spielmaterial)
export function createConfetti(scene, surfaces, tableTop) {
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.009, 0.014),
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.55, metalness: 0.2 }),
    PIECES,
  );
  mesh.castShadow = true;
  mesh.visible = false;
  mesh.frustumCulled = false;
  const tint = new THREE.Color();
  for (let i = 0; i < PIECES; i++) mesh.setColorAt(i, tint.setHex(COLORS[i % COLORS.length]));
  scene.add(mesh);

  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const shown = (o) => o.visible && (!o.parent || shown(o.parent));
  const dummy = new THREE.Object3D();
  const turn = new THREE.Quaternion();
  let pieces = [];
  let age = 0;

  // Höhe, auf der ein Schnipsel an dieser Stelle landet: oberste sichtbare Fläche, sonst Tischplatte/Boden
  function groundAt(p) {
    ray.set(new THREE.Vector3(p.x, tableTop + 0.2, p.z), down);
    const hit = ray.intersectObject(surfaces, true).find((h) => shown(h.object) && h.object.isMesh);
    if (hit) return hit.point.y + 0.001;
    return Math.abs(p.x) < 0.5 && Math.abs(p.z) < 0.5 ? tableTop + 0.001 : 0.003;
  }

  return {
    // side = +1 (Platz auf +z) oder −1: zwei Böller an den Tischecken vor dem Gewinner
    burst(side) {
      age = 0;
      mesh.visible = true;
      pieces = Array.from({ length: PIECES }, (_, i) => {
        const left = i % 2 ? 1 : -1;
        return {
          pos: new THREE.Vector3(left * 0.4, tableTop + 0.03, side * 0.38),
          vel: new THREE.Vector3(-left * rand(0.4, 2.2), rand(4, 7.5), -side * rand(0.2, 2.4)),
          quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
          axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
          spin: rand(4, 12), // Drehung in Bogenmaß pro Sekunde
          phase: rand(0, 6),
          ground: null,
          landed: false,
        };
      });
    },
    update(dt) {
      if (!mesh.visible) return;
      age += dt;
      const shrink = THREE.MathUtils.clamp(1 - (age - LIE_S) / FADE_S, 0, 1);
      pieces.forEach((p, i) => {
        if (!p.landed) {
          p.vel.y -= GRAVITY * dt;
          p.vel.multiplyScalar(Math.exp(-DRAG * dt));
          p.pos.addScaledVector(p.vel, dt);
          p.pos.x += Math.sin(age * 5 + p.phase) * 0.12 * dt; // flattern
          p.quat.multiply(turn.setFromAxisAngle(p.axis, p.spin * dt));
          if (p.vel.y < 0 && p.pos.y < tableTop + 0.18) p.ground ??= groundAt(p.pos); // höchstes Spielmaterial ~11 cm
          if (p.ground !== null && p.pos.y <= p.ground) {
            p.landed = true;
            p.pos.y = p.ground;
            p.quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rand(0, 6))); // liegt flach
          }
        }
        dummy.position.copy(p.pos);
        dummy.quaternion.copy(p.quat);
        dummy.scale.setScalar(shrink);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (shrink === 0) mesh.visible = false;
    },
  };
}
