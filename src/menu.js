// Einstellungsmenü (Zahnrad am Schrank und im Spiel) mit den Bereichen Spieler, Grafik und Effekte.
// Ein weiterer Bereich (z. B. „Designs“) = ein Knopf in .tabs plus ein <section data-pane> in index.html.
// Dazu das Fenster beim ersten Start, das nach dem Namen fragt. Alles gilt nur für diesen PC (settings.js).
import { OPTIONS, cleanName, levelOf, withLevel, NAME_MAX } from './settings.js';

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

// get = aktuelle Einstellungen, onChange(neue) bei jeder Änderung
export function createMenu({ get, onChange }) {
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
