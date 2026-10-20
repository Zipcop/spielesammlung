// Mau-Mau-Partie: verbindet Spielstand (game.js), Kartentisch (board.js), Seitenfeld (panel.js) und Netz.
// Zu zweit: Der Host hält den vollen Stand und schickt dem Gast nur dessen Sicht (viewFor: eigene
// Karten offen, vom Host nur die Anzahl). Der Gast schickt Wünsche (legen, ziehen, weiter, Revanche),
// der Host prüft sie. Allein (level gesetzt): Spieler 1 ist der Computer (ai.js) – auch er sieht nur seine Sicht.
// free = „Ohne Hilfen“: keine abgedunkelten Karten, kein Regel-Hinweis im Status, jede Karte legbar, „Geschummelt!“-Knopf.
// Allein schummelt der Computer dann ab und zu selbst und prüft jeden Zug des Menschen einmal (schummeln.js).
import { newGame, play, draw, pass, again, accuse, waive, viewFor, playable, handSize, MAU_PENALTY, CHEAT_PENALTY, FALSE_ALARM_PENALTY } from './game.js';
import { computerMove } from './ai.js';
import { createPanel } from './panel.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked, cpuCheats, cpuAccuses } from '../schummeln.js';
import { cardName, isCard, rankOf, SUIT_NAMES, SUITS } from '../karten/cards.js';
import { paintSuit } from '../karten/faces.js';

const $ = (id) => document.getElementById(id);
const THINK_MS = 900; // so lange „überlegt“ der Computer, nachdem die Karten liegen
const nameOf = (card) => (isCard(card) ? cardName(card) : 'eine Karte');

export function startMauMau({ room, board, canvas, me, send, onLeave, ask, level, names, free = false, resume, save }) {
  const solo = level !== undefined;
  const isHost = me === 0;
  const other = () => (solo ? 'Der Computer' : names.other()); // Name kann sich während des Spiels ändern
  let state = null; // Host: voller Stand · Gast: seine Sicht, wie sie vom Host kommt
  let cheered = false; // Sieg-Konfetti schon gezeigt
  let mine = null; // meine Sicht davon
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let mau = false; // „Mau!“ gedrückt – gilt für die nächste Karte, die ich lege
  let wishCard = null; // Bube, für den gerade die Wunschfarbe gewählt wird
  let hint = ''; // kurzer Hinweis, z. B. „passt nicht“
  let timer = null;

  const panel = createPanel($('mm-panel'), {
    solo,
    onMau: () => {
      mau = !mau;
      render();
    },
    onDraw: () => act('draw'),
    onPass: () => act('pass'),
    onAgain: () => act('again'),
    onLeave: (confirm) => (confirm && mine?.winner === null ? ask('Spiel beenden und zurück zum Schrank?', onLeave) : onLeave()),
  });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Mau-Mau"] [data-hint]') });

  function apply(type, player, arg) {
    if (type === 'play') return play(state, player, arg);
    if (type === 'draw') return draw(state, player);
    if (type === 'pass') return pass(state, player);
    if (type === 'accuse') return accuse(state, player);
    if (type === 'again') return rematchBlocked(state, player) ? null : again(state);
    return null;
  }

  function setState(next) {
    state = next;
    mine = isHost ? viewFor(state, me) : state;
    hint = '';
    if (mine.turn !== me || mine.winner !== null) {
      mau = false;
      closeWish(null, false); // z. B. Stand kam neu, während ich die Farbe aussuche
    }
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
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
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

  // Der Computer zieht, sobald die Karten liegen und er kurz „überlegt“ hat. Ohne Hilfen prüft er vorher einmal den
  // offenen Zug des Menschen – auch nach dessen Sieg; ruft er dann nicht, ist die Frist vorbei (waive).
  function computerTurn() {
    clearTimeout(timer);
    const cpu = 1 - me;
    const judge = state.cheat?.player === me && (state.turn === cpu || state.winner !== null);
    if (!judge && (state.winner !== null || state.turn === me)) return;
    timer = setTimeout(() => {
      if (judge && cpuAccuses(!state.cheat.legal || state.cheat.forgot)) return commit(accuse(state, cpu));
      if (judge && state.winner !== null) return commit(waive(state, cpu));
      const m = computerMove(viewFor(state, cpu), cpu, state.free && cpuCheats());
      const next = apply(m.t, cpu, m.arg);
      if (next) commit(next);
    }, THINK_MS + board.busy() * 1000);
  }

  const myTurn = () => mine && mine.winner === null && !waiting && !wishCard && mine.turn === me;

  // true = Karte wird gelegt; false = passt nicht oder erst die Wunschfarbe wählen
  function tryPlay(card) {
    if (!mine.free && !playable(mine, me).includes(card)) {
      hint = mine.drawn ? 'Nur die gezogene Karte darf noch gelegt werden – oder „Weiter“.'
        : mine.sevens ? `Auf die 7 passt nur eine 7 – sonst ${2 * mine.sevens} Karten ziehen.`
          : mine.wish ? `Gewünscht ist ${SUIT_NAMES[mine.wish]}.` : 'Die Karte passt nicht.';
      render();
      return false;
    }
    if (rankOf(card) === 'J' && handSize(mine, me) > 1) {
      wishCard = card;
      $('wish').hidden = false;
      render();
      return false;
    }
    playCard(card, null);
    return true;
  }

  // Karte mit der Hand abgelegt (tisch.js): eigene Karte auf die Ablage = legen, oberste Stapelkarte vor mich = ziehen.
  // Antwort: 'move' (Spiel macht den Zug), 'back' (Karte fliegt zurück) oder null (bleibt auf dem Tisch liegen)
  board.onPlace = (mesh, point) => {
    const card = board.cardOf(mesh);
    const zone = board.zoneAt(point);
    if (!card || !myTurn()) return null;
    if (card.from === 'hand' && zone === 'pile') return tryPlay(card.id) ? 'move' : 'back';
    if (card.from === 'talon' && zone === 'hand' && !mine.drawn) {
      act('draw');
      return 'move';
    }
    return null;
  };

  function playCard(card, wish) {
    const said = mau;
    mau = false;
    act('play', { card, wish, mau: said });
  }

  // Auswahlfenster für die Wunschfarbe schließen; suit = gewählte Farbe oder null (abgebrochen)
  function closeWish(suit, redraw = true) {
    const card = wishCard;
    wishCard = null;
    $('wish').hidden = true;
    if (card && SUITS.includes(suit)) playCard(card, suit);
    else if (redraw) render();
  }

  function render() {
    board.sync(mine, me);
    if (!mine) return;
    board.setPlayable(myTurn() && !mine.free ? playable(mine, me) : null);
    cheat.update({ free: mine.free, canAccuse: !!mine.cheat && mine.cheat.player !== me && !waiting });
    const verdict = mine.events.find((e) => e.type === 'caught' || e.type === 'fehlalarm');
    if (verdict) cheat.say(mine.seq, verdictText(verdict), verdict.type === 'caught');
    const n = (p) => handSize(mine, p);
    const cards = (k) => (k === 1 ? '1 Karte' : `${k} Karten`);
    const won = mine.winner === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
    panel.render({
      players: `Du: ${cards(n(me))} · ${solo ? 'Computer' : names.other()}: ${cards(n(1 - me))}`,
      status: statusText(),
      last: lastText(),
      hint,
      mau,
      canMau: myTurn(),
      canDraw: myTurn() && !mine.drawn,
      canPass: myTurn() && !!mine.drawn,
      end: mine.winner === null ? null : {
        title: mine.winner === me ? 'Mau-Mau! Du gewinnst!' : `${other()} gewinnt`,
        text: mine.winner === me ? `${other()} hatte noch ${cards(n(1 - me))}.` : `Du hattest noch ${cards(n(me))}.`,
      },
    });
  }

  function statusText() {
    if (mine.winner !== null) return 'Spiel vorbei';
    if (waiting) return 'Wird gesendet …';
    if (mine.turn !== me) return solo ? 'Der Computer überlegt …' : `${other()} ist dran …`;
    if (mine.sevens && !mine.free) return `Zieh ${2 * mine.sevens} Karten – oder leg eine 7 drauf`; // ohne Hilfen keine Regel-Hinweise
    if (mine.drawn && !mine.free) return 'Gezogene Karte legen – oder „Weiter“';
    if (mine.wish) return `Du bist dran – gewünscht ist ${SUIT_NAMES[mine.wish]}`;
    return 'Du bist dran';
  }

  function verdictText(e) {
    if (e.type === 'caught' && e.mau) {
      return e.player === me ? `Erwischt! Du hast geschummelt${e.why ? `: ${e.why}` : ''}. Du ziehst ${MAU_PENALTY} Strafkarte.`
        : `Erwischt! ${other()} hat geschummelt${e.why ? `: ${e.why}` : ''}. Dafür ${MAU_PENALTY} Strafkarte.`;
    }
    if (e.type === 'caught') {
      return e.player === me ? `Erwischt! Du hast geschummelt${e.why ? `: ${e.why}` : ''}. Deine Karte geht zurück, dazu ${CHEAT_PENALTY} Strafkarten.`
        : `Erwischt! ${other()} hat geschummelt${e.why ? `: ${e.why}` : ''}. Karte zurück und ${CHEAT_PENALTY} Strafkarten.`;
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
      if (e.type === 'deal') parts.push(mine.starter === me ? 'Neues Spiel – du fängst an.' : `Neues Spiel – ${solo ? 'der Computer' : other()} fängt an.`);
      else if (e.type === 'play') {
        const wish = SUIT_NAMES[e.wish] ? ` und ${verb(e.player, 'wünschst dir', 'wünscht sich')} ${SUIT_NAMES[e.wish]}` : '';
        parts.push(`${who(e.player)} ${verb(e.player, 'legst', 'legt')} ${nameOf(e.card)}${wish}.`);
      } else if (e.type === 'mau') parts.push(e.said ? '„Mau!“' : `„Mau“ vergessen – ${MAU_PENALTY} Strafkarte!`);
      else if (e.type === 'caught' || e.type === 'fehlalarm') parts.push(verdictText(e));
      else if (e.type === 'draw' && !['mau', 'strafe', 'fehlalarm'].includes(e.why)) parts.push(`${who(e.player)} ${verb(e.player, 'ziehst', 'zieht')} ${e.count === 1 ? 'eine Karte' : `${e.count} Karten`}.`);
      else if (e.type === 'shuffle') parts.push('Die Ablage wird neu gemischt.');
      else if (e.type === 'skip') parts.push(`${who(e.player)} setzt aus.`);
      else if (e.type === 'pass' && e.kept) parts.push(`${who(e.player)} ${verb(e.player, 'behältst', 'behält')} die gezogene Karte.`);
      else if (e.type === 'empty') parts.push('Keine Karte mehr zum Ziehen da.');
    }
    return parts.join(' ');
  }

  // --- Eingaben: eigene Karte anklicken = legen, Stapel anklicken = ziehen ---
  const onMove = (e) => {
    const ray = room.rayFrom(e);
    const card = myTurn() ? board.pickHand(ray) : null;
    board.setHover(card);
    canvas.style.cursor = card || (myTurn() && !mine.drawn && board.hitTalon(ray)) ? 'pointer' : '';
  };

  const onClick = (e) => {
    if (!myTurn()) return;
    const ray = room.rayFrom(e);
    const card = board.pickHand(ray);
    if (card) return tryPlay(card);
    if (!mine.drawn && board.hitTalon(ray)) act('draw');
  };

  const onKey = (e) => {
    if (e.key === 'Escape' && wishCard) closeWish(null);
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  $('wish').querySelectorAll('button').forEach((b) => paintSuit(b.querySelector('canvas'), b.dataset.suit));
  $('wish').onclick = (e) => {
    const b = e.target.closest('button');
    if (b || e.target === $('wish')) closeWish(b?.dataset.suit ?? null); // Farbe oder daneben = abbrechen
  };
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame(Math.random() < 0.5 ? 0 : 1, Math.random, { free })); // wer anfängt, entscheidet der Zufall

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    stop() {
      board.onPlace = null;
      clearTimeout(timer);
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      $('wish').hidden = true;
      stopFrames();
      board.reset();
    },
  };
}
