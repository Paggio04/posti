// Segnalare, bloccare, sospendere; portarsi via i propri dati
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { ask, conferma } from './dialogo.js';
import { bloccati, currentUser, friendlyError, isAdmin, nomeDi, offerCard, offerToggle, setBloccati, sospeso, sospesoMotivo, toast, todayISO } from './nucleo.js';
import { COLONNE_RIDE, attaccaCoordinate, loadRides } from './passaggi.js';
import { renderProfile } from './schede.js';
import { supabase } from './supabase.js';

// --- Segnalazione, blocco, sospensione (cantiere C10) ---
// Qui c'e' solo l'interfaccia: chi puo' fare cosa lo decidono le policy della migrazione
// 012, e questa meta' non e' fidata (ADR 001, punto 2). Le guardie qui sotto servono a
// dare un messaggio sensato invece di un errore del database, non a proteggere niente.

async function loadBlocked() {
  const { data } = await supabase.from('user_blocks').select('blocked_id');
  setBloccati(new Set((data ?? []).map(b => b.blocked_id)));
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

export {
  applicaSospensione,
  bloccaSeSospeso,
  bottonePersona,
  loadBlocked,
  renderBlocked,
  renderReports,
};
