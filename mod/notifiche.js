// Gli avvisi sul telefono (C13)
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { currentUser, friendlyError, toast } from './nucleo.js';
import { VAPID_PUBLIC_KEY, supabase } from './supabase.js';

// --- Avvisi sul telefono (cantiere C13, decisione D5) ---
// Il browser parla con il servizio push del produttore (Google, Apple, Mozilla) e ne
// riporta un "endpoint": un indirizzo a cui si puo' scrivere per far vibrare **questo**
// dispositivo. Quello che si salva qui e' l'endpoint, non un permesso globale: chi usa
// l'app da telefono e da portatile ha due iscrizioni, e spegnerne una non tocca l'altra.
//
// Tutto degrada in silenzio: se la chiave pubblica non c'e', se il browser non sa fare
// push (iOS fuori dalla schermata home), o se il worker non e' registrato, la scheda resta
// nascosta invece di offrire un interruttore che non accende niente.
const notifichePossibili = () => Boolean(VAPID_PUBLIC_KEY)
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// La chiave viaggia in base64url e il browser la vuole in byte.
function chiaveInByte(base64url) {
  const base64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const grezza = atob(base64);
  return Uint8Array.from([...grezza].map((c) => c.charCodeAt(0)));
}

async function iscrizioneCorrente() {
  if (!notifichePossibili()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

async function renderNotifiche() {
  const card = document.getElementById('notifiche-card');
  if (!card) return;
  if (!notifichePossibili()) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const stato = document.getElementById('notifiche-stato');
  const attiva = document.getElementById('notifiche-attiva');
  const spegni = document.getElementById('notifiche-spegni');
  const iscritto = Boolean(await iscrizioneCorrente());

  attiva.classList.toggle('hidden', iscritto);
  spegni.classList.toggle('hidden', !iscritto);
  if (Notification.permission === 'denied') {
    stato.textContent = 'Gli avvisi sono bloccati nelle impostazioni del browser: da qui non si possono riaccendere.';
    attiva.classList.add('hidden');
    return;
  }
  stato.textContent = iscritto
    ? 'Attivi su questo dispositivo.'
    : 'Spenti su questo dispositivo.';
}

document.getElementById('notifiche-attiva')?.addEventListener('click', async () => {
  if (!notifichePossibili()) return;
  const permesso = await Notification.requestPermission();
  if (permesso !== 'granted') { toast('Senza il permesso del browser non si può fare.'); return; }

  const reg = await navigator.serviceWorker.ready;
  let sub;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,                       // niente push silenziosi: ogni messaggio si vede
      applicationServerKey: chiaveInByte(VAPID_PUBLIC_KEY),
    });
  } catch {
    toast('Il browser non ha accettato l\'iscrizione agli avvisi.');
    return;
  }

  const chiavi = sub.toJSON().keys ?? {};
  const { error } = await supabase.from('push_subscriptions').insert({
    user_id: currentUser.id,
    endpoint: sub.endpoint,
    p256dh: chiavi.p256dh,
    auth: chiavi.auth,
  });
  // Un endpoint già registrato non è un errore da mostrare: vuol dire che è già acceso.
  if (error && error.code !== '23505') {
    await sub.unsubscribe();                       // niente iscrizioni orfane: il server non la conosce
    toast(friendlyError(error));
    return;
  }
  toast('Avvisi accesi su questo dispositivo.');
  renderNotifiche();
});

document.getElementById('notifiche-spegni')?.addEventListener('click', async () => {
  const sub = await iscrizioneCorrente();
  if (!sub) { renderNotifiche(); return; }
  // Prima si toglie dal database, poi dal browser: al contrario, un errore lascerebbe una
  // riga che fa scrivere a un indirizzo che non esiste più.
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  if (error) { toast(friendlyError(error)); return; }
  await sub.unsubscribe();
  toast('Avvisi spenti su questo dispositivo.');
  renderNotifiche();
});

export {
  notifichePossibili,
  renderNotifiche,
};
