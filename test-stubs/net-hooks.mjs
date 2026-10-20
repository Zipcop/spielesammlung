// Nur für test/net.test.js (liegt außerhalb von test/, sonst hielte node --test es für Tests):
// src/net.js bekommt statt PeerJS den Stellvertreter stub-peerjs.js (Vermittlung im Arbeitsspeicher).
export async function resolve(specifier, context, next) {
  if (specifier === 'peerjs' && context.parentURL?.endsWith('/src/net.js')) {
    return { url: new URL('./stub-peerjs.js', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
