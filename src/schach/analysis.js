// Zuganalyse wie bei chess.com: Stockfish (volle Stärke, die zwei besten Varianten) bewertet jede Stellung;
// daraus werden Abzeichen für jeden Zug (oracle.js), Buchzüge mit Eröffnungsname und Stellungssymbole.
// Live rechnet sie die aktuelle Stellung nebenher, nach der Partie auf Wunsch alle („Partie analysieren“).
// Jeder PC rechnet für sich – übers Netz geht dafür nichts. Nicht für „Ohne Hilfen“ (regelwidrige Stellungen).
import { Chess } from 'chess.js';
import { createEngine } from './engine.js';
import { classify, expected, flip, gameAccuracy, isSacrifice, positionSymbol, turningPoint, winPercent } from './oracle.js';
import { NEGATIVE } from './badges.js';

const GO = 'depth 14';
const LINE = 6; // so viele Halbzüge der besten Fortsetzung zeigt der Rückblick
const key = (fen) => fen.split(' ').slice(0, 2).join(' '); // Figuren + Seite am Zug, wie in openings.json
const sideOf = (fen) => fen.split(' ')[1];
const parse = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

export function createAnalyst({ onChange }) {
  let engine = null; // Stockfish startet erst, wenn wirklich gerechnet wird
  let openings = null; // Stellung → Eröffnungsname ('' = Buch, aber ohne eigenen Namen)
  let waiting = []; // Stellungen, die noch dran sind – live vorn, Rückblick hinten
  let running = null; // Stellung, die Stockfish gerade rechnet (immer nur eine)
  const done = new Map(); // FEN → { best, score, lines } (Bewertung aus Sicht der Seite am Zug)
  const verdicts = new Map(); // fertig eingestufte Züge – ändern sich nicht mehr
  const lineCache = new Map(); // FEN → beste Fortsetzung (aus done, ändert sich also auch nicht)
  let state = null;
  let fens = []; // Stellung nach 0, 1, 2 … Halbzügen
  let stopped = false;

  import('./openings.json').then((m) => {
    openings = m.default;
    if (!stopped) onChange();
  });

  // urgent = live: vor den Rückblick, damit eine lange Analyse die laufende Partie nicht aufhält
  function analyse(fen, urgent = false) {
    if (stopped || done.has(fen) || fen === running) return;
    if (waiting.includes(fen)) {
      if (!urgent) return;
      waiting = waiting.filter((f) => f !== fen);
    }
    if (urgent) waiting.unshift(fen);
    else waiting.push(fen);
    pump();
  }

  function pump() {
    if (running || stopped || !waiting.length) return;
    running = waiting.shift();
    engine ??= createEngine({ MultiPV: 2 });
    engine.analyse(running, GO).then((r) => {
      done.set(running, r);
      running = null;
      if (stopped) return;
      pump();
      onChange();
    });
  }

  // Letzte Stellung einer beendeten Partie: dort rechnet Stockfish nicht (Matt, Patt, Remis-Regel)
  const terminal = (k) => k === fens.length - 1 && !!state.result && state.result.reason !== 'aufgabe';

  // Bewertung der Stellung nach k Halbzügen aus Sicht von color ('w'/'b') – oder null (noch nicht gerechnet)
  function scoreAt(k, color) {
    const toMove = sideOf(fens[k]);
    if (terminal(k)) {
      if (state.result.reason !== 'matt') return { cp: 0 };
      return color === toMove ? { mate: 0 } : { mate: 1 }; // wer am Zug ist, ist matt
    }
    const score = done.get(fens[k])?.score;
    if (!score) return null;
    return color === toMove ? score : flip(score);
  }

  // Einstufung von Zug Nummer i (Index in der Zugliste) – oder null, solange noch gerechnet wird
  function verdict(i) {
    const fen = fens[i];
    const uci = state.moves[i];
    const id = `${fens[i - 1] ?? ''} ${fen} ${uci} ${terminal(i + 1) ? state.result.reason : ''}`; // Stellung davor: Geschenk, Zurückschlagen
    if (verdicts.has(id)) return verdicts.get(id);
    const a = done.get(fen);
    const color = sideOf(fen);
    const after = scoreAt(i + 1, color);
    const beforeGift = i > 0 ? scoreAt(i - 1, color) : null; // vor dem letzten Zug des Gegners
    if (!openings || !a?.score || !after || (i > 0 && !beforeGift)) return null;
    const last = state.moves[i - 1];
    const v = classify({
      before: a.score,
      after,
      second: a.lines[1]?.score ?? null,
      best: uci === a.best,
      book: openings[key(fens[i + 1])] !== undefined,
      get sacrifice() { // teuer – classify fragt nur bei fast bestem Zug in guter Stellung
        return isSacrifice(fen, uci);
      },
      recapture: !!last && last.slice(2, 4) === uci.slice(2, 4) && !!new Chess(fens[i - 1]).get(last.slice(2, 4)),
      gift: beforeGift ? expected(a.score) - expected(beforeGift) : 0,
      beforeGift: beforeGift ? expected(beforeGift) : 0.5,
    });
    verdicts.set(id, v);
    return v;
  }

  // Was Stockfish an Stelle von Zug i vorgeschlagen hätte: beste Fortsetzung [{ uci, san }, …] oder null
  function line(i) {
    if (lineCache.has(fens[i])) return lineCache.get(fens[i]);
    const a = done.get(fens[i]);
    if (!a?.best) return null;
    const pv = a.lines[0]?.pv[0] === a.best ? a.lines[0].pv : [a.best];
    const chess = new Chess(fens[i]);
    const out = [];
    for (const uci of pv.slice(0, LINE)) {
      try {
        out.push({ uci, san: chess.move(parse(uci)).san });
      } catch {
        break; // sollte nicht vorkommen – dann nur der gültige Anfang
      }
    }
    lineCache.set(fens[i], out.length ? out : null);
    return lineCache.get(fens[i]);
  }
  const better = (i) => line(i)?.[0].san ?? null; // nur der erste Zug, Kurzschrift wie 'Nf3'

  return {
    // Neuer Spielstand. live = aktuelle Stellung gleich rechnen (dazu die drei davor, falls die
    // Live-Bewertung gerade erst eingeschaltet wurde – die braucht man für die Einstufung meines letzten Zugs).
    // Stellungen einer früheren Partie fliegen aus der Warteschlange.
    update(s, live) {
      state = s;
      const chess = new Chess();
      fens = [chess.fen()];
      for (const m of s.moves) {
        chess.move(parse(m));
        fens.push(chess.fen());
      }
      waiting = waiting.filter((f) => fens.includes(f));
      if (!live) return;
      for (let k = Math.max(0, fens.length - 4); k < fens.length; k++) if (!terminal(k)) analyse(fens[k], true); // die letzte kommt zuerst dran
    },
    // Rückblick: alle Stellungen der Partie rechnen (der Reihe nach)
    analyseAll() {
      fens.forEach((fen, k) => terminal(k) || analyse(fen));
    },
    // mine = meine Farbe ('w'/'b'); all = alle Züge einstufen (Rückblick), sonst nur meine
    view(mine, all) {
      const mover = (i) => sideOf(fens[i]);
      const verdictsNow = state.moves.map((_, i) => (all || mover(i) === mine ? verdict(i) : null));
      const named = openings ? fens.map((f) => openings[key(f)]).filter(Boolean) : [];
      const lastMine = state.moves.findLastIndex((_, i) => mover(i) === mine);
      const counted = fens.filter((f, k) => !terminal(k));
      const lines = verdictsNow.map((v, i) => (v ? line(i) : null)); // beste Variante je eingestuftem Zug
      const white = fens.map((_, k) => scoreAt(k, 'w')); // Bewertung aus Sicht von Weiß
      const wins = white.map((sc) => (sc ? winPercent(sc) : null));
      return {
        mine,
        verdicts: verdictsNow,
        arrows: lines.map((l, i) => (l && l[0].uci !== state.moves[i] ? l[0].uci : null)), // Stockfishs Zug als Pfeil, wenn anders gespielt
        lines, // beste Variante zum Anzeigen und Vorspielen
        evals: white, // Bewertung je Stellung aus Sicht von Weiß ({ cp } / { mate }) oder null
        curve: fens.map((_, k) => scoreAt(k, mine)).map((sc) => (sc ? winPercent(sc) : null)), // meine Gewinnchance
        symbols: white.map((sc) => (sc ? positionSymbol(sc) : null)),
        accuracy: gameAccuracy(wins), // { w, b } in %
        turning: turningPoint(wins, verdictsNow, mine),
        opening: named.at(-1) ?? '',
        last: lastMine >= 0 ? { index: lastMine, kind: verdictsNow[lastMine], better: NEGATIVE.has(verdictsNow[lastMine]) ? better(lastMine) : null } : null,
        hint: !state.result && sideOf(state.fen) === mine ? done.get(state.fen)?.best ?? null : null,
        progress: { done: counted.filter((f) => done.has(f)).length, total: counted.length },
      };
    },
    // Für den Coach (coach.js), Zug i: Stellung davor und danach, Stockfishs beste Variante davor (better) samt Bewertung
    // aus Sicht des Ziehenden (best), seine Bewertung nach dem Zug (played) und die beste Antwort danach (reply, Bewertung
    // replyScore aus Sicht des Antwortenden) – Züge als UCI. null, solange eine der beiden Stellungen nicht gerechnet ist.
    coachView(i) {
      const [before, after] = [done.get(fens[i]), done.get(fens[i + 1])];
      if (!before?.score || !after?.score) return null;
      // die volle Variante, nicht nur die LINE Halbzüge der Anzeige: coach.js zählt Material erst an einer ruhigen Stelle
      const pv = (a) => (a.lines[0]?.pv[0] === a.best ? a.lines[0].pv : [a.best]);
      // second = zweitbester Zug davor samt Bewertung (für „Meine Fehler“, lernen.js: fast gleich gut zählt auch)
      const second = before.lines[1]?.pv[0] ? { uci: before.lines[1].pv[0], score: before.lines[1].score } : null;
      return { fenBefore: fens[i], fenAfter: fens[i + 1], better: pv(before), best: before.score, played: flip(after.score), reply: pv(after), replyScore: after.score, second };
    },
    stop() {
      stopped = true;
      waiting = [];
      engine?.stop();
    },
  };
}
