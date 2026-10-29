// Steel-Darts: Scheibe, Wertung eines Treffers und Checkout-Wege – rein (kein DOM, kein three.js).
// Maße nach den WDF-Spielregeln (vom DDV übernommen): Bullseye 1,73 m über dem Boden, Abwurflinie 2,37 m waagerecht
// vor der Scheibe (Diagonale 2,93 m). Ringe: Bull 12,7 mm Durchmesser, Single-Bull 31,8 mm, Double- und Triple-Ring
// je 8 mm breit, außen am Double-Draht 170 mm, außen am Triple-Draht 107 mm von der Mitte, Scheibe 451 mm.
// Koordinaten auf der Scheibe in Metern: x nach rechts (vom Werfer aus), y nach oben, Ursprung = Bullseye.

export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]; // im Uhrzeigersinn, 20 oben
export const RING = { bull: 0.00635, outer: 0.0159, trebleIn: 0.099, trebleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, edge: 0.2255 };
export const HANG = { bull: 1.73, oche: 2.37 };

const SEG = (2 * Math.PI) / 20;

// Wert eines Felds: 'T20', 'D16', 'S5', '25' (Single-Bull), 'Bull' (50, zählt als Doppel), 'Miss'
export function value(label) {
  if (label === 'Bull') return 50;
  if (label === '25') return 25;
  const m = /^([SDT])(\d{1,2})$/.exec(label ?? '');
  if (!m || +m[2] < 1 || +m[2] > 20) return 0;
  return +m[2] * { S: 1, D: 2, T: 3 }[m[1]];
}
export const isDouble = (label) => label === 'Bull' || /^D\d/.test(label ?? '');

// Treffer an der Stelle (x, y) → { label, points, double }
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  const hit = (label) => ({ label, points: value(label), double: isDouble(label) });
  if (!(r <= RING.doubleOut)) return hit('Miss');
  if (r <= RING.bull) return hit('Bull');
  if (r <= RING.outer) return hit('25');
  const n = ORDER[Math.floor((((Math.atan2(x, y) + SEG / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / SEG) % 20];
  if (r >= RING.doubleIn) return hit(`D${n}`);
  if (r >= RING.trebleIn && r <= RING.trebleOut) return hit(`T${n}`);
  return hit(`S${n}`);
}

// Mitte eines Felds (dorthin zielt man): Single = großes äußeres Feld
export function centerOf(label) {
  if (label === 'Bull') return [0, 0];
  if (label === '25') return [0, -(RING.bull + RING.outer) / 2];
  const m = /^([SDT])(\d{1,2})$/.exec(label);
  const r = { S: (RING.trebleOut + RING.doubleIn) / 2, D: (RING.doubleIn + RING.doubleOut) / 2, T: (RING.trebleIn + RING.trebleOut) / 2 }[m[1]];
  const a = ORDER.indexOf(+m[2]) * SEG;
  return [r * Math.sin(a), r * Math.cos(a)];
}

// --- Checkout: mit höchstens `darts` Pfeilen genau auf 0, der letzte ein Doppel (Bull zählt als Doppel) ---
const NUMS = Array.from({ length: 20 }, (_, i) => 20 - i);
const THROWS = [...NUMS.flatMap((n) => [`T${n}`, `S${n}`, `D${n}`]), '25', 'Bull'];
const FINISH = [...NUMS.map((n) => `D${n}`), 'Bull'];
// Lieblings-Doppel (gut zu teilen: D20 → D10 → D5, D16 → D8 → D4 …), dahinter der Rest
const DOUBLE_RANK = ['D20', 'D16', 'D8', 'D12', 'D18', 'D10', 'D4', 'D14', 'D6', 'D2', 'Bull', 'D9', 'D15', 'D17', 'D19', 'D13', 'D11', 'D7', 'D5', 'D3', 'D1'];
// Vorbereitende Würfe: Single am leichtesten, dann hohe Triples
const setupCost = (t) => (t[0] === 'S' ? 1 : t[0] === 'T' ? 2 + (20 - +t.slice(1)) * 0.03 : t === '25' ? 3 : 3.5);
const routeCost = (setup, last) => setup.reduce((c, t) => c + setupCost(t), 0) + DOUBLE_RANK.indexOf(last) * 0.12;

const cache = new Map();

// Bester Weg als Liste von Feldern, z. B. 100 → ['T20', 'D20'], 170 → ['T20', 'T20', 'Bull']; null = kein Checkout
export function checkout(rest, darts = 3) {
  const key = `${rest}/${darts}`;
  if (cache.has(key)) return cache.get(key);
  let best = null;
  for (let k = 1; k <= darts && !best; k++) {
    let cost = Infinity;
    const search = (left, setup, from) => {
      if (setup.length === k - 1) {
        for (const d of FINISH) {
          if (value(d) !== left) continue;
          const c = routeCost(setup, d);
          if (c < cost) [cost, best] = [c, [...setup, d]];
        }
        return;
      }
      for (let i = from; i < THROWS.length; i++) { // Reihenfolge egal → nur aufsteigende Indizes (höchste zuerst)
        const v = value(THROWS[i]);
        if (left - v >= 2) search(left - v, [...setup, THROWS[i]], i);
      }
    };
    if (rest >= 2) search(rest, [], 0);
  }
  cache.set(key, best);
  return best;
}

// Höchster Rest mit Checkout und die „Bogey-Zahlen“ darunter, die man mit drei Pfeilen nicht beenden kann
export const MAX_CHECKOUT = 170;
export const canFinish = (rest, darts = 3) => checkout(rest, darts) !== null;
