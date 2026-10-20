// Computer fürs Kartenduell: sieht nur seine Sicht (viewFor) und macht je Aufruf eine Aktion.
// Idee: jede erlaubte Aktion (moves) einmal durchspielen und den Stand danach bewerten – LP, Monster auf dem Feld
// (mit Gefahr durch stärkere Gegner-Monster), Handkarten, gesetzte Karten. Verdeckte Gegner-Monster schätzt er wie
// eine Karte mit DEF 1500, auf verdeckte Fallen reagiert der Gegner in seiner Rechnung nicht. Ist nichts besser als
// jetzt, geht er weiter: Haupt 1 → Kampf → Haupt 2 → Ende.
import { moves, apply, atkOf, defOf, cardOf, pass, LP_START } from './game.js';
import { CARD, tributesFor } from './cards.js';

const GUESS = 'w02'; // so stellt er sich ein verdecktes Monster vor (500/1500)
const HAND = 260;
const SET = 180;

// Stand für die Rechnung: Unbekanntes durch eine Schätzung ersetzt
function guessed(v, seat) {
  const cards = { ...v.cards };
  for (const m of v.mon[1 - seat]) if (m && !cards[m.u]) cards[m.u] = GUESS;
  return { ...v, cards, free: false };
}

// Bewertung aus Sicht von seat (je höher, desto besser)
export function score(s, seat) {
  const opp = 1 - seat;
  if (s.phase === 'over') return s.winner === seat ? 1e6 : s.winner === null ? 0 : -1e6;
  let v = s.lp[seat] - s.lp[opp] * 1.1 + Math.min(s.lp[seat], 2000) * 0.5; // wenig LP sind gefährlich
  const threat = (p) => Math.max(0, ...s.mon[p].filter((m) => m?.up && m.pos === 'atk').map((m) => atkOf(s, m.u)));
  for (const p of [seat, opp]) {
    const sign = p === seat ? 1 : -1;
    const danger = threat(1 - p);
    for (const m of s.mon[p]) {
      if (!m) continue;
      const atk = atkOf(s, m.u);
      const def = defOf(s, m.u);
      let worth = 350 + Math.max(atk, def * 0.8) * 0.7;
      if (m.pos === 'atk' && danger > atk) worth -= Math.min(worth, 200 + (danger - atk) * 0.6); // wird wohl zerstört
      if (m.pos === 'def' && danger > def) worth *= 0.6;
      v += sign * worth;
    }
    v += sign * s.st[p].filter((x) => x && !x.up).length * SET;
    v += sign * s.st[p].filter((x) => x?.up).length * 120;
    if (s.field[p]) v += sign * 100;
    v += sign * s.hand[p].length * HAND;
  }
  return v;
}

// Gegner reagiert in der Rechnung nicht (seine verdeckten Karten kennt man ja nicht)
function settle(s, seat) {
  return s?.pending?.type === 'react' && s.pending.who !== seat ? pass(s, s.pending.who) ?? s : s;
}

// Nächste Aktion als { t, … } (wie game.js apply)
export function chooseMove(v, seat) {
  if (v.pending?.who === seat && v.pending.type === 'discard') return best(v, seat, moves(v, seat)).m;
  if (v.free && v.turn === seat && !v.pending && v.drawn < (v.turnNo === 1 ? 0 : 1) && v.deck[seat].length) return { t: 'draw' };
  const all = moves(v, seat);
  if (v.pending?.who === seat) return best(v, seat, all).m; // Reaktion: Falle oder nicht
  const step = (to) => ({ t: 'step', to });
  const actions = all.filter((m) => m.t !== 'step');
  const g = guessed(v, seat);
  const now = score(g, seat);
  const b = actions.length ? best(v, seat, actions) : null;
  const need = v.step === 'battle' ? 0 : 60;
  if (b && b.value > now + need) return b.m;
  if (v.step === 'main1') return all.some((m) => m.t === 'step' && m.to === 'battle') && hasAttacker(v, seat) && v.turnNo > 1 ? step('battle') : step('end');
  if (v.step === 'battle') return step('main2');
  return step('end');
}

const hasAttacker = (v, seat) => v.mon[seat].some((m) => m?.up && m.pos === 'atk');

function best(v, seat, list) {
  const g = guessed(v, seat);
  let top = null;
  for (const m of list) {
    const next = settle(apply(g, seat, m), seat);
    if (!next) continue;
    const value = score(next, seat) + bonus(g, seat, m);
    if (!top || value > top.value) top = { m, value };
  }
  return top ?? { m: list[0], value: -Infinity };
}

// Kleine Vorlieben, die die Bewertung nicht sieht
function bonus(s, seat, m) {
  const c = cardOf(s, m.u);
  if (m.t === 'pass') return 0;
  if (m.t === 'summon' && m.set && c?.fx?.on === 'flip') return 150; // Flip-Monster lieber verdeckt
  if (m.t === 'activate' && c?.sub === 'normal' && c.fx.op === 'heal' && s.lp[seat] > LP_START - 1000) return -900; // nicht verschwenden
  if (m.t === 'set' && c?.kind === 'spell' && c.sub === 'normal') return -150; // Zauber lieber gleich nutzen
  return 0;
}

// Ohne Hilfen (allein): ein Schummelzug – oder null, wenn sich gerade keiner anbietet.
// Möglich: Monster ab Stufe 5 ohne Tribute, zweite Normalbeschwörung, zweiter Angriff, eine Karte zu viel ziehen.
export function cheatMove(v, seat, rng = Math.random) {
  if (v.phase !== 'duel' || v.turn !== seat || v.pending) return null;
  const options = [];
  const free = v.mon[seat].includes(null);
  const monsters = v.hand[seat].filter((u) => CARD[v.cards[u]]?.kind === 'monster');
  if ((v.step === 'main1' || v.step === 'main2') && free) {
    const big = monsters.filter((u) => tributesFor(CARD[v.cards[u]].level) > 0 && !v.summoned).sort((a, b) => CARD[v.cards[b]].atk - CARD[v.cards[a]].atk)[0];
    if (big !== undefined) options.push({ t: 'summon', u: big, set: false, tributes: [] });
    const small = monsters.filter((u) => tributesFor(CARD[v.cards[u]].level) === 0).sort((a, b) => CARD[v.cards[b]].atk - CARD[v.cards[a]].atk)[0];
    if (v.summoned && small !== undefined) options.push({ t: 'summon', u: small, set: false, tributes: [] });
  }
  if (v.step === 'main1' && v.drawn >= (v.turnNo === 1 ? 0 : 1) && v.deck[seat].length > 5) options.push({ t: 'draw' });
  if (v.step === 'battle') {
    const again = v.mon[seat].find((m) => m?.up && m.pos === 'atk' && m.attacked === v.turnNo);
    const opp = v.mon[1 - seat].filter(Boolean);
    if (again && !opp.length) options.push({ t: 'attack', u: again.u, target: null });
    else if (again) {
      const weak = opp.find((o) => o.up && o.pos === 'atk' && atkOf(v, o.u) < atkOf(v, again.u));
      if (weak) options.push({ t: 'attack', u: again.u, target: weak.u });
    }
  }
  return options.length ? options[Math.floor(rng() * options.length)] : null;
}
