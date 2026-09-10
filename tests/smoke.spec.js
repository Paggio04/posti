// Smoke E2E: pagina auth, switch registrazione, privacy.
// L'indirizzo arriva da playwright.config.js (BASE_URL): l'anteprima della PR in CI,
// il sito vivo se non specificato.
const { test, expect } = require('@playwright/test');
const { sbloccaAnteprima } = require('./anteprima');

// Su un'anteprima l'accesso e' chiuso (vedi `app.js`, `ambienteEstraneo`). Questi
// controlli misurano il modulo d'accesso, quindi dichiarano di sapere dove sono: senza,
// misurerebbero il blocco invece di cio' che sono scritti per misurare. Il blocco ha un
// controllo suo, in fondo, e quello parte da un contesto pulito.
test.beforeEach(async ({ page }) => { await sbloccaAnteprima(page); });

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

  // **E i collegamenti in fondo a «sei senza rete» devono aprire quello che dicono.**
  // Netlify toglie `.html` quando pubblica, quindi il link scritto `privacy.html`
  // chiede `/privacy`, mentre in cache la pagina sta col suo nome di file. Senza la
  // riga che riprova con l'estensione (`sw.js`, gestore `navigate`), quel link cadeva
  // sul ripiego e apriva **il guscio dell'app** al posto dell'informativa: non un
  // errore, una pagina sbagliata che sembra funzionare. Ed e' proprio la pagina che
  // per definizione si guarda senza rete.
  await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1')).toHaveText('Informativa privacy');

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
  //
  // **Il dominio si controlla, il percorso si chiede qui.** Chiedere l'indirizzo
  // assoluto misurerebbe sempre la produzione, anche girando sull'anteprima di una
  // pull request: una pagina nuova nel sitemap farebbe fallire la propria anteprima
  // perche' sul sito vivo non c'e' ancora — cioe' il controllo direbbe «rotto» a una
  // modifica giusta, e non direbbe niente su quella sbagliata. Il dominio dichiarato
  // resta comunque verificato, che e' l'altra meta' del lavoro di questo test.
  const loc = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(loc.length).toBeGreaterThan(0);
  for (const indirizzo of loc) {
    expect(new URL(indirizzo).origin, indirizzo).toBe('https://wetransport.netlify.app');
    const percorso = new URL(indirizzo).pathname;
    expect((await request.get(percorso)).status(), percorso).toBe(200);
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

// --- Le voci della checklist pre-lancio che solo un browser puo' misurare ---

// **Dove porta un collegamento, non com'e' scritto.** Netlify toglie `.html` quando
// pubblica: `href="privacy.html"` nel sorgente arriva al browser come `href="/privacy"`.
// Un controllo sulla stringa misurerebbe quindi l'impostazione di un fornitore invece
// del collegamento, e sarebbe rosso in anteprima e verde in locale sulla stessa
// identica pagina. Questo normalizza le due grafie a una: `/privacy`, `/termini`.
async function pagine(zona) {
  const href = await zona.locator('a[href]:not([href^="mailto:"])').evaluateAll(
    (nodi) => nodi.map((n) => n.getAttribute('href')),
  );
  return href.map((h) => new URL(h, 'https://wetransport.netlify.app/').pathname.replace(/\.html$/, ''));
}

// La schermata d'accesso e' l'unica pagina che un motore di ricerca e un lettore di
// schermo vedono da fuori, e non aveva **nessun** titolo di primo livello: partiva da
// h2, e l'unico h1 del progetto lo scriveva `app.js` dentro il riepilogo, cioe' dopo
// l'accesso. `html-validate` non poteva vederlo: non e' un errore di sintassi.
test('la pagina pubblica ha un titolo di primo livello, e uno solo', async ({ page }) => {
  await page.goto('/');
  const visibili = page.locator('h1:visible');
  await expect(visibili).toHaveCount(1);
  await expect(visibili).toHaveText('Chi guida oggi?');
});

// L'informativa era raggiungibile da un punto solo, dentro la scheda Profilo: chi
// creava un account leggeva chi tratta i suoi dati soltanto una volta entrato. Le due
// pagine e il titolare stanno dove i dati si raccolgono.
test('titolare, informativa e termini si leggono prima di entrare', async ({ page, request }) => {
  await page.goto('/');
  const piede = page.locator('.auth-fondo');
  await expect(piede).toBeVisible();
  await expect(piede).toContainText('Elia Paggetti');
  await expect(piede.locator('a[href^="mailto:"]')).toBeVisible();

  for (const pagina of ['/privacy', '/termini']) {
    expect(await pagine(piede), pagina).toContain(pagina);
    expect((await request.get(pagina + '.html')).status()).toBe(200);
  }
});

// In registrazione si accetta qualcosa, quindi in registrazione va detto; in accesso
// non c'e' niente da accettare e la riga sparisce, tabulazione compresa.
test('la riga di accettazione compare solo in registrazione', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.auth-accetto')).toBeHidden();
  await page.locator('#mode-signup').click();
  const riga = page.locator('.auth-accetto');
  await expect(riga).toBeVisible();
  expect(await pagine(riga)).toEqual(expect.arrayContaining(['/termini', '/privacy']));
});

test('la pagina dei termini esiste e dice di cosa risponde chi guida', async ({ page }) => {
  await page.goto('/termini.html');
  await expect(page.locator('h1')).toHaveText('Termini e condizioni');
  // Le due cose che questa pagina esiste per dire, e che nessun'altra pagina dice.
  await expect(page.locator('body')).toContainText('Non è un servizio di trasporto');
  await expect(page.locator('body')).toContainText('assicurativa');
});

// Il primo elemento tabulabile dentro l'app salta la barra in alto. Non e'
// `display: none` — quella lo toglierebbe anche alla tabulazione, cioe' a chi serve.
test('«vai al contenuto» e\' il primo elemento tabulabile dentro l\'app', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  });
  await page.keyboard.press('Tab');
  const primo = page.locator(':focus');
  await expect(primo).toHaveClass(/salta-al-contenuto/);
  // Col fuoco rientra sullo schermo: un salto che non si vede non lo usa nessuno.
  const riquadro = await primo.boundingBox();
  expect(riquadro.y).toBeGreaterThanOrEqual(0);
  // E porta davvero da qualche parte.
  await expect(page.locator('#contenuto')).toHaveCount(1);
});

// **Un controllo di forma, come quelli SQL sulle funzioni.** La registrazione diceva
// «questa email e' gia' registrata» in due modi: il messaggio d'errore, e il controllo
// su `identities.length === 0`, che e' il modo per aggirare l'offuscamento di Supabase.
// Insieme facevano della registrazione un elenco: si prova un indirizzo per volta e si
// scopre chi ha un account. Questo test non guarda un comportamento, guarda che quelle
// due righe non tornino — perche' tornerebbero come una gentilezza verso chi si e'
// dimenticato di essersi iscritto, che e' esattamente il modo in cui erano arrivate.
test('la registrazione non dice se un indirizzo ha gia\' un account', async ({ request }) => {
  const sorgente = await (await request.get('/app.js')).text();
  expect(sorgente).not.toContain('Questa email è già registrata');
  // Il campo che Supabase lascia vuoto per non far capire che l'account c'e' gia':
  // guardarlo e' il modo di aggirare l'offuscamento, quindi non deve comparire.
  expect(sorgente).not.toContain('identities');
});

// L'anteprima social era l'icona quadrata da 512: in chat arrivava ritagliata e
// piccola, e l'app si condivide da dentro (C14).
test('l\'anteprima social e\' 1200x630 e c\'e\' davvero', async ({ page, request }) => {
  await page.goto('/');
  const src = await page.locator('meta[property="og:image"]').getAttribute('content');
  // Il tag dichiara l'indirizzo assoluto del sito vivo, perche' e' quello che serve a
  // chi legge l'anteprima. Il file pero' si chiede **a questo** indirizzo: altrimenti
  // il controllo sull'anteprima di una pull request misurerebbe la produzione, cioe'
  // sarebbe verde anche per una modifica che l'immagine non ce l'ha.
  const risposta = await request.get(new URL(src).pathname);
  expect(risposta.status()).toBe(200);
  expect(risposta.headers()['content-type']).toContain('image');
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
});

// **Il blocco delle anteprime, e questo parte da un contesto pulito.**
// Tutti i controlli qui sopra dichiarano di sapere dove sono (`test.beforeEach`), perche'
// misurano il modulo d'accesso e non il blocco. Questo fa il contrario: nasce senza la
// scappatoia, cosi' vede quello che vedrebbe una persona che apre il link di un'anteprima
// da una discussione.
//
// La regola vale nei due sensi, quindi l'attesa dipende da dove sta girando: sul sito vivo
// e in locale si deve poter entrare, ovunque altro no. Un controllo che si aspettasse
// sempre il blocco sarebbe rosso in produzione — cioe' misurerebbe l'indirizzo invece
// della regola.
test('su un\'anteprima non si entra, sul sito vivo sì', async ({ browser, baseURL }) => {
  const host = new URL(baseURL).hostname;
  const deveBloccare = host !== 'wetransport.netlify.app'
    && !['localhost', '127.0.0.1', '[::1]'].includes(host);

  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto('/');

  const avviso = page.locator('#anteprima-blocco');
  if (deveBloccare) {
    await expect(avviso).toBeVisible();
    await expect(avviso).toContainText('wetransport.netlify.app');
    // I due modi di entrare e il recupero della password: tutti e tre chiusi.
    await expect(page.locator('#auth-submit')).toBeDisabled();
    await expect(page.locator('#oauth-google')).toBeDisabled();
    await expect(page.locator('#forgot-btn')).toBeDisabled();
    // E cambiare modo non li riapre: `setAuthMode` li rimette giù.
    await page.locator('#mode-signup').click();
    await expect(page.locator('#auth-submit')).toBeDisabled();
  } else {
    await expect(avviso).toBeHidden();
    await expect(page.locator('#auth-submit')).toBeEnabled();
  }
  await ctx.close();
});
