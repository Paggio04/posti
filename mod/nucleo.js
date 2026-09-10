// Riferimenti al DOM, stato condiviso, aiutanti puri, avvisi
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

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

// ── Perche' ci sono dei setter, e non si assegna e basta ───────────────────
// Un modulo ES puo' **leggere** un `let` esportato da un altro e vederlo cambiare — i
// legami sono vivi — ma **non puo' assegnarlo**: assegnare a un import e' un errore, e
// il browser lo dice in un modo che non somiglia alla causa. Le righe che cambiano
// questi tredici valori vivono altrove (l'accesso mette `currentUser`, le comitive
// mettono `currentGroupId`, il giorno mette `currentDate`), quindi passano di qui.
// Sono tredici perche' tredici sono i valori davvero condivisi: ogni setter in piu'
// sarebbe uno stato in piu' che due moduli si scambiano, e si vede subito.
function setCurrentUser(v) { currentUser = v; }
function setMyName(v) { myName = v; }
function setMyAvatar(v) { myAvatar = v; }
function setIsAdmin(v) { isAdmin = v; }
function setSospeso(v) { sospeso = v; }
function setSospesoMotivo(v) { sospesoMotivo = v; }
function setBloccati(v) { bloccati = v; }
function setCurrentDate(v) { currentDate = v; }
function setMyGroups(v) { myGroups = v; }
function setCurrentGroupId(v) { currentGroupId = v; }
function setRealtimeChannel(v) { realtimeChannel = v; }
function setRealtimeDate(v) { realtimeDate = v; }
function setRendered(v) { rendered = v; }

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

export {
  ULTIMO_GRUPPO,
  addDaysISO,
  appShell,
  authForm,
  authMessage,
  authView,
  bloccati,
  chiRisponde,
  currentDate,
  currentGroupId,
  currentUser,
  dayPicker,
  dayToday,
  dayTomorrow,
  dayWeek,
  emptyMessage,
  escapeHtml,
  friendlyError,
  groupPills,
  hasDeparted,
  isAdmin,
  isPastDay,
  mioPosto,
  myAvatar,
  myGroups,
  myName,
  nameLabel,
  nomeDi,
  nomeOccupante,
  offerCard,
  offerToggle,
  oraPiu,
  realtimeChannel,
  realtimeDate,
  rendered,
  rideForm,
  ridesList,
  setBloccati,
  setCurrentDate,
  setCurrentGroupId,
  setCurrentUser,
  setIsAdmin,
  setMyAvatar,
  setMyGroups,
  setMyName,
  setRealtimeChannel,
  setRealtimeDate,
  setRendered,
  setSospeso,
  setSospesoMotivo,
  sospeso,
  sospesoMotivo,
  toast,
  todayISO,
  walkersCard,
  walkersList,
};
