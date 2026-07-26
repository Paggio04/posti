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

const VERSIONE = 'wetransport-v1';

const GUSCIO = [
  '/',
  '/index.html',
  '/offline.html',
  '/privacy.html',
  '/style.css',
  '/app.js',
  '/rete.js',
  '/config.js',
  '/manifest.json',
  '/icon.svg',
  '/icona-192.png',
  '/icona-512.png',
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co')) return;   // dati e sessioni: sempre rete

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

  // Il resto del guscio: prima la cache, cosi' parte subito e parte anche offline, poi
  // si aggiorna in sottofondo per la volta dopo.
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
