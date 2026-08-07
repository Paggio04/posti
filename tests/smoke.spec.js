// Smoke E2E: pagina auth, switch registrazione, privacy.
// L'indirizzo arriva da playwright.config.js (BASE_URL): l'anteprima della PR in CI,
// il sito vivo se non specificato.
const { test, expect } = require('@playwright/test');

test('la pagina di accesso si carica e funziona', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#auth-card')).toBeVisible();
  await expect(page.locator('#auth-title')).toHaveText('Chi guida oggi?');

  await page.locator('#mode-signup').click();
  await expect(page.locator('#name-label')).toBeVisible();
  await expect(page.locator('#auth-submit')).toHaveText('Crea account');

  await page.locator('#mode-login').click();
  await expect(page.locator('#name-label')).toBeHidden();
  expect(errors).toEqual([]);
});

// Il difetto che ha fatto rifare questa schermata: sul telefono il pannello del
// marchio occupava tutto il primo schermo e la casella dell'email cominciava sotto la
// piega. Chi apre l'app per entrarci doveva scorrere per trovare dove si entra.
// Questo test non guarda com'e' fatta la pagina, guarda che quella cosa non torni.
test('sul telefono si entra senza scorrere', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  for (const id of ['#email', '#password', '#auth-submit']) {
    const riquadro = await page.locator(id).boundingBox();
    expect(riquadro, `${id} non e' sulla pagina`).not.toBeNull();
    expect(riquadro.y + riquadro.height, `${id} finisce sotto la piega`).toBeLessThanOrEqual(780);
  }
});

// Le conferme distruttive passavano da `confirm()` del browser: non si puo' scrivere
// sopra («OK» dove serve «Esci dall'account»), mostra l'indirizzo del sito in cima, e
// in qualche browser dentro un'altra app arriva soppressa. Ora e' il dialogo dell'app.
test('uscire dall\'account chiede conferma con un bottone che dice cosa fa', async ({ page }) => {
  await page.goto('/');
  // Nessun accesso vero: si scopre il guscio e si tocca il bottone, che e' quanto
  // basta perche' il dialogo sia quello dell'app e non quello del browser.
  await page.evaluate(() => {
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('view-profile').classList.remove('hidden');
  });
  await page.locator('#profile-logout').click();
  await expect(page.locator('#app-dialog')).toBeVisible();
  await expect(page.locator('#dialog-ok')).toHaveText('Esci dall\'account');
  // Il campo di testo non c'entra niente con una conferma e non deve comparire.
  await expect(page.locator('#dialog-input')).toBeHidden();
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

// C12: "installabile e si apre offline" e' una promessa che si verifica solo staccando la
// rete. Il worker mette in cache il guscio, non i dati — qui si controlla che il guscio
// basti a far comparire l'app, non che i passaggi ci siano: quelli senza rete non esistono.
test('l\'app si apre anche senza rete', async ({ page, context }) => {
  await page.goto('/');
  const scope = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return r.active ? r.scope : null;
  });
  expect(scope).not.toBeNull();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#auth-view')).toBeAttached();
  // E lo deve dire, invece di mostrare una schermata ferma senza spiegazioni.
  await expect(page.locator('#offline-bar')).toBeVisible();
  await context.setOffline(false);
});

// C18: file che esistono o non esistono, e quando non esistono nessuno se ne accorge
// guardando l'app — si vede solo da fuori, mesi dopo, in una ricerca.
test('robots.txt e sitemap.xml ci sono e si parlano', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const testo = await robots.text();
  expect(testo).toContain('Sitemap: https://wetransport.netlify.app/sitemap.xml');
  // La pagina "senza rete" indicizzata sembrerebbe un'app rotta a chi la trova cercando.
  expect(testo).toContain('Disallow: /offline.html');

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  // Ogni indirizzo elencato deve rispondere davvero: un sitemap con un 404 dentro e' peggio
  // che non averlo, perche' dice al motore di ricerca una cosa falsa.
  for (const loc of [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
    expect((await request.get(loc)).status(), loc).toBe(200);
  }
});

// L'interruttore del tema, e il motivo per cui questo test esiste: il gesto vive
// in `app.js`, e nessun controllo del repo lo guardava. Lint vede che la funzione
// compila, il controllo del contrasto vede che i due temi reggono le soglie — ma
// che *toccare il bottone* cambi davvero il tema, ribalti `aria-pressed` e giri la
// faccia della targa lo vede solo un browser. Ed e' un bottone in cima a ogni
// schermata dell'app.
//
// Guarda quattro cose insieme perche' sono la stessa cosa detta a chi guarda, a chi
// ascolta e a chi rilegge: il tema sulla radice, lo stato in `aria-pressed`, la
// faccia mostrata (che e' **dove andresti**, non dove sei) e la classe che fa
// partire la voltata. La quinta e' che la scelta resti scelta dopo un ricaricamento.
test('l\'interruttore del tema gira la pagina, e la scelta resta', async ({ page }) => {
  await page.goto('/');
  // Nessun accesso vero: si scopre il guscio, che e' dove sta la barra in alto.
  await page.evaluate(() => {
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  });

  const tasto = page.locator('#tema-tasto');
  // L'app nasce chiara, quindi il bottone mostra la luna: dove andresti.
  await expect(tasto).toHaveAttribute('aria-pressed', 'false');
  expect(await tasto.locator('use').getAttribute('href')).toBe('#i-luna');
  // Al primo disegno non deve girare niente: non c'e' stato nessun cambio da dire.
  expect(await tasto.locator('svg').getAttribute('class')).toBeNull();

  await tasto.click();

  await expect(page.locator('html')).toHaveAttribute('data-tema', 'scuro');
  await expect(tasto).toHaveAttribute('aria-pressed', 'true');
  await expect(tasto).toHaveAttribute('aria-label', 'Passa al tema chiaro');
  expect(await tasto.locator('use').getAttribute('href')).toBe('#i-sole');
  // E la targa si volta, nel verso di dove sei andato.
  expect(await tasto.locator('svg').getAttribute('class')).toBe('volta al-buio');

  // La scelta e' scritta, e `tema.js` la applica prima che il browser dipinga.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-tema', 'scuro');
});

test('la pagina 404 risponde 404 e non si fa indicizzare', async ({ request }) => {
  const r = await request.get('/questo-indirizzo-non-esiste');
  expect(r.status()).toBe(404);
  expect(await r.text()).toContain('Questa pagina non c\'è');
});

test('il manifest dichiara le icone PNG che servono a installarla', async ({ request }) => {
  const manifest = await (await request.get('/manifest.json')).json();
  const misure = manifest.icons.map((i) => i.sizes);
  // Solo l'SVG non basta: diversi sistemi lo ignorano e mostrano un quadrato vuoto.
  expect(misure).toContain('192x192');
  expect(misure).toContain('512x512');
  // E senza almeno una `maskable`, Android disegna l'icona dentro un quadratino bianco
  // invece che a tutta forma: si vede un francobollo in mezzo al cerchio.
  expect(manifest.icons.some((i) => (i.purpose || '').split(' ').includes('maskable'))).toBe(true);
  for (const icona of manifest.icons) {
    expect((await request.get('/' + icona.src)).status()).toBe(200);
  }
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
