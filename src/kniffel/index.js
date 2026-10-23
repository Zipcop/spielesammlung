// Kniffel-Partie: verbindet Spielstand (game.js), 3D-Brett (board.js), Block (sheet.js) und Netz.
// Der Host hält den Spielstand und schickt ihn nach jeder Änderung komplett an den Gast.
// Der Gast schickt nur Wünsche (behalten, eintragen, Wurf-Ergebnis) – der Host prüft sie.
// free = „Ohne Hilfen“: Punkte selbst eintippen, beliebig oft würfeln, „Geschummelt!“-Knopf.
import { newGame, canRoll, canHold, toggleHold, applyRoll, scoreField, accuse, scores, winner, ROLLS_PER_TURN, FALSE_ALARM_POINTS } from './game.js';
import { LABELS } from './rules.js';
import { createSheet } from './sheet.js';
import { createCheatUI } from '../cheat-ui.js';
import { rematchBlocked } from '../schummeln.js';
import { seatLabels } from '../plates.js';

const $ = (id) => document.getElementById(id);

// Was der Gast sehen darf: ob der letzte Eintrag gestimmt hat, muss er selbst merken
const forGuest = (s) => ({ ...s, cheat: s.cheat && { player: s.cheat.player, field: s.cheat.field } });

export function startKniffel({ room, board, canvas, me, send, onLeave, names, free = false, resume, save }) {
  const isHost = me === 0;
  let state = null;
  let cheered = false; // Sieg-Konfetti schon gezeigt
  let rolling = false; // meine Würfel rollen gerade
  let waiting = false; // Gast: Wunsch geschickt, Antwort vom Host steht aus
  let claiming = false; // ohne Hilfen: ich tippe gerade Punkte ein

  const sheet = createSheet($('sheet'), { me, onPick: pick });
  const cheat = createCheatUI({ onAccuse: () => act('accuse'), hint: document.querySelector('[data-game="Kniffel"] [data-hint]') });

  function pick(field) {
    if (!state.free) return act('score', field);
    if (claiming) return;
    claiming = true;
    sheet.askClaim(field, (claim, extra) => {
      claiming = false;
      if (claim === null) render();
      else act('score', { field, claim, extra }); // extra = Zusatz-Kniffel selbst angesagt – der Host prüft: nur true/false
    });
  }

  function apply(type, player, arg) {
    if (type === 'hold') return toggleHold(state, player, arg);
    if (type === 'score') return typeof arg === 'object' && arg ? scoreField(state, player, arg.field, arg.claim, arg.extra) : scoreField(state, player, arg);
    if (type === 'roll') return applyRoll(state, player, arg);
    if (type === 'accuse') return accuse(state, player);
    if (type === 'again') return state.over && !rematchBlocked(state, player) ? newGame(1 - state.starter, { free: state.free }) : null; // abwechselnd anfangen
    return null;
  }

  function commit(next) {
    state = next;
    send({ t: 'state', state: forGuest(state) });
    save?.(state); // zu zweit: Host merkt sich die Partie (saves.js)
    render();
  }

  // Eigene Aktion: Host wendet sie direkt an, Gast fragt beim Host an
  function act(type, arg) {
    if (!state || rolling || waiting) return;
    if (isHost) {
      const next = apply(type, me, arg);
      if (next) commit(next);
    } else {
      waiting = true;
      send({ t: type, arg });
      render();
    }
  }

  // how: 'cup' = Becher mit gedrückter linker Maustaste selbst schütteln, Loslassen kippt aus ·
  // 'hand' = die freien Würfel als Handvoll (gepackt bei Würfel from), Loslassen wirft · sonst schüttelt der Becher allein
  async function roll(how = null, from = -1) {
    if (!state || rolling || waiting || !canRoll(state, me)) return;
    rolling = true;
    render();
    const values = await (how === 'cup' ? board.grab(state.held, me) : how === 'hand' ? board.grabHand(state.held, me, from) : board.roll(state.held, me));
    rolling = false;
    if (values) act('roll', values);
    render();
  }

  function handle(msg) {
    if (msg.t === 'dice') return board.applyRemote(msg);
    if (!isHost && msg.t === 'state') {
      state = msg.state;
      waiting = false;
      return render();
    }
    if (isHost && state) {
      const next = apply(msg.t, 1 - me, msg.arg);
      if (next) commit(next);
      else send({ t: 'state', state: forGuest(state) }); // ungültig → Gast bekommt den aktuellen Stand zurück
    }
  }

  function render() {
    if (!waiting) board.sync(state); // Gast: bis zur Antwort des Hosts nicht auf den alten Stand zurückspringen
    if (!state) return;
    const mine = state.turn === me;
    const busy = rolling || waiting;
    const other = names.other();
    board.names(seatLabels(2, { mySeat: me, humans: [0, 1], me: names.me(), other }), state.over ? null : state.turn, me);
    if (!claiming) sheet.render(state, mine && !busy && state.rolls > 0, me === 0 ? [names.me(), other] : [other, names.me()]);

    const of = state.free ? '' : ` von ${ROLLS_PER_TURN}`; // ohne Hilfen zählt niemand mit
    $('status').textContent = state.over ? 'Spiel vorbei'
      : rolling ? 'Die Würfel rollen …'
      : mine ? (state.rolls === 0 ? 'Du bist dran – Becher greifen und schütteln, Würfel packen und werfen oder „Würfeln“'
        : state.free ? 'Würfel behalten, weiterwürfeln oder Feld wählen und Punkte eintippen'
          : state.rolls < ROLLS_PER_TURN ? `Wurf ${state.rolls}${of}: Würfel behalten oder Feld wählen`
            : 'Letzter Wurf – trag ein Feld ein')
        : state.rolls === 0 ? `${other} ist dran …` : state.free ? `${other} würfelt …` : `${other} würfelt (Wurf ${state.rolls}${of})`;
    $('roll').disabled = busy || !canRoll(state, me);
    $('roll').textContent = state.free ? 'Würfeln' : `Würfeln · noch ${ROLLS_PER_TURN - state.rolls}`;
    $('roll').hidden = !mine || state.over;

    cheat.update({ free: state.free, canAccuse: !!state.cheat && state.cheat.player !== me && !busy });
    const v = state.verdict;
    if (v) {
      const who = v.player === me ? 'Du' : other;
      const filled = state.cards.reduce((n, c) => n + Object.keys(c).length, 0); // unterscheidet gleiche Meldungen in verschiedenen Runden
      cheat.say(`${filled}:${JSON.stringify(v)}`, v.caught
        ? `Erwischt! ${v.player === me ? 'Du hast' : `${other} hat`} geschummelt${v.why ? `: ${v.why}` : ''} – ${LABELS[v.field]} wird mit 0 gestrichen${v.extra ? ', der Zusatz-Kniffel fällt weg' : ''}.`
        : `Fehlalarm! ${who} ${v.player === me ? 'bekommst' : 'bekommt'} ${FALSE_ALARM_POINTS} Minuspunkte.`, v.caught);
    }

    $('result').hidden = !state.over;
    if (state.over) {
      const [a, b] = [scores(state)[me], scores(state)[1 - me]];
      const w = winner(state);
      $('result-title').textContent = w === null ? 'Unentschieden!' : w === me ? 'Du gewinnst!' : `${other} gewinnt`;
      $('result-score').textContent = `${a} : ${b}`;
    }
    const won = state.over && winner(state) === me;
    if (won && !cheered) room.celebrate(me);
    cheered = won;
  }

  // --- Eingaben ---
  function dieUnder(e) {
    return state && !rolling && !waiting && canHold(state, me) ? board.pickDie(room.rayFrom(e)) : -1;
  }
  let grabbing = false; // Becher oder Handvoll hängt gerade an der Maus
  let pressed = null; // freier Würfel gedrückt: { i, x, y } – Klick = behalten, Ziehen = Handvoll
  let handled = false; // das Drücken wurde zur Handvoll – der Klick danach behält keinen Würfel
  const DRAG_PX = 18;
  const canGrab = () => state && !rolling && !waiting && canRoll(state, me);
  const freeDie = (e) => {
    const i = canGrab() ? board.pickDie(room.rayFrom(e)) : -1;
    return i >= 0 && !state.held[i] ? i : -1;
  };
  const onMove = (e) => {
    if (pressed && !grabbing && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > DRAG_PX) {
      grabbing = handled = true; // gezogen: alle freien Würfel in die Hand
      canvas.style.cursor = 'grabbing';
      roll('hand', pressed.i);
    }
    if (grabbing) return board.dragCup(room.rayFrom(e));
    const i = dieUnder(e);
    board.setHover(i);
    const cup = i < 0 && canGrab() && board.hitCup(room.rayFrom(e));
    canvas.style.cursor = i >= 0 ? 'pointer' : cup || freeDie(e) >= 0 ? 'grab' : '';
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    handled = false;
    if (!canGrab()) return;
    if (board.hitCup(room.rayFrom(e))) {
      e.preventDefault(); // Becher gehört dem Spiel – sonst würde tisch.js das ganze Brett greifen
      grabbing = true;
      canvas.style.cursor = 'grabbing';
      roll('cup');
      board.dragCup(room.rayFrom(e));
      return;
    }
    const i = freeDie(e);
    if (i < 0) return;
    e.preventDefault(); // freie Würfel gehören dem Spiel: Klick = behalten, Ziehen = Handvoll werfen
    pressed = { i, x: e.clientX, y: e.clientY };
  };
  const onUp = (e) => {
    if (e.button !== 0) return;
    pressed = null;
    if (!grabbing) return;
    grabbing = false;
    canvas.style.cursor = '';
    board.release();
  };
  const onClick = (e) => {
    if (handled) {
      handled = false;
      return;
    }
    const i = dieUnder(e);
    if (i >= 0) act('hold', i);
  };
  const onKey = (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    roll();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp); // auch wenn die Maus beim Loslassen neben dem Fenster ist
  canvas.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  $('roll').onclick = () => roll();
  $('again').onclick = () => act('again');
  $('to-room').onclick = onLeave;
  const stopFrames = room.onFrame((dt) => board.update(dt));

  if (isHost) commit(resume ?? newGame(Math.random() < 0.5 ? 0 : 1, { free })); // wer anfängt, entscheidet der Zufall

  return {
    handle,
    refresh: render, // z. B. wenn sich ein Name ändert
    stop() {
      cheat.remove();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
      stopFrames();
      board.reset();
    },
  };
}
