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
const groupPills = document.getElementById('group-pills');
const dayToday = document.getElementById('day-today');
const dayTomorrow = document.getElementById('day-tomorrow');
const dayPicker = document.getElementById('day-picker');
const dayWeek = document.getElementById('day-week');
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

// C35 — un sedile puo' essere di una persona con un account o di un ospite con un
// nome. Da qui in giu' non si legge piu' `claim.passenger` a mano: il posto ha un
// occupante, e queste tre funzioni sono l'unico modo di chiedere chi sia.
function nomeOccupante(claim) {
  return claim.passenger_id ? nomeDi(claim.passenger) : (claim.ospite_nome ?? 'Ospite');
}
// Chi risponde di quel posto: e' l'ospite stesso a non esistere come persona, e la
// sua quota sta nel conto di chi lo ha portato (031, `saldo_con`). La stessa regola
// vale nei conti del riepilogo, o le due somme direbbero cose diverse.
function chiRisponde(claim) {
  return claim.passenger_id ?? claim.invitato_da ?? null;
}
function mioPosto(claim) {
  return claim.passenger_id === currentUser.id;
}

function hasDeparted(ride) {
  if (ride.ride_date !== todayISO() || !ride.depart_time) return false;
  const [h, m] = ride.depart_time.split(':').map(Number);
  const now = new Date();
  // Con un ritardo annunciato (C30) l'auto non e' partita: e' quello il senso
  // dell'annuncio. Senza questo termine la lista d'attesa si chiuderebbe mentre
  // l'auto e' ancora ferma sotto casa.
  return h * 60 + m + (ride.ritardo_min || 0) <= now.getHours() * 60 + now.getMinutes();
}

// «07:40» + 15 -> «07:55». Somma in minuti e non con una Date: una Date vuole un
// giorno, e qui il giorno non c'entra — un ritardo che scavalca la mezzanotte
// rientra dall'altra parte del quadrante, come su un orologio vero.
function oraPiu(hhmm, minuti) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const t = (((h * 60 + m + (minuti || 0)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
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
    if (!await conferma(`Bloccare ${p.nome}?`, {
      testo: 'Non vedrete più i passaggi l\'uno dell\'altra, e non potrete salire in macchina insieme. I posti già presi restano.',
      azione: 'Blocca',
      pericolo: true,
    })) return;
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

// ══════════════════════════════════════════════════════════════════════════
// C33 — Il garage.
//
// Le auto sono di una persona, non di una comitiva: la stessa Panda porta gente
// in due gruppi diversi. Stanno quindi nel Profilo e non nella Comitiva, e le
// legge chi condivide un gruppo — la regola dei profili (D2).
// ══════════════════════════════════════════════════════════════════════════
let mieAuto = [];

async function caricaAuto() {
  const { data, error } = await supabase
    .from('auto')
    .select('id, nome, posti, modello, colore, consumo_km_l, predefinita')
    .eq('user_id', currentUser.id)
    .order('predefinita', { ascending: false })
    .order('creata_il', { ascending: true });
  if (error) { console.error('auto:', error); }
  mieAuto = data ?? [];
  riempiSceltaAuto();
}

// Il menu nel modulo di pubblicazione. Scegliere un'auto porta con se' i posti:
// e' tutto il senso del cantiere, e farlo qui invece che a mano evita la
// combinazione senza senso «la Panda da 4, con 6 posti».
function riempiSceltaAuto() {
  const sel = document.getElementById('ride-auto');
  const lab = document.getElementById('ride-auto-label');
  lab.classList.toggle('hidden', mieAuto.length === 0);
  sel.innerHTML = '';
  if (!mieAuto.length) return;
  const vuota = document.createElement('option');
  vuota.value = '';
  vuota.textContent = 'Nessuna';
  sel.appendChild(vuota);
  for (const a of mieAuto) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.nome;
    if (a.predefinita) o.selected = true;
    sel.appendChild(o);
  }
  applicaAutoScelta();
}

function autoScelta() {
  const id = document.getElementById('ride-auto')?.value;
  return id ? mieAuto.find(a => a.id === id) ?? null : null;
}

function applicaAutoScelta() {
  const a = autoScelta();
  if (a) document.getElementById('ride-seats').value = String(a.posti);
  // Cambiare auto cambia i posti e puo' cambiare il consumo: la quota proposta
  // (C34) dipende da entrambi, e ricalcolarla qui e' l'unico modo perche' non
  // resti indietro di un'auto quando il menu si riempie da solo.
  proponiQuota();
}

document.getElementById('ride-auto').addEventListener('change', applicaAutoScelta);

function descriviAuto(a) {
  return [a.modello, a.colore].filter(Boolean).join(' ') || null;
}

function renderAuto() {
  const box = document.getElementById('auto-list');
  box.innerHTML = '';
  if (!mieAuto.length) {
    const p = document.createElement('p');
    p.className = 'form-hint';
    p.textContent = 'Nessuna auto salvata: pubblichi come prima, scrivendo i posti ogni volta.';
    box.appendChild(p);
    return;
  }
  for (const a of mieAuto) {
    const riga = document.createElement('div');
    riga.className = 'auto-riga';
    const testo = document.createElement('div');
    testo.className = 'auto-testo';
    const nome = document.createElement('b');
    nome.textContent = a.nome + (a.predefinita ? ' · predefinita' : '');
    testo.appendChild(nome);
    const sotto = document.createElement('small');
    sotto.textContent = [
      `${a.posti} ${a.posti === 1 ? 'posto' : 'posti'}`,
      descriviAuto(a),
      a.consumo_km_l ? `${a.consumo_km_l} km/l` : null,
    ].filter(Boolean).join(' · ');
    testo.appendChild(sotto);
    riga.appendChild(testo);

    if (!a.predefinita) {
      const pred = document.createElement('button');
      pred.className = 'btn btn-ghost btn-small';
      pred.textContent = 'Predefinita';
      pred.addEventListener('click', async () => {
        // Due passaggi e non uno: l'indice parziale ammette **una** predefinita per
        // persona, quindi accenderne una senza prima spegnere l'altra viene rifiutato.
        await supabase.from('auto').update({ predefinita: false })
          .eq('user_id', currentUser.id).eq('predefinita', true);
        const { error } = await supabase.from('auto').update({ predefinita: true }).eq('id', a.id);
        if (error) { toast(friendlyError(error)); return; }
        await caricaAuto();
        renderAuto();
      });
      riga.appendChild(pred);
    }

    const mod = document.createElement('button');
    mod.className = 'btn btn-ghost btn-small';
    mod.textContent = 'Modifica';
    mod.addEventListener('click', () => modificaAuto(a));
    riga.appendChild(mod);

    const via = document.createElement('button');
    via.className = 'btn btn-ghost btn-small btn-danger';
    via.textContent = 'Togli';
    via.addEventListener('click', async () => {
      if (!await conferma(`Togliere "${a.nome}" dal garage?`, {
        // `on delete set null` sulla colonna di `rides`: e' il motivo per cui questa
        // frase si puo' scrivere, e va detta perche' altrimenti nessuno la crede.
        testo: 'I passaggi già pubblicati con questa auto restano, e restano i conti della benzina. Sparisce solo dal menu quando pubblichi.',
        azione: 'Togli l\'auto',
        pericolo: true,
      })) return;
      const { error } = await supabase.from('auto').delete().eq('id', a.id);
      if (error) { toast(friendlyError(error)); return; }
      await caricaAuto();
      renderAuto();
    });
    riga.appendChild(via);
    box.appendChild(riga);
  }
}

// Una domanda per volta, con i dialoghi che l'app ha gia'. Un modulo intero per
// cinque campi facoltativi sarebbe una schermata in piu' da disegnare e mantenere
// per una cosa che si compila una volta nella vita dell'auto.
async function modificaAuto(a) {
  const nuova = !a;
  const nome = await ask(nuova ? 'Come la chiami?' : 'Nome dell\'auto', {
    text: 'Il nome che vedi tu nel menu quando pubblichi. «La mia», «Panda», «Quella di papà».',
    value: a?.nome ?? '', placeholder: 'Panda',
  });
  if (!nome) return;
  const posti = await ask('Quanti posti per i passeggeri?', {
    text: 'Senza contare il tuo. È il numero di sedili che si possono prenotare.',
    value: String(a?.posti ?? 4), type: 'number',
    scelte: [[3, '3'], [4, '4'], [5, '5']],
  });
  if (posti === null) return;
  const n = Number(posti);
  if (!(n >= 1 && n <= 6)) { toast('Da 1 a 6 posti.'); return; }
  const modello = await ask('Che modello è?', {
    text: 'Facoltativo, e serve a chi ti aspetta: è metà di «cerca la Panda blu».',
    value: a?.modello ?? '', placeholder: 'Fiat Panda',
  });
  if (modello === null) return;
  const colore = await ask('Di che colore?', {
    text: 'Facoltativo. È l\'altra metà, ed è quella che si vede da lontano.',
    value: a?.colore ?? '', placeholder: 'blu',
  });
  if (colore === null) return;
  const consumo = await ask('Quanti chilometri con un litro?', {
    text: 'Facoltativo. Serve solo a farti proporre il «€ a testa» invece di inventarlo ogni volta.',
    value: a?.consumo_km_l ? String(a.consumo_km_l) : '', placeholder: '15', type: 'number',
  });
  if (consumo === null) return;
  const km = consumo === '' ? null : Number(String(consumo).replace(',', '.'));
  if (km !== null && !(km >= 3 && km <= 40)) { toast('Un consumo fra 3 e 40 km/l.'); return; }

  const riga = {
    nome: nome.slice(0, 30),
    posti: n,
    modello: modello.trim().slice(0, 40) || null,
    colore: colore.trim().slice(0, 20) || null,
    consumo_km_l: km,
  };
  const { error } = nuova
    ? await supabase.from('auto').insert({
        ...riga, user_id: currentUser.id, predefinita: mieAuto.length === 0,
      })
    : await supabase.from('auto').update(riga).eq('id', a.id);
  if (error) { toast(friendlyError(error)); return; }
  toast(nuova ? `"${riga.nome}" è nel garage.` : 'Auto aggiornata.');
  await caricaAuto();
  renderAuto();
}

document.getElementById('auto-nuova').addEventListener('click', () => modificaAuto(null));

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
    // Il proprio posto **e quelli presi per un ospite**: sono righe che questa
    // persona ha scritto e di cui paga la quota (C35). Lasciarle fuori vorrebbe
    // dire che «tutto quello che il database ha su di te» non e' vero.
    supabase.from('seat_claims').select('*')
      .or(`passenger_id.eq.${currentUser.id},invitato_da.eq.${currentUser.id}`),
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
  if (!await conferma('Eliminare il tuo account?', {
    testo: 'Spariscono profilo, auto, prenotazioni, richieste e commenti. Non si torna indietro.',
    azione: 'Continua',
    pericolo: true,
  })) return;
  const scritto = await ask('Conferma l\'eliminazione', {
    text: 'Scrivi ELIMINA per confermare. Se possiedi una comitiva passerà a un altro membro; se non ce ne sono, sparisce anche quella.',
    placeholder: 'ELIMINA',
  });
  if (scritto !== 'ELIMINA') { toast('Eliminazione annullata.'); return; }
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

// Condividere: era scritto tre volte identico — invito al gruppo, giornata, singolo
// passaggio. Stessa scelta, stesso ripiego su WhatsApp, stesso `catch {}` per l'utente
// che chiude il foglio di sistema. Una funzione sola, e le tre chiamate diventano una
// riga ciascuna.
async function condividi(testo, url) {
  if (navigator.share) {
    try { await navigator.share({ title: 'WeTransport', text: testo, ...(url ? { url } : {}) }); } catch { /* chiuso */ }
    return;
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(testo), '_blank', 'noopener');
}

// **Una finestra sola per chiedere.** `ask()` usava questo dialogo disegnato, e le
// sette conferme usavano `confirm()` del browser: due vocabolari nella stessa app,
// e quello nativo e' il peggiore dei due. Non si puo' scrivere sopra, quindi il
// bottone dice «OK» dove servirebbe «Elimina l'account»; mostra l'indirizzo del sito
// in cima («wetransport.netlify.app dice…»), che dentro un'app installata sembra la
// finestra di un altro programma; e nel browser dentro Instagram o WhatsApp puo'
// arrivare soppresso, cioe' l'azione distruttiva parte o non parte senza che nessuno
// abbia risposto. Ora ce n'e' una, e il suo bottone dice cosa fa.
const dialogTesto = document.getElementById('dialog-text');
const dialogOk = document.getElementById('dialog-ok');

// `scelte` e' un elenco di [valore, etichetta]: le risposte che si danno quasi
// sempre diventano un tocco solo, e il campo resta li' sotto per tutte le altre.
// Serve dove la risposta si da' col telefono in mano e di fretta — annunciare un
// ritardo mentre si esce di casa in ritardo (C30) e' il caso limite.
function apriDialogo({ titolo, testo = '', campo = false, azione = 'Conferma', pericolo = false, placeholder = '', value = '', type = 'text', scelte = [] }) {
  document.getElementById('dialog-title').textContent = titolo;
  dialogTesto.textContent = testo;
  dialogTesto.style.display = testo ? '' : 'none';
  const boxScelte = document.getElementById('dialog-scelte');
  boxScelte.innerHTML = '';
  boxScelte.classList.toggle('hidden', scelte.length === 0);
  for (const [val, etichetta] of scelte) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtro';
    b.textContent = etichetta;
    b.addEventListener('click', () => chiudiDialogo(String(val)));
    boxScelte.appendChild(b);
  }
  dialogInput.classList.toggle('hidden', !campo);
  dialogInput.type = type;
  dialogInput.placeholder = placeholder;
  dialogInput.value = value;
  dialogOk.textContent = azione;
  // Un'azione che distrugge non ha lo stesso bottone di una che salva.
  dialogOk.classList.toggle('btn-primary', !pericolo);
  dialogOk.classList.toggle('btn-pericolo', pericolo);
  appDialog.showModal();
  // Il fuoco va sul campo se c'e', altrimenti su «Annulla»: su una conferma
  // distruttiva la prima cosa che si tocca a occhi chiusi dev'essere l'uscita.
  (campo ? dialogInput : document.getElementById('dialog-cancel')).focus();
  return new Promise((resolve) => { dialogResolve = resolve; });
}

function ask(title, { text = '', placeholder = '', value = '', type = 'text', scelte = [] } = {}) {
  return apriDialogo({ titolo: title, testo: text, campo: true, placeholder, value, type, scelte });
}

// Torna `true` solo se si e' scelto davvero: chiudere con Esc o toccare fuori vale no.
function conferma(titolo, { testo = '', azione = 'Conferma', pericolo = false } = {}) {
  return apriDialogo({ titolo, testo, campo: false, azione, pericolo });
}

function chiudiDialogo(esito) {
  appDialog.close();
  dialogResolve?.(esito);
  dialogResolve = null;
}

document.getElementById('dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  chiudiDialogo(dialogInput.classList.contains('hidden') ? true : dialogInput.value.trim());
});
document.getElementById('dialog-cancel').addEventListener('click', () => {
  chiudiDialogo(dialogInput.classList.contains('hidden') ? false : null);
});
appDialog.addEventListener('cancel', () => {
  dialogResolve?.(dialogInput.classList.contains('hidden') ? false : null);
  dialogResolve = null;
});

// --- Navigazione a schede ---
const VIEWS = ['home', 'history', 'groups', 'stats', 'profile'];

function switchView(view) {
  for (const v of VIEWS) {
    document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
  }
  // La riga di due pixel scivola sulla scheda aperta, e la sua colonna la passa il
  // codice al CSS leggendola dall'**ordine vero** dei pulsanti: cosi' l'elenco delle
  // viste non e' scritto in due posti che possono divergere.
  const fascia = document.querySelector('.bottom-nav');
  let aperta = false;
  document.querySelectorAll('.nav-item').forEach((b, i) => {
    const attiva = b.dataset.view === view;
    b.classList.toggle('active', attiva);
    if (attiva) {
      aperta = true;
      b.setAttribute('aria-current', 'page');
      fascia?.style.setProperty('--nav-i', i);
    } else {
      b.removeAttribute('aria-current');
    }
  });
  // Il profilo non e' una scheda: ce l'ha la faccia in alto. Li' la riga si spegne
  // invece di restare ferma su una scheda che non e' quella aperta — dire una cosa
  // falsa e' peggio che non dire niente.
  fascia?.classList.toggle('spenta', !aperta);
  const scheda = document.getElementById('top-me');
  scheda?.classList.toggle('on', view === 'profile');
  if (view === 'profile') scheda?.setAttribute('aria-current', 'page');
  else scheda?.removeAttribute('aria-current');
  // La vista corrente e' scritta sul guscio e sul contenitore: il riepilogo e' l'unica
  // che vuole tutta la larghezza e nessuno scorrimento, e il CSS ha bisogno di saperlo
  // da un attributo invece che indovinarlo dal figlio visibile.
  document.getElementById('app-shell')?.setAttribute('data-vista', view);
  document.querySelector('.app-view')?.setAttribute('data-vista', view);
  window.scrollTo({ top: 0 });
  if (view === 'history') loadHistory();
  if (view === 'stats') loadStats();
  if (view === 'groups') renderGroupsView();
  if (view === 'profile') renderProfile();
}

document.querySelectorAll('.nav-item').forEach(b =>
  b.addEventListener('click', () => switchView(b.dataset.view)));

document.getElementById('top-me')?.addEventListener('click', () => switchView('profile'));

// --- Cambia nome ---
document.getElementById('profile-rename').addEventListener('click', async () => {
  const name = await ask('Il tuo nome', { text: 'È quello che appare sul sedile.', value: myName });
  if (!name || !name.trim() || name.trim() === myName) return;
  const { error } = await supabase.from('profiles').update({ display_name: name.trim().slice(0, 40) }).eq('id', currentUser.id);
  if (error) { toast('Errore: ' + error.message); return; }
  myName = name.trim().slice(0, 40);
  renderProfile();
  toast('Nome aggiornato.');
  loadRides();
});

// La scheda con la faccia, a destra nella barra in alto. Dice due cose vere e nessuna
// di piu': come ti chiami e in quante comitive sei. Il ruolo lo scrive solo se c'e'.
function aggiornaSchedaProfilo() {
  const av = document.getElementById('top-av');
  const nome = document.getElementById('top-nome');
  const ruolo = document.getElementById('top-ruolo');
  if (!av || !nome || !ruolo) return;
  av.textContent = initials(myName || '?');
  nome.textContent = myName || '—';
  const n = myGroups.length;
  ruolo.textContent = (isAdmin ? 'Amministratore · ' : '') +
    (n === 0 ? 'nessuna comitiva' : n === 1 ? '1 comitiva' : `${n} comitive`);
}

function renderProfile() {
  aggiornaSchedaProfilo();
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
  renderAuto();
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
  // C38 — la seconda domanda, e si salta. Una comitiva permanente resta il caso
  // normale: chiedere una data e basta trasformerebbe ogni gruppo in una cosa che
  // scade, che e' l'opposto del punto.
  const fine = await ask('Quando finisce?', {
    text: 'Facoltativo. Per un concerto o un weekend: dopo quel giorno non ci si entra più col codice, e i dati restano a chi c\'era. Lascia vuoto per una comitiva che non finisce.',
    type: 'date',
  });
  if (fine === null) return;
  if (fine && fine < todayISO()) { toast('Una comitiva non può chiudere prima di aprire.'); return; }
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name.trim().slice(0, 40), p_scade: fine || null,
  });
  if (error) { toast('Errore: ' + error.message); return; }
  await loadGroups();
  selectGroup(data.id);
  renderGroupsView();
  toast(fine
    ? `Comitiva creata, si chiude il ${dataBreve(fine)}. Condividi il codice ${data.code}.`
    : `Gruppo creato. Condividi il codice ${data.code} con gli amici.`);
}

async function joinGroupFlow() {
  const code = await ask('Entra in un gruppo', { text: 'Fatti mandare il codice da un amico.', placeholder: 'Codice invito (6 caratteri)' });
  if (!code || !code.trim()) return;
  const { data, error } = await supabase.rpc('join_group', { p_code: code.trim() });
  if (error) {
    // Tre esiti e non due (C38): «chiusa» non e' «sbagliato», e dirlo uguale
    // manderebbe a ricontrollare le lettere di un codice giusto.
    toast(error.message.includes('chiusa') ? 'Quella comitiva è chiusa: il codice non vale più.'
      : error.message.includes('Codice') ? 'Codice non valido, ricontrolla.'
      : 'Errore: ' + error.message);
    return;
  }
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
    .select('group:groups(id, name, code, owner_id, scade_il, regola_quota, regola_guida_non_paga, regola_max_posti)')
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
  caricaFermate();
}

function renderGroupBar() {
  groupPills.innerHTML = '';
  for (const g of myGroups) {
    const b = document.createElement('button');
    b.className = 'group-pill' + (currentGroupId === g.id ? ' active' : '');
    b.textContent = g.name;
    b.addEventListener('click', () => selectGroup(g.id));
    groupPills.appendChild(b);
  }
}

function selectGroup(groupId) {
  currentGroupId = groupId;
  if (groupId) localStorage.setItem(ULTIMO_GRUPPO, groupId);
  renderGroupBar();
  // La rubrica (C32) e' del gruppo: cambiando comitiva cambia, e i suggerimenti
  // sotto i campi devono essere quelli della comitiva che si sta guardando.
  caricaFermate();
  loadRides();
}

// --- Vista Gruppi ---
// ══════════════════════════════════════════════════════════════════════════
// C32 — La rubrica delle fermate.
//
// La riempie il trigger `registra_fermate` (029), non questo codice: qui si
// legge e si sceglie. Le fermate stanno in memoria perche' servono in due posti
// che non si parlano — l'elenco sotto i campi del modulo e la scheda nella
// vista Comitiva — e perche' C34 ci cerca dentro le coordinate per la quota.
// ══════════════════════════════════════════════════════════════════════════
let fermate = [];

async function caricaFermate() {
  fermate = [];
  if (!currentGroupId) { riempiElencoFermate(); return; }
  const { data, error } = await supabase
    .from('fermate')
    .select('id, nome, chiave, lat, lon, usi, usata_il')
    .eq('group_id', currentGroupId)
    .order('usi', { ascending: false })
    .limit(60);
  // Un errore qui non rompe niente: senza rubrica i campi tornano a essere quello che
  // erano prima di C32, cioe' testo libero. Degrada, non rompe.
  if (error) { console.error('fermate:', error); }
  fermate = data ?? [];
  riempiElencoFermate();
}

function riempiElencoFermate() {
  const lista = document.getElementById('fermate-lista');
  lista.innerHTML = '';
  for (const f of fermate) {
    const o = document.createElement('option');
    o.value = f.nome;
    // `<option>` in un datalist mostra il testo come suggerimento accanto al valore:
    // quante volte si e' partiti di li' e' l'unica cosa che aiuta a scegliere fra due
    // nomi simili.
    o.label = f.usi > 1 ? `${f.usi} volte` : '';
    lista.appendChild(o);
  }
}

// La stessa normalizzazione della 029, nella stessa forma. Sono due copie e va
// detto: quella che conta e' la SQL, perche' e' lei a decidere l'unicita'. Questa
// serve solo a ritrovare in memoria la fermata che il campo nomina, e se le due
// divergessero il peggio che succede e' che la quota non si precompila (C34).
function chiaveFermata(nome) {
  const piegato = String(nome ?? '').toLowerCase()
    .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c');
  return piegato.replace(/[^a-z0-9]+/g, ' ').trim() || null;
}

function fermataDi(nome) {
  const k = chiaveFermata(nome);
  return k ? fermate.find(f => f.chiave === k) ?? null : null;
}

// ══════════════════════════════════════════════════════════════════════════
// C34 — La quota proposta invece che inventata.
//
// `fuel_per_person` era un numero che chi guida sceglie ogni volta, quindi
// **cambia da persona a persona per lo stesso tragitto**: e' l'unica trattativa
// rimasta nell'app. Qui la cifra si ricava, e sopra il campo c'e' scritto da
// dove esce — un numero precompilato senza il suo conto e' un numero da
// accettare per fiducia, che e' la cosa che C26 ha appena tolto ai conti.
//
// ── Le due costanti, e perche' sono costanti ──────────────────────────────
// Il prezzo del carburante e il consumo di riferimento stanno qui, in due righe
// sole, come `raggio_zona_km()` per il raggio della zona. Un campo da compilare
// per il prezzo del gasolio sarebbe una cosa in piu' da tenere aggiornata che
// nessuno aggiorna; una chiamata a un servizio dei prezzi sarebbe un terzo che
// guarda dove va la gente (D6). Il numero invecchia, e va bene: la proposta si
// corregge, e sbagliare di dieci centesimi su una cifra che oggi si inventa di
// sana pianta non e' un peggioramento.
//
// ── «La stessa proposta per lo stesso tragitto», e cosa vuol dire ─────────
// Il criterio della roadmap e' che due persone che fanno la stessa strada
// propongano la stessa cifra. Vale **per costruzione** finche' nessuno ha
// dichiarato il consumo della propria auto: prezzo, consumo di riferimento e
// modo di dividere sono uguali per tutti, e cambia solo la distanza.
// Se chi guida ha salvato un consumo (C33) la proposta usa quello, ed e' una
// deroga voluta: un'auto che beve di piu' costa davvero di piu', e fingere di
// no vorrebbe dire che il numero derivato e' meno vero di quello inventato.
// La nota sotto il campo dice sempre quale dei due conti ha fatto.
const PREZZO_CARBURANTE = 1.75;      // €/litro, benzina, ordine di grandezza 2026
const CONSUMO_RIFERIMENTO = 15;      // km/l di un'utilitaria qualsiasi

// Haversine, la stessa formula di `distanza_km()` (014). Qui in JS perche' i
// due punti sono gia' in pagina: chiedere al database la distanza fra due
// fermate che si stanno guardando sarebbe un giro di rete per un'aritmetica.
function distanzaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let quotaProposta = null;   // l'ultima cifra scritta da qui, per non sovrascrivere quella di chi guida

function proponiQuota() {
  const nota = document.getElementById('ride-quota-nota');
  const campo = document.getElementById('ride-fuel');
  const regole = regoleGruppo();

  // C36 — la quota fissa della comitiva vince sul calcolo, e non e' un'eccezione al
  // principio di C34: e' ancora un numero che non si inventa ogni volta. La comitiva
  // l'ha deciso una volta, e questo e' il posto in cui quella decisione si applica
  // senza che nessuno la ridigiti.
  if (regole.quota != null) {
    const fissa = regole.quota;
    if (campo.value === '' || (quotaProposta !== null && Number(campo.value) === quotaProposta)) {
      campo.value = String(fissa);
      quotaProposta = fissa;
    }
    nota.textContent = `Quota fissa della comitiva: ${fissa.toFixed(2)} €`
      + (regole.guidaNonPaga ? ' · chi guida non paga' : '');
    return;
  }

  const da = fermataDi(document.getElementById('ride-origin').value);
  const a = fermataDi(document.getElementById('ride-destination').value);
  if (!da || !a || da.lat == null || a.lat == null || da.id === a.id) {
    // Niente proposta e **niente scusa**: dire «non posso calcolare» sotto un campo
    // facoltativo sarebbe rumore. Chi vuole capire perche' lo trova nella scheda
    // delle fermate, dove si vede quali hanno un punto e quali no.
    nota.textContent = '';
    return;
  }
  const km = distanzaKm(da, a);
  if (!(km > 0.3)) { nota.textContent = ''; return; }
  const auto = autoScelta();
  const consumo = auto?.consumo_km_l ? Number(auto.consumo_km_l) : CONSUMO_RIFERIMENTO;
  // Diviso per chi c'e' in macchina, guidatore compreso: e' la convenzione con cui
  // si divide una spesa fra chi la fa insieme. Se la comitiva ha deciso che chi
  // guida non paga (C36), il conto e' lo stesso e cambia solo in quante parti si
  // divide — la benzina costa uguale.
  const posti = Number(document.getElementById('ride-seats').value || 4);
  const persone = regole.guidaNonPaga ? Math.max(1, posti) : posti + 1;
  const costo = (km / consumo) * PREZZO_CARBURANTE;
  // A mezzi euro, come lo scatto del campo: proporre 1,37 € a testa e' un numero
  // che nessuno tira fuori dal portafoglio.
  const quota = Math.round((costo / persone) * 2) / 2;
  const base = `${km.toFixed(1)} km · ${consumo} km/l`
    + (auto?.consumo_km_l ? ` (${auto.nome})` : ' (riferimento)')
    + ` · ${PREZZO_CARBURANTE.toFixed(2)} €/l · diviso ${persone}`
    + (regole.guidaNonPaga ? ' (chi guida non paga)' : '');

  const vuoto = campo.value === '';
  const miaProposta = quotaProposta !== null && Number(campo.value) === quotaProposta;

  // **Sotto i cinquanta centesimi non si propone niente, e non e' un dettaglio.**
  // Il conto vero di un tragitto corto diviso per cinque fa venti centesimi: un
  // minimo di mezzo euro messo li' per avere un numero da mostrare sarebbe una
  // cifra inventata, cioe' esattamente cio' che questo cantiere toglie — e per
  // giunta piu' alta del dovuto. Un campo vuoto qui vuol dire «non si paga», che
  // per due chilometri e' la risposta giusta.
  if (quota < 0.5) {
    if (miaProposta) { campo.value = ''; quotaProposta = null; }
    nota.textContent = `${base} · meno di 50 centesimi a testa: non vale un contributo`;
    return;
  }

  if (vuoto || miaProposta) {
    campo.value = String(quota);
    quotaProposta = quota;
  }
  nota.textContent = base
    + (vuoto || miaProposta ? '' : ` · proposta: ${quota.toFixed(2)} €`);
}

for (const id of ['ride-origin', 'ride-destination', 'ride-seats', 'ride-auto']) {
  document.getElementById(id).addEventListener('input', proponiQuota);
  document.getElementById(id).addEventListener('change', proponiQuota);
}

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
    // C38: quando una comitiva finisce si legge accanto al codice, che e' la cosa
    // che smette di funzionare. Chiusa e in scadenza sono due stati diversi: il
    // primo e' un fatto, il secondo e' un avviso.
    if (g.scade_il) {
      const fine = document.createElement('span');
      const chiusa = g.scade_il < todayISO();
      fine.className = 'place-badge' + (chiusa ? ' ritardo' : '');
      fine.textContent = chiusa ? `Chiusa il ${dataBreve(g.scade_il)}` : `Si chiude il ${dataBreve(g.scade_il)}`;
      fine.title = chiusa
        ? 'Col codice non si entra più e non si pubblica. Quello che c\'è resta leggibile a chi c\'era.'
        : 'Dopo quel giorno col codice non si entra più.';
      head.appendChild(fine);
    }
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
              if (!await conferma(`Rimuovere ${nome} dal gruppo?`, {
                testo: `${nome} esce da "${g.name}" e non vede più i passaggi della comitiva. I posti già presi restano.`,
                azione: 'Rimuovi dal gruppo',
                pericolo: true,
              })) return;
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
    invite.addEventListener('click', () => condividi(inviteText, SITE_URL));
    actions.appendChild(invite);

    const leave = document.createElement('button');
    leave.className = 'btn btn-ghost btn-small btn-danger';
    leave.textContent = 'Esci dal gruppo';
    leave.addEventListener('click', async () => {
      if (!await conferma(`Uscire da "${g.name}"?`, {
        testo: 'Non vedrai più i passaggi di questa comitiva. Per rientrare serve di nuovo il codice.',
        azione: 'Esci dal gruppo',
        pericolo: true,
      })) return;
      const { error } = await supabase.from('group_members').delete()
        .eq('group_id', g.id).eq('user_id', currentUser.id);
      if (error) { toast(friendlyError(error)); return; }
      await loadGroups();
      renderGroupsView();
      loadRides();
    });
    actions.appendChild(leave);

    // ── C36: le regole, a chi possiede la comitiva ──────────────────────
    // Sotto ai membri e sopra alle fermate: sono la cosa che vale per tutti
    // quelli scritti sopra, e si leggono nell'ordine in cui si ragiona.
    card.appendChild(schedaRegole(g));

    // ── C32: le fermate, ma solo della comitiva aperta ──────────────────
    // `fermate` in memoria e' quella di `currentGroupId`: mostrarla sotto tutte
    // le schede direbbe che i posti di un gruppo sono anche quelli dell'altro,
    // che e' il contrario di cio' che questa app tiene separato.
    if (g.id === currentGroupId) card.appendChild(schedaFermate(g));

    card.appendChild(actions);
    list.appendChild(card);
  }
}

// C36 — le regole si leggono sempre, si cambiano solo se la comitiva e' tua.
// Leggerle vale per tutti: una regola che vedi solo se puoi cambiarla non e' una
// regola, e' una preferenza di chi comanda.
function schedaRegole(g) {
  const box = document.createElement('div');
  box.className = 'fermate-box';
  const titolo = document.createElement('div');
  titolo.className = 'fermate-titolo';
  titolo.textContent = 'Le regole della comitiva';
  box.appendChild(titolo);

  const detto = [
    g.regola_quota != null ? `Quota fissa: ${Number(g.regola_quota).toFixed(2)} € a testa` : null,
    g.regola_guida_non_paga ? 'Chi guida non paga' : null,
    g.regola_max_posti != null ? `Massimo ${g.regola_max_posti} passeggeri` : null,
  ].filter(Boolean);

  const p = document.createElement('p');
  p.className = 'form-hint';
  p.textContent = detto.length
    ? detto.join(' · ')
    : 'Nessuna regola fissata: ogni passaggio si decide da capo.';
  box.appendChild(p);

  if (g.owner_id !== currentUser.id) return box;

  const azioni = document.createElement('div');
  azioni.className = 'group-card-actions';
  const cambia = document.createElement('button');
  cambia.className = 'btn btn-ghost btn-small';
  cambia.textContent = detto.length ? 'Cambia le regole' : 'Fissa le regole';
  cambia.addEventListener('click', () => modificaRegole(g));
  azioni.appendChild(cambia);

  // C38 — la data di fine si sceglie creando la comitiva, ma una data sbagliata
  // dev'essere correggibile: senza questo bottone l'unico rimedio sarebbe rifare la
  // comitiva, cioe' perdere i membri e i conti. Sta qui e non fra le regole perche'
  // non e' una convenzione del gruppo — e' un fatto che il database fa rispettare.
  const data = document.createElement('button');
  data.className = 'btn btn-ghost btn-small';
  data.textContent = g.scade_il ? 'Cambia la data di fine' : 'Falla chiudere da sola';
  data.addEventListener('click', async () => {
    const fine = await ask('Quando finisce la comitiva?', {
      text: 'Dopo quel giorno non ci si entra più col codice e non si pubblica. Quello che c\'è resta leggibile a chi c\'era. Lascia vuoto perché non finisca.',
      value: g.scade_il ?? '', type: 'date',
    });
    if (fine === null) return;
    if (fine && fine < todayISO()) { toast('Una comitiva non può chiudere prima di oggi.'); return; }
    const { error } = await supabase.from('groups').update({ scade_il: fine || null }).eq('id', g.id);
    if (error) { toast(friendlyError(error)); return; }
    toast(fine ? `La comitiva si chiude il ${dataBreve(fine)}.` : 'La comitiva non finisce più.');
    await loadGroups();
    renderGroupsView();
    loadRides();
  });
  azioni.appendChild(data);

  box.appendChild(azioni);
  return box;
}

async function modificaRegole(g) {
  // Vuoto vuol dire «nessuna regola», e va detto a parole in ogni domanda: senza,
  // l'unico modo di togliere una regola gia' messa sarebbe indovinarlo.
  const quota = await ask('Quota fissa a testa', {
    text: 'In euro. Lascia vuoto perché la quota resti libera: chi guida la sceglie ogni volta, o la fa proporre dal tragitto.',
    value: g.regola_quota != null ? String(Number(g.regola_quota)) : '',
    placeholder: '5', type: 'number',
  });
  if (quota === null) return;
  const q = quota === '' ? null : Math.round(Number(String(quota).replace(',', '.')) * 100) / 100;
  if (q !== null && !(q >= 0 && q <= 100)) { toast('Una quota fra 0 e 100 €.'); return; }

  const guida = await ask('Chi guida partecipa alla spesa?', {
    text: 'Rispondi "no" se nella tua comitiva chi mette l\'auto non paga la benzina.',
    value: g.regola_guida_non_paga ? 'no' : 'sì',
    scelte: [['sì', 'Sì, divide con gli altri'], ['no', 'No, chi guida non paga']],
  });
  if (guida === null) return;
  const nonPaga = /^n/i.test(guida.trim());

  const posti = await ask('Massimo passeggeri', {
    text: 'Senza contare chi guida. Lascia vuoto per nessun limite.',
    value: g.regola_max_posti != null ? String(g.regola_max_posti) : '',
    placeholder: '4', type: 'number',
    scelte: [['3', '3'], ['4', '4'], ['5', '5']],
  });
  if (posti === null) return;
  const mp = posti === '' ? null : Number(posti);
  if (mp !== null && !(mp >= 1 && mp <= 6)) { toast('Da 1 a 6 passeggeri.'); return; }

  const { error } = await supabase.from('groups').update({
    regola_quota: q, regola_guida_non_paga: nonPaga, regola_max_posti: mp,
  }).eq('id', g.id);
  if (error) { toast(friendlyError(error)); return; }
  toast('Regole della comitiva aggiornate.');
  await loadGroups();
  renderGroupsView();
  // La quota proposta (C34) dipende da queste: senza, il modulo continuerebbe a
  // proporre la cifra di prima fino al ricaricamento.
  proponiQuota();
}

// Le fermate stanno nella vista Comitiva perche' sono **del gruppo**: e' la
// rubrica condivisa, non una preferenza di chi guarda.
function schedaFermate(g) {
  const box = document.createElement('div');
  box.className = 'fermate-box';
  const titolo = document.createElement('div');
  titolo.className = 'fermate-titolo';
  titolo.textContent = fermate.length
    ? `Fermate della comitiva (${fermate.length})`
    : 'Fermate della comitiva';
  box.appendChild(titolo);
  if (!fermate.length) {
    const p = document.createElement('p');
    p.className = 'form-hint';
    p.textContent = 'Si riempie da sola: ogni partenza e ogni destinazione che scrivete pubblicando entra qui, e dalla volta dopo si sceglie invece di riscriverla.';
    box.appendChild(p);
    return box;
  }
  const elenco = document.createElement('div');
  elenco.className = 'fermate-elenco';
  for (const f of fermate) {
    const riga = document.createElement('span');
    riga.className = 'history-chip' + (f.lat != null ? ' driver' : '');
    riga.textContent = `${f.nome} · ${f.usi}`;
    riga.title = f.lat != null
      ? 'Ha un punto sulla mappa: serve a proporre la quota della benzina.'
      : 'Senza punto sulla mappa.';

    const punta = document.createElement('button');
    punta.className = 'chip-kick';
    punta.textContent = f.lat != null ? '↺' : '⌖';
    punta.title = f.lat != null ? 'Rimisura il punto stando qui' : 'Segna il punto stando qui';
    punta.addEventListener('click', () => segnaPuntoFermata(f));
    riga.appendChild(punta);

    if (g.owner_id === currentUser.id) {
      const via = document.createElement('button');
      via.className = 'chip-kick';
      via.textContent = '✕';
      via.title = `Togli "${f.nome}" dalla rubrica`;
      via.addEventListener('click', async () => {
        if (!await conferma(`Togliere "${f.nome}" dalla rubrica?`, {
          testo: 'Sparisce dai suggerimenti. I passaggi già pubblicati non cambiano, e se qualcuno la riscrive torna.',
          azione: 'Togli dalla rubrica',
          pericolo: true,
        })) return;
        const { error } = await supabase.from('fermate').delete().eq('id', f.id);
        if (error) { toast(friendlyError(error)); return; }
        await caricaFermate();
        renderGroupsView();
      });
      riga.appendChild(via);
    }
    elenco.appendChild(riga);
  }
  box.appendChild(elenco);
  const nota = document.createElement('p');
  nota.className = 'form-hint';
  nota.textContent = 'Il numero è quante volte è stata usata. Il punto sulla mappa si segna stando sul posto, e lo vede tutta la comitiva: mettilo su un ritrovo, non su casa tua.';
  box.appendChild(nota);
  return box;
}

// Il punto di una fermata **non** si raccoglie di nascosto dalle pubblicazioni:
// e' la decisione scritta nella 029, ed e' C21 per la terza volta. Si mette con
// un gesto che dice cosa sta facendo, e la conferma lo dice a parole.
async function segnaPuntoFermata(f) {
  if (bloccaSeSospeso('segnare una fermata')) return;
  if (!await conferma(`Segnare qui "${f.nome}"?`, {
    testo: 'Prende la posizione di adesso e la salva sulla fermata. La vede tutta la comitiva, quindi vale per un punto di ritrovo — non per il posto da cui parti tu.',
    azione: 'Sono alla fermata',
  })) return;
  let punto;
  try {
    punto = await posizione();
  } catch (err) {
    toast(err.message);
    return;
  }
  const { error } = await supabase.from('fermate')
    .update({ lat: punto.lat, lon: punto.lon }).eq('id', f.id);
  if (error) { toast(friendlyError(error)); return; }
  toast(`"${f.nome}" ha il suo punto sulla mappa.`);
  await caricaFermate();
  renderGroupsView();
}

// --- Vista Storico ---
const DAY_FMT = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

function groupLabel() {
  const g = myGroups.find(x => x.id === currentGroupId);
  return g ? `Gruppo: ${g.name}` : 'Nessuna comitiva';
}

// Il solo nome, senza etichetta davanti: nella testata del riepilogo sta accanto alla
// parola «Riepilogo» e in un contesto che non lascia dubbi su cosa sia.
// C36 — le regole della comitiva aperta. Sempre un oggetto, mai `undefined`: chi le
// legge non deve chiedersi se c'e' una comitiva, e «nessuna regola» e' un caso
// normale, non un errore.
// C38 — la comitiva aperta ha gia' chiuso? Il confronto e' sulla data locale, la
// stessa che `todayISO()` usa dappertutto: `current_date` del database e' in un
// altro fuso, e un'ora di scarto a mezzanotte direbbe due cose diverse.
function comitivaChiusa() {
  const g = myGroups.find(x => x.id === currentGroupId);
  return Boolean(g?.scade_il && g.scade_il < todayISO());
}

function regoleGruppo() {
  const g = myGroups.find(x => x.id === currentGroupId);
  return {
    quota: g?.regola_quota != null ? Number(g.regola_quota) : null,
    guidaNonPaga: Boolean(g?.regola_guida_non_paga),
    maxPosti: g?.regola_max_posti ?? null,
  };
}

function nomeComitiva() {
  return myGroups.find(x => x.id === currentGroupId)?.name ?? 'Nessuna comitiva';
}

// ── C27: i due interruttori dello storico ──────────────────────────────────
// Sono variabili di modulo, non stato di un elemento: e' l'unico modo perche'
// la scelta sopravviva al cambio di vista senza scriverla da nessuna parte.
// La domanda vera e' «quante volte ci ho messo l'auto?», e senza questi due si
// risponde contando a mano un elenco indistinto.
const STORICO_FINESTRA = 120;
let storicoSoloMiei = false;
let storicoSoloGuidati = false;

function aggiornaFiltriStorico() {
  const m = document.getElementById('storico-miei');
  const g = document.getElementById('storico-guidati');
  m.classList.toggle('on', storicoSoloMiei);
  m.setAttribute('aria-pressed', String(storicoSoloMiei));
  g.classList.toggle('on', storicoSoloGuidati);
  g.setAttribute('aria-pressed', String(storicoSoloGuidati));
}

document.getElementById('storico-miei').addEventListener('click', () => {
  storicoSoloMiei = !storicoSoloMiei;
  aggiornaFiltriStorico();
  loadHistory();
});
document.getElementById('storico-guidati').addEventListener('click', () => {
  storicoSoloGuidati = !storicoSoloGuidati;
  aggiornaFiltriStorico();
  loadHistory();
});

async function loadHistory() {
  if (!currentGroupId) return;
  const list = document.getElementById('history-list');
  document.querySelector('#view-history .view-subtitle').textContent =
    `Chi ha guidato e chi era a bordo · ${groupLabel()} (si cambia dalla Home)`;
  aggiornaFiltriStorico();
  list.innerHTML = '<div class="skeleton"></div>';
  let hq = supabase
    .from('rides')
    .select('ride_date, origin, destination, depart_time, driver_id, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger_id, ospite_nome, invitato_da, passenger:profiles!seat_claims_passenger_id_fkey(display_name))')
    .lt('ride_date', todayISO());
  hq = hq.eq('group_id', currentGroupId);
  const { data: tutti, error } = await hq
    .order('ride_date', { ascending: false })
    .order('depart_time', { ascending: true, nullsFirst: false })
    .limit(STORICO_FINESTRA);
  list.innerHTML = '';
  if (error || !tutti) {
    document.getElementById('history-empty').classList.remove('hidden');
    document.getElementById('storico-conteggio').textContent = '';
    return;
  }

  // I due filtri si combinano, e insieme valgono il piu' stretto dei due: chi
  // chiede «i miei» **e** «guidati da me» chiede i suoi turni alla guida.
  // «I miei passaggi» comprende quelli su cui ho portato un ospite: il posto l'ho
  // preso io, e nel conto della benzina risulta a me (C35).
  const cEroIo = (r) => r.seat_claims.some(c => chiRisponde(c) === currentUser.id);
  const data = tutti.filter(r =>
    (!storicoSoloMiei || r.driver_id === currentUser.id || cEroIo(r))
    && (!storicoSoloGuidati || r.driver_id === currentUser.id));

  // Il conteggio e' la risposta alla domanda, e va detto anche quando il filtro
  // non nasconde niente: e' il numero che si andava a contare a mano.
  const conteggio = document.getElementById('storico-conteggio');
  const filtrato = storicoSoloMiei || storicoSoloGuidati;
  conteggio.textContent = filtrato
    ? `${data.length} su ${tutti.length} · ultimi ${STORICO_FINESTRA} passaggi della comitiva`
    : (tutti.length >= STORICO_FINESTRA ? `ultimi ${STORICO_FINESTRA} passaggi` : '');

  // Vuoto per il filtro e vuoto per davvero sono due cose diverse, e dirle uguali
  // fa credere che la comitiva non abbia mai viaggiato.
  const vuoto = document.getElementById('history-empty');
  vuoto.classList.toggle('hidden', data.length > 0);
  if (!data.length && tutti.length) {
    vuoto.querySelector('.empty-title').textContent = 'Nessun passaggio con questi filtri';
    vuoto.querySelector('.empty-hint').textContent =
      `La comitiva ne ha ${tutti.length} nella finestra guardata: togli un filtro per vederli.`;
  } else if (!data.length) {
    vuoto.querySelector('.empty-title').textContent = 'Ancora nessun viaggio';
    vuoto.querySelector('.empty-hint').textContent =
      'Quando i giorni passano, qui trovi chi ha guidato e chi era con lui.';
  }

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
      chip.textContent = nomeOccupante(c);
      people.appendChild(chip);
    }
    item.appendChild(people);
    dayWrap.appendChild(item);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Il riepilogo.
//
// Una sola funzione perche' una sola lettura: le tre interrogazioni partono
// insieme e da li' in poi si contano le stesse righe **in un giro solo**,
// invece di chiedere al database una somma per riquadro. Con una comitiva vera
// sono centinaia di righe, non milioni.
//
// Regola valida per ogni riquadro qui sotto: **se il dato non c'e', il riquadro
// non c'e'**. Nessun numero finto, nessun trattino messo li' per riempire il
// disegno. Un cruscotto che mostra zeri inventati e' peggio di uno spazio vuoto,
// perche' lo zero si legge come una misura.
//
// E la regola aggiunta in C41: **ogni numero compare una volta sola.** I giorni
// scoperti stavano in tre punti — la riga in cima, un riquadro dei numeri e il
// piede della settimana — e tre copie dello stesso conto non sono tre
// informazioni: sono una, ripetuta, che ruba il posto a quelle che mancano.
// ══════════════════════════════════════════════════════════════════════════
async function loadStats() {
  const box = document.getElementById('stats-content');

  // **Questa vista non puo' finire bianca.** Prima il riquadro conteneva un titolo
  // fisso scritto in `index.html`, quindi anche uscendo subito qualcosa restava a
  // schermo; ora lo scrive tutto questa funzione, e uscire in silenzio vuol dire
  // consegnare una pagina vuota — che chi guarda legge come «e' rotto», non come
  // «manca un gruppo». Le tre uscite qui sotto dicono cosa manca e cosa fare.
  if (!currentGroupId) {
    box.innerHTML = `${testata('Serve una comitiva: il riepilogo somma i passaggi di un gruppo.')}
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
    box.innerHTML = `${testata('Qualcosa non ha funzionato nel caricare i dati.')}
      <section class="card"><div class="head"><h3>Riepilogo non disponibile</h3></div>
      <p class="vuoto">Ricarica la pagina. Se continua, è un difetto: il dettaglio è nella
      console del browser.</p>
      <button type="button" class="cta-vuoto" data-ricarica>Riprova</button></section>`;
    box.querySelector('[data-ricarica]')?.addEventListener('click', () => loadStats());
  }
}

async function disegnaRiepilogo(box) {
  // **Le tre letture partono insieme.** Prima i passaggi si aspettavano da soli e
  // le altre due partivano dopo: due viaggi di rete in fila per tre domande che
  // non dipendono l'una dall'altra.
  const [resPassaggi, resPagamenti, resEventi] = await Promise.all([
    supabase.from('rides').select(CAMPI_RIEPILOGO).eq('group_id', currentGroupId),
    supabase.from('pagamenti').select('da_utente, a_utente, importo, quando').eq('group_id', currentGroupId),
    supabase.from('eventi').select('tipo, attore, quando').eq('group_id', currentGroupId)
      .order('quando', { ascending: false }).limit(5),
  ]);
  // Non si scrive un messaggio a mano: si lascia salire, cosi' l'errore vero finisce
  // in console e chi ha chiamato e' l'unico posto che decide cosa mostrare.
  if (resPassaggi.error) throw resPassaggi.error;
  const passaggi = resPassaggi.data;
  if (!passaggi) throw new Error('nessun dato dai passaggi');
  // Le altre due non fermano niente: se mancano manca un riquadro, non la pagina.
  // `eventi` non ha chiavi esterne (e' un registro storico: deve sopravvivere a
  // cio' che racconta), quindi PostgREST non puo' unirla a `profiles` da solo e i
  // nomi si risolvono qui sotto, con quelli gia' letti dai passaggi.
  const pagamenti = resPagamenti.data ?? [];
  const eventi = resEventi.data ?? [];

  const oggi = todayISO();
  const trentaFa = isoMeno(oggi, 30);
  const inizioMese = oggi.slice(0, 8) + '01';

  // ── I conti fra me e gli altri, con l'aritmetica di saldo_con() ───────────
  const dovutoDaMe = new Map();   // guidatore -> quanto gli devo
  const dovutoAMe = new Map();    // passeggero -> quanto mi deve
  const quantiCon = new Map();    // altra persona -> quanti passaggi in ballo
  const primaCon = new Map();     // altra persona -> il piu' vecchio dei passaggi
  // C26 — le voci che compongono ogni conto, nello stesso giro che lo somma.
  // Il segno e' sempre dal mio punto di vista: positivo = quella riga fa salire
  // il mio credito. Cosi' la somma delle voci **e'** il netto, per costruzione, e
  // non un secondo conto che puo' divergere dal primo.
  const vociCon = new Map();      // altra persona -> [{quando, testo, importo}]
  const voce = (id, quando, testo, importo) => {
    const v = vociCon.get(id) ?? [];
    v.push({ quando, testo, importo });
    vociCon.set(id, v);
  };
  const segna = (id, giorno) => {
    quantiCon.set(id, (quantiCon.get(id) || 0) + 1);
    const p = primaCon.get(id);
    if (!p || giorno < p) primaCon.set(id, giorno);
  };
  const tratta = (r) => (r.origin ? `${r.origin} → ` : '') + (r.destination || '—');

  // ── Un giro solo sui passaggi, e tutte le somme che servono ───────────────
  // Erano tre giri sulle stesse righe — i conteggi, il carburante, il saldo —
  // piu' un `filter` per ognuno dei sette giorni della settimana. Le somme sono
  // diverse, le righe sono le stesse: si passa una volta e si riempiono tutte.
  const perGiorno = new Map();    // giorno ISO -> i passaggi di quel giorno
  const turni30 = new Map();      // guidatore -> {nome, n}, ultimi 30 giorni
  const perMese = new Map();      // mese '2026-08' -> {tot, n} di carburante diviso
  const nomePer = new Map();      // id -> nome, per ogni persona che compare qui
  const guidaNelMese = new Set();
  let nelMese = 0;
  for (const r of passaggi) {
    nomePer.set(r.driver_id, nomeDi(r.driver));
    const delGiorno = perGiorno.get(r.ride_date);
    if (delGiorno) delGiorno.push(r); else perGiorno.set(r.ride_date, [r]);

    if (r.ride_date >= trentaFa && r.ride_date <= oggi) {
      const t = turni30.get(r.driver_id) ?? { nome: nomeDi(r.driver), n: 0 };
      t.n++; turni30.set(r.driver_id, t);
    }
    if (r.ride_date >= inizioMese && r.ride_date <= oggi) {
      nelMese++;
      guidaNelMese.add(r.driver_id);
    }

    // Il carburante ripartito non e' quanto e' stato **pagato** (quello sta in
    // `pagamenti`): e' quanto valgono le quote dei posti occupati, cioe' la spesa
    // che la comitiva si e' divisa. Le due cose vanno tenute separate o il saldo
    // non torna.
    const quota = Number(r.fuel_per_person) || 0;
    if (quota && r.seat_claims.length) {
      const mese = r.ride_date.slice(0, 7);
      const v = perMese.get(mese) ?? { tot: 0, n: 0 };
      v.tot += quota * r.seat_claims.length;
      v.n += 1;
      perMese.set(mese, v);
    }

    for (const c of r.seat_claims) {
      if (c.passenger_id) nomePer.set(c.passenger_id, nomeDi(c.passenger));
      if (!quota) continue;
      // Un ospite non e' una persona di questa applicazione: il posto si conta a
      // chi lo ha portato, che e' la stessa regola con cui `saldo_con` gli mette
      // addosso la quota (031). Due regole diverse qui e nel database vorrebbero
      // dire due totali diversi per la stessa cosa.
      const chi = chiRisponde(c);
      if (chi === currentUser.id && r.driver_id !== currentUser.id) {
        dovutoDaMe.set(r.driver_id, (dovutoDaMe.get(r.driver_id) || 0) + quota);
        segna(r.driver_id, r.ride_date);
        voce(r.driver_id, r.ride_date, `Posto sulla sua auto · ${tratta(r)}`, -quota);
      } else if (r.driver_id === currentUser.id && chi && chi !== currentUser.id) {
        dovutoAMe.set(chi, (dovutoAMe.get(chi) || 0) + quota);
        segna(chi, r.ride_date);
        voce(chi, r.ride_date, `Posto sulla tua auto · ${tratta(r)}`
          + (c.passenger_id ? '' : ` (ospite: ${c.ospite_nome})`), quota);
      }
    }
  }

  for (const pg of pagamenti) {
    const imp = Number(pg.importo) || 0;
    if (pg.da_utente === currentUser.id) {
      dovutoDaMe.set(pg.a_utente, (dovutoDaMe.get(pg.a_utente) || 0) - imp);
      voce(pg.a_utente, pg.quando, 'Pagamento che hai fatto', imp);
    }
    if (pg.a_utente === currentUser.id) {
      dovutoAMe.set(pg.da_utente, (dovutoAMe.get(pg.da_utente) || 0) - imp);
      voce(pg.da_utente, pg.quando, 'Pagamento che hai ricevuto', -imp);
    }
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

  // ── Quel che resta da qui in avanti ──────────────────────────────────────
  const futuri = passaggi
    .filter(r => r.ride_date >= oggi)
    .sort((a, b) => (a.ride_date + (a.depart_time || '')).localeCompare(b.ride_date + (b.depart_time || '')));
  const prossimo = futuri[0] ?? null;
  const liberiTot = futuri.reduce((s, r) => s + Math.max(0, (r.seats || 0) - r.seat_claims.length), 0);

  // ── I prossimi sette giorni: chi guida, e i giorni senza nessuno ─────────
  const settimana = [];
  for (let i = 0; i < 7; i++) {
    const giorno = todayISO(i);
    const rides = perGiorno.get(giorno) ?? [];
    settimana.push({
      giorno,
      rides,
      posti: rides.reduce((s, r) => s + (r.seats || 0), 0),
      presi: rides.reduce((s, r) => s + r.seat_claims.length, 0),
    });
  }
  const scoperti = settimana.filter(g => !g.rides.length).length;
  const primoScoperto = settimana.find(g => !g.rides.length);
  const postiSett = settimana.reduce((s, g) => s + g.posti, 0);
  const presiSett = settimana.reduce((s, g) => s + g.presi, 0);

  // ── Il carburante degli ultimi sei mesi ──────────────────────────────────
  const mesiFinestra = ultimiMesi(oggi, 6);
  const serie = mesiFinestra.map(m => perMese.get(m)?.tot ?? 0);
  const meseCorr = perMese.get(oggi.slice(0, 7)) ?? { tot: 0, n: 0 };
  const mesePrec = perMese.get(mesiFinestra[mesiFinestra.length - 2]) ?? { tot: 0, n: 0 };
  const delta = mesePrec.tot > 0 ? Math.round(((meseCorr.tot - mesePrec.tot) / mesePrec.tot) * 100) : null;

  // ── Da qui in giu' si scrive, non si calcola piu' ────────────────────────
  const mio = (id) => id === currentUser.id;
  const nomeCorto = (id) => mio(id) ? 'Tu' : (nomePer.get(id) || 'Qualcuno');

  // I quattro numeri in cima sono la risposta piu' corta alla domanda «come
  // siamo messi», e **nessuno di loro e' ripetuto piu' in basso**: i passaggi in
  // programma non stanno piu' nella riga della testata, i giorni scoperti non
  // stanno piu' nel piede della settimana, il saldo non sta piu' nella pastiglia
  // dei conti. Erano cinque: «Posti disponibili» diceva un numero che ora sta
  // nella nota qui accanto, dove costa una riga invece di un riquadro.
  const numeri = [
    tessera('', 'Passaggi in programma', String(futuri.length),
      plurale(liberiTot, 'posto libero', 'posti liberi')),
    tessera('', 'Passaggi nel mese', String(nelMese),
      plurale(guidaNelMese.size, 'persona alla guida', 'persone alla guida')),
    tessera('mio', 'Il tuo saldo', firma(saldo),
      partite.length ? plurale(partite.length, 'conto in sospeso', 'conti in sospeso') : 'nessun conto in sospeso'),
    scoperti
      ? tessera('allerta', 'Giorni scoperti', String(scoperti), `il primo: ${dataBreve(primoScoperto.giorno)}`)
      : tessera('', 'Giorni scoperti', '0', 'sette giorni tutti coperti'),
  ].join('');

  // Il grafico: si disegna solo se ci sono due mesi con qualcosa dentro. Una
  // linea costruita su un punto solo e' una decorazione, non una misura.
  const via = sparkline(serie);
  const cardCarburante = `
    <section class="card hero">
      <div class="head"><span class="sub">Carburante ripartito · mese corrente</span></div>
      <div class="big">${escapeHtml(eur(meseCorr.tot))}</div>
      <div class="d">${
        delta === null ? 'primo mese con le quote registrate' :
        `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% sul mese precedente`
      }${meseCorr.n ? ` · ${escapeHtml(eur(meseCorr.tot / meseCorr.n))} per passaggio` : ''}</div>
      ${serie.filter(v => v > 0).length >= 2 ? `
      <svg class="via" viewBox="0 0 250 56" preserveAspectRatio="none" role="img"
           aria-label="Andamento del carburante ripartito negli ultimi sei mesi">
        <defs><linearGradient id="grad-carb" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--primary)" stop-opacity=".28"/>
          <stop offset="1" stop-color="var(--primary)" stop-opacity="0"/></linearGradient></defs>
        <path d="${via} L250,56 L0,56 Z" fill="url(#grad-carb)"/>
        <path d="${via}" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg>` : ''}
    </section>`;

  const liberiProssimo = prossimo ? Math.max(0, (prossimo.seats || 0) - prossimo.seat_claims.length) : 0;
  const cardProssimo = prossimo ? `
    <section class="card next">
      <div class="head"><span class="sub">Prossimo passaggio · ${escapeHtml(dataBreve(prossimo.ride_date))}</span></div>
      <div class="titolo">${escapeHtml((prossimo.depart_time || '').slice(0, 5))} · ${escapeHtml(prossimo.origin || '—')} → ${escapeHtml(prossimo.destination || '')}</div>
      <div class="riga${mio(prossimo.driver_id) ? ' tua' : ''}"><span>Conducente</span><b>${escapeHtml(nomeCorto(prossimo.driver_id))}</b></div>
      <div class="riga"><span>Occupazione</span><b>${prossimo.seat_claims.length} / ${prossimo.seats} · ${escapeHtml(plurale(liberiProssimo, 'disponibile', 'disponibili'))}</b></div>
      <div class="riga"><span>Ritrovo</span><b>${escapeHtml(prossimo.origin || 'da concordare')}</b></div>
      <div class="riga"><span>${prossimo.seat_claims.length === 1 ? 'Passeggero' : 'Passeggeri'}</span><b>${
        prossimo.seat_claims.length
          ? prossimo.seat_claims.map(c => escapeHtml(c.passenger_id ? nomeCorto(c.passenger_id) : `${nomeOccupante(c)} (ospite)`)).join(' · ')
          : 'nessuno, per ora'}</b></div>
      <button type="button" class="go" data-vai="home" aria-label="Vai al passaggio">→</button>
    </section>` : `
    <section class="card next">
      <div class="head"><span class="sub">Prossimo passaggio</span></div>
      <div class="titolo">Nessun passaggio in programma</div>
      <div class="riga"><span>Guidi tu?</span><b>Pubblica la tua auto dalla Home</b></div>
      <button type="button" class="go" data-vai="home" aria-label="Vai alla Home">→</button>
    </section>`;

  const cardSettimana = `
    <section class="card">
      <div class="head"><h3>Occupazione settimanale</h3></div>
      ${settimana.map(g => {
        // Con piu' di un'auto nello stesso giorno il nome di chi guida la prima
        // sarebbe una mezza verita': si dice quante sono.
        const guidatori = new Set(g.rides.map(r => r.driver_id));
        const suo = guidatori.has(currentUser.id);
        const perc = g.posti ? (g.presi / g.posti) * 100 : 0;
        const et = `${giornoBreve(g.giorno)} · ` + (
          guidatori.size === 0 ? 'scoperto'
          : guidatori.size > 1 ? `${guidatori.size} auto`
          : nomeCorto(g.rides[0].driver_id).toLowerCase());
        return `<div class="riemp">
          <span class="n">${suo ? `<span class="tu">${escapeHtml(et)}</span>` : escapeHtml(et)}</span>
          <span class="bar"><i style="width:${perc.toFixed(0)}%;background:${
            !g.posti ? 'transparent' : suo ? 'var(--tuo)' : 'var(--ink-soft)'}"></i></span>
          <span class="p">${g.posti ? `${g.presi}/${g.posti}` : '—'}</span>
        </div>`;
      }).join('')}
      <div class="piede"><b>${presiSett}/${postiSett}</b> posti assegnati nei sette giorni</div>
    </section>`;

  const turni = [...turni30.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  const totTurni = turni.reduce((s, [, v]) => s + v.n, 0);
  const mieiTurni = turni30.get(currentUser.id)?.n ?? 0;
  const cardTurni = `
    <section class="card">
      <div class="head"><h3>Distribuzione turni</h3><span class="sub">ultimi 30 giorni</span></div>
      ${turni.length ? turni.map(([id, v]) => `<div class="turno">
          <span class="n">${mio(id) ? '<b>Tu</b>' : escapeHtml(v.nome)}</span>
          <span class="bar"><i style="width:${((v.n / turni[0][1].n) * 100).toFixed(0)}%;background:${
            mio(id) ? 'var(--tuo)' : 'var(--ink-soft)'}"></i><em>${v.n}</em></span>
        </div>`).join('') + `<div class="piede"><b class="tuo">${Math.round((mieiTurni / totTurni) * 100)}%</b> dei turni a tuo carico</div>`
      : '<p class="vuoto">Negli ultimi trenta giorni non ha guidato nessuno.</p>'}
    </section>`;

  const cardConti = `
    <section class="card" id="dash-conti">
      <div class="head"><h3>Conti in sospeso</h3></div>
      ${partite.length ? `<div class="conti">${partite.slice(0, CONTI_IN_VISTA).map(p => {
        const n = quantiCon.get(p.id) || 0;
        const da = primaCon.get(p.id);
        // Le voci in ordine di tempo, dalla piu' recente: la contestazione parte
        // quasi sempre dall'ultima cosa successa.
        const voci = [...(vociCon.get(p.id) ?? [])].sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
        return `<div class="conto-blocco">
          <div class="conto">
          <div class="av" style="background:${coloreDi(p.id)}">${escapeHtml(iniziale(nomePer.get(p.id)))}</div>
          <button type="button" class="chi" data-dettaglio="${p.id}" aria-expanded="false" aria-controls="voci-${p.id}">${escapeHtml(nomePer.get(p.id) || 'Qualcuno')}<small>${escapeHtml(plurale(n, 'passaggio', 'passaggi'))}${da ? ` · dal ${escapeHtml(dataBreve(da))}` : ''} · da cosa nasce</small></button>
          <span class="imp ${versoDi(p.v)}">${escapeHtml(firma(p.v))}</span>
          <button type="button" class="salda" data-salda="${p.id}" data-verso="${p.v >= 0 ? 'ricevuto' : 'pagato'}"
                  data-quanto="${Math.abs(p.v).toFixed(2)}"
                  title="${p.v >= 0 ? 'Segna che ti ha pagato' : 'Segna che l\'hai pagato'}">${p.v >= 0 ? 'Ricevuto' : 'Pagato'}</button>
          </div>
          <div class="voci hidden" id="voci-${p.id}">
            ${voci.map(v => `<div class="riga-voce">
              <span class="q">${escapeHtml(dataBreve(v.quando))}</span>
              <span class="t">${escapeHtml(v.testo)}</span>
              <span class="i ${versoDi(v.importo)}">${escapeHtml(firma(v.importo))}</span>
            </div>`).join('')}
            <div class="riga-voce somma">
              <span class="q"></span><span class="t">Totale</span>
              <span class="i ${versoDi(p.v)}">${escapeHtml(firma(p.v))}</span>
            </div>
          </div>
        </div>`;
      }).join('')}</div>
      <div class="piede">${partite.length > CONTI_IN_VISTA ? `<span class="resto">${partite.length - CONTI_IN_VISTA === 1
        ? 'e un altro conto aperto' : `e altri ${partite.length - CONTI_IN_VISTA} conti aperti`}</span>` : ''}<button type="button" class="cta-vuoto" id="salda-tutto">Salda tutto (${partite.length})</button><button type="button" class="cta-vuoto" id="conto-mese">Conto del mese</button></div>`
      : `<p class="vuoto">Nessun conto in sospeso. Compaiono qui quando chi guida indica un «€ a testa».</p>
      <div class="piede">Gli importi li vedete solo tu e la persona interessata.</div>`}
    </section>`;

  const cardAttivita = `
    <section class="card">
      <div class="head"><h3>Attività recente</h3></div>
      ${eventi.length ? eventi.map(e => {
        const chi = nomeCorto(e.attore);
        return `<div class="att">
          <div class="av" style="background:${mio(e.attore) ? 'var(--tuo)' : coloreDi(e.attore)}">${escapeHtml(iniziale(chi))}</div>
          <div class="txt"><b>${escapeHtml(chi)}</b> — ${ETICHETTA_EVENTO[e.tipo] || escapeHtml(e.tipo)}</div>
          <span class="when">${escapeHtml(quandoBreve(e.quando))}</span>
        </div>`;
      }).join('')
      : '<p class="vuoto">Il registro parte da quando è stato acceso: qui comparirà quello che succede da adesso in poi.</p>'}
    </section>`;

  // Erano cinque perche' cinque ne aveva il disegno, ma due — «Guarda lo storico» e
  // «Il tuo profilo» — erano scorciatoie per due voci che stanno **gia'** nella
  // navigazione, a pochi centimetri: lo stesso doppione della voce Profilo nel menu'.
  // Qui restano solo le cose che si **fanno** e che da qui non si potrebbero fare
  // altrimenti. Sono flex, quindi tre riempiono la riga esattamente come cinque.
  const azioni = `<div class="azioni">${AZIONI_RIEPILOGO.map(([icona, testo, azione]) =>
    `<button type="button" class="az" data-azione="${azione}"><span class="o">${iconaSvg(icona)}</span><span class="t">${escapeHtml(testo)}</span></button>`).join('')}</div>`;

  box.innerHTML = testata(oggiInLettere(), true)
    + `<div class="numeri">${numeri}</div>
    <div class="grid">
      ${cardProssimo}
      ${cardCarburante}
      ${cardSettimana}
      ${cardTurni}
      ${cardConti}
      ${cardAttivita}
    </div>
    ${azioni}`;

  // I riquadri portano da qualche parte: nessun bottone qui sopra e' finto.
  box.querySelectorAll('[data-vai="home"]').forEach(b => b.addEventListener('click', () => switchView('home')));

  // ── Segnare un pagamento ────────────────────────────────────────────────
  // La tabella `pagamenti` esiste dalla 022 e il saldo la sottrae gia': mancava solo
  // il gesto, e senza quello il numero poteva solo crescere. L'importo arriva
  // precompilato con quanto resta, perche' nove volte su dieci si salda tutto.
  box.querySelectorAll('[data-salda]').forEach(b => b.addEventListener('click', async () => {
    const altro = b.dataset.salda;
    const ricevuto = b.dataset.verso === 'ricevuto';
    const chi = nomePer.get(altro) || 'questa persona';
    const risposta = await ask(ricevuto ? `Quanto ti ha dato ${chi}?` : `Quanto hai dato a ${chi}?`, {
      text: 'In euro. Puoi segnare anche solo una parte.',
      value: b.dataset.quanto, type: 'number',
    });
    if (risposta === null) return;
    const importo = Math.round(Number(String(risposta).replace(',', '.')) * 100) / 100;
    if (!(importo > 0)) { toast('Serve un importo maggiore di zero.'); return; }
    const { error } = await supabase.from('pagamenti').insert({
      group_id: currentGroupId,
      da_utente: ricevuto ? altro : currentUser.id,
      a_utente: ricevuto ? currentUser.id : altro,
      importo,
      registrato_da: currentUser.id,
    });
    if (error) { toast(friendlyError(error)); return; }
    toast(`Segnato: ${eur(importo)} ${ricevuto ? 'da' : 'a'} ${chi}.`);
    loadStats();
  }));

  // ── C26: da cosa nasce il conto ─────────────────────────────────────────
  // Nessuna interrogazione nuova: le voci sono state contate nello stesso giro
  // che ha prodotto il totale, e stanno gia' in pagina. Qui si scopre e basta —
  // che e' anche il motivo per cui apre istantaneo e funziona senza rete.
  box.querySelectorAll('[data-dettaglio]').forEach(b => b.addEventListener('click', () => {
    const pannello = document.getElementById('voci-' + b.dataset.dettaglio);
    if (!pannello) return;
    b.setAttribute('aria-expanded', String(pannello.classList.toggle('hidden') === false));
  }));

  // ── C25: saldare tutto in un colpo ──────────────────────────────────────
  // N righe in `pagamenti`, **un solo insert**: o passano tutte o non passa
  // nessuna. Con una riga per volta un rifiuto a meta' strada lascerebbe il
  // saldo per aria, cioe' esattamente lo stato che questo bottone deve chiudere.
  document.getElementById('salda-tutto')?.addEventListener('click', async () => {
    if (bloccaSeSospeso('saldare i conti')) return;
    const daPagare = partite.reduce((s, p) => p.v < 0 ? s - p.v : s, 0);
    const daIncassare = partite.reduce((s, p) => p.v > 0 ? s + p.v : s, 0);
    const dettaglio = [
      daPagare > 0 ? `${eur(daPagare)} che paghi tu` : null,
      daIncassare > 0 ? `${eur(daIncassare)} che hai ricevuto` : null,
    ].filter(Boolean).join(' e ');
    if (!await conferma(`Azzerare tutti i conti (${partite.length})?`, {
      testo: `Si registrano ${plurale(partite.length, 'pagamento', 'pagamenti')}: ${dettaglio}. `
        + 'Segnare un pagamento non lo esegue: dice che è già avvenuto.',
      azione: 'Segna tutto saldato',
    })) return;
    const righe = partite.map(p => ({
      group_id: currentGroupId,
      da_utente: p.v >= 0 ? p.id : currentUser.id,
      a_utente: p.v >= 0 ? currentUser.id : p.id,
      importo: Math.round(Math.abs(p.v) * 100) / 100,
      registrato_da: currentUser.id,
      nota: 'Saldo totale',
    }));
    const { error } = await supabase.from('pagamenti').insert(righe);
    if (error) { toast(friendlyError(error)); return; }
    toast(`Conti azzerati: ${plurale(righe.length, 'pagamento registrato', 'pagamenti registrati')}.`);
    loadStats();
  });

  // Il conto del mese: i numeri ci sono gia' tutti, mancava il modo di mandarli.
  document.getElementById('conto-mese')?.addEventListener('click', () => {
    const righe = [`WeTransport · ${nomeComitiva()} · ${meseInLettere(oggi)}`,
      `Carburante diviso questo mese: ${eur(meseCorr.tot)}`,
      `Il mio saldo: ${firma(saldo)}`, ''];
    for (const p of partite) {
      righe.push(p.v >= 0
        ? `${nomePer.get(p.id) || 'Qualcuno'} mi deve ${eur(p.v)}`
        : `Devo ${eur(-p.v)} a ${nomePer.get(p.id) || 'qualcuno'}`);
    }
    condividi(righe.join('\n'));
  });

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
      const tasto = document.getElementById('request-toggle');
      tasto?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      tasto?.focus({ preventScroll: true });
    }
    if (a === 'invita') switchView('groups');
  }));
}

// ── Attrezzi del riepilogo ─────────────────────────────────────────────────

// Le colonne che servono al riepilogo. Stavano scritte dentro la chiamata, su una
// riga lunga il doppio dello schermo: li' nessuno le rileggeva piu'.
const CAMPI_RIEPILOGO = 'id, ride_date, depart_time, origin, destination, seats, driver_id,'
  + ' fuel_per_person, driver:profiles!rides_driver_id_fkey(display_name),'
  + ' seat_claims(passenger_id, ospite_nome, invitato_da,'
  + ' passenger:profiles!seat_claims_passenger_id_fkey(display_name))';

// Il registro degli eventi parla per codici: qui diventano italiano. E' una
// tabella di traduzione, non un calcolo — non ha ragione di rinascere a ogni
// disegno del riepilogo.
const ETICHETTA_EVENTO = {
  passaggio_pubblicato: 'ha pubblicato un passaggio',
  passaggio_annullato: 'ha annullato un passaggio',
  posto_preso: 'ha preso un posto',
  posto_liberato: 'ha liberato un posto',
  membro_entrato: 'è entrato nella comitiva',
  pagamento_registrato: 'ha registrato un pagamento',
};

// Quanti conti si vedono per intero prima della riga «e altri N». Erano due
// perche' due ne entravano nel riquadro alto meta' schermata del quaderno; il
// riquadro adesso e' piu' alto e il terzo ci sta senza spingere niente.
const CONTI_IN_VISTA = 3;

// Le tre cose che si **fanno** dal riepilogo e che da qui non si potrebbero fare
// altrimenti: icona, etichetta, azione.
// Le tre etichette non hanno piu' un `<br>` in mezzo: dove i bottoni stanno in
// riga andrebbe tolto, dove stanno in colonna il testo va a capo da solo.
const AZIONI_RIEPILOGO = [
  ['plus', 'Pubblica un passaggio', 'offerta'],
  ['walk', 'Cerco un passaggio', 'richiesta'],
  ['users', 'Invita un membro', 'invita'],
];

// La riga in cima al riepilogo. La scrivono in tre — la vista buona e i due
// riquadri che dicono cosa manca — e prima erano tre copie della stessa
// marcatura, che divergevano a ogni ritocco.
function testata(sottotitolo, conComitiva = false) {
  // La faccia non sta qui. Ci stava quando la barra in alto la mostrava solo da
  // 768px in su; adesso la barra c'e' sempre e la porta lei, a due centimetri di
  // distanza — due volte la stessa iniziale sullo stesso schermo.
  return `<div class="dash-top">
      <div class="dash-hi"><h1>Riepilogo</h1><p>${escapeHtml(sottotitolo)}</p></div>
      ${conComitiva ? `<span class="dash-gruppo">${escapeHtml(nomeComitiva())}</span>` : ''}
    </div>`;
}

// Uno dei quattro numeri in cima: etichetta, valore, e la riga che lo qualifica.
function tessera(cls, etichetta, valore, nota) {
  return `<div class="k${cls ? ' ' + cls : ''}"><div class="lab">${escapeHtml(etichetta)}</div>`
    + `<div class="val">${escapeHtml(valore)}</div><div class="nota">${escapeHtml(nota)}</div></div>`;
}

// Gli euro con il segno davanti, dal punto di vista di chi guarda: «+ 4,50 €».
// Il ternario con il meno unicode stava scritto a mano in otto punti, e bastava
// dimenticarne uno per avere due modi di dire la stessa cifra nella stessa vista.
const eur = (n) => (Math.round(n * 100) / 100).toLocaleString('it-IT',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const firma = (n) => {
  // Lo zero non ha verso: «+ 0,00 €» dice che sei in credito di niente, che e' una
  // frase che non vuol dire niente. Si arrotonda prima di guardare il segno, o un
  // saldo da mezzo centesimo si prende il piu'.
  const v = Math.round(n * 100) / 100;
  return (v > 0 ? '+ ' : v < 0 ? '− ' : '') + eur(Math.abs(v));
};
const versoDi = (n) => (n >= 0 ? 'avere' : 'dare');

// «1 passaggio», «3 passaggi». Il plurale e' una regola, non un ternario da
// ricopiare quindici volte.
const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

// La lettera dentro il tondo di una persona.
const iniziale = (nome) => (String(nome || '?').trim()[0] || '?').toUpperCase();

const iconaSvg = (id, w = 15) =>
  `<svg width="${w}" height="${w}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// Il tondo colorato accanto a un nome. Deriva dall'id, quindi la stessa persona
// ha lo stesso colore in tutti i riquadri e fra una visita e l'altra — senza
// tenere da nessuna parte una tabella di colori.
// Sei tinte, tutte nella famiglia del viola della palette: cambiano di tinta e di
// luminosita' quel tanto che basta a distinguere sei persone, senza diventare sei
// accenti in un'app che ne ha uno. Sono **scure** perche' sopra ci va il
// quasi-bianco: con il candy blue erano chiare e sopra ci andava l'onyx, ed e' il
// verso che si e' ribaltato insieme all'accento. Un avatar e' un cerchio con due
// lettere dentro: e' testo, e vale la soglia del testo (`npm run contrasto`).
const COLORI_AV = ['oklch(0.50 0.200 300)', 'oklch(0.46 0.165 285)', 'oklch(0.54 0.215 312)',
  'oklch(0.44 0.140 272)', 'oklch(0.52 0.155 328)', 'oklch(0.48 0.105 262)'];
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
  // Scegliere un giorno vuol dire uscire dalla settimana (C37): sono la stessa
  // scelta — quanto lontano si guarda — e due pastiglie accese insieme direbbero
  // che si sta guardando due cose.
  vistaSettimana = false;
  dayToday.classList.toggle('active', date === todayISO());
  dayTomorrow.classList.toggle('active', date === todayISO(1));
  dayPicker.classList.toggle('active', date !== todayISO() && date !== todayISO(1));
  dayWeek.classList.remove('active');
  dayPicker.value = date;
  document.getElementById('week-grid').classList.add('hidden');
  document.querySelector('.day-cta').classList.remove('hidden');
  ridesList.classList.remove('hidden');
  // il canale realtime filtra sul giorno visualizzato: cambiato giorno, ci si riabbona
  if (realtimeChannel) subscribeRealtime();
  loadRides();
}

// ══════════════════════════════════════════════════════════════════════════
// C37 — La settimana.
//
// La Home guarda un giorno per volta, e la domanda della domenica sera e'
// un'altra: «come siamo messi questa settimana». Il riepilogo il conto lo fa
// gia' — `disegnaRiepilogo` calcola i giorni scoperti — ma li' e' un numero in
// una pastiglia, e da un numero non si pubblica. Qui i sette giorni si guardano
// e da un giorno vuoto si parte in un tocco, che e' la cosa che quel numero
// faceva venire voglia di fare senza dare il modo di farla.
// ══════════════════════════════════════════════════════════════════════════
let vistaSettimana = false;
const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
// La settimana comincia di lunedi', come si usa qui. Lo sapevano in tre punti
// diversi con lo stesso `(getDay() + 6) % 7` copiato: adesso lo sa questa riga.
const giornoBreve = (iso) => GIORNI_BREVI[(new Date(iso + 'T12:00:00').getDay() + 6) % 7];

dayWeek.addEventListener('click', () => {
  if (vistaSettimana) { setDate(todayISO()); return; }
  vistaSettimana = true;
  dayToday.classList.remove('active');
  dayTomorrow.classList.remove('active');
  dayPicker.classList.remove('active');
  dayWeek.classList.add('active');
  // Tutto quello che parla del **giorno** sparisce: lasciarlo direbbe che quei
  // numeri riguardano la settimana che si sta guardando, e non e' vero.
  ridesList.classList.add('hidden');
  emptyMessage.classList.add('hidden');
  document.getElementById('day-stats').classList.add('hidden');
  document.getElementById('turn-hint').classList.add('hidden');
  walkersCard.classList.add('hidden');
  offerCard.classList.add('hidden');
  // Anche i due bottoni del giorno, e questo non e' pulizia: «Metti la tua auto»
  // pubblicherebbe per `currentDate`, cioe' per il giorno che si stava guardando
  // prima — mentre a schermo ci sono sette giorni e nessuno di essi e' evidenziato.
  // Nella settimana l'azione e' un'altra ed e' scritta dentro i buchi.
  document.querySelector('.day-cta').classList.add('hidden');
  document.getElementById('week-grid').classList.remove('hidden');
  loadWeek();
});

async function loadWeek() {
  const box = document.getElementById('week-grid');
  if (!currentGroupId) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="skeleton"></div>';
  const inizio = todayISO();
  const fine = addDaysISO(inizio, 6);
  const { data, error } = await supabase
    .from('rides')
    .select('id, ride_date, depart_time, origin, destination, seats, driver_id, ritardo_min, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger_id, ospite_nome)')
    .eq('group_id', currentGroupId)
    .gte('ride_date', inizio).lte('ride_date', fine)
    .order('ride_date', { ascending: true })
    .order('depart_time', { ascending: true, nullsFirst: false });
  if (error) {
    console.error('settimana:', error);
    box.innerHTML = '<p class="empty-hint">La settimana non si è caricata. Riprova, o torna al giorno singolo.</p>';
    return;
  }
  // Solo la comitiva aperta, e di proposito: un passaggio di fuori (C9) e' un'occasione
  // per una persona, non copertura per il gruppo. Contarlo qui direbbe che martedi' e'
  // coperto quando la comitiva martedi' non ha nessuno.
  const perGiorno = new Map();
  for (let i = 0; i < 7; i++) perGiorno.set(addDaysISO(inizio, i), []);
  for (const r of data ?? []) perGiorno.get(r.ride_date)?.push(r);

  box.innerHTML = '';
  for (const [giorno, elenco] of perGiorno) {
    const col = document.createElement('div');
    const scoperto = elenco.length === 0;
    const passato = giorno === inizio && elenco.every(hasDeparted) && elenco.length > 0;
    col.className = 'week-day' + (scoperto ? ' scoperto' : '') + (giorno === inizio ? ' oggi' : '');

    const testa = document.createElement('div');
    testa.className = 'week-testa';
    const gg = new Date(giorno + 'T12:00:00');
    testa.innerHTML = `<b>${giornoBreve(giorno)}</b> <span>${gg.getDate()}</span>`;
    col.appendChild(testa);

    if (scoperto) {
      // Da un giorno vuoto si pubblica in un tocco: e' il criterio del cantiere, ed
      // e' anche l'unica ragione per cui vale la pena guardare i buchi.
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'week-vuoto';
      cta.textContent = 'Nessuno · metti la tua auto';
      cta.addEventListener('click', () => {
        setDate(giorno);
        if (offerCard.classList.contains('hidden')) offerToggle.click();
        offerCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      col.appendChild(cta);
    } else {
      for (const r of elenco) {
        const liberi = r.seats - r.seat_claims.length;
        const riga = document.createElement('button');
        riga.type = 'button';
        riga.className = 'week-auto' + (r.driver_id === currentUser.id ? ' mia' : '') + (liberi === 0 ? ' pieno' : '');
        riga.innerHTML = `<b>${escapeHtml((r.depart_time || '').slice(0, 5) || '—')}</b>`
          + `<span>${escapeHtml(nomeDi(r.driver))}</span>`
          + `<em>${liberi > 0 ? `${liberi} ${liberi === 1 ? 'libero' : 'liberi'}` : 'completo'}</em>`;
        riga.title = `${r.origin || '—'} → ${r.destination || ''}`;
        riga.addEventListener('click', () => setDate(giorno));
        col.appendChild(riga);
      }
      if (passato) col.classList.add('finito');
    }
    box.appendChild(col);
  }

  const piede = document.createElement('p');
  piede.className = 'form-hint week-piede';
  const scoperti = [...perGiorno.values()].filter(v => v.length === 0).length;
  piede.textContent = scoperti === 0
    ? 'Sette giorni tutti coperti.'
    : `${scoperti} ${scoperti === 1 ? 'giorno scoperto' : 'giorni scoperti'} su sette: tocca un giorno vuoto per pubblicare.`;
  box.appendChild(piede);
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
      // La nota di C34 va aggiornata anche qui: i campi sono cambiati senza che
      // nessuno li abbia toccati, quindi nessun evento `input` e' partito.
      proponiQuota();
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
    // C33: quale auto. Il database rifiuta l'auto di un altro (`check_ride`), quindi
    // qui basta dire quale si e' scelta.
    auto_id: document.getElementById('ride-auto').value || null,
  };
  if (base.visibilita === 'zona' && base.origin_lat === null) {
    toast('Per aprire il passaggio a chi è in zona serve "Parto da qui": senza, non lo vedrebbe nessuno.');
    return;
  }
  // ── C36: chi infrange una regola lo vede scritto prima di confermare ────
  // Un avviso, non un rifiuto. Una regola di comitiva e' una convenzione fra amici,
  // e la sera che qualcuno fa un'eccezione deve poterla fare: il database infatti non
  // la fa rispettare (032), e bloccare qui sarebbe rimettere il vincolo dalla parte
  // sbagliata — quella che si aggira cambiando la regola per tutti.
  const regole = regoleGruppo();
  const infrazioni = [];
  if (regole.maxPosti != null && base.seats > regole.maxPosti) {
    infrazioni.push(`la comitiva sta al massimo in ${regole.maxPosti + 1} (tu compreso), e tu offri ${base.seats} posti`);
  }
  if (regole.quota != null && Number(base.fuel_per_person || 0) !== regole.quota) {
    infrazioni.push(base.fuel_per_person
      ? `la quota fissa è ${regole.quota.toFixed(2)} €, tu hai messo ${Number(base.fuel_per_person).toFixed(2)} €`
      : `la quota fissa è ${regole.quota.toFixed(2)} € e tu non ne chiedi nessuna`);
  }
  if (infrazioni.length && !await conferma('Va contro le regole della comitiva', {
    testo: infrazioni.join('; ') + '. Puoi pubblicare lo stesso: le eccezioni si vedono perché sono eccezioni.',
    azione: 'Pubblica lo stesso',
  })) return;

  // C31 — il ritorno, se c'e'. E' la stessa auto che rifa' la strada al contrario:
  // origine e destinazione si scambiano, i posti e la quota restano quelli. Non si
  // ricopiano le coordinate della partenza: il punto misurato e' dove si e' adesso,
  // e alle 13:30 si parte dall'altra parte — un punto sbagliato e' peggio di nessun
  // punto, perche' il navigatore ci porta davvero.
  const oraRitorno = document.getElementById('ride-ritorno').value || null;
  if (oraRitorno && !base.destination) {
    toast('Per il ritorno serve la destinazione: è da lì che si riparte.');
    return;
  }
  const weeks = Number(document.getElementById('ride-repeat').value) || 1;
  let published = 0;
  let ritorni = 0;
  let firstError = null;
  for (let w = 0; w < weeks; w++) {
    const giorno = addDaysISO(currentDate, w * 7);
    // `select().single()` invece di un semplice insert: senza l'id dell'andata il
    // ritorno non ha a cosa legarsi, e due righe scollegate sono lo stato di prima.
    const { data: andata, error } = await supabase.from('rides')
      .insert({ ...base, ride_date: giorno }).select('id').single();
    if (error || !andata) { firstError = firstError ?? error; continue; }
    published++;
    if (!oraRitorno) continue;
    const { error: erroreRitorno } = await supabase.from('rides').insert({
      ...base,
      ride_date: giorno,
      depart_time: oraRitorno,
      origin: base.destination,
      destination: base.origin || 'Ritorno',
      // Il ritorno parte da dove si e' arrivati, non da dove si e' misurato.
      origin_lat: null,
      origin_lon: null,
      // Un ritorno aperto alla zona senza coordinate non lo vedrebbe nessuno (014):
      // resta della comitiva, che e' il default e la cosa che non sorprende.
      visibilita: base.visibilita === 'zona' ? 'gruppo' : base.visibilita,
      ritorno_di: andata.id,
    });
    if (erroreRitorno) { firstError = firstError ?? erroreRitorno; } else { ritorni++; }
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
  // C34: `reset()` svuota il campo ma non questa variabile. Senza, la pubblicazione
  // dopo crederebbe che la cifra scritta a mano sia una vecchia proposta e la
  // sovrascriverebbe.
  quotaProposta = null;
  document.getElementById('ride-quota-nota').textContent = '';
  document.getElementById('ride-posizione').textContent = '';
  offerCard.classList.add('hidden');
  // Il ritorno si conta a parte: se le andate passano e i ritorni no — succede se
  // per quel giorno un ritorno c'era gia' — dirlo e' l'unico modo perche' chi
  // pubblica non scopra sul posto di avere meta' viaggio.
  const quanti = published === 1
    ? 'Auto pubblicata: ora gli amici possono prenotare il posto.'
    : `Auto pubblicata per ${published} settimane.`;
  toast(!oraRitorno ? quanti
    : ritorni === published ? `${quanti} Anche il ritorno delle ${oraRitorno}.`
    : ritorni === 0 ? `${quanti} Il ritorno però non è passato: ne avevi già uno per quel giorno.`
    : `${quanti} Ritorno pubblicato ${ritorni} volte su ${published}.`);
  await clearMyRequest();
  // C32: il trigger ha appena messo in rubrica partenza e destinazione. Ricaricarla
  // qui e' l'unico modo perche' la seconda pubblicazione trovi da scegliere cio' che
  // la prima ha scritto, senza ricaricare la pagina.
  caricaFermate();
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
    // C30: un ritardo annunciato mentre si guarda la scheda deve comparire senza che
    // nessuno ricarichi. E' l'unico caso in cui una riga di `rides` cambia dopo essere
    // stata pubblicata, ed e' il caso in cui i secondi contano.
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `ride_date=eq.${currentDate}` }, () => loadRides(true))
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

function isPastDay() { return currentDate < todayISO(); }

// Messaggi d'errore: i trigger del DB parlano già italiano
function friendlyError(error) {
  if (error.code === 'P0001') return error.message;
  if (error.code === '23505') return 'Operazione già registrata.';
  return 'Errore: ' + error.message;
}

let currentRequests = [];
// La 025 aggiunge `ora` a `ride_requests`. Il codice arriva sul sito appena si fonde,
// la migrazione la applica una persona: fra i due momenti passa del tempo, e in quel
// tempo chiedere una colonna che non c'e' fa fallire **tutto** il caricamento dei
// passaggi, non solo l'ora. Quindi si prova con l'ora, e al primo `42703` si smette di
// chiederla per il resto della sessione. Quando la migrazione c'e', questa riga non fa
// niente e non se ne accorge nessuno.
let requestsConOra = true;
let loadToken = 0;
// Le colonne di `rides` si nominano una per una, e non e' pignoleria (cantiere C21): da
// `016_coordinate_riservate.sql` un client non ha il permesso di leggere origin_lat,
// origin_lon, dest_lat e dest_lon, quindi `select('*')` verrebbe rifiutato in blocco.
// Aggiungendo una colonna a `rides`, va aggiunta anche qui.
const COLONNE_RIDE = 'id, driver_id, ride_date, depart_time, origin, destination, seats, note, created_at, group_id, fuel_per_person, visibilita, ritardo_min, ritorno_di, auto_id';

// C31 — l'altra meta' del viaggio, cercata fra i passaggi gia' in pagina.
// Il legame in `rides` va dal ritorno all'andata, quindi la ricerca e' nei due
// versi: da un ritorno si risale, da un'andata si scende.
let passaggiVisibili = [];
function gemelloDi(ride) {
  if (!ride) return null;
  if (ride.ritorno_di) return passaggiVisibili.find(r => r.id === ride.ritorno_di) ?? null;
  return passaggiVisibili.find(r => r.ritorno_di === ride.id) ?? null;
}

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
  // C37: guardando la settimana, «ricarica i passaggi» vuol dire ricaricare quella.
  // Senza questa riga il realtime riempirebbe una lista nascosta e `updateDayCta`
  // rimetterebbe in pagina i bottoni del giorno sopra la griglia dei sette.
  if (vistaSettimana) { loadWeek(); return; }
  const token = ++loadToken;
  if (!silent) {
    ridesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    emptyMessage.classList.add('hidden');
  }
  let query = supabase
    .from('rides')
    .select(`${COLONNE_RIDE}, driver:profiles!rides_driver_id_fkey(display_name, avatar_url), seat_claims(seat_index, passenger_id, ospite_nome, invitato_da, passenger:profiles!seat_claims_passenger_id_fkey(display_name, avatar_url)), ride_comments(count), ride_waitlist(user_id, created_at, profile:profiles(display_name)), auto(nome, modello, colore)`)
    .eq('ride_date', currentDate)
    .order('depart_time', { ascending: true, nullsFirst: false });
  // Niente piu' filtro sul gruppo qui: da C9 la policy fa uscire anche i passaggi aperti
  // alla zona o a chiunque, e filtrarli di nuovo nel client li rimetterebbe dentro la
  // comitiva. Quali siano "di fuori" lo dice group_id al momento di disegnarli.

  let reqQuery = supabase
    .from('ride_requests')
    .select(requestsConOra ? 'user_id, ora, profile:profiles(display_name)' : 'user_id, profile:profiles(display_name)')
    .eq('ride_date', currentDate);
  reqQuery = reqQuery.eq('group_id', currentGroupId);

  let [{ data, error }, { data: reqs, error: erroreReq }] = await Promise.all([query, reqQuery]);
  // Stessa ragione di `requestsConOra`: senza la 025 questa interrogazione fallisce e le
  // richieste sparirebbero **in silenzio**, perche' vivono in una query separata e nessuno
  // ne guarda l'errore. Si riprova una volta sola, senza la colonna.
  if (erroreReq?.code === '42703') {
    requestsConOra = false;
    ({ data: reqs } = await supabase
      .from('ride_requests')
      .select('user_id, profile:profiles(display_name)')
      .eq('ride_date', currentDate)
      .eq('group_id', currentGroupId));
  }
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
    ? `Nelle ultime quattro settimane hai guidato ${lazyN === 0 ? 'zero volte' : `solo ${lazyN} ${lazyN === 1 ? 'volta' : 'volte'}`}: tocca a te metterci l'auto.`
    : `${escapeHtml(lazyName)} ha guidato ${lazyN === 0 ? 'zero volte' : `solo ${lazyN} ${lazyN === 1 ? 'volta' : 'volte'}`} nelle ultime quattro settimane.`;
  el.classList.remove('hidden');
}

// Bottoni del giorno: nascosti nei giorni passati; "Cerco un passaggio" contestuale
function updateDayCta(rides) {
  const past = isPastDay();
  // `sospeso` va rimesso qui e non solo in applicaSospensione(): questa riga gira a ogni
  // caricamento dei passaggi e senza il controllo rimetterebbe il pulsante "pubblica" a
  // chi e' sospeso, che poi si prenderebbe un errore dal database.
  // C38: in una comitiva chiusa il database rifiuta comunque (033), ma un bottone che
  // porta dritto a un errore e' peggio di un bottone che non c'e'. Stessa forma della
  // riga qui sopra su `sospeso`.
  const chiusa = comitivaChiusa();
  offerToggle.classList.toggle('hidden', past || sospeso || chiusa);
  if (past || sospeso || chiusa) offerCard.classList.add('hidden');
  const reqBtn = document.getElementById('request-toggle');
  const iDrive = rides.some(r => r.driver_id === currentUser.id);
  const iSit = rides.some(r => r.seat_claims.some(mioPosto));
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
    // Una domanda sola, e si puo' saltare. Chi guida senza l'ora sa **che** qualcuno e'
    // a piedi ma non se il passaggio che sta per pubblicare gli serve davvero: era
    // l'unica cosa che mancava perche' la richiesta valesse qualcosa.
    const ora = await ask('A che ora ti serve?', {
      text: 'Facoltativo. Lascia vuoto se ti va bene qualsiasi ora.',
      placeholder: '07:40', type: 'time',
    });
    if (ora === null) return;
    const riga = { user_id: currentUser.id, ride_date: currentDate, group_id: currentGroupId };
    if (requestsConOra && ora) riga.ora = ora;
    let { error } = await supabase.from('ride_requests').insert(riga);
    if (error?.code === '42703') {            // 025 non ancora applicata
      requestsConOra = false;
      delete riga.ora;
      ({ error } = await supabase.from('ride_requests').insert(riga));
    }
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
    // Un ospite non e' un membro: non compare fra chi e' «ancora senza passaggio»,
    // e chi lo ha portato ci compare solo se non ha un posto suo.
    for (const c of r.seat_claims) if (c.passenger_id) seated.add(c.passenger_id);
  }
  const requesters = new Map(currentRequests.map(r => [r.user_id, r.ora || null]));

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
  const guidoIoOggi = rides.some(r => r.driver_id === currentUser.id);
  walkersCard.classList.toggle('hidden', walkers.length === 0);
  walkersList.innerHTML = '';
  const seen = new Set();
  for (const w of walkers) {
    if (seen.has(w.user_id)) continue;
    seen.add(w.user_id);
    const wants = requesters.has(w.user_id);
    const ora = requesters.get(w.user_id);
    const suo = w.user_id === currentUser.id;

    // Per chi cerca un passaggio la pastiglia diventa un bottone: apre il modulo
    // dell'auto gia' aperto e con la sua ora dentro. Prima il verso funzionava in un
    // senso solo — qualcuno pubblica, gli altri prenotano — e chi restava a piedi
    // poteva solo aspettare che a qualcuno venisse in mente.
    const offribile = wants && !suo && !guidoIoOggi && !isPastDay() && !sospeso;
    const chip = document.createElement(offribile ? 'button' : 'span');
    if (offribile) chip.type = 'button';
    chip.className = 'walker-chip' + (wants ? ' request' : '') + (offribile ? ' offribile' : '');
    chip.textContent = nomeDi(w.profile)
      + (suo ? ' (tu)' : '')
      + (wants ? (ora ? ` · cerca per le ${ora.slice(0, 5)}` : ' · cerca un passaggio') : '');
    if (offribile) {
      chip.title = `Metti la tua auto${ora ? ' per le ' + ora.slice(0, 5) : ''}`;
      chip.addEventListener('click', () => {
        if (offerCard.classList.contains('hidden')) offerToggle.click();
        if (ora) document.getElementById('ride-time').value = ora.slice(0, 5);
        offerCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
        document.getElementById('ride-destination').focus();
      });
    }
    walkersList.appendChild(chip);
  }
}

// --- Macchina SVG ---
//
// **Le proporzioni sono quelle di un'auto, e prima non lo erano.** La scocca era
// un rettangolo 170x230 con gli spigoli arrotondati a 46: cioe' larga quanto due
// terzi della sua lunghezza (un'auto vera sta a uno a due e mezzo) e con le due
// estremita' quasi semicircolari. Vista dall'alto non era un'auto, era una
// capsula. E dentro quella larghezza tre sedili da 44 in fila si toccavano.
//
// Adesso il rapporto e' 114 di larghezza per 282 di lunghezza — **1 : 2,47**, che
// e' quello di un'utilitaria vera (1,75 m per 4,3 m) — la sagoma e' un tracciato
// con il muso che si stringe e la coda che si chiude, e i sedili sono piu' stretti
// e piu' alti, come sono i sedili. Quelli di dietro sono piu' stretti di quelli
// davanti perche' e' cosi' anche in macchina: dietro e' una panchina divisa in
// tre, davanti sono due poltrone.
//
// Le file sono equidistanti: 122, 210, 298, cioe' 88 di passo, e fra il fondo di
// una fila e la cima della successiva restano 33px di pavimento.
const PASSO_FILA = 88;
const ROW_FRONT = 122, ROW_BACK = ROW_FRONT + PASSO_FILA, ROW_THIRD = ROW_BACK + PASSO_FILA;

// La geometria della scocca. Tutto quello che sta a destra si RICAVA da quello che
// sta a sinistra: scrivere le due coordinate a mano e' esattamente il modo in cui
// le ruote sono finite fuori di 4px, con quelle di sinistra tagliate dal bordo.
const CAR_W = 150;                          // larghezza del viewBox
const CAR_INSET = 18;                       // margine della scocca dal viewBox
const CAR_MID = CAR_W / 2;
const specchia = (x, w) => CAR_W - x - w;   // riflette un rettangolo sull'asse
// Larghezza di un sedile: poltrona davanti, posto di panchina dietro.
const W_AVANTI = 40, W_DIETRO = 34;
const DRIVER_POS = { x: 44, y: ROW_FRONT, w: W_AVANTI };
const SEAT_LAYOUTS = {
  1: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI } },
  2: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI }, 4: { x: CAR_MID, y: ROW_BACK, w: W_AVANTI } },
  3: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 52, y: ROW_BACK, w: W_AVANTI }, 4: { x: 98, y: ROW_BACK, w: W_AVANTI } },
  4: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO } },
  5: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO }, 6: { x: CAR_MID, y: ROW_THIRD, w: W_AVANTI } },
  6: { 1: { x: 106, y: ROW_FRONT, w: W_AVANTI }, 2: { x: 38, y: ROW_BACK, w: W_DIETRO }, 3: { x: CAR_MID, y: ROW_BACK, w: W_DIETRO }, 4: { x: 112, y: ROW_BACK, w: W_DIETRO }, 5: { x: 52, y: ROW_THIRD, w: W_AVANTI }, 6: { x: 98, y: ROW_THIRD, w: W_AVANTI } },
};

// La sagoma, ricavata dall'altezza. Un `path` e non un `rect` con il raggio
// grande, perche' e' il raggio grande a fare la capsula — e nessun valore di `rx`
// fa un muso.
//
// **Il muso e' schiacciato, non a punta**: fra x=56 e x=94 la linea in cima e'
// dritta, cioe' 38px di frontale piatto dove stanno i fari. Un'auto vista
// dall'alto ha un frontale, non una prua; con il muso appuntito la sagoma
// tornava a somigliare a una capsula pur avendo le proporzioni giuste.
function sagomaAuto(H) {
  return `M 56 10
    C 40 12 30 26 25 48 C 20 68 ${CAR_INSET} 88 ${CAR_INSET} 108
    L ${CAR_INSET} ${H - 100}
    C ${CAR_INSET} ${H - 70} 20 ${H - 40} 26 ${H - 24}
    C 31 ${H - 12} 42 ${H - 6} 60 ${H - 5}
    L 90 ${H - 5}
    C 108 ${H - 6} 119 ${H - 12} 124 ${H - 24}
    C 130 ${H - 40} 132 ${H - 70} 132 ${H - 100}
    L 132 108
    C 132 88 130 68 125 48 C 120 26 110 12 94 10 Z`;
}

// ── Le finiture della carrozzeria ──────────────────────────────────────────
// Passaruota, battistrada, fari, linee delle porte, pieghe dei fianchi. Prese
// dal riferimento che mi e' stato dato — che pero' e' un'auto **di profilo**, e
// di profilo un sedile non si puo' toccare: qui la vista resta dall'alto e di
// quel disegno si prende il vocabolario, non l'inquadratura. Stessa ragione per
// cui i fari sono viola e non ciano al neon: i colori dell'app sono quelli della
// palette, e nessuno di piu'.
//
// Tutto quello che sta a destra si ricava da quello che sta a sinistra.
function finitureAuto(svg, H, righe) {
  // **Le ruote entrano nella scocca di tre pixel.** Tangenti al fianco — com'erano
  // — si leggevano come quattro pastiglie appoggiate accanto all'auto invece che
  // come ruote dentro il loro passaruota. Tre pixel bastano, e sono la differenza
  // fra un mezzo e un disegno di un mezzo.
  const RUOTA_W = 13, RUOTA_H = 46, RUOTA_X = 8, RUOTA_DAL_BORDO = 54;
  const ruoteY = [RUOTA_DAL_BORDO, H - RUOTA_DAL_BORDO - RUOTA_H];

  // Il passaruota: l'arco che chiude la ruota sopra e sotto. Un riempimento non
  // si vedrebbe (il fondo della scheda e' gia' l'onyx), quindi e' un contorno.
  for (const ry of ruoteY) {
    for (const ax of [RUOTA_X - 3, specchia(RUOTA_X - 3, RUOTA_W + 6)]) {
      svg.appendChild(svgEl('rect', {
        x: ax, y: ry - 4, width: RUOTA_W + 6, height: RUOTA_H + 8, rx: 9, class: 'car-passaruota',
      }));
    }
  }
  for (const ry of ruoteY) {
    for (const rx of [RUOTA_X, specchia(RUOTA_X, RUOTA_W)]) {
      svg.appendChild(svgEl('rect', { x: rx, y: ry, width: RUOTA_W, height: RUOTA_H, rx: 6, class: 'car-wheel' }));
      // Il battistrada: tre solchi. E' quello che distingue una ruota da una
      // pastiglia grigia, e a questa scala e' l'unico dettaglio che si vede.
      for (const d of [12, 23, 34]) {
        svg.appendChild(svgEl('path', {
          d: `M ${rx + 2} ${ry + d} L ${rx + RUOTA_W - 2} ${ry + d}`, class: 'car-battistrada',
        }));
      }
    }
  }

  // I paraurti: la fascia piu' scura all'estremita'. Senza, muso e coda sono due
  // superfici chiare e vuote, e l'auto sembra un guscio invece di un mezzo.
  svg.appendChild(svgEl('rect', { x: 40, y: 12, width: 70, height: 22, rx: 11, class: 'car-paraurti' }));
  svg.appendChild(svgEl('rect', { x: 36, y: H - 34, width: 78, height: 24, rx: 12, class: 'car-paraurti' }));

  // Cofano e baule: la riga dove la lamiera piatta finisce e comincia il vetro.
  // Sono le due che dividono l'auto nelle sue tre parti — muso, abitacolo, coda —
  // e senza di loro il muso e' solo spazio vuoto sopra il parabrezza.
  svg.appendChild(svgEl('path', { d: 'M 30 60 Q 75 54 120 60', class: 'car-cofano' }));
  svg.appendChild(svgEl('path', { d: `M 32 ${H - 68} Q 75 ${H - 62} 118 ${H - 68}`, class: 'car-cofano' }));

  // I fari: incassati nel frontale, non appoggiati sopra. E' l'unico punto in cui
  // la carrozzeria porta il colore dell'app: dicono da che parte guarda l'auto,
  // cioe' dove sta chi guida, cioe' da dove si comincia a leggere.
  for (const fx of [36, specchia(36, 20)]) {
    svg.appendChild(svgEl('rect', { x: fx, y: 22, width: 20, height: 8, rx: 3, class: 'car-faro' }));
  }
  // La presa d'aria fra i due fari: una riga, e il muso ha una faccia.
  svg.appendChild(svgEl('path', { d: 'M 62 26 L 88 26', class: 'car-griglia' }));
  // I fanali dietro: contorno e basta. Pieni sarebbero il rosso dell'errore su
  // una cosa che non e' un errore.
  for (const fx of [34, specchia(34, 22)]) {
    svg.appendChild(svgEl('rect', { x: fx, y: H - 28, width: 22, height: 8, rx: 3, class: 'car-fanale' }));
  }

  // Le porte, e sono la ragione per cui una scocca vista dall'alto si legge come
  // una scocca: una riga corta sul fianco all'altezza di ogni fila.
  const porte = [ROW_FRONT - 22, ROW_BACK - 22];
  if (righe > 2) porte.push(ROW_THIRD - 22);
  for (const py of porte) {
    svg.appendChild(svgEl('path', { d: `M ${CAR_INSET} ${py} L ${CAR_INSET + 13} ${py}`, class: 'car-porta' }));
    svg.appendChild(svgEl('path', { d: `M ${CAR_W - CAR_INSET - 13} ${py} L ${CAR_W - CAR_INSET} ${py}`, class: 'car-porta' }));
  }

  // Il vano dell'abitacolo: dove il tetto e' tagliato via per far vedere i sedili.
  // Senza questo contorno, muso, abitacolo e coda sono la stessa superficie nera e
  // i sedili sembrano appoggiati sopra la lamiera invece che dentro l'auto.
  svg.appendChild(svgEl('rect', {
    x: 22, y: 62, width: CAR_W - 44, height: H - 62 - 46, rx: 16, class: 'car-abitacolo',
  }));

  // Le due pieghe dei fianchi: danno spessore alla lamiera, come la `body-line`
  // del riferimento.
  const y1 = ROW_FRONT - 30, y2 = H - 76;
  for (const px of [25, CAR_W - 25]) {
    svg.appendChild(svgEl('path', { d: `M ${px} ${y1} L ${px} ${y2}`, class: 'car-piega-scocca' }));
  }

  // Gli specchietti, alla stessa altezza del parabrezza.
  const SPECCHIO_W = 16;
  for (const mx of [0, specchia(0, SPECCHIO_W)]) {
    svg.appendChild(svgEl('rect', { x: mx, y: 70, width: SPECCHIO_W, height: 6, rx: 3, class: 'car-wheel' }));
  }
}

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
  // Altezza della scocca: l'ultima fila piu' il lunotto piu' il baule. Non un
  // numero tondo scelto a occhio — 310 sono i 237 dove finisce la seconda fila
  // piu' i 73 che servono a lunotto e coda; con tre file la scocca cresce di un
  // passo di fila esatto.
  const H = isLong ? 310 + PASSO_FILA : 310;
  const svg = svgEl('svg', { viewBox: `0 0 ${CAR_W} ${H}`, class: 'car-svg', role: 'img' });
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
  svg.appendChild(svgEl('ellipse', { cx: CAR_MID, cy: H - 4, rx: 56, ry: 6, class: 'car-ombra' }));

  svg.appendChild(svgEl('path', { d: sagomaAuto(H), class: 'car-body', fill: `url(#lamiera-${uid})` }));
  // Il filo di luce sul bordo alto: un pixel, ed e' quello che da' lo spessore.
  svg.appendChild(svgEl('path', { d: `M 58 11 Q ${CAR_MID} 11 92 11`, class: 'car-luce' }));
  // Parabrezza e lunotto. Il parabrezza sta fra il cofano e la prima fila; il
  // lunotto fra l'ultima fila e la coda.
  svg.appendChild(svgEl('rect', { x: 32, y: 66, width: 86, height: 20, rx: 7, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  // Riflesso sul parabrezza: una striscia sola, di sbieco.
  svg.appendChild(svgEl('path', { d: 'M 40 84 L 56 68 L 70 68 L 54 84 Z', class: 'car-riflesso' }));
  svg.appendChild(svgEl('rect', { x: 34, y: H - 62, width: 82, height: 16, rx: 6, class: 'car-glass', fill: `url(#vetro-${uid})` }));
  finitureAuto(svg, H, isLong ? 3 : 2);

  const claims = new Map(ride.seat_claims.map(c => [c.seat_index, c]));
  const myClaim = ride.seat_claims.find(mioPosto);
  const isDriver = ride.driver_id === currentUser.id;
  const past = isPastDay() || hasDeparted(ride);

  drawSeat(svg, DRIVER_POS, { kind: 'driver', label: initials(nomeDi(ride.driver)), name: nomeDi(ride.driver), avatar: ride.driver?.avatar_url ?? null });
  svg.appendChild(svgEl('circle', { cx: DRIVER_POS.x, cy: DRIVER_POS.y - 36, r: 7, class: 'car-wheel-steer' }));

  const layout = SEAT_LAYOUTS[ride.seats];
  for (const idx of Object.keys(layout).map(Number)) {
    const claim = claims.get(idx);
    const pos = layout[idx];
    if (claim) {
      const mine = mioPosto(claim);
      // Il posto di un ospite lo libera anche chi ce l'ha portato: e' la policy di
      // 031, e senza questo ramo un ospite messo per sbaglio resterebbe li' finche'
      // il guidatore non se ne accorge.
      const mioOspite = claim.invitato_da === currentUser.id;
      const nome = nomeOccupante(claim);
      const seat = drawSeat(svg, pos, {
        kind: mine ? 'mine' : 'taken',
        label: initials(nome),
        name: claim.passenger_id ? nome : `${nome} · ospite`,
        avatar: claim.passenger?.avatar_url ?? null,
        clickable: !past && (mine || mioOspite || isDriver || isAdmin),
      });
      if (!past && (mine || mioOspite || isDriver || isAdmin)) {
        seat.addEventListener('click', () => releaseSeat(ride, claim, mine));
      }
    } else {
      // Con un posto gia' preso resta possibile aggiungere un ospite: e' tutto il
      // senso di C35, e chi ha gia' il suo sedile e' proprio la persona che porta
      // qualcuno. Chi guida puo' farlo anche lui — e' la sua auto.
      const canClaim = !past && !isDriver && !myClaim;
      const canOspite = !past && !sospeso && (isDriver || Boolean(myClaim));
      const seat = drawSeat(svg, pos, {
        kind: 'free', label: '+',
        name: canOspite && !canClaim ? 'Posto libero: aggiungi un ospite' : 'Posto libero',
        clickable: canClaim || canOspite,
      });
      if (canClaim) seat.addEventListener('click', () => claimSeat(ride, idx));
      else if (canOspite) seat.addEventListener('click', () => aggiungiOspite(ride, idx));
    }
  }
  return svg;
}

let avatarClipId = 0;
let carGradId = 0;
// Un sedile e' piu' alto che largo, come i sedili: 42 di seduta contro 34-40 di
// larghezza. Prima erano 44 per 40, cioe' quadrati, e tre quadrati in fila si
// leggevano come una griglia invece che come una panchina.
function drawSeat(svg, pos, { kind, label, name, avatar = null, clickable = false }) {
  const w = pos.w ?? W_AVANTI;
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  g.appendChild(svgEl('rect', { x: pos.x - (w - 4) / 2, y: pos.y - 28, width: w - 4, height: 13, rx: 5, class: 'seat-back' }));
  g.appendChild(svgEl('rect', { x: pos.x - w / 2, y: pos.y - 15, width: w, height: 42, rx: 9, class: 'seat-base' }));
  // La piega del cuscino: e' quella che fa leggere il sedile come imbottitura.
  g.appendChild(svgEl('path', { d: `M ${pos.x - (w / 2 - 7)} ${pos.y - 5} L ${pos.x + (w / 2 - 7)} ${pos.y - 5}`, class: 'seat-piega' }));
  if (avatar) {
    // Il tondo della foto non puo' sfondare il sedile piu' stretto.
    const r = Math.min(15, w / 2 - 3);
    const clipId = 'seat-av-' + (++avatarClipId);
    const clip = svgEl('clipPath', { id: clipId });
    clip.appendChild(svgEl('circle', { cx: pos.x, cy: pos.y + 6, r }));
    svg.appendChild(clip);
    const img = svgEl('image', {
      x: pos.x - r, y: pos.y + 6 - r, width: r * 2, height: r * 2,
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
    loadRides();
    return;
  }
  toast('Posto prenotato: sei a bordo.');
  await clearMyRequest();
  await proponiGemello(ride);
  loadRides();
}

// C31 — preso il posto all'andata, la domanda successiva e' sempre la stessa.
// Si chiede invece di farlo da soli: prenotare per conto di qualcuno e' la cosa
// che poi si scopre di aver fatto, e un posto occupato per sbaglio lo perde
// qualcun altro. Si chiede **una volta** e la risposta e' un tocco.
async function proponiGemello(ride) {
  const g = gemelloDi(ride);
  if (!g) return;
  if (g.seat_claims.some(mioPosto)) return;
  if (g.driver_id === currentUser.id) return;
  const occupati = new Set(g.seat_claims.map(c => c.seat_index));
  const libero = [...Array(g.seats).keys()].map(i => i + 1).find(i => !occupati.has(i));
  if (!libero) return;
  const versoCasa = Boolean(ride.ritorno_di) === false;
  if (!await conferma(versoCasa ? 'Prendi anche il ritorno?' : 'Prendi anche l\'andata?', {
    testo: `${g.origin || '—'} → ${g.destination || ''}`
      + (g.depart_time ? ` alle ${g.depart_time.slice(0, 5)}` : '')
      + `, con ${nomeDi(g.driver)}. È l'altra metà dello stesso viaggio.`,
    azione: 'Sì, prendo il posto',
  })) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: g.id, seat_index: libero, passenger_id: currentUser.id,
  });
  if (error) { toast(friendlyError(error)); return; }
  toast(versoCasa ? 'Preso anche il ritorno.' : 'Presa anche l\'andata.');
}

// --- C35: il posto per un ospite ---
// Un sedile con un nome libero invece di un `user_id`. Il database sa gia' dire di
// no a tutto il resto (031): che chi invita sia della comitiva, che non ci siano due
// ospiti con lo stesso nome, che un sospeso o un bloccato non passino. Qui si chiede
// il nome e si scrive.
async function aggiungiOspite(ride, seatIndex) {
  if (bloccaSeSospeso('portare un ospite')) return;
  const nome = await ask('Chi porti?', {
    text: 'Il nome di chi sale senza avere l\'app. Il posto risulta occupato a tutti, e la sua quota finisce nel tuo conto — non in uno suo, che non esiste.',
    placeholder: 'Enrico',
  });
  if (!nome) return;
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: ride.id, seat_index: seatIndex,
    ospite_nome: nome.trim().slice(0, 40), invitato_da: currentUser.id,
  });
  if (error) {
    toast(error.code === '23505' ? 'Posto già occupato.' : friendlyError(error));
  } else {
    toast(`${nome.trim()} è a bordo come tuo ospite.`);
  }
  loadRides();
}

// --- C30: annunciare un ritardo ---
// Zero non e' un ritardo di zero minuti: e' «ho sbagliato, sono in orario». Il
// database tiene `null` per quello, cosi' il vincolo resta «da 1 a 180» e non
// esiste una seconda maniera di dire la stessa cosa.
async function annunciaRitardo(ride) {
  if (bloccaSeSospeso('annunciare un ritardo')) return;
  const risposta = await ask('Di quanto sei in ritardo?', {
    text: ride.ritardo_min > 0
      ? `Adesso dice ${ride.ritardo_min} minuti. Scrivi 0 per dire che sei di nuovo in orario.`
      : 'Chi ha un posto sulla tua auto lo vede subito, senza ricaricare.',
    value: String(ride.ritardo_min || ''), placeholder: '10', type: 'number',
    scelte: [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']],
  });
  if (risposta === null) return;
  const minuti = Math.round(Number(String(risposta).replace(',', '.')));
  if (!Number.isFinite(minuti) || minuti < 0 || minuti > 180) {
    toast('Da 1 a 180 minuti, oppure 0 per dire che sei in orario.');
    return;
  }
  const { error } = await supabase.from('rides')
    .update({ ritardo_min: minuti || null, ritardo_alle: minuti ? new Date().toISOString() : null })
    .eq('id', ride.id);
  if (error) { toast(friendlyError(error)); return; }
  toast(minuti
    ? `Annunciato: ${minuti} minuti di ritardo, si parte verso le ${oraPiu(ride.depart_time || '00:00', minuti)}.`
    : 'Ritardo tolto: risulti di nuovo in orario.');
  loadRides(true);
}

async function releaseSeat(ride, claim, mine) {
  // Tre casi e non due: il proprio posto, quello di una persona, quello di un
  // proprio ospite. Il terzo non e' il secondo con un nome diverso — «non riceve un
  // avviso» sarebbe una frase senza senso per chi non ha l'app.
  const ospite = !claim.passenger_id;
  const nome = nomeOccupante(claim);
  const titolo = mine ? 'Scendere da questa auto?' : `Liberare il posto di ${nome}?`;
  if (!await conferma(titolo, {
    testo: mine
      ? 'Il posto torna libero e chiunque della comitiva può prenderlo.'
      : ospite
        ? `Il posto torna libero e la quota di ${nome} esce dal conto di chi lo ha portato.`
        : 'Il posto torna libero e chiunque della comitiva può prenderlo. Chi ci stava non riceve un avviso.',
    azione: mine ? 'Scendi' : 'Libera il posto',
  })) return;
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
  // C31: `gemelloDi()` cerca qui dentro. Va assegnato prima di disegnare, perche'
  // le schede lo interrogano mentre si costruiscono.
  passaggiVisibili = rides;

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
        lines.push(`${nomeDi(r.driver)} → ${r.destination}`
          + (r.depart_time ? ` (ore ${r.depart_time.slice(0, 5)})` : ''));
        lines.push('A bordo: ' + (r.seat_claims.map(nomeOccupante).join(', ') || 'nessuno'));
        lines.push(freeN > 0 ? `Liberi: ${freeN} → prenota su ${SITE_URL}` : 'Al completo');
      }
      condividi(lines.join('\n'));
    });
    statsEl.appendChild(shareDay);
  }
  for (const [idx, ride] of rides.entries()) {
    const card = document.createElement('article');
    card.className = 'ride-card' + (ride.driver_id === currentUser.id ? ' mia' : '');
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
    // C33: che auto cercare. Sta accanto a chi guida e non fra le pastiglie in
    // fondo, perche' risponde alla stessa domanda — «chi passa a prendermi» — e
    // perche' si legge nel momento in cui si guarda la strada, non la scheda.
    const targa = ride.auto ? descriviAuto(ride.auto) : null;
    drv.textContent = `Guida ${nomeDi(ride.driver)}` + (targa ? ` · ${targa}` : '');
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
    share.addEventListener('click', () => condividi(shareText, SITE_URL));
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
        // C28: l'avviso si accoda comunque (026), ma arriva sul telefono solo con le
        // chiavi delle notifiche in piedi. Prometterlo quando non puo' partire sarebbe
        // la stessa mezza verita' di un test che si salta da solo.
        if (!await conferma('Annullare il passaggio?', {
          testo: notifichePossibili()
            ? 'Chi aveva un posto sopra questa auto lo perde. Riceve un avviso, e lo riceve anche chi era in lista d\'attesa.'
            : 'Chi aveva un posto sopra questa auto lo perde, e per oggi resta a piedi.',
          azione: 'Annulla il passaggio',
          pericolo: true,
        })) return;
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
        chip.className = 'history-chip' + (mioPosto(c) ? ' driver' : '');
        chip.textContent = nomeOccupante(c) + (c.passenger_id ? '' : ' · ospite');
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
    } else if (ride.seat_claims.some(mioPosto)) {
      const meBadge = document.createElement('span');
      meBadge.className = 'place-badge mine';
      meBadge.textContent = 'Sei a bordo';
      foot.appendChild(meBadge);
    }
    if (ride.depart_time && currentDate === todayISO()) {
      const [h, m] = ride.depart_time.split(':').map(Number);
      const now = new Date();
      // C30: annunciato un ritardo, il conto alla rovescia deve contare verso l'ora
      // vera. Lasciarlo sull'ora pubblicata direbbe «Partita» a un'auto che sta
      // ancora arrivando, cioe' la cosa esattamente sbagliata da dire a chi aspetta.
      const mins = h * 60 + m + (ride.ritardo_min || 0) - (now.getHours() * 60 + now.getMinutes());
      const t = document.createElement('span');
      t.className = 'place-badge' + (mins > 0 && mins <= 60 ? ' mine' : '');
      t.textContent = mins <= 0 ? 'Partita'
        : mins < 60 ? `Parte tra ${mins} min`
        : `Parte tra ${Math.floor(mins / 60)} h ${mins % 60} min`;
      foot.appendChild(t);
    }
    // C31: le due meta' si riconoscono a colpo d'occhio. Il legame si dice sulla
    // scheda e non in una vista a parte, perche' la domanda («e per tornare?»)
    // nasce guardando l'andata.
    const gemello = gemelloDi(ride);
    if (gemello) {
      const par = document.createElement('span');
      par.className = 'place-badge coppia';
      par.textContent = ride.ritorno_di
        ? `Ritorno · andata alle ${(gemello.depart_time || '').slice(0, 5) || '—'}`
        : `Andata · ritorno alle ${(gemello.depart_time || '').slice(0, 5) || '—'}`;
      par.title = 'Andata e ritorno dello stesso viaggio: puoi prenderli entrambi.';
      foot.appendChild(par);
    }
    // Il ritardo si vede a tutti, sempre: chi apre l'app in quel momento deve
    // trovarlo scritto, non dedurlo dal conto alla rovescia.
    if (ride.ritardo_min > 0) {
      const rit = document.createElement('span');
      rit.className = 'place-badge ritardo';
      rit.textContent = `In ritardo di ${ride.ritardo_min} min`
        + (ride.depart_time ? ` · verso le ${oraPiu(ride.depart_time, ride.ritardo_min)}` : '');
      foot.appendChild(rit);
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

    // ── C30: «sono in ritardo» ───────────────────────────────────────────
    // Solo a chi guida e solo il giorno stesso: annunciare un ritardo per
    // dopodomani non vuol dire niente, e il bottone in piu' su ogni scheda
    // renderebbe illeggibili le altre azioni. La cifra si sceglie da un elenco
    // corto invece che scriverla, perche' si preme col telefono in mano mentre
    // si esce di casa in ritardo — che e' l'unico momento in cui serve.
    if (ride.driver_id === currentUser.id && ride.ride_date === todayISO() && !sospeso) {
      const rBtn = document.createElement('button');
      rBtn.className = 'btn btn-ghost btn-small';
      rBtn.textContent = ride.ritardo_min > 0 ? `In ritardo di ${ride.ritardo_min} min · cambia` : 'Sono in ritardo';
      rBtn.addEventListener('click', () => annunciaRitardo(ride));
      card.appendChild(rBtn);
    }

    // Lista d'attesa: quando l'auto è piena ci si mette in coda,
    // il primo in lista prende il posto appena qualcuno scende (trigger DB)
    const waitlist = [...(ride.ride_waitlist ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const ridePast = isPastDay() || hasDeparted(ride);
    const imAboard = ride.seat_claims.some(mioPosto);
    const imWaiting = waitlist.some(w => w.user_id === currentUser.id);
    if (waitlist.length > 0) {
      const wl = document.createElement('div');
      wl.className = 'ride-sub waitlist-row';
      wl.textContent = 'In attesa: ' + waitlist.map((w, i) =>
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
