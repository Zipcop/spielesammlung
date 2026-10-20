// Netzwerk-Schicht: Lobby per Code. Der PeerJS-Broker vermittelt nur den Handshake,
// danach laufen alle Daten direkt zwischen den beiden PCs (WebRTC).
// Reißt die Verbindung ab (WLAN-Aussetzer, PC kurz eingefroren …), bleibt der Host unter seinem Code
// erreichbar und der Gast wählt sich mit demselben Code neu ein – das Spiel läuft danach weiter.
import { Peer } from 'peerjs';

const ID_PREFIX = 'ssw-spielesammlung-'; // eigener Präfix, damit es auf dem öffentlichen Broker keine Kollisionen gibt
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I/L
const CODE_LENGTH = 4;
const PING_EVERY_MS = 1000;
const LOST_AFTER_MS = 6000;
const CONNECT_TIMEOUT_MS = 15000;
const REDIAL_CHECK_MS = 2000; // Gast: so oft prüfen, ob neu angewählt werden muss, solange die Verbindung weg ist
const REDIAL_AFTER_MS = 6000; // … und eine laufende Anwahl so lange in Ruhe aufbauen lassen
const BROKER_RETRY_MS = 2000; // Vermittlung weg → nach dieser Pause wieder anmelden
export const GIVE_UP_AFTER_MS = 120000; // so lange warten beide auf die Rückkehr des anderen
const BYE_MS = 500; // beim Verlassen: so lange bleibt die Leitung offen, damit das „Tschüss“ noch ankommt

const BROKER_DOWN = 'Vermittlungsdienst nicht erreichbar. Bitte Internetverbindung prüfen.';
const ERROR_TEXT = {
  'peer-unavailable': 'Kein offenes Spiel mit diesem Code gefunden. Bitte Code prüfen.',
  'network': BROKER_DOWN,
  'server-error': BROKER_DOWN,
  'socket-error': BROKER_DOWN,
  'socket-closed': BROKER_DOWN,
  'browser-incompatible': 'Dieser Browser kann keine direkte Verbindung (WebRTC) aufbauen.',
  'webrtc': 'Die direkte Verbindung zwischen den PCs ist fehlgeschlagen.',
  'timeout': 'Verbindung kommt nicht zustande. Ist die Lobby noch offen?',
};

export function normalizeCode(text) {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

// Ereignisse: 'code' (Host), 'connected', 'ping' (ms), 'message', 'error' (Text),
// 'reconnecting' (Verbindung weg, es wird neu verbunden), 'reconnected',
// 'closed' (endgültig weg – Wert 'bye': der andere hat selbst getrennt, 'full': Spiel hat schon zwei Spieler)
export class Lobby {
  #handlers = {};
  #peer = null;
  #conn = null; // aktuelle Verbindung (auch eine, die sich gerade erst aufbaut)
  #code = '';
  #isHost = false;
  #connected = false; // war schon einmal verbunden
  #live = false; // Datenkanal steht gerade
  #closed = false;
  #pingTimer = null;
  #connectTimer = null;
  #redialTimer = null;
  #giveUpTimer = null;
  #brokerTimer = null;
  #dialedAt = -Infinity;

  on(event, fn) {
    this.#handlers[event] = fn;
    return this;
  }

  host() {
    this.#isHost = true;
    this.#code = randomCode();
    this.#peer = new Peer(ID_PREFIX + this.#code);
    this.#peer.on('open', () => !this.#connected && this.#emit('code', this.#code));
    this.#peer.on('connection', (conn) => {
      // nur zwei Spieler – derselbe Gast darf sich aber neu einwählen (er hält uns evtl. schon für weg)
      if (this.#live && conn.peer !== this.#conn.peer) {
        return conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), BYE_MS);
        });
      }
      this.#attach(conn);
    });
    this.#peer.on('error', (err) => {
      if (err.type !== 'unavailable-id' || this.#connected) return this.#fail(err);
      this.#peer.destroy(); // Code zufällig schon vergeben → neuen erzeugen
      this.host();
    });
    this.#keepRegistered();
  }

  join(code) {
    this.#code = code;
    this.#peer = new Peer();
    this.#peer.on('open', () => !this.#connected && this.#dial());
    this.#peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') this.#dialedAt = -Infinity; // Host (noch) nicht da → gleich nochmal
      this.#fail(err);
    });
    this.#keepRegistered();
    this.#connectTimer = setTimeout(() => this.#fail({ type: 'timeout' }), CONNECT_TIMEOUT_MS);
  }

  send(msg) {
    if (this.#live) this.#conn.send(msg);
  }

  leave() {
    if (this.#live) this.#conn.send({ t: 'bye' }); // sonst wartet der Mitspieler vergeblich auf unsere Rückkehr
    this.#closed = true;
    this.#live = false;
    clearInterval(this.#pingTimer);
    clearTimeout(this.#connectTimer);
    clearInterval(this.#redialTimer);
    clearTimeout(this.#giveUpTimer);
    clearInterval(this.#brokerTimer);
    const peer = this.#peer;
    setTimeout(() => peer?.destroy(), BYE_MS);
  }

  #emit(event, value) {
    this.#handlers[event]?.(value);
  }

  // Verliert der PC die Vermittlung (z. B. WLAN weg), meldet er sich unter derselben ID wieder an –
  // nur so findet der Gast den Host nach einem Abbruch wieder.
  #keepRegistered() {
    clearInterval(this.#brokerTimer);
    this.#brokerTimer = setInterval(() => {
      if (this.#peer.disconnected && !this.#peer.destroyed) this.#peer.reconnect();
    }, BROKER_RETRY_MS);
  }

  #dial() {
    this.#dialedAt = performance.now();
    this.#attach(this.#peer.connect(ID_PREFIX + this.#code, { reliable: true, serialization: 'json' }));
  }

  #attach(conn) {
    const old = this.#conn;
    const wasLive = this.#live; // Host: derselbe Gast wählt neu an, während wir die alte Verbindung noch für gut hielten
    this.#conn = conn;
    this.#live = false; // bis die neue Verbindung steht
    clearInterval(this.#pingTimer);
    if (old && old !== conn) old.close(); // halb aufgebaute oder tote Verbindung verwerfen
    if (wasLive) this.#waitForReturn();
    let lastSeen = performance.now();

    conn.on('open', () => {
      if (conn !== this.#conn || this.#closed) return conn.close();
      const again = this.#connected;
      this.#connected = this.#live = true;
      lastSeen = performance.now();
      clearTimeout(this.#connectTimer);
      clearInterval(this.#redialTimer);
      clearTimeout(this.#giveUpTimer);
      clearInterval(this.#pingTimer);
      this.#pingTimer = setInterval(() => {
        if (performance.now() - lastSeen > LOST_AFTER_MS) return this.#lost(conn);
        conn.send({ t: 'ping', ts: performance.now() });
      }, PING_EVERY_MS);
      this.#emit(again ? 'reconnected' : 'connected');
    });

    conn.on('data', (msg) => {
      if (conn !== this.#conn || this.#closed) return;
      lastSeen = performance.now();
      if (msg.t === 'bye' || msg.t === 'full') {
        this.#live = false;
        this.leave();
        this.#emit('closed', msg.t);
      } else if (msg.t === 'ping') conn.send({ t: 'pong', ts: msg.ts });
      else if (msg.t === 'pong') this.#emit('ping', performance.now() - msg.ts);
      else this.#emit('message', msg);
    });

    conn.on('close', () => this.#lost(conn));
  }

  #lost(conn) {
    if (conn !== this.#conn || this.#closed) return;
    if (!this.#connected) return this.#fail({ type: 'webrtc' });
    if (!this.#live) return; // wird schon neu verbunden – eine neue Anwahl kam nicht zustande
    this.#live = false;
    clearInterval(this.#pingTimer);
    conn.close();
    this.#waitForReturn();
    if (this.#isHost) return; // Host: wartet, bis der Gast sich neu einwählt
    if (this.#peer.open) this.#dial();
    this.#redialTimer = setInterval(() => {
      if (this.#peer.open && performance.now() - this.#dialedAt > REDIAL_AFTER_MS) this.#dial();
    }, REDIAL_CHECK_MS);
  }

  // Verbindung weg: melden und höchstens GIVE_UP_AFTER_MS auf die Rückkehr warten
  #waitForReturn() {
    this.#emit('reconnecting');
    clearTimeout(this.#giveUpTimer);
    this.#giveUpTimer = setTimeout(() => {
      this.leave();
      this.#emit('closed');
    }, GIVE_UP_AFTER_MS);
  }

  #fail(err) {
    // Broker-Fehler nach dem Verbinden sind egal – die Daten laufen dann direkt.
    if (this.#closed || this.#connected) return;
    this.leave();
    this.#emit('error', ERROR_TEXT[err.type] ?? `Verbindung fehlgeschlagen (${err.type}).`);
  }
}
