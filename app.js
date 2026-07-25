import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

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
  const { data } = await supabase.from('profiles')
    .select('display_name, is_admin, avatar_url, sospeso, sospeso_motivo, zona_lat, zona_lon, zona_nome')
    .eq('id', currentUser.id).maybeSingle();
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
  await supabase.from('profiles').insert({ id: currentUser.id, display_name: fallback, avatar_url: oauthAvatar });
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
  const [profilo, auto, posti, richieste, commenti, attesa, gruppi, segnalazioni, blocchi] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(),
    mio('rides', 'driver_id'),
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

  const dati = {
    esportato_il: new Date().toISOString(),
    account: { id: currentUser.id, email: currentUser.email, registrato_il: currentUser.created_at },
    profilo: profilo.data,
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
  a.click();
  URL.revokeObjectURL(url);
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
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo({ top: 0 });
  if (view === 'history') loadHistory();
  if (view === 'stats') loadStats();
  if (view === 'groups') renderGroupsView();
  if (view === 'profile') renderProfile();
}

document.querySelectorAll('.nav-item').forEach(b =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

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

function renderProfile() {
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
  renderBlocked();
  renderReports();
}

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

// --- Vista Statistiche ---
async function loadStats() {
  if (!currentGroupId) return;
  const box = document.getElementById('stats-content');
  document.querySelector('#view-stats .view-subtitle').textContent =
    `I turni parlano da soli · ${groupLabel()} (si cambia dalla Home)`;
  box.innerHTML = '<div class="skeleton"></div>';
  let sq = supabase
    .from('rides')
    .select('driver_id, fuel_per_person, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name))');
  sq = sq.eq('group_id', currentGroupId);
  const { data, error } = await sq;
  if (error || !data) { box.innerHTML = '<p class="view-subtitle">Impossibile caricare le statistiche.</p>'; return; }

  const drives = new Map(); // id -> {name, n}
  const ridesTaken = new Map();
  const fuelIn = new Map();  // guidatore -> {name, n: € raccolti}
  const fuelOut = new Map(); // passeggero -> {name, n: € versati}
  for (const r of data) {
    const d = drives.get(r.driver_id) ?? { name: nomeDi(r.driver), n: 0 };
    d.n++; drives.set(r.driver_id, d);
    const fuel = Number(r.fuel_per_person) || 0;
    for (const c of r.seat_claims) {
      const p = ridesTaken.get(c.passenger_id) ?? { name: nomeDi(c.passenger), n: 0 };
      p.n++; ridesTaken.set(c.passenger_id, p);
      if (fuel > 0) {
        const fi = fuelIn.get(r.driver_id) ?? { name: nomeDi(r.driver), n: 0 };
        fi.n += fuel; fuelIn.set(r.driver_id, fi);
        const fo = fuelOut.get(c.passenger_id) ?? { name: nomeDi(c.passenger), n: 0 };
        fo.n += fuel; fuelOut.set(c.passenger_id, fo);
      }
    }
  }

  const myDrives = drives.get(currentUser.id)?.n ?? 0;
  const myRides = ridesTaken.get(currentUser.id)?.n ?? 0;

  const bars = (map, alt) => {
    const rows = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const max = rows[0]?.n || 1;
    return rows.map(r =>
      `<div class="stats-row${alt ? ' alt' : ''}">
        <span class="stats-row-name">${escapeHtml(r.name)}</span>
        <span class="stats-row-bar-wrap"><span class="stats-row-bar" style="width:${(r.n / max) * 100}%"></span></span>
        <span class="stats-row-count">${r.n}</span>
      </div>`).join('') || '<p class="view-subtitle">Ancora nessun dato.</p>';
  };

  box.innerHTML =
    `<div class="stats-me">
      <div class="stat-box"><strong>${myDrives}</strong><span>volte hai guidato</span></div>
      <div class="stat-box"><strong>${myRides}</strong><span>passaggi ricevuti</span></div>
    </div>
    <div class="stats-section"><h3>Chi guida di più</h3>${bars(drives, false)}</div>
    <div class="stats-section"><h3>Chi sale più spesso</h3>${bars(ridesTaken, true)}</div>`
    + (fuelIn.size === 0 ? '' :
    `<div class="stats-section"><h3>⛽ Benzina: quanto spetta a chi guida</h3>
      <p class="view-subtitle">Somma dei contributi "€ a testa" dei passeggeri saliti. I conti si regolano di persona.</p>
      ${bars(new Map([...fuelIn].map(([k, v]) => [k, { name: v.name, n: Math.round(v.n * 100) / 100 }])), false)}
      <h3 style="margin-top:14px">Quanto ha versato ogni passeggero</h3>
      ${bars(new Map([...fuelOut].map(([k, v]) => [k, { name: v.name, n: Math.round(v.n * 100) / 100 }])), true)}
    </div>`);
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
function subscribeRealtime() {
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
    .select('*, driver:profiles!rides_driver_id_fkey(display_name, avatar_url), seat_claims(seat_index, passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name, avatar_url)), ride_comments(count), ride_waitlist(user_id, created_at, profile:profiles(display_name))')
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
  currentRequests = reqs ?? [];
  updateDayCta(data);
  renderRides(data);
  renderWalkers(data);
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
const ROW_FRONT = 92, ROW_BACK = 176, ROW_THIRD = 252;
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
function linkRitrovo(ride) {
  const haCoordinate = ride.origin_lat != null && ride.origin_lon != null;
  const dentro = ride.group_id === currentGroupId
    || (ride.seat_claims ?? []).some((c) => c.passenger_id === currentUser?.id);
  if (haCoordinate && dentro) {
    return {
      href: 'https://www.google.com/maps/dir/?api=1&destination='
        + encodeURIComponent(`${ride.origin_lat},${ride.origin_lon}`),
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

function buildCar(ride) {
  const isLong = ride.seats >= 5;
  const H = isLong ? 330 : 250;
  const svg = svgEl('svg', { viewBox: `0 0 190 ${H}`, class: 'car-svg', role: 'img' });
  svg.setAttribute('aria-label', `Auto di ${nomeDi(ride.driver)}`);

  svg.appendChild(svgEl('rect', { x: 10, y: 10, width: 170, height: H - 20, rx: 46, class: 'car-body' }));
  svg.appendChild(svgEl('rect', { x: 30, y: 44, width: 130, height: 16, rx: 8, class: 'car-glass' }));
  svg.appendChild(svgEl('rect', { x: 34, y: H - 42, width: 122, height: 12, rx: 6, class: 'car-glass' }));
  for (const [wx, wy] of [[2, 60], [180, 60], [2, H - 90], [180, H - 90]]) {
    svg.appendChild(svgEl('rect', { x: wx - 4, y: wy, width: 12, height: 34, rx: 5, class: 'car-wheel' }));
  }
  svg.appendChild(svgEl('rect', { x: 0, y: 46, width: 14, height: 6, rx: 3, class: 'car-wheel' }));
  svg.appendChild(svgEl('rect', { x: 176, y: 46, width: 14, height: 6, rx: 3, class: 'car-wheel' }));

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
function drawSeat(svg, pos, { kind, label, name, avatar = null, clickable = false }) {
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  g.appendChild(svgEl('rect', { x: pos.x - 20, y: pos.y - 26, width: 40, height: 14, rx: 7, class: 'seat-back' }));
  g.appendChild(svgEl('rect', { x: pos.x - 22, y: pos.y - 14, width: 44, height: 40, rx: 12, class: 'seat-base' }));
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
  }
}
