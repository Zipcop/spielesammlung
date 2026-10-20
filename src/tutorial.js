// Spielanleitung je Spiel als Buchseite: kurze Abschnitte mit Bild und Text (tutorials.js). Am Tisch vor dem Start
// über „Spielanleitung“, im Spiel über den „?“-Knopf. Texte nur per textContent.
import './tutorial.css';
import { TUTORIALS } from './tutorials.js';

export function createTutorial() {
  const shade = document.createElement('div');
  shade.className = 'book-shade';
  shade.hidden = true;
  shade.innerHTML = `
    <article class="book" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="book-title">
      <button class="book-close" data-close title="Schließen" aria-label="Schließen">×</button>
      <p class="book-kicker">Spielanleitung</p>
      <h2 id="book-title" data-title></h2>
      <div data-body></div>
      <p class="book-foot">Kamera: rechte Maustaste ziehen = drehen · Mausrad drücken + ziehen = verschieben · Mausrad = zoomen</p>
      <button class="book-done" data-done>Alles klar</button>
    </article>`;
  document.body.append(shade);
  const q = (name) => shade.querySelector(`[data-${name}]`);

  // flip = Bild rechts statt links (Bilder wechseln sich ab)
  function section({ title, text, img }, flip) {
    const sec = document.createElement('section');
    sec.className = flip ? 'book-sec flip' : 'book-sec';
    if (img) {
      const pic = new Image();
      pic.src = `anleitung/${img}`;
      pic.alt = '';
      sec.append(pic);
    }
    const words = document.createElement('div');
    words.append(Object.assign(document.createElement('h3'), { textContent: title }), Object.assign(document.createElement('p'), { textContent: text }));
    sec.append(words);
    return sec;
  }

  function show(name) {
    let pics = 0;
    q('title').textContent = name;
    q('body').replaceChildren(...TUTORIALS[name].map((s) => section(s, !!s.img && pics++ % 2 === 1)));
    shade.hidden = false;
    shade.scrollTop = 0;
    shade.querySelector('.book').focus({ preventScroll: true }); // Pfeiltasten und Leertaste blättern
  }

  const close = () => (shade.hidden = true);
  q('close').onclick = q('done').onclick = close;
  // Klick daneben schließt – aber nicht, wenn nur beim Markieren von Text die Maus neben dem Buch losgelassen wurde
  let downOnShade = false;
  shade.addEventListener('pointerdown', (e) => (downOnShade = e.target === shade));
  shade.addEventListener('click', (e) => downOnShade && e.target === shade && close());
  // Solange die Seite offen ist, bekommt das Spiel keine Tasten (Leertaste würfelt sonst dahinter); Esc schließt.
  // Tab bleibt aus – sonst landet der Fokus auf Knöpfen hinter der Seite (Enter würde dort würfeln)
  window.addEventListener('keydown', (e) => {
    if (shade.hidden) return;
    e.stopPropagation();
    if (e.key === 'Tab') e.preventDefault();
    if (e.key === 'Escape') close();
  }, true);

  return {
    show, // name = Spiel (wie im Schrank)
    close,
  };
}
