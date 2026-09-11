// Il giorno, l'offerta, il realtime, il caricamento
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { ask, conferma } from './dialogo.js';
import { caricaFermate, proponiQuota, setQuotaProposta } from './gruppi.js';
import { addDaysISO, currentDate, currentGroupId, currentUser, dayPicker, dayToday, dayTomorrow, dayWeek, emptyMessage, escapeHtml, friendlyError, hasDeparted, isPastDay, mioPosto, myGroups, nomeDi, offerCard, offerToggle, realtimeChannel, realtimeDate, rideForm, ridesList, setCurrentDate, setRealtimeChannel, setRealtimeDate, sospeso, toast, todayISO, walkersCard, walkersList } from './nucleo.js';
import { bloccaSeSospeso } from './persone.js';
import { renderRides } from './scheda.js';
import { comitivaChiusa, regoleGruppo } from './storico.js';
import { supabase } from './supabase.js';
import { partenza, setPartenza } from './zona.js';

// --- Giorno ---
dayToday.addEventListener('click', () => setDate(todayISO()));
dayTomorrow.addEventListener('click', () => setDate(todayISO(1)));
dayPicker.addEventListener('change', () => { if (dayPicker.value) setDate(dayPicker.value); });

function setDate(date) {
  setCurrentDate(date);
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
  setPartenza(null);
  // C34: `reset()` svuota il campo ma non questa variabile. Senza, la pubblicazione
  // dopo crederebbe che la cifra scritta a mano sia una vecchia proposta e la
  // sovrascriverebbe.
  setQuotaProposta(null);
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
  setRealtimeDate(currentDate);
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  setRealtimeChannel(supabase
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
    .subscribe());
}

// --- Caricamento passaggi ---

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
// La riempie chi disegna le schede: a un `let` importato non si assegna.
function setPassaggiVisibili(v) { passaggiVisibili = v; }
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

export {
  COLONNE_RIDE,
  askNotifyPermission,
  attaccaCoordinate,
  clearMyRequest,
  gemelloDi,
  giornoBreve,
  loadRides,
  setPassaggiVisibili,
  setDate,
  subscribeRealtime,
};
