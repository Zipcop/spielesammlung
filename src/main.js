import './style.css';
import { Lobby, normalizeCode, isValidCode } from './net.js';
import { createRoom } from './room.js';
import { PLAYABLE } from './games.js';
import { createBoard } from './kniffel/board.js';
import { startKniffel } from './kniffel/index.js';
import { createChessBoard } from './schach/board.js';
import { startSchach } from './schach/index.js';
import { LEVELS, loadRecord } from './schach/solo.js';
import { startRaetsel } from './schach/raetsel.js';
import { createMauMauBoard } from './maumau/board.js';
import { startMauMau } from './maumau/index.js';
import { createMaednBoard } from './maedn/board.js';
import { startMaedn } from './maedn/index.js';
import { createBillardBoard } from './billard/table.js';
import { startBillard } from './billard/index.js';
import { createRommeBoard } from './romme/board.js';
import { startRomme } from './romme/index.js';
import { unlockAudio } from './sound.js';
import { createTisch } from './tisch.js';
import { createTutorial } from './tutorial.js';
import { loadSettings, saveSettings, cleanName } from './settings.js';
import { createMenu, askName } from './menu.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

const room = createRoom(canvas);
let settings = loadSettings(); // nur dieser PC
room.applySettings(settings);
const board = createBoard(room.tableTop, { onStream: (msg) => lobby?.send(msg) });
board.ready(); // Physik-Engine schon im Hintergrund laden

// Je Spiel: Sachen auf dem Tisch, Start der Partie und Kamera am Platz (+ Spielernummer)
const GAMES = {
  Kniffel: { board, start: startKniffel, seat: 'seat' },
  Schach: { board: createChessBoard(room.tableTop), start: startSchach, seat: 'chess' },
  'Schach-Rätsel': { board: createChessBoard(room.tableTop), start: startRaetsel, seat: 'chess' }, // eigenes Brett: setTable blendet je Eintrag ein
  'Mau-Mau': { board: createMauMauBoard(room.tableTop), start: startMauMau, seat: 'cards' },
  // 4 Farben: Host + Gast (bzw. allein) – die freien Plätze spielt der Computer
  // Billard steht auf einem eigenen Tisch – der kleine Spieltisch wird solange ausgeblendet (setTable)
  Billard: { board: createBillardBoard(room.tableTop, { onStream: (msg) => lobby?.send(msg) }), start: startBillard, seat: 'billard' },
  'Mensch ärgere dich nicht': { board: createMaednBoard(room.tableTop, { onStream: (msg) => lobby?.send(msg) }), start: startMaedn, seat: 'maedn' },
  Rommé: { board: createRommeBoard(room.tableTop), start: startRomme, seat: 'romme' },
};
for (const [n, g] of Object.entries(GAMES)) g.board.group.visible = n === 'Kniffel'; // nur ein Spiel liegt auf dem Tisch
// Brett greifen, schieben, umwerfen, aufbauen – für alle Spiele gleich
const tisch = createTisch({ room, canvas, send: (msg) => lobby?.send(msg) });
// Geführter Rundgang je Spiel – beim ersten Öffnen auf diesem PC, danach über den „?“-Knopf
const tutorial = createTutorial({ room });
const applyDesigns = (s) => Object.values(GAMES).forEach((g) => g.board.setDesign?.(s)); // Würfel, Filz, Figuren, Kartenrücken
applyDesigns(settings);

let lobby = null;
let host = null; // true/false, solange eine Verbindung steht – sonst null
let game = null;
let table = 'Kniffel'; // Spiel, das auf dem Tisch liegt
let view = 'shelf';
let noticeTimer = null;
let peerName = ''; // Name des Mitspielers (beim Empfang geprüft), '' = noch unbekannt

const otherName = () => peerName || 'Mitspieler';
const names = { me: () => settings.name, other: otherName }; // für die Spiele – Namen können sich während der Partie ändern

// view: shelf | table | hosting | joining | playing
function show(next, text = '', kind = 'error') {
  view = next;
  clearTimeout(noticeTimer);
  document.querySelectorAll('[data-view]').forEach((el) => (el.hidden = !el.dataset.view.split(' ').includes(next)));
  $('message').textContent = text;
  $('message').className = `message ${kind}`;
  $('message').hidden = !text;

  // Verbindungsleiste und Schrank-Hinweis hängen davon ab, ob schon jemand verbunden ist
  const connected = host !== null;
  $('hud').hidden = !connected;
  $('hud').classList.toggle('below', next !== 'playing'); // am Schrank unten rechts, wo sonst das Code-Feld ist
  $('hud-shelf').hidden = next !== 'playing';
  $('join-form').hidden = connected;
  showNames();
}

// Name des Mitspielers in Leiste und Schrank-Hinweis – nur per textContent, er kommt ja vom anderen PC
function showNames() {
  $('peer-name').textContent = otherName();
  if (host === null) $('shelf-hint').innerHTML = 'Spiel anklicken · <span class="dot"></span> = spielbar';
  else $('shelf-hint').textContent = host ? 'Such das nächste Spiel aus – ihr landet beide am Tisch' : `${otherName()} sucht das nächste Spiel aus …`;
}

// Was auf dem Tisch liegt (Würfelschale, Schachbrett …)
function setTable(name) {
  table = name;
  for (const [n, g] of Object.entries(GAMES)) g.board.group.visible = n === name;
  room.setFurniture(name !== 'Billard');
}

// Zurück zum Schrank – die Verbindung bleibt bestehen
function toShelf(text = '') {
  tutorial.close();
  tisch.setBoard(null);
  game?.stop();
  game = null;
  setTable('Kniffel');
  room.shelf.setTaken(null);
  $('tip').hidden = true;
  $('confirm').hidden = true;
  canvas.style.cursor = '';
  room.setView('shelf');
  show('shelf', text);
}

// Eigener Klick „Zum Schrank“: der Mitspieler kommt mit
function bothToShelf() {
  lobby?.send({ t: 'shelf' });
  toShelf();
}

function disconnect(text = '') {
  lobby?.leave();
  lobby = null;
  host = null;
  peerName = '';
  toShelf(text);
}

// Hinweis, der nach ein paar Sekunden von selbst verschwindet
function notice(text) {
  show(view, text, 'info');
  noticeTimer = setTimeout(() => ($('message').hidden = true), 4000);
}

function tip(e, text) {
  $('tip').hidden = !text;
  $('tip').textContent = text || '';
  $('tip').style.left = `${e.clientX + 18}px`;
  $('tip').style.top = `${e.clientY + 18}px`;
}

// Rückfrage im Spiel (kein confirm(): das hält die Seite an, und der Mitspieler hielte die Verbindung für tot)
function ask(text, onYes) {
  $('confirm-text').textContent = text;
  $('confirm').hidden = false;
  $('confirm-yes').onclick = () => {
    $('confirm').hidden = true;
    onYes();
  };
}

// level gesetzt = allein gegen den Computer (ohne Verbindung)
function startGame(name, me, level) {
  game?.stop();
  setTable(name);
  const g = GAMES[name];
  tisch.setBoard(g.board);
  const onLeave = level === undefined ? bothToShelf : () => toShelf();
  const free = settings.free && level === undefined && !!PLAYABLE.get(name).free; // nur zu zweit; der Host entscheidet
  game = g.start({ room, board: g.board, canvas, me, level, ask, names, free, send: (msg) => lobby?.send(msg), onLeave });
  room.shelf.setHover(null);
  room.shelf.setTaken(name);
  room.setView(g.seat + me);
  document.querySelectorAll('[data-game]').forEach((el) => (el.hidden = el.dataset.game !== name));
  // Bedienhinweis je nach Modus – der Gast erfährt „ohne Hilfen“ erst mit dem ersten Spielstand, deshalb fragt das Spiel nach
  document.querySelectorAll('[data-hint]').forEach((el) => (el.textContent = el.dataset.hint));
  show('playing');
  $('btn-help').hidden = !tutorial.has(name);
  tutorial.maybe(name, g.board);
}

// Seitenfeld am Tisch: Name, Untertitel, bei Schach und Mau-Mau auch „Gegen Computer“ (Schach mit Stufe und Bilanz)
function showTablePanel(name) {
  $('game-title').textContent = name;
  $('game-info').textContent = PLAYABLE.get(name).info;
  $('solo').hidden = !PLAYABLE.get(name).solo;
  const alone = PLAYABLE.get(name).alone; // nur allein: keine Lobby, eigener Start-Knopf
  $('btn-host').hidden = document.querySelector('#solo .or').hidden = !!alone;
  $('btn-solo').textContent = alone || 'Gegen Computer';
  $('level').hidden = $('solo-record').hidden = name !== 'Schach';
  $('free-row').hidden = !PLAYABLE.get(name).free;
  $('free-toggle').checked = settings.free;
  showRecord();
}

function showRecord() {
  const r = loadRecord()[$('level').value] ?? { w: 0, d: 0, l: 0 };
  $('solo-record').textContent = `Deine Bilanz – Siege: ${r.w} · Remis: ${r.d} · Niederlagen: ${r.l}`;
}

function startLobby(role) {
  lobby?.leave();
  lobby = new Lobby()
    .on('code', (code) => {
      $('code').textContent = code;
      $('host-status').textContent = 'Warte auf Mitspieler …';
    })
    .on('connected', () => {
      host = role === 'host';
      $('ping').textContent = '…';
      $('role').textContent = host ? 'Du bist Host' : 'Du bist Gast';
      lobby.send({ t: 'name', name: settings.name });
      if (!host) return; // der Gast wartet, welches Spiel der Host aufgemacht hat
      lobby.send({ t: 'game', id: table });
      startGame(table, 0);
    })
    .on('ping', (ms) => ($('ping').textContent = ms < 1 ? '< 1 ms' : `${Math.round(ms)} ms`))
    .on('message', (msg) => {
      if (msg.t === 'game') {
        if (!host && Object.hasOwn(GAMES, msg.id)) startGame(msg.id, 1); // nur der Host sucht das Spiel aus
      } else if (msg.t === 'shelf') toShelf();
      else if (msg.t === 'tisch') tisch.handle(msg);
      else if (msg.t === 'name') {
        peerName = cleanName(msg.name);
        showNames();
        game?.refresh();
      } else game?.handle(msg);
    })
    .on('error', (text) => show(role === 'host' ? 'table' : 'shelf', text))
    .on('closed', () => disconnect(`Verbindung zu ${otherName()} verloren.`));
  return lobby;
}

// --- Spieleschrank: Schachtel anklicken → Kamera fährt zum Tisch; dort Schrank anklicken → zurück ---
canvas.addEventListener('pointermove', (e) => {
  if (view === 'shelf') {
    const name = room.shelf.pick(room.rayFrom(e));
    room.shelf.setHover(name);
    canvas.style.cursor = name ? 'pointer' : '';
    tip(e, name && (PLAYABLE.has(name) ? name : `${name} – wird noch gebaut`));
  } else if (view === 'table') {
    const over = room.shelf.hit(room.rayFrom(e));
    canvas.style.cursor = over ? 'pointer' : '';
    tip(e, over && 'Zurück zum Schrank');
  }
});

canvas.addEventListener('click', (e) => {
  if (view === 'table' && room.shelf.hit(room.rayFrom(e))) return toShelf();
  if (view !== 'shelf') return;
  const name = room.shelf.pick(room.rayFrom(e));
  if (!name) return;
  if (!PLAYABLE.has(name)) return notice(`${name} – wird noch gebaut. Kommt nach und nach.`);
  if (host === false) return notice(`Das Spiel sucht ${otherName()} (Host) aus.`);
  room.shelf.setHover(null);
  canvas.style.cursor = '';
  tip(e, '');
  if (host && PLAYABLE.get(name).alone) return notice(`${name} übt jeder allein – erst die Verbindung trennen.`);
  if (host) {
    lobby.send({ t: 'game', id: name }); // schon verbunden → beide direkt an den Tisch
    return startGame(name, 0);
  }
  setTable(name);
  room.shelf.setTaken(name); // Schachtel kommt auf den Tisch
  showTablePanel(name);
  room.setView('table');
  show('table');
});

window.addEventListener('pointerdown', unlockAudio); // Ton ist erst nach einem Klick erlaubt

$('btn-host').onclick = () => {
  $('code').textContent = '····';
  $('host-status').textContent = 'Code wird erstellt …';
  show('hosting');
  startLobby('host').host();
};

$('level').innerHTML = LEVELS.map((l, i) => `<option value="${i}">Stufe ${i + 1} · ${l.name}</option>`).join('');
$('level').value = '1';
$('level').onchange = showRecord;
$('btn-solo').onclick = () => startGame(table, 0, table === 'Schach' ? Number($('level').value) : 0);

$('free-toggle').onchange = (e) => changeSettings({ ...settings, free: e.target.checked });

$('code-input').oninput = (e) => (e.target.value = normalizeCode(e.target.value));

$('join-form').onsubmit = (e) => {
  e.preventDefault();
  const code = normalizeCode($('code-input').value);
  if (!isValidCode(code)) return show('shelf', 'Der Code hat 4 Zeichen, z. B. K7XQ.');
  show('joining', 'Verbinde …', 'info');
  startLobby('guest').join(code);
};

document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => disconnect()));
$('hud-shelf').onclick = () => ask('Partie abbrechen? Ihr geht beide zurück zum Schrank.', bothToShelf);
$('hud-leave').onclick = () => ask(`Verbindung zu ${otherName()} trennen?`, () => disconnect());
$('confirm-no').onclick = () => ($('confirm').hidden = true);

// --- Einstellungen (Zahnrad) und Ansicht ---
function changeSettings(next) {
  const renamed = next.name !== settings.name;
  settings = next;
  saveSettings(settings);
  room.applySettings(settings);
  applyDesigns(settings);
  $('fps').hidden = !settings.fps;
  if (!renamed) return;
  lobby?.send({ t: 'name', name: settings.name });
  game?.refresh();
}

const menu = createMenu({ get: () => settings, onChange: changeSettings });
$('btn-settings').onclick = () => menu.open();
$('btn-view').onclick = () => room.resetView();
$('btn-help').onclick = () => tutorial.show(table, GAMES[table].board);
$('fps').hidden = !settings.fps;
if (!settings.name) askName((name) => changeSettings({ ...settings, name }));

// FPS-Anzeige: Bilder pro Sekunde und Zeit pro Bild, alle halbe Sekunde neu
let frames = 0;
let since = performance.now();
room.onFrame(() => {
  const now = performance.now();
  if ($('fps').hidden) {
    [frames, since] = [0, now];
    return;
  }
  frames++;
  if (now - since < 500) return;
  $('fps').textContent = `${Math.round((frames * 1000) / (now - since))} FPS · ${((now - since) / frames).toFixed(1)} ms`;
  [frames, since] = [0, now];
});

show('shelf');

// Installierbare App (PWA): Offline-Speicher nur in der gebauten Fassung – beim Entwickeln stünde er Änderungen im Weg
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`sw.js?v=${__BUILD__}`);
