// Ergebnis einer Partie zu zweit aus dem Spielstand lesen – für die Statistik (stats.js, main.js).
// Je Spiel: undefined = läuft noch, 0 = Host gewinnt, 1 = Gast gewinnt, null = Remis.
// Bei Spielen mit Computer-Mitspielern zählt, wer von den beiden Menschen besser abgeschnitten hat.
// Neues Spiel (z. B. Elfer raus, Poker): hier eine Zeile mit dem Spielnamen aus games.js eintragen – sonst zählt es nicht.
// Rein (kein DOM), damit es sich mit node --test prüfen lässt.
import { winner as kniffelWinner } from './kniffel/game.js';
import { NOBODY } from './romme/game.js';

const byResult = (s) => (s.result ? s.result.winner : undefined); // result = { winner: 0 | 1 | null } oder null
const byWinner = (s) => (s.winner === null ? undefined : s.winner); // winner = 0 | 1 oder null (läuft)
// Wer von beiden besser ist: kleinerer Rang gewinnt, gleich = Remis
const better = (host, guest) => (host === guest ? null : host < guest ? 0 : 1);
const rank = (list, seat) => (list.includes(seat) ? list.indexOf(seat) : Infinity);

export const OUTCOME = {
  Kniffel: (s) => (s.over ? kniffelWinner(s) : undefined),
  Schach: byResult,
  'Mau-Mau': byWinner,
  Billard: byWinner,
  // Wer früher alle Figuren im Ziel hatte (Host sitzt auf Sitz 0, der Gast auf humans[1])
  'Mensch ärgere dich nicht': (s) => (s.phase === 'over' ? better(rank(s.places, 0), rank(s.places, s.humans[1])) : undefined),
  // Je Runde; NOBODY = Stapel leer bei gleich vielen Restpunkten
  Rommé: (s) => (s.winner === null ? undefined : s.winner === NOBODY ? null : s.winner),
  // Je Spiel: mehr Spielpunkte (Host Sitz 0, Gast Sitz 2) – in derselben Partei gleich viele = Remis
  Doppelkopf: (s) => (s.phase === 'over' && s.result ? better(-s.result.points[0], -s.result.points[2]) : undefined),
  'Vier gewinnt': byResult,
  Reversi: byResult,
  Mühle: byResult,
  Dame: byResult,
  // Wer länger im Spiel blieb (Host Sitz 0, Gast Sitz 2): noch dabei vor später ausgeschieden vor früher ausgeschieden.
  // Keiner mehr übrig (alle Leben weg): der Letzte flog durch eine Anklage nach dem Ende raus (erwischt oder Fehlalarm) –
  // er zählt als Erster raus. (Nur noch Computer übrig ist auch winner null, aber da bleibt die Reihenfolge.)
  Mäxchen: (s) => {
    if (s.phase !== 'over') return undefined;
    const out = s.lives.every((x) => x === 0) && s.out.length ? [s.out.at(-1), ...s.out.slice(0, -1)] : s.out;
    return better(-rank(out, 0), -rank(out, 2));
  },
  // Je Runde: wer raus ist gewinnt; sonst weniger Restpunkte (Host Sitz 0, Gast humans[1])
  'Elfer raus': (s) => {
    if (s.phase !== 'over' || !s.result) return undefined;
    const guest = s.humans[1];
    if (s.result.winner === 0) return 0;
    if (s.result.winner === guest) return 1;
    return better(s.result.points[0], s.result.points[guest]);
  },
  // Je Hand, nur wenn einer der beiden etwas gewonnen hat: mehr Gewinn = Sieg, gleich viel (geteilter Pot) = Remis
  "Texas Hold'em": (s) => {
    if (s.phase !== 'done') return undefined;
    const [host, guest] = [s.payout[0], s.payout[s.humans[1]]];
    return host > 0 || guest > 0 ? better(-host, -guest) : undefined;
  },
};

// Kam der Stand von einem erwischten Schummelzug? Dann ist ein Spielende zurückgenommen, die Runde läuft weiter.
export const reverted = (s) => s.verdict?.caught === true || (Array.isArray(s.events) && s.events.some((e) => e?.type === 'caught'));
