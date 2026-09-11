// La navigazione fra le viste, e la scheda Profilo
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { collegaPromo } from './installa.js';
import { initials } from './auto-svg.js';
import { ask } from './dialogo.js';
import { renderGroupsView } from './gruppi.js';
import { renderNotifiche } from './notifiche.js';
import { currentUser, isAdmin, myAvatar, myGroups, myName, sospeso, toast } from './nucleo.js';
import { loadRides } from './passaggi.js';
import { renderBlocked, renderReports } from './persone.js';
import { loadHistory, loadStats } from './storico.js';
import { supabase } from './supabase.js';
import { renderAuto, renderZona } from './zona.js';

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

  // **La colonna, da 768px in su.** Stesso stato, letto dallo stesso `data-view`:
  // non e' una seconda navigazione con un suo elenco da tenere allineato, sono due
  // rese dello stesso elenco. Qui il profilo **e'** una voce come le altre, perche'
  // in colonna c'e' posto e la faccia in alto resta comunque.
  for (const b of document.querySelectorAll('.lato-voci .voce')) {
    const attiva = b.dataset.view === view;
    b.classList.toggle('attiva', attiva);
    if (attiva) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }

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

for (const b of document.querySelectorAll('.nav-item, .lato-voci .voce')) {
  b.addEventListener('click', () => switchView(b.dataset.view));
}

// Il riquadro che invita a installarla: si spegne da solo se non c'e' niente da
// proporre — dentro un'app gia' installata, o dove il browser non offre il dialogo.
collegaPromo(document.getElementById('promo'), document.getElementById('btn-installa'));

document.getElementById('top-me')?.addEventListener('click', () => switchView('profile'));

// ── L'interruttore del tema ────────────────────────────────────────────────
//
// La lettura sta in `tema.js`, che gira in `<head>` prima che si dipinga: qui c'e'
// solo il gesto. L'app nasce chiara — e' cosi' che e' disegnata — e chi la gira se
// la ritrova girata alla visita dopo.
//
// Il bottone mostra **dove andresti**, non dove sei: la luna sulla pagina chiara, il
// sole su quella scura. `aria-pressed` invece dice lo stato vero, perche' quella e'
// la domanda che fa chi ascolta la pagina.
const tastoTema = document.getElementById('tema-tasto');

// `gira` dice se il bottone deve **voltarsi**, e non e' un vezzo che si potrebbe
// leggere dallo stato: e' la differenza fra un gesto e un disegno iniziale. La
// stessa funzione serve due momenti — il tocco e il primo disegno della pagina —
// e voltarsi al primo disegno vorrebbe dire annunciare un cambio che non c'e'
// stato. Il movimento dice lo stato, o non c'e' (PRODUCT.md, principio 2).
function mostraTema(scuro, gira = false) {
  if (scuro) document.documentElement.setAttribute('data-tema', 'scuro');
  else document.documentElement.removeAttribute('data-tema');
  if (!tastoTema) return;
  const verso = scuro ? 'chiaro' : 'scuro';
  tastoTema.setAttribute('aria-pressed', String(scuro));
  tastoTema.title = `Passa al tema ${verso}`;
  tastoTema.setAttribute('aria-label', `Passa al tema ${verso}`);
  // La targa a due facce: la luna su una, il sole sull'altra, e per passare da una
  // all'altra si **volta**. Il segno lo dice il verso in cui si e' andati — a
  // sinistra verso il buio, a destra verso la luce — cosi' il gesto non e' una
  // rotazione generica ma il verso di quel comando. Lo `<svg>` viene sostituito, e
  // l'elemento nuovo fa partire l'animazione da solo: senza `gira` la classe non
  // c'e' e non parte niente.
  tastoTema.innerHTML = `<svg width="17" height="17" aria-hidden="true"`
    + `${gira ? ` class="volta ${scuro ? 'al-buio' : 'alla-luce'}"` : ''}`
    + `><use href="#i-${scuro ? 'sole' : 'luna'}"/></svg>`;
  // Anche la barra del browser sul telefono segue il tema: altrimenti resta del
  // colore dell'altro, ed e' la striscia piu' grande dello schermo a dirlo.
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', scuro ? '#04326D' : '#F4FEFF');
}

mostraTema(document.documentElement.getAttribute('data-tema') === 'scuro');

// Senza una scelta salvata comanda il browser **anche mentre la pagina e' aperta**:
// chi ha il tema di sistema automatico lo vede girare all'imbrunire senza ricaricare.
// Con una scelta salvata no: quella e' una decisione, e un'impostazione generale non
// la scavalca. La chiave si rilegge ogni volta invece di tenerla in una variabile,
// perche' un'altra scheda della stessa app puo' averla cambiata nel frattempo.
window.matchMedia?.('(prefers-color-scheme: dark)')
  ?.addEventListener('change', (ev) => {
    let scelto = null;
    try {
      scelto = localStorage.getItem('wt_tema');
    } catch {
      // Memoria chiusa: nessuna scelta, quindi si segue il browser.
    }
    if (!scelto) mostraTema(ev.matches, true);
  });

tastoTema?.addEventListener('click', () => {
  const scuro = document.documentElement.getAttribute('data-tema') !== 'scuro';
  mostraTema(scuro, true);
  try {
    localStorage.setItem('wt_tema', scuro ? 'scuro' : 'chiaro');
  } catch {
    // Memoria locale chiusa: il tema vale per questa visita e basta. Meglio di un
    // errore in faccia per una preferenza estetica.
  }
});

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

export {
  renderProfile,
  switchView,
};
