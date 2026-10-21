// Computer für Memory: Er sieht nur, was offen auf dem Tisch lag (seine Sicht viewFor) und merkt es sich mehr oder
// weniger gut. Gedächtnis = Map Platz → Motiv. Jedes aufgedeckte Kärtchen behält er mit der Wahrscheinlichkeit see,
// vor jedem eigenen Zug vergisst er jedes gemerkte mit forget. Stufen: wie gut er sich die Kärtchen merkt.
// Spielweise: Kennt er ein Paar, deckt er es auf; sonst ein unbekanntes Kärtchen; zum ersten das passende, wenn er es
// kennt – sonst wieder ein unbekanntes (nie ein bekanntes, das nicht passt).
export const LEVELS = [
  { name: 'Vergesslich', see: 0.55, forget: 0.3 },
  { name: 'Mittel', see: 0.8, forget: 0.12 },
  { name: 'Fast perfekt', see: 1, forget: 0.02 },
];

// Neue Ereignisse ansehen: aufgedeckte Kärtchen (und beim eigenen Linsen das Motiv) merken, eingesteckte vergessen
export function remember(mem, events, level, seat, rng = Math.random) {
  const next = new Map(mem);
  const { see } = LEVELS[level];
  for (const e of events) {
    if (e.type === 'flip' && rng() < see) next.set(e.i, e.motif);
    else if (e.type === 'peek' && e.by === seat && e.motif !== null) next.set(e.i, e.motif); // eben selbst gelinst – sicher
    else if (e.type === 'pair' || e.type === 'pocket') for (const k of e.tiles) next.delete(k);
  }
  return next;
}

// Vor dem eigenen Zug: manches ist wieder weg
export function fade(mem, level, rng = Math.random) {
  const { forget } = LEVELS[level];
  return new Map([...mem].filter(() => rng() >= forget));
}

// Bekannt = gemerkt oder gerade offen zu sehen (nur Kärtchen, die noch liegen)
export function known(v, mem) {
  const out = new Map();
  v.tiles.forEach((m, k) => {
    if (v.owner[k] !== null) return;
    if (m !== null) out.set(k, m);
    else if (mem.has(k)) out.set(k, mem.get(k));
  });
  return out;
}

// Platz eines bekannten Kärtchens mit Motiv m (außer except) – oder undefined
export function partner(v, mem, m, except) {
  for (const [k, x] of known(v, mem)) if (x === m && k !== except && !v.open.includes(k)) return k;
  return undefined;
}

// Welches Kärtchen als Nächstes? v = Sicht des Computers (er ist dran)
export function chooseFlip(v, mem, rng = Math.random) {
  const free = [];
  v.owner.forEach((o, k) => o === null && !v.open.includes(k) && free.push(k));
  const kn = known(v, mem);
  const unknown = free.filter((k) => !kn.has(k));
  const pick = (list) => list[Math.floor(rng() * list.length)];
  if (v.open.length === 1) {
    const first = v.open[0];
    const k = partner(v, mem, v.tiles[first], first);
    if (k !== undefined) return k;
  } else {
    // bekanntes Paar?
    const seen = new Map();
    for (const k of free) {
      if (!kn.has(k)) continue;
      const m = kn.get(k);
      if (seen.has(m)) return seen.get(m);
      seen.set(m, k);
    }
  }
  return pick(unknown.length ? unknown : free);
}

// Ohne Hilfen (allein): lohnt sich Linsen? Nach dem ersten Kärtchen, wenn er das passende nicht kennt –
// er linst unter ein unbekanntes Kärtchen. Gibt den Platz zurück oder null.
export function peekTarget(v, mem, rng = Math.random) {
  if (v.open.length !== 1 || partner(v, mem, v.tiles[v.open[0]], v.open[0]) !== undefined) return null;
  const kn = known(v, mem);
  const list = [];
  v.owner.forEach((o, k) => o === null && !v.open.includes(k) && !kn.has(k) && list.push(k));
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}
