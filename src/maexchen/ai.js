// Computer-Gegner für Mäxchen: rechnet mit Wahrscheinlichkeiten und würfelt dabei selbst ein wenig.
// Grundlage ist ein Modell, wie jemand ansagt (claimDist): mit einem Wurf über der Vorgabe meist die Wahrheit, ab und
// zu etwas mehr (eher bei kleinen Würfen); muss er lügen, dann knapp über der Vorgabe. Daraus folgt nach Bayes, wie
// wahrscheinlich eine Ansage stimmt (truthChance) – und der Computer zweifelt, wenn Aufdecken ihn im Mittel weniger
// Leben kostet als Glauben. Ein Zufallsanteil (weiche Entscheidung statt fester Schwelle) macht ihn schwer durchschaubar.
import { CLAIMS, MAEXCHEN, rankOf, chanceOf, valueOf, lastClaim } from './game.js';

const N = CLAIMS.length;
const TOP = N - 1; // Rang des Mäxchens
const P = CLAIMS.map(chanceOf);
const AT_LEAST = CLAIMS.map((_, i) => P.slice(i).reduce((a, b) => a + b, 0)); // P(Wurf hat mindestens Rang i)
const CAUGHT = 0.55; // so oft fliegt eine Lüge auf (geschätzt – der Nächste zweifelt oder überbietet sie gar nicht)
const SOFT = 0.07; // je kleiner, desto härter die Entscheidung (0 = immer die rechnerisch bessere)
const LIE_STEPS = [0.5, 0.27, 0.15, 0.08]; // gelogen wird knapp über der Vorgabe
const UP_STEPS = [0.6, 0.3, 0.1]; // etwas mehr angesagt als gewürfelt

// Rangverteilung der Ansage: r = Rang des eigenen Wurfs, p = Rang der Vorgabe (−1 = Runde eröffnen)
export function claimDist(r, p) {
  const d = new Array(N).fill(0);
  const spread = (from, weights, mass) => {
    const ok = weights.map((w, k) => (from + k <= TOP ? w : 0));
    const sum = ok.reduce((a, b) => a + b, 0);
    if (sum) ok.forEach((w, k) => w && (d[from + k] += (mass * w) / sum));
    return sum > 0;
  };
  if (r > p) {
    const up = r < rankOf(54) ? 0.25 : r < rankOf(11) ? 0.12 : 0.04;
    const moved = r < TOP && spread(r + 1, UP_STEPS, up);
    d[r] += moved ? 1 - up : 1;
  } else if (p < TOP) {
    spread(p + 1, LIE_STEPS, 1);
  }
  return d;
}

// Wie wahrscheinlich stimmt die Ansage c (Rang) auf die Vorgabe p (Rang, −1 = eröffnet)?
export function truthChance(c, p) {
  let truth = 0;
  let all = 0;
  for (let r = 0; r < N; r++) {
    const w = P[r] * claimDist(r, p)[c];
    all += w;
    if (r >= c) truth += w;
  }
  return all ? truth / all : 0.5;
}

// Gedächtnis je Partie: Wie oft wurde ein Spieler beim Aufdecken als Lügner entlarvt, wie oft sagt er Mäxchen?
// So fällt auf, wer ständig blufft (z. B. jede Runde mit „Mäxchen“ eröffnet). index.js füttert es mit den Ereignissen.
export function observe(memo, events) {
  const of = (p) => (memo[p] ??= { lies: 0, truths: 0, claims: 0, maex: 0 });
  for (const e of events) {
    if (e.type === 'announce') {
      of(e.player).claims++;
      if (e.value === MAEXCHEN) of(e.player).maex++;
    } else if (e.type === 'doubt') of(e.claimer)[e.truth ? 'truths' : 'lies']++;
  }
  return memo;
}
const BASE_LIES = 0.3; // so oft lügt jemand ungefähr, der wie das Modell spielt
export const lieRate = (m) => (m ? (m.lies + 3) / (m.lies + m.truths + 10) : BASE_LIES);
// Wahrscheinlichkeit t an den Spieler anpassen: Wer öfter lügt als üblich, dem glaubt er weniger. Sagt jemand
// auffällig oft Mäxchen (ehrlich wäre gut jede zehnte Ansage), glaubt er ihm das Mäxchen entsprechend seltener.
function adjust(t, m, claim) {
  const l = lieRate(m);
  const odds = (t / Math.max(1e-6, 1 - t)) * ((1 - l) / l) / ((1 - BASE_LIES) / BASE_LIES);
  const many = claim === MAEXCHEN && m?.maex ? Math.min(1, (0.12 * m.claims + 1) / m.maex) : 1;
  return (odds / (1 + odds)) * many;
}

const soft = (gain, rng) => rng() < 1 / (1 + Math.exp(-gain / SOFT)); // gain > 0: eher ja
const prevRank = (v) => (v.claims.length > 1 ? rankOf(v.claims.at(-2).value) : -1);

// Glauben oder aufdecken? → 'believe' | 'doubt' | 'accept' (Mäxchen ohne Aufdecken glauben).
// known = echter Wert unter dem Becher (nur wenn er gelinst hat) · memo = Gedächtnis (observe)
export function chooseDecision(v, rng = Math.random, known = null, memo = {}) {
  const { value: claim, by } = lastClaim(v);
  const c = rankOf(claim);
  const t = known === null ? adjust(truthChance(c, prevRank(v)), memo[by], claim) : Number(rankOf(known) >= c);
  if (claim === MAEXCHEN) {
    if (known !== null) return t ? 'accept' : 'doubt';
    // aufdecken kostet 2 × t, glauben sicher 1 – ab und zu deckt er trotzdem auf, sonst lernt er Dauer-Bluffer nie kennen
    return rng() < 0.06 || soft(1 - 2 * t, rng) ? 'doubt' : 'accept';
  }
  const believeLoss = (1 - AT_LEAST[c + 1]) * CAUGHT; // ich muss danach höher kommen – sonst lügen
  const doubtLoss = t;
  if (known !== null) return doubtLoss < believeLoss ? 'doubt' : 'believe';
  return soft(believeLoss - doubtLoss, rng) ? 'doubt' : 'believe';
}

// Was sagt er an? v.dice = sein Wurf
export function chooseClaim(v, rng = Math.random) {
  const p = v.claims.length ? rankOf(lastClaim(v).value) : -1;
  const d = claimDist(rankOf(valueOf(v.dice)), p);
  let x = rng();
  for (let i = 0; i < N; i++) {
    x -= d[i];
    if (x < 0) return CLAIMS[i];
  }
  return CLAIMS[Math.min(TOP, p + 1)];
}

// Ohne Hilfen: Lohnt sich Schummeln? Nachwürfeln nur, wenn er sonst lügen müsste; linsen, wenn die Ansage
// wirklich zweifelhaft ist (weder sicher wahr noch sicher gelogen).
export function wantsReroll(v) {
  const p = v.claims.length ? rankOf(lastClaim(v).value) : -1;
  return p >= 0 && rankOf(valueOf(v.dice)) <= p && p < TOP;
}
export function wantsPeek(v, memo = {}) {
  const t = adjust(truthChance(rankOf(lastClaim(v).value), prevRank(v)), memo[lastClaim(v).by], lastClaim(v).value);
  return t > 0.2 && t < 0.8;
}
