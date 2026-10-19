// Stockfish 19 (Lite, WASM, ein Thread) als Web Worker – spricht das UCI-Textprotokoll.
// Die Dateien werden erst geladen, wenn gerechnet wird: Computer-Gegner oder Zuganalyse (allein und zu zweit).
// Lizenz: GPLv3, siehe public/lizenzen/stockfish-GPLv3.txt.
import engineUrl from 'stockfish/bin/stockfish-19-lite-single.js?url';
import wasmUrl from 'stockfish/bin/stockfish-19-lite-single.wasm?url';

// options: UCI-Optionen, z. B. { 'Skill Level': 5 }
export function createEngine(options = {}) {
  const worker = new Worker(`${engineUrl}#${encodeURIComponent(wasmUrl)}`); // hinter # steht, wo die WASM-Datei liegt
  let onLine = () => {};
  worker.onmessage = (e) => onLine(String(e.data));
  const post = (cmd) => worker.postMessage(cmd);

  // Auf eine Antwortzeile warten, die so anfängt; jede Zeile davor geht an each()
  const until = (start, each = () => {}) => new Promise((resolve) => {
    onLine = (line) => {
      each(line);
      if (line.startsWith(start)) resolve(line);
    };
  });

  let queue = (async () => {
    post('uci');
    await until('uciok');
    for (const [name, value] of Object.entries(options)) post(`setoption name ${name} value ${value}`);
    post('isready');
    await until('readyok');
  })();

  // Stellung rechnen lassen (Aufträge laufen nacheinander). Liefert den besten Zug als UCI-Text,
  // die Bewertung aus Sicht der Seite am Zug ({ cp } oder { mate }) und – mit Option MultiPV – die
  // besten Varianten: lines[0] = beste, lines[1] = zweitbeste, je { score, pv: [Züge] }.
  function analyse(fen, go) {
    const job = queue.then(async () => {
      const lines = [];
      post(`position fen ${fen}`);
      post(`go ${go}`);
      const line = await until('bestmove', (l) => {
        const m = l.match(/^info .*\bscore (cp|mate) (-?\d+)\b(?! (lower|upper)bound)/);
        if (!m) return;
        const k = Number(l.match(/\bmultipv (\d+)/)?.[1] ?? 1) - 1;
        lines[k] = { score: { [m[1]]: Number(m[2]) }, pv: l.match(/ pv (.+)$/)?.[1].split(' ') ?? [] };
      });
      return { best: line.split(' ')[1], score: lines[0]?.score ?? null, lines };
    });
    queue = job.catch(() => {});
    return job;
  }

  // cancel: laufende Suche sofort beenden (ihr Ergebnis wird dann verworfen)
  return { analyse, cancel: () => post('stop'), stop: () => worker.terminate() };
}
