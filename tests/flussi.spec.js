// Flussi veri, con due utenti in due schede separate: creare una comitiva, pubblicare
// un'auto, entrare col codice, prenotare un sedile, e verificare che chi non e' del
// gruppo non veda niente.
//
// Servono due account di prova gia' confermati, passati da variabili d'ambiente:
//   WT_TEST_EMAIL_A, WT_TEST_EMAIL_B, WT_TEST_PASSWORD
// Senza quelli i test si saltano invece di fallire: non tutti gli ambienti hanno
// un database su cui e' lecito scrivere.
const { test, expect } = require('@playwright/test');

const A = process.env.WT_TEST_EMAIL_A;
const B = process.env.WT_TEST_EMAIL_B;
const PW = process.env.WT_TEST_PASSWORD;

async function entra(page, email) {
  await page.goto('/');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PW);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#app-shell')).toBeVisible({ timeout: 20000 });
}

// Il dialogo custom sostituisce prompt(): un campo e un bottone Conferma.
async function rispondiAlDialogo(page, testo) {
  await expect(page.locator('#app-dialog')).toBeVisible();
  await page.locator('#dialog-input').fill(testo);
  await page.locator('#dialog-ok').click();
  await expect(page.locator('#app-dialog')).toBeHidden();
}

async function vaiA(page, vista) {
  await page.locator(`.nav-item[data-view="${vista}"]`).click();
  await expect(page.locator(`#view-${vista}`)).toBeVisible();
}

test('due utenti, una comitiva: pubblicare, entrare col codice, prenotare un sedile', async ({ browser }) => {
  test.skip(!A || !B || !PW, 'Servono WT_TEST_EMAIL_A, WT_TEST_EMAIL_B e WT_TEST_PASSWORD');
  // Un viaggio completo fra due utenti: molti passi, due schede, il realtime da aspettare.
  // I 30 secondi buoni per uno smoke test qui non bastano.
  test.setTimeout(180_000);

  const nomeGruppo = 'Collaudo ' + Date.now().toString().slice(-6);
  const destinazione = 'Mare ' + Date.now().toString().slice(-4);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ada = await ctxA.newPage();
  const bruno = await ctxB.newPage();

  const erroriA = [];
  ada.on('pageerror', (e) => erroriA.push(e.message));
  bruno.on('pageerror', (e) => erroriA.push('B: ' + e.message));

  await entra(ada, A);
  await entra(bruno, B);

  // --- Ada crea la comitiva ---
  await vaiA(ada, 'groups');
  await ada.locator('#group-create').click();
  await rispondiAlDialogo(ada, nomeGruppo);
  const cardGruppo = ada.locator('.group-card', { hasText: nomeGruppo });
  await expect(cardGruppo).toBeVisible({ timeout: 15000 });
  const codice = (await cardGruppo.locator('.group-code').textContent()).trim();
  expect(codice).toHaveLength(6);

  // --- Ada pubblica la propria auto ---
  await vaiA(ada, 'home');
  await ada.locator('#offer-toggle').click();
  await ada.locator('#ride-destination').fill(destinazione);
  await ada.locator('#save-place-btn').click();
  await expect(ada.locator('.ride-card', { hasText: destinazione })).toBeVisible({ timeout: 15000 });

  // --- Bruno, che non e' del gruppo, non deve vedere niente ---
  await bruno.reload();
  await expect(bruno.locator('#app-shell')).toBeVisible({ timeout: 20000 });
  await expect(bruno.locator('.ride-card', { hasText: destinazione })).toHaveCount(0);

  // --- Bruno entra col codice e a quel punto la vede ---
  await vaiA(bruno, 'groups');
  await bruno.locator('#group-join').click();
  await rispondiAlDialogo(bruno, codice);
  await expect(bruno.locator('.group-card', { hasText: nomeGruppo })).toBeVisible({ timeout: 15000 });
  await vaiA(bruno, 'home');
  const autoDiAda = bruno.locator('.ride-card', { hasText: destinazione });
  await expect(autoDiAda).toBeVisible({ timeout: 15000 });

  // --- Bruno prenota un sedile libero ---
  const sedileLibero = autoDiAda.locator('.seat-free.seat-click').first();
  await expect(sedileLibero).toBeVisible();
  await sedileLibero.click();
  await expect(autoDiAda.locator('.seat-mine')).toBeVisible({ timeout: 15000 });
  await expect(autoDiAda).toContainText('Sei a bordo');

  // --- Ada lo vede senza ricaricare: e' il realtime ---
  await expect(ada.locator('.ride-card', { hasText: destinazione }).locator('.seat-taken'))
    .toBeVisible({ timeout: 20000 });

  expect(erroriA).toEqual([]);

  // --- Pulizia: Ada annulla il passaggio, tutti e due escono dal gruppo ---
  ada.on('dialog', (d) => d.accept());
  bruno.on('dialog', (d) => d.accept());
  await ada.locator('.ride-card', { hasText: destinazione }).locator('.place-delete:not(.share)').click();
  await expect(ada.locator('.ride-card', { hasText: destinazione })).toHaveCount(0, { timeout: 15000 });
  for (const [pagina, nome] of [[bruno, 'B'], [ada, 'A']]) {
    await vaiA(pagina, 'groups');
    await pagina.locator('.group-card', { hasText: nomeGruppo }).getByText('Esci dal gruppo').click();
    await expect(pagina.locator('.group-card', { hasText: nomeGruppo })).toHaveCount(0, { timeout: 15000 });
    expect(nome).toBeTruthy();
  }

  await ctxA.close();
  await ctxB.close();
});
