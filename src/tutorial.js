// Geführter Rundgang je Spiel: eine kleine Karte oben links erklärt Schritt für Schritt Ziel, Bedienung und
// Besonderheiten. Ein pulsierender Ring zeigt auf das passende Teil am Tisch (board.anchor(name) → Weltpunkt) oder
// eine Stelle im Seitenfeld leuchtet (el = CSS-Selektor). Erscheint beim ersten Öffnen eines Spiels auf diesem PC,
// danach jederzeit über den „?“-Knopf. Die Texte stehen in tutorials.js. Texte nur per textContent.
import './tutorial.css';
import { TUTORIALS } from './tutorials.js';

const KEY = 'spielesammlung-rundgang'; // welche Rundgänge dieser PC schon gesehen hat

function seen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function remember(name) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen().add(name)]));
  } catch {
    // ohne Speicher erscheint der Rundgang eben beim nächsten Mal wieder
  }
}

export function createTutorial({ room }) {
  const card = document.createElement('div');
  card.className = 'tut-card';
  card.hidden = true;
  card.innerHTML = `
    <div class="tut-head"><span data-head></span><button class="tut-close" data-close title="Rundgang beenden" aria-label="Rundgang beenden">×</button></div>
    <h3 data-title></h3>
    <p data-text></p>
    <div class="tut-nav"><button class="secondary small" data-back>Zurück</button><button class="small" data-next>Weiter</button></div>`;
  const ring = document.createElement('div');
  ring.className = 'tut-ring';
  ring.hidden = true;
  document.body.append(card, ring);
  const q = (name) => card.querySelector(`[data-${name}]`);
  let tour = null; // { name, steps, k, board }
  let marked = null; // gerade hervorgehobenes Element im Seitenfeld

  function render() {
    const step = tour.steps[tour.k];
    q('head').textContent = `So geht's: ${tour.name} · ${tour.k + 1}/${tour.steps.length}`;
    q('title').textContent = step.title;
    q('text').textContent = step.text;
    q('back').disabled = tour.k === 0;
    q('next').textContent = tour.k === tour.steps.length - 1 ? 'Los geht’s' : 'Weiter';
    marked?.classList.remove('tut-mark');
    marked = step.el ? document.querySelector(step.el) : null;
    marked?.classList.add('tut-mark');
    card.hidden = false;
  }

  function show(name, board) {
    const steps = TUTORIALS[name];
    if (!steps?.length) return;
    tour = { name, steps, k: 0, board };
    render();
  }

  function close() {
    if (!tour) return;
    remember(tour.name);
    tour = null;
    card.hidden = ring.hidden = true;
    marked?.classList.remove('tut-mark');
    marked = null;
  }

  q('close').onclick = close;
  q('back').onclick = () => {
    if (tour.k === 0) return;
    tour.k--;
    render();
  };
  q('next').onclick = () => {
    if (tour.k === tour.steps.length - 1) return close();
    tour.k++;
    render();
  };

  // Der Ring folgt seinem Teil – auch wenn sich die Kamera dreht oder das Teil bewegt
  room.onFrame(() => {
    const at = tour?.steps[tour.k].at;
    const point = at ? tour.board?.anchor?.(at) : null;
    const p = point ? room.toScreen(point) : null;
    ring.hidden = !p;
    if (p) ring.style.transform = `translate(${p.x}px, ${p.y}px)`;
  });

  return {
    show, // name = Spiel (wie im Schrank), board = sein Brett (für die Ringe)
    maybe: (name, board) => !seen().has(name) && show(name, board), // nur beim ersten Mal
    close,
    has: (name) => !!TUTORIALS[name]?.length,
  };
}
