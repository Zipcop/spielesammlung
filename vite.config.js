import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade: dieselbe Fassung läuft unter jeder Adresse – lokal (npm run dev:lan) wie auf GitHub Pages
  // (https://<name>.github.io/spielesammlung/)
  base: './',
  // Bauzeit als Versionsnummer für den Offline-Speicher (public/sw.js)
  define: { __BUILD__: JSON.stringify(Date.now().toString(36)) },
});
