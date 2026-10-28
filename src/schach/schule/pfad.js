// Schach-Schule, Lernpfad (Anzeige): Kapitelliste → Erklärung mit Beispielstellung → Übungen → Sterne.
// Regeln in lernpfad.js, Übungen in kapitel.json; das Lösen läuft wie bei Schach-Rätsel (puzzle.js).
import { german } from '../panel.js';
import { puzzleFrom, positionOf, isRight } from '../puzzle.js';
import { CHAPTERS, PER_CHAPTER, SHOW_COST, unlocked, finishChapter, nextChapter, exercisesOf, levelOf, starsFor } from './lernpfad.js';
import { stateOf } from './brett.js';

const COLOR = { w: 'Weiß', b: 'Schwarz' };
const LOOK_MS = 800; // kurz die Stellung zeigen, dann zieht der Gegner
const REPLY_MS = 450;
const WRONG_MS = 900;
const PLAY_MS = 900;

const stars = (n) => `<span class="sch-stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;

export function openPfad(ctx) {
  let data = null; // kapitel.json
  let chapter = null;
  let list = []; // Übungen des Kapitels
  let i = 0; // Nummer der Übung
  let p = null; // aktuelles Rätsel
  let k = 0; // so viele Züge der Lösung stehen auf dem Brett
  let mistakes = 0;
  let phase = 'list'; // list | intro | look | play | reply | show | solved | done

  import('./kapitel.json').then((m) => {
    data = m.default;
    if (ctx.alive()) renderList();
  });
  ctx.body.innerHTML = '<p class="sch-note">Kapitel werden geladen …</p>';

  // --- Kapitelliste ---
  function renderList() {
    ctx.fresh();
    phase = 'list';
    ctx.setPlay(null);
    ctx.marks();
    const path = ctx.schule.path;
    const { level, toNext, stars: all } = levelOf(path);
    ctx.body.innerHTML = `
      <div class="sch-box"><b>Level ${level}</b> · ${all} ★${toNext ? ` · noch ${toNext} ★ bis Level ${level + 1}` : ''}</div>
      <button data-go>Weiter lernen</button>
      <div class="sch-list">${CHAPTERS.map((c, n) => {
        const open = unlocked(path, n);
        return `<button class="secondary sch-item" data-chapter="${c.id}"${open ? '' : ' disabled'}><span>${n + 1}. ${c.title}</span>${open ? stars(path[c.id]?.stars ?? 0) : '<span class="sch-lock">gesperrt</span>'}</button>`;
      }).join('')}</div>
      <p class="sch-note">Je Kapitel ${PER_CHAPTER} Übungen. Ohne Fehler 3 ★, mit 1–2 Fehlern 2 ★, sonst 1 ★. „Lösung zeigen“ zählt wie ${SHOW_COST} Fehler. Ab 1 ★ ist das nächste Kapitel frei, je 3 ★ steigt dein Level.</p>`;
  }

  // --- Erklärung mit Beispielstellung ---
  function intro(id) {
    chapter = CHAPTERS.find((c) => c.id === id);
    ctx.fresh();
    phase = 'intro';
    ctx.setPlay(null);
    let example = chapter.example;
    if (example === 'auto') { // weiteres Rätsel des Themas (CC0): Stellung nach dem Gegnerzug, Lösungszug als Pfeil
      const ex = puzzleFrom(data.examples[id]);
      const state = positionOf(ex, [ex.line[0]]);
      ctx.show(state, true);
      ctx.marks([{ uci: ex.line[1], look: 'green' }]);
      const san = positionOf(ex, ex.line.slice(0, 2)).san[1];
      example = { note: `Beispiel aus einer echten Partie (Rätsel ${ex.id}, lichess.org, CC0): ${COLOR[ex.color]} spielt ${german(san)} (grüner Pfeil).` };
    } else {
      ctx.show(stateOf(example.fen), true);
      ctx.marks(example.arrows.map((uci, n) => ({ uci, look: n ? 'blue' : 'green' }))); // grün = der Zug, blau = was danach kommt
    }
    ctx.body.innerHTML = `
      <h3 class="sch-h">${chapter.title}</h3>
      <p class="sch-text">${chapter.text}</p>
      <p class="sch-box">${example.note}</p>
      <button data-start>Übungen starten (${PER_CHAPTER})</button>
      <button class="secondary small" data-list>Alle Kapitel</button>`;
  }

  // --- Übungen ---
  function start() {
    list = exercisesOf(data, chapter.id);
    i = 0;
    mistakes = 0;
    ctx.body.innerHTML = `
      <h3 class="sch-h">${chapter.title}</h3>
      <div class="sch-progress" data-dots></div>
      <p class="chess-status" data-status></p>
      <p class="sch-note" data-info></p>
      <div class="row"><button class="secondary small" data-solution>Lösung zeigen</button><button class="small" data-next>Weiter</button></div>
      <p class="pz-source" data-source></p>`;
    load();
  }

  const played = () => p.line.slice(0, k);
  const showMoves = (moves) => ctx.show(positionOf(p, moves));

  function load() {
    ctx.fresh();
    p = puzzleFrom(list[i]);
    k = 0;
    phase = 'look';
    ctx.marks();
    ctx.setPlay(null);
    ctx.show(positionOf(p, []), true);
    render(`Du spielst ${COLOR[p.color]}. Gleich zieht ${COLOR[p.color === 'w' ? 'b' : 'w']} …`);
    ctx.later(LOOK_MS, () => {
      k = 1;
      showMoves(played());
      phase = 'play';
      ctx.setPlay({ color: p.color, onMove: tryMove });
      render(`Finde den besten Zug für ${COLOR[p.color]}.`);
    });
  }

  function tryMove(uci) {
    if (phase !== 'play') return;
    if (!isRight(p, k, uci)) {
      mistakes++;
      phase = 'reply';
      showMoves([...played(), uci]);
      render(`${german(positionOf(p, [...played(), uci]).san.at(-1))} ist nicht die Lösung.`);
      ctx.later(WRONG_MS, () => {
        showMoves(played());
        phase = 'play';
        render('Versuch es noch einmal.');
      });
      return;
    }
    const mate = positionOf(p, [...played(), uci]).mate; // jedes Matt ist richtig
    k += 1;
    if (mate || k >= p.line.length) {
      showMoves(mate ? [...p.line.slice(0, k - 1), uci] : played());
      return solved('Richtig gelöst!');
    }
    showMoves(played());
    phase = 'reply';
    render('Richtig!');
    ctx.later(REPLY_MS, () => {
      k += 1;
      showMoves(played());
      phase = 'play';
      render('Richtig! Und jetzt?');
    });
  }

  function solved(text) {
    phase = 'solved';
    ctx.setPlay(null);
    render(text);
  }

  function showSolution() {
    if (phase !== 'play') return;
    mistakes += SHOW_COST;
    phase = 'show';
    ctx.setPlay(null);
    const step = () => {
      if (k >= p.line.length) return solved('So geht die Lösung.');
      k += 1;
      showMoves(played());
      render('Lösung wird gezeigt …');
      ctx.later(PLAY_MS, step);
    };
    ctx.later(PLAY_MS / 2, step);
    render('Lösung wird gezeigt …');
  }

  function next() {
    if (phase !== 'solved') return;
    if (i + 1 < list.length) {
      i++;
      return load();
    }
    finish();
  }

  function finish() {
    phase = 'done';
    const r = finishChapter(ctx.schule.path, chapter.id, mistakes);
    ctx.schule.path = r.path;
    ctx.save();
    const { level } = levelOf(r.path);
    const opened = r.opened && CHAPTERS.find((c) => c.id === r.opened);
    ctx.body.innerHTML = `
      <h3 class="sch-h">${chapter.title} geschafft!</h3>
      <div class="sch-result">${stars(r.stars)}</div>
      <p class="sch-text">${mistakes ? `${mistakes} Fehler` : 'Ohne Fehler'} – ${r.stars} ${r.stars === 1 ? 'Stern' : 'Sterne'}${r.better ? ' (neuer Bestwert)' : ''}.
        ${r.levelUp ? `<b>Level-Aufstieg: Level ${level}!</b>` : ''} ${opened ? `Neues Kapitel frei: <b>${opened.title}</b>.` : ''}</p>
      ${r.stars < 3 ? `<p class="sch-note">Für ${r.stars + 1} ★ höchstens ${r.stars === 1 ? 2 : 0} Fehler.</p>` : ''}
      <div class="row"><button data-again class="secondary">Nochmal</button><button data-go>Weiter lernen</button></div>
      <button class="secondary small" data-list>Alle Kapitel</button>`;
  }

  function render(message) {
    if (!ctx.q('status')) return;
    ctx.q('status').textContent = message;
    ctx.q('status').classList.toggle('pz-good', phase === 'solved');
    ctx.q('dots').innerHTML = list.map((_, n) => `<i class="${n < i || (n === i && phase === 'solved') ? 'ok' : n === i ? 'now' : ''}"></i>`).join('');
    ctx.q('info').textContent = `Übung ${i + 1} von ${list.length} · Fehler bisher: ${mistakes} (jetzt ${starsFor(mistakes)} ★)`;
    ctx.q('solution').disabled = phase !== 'play';
    ctx.q('next').disabled = phase !== 'solved';
    ctx.q('next').textContent = i + 1 < list.length ? 'Nächste Übung' : 'Kapitel abschließen';
    ctx.q('source').textContent = `Rätsel ${p.id} · lichess.org (CC0)`;
  }

  return {
    click(b) {
      if (!data) return;
      if (b.dataset.chapter) intro(b.dataset.chapter);
      else if ('go' in b.dataset) intro(nextChapter(ctx.schule.path));
      else if ('list' in b.dataset) renderList();
      else if ('start' in b.dataset || 'again' in b.dataset) start();
      else if ('solution' in b.dataset) showSolution();
      else if ('next' in b.dataset) next();
    },
  };
}
