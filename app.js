// L'avvio, e nient'altro: chi disegna cosa, e in che ordine.
//
// Fino al 10/09/2026 questo file era l'applicazione intera — 4400 righe, oltre il doppio
// della soglia che l'ADR 001 si era dato. Adesso sono tredici moduli in `mod/`, e qui
// resta `render()`, che e' l'unica funzione che li conosce tutti: e' la radice, e si
// legge come l'indice di cosa succede quando qualcuno entra.
//
// I moduli si chiamano fra loro anche all'indietro (`mod/auth.js` chiama `render()` di
// qui): un ciclo di import, che i moduli ES reggono **a patto che il nome attraversato
// sia una `function` dichiarata** — quelle nascono gia' pronte, mentre a un `const` si
// arriverebbe prima che esista. Per la stessa ragione i valori condivisi si cambiano
// coi setter di `mod/nucleo.js`: a un `let` importato non si assegna.
import { ensureProfile } from './mod/auth.js';
import { loadGroups } from './mod/gruppi.js';
import { appShell, authView, currentDate, currentUser, realtimeChannel, setRealtimeChannel, setRealtimeDate, setRendered } from './mod/nucleo.js';
import { askNotifyPermission, loadRides, setDate, subscribeRealtime } from './mod/passaggi.js';
import { applicaSospensione, loadBlocked } from './mod/persone.js';
import { renderProfile, switchView } from './mod/schede.js';
import { supabase } from './mod/supabase.js';
import { caricaAuto } from './mod/zona.js';

// --- Render root ---
async function render() {
  const loggedIn = !!currentUser;
  setRendered(true);
  authView.classList.toggle('hidden', loggedIn);
  appShell.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    await ensureProfile();
    await loadBlocked();
    applicaSospensione();
    await loadGroups();
    // Prima di renderProfile(), che disegna il garage, e prima che il modulo di
    // pubblicazione possa aprirsi: senza, il menu delle auto resta vuoto fino al
    // primo giro nel Profilo.
    await caricaAuto();
    renderProfile();
    askNotifyPermission();
    subscribeRealtime();
    setDate(currentDate);
    // Solo se nessuna scheda e' gia' aperta. render() finisce dopo una catena di attese
    // (profilo, gruppi): chi tocca una scheda mentre l'app carica si vedeva riportare
    // alla Home, con il tocco annullato. Su telefono lento quella finestra dura secondi.
    if (!document.querySelector('#app-shell .view:not(.hidden)')) switchView('home');
  } else if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    setRealtimeChannel(null);
    setRealtimeDate(null);
  }
}

// La barra "sei senza rete" **non sta qui**, sta in rete.js: dipendeva da questo file,
// che come prima riga importa un modulo da un CDN, quindi senza rete non partiva e
// l'avviso non compariva proprio quando serviva. Qui resta solo cio' che ha davvero
// bisogno dell'app: quando la linea torna, i dati a schermo sono vecchi e si
// ricaricano da soli. L'evento lo annuncia rete.js.
window.addEventListener('wt:rete-tornata', () => {
  if (currentUser) loadRides(true);
});

export {
  render,
};
