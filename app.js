import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SITE_URL = 'https://posti-app.netlify.app';

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
let isAdmin = false;
let currentDate = todayISO();
let myGroups = [];
let currentGroupId = null; // null = Tutti
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
    || currentUser.email.split('@')[0];
  const { data } = await supabase.from('profiles').select('display_name, is_admin').eq('id', currentUser.id).maybeSingle();
  if (data) { myName = data.display_name; isAdmin = !!data.is_admin; return; }
  await supabase.from('profiles').insert({ id: currentUser.id, display_name: fallback });
  myName = fallback;
  isAdmin = false;
}

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
let currentView = 'home';

function switchView(view) {
  currentView = view;
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
  document.getElementById('profile-avatar').textContent = initials(myName || '?');
  document.getElementById('profile-name').textContent = myName + (isAdmin ? ' · Amministratore' : '');
  document.getElementById('profile-email').textContent = currentUser?.email ?? '';
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
  if (currentGroupId && !myGroups.some(g => g.id === currentGroupId)) currentGroupId = null;
  document.getElementById('welcome').classList.toggle('hidden', myGroups.length > 0);
  renderGroupBar();
}

function renderGroupBar() {
  groupPills.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'tab' + (currentGroupId === null ? ' active' : '');
  all.textContent = 'Tutti';
  all.addEventListener('click', () => selectGroup(null));
  groupPills.appendChild(all);
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
          const chip = document.createElement('span');
          chip.className = 'history-chip';
          chip.textContent = m.profile.display_name + (m.user_id === currentUser.id ? ' (tu)' : '');
          if (canKick && m.user_id !== currentUser.id) {
            const kick = document.createElement('button');
            kick.className = 'chip-kick';
            kick.textContent = '✕';
            kick.title = `Rimuovi ${m.profile.display_name} dal gruppo`;
            kick.addEventListener('click', async () => {
              if (!confirm(`Rimuovere ${m.profile.display_name} dal gruppo "${g.name}"?`)) return;
              const { error } = await supabase.from('group_members').delete()
                .eq('group_id', g.id).eq('user_id', m.user_id);
              if (error) { toast(friendlyError(error)); return; }
              toast(`${m.profile.display_name} rimosso dal gruppo.`);
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

    const inviteText = `Entra nel gruppo "${g.name}" su Posti con il codice ${g.code}: ${SITE_URL}`;
    const invite = document.createElement('button');
    invite.className = 'btn btn-ghost btn-small';
    invite.textContent = 'Invita amici';
    invite.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'Posti', text: inviteText, url: SITE_URL }); } catch {}
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
      await supabase.from('group_members').delete().eq('group_id', g.id).eq('user_id', currentUser.id);
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
  return currentGroupId
    ? `Gruppo: ${myGroups.find(g => g.id === currentGroupId)?.name ?? ''}`
    : 'Tutti i passaggi pubblici';
}

async function loadHistory() {
  const list = document.getElementById('history-list');
  document.querySelector('#view-history .view-subtitle').textContent =
    `Chi ha guidato e chi era a bordo · ${groupLabel()} (si cambia dalla Home)`;
  list.innerHTML = '<div class="skeleton"></div>';
  let hq = supabase
    .from('rides')
    .select('ride_date, origin, destination, depart_time, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger:profiles!seat_claims_passenger_id_fkey(display_name))')
    .lt('ride_date', todayISO());
  hq = currentGroupId ? hq.eq('group_id', currentGroupId) : hq;
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
    drv.textContent = `${r.driver.display_name} (guidava)`;
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
      chip.textContent = c.passenger.display_name;
      people.appendChild(chip);
    }
    item.appendChild(people);
    dayWrap.appendChild(item);
  }
}

// --- Vista Statistiche ---
async function loadStats() {
  const box = document.getElementById('stats-content');
  document.querySelector('#view-stats .view-subtitle').textContent =
    `I turni parlano da soli · ${groupLabel()} (si cambia dalla Home)`;
  box.innerHTML = '<div class="skeleton"></div>';
  let sq = supabase
    .from('rides')
    .select('driver_id, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name))');
  sq = currentGroupId ? sq.eq('group_id', currentGroupId) : sq;
  const { data, error } = await sq;
  if (error || !data) { box.innerHTML = '<p class="view-subtitle">Impossibile caricare le statistiche.</p>'; return; }

  const drives = new Map(); // id -> {name, n}
  const ridesTaken = new Map();
  for (const r of data) {
    const d = drives.get(r.driver_id) ?? { name: r.driver.display_name, n: 0 };
    d.n++; drives.set(r.driver_id, d);
    for (const c of r.seat_claims) {
      const p = ridesTaken.get(c.passenger_id) ?? { name: c.passenger.display_name, n: 0 };
      p.n++; ridesTaken.set(c.passenger_id, p);
    }
  }

  const myDrives = drives.get(currentUser.id)?.n ?? 0;
  const myRides = ridesTaken.get(currentUser.id)?.n ?? 0;

  const bars = (map, alt) => {
    const rows = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    const max = rows[0]?.n || 1;
    return rows.map(r =>
      `<div class="stats-row${alt ? ' alt' : ''}">
        <span class="stats-row-name">${r.name.replace(/</g, '&lt;')}</span>
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
    <div class="stats-section"><h3>Chi sale più spesso</h3>${bars(ridesTaken, true)}</div>`;
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
  loadRides();
}

// Prenotando o pubblicando, la richiesta "cerco un passaggio" si toglie da sola
async function clearMyRequest() {
  let q = supabase.from('ride_requests').delete().eq('user_id', currentUser.id).eq('ride_date', currentDate);
  q = currentGroupId ? q.eq('group_id', currentGroupId) : q.is('group_id', null);
  await q;
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
      .select('origin, destination, depart_time, seats, note')
      .eq('driver_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && !dest.value) {
      document.getElementById('ride-origin').value = data.origin ?? '';
      dest.value = data.destination ?? '';
      document.getElementById('ride-time').value = data.depart_time?.slice(0, 5) ?? '';
      document.getElementById('ride-seats').value = String(data.seats);
      document.getElementById('ride-note').value = data.note ?? '';
      toast('Modulo precompilato con il tuo ultimo viaggio: cambia quello che vuoi.');
    }
  }
});

rideForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const base = {
    driver_id: currentUser.id,
    group_id: currentGroupId,
    depart_time: document.getElementById('ride-time').value || null,
    origin: document.getElementById('ride-origin').value.trim() || null,
    destination: document.getElementById('ride-destination').value.trim(),
    seats: Number(document.getElementById('ride-seats').value),
    note: document.getElementById('ride-note').value.trim() || null,
  };
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
  offerCard.classList.add('hidden');
  toast(published === 1
    ? 'Auto pubblicata: ora gli amici possono prenotare il posto.'
    : `Auto pubblicata per ${published} settimane.`);
  clearMyRequest();
  loadRides();
});

// --- Notifiche (quando la scheda è in background) ---
let lastNotify = 0;
function maybeNotify(text) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (Date.now() - lastNotify < 30000) return; // non più di una ogni 30s
  lastNotify = Date.now();
  try { new Notification('Posti', { body: text, icon: 'icon.svg' }); } catch {}
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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, () => {
      maybeNotify('Nuova auto pubblicata: corri a prenotare il posto.');
      loadRides(true);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rides' }, () => loadRides(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_requests' }, () => loadRides(true))
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
  const token = ++loadToken;
  if (!silent) {
    ridesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    emptyMessage.classList.add('hidden');
  }
  let query = supabase
    .from('rides')
    .select('*, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(seat_index, passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name)), ride_comments(count)')
    .eq('ride_date', currentDate)
    .order('depart_time', { ascending: true, nullsFirst: false });
  query = currentGroupId ? query.eq('group_id', currentGroupId) : query.is('group_id', null);

  let reqQuery = supabase
    .from('ride_requests')
    .select('user_id, profile:profiles(display_name)')
    .eq('ride_date', currentDate);
  reqQuery = currentGroupId ? reqQuery.eq('group_id', currentGroupId) : reqQuery.is('group_id', null);

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
}

// Bottoni del giorno: nascosti nei giorni passati; "Cerco un passaggio" contestuale
function updateDayCta(rides) {
  const past = isPastDay();
  offerToggle.classList.toggle('hidden', past);
  if (past) offerCard.classList.add('hidden');
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
    let q = supabase.from('ride_requests').delete().eq('user_id', currentUser.id).eq('ride_date', currentDate);
    q = currentGroupId ? q.eq('group_id', currentGroupId) : q.is('group_id', null);
    await q;
    toast('Richiesta rimossa.');
  } else {
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

  let members = [];
  if (currentGroupId) {
    const { data } = await supabase
      .from('group_members')
      .select('user_id, profile:profiles(display_name)')
      .eq('group_id', currentGroupId);
    members = data ?? [];
  } else {
    members = currentRequests.map(r => ({ user_id: r.user_id, profile: r.profile }));
  }

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
    chip.textContent = w.profile.display_name
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

function buildCar(ride) {
  const isLong = ride.seats >= 5;
  const H = isLong ? 330 : 250;
  const svg = svgEl('svg', { viewBox: `0 0 190 ${H}`, class: 'car-svg', role: 'img' });
  svg.setAttribute('aria-label', `Auto di ${ride.driver.display_name}`);

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

  drawSeat(svg, DRIVER_POS, { kind: 'driver', label: initials(ride.driver.display_name), name: ride.driver.display_name });
  svg.appendChild(svgEl('circle', { cx: DRIVER_POS.x, cy: DRIVER_POS.y - 32, r: 8, class: 'car-wheel-steer' }));

  const layout = SEAT_LAYOUTS[ride.seats];
  for (const idx of Object.keys(layout).map(Number)) {
    const claim = claims.get(idx);
    const pos = layout[idx];
    if (claim) {
      const mine = claim.passenger_id === currentUser.id;
      const seat = drawSeat(svg, pos, {
        kind: mine ? 'mine' : 'taken',
        label: initials(claim.passenger.display_name),
        name: claim.passenger.display_name,
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

function drawSeat(svg, pos, { kind, label, name, clickable = false }) {
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  g.appendChild(svgEl('rect', { x: pos.x - 20, y: pos.y - 26, width: 40, height: 14, rx: 7, class: 'seat-back' }));
  g.appendChild(svgEl('rect', { x: pos.x - 22, y: pos.y - 14, width: 44, height: 40, rx: 12, class: 'seat-base' }));
  const t = svgEl('text', { x: pos.x, y: pos.y + 12, class: 'seat-text' });
  t.textContent = label;
  g.appendChild(t);
  svg.appendChild(g);
  if (clickable) {
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.dispatchEvent(new Event('click')); } });
  }
  return g;
}

// --- Azioni sedili ---
async function claimSeat(ride, seatIndex) {
  const { error } = await supabase.from('seat_claims').insert({
    ride_id: ride.id, seat_index: seatIndex, passenger_id: currentUser.id,
  });
  if (error) {
    if (error.code === '23505') toast('Posto già occupato, oppure sei già su questa auto.');
    else toast(friendlyError(error));
  } else {
    toast('Posto prenotato: sei a bordo.');
    clearMyRequest();
  }
  loadRides();
}

async function releaseSeat(ride, claim, mine) {
  const who = mine ? 'Vuoi scendere da questa auto?' : `Vuoi liberare il posto di ${claim.passenger.display_name}?`;
  if (!confirm(who)) return;
  await supabase.from('seat_claims').delete().eq('ride_id', ride.id).eq('seat_index', claim.seat_index);
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
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-car"/></svg><strong>${rides.length}</strong> ${rides.length === 1 ? 'auto' : 'auto'}</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-plus"/></svg><strong>${totalFree}</strong> posti liberi</span>` +
      `<span class="stat-chip"><svg width="15" height="15"><use href="#i-users"/></svg><strong>${aboard}</strong> a bordo</span>`;
  }
  for (const ride of rides) {
    const card = document.createElement('article');
    card.className = 'ride-card';
    card.style.setProperty('--car-hue', hueFor(ride.driver_id));

    const head = document.createElement('div');
    head.className = 'ride-head';
    const info = document.createElement('div');
    const route = document.createElement('div');
    route.className = 'ride-route';
    route.textContent = ride.origin ? `${ride.origin} → ${ride.destination}` : ride.destination;
    info.appendChild(route);
    const sub = document.createElement('div');
    sub.className = 'ride-sub';
    const time = ride.depart_time ? ` · ore ${ride.depart_time.slice(0, 5)}` : '';
    sub.textContent = DAY_FMT.format(new Date(ride.ride_date + 'T12:00:00')) + time;
    info.appendChild(sub);
    const drv = document.createElement('div');
    drv.className = 'ride-sub';
    drv.textContent = `Guida ${ride.driver.display_name}`;
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
      `${ride.driver.display_name} guida verso ${ride.destination}` +
      (ride.depart_time ? ` alle ${ride.depart_time.slice(0, 5)}` : '') +
      ` (${ride.ride_date.split('-').reverse().join('/')})` +
      (free > 0 ? ` — ${free} posti disponibili.` : ' — auto al completo.') +
      ` Prenota su ${SITE_URL}`;
    share.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'Posti', text: shareText, url: SITE_URL }); } catch {}
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
        await supabase.from('rides').delete().eq('id', ride.id);
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
        chip.textContent = c.passenger.display_name;
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
    if (ride.note) {
      const note = document.createElement('span');
      note.className = 'ride-note';
      note.textContent = ride.note;
      foot.appendChild(note);
    }
    card.appendChild(foot);

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
    meta.textContent = `${c.author.display_name} · ${TIME_FMT.format(new Date(c.created_at))}`;
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
        await supabase.from('ride_comments').delete().eq('id', c.id);
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
    await loadGroups();
    renderProfile();
    askNotifyPermission();
    subscribeRealtime();
    setDate(currentDate);
    switchView('home');
  } else if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
