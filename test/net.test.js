// Lobby (src/net.js) mit PeerJS-Stellvertreter und Spieluhr: Abbruch erkennen, neu verbinden, aufgeben.
// Anlass 20.10.2026: Nico und seine Frau flogen mitten in einer Schach-Partie raus – jede Pause über 6 s
// ohne Daten (WLAN-Aussetzer, PC kurz eingefroren) beendete die Verbindung samt Spiel.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('../test-stubs/net-hooks.mjs', import.meta.url);
const { Lobby, GIVE_UP_AFTER_MS } = await import('../src/net.js');
const { network } = await import('../test-stubs/stub-peerjs.js');

mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
performance.now = () => Date.now(); // Lobby misst mit performance.now – hier läuft sie mit der Spieluhr

function run(ms) {
  for (let t = 0; t < ms; t += 10) mock.timers.tick(10);
}

// Host und Gast verbinden; log hält alle Ereignisse beider Seiten fest
function pair() {
  const log = [];
  const got = { host: [], guest: [] };
  const lobby = (who) => new Lobby()
    .on('connected', () => log.push(`${who} connected`))
    .on('reconnecting', () => log.push(`${who} reconnecting`))
    .on('reconnected', () => log.push(`${who} reconnected`))
    .on('closed', () => log.push(`${who} closed`))
    .on('error', (text) => log.push(`${who} error ${text}`))
    .on('message', (msg) => got[who].push(msg));
  let code = null;
  const host = lobby('host').on('code', (c) => (code = c));
  host.host();
  run(50);
  const guest = lobby('guest');
  guest.join(code);
  run(100);
  return { host, guest, log, got, code };
}

function cleanup(...lobbies) {
  lobbies.forEach((l) => l.leave());
  network.down = false;
  network.peers.clear();
}

test('Verbinden, Daten fließen', () => {
  const { host, guest, log, got } = pair();
  assert.deepEqual(log, ['host connected', 'guest connected']);
  host.send({ t: 'state', n: 1 });
  guest.send({ t: 'move', n: 2 });
  run(50);
  assert.deepEqual(got.guest, [{ t: 'state', n: 1 }]);
  assert.deepEqual(got.host, [{ t: 'move', n: 2 }]);
  run(30000); // Ping hält die Verbindung
  assert.deepEqual(log, ['host connected', 'guest connected']);
  cleanup(host, guest);
});

test('Kurzer Ausfall (20 s): beide merken es, Gast wählt neu an, es geht weiter', () => {
  const { host, guest, log, got } = pair();
  network.down = true;
  run(20000);
  assert.deepEqual(log.slice(2).sort(), ['guest reconnecting', 'host reconnecting']);
  host.send({ t: 'state', n: 'verloren' }); // während der Pause: kommt nicht an, wirft aber auch nicht
  network.down = false;
  run(8000); // eine Anwahl, die während des Ausfalls hängen blieb, wird nach 6 s erneuert
  assert.deepEqual(log.slice(4).sort(), ['guest reconnected', 'host reconnected']);
  host.send({ t: 'state', n: 3 });
  run(50);
  assert.deepEqual(got.guest, [{ t: 'state', n: 3 }]);
  run(GIVE_UP_AFTER_MS + 10000); // Aufgabe-Zeit ist abgeschaltet
  assert.ok(!log.some((l) => l.endsWith('closed')));
  cleanup(host, guest);
});

test('PC 7 s eingefroren: früher Abbruch, jetzt neu verbunden', () => {
  const { host, guest, log } = pair();
  network.down = true;
  run(7000);
  network.down = false;
  run(8000);
  assert.ok(log.includes('host reconnected') && log.includes('guest reconnected'), log.join(', '));
  assert.ok(!log.some((l) => l.endsWith('closed')));
  cleanup(host, guest);
});

test('Langer Ausfall: nach der Wartezeit endgültig getrennt', () => {
  const { host, guest, log } = pair();
  network.down = true;
  run(GIVE_UP_AFTER_MS + 8000);
  assert.ok(log.includes('host closed') && log.includes('guest closed'), log.join(', '));
  network.down = false;
  run(10000); // danach wählt niemand mehr an
  assert.ok(!log.some((l) => l.endsWith('reconnected')));
  cleanup(host, guest);
});

test('Ein Dritter mit demselben Code: abgewiesen, ohne die Partie zu stören', () => {
  const { host, guest, log, got, code } = pair();
  let why = null;
  const third = new Lobby().on('closed', (w) => (why = w)).on('reconnecting', () => log.push('third reconnecting'));
  third.join(code);
  run(1000);
  assert.equal(why, 'full'); // „Spiel hat schon zwei Spieler“ – und kein Neu-Anwählen
  host.send({ t: 'state', n: 4 });
  run(5000);
  assert.deepEqual(log, ['host connected', 'guest connected']);
  assert.deepEqual(got.guest, [{ t: 'state', n: 4 }]);
  cleanup(host, guest, third);
});

test('Absichtlich verlassen: der andere erfährt es sofort und wartet nicht', () => {
  const { host, guest, log } = pair();
  let left = null;
  host.on('closed', (bye) => (left = bye));
  guest.leave();
  run(1000);
  assert.equal(left, 'bye');
  run(20000);
  assert.ok(!log.some((l) => l.endsWith('reconnecting')), log.join(', '));
  cleanup(host, guest);
});
