// Gemeinsame Regel für „Ohne Hilfen“ (rein, ohne Oberfläche): Solange der letzte Zug eines Spielers noch
// angeprangert werden kann, darf genau dieser Spieler keine Revanche starten – sonst könnte er mit einem
// Schummelzug gewinnen und die Anklage sofort wegklicken. Der andere darf (er verzichtet damit).
export const rematchBlocked = (s, player) => !!(s?.free && s.cheat && s.cheat.player === player);
