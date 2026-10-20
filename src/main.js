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
import { createDokoBoard } from './doko/board.js';
import { startDoko } from './doko/index.js';
import { createVierBoard } from './viergewinnt/board.js';
import { startVierGewinnt } from './viergewinnt/index.js';
import { createReversiBoard } from './reversi/board.js';
import { startReversi } from './reversi/index.js';
import { createMuehleBoard } from './muehle/board.js';
import { startMuehle } from './muehle/index.js';
import { createDameBoard } from './dame/board.js';
import { startDame } from './dame/index.js';
import { createMaexchenBoard } from './maexchen/board.js';
import { startMaexchen } from './maexchen/index.js';
import { createElferBoard } from './elferraus/board.js';
import { startElferRaus } from './elferraus/index.js';
import { createPokerBoard } from './poker/board.js';
import { startPoker } from './poker/index.js';
import { createDuelBoard } from './kartenduell/board.js';
import { startKartenduell } from './kartenduell/index.js';
import { unlockAudio } from './sound.js';
import { createTisch } from './tisch.js';
import { createTutorial } from './tutorial.js';
import { loadSettings, saveSettings, cleanName } from './settings.js';
import { loadSaves, storeSave, savedAt } from './saves.js';
import { loadStats, mergeStats, entry, pairOf, ofPair, resetPair, tally, step, today, RESET } from './stats.js';
import { OUTCOME, reverted } from './results.js';
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
  // Vier Sitze: Host, Gast gegenüber, die freien spielt der Computer
  Doppelkopf: { board: createDokoBoard(room.tableTop), start: startDoko, seat: 'doko' },
  // Rahmen steht aufrecht in der Mitte: Host sieht ihn von vorn (+z), Gast von hinten
  'Vier gewinnt': { board: createVierBoard(room.tableTop), start: startVierGewinnt, seat: 'vier' },
  Reversi: { board: createReversiBoard(room.tableTop), start: startReversi, seat: 'reversi' },
  Mühle: { board: createMuehleBoard(room.tableTop), start: startMuehle, seat: 'muehle' },
  Dame: { board: createDameBoard(room.tableTop), start: startDame, seat: 'dame' },
  // Vier Sitze wie Doppelkopf; Becherlagen gehen als 'mx' zum anderen PC
  Mäxchen: { board: createMaexchenBoard(room.tableTop, { onStream: (msg) => lobby?.send(msg) }), start: startMaexchen, seat: 'mx' },
  // Sitze wie Doppelkopf (2–4 am Tisch, freie spielt der Computer); die Reihen liegen in der Mitte
  'Elfer raus': { board: createElferBoard(room.tableTop), start: startElferRaus, seat: 'elfer' },
  // Sechs Plätze: Host, Gast gegenüber, die freien spielt der Computer; Spielgeld-Konto je PC (spielgeld.js)
  "Texas Hold'em": { board: createPokerBoard(room.tableTop), start: startPoker, seat: 'poker' },
  // Zwei Plätze: Host (+z), Gast bzw. Computer gegenüber; Spielmatte mit Zonen in der Mitte
  Kartenduell: { board: createDuelBoard(room.tableTop), start: startKartenduell, seat: 'kd' },
};
for (const [n, g] of Object.entries(GAMES)) g.board.group.visible = n === 'Kniffel'; // nur ein Spiel liegt auf dem Tisch
// Brett greifen, schieben, umwerfen, aufbauen – für alle Spiele gleich
const tisch = createTisch({ room, canvas, send: (msg) => lobby?.send(msg) });
// Spielanleitung je Spiel – am Tisch vor dem Start und im Spiel über den „?“-Knopf
const tutorial = createTutorial();
const applyDesigns = (s) => Object.values(GAMES).forEach((g) => g.board.setDesign?.(s)); // Würfel, Filz, Figuren, Kartenrücken
applyDesigns(settings);

let lobby = null;
let host = null; // true/false, solange eine Verbindung steht – sonst null
let game = null;
let table = 'Kniffel'; // Spiel, das auf dem Tisch liegt
let view = 'shelf';
let noticeTimer = null;
let peerName = ''; // Name des Mitspielers (beim Empfang geprüft), '' = noch unbekannt
let latest = null; // Host: { name, state } der laufenden Partie zu zweit – nach einem Verbindungsabbruch geht es damit weiter
let resumeNext = false; // Host: nach dem Verbinden die gespeicherte Partie fortsetzen statt neu anfangen

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
  showScore();
}

// --- Statistik zu zweit (stats.js): der Host zählt, meldet dem Gast; beim Verbinden gleichen beide ab ---
const pair = () => pairOf(settings.name, peerName); // null = Name fehlt oder beide gleich – dann zählt nichts

// Stand dieser Sitzung in der Verbindungsleiste, z. B. „Heute: Nico 3 – Denisa 2“
function showScore() {
  const p = pair();
  const t = p && view === 'playing' && OUTCOME[table] ? tally(loadStats(today), p)[table] ?? { wins: { [p[0]]: 0, [p[1]]: 0 }, draws: 0 } : null;
  $('hud-score').hidden = !t;
  if (t) $('hud-score').textContent = `Heute: ${settings.name} ${t.wins[settings.name]} – ${peerName} ${t.wins[peerName]}${t.draws ? ` · Remis ${t.draws}` : ''}`;
}

function record(e) {
  if (!e) return;
  mergeStats([e]);
  mergeStats([e], today);
  showScore();
}

// Ergebnis vom anderen PC: nur für unser Paar und bekannte Spiele (oder die Rücksetz-Marke)
const ours = (e) => {
  const p = pair();
  return !!p && e?.a === p[0] && e?.b === p[1] && (Object.hasOwn(GAMES, e.game) || e.game === RESET);
};

// In Stücken zu je 40 (höchstens ~12 kB): PeerJS verwirft JSON-Nachrichten ab 16 300 Byte ohne Meldung
function sendStats() {
  const list = pair() ? ofPair(loadStats(), pair()) : [];
  for (let i = 0; i < list.length; i += 40) lobby?.send({ t: 'stats', list: list.slice(i, i + 40) });
}

// Host: Spielstand → Runde verfolgen, Ergebnis festhalten und dem Gast melden. Gibt den neuen track zurück.
function countResult(name, track, state) {
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const { report, ...next } = step(track, OUTCOME[name](state), reverted(state), id);
  if (report === undefined) return next;
  const winner = report === 'void' ? null : report === null ? '' : report === 0 ? settings.name : peerName;
  const e = entry({ id: next.id, game: name, me: settings.name, other: peerName, winner });
  record(e);
  if (e) lobby?.send({ t: 'result', entry: e });
  return next;
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
// onNo gesetzt: „Nein“ ist eine eigene Wahl (Text noText) statt nur Zurück
function ask(text, onYes, onNo, noText = 'Nein, zurück') {
  $('confirm-text').textContent = text;
  $('confirm').hidden = false;
  $('confirm-yes').onclick = () => {
    $('confirm').hidden = true;
    onYes();
  };
  $('confirm-no').textContent = noText;
  $('confirm-no').onclick = () => {
    $('confirm').hidden = true;
    onNo?.();
  };
}

// level gesetzt = allein gegen den Computer (ohne Verbindung) · resume = gespeicherter Stand (nur Host)
// track = Statistik-Stand dazu (saves.js) – fehlt er (alter Speicherstand), gilt ein schon beendetes Spiel als gezählt
function startGame(name, me, level, resume, track) {
  game?.stop();
  $('confirm').hidden = true; // offene Rückfrage gehörte zur alten Partie
  setTable(name);
  const g = GAMES[name];
  tisch.setBoard(g.board);
  const onLeave = level === undefined ? bothToShelf : () => toShelf();
  const free = settings.free && !!PLAYABLE.get(name).free; // allein oder zu zweit; zu zweit entscheidet der Host
  // Zu zweit merkt sich der Host jeden Spielstand (saves.js) – für Neuverbinden und „Fortsetzen“
  latest = null;
  track ??= { id: null, w: resume && OUTCOME[name] ? OUTCOME[name](resume) : undefined };
  const save = level === undefined && me === 0 ? (state) => {
    if (OUTCOME[name]) track = countResult(name, track, state); // Statistik zu zweit
    latest = { name, state, track };
    storeSave(name, state, undefined, undefined, track);
  } : undefined;
  // Bedienhinweis je nach Modus – der Gast erfährt „ohne Hilfen“ erst mit dem ersten Spielstand, deshalb fragt das Spiel nach.
  // Vor dem Start zurücksetzen: Der Host zeichnet schon beim Start und stellt dabei den Hinweis für „ohne Hilfen“ ein.
  document.querySelectorAll('[data-hint]').forEach((el) => (el.textContent = el.dataset.hint));
  game = g.start({ room, board: g.board, canvas, me, level, ask, names, free, resume, save, send: (msg) => lobby?.send(msg), onLeave });
  room.shelf.setHover(null);
  room.shelf.setTaken(name);
  room.setView(g.seat + me);
  document.querySelectorAll('[data-game]').forEach((el) => (el.hidden = el.dataset.game !== name));
  show('playing');
}

// Seitenfeld am Tisch: Name, Untertitel, bei Schach und Mau-Mau auch „Gegen Computer“ (Schach mit Stufe und Bilanz)
function showTablePanel(name) {
  $('game-title').textContent = name;
  $('game-info').textContent = PLAYABLE.get(name).info;
  $('solo').hidden = !PLAYABLE.get(name).solo;
  const alone = PLAYABLE.get(name).alone; // nur allein: keine Lobby, eigener Start-Knopf
  $('btn-host').hidden = document.querySelector('#solo .or').hidden = !!alone;
  const saved = loadSaves()[name];
  $('btn-resume').hidden = !saved || !!alone;
  if (saved) $('btn-resume').textContent = `Letzte Partie fortsetzen (${savedAt(saved.at)})`;
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

// Verbindungsleiste: steht die Leitung oder wird gerade neu verbunden?
function showLink(ok) {
  $('hud-link').className = ok ? 'ok' : 'muted';
  $('hud-link').firstChild.textContent = ok ? '● Verbunden mit ' : '○ Verbinde neu mit ';
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
      showLink(true);
      $('ping').textContent = '…';
      $('role').textContent = host ? 'Du bist Host' : 'Du bist Gast';
      lobby.send({ t: 'name', name: settings.name });
      if (!host) return; // der Gast wartet, welches Spiel der Host aufgemacht hat
      lobby.send({ t: 'game', id: table });
      const saved = resumeNext ? loadSaves()[table] : undefined;
      startGame(table, 0, undefined, saved?.state, saved?.track);
    })
    // Verbindung kurz weg: Spiel bleibt stehen, Lobby verbindet neu (net.js)
    .on('reconnecting', () => {
      $('ping').textContent = '–';
      showLink(false);
      show(view, `Verbindung zu ${otherName()} unterbrochen – verbinde neu …`, 'info');
    })
    .on('reconnected', () => {
      showLink(true);
      show(view);
      lobby.send({ t: 'name', name: settings.name });
      // Host schickt das Spiel neu, mit dem letzten Stand – was während der Pause passiert ist, kommt so beim Gast an
      if (host && view === 'playing' && latest?.name === table) {
        lobby.send({ t: 'game', id: table });
        startGame(table, 0, undefined, latest.state, latest.track);
      } else if (host && view !== 'playing') lobby.send({ t: 'shelf' }); // „Zum Schrank“ während der Pause ging verloren
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
        sendStats(); // Abgleich: jeder schickt seine Liste fürs Paar, beide nehmen dazu, was fehlt
      } else if (msg.t === 'result') {
        if (!host && ours(msg.entry)) record(msg.entry); // nur der Host zählt
      } else if (msg.t === 'stats') {
        if (!Array.isArray(msg.list)) return;
        const list = msg.list.filter(ours);
        mergeStats(list);
        const todays = new Set(loadStats(today).map((e) => e.id)); // „Heute“: nur Berichtigungen von Runden dieser Sitzung und Zurücksetzen
        mergeStats(list.filter((e) => todays.has(e.id) || e.game === RESET), today);
        showScore();
      } else game?.handle(msg);
    })
    .on('error', (text) => show(role === 'host' ? 'table' : 'shelf', text))
    .on('closed', (why) => {
      if (why === 'full') return disconnect('Das Spiel hat schon zwei Spieler.');
      const kept = host && view === 'playing' && latest?.name === table;
      const what = why === 'bye' ? `${otherName()} hat die Verbindung getrennt.` : `Verbindung zu ${otherName()} verloren.`;
      disconnect(`${what}${kept ? ' Die Partie ist gespeichert – am Tisch „Letzte Partie fortsetzen“.' : ''}`);
    });
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
    const play = (resume, track) => {
      lobby.send({ t: 'game', id: name }); // schon verbunden → beide direkt an den Tisch
      startGame(name, 0, undefined, resume, track);
    };
    const saved = loadSaves()[name];
    if (!saved) return play();
    return ask(`Letzte Partie ${name} (${savedAt(saved.at)}) fortsetzen?`, () => play(saved.state, saved.track), () => play(), 'Nein, neue Partie');
  }
  setTable(name);
  room.shelf.setTaken(name); // Schachtel kommt auf den Tisch
  showTablePanel(name);
  room.setView('table');
  show('table');
});

window.addEventListener('pointerdown', unlockAudio); // Ton ist erst nach einem Klick erlaubt

$('btn-host').onclick = $('btn-resume').onclick = (e) => {
  resumeNext = e.currentTarget.id === 'btn-resume';
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
  sendStats();
  showScore();
}

// Statistik eines Paars zurücksetzen – der andere PC zieht beim Abgleich mit
function resetStats([a, b]) {
  resetPair(a, b);
  resetPair(a, b, today);
  sendStats();
  showScore();
}

const menu = createMenu({ get: () => settings, onChange: changeSettings, onReset: resetStats });
$('btn-settings').onclick = () => menu.open();
$('btn-view').onclick = () => room.resetView();
$('btn-help').onclick = $('btn-rules').onclick = () => tutorial.show(table);
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
