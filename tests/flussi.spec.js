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

// I flussi della Fase 3 — segnalare, bloccare, sbloccare — visti dal browser.
// Le policy corrispondenti sono gia' coperte da supabase/test/verifica-sicurezza.sql:
// qui si prova il cablaggio che solo un browser esegue (il dialogo, i toast, la lista
// dei bloccati, la vista che cambia da sola).
test('segnalare e bloccare: il dialogo, la lista dei bloccati, e la vista che cambia', async ({ browser }) => {
  test.skip(!A || !B || !PW, 'Servono WT_TEST_EMAIL_A, WT_TEST_EMAIL_B e WT_TEST_PASSWORD');
  // Come il test sopra: due schede, molti passi, il realtime da aspettare.
  test.setTimeout(180_000);

  const nomeGruppo = 'Segnalazioni ' + Date.now().toString().slice(-6);
  const destinazione = 'Lago ' + Date.now().toString().slice(-4);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ada = await ctxA.newPage();
  const bruno = await ctxB.newPage();

  const erroriDiPagina = [];
  ada.on('pageerror', (e) => erroriDiPagina.push('A: ' + e.message));
  bruno.on('pageerror', (e) => erroriDiPagina.push('B: ' + e.message));
  // Registrati prima di qualsiasi click: bloccare e uscire dal gruppo passano da
  // confirm(), che senza un ascoltatore Playwright chiude da solo con "annulla".
  ada.on('dialog', (d) => d.accept());
  bruno.on('dialog', (d) => d.accept());

  await entra(ada, A);
  await entra(bruno, B);

  // --- Ada crea la comitiva e pubblica l'auto, Bruno entra col codice ---
  await vaiA(ada, 'groups');
  await ada.locator('#group-create').click();
  await rispondiAlDialogo(ada, nomeGruppo);
  const cardGruppo = ada.locator('.group-card', { hasText: nomeGruppo });
  await expect(cardGruppo).toBeVisible({ timeout: 15000 });
  const codice = (await cardGruppo.locator('.group-code').textContent()).trim();

  await vaiA(ada, 'home');
  await ada.locator('#offer-toggle').click();
  await ada.locator('#ride-destination').fill(destinazione);
  await ada.locator('#save-place-btn').click();
  await expect(ada.locator('.ride-card', { hasText: destinazione })).toBeVisible({ timeout: 15000 });

  await vaiA(bruno, 'groups');
  await bruno.locator('#group-join').click();
  await rispondiAlDialogo(bruno, codice);
  const gruppoDiBruno = bruno.locator('.group-card', { hasText: nomeGruppo });
  await expect(gruppoDiBruno).toBeVisible({ timeout: 15000 });

  // --- Normalizzazione: il blocco e' globale, non per comitiva ---
  // Un giro precedente fallito a meta', o la ripetizione automatica di Playwright
  // (retries: 1), lascerebbe Ada bloccata e il test partirebbe dal caso sbagliato.
  // Si passa dalla scheda della comitiva e non dall'auto: con il blocco in piedi
  // l'auto di Ada non comparirebbe affatto (policy `rides read` della 012), quindi
  // da li' non si potrebbe nemmeno riaprire il dialogo per sbloccarla. Nella scheda
  // il nome resta invece leggibile, per scelta della 012.
  const bottoneBlocca = bruno.locator('#persona-blocca');
  await gruppoDiBruno.locator('.history-chip .chip-report').first().click();
  await expect(bruno.locator('#persona-dialog')).toBeVisible();
  const titolo = (await bruno.locator('#persona-title').textContent()).trim();
  expect(titolo).toContain(': segnala o blocca');
  // Il nome di Ada si legge dal titolo del dialogo invece di essere ricostruito: e'
  // l'unico posto che lo espone gia' pulito, senza il "· bloccato" della scheda.
  const nomeAda = titolo.replace(/:\s*segnala o blocca$/, '').trim();
  expect(nomeAda.length).toBeGreaterThan(0);
  if ((await bottoneBlocca.textContent()).trim() === 'Sblocca') {
    await bottoneBlocca.click();
    await expect(bruno.locator('#toast')).toContainText('di nuovo visibile', { timeout: 15000 });
  } else {
    await bruno.locator('#persona-cancel').click();
  }
  await expect(bruno.locator('#persona-dialog')).toBeHidden();

  // --- Bruno apre il dialogo persona dall'auto di Ada ---
  await vaiA(bruno, 'home');
  const autoDiAda = bruno.locator('.ride-card', { hasText: destinazione });
  await expect(autoDiAda).toBeVisible({ timeout: 15000 });
  await autoDiAda.locator('.chip-report').click();
  await expect(bruno.locator('#persona-dialog')).toBeVisible();
  await expect(bruno.locator('#persona-title')).toContainText(nomeAda);

  // --- Segnalare ---
  // Due esiti, entrambi corretti: l'indice unico parziale `user_reports_una_per_coppia`
  // consente una sola segnalazione aperta per coppia, e chiuderla puo' solo
  // l'amministratore (policy `reports admin` della 012). Al primo giro il messaggio e'
  // il primo, dal secondo in poi il secondo. Pretendere solo il primo sarebbe un test
  // verde una volta e rosso per sempre.
  await bruno.locator('#persona-motivo').selectOption('altro');
  await bruno.locator('#persona-dettagli').fill('Segnalazione generata dal test automatico: ignorare.');
  await bruno.locator('#persona-segnala').click();
  await expect(bruno.locator('#toast'))
    .toHaveText(/Segnalazione inviata|Hai già una segnalazione aperta/, { timeout: 15000 });

  // --- Bloccare ---
  await autoDiAda.locator('.chip-report').click();
  await expect(bruno.locator('#persona-dialog')).toBeVisible();
  await expect(bottoneBlocca).toHaveText('Blocca');
  await bottoneBlocca.click();
  await expect(bruno.locator('#toast')).toContainText('bloccato', { timeout: 15000 });

  // --- L'effetto si vede senza ricaricare: app.js richiama loadRides() ---
  // Va fatto prima che Bruno prenoti un sedile: con un posto preso l'auto resterebbe
  // visibile per scelta (`ho_un_posto()` nella policy `rides read` della 012), e il
  // test sarebbe rosso su un comportamento corretto.
  await expect(autoDiAda).toHaveCount(0, { timeout: 15000 });

  // --- La lista dei bloccati nel Profilo ---
  await vaiA(bruno, 'profile');
  await expect(bruno.locator('#blocked-card')).toBeVisible({ timeout: 15000 });
  const chipAda = bruno.locator('#blocked-list .history-chip', { hasText: nomeAda });
  await expect(chipAda).toBeVisible({ timeout: 15000 });

  // --- La superficie da amministratore non c'e' ---
  // E' l'unica parte di "sospendere" che due account normali possono provare, ed e' una
  // prova vera: nessun altro controllo del repo guarda che quella scheda non venga
  // servita a chi non e' amministratore.
  await expect(bruno.locator('#admin-card')).toBeHidden();

  // --- Sbloccare dalla lista, e l'auto ricompare ---
  await chipAda.locator('.chip-kick').click();
  await expect(bruno.locator('#toast')).toContainText('Persona sbloccata.', { timeout: 15000 });
  await expect(bruno.locator('#blocked-card')).toBeHidden({ timeout: 15000 });
  await vaiA(bruno, 'home');
  await expect(autoDiAda).toBeVisible({ timeout: 15000 });

  expect(erroriDiPagina).toEqual([]);

  // --- Pulizia: Ada ritira l'auto, tutti e due escono dalla comitiva ---
  // La segnalazione non si pulisce da qui: chiuderla puo' solo l'amministratore. Ne
  // resta una sola per coppia, con motivo `altro` e il testo che dice di ignorarla.
  await ada.locator('.ride-card', { hasText: destinazione }).locator('.place-delete:not(.share)').click();
  await expect(ada.locator('.ride-card', { hasText: destinazione })).toHaveCount(0, { timeout: 15000 });
  for (const pagina of [bruno, ada]) {
    await vaiA(pagina, 'groups');
    await pagina.locator('.group-card', { hasText: nomeGruppo }).getByText('Esci dal gruppo').click();
    await expect(pagina.locator('.group-card', { hasText: nomeGruppo })).toHaveCount(0, { timeout: 15000 });
  }

  await ctxA.close();
  await ctxB.close();
});
