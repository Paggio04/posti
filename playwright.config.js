// Configurazione Playwright. L'indirizzo da collaudare arriva da BASE_URL:
// in CI e' l'anteprima della pull request, in locale il sito vivo se non specificato.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1, // una ripetizione assorbe la rete ballerina, non nasconde un test rotto
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://wetransport.netlify.app',
    screenshot: 'only-on-failure',
    // Solo per ambienti che escono in rete da un proxy: in CI non serve e resta spento.
    proxy: process.env.PW_PROXY ? { server: process.env.PW_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
  },
});
