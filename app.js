import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SITE_URL = 'https://wetransport.netlify.app';

// --- DOM ---
const authView = document.getElementById('auth-view');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const authMessage = document.getElementById('auth-message');
const nameLabel = document.getElementById('name-label');
const userNameEl = document.getElementById('user-name');
const groupPills = document.getElementById('group-pills');
const dayToday = document.getElementById('day-today');
const dayTomorrow = document.getElementById('day-tomorrow');
const dayPicker = document.getElementById('day-picker');
const offerToggle = document.getElementById('offer-toggle');
const offerCard = document.getElementById('offer-card');
const rideForm = document.getElementById('ride-form');
const ridesList = document.getElementById('rides-list');
const emptyMessage = document.getElementById('empty-message');
const walkersCard = document.getElementById('walkers-card');
const walkersList = document.getElementById('walkers-list');

let currentUser = null;
let myName = '';
let myAvatar = null;
let isAdmin = false;
let sospeso = false;          // account sospeso: legge tutto, non scrive piu' niente
let sospesoMotivo = null;
let bloccati = new Set();     // chi ho bloccato io; chi ha bloccato me non e' conoscibile
let currentDate = todayISO();
let myGroups = [];
let currentGroupId = null; // sempre un gruppo vero quando l'utente ne ha almeno uno
const ULTIMO_GRUPPO = 'wt_ultimo_gruppo'; // quale comitiva stavo guardando
let realtimeChannel = null;
let realtimeDate = null;     // il giorno su cui il canale e' filtrato adesso
let rendered = false;

// Data locale (non UTC: dopo mezzanotte toISOString darebbe il giorno sbagliato)
function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// L'auto di oggi è già partita?
// Un profilo puo' non essere leggibile: da 011 si vedono solo le persone con cui si
// condivide una comitiva, ma le auto e le prenotazioni di chi se n'e' andato restano
// nello storico. Senza questa rete, l'incorporamento nullo mandava in errore la pagina.
function nomeDi(profilo) { return profilo?.display_name ?? 'Ex membro'; }

function hasDeparted(ride) {
  if (ride.ride_date !== todayISO() || !ride.depart_time) return false;
  const [h, m] = ride.depart_time.split(':').map(Number);
  const now = new Date();
  return h * 60 + m <= now.getHours() * 60 + now.getMinutes();
}

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
  currentUser = session?.user ?? null;
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

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  authSwitch.classList.toggle('signup', signup);
  modeLogin.classList.toggle('active', !signup);
  modeSignup.classList.toggle('active', signup);
  modeLogin.setAttribute('aria-selected', String(!signup));
  modeSignup.setAttribute('aria-selected', String(signup));
  nameLabel.classList.toggle('hidden', !signup);
  authTitle.textContent = signup ? 'Crea il tuo account' : 'Bentornato';
  authSubtitle.textContent = signup
    ? 'Bastano nome, email e una password.'
    : 'Accedi per vedere chi guida oggi.';
  authSubmit.textContent = signup ? 'Crea account' : 'Accedi';
  document.getElementById('forgot-btn').classList.toggle('hidden', signup);
  document.getElementById('password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  showAuthMessage('');
}

// Login OAuth (Google / Apple)
async function oauthLogin(provider) {
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
  const email = document.getElementById('email').value.trim()
    || await ask('Reimposta password', { text: 'A quale email mandiamo il link?', type: 'email', placeholder: 'nome@esempio.it' });
  if (!email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
  if (error) showAuthMessage(error.message);
  else showAuthMessage(`Ti abbiamo inviato un link per reimpostare la password a ${email}.`, true);
});

document.getElementById('success-back').addEventListener('click', () => {
  authSuccess.classList.add('hidden');
  authCard.classList.remove('hidden');
  setAuthMode('login');
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { email, password } = credentials();

  if (authMode === 'login') {
    if (!authForm.reportValidity()) return;
    authSubmit.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    authSubmit.disabled = false;
    if (error) {
      showAuthMessage(error.message.includes('not confirmed')
        ? 'Devi prima confermare l\'email: controlla la posta in arrivo.'
        : 'Email o password non corrette. Riprova.');
    }
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
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: name } },
  });
  authSubmit.disabled = false;
  if (error) {
    showAuthMessage(error.message.includes('already registered')
      ? 'Questa email è già registrata: prova ad accedere.'
      : error.message);
    return;
  }
  if (data.user?.identities?.length === 0) {
    showAuthMessage('Questa email è già registrata: prova ad accedere.');
    return;
  }
  document.getElementById('success-email').textContent = email;
  authCard.classList.add('hidden');
  authSuccess.classList.remove('hidden');
});

document.getElementById('profile-logout').addEventListener('click', () => {
  if (confirm('Vuoi uscire dall\'account?')) supabase.auth.signOut();
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
    myName = data.display_name; isAdmin = !!data.is_admin; myAvatar = data.avatar_url;
    sospeso = !!data.sospeso; sospesoMotivo = data.sospeso_motivo;
    miaZona = data.zona_lat === null ? null : { lat: data.zona_lat, lon: data.zona_lon, nome: data.zona_nome };
    // La foto di Google/Apple si salva nel profilo, così la vedono anche gli altri
    if (oauthAvatar && data.avatar_url !== oauthAvatar) {
      myAvatar = oauthAvatar;
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
  myName = fallback;
  myAvatar = oauthAvatar;
  isAdmin = false;
  sospeso = false;
  sospesoMotivo = null;
  miaZona = null;
}

// --- Segnalazione, blocco, sospensione (cantiere C10) ---
// Qui c'e' solo l'interfaccia: chi puo' fare cosa lo decidono le policy della migrazione
// 012, e questa meta' non e' fidata (ADR 001, punto 2). Le guardie qui sotto servono a
// dare un messaggio sensato invece di un errore del database, non a proteggere niente.

async function loadBlocked() {
  const { data } = await supabase.from('user_blocks').select('blocked_id');
  bloccati = new Set((data ?? []).map(b => b.blocked_id));
}

// Un solo posto dove chiedersi "posso scrivere?", cosi' la risposta non diverge.
function bloccaSeSospeso(azione = 'farlo') {
  if (!sospeso) return false;
  toast(`Account sospeso: non puoi ${azione}.`);
  return true;
}

function applicaSospensione() {
  const banner = document.getElementById('sospeso-banner');
  banner.classList.toggle('hidden', !sospeso);
  document.getElementById('sospeso-motivo').textContent = sospesoMotivo ? `Motivo: ${sospesoMotivo}.` : '';
  // Il pulsante per pubblicare sparisce: proporre un'azione che il database rifiutera'
  // e' peggio che non proporla.
  offerToggle.classList.toggle('hidden', sospeso);
  if (sospeso) offerCard.classList.add('hidden');
}

// --- Dialogo "segnala o blocca" ---
const personaDialog = document.getElementById('persona-dialog');
let personaCorrente = null; // { id, nome, rideId }

function apriPersona(id, nome, rideId = null) {
  if (id === currentUser.id) return;
  personaCorrente = { id, nome, rideId };
  document.getElementById('persona-title').textContent = `${nome}: segnala o blocca`;
  document.getElementById('persona-motivo').value = 'guida-pericolosa';
  document.getElementById('persona-dettagli').value = '';
  const blocca = document.getElementById('persona-blocca');
  const giaBloccato = bloccati.has(id);
  blocca.textContent = giaBloccato ? 'Sblocca' : 'Blocca';
  blocca.classList.toggle('btn-danger-full', !giaBloccato);
  document.getElementById('persona-segnala').disabled = sospeso;
  personaDialog.showModal();
}

function bottonePersona(id, nome, rideId = null) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip-report';
  b.textContent = '⋯';
  b.title = `Segnala o blocca ${nome}`;
  b.setAttribute('aria-label', `Segnala o blocca ${nome}`);
  b.addEventListener('click', (e) => { e.stopPropagation(); apriPersona(id, nome, rideId); });
  return b;
}

document.getElementById('persona-cancel').addEventListener('click', () => personaDialog.close());

document.getElementById('persona-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = personaCorrente;
  personaDialog.close();
  if (!p || bloccaSeSospeso('segnalare')) return;
  const { error } = await supabase.from('user_reports').insert({
    reporter_id: currentUser.id,
    reported_id: p.id,
    ride_id: p.rideId,
    motivo: document.getElementById('persona-motivo').value,
    dettagli: document.getElementById('persona-dettagli').value.trim() || null,
  });
  if (error) {
    // 23505 = c'e' gia' una segnalazione aperta su questa persona, per scelta di 012
    toast(error.code === '23505'
      ? 'Hai già una segnalazione aperta su questa persona: è in mano all\'amministratore.'
      : friendlyError(error));
    return;
  }
  toast('Segnalazione inviata. Non saprà di essere stata segnalata.');
});

document.getElementById('persona-blocca').addEventListener('click', async () => {
  const p = personaCorrente;
  personaDialog.close();
  if (!p) return;
  if (bloccati.has(p.id)) {
    const { error } = await supabase.from('user_blocks').delete()
      .eq('blocker_id', currentUser.id).eq('blocked_id', p.id);
    if (error) { toast(friendlyError(error)); return; }
    toast(`${p.nome} è di nuovo visibile.`);
  } else {
    if (!confirm(`Bloccare ${p.nome}? Non vedrete più i passaggi l'uno dell'altra, e non potrete salire in macchina insieme. I posti già presi restano.`)) return;
    if (bloccaSeSospeso('bloccare')) return;
    const { error } = await supabase.from('user_blocks')
      .insert({ blocker_id: currentUser.id, blocked_id: p.id });
    if (error) { toast(friendlyError(error)); return; }
    toast(`${p.nome} bloccato.`);
  }
  await loadBlocked();
  renderProfile();
  loadRides();
});

async function renderBlocked() {
  const card = document.getElementById('blocked-card');
  const list = document.getElementById('blocked-list');
  list.innerHTML = '';
  card.classList.toggle('hidden', bloccati.size === 0);
  if (bloccati.size === 0) return;
  // Il nome c'e' finche' si condivide una comitiva: fuori da quella, il blocco non tiene
  // aperta nessuna lettura (vincolo di 011), e resta l'etichetta generica.
  const { data } = await supabase.from('profiles').select('id, display_name').in('id', [...bloccati]);
  const nomi = new Map((data ?? []).map(p => [p.id, p.display_name]));
  for (const id of bloccati) {
    const chip = document.createElement('span');
    chip.className = 'history-chip';
    chip.textContent = nomi.get(id) ?? 'Persona bloccata';
    const sblocca = document.createElement('button');
    sblocca.type = 'button';
    sblocca.className = 'chip-kick';
    sblocca.textContent = '✕';
    sblocca.title = 'Sblocca';
    sblocca.addEventListener('click', async () => {
      const { error } = await supabase.from('user_blocks').delete()
        .eq('blocker_id', currentUser.id).eq('blocked_id', id);
      if (error) { toast(friendlyError(error)); return; }
      await loadBlocked();
      renderProfile();
      loadRides();
      toast('Persona sbloccata.');
    });
    chip.appendChild(sblocca);
    list.appendChild(chip);
  }
}

const MOTIVI = {
  'guida-pericolosa': 'Guida pericolosa',
  'molestie': 'Molestie o offese',
  'non-si-e-presentato': 'Non si è presentato',
  'profilo-falso': 'Profilo falso',
  'altro': 'Altro',
};

async function renderReports() {
  const card = document.getElementById('admin-card');
  card.classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  const list = document.getElementById('reports-list');
  list.innerHTML = '';
  const { data, error } = await supabase.from('user_reports')
    .select('id, motivo, dettagli, stato, created_at, reported_id, reporter:profiles!user_reports_reporter_id_fkey(display_name), segnalato:profiles!user_reports_reported_id_fkey(display_name, sospeso)')
    .neq('stato', 'chiusa').order('created_at');
  if (error) { list.textContent = friendlyError(error); return; }
  if (!data.length) {
    list.innerHTML = '<p class="card-sub">Nessuna segnalazione aperta.</p>';
    return;
  }
  for (const r of data) {
    const box = document.createElement('div');
    box.className = 'report-row';

    const testa = document.createElement('div');
    testa.className = 'report-head';
    testa.textContent = `${nomeDi(r.reporter)} → ${nomeDi(r.segnalato)}: ${MOTIVI[r.motivo] ?? r.motivo}`;
    box.appendChild(testa);

    if (r.dettagli) {
      const det = document.createElement('p');
      det.className = 'report-body';
      det.textContent = r.dettagli;
      box.appendChild(det);
    }

    const azioni = document.createElement('div');
    azioni.className = 'group-card-actions';

    const eraSospeso = !!r.segnalato?.sospeso;
    const sosp = document.createElement('button');
    sosp.type = 'button';
    sosp.className = 'btn btn-ghost btn-small' + (eraSospeso ? '' : ' btn-danger');
    sosp.textContent = eraSospeso ? 'Riabilita' : 'Sospendi';
    sosp.addEventListener('click', async () => {
      const motivo = eraSospeso ? null
        : await ask(`Sospendere ${nomeDi(r.segnalato)}?`, { text: 'Il motivo lo legge la persona sospesa.', placeholder: 'Motivo' });
      if (!eraSospeso && motivo === null) return;
      const { error: e2 } = await supabase.from('profiles')
        .update({ sospeso: !eraSospeso, sospeso_il: eraSospeso ? null : new Date().toISOString(), sospeso_motivo: motivo || null })
        .eq('id', r.reported_id);
      if (e2) { toast(friendlyError(e2)); return; }
      toast(eraSospeso ? 'Account riabilitato.' : 'Account sospeso.');
      renderReports();
    });
    azioni.appendChild(sosp);

    const chiudi = document.createElement('button');
    chiudi.type = 'button';
    chiudi.className = 'btn btn-ghost btn-small';
    chiudi.textContent = 'Chiudi segnalazione';
    chiudi.addEventListener('click', async () => {
      const esito = await ask('Come si è chiusa?', { text: 'Resta scritto, ma non lo legge nessun altro.', placeholder: 'Esito' });
      if (esito === null) return;
      const { error: e2 } = await supabase.from('user_reports')
        .update({ stato: 'chiusa', esito: esito || null, gestita_da: currentUser.id, gestita_il: new Date().toISOString() })
        .eq('id', r.id);
      if (e2) { toast(friendlyError(e2)); return; }
      renderReports();
    });
    azioni.appendChild(chiudi);

    box.appendChild(azioni);
    list.appendChild(box);
  }
}

// --- Passaggi in zona (cantiere C9) ---
// Le coordinate arrivano solo da navigator.geolocation: niente servizio di geocodifica,
// che sarebbe un terzo a cui si dice dove vanno gli utenti (decisione D6). Il nome del
// luogo resta il testo libero che c'era gia'.

let partenza = null;   // { lat, lon } del passaggio che si sta pubblicando
let miaZona = null;    // { lat, lon, nome } dal profilo

function posizione() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Questo browser non sa dire dove sei.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Non hai dato il permesso di leggere la posizione.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

document.getElementById('ride-qui').addEventListener('click', async () => {
  const esito = document.getElementById('ride-posizione');
  esito.textContent = 'Cerco…';
  try {
    partenza = await posizione();
    esito.textContent = 'Partenza segnata su questa posizione.';
  } catch (e) {
    partenza = null;
    esito.textContent = e.message;
  }
});

function renderZona() {
  const stato = document.getElementById('zona-stato');
  stato.textContent = miaZona
    ? `Impostata${miaZona.nome ? ` su ${miaZona.nome}` : ''}: vedi i passaggi che partono entro ${RAGGIO_ZONA_KM} km.`
    : 'Non impostata: non ricevi passaggi da fuori la tua comitiva, a parte quelli aperti a chiunque.';
  document.getElementById('zona-togli').classList.toggle('hidden', !miaZona);
}

const RAGGIO_ZONA_KM = 25; // deve restare uguale a raggio_zona_km() nella migrazione 014

document.getElementById('zona-imposta').addEventListener('click', async () => {
  if (bloccaSeSospeso('cambiare la tua zona')) return;
  const stato = document.getElementById('zona-stato');
  stato.textContent = 'Cerco…';
  let punto;
  try {
    punto = await posizione();
  } catch (e) { stato.textContent = e.message; return; }
  const nome = await ask('Come si chiama questa zona?', {
    text: 'Solo per te: serve a ricordarti quale punto hai segnato.',
    placeholder: 'Es. Sesto San Giovanni',
  });
  if (nome === null) { renderZona(); return; }
  const { error } = await supabase.from('profiles')
    .update({ zona_lat: punto.lat, zona_lon: punto.lon, zona_nome: nome || null })
    .eq('id', currentUser.id);
  if (error) { toast(friendlyError(error)); renderZona(); return; }
  miaZona = { ...punto, nome: nome || null };
  renderZona();
  toast('Zona impostata.');
  loadRides();
});

document.getElementById('zona-togli').addEventListener('click', async () => {
  const { error } = await supabase.from('profiles')
    .update({ zona_lat: null, zona_lon: null, zona_nome: null }).eq('id', currentUser.id);
  if (error) { toast(friendlyError(error)); return; }
  miaZona = null;
  renderZona();
  toast('Zona rimossa.');
  loadRides();
});

// --- I propri dati: portarli via, o cancellarli (cantiere C11) ---
// L'esportazione si fa dal client, con le stesse query di tutti i giorni: le policy
// decidono cosa esce, quindi non serve nessun permesso nuovo per una cosa che deve solo
// restituire il gia' visibile.

async function esportaDati() {
  const mio = (tabella, colonna) => supabase.from(tabella).select('*').eq(colonna, currentUser.id);
  // `rides` fa eccezione e chiede le colonne per nome: da C21 il `*` non e' piu' permesso
  // (vedi COLONNE_RIDE). Le coordinate delle proprie auto rientrano subito dopo, dalla
  // stessa funzione che le da' alla Home: sono dati propri, e devono esserci.
  const mieAuto = () => supabase.from('rides').select(COLONNE_RIDE).eq('driver_id', currentUser.id);
  // Il profilo esce intero, zona compresa, e per la stessa ragione delle coordinate: sono
  // dati propri. Dopo la 019 pero' il `select('*')` sulla tabella non li porterebbe piu'
  // (permesso per colonna), quindi si chiede a `mio_profilo()`, che li ha tutti.
  const [profilo, auto, posti, richieste, commenti, attesa, gruppi, segnalazioni, blocchi] = await Promise.all([
    supabase.rpc('mio_profilo'),
    mieAuto(),
    mio('seat_claims', 'passenger_id'),
    mio('ride_requests', 'user_id'),
    mio('ride_comments', 'user_id'),
    mio('ride_waitlist', 'user_id'),
    supabase.from('group_members').select('group_id, created_at, gruppo:groups(name, code)').eq('user_id', currentUser.id),
    mio('user_reports', 'reporter_id'),
    mio('user_blocks', 'blocker_id'),
  ]);
  const primoErrore = [profilo, auto, posti, richieste, commenti, attesa, gruppi, segnalazioni, blocchi]
    .find(r => r.error);
  if (primoErrore) { toast(friendlyError(primoErrore.error)); return; }

  // Le coordinate tornano dentro le proprie auto: "Scarica i miei dati" deve dare tutto
  // quello che il database ha su di te, e il punto da cui hai detto di partire e' tuo.
  await attaccaCoordinate(auto.data);

  const dati = {
    esportato_il: new Date().toISOString(),
    account: { id: currentUser.id, email: currentUser.email, registrato_il: currentUser.created_at },
    profilo: profilo.data?.[0] ?? null,
    comitive: gruppi.data,
    auto_pubblicate: auto.data,
    posti_prenotati: posti.data,
    richieste_di_passaggio: richieste.data,
    commenti: commenti.data,
    liste_di_attesa: attesa.data,
    segnalazioni_fatte: segnalazioni.data,
    persone_bloccate: blocchi.data,
  };
  // Le segnalazioni RICEVUTE non ci sono, ed e' voluto: contengono il racconto di
  // un'altra persona, che non diventa esportabile perche' parla di te.

  const blob = new Blob([JSON.stringify(dati, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wetransport-${todayISO()}.json`;
  // Stessa cautela di scaricaIcs(), e per lo stesso motivo: l'ancora deve stare nel
  // documento perche' il click valga anche fuori da Chrome, e revocare l'indirizzo
  // nello stesso istante lascia a mani vuote i browser che leggono il blob un attimo dopo.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast('Dati scaricati.');
}

document.getElementById('profile-export').addEventListener('click', esportaDati);

document.getElementById('profile-delete').addEventListener('click', async () => {
  if (!confirm('Eliminare l\'account? Spariscono profilo, auto, prenotazioni, richieste e commenti. Non si torna indietro.')) return;
  const conferma = await ask('Conferma l\'eliminazione', {
    text: 'Scrivi ELIMINA per confermare. Se possiedi una comitiva passerà a un altro membro; se non ce ne sono, sparisce anche quella.',
    placeholder: 'ELIMINA',
  });
  if (conferma !== 'ELIMINA') { toast('Eliminazione annullata.'); return; }
  const { error } = await supabase.rpc('elimina_account');
  if (error) { toast(friendlyError(error)); return; }
  await supabase.auth.signOut();
  toast('Account eliminato.');
  location.reload();
});

// --- Dialog custom (sostituisce prompt(): funziona anche nei browser in-app) ---
const appDialog = document.getElementById('app-dialog');
const dialogInput = document.getElementById('dialog-input');
let dialogResolve = null;

function ask(title, { text = '', placeholder = '', value = '', type = 'text' } = {}) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-text').textContent = text;
  document.getElementById('dialog-text').style.display = text ? '' : 'none';
  dialogInput.type = type;
  dialogInput.placeholder = placeholder;
  dialogInput.value = value;
  appDialog.showModal();
  dialogInput.focus();
  return new Promise((resolve) => { dialogResolve = resolve; });
}

document.getElementById('dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  appDialog.close();
  dialogResolve?.(dialogInput.value.trim());
  dialogResolve = null;
});
document.getElementById('dialog-cancel').addEventListener('click', () => {
  appDialog.close();
  dialogResolve?.(null);
  dialogResolve = null;
});
appDialog.addEventListener('cancel', () => { dialogResolve?.(null); dialogResolve = null; });

// --- Navigazione a schede ---
const VIEWS = ['home', 'history', 'groups', 'stats', 'profile'];

function switchView(view) {
  for (const v of VIEWS) {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
  }
  // Il tondo della navigazione scivola sulla scheda attiva: la sua colonna la
  // passa il codice al CSS, letta dall'ordine vero dei pulsanti, per non tenere
  // l'elenco delle viste scritto in due posti che possono divergere.
  const schede = [...document.querySelectorAll('.nav-item')];
  schede.forEach((b, i) => {
    const attiva = b.dataset.view === view;
    b.classList.toggle('active', attiva);
    if (attiva) {
      b.setAttribute('aria-current', 'page');
      document.querySelector('.bottom-nav')?.style.setProperty('--nav-i', i);
    } else {
      b.removeAttribute('aria-current');
    }
  });
  // La barra laterale segue le stesse viste. Non usa `.nav-item` di proposito:
  // quel ciclo qui sopra ricava la colonna del tondo dalla **posizione** del
  // pulsante nell'elenco, e tredici pulsanti al posto di cinque lo manderebbero
  // a segnare una colonna che non esiste.
  document.querySelectorAll('.side-item').forEach(b => {
    const attiva = b.dataset.view === view && !b.dataset.scroll;
    b.classList.toggle('on', attiva);
    if (attiva) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0 });
  if (view === 'history') loadHistory();
  if (view === 'stats') loadStats();
  if (view === 'groups') renderGroupsView();
  if (view === 'profile') renderProfile();
}

document.querySelectorAll('.nav-item').forEach(b =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

// Ogni voce apre una vista e basta. `data-scroll` resta previsto ma non usato: se
// un domani servisse una voce che porta a un riquadro dentro una vista, il pezzo
// c'e' gia' e aspetta che `loadStats()` abbia finito di scrivere.
document.querySelectorAll('.side-item').forEach(b => b.addEventListener('click', () => {
  switchView(b.dataset.view);
  const bersaglio = b.dataset.scroll;
  if (!bersaglio) return;
  const vaiLi = (tentativi) => {
    const el = document.getElementById(bersaglio);
    if (el && !el.classList.contains('hidden')) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (tentativi > 0) setTimeout(() => vaiLi(tentativi - 1), 120);
  };
  setTimeout(() => vaiLi(12), 0);
}));

document.getElementById('side-me')?.addEventListener('click', () => switchView('profile'));

userNameEl.addEventListener('click', () => switchView('profile'));

// --- Cambia nome ---
document.getElementById('profile-rename').addEventListener('click', async () => {
  const name = await ask('Il tuo nome', { text: 'È quello che appare sul sedile.', value: myName });
  if (!name || !name.trim() || name.trim() === myName) return;
  const { error } = await supabase.from('profiles').update({ display_name: name.trim().slice(0, 40) }).eq('id', currentUser.id);
  if (error) { toast('Errore: ' + error.message); return; }
  myName = name.trim().slice(0, 40);
  userNameEl.textContent = myName;
  renderProfile();
  toast('Nome aggiornato.');
  loadRides();
});

// La scheda in fondo alla barra laterale. Dice due cose vere e nessuna di piu':
// come ti chiami e in quante comitive sei. Il ruolo lo scrive solo se c'e'.
function aggiornaBarraLaterale() {
  const av = document.getElementById('side-av');
  const nome = document.getElementById('side-nome');
  const ruolo = document.getElementById('side-ruolo');
  if (!av || !nome || !ruolo) return;
  av.textContent = initials(myName || '?');
  nome.textContent = myName || '—';
  const n = myGroups.length;
  ruolo.textContent = (isAdmin ? 'Amministratore · ' : '') +
    (n === 0 ? 'nessuna comitiva' : n === 1 ? '1 comitiva' : `${n} comitive`);
}

function renderProfile() {
  aggiornaBarraLaterale();
  const av = document.getElementById('profile-avatar');
  if (myAvatar) {
    // Costruito con il DOM e non con innerHTML: l'indirizzo dell'avatar arriva da
    // fuori (metadati OAuth, o profilo modificabile via API) e in una stringa HTML
    // basterebbe una virgoletta per uscire dall'attributo.
    av.textContent = '';
    const img = document.createElement('img');
    img.src = myAvatar;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    av.appendChild(img);
  } else {
    av.textContent = initials(myName || '?');
  }
  document.getElementById('profile-name').textContent = myName
    + (isAdmin ? ' · Amministratore' : '')
    + (sospeso ? ' · Sospeso' : '');
  document.getElementById('profile-email').textContent = currentUser?.email ?? '';
  renderZona();
  renderNotifiche();
  renderBlocked();
  renderReports();
}

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

// --- Gruppi ---
async function createGroupFlow() {
  const name = await ask('Nuovo gruppo', { text: 'Il nome che vedranno gli amici.', placeholder: 'es. Comitiva del mare' });
  if (!name || !name.trim()) return;
  const { data, error } = await supabase.rpc('create_group', { p_name: name.trim().slice(0, 40) });
  if (error) { toast('Errore: ' + error.message); return; }
  await loadGroups();
  selectGroup(data.id);
  renderGroupsView();
  toast(`Gruppo creato. Condividi il codice ${data.code} con gli amici.`);
}

async function joinGroupFlow() {
  const code = await ask('Entra in un gruppo', { text: 'Fatti mandare il codice da un amico.', placeholder: 'Codice invito (6 caratteri)' });
  if (!code || !code.trim()) return;
  const { data, error } = await supabase.rpc('join_group', { p_code: code.trim() });
  if (error) { toast(error.message.includes('Codice') ? 'Codice non valido, ricontrolla.' : 'Errore: ' + error.message); return; }
  await loadGroups();
  selectGroup(data.id);
  renderGroupsView();
  toast(`Sei entrato nel gruppo "${data.name}".`);
}

document.getElementById('group-create').addEventListener('click', createGroupFlow);
document.getElementById('group-join').addEventListener('click', joinGroupFlow);
document.getElementById('welcome-create').addEventListener('click', createGroupFlow);
document.getElementById('welcome-join').addEventListener('click', joinGroupFlow);

async function loadGroups() {
  const { data, error } = await supabase
    .from('group_members')
    .select('group:groups(id, name, code, owner_id)')
    .eq('user_id', currentUser.id);
  if (error) { console.error(error); return; }
  myGroups = (data ?? []).map(r => r.group).filter(Boolean);

  // Ogni passaggio appartiene a una comitiva: senza comitiva non c'e' niente da mostrare.
  // Si riprende quella che si stava guardando; se non c'e' piu', la prima disponibile.
  const valido = (id) => id && myGroups.some(g => g.id === id);
  if (!valido(currentGroupId)) {
    const ricordato = localStorage.getItem(ULTIMO_GRUPPO);
    currentGroupId = valido(ricordato) ? ricordato : (myGroups[0]?.id ?? null);
  }

  const senzaGruppi = myGroups.length === 0;
  document.getElementById('welcome').classList.toggle('hidden', !senzaGruppi);
  document.getElementById('group-bar').classList.toggle('hidden', senzaGruppi);
  document.getElementById('day-bar').classList.toggle('hidden', senzaGruppi);
  if (senzaGruppi) {
    ridesList.innerHTML = '';
    emptyMessage.classList.add('hidden');
    document.getElementById('day-stats').classList.add('hidden');
    document.getElementById('turn-hint').classList.add('hidden');
    walkersCard.classList.add('hidden');
    offerCard.classList.add('hidden');
  }
  renderGroupBar();
}

function renderGroupBar() {
  groupPills.innerHTML = '';
  for (const g of myGroups) {
    const b = document.createElement('button');
    b.className = 'tab' + (currentGroupId === g.id ? ' active' : '');
    b.textContent = g.name;
    b.addEventListener('click', () => selectGroup(g.id));
    groupPills.appendChild(b);
  }
}

function selectGroup(groupId) {
  currentGroupId = groupId;
  if (groupId) localStorage.setItem(ULTIMO_GRUPPO, groupId);
  renderGroupBar();
  loadRides();
}

// --- Vista Gruppi ---
async function renderGroupsView() {
  const list = document.getElementById('groups-list');
  document.getElementById('groups-empty').classList.toggle('hidden', myGroups.length > 0);
  list.innerHTML = '';
  for (const g of myGroups) {
    const card = document.createElement('article');
    card.className = 'group-card';

    const head = document.createElement('div');
    head.className = 'group-card-head';
    const name = document.createElement('span');
    name.className = 'group-card-name';
    name.textContent = g.name;
    head.appendChild(name);
    const code = document.createElement('span');
    code.className = 'group-code';
    code.textContent = g.code;
    code.title = 'Codice invito';
    head.appendChild(code);
    card.appendChild(head);

    const membersWrap = document.createElement('div');
    membersWrap.className = 'group-card-members';
    card.appendChild(membersWrap);
    const canKick = g.owner_id === currentUser.id || isAdmin;
    supabase.from('group_members').select('user_id, profile:profiles(display_name)').eq('group_id', g.id)
      .then(({ data }) => {
        for (const m of data ?? []) {
          // Il nome di chi ho bloccato lo leggo ancora (policy di 012): serve a sapere chi
          // sbloccare. Qui si dice pero' che e' bloccato, altrimenti non si capisce perche'
          // le sue auto non compaiano mai.
          const nome = nomeDi(m.profile);
          const chip = document.createElement('span');
          chip.className = 'history-chip';
          chip.textContent = nome
            + (m.user_id === currentUser.id ? ' (tu)' : '')
            + (bloccati.has(m.user_id) ? ' · bloccato' : '');
          if (m.user_id !== currentUser.id) {
            chip.appendChild(bottonePersona(m.user_id, nome));
          }
          if (canKick && m.user_id !== currentUser.id) {
            const kick = document.createElement('button');
            kick.className = 'chip-kick';
            kick.textContent = '✕';
            kick.title = `Rimuovi ${nome} dal gruppo`;
            kick.addEventListener('click', async () => {
              if (!confirm(`Rimuovere ${nome} dal gruppo "${g.name}"?`)) return;
              const { error } = await supabase.from('group_members').delete()
                .eq('group_id', g.id).eq('user_id', m.user_id);
              if (error) { toast(friendlyError(error)); return; }
              toast(`${nome} rimosso dal gruppo.`);
              renderGroupsView();
            });
            chip.appendChild(kick);
          }
          membersWrap.appendChild(chip);
        }
      });

    const actions = document.createElement('div');
    actions.className = 'group-card-actions';

    const copy = document.createElement('button');
    copy.className = 'btn btn-ghost btn-small';
    copy.textContent = 'Copia codice';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(g.code);
      copy.textContent = 'Copiato';
      setTimeout(() => (copy.textContent = 'Copia codice'), 1500);
    });
    actions.appendChild(copy);

    const inviteText = `Entra nel gruppo "${g.name}" su WeTransport con il codice ${g.code}: ${SITE_URL}`;
    const invite = document.createElement('button');
    invite.className = 'btn btn-ghost btn-small';
    invite.textContent = 'Invita amici';
    invite.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'WeTransport', text: inviteText, url: SITE_URL }); } catch {}
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(inviteText), '_blank', 'noopener');
      }
    });
    actions.appendChild(invite);

    const leave = document.createElement('button');
    leave.className = 'btn btn-ghost btn-small btn-danger';
    leave.textContent = 'Esci dal gruppo';
    leave.addEventListener('click', async () => {
      if (!confirm(`Vuoi uscire dal gruppo "${g.name}"?`)) return;
      const { error } = await supabase.from('group_members').delete()
        .eq('group_id', g.id).eq('user_id', currentUser.id);
      if (error) { toast(friendlyError(error)); return; }
      await loadGroups();
      renderGroupsView();
      loadRides();
    });
    actions.appendChild(leave);

    card.appendChild(actions);
    list.appendChild(card);
  }
}

// --- Vista Storico ---
const DAY_FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

function groupLabel() {
  const g = myGroups.find(x => x.id === currentGroupId);
  return g ? `Gruppo: ${g.name}` : 'Nessuna comitiva';
}

async function loadHistory() {
  if (!currentGroupId) return;
  const list = document.getElementById('history-list');
  document.querySelector('#view-history .view-subtitle').textContent =
    `Chi ha guidato e chi era a bordo · ${groupLabel()} (si cambia dalla Home)`;
  list.innerHTML = '<div class="skeleton"></div>';
  let hq = supabase
    .from('rides')
    .select('ride_date, origin, destination, depart_time, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger:profiles!seat_claims_passenger_id_fkey(display_name))')
    .lt('ride_date', todayISO());
  hq = hq.eq('group_id', currentGroupId);
  const { data, error } = await hq
    .order('ride_date', { ascending: false })
    .order('depart_time', { ascending: true, nullsFirst: false })
    .limit(120);
  list.innerHTML = '';
  document.getElementById('history-empty').classList.toggle('hidden', !!data?.length);
  if (error || !data) return;

  let currentDay = null;
  let dayWrap = null;
  for (const r of data) {
    if (r.ride_date !== currentDay) {
      currentDay = r.ride_date;
      dayWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'history-day-title';
      title.textContent = DAY_FMT.format(new Date(r.ride_date + 'T12:00:00'));
      dayWrap.appendChild(title);
      list.appendChild(dayWrap);
    }
    const item = document.createElement('div');
    item.className = 'history-ride';
    const route = document.createElement('div');
    route.className = 'history-route';
    route.textContent = (r.origin ? `${r.origin} → ` : '') + r.destination
      + (r.depart_time ? ` · ore ${r.depart_time.slice(0, 5)}` : '');
    item.appendChild(route);
    const people = document.createElement('div');
    people.className = 'history-passengers';
    const drv = document.createElement('span');
    drv.className = 'history-chip driver';
    drv.textContent = `${nomeDi(r.driver)} (guidava)`;
    people.appendChild(drv);
    if (r.seat_claims.length === 0) {
      const none = document.createElement('span');
      none.className = 'history-chip';
      none.textContent = 'nessun passeggero';
      people.appendChild(none);
    }
    for (const c of r.seat_claims) {
      const chip = document.createElement('span');
      chip.className = 'history-chip';
      chip.textContent = nomeDi(c.passenger);
      people.appendChild(chip);
    }
    item.appendChild(people);
    dayWrap.appendChild(item);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Il riepilogo.
//
// Una sola funzione perche' una sola lettura: le quattro interrogazioni partono
// insieme e da li' in poi si contano le stesse righe piu' volte, invece di
// chiedere al database una somma per riquadro. Con una comitiva vera sono
// centinaia di righe, non milioni.
//
// Regola valida per ogni riquadro qui sotto: **se il dato non c'e', il riquadro
// non c'e'**. Nessun numero finto, nessun trattino messo li' per riempire il
// disegno. Un cruscotto che mostra zeri inventati e' peggio di uno spazio vuoto,
// perche' lo zero si legge come una misura.
// ══════════════════════════════════════════════════════════════════════════
async function loadStats() {
  const box = document.getElementById('stats-content');

  // **Questa vista non puo' finire bianca.** Prima il riquadro conteneva un titolo
  // fisso scritto in `index.html`, quindi anche uscendo subito qualcosa restava a
  // schermo; ora lo scrive tutto questa funzione, e uscire in silenzio vuol dire
  // consegnare una pagina vuota — che chi guarda legge come «e' rotto», non come
  // «manca un gruppo». Le tre uscite qui sotto dicono cosa manca e cosa fare.
  if (!currentGroupId) {
    box.innerHTML = `<div class="dash-top"><div class="dash-hi"><h1>Riepilogo</h1>
      <p>Serve una comitiva: il riepilogo somma i passaggi di un gruppo.</p></div></div>
      <section class="card"><div class="head"><h3>Nessuna comitiva selezionata</h3></div>
      <p class="vuoto">Crea un gruppo o entra con un codice invito dalla vista Comitiva,
      poi torna qui.</p>
      <button type="button" class="cta-vuoto" data-vai="gruppi">Vai alla comitiva →</button>
      </section>`;
    box.querySelector('[data-vai]')?.addEventListener('click', () => switchView('groups'));
    return;
  }

  box.innerHTML = '<div class="skeleton"></div>';
  try {
    await disegnaRiepilogo(box);
  } catch (err) {
    // Un errore qui dentro lasciava lo scheletro a girare per sempre. Meglio dire
    // che e' andata storta, e come rimediare, che una pagina che finge di caricare.
    console.error('riepilogo:', err);
    box.innerHTML = `<div class="dash-top"><div class="dash-hi"><h1>Riepilogo</h1>
      <p>Qualcosa non ha funzionato nel caricare i dati.</p></div></div>
      <section class="card"><div class="head"><h3>Riepilogo non disponibile</h3></div>
      <p class="vuoto">Ricarica la pagina. Se continua, è un difetto: il dettaglio è nella
      console del browser.</p>
      <button type="button" class="cta-vuoto" data-ricarica>Riprova</button></section>`;
    box.querySelector('[data-ricarica]')?.addEventListener('click', () => loadStats());
  }
}

async function disegnaRiepilogo(box) {

  let sq = supabase
    .from('rides')
    .select('id, ride_date, depart_time, origin, destination, seats, driver_id, fuel_per_person, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name))');
  sq = sq.eq('group_id', currentGroupId);
  const { data, error } = await sq;
  // Non si scrive un messaggio a mano: si lascia salire, cosi' l'errore vero finisce
  // in console e il riquadro di sopra e' l'unico posto che decide cosa mostrare.
  if (error) throw error;
  if (!data) throw new Error('nessun dato dai passaggi');

  // Le tre tabelle della 022-024. `eventi` non ha chiavi esterne (e' un registro
  // storico: deve sopravvivere a cio' che racconta), quindi PostgREST non puo'
  // unirla a `profiles` da solo e i nomi si risolvono qui sotto.
  const oggi = todayISO();
  const domani = todayISO(1);
  const [pagRes, evRes] = await Promise.all([
    supabase.from('pagamenti').select('da_utente, a_utente, importo, quando').eq('group_id', currentGroupId),
    supabase.from('eventi').select('tipo, attore, quando').eq('group_id', currentGroupId)
      .order('quando', { ascending: false }).limit(6),
  ]);
  const pagamenti = pagRes.data ?? [];
  const eventi = evRes.data ?? [];

  // ── Un giro solo sui passaggi, e tutte le somme che servono ───────────────
  const drives = new Map();      // guidatore -> {name, n}
  const drives30 = new Map();    // idem, ultimi 30 giorni
  const ridesTaken = new Map();  // passeggero -> {name, n}
  const nomePer = new Map();
  const trentaFa = isoMeno(oggi, 30);
  for (const r of data) {
    nomePer.set(r.driver_id, nomeDi(r.driver));
    const d = drives.get(r.driver_id) ?? { name: nomeDi(r.driver), n: 0 };
    d.n++; drives.set(r.driver_id, d);
    if (r.ride_date >= trentaFa && r.ride_date <= oggi) {
      const d30 = drives30.get(r.driver_id) ?? { name: nomeDi(r.driver), n: 0 };
      d30.n++; drives30.set(r.driver_id, d30);
    }
    for (const c of r.seat_claims) {
      nomePer.set(c.passenger_id, nomeDi(c.passenger));
      const p = ridesTaken.get(c.passenger_id) ?? { name: nomeDi(c.passenger), n: 0 };
      p.n++; ridesTaken.set(c.passenger_id, p);
    }
  }
  const futuri = data
    .filter(r => r.ride_date >= oggi)
    .sort((a, b) => (a.ride_date + (a.depart_time || '')).localeCompare(b.ride_date + (b.depart_time || '')));
  const prossimo = futuri[0] || null;
  const liberiTot = futuri.reduce((s, r) => s + Math.max(0, (r.seats || 0) - r.seat_claims.length), 0);
  const guidoIo = futuri.find(r => r.driver_id === currentUser.id) || null;
  const inizioMese = oggi.slice(0, 8) + '01';
  const nelMese = data.filter(r => r.ride_date >= inizioMese && r.ride_date <= oggi).length;

  // ── Il carburante ripartito, mese per mese ───────────────────────────────
  // Non e' quanto e' stato **pagato** (quello sta in `pagamenti`): e' quanto
  // valgono le quote dei posti occupati, cioe' la spesa che la comitiva si e'
  // divisa. Le due cose vanno tenute separate o il saldo non torna.
  const perMese = new Map();
  for (const r of data) {
    const q = Number(r.fuel_per_person) || 0;
    if (!q || !r.seat_claims.length) continue;
    const m = (r.ride_date || '').slice(0, 7);
    const v = perMese.get(m) ?? { tot: 0, n: 0 };
    v.tot += q * r.seat_claims.length;
    v.n += 1;
    perMese.set(m, v);
  }
  const mesiFinestra = ultimiMesi(oggi, 6);
  const serie = mesiFinestra.map(m => perMese.get(m)?.tot ?? 0);
  const meseCorr = perMese.get(oggi.slice(0, 7)) ?? { tot: 0, n: 0 };
  const mesePrec = perMese.get(mesiFinestra[mesiFinestra.length - 2]) ?? { tot: 0, n: 0 };
  const delta = mesePrec.tot > 0 ? Math.round(((meseCorr.tot - mesePrec.tot) / mesePrec.tot) * 100) : null;

  // ── Il mio saldo, con l'aritmetica di saldo_con() ────────────────────────
  const dovutoDaMe = new Map();   // guidatore -> quanto gli devo
  const dovutoAMe = new Map();    // passeggero -> quanto mi deve
  const quantiCon = new Map();    // altra persona -> quanti passaggi in ballo
  const primaCon = new Map();     // altra persona -> il piu' vecchio dei passaggi
  const segna = (id, giorno) => {
    quantiCon.set(id, (quantiCon.get(id) || 0) + 1);
    const p = primaCon.get(id);
    if (!p || giorno < p) primaCon.set(id, giorno);
  };
  for (const r of data) {
    const q = Number(r.fuel_per_person) || 0;
    if (!q) continue;
    for (const c of r.seat_claims) {
      if (c.passenger_id === currentUser.id && r.driver_id !== currentUser.id) {
        dovutoDaMe.set(r.driver_id, (dovutoDaMe.get(r.driver_id) || 0) + q);
        segna(r.driver_id, r.ride_date);
      } else if (r.driver_id === currentUser.id && c.passenger_id !== currentUser.id) {
        dovutoAMe.set(c.passenger_id, (dovutoAMe.get(c.passenger_id) || 0) + q);
        segna(c.passenger_id, r.ride_date);
      }
    }
  }
  for (const pg of pagamenti) {
    const imp = Number(pg.importo) || 0;
    if (pg.da_utente === currentUser.id) dovutoDaMe.set(pg.a_utente, (dovutoDaMe.get(pg.a_utente) || 0) - imp);
    if (pg.a_utente === currentUser.id) dovutoAMe.set(pg.da_utente, (dovutoAMe.get(pg.da_utente) || 0) - imp);
  }
  // Una riga per persona, non una per verso. Con due mappe separate chi ha
  // guidato per me **e** e' salito con me compariva due volte, una in credito e
  // una in debito, e il totale in cima non tornava con la somma delle righe
  // sotto. Il conto fra due persone e' uno solo: si sommano e si tiene il netto.
  const netto = new Map();
  for (const [id, v] of dovutoAMe) netto.set(id, (netto.get(id) || 0) + v);
  for (const [id, v] of dovutoDaMe) netto.set(id, (netto.get(id) || 0) - v);
  const partite = [...netto.entries()]
    .filter(([, v]) => Math.abs(v) >= 0.01)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v);
  const saldo = partite.reduce((s, p) => s + p.v, 0);

  // ── I prossimi sette giorni: chi guida, e i giorni senza nessuno ─────────
  const settimana = [];
  for (let i = 0; i < 7; i++) {
    const g = todayISO(i);
    const dellaGiornata = data.filter(r => r.ride_date === g)
      .sort((a, b) => (a.depart_time || '').localeCompare(b.depart_time || ''));
    const posti = dellaGiornata.reduce((s, r) => s + (r.seats || 0), 0);
    const presi = dellaGiornata.reduce((s, r) => s + r.seat_claims.length, 0);
    settimana.push({ giorno: g, rides: dellaGiornata, posti, presi });
  }
  const scoperti = settimana.filter(s => s.rides.length === 0).length;
  const primoScoperto = settimana.find(s => s.rides.length === 0);
  const postiSett = settimana.reduce((s, g) => s + g.posti, 0);
  const presiSett = settimana.reduce((s, g) => s + g.presi, 0);

  // L'agenda mostra il primo giorno che ha qualcosa: oggi se c'e', altrimenti
  // il primo giorno pieno. Un'agenda vuota su "oggi" non dice niente.
  const giornoAgenda = settimana.find(s => s.giorno === oggi && s.rides.length)
    || settimana.find(s => s.rides.length) || settimana[0];

  // ── L'occupazione di domani ──────────────────────────────────────────────
  const diDomani = data.filter(r => r.ride_date === domani);
  const postiDom = diDomani.reduce((s, r) => s + (r.seats || 0), 0);
  const occupatiDom = diDomani.reduce((s, r) => s + r.seat_claims.length, 0);
  const liberiDom = Math.max(0, postiDom - occupatiDom);

  // ── Il calendario del mese ───────────────────────────────────────────────
  const conPassaggio = new Set(data.map(r => r.ride_date));
  const guidoIl = new Set(data.filter(r => r.driver_id === currentUser.id).map(r => r.ride_date));

  // ── Da qui in giu' si scrive, non si calcola piu' ────────────────────────
  const eur = (n) => (Math.round(n * 100) / 100).toLocaleString('it-IT',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const ico = (id, w = 15) => `<svg width="${w}" height="${w}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const iniz = (n) => (String(n || '?').trim()[0] || '?').toUpperCase();
  const mio = (id) => id === currentUser.id;
  const nomeCorto = (id) => mio(id) ? 'Tu' : (nomePer.get(id) || 'Qualcuno');

  const kpi = [];
  kpi.push(guidoIo
    ? box_k('mio', 'Il tuo prossimo turno', dataBreve(guidoIo.ride_date),
        `${(guidoIo.depart_time || '').slice(0, 5)} · ${guidoIo.origin || '—'} → ${guidoIo.destination || ''}`)
    : box_k('', 'Il tuo prossimo turno', '—', 'non sei alla guida di nessun passaggio'));
  kpi.push(box_k('', 'Passaggi nel mese', String(nelMese),
    `${drives.size} ${drives.size === 1 ? 'persona alla guida' : 'persone alla guida'}`));
  kpi.push(box_k('mio', 'Il tuo saldo', (saldo >= 0 ? '+ ' : '− ') + eur(Math.abs(saldo)),
    partite.length ? `${partite.length} ${partite.length === 1 ? 'conto in sospeso' : 'conti in sospeso'}` : 'nessun conto in sospeso'));
  kpi.push(scoperti
    ? box_k('allerta', 'Giorni scoperti', String(scoperti),
        `il primo: ${dataBreve(primoScoperto.giorno)}`)
    : box_k('', 'Giorni scoperti', '0', 'sette giorni tutti coperti'));
  kpi.push(box_k('', 'Posti disponibili', String(liberiTot), 'sui passaggi in programma'));

  function box_k(cls, lab, val, nota) {
    return `<div class="k${cls ? ' ' + cls : ''}"><div class="lab">${escapeHtml(lab)}</div>` +
      `<div class="val">${escapeHtml(val)}</div><div class="nota">${escapeHtml(nota)}</div></div>`;
  }

  // Il grafico: si disegna solo se ci sono due mesi con qualcosa dentro. Una
  // linea costruita su un punto solo e' una decorazione, non una misura.
  const mesiPieni = serie.filter(v => v > 0).length;
  const via = sparkline(serie);

  const heroCarb = `
    <section class="card hero g-carburante">
      <div class="head">
        <span class="sub">Carburante ripartito · mese corrente</span>
        <span class="pill">${escapeHtml(groupLabel())}</span>
      </div>
      <div class="big">${escapeHtml(eur(meseCorr.tot))}</div>
      <div class="d">${
        delta === null ? 'primo mese con le quote registrate' :
        `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% sul mese precedente`
      }${meseCorr.n ? ` · ${escapeHtml(eur(meseCorr.tot / meseCorr.n))} per passaggio` : ''}</div>
      ${mesiPieni >= 2 ? `
      <svg viewBox="0 0 250 56" preserveAspectRatio="none" role="img"
           aria-label="Andamento del carburante ripartito negli ultimi sei mesi"
           style="width:100%;height:56px;margin-top:8px;display:block">
        <defs><linearGradient id="grad-carb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="oklch(0.74 0.13 78)" stop-opacity=".40"/>
          <stop offset="1" stop-color="oklch(0.74 0.13 78)" stop-opacity="0"/></linearGradient></defs>
        <path d="${via} L250,56 L0,56 Z" fill="url(#grad-carb)"/>
        <path d="${via}" fill="none" stroke="oklch(0.74 0.13 78)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg>` : ''}
      <button type="button" class="cta" data-vai="conti">Vedi i conti →</button>
    </section>`;

  const cardProssimo = prossimo ? `
    <section class="card next g-prossimo">
      <div class="head"><span class="sub">Prossimo passaggio · ${escapeHtml(dataBreve(prossimo.ride_date))}</span></div>
      <div class="titolo">${escapeHtml((prossimo.depart_time || '').slice(0, 5))} · ${escapeHtml(prossimo.origin || '—')} → ${escapeHtml(prossimo.destination || '')}</div>
      <div class="riga${mio(prossimo.driver_id) ? ' tua' : ''}"><span>Conducente</span><b>${escapeHtml(nomeCorto(prossimo.driver_id))}</b></div>
      <div class="riga"><span>Occupazione</span><b>${prossimo.seat_claims.length} / ${prossimo.seats} · ${Math.max(0, prossimo.seats - prossimo.seat_claims.length)} ${Math.max(0, prossimo.seats - prossimo.seat_claims.length) === 1 ? 'disponibile' : 'disponibili'}</b></div>
      <div class="riga"><span>Ritrovo</span><b>${escapeHtml(prossimo.origin || 'da concordare')}</b></div>
      <div class="riga"><span>${prossimo.seat_claims.length === 1 ? 'Passeggero' : 'Passeggeri'}</span><b>${
        prossimo.seat_claims.length
          ? prossimo.seat_claims.map(c => escapeHtml(nomeCorto(c.passenger_id))).join(' · ')
          : 'nessuno, per ora'}</b></div>
      <button type="button" class="go" data-vai="home" aria-label="Vai al passaggio">→</button>
    </section>` : `
    <section class="card next g-prossimo">
      <div class="head"><span class="sub">Prossimo passaggio</span></div>
      <div class="titolo">Nessun passaggio in programma</div>
      <div class="riga"><span>Guidi tu?</span><b>Pubblica la tua auto dalla Home</b></div>
      <button type="button" class="go" data-vai="home" aria-label="Vai alla Home">→</button>
    </section>`;

  // Il calendario del mese: le settimane cominciano di lunedi', come si usa qui.
  const primo = new Date(oggi.slice(0, 8) + '01T00:00:00');
  const scarto = (primo.getDay() + 6) % 7;
  const celle = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(primo);
    d.setDate(1 - scarto + i);
    const iso = isoDi(d);
    if (i >= 35 && d.getMonth() !== primo.getMonth()) break;
    const cls = [];
    if (d.getMonth() !== primo.getMonth()) cls.push('fuori');
    if (iso === oggi) cls.push('oggi');
    else if (guidoIl.has(iso)) cls.push('mio');
    else if (conPassaggio.has(iso)) cls.push('ha');
    celle.push(`<span class="${cls.join(' ')}">${d.getDate()}</span>`);
  }

  const cardCal = `
    <section class="card cal g-calendario">
      <div class="head"><h3>${escapeHtml(meseInLettere(oggi))}</h3><span class="sub">oggi · tuoi turni · con auto</span></div>
      <div class="dows"><span>L</span><span>M</span><span>M</span><span>G</span><span>V</span><span>S</span><span>D</span></div>
      <div class="days">${celle.join('')}</div>
      <div style="margin-top:9px">
        ${giornoAgenda.rides.length
          ? giornoAgenda.rides.slice(0, 4).map(r => {
              const pieno = r.seat_claims.length >= (r.seats || 0);
              return `<div class="ag">
                <span class="h">${escapeHtml((r.depart_time || '').slice(0, 5) || '—')}</span>
                <div class="t">${escapeHtml(r.origin || '—')} → ${escapeHtml(r.destination || '')}
                  <small>${escapeHtml(nomeCorto(r.driver_id))} · ${r.seat_claims.length}/${r.seats}${pieno ? ' completo' : ''}</small></div>
                <span class="chip${mio(r.driver_id) ? ' mia' : ''}" style="background:${mio(r.driver_id) ? 'var(--ottone-velo)' : 'var(--primary-soft)'}">${ico('car', 13)}</span>
              </div>`;
            }).join('')
          : '<p class="vuoto" style="margin:0">Nessun passaggio nei prossimi sette giorni.</p>'}
      </div>
    </section>`;

  // La ciambella si disegna solo se domani esiste qualcosa da ripartire.
  const cardDomani = postiDom > 0 ? `
    <section class="card hero g-domani">
      <div class="head"><h3>Occupazione · domani</h3><span class="sub">${postiDom}</span></div>
      <div class="ciambella">
        <svg width="74" height="74" viewBox="0 0 42 42" style="flex:none" role="img"
             aria-label="${occupatiDom} posti occupati su ${postiDom}">
          <circle cx="21" cy="21" r="16" fill="none" stroke="oklch(1 0 0/.10)" stroke-width="7"/>
          <circle cx="21" cy="21" r="16" fill="none" stroke="oklch(0.52 0.11 165)" stroke-width="7"
                  stroke-dasharray="${((occupatiDom / postiDom) * 100).toFixed(1)} 100" transform="rotate(-90 21 21)"/>
          <circle cx="21" cy="21" r="16" fill="none" stroke="oklch(0.52 0.13 255)" stroke-width="7"
                  stroke-dasharray="${((liberiDom / postiDom) * 100).toFixed(1)} 100"
                  stroke-dashoffset="-${((occupatiDom / postiDom) * 100).toFixed(1)}" transform="rotate(-90 21 21)"/>
          <text x="21" y="20" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff">${postiDom}</text>
          <text x="21" y="26" text-anchor="middle" font-size="3.4" fill="oklch(0.72 0.03 258)">posti</text>
        </svg>
        <div class="leg">
          <div><i style="background:oklch(0.52 0.11 165)"></i><span class="nm">Occupati</span><b>${occupatiDom}</b></div>
          <div><i style="background:oklch(0.52 0.13 255)"></i><span class="nm">Disponibili</span><b>${liberiDom}</b></div>
          <div><i style="background:oklch(1 0 0/.18)"></i><span class="nm">Auto in strada</span><b>${diDomani.length}</b></div>
        </div>
      </div>
    </section>` : `
    <section class="card hero g-domani">
      <div class="head"><h3>Occupazione · domani</h3></div>
      <p class="vuoto" style="color:oklch(0.72 0.03 258)">Domani non c'è nessuna auto in programma.
      Se guidi tu, pubblicala dalla Home.</p>
    </section>`;

  const ETICHETTA = {
    passaggio_pubblicato: 'ha pubblicato un passaggio',
    passaggio_annullato: 'ha annullato un passaggio',
    posto_preso: 'ha preso un posto',
    posto_liberato: 'ha liberato un posto',
    membro_entrato: 'è entrato nella comitiva',
    pagamento_registrato: 'ha registrato un pagamento',
  };

  const cardAttivita = `
    <section class="card g-attivita">
      <div class="head"><h3>Attività recente</h3></div>
      ${eventi.length ? eventi.map(e => {
        const chi = nomeCorto(e.attore);
        return `<div class="att">
          <div class="av" style="background:${mio(e.attore) ? 'var(--ottone)' : coloreDi(e.attore)};${mio(e.attore) ? 'color:oklch(0.28 0.05 70)' : ''}">${escapeHtml(iniz(chi))}</div>
          <div class="txt"><b>${escapeHtml(chi)}</b> — ${ETICHETTA[e.tipo] || escapeHtml(e.tipo)}</div>
          <span class="when">${escapeHtml(quandoBreve(e.quando))}</span>
        </div>`;
      }).join('')
      : '<p class="vuoto">Il registro parte da quando è stato acceso: qui comparirà quello che succede da adesso in poi.</p>'}
    </section>`;

  const AZIONI = [
    ['plus', 'Pubblica<br>un passaggio', 'offerta'],
    ['walk', 'Cerco<br>un passaggio', 'richiesta'],
    ['users', 'Invita<br>un membro', 'invita'],
    ['history', 'Guarda<br>lo storico', 'storico'],
    ['user', 'Il tuo<br>profilo', 'profilo'],
  ];
  const cardAzioni = `<div class="azioni g-azioni">${AZIONI.map(([i, t, a]) =>
    `<button type="button" class="az" data-azione="${a}"><span class="o">${ico(i)}</span><span class="t">${t}</span></button>`).join('')}</div>`;

  const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const nomeGiorno = (iso) => GIORNI[(new Date(iso + 'T00:00:00').getDay() + 6) % 7];
  const cardSettimana = `
    <section class="card g-settimana">
      <div class="head"><div><h3>Occupazione settimanale</h3>
        <span class="sub">posti assegnati, giorno per giorno</span></div></div>
      ${settimana.map(g => {
        // Con piu' di un'auto nello stesso giorno il nome di chi guida la prima
        // sarebbe una mezza verita': si dice quante sono.
        const guidatori = new Set(g.rides.map(r => r.driver_id));
        const suo = guidatori.has(currentUser.id);
        const perc = g.posti ? (g.presi / g.posti) * 100 : 0;
        const et = `${nomeGiorno(g.giorno)} · ` + (
          g.rides.length === 0 ? 'scoperto'
          : guidatori.size > 1 ? `${guidatori.size} auto`
          : nomeCorto(g.rides[0].driver_id).toLowerCase());
        return `<div class="riemp">
          <span class="n">${suo ? `<span class="tu">${escapeHtml(et)}</span>` : escapeHtml(et)}</span>
          <span class="bar"><i style="width:${perc.toFixed(0)}%;background:${
            !g.posti ? 'transparent' : perc >= 100 ? 'var(--ok)' : suo ? 'var(--ottone)' : 'var(--primary-bright)'}"></i></span>
          <span class="p">${g.posti ? `${g.presi}/${g.posti}` : '—'}</span>
        </div>`;
      }).join('')}
      <div class="piede"><b>${presiSett} / ${postiSett}</b> posti assegnati nei prossimi sette giorni${
        scoperti ? ` · <b style="color:var(--danger)">${scoperti} ${scoperti === 1 ? 'giorno scoperto' : 'giorni scoperti'}</b>` : ' · nessun giorno scoperto'}</div>
    </section>`;

  const turni = [...drives30.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const totTurni = turni.reduce((s, [, v]) => s + v.n, 0);
  const mieiTurni = drives30.get(currentUser.id)?.n ?? 0;
  const cardTurni = turni.length ? `
    <section class="card g-turni">
      <div class="head"><div><h3>Distribuzione turni</h3><span class="sub">ultimi 30 giorni</span></div></div>
      ${turni.map(([id, v]) => {
        const suo = mio(id);
        return `<div class="turno">
          <span class="n">${suo ? '<b>Tu</b>' : escapeHtml(v.name)}</span>
          <span class="bar"><i style="width:${totTurni ? ((v.n / turni[0][1].n) * 100).toFixed(0) : 0}%;background:${suo ? 'var(--ottone)' : 'var(--primary-bright)'}"></i><em>${v.n}</em></span>
        </div>`;
      }).join('')}
      <div class="piede"><b style="color:var(--ottone-scuro)">${totTurni ? Math.round((mieiTurni / totTurni) * 100) : 0}%</b> dei turni a tuo carico</div>
    </section>` : `
    <section class="card g-turni">
      <div class="head"><div><h3>Distribuzione turni</h3><span class="sub">ultimi 30 giorni</span></div></div>
      <p class="vuoto">Negli ultimi trenta giorni non ha guidato nessuno.</p>
    </section>`;

  const cardConti = `
    <section class="card g-conti" id="dash-conti">
      <div class="head"><div><h3>Conti in sospeso</h3>
        <span class="sub">quote di carburante non ancora saldate</span></div>
        <span class="pill">Saldo: <b style="color:${saldo >= 0 ? 'var(--ok-deep)' : 'var(--danger)'}">${saldo >= 0 ? '+ ' : '− '}${escapeHtml(eur(Math.abs(saldo)))}</b></span></div>
      ${partite.length ? `<div class="conti">${partite.map(p => {
        const n = quantiCon.get(p.id) || 0;
        const da = primaCon.get(p.id);
        return `<div class="conto">
          <div class="av" style="background:${coloreDi(p.id)}">${escapeHtml(iniz(nomePer.get(p.id)))}</div>
          <div class="chi">${escapeHtml(nomePer.get(p.id) || 'Qualcuno')}<small>${n} ${n === 1 ? 'passaggio' : 'passaggi'}${da ? ` · dal ${escapeHtml(dataBreve(da))}` : ''}</small></div>
          <span class="imp ${p.v >= 0 ? 'avere' : 'dare'}">${p.v >= 0 ? '+ ' : '− '}${escapeHtml(eur(Math.abs(p.v)))}</span>
        </div>`;
      }).join('')}</div>`
      : '<p class="vuoto">Nessun conto in sospeso. Compaiono qui quando chi guida indica un «€ a testa».</p>'}
      <div class="piede">Gli importi li vedete solo tu e la persona interessata: la policy sulla tabella nomina le due parti, non la comitiva.</div>
    </section>`;

  box.innerHTML =
    `<div class="dash-top">
      <div class="dash-hi">
        <h1>Riepilogo</h1>
        <p>${escapeHtml(oggiInLettere())} · ${futuri.length} ${futuri.length === 1 ? 'passaggio in programma' : 'passaggi in programma'}${
          scoperti ? ` · ${scoperti} ${scoperti === 1 ? 'giorno scoperto' : 'giorni scoperti'}` : ''}</p>
      </div>
      <span class="dash-gruppo">${escapeHtml(groupLabel())}</span>
      <span class="dash-av">${escapeHtml(iniz(myName))}</span>
    </div>

    <div class="kpi">${kpi.join('')}</div>

    <div class="grid">
      ${heroCarb}
      ${cardProssimo}
      ${cardCal}
      ${cardAzioni}
      ${cardSettimana}
      ${cardTurni}
      ${cardAttivita}
      ${cardConti}
      ${cardDomani}
    </div>`;

  // I riquadri portano da qualche parte: nessun bottone qui sopra e' finto.
  box.querySelectorAll('[data-vai]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.vai === 'home') switchView('home');
    if (b.dataset.vai === 'conti') document.getElementById('dash-conti')?.scrollIntoView({ block: 'start' });
  }));
  box.querySelectorAll('[data-azione]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.azione;
    // Il modulo si apre, non si commuta: chi tocca «Pubblica un passaggio» vuole
    // il modulo aperto, e con `.click()` toccarlo due volte lo richiudeva.
    if (a === 'offerta') {
      switchView('home');
      if (offerCard.classList.contains('hidden')) document.getElementById('offer-toggle')?.click();
      offerCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Qui **non** si preme il bottone vero, e non e' una svista: «Cerco un
    // passaggio» non apre un modulo, pubblica la richiesta — e ripremuto la
    // ritira. Una mattonella che scrive nel database senza mostrare cosa sta
    // scrivendo non e' una scorciatoia, e' un tranello. Si porta la persona
    // dov'e' il bottone e decide lei.
    if (a === 'richiesta') {
      switchView('home');
      const b = document.getElementById('request-toggle');
      b?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      b?.focus({ preventScroll: true });
    }
    if (a === 'invita') switchView('groups');
    if (a === 'storico') switchView('history');
    if (a === 'profilo') switchView('profile');
  }));
}

// ── Attrezzi del riepilogo ─────────────────────────────────────────────────

// Il tondo colorato accanto a un nome. Deriva dall'id, quindi la stessa persona
// ha lo stesso colore in tutti i riquadri e fra una visita e l'altra — senza
// tenere da nessuna parte una tabella di colori.
const COLORI_AV = ['var(--primary)', 'var(--ok)', 'oklch(0.6 0.03 258)',
  'oklch(0.55 0.14 300)', 'oklch(0.55 0.13 30)', 'oklch(0.5 0.1 200)'];
function coloreDi(id) {
  let h = 0;
  for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORI_AV[h % COLORI_AV.length];
}

// La linea del grafico. Curve di Bézier con i punti di controllo sulla verticale
// di mezzo fra due punti: e' la curva morbida piu' semplice che non puo'
// oltrepassare i valori veri, quindi non racconta un massimo che non c'e'.
function sparkline(vals, w = 250, h = 56) {
  const max = Math.max(...vals, 1);
  const pts = vals.map((v, i) => [
    (i / Math.max(1, vals.length - 1)) * w,
    h - 8 - (v / max) * (h - 16),
  ]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const cx = ((x0 + x1) / 2).toFixed(1);
    d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

// Le ultime `n` mensilita' che finiscono con quella di `iso`, come '2026-08'.
function ultimiMesi(iso, n) {
  const d = new Date(iso.slice(0, 8) + '01T00:00:00');
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d);
    m.setMonth(m.getMonth() - i);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Date in ISO senza passare da UTC: `toISOString()` sposta di un giorno chi sta
// a est di Greenwich la sera, ed e' un difetto che si vede solo dopo le 22.
function isoDi(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoMeno(iso, giorni) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - giorni);
  return isoDi(d);
}
function meseInLettere(iso) {
  const d = new Date(iso.slice(0, 8) + '01T00:00:00');
  const s = d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function oggiInLettere() {
  const s = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Data breve, per i riquadri: «gio 7 ago».
function dataBreve(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

// «2 min», «3 h», «5 g»: quanto e' passato, senza librerie.
function quandoBreve(ts) {
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  if (m < 60) return m + ' min';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h';
  return Math.round(h / 24) + ' g';
}

// --- Giorno ---
dayToday.addEventListener('click', () => setDate(todayISO()));
dayTomorrow.addEventListener('click', () => setDate(todayISO(1)));
dayPicker.addEventListener('change', () => { if (dayPicker.value) setDate(dayPicker.value); });

function setDate(date) {
  currentDate = date;
  dayToday.classList.toggle('active', date === todayISO());
  dayTomorrow.classList.toggle('active', date === todayISO(1));
  dayPicker.classList.toggle('active', date !== todayISO() && date !== todayISO(1));
  dayPicker.value = date;
  // il canale realtime filtra sul giorno visualizzato: cambiato giorno, ci si riabbona
  if (realtimeChannel) subscribeRealtime();
  loadRides();
}

// Prenotando o pubblicando, la richiesta "cerco un passaggio" si toglie da sola
async function clearMyRequest() {
  await supabase.from('ride_requests').delete()
    .eq('user_id', currentUser.id).eq('ride_date', currentDate).eq('group_id', currentGroupId);
}

// --- Offri passaggio ---
offerToggle.addEventListener('click', async () => {
  offerCard.classList.toggle('hidden');
  if (offerCard.classList.contains('hidden')) return;
  document.getElementById('ride-destination').focus();
  // Precompila con l'ultimo viaggio pubblicato
  const dest = document.getElementById('ride-destination');
  if (!dest.value) {
    const { data } = await supabase
      .from('rides')
      .select('origin, destination, depart_time, seats, note, fuel_per_person')
      .eq('driver_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && !dest.value) {
      document.getElementById('ride-origin').value = data.origin ?? '';
      dest.value = data.destination ?? '';
      document.getElementById('ride-time').value = data.depart_time?.slice(0, 5) ?? '';
      document.getElementById('ride-seats').value = String(data.seats);
      document.getElementById('ride-fuel').value = data.fuel_per_person ?? '';
      document.getElementById('ride-note').value = data.note ?? '';
      toast('Modulo precompilato con il tuo ultimo viaggio: cambia quello che vuoi.');
    }
  }
});

rideForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (bloccaSeSospeso('pubblicare un\'auto')) return;
  const base = {
    driver_id: currentUser.id,
    group_id: currentGroupId,
    depart_time: document.getElementById('ride-time').value || null,
    origin: document.getElementById('ride-origin').value.trim() || null,
    visibilita: document.getElementById('ride-visibilita').value,
    origin_lat: partenza ? partenza.lat : null,
    origin_lon: partenza ? partenza.lon : null,
    destination: document.getElementById('ride-destination').value.trim(),
    seats: Number(document.getElementById('ride-seats').value),
    fuel_per_person: Number(document.getElementById('ride-fuel').value) || null,
    note: document.getElementById('ride-note').value.trim() || null,
  };
  if (base.visibilita === 'zona' && base.origin_lat === null) {
    toast('Per aprire il passaggio a chi è in zona serve "Parto da qui": senza, non lo vedrebbe nessuno.');
    return;
  }
  const weeks = Number(document.getElementById('ride-repeat').value) || 1;
  let published = 0;
  let firstError = null;
  for (let w = 0; w < weeks; w++) {
    const { error } = await supabase.from('rides').insert({
      ...base,
      ride_date: addDaysISO(currentDate, w * 7),
    });
    if (error) { firstError = firstError ?? error; } else { published++; }
  }
  if (published === 0) {
    toast(firstError?.code === '23505'
      ? 'Hai già pubblicato la tua auto per questo giorno.'
      : friendlyError(firstError));
    return;
  }
  rideForm.reset();
  // reset() non tocca le variabili: senza questo, la posizione segnata resterebbe
  // appiccicata alla pubblicazione successiva, che magari parte da un'altra parte.
  partenza = null;
  document.getElementById('ride-posizione').textContent = '';
  offerCard.classList.add('hidden');
  toast(published === 1
    ? 'Auto pubblicata: ora gli amici possono prenotare il posto.'
    : `Auto pubblicata per ${published} settimane.`);
  await clearMyRequest();
  loadRides();
});

// --- Notifiche (quando la scheda è in background) ---
let lastNotify = 0;
function maybeNotify(text) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (Date.now() - lastNotify < 30000) return; // non più di una ogni 30s
  lastNotify = Date.now();
  try { new Notification('WeTransport', { body: text, icon: 'icon.svg' }); } catch {}
}

function askNotifyPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  // la chiediamo al primo gesto dell'utente, non a freddo
  const ask = () => { Notification.requestPermission(); document.removeEventListener('click', ask); };
  document.addEventListener('click', ask, { once: true });
}

// --- Realtime ---
// Il canale filtra sul giorno guardato, quindi riabbonarsi allo stesso giorno e' lavoro
// per niente: succedeva a ogni accesso, perche' render() sottoscrive e poi chiama
// setDate(), che sottoscrive di nuovo. Una connessione aperta e chiusa nello stesso
// istante, e sulla rete di un telefono si sente.
function subscribeRealtime() {
  if (realtimeChannel && realtimeDate === currentDate) return;
  realtimeDate = currentDate;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel('posti-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_claims' }, () => {
      maybeNotify('Movimenti sui sedili: qualcuno è salito o sceso.');
      loadRides(true);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides', filter: `ride_date=eq.${currentDate}` }, () => {
      maybeNotify('Nuova auto pubblicata: corri a prenotare il posto.');
      loadRides(true);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rides' }, () => loadRides(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_waitlist' }, () => loadRides(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests', filter: `ride_date=eq.${currentDate}` }, () => loadRides(true))
    .subscribe();
}

// --- Caricamento passaggi ---
// --- Toast + banner "come funziona" ---
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

const howto = document.getElementById('howto');
if (!localStorage.getItem('posti-howto-done')) howto.classList.remove('hidden');
document.getElementById('howto-close').addEventListener('click', () => {
  howto.classList.add('hidden');
  localStorage.setItem('posti-howto-done', '1');
});

// I nomi finiscono dentro stringhe HTML in due punti (statistiche e "tocca a te
// guidare"). Prima si sostituiva solo "<": bastava una & per rompere il testo.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hueFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function isPastDay() { return currentDate < todayISO(); }

// Messaggi d'errore: i trigger del DB parlano già italiano
function friendlyError(error) {
  if (error.code === 'P0001') return error.message;
  if (error.code === '23505') return 'Operazione già registrata.';
  return 'Errore: ' + error.message;
}

let currentRequests = [];
let loadToken = 0;
// Le colonne di `rides` si nominano una per una, e non e' pignoleria (cantiere C21): da
// `016_coordinate_riservate.sql` un client non ha il permesso di leggere origin_lat,
// origin_lon, dest_lat e dest_lon, quindi `select('*')` verrebbe rifiutato in blocco.
// Aggiungendo una colonna a `rides`, va aggiunta anche qui.
const COLONNE_RIDE = 'id, driver_id, ride_date, depart_time, origin, destination, seats, note, created_at, group_id, fuel_per_person, visibilita';

// Le coordinate del ritrovo arrivano a parte, e solo per i passaggi a cui si ha diritto:
// e' il database a decidere quali (`coordinate_passaggi`), non il client. Chi resta senza
// non ha un buco in pagina — il link torna a cercare il nome del luogo, com'era prima di
// C14 — quindi un errore qui degrada, non rompe.
async function attaccaCoordinate(rides) {
  if (!rides?.length) return;
  for (const r of rides) r.partenza = null;
  const { data, error } = await supabase.rpc('coordinate_passaggi', { ids: rides.map((r) => r.id) });
  if (error) { console.error(error); return; }
  const punti = new Map((data ?? []).map((c) => [c.ride_id, { lat: c.origin_lat, lon: c.origin_lon }]));
  for (const r of rides) r.partenza = punti.get(r.id) ?? null;
}

let retryCount = 0;
async function loadRides(silent = false) {
  // Senza comitiva non c'e' niente da caricare: la Home mostra il benvenuto (vedi loadGroups).
  if (!currentGroupId) return;
  const token = ++loadToken;
  if (!silent) {
    ridesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    emptyMessage.classList.add('hidden');
  }
  let query = supabase
    .from('rides')
    .select(`${COLONNE_RIDE}, driver:profiles!rides_driver_id_fkey(display_name, avatar_url), seat_claims(seat_index, passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name, avatar_url)), ride_comments(count), ride_waitlist(user_id, created_at, profile:profiles(display_name))`)
    .eq('ride_date', currentDate)
    .order('depart_time', { ascending: true, nullsFirst: false });
  // Niente piu' filtro sul gruppo qui: da C9 la policy fa uscire anche i passaggi aperti
  // alla zona o a chiunque, e filtrarli di nuovo nel client li rimetterebbe dentro la
  // comitiva. Quali siano "di fuori" lo dice group_id al momento di disegnarli.

  let reqQuery = supabase
    .from('ride_requests')
    .select('user_id, profile:profiles(display_name)')
    .eq('ride_date', currentDate);
  reqQuery = reqQuery.eq('group_id', currentGroupId);

  const [{ data, error }, { data: reqs }] = await Promise.all([query, reqQuery]);
  if (token !== loadToken) return; // risposta vecchia, ignora
  if (error) {
    console.error(error);
    // retry con backoff esponenziale (0.5s, 1.5s), poi arrendersi con messaggio
    if (retryCount < 2) {
      retryCount++;
      setTimeout(() => { if (token === loadToken) loadRides(true); }, retryCount === 1 ? 500 : 1500);
      return;
    }
    retryCount = 0;
    ridesList.innerHTML = '';
    document.getElementById('day-stats').classList.add('hidden');
    walkersCard.classList.add('hidden');
    toast('Connessione instabile: riprova tra un attimo.');
    return;
  }
  retryCount = 0;
  // La policy fa uscire tutto il visibile, e "visibile" comprende **le altre comitive di
  // cui faccio parte**: senza questo filtro, guardando il gruppo A comparivano anche le
  // auto del gruppo B, per giunta con l'etichetta "in zona" — che e' falsa, sono mie.
  // Restano quelle di fuori (zona o pubbliche), che sono il senso di C9.
  const miei = new Set(myGroups.map((g) => g.id));
  const visibili = (data ?? []).filter((r) => r.group_id === currentGroupId || !miei.has(r.group_id));
  await attaccaCoordinate(visibili);
  if (token !== loadToken) return; // e' passata un'altra richiesta mentre chiedevo i punti
  currentRequests = reqs ?? [];
  updateDayCta(visibili);
  renderRides(visibili);
  renderWalkers(visibili);
  renderTurnHint();
}

// --- "Tocca a te guidare": chi ha guidato meno nelle ultime 4 settimane ---
async function renderTurnHint() {
  const el = document.getElementById('turn-hint');
  el.classList.add('hidden');
  if (!currentGroupId || isPastDay()) return;
  const since = addDaysISO(todayISO(), -28);
  const [{ data: members }, { data: drives }] = await Promise.all([
    supabase.from('group_members').select('user_id, profile:profiles(display_name)').eq('group_id', currentGroupId),
    supabase.from('rides').select('driver_id').eq('group_id', currentGroupId).gte('ride_date', since).lte('ride_date', todayISO()),
  ]);
  // Ha senso solo con un gruppo vivo: almeno 2 membri e 3 viaggi recenti
  if (!members || members.length < 2 || !drives || drives.length < 3) return;
  const counts = new Map(members.map(m => [m.user_id, 0]));
  for (const d of drives) if (counts.has(d.driver_id)) counts.set(d.driver_id, counts.get(d.driver_id) + 1);
  const sorted = [...counts.entries()].sort((a, b) => a[1] - b[1]);
  const [lazyId, lazyN] = sorted[0];
  const maxN = sorted[sorted.length - 1][1];
  if (maxN - lazyN < 2) return; // turni già equi, niente frecciatine
  const lazyName = nomeDi(members.find(m => m.user_id === lazyId)?.profile);
  el.innerHTML = lazyId === currentUser.id
    ? `🚗 Nelle ultime 4 settimane hai guidato ${lazyN === 0 ? 'zero volte' : `solo ${lazyN} ${lazyN === 1 ? 'volta' : 'volte'}`}: tocca a te metterci l'auto 👀`
    : `👀 ${escapeHtml(lazyName)} ha guidato ${lazyN === 0 ? 'zero volte' : `solo ${lazyN} ${lazyN === 1 ? 'volta' : 'volte'}`} nelle ultime 4 settimane… i turni parlano da soli`;
  el.classList.remove('hidden');
}

// Bottoni del giorno: nascosti nei giorni passati; "Cerco un passaggio" contestuale
function updateDayCta(rides) {
  const past = isPastDay();
  // `sospeso` va rimesso qui e non solo in applicaSospensione(): questa riga gira a ogni
  // caricamento dei passaggi e senza il controllo rimetterebbe il pulsante "pubblica" a
  // chi e' sospeso, che poi si prenderebbe un errore dal database.
  offerToggle.classList.toggle('hidden', past || sospeso);
  if (past || sospeso) offerCard.classList.add('hidden');
  const reqBtn = document.getElementById('request-toggle');
  const iDrive = rides.some(r => r.driver_id === currentUser.id);
  const iSit = rides.some(r => r.seat_claims.some(c => c.passenger_id === currentUser.id));
  const myReq = currentRequests.some(r => r.user_id === currentUser.id);
  reqBtn.classList.toggle('hidden', past || iDrive || iSit);
  reqBtn.innerHTML = myReq
    ? '<svg width="15" height="15"><use href="#i-x"/></svg> Non cerco più'
    : '<svg width="15" height="15"><use href="#i-walk"/></svg> Cerco un passaggio';
}

document.getElementById('request-toggle').addEventListener('click', async () => {
  const myReq = currentRequests.some(r => r.user_id === currentUser.id);
  if (myReq) {
    await supabase.from('ride_requests').delete()
      .eq('user_id', currentUser.id).eq('ride_date', currentDate).eq('group_id', currentGroupId);
    toast('Richiesta rimossa.');
  } else {
    if (bloccaSeSospeso('chiedere un passaggio')) return;
    const { error } = await supabase.from('ride_requests').insert({
      user_id: currentUser.id, ride_date: currentDate, group_id: currentGroupId,
    });
    if (error && error.code !== '23505') { toast(friendlyError(error)); return; }
    toast('Fatto: i guidatori vedranno che cerchi un passaggio.');
  }
  loadRides(true);
});

// --- "A piedi" (solo nei gruppi) ---
async function renderWalkers(rides) {
  const seated = new Set();
  for (const r of rides) {
    seated.add(r.driver_id);
    for (const c of r.seat_claims) seated.add(c.passenger_id);
  }
  const requesters = new Set(currentRequests.map(r => r.user_id));

  // Si arriva qui solo con una comitiva scelta (loadRides esce prima, altrimenti):
  // il ramo "senza gruppo" e' sparito con C4.
  const { data } = await supabase
    .from('group_members')
    .select('user_id, profile:profiles(display_name)')
    .eq('group_id', currentGroupId);
  const members = data ?? [];

  const walkers = members.filter(m => !seated.has(m.user_id));
  // chi cerca un passaggio prima di tutti
  walkers.sort((a, b) => Number(requesters.has(b.user_id)) - Number(requesters.has(a.user_id)));
  walkersCard.classList.toggle('hidden', walkers.length === 0);
  walkersList.innerHTML = '';
  const seen = new Set();
  for (const w of walkers) {
    if (seen.has(w.user_id)) continue;
    seen.add(w.user_id);
    const chip = document.createElement('span');
    const wants = requesters.has(w.user_id);
    chip.className = 'walker-chip' + (wants ? ' request' : '');
    chip.textContent = nomeDi(w.profile)
      + (w.user_id === currentUser.id ? ' (tu)' : '')
      + (wants ? ' · cerca un passaggio' : '');
    walkersList.appendChild(chip);
  }
}

// --- Macchina SVG ---
// Layout sedili centrato nella carrozzeria (larghezza 190, centro x = 95).
// Il guidatore è sempre davanti a sinistra; le posizioni dei passeggeri
// dipendono da quanti posti offre l'auto.
// Le tre file sono equidistanti: 92, 176, 260, cioe' 84 di passo. Prima l'ultima
// era a 252, quindi 84 e poi 76: la terza fila risultava schiacciata verso il
// lunotto, e su un disegno simmetrico si vede subito anche senza misurarlo.
const PASSO_FILA = 84;
const ROW_FRONT = 92, ROW_BACK = ROW_FRONT + PASSO_FILA, ROW_THIRD = ROW_BACK + PASSO_FILA;

// La geometria della scocca. Tutto quello che sta a destra si RICAVA da quello che
// sta a sinistra: scrivere le due coordinate a mano e' esattamente il modo in cui
// le ruote sono finite fuori di 4px, con quelle di sinistra tagliate dal bordo.
const CAR_W = 190;
const CAR_INSET = 10;                       // margine della scocca dal viewBox
const specchia = (x, w) => CAR_W - x - w;   // riflette un rettangolo sull'asse
const DRIVER_POS = { x: 58, y: ROW_FRONT };
const SEAT_LAYOUTS = {
  1: { 1: { x: 132, y: ROW_FRONT } },
  2: { 1: { x: 132, y: ROW_FRONT }, 4: { x: 95, y: ROW_BACK } },
  3: { 1: { x: 132, y: ROW_FRONT }, 2: { x: 58, y: ROW_BACK }, 4: { x: 132, y: ROW_BACK } },
  4: { 1: { x: 132, y: ROW_FRONT }, 2: { x: 43, y: ROW_BACK }, 3: { x: 95, y: ROW_BACK }, 4: { x: 147, y: ROW_BACK } },
  5: { 1: { x: 132, y: ROW_FRONT }, 2: { x: 43, y: ROW_BACK }, 3: { x: 95, y: ROW_BACK }, 4: { x: 147, y: ROW_BACK }, 6: { x: 95, y: ROW_THIRD } },
  6: { 1: { x: 132, y: ROW_FRONT }, 2: { x: 43, y: ROW_BACK }, 3: { x: 95, y: ROW_BACK }, 4: { x: 147, y: ROW_BACK }, 5: { x: 58, y: ROW_THIRD }, 6: { x: 132, y: ROW_THIRD } },
};

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// --- Navigazione al ritrovo (cantiere C14, decisione D6) ---
// Le coordinate della partenza esistono da C9, ma il link continuava a cercare il testo
// libero: "piazza" trova la piazza sbagliata, e il ritrovo si sposta di un chilometro.
// Con origin_lat/origin_lon il punto e' quello vero, e il link apre il percorso invece
// della sola ricerca. Nessun servizio nuovo: e' un indirizzo di Maps, non un SDK.
//
// **Non a tutti lo stesso link, pero'.** La policy di 014 e' di riga, non di colonna: chi
// vede un passaggio 'zona' o 'pubblico' riceve la riga intera, coordinate comprese, e il
// punto di partenza di una persona puo' essere casa sua al metro. Dentro la comitiva (o
// avendo un posto sopra quell'auto) il punto esatto e' esattamente quello che serve; da
// fuori resta la ricerca sul nome del luogo, che dice la zona e non l'indirizzo.
// Restringere anche il payload e' un cantiere a parte, ed e' scritto in ROADMAP: qui si
// smette di *offrire* l'indirizzo con un click, non si finge che il dato non arrivi.
// Chi vede il punto esatto di partenza e chi no. Una decisione sola, in un posto solo: la
// usano sia il link di navigazione sia il file del calendario, e se cambia idea cambia qui.
// Da C21 la domanda non si fa piu' qui: le coordinate arrivano **solo** se il database ha
// deciso che si possono avere (`coordinate_passaggi`), quindi averle in mano *e'* il
// permesso. Prima questa funzione decideva sul group_id della comitiva aperta in quel
// momento, cioe' rispondeva a una domanda diversa da quella del server; ora e' una sola
// risposta, e sta dove stanno tutte le altre regole di visibilita'.
function coordinateVisibili(ride) {
  return ride.partenza != null;
}

function linkRitrovo(ride) {
  if (coordinateVisibili(ride)) {
    return {
      href: 'https://www.google.com/maps/dir/?api=1&destination='
        + encodeURIComponent(`${ride.partenza.lat},${ride.partenza.lon}`),
      testo: 'Naviga al ritrovo',
    };
  }
  // Senza coordinate — o guardando da fuori — vale quello che c'era: il testo libero.
  // Vale anche per ogni passaggio pubblicato prima della 014, che coordinate non ne ha.
  if (!ride.origin) return null;
  return {
    href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ride.origin),
    testo: 'Punto di ritrovo su Maps',
  };
}

// --- Il passaggio nel calendario (cantiere C14, decisione D6) ---
// Un file .ics costruito qui dentro: nessun servizio esterno da avvisare di dove va la
// gente, e Google, Apple e Outlook lo aprono allo stesso modo. Il formato e' pignolo su tre
// cose, e sbagliarne una vuol dire un file che un calendario apre e un altro rifiuta senza
// dire perche': le righe finiscono con CRLF e non con \n, virgole e punto e virgola dentro
// il testo vanno protetti, e le righe lunghe vanno spezzate.
function testoIcs(ride) {
  const esc = (s) => String(s)
    .replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const istante = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const giorno = (iso) => iso.replace(/-/g, '');

  const righe = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WeTransport//IT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ride.id}@wetransport`,
    `DTSTAMP:${istante(new Date())}`,
  ];

  if (ride.depart_time) {
    // L'ora salvata e' l'ora dell'orologio di chi parte. La converto in UTC col fuso di
    // questo dispositivo, che per una comitiva che parte dallo stesso posto e' il fuso
    // giusto: cosi' l'appuntamento resta l'istante corretto anche aprendolo da altrove.
    const inizio = new Date(`${ride.ride_date}T${ride.depart_time}`);
    righe.push(
      `DTSTART:${istante(inizio)}`,
      `DTEND:${istante(new Date(inizio.getTime() + 60 * 60 * 1000))}`,
    );
  } else {
    // Senza ora non si inventa un orario: giornata intera, e chi guida la precisa poi.
    righe.push(
      `DTSTART;VALUE=DATE:${giorno(ride.ride_date)}`,
      `DTEND;VALUE=DATE:${giorno(addDaysISO(ride.ride_date, 1))}`,
    );
  }

  const liberi = ride.seats - ride.seat_claims.length;
  const descrizione = [
    `Guida ${nomeDi(ride.driver)}.`,
    liberi > 0 ? `${liberi} posti liberi quando hai scaricato questo file.` : 'Auto al completo.',
    ride.fuel_per_person ? `Benzina: ${ride.fuel_per_person} € a testa.` : null,
    ride.note ? `Nota: ${ride.note}` : null,
    SITE_URL,
  ].filter(Boolean).join('\n');

  righe.push(`SUMMARY:${esc('Passaggio verso ' + ride.destination)}`);
  righe.push(`DESCRIPTION:${esc(descrizione)}`);
  if (ride.origin) righe.push(`LOCATION:${esc(ride.origin)}`);
  // Il punto esatto solo a chi lo vede comunque: stessa regola del link di navigazione.
  if (coordinateVisibili(ride)) righe.push(`GEO:${ride.partenza.lat};${ride.partenza.lon}`);
  righe.push('END:VEVENT', 'END:VCALENDAR');

  // Piegatura: il formato vuole righe da non piu' di 75 ottetti, e la continuazione deve
  // cominciare con uno spazio. Taglio a 70 caratteri invece di contare gli ottetti perche'
  // le lettere accentate ne occupano due, e questo margine le copre senza fare i conti.
  return righe.flatMap((r) => {
    const pezzi = [];
    for (let i = 0; i < r.length; i += 70) pezzi.push((i === 0 ? '' : ' ') + r.slice(i, i + 70));
    return pezzi;
  }).join('\r\n') + '\r\n';
}

function scaricaIcs(ride) {
  const url = URL.createObjectURL(new Blob([testoIcs(ride)], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `passaggio-${ride.ride_date}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Non subito: revocare l'indirizzo nello stesso istante del click lascia a mani vuote i
  // browser che leggono il blob un attimo dopo.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function buildCar(ride) {
  const isLong = ride.seats >= 5;
  // Altezza della scocca: quanto serve alle file che ci stanno dentro, piu' lo
  // spazio del lunotto e del baule. Non un numero tondo scelto a occhio.
  const H = isLong ? 344 : 250;
  const svg = svgEl('svg', { viewBox: `0 0 190 ${H}`, class: 'car-svg', role: 'img' });
  svg.setAttribute('aria-label', `Auto di ${nomeDi(ride.driver)}`);

  // Materiali (C15). L'auto e' l'unica cosa qui dentro che nessun altro ha, quindi
  // vale disegnarla come un oggetto e non come un rettangolo: la luce arriva
  // dall'alto, il vetro riflette, e sotto c'e' un'ombra che la appoggia. Il
  // gradiente serve alla lamiera, non alla pagina: la carrozzeria ha un colore
  // per ogni guidatore (--car-hue) e senza una variazione di luce sembra piatta.
  const uid = ++carGradId;
  const defs = svgEl('defs', {});
  const lamiera = svgEl('linearGradient', { id: `lamiera-${uid}`, x1: '0', y1: '0', x2: '0.35', y2: '1' });
  lamiera.appendChild(svgEl('stop', { offset: '0', class: 'lamiera-alto' }));
  lamiera.appendChild(svgEl('stop', { offset: '0.55', class: 'lamiera-mezzo' }));
  lamiera.appendChild(svgEl('stop', { offset: '1', class: 'lamiera-basso' }));
  defs.appendChild(lamiera);
  const vetro = svgEl('linearGradient', { id: `vetro-${uid}`, x1: '0', y1: '0', x2: '1', y2: '1' });
  vetro.appendChild(svgEl('stop', { offset: '0', class: 'vetro-chiaro' }));
  vetro.appendChild(svgEl('stop', { offset: '0.5', class: 'vetro-scuro' }));
  vetro.appendChild(svgEl('stop', { offset: '1', class: 'vetro-chiaro' }));
  defs.appendChild(vetro);
  svg.appendChild(defs);

  // L'ombra a terra: appoggia l'auto invece di lasciarla galleggiare.
  svg.appendChild(svgEl('ellipse', { cx: 95, cy: H - 6, rx: 74, ry: 7, class: 'car-ombra' }));

  svg.appendChild(svgEl('rect', {
    x: 10, y: 10, width: 170, height: H - 20, rx: 46,
    class: 'car-body', fill: `url(#lamiera-${uid})`,
  }));
  // Il filo di luce sul bordo alto: un pixel, ed e' quello che da' lo spessore.
  svg.appendChild(svgEl('path', {
    d: `M 56 11 Q 95 11 134 11`, class: 'car-luce',
  }));
  svg.appendChild(svgEl('rect', { x: 30, y: 44, width: 130, height: 16, rx: 8, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  // Riflesso sul parabrezza: una striscia sola, di sbieco.
  svg.appendChild(svgEl('path', { d: 'M 40 58 L 58 46 L 74 46 L 56 58 Z', class: 'car-riflesso' }));
  svg.appendChild(svgEl('rect', { x: 34, y: H - 42, width: 122, height: 12, rx: 6, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  // Ruote: due coppie, e ogni coppia si specchia sui due assi. La distanza dal
  // bordo alto della scocca e' la stessa di quella dal bordo basso, quindi le
  // anteriori e le posteriori sono simmetriche invece di essere sfasate di 4px.
  const RUOTA_W = 12, RUOTA_H = 34, RUOTA_X = 2, RUOTA_DAL_BORDO = 50;
  const corpoAlto = CAR_INSET, corpoBasso = H - CAR_INSET;
  const ruoteY = [corpoAlto + RUOTA_DAL_BORDO, corpoBasso - RUOTA_DAL_BORDO - RUOTA_H];
  for (const ry of ruoteY) {
    for (const rx of [RUOTA_X, specchia(RUOTA_X, RUOTA_W)]) {
      svg.appendChild(svgEl('rect', { x: rx, y: ry, width: RUOTA_W, height: RUOTA_H, rx: 5, class: 'car-wheel' }));
    }
  }
  // Gli specchietti, alla stessa altezza del parabrezza.
  const SPECCHIO_X = 0, SPECCHIO_W = 14;
  for (const mx of [SPECCHIO_X, specchia(SPECCHIO_X, SPECCHIO_W)]) {
    svg.appendChild(svgEl('rect', { x: mx, y: 46, width: SPECCHIO_W, height: 6, rx: 3, class: 'car-wheel' }));
  }

  const claims = new Map(ride.seat_claims.map(c => [c.seat_index, c]));
  const myClaim = ride.seat_claims.find(c => c.passenger_id === currentUser.id);
  const isDriver = ride.driver_id === currentUser.id;
  const past = isPastDay() || hasDeparted(ride);

  drawSeat(svg, DRIVER_POS, { kind: 'driver', label: initials(nomeDi(ride.driver)), name: nomeDi(ride.driver), avatar: ride.driver?.avatar_url ?? null });
  svg.appendChild(svgEl('circle', { cx: DRIVER_POS.x, cy: DRIVER_POS.y - 32, r: 8, class: 'car-wheel-steer' }));

  const layout = SEAT_LAYOUTS[ride.seats];
  for (const idx of Object.keys(layout).map(Number)) {
    const claim = claims.get(idx);
    const pos = layout[idx];
    if (claim) {
      const mine = claim.passenger_id === currentUser.id;
      const seat = drawSeat(svg, pos, {
        kind: mine ? 'mine' : 'taken',
        label: initials(nomeDi(claim.passenger)),
        name: nomeDi(claim.passenger),
        avatar: claim.passenger?.avatar_url ?? null,
        clickable: !past && (mine || isDriver || isAdmin),
      });
      if (!past && (mine || isDriver || isAdmin)) seat.addEventListener('click', () => releaseSeat(ride, claim, mine));
    } else {
      const canClaim = !past && !isDriver && !myClaim;
      const seat = drawSeat(svg, pos, { kind: 'free', label: '+', name: 'Posto libero', clickable: canClaim });
      if (canClaim) seat.addEventListener('click', () => claimSeat(ride, idx));
    }
  }
  return svg;
}

let avatarClipId = 0;
let carGradId = 0;
function drawSeat(svg, pos, { kind, label, name, avatar = null, clickable = false }) {
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  g.appendChild(svgEl('rect', { x: pos.x - 20, y: pos.y - 26, width: 40, height: 14, rx: 7, class: 'seat-back' }));
  g.appendChild(svgEl('rect', { x: pos.x - 22, y: pos.y - 14, width: 44, height: 40, rx: 12, class: 'seat-base' }));
  // La piega del cuscino: due linee, e il sedile smette di sembrare una tessera.
  g.appendChild(svgEl('path', { d: `M ${pos.x - 13} ${pos.y - 6} L ${pos.x + 13} ${pos.y - 6}`, class: 'seat-piega' }));
  if (avatar) {
    const clipId = 'seat-av-' + (++avatarClipId);
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('circle', { cx: pos.x, cy: pos.y + 6, r: 16 }));
    svg.appendChild(clip);
    const img = svgEl('image', {
      x: pos.x - 16, y: pos.y - 10, width: 32, height: 32,
      'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice',
    });
    img.setAttribute('href', avatar);
    // Se la foto non carica si torna alle iniziali
    img.addEventListener('error', () => { img.remove(); g.querySelector('text')?.removeAttribute('opacity'); });
    g.appendChild(img);
  }
  const t = svgEl('text', { x: pos.x, y: pos.y + 12, class: 'seat-text' });
  t.textContent = label;
  if (avatar) t.setAttribute('opacity', '0'); // iniziali sotto la foto, visibili solo se la foto fallisce
  g.appendChild(t);
  svg.appendChild(g);
  if (clickable) {
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new Event('click')); } });
  }
  return g;
}

// --- Azioni sedili ---
async function claimSeat(ride, seatIndex) {
  if (bloccaSeSospeso('prenotare un posto')) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: ride.id, seat_index: seatIndex, passenger_id: currentUser.id,
  });
  if (error) {
    if (error.code === '23505') toast('Posto già occupato, oppure sei già su questa auto.');
    else toast(friendlyError(error));
  } else {
    toast('Posto prenotato: sei a bordo.');
    await clearMyRequest();
  }
  loadRides();
}

async function releaseSeat(ride, claim, mine) {
  const who = mine ? 'Vuoi scendere da questa auto?' : `Vuoi liberare il posto di ${nomeDi(claim.passenger)}?`;
  if (!confirm(who)) return;
  const { error } = await supabase.from('seat_claims').delete()
    .eq('ride_id', ride.id).eq('seat_index', claim.seat_index);
  if (error) { toast(friendlyError(error)); return; }
  toast(mine ? 'Sei sceso dall\'auto.' : 'Posto liberato.');
  loadRides();
}

// --- Render passaggi ---
function renderRides(rides) {
  ridesList.innerHTML = '';
  emptyMessage.classList.toggle('hidden', rides.length > 0);

  // Riepilogo del giorno
  const statsEl = document.getElementById('day-stats');
  statsEl.classList.toggle('hidden', rides.length === 0);
  if (rides.length > 0) {
    const totalFree = rides.reduce((n, r) => n + r.seats - r.seat_claims.length, 0);
    const aboard = rides.reduce((n, r) => n + 1 + r.seat_claims.length, 0);
    statsEl.innerHTML =
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-car"/></svg><strong>${rides.length}</strong> auto</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-plus"/></svg><strong>${totalFree}</strong> posti liberi</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-users"/></svg><strong>${aboard}</strong> a bordo</span>`;

    // Condividi il riepilogo dell'intera giornata (pronto per il gruppo WhatsApp)
    const shareDay = document.createElement('button');
    shareDay.className = 'btn btn-ghost btn-small';
    shareDay.innerHTML = '<svg width="14" height="14"><use href="#i-share"/></svg> Condividi riepilogo';
    shareDay.addEventListener('click', async () => {
      const lines = [`WeTransport — ${DAY_FMT.format(new Date(currentDate + 'T12:00:00'))}`];
      for (const r of rides) {
        const freeN = r.seats - r.seat_claims.length;
        lines.push('');
        lines.push(`🚗 ${nomeDi(r.driver)} → ${r.destination}`
          + (r.depart_time ? ` (ore ${r.depart_time.slice(0, 5)})` : ''));
        lines.push('A bordo: ' + (r.seat_claims.map(c => nomeDi(c.passenger)).join(', ') || 'nessuno'));
        lines.push(freeN > 0 ? `Liberi: ${freeN} → prenota su ${SITE_URL}` : 'Al completo');
      }
      const text = lines.join('\n');
      if (navigator.share) {
        try { await navigator.share({ title: 'WeTransport', text }); } catch {}
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      }
    });
    statsEl.appendChild(shareDay);
  }
  for (const [idx, ride] of rides.entries()) {
    const card = document.createElement('article');
    card.className = 'ride-card';
    card.style.setProperty('--car-hue', hueFor(ride.driver_id));
    card.style.setProperty('--i', idx); // stagger dell'entrata

    const head = document.createElement('div');
    head.className = 'ride-head';
    const info = document.createElement('div');
    const route = document.createElement('div');
    route.className = 'ride-route';
    route.textContent = ride.origin ? `${ride.origin} → ${ride.destination}` : ride.destination;
    info.appendChild(route);
    const ritrovo = linkRitrovo(ride);
    if (ritrovo) {
      const maps = document.createElement('a');
      maps.className = 'maps-link';
      maps.href = ritrovo.href;
      maps.target = '_blank';
      maps.rel = 'noopener';
      maps.innerHTML = '<svg width="13" height="13"><use href="#i-pin"/></svg> ' + ritrovo.testo;
      info.appendChild(maps);
    }
    const sub = document.createElement('div');
    sub.className = 'ride-sub';
    const time = ride.depart_time ? ` · ore ${ride.depart_time.slice(0, 5)}` : '';
    sub.textContent = DAY_FMT.format(new Date(ride.ride_date + 'T12:00:00')) + time;
    info.appendChild(sub);
    const drv = document.createElement('div');
    drv.className = 'ride-sub';
    drv.textContent = `Guida ${nomeDi(ride.driver)}`;
    // Da C9 in Home arrivano anche passaggi di comitive a cui non appartengo: senza
    // dirlo, sembrerebbero della propria e non si capirebbe chi sia chi guida.
    if (ride.group_id !== currentGroupId) {
      const fuori = document.createElement('span');
      fuori.className = 'badge-fuori';
      fuori.textContent = ride.visibilita === 'pubblico' ? 'fuori comitiva' : 'in zona';
      fuori.title = 'Questo passaggio è di un\'altra comitiva, aperto a chi sta fuori.';
      drv.appendChild(fuori);
    }
    if (ride.driver_id !== currentUser.id) {
      // Il guidatore qui puo' essere una persona bloccata: la sua auto resta visibile solo
      // finche' ci sono sopra, ed e' anche il punto da cui si sblocca.
      drv.appendChild(bottonePersona(ride.driver_id, nomeDi(ride.driver), ride.id));
    }
    info.appendChild(drv);
    head.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'ride-actions';
    const share = document.createElement('button');
    share.className = 'place-delete share';
    share.innerHTML = '<svg width="16" height="16"><use href="#i-share"/></svg>';
    share.title = 'Condividi';
    const free = ride.seats - ride.seat_claims.length;
    const shareText =
      `${nomeDi(ride.driver)} guida verso ${ride.destination}` +
      (ride.depart_time ? ` alle ${ride.depart_time.slice(0, 5)}` : '') +
      ` (${ride.ride_date.split('-').reverse().join('/')})` +
      (free > 0 ? ` — ${free} posti disponibili.` : ' — auto al completo.') +
      ` Prenota su ${SITE_URL}`;
    share.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'WeTransport', text: shareText, url: SITE_URL }); } catch {}
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank', 'noopener');
      }
    });
    actions.appendChild(share);
    const cal = document.createElement('button');
    cal.className = 'place-delete';
    cal.innerHTML = '<svg width="16" height="16"><use href="#i-calendar"/></svg>';
    cal.title = 'Aggiungi al calendario';
    cal.addEventListener('click', () => {
      scaricaIcs(ride);
      toast('File del calendario scaricato: aprilo e il passaggio entra nel tuo calendario.');
    });
    actions.appendChild(cal);
    if (ride.driver_id === currentUser.id || isAdmin) {
      const del = document.createElement('button');
      del.className = 'place-delete';
      del.innerHTML = '<svg width="16" height="16"><use href="#i-x"/></svg>';
      del.title = 'Annulla passaggio';
      del.addEventListener('click', async () => {
        if (!confirm('Annullare il passaggio? I passeggeri perderanno il posto.')) return;
        const { error } = await supabase.from('rides').delete().eq('id', ride.id);
        if (error) { toast(friendlyError(error)); return; }
        toast('Passaggio annullato.');
        loadRides();
      });
      actions.appendChild(del);
    }
    head.appendChild(actions);
    card.appendChild(head);

    card.appendChild(buildCar(ride));

    // Chi è a bordo, in chiaro
    if (ride.seat_claims.length > 0) {
      const aboard = document.createElement('div');
      aboard.className = 'history-passengers';
      for (const c of ride.seat_claims) {
        const chip = document.createElement('span');
        chip.className = 'history-chip' + (c.passenger_id === currentUser.id ? ' driver' : '');
        chip.textContent = nomeDi(c.passenger);
        aboard.appendChild(chip);
      }
      card.appendChild(aboard);
    }

    const foot = document.createElement('div');
    foot.className = 'ride-foot';
    const count = document.createElement('span');
    count.className = 'place-badge' + (free > 0 ? ' public' : '');
    count.textContent = free > 0
      ? `${ride.seat_claims.length}/${ride.seats} occupati · ${free} ${free === 1 ? 'libero' : 'liberi'}`
      : 'Al completo';
    foot.appendChild(count);
    if (ride.driver_id === currentUser.id) {
      const meBadge = document.createElement('span');
      meBadge.className = 'place-badge mine';
      meBadge.textContent = 'La tua auto';
      foot.appendChild(meBadge);
    } else if (ride.seat_claims.some(c => c.passenger_id === currentUser.id)) {
      const meBadge = document.createElement('span');
      meBadge.className = 'place-badge mine';
      meBadge.textContent = 'Sei a bordo';
      foot.appendChild(meBadge);
    }
    if (ride.depart_time && currentDate === todayISO()) {
      const [h, m] = ride.depart_time.split(':').map(Number);
      const now = new Date();
      const mins = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
      const t = document.createElement('span');
      t.className = 'place-badge' + (mins > 0 && mins <= 60 ? ' mine' : '');
      t.textContent = mins <= 0 ? 'Partita'
        : mins < 60 ? `Parte tra ${mins} min`
        : `Parte tra ${Math.floor(mins / 60)} h ${mins % 60} min`;
      foot.appendChild(t);
    }
    if (ride.fuel_per_person > 0) {
      const fuel = document.createElement('span');
      fuel.className = 'place-badge fuel';
      fuel.innerHTML = `<svg width="12" height="12"><use href="#i-fuel"/></svg> ${ride.fuel_per_person} € a testa`;
      foot.appendChild(fuel);
    }
    if (ride.note) {
      const note = document.createElement('span');
      note.className = 'ride-note';
      note.textContent = ride.note;
      foot.appendChild(note);
    }
    card.appendChild(foot);

    // Lista d'attesa: quando l'auto è piena ci si mette in coda,
    // il primo in lista prende il posto appena qualcuno scende (trigger DB)
    const waitlist = [...(ride.ride_waitlist ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ridePast = isPastDay() || hasDeparted(ride);
    const imAboard = ride.seat_claims.some(c => c.passenger_id === currentUser.id);
    const imWaiting = waitlist.some(w => w.user_id === currentUser.id);
    if (waitlist.length > 0) {
      const wl = document.createElement('div');
      wl.className = 'ride-sub waitlist-row';
      wl.textContent = '⏳ In attesa: ' + waitlist.map((w, i) =>
        `${i + 1}. ${nomeDi(w.profile)}${w.user_id === currentUser.id ? ' (tu)' : ''}`).join(' · ');
      card.appendChild(wl);
    }
    if (!ridePast && ride.driver_id !== currentUser.id && !imAboard && (free === 0 || imWaiting)) {
      const wBtn = document.createElement('button');
      wBtn.className = 'btn btn-ghost btn-small';
      wBtn.textContent = imWaiting ? 'Esci dalla lista d\'attesa' : 'Mettimi in lista d\'attesa';
      wBtn.addEventListener('click', async () => {
        if (imWaiting) {
          const { error } = await supabase.from('ride_waitlist').delete()
            .eq('ride_id', ride.id).eq('user_id', currentUser.id);
          if (error) { toast(friendlyError(error)); return; }
          toast('Tolto dalla lista d\'attesa.');
        } else {
          if (bloccaSeSospeso('metterti in lista d\'attesa')) return;
          const { error } = await supabase.from('ride_waitlist').insert({ ride_id: ride.id, user_id: currentUser.id });
          if (error && error.code !== '23505') { toast(friendlyError(error)); return; }
          toast('Sei in lista: se un posto si libera, sali in automatico.');
        }
        loadRides(true);
      });
      card.appendChild(wBtn);
    }

    // Commenti
    const nComments = ride.ride_comments?.[0]?.count ?? 0;
    const cBtn = document.createElement('button');
    cBtn.className = 'btn btn-ghost btn-small comments-btn';
    cBtn.textContent = nComments > 0 ? `Commenti (${nComments})` : 'Scrivi un commento';
    const panel = document.createElement('div');
    panel.className = 'comments-panel hidden';
    cBtn.addEventListener('click', async () => {
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) await loadComments(ride.id, panel);
    });
    card.appendChild(cBtn);
    card.appendChild(panel);

    ridesList.appendChild(card);
  }
}

// --- Commenti ---
const TIME_FMT = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

async function loadComments(rideId, panel) {
  panel.innerHTML = '<div class="skeleton" style="height:40px"></div>';
  const { data, error } = await supabase
    .from('ride_comments')
    .select('id, user_id, body, created_at, author:profiles(display_name)')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: true })
    .limit(50);
  panel.innerHTML = '';
  if (error) { toast(friendlyError(error)); return; }

  const list = document.createElement('div');
  list.className = 'comments-list';
  for (const c of data ?? []) {
    const row = document.createElement('div');
    row.className = 'comment';
    const meta = document.createElement('span');
    meta.className = 'comment-meta';
    meta.textContent = `${nomeDi(c.author)} · ${TIME_FMT.format(new Date(c.created_at))}`;
    row.appendChild(meta);
    const body = document.createElement('span');
    body.textContent = c.body;
    row.appendChild(body);
    if (c.user_id === currentUser.id || isAdmin) {
      const del = document.createElement('button');
      del.className = 'comment-del';
      del.innerHTML = '<svg width="12" height="12"><use href="#i-x"/></svg>';
      del.title = 'Elimina commento';
      del.addEventListener('click', async () => {
        const { error } = await supabase.from('ride_comments').delete().eq('id', c.id);
        if (error) { toast(friendlyError(error)); return; }
        loadComments(rideId, panel);
      });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
  panel.appendChild(list);

  const form = document.createElement('form');
  form.className = 'comment-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 300;
  input.placeholder = 'Scrivi qualcosa (es. "passo alle 15 in piazza")';
  form.appendChild(input);
  const send = document.createElement('button');
  send.className = 'btn btn-primary btn-small';
  send.textContent = 'Invia';
  form.appendChild(send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    if (bloccaSeSospeso('commentare')) return;
    const { error } = await supabase.from('ride_comments').insert({ ride_id: rideId, user_id: currentUser.id, body });
    if (error) { toast(friendlyError(error)); return; }
    input.value = '';
    loadComments(rideId, panel);
  });
  panel.appendChild(form);
  input.focus();
}

// --- Render root ---
async function render() {
  const loggedIn = !!currentUser;
  rendered = true;
  authView.classList.toggle('hidden', loggedIn);
  appShell.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    await ensureProfile();
    userNameEl.textContent = myName;
    await loadBlocked();
    applicaSospensione();
    await loadGroups();
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
    realtimeChannel = null;
    realtimeDate = null;
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
