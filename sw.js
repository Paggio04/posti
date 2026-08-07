// Service worker (cantiere C12).
//
// Serve a due cose, e a nessun'altra: far aprire l'app anche senza rete, e renderla
// installabile per davvero. Non serve a far finta che i dati ci siano.
//
// La regola che conta e' quella che dice cosa **non** si mette in cache:
//
//  1. Tutto quello che passa da Supabase. Sono dati di persone e token di sessione: una
//     copia in cache sarebbe una copia che nessuno ha chiesto, che l'esportazione non
//     mostra e che "Elimina il mio account" non porta via. Il contrario di C11.
//  2. Tutto quello che non e' GET. Una prenotazione non si rigioca dalla cache.
//
// Quello che si mette in cache e' solo il guscio: i file pubblici, identici per tutti.

const VERSIONE = 'wetransport-v12';  // sale quando cambia il GUSCIO qui sotto
// v10 (06/08/2026): la barra laterale diventa una barra in alto con il tondo che
// scivola, e il riepilogo prende tutta la larghezza senza scorrere. Cambiano
// `index.html`, `style.css` e `app.js`.
// v9 (01/08/2026): si segna un pagamento, la richiesta porta l'ora, il riepilogo del
// mese si manda. Cambiano `index.html`, `style.css` e `app.js`.
// v8 (01/08/2026): tre fasce e due sole soglie in `style.css`, l'avatar del profilo
// ritagliato nel suo cerchio, un nome solo per vista nelle due navigazioni.
// v7 (01/08/2026): barra laterale a cinque voci, riepilogo ricomposto su una griglia
// sola di quattro righe. Cambiano `index.html`, `style.css` e `app.js`.
// v6 (01/08/2026): il guscio si serve **coerente**. Pagina «prima la rete» e file
// «prima la cache» insieme davano, il giorno del rilascio, l'HTML nuovo con il CSS e il
// codice vecchi: barra laterale senza stile in cima alla pagina e Statistiche vuota.
// Il perche' e il come stanno nel gestore `fetch`, in fondo. Non era la VERSIONE a
// mancare: quel numero dice **quale** cache, non **quando** preferirla alla rete.
// v5 (01/08/2026): il riepilogo rifatto sul disegno concordato — barra laterale nuova
// in `index.html`, l'intero blocco della dashboard in `style.css`, `loadStats()`
// riscritta in `app.js`. Tre file del guscio su tre: senza questa riga non l'avrebbe
// visto nessuno di quelli che l'app ce l'hanno gia' aperta.
// v4 (01/08/2026): index.html, style.css e app.js sono cambiati sette volte in un
// pomeriggio — login a pannello, dashboard, tre tabelle nuove — e questa riga era
// rimasta a v3. Chi aveva gia' aperto l'app continuava a vedere il guscio vecchio,
// perche' e' esattamente cio' che una cache fa. E' la seconda volta: la prima sta in
// `85d023e`. Il guscio elencato qui sotto e' contenuto: se cambia, questo numero sale.

const GUSCIO = [
  '/',
  '/index.html',
  '/offline.html',
  '/privacy.html',
  '/style.css',
  '/app.js',
  '/rete.js',
  '/accesso.js',
  '/tema.js',
  '/config.js',
  '/manifest.json',
  '/icon.svg',
  '/icona-192.png',
  '/icona-512.png',
  // I caratteri fanno parte del guscio da quando non arrivano piu' da un CDN: senza,
  // l'app aperta offline ripiegherebbe sul carattere di sistema e sarebbe un'altra app.
  '/fonts/ibm-plex-sans-latin-400-normal.woff2',
  '/fonts/ibm-plex-sans-latin-600-normal.woff2',
  '/fonts/ibm-plex-sans-latin-700-normal.woff2',
  '/fonts/ibm-plex-mono-latin-500-normal.woff2',
];

// app.js importa questo modulo come prima riga: senza, non parte niente. Se resta fuori
// dalla cache, "apre offline" e' una promessa che il primo import smentisce.
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSIONE);
    await cache.addAll(GUSCIO);
    // Il CDN puo' non rispondere adesso, e non e' un motivo per non installarsi: ci
    // riprova al primo caricamento con la rete.
    try { await cache.add(SUPABASE_JS); } catch { /* la prossima volta */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Le versioni vecchie vanno via subito: due gusci diversi mezzi mescolati sono
    // peggio di nessun guscio.
    const nomi = await caches.keys();
    await Promise.all(nomi.filter((n) => n !== VERSIONE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// --- Notifiche push (cantiere C13) ---
// Arrivano anche a scheda chiusa: e' l'unica parte dell'app che gira senza pagina aperta.
// Il messaggio lo costruisce chi lo manda (la Edge Function), qui non si decide niente:
// se il corpo non arriva o non e' JSON si mostra un testo generico invece di non mostrare
// niente, perche' una notifica ricevuta e non mostrata su iOS costa l'iscrizione.
self.addEventListener('push', (e) => {
  let dati = {};
  try { dati = e.data ? e.data.json() : {}; } catch { dati = {}; }
  const titolo = dati.titolo || 'WeTransport';
  const opzioni = {
    body: dati.corpo || 'Qualcosa e\' cambiato nei passaggi di oggi.',
    icon: '/icona-192.png',
    badge: '/icona-192.png',
    // Due notifiche dello stesso tipo si sostituiscono invece di impilarsi: chi torna al
    // telefono dopo un'ora vuole sapere com'e' adesso, non la cronaca.
    tag: dati.tipo || 'wetransport',
    data: { url: dati.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(titolo, opzioni));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destinazione = (e.notification.data && e.notification.data.url) || '/';
  // Se l'app e' gia' aperta da qualche parte si porta in primo piano quella, invece di
  // aprire una seconda copia: sono due schede che parlano allo stesso database.
  e.waitUntil((async () => {
    const aperte = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of aperte) {
      if (new URL(c.url).origin === self.location.origin) return c.focus();
    }
    return self.clients.openWindow(destinazione);
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co')) return;   // dati e sessioni: sempre rete
  // La sonda di rete di rete.js deve passare: se la servissi dalla cache
  // risponderebbe "connesso" anche a chi non ha linea, che e' il contrario del suo
  // scopo. Riconoscibile dal parametro `rete`.
  if (url.searchParams.has('rete')) return;

  // Aprire l'app: prima la rete, perche' una versione nuova va vista appena esiste.
  // Se la rete non c'e', il guscio salvato; e se manca anche quello, la pagina che
  // spiega cosa sta succedendo invece dell'errore del browser.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(VERSIONE);
        return (await cache.match(req, { ignoreVary: true }))
          ?? (await cache.match('/index.html'))
          ?? (await cache.match('/offline.html'))
          ?? Response.error();
      }
    })());
    return;
  }

  // ── Il guscio si serve **coerente**, ed e' il difetto che questa riga chiude ──
  //
  // Prima era tutto «prima la cache»: la pagina pero' e' «prima la rete» (qui sopra).
  // Le due strategie insieme, il giorno di un rilascio, davano questo:
  //
  //     index.html  -> dalla rete  -> quello NUOVO
  //     style.css   -> dalla cache -> quello VECCHIO
  //     app.js      -> dalla cache -> quello VECCHIO
  //
  // cioe' il guscio nuovo vestito e mosso da quello vecchio. Non e' un caso limite:
  // succede **a ogni rilascio**, al primo caricamento, a chiunque abbia gia' aperto
  // l'app. L'1/08 e' costato una pagina con un elenco di bottoni senza stile in cima e
  // la vista Statistiche vuota, perche' il vecchio `loadStats()` cercava un elemento
  // che nel nuovo `index.html` non c'e' piu' e moriva prima di scrivere.
  //
  // Alzare la VERSIONE non bastava e non poteva bastare: quel numero decide **quale**
  // cache si usa, non **quando** la si preferisce alla rete.
  //
  // Quindi: i tre file che devono essere d'accordo fra loro (documento, stile, codice)
  // vanno a rete per primi, con la cache come rete di scorta — offline funziona
  // esattamente come prima. Caratteri e immagini restano «prima la cache»: sono pesanti,
  // non possono essere in disaccordo con niente, e sono il motivo per cui l'app parte
  // subito. Le intestazioni di Netlify sono gia' `max-age=0, must-revalidate`, quindi
  // per il browser questo e' spesso un 304 e non un trasferimento.
  const coerenti = req.destination === 'style' || req.destination === 'script'
    || req.destination === 'document' || url.pathname.endsWith('.json');

  if (url.origin === self.location.origin && coerenti) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSIONE);
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch {
        return (await cache.match(req, { ignoreVary: true })) ?? Response.error();
      }
    })());
    return;
  }

  // Caratteri, icone e il modulo del CDN: prima la cache, cosi' parte subito e parte
  // anche offline, poi si aggiorna in sottofondo per la volta dopo.
  if (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cache = await caches.open(VERSIONE);
      const salvata = await cache.match(req, { ignoreVary: true });
      const dallaRete = fetch(req)
        .then((r) => { if (r.ok) cache.put(req, r.clone()); return r; })
        .catch(() => null);
      return salvata ?? (await dallaRete) ?? Response.error();
    })());
  }
});
