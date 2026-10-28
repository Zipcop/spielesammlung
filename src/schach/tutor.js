// „Mit Coach spielen“ (allein): Ablauf am Tisch. Nach jedem eigenen Zug wartet der Coach, bis Stockfish den Zug
// eingestuft hat (analysis.js). Bei Ungenauigkeit, Fehler, Patzer oder verpasstem Gewinn sagt er, was er jetzt
// spielen kann (roter Pfeil) und was besser gewesen wäre (coach.js) – dann „Zug zurücknehmen“ (grüner Pfeil zeigt
// den besseren Zug) oder „Weiterspielen“ (er spielt genau die angekündigte Drohung). Gute Züge lobt er ab und zu.
// Die Sätze kommen aus coach.js, die Stellung hält index.js.
import { explainThreat, explainBetter, praise, warns } from './coach.js';

const WAIT_MS = 12000; // rechnet Stockfish zu lange, zieht der Coach ohne Kommentar
// Pfeile: kind fürs 3D-Brett (board.js LOOK), color fürs 2D-Brett (board2d.js)
const RED = { kind: 'threat', color: '#e0302a' };
const GREEN = { kind: 'better', color: '#2fb34a' };

// me = mein Spieler, solo = Computer-Gegner (createSolo), onChange = neu zeichnen
export function createTutor({ me, solo, onChange }) {
  let pending = null; // { index } – mein Zug, zu dem der Coach noch etwas sagen will
  let say = null; // { text, kind, choice } – Sprechblase; choice = Knöpfe „Zug zurücknehmen“ / „Weiterspielen“
  let arrows = [];
  let threat = null; // Zug, den der Coach bei „Weiterspielen“ spielt
  let retry = null; // nach „Zug zurücknehmen“: { index, say, arrows } bleibt stehen, bis ich neu ziehe
  let since = 3; // eigene Züge seit der letzten Bemerkung (Lob nur ab und zu)
  let praised = 0;
  let timer = null;

  const myMove = (s, i) => (i % 2 === 0) === (s.white === me); // Zug i (0 = erster weißer) ist von mir

  // Nach jedem neuen Stand: soll der Computer warten? (true, solange der Coach meinen Zug noch ansieht)
  function afterCommit(s) {
    clearTimeout(timer);
    const i = s.moves.length - 1;
    if (retry && s.moves.length === retry.index) { // gerade zurückgenommen: grüner Pfeil bleibt bis zum neuen Zug
      ({ say, arrows } = retry);
      retry = null;
      pending = null;
      return false;
    }
    if (s.result || i < 0 || !myMove(s, i)) { // Computer hat gezogen (oder Partie aus): Drohung ist erledigt
      pending = null;
      arrows = [];
      threat = null;
      if (say) say = { ...say, choice: false };
      if (s.result || i < 0) say = null;
      return false;
    }
    pending = { index: i };
    say = null;
    arrows = [];
    threat = null;
    since++;
    const waiting = pending;
    timer = setTimeout(() => {
      if (pending !== waiting) return;
      pending = null;
      solo.release();
      onChange();
    }, WAIT_MS);
    return true;
  }

  // Bei jedem Zeichnen: Ist die Einstufung meines Zugs da? view = analysis.view(), analyst für die Varianten
  function check(view, analyst) {
    if (!pending || view?.last?.index !== pending.index || !view.last.kind) return;
    const { kind } = view.last;
    if (warns(kind)) {
      const cv = analyst.coachView(pending.index);
      if (!cv) return; // Varianten noch nicht da
      const t = cv.reply.length ? explainThreat(cv.fenAfter, cv.reply, cv.replyScore) : null;
      const b = cv.better.length ? explainBetter(cv.fenBefore, cv.better, cv.best, cv.played, t) : null;
      if (t) {
        clearTimeout(timer);
        pending = null;
        since = 0;
        threat = t.uci;
        arrows = [{ uci: t.uci, ...RED }];
        say = { kind, text: [t.text, b?.text].filter(Boolean).join(' '), choice: true, better: b?.uci ?? null };
        return;
      }
    }
    clearTimeout(timer);
    pending = null;
    const p = praise(kind, since, praised);
    if (p) {
      praised++;
      since = 0;
      say = { kind, text: p, choice: false };
    }
    solo.release();
  }

  return {
    afterCommit,
    check,
    view: () => ({ say, arrows }),
    waiting: () => !!pending, // Coach schaut sich meinen Zug gerade an
    // „Zug zurücknehmen“: index.js nimmt den Zug zurück; danach zeigt der grüne Pfeil den besseren Zug
    back(index) {
      const better = say?.better;
      retry = { index, arrows: better ? [{ uci: better, ...GREEN }] : [], say: { kind: null, text: better ? 'Zurückgenommen – versuch es nochmal. Der grüne Pfeil zeigt meinen Vorschlag.' : 'Zurückgenommen – versuch es nochmal.', choice: false } };
    },
    // „Weiterspielen“: der Coach spielt die angekündigte Drohung
    go() {
      if (!threat) return;
      say = say && { ...say, choice: false };
      solo.release(threat);
    },
    stop: () => clearTimeout(timer),
  };
}
