// Smoke E2E sul sito live: pagina auth, switch registrazione, privacy.
const { test, expect } = require('@playwright/test');

const URL = 'https://wetransport.netlify.app';

test('la pagina di accesso si carica e funziona', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
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
  await page.goto(URL);
  await page.locator('#email').fill('nessuno@esempio.it');
  await page.locator('#password').fill('password-sbagliata');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#auth-message')).toContainText('Email o password non corrette');
});

test('la pagina privacy esiste', async ({ page }) => {
  await page.goto(URL + '/privacy.html');
  await expect(page.locator('h1')).toHaveText('Informativa privacy');
});
