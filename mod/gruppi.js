// Le comitive: codice, fermate, regole, quota
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { ask, condividi, conferma } from './dialogo.js';
import { ULTIMO_GRUPPO, bloccati, currentGroupId, currentUser, emptyMessage, friendlyError, groupPills, isAdmin, myGroups, nomeDi, offerCard, ridesList, setCurrentGroupId, setMyGroups, toast, todayISO, walkersCard } from './nucleo.js';
import { loadRides } from './passaggi.js';
import { bloccaSeSospeso, bottonePersona } from './persone.js';
import { dataBreve, regoleGruppo } from './storico.js';
import { SITE_URL, supabase } from './supabase.js';
import { autoScelta, posizione } from './zona.js';

// --- Gruppi ---
// Una frase sola per i due modi in cui un codice non fa entrare (C24): scriverne due
// distinte direbbe a chi tira a indovinare quali codici esistono.
const CODICE_RIFIUTATO = 'Codice non valido, o quella comitiva è già chiusa.';

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
  const code = await ask('Entra in un gruppo', { text: 'Fatti mandare il codice da un amico.', placeholder: 'Codice invito' });
  if (!code || !code.trim()) return;
  const { data, error } = await supabase.rpc('join_group', { p_code: code.trim() });
  if (error) {
    // C24: dalla 034 il rifiuto arriva come `null` qui sotto, non come eccezione. Le
    // due righe che leggono i messaggi vecchi restano finche' la migrazione non e'
    // applicata — e' la stessa precauzione del commit «il codice regge lo schema
    // vecchio e quello nuovo, cosi' l'ordine non conta».
    toast(error.message.includes('Troppi tentativi') ? 'Troppi codici sbagliati: riprova fra un\'ora.'
      : /chiusa|Codice/.test(error.message) ? CODICE_RIFIUTATO
      : 'Errore: ' + error.message);
    return;
  }
  // Codice inesistente e comitiva chiusa rispondono uguale (C24, rimedio 2): la
  // differenza fra i due direbbe che quel codice esiste. La frase li nomina tutti e
  // due, cosi' chi ha in mano un codice legittimo ma scaduto sa cosa guardare — che
  // era l'argomento con cui C38 aveva voluto due messaggi distinti.
  if (!data) { toast(CODICE_RIFIUTATO); return; }
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
  setMyGroups((data ?? []).map(r => r.group).filter(Boolean));

  // Ogni passaggio appartiene a una comitiva: senza comitiva non c'e' niente da mostrare.
  // Si riprende quella che si stava guardando; se non c'e' piu', la prima disponibile.
  const valido = (id) => id && myGroups.some(g => g.id === id);
  if (!valido(currentGroupId)) {
    const ricordato = localStorage.getItem(ULTIMO_GRUPPO);
    setCurrentGroupId(valido(ricordato) ? ricordato : (myGroups[0]?.id ?? null));
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
  setCurrentGroupId(groupId);
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
// La azzera anche il modulo che pubblica un passaggio: a un `let` importato non si assegna.
function setQuotaProposta(v) { quotaProposta = v; }

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

export {
  caricaFermate,
  loadGroups,
  proponiQuota,
  setQuotaProposta,
  renderGroupsView,
};
