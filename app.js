import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- DOM ---
const authView = document.getElementById('auth-view');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const authMessage = document.getElementById('auth-message');
const signupBtn = document.getElementById('signup-btn');
const logoutBtn = document.getElementById('logout-btn');
const nameLabel = document.getElementById('name-label');
const userNameEl = document.getElementById('user-name');
const dayToday = document.getElementById('day-today');
const dayTomorrow = document.getElementById('day-tomorrow');
const dayPicker = document.getElementById('day-picker');
const offerToggle = document.getElementById('offer-toggle');
const offerCard = document.getElementById('offer-card');
const rideForm = document.getElementById('ride-form');
const ridesList = document.getElementById('rides-list');
const emptyMessage = document.getElementById('empty-message');

let currentUser = null;
let myName = '';
let currentDate = todayISO();

function todayISO(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// --- Auth ---
supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user ?? null;
  render();
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signInWithPassword(credentials());
  showAuthMessage(error ? 'Credenziali non valide o email non confermata.' : '');
});

signupBtn.addEventListener('click', async () => {
  // Primo click: mostra il campo nome; secondo click: registra
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
    depart_time: document.getElementById('ride-time').value || null,
    origin: document.getElementById('ride-origin').value.trim() || null,
    destination: document.getElementById('ride-destination').value.trim(),
    seats: Number(document.getElementById('ride-seats').value),
    note: document.getElementById('ride-note').value.trim() || null,
  });
  if (error) { alert('Errore: ' + error.message); return; }
  rideForm.reset();
  offerCard.classList.add('hidden');
  loadRides();
});

// --- Caricamento passaggi ---
async function loadRides() {
  ridesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  emptyMessage.classList.add('hidden');
  const { data, error } = await supabase
    .from('rides')
    .select('*, driver:profiles!rides_driver_id_fkey(display_name), seat_claims(seat_index, passenger_id, passenger:profiles!seat_claims_passenger_id_fkey(display_name))')
    .eq('ride_date', currentDate)
    .order('depart_time', { ascending: true, nullsFirst: false });
  if (error) { console.error(error); ridesList.innerHTML = ''; return; }
  renderRides(data);
}

// --- Macchina SVG ---
// Layout sedili (vista dall'alto, muso in alto). 0 = guidatore.
const SEAT_POS = {
  0: { x: 38, y: 92 },   // guidatore (davanti sx)
  1: { x: 112, y: 92 },  // davanti dx
  2: { x: 24, y: 176 },  // dietro sx
  3: { x: 76, y: 176 },  // dietro centro
  4: { x: 128, y: 176 }, // dietro dx
  5: { x: 42, y: 252 },  // terza fila sx
  6: { x: 110, y: 252 }, // terza fila dx
};
// Quali sedili usare in base ai posti passeggero offerti
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

  // Carrozzeria
  svg.appendChild(svgEl('rect', { x: 10, y: 10, width: 170, height: H - 20, rx: 46, class: 'car-body' }));
  // Parabrezza + lunotto
  svg.appendChild(svgEl('rect', { x: 30, y: 44, width: 130, height: 16, rx: 8, class: 'car-glass' }));
  svg.appendChild(svgEl('rect', { x: 34, y: H - 42, width: 122, height: 12, rx: 6, class: 'car-glass' }));
  // Ruote
  for (const [wx, wy] of [[2, 60], [180, 60], [2, H - 90], [180, H - 90]]) {
    svg.appendChild(svgEl('rect', { x: wx - 4, y: wy, width: 12, height: 34, rx: 5, class: 'car-wheel' }));
  }
  // Specchietti
  svg.appendChild(svgEl('rect', { x: 0, y: 46, width: 14, height: 6, rx: 3, class: 'car-wheel' }));
  svg.appendChild(svgEl('rect', { x: 176, y: 46, width: 14, height: 6, rx: 3, class: 'car-wheel' }));

  const claims = new Map(ride.seat_claims.map(c => [c.seat_index, c]));
  const myClaim = ride.seat_claims.find(c => c.passenger_id === currentUser.id);
  const isDriver = ride.driver_id === currentUser.id;

  // Sedile guidatore
  drawSeat(svg, SEAT_POS[0], { kind: 'driver', label: initials(ride.driver.display_name), name: ride.driver.display_name });
  // Volante
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
      if (mine || isDriver) {
        seat.addEventListener('click', () => releaseSeat(ride, claim, mine));
      }
    } else {
      const seat = drawSeat(svg, pos, { kind: 'free', label: '+', name: 'Posto libero', clickable: !isDriver && !myClaim });
      if (!isDriver && !myClaim) {
        seat.addEventListener('click', () => claimSeat(ride, idx));
      }
    }
  }
  return svg;
}

function drawSeat(svg, pos, { kind, label, name, clickable = false }) {
  const g = svgEl('g', { class: `seat seat-${kind}${clickable ? ' seat-click' : ''}`, tabindex: clickable ? 0 : -1 });
  const title = svgEl('title', {});
  title.textContent = name;
  g.appendChild(title);
  // Sedile: schienale + seduta
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
    if (error.code === '23505') alert('Troppo tardi: posto appena preso, o sei già su questa macchina.');
    else alert('Errore: ' + error.message);
  }
  loadRides();
}

async function releaseSeat(ride, claim, mine) {
  const who = mine ? 'Scendi da questa macchina?' : `Togli ${claim.passenger.display_name} dal posto?`;
  if (!confirm(who)) return;
  await supabase.from('seat_claims').delete().eq('ride_id', ride.id).eq('seat_index', claim.seat_index);
  loadRides();
}

// --- Render passaggi ---
function renderRides(rides) {
  ridesList.innerHTML = '';
  emptyMessage.classList.toggle('hidden', rides.length > 0);
  for (const ride of rides) {
    const card = document.createElement('article');
    card.className = 'ride-card';

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
      head.appendChild(del);
    }
    card.appendChild(head);

    card.appendChild(buildCar(ride));

    const free = ride.seats - ride.seat_claims.length;
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
  authView.classList.toggle('hidden', loggedIn);
  appShell.classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    await ensureProfile();
    userNameEl.textContent = myName;
    setDate(currentDate);
  }
}
