// Gemeinsame Regel für „Ohne Hilfen“ (rein, ohne Oberfläche): Solange der letzte Zug eines Spielers noch
// angeprangert werden kann, darf genau dieser Spieler keine Revanche starten – sonst könnte er mit einem
// Schummelzug gewinnen und die Anklage sofort wegklicken. Der andere darf (er verzichtet damit).
export const rematchBlocked = (s, player) => !!(s?.free && s.cheat && s.cheat.player === player);

// Allein gegen den Computer (Nico 20.10.2026): Er schummelt ab und zu selbst und prüft jeden Zug des Menschen einmal –
// einen Schummelzug erwischt er jedes zweite Mal, bei einem ehrlichen Zug ruft er selten trotzdem (Fehlalarm, Strafe für ihn).
export const CPU_CHEAT = 0.12; // Anteil seiner Züge, in denen er schummelt (wenn das Spiel einen Schummelzug hergibt)
export const CPU_CATCH = 0.5;
export const CPU_FALSE_ALARM = 0.05;
export const cpuCheats = (rng = Math.random) => rng() < CPU_CHEAT;
export const cpuAccuses = (cheated, rng = Math.random) => rng() < (cheated ? CPU_CATCH : CPU_FALSE_ALARM);
