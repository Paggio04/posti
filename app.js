import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SITE_URL = 'https://posti-app.netlify.app';

// --- DOM ---
const authView = document.getElementById('auth-view');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const authMessage = document.getElementById('auth-message');
const signupBtn = document.getElementById('signup-btn');
const logoutBtn = document.getElementById('logout-btn');
const nameLabel = document.getElementById('name-label');
const userNameEl = document.getElementById('user-name');
const groupPills = document.getElementById('group-pills');
const groupInfo = document.getElementById('group-info');
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
let currentDate = todayISO();
let myGroups = [];
let currentGroupId = null; // null = Tutti
let realtimeChannel = null;
let rendered = false;

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// --- Auth ---
supabase.auth.onAuthStateChange((_event, session) => {
  const wasUser = currentUser?.id;
  currentUser = session?.user ?? null;
  if (currentUser?.id !== wasUser || !rendered) render();
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signInWithPassword(credentials());
  showAuthMessage(error ? 'Credenziali non valide o email non confermata.' : '');
});

signupBtn.addEventListener('click', async () => {
  if (nameLabel.classList.contains('hidden')) {
    nameLabel.classList.remove('hidden');
    document.getElementById('display-name').focus();
    showAuthMessage('Dicci come ti chiami, poi premi di nuovo "Crea account".', true);
    return;
  }
  const name = document.getElementById('display-name').value.trim();
  if (!name) { showAuthMessage('Serve il tuo nome per farti trovare dagli amici.'); return; }
  if (!authForm.reportValidity()) return;
  const { email, password } = credentials();
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: name } },
  });
  if (error) showAuthMessage(error.message);
  else showAuthMessage('Registrazione ok! Controlla la mail per confermare.', true);
});

logoutBtn.addEventListener('click', () => supabase.auth.signOut());

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
  const { data } = await supabase.from('profiles').select('display_name').eq('id', currentUser.id).maybeSingle();
  if (data) { myName = data.display_name; return; }
  await supabase.from('profiles').insert({ id: currentUser.id, display_name: fallback });
  myName = fallback;
}

// --- Cambia nome ---
userNameEl.addEventListener('click', async () => {
  const name = prompt('Il tuo nome (come appare sul sedile):', myName);
  if (!name || !name.trim() || name.trim() === myName) return;
  const { error } = await supabase.from('profiles').update({ display_name: name.trim().slice(0, 40) }).eq('id', currentUser.id);
  if (error) { toast('Errore: ' + error.message); return; }
  myName = name.trim().slice(0, 40);
  userNameEl.textContent = myName;
  loadRides();
});

// --- Gruppi ---
document.getElementById('group-create').addEventListener('click', async () => {
  const name = prompt('Nome del gruppo (es. Comitiva del mare):');
  if (!name || !name.trim()) return;
  const { data, error } = await supabase.rpc('create_group', { p_name: name.trim().slice(0, 40) });
  if (error) { toast('Errore: ' + error.message); return; }
  await loadGroups();
  selectGroup(data.id);
  toast(`🎉 Gruppo creato! Manda il codice ${data.code} agli amici.`);
});

document.getElementById('group-join').addEventListener('click', async () => {
  const code = prompt('Codice invito del gruppo:');
  if (!code || !code.trim()) return;
  const { data, error } = await supabase.rpc('join_group', { p_code: code.trim() });
  if (error) { toast(error.message.includes('Codice') ? '🤔 Codice non valido, ricontrolla.' : 'Errore: ' + error.message); return; }
  await loadGroups();
  selectGroup(data.id);
  toast(`🙌 Sei nel gruppo "${data.name}"!`);
});

async function loadGroups() {
  const { data, error } = await supabase
    .from('group_members')
    .select('group:groups(id, name, code, owner_id)')
    .eq('user_id', currentUser.id);
  if (error) { console.error(error); return; }
  myGroups = (data ?? []).map(r => r.group).filter(Boolean);
  if (currentGroupId && !myGroups.some(g => g.id === currentGroupId)) currentGroupId = null;
  renderGroupBar();
}

function renderGroupBar() {
  groupPills.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'tab' + (currentGroupId === null ? ' active' : '');
  all.textContent = '🌍 Tutti';
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
  renderGroupInfo();
  loadRides();
}

function renderGroupInfo() {
  const g = myGroups.find(x => x.id === currentGroupId);
  groupInfo.classList.toggle('hidden', !g);
  groupInfo.innerHTML = '';
  if (!g) return;

  const code = document.createElement('span');
  code.className = 'group-code';
  code.textContent = `Codice invito: ${g.code}`;
  groupInfo.appendChild(code);

  const copy = document.createElement('button');
  copy.className = 'btn btn-ghost btn-small';
  copy.textContent = 'Copia';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(g.code);
    copy.textContent = 'Copiato ✓';
    setTimeout(() => (copy.textContent = 'Copia'), 1500);
  });
  groupInfo.appendChild(copy);

  const wa = document.createElement('a');
  wa.className = 'btn btn-ghost btn-small';
  wa.textContent = 'Invita su WhatsApp';
  wa.target = '_blank';
  wa.rel = 'noopener';
  wa.href = 'https://wa.me/?text=' + encodeURIComponent(
    `Entra nel gruppo "${g.name}" su Posti 🚗 codice: ${g.code} → ${SITE_URL}`);
  groupInfo.appendChild(wa);

  const leave = document.createElement('button');
  leave.className = 'btn btn-ghost btn-small btn-danger';
  leave.textContent = 'Esci dal gruppo';
  leave.addEventListener('click', async () => {
    if (!confirm(`Uscire dal gruppo "${g.name}"?`)) return;
    await supabase.from('group_members').delete().eq('group_id', g.id).eq('user_id', currentUser.id);
    currentGroupId = null;
    await loadGroups();
    selectGroup(null);
  });
  groupInfo.appendChild(leave);
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

// --- Offri passaggio ---
offerToggle.addEventListener('click', () => {
  offerCard.classList.toggle('hidden');
  if (!offerCard.classList.contains('hidden')) document.getElementById('ride-destination').focus();
});

rideForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('rides').insert({
    driver_id: currentUser.id,
    ride_date: currentDate,
    group_id: currentGroupId,
    depart_time: document.getElementById('ride-time').value || null,
    origin: document.getElementById('ride-origin').value.trim() || null,
    destination: document.getElementById('ride-destination').value.trim(),
    seats: Number(document.getElementById('ride-seats').value),
    note: document.getElementById('ride-note').value.trim() || null,
  });
  if (error) { toast('Errore: ' + error.message); return; }
  rideForm.reset();
  offerCard.classList.add('hidden');
  toast('🚗 Macchina pubblicata! Ora gli amici possono salire.');
  loadRides();
});

// --- Realtime ---
function subscribeRealtime() {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel('posti-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_claims' }, () => loadRides(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => loadRides(true))
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

let loadToken = 0;
async function loadRides(silent = false) {
  const token = ++loadToken;
  if (!silent) {
    ridesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    emptyMessage.classList.add('hidden');
  }
  let query = supabase
    .from('rides')
    .select('*, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(seat_index, passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name))')
    .eq('ride_date', currentDate)
    .order('depart_time', { ascending: true, nullsFirst: false });
  query = currentGroupId ? query.eq('group_id', currentGroupId) : query.is('group_id', null);
  const { data, error } = await query;
  if (token !== loadToken) return; // risposta vecchia, ignora
  if (error) { console.error(error); ridesList.innerHTML = ''; return; }
  renderRides(data);
  renderWalkers(data);
}

// --- "A piedi" (solo nei gruppi) ---
async function renderWalkers(rides) {
  if (!currentGroupId) { walkersCard.classList.add('hidden'); return; }
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, profile:profiles(display_name)')
    .eq('group_id', currentGroupId);
  if (error || !data) { walkersCard.classList.add('hidden'); return; }
  const seated = new Set();
  for (const r of rides) {
    seated.add(r.driver_id);
    for (const c of r.seat_claims) seated.add(c.passenger_id);
  }
  const walkers = data.filter(m => !seated.has(m.user_id));
  walkersCard.classList.toggle('hidden', walkers.length === 0);
  walkersList.innerHTML = '';
  for (const w of walkers) {
    const chip = document.createElement('span');
    chip.className = 'walker-chip';
    chip.textContent = w.profile.display_name + (w.user_id === currentUser.id ? ' (tu)' : '');
    walkersList.appendChild(chip);
  }
}

// --- Macchina SVG ---
const SEAT_POS = {
  0: { x: 38, y: 92 },
  1: { x: 112, y: 92 },
  2: { x: 24, y: 176 },
  3: { x: 76, y: 176 },
  4: { x: 128, y: 176 },
  5: { x: 42, y: 252 },
  6: { x: 110, y: 252 },
};
const SEAT_SETS = {
  1: [1], 2: [1, 4], 3: [1, 2, 4], 4: [1, 2, 3, 4],
  5: [1, 2, 3, 4, 6], 6: [1, 2, 3, 4, 5, 6],
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
  svg.setAttribute('aria-label', `Macchina di ${ride.driver.display_name}`);

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

  drawSeat(svg, SEAT_POS[0], { kind: 'driver', label: initials(ride.driver.display_name), name: ride.driver.display_name });
  const s0 = SEAT_POS[0];
  svg.appendChild(svgEl('circle', { cx: s0.x + 26, cy: s0.y - 4, r: 9, class: 'car-wheel-steer' }));

  for (const idx of SEAT_SETS[ride.seats]) {
    const claim = claims.get(idx);
    const pos = SEAT_POS[idx];
    if (claim) {
      const mine = claim.passenger_id === currentUser.id;
      const seat = drawSeat(svg, pos, {
        kind: mine ? 'mine' : 'taken',
        label: initials(claim.passenger.display_name),
        name: claim.passenger.display_name,
        clickable: mine || isDriver,
      });
      if (mine || isDriver) seat.addEventListener('click', () => releaseSeat(ride, claim, mine));
    } else {
      const seat = drawSeat(svg, pos, { kind: 'free', label: '+', name: 'Posto libero', clickable: !isDriver && !myClaim });
      if (!isDriver && !myClaim) seat.addEventListener('click', () => claimSeat(ride, idx));
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
    if (error.code === '23505') toast('😅 Troppo tardi: posto già preso, o sei già su questa macchina.');
    else toast('Errore: ' + error.message);
  } else {
    toast('🎉 Sei a bordo!');
  }
  loadRides();
}

async function releaseSeat(ride, claim, mine) {
  const who = mine ? 'Scendi da questa macchina?' : `Togli ${claim.passenger.display_name} dal posto?`;
  if (!confirm(who)) return;
  await supabase.from('seat_claims').delete().eq('ride_id', ride.id).eq('seat_index', claim.seat_index);
  toast(mine ? '👋 Sei sceso dalla macchina.' : 'Posto liberato.');
  loadRides();
}

// --- Render passaggi ---
function renderRides(rides) {
  ridesList.innerHTML = '';
  emptyMessage.classList.toggle('hidden', rides.length > 0);
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
    sub.textContent = `Guida ${ride.driver.display_name}${time}`;
    info.appendChild(sub);
    head.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'ride-actions';
    const share = document.createElement('a');
    share.className = 'place-delete';
    share.textContent = '📤';
    share.title = 'Condividi su WhatsApp';
    share.target = '_blank';
    share.rel = 'noopener';
    const free = ride.seats - ride.seat_claims.length;
    share.href = 'https://wa.me/?text=' + encodeURIComponent(
      `🚗 ${ride.driver.display_name} guida verso ${ride.destination}` +
      (ride.depart_time ? ` alle ${ride.depart_time.slice(0, 5)}` : '') +
      ` (${currentDate.split('-').reverse().join('/')})` +
      (free > 0 ? ` — ${free} posti liberi!` : ' — piena') +
      ` Prenota il posto: ${SITE_URL}`);
    actions.appendChild(share);
    if (ride.driver_id === currentUser.id) {
      const del = document.createElement('button');
      del.className = 'place-delete';
      del.textContent = '✕';
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

    const foot = document.createElement('div');
    foot.className = 'ride-foot';
    const count = document.createElement('span');
    count.className = 'place-badge' + (free > 0 ? ' public' : '');
    count.textContent = free > 0 ? `${free} ${free === 1 ? 'posto libero' : 'posti liberi'}` : 'Macchina piena';
    foot.appendChild(count);
    if (ride.note) {
      const note = document.createElement('span');
      note.className = 'ride-note';
      note.textContent = ride.note;
      foot.appendChild(note);
    }
    card.appendChild(foot);

    ridesList.appendChild(card);
  }
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
    renderGroupInfo();
    subscribeRealtime();
    setDate(currentDate);
  } else if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
