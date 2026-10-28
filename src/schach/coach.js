// Coach – was er zu deinem Zug sagt. Reine Regeln ohne Anzeige: Die Sätze entstehen nur aus Fakten der Stellung
// und der Hauptvariante von Stockfish (analysis.js): Schlagen und was, Schach, Matt in n, Gabel/Doppelangriff,
// ungedeckte Figur, Material nach der Variante, Umwandlung, Bewertung. Keine erfundenen Begründungen.
// Text: **Zug** = fett (das Panel macht daraus <b>), Züge in deutscher Kurzschrift (S, L, T, D, K).
// Der Coach spricht als „ich“ (er ist dein Gegner), dich duzt er.
import { Chess } from 'chess.js';
import { NEGATIVE } from './badges.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'Bauer', n: 'Springer', b: 'Läufer', r: 'Turm', q: 'Dame', k: 'König' };
const ACC = { ...NAME, p: 'Bauern' }; // Akkusativ: „deinen Bauern“
const PLURAL = { p: 'Bauern', n: 'Springer', b: 'Läufer', r: 'Türme', q: 'Damen' };
const NUMBER = ['', 'einen', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht'];
const GERMAN = { N: 'S', B: 'L', R: 'T', Q: 'D' };
const SETTLE = 6; // so viele Halbzüge der Variante werden höchstens nachgespielt

export const german = (san) => san.replace(/[NBRQ]/g, (c) => GERMAN[c]);
const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// „deinen Läufer“, „deine Dame“, „meinen Turm“ (Akkusativ) – who = 'dein' | 'mein'
const own = (who, type) => (type === 'q' ? `${who}e Dame` : `${who}en ${ACC[type]}`);
// „Dein Läufer“, „Deine Dame“ (Nominativ, Satzanfang)
const ownNom = (who, type) => (type === 'q' ? `${who}e Dame` : `${who} ${NAME[type]}`);
// „einen Springer“, „eine Dame“
const one = (type) => (type === 'q' ? 'eine Dame' : `einen ${ACC[type]}`);

// Figuren aufzählen: { b: 1, p: 2 } → „deinen Läufer und zwei Bauern“ (König zuerst, dann die wertvollste)
const RANK = { ...VALUE, k: 100 };
function pieces(counts, who) {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).sort(([a], [b]) => RANK[b] - RANK[a])
    .map(([type, n]) => (n === 1 ? (who ? own(who, type) : one(type)) : `${NUMBER[n] ?? n} ${PLURAL[type]}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : parts[0] ?? '';
}

// Bewertung aus deiner Sicht als Text: '+0,3', '−2,8', 'du setzt in 2 matt', 'du wirst in 2 matt'
export function evalText(score) {
  if (score.mate !== undefined) return score.mate > 0 ? `du setzt in ${score.mate} matt` : score.mate < 0 ? `du wirst in ${-score.mate} matt` : 'matt';
  const pawns = (Math.abs(score.cp) / 100).toFixed(1).replace('.', ',');
  return pawns === '0,0' ? '0,0' : `${score.cp > 0 ? '+' : '−'}${pawns}`;
}

// Die Variante nachspielen und auswerten – aus Sicht dessen, der den ersten Zug macht.
// Ergebnis: { san: erster Zug (deutsch), check, mate (erster Zug setzt matt), gain (Material unterm Strich, Bauerneinheiten),
//   won / gave: Figuren, die er unterm Strich gewinnt / hergibt ({ Typ: Anzahl }), promo: Umwandlung (Typ) oder null,
//   unguarded: { type, square } – der erste Zug schlägt eine Figur, die niemand zurückschlagen kann,
//   fork: [Typen], die die gezogene Figur danach gleichzeitig angreift (König oder wertvoller oder ungedeckt) }
// Material zählt bis zur letzten „ruhigen“ Stelle (danach wird nicht gleich geschlagen), höchstens SETTLE Halbzüge.
export function lineFacts(fen, pv) {
  const chess = new Chess(fen);
  const me = chess.turn();
  const moves = [];
  for (const uci of pv.slice(0, SETTLE + 1)) {
    try {
      moves.push(chess.move(parse(uci)));
    } catch {
      break; // passt nicht zur Stellung – nur der gültige Anfang zählt
    }
  }
  if (!moves.length) return null;
  const first = moves[0];
  const shown = moves.slice(0, SETTLE);
  // letzte ruhige Stelle: Halbzug k, nach dem nicht sofort geschlagen wird (oder die Variante endet)
  let settled = shown.length;
  while (settled > 1 && moves[settled]?.captured) settled--;
  if (moves[settled]?.captured && settled === 1 && shown.length > 1) settled = shown.length; // nur Schlagabtausch – alles nehmen
  const won = {};
  const gave = {};
  let promo = null;
  let promoted = 0; // Umwandlung zählt als Material: aus dem Bauern wird die neue Figur
  for (const m of shown.slice(0, settled)) {
    const mine = m.color === me;
    if (m.captured) (mine ? won : gave)[m.captured] = ((mine ? won : gave)[m.captured] ?? 0) + 1;
    if (m.promotion) {
      if (mine) promo ??= m.promotion;
      promoted += (mine ? 1 : -1) * (VALUE[m.promotion] - 1);
    }
  }
  for (const type of Object.keys(won)) { // gleiche Figuren heben sich auf (Tausch)
    const both = Math.min(won[type], gave[type] ?? 0);
    won[type] -= both;
    if (gave[type]) gave[type] -= both;
  }
  const sum = (c) => Object.entries(c).reduce((s, [t, n]) => s + VALUE[t] * n, 0);

  // nach dem ersten Zug: Gabel und ungedeckte Figur
  const after = new Chess(fen);
  after.move(parse(first.lan));
  const them = me === 'w' ? 'b' : 'w';
  let unguarded = null;
  if (first.captured && !first.isEnPassant() && !after.isAttacked(first.to, them)) unguarded = { type: first.captured, square: first.to };
  const fork = [];
  // Gabel nur, wenn die gabelnde Figur stehen bleibt: nicht angegriffen – oder gedeckt und nur von wertvolleren Figuren
  // (oder dem König) angegriffen. Sonst schlägt der andere sie einfach (z. B. dxe5 Sxe5, Df5+ Dxf5 Sxf5).
  const hitBy = after.attackers(first.to, them).map((sq) => after.get(sq).type);
  const safe = !hitBy.length || (after.isAttacked(first.to, me) && hitBy.every((t) => t === 'k' || VALUE[t] > VALUE[first.piece]));
  if (safe && !after.isCheckmate()) {
    for (const p of after.board().flat()) {
      if (!p || p.color !== them) continue;
      if (!after.attackers(p.square, me).includes(first.to)) continue;
      const defended = after.attackers(p.square, them).length > 0;
      if (p.type === 'k' || VALUE[p.type] > VALUE[first.piece] || !defended) fork.push(p.type);
    }
  }
  return {
    san: german(first.san),
    uci: first.lan,
    piece: first.piece,
    check: first.san.includes('+') || first.san.includes('#'),
    mate: first.san.includes('#'),
    gain: sum(won) - sum(gave) + promoted,
    won,
    gave,
    promo,
    unguarded,
    fork: fork.length >= 2 ? fork.sort((a, b) => (b === 'k') - (a === 'k') || VALUE[b] - VALUE[a]) : [],
  };
}

const countOf = (types) => types.reduce((c, t) => ({ ...c, [t]: (c[t] ?? 0) + 1 }), {});
const forkWord = (piece) => (piece === 'n' || piece === 'p' ? 'Gabel' : 'Doppelangriff');

// Was der Coach nach deinem Zug drohen kann. fen = Stellung nach deinem Zug (er ist am Zug), pv = seine beste Variante,
// score = Bewertung aus seiner Sicht. Liefert { text, threat (echte Drohung: Matt, Material, Gabel), uci } oder null.
export function explainThreat(fen, pv, score) {
  const f = lineFacts(fen, pv);
  if (!f) return null;
  const move = `**${f.san}**`;
  if (f.mate) return { text: `Pass auf – nach deinem Zug kann ich jetzt ${move} spielen: Schachmatt!`, threat: true, uci: f.uci };
  if (score?.mate > 0) return { text: `Pass auf – nach deinem Zug kann ich jetzt ${move} spielen und setze dich in ${score.mate} Zügen matt.`, threat: true, uci: f.uci };
  const extra = [];
  if (f.fork.length) extra.push(`Das ist ein${f.piece === 'n' || f.piece === 'p' ? 'e' : ''} ${forkWord(f.piece)}: Mein${f.piece === 'q' ? 'e' : ''} ${NAME[f.piece]} greift ${pieces(countOf(f.fork), 'dein')} gleichzeitig an.`);
  if (f.promo) extra.push(`${f.uci[4] ? 'Dabei' : 'Danach'} wird mein Bauer zu${f.promo === 'q' ? 'r Dame' : `m ${NAME[f.promo]}`}.`);
  const check = f.check ? ' – Schach! –' : ''; // mitten im Satz
  if (f.gain >= 1 && Object.values(f.won).some((n) => n)) {
    const onlyIt = f.unguarded && !Object.keys(f.gave).some((t) => f.gave[t]) && pieces(f.won, 'dein') === own('dein', f.unguarded.type);
    if (onlyIt) {
      return { text: [`Pass auf – ${ownNom('dein', f.unguarded.type)} auf ${f.unguarded.square} ist ungedeckt: Ich kann jetzt ${move} spielen${check} und gewinne ${f.unguarded.type === 'q' ? 'sie' : 'ihn'}.`, ...extra].join(' '), threat: true, uci: f.uci };
    }
    const what = Object.values(f.gave).some((n) => n) ? `Material: ${pieces(f.won, 'dein')} gegen ${pieces(f.gave, 'mein')}` : pieces(f.won, 'dein');
    return { text: [`Pass auf – nach deinem Zug kann ich jetzt ${move} spielen${check} und gewinne ${what}.`, ...extra].join(' '), threat: true, uci: f.uci };
  }
  if (f.fork.length || (f.promo && f.gain >= 1)) return { text: [`Pass auf – nach deinem Zug kann ich jetzt ${move} spielen${f.check ? ' – Schach!' : '.'}`, ...extra].join(' '), threat: true, uci: f.uci };
  const better = score && (score.cp ?? 0) >= 100;
  const view = score ? ` (Stockfish für dich: ${evalText(flip(score))})` : '';
  return better
    ? { text: [`Nach deinem Zug spiele ich ${move}${check} und stehe danach besser${view}.`, ...extra].join(' '), threat: false, uci: f.uci }
    : { text: [`Mein bester Zug darauf wäre ${move}${view}.`, ...extra].join(' '), threat: false, uci: f.uci };
}

const flip = (s) => (s.mate !== undefined ? { mate: -s.mate } : { cp: -s.cp });

// Was besser gewesen wäre. fen = Stellung vor deinem Zug, pv = Stockfishs beste Variante für dich,
// best / played = Bewertung aus deiner Sicht mit dem besten bzw. deinem Zug, threat = explainThreat-Ergebnis (oder null).
export function explainBetter(fen, pv, best, played, threat) {
  const f = lineFacts(fen, pv);
  if (!f) return null;
  const move = `**${f.san}**`;
  const compare = best && played ? ` (Stockfish für dich: ${evalText(best)} statt ${evalText(played)})` : '';
  if (f.mate) return { text: `Besser wäre ${move} gewesen – das ist Schachmatt!`, uci: f.uci };
  if (best?.mate > 0) return { text: `Besser wäre ${move} gewesen – damit setzt du in ${best.mate} Zügen matt.`, uci: f.uci };
  const why = [];
  const won = Object.values(f.won).some((n) => n);
  if (f.gain >= 1 && won) why.push(Object.values(f.gave).some((n) => n) ? `du damit Material gewinnst: ${pieces(f.won, 'mein')} gegen ${pieces(f.gave, 'dein')}` : `du damit ${pieces(f.won, 'mein')} gewinnst`);
  if (f.fork.length) why.push(`dein${f.piece === 'q' ? 'e' : ''} ${NAME[f.piece]} damit ${pieces(countOf(f.fork), 'mein')} gleichzeitig angreift (${forkWord(f.piece)})`);
  if (f.promo) why.push(`dein Bauer damit zu${f.promo === 'q' ? 'r Dame' : `m ${NAME[f.promo]}`} wird`);
  if (why.length) return { text: `Besser wäre ${move} gewesen, weil ${why.join(' und weil ')}${compare}.`, uci: f.uci };
  if (threat?.threat && f.gain >= 0) return { text: `Besser wäre ${move} gewesen – damit verlierst du kein Material${compare}.`, uci: f.uci };
  return { text: `Besser wäre ${move} gewesen${compare}.`, uci: f.uci };
}

// Lob – nur ab und zu: bei Brillant und Großartig immer, beim besten Zug höchstens jeden dritten eigenen Zug.
// since = eigene Züge seit der letzten Bemerkung des Coachs, n = laufende Nummer (wechselt den Satz)
const PRAISE = ['Stark – genau mein Zug!', 'Gut gesehen, das ist der beste Zug.', 'Sehr schön gespielt.', 'Prima, so hätte ich auch gezogen.'];
export function praise(kind, since, n = 0) {
  if (kind === 'brillant') return 'Brillant! Ein Opfer, das sich lohnt – Respekt.';
  if (kind === 'grossartig') return 'Großartig – genau der eine Zug, der hier zählt!';
  if (kind === 'best' && since >= 3) return PRAISE[n % PRAISE.length];
  return null;
}

// Spricht der Coach bei dieser Einstufung mit Tipp und Rückfrage? (Ungenauigkeit, Fehler, Patzer, Verpasster Gewinn)
export const warns = (kind) => NEGATIVE.has(kind);

// „Drohung zeigen“ (index.js): Was der Gegner spielen würde, wenn er gleich nochmal dran wäre – kurz und aus deiner
// Sicht, mit denselben Fakten wie explainThreat. fen = Stellung mit getauschtem Zugrecht (Nullzug, lernen.js),
// pv = seine beste Variante dort, score = Bewertung aus seiner Sicht. Liefert { text, threat, uci } oder null.
export function threatText(fen, pv, score) {
  const f = lineFacts(fen, pv);
  if (!f) return null;
  const move = `**${f.san}**`;
  if (f.mate) return { text: `Droht ${move} – Schachmatt!`, threat: true, uci: f.uci };
  if (score?.mate > 0) return { text: `Droht ${move} – danach setzt er dich in ${score.mate} Zügen matt.`, threat: true, uci: f.uci };
  const extra = [];
  if (f.fork.length) extra.push(`Das wäre ein${f.piece === 'n' || f.piece === 'p' ? 'e' : ''} ${forkWord(f.piece)}: ${ownNom('Sein', f.piece)} greift ${pieces(countOf(f.fork), 'dein')} gleichzeitig an.`);
  if (f.promo) extra.push(`${f.uci[4] ? 'Dabei' : 'Danach'} wird sein Bauer zu${f.promo === 'q' ? 'r Dame' : `m ${NAME[f.promo]}`}.`);
  const check = f.check ? ' – Schach! –' : ''; // mitten im Satz
  if (f.gain >= 1 && Object.values(f.won).some((n) => n)) {
    const gave = Object.values(f.gave).some((n) => n);
    const onlyIt = f.unguarded && !gave && pieces(f.won, 'dein') === own('dein', f.unguarded.type);
    const what = onlyIt ? `${own('dein', f.unguarded.type)} auf ${f.unguarded.square} (ungedeckt)` : gave ? `Material: ${pieces(f.won, 'dein')} gegen ${pieces(f.gave, 'sein')}` : pieces(f.won, 'dein');
    return { text: [`Droht ${move}${check} und gewinnt ${what}.`, ...extra].join(' '), threat: true, uci: f.uci };
  }
  if (f.fork.length || (f.promo && f.gain >= 1)) return { text: [`Droht ${move}${f.check ? ' – Schach!' : '.'}`, ...extra].join(' '), threat: true, uci: f.uci };
  return { text: `Keine akute Drohung – sein bester Zug wäre ${move}${f.check ? ' mit Schach' : ''}.`, threat: false, uci: f.uci };
}
