// Smoke E2E: pagina auth, switch registrazione, privacy.
// L'indirizzo arriva da playwright.config.js (BASE_URL): l'anteprima della PR in CI,
// il sito vivo se non specificato.
const { test, expect } = require('@playwright/test');

test('la pagina di accesso si carica e funziona', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#auth-card')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Bentornato');

  await page.locator('#mode-signup').click();
  await expect(page.locator('#name-label')).toBeVisible();
  await expect(page.locator('#auth-submit')).toHaveText('Crea account');

  await page.locator('#mode-login').click();
  await expect(page.locator('#name-label')).toBeHidden();
  expect(errors).toEqual([]);
});

test('login con credenziali sbagliate mostra errore chiaro', async ({ page }) => {
  await page.goto('/');
  await page.locator('#email').fill('nessuno@esempio.it');
  await page.locator('#password').fill('password-sbagliata');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('Email o password non corrette');
});

test('la pagina privacy esiste', async ({ page }) => {
  await page.goto('/privacy.html');
  await expect(page.locator('h1')).toHaveText('Informativa privacy');
});

// Questo test nasce da un bug vero, e nessun controllo del repo lo vedeva: la
// Permissions-Policy diceva `geolocation=()`, cioe' allowlist vuota, cioe' funzione
// spenta *anche per la pagina stessa*. Da C9 la posizione serve, quindi "Parto da qui"
// era rotto in produzione e con lui tutti i passaggi in zona. Lint, sintassi e test sul
// database erano verdi: un header non e' ne' codice ne' schema, e solo un browser lo vede.
test('la posizione non e\' spenta dagli header', async ({ browser }) => {
  const ctx = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 45.07, longitude: 7.69 },
  });
  const page = await ctx.newPage();
  await page.goto('/');
  const esito = await page.evaluate(() => new Promise((resolve) => {
    if (!navigator.geolocation) { resolve('assente'); return; }
    navigator.geolocation.getCurrentPosition(
      () => resolve('ok'),
      (e) => resolve(`fallito: ${e.message}`),
      { timeout: 5000 },
    );
  }));
  // Il permesso e' concesso dal contesto: se fallisce non e' l'utente, e' la policy.
  expect(esito).toBe('ok');
  await ctx.close();
});
