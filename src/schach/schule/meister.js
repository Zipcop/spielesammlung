// Schach-Schule, Meisterpartien „Zug raten“ – reine Logik ohne Anzeige. Berühmte alte Partien (alle vor 1950, nur die
// Zugfolge – Züge sind Fakten, keine fremden Kommentare). Abgeglichen mit den englischen Wikipedia-Artikeln (source).
// Du spielst die Seite des Siegers und rätst ab Halbzug from jeden seiner Züge; danach steht der echte Zug auf dem Brett.
// Punkte (eigene Festlegung zur Bestätigung): Meisterzug oder gleich gut = 10. Sonst nach verlorenen erwarteten Punkten
// gegenüber dem Meisterzug (Stockfish, Sicht des Ziehenden, Kurve wie oracle.js expected) mit den Grenzen der
// Zugeinstufung von chess.com: bis 0,02 → 10, bis 0,05 → 7, bis 0,10 → 4, bis 0,20 → 2, darüber 0.
import { Chess } from 'chess.js';
import { expected } from '../oracle.js';

export const MAX_POINTS = 10;

export const MASTER_GAMES = [
  {
    id: 'oper',
    title: 'Opernpartie',
    white: 'Paul Morphy',
    black: 'Herzog Karl von Braunschweig und Graf Isouard',
    where: 'Paris 1858',
    side: 'w',
    from: 6,
    moves: 'e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#',
    source: 'en.wikipedia.org/wiki/Opera_Game',
  },
  {
    id: 'unsterblich',
    title: 'Die Unsterbliche Partie',
    white: 'Adolf Anderssen',
    black: 'Lionel Kieseritzky',
    where: 'London 1851',
    side: 'w',
    from: 8,
    moves: 'e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 Qf6+ Nxf6 Be7#',
    source: 'en.wikipedia.org/wiki/Immortal_Game',
  },
  {
    id: 'immergruen',
    title: 'Die Immergrüne Partie',
    white: 'Adolf Anderssen',
    black: 'Jean Dufresne',
    where: 'Berlin 1852',
    side: 'w',
    from: 6,
    moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 Qxb5 Rb8 Qa4 Bb6 Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7#',
    source: 'en.wikipedia.org/wiki/Evergreen_Game',
  },
  {
    id: 'rubinstein',
    title: 'Rubinsteins Unsterbliche',
    white: 'Georg Rotlewi',
    black: 'Akiba Rubinstein',
    where: 'Łódź 1907',
    side: 'b',
    from: 9,
    moves: 'd4 d5 Nf3 e6 e3 c5 c4 Nc6 Nc3 Nf6 dxc5 Bxc5 a3 a6 b4 Bd6 Bb2 O-O Qd2 Qe7 Bd3 dxc4 Bxc4 b5 Bd3 Rd8 Qe2 Bb7 O-O Ne5 Nxe5 Bxe5 f4 Bc7 e4 Rac8 e5 Bb6+ Kh1 Ng4 Be4 Qh4 g3 Rxc3 gxh4 Rd2 Qxd2 Bxe4+ Qg2 Rh3',
    source: 'en.wikipedia.org/wiki/Rotlewi_versus_Rubinstein',
  },
  {
    id: 'lasker',
    title: 'Königsjagd',
    white: 'Edward Lasker',
    black: 'George Alan Thomas',
    where: 'London 1912',
    side: 'w',
    from: 8,
    moves: 'd4 e6 Nf3 f5 Nc3 Nf6 Bg5 Be7 Bxf6 Bxf6 e4 fxe4 Nxe4 b6 Ne5 O-O Bd3 Bb7 Qh5 Qe7 Qxh7+ Kxh7 Nxf6+ Kh6 Neg4+ Kg5 h4+ Kf4 g3+ Kf3 Be2+ Kg2 Rh2+ Kg1 Kd2#',
    source: 'en.wikipedia.org/wiki/Edward_Lasker',
  },
  {
    id: 'polnisch',
    title: 'Die Polnische Unsterbliche',
    white: 'Glücksberg',
    black: 'Miguel Najdorf',
    where: 'Warschau 1929',
    side: 'b',
    from: 9,
    moves: 'd4 f5 c4 Nf6 Nc3 e6 Nf3 d5 e3 c6 Bd3 Bd6 O-O O-O Ne2 Nbd7 Ng5 Bxh2+ Kh1 Ng4 f4 Qe8 g3 Qh5 Kg2 Bg1 Nxg1 Qh2+ Kf3 e5 dxe5 Ndxe5+ fxe5 Nxe5+ Kf4 Ng6+ Kf3 f4 exf4 Bg4+ Kxg4 Ne5+ fxe5 h5#',
    source: 'en.wikipedia.org/wiki/Polish_Immortal',
  },
  {
    id: 'peru',
    title: 'Die Peruanische Unsterbliche',
    white: 'Esteban Canal',
    black: 'unbekannt',
    where: 'Budapest 1934',
    side: 'w',
    from: 6,
    moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 c6 Nf3 Bg4 Bf4 e6 h3 Bxf3 Qxf3 Bb4 Be2 Nd7 a3 O-O-O axb4 Qxa1+ Kd2 Qxh1 Qxc6+ bxc6 Ba6#',
    source: 'en.wikipedia.org/wiki/Peruvian_Immortal',
  },
];

export const movesOf = (g) => g.moves.split(' ');

// Ist Halbzug ply ein Zug, den du rätst?
export const isGuess = (g, ply) => ply >= g.from && (ply % 2 === 0) === (g.side === 'w');

// Zahl der Rateaufgaben einer Partie (für die Höchstpunktzahl)
export const guessCount = (g) => movesOf(g).filter((_, i) => isGuess(g, i)).length;

// Punkte für deinen Zug: same = genau der Meisterzug; master / mine = Stockfish-Bewertung nach dem Meisterzug bzw.
// nach deinem Zug, beide aus Sicht des Ziehenden ({ cp } / { mate })
export function guessPoints({ same, master, mine }) {
  if (same) return MAX_POINTS;
  const loss = expected(master) - expected(mine);
  return loss <= 0.02 ? 10 : loss <= 0.05 ? 7 : loss <= 0.1 ? 4 : loss <= 0.2 ? 2 : 0;
}

// Stellung (FEN) nach ply Halbzügen und der echte Zug dort als { uci, san }
export function stepAt(g, ply) {
  const chess = new Chess();
  const line = movesOf(g);
  for (const san of line.slice(0, ply)) chess.move(san);
  const fen = chess.fen();
  const m = line[ply] ? chess.move(line[ply]) : null;
  return { fen, move: m ? { uci: m.lan, san: m.san } : null };
}

// Bestwerte je Partie: best = { [id]: Punkte } → neue Bestwerte und ob es ein neuer Rekord ist
export function recordGame(best, id, points) {
  const old = best?.[id] ?? 0;
  return { best: { ...best, [id]: Math.max(old, points) }, record: points > old };
}
