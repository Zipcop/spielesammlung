// Nur für test/tisch.test.js (liegt außerhalb von test/, sonst hielte node --test es für Tests): tisch.js bekommt statt room.js (braucht Fenster und Grafik) und sound.js
// kleine Stellvertreter, damit die Tisch-Physik ohne Browser läuft.
export async function resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/src/tisch.js') && (specifier === './room.js' || specifier === './sound.js')) {
    return { url: new URL(`./stub-${specifier.slice(2)}`, import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
