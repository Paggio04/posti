// Avviso di rete (cantiere C12), e sta in un file suo per una ragione precisa.
//
// Prima viveva in fondo ad app.js, che come prima riga importa supabase-js da un
// CDN. Senza rete quel modulo puo' non arrivare -- ed e' esattamente quello che ha
// fatto diventare rosso il test in CI: il guscio si apriva dalla cache, ma app.js
// non partiva, quindi la barra che deve dire "sei senza rete" restava nascosta
// **proprio quando serviva**.
//
// La regola che ne esce: l'avviso di mancanza di rete non puo' dipendere da
// qualcosa che ha bisogno della rete. Questo file non importa niente.

const barra = document.getElementById('offline-bar');

function segnala() {
  if (barra) barra.hidden = navigator.onLine;
}

window.addEventListener('offline', segnala);
window.addEventListener('online', () => {
  segnala();
  // Chi ha i dati a schermo li vuole freschi appena torna la linea. Se app.js e'
  // partito raccoglie lui l'evento; se non e' partito, non c'e' niente da
  // ricaricare e questo file ha comunque fatto il suo lavoro.
  window.dispatchEvent(new Event('wt:rete-tornata'));
});

segnala();

// --- Registrazione del service worker (C12) ---
// Sta qui e non in app.js per la stessa ragione della barra: app.js importa un modulo
// da un CDN, e se quello non arriva il worker non si registrerebbe mai -- cioe' l'app
// non diventerebbe apribile offline proprio a chi ha la rete peggiore. Registrato dopo
// il caricamento, per non rubare banda alla prima schermata utile.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* pazienza: l'app funziona */ });
  });
}
