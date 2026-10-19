// Designs des Spielzimmers: Zimmer-Stil (Wohnzimmer, Kaminzimmer, Casino-Lounge) und Tageszeit (Tag, Abend,
// Nacht). Tauscht nur Texturen, Farben und Licht der Teile, die room.js gebaut hat – dazu der Kamin.
// Gilt nur für diesen PC (Einstellungen), nichts geht übers Netz.
import * as THREE from 'three';
import { woodTexture, wallpaperTexture, rugTexture, nightTexture, dayTexture, eveningTexture, stoneTexture, feltTexture, canvasTexture } from './textures.js';

export const STYLES = {
  wohnzimmer: { paper: {}, panel: '#4a2c17', floor: '#6b4226', rug: {}, curtain: 0x6b1f1a, ceiling: 0x5a4636, felt: false, fire: false },
  kamin: {
    paper: { base: '#4f2620', ink: '220, 180, 120' }, panel: '#2e1a0e', floor: '#4a2a16',
    rug: { field: '#24324f', border: '#5a1c1c', gold: '214, 180, 110' }, curtain: 0x2c3a28, ceiling: 0x3d2a1e, felt: false, fire: true,
  },
  casino: {
    paper: { base: '#3a0f16', ink: '212, 175, 55' }, panel: '#1a1010', floor: '#2a1a12',
    rug: { field: '#0f3d2b', border: '#5c0f1a', gold: '212, 175, 55' }, curtain: 0xb8902c, ceiling: 0x1c1012, felt: true, fire: false,
  },
};

// sun = Sonnenlicht durchs Fenster, lamp = Hängelampe, floorLamp = Stehlampe, glow = Leuchten der Lampenschirme
export const DAYTIMES = {
  nacht: { sky: nightTexture, sun: 0, sunColor: 0xffffff, hemi: [0xffe2c0, 0x2a1a10, 0.35], lamp: 7, floorLamp: 2.2, glow: 2.6 },
  abend: { sky: eveningTexture, sun: 1.8, sunColor: 0xff9a55, hemi: [0xffcf9a, 0x2a1a10, 0.5], lamp: 6, floorLamp: 1.6, glow: 2.2 },
  tag: { sky: dayTexture, sun: 3.4, sunColor: 0xfff1dc, hemi: [0xdfefff, 0x5a4636, 1.1], lamp: 3.2, floorLamp: 0.35, glow: 0.9 },
};

// look = Materialien und Lichter aus room.js
export function createDesigns(scene, look) {
  const cache = new Map(); // Texturen je Stil/Tageszeit nur einmal zeichnen
  const once = (key, make) => {
    if (!cache.has(key)) cache.set(key, make());
    return cache.get(key);
  };

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.set(-1.6, 3.4, -5.5); // hinter dem Fenster
  sun.target.position.set(0.2, 0.7, 0.6);
  scene.add(sun, sun.target);

  const fire = buildFireplace();
  scene.add(fire.group);

  let style = null;
  let daytime = null;

  function setStyle(name) {
    const s = STYLES[name] ?? STYLES.wohnzimmer;
    look.paper.map = once(`paper-${name}`, () => wallpaperTexture(s.paper));
    look.panel.map = once(`panel-${name}`, () => woodTexture({ base: s.panel, boards: 3 }));
    look.floor.map = once(`floor-${name}`, () => woodTexture({ base: s.floor, boards: 8, joints: true, repeat: [4, 4] }));
    look.rug.map = once(`rug-${name}`, () => rugTexture(s.rug));
    look.table.map = s.felt ? once('felt', () => feltTexture('gruen')) : look.tableWood;
    look.table.roughness = s.felt ? 1 : 0.45;
    look.curtain.color.setHex(s.curtain);
    look.ceiling.color.setHex(s.ceiling);
    for (const m of [look.paper, look.panel, look.floor, look.rug, look.table]) m.needsUpdate = true;
    fire.group.visible = s.fire;
    style = name;
  }

  function setDaytime(name) {
    const d = DAYTIMES[name] ?? DAYTIMES.nacht;
    look.sky.map = once(`sky-${name}`, d.sky);
    look.sky.needsUpdate = true;
    sun.intensity = d.sun;
    sun.color.setHex(d.sunColor);
    look.hemi.color.setHex(d.hemi[0]);
    look.hemi.groundColor.setHex(d.hemi[1]);
    look.hemi.intensity = d.hemi[2];
    look.spot.intensity = d.lamp;
    look.floorLamp.intensity = d.floorLamp;
    for (const m of look.glowing) m.emissiveIntensity = d.glow;
    daytime = name;
  }

  return {
    apply(nextStyle, nextDaytime) {
      if (nextStyle !== style) setStyle(nextStyle);
      if (nextDaytime !== daytime) setDaytime(nextDaytime);
    },
    update: (dt) => fire.group.visible && fire.update(dt),
  };
}

// Kamin an der rechten Wand: Bruchstein, Sims aus Holz, Holzscheite und ein flackerndes Feuer mit eigenem Licht
function buildFireplace() {
  const group = new THREE.Group();
  group.position.set(2.82, 0, 0.9);
  group.rotation.y = -Math.PI / 2;
  group.visible = false;

  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0806, roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ map: woodTexture({ base: '#3a200f', boards: 1 }), roughness: 0.6 });
  const add = (geometry, material, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = shadow;
    group.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(0.32, 1.05, 0.36), stone, -0.52, 0.525, 0); // Pfeiler links
  add(new THREE.BoxGeometry(0.32, 1.05, 0.36), stone, 0.52, 0.525, 0); // Pfeiler rechts
  add(new THREE.BoxGeometry(1.36, 0.3, 0.36), stone, 0, 0.9, 0); // Sturz
  add(new THREE.BoxGeometry(0.72, 0.75, 0.05), dark, 0, 0.375, -0.16); // Rückwand der Feuerstelle
  add(new THREE.BoxGeometry(1.5, 0.06, 0.5), stone, 0, 0.03, 0.06); // Herdplatte
  add(new THREE.BoxGeometry(1.5, 0.06, 0.44), wood, 0, 1.08, 0.04); // Sims
  for (const [x, ry] of [[-0.08, 0.3], [0.1, -0.25]]) {
    const log = add(new THREE.CylinderGeometry(0.045, 0.05, 0.5, 10), wood, x, 0.11, -0.02);
    log.rotation.set(0, ry, Math.PI / 2);
  }

  // Flammen: weiche, leuchtende Tropfen (additiv, leuchten über den Lichtschein)
  const flameTex = canvasTexture(128, 256, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h * 0.72, 4, w / 2, h * 0.6, h * 0.55);
    grad.addColorStop(0, 'rgba(255, 245, 200, 1)');
    grad.addColorStop(0.25, 'rgba(255, 190, 80, 0.95)');
    grad.addColorStop(0.6, 'rgba(240, 90, 20, 0.5)');
    grad.addColorStop(1, 'rgba(200, 40, 0, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.bezierCurveTo(w * 0.95, h * 0.45, w, h * 0.95, w / 2, h);
    g.bezierCurveTo(0, h * 0.95, w * 0.05, h * 0.45, w / 2, 0);
    g.fill();
  });
  const flames = [-0.14, 0, 0.13].map((x, i) => {
    const m = add(new THREE.PlaneGeometry(0.22, 0.4), new THREE.MeshBasicMaterial({
      map: flameTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.2, 1.6, 1.1), toneMapped: false,
    }), x, 0.32, -0.05 + i * 0.01, false);
    m.userData.phase = i * 2.1;
    return m;
  });
  const light = new THREE.PointLight(0xff8a3a, 0, 7, 2);
  light.position.set(0, 0.45, 0.25);
  group.add(light);

  let t = 0;
  return {
    group,
    update(dt) {
      t += dt;
      for (const f of flames) {
        const p = f.userData.phase;
        f.scale.set(1 + Math.sin(t * 7 + p) * 0.08, 0.85 + Math.sin(t * 9.3 + p) * 0.12 + Math.sin(t * 23 + p) * 0.05, 1);
        f.position.y = 0.3 + f.scale.y * 0.03;
      }
      light.intensity = 2.4 + Math.sin(t * 11) * 0.35 + Math.sin(t * 27) * 0.25;
    },
  };
}
