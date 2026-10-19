// Netzwerk-Schicht: Lobby per Code. Der PeerJS-Broker vermittelt nur den Handshake,
// danach laufen alle Daten direkt zwischen den beiden PCs (WebRTC).
import { Peer } from 'peerjs';

const ID_PREFIX = 'ssw-spielesammlung-'; // eigener Präfix, damit es auf dem öffentlichen Broker keine Kollisionen gibt
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I/L
const CODE_LENGTH = 4;
const PING_EVERY_MS = 1000;
const LOST_AFTER_MS = 6000;
const CONNECT_TIMEOUT_MS = 15000;

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

// Ereignisse: 'code' (Host), 'connected', 'ping' (ms), 'message', 'error' (Text), 'closed'
export class Lobby {
  #handlers = {};
  #peer = null;
  #conn = null;
  #connected = false;
  #closed = false;
  #pingTimer = null;
  #connectTimer = null;

  on(event, fn) {
    this.#handlers[event] = fn;
    return this;
  }

  host() {
    const code = randomCode();
    this.#peer = new Peer(ID_PREFIX + code);
    this.#peer.on('open', () => this.#emit('code', code));
    this.#peer.on('connection', (conn) => {
      if (this.#conn) return conn.on('open', () => conn.close()); // nur zwei Spieler
      this.#attach(conn);
    });
    this.#peer.on('error', (err) => {
      if (err.type !== 'unavailable-id') return this.#fail(err);
      this.#peer.destroy(); // Code zufällig schon vergeben → neuen erzeugen
      this.host();
    });
  }

  join(code) {
    this.#peer = new Peer();
    this.#peer.on('open', () => {
      this.#attach(this.#peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' }));
    });
    this.#peer.on('error', (err) => this.#fail(err));
    this.#connectTimer = setTimeout(() => this.#fail({ type: 'timeout' }), CONNECT_TIMEOUT_MS);
  }

  send(msg) {
    if (this.#connected) this.#conn.send(msg);
  }

  leave() {
    this.#closed = true;
    clearInterval(this.#pingTimer);
    clearTimeout(this.#connectTimer);
    this.#peer?.destroy();
  }

  #emit(event, value) {
    this.#handlers[event]?.(value);
  }

  #attach(conn) {
    this.#conn = conn;
    let lastSeen = performance.now();

    conn.on('open', () => {
      this.#connected = true;
      clearTimeout(this.#connectTimer);
      this.#pingTimer = setInterval(() => {
        if (performance.now() - lastSeen > LOST_AFTER_MS) return this.#lost();
        conn.send({ t: 'ping', ts: performance.now() });
      }, PING_EVERY_MS);
      this.#emit('connected');
    });

    conn.on('data', (msg) => {
      lastSeen = performance.now();
      if (msg.t === 'ping') conn.send({ t: 'pong', ts: msg.ts });
      else if (msg.t === 'pong') this.#emit('ping', performance.now() - msg.ts);
      else this.#emit('message', msg);
    });

    conn.on('close', () => this.#lost());
  }

  #lost() {
    if (!this.#connected) return this.#fail({ type: 'webrtc' });
    if (this.#closed) return;
    this.leave();
    this.#emit('closed');
  }

  #fail(err) {
    // Broker-Fehler nach dem Verbinden sind egal – die Daten laufen dann direkt.
    if (this.#closed || this.#connected) return;
    this.leave();
    this.#emit('error', ERROR_TEXT[err.type] ?? `Verbindung fehlgeschlagen (${err.type}).`);
  }
}
