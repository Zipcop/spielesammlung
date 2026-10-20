// Kartenduell – alle Karten als reine Daten. Eigene Monster, Zauber und Fallen mit eigenen Namen und Texten
// (Spielprinzip angelehnt an Sammelkarten-Duelle; keine Namen, Bilder oder Texte aus Yu-Gi-Oh!).
// Nicos Vorgaben (20.10.2026): 40 Karten je Deck, rund 60 Sorten, drei feste Decks plus eigener Deckbau (höchstens
// 3 Kopien einer Karte, starke Karten nur 1-mal: max).
//
// Monster: level (Stufe 1–8), attr (Element), type (Typ), atk/def, fx = Effekt oder null.
//   fx.on: 'summon' (wenn als Normalbeschwörung offen beschworen), 'flip' (wenn aufgedeckt), 'death' (durch Kampf
//   zerstört), 'static' (wirkt dauernd). fx.op = was passiert (game.js: effect()).
// Zauber: sub 'normal' (wirkt einmal, dann Friedhof), 'equip' (bleibt liegen, stärkt ein Monster), 'field'
//   (Feldzone), 'cont' (Dauerzauber). target = was man anklickt ('opp' = offenes oder verdecktes Monster des Gegners,
//   'own' = eigenes offenes Monster, 'st' = Zauber/Falle auf dem Feld, 'small' = offenes Monster bis 1500 ATK).
// Fallen: trigger 'attack' (der Gegner greift an), 'summon' (der Gegner beschwört), 'any' (jederzeit: eigene
//   Hauptphase oder als Antwort). Fallen wirken frühestens im Zug nach dem Setzen.
// Rein (kein DOM), damit es sich mit node --test prüfen lässt.

export const ATTRS = { feuer: 'Feuer', wasser: 'Wasser', erde: 'Erde', wind: 'Wind', licht: 'Licht', finster: 'Finsternis' };

const M = (id, name, level, attr, type, atk, def, fx, text, max = 3) => ({ id, name, kind: 'monster', level, attr, type, atk, def, fx, text, max });
const S = (id, name, sub, fx, target, text, max = 3) => ({ id, name, kind: 'spell', sub, fx, target, text, max });
const T = (id, name, trigger, fx, target, text, max = 3) => ({ id, name, kind: 'trap', trigger, fx, target, text, max });

export const CARDS = [
  // --- Glut (Feuer) ---
  M('g01', 'Glutwelpe', 2, 'feuer', 'Drache', 800, 600, null, 'Ein junger Drache, der beim Niesen Funken sprüht.'),
  M('g02', 'Funkenechse', 3, 'feuer', 'Reptil', 1200, 800, { on: 'summon', op: 'burn', n: 300 }, 'Wenn beschworen: Der Gegner verliert 300 LP.'),
  M('g03', 'Aschefuchs', 3, 'feuer', 'Bestie', 1300, 700, { on: 'death', op: 'burn', n: 500 }, 'Wird er im Kampf zerstört: Der Gegner verliert 500 LP.'),
  M('g04', 'Schmiedeknecht', 4, 'feuer', 'Krieger', 1600, 1300, null, 'Er hämmert seine Rüstung jeden Morgen neu – zur Sicherheit.'),
  M('g05', 'Lavagolem', 4, 'feuer', 'Fels', 1300, 2000, null, 'Langsam, schwer und innen flüssig heiß.'),
  M('g06', 'Flammenschwinge', 4, 'feuer', 'Drache', 1800, 1000, null, 'Wo sie vorbeifliegt, riecht es tagelang nach Rauch.'),
  M('g07', 'Glutpriesterin', 4, 'feuer', 'Magier', 1400, 1200, { on: 'static', op: 'aura', attr: 'feuer', atk: 300 }, 'Deine anderen Feuer-Monster erhalten 300 ATK.'),
  M('g08', 'Feuerspeier', 5, 'feuer', 'Drache', 2100, 1500, { on: 'static', op: 'pierce' }, 'Greift er ein Monster in Verteidigung an, erhält der Gegner den Unterschied als Schaden.'),
  M('g09', 'Vulkanwyrm', 6, 'feuer', 'Drache', 2400, 2000, { on: 'summon', op: 'burn', n: 500 }, 'Wenn beschworen: Der Gegner verliert 500 LP.'),
  M('g10', 'Sonnenglutdrache', 8, 'feuer', 'Drache', 3000, 2500, null, 'Man sagt, die Sonne sei nur sein Spiegelbild.'),
  // --- Tiefsee (Wasser) ---
  M('t01', 'Nebelqualle', 2, 'wasser', 'Wassertier', 500, 1200, { on: 'flip', op: 'draw', n: 1 }, 'Wenn aufgedeckt: Ziehe 1 Karte.'),
  M('t02', 'Krabbenwächter', 3, 'wasser', 'Wassertier', 800, 1700, null, 'Er kennt nur eine Richtung: seitwärts – und die verteidigt er.'),
  M('t03', 'Riffflitzer', 3, 'wasser', 'Fisch', 1000, 600, { on: 'static', op: 'direct' }, 'Darf direkt angreifen, auch wenn der Gegner Monster hat.'),
  M('t04', 'Muschelritter', 4, 'wasser', 'Krieger', 1300, 1900, null, 'Sein Schild ist eine Muschel, die nie jemand öffnen konnte.'),
  M('t05', 'Riffhai', 4, 'wasser', 'Fisch', 1800, 900, null, 'Riecht einen Tropfen Schwäche auf zehn Meilen.'),
  M('t06', 'Gezeitensirene', 4, 'wasser', 'Fee', 1400, 1200, { on: 'flip', op: 'bounceStrongest' }, 'Wenn aufgedeckt: Das Monster des Gegners mit der höchsten ATK kehrt auf seine Hand zurück.'),
  M('t07', 'Tiefseeangler', 4, 'wasser', 'Fisch', 1600, 1100, { on: 'death', op: 'draw', n: 1 }, 'Wird er im Kampf zerstört: Ziehe 1 Karte.'),
  M('t08', 'Seeschlange', 5, 'wasser', 'Seeschlange', 2000, 1600, null, 'Ihre Windungen reichen von einer Küste zur anderen.'),
  M('t09', 'Kraken der Tiefe', 6, 'wasser', 'Wassertier', 2300, 2100, { on: 'summon', op: 'bounceStrongest' }, 'Wenn beschworen: Das Monster des Gegners mit der höchsten ATK kehrt auf seine Hand zurück.'),
  M('t10', 'Urozean-Leviathan', 8, 'wasser', 'Seeschlange', 2800, 3000, null, 'Wenn er auftaucht, steigt der Meeresspiegel.'),
  // --- Wildwald (Erde, Wind) ---
  M('w01', 'Eichhornspäher', 1, 'erde', 'Bestie', 300, 200, { on: 'summon', op: 'draw', n: 1 }, 'Wenn beschworen: Ziehe 1 Karte.'),
  M('w02', 'Dornenigel', 2, 'erde', 'Bestie', 500, 1500, null, 'Wer ihn streicheln will, lernt schnell.'),
  M('w03', 'Moosgnom', 3, 'erde', 'Pflanze', 900, 1400, { on: 'flip', op: 'destroyStrongest' }, 'Wenn aufgedeckt: Zerstöre das Monster des Gegners mit der höchsten ATK.'),
  M('w04', 'Waldläuferin', 4, 'erde', 'Krieger', 1600, 1200, { on: 'static', op: 'pierce' }, 'Greift sie ein Monster in Verteidigung an, erhält der Gegner den Unterschied als Schaden.'),
  M('w05', 'Nordwolf', 4, 'erde', 'Bestie', 1700, 1100, null, 'Er heult nie allein.'),
  M('w06', 'Wildkeiler', 4, 'erde', 'Bestie', 1900, 400, null, 'Bremsen hat er nie gelernt.'),
  M('w07', 'Sturmfalke', 4, 'wind', 'Vogel', 1400, 1000, { on: 'static', op: 'direct' }, 'Darf direkt angreifen, auch wenn der Gegner Monster hat.'),
  M('w08', 'Mooswächter', 4, 'erde', 'Pflanze', 1000, 2100, null, 'Seit tausend Jahren hat er sich nicht bewegt – und doch steht er immer im Weg.'),
  M('w09', 'Grauer Grizzly', 5, 'erde', 'Bestie', 2200, 1400, null, 'Der Wald wird still, wenn er Hunger hat.'),
  M('w10', 'Uralter Baumhüter', 7, 'erde', 'Pflanze', 2500, 3000, { on: 'summon', op: 'heal', n: 1000 }, 'Wenn beschworen: Du erhältst 1000 LP.'),
  // --- Licht und Finsternis (für alle Decks) ---
  M('n01', 'Lichtfee', 2, 'licht', 'Fee', 600, 800, { on: 'death', op: 'heal', n: 1000 }, 'Wird sie im Kampf zerstört: Du erhältst 1000 LP.'),
  M('n02', 'Schattenkobold', 3, 'finster', 'Unhold', 1100, 800, { on: 'static', op: 'direct' }, 'Darf direkt angreifen, auch wenn der Gegner Monster hat.'),
  M('n03', 'Knochenritter', 4, 'finster', 'Untoter', 1700, 1200, null, 'Er hat seinen Eid vergessen, nur das Kämpfen nicht.'),
  M('n04', 'Uhrwerkwächter', 4, 'licht', 'Maschine', 1200, 1800, null, 'Tick, tack – kein Schritt weiter.'),
  M('n05', 'Torhüter des Lichts', 5, 'licht', 'Krieger', 1800, 2200, null, 'Er lässt nur durch, wer reinen Herzens ist. Also niemanden.'),
  M('n06', 'Schattenmagier', 6, 'finster', 'Magier', 2300, 1900, { on: 'summon', op: 'destroyRandomSet' }, 'Wenn beschworen: Zerstöre 1 zufällige verdeckte Zauber- oder Fallenkarte des Gegners.'),
  // --- Zauber ---
  S('s01', 'Feuerball', 'normal', { op: 'burn', n: 600 }, null, 'Der Gegner verliert 600 LP.'),
  S('s02', 'Heilquelle', 'normal', { op: 'heal', n: 1000 }, null, 'Du erhältst 1000 LP.'),
  S('s03', 'Blitzschlag', 'normal', { op: 'destroy' }, 'opp', 'Zerstöre 1 Monster des Gegners.', 1),
  S('s04', 'Sturmbö', 'normal', { op: 'destroyAllOppST' }, null, 'Zerstöre alle Zauber- und Fallenkarten des Gegners.', 1),
  S('s05', 'Weiser Blick', 'normal', { op: 'draw', n: 2 }, null, 'Ziehe 2 Karten.', 1),
  S('s06', 'Kraftschub', 'normal', { op: 'boost', n: 800 }, 'own', '1 eigenes Monster erhält bis zum Ende des Zugs 800 ATK.'),
  S('s07', 'Flammenklinge', 'equip', { atk: 400, def: 0, attr: 'feuer', bonus: 300 }, 'own', 'Ausrüstung: 400 ATK, ein Feuer-Monster 700 ATK.'),
  S('s08', 'Muschelpanzer', 'equip', { atk: 200, def: 800 }, 'own', 'Ausrüstung: 200 ATK und 800 DEF.'),
  S('s09', 'Krallenring', 'equip', { atk: 500, def: 300 }, 'own', 'Ausrüstung: 500 ATK und 300 DEF.'),
  S('s10', 'Glutfeld', 'field', { buffs: [{ attrs: ['feuer'], atk: 300, def: 0 }, { attrs: ['wasser'], atk: -200, def: 0 }] }, null, 'Feld: Feuer-Monster 300 ATK, Wasser-Monster −200 ATK.'),
  S('s11', 'Tiefseegrund', 'field', { buffs: [{ attrs: ['wasser'], atk: 300, def: 300 }] }, null, 'Feld: Wasser-Monster 300 ATK und 300 DEF.'),
  S('s12', 'Urwald', 'field', { buffs: [{ attrs: ['erde', 'wind'], atk: 200, def: 200 }] }, null, 'Feld: Erde- und Wind-Monster 200 ATK und 200 DEF.'),
  S('s13', 'Wiederkehr', 'normal', { op: 'revive', pos: 'atk' }, null, 'Dein stärkstes Monster im Friedhof kommt in Angriffsposition aufs Feld.', 1),
  S('s14', 'Kriegstrommel', 'cont', { atk: 200 }, null, 'Dauerzauber: Deine Monster erhalten 200 ATK.'),
  // --- Fallen ---
  T('f01', 'Spiegelschild', 'attack', { op: 'destroyAttacker' }, null, 'Greift der Gegner an: Zerstöre das angreifende Monster.', 1),
  T('f02', 'Stolperdraht', 'attack', { op: 'negateAttack' }, null, 'Greift der Gegner an: Der Angriff fällt aus, seine Kampfphase endet.'),
  T('f03', 'Dornengrube', 'summon', { op: 'destroySummoned', min: 1000 }, null, 'Beschwört der Gegner ein Monster mit mindestens 1000 ATK: Zerstöre es.'),
  T('f04', 'Strudel', 'summon', { op: 'bounceSummoned' }, null, 'Beschwört der Gegner ein Monster: Es kehrt auf seine Hand zurück.'),
  T('f05', 'Schutzkuppel', 'attack', { op: 'noDamage' }, null, 'Greift der Gegner an: Du erhältst in diesem Zug keinen Kampfschaden.'),
  T('f06', 'Schwächungsfluch', 'attack', { op: 'weakenAttacker', n: 1000 }, null, 'Greift der Gegner an: Das angreifende Monster verliert bis zum Ende des Zugs 1000 ATK.'),
  T('f07', 'Bannrune', 'any', { op: 'destroy' }, 'st', 'Zerstöre 1 Zauber- oder Fallenkarte auf dem Feld.'),
  T('f08', 'Letzter Ruf', 'any', { op: 'revive', pos: 'def' }, null, 'Dein stärkstes Monster im Friedhof kommt in Verteidigungsposition aufs Feld.', 1),
  T('f09', 'Gegenschlag', 'attack', { op: 'burnHalfAttacker' }, null, 'Greift der Gegner an: Er verliert LP in Höhe der halben ATK des Angreifers.'),
  T('f10', 'Felsriss', 'any', { op: 'destroy' }, 'small', 'Zerstöre 1 offenes Monster mit 1500 ATK oder weniger.'),
];

export const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const isCardId = (id) => typeof id === 'string' && Object.hasOwn(CARD, id);
export const DECK_SIZE = 40;
export const MAX_COPIES = 3;

// Je Kartenart eine Sortierung: Monster nach Stufe, dann Zauber, dann Fallen
const KIND_ORDER = { monster: 0, spell: 1, trap: 2 };
export const sortKey = (id) => {
  const c = CARD[id];
  return KIND_ORDER[c.kind] * 1000 + (c.kind === 'monster' ? c.level * 100 : 0) + CARDS.indexOf(c);
};
export const sortIds = (ids) => [...ids].sort((a, b) => sortKey(a) - sortKey(b));

// Tribute für eine Normalbeschwörung: Stufe 1–4 keiner, 5–6 einer, ab 7 zwei
export const tributesFor = (level) => (level >= 7 ? 2 : level >= 5 ? 1 : 0);

// Deckliste aus { id: Anzahl }
const list = (counts) => Object.entries(counts).flatMap(([id, n]) => Array(n).fill(id));

// Die drei festen Decks (je 40 Karten)
export const DECKS = {
  glut: {
    name: 'Glut',
    info: 'Feuer und Drachen – stark im Angriff',
    list: list({
      g01: 2, g02: 3, g03: 2, g04: 2, g05: 2, g06: 3, g07: 2, g08: 2, g09: 1, g10: 1, n02: 1, n03: 1,
      s01: 2, s03: 1, s05: 1, s06: 1, s07: 2, s10: 1, s13: 1, s14: 1,
      f01: 1, f02: 2, f03: 2, f06: 1, f09: 1, f07: 1,
    }),
  },
  tiefsee: {
    name: 'Tiefsee',
    info: 'Wasser – zäh in der Verteidigung, schickt Monster zurück',
    list: list({
      t01: 3, t02: 2, t03: 2, t04: 2, t05: 3, t06: 2, t07: 2, t08: 2, t09: 1, t10: 1, n01: 1, n04: 1,
      s02: 1, s03: 1, s04: 1, s05: 1, s08: 2, s11: 1, s13: 1,
      f02: 2, f04: 2, f05: 1, f06: 1, f07: 1, f08: 1, f10: 1, f01: 1,
    }),
  },
  wildwald: {
    name: 'Wildwald',
    info: 'Erde und Wind – viele Tiere, Überraschungen beim Aufdecken',
    list: list({
      w01: 2, w02: 2, w03: 2, w04: 2, w05: 3, w06: 2, w07: 2, w08: 2, w09: 2, w10: 1, n05: 1, n06: 1,
      s03: 1, s05: 1, s06: 1, s09: 2, s12: 1, s14: 1, s02: 1,
      f01: 1, f02: 2, f03: 2, f05: 1, f07: 1, f10: 2, f08: 1,
    }),
  },
};

// Ist das eine erlaubte Deckliste? Gibt den Grund zurück (oder '' = in Ordnung)
export function deckProblem(ids) {
  if (!Array.isArray(ids)) return 'Keine Deckliste.';
  if (ids.length !== DECK_SIZE) return `Ein Deck hat genau ${DECK_SIZE} Karten (jetzt ${ids.length}).`;
  const counts = {};
  for (const id of ids) {
    if (!isCardId(id)) return 'Unbekannte Karte im Deck.';
    counts[id] = (counts[id] ?? 0) + 1;
    if (counts[id] > Math.min(MAX_COPIES, CARD[id].max)) return `${CARD[id].name} darf höchstens ${Math.min(MAX_COPIES, CARD[id].max)}-mal ins Deck.`;
  }
  return '';
}

export const countOf = (ids) => ids.reduce((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});
