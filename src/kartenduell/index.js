// Kartenduell-Partie: verbindet Spielstand (game.js), Spielmatte (board.js), Seitenfeld (panel.js), Deckbau (deckbau.js),
// Computer (ai.js) und Netz. Host = Sitz 0 (+z), Gast bzw. Computer = Sitz 1 (−z). Der Host hält den vollen Stand,
// lässt den Computer handeln und schickt dem Gast nur dessen Sicht (viewFor). Der Gast schickt Züge ({ t: 'move', m }),
// der Host prüft sie. Bedienung: Karte anklicken (Hand oder eigenes Feld) → Aktionen im Seitenfeld; Tribute und Ziele
// danach auf dem Tisch anklicken. Maus über einer Karte zeigt sie groß im Seitenfeld.
// free = „Ohne Hilfen“: nichts abgedunkelt, keine Schadensvorschau, Ziehen per Klick aufs Deck, die Schummel-Züge aus
// game.js gehen; „Geschummelt!“ gegen den anderen, bis man selbst etwas tut. Allein schummelt der Computer ab und zu
// und prüft die Züge des Menschen (schummeln.js).
import {
  newGame, apply, accuse, waive, viewFor, moves, cardOf, atkOf, defOf, locate, ownerOf, STEP_NAMES, HAND_MAX,
  CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from './game.js';
import { CARD, DECKS, ATTRS, tributesFor } from './cards.js';
import { chooseMove, cheatMove } from './ai.js';
import { loadDeck, playable as deckReady } from './deck.js';
import { createPanel } from './panel.js';
import { createBuilder } from './deckbau.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses, rematchBlocked } from '../schummeln.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { act: 650, step: 380, accuse: 900 }; // so lange „überlegt“ der Computer, nachdem die Karten liegen

export function startKartenduell({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 1;
  const other = 1 - mySeat;
  const humans = solo ? [0] : [0, 1];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Zug geschickt, Antwort steht aus
  let asked = null;
  let timer = null;
  let hint = '';
  let cheered = false;
  let stopped = false;
  let judged = null; // allein ohne Hilfen: zuletzt geprüfte Frist des Menschen
  let cpuTurn = 0; // Zug, für den der Computer schon entschieden hat, ob er schummelt
  let sly = false; // … und ob
  let log = [];
  let sel = null; // gewählte Karte (uid)
  let mode = null; // null | { kind: 'tribute', u, set, chosen } | { kind: 'target', u, list } | { kind: 'attack', u, list, direct }
  let hover = null;
  let preview = '';
  let shownActs = []; // Knöpfe, die gerade im Kartenfeld stehen

  const nameOf = (seat) => (seat === mySeat ? 'Du' : solo ? 'Computer' : names.other());
  const verb = (seat, du, er) => (seat === mySeat ? du : er);
  const cardName = (u) => cardOf(mine, u)?.name ?? 'eine verdeckte Karte';

  const panel = createPanel($('kd-panel'), {
    solo,
    onPick: (key) => pick(key),
    onBuild: () => builder.open(),
    onStep: (to) => act({ t: 'step', to }),
    onAction: (i) => !waiting && shownActs[i]?.run(),
    onAgain: () => act({ t: 'again' }),
    onRegroup: () => act({ t: 'regroup' }),
    onLeave: (confirm) => (confirm && mine?.phase === 'duel' ? ask('Duell beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const builder = createBuilder({ onSave: () => render() });
  const cheat = createCheatUI({ onAccuse: () => act({ t: 'accuse' }), hint: document.querySelector('[data-game="Kartenduell"] .dock [data-hint]') });

  function setState(next) {
    if (next.events[0]?.type === 'deal' || next.phase === 'setup') {
      cheered = false;
      judged = null;
      cpuTurn = 0;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 5);
      // Stand hat sich geändert: Auswahl nur behalten, wenn die Karte noch bei mir ist und nichts aussteht
      if (sel !== null && !mineNow(sel)) sel = null;
      mode = null;
    }
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 1) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    schedule();
  }

  // Eigener Zug: Host wendet ihn direkt an, Gast fragt beim Host an
  function act(m) {
    if (!state || waiting) return false;
    if (isHost) {
      const next = apply(state, mySeat, m);
      if (next) {
        commit(next);
        return true;
      }
      if (m.t === 'again' || m.t === 'regroup') say(blocked());
      else if (m.t === 'accuse') say('Zu spät – inzwischen hat der andere weitergespielt.');
      else say('Das geht gerade nicht.');
      return false;
    }
    waiting = true;
    asked = m.t;
    send({ t: 'move', m });
    render();
    return true;
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && (asked === 'again' || asked === 'regroup')) hint = blocked();
      else if (same && asked === 'accuse') hint = 'Zu spät – inzwischen hat der andere weitergespielt.';
      else if (same && asked) hint = 'Das geht gerade nicht.';
      asked = null;
      return render();
    }
    if (isHost && state && msg.t === 'move' && msg.m && typeof msg.m === 'object') {
      const next = apply(state, 1, msg.m);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 1) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Computer (nur allein, Sitz 1) ---
  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !solo || !state) return;
    const s = state;
    if (s.phase === 'setup') {
      if (!s.picks[1]) commit(apply(s, 1, { t: 'pick', pick: { deck: Object.keys(DECKS)[Math.floor(Math.random() * 3)] } }));
      return;
    }
    const c = s.cheat;
    const cpuNext = s.phase === 'duel' && (s.pending ? s.pending.who === 1 : s.turn === 1);
    // Ohne Hilfen: Bevor der Computer selbst etwas tut (oder am Ende), prüft er die Frist des Menschen einmal
    if (s.free && c?.player === mySeat && c === judged && s.phase === 'over') return commit(waive(s, 1)); // schon geprüft – Revanche frei
    if (s.free && c?.player === mySeat && c !== judged && (s.phase === 'over' || cpuNext)) {
      judged = c;
      return later(THINK_MS.accuse, () => {
        if (cpuAccuses(!state.cheat.legal)) return commit(accuse(state, 1));
        if (state.phase === 'over') return commit(waive(state, 1));
        schedule();
      });
    }
    if (!cpuNext) return;
    if (s.turn === 1 && s.turnNo !== cpuTurn) {
      cpuTurn = s.turnNo;
      sly = s.free && cpuCheats();
    }
    const v = viewFor(s, 1);
    const trick = sly && !s.pending ? cheatMove(v, 1) : null;
    const m = trick ?? chooseMove(v, 1);
    later(m.t === 'step' || m.t === 'pass' ? THINK_MS.step : THINK_MS.act, () => {
      if (trick) sly = false;
      commit(apply(state, 1, m) ?? apply(state, 1, { t: 'pass' }) ?? apply(state, 1, { t: 'step', to: 'end' }) ?? apply(state, 1, { t: 'discard', u: state.hand[1][0] }));
    });
  }

  // Erst wenn die Karten liegen, kurz überlegen, dann handeln (solange ändert niemand etwas am Stand)
  function later(ms, fn) {
    const at = state;
    const tick = () => {
      if (stopped || state !== at) return;
      if (board.busy()) timer = setTimeout(tick, 40);
      else timer = setTimeout(() => !stopped && state === at && fn(), ms);
    };
    tick();
  }

  // --- Eingaben ---
  const running = () => mine && mine.phase === 'duel' && !waiting;
  const myTurn = () => running() && !mine.pending && mine.turn === mySeat;
  const myCall = () => running() && (mine.pending ? mine.pending.who === mySeat : mine.turn === mySeat);
  const blocked = () => (solo ? 'Der Computer prüft den Zug noch …' : `${names.other()} sieht sich deinen letzten Zug noch an …`);
  const mineNow = (u) => {
    const at = mine && locate(mine, u);
    return at && at.p === mySeat && at.where !== 'deck' && at.where !== 'grave';
  };

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function pick(key) {
    if (key !== 'own') return act({ t: 'pick', pick: { deck: key } });
    const d = loadDeck();
    if (!deckReady(d)) return say('Dein Deck ist noch nicht fertig – erst im Deckbau auf 40 Karten bringen.');
    return act({ t: 'pick', pick: { name: d.name, list: d.list } });
  }

  // Alle Züge, die gerade gehen (ohne Hilfen auch die Schummel-Züge)
  const legal = () => (myCall() ? moves(mine, mySeat, { strict: !mine.free }) : []);
  const can = (m) => !!apply(mine.free ? mine : { ...mine, free: false }, mySeat, m);

  // Aktionen für die gewählte Karte: [{ label, primary, off, run }]
  function actions() {
    const v = mine;
    if (!v || v.phase !== 'duel' || sel === null || mode) return [];
    const at = locate(v, sel);
    const c = cardOf(v, sel);
    if (!at || !c || at.p !== mySeat) return [];
    const ms = legal().filter((m) => m.u === sel);
    const has = (t, f = () => true) => ms.some((m) => m.t === t && f(m));
    const out = [];
    const add = (label, ok, run, primary = false) => out.push({ label, primary, off: !ok, run });
    if (v.pending?.type === 'discard' && v.pending.who === mySeat) {
      if (at.where === 'hand') add('Abwerfen', true, () => act({ t: 'discard', u: sel }), true);
      return out;
    }
    if (at.where === 'hand' && c.kind === 'monster') {
      const need = tributesFor(c.level);
      for (const set of [false, true]) {
        const ok = has('summon', (m) => m.set === set) || (v.free && myTurn() && can({ t: 'summon', u: sel, set, tributes: [] }));
        add(set ? 'Verdeckt setzen' : 'Beschwören', ok, () => {
          if (!need) return act({ t: 'summon', u: sel, set, tributes: [] });
          mode = { kind: 'tribute', u: sel, set, chosen: [] };
          render();
        }, !set);
      }
    } else if (at.where === 'hand' || (at.where === 'st' && !at.slot.up)) {
      if (c.kind === 'spell' || at.where === 'st') {
        const list = ms.filter((m) => m.t === 'activate').map((m) => m.target);
        add('Aktivieren', list.length > 0, () => {
          if (!c.target) return act({ t: 'activate', u: sel, target: null });
          mode = { kind: 'target', u: sel, list };
          render();
        }, true);
      }
      if (at.where === 'hand' && c.sub !== 'field') add('Verdeckt setzen', has('set'), () => act({ t: 'set', u: sel }));
    } else if (at.where === 'mon') {
      const list = ms.filter((m) => m.t === 'attack');
      if (v.step === 'battle' || list.length) {
        add('Angreifen', list.length > 0, () => {
          const targets = list.filter((m) => m.target !== null).map((m) => m.target);
          const direct = list.some((m) => m.target === null);
          if (direct && !targets.length) return act({ t: 'attack', u: sel, target: null });
          mode = { kind: 'attack', u: sel, list: targets, direct };
          render();
        }, true);
      }
      if (!at.slot.up) add('Aufdecken', has('flip'), () => act({ t: 'flip', u: sel }));
      else add(at.slot.pos === 'atk' ? 'In Verteidigung' : 'In Angriff', has('position'), () => act({ t: 'position', u: sel }));
    }
    return out;
  }

  // Klick auf eine Karte: je nach Modus Tribut, Ziel oder Auswahl
  function clickCard(u) {
    if (!running()) return;
    if (mode?.kind === 'tribute') {
      const at = locate(mine, u);
      if (at?.where === 'mon' && at.p === mySeat) {
        mode.chosen = mode.chosen.includes(u) ? mode.chosen.filter((x) => x !== u) : [...mode.chosen, u];
        const need = tributesFor(cardOf(mine, mode.u).level);
        if (mode.chosen.length === need) return act({ t: 'summon', u: mode.u, set: mode.set, tributes: mode.chosen });
        return render();
      }
      mode = null;
    } else if (mode) {
      if (mode.list.includes(u)) {
        const m = mode.kind === 'attack' ? { t: 'attack', u: mode.u, target: u } : { t: 'activate', u: mode.u, target: u };
        return act(m);
      }
      mode = null;
    }
    sel = u === sel ? null : u;
    render();
  }

  // Tribute fertig (ohne Hilfen auch mit zu wenigen), Direktangriff, Abbrechen
  function modeActions() {
    if (!mode) return [];
    const out = [];
    if (mode.kind === 'tribute') {
      const need = tributesFor(cardOf(mine, mode.u).level);
      if (mine.free) out.push({ label: `Mit ${mode.chosen.length} Tribut${mode.chosen.length === 1 ? '' : 'en'} beschwören`, primary: true, run: () => act({ t: 'summon', u: mode.u, set: mode.set, tributes: mode.chosen }) });
      else out.push({ label: `${mode.chosen.length} von ${need} gewählt`, off: true, run: () => {} });
    }
    if (mode.kind === 'attack' && mode.direct) out.push({ label: 'Direkt angreifen', primary: true, run: () => act({ t: 'attack', u: mode.u, target: null }) });
    out.push({ label: 'Abbrechen', run: () => { mode = null; render(); } });
    return out;
  }

  // Karte mit der Hand abgelegt (tisch.js): Monster auf eine eigene Monsterzone = beschwören, Zauber/Falle auf eine
  // eigene Zauber-/Fallenzone = setzen, Feldzauber auf die Feldzone = aktivieren
  board.onPlace = (mesh, point) => {
    const c = board.cardOf(mesh);
    const zone = board.zoneAt(point);
    if (!c || c.from !== 'hand' || !myTurn()) return null;
    if (!zone || zone.seat !== mySeat) return 'back';
    const card = cardOf(mine, c.u);
    sel = c.u;
    if (card.kind === 'monster' && zone.row === 'mon') {
      if (!tributesFor(card.level)) return act({ t: 'summon', u: c.u, set: false, tributes: [] }) ? 'move' : 'back';
      mode = { kind: 'tribute', u: c.u, set: false, chosen: [] };
      render();
      return 'back';
    }
    if (card.sub === 'field' && zone.row === 'field') return act({ t: 'activate', u: c.u, target: null }) ? 'move' : 'back';
    if (card.kind !== 'monster' && card.sub !== 'field' && zone.row === 'st') return act({ t: 'set', u: c.u }) ? 'move' : 'back';
    return 'back';
  };

  const onMove = (e) => {
    if (e.buttons & 1) return; // Karte in der Hand (tisch.js): nichts anheben – sonst fliegt die gepackte Kopie zurück
    const ray = room.rayFrom(e);
    const hit = mine && mine.phase !== 'setup' ? board.pick(ray) : null;
    const deck = hit !== null && (mine.deck[0].includes(hit) || mine.deck[1].includes(hit));
    const u = deck ? null : hit;
    if (u !== hover) {
      hover = u;
      board.setHover(u);
      render();
    }
    canvas.style.cursor = u !== null || (mine?.free && myTurn() && (deck ? mine.deck[mySeat].includes(hit) : board.hitDeck(ray))) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const ray = room.rayFrom(e);
    const u = board.pick(ray);
    const deck = u !== null ? mine.deck[mySeat].includes(u) || mine.deck[other].includes(u) : board.hitDeck(ray);
    if (deck) { // Deck: ohne Hilfen = ziehen, sonst nichts
      if (mine.free && myTurn() && (u === null || mine.deck[mySeat].includes(u))) act({ t: 'draw' });
      return;
    }
    if (u !== null) return clickCard(u);
    if (mode || sel !== null) {
      mode = null;
      sel = null;
      render();
    }
  };

  const onLeaveCanvas = () => {
    if (hover === null) return;
    hover = null;
    board.setHover(null);
    render();
  };

  const onKey = (e) => {
    if (e.key !== 'Escape' || (!mode && sel === null)) return;
    mode = null;
    sel = null;
    render();
  };

  // --- Anzeige ---
  function render() {
    updatePreview();
    board.sync(mine, mySeat, [0, 1].map((p) => (p === mySeat ? names.me() || 'Du' : solo ? 'Computer' : names.other())));
    if (!mine) return;
    const v = mine;
    const ms = legal();
    const strict = !v.free;
    board.setMarks({
      selected: sel,
      targets: mode?.kind === 'tribute' ? v.mon[mySeat].filter(Boolean).map((m) => m.u).filter((u) => !mode.chosen.includes(u)) : mode?.list ?? [],
      tribute: mode?.kind === 'tribute' ? mode.chosen : [],
      dim: strict && myCall() && !mode ? new Set(ms.map((m) => m.u).filter((u) => u !== undefined)) : null,
    });
    const canAccuse = v.free && v.phase !== 'setup' && !!v.cheat && v.cheat.player !== mySeat && !waiting;
    cheat.update({ free: v.free, canAccuse });
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const won = v.phase === 'over' && v.winner === mySeat;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const seats = [mySeat, other];
    const react = v.pending?.type === 'react' && v.pending.who === mySeat && running();
    const shownU = hover ?? sel;
    const id = shownU !== null ? v.cards[shownU] : null;
    shownActs = mode ? modeActions() : react ? reactActions() : shownU === sel ? actions() : []; // nur die gewählte Karte hat Knöpfe
    panel.render({
      round: v.phase === 'setup' ? 'Deck wählen' : `Duell ${v.round} · Siege: Du ${v.wins[mySeat]} – ${nameOf(other)} ${v.wins[other]}`,
      players: seats.map((p) => ({
        name: nameOf(p) + (v.picks[p] ? ` · ${v.picks[p].name || 'hat gewählt'}` : ''),
        lp: v.phase === 'setup' ? null : v.lp[p],
        hand: v.phase === 'setup' ? null : v.hand[p].length,
        deck: v.deck[p].length,
        grave: v.grave[p].length,
        turn: v.phase === 'duel' && (v.pending ? v.pending.who === p : v.turn === p),
      })),
      step: v.phase === 'duel' ? (v.pending?.type === 'discard' ? 'end' : v.step) : null,
      status: statusText(),
      setup: v.phase === 'setup' ? setupInfo() : null,
      phase: v.phase === 'duel' && myTurn() && !mode ? Object.fromEntries(['battle', 'main2', 'end'].map((to) => [to, ms.some((m) => m.t === 'step' && m.to === to)])) : null,
      card: id || mode || react ? {
        id: id ?? v.cards[mode?.u ?? v.pending?.attacker ?? v.pending?.summoned] ?? null,
        stats: statsText(id ? shownU : mode?.u ?? v.pending?.attacker ?? v.pending?.summoned),
        acts: shownActs,
      } : null,
      hint: hint || preview,
      last: log.join('\n'),
      end: v.phase === 'over' ? endInfo() : null,
    });
  }

  // Reaktion: passende Fallen direkt anbieten, dazu „Keine Reaktion“
  function reactActions() {
    const out = legal().filter((m) => m.t === 'activate').map((m) => ({
      label: `${cardOf(mine, m.u).name}${m.target !== null ? ` → ${cardName(m.target)}` : ''}`,
      primary: true,
      run: () => act(m),
    }));
    out.push({ label: 'Keine Reaktion', run: () => act({ t: 'pass' }) });
    return out;
  }

  function statsText(u) {
    if (u === null || u === undefined) return '';
    const v = mine;
    const c = cardOf(v, u);
    const at = locate(v, u);
    if (!c) return '';
    const where = { hand: 'auf der Hand', deck: 'im Deck', grave: 'im Friedhof', st: 'auf dem Feld', field: 'in der Feldzone', mon: 'auf dem Feld' }[at?.where] ?? '';
    if (c.kind !== 'monster') return `${c.name} · ${where}`;
    const base = `Stufe ${c.level} · ${ATTRS[c.attr]} · ${c.type}`;
    if (at?.where !== 'mon') return `${base} · ${where}`;
    const pos = at.slot.pos === 'atk' ? 'Angriff' : 'Verteidigung';
    if (!at.slot.up) return `${base} · verdeckt in ${pos}`;
    return `Jetzt ATK ${atkOf(v, u)} · DEF ${defOf(v, u)} · ${pos}`;
  }

  function setupInfo() {
    const own = loadDeck();
    const decks = Object.entries(DECKS).map(([key, d]) => ({ key, name: d.name, info: d.info, ok: true }));
    decks.push({ key: 'own', name: own?.name ?? 'Eigenes Deck', info: deckReady(own) ? 'Dein Deck aus dem Deckbau' : `Noch nicht fertig (${own?.list.length ?? 0} von 40 Karten)`, ok: deckReady(own) });
    return { decks, wait: !!mine.picks[mySeat] || waiting };
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'setup') return v.picks[mySeat] ? `Warte auf ${nameOf(other)} …` : 'Wähle dein Deck';
    if (v.phase === 'over') return 'Duell vorbei';
    if (waiting) return 'Wird gesendet …';
    const pend = v.pending;
    if (pend?.type === 'react') {
      const what = pend.trigger === 'attack'
        ? `${cardName(pend.attacker)} greift ${pend.target === null ? `${pend.who === mySeat ? 'dich' : nameOf(pend.who)} direkt` : cardName(pend.target)} an`
        : `${cardName(pend.summoned)} wurde beschworen`;
      return pend.who === mySeat ? `${what} – Falle aktivieren?` : `${what} – ${nameOf(pend.who)} überlegt …`;
    }
    if (pend?.type === 'discard') {
      const n = v.hand[pend.who].length - HAND_MAX;
      return pend.who === mySeat ? `Zu viele Karten: wirf ${n} ab (Karte anklicken)` : `${nameOf(pend.who)} wirft Karten ab …`;
    }
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ist dran · ${STEP_NAMES[v.step]}`;
    if (mode?.kind === 'tribute') {
      const need = tributesFor(cardOf(v, mode.u).level);
      return `Wähle ${need === 1 ? '1 Monster' : `${need} Monster`} als Tribut`;
    }
    if (mode?.kind === 'target') return 'Ziel anklicken';
    if (mode?.kind === 'attack') return mode.direct ? 'Angriffsziel anklicken – oder direkt angreifen' : 'Angriffsziel anklicken';
    return `Du bist dran · ${STEP_NAMES[v.step]}`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      const who = (p) => nameOf(p);
      if (e.type === 'deal') parts.push(`Duell ${mine.round}: ${who(e.starter)} ${verb(e.starter, 'fängst', 'fängt')} an.`);
      else if (e.type === 'turn' && e.no > 1) parts.push(`— Zug ${e.no}: ${who(e.p)} ${verb(e.p, 'bist', 'ist')} dran.`);
      else if (e.type === 'draw' && e.p === mySeat && mine.phase !== 'setup') parts.push(`Du ziehst ${cardName(e.u)}.`);
      else if (e.type === 'summon') parts.push(e.set ? `${who(e.p)} ${verb(e.p, 'setzt', 'setzt')} ein Monster.` : `${who(e.p)} ${verb(e.p, 'beschwörst', 'beschwört')} ${cardName(e.u)}.`);
      else if (e.type === 'tribute') parts.push(`${cardName(e.u)} wird geopfert.`);
      else if (e.type === 'set') parts.push(`${who(e.p)} ${verb(e.p, 'setzt', 'setzt')} eine Karte.`);
      else if (e.type === 'activate') parts.push(`${who(e.p)} ${verb(e.p, 'aktivierst', 'aktiviert')} ${cardName(e.u)}.`);
      else if (e.type === 'flip') parts.push(`${cardName(e.u)} wird aufgedeckt.`);
      else if (e.type === 'position') parts.push(`${cardName(e.u)} wechselt die Position.`);
      else if (e.type === 'attack') parts.push(`${cardName(e.u)} greift ${e.target === null ? 'direkt' : cardName(e.target)} an.`);
      else if (e.type === 'destroy') parts.push(`${cardName(e.u)} wird zerstört.`);
      else if (e.type === 'bounce') parts.push(`${cardName(e.u)} kehrt auf die Hand zurück.`);
      else if (e.type === 'revive') parts.push(`${cardName(e.u)} kehrt aufs Feld zurück.`);
      else if (e.type === 'negate') parts.push('Der Angriff fällt aus.');
      else if (e.type === 'discard') parts.push(`${who(ownerOf(e.u))} ${verb(ownerOf(e.u), 'wirfst', 'wirft')} ${cardName(e.u)} ab.`);
      else if (e.type === 'lp' && events.some((x) => x.type === 'fehlalarm' || x.type === 'caught')) continue; // steht schon in der Meldung
      else if (e.type === 'lp') parts.push(e.n < 0 ? `${who(e.p)} ${verb(e.p, 'verlierst', 'verliert')} ${-e.n} LP.` : `${who(e.p)} ${verb(e.p, 'erhältst', 'erhält')} ${e.n} LP.`);
      else if (e.type === 'over') parts.push(e.winner === null ? 'Unentschieden!' : `${who(e.winner)} ${verb(e.winner, 'gewinnst', 'gewinnt')}!`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    const why = e.why ? `: ${e.why}` : '';
    if (e.type === 'caught') {
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast geschummelt${why}. Alles ab da wird zurückgenommen, dazu ${CHEAT_PENALTY} LP Strafe.`
        : `Erwischt! ${nameOf(e.player)} hat geschummelt${why}. Alles ab da wird zurückgenommen, dazu ${CHEAT_PENALTY} LP Strafe.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig gespielt – du verlierst ${FALSE_ALARM_PENALTY} LP.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen und verliert ${FALSE_ALARM_PENALTY} LP.`;
  }

  function endInfo() {
    const v = mine;
    const title = v.winner === mySeat ? 'Du gewinnst das Duell!' : v.winner === null ? 'Unentschieden' : `${nameOf(v.winner)} gewinnt`;
    const why = v.why === 'Keine Karte mehr zum Ziehen' ? `${nameOf(1 - v.winner)} konnte keine Karte mehr ziehen.` : `LP: Du ${v.lp[mySeat]} – ${nameOf(other)} ${v.lp[other]}.`;
    const stuck = rematchBlocked(v, mySeat);
    return { title, text: `${why} Siege: Du ${v.wins[mySeat]} – ${nameOf(other)} ${v.wins[other]}.`, again: !stuck && !waiting, regroup: !stuck && !waiting };
  }

  // Ohne Hilfen gibt es keine Vorschau; sonst zeigt die Maus über einem Angriffsziel, was passieren würde
  function updatePreview() {
    preview = '';
    if (!mine || mine.free || mode?.kind !== 'attack' || hover === null || !mode.list.includes(hover)) return;
    if (!locate(mine, hover).slot.up) {
      preview = 'Vorschau: Das Ziel liegt verdeckt – was passiert, siehst du erst beim Angriff.';
      return;
    }
    const next = apply({ ...mine, free: false }, mySeat, { t: 'attack', u: mode.u, target: hover });
    const done = next?.pending ? apply(next, next.pending.who, { t: 'pass' }) : next;
    if (!done) return;
    const loss = [0, 1].map((p) => mine.lp[p] - done.lp[p]);
    const gone = (u) => locate(done, u)?.where === 'grave';
    const bits = [];
    if (gone(hover)) bits.push(`${cardName(hover)} wird zerstört`);
    if (gone(mode.u)) bits.push(`${cardName(mode.u)} wird zerstört`);
    if (loss[other]) bits.push(`${nameOf(other)} verliert ${loss[other]} LP`);
    if (loss[mySeat]) bits.push(`du verlierst ${loss[mySeat]} LP`);
    preview = `Vorschau (ohne Fallen): ${bits.join(', ') || 'nichts passiert'}.`;
  }
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerleave', onLeaveCanvas);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame({ humans, free }));
  // main.js setzt nach dem Start die Bedienhinweise zurück – danach einmal neu zeichnen, damit „Ohne Hilfen“ stimmt
  setTimeout(() => !stopped && render());

  return {
    handle,
    refresh: () => render(), // z. B. wenn sich ein Name ändert
    view: () => mine,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      cheat.remove();
      builder.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointerleave', onLeaveCanvas);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
