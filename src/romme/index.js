// Rommé-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js) und Netz.
// Zu zweit: Der Host hält den vollen Stand und schickt dem Gast nur dessen Sicht (viewFor: eigene Karten offen,
// vom Host nur die Anzahl). Der Gast schickt Wünsche (ziehen, auslegen, anlegen, tauschen, zurücksetzen, ablegen,
// nächste Runde), der Host prüft sie. Allein (level gesetzt): Spieler 1 ist der Computer (ai.js) – auch er sieht nur seine Sicht.
// free = „Ohne Hilfen“ (zu zweit oder allein): keine Hinweise und Punkte zur Auswahl, regelwidrige Züge gehen durch,
// „Geschummelt!“-Knopf. Allein schummelt der Computer ab und zu selbst und prüft jeden Zug des Menschen einmal.
import {
  newGame, draw, meld, layoff, swap, undo, discard, again, accuse, waive, viewFor, arrange, arrangeOptions, extend, meldValue, handSize,
  canMeld, discardable, openPoints, isOut, faceOf, isJoker, handPoints, OPEN_MIN, NOBODY, CHEAT_PENALTY, FALSE_ALARM_PENALTY,
} from './game.js';
import { computerMove, cheatMoves } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../schummeln.js';
import { cardName, SUIT_NAMES } from '../karten/cards.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = { draw: 800, discard: 700, other: 450, accuse: 900 }; // so lange „überlegt“ der Computer je Schritt, nachdem die Karten liegen
const nameOf = (id) => cardName(faceOf(id));
const asObject = (id) => (isJoker(id) ? 'einen Joker' : nameOf(id)); // „legt einen Joker an“
const RUN_NAMES = { 1: 'Ass', 11: 'Bube', 12: 'Dame', 13: 'König', 14: 'Ass' };
const posName = (p) => RUN_NAMES[p] ?? String(p);

// „Herz 7 bis 9“ oder „Satz König“ (ohne Hilfen auch „3 Karten“)
function meldName(m) {
  if (m.kind === 'free') return `${m.cards.length} Karten`;
  if (m.kind === 'run') return `${SUIT_NAMES[m.suit]} ${posName(m.low)} bis ${posName(m.low + m.cards.length - 1)}`;
  const real = m.cards.find((c) => !isJoker(c));
  return `Satz ${nameOf(real).split(' ')[1]}`;
}

export function startRomme({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = () => (solo ? 'Der Computer' : names.other()); // Name kann sich während des Spiels ändern
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let mine = null; // meine Sicht davon
  let cheered = false;
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let selected = []; // ausgewählte Handkarten
  let lay = 0; // gewählte Lage der Auswahl (Nummer in arrangeOptions) – z. B. Joker vorn statt hinten, Satz statt Reihe
  let sort = 'suit';
  let hint = '';
  let timer = null;
  // Computer allein ohne Hilfen: Schummelzug, den er gerade spielt · ob er in diesem Zug schummelt (beim Ziehen
  // entschieden) · der Zug des Menschen, den er schon geprüft hat
  let plan = [];
  let cheating = false;
  let judged = null;

  const panel = createPanel($('rm-panel'), {
    solo,
    onMeld: () => tryMeld(selected),
    onLay: () => {
      lay++;
      render();
    },
    onDiscard: () => (selected.length === 1 ? tryDiscard(selected[0]) : say('Zum Ablegen genau eine Karte auswählen.')),
    onUndo: () => act('undo'),
    onSort: () => {
      sort = sort === 'suit' ? 'rank' : 'suit';
      board.setSort(sort);
      render();
    },
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && mine?.winner === null ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Rommé"] [data-hint]') });

  function apply(type, player, arg) {
    if (type === 'draw') return draw(state, player, arg?.from);
    if (type === 'meld') return meld(state, player, arg?.cards, arg?.hint);
    if (type === 'layoff') return layoff(state, player, arg?.card, arg?.index, arg?.end);
    if (type === 'swap') return swap(state, player, arg?.card, arg?.index, arg?.joker ?? null); // joker: ohne Hilfen der angetippte
    if (type === 'undo') return undo(state, player);
    if (type === 'discard') return discard(state, player, arg?.card);
    if (type === 'accuse') return accuse(state, player);
    if (type === 'again') return rematchBlocked(state, player) ? null : again(state);
    return null;
  }

  function setState(next) {
    state = next;
    mine = isHost ? viewFor(state, me) : state;
    hint = '';
    const hand = Array.isArray(mine.hands[me]) ? mine.hands[me] : [];
    const kept = selected.filter((c) => hand.includes(c));
    if (kept.length !== selected.length) lay = 0;
    selected = kept;
  }

  function commit(next) {
    setState(next);
    send({ t: 'state', state: viewFor(state, 1 - me) }); // der Gast sieht nur seine eigenen Karten
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
    if (solo) computerTurn();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || waiting) return;
    hint = '';
    if (type !== 'again') [selected, lay] = [[], 0];
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
      else render();
    } else {
      waiting = true;
      send({ t: type, arg });
      render();
    }
  }

  function handle(msg) {
    if (!isHost && msg.t === 'state') {
      waiting = false;
      setState(msg.state);
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 1 - me, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: viewFor(state, 1 - me) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  // Der Computer spielt Schritt für Schritt, sobald die Karten liegen (solange ändert sonst niemand etwas am Stand)
  function computerTurn() {
    clearTimeout(timer);
    const cpu = 1 - me;
    const c = state.cheat;
    if (c && c.player === me && c !== judged) { // ohne Hilfen: den letzten Zug des Menschen einmal prüfen, bevor er handelt
      judged = c;
      if (cpuAccuses(!c.legal)) {
        timer = setTimeout(() => {
          const next = accuse(state, cpu);
          if (next) commit(next);
        }, THINK_MS.accuse + board.busy() * 1000);
        return;
      }
      if (state.winner !== null) return commit(waive(state, cpu)); // Runde vorbei: gelten lassen, sonst sperrt das die nächste
    }
    if (state.winner !== null || state.turn === me) return;
    const v = viewFor(state, cpu);
    let m = plan.shift() ?? computerMove(v, cpu);
    if (m.t === 'draw') cheating = state.free && cpuCheats();
    if (m.t === 'discard' && cheating) { // einmal je Zug: statt des Ablegens ein Schummelzug, falls es einen gibt
      cheating = false;
      plan = cheatMoves(v, cpu) ?? [];
      m = plan.shift() ?? m;
    }
    timer = setTimeout(() => {
      let next = apply(m.t, cpu, m.arg);
      if (!next) [plan, next] = [[], rescue(state, cpu)];
      if (next) commit(next);
    }, (THINK_MS[m.t] ?? THINK_MS.other) + board.busy() * 1000);
  }

  // Sollte nie nötig sein: ungültiger Computerzug → Zug zurück, falls nötig ziehen, irgendeine Karte ablegen
  function rescue(s, p) {
    if (s.phase === 'draw') return draw(s, p, 'talon') ?? draw(s, p, 'pile');
    const back = undo(s, p) ?? s;
    return discardable(back, back.hands[p]).map((c) => discard(back, p, c)).find(Boolean) ?? null;
  }

  const running = () => mine && mine.winner === null && !waiting;
  const myTurn = () => running() && mine.turn === me;
  const playing = () => myTurn() && mine.phase === 'play';

  function say(text) {
    hint = text;
    render();
    return false;
  }

  // Ohne Hilfen: das Spiel lässt auch Regelwidriges zu und verrät nicht, was passt
  const loose = () => !!mine?.free;

  // Warum geht Auslegen/Anlegen gerade nicht? (null = geht)
  function meldBlock() {
    if (!playing()) return mine?.phase === 'draw' && myTurn() ? 'Zuerst eine Karte ziehen – vom Stapel oder von der Ablage.' : 'Du bist nicht dran.';
    if (!loose() && !canMeld(mine, me)) return 'In der ersten Runde wird noch nicht ausgelegt – nur ziehen und ablegen.';
    return null;
  }

  // Die folgenden Versuche prüfen mit denselben Regeln wie der Host (auf der eigenen Sicht) und
  // schicken nur gültige Züge (ohne Hilfen auch regelwidrige). true = Zug wird gemacht.
  function tryMeld(cards) {
    const block = meldBlock();
    if (block) return say(block);
    if (cards.length < 3) return say('Für eine Figur mindestens 3 Karten auswählen.');
    const m = chosen(cards);
    if (!m && !loose()) return say('Das ist keine gültige Figur – Satz: 3–4 gleiche Werte in verschiedenen Farben; Reihe: ab 3 aufeinanderfolgende Karten einer Farbe.');
    const hint = m && { kind: m.kind, low: m.low };
    if (!meld(mine, me, cards, hint)) return say(noRest(cards));
    act('meld', hint ? { cards, hint } : { cards });
    return true;
  }

  // Gewählte Lage für diese Karten (für die aktuelle Auswahl die mit „Andere Lage“ eingestellte, sonst die beste)
  function chosen(cards) {
    const list = arrangeOptions(cards);
    return list.length ? list[cards === selected ? lay % list.length : 0] : null;
  }

  // Warum die Karten nicht aus der Hand dürfen: Danach bliebe nichts, was man ablegen darf
  function noRest(cards) {
    const rest = mine.hands[me].filter((c) => !cards.includes(c));
    return rest.length ? 'Übrig bliebe nur eine Karte, die du nicht ablegen darfst (die von der Ablage oder ein eingetauschter Joker).'
      : 'Eine Karte muss zum Ablegen übrig bleiben.';
  }

  // Karte an Figur: auf einen passenden Joker getippt = tauschen, sonst anlegen (Joker an das nähere Ende)
  function tryLayoff(card, target) {
    const block = meldBlock();
    if (block) return say(block);
    const onJoker = target.card && isJoker(target.card);
    if (loose()) { // ohne Hilfen zählt nur, wohin man tippt (auf einen Joker = tauschen) – sonst verriete es, was passt
      const swapping = onJoker && !isJoker(card);
      if (!(swapping ? swap(mine, me, card, target.index, target.card) : layoff(mine, me, card, target.index, target.end))) return say(noRest([card]));
      act(swapping ? 'swap' : 'layoff', { card, index: target.index, end: target.end, ...(swapping && { joker: target.card }) });
      return true;
    }
    if (!mine.opened[me]) return say(`Anlegen und Joker tauschen geht erst, wenn du herausgekommen bist (${OPEN_MIN} Punkte).`);
    const canSwap = !!swap(mine, me, card, target.index);
    const canLay = !!layoff(mine, me, card, target.index, target.end);
    if (canSwap && (!canLay || onJoker)) {
      act('swap', { card, index: target.index });
      return true;
    }
    if (canLay) {
      act('layoff', { card, index: target.index, end: target.end });
      return true;
    }
    if (mine.melds[target.index] && extend(mine.melds[target.index], card)) return say(noRest([card]));
    return say(`${isJoker(card) ? 'Der Joker' : nameOf(card)} passt nicht an diese Figur.`);
  }

  function tryDiscard(card) {
    if (!playing()) return say(myTurn() ? 'Zuerst eine Karte ziehen – vom Stapel oder von der Ablage.' : 'Du bist nicht dran.');
    if (!loose()) {
      if (card === mine.taken) return say('Die Karte von der Ablage darf nicht gleich wieder abgelegt werden.');
      if (mine.fresh.length) return say(`Noch ${OPEN_MIN - openPoints(mine)} Punkte bis ${OPEN_MIN} – weitere Figur auslegen oder „Zug zurücksetzen“.`);
      if (mine.swapped.some((j) => mine.hands[me].includes(j))) return say('Den eingetauschten Joker erst auslegen oder anlegen – oder „Zug zurücksetzen“.');
    }
    if (!discard(mine, me, card)) return say('Diese Karte kannst du gerade nicht ablegen.');
    act('discard', { card });
    return true;
  }

  function tryDraw(from) {
    if (!myTurn() || mine.phase !== 'draw') return false;
    if (from === 'pile' && !mine.pile.length) return say('Die Ablage ist leer.');
    if (from === 'talon' && !mine.talon && mine.pile.length < 2) return say('Der Stapel ist leer – nimm die Karte von der Ablage.');
    act('draw', { from });
    return true;
  }

  // Karte mit der Hand abgelegt (tisch.js): Stapel- oder Ablagekarte vor mich = ziehen, Handkarte auf die Ablage =
  // ablegen, auf eine Figur = anlegen/tauschen, auf die freie Fläche vor mir = mit den ausgewählten Karten auslegen.
  // Antwort: 'move' (Spiel macht den Zug), 'back' (Karte fliegt zurück) oder null (bleibt auf dem Tisch liegen)
  board.onPlace = (mesh, point) => {
    const card = board.cardOf(mesh);
    const at = board.zoneAt(point);
    if (!card || !at || !myTurn()) return null;
    if (mine.phase === 'draw' && (card.from === 'talon' || card.from === 'pile') && (at.zone === 'hand' || at.zone === 'mine')) return tryDraw(card.from) ? 'move' : 'back';
    if (mine.phase !== 'play' || card.from !== 'hand') return null;
    if (at.zone === 'pile') return tryDiscard(card.id) ? 'move' : 'back';
    if (at.zone === 'meld') return tryLayoff(card.id, { index: at.index, card: null, end: at.end }) ? 'move' : 'back';
    if (at.zone === 'mine') return tryMeld(selected.includes(card.id) ? selected : [...selected, card.id]) ? 'move' : 'back';
    return null;
  };

  function render() {
    board.sync(mine, me);
    if (!mine) return;
    board.setSelected(selected);
    cheat.update({ free: mine.free, canAccuse: !!mine.cheat && mine.cheat.player !== me && !waiting });
    const verdict = mine.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(mine.seq, verdictText(verdict), verdict.type === 'caught');
    const n = (p) => handSize(mine, p);
    const cards = (k) => (k === 1 ? '1 Karte' : `${k} Karten`);
    const out = (p) => (isOut(mine, p) ? ' (draußen)' : '');
    const won = mine.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    const otherShort = solo ? 'Computer' : names.other();
    panel.render({
      players: `Du: ${cards(n(me))}${out(me)} · ${otherShort}: ${cards(n(1 - me))}${out(1 - me)}`,
      score: `Punkte: Du ${mine.score[me]} · ${otherShort} ${mine.score[1 - me]}`,
      status: statusText(),
      pick: pickText(),
      lay: { k: lay % Math.max(arrangeOptions(selected).length, 1), n: selected.length >= 3 && !loose() ? arrangeOptions(selected).length : 0 },
      last: lastText(),
      hint,
      canMeld: playing() && (loose() || canMeld(mine, me)) && selected.length >= 3,
      canDiscard: playing() && selected.length === 1,
      canUndo: playing() && mine.changed,
      sort,
      end: mine.winner === null ? null : endText(won, otherShort),
    });
  }

  // Rundenende: Rommé gemacht – oder der Stapel war zum zweiten Mal leer (weniger Restpunkte gewinnt die Differenz)
  function endText(won, otherShort) {
    if (!mine.events.some((e) => e.type === 'exhausted')) {
      return {
        title: won ? 'Rommé! Du gewinnst die Runde!' : `${other()} gewinnt die Runde`,
        text: won ? `${other()} hatte noch ${mine.points} Punkte auf der Hand – die bekommst du.` : `Du hattest noch ${mine.points} Punkte auf der Hand.`,
      };
    }
    const pts = (p) => (Array.isArray(mine.hands[p]) ? handPoints(mine.hands[p]) : 0);
    const both = `Der Stapel war zum zweiten Mal leer. Restpunkte: du ${pts(me)}, ${otherShort} ${pts(1 - me)}.`;
    if (mine.winner === NOBODY) return { title: 'Unentschieden', text: `${both} Keiner bekommt Punkte.` };
    return {
      title: won ? 'Du gewinnst die Runde' : `${other()} gewinnt die Runde`,
      text: `${both} ${won ? 'Du bekommst' : `${other()} bekommt`} die Differenz: ${mine.points} Punkte.`,
    };
  }

  function statusText() {
    if (mine.winner !== null) return 'Runde vorbei';
    if (waiting) return 'Wird gesendet …';
    if (mine.turn !== me) return solo ? 'Der Computer ist dran …' : `${other()} ist dran …`;
    if (mine.phase === 'draw') return 'Du bist dran – zieh eine Karte (Stapel oder Ablage)';
    if (loose()) return 'Auslegen, anlegen – dann eine Karte ablegen';
    if (!canMeld(mine, me)) return 'Erste Runde – leg eine Karte ab';
    if (mine.fresh.length) return `Herauskommen: ${openPoints(mine)} von ${OPEN_MIN} Punkten`;
    if (!mine.opened[me]) return `Auslegen (mind. ${OPEN_MIN} Punkte) – dann eine Karte ablegen`;
    return 'Auslegen, anlegen – dann eine Karte ablegen';
  }

  // Was die Auswahl wäre: „Reihe Herz 7 bis 9 · 24 Punkte“
  function pickText() {
    if (!selected.length || mine.winner !== null) return '';
    if (selected.length < 3 || loose()) return selected.length === 1 ? `Ausgewählt: ${nameOf(selected[0])}` : `Ausgewählt: ${selected.length} Karten`;
    const m = chosen(selected);
    return m ? `${m.kind === 'run' ? 'Reihe' : ''} ${meldName(m)} · ${meldValue(m)} Punkte`.trim() : `${selected.length} Karten – keine gültige Figur`;
  }

  function verdictText(e) {
    if (e.type === 'caught') {
      return e.player === me ? `Erwischt! Du hast geschummelt${e.why ? `: ${e.why}` : ''}. Dein ganzer Zug wird zurückgenommen, dazu ${CHEAT_PENALTY} Strafkarten – spiel ihn neu.`
        : `Erwischt! ${other()} hat geschummelt${e.why ? `: ${e.why}` : ''}. Der Zug wird zurückgenommen, dazu ${CHEAT_PENALTY} Strafkarten.`;
    }
    return e.player === me ? `Fehlalarm! Der Zug war in Ordnung – du ziehst ${FALSE_ALARM_PENALTY} Strafkarte.`
      : `Fehlalarm! ${other()} hat zu Unrecht „Geschummelt!“ gerufen und zieht ${FALSE_ALARM_PENALTY} Strafkarte.`;
  }

  // Was die letzte Aktion bewirkt hat, in einem Satz
  function lastText() {
    const who = (p) => (p === me ? 'Du' : other());
    const verb = (p, du, er) => (p === me ? du : er);
    const parts = [];
    for (const e of mine.events) {
      if (e.type === 'deal') parts.push(mine.starter === me ? 'Neue Runde – du fängst an (14 Karten).' : `Neue Runde – ${solo ? 'der Computer' : other()} fängt an.`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'draw' && e.why === 'strafe') continue; // steht schon im Urteil
      else if (e.type === 'draw') parts.push(e.from === 'pile' ? `${who(e.player)} ${verb(e.player, 'nimmst', 'nimmt')} ${asObject(e.card)} von der Ablage.` : `${who(e.player)} ${verb(e.player, 'ziehst', 'zieht')} vom Stapel.`);
      else if (e.type === 'shuffle') parts.push('Die Ablage wird neu gemischt.');
      else if (e.type === 'meld') { // ohne Hilfen ohne Figurname – der verriete, ob sie gültig ist
        parts.push(`${who(e.player)} ${verb(e.player, 'legst', 'legt')} ${loose() ? `${e.cards.length} Karten` : meldName(mine.melds[e.index] ?? arrange(e.cards))} aus.`);
      } else if (e.type === 'open' && !loose()) parts.push(`Mit ${e.points} Punkten herausgekommen!`);
      else if (e.type === 'layoff') parts.push(`${who(e.player)} ${verb(e.player, 'legst', 'legt')} ${asObject(e.card)} an.`);
      else if (e.type === 'swap') parts.push(`${who(e.player)} ${verb(e.player, 'tauschst', 'tauscht')} ${nameOf(e.card)} gegen einen Joker.`);
      else if (e.type === 'undo') parts.push(`${who(e.player)} ${verb(e.player, 'nimmst', 'nimmt')} den Zug zurück.`);
      else if (e.type === 'discard') parts.push(`${who(e.player)} ${verb(e.player, 'legst', 'legt')} ${asObject(e.card)} ab.`);
      else if (e.type === 'win') parts.push('Rommé!');
      else if (e.type === 'exhausted') parts.push('Der Stapel ist zum zweiten Mal aufgebraucht – die Runde endet.');
    }
    return parts.join(' ');
  }

  // --- Eingaben: Handkarte anklicken = auswählen, Stapel/Ablage = ziehen, Ablage = ablegen, Figur = anlegen ---
  const onMove = (e) => {
    if (!running()) {
      board.setHover(null);
      canvas.style.cursor = '';
      return;
    }
    const ray = room.rayFrom(e);
    let over = board.pickHand(ray);
    if (!over && myTurn() && mine.phase === 'draw') over = board.hitTalon(ray) ? 'talon' : board.hitPile(ray) && mine.pile.length ? 'pile' : null;
    if (!over && playing() && selected.length === 1) over = board.pickMeld(ray)?.card ?? (board.hitPile(ray) ? 'pile' : null);
    board.setHover(over);
    canvas.style.cursor = over ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!running()) return;
    const ray = room.rayFrom(e);
    const card = board.pickHand(ray);
    if (card) {
      selected = selected.includes(card) ? selected.filter((c) => c !== card) : [...selected, card];
      lay = 0;
      hint = '';
      return render();
    }
    if (!myTurn()) return;
    if (mine.phase === 'draw') {
      if (board.hitTalon(ray)) return tryDraw('talon');
      if (board.hitPile(ray)) return tryDraw('pile');
      return;
    }
    const target = board.pickMeld(ray);
    if (target) return selected.length === 1 ? tryLayoff(selected[0], target) : say('Zum Anlegen genau eine Karte auswählen, dann die Figur anklicken.');
    if (board.hitPile(ray)) return selected.length === 1 ? tryDiscard(selected[0]) : say('Zum Ablegen genau eine Karte auswählen, dann die Ablage anklicken.');
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && selected.length) {
      [selected, lay] = [[], 0];
      render();
    }
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  const stopFrames = room.onFrame((dt) => board.update(dt));
  board.setSort(sort);

  if (isHost) commit(resume ?? newGame(Math.random() < 0.5 ? 0 : 1, Math.random, { free })); // wer anfängt, entscheidet der Zufall

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    view: () => mine, // meine aktuelle Sicht (z. B. für einen Rundgang oder Tests)
    stop() {
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
