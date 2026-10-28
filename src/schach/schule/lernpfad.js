// Schach-Schule, Lernpfad – reine Logik ohne Anzeige. Kapitel der Reihe nach: kurze Erklärung mit Beispielstellung,
// dann PER_CHAPTER Übungen aus der Lichess-Rätseldatenbank (database.lichess.org, CC0), leichte zuerst. Die Übungen
// je Kapitel stehen in kapitel.json (erzeugt mit scripts/schule-raetsel.mjs nach den Regeln in pick).
// Eigene Festlegungen (Nico 28.10.2026 zur Bestätigung): Sterne nach Fehlern im Kapitel (0 → 3, 1–2 → 2, mehr → 1),
// „Lösung zeigen“ zählt wie zwei Fehler; das nächste Kapitel ist frei, sobald das vorige mindestens 1 Stern hat;
// je 3 Sterne (bester Lauf je Kapitel) steigt das Level um 1.

export const PER_CHAPTER = 8;
export const SHOW_COST = 2; // „Lösung zeigen“ zählt wie zwei Fehler
export const STARS_PER_LEVEL = 3;

// Welche Figur macht den ersten eigenen Zug der Lösung? (Gabel: Springer/Bauer – Doppelangriff: die anderen)
const firstPiece = (row) => row.piece;

// pick: Auswahl aus der Datenbank (row = { themes: [...], piece: 'n' | … }) – nur fürs Erzeugen von kapitel.json.
// example: eigene Lehrstellung { fen, arrows: [UCI …] } – 'auto' = ein weiteres leichtes Rätsel des Themas (Lösungszug als Pfeil).
export const CHAPTERS = [
  {
    id: 'matt1',
    title: 'Matt in 1',
    text: 'Schachmatt heißt: Der König steht im Schach und kann nichts mehr dagegen tun – nicht wegziehen, nicht schlagen, nichts dazwischenstellen. Such zuerst alle Schachgebote, dann prüf jedes Feld rund um den König.',
    example: { fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', arrows: ['a1a8'], note: 'Da8 ist matt: Die Dame hält die ganze achte Reihe, g7 und h7 deckt der weiße König.' },
    pick: (r) => r.themes.includes('mateIn1'),
  },
  {
    id: 'ungedeckt',
    title: 'Ungedeckte Figur',
    text: 'Eine Figur, die niemand deckt, kannst du einfach schlagen. Frag dich vor jedem Zug: Welche gegnerische Figur ist ungedeckt – und welche von meinen?',
    example: { fen: '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', arrows: ['d1d5'], note: 'Der Springer auf d5 ist ungedeckt – Txd5 gewinnt ihn.' },
    pick: (r) => r.themes.includes('hangingPiece'),
  },
  {
    id: 'gabel',
    title: 'Gabel',
    text: 'Bei einer Gabel greift eine Figur zwei gegnerische gleichzeitig an. Der Gegner kann nur eine retten. Am gefährlichsten ist der Springer, weil er um die Ecke angreift.',
    example: { fen: 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', arrows: ['b5c7'], note: 'Sc7+ greift König und Turm an. Der König muss weg, dann fällt der Turm.' },
    pick: (r) => r.themes.includes('fork') && 'np'.includes(firstPiece(r)),
  },
  {
    id: 'doppelangriff',
    title: 'Doppelangriff',
    text: 'Auch Dame, Turm, Läufer und König können zwei Ziele auf einmal angreifen. Besonders stark ist ein Doppelangriff mit Schach: Der Gegner muss zuerst seinen König retten.',
    example: { fen: '4k3/8/8/8/7n/8/8/3QK3 w - - 0 1', arrows: ['d1a4'], note: 'Da4+ gibt Schach und greift gleichzeitig den Springer auf h4 an.' },
    pick: (r) => r.themes.includes('fork') && 'qbrk'.includes(firstPiece(r)),
  },
  {
    id: 'fesselung',
    title: 'Fesselung',
    text: 'Eine gefesselte Figur steht vor einer wertvolleren. Zieht sie weg, wird die dahinter geschlagen – steht dort der König, darf sie gar nicht ziehen. Greif gefesselte Figuren ruhig ein zweites Mal an.',
    example: { fen: '4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1', arrows: ['f1b5'], note: 'Lb5 fesselt den Springer an den König – er darf nicht mehr ziehen.' },
    pick: (r) => r.themes.includes('pin'),
  },
  {
    id: 'spiess',
    title: 'Spieß',
    text: 'Der Spieß ist die umgekehrte Fesselung: Du greifst eine wertvolle Figur an, sie muss weichen – und die Figur dahinter fällt.',
    example: { fen: '8/8/3k3q/8/8/8/8/R3K3 w - - 0 1', arrows: ['a1a6'], note: 'Ta6+: Der König muss die sechste Reihe verlassen, dann schlägt der Turm die Dame auf h6.' },
    pick: (r) => r.themes.includes('skewer'),
  },
  {
    id: 'abzug',
    title: 'Abzug und Abzugsschach',
    text: 'Zieht eine Figur aus der Linie einer anderen, greift die hintere plötzlich an. Ist das Ziel der König, heißt es Abzugsschach – dann darf die ziehende Figur fast alles, denn zuerst muss das Schach weg.',
    example: { fen: '4k3/8/8/8/q3N3/8/8/4RK2 w - - 0 1', arrows: ['e4c3', 'e1e8'], note: 'Sc3 macht die e-Linie frei: Abzugsschach durch den Turm – und der Springer greift die Dame an.' },
    pick: (r) => r.themes.includes('discoveredAttack') || r.themes.includes('doubleCheck'),
  },
  {
    id: 'grundreihe',
    title: 'Grundreihenmatt',
    text: 'Steht der König hinter seinen eigenen Bauern, sperren sie ihm den Weg. Ein Turm oder eine Dame auf der Grundreihe setzt dann matt. Darum lohnt sich oft ein „Luftloch“.',
    example: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', arrows: ['d1d8'], note: 'Td8 ist matt – die eigenen Bauern versperren dem König die Flucht.' },
    pick: (r) => r.themes.includes('backRankMate'),
  },
  {
    id: 'matt2',
    title: 'Matt in 2',
    text: 'Jetzt denkst du zwei Züge weit: Erst ein Zug, der dem Gegner kaum eine Wahl lässt (oft ein Schach), dann das Matt. Prüf jede Antwort des Gegners.',
    example: { fen: '1r4k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', arrows: ['d2d8', 'd1d8'], note: 'Td8+ Txd8, dann Txd8 matt – der zweite Turm vollendet.' },
    pick: (r) => r.themes.includes('mateIn2'),
  },
  {
    id: 'ablenkung',
    title: 'Ablenkung und Überlastung',
    text: 'Manche Figur hat eine wichtige Aufgabe, etwa ein Feld oder eine andere Figur zu decken. Lenkst du sie mit einem Schlag oder Schach weg, fehlt sie dort. Hat sie zwei Aufgaben zugleich, ist sie überlastet.',
    example: 'auto',
    pick: (r) => r.themes.includes('deflection'),
  },
  {
    id: 'hinlenkung',
    title: 'Hinlenkung',
    text: 'Bei der Hinlenkung zwingst du eine gegnerische Figur – oft den König – auf ein bestimmtes Feld, meist mit einem Opfer. Dort trifft sie dann eine Gabel, ein Spieß oder ein Matt.',
    example: { fen: '3q2k1/6p1/8/4N3/8/8/8/6KR w - - 0 1', arrows: ['h1h8', 'e5f7'], note: 'Th8+! Kxh8 lockt den König nach h8, dann gabelt Sf7+ König und Dame.' },
    pick: (r) => r.themes.includes('attraction'),
  },
  {
    id: 'umwandlung',
    title: 'Bauernumwandlung',
    text: 'Erreicht ein Bauer die letzte Reihe, wird er zu einer neuen Figur, fast immer zur Dame. Ein Bauer kurz vor dem Ziel ist darum viel wert – oft lohnt sich sogar ein Opfer, um ihn durchzubringen.',
    example: { fen: '8/1P6/8/8/8/8/6k1/4K3 w - - 0 1', arrows: ['b7b8'], note: 'b8=D – aus dem Bauern wird eine Dame.' },
    pick: (r) => r.themes.includes('promotion'),
  },
  {
    id: 'mattbilder',
    title: 'Matt-Bilder',
    text: 'Manche Matts kommen immer wieder: das erstickte Matt mit dem Springer, das Anastasia-Matt, das Arabische Matt mit Turm und Springer. Wer die Bilder kennt, sieht sie in der Partie sofort.',
    example: { fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', arrows: ['g5f7'], note: 'Sf7 ist ein ersticktes Matt: Der König ist von eigenen Figuren eingesperrt.' },
    pick: (r) => ['smotheredMate', 'anastasiaMate', 'arabianMate', 'bodenMate', 'hookMate', 'doubleBishopMate', 'dovetailMate'].some((t) => r.themes.includes(t)),
  },
];

// Sterne für einen Durchgang durch ein Kapitel
export const starsFor = (mistakes) => (mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1);

// Kapitel i frei? Das erste immer, sonst wenn das vorige mindestens einen Stern hat
export const unlocked = (path, i) => i === 0 || (path[CHAPTERS[i - 1]?.id]?.stars ?? 0) > 0;

export const totalStars = (path) => CHAPTERS.reduce((sum, c) => sum + (path[c.id]?.stars ?? 0), 0);

// Level aus den Sternen: { level, toNext (Sterne bis zum nächsten Level, 0 = alle Sterne), stars }
export function levelOf(path) {
  const stars = totalStars(path);
  const toNext = stars >= CHAPTERS.length * 3 ? 0 : STARS_PER_LEVEL - (stars % STARS_PER_LEVEL); // alle Sterne: kein nächstes Level
  return { level: 1 + Math.floor(stars / STARS_PER_LEVEL), toNext, stars };
}

// Durchgang beendet: bester Lauf zählt. Liefert { path (neu), stars, better, levelUp, opened (neu freigeschaltetes Kapitel oder null) }
export function finishChapter(path, id, mistakes) {
  const i = CHAPTERS.findIndex((c) => c.id === id);
  const stars = starsFor(mistakes);
  const old = path[id] ?? { stars: 0, runs: 0 };
  const next = { ...path, [id]: { stars: Math.max(old.stars, stars), runs: (old.runs ?? 0) + 1, last: mistakes } };
  const opened = i + 1 < CHAPTERS.length && !unlocked(path, i + 1) && unlocked(next, i + 1) ? CHAPTERS[i + 1].id : null;
  return { path: next, stars, better: stars > old.stars, levelUp: levelOf(next).level > levelOf(path).level, opened };
}

// Nächstes Kapitel zum Weitermachen: das erste freie ohne Sterne, sonst das erste mit weniger als 3 Sternen, sonst das letzte
export function nextChapter(path) {
  const free = CHAPTERS.filter((_, i) => unlocked(path, i));
  return (free.find((c) => !path[c.id]?.stars) ?? free.find((c) => path[c.id].stars < 3) ?? CHAPTERS.at(-1)).id;
}

// Übungen eines Kapitels aus kapitel.json (Zeilen [Kennung, FEN, Züge, Wertung, Themen]), leichte zuerst
export function exercisesOf(data, id) {
  return [...(data.chapters?.[id] ?? [])].sort((a, b) => a[3] - b[3]);
}
