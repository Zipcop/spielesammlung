// Kamera: weiche Fahrten zwischen festen Ansichten (Schrank, Tisch, Plätze) und – am Platz – frei um
// den Tisch drehen: rechte Maustaste ziehen = drehen, Mausrad = zoomen, Mausrad gedrückt ziehen = verschieben.
// Die linke Maustaste bleibt fürs Spiel.
// Grenzen: mindestens 15 cm über der Tischplatte (nicht in Figuren/Karten), nicht in die Hängelampe,
// nicht durch Wände (höchstens 1,6 m weg, Blickpunkt höchstens 1,3 m und Kamera höchstens 2,4 m von der Zimmermitte).
import * as THREE from 'three';

const FLY_S = 1.4;
const FIXED = ['shelf', 'table', 'billard0', 'billard1']; // hier bleibt die Kamera stehen (Billard: von oben)
const PITCH = [0.3, 1.35]; // Blick von oben, Bogenmaß: ab 17° (sonst Stuhllehnen im Bild) bis 77°
const DIST = [0.25, 1.6]; // Meter vom Blickziel
const Y_MAX = 1.6; // höchste Kamerahöhe – die Hängelampe hängt ab 1,70 m
const ABOVE = 0.15; // so hoch mindestens über dem Blickziel (Tischplatte)
const TURN = 0.006; // Bogenmaß pro Pixel Mausweg
const ZOOM = 0.0012; // je Rad-Einheit (eine Raste ≈ 100 → etwa 13 % näher/weiter)
const PAN_AREA = 1.3; // Blickpunkt bleibt in x und z so nah an der Zimmermitte (m) – Zimmer 6 × 6 m, Kamera bis 1,6 m dahinter
const CAM_AREA = 2.4; // Kamera selbst bleibt in x und z so nah an der Mitte – vor Schrank (ab 2,6 m), Kamin und Wänden

// views: Name → [Position, Blickziel]
export function createCamera(canvas, views) {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 30);
  const look = new THREE.Vector3();
  let fly = null;
  let current = null;
  let orbit = null; // { target, now: {yaw, pitch, dist}, goal: {…} } – nur an den Plätzen
  let drag = null;
  let dragEnd = 0; // Zeit des letzten Loslassens – danach kein Kontextmenü

  // Kugelkoordinaten der Ansicht um ihr Blickziel
  function orbitOf(pos, target) {
    const offset = pos.clone().sub(target);
    const dist = offset.length();
    const at = { yaw: Math.atan2(offset.x, offset.z), pitch: Math.asin(offset.y / dist), dist };
    // pan = Verschiebung des Blickpunkts (Mausrad gedrückt), zusätzlich zum Blickziel
    return { target: target.clone(), now: { ...at }, goal: at, pan: new THREE.Vector3(), panGoal: new THREE.Vector3() };
  }

  // keepDist: beim Drehen bleibt der Abstand und der Winkel gibt nach, beim Zoomen umgekehrt
  function limit(o, keepDist) {
    o.pitch = THREE.MathUtils.clamp(o.pitch, ...PITCH);
    o.dist = THREE.MathUtils.clamp(o.dist, ...DIST);
    const height = THREE.MathUtils.clamp(o.dist * Math.sin(o.pitch), ABOVE, Y_MAX - orbit.target.y);
    if (keepDist) o.pitch = Math.asin(height / o.dist);
    else o.dist = height / Math.sin(o.pitch);
  }

  function setView(name, instant = false) {
    const [pos, target] = views[name];
    const to = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...target) };
    current = name;
    orbit = FIXED.includes(name) ? null : orbitOf(to.pos, to.look);
    drag = null;
    if (instant) {
      camera.position.copy(to.pos);
      look.copy(to.look);
      camera.lookAt(look);
      fly = null;
      return;
    }
    fly = { from: { pos: camera.position.clone(), look: look.clone() }, to, t: 0 };
  }

  function update(dt) {
    if (fly) {
      fly.t = Math.min(fly.t + dt / FLY_S, 1);
      const k = fly.t * fly.t * (3 - 2 * fly.t); // weich anfahren und abbremsen
      camera.position.lerpVectors(fly.from.pos, fly.to.pos, k);
      look.lerpVectors(fly.from.look, fly.to.look, k);
      camera.lookAt(look);
      if (fly.t === 1) fly = null;
      return;
    }
    if (!orbit) return;
    const { now, goal, target } = orbit;
    const k = 1 - Math.exp(-dt * 14); // weich nachziehen
    for (const key of ['yaw', 'pitch', 'dist']) now[key] += (goal[key] - now[key]) * k;
    orbit.pan.lerp(orbit.panGoal, k);
    const at = target.clone().add(orbit.pan);
    at.x = THREE.MathUtils.clamp(at.x, -PAN_AREA, PAN_AREA);
    at.z = THREE.MathUtils.clamp(at.z, -PAN_AREA, PAN_AREA);
    const flatDist = now.dist * Math.cos(now.pitch);
    camera.position.set(
      THREE.MathUtils.clamp(at.x + flatDist * Math.sin(now.yaw), -CAM_AREA, CAM_AREA),
      at.y + now.dist * Math.sin(now.pitch),
      THREE.MathUtils.clamp(at.z + flatDist * Math.cos(now.yaw), -CAM_AREA, CAM_AREA),
    );
    camera.lookAt(at);
  }

  // Mausrad gedrückt ziehen: den Tisch „anfassen“ und verschieben – so weit, wie er sich in Blickpunkt-Tiefe bewegt
  function pan(dx, dy) {
    const { yaw, pitch, dist } = orbit.goal;
    const perPixel = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / canvas.clientHeight;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const ahead = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // vom Platz weg, flach über den Tisch
    // in die Tiefe erscheint der Tisch verkürzt (schräger Blick) – deshalb dort weiter schieben, sonst rutscht er unter der Maus weg
    orbit.panGoal.addScaledVector(right, -dx * perPixel).addScaledVector(ahead, (dy * perPixel) / Math.sin(pitch));
    // nicht weiter als der Blickpunkt darf (sonst hinge die Maus „fest“, bis man zurückzieht)
    const at = orbit.target.clone().add(orbit.panGoal);
    orbit.panGoal.x = THREE.MathUtils.clamp(at.x, -PAN_AREA, PAN_AREA) - orbit.target.x;
    orbit.panGoal.z = THREE.MathUtils.clamp(at.z, -PAN_AREA, PAN_AREA) - orbit.target.z;
  }

  const free = () => orbit && !fly;

  // Kontextmenü weder auf der Szene noch direkt nach dem Ziehen (Taste evtl. über dem Block losgelassen)
  window.addEventListener('contextmenu', (e) => {
    if (e.target === canvas || drag || performance.now() - dragEnd < 400) e.preventDefault();
  });
  // Mittlere Taste: sonst startet der Browser sein Auto-Scrollen (Pfeilkreuz)
  canvas.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if ((e.button !== 2 && e.button !== 1) || !free()) return;
    drag = { x: e.clientX, y: e.clientY, mask: e.button === 2 ? 2 : 4 }; // buttons: 2 = rechte, 4 = mittlere Taste
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !free()) return;
    if (!(e.buttons & drag.mask)) return endDrag(); // Taste schon los (z. B. mit einer anderen zusammen gedrückt)
    if (drag.mask === 4) pan(e.clientX - drag.x, e.clientY - drag.y);
    else {
      orbit.goal.yaw -= (e.clientX - drag.x) * TURN;
      orbit.goal.pitch += (e.clientY - drag.y) * TURN;
      limit(orbit.goal, true);
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  function endDrag() {
    if (drag) dragEnd = performance.now();
    drag = null;
  }
  canvas.addEventListener('pointerup', (e) => (e.button === 2 || e.button === 1) && endDrag());
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!free()) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // Zeilen (Firefox) → Pixel
    orbit.goal.dist *= Math.exp(delta * ZOOM);
    limit(orbit.goal, false);
  }, { passive: false });

  return {
    camera,
    setView,
    update,
    // zurück zur Ansicht des Platzes (nach Drehen/Zoomen/Verschieben)
    resetView() {
      if (orbit) setView(current);
    },
  };
}
