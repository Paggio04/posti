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
  },
});
