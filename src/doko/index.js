// Doppelkopf-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js), Computer (ai.js) und Netz.
// Vier Sitze: Host 0 (+z), Gast 2 (gegenüber), die freien Sitze spielt der Computer (allein: 1, 2, 3).
// Der Host hält den vollen Stand, lässt die Computer handeln und schickt dem Gast nur dessen Sicht (viewFor). Der Gast
// schickt Wünsche (call, play, announce, accuse, again), der Host prüft sie.
// free = „Ohne Hilfen“: jede Karte lässt sich legen, nichts wird abgedunkelt; „Geschummelt!“ gegen einen gewählten
// Spieler bis zum nächsten Spiel. Allein schummeln die Computer ab und zu (nicht bedienen) und passen auf: Nichtbedienen
// des Menschen fällt ihnen auf, sobald er die Farbe später doch zeigt – dann rufen sie jedes zweite Mal (schummeln.js).
import {
  newGame, reserve, play, announce, accuse, waive, again, viewFor, legalCards, announceOptions, knownParties, partyOf, revealed,
  keyOf, faceOf, titleOf, SOLO_NAMES, LEVEL_NAMES, PENALTY, FALSE_ALARM,
} from './game.js';
import { chooseCall, chooseAnnounce, searchCard, cheatCard } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { cpuCheats, cpuAccuses } from '../schummeln.js';
import { cardName, SUIT_NAMES } from '../karten/cards.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { call: 650, play: 600, announce: 450, accuse: 900 }; // so lange „überlegt“ der Computer, nachdem die Karten liegen
const REL = ['', 'links', 'gegenüber', 'rechts'];
const nameOfCard = (c) => cardName(faceOf(c));

export function startDoko({ room, board, canvas, me, send, onLeave, ask, level, names, free = false }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const mySeat = isHost ? 0 : 2;
  const humans = solo ? [0] : [0, 2];
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort steht aus
  let asked = null; // Gast: welcher Wunsch zuletzt
  let timer = null;
  let hint = '';
  let picking = false; // „Geschummelt!“ gedrückt – wartet auf die Wahl des Spielers
  let cheered = false;
  let stopped = false;
  let judged = new Set(); // allein ohne Hilfen: schon geprüfte Schummeleien des Menschen
  let due = null; // … und die, die ein Computer anklagen will
  let log = []; // was zuletzt passiert ist (ein paar Sätze)

  const rel = (seat) => (seat - mySeat + 4) % 4;
  const nameOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : `Computer ${REL[rel(seat)]}`);
  const shortOf = (seat) => (seat === mySeat ? 'Du' : humans.includes(seat) ? names.other() : REL[rel(seat)]);

  const panel = createPanel($('dk-panel'), {
    solo,
    onCall: (choice) => act('call', choice),
    onAnnounce: (lv) => act('announce', lv),
    onAgain: () => act('again'),
    onAccuse: (target) => {
      picking = false;
      if (target === null) return render();
      act('accuse', target);
    },
    onLeave: (confirm) => (confirm && mine?.phase !== 'over' ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({
    onAccuse: () => {
      picking = !picking;
      render();
    },
    hint: document.querySelector('[data-game="Doppelkopf"] [data-hint]'),
  });

  function apply(type, seat, arg) {
    if (type === 'call') return reserve(state, seat, arg);
    if (type === 'play') return play(state, seat, arg);
    if (type === 'announce') return announce(state, seat, arg);
    if (type === 'accuse') return accuse(state, seat, arg);
    if (type === 'again') return again(state, seat);
    return null;
  }

  function setState(next) {
    if (next.events[0]?.type === 'deal') {
      cheered = false;
      judged = new Set();
      due = null;
      log = [];
    }
    const fresh = next.seq !== state?.seq;
    state = next;
    mine = isHost ? viewFor(state, mySeat) : state;
    if (fresh) {
      const text = describe(mine.events);
      if (text) log = [text, ...log].slice(0, 3);
    }
    hint = '';
  }

  function commit(next) {
    setState(next);
    if (!solo) send({ t: 'state', state: viewFor(state, 2) });
    render();
    schedule();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    if (isHost) {
      const next = apply(type, mySeat, arg);
      if (next) commit(next);
      else if (type === 'again') say(blocked());
      else render();
    } else {
      waiting = true;
      asked = type;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (stopped) return;
    if (!isHost && msg.t === 'state') {
      const same = msg.state.seq === state?.seq;
      waiting = false;
      setState(msg.state);
      if (same && asked === 'again') hint = blocked();
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 2, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 2) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // --- Computer (nur beim Host) ---
  const isCpu = (seat) => !humans.includes(seat);
  const firstCpu = (from = mySeat) => [1, 2, 3].map((k) => (from + k) % 4).find(isCpu);

  function schedule() {
    clearTimeout(timer);
    if (stopped || !isHost || !state) return;
    const s = state;
    if (solo && s.free && judge(s)) return;
    if (s.phase === 'over') {
      if (solo && s.free && !s.waived && !s.result.caught) {
        // Am Ende einmal prüfen: Ohne Schummelei des Menschen ruft er selten trotzdem (Fehlalarm, Strafe für ihn)
        const clean = !s.revokes.some((r) => humans.includes(r.player));
        later(THINK_MS.accuse, () => {
          const alarm = clean && cpuAccuses(false) ? accuse(state, firstCpu(), mySeat) : null;
          commit(waive(alarm ?? state) ?? alarm ?? state);
        });
      }
      return;
    }
    const seat = s.turn;
    if (!isCpu(seat)) return;
    if (s.phase === 'reserve') return later(THINK_MS.call, () => commit(reserve(state, seat, chooseCall(viewFor(state, seat), seat)) ?? reserve(state, seat, 'gesund')));
    later(THINK_MS.play, () => {
      const v = viewFor(state, seat);
      const lv = chooseAnnounce(v, seat);
      const said = lv ? announce(state, seat, lv) : null;
      if (said) return commit(said); // danach geht es mit der Karte weiter
      const sly = solo && state.free && cpuCheats() ? cheatCard(v, seat) : null;
      commit(play(state, seat, sly ?? searchCard(v, seat)) ?? play(state, seat, legalCards(state.hands[seat], state.trick, state.kind)[0]));
    });
  }

  // Allein ohne Hilfen: Hat der Mensch nicht bedient und es zeigt sich jetzt? Dann prüft ein Computer einmal.
  function judge(s) {
    if (s.phase === 'reserve' || s.result?.caught) return false;
    const r = s.revokes.find((x) => humans.includes(x.player) && !judged.has(x) && revealed(s, x));
    if (r) {
      judged.add(r);
      if (cpuAccuses(true)) due = r;
    }
    if (!due) return false;
    // bleibt vorgemerkt, falls der Mensch vorher noch etwas tut (dann verwirft later() den Aufruf)
    later(THINK_MS.accuse, () => commit(accuse(state, firstCpu(), due.player) ?? state));
    return true;
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
  const running = () => mine && mine.phase !== 'over' && !waiting;
  const myTurn = () => running() && mine.turn === mySeat;
  const legalNow = () => (myTurn() && mine.phase === 'play' ? legalCards(mine.hands[mySeat], mine.trick, mine.kind) : []);

  // Wer nicht bedient hat, startet das nächste Spiel nicht selbst, solange man ihn noch erwischen kann (game.js again)
  const blocked = () => (humans.length === 1 ? 'Der Computer prüft das Spiel noch …' : `${nameOf(humans.find((p) => p !== mySeat))} startet das nächste Spiel`);

  function say(text) {
    hint = text;
    render();
    return false;
  }

  function tryPlay(card) {
    if (!running() || mine.phase !== 'play') return false;
    if (mine.turn !== mySeat) return say(`${nameOf(mine.turn)} ist dran.`);
    if (!mine.free && !legalNow().includes(card)) {
      const led = keyOf(mine.trick[0].c, mine.kind);
      return say(`Du musst bedienen: ${led === 't' ? 'Trumpf' : SUIT_NAMES[led]}.`);
    }
    act('play', card);
    return true;
  }

  // Karte mit der Hand in die Tischmitte gelegt (tisch.js) = spielen
  board.onPlace = (mesh, point) => {
    const c = board.cardOf(mesh);
    if (!c || !board.inMiddle(point) || !myTurn() || mine.phase !== 'play') return null;
    return tryPlay(c.id) ? 'move' : 'back';
  };

  const onMove = (e) => {
    const id = running() ? board.pickHand(room.rayFrom(e)) : null;
    const usable = id && myTurn() && mine.phase === 'play';
    board.setHover(usable ? id : null);
    canvas.style.cursor = usable ? 'pointer' : '';
  };

  const onClick = (e) => {
    const id = running() ? board.pickHand(room.rayFrom(e)) : null;
    if (id) tryPlay(id);
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && picking) {
      picking = false;
      render();
    }
  };

  // --- Anzeige ---
  function render() {
    board.sync(mine, mySeat);
    if (!mine) return;
    const v = mine;
    board.setPlayable(v.free || v.phase !== 'play' || !myTurn() ? null : legalNow());
    const known = knownParties(v, mySeat);
    const over = v.phase === 'over';
    const truth = over ? (p) => (v.re.includes(p) ? 0 : 1) : (p) => known[p];
    const won = over && v.result.winner !== null && v.result.winner === (v.re.includes(mySeat) ? 0 : 1) && !v.result.caught;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const canAccuse = v.free && v.phase !== 'reserve' && !v.result?.caught && !waiting;
    cheat.update({ free: v.free, canAccuse });
    if (!canAccuse) picking = false;
    const verdict = v.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(`${v.round}-${v.seq}`, verdictText(verdict), verdict.type === 'caught');
    const seats = [0, 1, 2, 3].map((k) => (mySeat + k) % 4);
    const tricksOf = (p) => v.tricks.filter((t) => t.winner === p).length;
    panel.render({
      contract: contractText(),
      players: seats.map((p) => ({
        name: nameOf(p),
        party: truth(p) === 0 ? 'Re' : truth(p) === 1 ? 'Kontra' : null,
        tricks: v.phase === 'reserve' ? null : tricksOf(p),
        score: v.score[p],
        turn: !over && v.turn === p,
      })),
      status: statusText(),
      reserve: v.phase === 'reserve' && myTurn() ? { wedding: v.hands[mySeat].filter((c) => faceOf(c) === 'cQ').length === 2 } : null,
      says: saysText(),
      ann: v.phase === 'play' && !waiting ? announceOptions(v, mySeat).map((lv) => ({ level: lv, text: lv === 1 ? (partyOf(v, mySeat) === 0 ? 'Re' : 'Kontra') : LEVEL_NAMES[lv] })) : [],
      accuse: picking && canAccuse ? seats.slice(1).map((p) => ({ seat: p, name: nameOf(p) })) : null,
      last: log.join(' '),
      trick: lastTrickText(),
      hint,
      end: over ? endInfo() : null,
      list: {
        names: seats.map(shortOf),
        rows: v.list.slice(-8).map((r) => ({ title: r.title, points: seats.map((p) => r.points[p]) })),
        total: seats.map((p) => v.score[p]),
      },
    });
  }

  function contractText() {
    const c = mine.contract;
    if (!c) return `Spiel ${mine.round} · Vorbehaltsabfrage`;
    const who = (p) => (p === mySeat ? 'du' : nameOf(p));
    if (c.type === 'solo') return `${titleOf(c)} – ${c.player === mySeat ? 'du spielst allein' : `${nameOf(c.player)} spielt allein`}`;
    if (c.type === 'silent') return `Stille Hochzeit – ${who(c.player)} allein`; // andere sehen sie erst ab der zweiten Kreuz-Dame
    if (c.type === 'wedding') return c.partner === null ? `Hochzeit von ${who(c.player)} – Partner gesucht` : `Hochzeit: ${who(c.player)} + ${who(c.partner)}`;
    return `Spiel ${mine.round} · Normalspiel`;
  }

  function statusText() {
    const v = mine;
    if (v.phase === 'over') return v.result.caught ? 'Spiel abgebrochen' : 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (v.phase === 'reserve') return v.turn === mySeat ? 'Gesund – oder Vorbehalt?' : `${nameOf(v.turn)} überlegt …`;
    if (v.turn !== mySeat) return `${nameOf(v.turn)} ist dran …`;
    if (!v.trick.length) return 'Du spielst auf';
    if (v.free) return 'Du bist dran';
    const led = keyOf(v.trick[0].c, v.kind);
    return `Du bist dran – ${led === 't' ? 'Trumpf' : SUIT_NAMES[led]} ist gefordert`;
  }

  function saysText() {
    const v = mine;
    if (v.phase === 'reserve') {
      return v.calls.map((c, p) => (c === null ? null : `${shortOf(p)}: ${c === 'gesund' ? 'gesund' : c === 'vorbehalt' ? 'Vorbehalt' : c === 'wedding' ? 'Hochzeit' : SOLO_NAMES[c]}`)).filter(Boolean).join(' · ');
    }
    const part = (k) => (v.ann[k] ? `${k === 0 ? 'Re' : 'Kontra'}${v.ann[k] > 1 ? `: ${LEVEL_NAMES[v.ann[k]]}` : ''}` : null);
    const said = [part(0), part(1)].filter(Boolean).join(' · ');
    return said ? `Angesagt: ${said}` : v.phase === 'play' ? 'Noch keine Ansage' : '';
  }

  // Letzter fertiger Stich (darf man ansehen, bis der nächste voll ist – TSR 5.3.5)
  function lastTrickText() {
    const t = mine.tricks.at(-1);
    if (!t || mine.phase === 'reserve') return '';
    return `Letzter Stich: ${t.cards.map((x) => `${shortOf(x.p)} ${nameOfCard(x.c)}`).join(', ')} → ${shortOf(t.winner) === 'Du' ? 'dein Stich' : shortOf(t.winner)}`;
  }

  function describe(events) {
    const parts = [];
    for (const e of events) {
      if (e.type === 'deal') parts.push(`Spiel ${mine.round}: ${nameOf(mine.dealer) === 'Du' ? 'du gibst' : `${nameOf(mine.dealer)} gibt`}.`);
      else if (e.type === 'contract' && e.contract.type === 'solo') parts.push(`${nameOf(e.contract.player)} ${e.contract.player === mySeat ? 'spielst' : 'spielt'} ${SOLO_NAMES[e.contract.kind]}!`);
      else if (e.type === 'contract' && e.contract.type === 'wedding') parts.push(`${nameOf(e.contract.player)} ${e.contract.player === mySeat ? 'hast' : 'hat'} eine Hochzeit – wer zuerst einen Stich macht, spielt mit.`);
      else if (e.type === 'contract') parts.push('Alle gesund – Normalspiel.');
      else if (e.type === 'partner') parts.push(`${nameOf(e.player)} ${e.player === mySeat ? 'heiratest' : 'heiratet'} mit.`);
      else if (e.type === 'alone') parts.push(`Keiner hat geheiratet – ${nameOf(e.player)} ${e.player === mySeat ? 'spielst' : 'spielt'} Karo-Solo.`);
      else if (e.type === 'announce') parts.push(`${nameOf(e.player)} ${e.player === mySeat ? 'sagst' : 'sagt'} „${e.level === 1 ? (e.party === 0 ? 'Re' : 'Kontra') : LEVEL_NAMES[e.level]}“.`);
      else if (e.type === 'trick') parts.push(e.winner === mySeat ? 'Dein Stich.' : `Stich für ${nameOf(e.winner)}.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
    }
    return parts.join(' ');
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      return e.player === mySeat ? `${nameOf(e.by)} ruft „Geschummelt!“ – erwischt! Du hast nicht bedient: −${PENALTY}, das Spiel ist vorbei.`
        : `Erwischt! ${nameOf(e.player)} hat nicht bedient – das Spiel ist vorbei.`;
    }
    return e.player === mySeat ? `Fehlalarm! ${nameOf(e.target)} hat richtig bedient – du bekommst −${FALSE_ALARM}, die anderen je +1.`
      : `Fehlalarm! ${nameOf(e.player)} hat zu Unrecht „Geschummelt!“ gerufen: −${FALSE_ALARM}, die anderen je +1.`;
  }

  function endInfo() {
    const r = mine.result;
    const pts = (x) => (x > 0 ? `+${x}` : String(x));
    const mineP = r.points[mySeat];
    if (r.caught) {
      const t = r.caught;
      return { title: `${nameOf(t.player)} ${t.player === mySeat ? 'hast' : 'hat'} nicht bedient`, text: `Erwischt von ${nameOf(t.by)} (Stich ${t.trick + 1}). Spiel vorbei – für dich: ${pts(mineP)}.`, lines: [] };
    }
    const team = (k) => [0, 1, 2, 3].filter((p) => (r.re.includes(p) ? 0 : 1) === k).map((p) => (p === mySeat ? 'du' : nameOf(p))).join(' + ');
    const myParty = r.re.includes(mySeat) ? 0 : 1;
    const title = r.winner === null ? 'Keiner gewinnt' : r.winner === myParty ? 'Gewonnen!' : 'Verloren';
    const text = `${titleOf(r.contract)} · Re (${team(0)}) ${r.eyes[0]} : ${r.eyes[1]} Kontra (${team(1)}) · für dich: ${pts(mineP)}`;
    const lines = r.lines.map((l) => `${l.party === 0 ? 'Re' : 'Kontra'}: ${l.text} +${l.pts}${l.extra ? ' (Sonderpunkt)' : ''}`);
    return { title, text, lines };
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(newGame({ dealer: Math.floor(Math.random() * 4), humans, free }));

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => mine,
    stop() {
      stopped = true;
      board.onPlace = null;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
