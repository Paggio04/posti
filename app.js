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
const userEmailEl = document.getElementById('user-email');
const placeForm = document.getElementById('place-form');
const placesList = document.getElementById('places-list');
const emptyMessage = document.getElementById('empty-message');
const tabMine = document.getElementById('tab-mine');
const tabPublic = document.getElementById('tab-public');

let currentUser = null;
let currentTab = 'mine';

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
  if (!authForm.reportValidity()) return;
  const { error } = await supabase.auth.signUp(credentials());
  if (error) {
    showAuthMessage(error.message);
  } else {
    showAuthMessage('Registrazione ok! Controlla la mail per confermare.', true);
  }
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

// --- Places ---
placeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('posti').insert({
    user_id: currentUser.id,
    name: document.getElementById('place-name').value.trim(),
    city: document.getElementById('place-city').value.trim() || null,
    category: document.getElementById('place-category').value,
    notes: document.getElementById('place-notes').value.trim() || null,
    rating: Number(document.getElementById('place-rating').value),
    is_public: document.getElementById('place-public').checked,
  });
  if (error) {
    alert('Errore nel salvataggio: ' + error.message);
    return;
  }
  placeForm.reset();
  loadPlaces();
});

async function loadPlaces() {
  placesList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  emptyMessage.classList.add('hidden');
  let query = supabase.from('posti').select('*').order('created_at', { ascending: false });
  query = currentTab === 'mine'
    ? query.eq('user_id', currentUser.id)
    : query.eq('is_public', true);
  const { data, error } = await query;
  if (error) {
    console.error(error);
    placesList.innerHTML = '';
    return;
  }
  renderPlaces(data);
}

const CATEGORY_ICONS = {
  ristorante: '🍝', bar: '☕', natura: '🌲', cultura: '🏛️', mare: '🏖️', altro: '✨',
};

function renderPlaces(places) {
  placesList.innerHTML = '';
  emptyMessage.classList.toggle('hidden', places.length > 0);
  for (const p of places) {
    const card = document.createElement('div');
    card.className = 'place-card';

    const head = document.createElement('div');
    head.className = 'place-head';
    const title = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'place-name';
    nameEl.textContent = `${CATEGORY_ICONS[p.category] ?? '📍'} ${p.name}`;
    title.appendChild(nameEl);
    if (p.city) {
      const cityEl = document.createElement('div');
      cityEl.className = 'place-city';
      cityEl.textContent = p.city;
      title.appendChild(cityEl);
    }
    head.appendChild(title);
    if (p.user_id === currentUser.id) {
      const del = document.createElement('button');
      del.className = 'place-delete';
      del.textContent = '✕';
      del.title = 'Elimina';
      del.addEventListener('click', async () => {
        if (!confirm(`Eliminare "${p.name}"?`)) return;
        await supabase.from('posti').delete().eq('id', p.id);
        loadPlaces();
      });
      head.appendChild(del);
    }
    card.appendChild(head);

    if (p.notes) {
      const notes = document.createElement('div');
      notes.className = 'place-notes';
      notes.textContent = p.notes;
      card.appendChild(notes);
    }

    const meta = document.createElement('div');
    meta.className = 'place-meta';
    const rating = document.createElement('span');
    rating.className = 'place-rating';
    rating.textContent = '★'.repeat(p.rating);
    meta.appendChild(rating);
    const badge = document.createElement('span');
    badge.className = 'place-badge' + (p.is_public ? ' public' : '');
    badge.textContent = p.is_public ? 'Pubblico' : 'Privato';
    meta.appendChild(badge);
    card.appendChild(meta);

    placesList.appendChild(card);
  }
}

// --- Tabs ---
tabMine.addEventListener('click', () => switchTab('mine'));
tabPublic.addEventListener('click', () => switchTab('public'));

function switchTab(tab) {
  currentTab = tab;
  tabMine.classList.toggle('active', tab === 'mine');
  tabPublic.classList.toggle('active', tab === 'public');
  loadPlaces();
}

// --- Render root ---
function render() {
  const loggedIn = !!currentUser;
  authView.classList.toggle('hidden', loggedIn);
  appShell.classList.toggle('hidden', !loggedIn);
  userEmailEl.textContent = currentUser?.email ?? '';
  if (loggedIn) loadPlaces();
}
