Drittanbieter-Software in der Spielesammlung
============================================

Stockfish 19 (Schach-Engine, geladen für den Computer-Gegner und die Zuganalyse)
  - Datei: stockfish-19-lite-single.js / .wasm (npm-Paket "stockfish" 19.0.1)
  - Lizenz: GNU General Public License v3 (Volltext: stockfish-GPLv3.txt)
  - Quellcode Engine:     https://github.com/official-stockfish/Stockfish
  - Quellcode WASM-Build: https://github.com/nmrugg/stockfish.js (Tag v19.0.1)
  - (c) T. Romstad, M. Costalba, J. Kiiski, G. Linscott und weitere; Stockfish.js (c) Chess.com, LLC
  - Die Engine läuft unverändert als eigener Web Worker und tauscht mit dem Spiel nur
    UCI-Textbefehle aus.

chess.js 1.4.0 (Schachregeln) – BSD-2-Clause, https://github.com/jhlywa/chess.js – Text: chess.js-BSD-2.txt
three.js – MIT, https://github.com/mrdoob/three.js – Text: three.js-MIT.txt
PeerJS – MIT, https://github.com/peers/peerjs – Text: peerjs-MIT.txt
Rapier (@dimforge/rapier3d-compat) – Apache-2.0, https://github.com/dimforge/rapier.js – Text: rapier-Apache-2.0.txt
Eröffnungsliste (Namen der Eröffnungen, Buchzüge in der Schach-Analyse) – lichess-org/chess-openings,
  CC0 1.0 (gemeinfrei), https://github.com/lichess-org/chess-openings – umgewandelt mit scripts/openings.mjs
Schach-Rätsel (gut 3.000 Rätsel mit Wertung und Themen) – Lichess-Rätseldatenbank, CC0 1.0 (gemeinfrei),
  https://database.lichess.org/#puzzles – Auswahl mit scripts/puzzles.mjs
