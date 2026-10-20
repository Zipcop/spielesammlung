// Stellvertreter für PeerJS in test/net.test.js: Vermittlung und Datenkanäle im Arbeitsspeicher.
// network.down = true spielt einen Ausfall nach (WLAN weg, PC eingefroren): nichts kommt mehr an, auch kein „close“.
export const network = { down: false, peers: new Map() };

class Emitter {
  #on = {};
  on(event, fn) {
    (this.#on[event] ??= []).push(fn);
    return this;
  }
  emit(event, value) {
    for (const fn of this.#on[event] ?? []) fn(value);
  }
}

const later = (fn) => setTimeout(fn, 10);

class Conn extends Emitter {
  open = false;
  closed = false;
  other = null;
  constructor(peer) {
    super();
    this.peer = peer;
  }
  send(msg) {
    if (!this.open || network.down) return;
    const copy = JSON.parse(JSON.stringify(msg));
    later(() => this.other.open && this.other.emit('data', copy));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    const was = this.open;
    this.open = false;
    if (was) this.emit('close'); // wie PeerJS: eine nie geöffnete Verbindung meldet kein „close“
    if (!network.down) later(() => this.other.close());
  }
}

let count = 0;

export class Peer extends Emitter {
  destroyed = false;
  disconnected = true;
  conns = [];
  constructor(id) {
    super();
    this.id = id ?? `gast-${++count}`;
    later(() => {
      if (network.peers.has(this.id)) return this.emit('error', { type: 'unavailable-id' });
      network.peers.set(this.id, this);
      this.disconnected = false;
      this.emit('open', this.id);
    });
  }
  get open() {
    return !this.disconnected && !this.destroyed;
  }
  reconnect() {}
  connect(id) {
    const mine = new Conn(id);
    const theirs = new Conn(this.id);
    [mine.other, theirs.other] = [theirs, mine];
    this.conns.push(mine);
    later(() => {
      const target = network.peers.get(id);
      if (network.down) return; // Anwahl verläuft im Sande
      if (!target) return this.emit('error', { type: 'peer-unavailable' });
      target.conns.push(theirs);
      target.emit('connection', theirs);
      later(() => {
        if (mine.closed || theirs.closed || network.down) return;
        mine.open = theirs.open = true;
        theirs.emit('open');
        mine.emit('open');
      });
    });
    return mine;
  }
  destroy() {
    this.destroyed = true;
    this.disconnected = true;
    if (network.peers.get(this.id) === this) network.peers.delete(this.id);
    this.conns.forEach((c) => c.close());
  }
}
