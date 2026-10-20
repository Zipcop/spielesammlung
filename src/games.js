// Inhalt des Spieleschranks: alle geplanten Spiele, je Fach-Spalte eine Kategorie.
// box = Schachtelmaß in Metern [Breite, Höhe, Tiefe], perPile = so viele Schachteln liegen höchstens übereinander
// (shelf.js macht die Spalte so breit, wie Stapel nebeneinander nötig sind).
// Neue Spiele hier eintragen; spielbare zusätzlich in PLAYABLE (info = Untertitel am Tisch,
// solo = auch allein gegen den Computer spielbar, free = auch „Ohne Hilfen“ mit Schummeln,
// alone = nur allein, ohne Lobby – der Text ist die Aufschrift des Start-Knopfs).

export const PLAYABLE = new Map([
  ['Kniffel', { info: 'Würfelspiel für zwei · 13 Runden', free: true }],
  ['Schach', { info: 'Zu zweit – oder allein gegen den Computer, mit Orakel', solo: true, free: true }],
  ['Schach-Rätsel', { info: 'Taktik-Rätsel und „Welcher Zug ist der beste?“ – allein, mit eigener Wertung', solo: true, alone: 'Rätsel üben' }],
  ['Mau-Mau', { info: 'Kartenspiel mit 32 Karten – zu zweit oder gegen den Computer', solo: true, free: true }],
  ['Billard', { info: '8-Ball an einem echten Billardtisch – zu zweit oder gegen den Computer', solo: true }],
  ['Mensch ärgere dich nicht', { info: 'Vier Farben – zu zweit mit 2 Computer-Spielern oder allein gegen 3', solo: true, free: true }],
  ['Rommé', { info: 'Kartenspiel mit 110 Karten und 6 Jokern – zu zweit oder gegen den Computer', solo: true, free: true }],
  ['Doppelkopf', { info: 'Turnierregeln, vier am Tisch – zu zweit mit 2 Computer-Spielern oder allein gegen 3', solo: true, free: true }],
  ['Mühle', { info: 'Je 9 Steine: setzen, ziehen, springen – zu zweit oder gegen den Computer (3 Stufen)', solo: true, free: true }],
  ['Dame', { info: 'Deutsche Dame auf 8 × 8 mit fliegender Dame – zu zweit oder gegen den Computer (3 Stufen)', solo: true, free: true }],
  ['Vier gewinnt', { info: 'Vier in einer Reihe – zu zweit oder gegen den Computer (4 Stufen)', solo: true, free: true }],
  ['Reversi', { info: 'Einschließen und umdrehen auf 8 × 8 – zu zweit oder gegen den Computer (4 Stufen)', solo: true, free: true }],
  ['Mäxchen', { info: 'Bluffen mit Becher und zwei Würfeln – zu zweit mit 2 Computer-Spielern oder allein gegen 3', solo: true, free: true }],
  ['Elfer raus', { info: 'Zahlenreihen ab der 11 auf- und abwärts – 2 bis 4 am Tisch, freie Plätze spielt der Computer', solo: true, free: true }],
  ["Texas Hold'em", { info: 'No-Limit-Poker an 6 Plätzen mit deinem Spielgeld-Konto – freie Plätze spielt der Computer', solo: true, free: true }],
]);

export const SHELF = [
  {
    title: 'Brettspiele',
    box: [0.3, 0.07, 0.3],
    perPile: 4,
    games: [
      'Schach', 'Schach-Rätsel', 'Dame', 'Mühle', 'Mensch ärgere dich nicht', 'Backgammon', 'Vier gewinnt',
      'Reversi', 'Go', 'Halma', 'Malefiz', 'Fang den Hut', 'Mancala', 'Abalone-artig', 'Quarto',
    ],
  },
  {
    title: 'Familienspiele',
    box: [0.31, 0.085, 0.31],
    perPile: 3,
    games: [
      'Schiffe versenken', 'Monopoly-artig', 'Spiel des Lebens-artig', 'Siedler-artig', 'Carcassonne-artig', 'Scrabble-artig',
      'Azul-artig', 'Blokus-artig', 'Domino', 'Mastermind', 'Wer ist es?', 'Stratego-artig',
    ],
  },
  {
    title: 'Kartenspiele',
    box: [0.27, 0.065, 0.19],
    perPile: 3,
    games: [
      'Mau-Mau', 'Uno-artig', 'Rommé', 'Schwimmen', 'Skat', 'Doppelkopf', 'Solitär', 'Sechsundsechzig', '6 nimmt!-artig',
      'Wizard-artig', 'Skip-Bo-artig', 'Kakerlakenpoker-artig', 'Hearts', 'Canasta', 'Schafkopf', 'Elfer raus',
      'Schwarzer Peter', 'Durak', 'Phase-10-artig',
    ],
  },
  {
    title: 'Würfel & Casino',
    box: [0.29, 0.075, 0.22],
    perPile: 3,
    games: ['Kniffel', 'Mäxchen', 'Zehntausend', 'Schocken', 'Perudo', "Texas Hold'em", 'Blackjack', 'Roulette', 'Baccarat', 'Craps'],
  },
  {
    title: 'Gesellschaft',
    box: [0.29, 0.085, 0.25],
    perPile: 2,
    games: ['Quiz', 'Stadt-Land-Fluss', 'Montagsmaler', 'Tabu-artig', 'Wer bin ich?', 'Memory'],
  },
  {
    title: 'Geschick & Sport',
    box: [0.31, 0.09, 0.3],
    perPile: 3,
    games: [
      'Billard', 'Minigolf', 'Darts', 'Bowling', 'Air-Hockey', 'Kicker', 'Kegeln', 'Boule', 'Kubb', 'Carrom', 'Crokinole',
      'Becherwerfen', 'Carrera-Bahn', 'Tischtennis', 'Shuffleboard', 'Curling', 'Flipper', 'Jenga', 'Mikado',
    ],
  },
];
