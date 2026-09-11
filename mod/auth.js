// Entrare, registrarsi, e il proprio profilo
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { render } from '../app.js';
import { ask, conferma } from './dialogo.js';
import { setMiaZona } from './zona.js';
import { authForm, authMessage, currentUser, nameLabel, rendered, setCurrentUser, setIsAdmin, setMyAvatar, setMyName, setSospeso, setSospesoMotivo, toast } from './nucleo.js';
import { AMBIENTE_VERO, PASSWORD_MINIMO, SITE_URL, ambienteEstraneo, supabase } from './supabase.js';

// --- Auth ---
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    ask('Nuova password', { text: 'Minimo 6 caratteri.', type: 'password', placeholder: 'La tua nuova password' })
      .then((pw) => {
        if (!pw) return toast('Password non cambiata: riapri il link dalla mail per riprovare.');
        if (pw.length < 6) return toast('Password troppo corta (minimo 6 caratteri).');
        supabase.auth.updateUser({ password: pw })
          .then(({ error }) => toast(error ? 'Errore: ' + error.message : 'Password aggiornata.'));
      });
  }
  const wasUser = currentUser?.id;
  setCurrentUser(session?.user ?? null);
  if (currentUser?.id !== wasUser || !rendered) render();
});

// Modalità Accedi / Registrati
const authCard = document.getElementById('auth-card');
const authSuccess = document.getElementById('auth-success');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authSubmit = document.getElementById('auth-submit');
const modeLogin = document.getElementById('mode-login');
const modeSignup = document.getElementById('mode-signup');
const authSwitch = document.querySelector('.auth-switch');
let authMode = 'login';

// Accedi / crea un account. `.signup` su `.auth-switch` e' l'unico interruttore: il
// CSS ci appende quale delle due frasi in fondo alla scheda si legge.
//
// Sparito da qui: `aria-selected` sui due bottoni. Erano marcati `role="tab"` senza
// che esistesse nessun pannello a schede — due bottoni che dicevano a un lettore di
// schermo di essere qualcos'altro. Ora sono due bottoni e basta, e quello che non
// serve e' tolto dal documento, quindi nemmeno dalla tabulazione.
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  authSwitch.classList.toggle('signup', signup);
  nameLabel.classList.toggle('hidden', !signup);
  // «Bentornato» era il registro da prodotto che PRODUCT.md nomina per non usarlo.
  // La domanda a cui l'app risponde e' scritta sul titolo, dove si guarda per prima.
  authTitle.textContent = signup ? 'Crea il tuo account' : 'Chi guida oggi?';
  authSubtitle.textContent = signup
    ? 'Nome, email e una password. Poi ti serve il codice di una comitiva, o ne crei una tua.'
    : 'Accedi e vedi i posti liberi della comitiva.';
  authSubmit.textContent = signup ? 'Crea account' : 'Accedi';
  // La riga di accettazione compare col modo, e con `display: none` esce anche
  // dalla tabulazione: in accesso non c'e' niente da accettare.
  authForm.classList.toggle('signup', signup);
  const recupero = document.getElementById('forgot-btn');
  recupero.classList.toggle('hidden', signup);
  // Cambiare modo non riapre una porta che il blocco ha chiuso.
  if (ambienteEstraneo()) { authSubmit.disabled = true; recupero.disabled = true; }
  const pw = document.getElementById('password');
  pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  // **La lunghezza minima vale per chi la password la sta scegliendo, non per chi
  // la sta usando.** Se restasse anche in accesso, chi ha un account creato quando
  // il minimo era sei caratteri si troverebbe il proprio browser a rifiutare la
  // password giusta — cioe' l'app lo chiuderebbe fuori dal suo account per una
  // regola pensata per gli account nuovi.
  if (signup) {
    pw.setAttribute('minlength', String(PASSWORD_MINIMO));
    pw.setAttribute('placeholder', `Almeno ${PASSWORD_MINIMO} caratteri`);
  } else {
    pw.removeAttribute('minlength');
    pw.setAttribute('placeholder', 'La tua password');
  }
  showAuthMessage('');
}

// Chiude i due modi di entrare e dice perche'. Non si limita a spegnere i bottoni:
// un bottone spento si riaccende dagli strumenti del browser in due secondi, quindi
// il divieto vero sta all'inizio dei due gestori, e questo e' solo cio' che si vede.
function bloccaAccessoSuAnteprima() {
  if (!ambienteEstraneo()) return;
  const avviso = document.getElementById('anteprima-blocco');
  if (avviso) {
    avviso.textContent = 'Questa è un\'anteprima di prova, e parla con i dati veri: '
      + 'l\'accesso è chiuso apposta. Per usare WeTransport vai su ' + AMBIENTE_VERO + '.';
    avviso.hidden = false;
  }
  authSubmit.disabled = true;
  document.getElementById('oauth-google').disabled = true;
  document.getElementById('forgot-btn').disabled = true;
}
bloccaAccessoSuAnteprima();

// Login OAuth (Google / Apple)
async function oauthLogin(provider) {
  if (ambienteEstraneo()) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: SITE_URL },
  });
  if (error) showAuthMessage('Accesso con ' + (provider === 'google' ? 'Google' : 'Apple') + ' non riuscito. Riprova.');
}
document.getElementById('oauth-google').addEventListener('click', () => oauthLogin('google'));

modeLogin.addEventListener('click', () => setAuthMode('login'));
modeSignup.addEventListener('click', () => setAuthMode('signup'));

document.getElementById('pw-toggle').addEventListener('click', () => {
  const pw = document.getElementById('password');
  const show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  document.getElementById('pw-toggle').innerHTML =
    `<svg width="18" height="18"><use href="#i-eye${show ? '-off' : ''}"/></svg>`;
});

document.getElementById('forgot-btn').addEventListener('click', async () => {
  if (ambienteEstraneo()) return;
  const email = document.getElementById('email').value.trim()
    || await ask('Reimposta password', { text: 'A quale email mandiamo il link?', type: 'email', placeholder: 'nome@esempio.it' });
  if (!email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  // **La stessa frase nei due casi, e non e' una svista.** Un messaggio diverso
  // quando l'indirizzo non ha un account trasforma questo campo in un elenco:
  // si prova una email per volta e si scopre chi c'e' dentro. L'errore vero, se
  // c'e', lo si legge nei log di Supabase — non lo si racconta a chi sta provando.
  // Resta detto l'unico caso che chi scrive puo' risolvere da solo: aver sbagliato
  // a scrivere l'indirizzo.
  if (error) console.warn('resetPasswordForEmail:', error.message);
  showAuthMessage(`Se ${email} ha un account, il link per reimpostare la password è in arrivo. Controlla anche lo spam.`, true);
});

document.getElementById('success-back').addEventListener('click', () => {
  authSuccess.classList.add('hidden');
  authCard.classList.remove('hidden');
  setAuthMode('login');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ambienteEstraneo()) return;
  const { email, password } = credentials();

  if (authMode === 'login') {
    if (!authForm.reportValidity()) return;
    authSubmit.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    authSubmit.disabled = false;
    if (error) showAuthMessage(erroreAccesso(error, 'accesso'));
    return;
  }

  const name = document.getElementById('display-name').value.trim();
  if (!name) {
    showAuthMessage('Inserisci il tuo nome: è quello che vedranno gli amici.');
    document.getElementById('display-name').focus();
    return;
  }
  if (!authForm.reportValidity()) return;
  authSubmit.disabled = true;
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: name } },
  });
  authSubmit.disabled = false;
  // **«Questo indirizzo ha gia' un account» non e' un errore da mostrare: e' la
  // stessa schermata dell'altro caso.** Supabase lo nasconde da solo quando
  // nella dashboard e' acceso l'offuscamento — restituisce un utente finto e
  // nessun errore — ma quella e' un'impostazione che vive fuori da questo repo e
  // che nessun controllo qui puo' vedere. Se e' spenta, l'errore arriva: assorbirlo
  // qui vuol dire che il comportamento e' lo stesso nelle due configurazioni,
  // invece di dipendere da una casella che qualcuno potrebbe girare per sbaglio.
  const giaRegistrato = /already registered|already exists|user_already/i.test(error?.message || '')
    || error?.code === 'user_already_exists';
  if (error && !giaRegistrato) {
    showAuthMessage(erroreAccesso(error, 'registrazione'));
    return;
  }
  // **Qui non si dice se l'indirizzo era gia' registrato, e prima si diceva due
  // volte.** C'era un messaggio che lo annunciava, e c'era un secondo controllo che
  // guardava il campo che Supabase lascia vuoto proprio per non farlo capire — cioe'
  // il contrario di quello che quel campo vuoto sta li' a fare. Le due righe insieme
  // rendevano la registrazione un oracolo: con un elenco di indirizzi si sapeva chi
  // ha un account su WeTransport. Il controllo di forma che non le fa tornare sta in
  // `tests/smoke.spec.js`, e cerca proprio quelle due stringhe nel file servito.
  //
  // Adesso la schermata e' una sola, e la frase regge in tutti e due i casi senza
  // promettere una posta che potrebbe non arrivare: se l'indirizzo e' libero il
  // link di conferma c'e', se e' gia' preso si entra da «Accedi».
  document.getElementById('success-email').textContent = email;
  authCard.classList.add('hidden');
  authSuccess.classList.remove('hidden');
});

document.getElementById('profile-logout').addEventListener('click', async () => {
  if (await conferma('Uscire dall\'account?', {
    testo: 'I tuoi passaggi e le tue prenotazioni restano dove sono. Per rientrare servono email e password.',
    azione: 'Esci dall\'account',
  })) supabase.auth.signOut();
});

function credentials() {
  return {
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
  };
}

function showAuthMessage(msg, ok = false) {
  authMessage.textContent = msg;
  authMessage.classList.toggle('ok', ok);
}

// **Gli errori dell'accesso si traducono, non si inoltrano.** `error.message` di
// Supabase e' una frase inglese scritta per chi sviluppa: in una pagina italiana
// e' rumore, e su un modulo di accesso e' anche informazione di troppo — dice se
// un account esiste, se e' bloccato, se e' scattato un limite di tentativi.
// Quello che serve a chi sta davanti allo schermo sono tre casi: la password non
// va, l'email non e' confermata, e ci hai provato troppe volte di fila. Tutto il
// resto e' una frase sola, e il dettaglio resta nella console e nei log del
// fornitore, dove lo legge chi deve.
function erroreAccesso(error, modo = 'accesso') {
  const m = (error?.message || '').toLowerCase();
  if (m.includes('not confirmed')) return 'Devi prima confermare l\'email: controlla la posta in arrivo.';
  if (m.includes('rate limit') || m.includes('too many') || error?.status === 429) {
    return 'Troppi tentativi di fila. Aspetta qualche minuto e riprova.';
  }
  if (m.includes('invalid login') || m.includes('invalid credentials')) return 'Email o password non corrette. Riprova.';
  if (m.includes('password') && m.includes('least')) {
    return `La password deve essere di almeno ${PASSWORD_MINIMO} caratteri.`;
  }
  if (m.includes('weak') || m.includes('pwned') || m.includes('compromised')) {
    return 'Questa password compare in elenchi di password rubate: scegline un\'altra.';
  }
  console.warn(modo + ':', error?.message);
  // Il ripiego dice il vero per il modulo in cui si e': su una registrazione
  // «email o password non corrette» sarebbe una frase che non c'entra niente.
  return modo === 'registrazione'
    ? 'Non e\' stato possibile creare l\'account. Riprova fra poco.'
    : 'Email o password non corrette. Riprova.';
}

async function ensureProfile() {
  const fallback = currentUser.user_metadata?.display_name
    || currentUser.user_metadata?.full_name // Google/Apple OAuth
    || currentUser.user_metadata?.name
    || currentUser.email.split('@')[0];
  const oauthAvatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
  // Il proprio profilo arriva da `mio_profilo()` e non da un select sulla tabella: da
  // `019_zona_riservata.sql` la zona e il motivo della sospensione non sono piu' colonne
  // leggibili da un client, nemmeno sulla propria riga (un permesso per colonna vale per
  // il ruolo, non per la riga). La funzione risponde di una persona sola, chi la chiama.
  const { data: righe, error: erroreProfilo } = await supabase.rpc('mio_profilo');
  if (erroreProfilo) console.error('mio_profilo() non risponde:', erroreProfilo);
  const data = righe?.[0] ?? null;
  if (data) {
    setMyName(data.display_name); setIsAdmin(!!data.is_admin); setMyAvatar(data.avatar_url);
    setSospeso(!!data.sospeso); setSospesoMotivo(data.sospeso_motivo);
    setMiaZona(data.zona_lat === null ? null : { lat: data.zona_lat, lon: data.zona_lon, nome: data.zona_nome });
    // La foto di Google/Apple si salva nel profilo, così la vedono anche gli altri
    if (oauthAvatar && data.avatar_url !== oauthAvatar) {
      setMyAvatar(oauthAvatar);
      supabase.from('profiles').update({ avatar_url: oauthAvatar }).eq('id', currentUser.id).then(() => {});
    }
    return;
  }
  // La riga si crea solo se la funzione ha davvero risposto "non c'e' nessun profilo".
  // Se invece ha dato errore — il caso vero e' la 018 non applicata — la riga esiste
  // eccome, e l'insert fallirebbe in silenzio su chiave duplicata: due errori taciuti
  // invece di uno. Sotto si prosegue con i valori di ripiego, e la console dice perche'.
  if (!erroreProfilo) {
    await supabase.from('profiles').insert({ id: currentUser.id, display_name: fallback, avatar_url: oauthAvatar });
  }
  setMyName(fallback);
  setMyAvatar(oauthAvatar);
  setIsAdmin(false);
  setSospeso(false);
  setSospesoMotivo(null);
  setMiaZona(null);
}

export {
  ensureProfile,
};
