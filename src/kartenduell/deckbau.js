// Deckbau (Nico 20.10.2026: feste Decks + eigener Deckbau): Fenster mit allen Karten. Linksklick = 1 Karte dazu,
// Rechtsklick = 1 weg (auch in der Liste rechts per Klick). Genau 40 Karten, höchstens 3 bzw. 1 Kopie.
// Gespeichert wird auf diesem PC (deck.js). Texte nur per textContent.
import { CARDS, CARD, DECKS, DECK_SIZE, MAX_COPIES, deckProblem, countOf, sortIds } from './cards.js';
import { loadDeck, saveDeck, cleanDeckName, NAME_MAX } from './deck.js';
import { paintCard } from './art.js';

const TABS = [['all', 'Alle'], ['monster', 'Monster'], ['spell', 'Zauber'], ['trap', 'Fallen']];

export function createBuilder({ onSave }) {
  const root = document.createElement('div');
  root.className = 'kd-builder';
  root.hidden = true;
  root.innerHTML = `
    <div class="box">
      <div class="pool">
        <div class="tabs" data-tabs></div>
        <p class="muted small">Linksklick = Karte ins Deck · Rechtsklick = wieder heraus · Maus darüber = groß ansehen</p>
        <div class="grid" data-grid></div>
      </div>
      <div class="side">
        <canvas width="512" height="716" data-big></canvas>
        <label class="small">Name <input data-name maxlength="${NAME_MAX}"></label>
        <p class="count" data-count></p>
        <p class="why" data-why></p>
        <ul class="list" data-list></ul>
        <div class="row" data-starts></div>
        <div class="row">
          <button class="secondary small" data-clear>Leeren</button>
          <button class="small" data-save>Speichern</button>
          <button class="secondary small" data-close>Schließen</button>
        </div>
      </div>
    </div>`;
  document.body.append(root);
  const q = (name) => root.querySelector(`[data-${name}]`);
  let list = [];
  let tab = 'all';

  // Kacheln einmal anlegen (Bilder zeichnen dauert etwas – erst beim ersten Öffnen)
  const tiles = new Map();
  function buildTiles() {
    if (tiles.size) return;
    for (const c of CARDS) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      const canvas = document.createElement('canvas');
      canvas.width = 236;
      canvas.height = 330;
      paintCard(canvas, c.id);
      const n = document.createElement('span');
      n.className = 'n';
      tile.append(canvas, n);
      tile.onclick = () => add(c.id);
      tile.oncontextmenu = (e) => {
        e.preventDefault();
        remove(c.id);
      };
      tile.onmouseenter = () => paintCard(q('big'), c.id);
      tiles.set(c.id, { tile, n });
      q('grid').append(tile);
    }
  }

  const limit = (id) => Math.min(MAX_COPIES, CARD[id].max);
  function add(id) {
    if (list.length >= DECK_SIZE || (countOf(list)[id] ?? 0) >= limit(id)) return;
    list = sortIds([...list, id]);
    render();
  }
  function remove(id) {
    const i = list.indexOf(id);
    if (i < 0) return;
    list = list.filter((_, k) => k !== i);
    render();
  }

  function render() {
    const counts = countOf(list);
    q('tabs').replaceChildren(...TABS.map(([key, label]) => {
      const b = document.createElement('button');
      b.className = `secondary small${key === tab ? ' on' : ''}`;
      b.textContent = label;
      b.onclick = () => {
        tab = key;
        render();
      };
      return b;
    }));
    for (const [id, { tile, n }] of tiles) {
      tile.hidden = tab !== 'all' && CARD[id].kind !== tab;
      n.textContent = counts[id] ? `${counts[id]}/${limit(id)}` : '';
      tile.classList.toggle('full', (counts[id] ?? 0) >= limit(id));
    }
    const kinds = { monster: 0, spell: 0, trap: 0 };
    for (const id of list) kinds[CARD[id].kind]++;
    q('count').textContent = `${list.length} / ${DECK_SIZE} Karten · ${kinds.monster} Monster, ${kinds.spell} Zauber, ${kinds.trap} Fallen`;
    q('count').classList.toggle('ok', list.length === DECK_SIZE);
    q('why').textContent = list.length ? deckProblem(list) : '';
    q('list').replaceChildren(...Object.entries(counts).map(([id, k]) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = CARD[id].name;
      const num = document.createElement('b');
      num.textContent = `${k}×`;
      li.append(name, num);
      li.title = 'Klick = eine weniger';
      li.onclick = () => remove(id);
      li.onmouseenter = () => paintCard(q('big'), id);
      return li;
    }));
  }

  q('starts').replaceChildren(...Object.entries(DECKS).map(([key, d]) => {
    const b = document.createElement('button');
    b.className = 'secondary small';
    b.textContent = `Wie ${d.name}`;
    b.title = `Mit dem Deck ${d.name} anfangen und dann ändern`;
    b.onclick = () => {
      list = sortIds(d.list);
      render();
    };
    return b;
  }));
  q('clear').onclick = () => {
    list = [];
    render();
  };
  q('save').onclick = () => {
    const deck = saveDeck({ name: q('name').value, list });
    q('name').value = deck.name;
    onSave(deck);
    q('why').textContent = deckProblem(list) ? `Gespeichert – spielbar erst mit genau ${DECK_SIZE} Karten.` : 'Gespeichert.';
  };
  q('close').onclick = () => (root.hidden = true);
  root.onclick = (e) => e.target === root && (root.hidden = true);

  return {
    open() {
      buildTiles();
      const saved = loadDeck();
      list = saved?.list ?? [];
      q('name').value = cleanDeckName(saved?.name);
      paintCard(q('big'), list[0] ?? CARDS[0].id);
      root.hidden = false;
      render();
    },
    close: () => (root.hidden = true),
    remove: () => root.remove(),
    isOpen: () => !root.hidden,
  };
}
