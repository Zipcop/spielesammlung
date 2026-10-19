// Grafik: rendert die Szene direkt (am schnellsten) oder – mit Kantenglättung oder Effekten – über eine
// Kette von Nachbearbeitungs-Schritten (EffectComposer). apply() stellt Auflösung, Schatten,
// Kantenglättung, Lichtschein, Umgebungsverdeckung und Umriss um (Werte aus settings.js).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { glowObjects } from './glow.js';

const SOFT_RADIUS = 3; // weiche Schatten: Streuung in Schatten-Pixeln

// shadowLights = Lichter mit Schatten (die Hängelampe)
export function createGraphics(renderer, scene, camera, shadowLights) {
  let settings = null;
  let composer = null;
  let outline = null;
  const size = new THREE.Vector2(1, 1);

  function pixelRatio() {
    return Math.min(window.devicePixelRatio, settings.maxDpr) * settings.scale;
  }

  // Schatten: aus / einfach (hart, 1 Abfrage) / weich (5 gestreute Abfragen)
  function applyShadows(s) {
    const type = s.shadows === 'soft' ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    const changed = renderer.shadowMap.enabled !== (s.shadows !== 'off') || renderer.shadowMap.type !== type;
    renderer.shadowMap.enabled = s.shadows !== 'off';
    renderer.shadowMap.type = type;
    for (const light of shadowLights) {
      light.shadow.radius = s.shadows === 'soft' ? SOFT_RADIUS : 1;
      if (light.shadow.mapSize.x === s.shadowSize) continue;
      light.shadow.mapSize.set(s.shadowSize, s.shadowSize);
      light.shadow.map?.dispose();
      light.shadow.map = null; // wird beim nächsten Bild in der neuen Größe angelegt
    }
    // Schatten an/aus oder andere Art steckt im Shader-Programm → alle Materialien neu übersetzen
    if (changed) scene.traverse((o) => [o.material ?? []].flat().forEach((m) => (m.needsUpdate = true)));
  }

  // Nachbearbeitung neu zusammenstellen (nur wenn sich etwas ändert – das passiert selten)
  function buildComposer(s) {
    composer?.passes.forEach((p) => {
      p.dispose?.();
      [p.gtaoMaterial, p.blendMaterial, p.materialHighPassFilter].forEach((m) => m?.dispose()); // vergisst dispose() in r186
    });
    composer?.dispose();
    composer = null;
    outline = null;
    if (!s.aa && !s.bloom && !s.ao && !s.outline) return;

    // Halbe Fließkommazahlen, damit helle Lampen über 1 hinausgehen dürfen (für den Lichtschein)
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: s.aa ? 4 : 0 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    if (s.ao) {
      const ao = new GTAOPass(scene, camera, 1, 1);
      ao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.4, thickness: 0.6, scale: 1, samples: 8 });
      ao.updatePdMaterial({ samples: 8 });
      ao.blendIntensity = 0.85;
      // halbe Auflösung reicht für weiche Verdeckung – in voller kostete sie bei 4K ~95 % der Bildzeit (gemessen)
      const fullSize = ao.setSize.bind(ao);
      ao.setSize = (w, h) => fullSize(Math.ceil(w / 2), Math.ceil(h / 2));
      composer.addPass(ao);
    }
    if (s.outline) {
      outline = new OutlinePass(new THREE.Vector2(1, 1), scene, camera);
      outline.visibleEdgeColor.set(0xffc66e);
      outline.hiddenEdgeColor.set(0x3a2410);
      outline.edgeStrength = 4;
      outline.edgeGlow = 0.6;
      outline.edgeThickness = 1.6;
      outline.pulsePeriod = 2.5;
      composer.addPass(outline);
    }
    // Lichtschein nur über der Helligkeit der beleuchteten Tischplatte (~2) – also Glühbirne, Lampenschirme, Glanzlichter
    if (s.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 2.4));
    composer.addPass(new OutputPass()); // Tonwerte und Farbraum wie beim direkten Rendern
  }

  return {
    apply(next) {
      const old = settings;
      settings = next;
      applyShadows(next);
      if (!old || ['aa', 'bloom', 'ao', 'outline'].some((k) => old[k] !== next[k])) buildComposer(next);
      this.setSize(size.x, size.y);
    },
    setSize(w, h) {
      size.set(w, h);
      if (settings) {
        renderer.setPixelRatio(pixelRatio());
        composer?.setPixelRatio(pixelRatio());
      }
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
    },
    render() {
      if (!composer) return renderer.render(scene, camera);
      if (outline) outline.selectedObjects = glowObjects();
      composer.render();
    },
  };
}
