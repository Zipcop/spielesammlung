// Inhalt des Spieleschranks: alle geplanten Spiele, je Fach-Spalte eine Kategorie.
// box = Schachtelmaß in Metern [Breite, Höhe, Tiefe], perPile = so viele Schachteln liegen übereinander.
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
]);

export const SHELF = [
  {
    title: 'Brettspiele',
    box: [0.31, 0.08, 0.3],
    perPile: 2,
    games: [
      'Schach', 'Schach-Rätsel', 'Dame', 'Mühle', 'Mensch ärgere dich nicht', 'Backgammon', 'Vier gewinnt',
      'Reversi', 'Go', 'Schiffe versenken', 'Monopoly-artig', 'Spiel des Lebens-artig',
    ],
  },
  {
    title: 'Kartenspiele',
    box: [0.27, 0.065, 0.19],
    perPile: 2,
    games: ["Texas Hold'em", 'Blackjack', 'Mau-Mau', 'Uno-artig', 'Rommé', 'Schwimmen', 'Skat', 'Doppelkopf', 'Solitär'],
  },
  {
    title: 'Würfel & Quiz',
    box: [0.29, 0.075, 0.22],
    perPile: 1,
    games: ['Kniffel', 'Mäxchen', 'Quiz'],
  },
  {
    title: 'Geschick & Sport',
    box: [0.31, 0.1, 0.3],
    perPile: 1,
    games: ['Billard', 'Minigolf', 'Darts', 'Bowling', 'Air-Hockey', 'Kicker'],
  },
];
