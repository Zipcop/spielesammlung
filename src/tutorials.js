// Texte der geführten Rundgänge (tutorial.js), je Spiel 4–5 kurze Schritte – so, wie die Spiele hier gebaut sind.
// at = Teil auf dem Tisch, auf das ein Ring zeigt (board.anchor(at)) · el = Stelle im Seitenfeld, die leuchtet.
// Neues Spiel: Eintrag mit seinem Namen aus dem Spieleschrank anlegen und am Brett anchor(name) anbieten.

export const TUTORIALS = {
  Kniffel: [
    { title: 'Worum geht’s?', text: '13 Runden: In jeder Runde bis zu dreimal würfeln, dann genau ein Feld im Block füllen. Wer am Ende mehr Punkte hat, gewinnt.', el: '#sheet' },
    { title: 'Würfeln', text: 'Becher packen und schütteln, loslassen = auskippen. Oder einen Würfel mit der Maus ziehen – dann nimmst du alle freien Würfel als Handvoll und wirfst sie. Bequem: „Würfeln“ oder Leertaste.', at: 'becher' },
    { title: 'Würfel behalten', text: 'Einen Würfel anklicken legt ihn beiseite – er wird nicht mehr mitgewürfelt. Nochmal anklicken holt ihn zurück.', at: 'wuerfel' },
    { title: 'Eintragen', text: 'Feld im Block anklicken. Oben zählen nur die passenden Augen (ab 63 Punkten gibt es 35 Bonus). Unten: Pasch, Full House (25), Straßen (30/40), Kniffel = fünf Gleiche (50), Chance.', el: '#sheet' },
    { title: 'Alles ist echt', text: 'Würfel, Becher und Block kannst du packen und werfen – „Aufbauen“ stellt alles wieder hin. Rechte Maustaste = Kamera drehen, Mausrad = zoomen.', at: 'block' },
  ],
  Schach: [
    { title: 'Worum geht’s?', text: 'Setz den gegnerischen König matt: Er steht im Schach und kann nicht mehr entkommen. Weiß fängt an.', at: 'brett' },
    { title: 'Ziehen', text: 'Figur anklicken – die erlaubten Felder leuchten – Zielfeld anklicken. Oder die Figur mit der Maus packen und aufs Feld stellen.', at: 'brett' },
    { title: 'Die Figuren', text: 'Bauer: ein Feld vor (am Anfang auch zwei), schlägt schräg. Turm gerade, Läufer schräg, Dame beides, Springer im „L“ (darf springen), König ein Feld.', at: 'brett' },
    { title: 'Sonderzüge', text: 'Rochade: König zwei Felder zum Turm, der Turm springt über ihn. En passant: Bauer schlägt einen danebengezogenen Doppelschritt. Am Ende verwandelt sich der Bauer (meist in eine Dame).', at: 'brett' },
    { title: 'Hilfe gegen den Computer', text: 'Allein zeigt das Orakel deine Gewinnchance und bewertet deine Züge. „Tipp“ zeigt einen guten Zug, „Zug zurück“ nimmt deinen letzten Zug zurück.', el: '#chess-panel' },
  ],
  'Schach-Rätsel': [
    { title: 'Worum geht’s?', text: 'Echte Stellungen aus Partien auf lichess.org: Der Gegner zieht zuerst, dann findest du den besten Zug. Oft geht es mehrere Züge weiter – der Gegner antwortet jeweils von selbst.', at: 'brett' },
    { title: 'Rätsel lösen', text: 'Figur anklicken, dann das Zielfeld – oder die Figur mit der Maus hinstellen. Ein falscher Zug wird zurückgenommen, du darfst nochmal. „Lösung zeigen“ spielt sie dir vor.', at: 'brett' },
    { title: 'Bester Zug?', text: 'Oben auf „Bester Zug?“ umschalten: Dann wählst du aus vier Zügen. Fährst du mit der Maus über eine Antwort, zeigt ein Pfeil den Zug auf dem Brett.', el: '#puzzle-panel .pz-modes' },
    { title: 'Deine Wertung', text: 'Du startest bei 1000. Gelöst = sie steigt, daneben = sie sinkt; schwere Rätsel bringen mehr. Die nächsten Rätsel passen zu deiner Wertung. Nach Fehlzug, gezeigter Lösung oder Überspringen zählt es als nicht gelöst.', el: '#puzzle-panel .pz-rating' },
    { title: 'Gezielt üben', text: 'Unter „Thema“ übst du eine Sache, z. B. Matt in 2, Gabel oder Fesselung. „Überspringen“ holt ein anderes Rätsel – zählt aber als nicht gelöst, genau wie Thema oder Modus mitten im Rätsel zu wechseln.', el: '#puzzle-panel .pz-theme' },
  ],
  'Mau-Mau': [
    { title: 'Worum geht’s?', text: 'Wer zuerst keine Karten mehr auf der Hand hat, gewinnt. Jeder startet mit 5 Karten.', at: 'hand' },
    { title: 'Karte legen', text: 'Auf die Ablage passt gleiche Farbe oder gleicher Wert. Karte anklicken – oder mit der Maus auf die Ablage ziehen.', at: 'ablage' },
    { title: 'Nichts passt?', text: 'Dann eine Karte ziehen: Stapel anklicken oder die oberste Karte zu dir ziehen. Passt sie, darfst du sie gleich legen oder mit „Weiter“ behalten; passt sie nicht, ist der andere dran.', at: 'stapel' },
    { title: 'Besondere Karten', text: '7: Der andere zieht 2 – oder legt selbst eine 7, dann zieht der Nächste 4. 8: Der andere setzt aus. Bube: passt auf alles, du wünschst dir eine Farbe.', at: 'ablage' },
    { title: 'Mau!', text: 'Bevor du deine vorletzte Karte legst, „Mau!“ drücken – vergessen kostet eine Strafkarte.', el: '#mm-panel [data-mau]' },
  ],
  'Mensch ärgere dich nicht': [
    { title: 'Worum geht’s?', text: 'Bring alle vier Figuren einmal ums Brett in dein Ziel in der Mitte. Wer zuerst alle drin hat, gewinnt.', at: 'mitte' },
    { title: 'Würfeln', text: 'Würfelteller anklicken oder Leertaste. Oder den Würfel mit der Maus packen, schütteln und werfen.', at: 'teller' },
    { title: 'Ziehen', text: 'Leuchtende Figur anklicken – oder mit der Maus aufs Zielfeld stellen. Gibt es nur einen Zug, zieht die Figur von selbst.', at: 'haus' },
    { title: 'Die Sechs', text: 'Mit einer 6 kommt eine Figur aus dem Haus aufs Startfeld – oder du ziehst eine andere. Nach einer 6 darfst du nochmal würfeln. Ist keine Figur draußen, hast du drei Versuche.', at: 'haus' },
    { title: 'Schlagen', text: 'Landest du genau auf einer fremden Figur, muss sie zurück ins Haus. Wer schlagen kann, muss schlagen. Ins Ziel nur mit passender Zahl.', at: 'mitte' },
  ],
  Billard: [
    { title: 'Worum geht’s?', text: '8-Ball: Einer spielt die Vollen (1–7), der andere die Halben (9–15) – das entscheidet die erste versenkte Kugel. Wer seine alle versenkt hat und dann die 8, gewinnt.', at: 'weisse' },
    { title: 'Stoßen', text: 'Die Maus zeigt die Richtung. Linke Maustaste halten = Kraft aufladen, loslassen = Stoß. Esc bricht ab.', at: 'weisse' },
    { title: 'Fouls', text: 'Weiße versenkt, zuerst eine falsche Kugel oder gar keine getroffen, nach dem Treffen keine Bande: Dann hat der andere „Ball in Hand“ und legt die Weiße frei hin.', at: 'weisse' },
    { title: 'Die 8', text: 'Die 8 kommt zuletzt. Wer sie zu früh oder mit einem Foul versenkt, verliert sofort.', el: '#bil-panel' },
  ],
  Rommé: [
    { title: 'Worum geht’s?', text: 'Wer zuerst alle Karten los ist, gewinnt die Runde und bekommt die Restpunkte des anderen. Jeder hat 13 Karten, wer anfängt 14. In der ersten Runde wird nur gezogen und abgelegt.', at: 'hand' },
    { title: 'Ziehen', text: 'Jeder Zug beginnt mit einer Karte: Stapel anklicken oder die oberste Karte der Ablage – oder sie mit der Maus zu dir ziehen. Die Karte von der Ablage darfst du nicht gleich wieder ablegen.', at: 'stapel' },
    { title: 'Auslegen', text: 'Karten anklicken (sie heben sich), dann „Auslegen“. Satz: 3–4 gleiche Werte in verschiedenen Farben. Reihe: ab 3 Karten einer Farbe in Folge, Ass vor der 2 oder hinter dem König. Ein Joker ersetzt jede Karte.', el: '#rm-panel [data-meld]' },
    { title: 'Herauskommen', text: 'Beim ersten Auslegen brauchst du zusammen mindestens 30 Punkte (Ass 1 oder 11, Bilder 10). Danach darfst du überall anlegen: Karte anklicken, dann die Figur. Auf einen Joker geklickt = tauschen.', at: 'auslage' },
    { title: 'Ablegen', text: 'Zum Schluss eine Karte auf die Ablage: anklicken, dann die Ablage – oder hinziehen. Die letzte Karte wird auch abgelegt. Verplant? „Zug zurücksetzen“ nimmt alles aus diesem Zug zurück.', at: 'ablage' },
  ],
};
