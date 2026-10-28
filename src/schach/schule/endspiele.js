// Schach-Schule, Endspiel-Training – reine Logik ohne Anzeige. Feste Lehrstellungen (allgemein bekannte Lehrpositionen,
// FEN selbst aufgeschrieben und mit Stockfish 19 geprüft, siehe Übergabe), du spielst gegen Stockfish in voller Stärke.
// Ziele: 'mate' = matt setzen (within = in so vielen eigenen Zügen), 'promote' = Bauer umwandeln und den Gewinn behalten,
// 'draw' = Remis halten (moves eigene Züge lang oder bis die Partie remis endet).
// Eigene Festlegungen (zur Bestätigung): Gewinn verspielt, wenn Stockfish nach deinem Zug weniger als +1,5 für dich sieht;
// Remis verspielt bei −2,5 oder schlechter; jedes Ziel hat eine Zuggrenze (limit), damit keine Stellung endlos läuft.
import { Chess } from 'chess.js';

export const WIN_MIN = 150; // so viel (Hundertstel Bauern) muss nach deinem Zug noch für dich stehen
export const DRAW_MIN = -250; // ab hier ist das Remis verloren

export const ENDGAMES = [
  {
    id: 'dame',
    title: 'Dame gegen König',
    fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1',
    goal: 'mate',
    limit: 20,
    text: 'Treib den König mit der Dame an den Rand: Sie steht einen Springerzug von ihm entfernt und nimmt ihm Feld um Feld. Dann holt dein König zur Hilfe – Vorsicht vor Patt!',
  },
  {
    id: 'turm',
    title: 'Turm gegen König',
    fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    goal: 'mate',
    limit: 30,
    text: 'Der Turm schneidet den König ab, dein König kommt dazu. Stehen sich die Könige gegenüber, gibt der Turm Schach von der Seite – so geht es Reihe für Reihe an den Rand.',
  },
  {
    id: 'dame-matt2',
    title: 'Dame: Matt in 2',
    fen: '7k/8/5K2/8/8/8/8/1Q6 w - - 0 1',
    goal: 'mate',
    within: 2,
    limit: 2,
    text: 'Setz in zwei Zügen matt. Nicht jeder starke Zug ist ein Schach – manchmal sperrt ein ruhiger Zug den König ein.',
  },
  {
    id: 'turm-matt2',
    title: 'Turm: Matt in 2',
    fen: 'k7/8/2K5/8/8/8/8/1R6 w - - 0 1',
    goal: 'mate',
    within: 2,
    limit: 2,
    text: 'Setz in zwei Zügen matt. Erst muss dein König die Fluchtfelder nehmen, dann kommt der Turm.',
  },
  {
    id: 'opposition',
    title: 'Bauer mit Opposition',
    fen: '8/8/3k4/8/3K4/8/3P4/8 w - - 0 1',
    goal: 'promote',
    limit: 25,
    text: 'Bring den Bauern zur Dame. Der König geht vor dem Bauern her. Opposition: Stehen sich die Könige mit einem Feld Abstand gegenüber, muss der am Zug weichen. Ein Bauernzug kann dir den Zug „schenken“.',
  },
  {
    id: 'quadrat',
    title: 'Quadratregel',
    fen: '8/8/8/5k2/P7/8/8/7K w - - 0 1',
    goal: 'promote',
    limit: 8,
    text: 'Zeichne vom Bauern bis zur Umwandlungsreihe ein Quadrat. Kommt der gegnerische König nicht hinein, holt er den Bauern nie ein. Also: sofort laufen!',
  },
  {
    id: 'halten',
    title: 'Opposition halten',
    fen: '8/8/8/4k3/8/4PK2/8/8 b - - 0 1',
    goal: 'draw',
    moves: 12,
    limit: 12,
    text: 'Du hast Schwarz und hältst Remis. Bleib vor dem Bauern und nimm die Opposition: Dein König stellt sich dem weißen mit einem Feld Abstand gegenüber.',
  },
  {
    id: 'lucena',
    title: 'Lucena-Stellung',
    fen: '1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1',
    goal: 'promote',
    limit: 20,
    text: 'Turmendspiel: Dein König steht vor dem Bauern und kommt nicht heraus. Baue eine „Brücke“: Turm erst auf die d-Linie (Schach), dann auf die vierte Reihe – er schirmt später die Schachs ab.',
  },
  {
    id: 'philidor',
    title: 'Philidor-Stellung',
    fen: '4k3/R7/8/3KP3/8/8/8/1r6 b - - 0 1',
    goal: 'draw',
    moves: 12,
    limit: 12,
    text: 'Du hast Schwarz und hältst Remis. Turm auf die sechste Reihe (Tb6) – so kommt der weiße König nicht nach vorn. Zieht der Bauer auf e6, gibt dein Turm von hinten Schach.',
  },
  {
    id: 'laeufer',
    title: 'Zwei Läufer (schwer)',
    fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1',
    goal: 'mate',
    limit: 40,
    text: 'Die Läufer stehen nebeneinander und bilden eine Wand. Treib den König in eine Ecke – dein König hilft mit. Vorsicht vor Patt!',
  },
];

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const material = (chess, color) => chess.board().flat().reduce((s, p) => s + (p && p.color === color ? VALUE[p.type] : 0), 0);

// Ziel erreicht oder verfehlt? eg = Lehrstellung, moves = Züge seit der Stellung (UCI), score = Stockfish-Bewertung nach deinem
// letzten Zug aus deiner Sicht ({ cp } / { mate }) oder null (noch nicht gerechnet / nicht nach deinem Zug).
// Liefert { state: 'done' | 'failed' | null, text }.
export function judge(eg, moves, score = null) {
  const chess = new Chess(eg.fen);
  const me = chess.turn();
  const history = [];
  for (const m of moves) history.push(chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }));
  const mine = history.filter((m) => m.color === me).length;
  const myTurn = chess.turn() === me;
  const winning = (s) => s && (s.mate !== undefined ? s.mate > 0 : s.cp >= WIN_MIN);
  const lost = (s) => s && (s.mate !== undefined ? s.mate < 0 : s.cp <= DRAW_MIN);

  if (chess.isCheckmate()) return myTurn ? { state: 'failed', text: 'Du bist matt.' } : eg.goal === 'mate' ? { state: 'done', text: 'Schachmatt – geschafft!' } : { state: 'done', text: 'Sogar matt – geschafft!' };
  if (chess.isDraw()) {
    const why = chess.isStalemate() ? 'Patt' : chess.isInsufficientMaterial() ? 'zu wenig Material zum Mattsetzen' : chess.isThreefoldRepetition() ? 'dreimal dieselbe Stellung' : '50 Züge ohne Schlagen und Bauernzug';
    return eg.goal === 'draw' ? { state: 'done', text: `Remis (${why}) – gehalten!` } : { state: 'failed', text: `Remis: ${why}.` };
  }
  if (eg.goal === 'mate') {
    // „Matt in n“: Stockfish sieht nach deinem Zug kein Matt mehr, das in die restlichen Züge passt
    if (eg.within && !myTurn && score && !(score.mate > 0 && mine + score.mate <= eg.within)) return { state: 'failed', text: `In ${eg.within} Zügen geht das Matt so nicht mehr.` };
    // Figur verloren = zu wenig Material (oben schon Remis) – sonst nur die Zuggrenze
    if (mine >= eg.limit && myTurn) return { state: 'failed', text: `${eg.limit} Züge sind um – versuch es kürzer.` };
    return { state: null, text: '' };
  }
  if (eg.goal === 'promote') {
    const promoted = history.some((m) => m.color === me && m.promotion);
    if (promoted && myTurn && material(chess, me) - material(chess, me === 'w' ? 'b' : 'w') >= 5) return { state: 'done', text: 'Umgewandelt – der Gewinn ist sicher!' };
    if (!myTurn && score && !winning(score)) return { state: 'failed', text: 'Damit ist der Gewinn weg – Stockfish hält jetzt Remis.' };
    if (mine >= eg.limit && myTurn) return { state: 'failed', text: `${eg.limit} Züge sind um – versuch es kürzer.` };
    return { state: null, text: '' };
  }
  // Remis halten
  if (history.some((m) => m.color !== me && m.promotion)) return { state: 'failed', text: 'Der Bauer ist durch.' };
  if (!myTurn && lost(score)) return { state: 'failed', text: 'Damit ist die Stellung verloren.' };
  if (mine >= eg.moves && !myTurn && score && !lost(score)) return { state: 'done', text: `${eg.moves} Züge gehalten – das ist Remis!` };
  return { state: null, text: '' };
}
