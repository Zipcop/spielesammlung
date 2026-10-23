// Namensschilder an den Plätzen – für alle Spiele gleich (Stil wie bei Poker): kleines dunkles Kärtchen flach auf dem
// Tisch, Name groß, wer dran ist, leuchtet gelb, wer raus ist, ist blass. Die Schrift steht immer aufrecht für den,
// der zuschaut. Schilder sind nie anklickbar (raycast aus) – Klicks gehen durch auf Tisch, Karten und Würfel.
// Namen kommen nur als Text auf eine Canvas-Textur, nie als HTML.
import * as THREE from 'three';

// Text je Sitz: eigener Name, Mitspieler, Computer wie im Seitenfeld (cpu), leere Plätze '' (kein Schild)
export function seatLabels(n, { mySeat, humans = [], me, other, cpu = () => 'Computer', taken = () => true }) {
  return Array.from({ length: n }, (_, s) => (!taken(s) ? '' : s === mySeat ? me || 'Du' : humans.includes(s) ? other || 'Mitspieler' : cpu(s)));
}

// Vier Sitze (0 = +z, 1 = −x, 2 = −z, 3 = +x), Zuschauer auf me: Das Schild liegt rechts neben dem Platz (aus Sicht
// dessen, der dort sitzt) = 1 – nur beim rechten Nachbarn des Zuschauers links (−1), sonst verdeckt dessen Hand es
export const seatSide = (seat, me) => ((seat - me + 4) % 4 === 3 ? -1 : 1);

// Zwei Plätze gegenüber (Spieler 0 auf +z, 1 auf −z): Lage vor Platz p – x quer (aus Sicht des Platzes), z Abstand
export const across = (p, x, z, y = 0) => (p === 0 ? { x, y, z } : { x: -x, y, z: -z });

// n Schilder, w × h = Größe in Brett-Einheiten, flach y über der Unterlage.
// set(labels, { at, view, turn, faded }): labels[s] = Text ('' = kein Schild), at(s) = Mitte des Schilds (lokal),
// view = Drehung um die Hochachse, in der die Schrift für den Zuschauer aufrecht steht, turn = wer dran ist (gelb)
export function createPlates(group, n, { w = 16, h = 4, y = 0.05 } = {}) {
  const plates = Array.from({ length: n }, () => buildPlate(group, w, h));
  return {
    set(labels, { at = null, view = 0, turn = null, faded = () => false } = {}) {
      plates.forEach((pl, s) => {
        const text = labels?.[s] ?? '';
        if (text) {
          const p = at(s);
          pl.mesh.position.set(p.x, p.y + y, p.z);
          pl.mesh.rotation.set(-Math.PI / 2, 0, view);
        }
        pl.draw(text, turn === s, faded(s));
      });
    },
  };
}

function buildPlate(group, w, h) {
  const material = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.8, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.renderOrder = 1;
  mesh.visible = false;
  mesh.raycast = () => {}; // nie anklickbar – Maus und Tisch greifen hindurch
  mesh.userData.plate = true; // keine Tisch-Physik (tisch.js)
  group.add(mesh);
  let c = null; // Leinwand erst beim ersten Namen – die Würfel-Tests bauen Bretter ohne DOM
  let key = null;
  return {
    mesh,
    draw(text, turn, faded) {
      mesh.visible = !!text;
      if (!text || key === `${text}|${turn}|${faded}`) return;
      key = `${text}|${turn}|${faded}`;
      if (!c) {
        c = document.createElement('canvas');
        c.width = 512;
        c.height = Math.round((512 * h) / w);
        material.map = new THREE.CanvasTexture(c);
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = 8;
        material.needsUpdate = true;
      }
      const g = c.getContext('2d');
      const H = c.height;
      g.clearRect(0, 0, 512, H);
      // deckend (bei Poker leicht durchsichtig): unter der hellen Lampe schiene sonst ein helles Brett durch
      g.fillStyle = turn ? 'rgb(240, 200, 80)' : 'rgb(24, 17, 12)';
      g.beginPath();
      g.roundRect(6, H * 0.08, 500, H * 0.84, H * 0.31);
      g.fill();
      g.fillStyle = turn ? '#2a1a08' : faded ? 'rgba(240, 230, 210, 0.45)' : '#f3e9d6';
      g.font = `bold ${Math.round(H * 0.41)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, H * 0.52, 470);
      material.map.needsUpdate = true;
    },
  };
}
