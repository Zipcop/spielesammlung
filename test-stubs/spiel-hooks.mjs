// Nur für test/kniffel-hand.test.js, test/maedn-wuerfel.test.js und test/staub.test.js (liegt außerhalb von test/, sonst
// hielte node --test es für Tests): src/kniffel/board.js, src/maedn/dice.js und src/effects.js bekommen statt Texturen
// (Canvas), Ton und Leuchten kleine Stellvertreter.
const PARENTS = ['/src/kniffel/board.js', '/src/maedn/dice.js', '/src/effects.js'];
const STUBS = { '../textures.js': 'stub-textures.js', './textures.js': 'stub-textures.js', '../sound.js': 'stub-sound.js', '../glow.js': 'stub-glow.js' };

export async function resolve(specifier, context, next) {
  if (PARENTS.some((p) => context.parentURL?.endsWith(p)) && STUBS[specifier]) {
    return { url: new URL(`./${STUBS[specifier]}`, import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
