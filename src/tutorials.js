// Spielanleitungen (tutorial.js zeigt sie als Buchseite): je Spiel ein paar kurze Abschnitte – so, wie die Spiele hier
// gebaut sind, im normalen Modus („Ohne Hilfen“ erklärt das Spiel selbst). img = Bild aus public/anleitung/.
// Neues Spiel: Eintrag mit seinem Namen aus dem Spieleschrank anlegen.

export const TUTORIALS = {
  Kniffel: [
    { title: 'Worum geht’s?', text: '13 Runden: In jeder Runde würfelst du bis zu dreimal und trägst dann genau ein Feld im Block ein. Wer am Ende mehr Punkte hat, gewinnt.', img: 'kniffel-tisch.webp' },
    { title: 'Würfeln', text: 'Becher packen und schütteln, loslassen = auskippen. Oder einen Würfel mit der Maus ziehen – dann nimmst du alle freien Würfel als Handvoll und wirfst sie. Bequem: „Würfeln“ oder Leertaste.' },
    { title: 'Würfel behalten', text: 'Einen Würfel anklicken legt ihn vor die Schale – er wird nicht mehr mitgewürfelt. Nochmal anklicken holt ihn zurück.' },
    { title: 'Eintragen', text: 'Feld im Block anklicken. Graue Zahlen zeigen, was ein Feld gerade bringen würde; passt nichts, streichst du ein Feld mit 0. Oben zählen nur die passenden Augen – ab 63 Punkten oben gibt es 35 Bonus.' },
    { title: 'Die Felder unten', text: 'Dreier- und Viererpasch: 3 bzw. 4 Gleiche, zählt alle Augen. Full House (3 + 2 Gleiche) 25, kleine Straße (4 in Folge) 30, große Straße (5 in Folge) 40, Kniffel (5 Gleiche) 50, Chance = alle Augen. Jeder weitere Kniffel bringt 50 extra.' },
    { title: 'Alles ist echt', text: 'Würfel, Becher und Block kannst du packen und werfen. Ist etwas verrutscht, stellt „Aufbauen“ alles wieder hin.' },
  ],
  Schach: [
    { title: 'Worum geht’s?', text: 'Setz den gegnerischen König matt: Er steht im Schach und kann nicht mehr entkommen. Weiß fängt an.', img: 'schach-figuren.webp' },
    { title: 'Die Figuren', text: 'Bauer: ein Feld vor (beim ersten Zug auch zwei), schlägt schräg. Turm gerade, Läufer schräg, Dame beides, Springer im „L“ (darf springen), König ein Feld in jede Richtung.' },
    { title: 'Ziehen', text: 'Figur anklicken – die erlaubten Felder leuchten – dann das Zielfeld anklicken. Oder die Figur mit der Maus packen und aufs Feld stellen. Esc wählt ab.', img: 'schach-ziehen.webp' },
    { title: 'Sonderzüge', text: 'Rochade: König zwei Felder zum Turm, der Turm springt über ihn. En passant: Ein Bauer schlägt einen danebengezogenen Doppelschritt. Erreicht ein Bauer die letzte Reihe, wählst du, was er wird (meist Dame).' },
    { title: 'Remis und Aufgeben', text: 'Unentschieden bei Patt (kein Zug möglich, aber kein Schach), dreimal gleicher Stellung, 50 Zügen ohne Schlagen und ohne Bauernzug oder zu wenig Material zum Mattsetzen. „Aufgeben“ beendet die Partie.' },
    { title: 'Gegen den Computer', text: 'Stufe wählen, dann „Gegen Computer“. Das Orakel zeigt deine Gewinnchance und bewertet deine Züge. „Tipp“ zeigt einen guten Zug, „Zug zurück“ nimmt deinen letzten Zug samt Antwort zurück.' },
  ],
  'Schach-Rätsel': [
    { title: 'Worum geht’s?', text: 'Echte Stellungen aus Partien auf lichess.org: Der Gegner zieht zuerst, dann findest du den besten Zug. Oft geht es mehrere Züge weiter – der Gegner antwortet jeweils von selbst.' },
    { title: 'Rätsel lösen', text: 'Figur anklicken, dann das Zielfeld – oder die Figur mit der Maus hinstellen. Ein falscher Zug wird zurückgenommen, du darfst nochmal. „Lösung zeigen“ spielt sie dir vor.' },
    { title: 'Bester Zug?', text: 'Oben auf „Bester Zug?“ umschalten: Dann wählst du aus bis zu vier Zügen. Fährst du mit der Maus über eine Antwort, zeigt ein Pfeil den Zug auf dem Brett.', img: 'raetsel-pfeil.webp' },
    { title: 'Deine Wertung', text: 'Jeder der beiden Modi hat seine eigene Wertung, beide starten bei 1000. Gelöst = sie steigt, daneben = sie sinkt; schwere Rätsel bringen mehr. Die nächsten Rätsel passen zu deiner Wertung.' },
    { title: 'Gezielt üben', text: 'Unter „Thema“ übst du eine Sache, z. B. Matt in 2, Gabel oder Fesselung. „Überspringen“ holt ein anderes Rätsel. Fehlzug, gezeigte Lösung, Überspringen oder Thema/Modus mitten im Rätsel wechseln zählt als nicht gelöst.' },
  ],
  'Mau-Mau': [
    { title: 'Worum geht’s?', text: 'Wer zuerst keine Karten mehr auf der Hand hat, gewinnt. Gespielt wird mit 32 Karten (7 bis Ass), jeder startet mit 5.', img: 'maumau-tisch.webp' },
    { title: 'Karte legen', text: 'Auf die Ablage passt gleiche Farbe oder gleicher Wert. Karte anklicken – oder mit der Maus auf die Ablage ziehen. Karten, die gerade nicht passen, sind abgedunkelt.', img: 'maumau-zug.webp' },
    { title: 'Nichts passt?', text: 'Dann eine Karte ziehen: Stapel anklicken, „Karte ziehen“ oder die oberste Karte zu dir ziehen. Passt sie, darfst du sie gleich legen oder mit „Weiter“ behalten; passt sie nicht, ist der andere dran.' },
    { title: 'Besondere Karten', text: '7: Der andere zieht 2 und ist danach normal dran – außer er legt selbst eine 7, dann zieht der Nächste 4. Auf eine offene 7 passt nur eine 7. 8: Der andere setzt aus. Bube: passt auf alles außer einen Buben, du wünschst dir eine Farbe.', img: 'maumau-sonder.webp' },
    { title: 'Mau!', text: 'Bevor du deine vorletzte Karte legst, „Mau!“ drücken – vergessen kostet eine Strafkarte.' },
  ],
  'Mensch ärgere dich nicht': [
    { title: 'Worum geht’s?', text: 'Bring alle vier Figuren einmal ums Brett in dein Ziel. Wer zuerst alle vier drin hat, gewinnt. Zuerst suchst du dir im Seitenfeld eine Farbe aus – freie Farben spielt der Computer.', img: 'maedn-brett.webp' },
    { title: 'Würfeln', text: 'Würfelteller anklicken, „Würfeln“ oder Leertaste. Oder den Würfel mit der Maus packen, schütteln und werfen.' },
    { title: 'Ziehen', text: 'Leuchtende Figur anklicken – oder mit der Maus aufs Zielfeld stellen. Gibt es nur einen möglichen Zug, zieht die Figur von selbst.' },
    { title: 'Die Sechs', text: 'Zu Beginn steht eine Figur auf deinem Startfeld, drei warten im Haus. Nur mit einer 6 kommt eine aufs Startfeld; solange noch welche im Haus warten, muss das Startfeld frei werden. Konntest du mit der 6 ziehen, würfelst du nochmal. Kannst du gar nicht ziehen (nichts auf der Laufbahn, im Ziel nichts beweglich), hast du drei Versuche.' },
    { title: 'Schlagen', text: 'Landest du genau auf einer fremden Figur, muss sie zurück ins Haus. Wer schlagen kann, muss schlagen. Ins Ziel geht es nur mit passender Zahl.' },
  ],
  Billard: [
    { title: 'Worum geht’s?', text: '8-Ball: Einer spielt die Vollen (1–7), der andere die Halben (9–15). Das entscheidet die erste Kugel, die nach dem Anstoß ohne Foul fällt – bis dahin ist der Tisch offen. Wer seine Kugeln abgeräumt hat und dann die 8 versenkt, gewinnt.' },
    { title: 'Zielen', text: 'Die Maus zeigt die Richtung, die Linie zeigt, wo die Weiße trifft. Mit gedrückter Shift-Taste zielst du ganz fein.', img: 'billard-zielen.webp' },
    { title: 'Stoßen', text: 'Linke Maustaste halten und die Maus vom Ziel weg ziehen: Der Queue geht mit – je weiter, desto stärker. Loslassen = Stoß. Esc oder zurück auf null = abbrechen.', img: 'billard-kraft.webp' },
    { title: 'Wer ist dran?', text: 'Versenkst du ohne Foul eine eigene Kugel (bei offenem Tisch: irgendeine), stößt du weiter. Sonst ist der andere dran.' },
    { title: 'Fouls', text: 'Weiße versenkt, zuerst eine falsche Kugel oder gar keine getroffen, nach dem Treffen weder Bande noch versenkt: Dann hat der andere „Ball in Hand“ und legt die Weiße per Klick, wo er will.' },
    { title: 'Die 8', text: 'Die 8 kommt zuletzt. Wer sie zu früh oder mit einem Foul versenkt, verliert sofort. Nur beim Anstoß wird sie wieder aufgesetzt.' },
  ],
  Rommé: [
    { title: 'Worum geht’s?', text: 'Wer zuerst alle Karten los ist, gewinnt die Runde und bekommt die Restpunkte des anderen. 110 Karten (zwei Blätter und 6 Joker); jeder bekommt 13, wer anfängt 14.', img: 'romme-tisch.webp' },
    { title: 'Ein Zug', text: 'Zuerst eine Karte nehmen: Stapel oder oberste Karte der Ablage anklicken – oder zu dir ziehen. Dann darfst du auslegen und anlegen. Zum Schluss legst du immer eine Karte ab. Die Karte von der Ablage darfst du nicht gleich wieder ablegen.' },
    { title: 'Der erste Zug', text: 'Im ersten Zug wird nur gezogen und abgelegt, noch nichts ausgelegt. Wer anfängt, hat schon 14 Karten: Er zieht nicht, sondern legt nur eine Karte ab.' },
    { title: 'Auslegen', text: 'Karten anklicken (sie heben sich), dann „Auslegen“. Satz: 3–4 gleiche Werte in verschiedenen Farben. Reihe: ab 3 Karten einer Farbe in Folge, Ass vor der 2 oder hinter dem König. Ein Joker ersetzt jede Karte. Geht die Auswahl auf mehrere Arten (Joker vorn oder hinten), wechselt „Andere Lage“.', img: 'romme-figuren.webp' },
    { title: 'Herauskommen und Anlegen', text: 'Beim ersten Auslegen brauchst du zusammen mindestens 30 Punkte (Ass 1 oder 11, Bilder 10, Joker wie die Karte, die er ersetzt). Danach darfst du überall anlegen: Karte anklicken, dann die Figur.' },
    { title: 'Joker tauschen', text: 'Nach dem Herauskommen: Hast du genau die Karte, für die ein ausgelegter Joker steht, Karte anklicken, dann den Joker. Er kommt auf deine Hand und muss im selben Zug wieder ausgelegt oder angelegt werden.' },
    { title: 'Ablegen und Rundenende', text: 'Karte anklicken, dann die Ablage oder „Ablegen“ – oder hinziehen. „Zug zurücksetzen“ nimmt Auslegen, Anlegen und Tauschen zurück, gezogen bleibt gezogen. Ist der Stapel zum zweiten Mal leer, bekommt wer weniger Restpunkte hat die Differenz.' },
  ],
  Doppelkopf: [
    { title: 'Worum geht’s?', text: 'Vier am Tisch, zwei Parteien: Re sind die beiden mit einer Kreuz-Dame, Kontra die anderen – wer zu wem gehört, ist geheim. Im Spiel sind 240 Augen; Re braucht 121, Kontra 120. Zu zweit spielen zwei Computer mit, allein drei. Gespielt wird nach den Turnierregeln.', img: 'doko-tisch.webp' },
    { title: 'Trumpf', text: 'Von hoch nach tief: Herz-10, die Damen, die Buben (je Kreuz, Pik, Herz, Karo), dann Karo Ass, 10, König, 9. Kreuz und Pik: Ass, 10, König, 9 – Herz: Ass, König, 9. Liegen zwei gleiche Karten im Stich, gewinnt die zuerst gelegte.', img: 'doko-truempfe.webp' },
    { title: 'Spielen', text: 'Karte anklicken oder in die Tischmitte legen. Bedienen ist Pflicht: Trumpf auf Trumpf, Farbe auf Farbe. Wer nicht bedienen kann, sticht mit Trumpf oder wirft ab. Abgedunkelte Karten passen gerade nicht. Augen: Ass 11, Zehn 10, König 4, Dame 3, Bube 2.' },
    { title: 'Vorbehalt: Hochzeit und Solo', text: 'Vor dem ersten Stich sagt jeder „gesund“ oder meldet einen Vorbehalt. Hochzeit (beide Kreuz-Damen): Partner wird, wer in den ersten drei Stichen zuerst einen Stich macht. Solo: allein gegen drei, zählt dreifach – Farb-, Damen-, Bubensolo oder Fleischloser.' },
    { title: 'Ansagen', text: 'Rechts im Seitenfeld: „Re“ bzw. „Kontra“ (solange du noch 11 Karten hast) bringt dem Gewinner 2 Punkte mehr. Mit „keine 90“, „keine 60“, „keine 30“ oder „schwarz“ (bis 10, 9, 8, 7 Karten) legst du nach – dann musst du das aber auch schaffen.', img: 'doko-ansage.webp' },
    { title: 'Abrechnung', text: 'Gewonnen +1, je 30 Augen Vorsprung (Gegner unter 90, 60, 30, schwarz) +1, dazu die Ansagen. Sonderpunkte: Fuchs (Karo Ass) gefangen, Doppelkopf (Stich mit 40 Augen), Karlchen (Kreuz-Bube) macht den letzten Stich, gegen die Kreuz-Damen gewonnen. Die Punkte laufen in der Spielliste weiter.', img: 'doko-abrechnung.webp' },
  ],
};
