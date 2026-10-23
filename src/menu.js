// Einstellungsmenü (Zahnrad am Schrank und im Spiel) mit den Bereichen Spieler, Grafik und Effekte.
// Ein weiterer Bereich (z. B. „Designs“) = ein Knopf in .tabs plus ein <section data-pane> in index.html.
// Dazu das Fenster beim ersten Start, das nach dem Namen fragt. Alles gilt nur für diesen PC (settings.js).
import { OPTIONS, cleanName, levelOf, withLevel, NAME_MAX } from './settings.js';
import { loadStats, tally, pairs } from './stats.js';
import { PLAYABLE } from './games.js';

const $ = (id) => document.getElementById(id);

const LEVEL_TEXT = {
  niedrig: 'Für schwache PCs: weniger Bildpunkte, keine Kantenglättung, nur das Sieg-Konfetti.',
  mittel: 'Standard: weiche Schatten, Kantenglättung, Lichtschein, Staub und Umriss.',
  hoch: 'Wie Mittel, dazu feinere Schatten und schärfer auf skalierten Bildschirmen.',
  ultra: 'Alles an – auch die teure Umgebungsverdeckung.',
};

// [Schlüssel, Name, Erklärung, Beschriftung je Wert]
const GRAPHICS = [
  ['scale', 'Auflösung', 'weniger Bildpunkte = schneller, aber unschärfer', { 0.5: '50 %', 0.75: '75 %', 1: '100 %' }],
  ['maxDpr', 'Pixeldichte höchstens', 'zählt nur bei hochauflösenden oder skalierten Bildschirmen', { 1: '1×', 1.5: '1,5×', 2: '2×' }],
  ['shadows', 'Schatten', 'weich kostet etwas mehr als einfach', { off: 'Aus', hard: 'Einfach', soft: 'Weich' }],
  ['shadowSize', 'Schatten-Auflösung', 'höher = feinere Schattenkanten, braucht mehr Grafikspeicher', { 512: '512', 1024: '1024', 2048: '2048', 4096: '4096' }],
  ['aa', 'Kantenglättung', 'glatte statt treppiger Kanten (4-fach)', { false: 'Aus', true: 'An' }],
];

// Designs: [Schlüssel, Name, Erklärung, Beschriftung je Wert] – nur Aussehen, nur auf diesem PC
const DESIGNS = [
  ['room', 'Zimmer', 'Einrichtung des Spielzimmers', { wohnzimmer: 'Wohnzimmer', kamin: 'Kaminzimmer', casino: 'Casino-Lounge' }],
  ['daytime', 'Tageszeit', 'Licht und Blick aus dem Fenster', { tag: 'Tag', abend: 'Abend', nacht: 'Nacht' }],
  ['brightness', 'Helligkeit', 'heller, wenn der Bildschirm dunkel ist oder man wenig erkennt', { 1: 'Normal', 1.3: 'Hell', 1.7: 'Sehr hell' }],
  ['dice', 'Würfel', 'Kniffel und Mensch ärgere dich nicht', { weiss: 'Weiß', elfenbein: 'Elfenbein', rot: 'Rot', schwarz: 'Schwarz' }],
  ['felt', 'Filz', 'Würfelschale und Würfelteller', { gruen: 'Grün', rot: 'Rot', blau: 'Blau' }],
  ['chessSet', 'Schachfiguren', 'Material der Figuren', { holz: 'Holz', marmor: 'Marmor', metall: 'Gold und Silber' }],
  ['cardBack', 'Kartenrücken', 'Farbe der Rückseite', { rot: 'Rot', blau: 'Blau', gruen: 'Grün' }],
];

// [Schlüssel, Name, Erklärung, Leistung]
const EFFECTS = [
  ['bloom', 'Lichtschein', 'Lampen und Glanzlichter strahlen weich', 'mittel'],
  ['ao', 'Umgebungsverdeckung', 'weiche Schatten in Ecken, unter Würfeln, Figuren und Karten', 'hoch'],
  ['dust', 'Staub im Lichtkegel', 'feine Körnchen schweben unter der Hängelampe', 'gering'],
  ['outline', 'Leuchtender Umriss', 'was unter der Maus liegt oder ausgewählt ist, leuchtet', 'gering'],
  ['confetti', 'Sieg-Konfetti', 'Konfetti fliegt, wenn du gewinnst', 'sehr gering'],
];

// Kleines Element bauen – Namen kommen vom anderen PC, deshalb nur textContent
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

// Reiter „Statistik“: je Paar eine Tabelle (Spiel, Siege je Name, Remis, letzte Partie), dazu „Zurücksetzen“ mit Rückfrage
function fillStats(me, onReset) {
  const list = loadStats();
  const box = $('stats-list');
  const all = pairs(list, me);
  if (!all.length) return box.replaceChildren(el('p', 'Noch keine Partie gezählt – spielt ein Spiel zu zweit bis zum Ende.', 'muted'));
  box.replaceChildren(...all.map((pair) => {
    const [a, b] = pair.includes(me) ? [me, pair.find((n) => n !== me)] : pair; // eigener Name zuerst
    const t = tally(list, pair);
    const table = el('table', undefined, 'stats');
    const head = table.createTHead().insertRow();
    ['Spiel', a, b, 'Remis', 'Zuletzt'].forEach((h) => head.append(el('th', h)));
    const body = table.createTBody();
    for (const game of [...PLAYABLE.keys()].filter((g) => t[g])) {
      const row = body.insertRow();
      const day = new Date(t[game].last).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      [game, t[game].wins[a], t[game].wins[b], t[game].draws, day].forEach((x) => row.append(el('td', String(x))));
    }
    const reset = el('button', 'Zurücksetzen', 'secondary small');
    reset.onclick = () => {
      const sure = el('span', `Alles von ${a} und ${b} löschen – auch auf dem anderen PC? `, 'small');
      const yes = el('button', 'Ja, löschen', 'small');
      const no = el('button', 'Nein', 'secondary small');
      yes.onclick = () => {
        onReset(pair);
        fillStats(me, onReset);
      };
      no.onclick = () => fillStats(me, onReset);
      reset.replaceWith(sure, yes, no);
    };
    const section = el('div', undefined, 'stats-pair');
    section.append(el('h3', `${a} gegen ${b}`), table, reset);
    return section;
  }));
}

// get = aktuelle Einstellungen, onChange(neue) bei jeder Änderung, onReset([a, b]) = Statistik eines Paars zurücksetzen
export function createMenu({ get, onChange, onReset }) {
  const root = $('settings');
  const pane = (name) => root.querySelector(`[data-pane="${name}"]`);

  pane('grafik').insertAdjacentHTML('beforeend', GRAPHICS.map(([key, label, help, names]) => `
    <label class="setting">
      <span>${label}<small>${help}</small></span>
      <select data-key="${key}">${OPTIONS[key].map((v) => `<option value="${v}">${names[v]}</option>`).join('')}</select>
    </label>`).join('') + `
    <label class="setting check">
      <span>FPS anzeigen<small>Bilder pro Sekunde – zum Vergleichen der Stufen</small></span>
      <input type="checkbox" data-key="fps">
    </label>`);
  pane('designs').insertAdjacentHTML('beforeend', DESIGNS.map(([key, label, help, names]) => `
    <label class="setting">
      <span>${label}<small>${help}</small></span>
      <select data-key="${key}">${OPTIONS[key].map((v) => `<option value="${v}">${names[v]}</option>`).join('')}</select>
    </label>`).join(''));
  pane('effekte').insertAdjacentHTML('beforeend', EFFECTS.map(([key, label, help, cost]) => `
    <label class="setting check">
      <span>${label} <em class="cost ${cost.replace(' ', '-')}">Leistung: ${cost}</em><small>${help}</small></span>
      <input type="checkbox" data-key="${key}">
    </label>`).join(''));
  $('name-input').maxLength = NAME_MAX;

  const change = (next) => {
    onChange(next);
    fill();
  };

  // Steuerelemente auf den aktuellen Stand bringen
  function fill() {
    const s = get();
    const level = levelOf(s);
    root.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === level));
    $('level-text').textContent = level ? LEVEL_TEXT[level] : 'Eigene Einstellung – wähl oben eine Stufe, um zurückzusetzen.';
    root.querySelectorAll('select[data-key]').forEach((el) => (el.value = String(s[el.dataset.key])));
    root.querySelectorAll('input[type=checkbox][data-key]').forEach((el) => (el.checked = s[el.dataset.key]));
    $('name-input').value = s.name;
    $('name-error').hidden = true;
    fillStats(s.name, onReset);
  }

  function saveName() {
    const name = cleanName($('name-input').value);
    if (!name) {
      $('name-error').hidden = false;
      return;
    }
    $('name-input').value = name;
    $('name-error').hidden = true;
    if (name !== get().name) change({ ...get(), name });
  }

  // Eingabe nicht verlieren, wenn direkt geschlossen wird – ungültig (leer) = alter Name bleibt
  function close() {
    if (!cleanName($('name-input').value)) $('name-input').value = get().name;
    saveName();
    root.hidden = true;
  }

  root.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (e.target === $('name-input')) return saveName();
    if (!key) return;
    const value = e.target.type === 'checkbox' ? e.target.checked : OPTIONS[key].find((v) => String(v) === e.target.value);
    change({ ...get(), [key]: value });
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (e.target === root || b?.dataset.close !== undefined) return close(); // daneben klicken oder „Fertig“
    if (b?.dataset.level) change(withLevel(get(), b.dataset.level));
    if (b?.dataset.tab) {
      root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('on', t === b));
      root.querySelectorAll('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
    }
  });
  // Solange ein Fenster offen ist, gehören ihm die Tasten – sonst würfelt z. B. die Leertaste im Hintergrund.
  // Auf window in der Einfangphase, damit es auch greift, wenn der Fokus auf <body> liegt.
  window.addEventListener('keydown', (e) => {
    const open = [root, $('welcome')].find((el) => !el.hidden);
    if (!open) return;
    e.stopPropagation();
    if (e.key === 'Escape' && open === root) close();
  }, true);

  return {
    open() {
      fill();
      root.hidden = false;
      root.querySelector('[data-tab].on').focus();
    },
  };
}

// Erster Start: nach dem Namen fragen, dann done(name)
export function askName(done) {
  const root = $('welcome');
  const input = $('welcome-input');
  input.maxLength = NAME_MAX;
  root.hidden = false;
  input.focus();
  $('welcome-form').onsubmit = (e) => {
    e.preventDefault();
    const name = cleanName(input.value);
    $('welcome-error').hidden = !!name;
    if (!name) return;
    root.hidden = true;
    done(name);
  };
}
