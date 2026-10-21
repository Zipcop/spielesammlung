// Nur für Tests (liegt außerhalb von test/, sonst hielte node --test es für Tests): Spielabläufe aus src/<spiel>/index.js
// ohne Browser. Seitenfeld (panel.js) und „Geschummelt!“-Knopf (cheat-ui.js) werden durch Stellvertreter ersetzt, die
// sich die Knöpfe (ui.panel = Handler von createPanel, ui.cheat = von createCheatUI) und das zuletzt Gezeigte
// (ui.shown = Daten von panel.render) merken. Erst diese Datei laden, dann index.js dynamisch importieren.
import { register } from 'node:module';

const PANEL = 'export function createPanel(root, h) { globalThis.__ui.panel = h; return { render(o) { globalThis.__ui.shown = o; } }; }';
const CHEAT = 'export function createCheatUI(o) { globalThis.__ui.cheat = o; return { update() {}, say() {}, remove() {} }; }';
const HOOKS = `
const url = (src) => 'data:text/javascript,' + encodeURIComponent(src);
const STUBS = { './panel.js': url(${JSON.stringify(PANEL)}), '../cheat-ui.js': url(${JSON.stringify(CHEAT)}) };
export async function resolve(specifier, context, next) {
  if (/\\/src\\/[^/]+\\/index\\.js$/.test(context.parentURL ?? '') && STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

export const ui = (globalThis.__ui = { panel: null, cheat: null, shown: null });
globalThis.document ??= { getElementById: () => ({}), querySelector: () => null };
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };

const noop = () => {};
// Tisch: jede Methode tut nichts, nichts bewegt sich gerade (busy = 0)
export const board = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'busy' ? () => 0 : noop), set: (t, k, v) => ((t[k] = v), true) });
export const room = { onFrame: () => noop, celebrate: noop, rayFrom: noop };
export const canvas = { addEventListener: noop, removeEventListener: noop, style: {} };
export const names = { me: () => 'Nico', other: () => 'Anna' };
export const base = { room, board, canvas, onLeave: noop, ask: noop, names, send: noop };
