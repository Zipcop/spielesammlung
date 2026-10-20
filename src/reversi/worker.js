// Reversi-Computer im Hintergrund: Die Suche (ai.js) darf bis zu 1,5 s rechnen – im Worker ruckelt dabei nichts.
import { chooseMove } from './ai.js';

self.onmessage = (e) => {
  const { id, board, color, level } = e.data;
  self.postMessage({ id, at: chooseMove(board, color, level) });
};
