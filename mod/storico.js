// Storico, riepilogo, conti, e i formattatori
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { ask, condividi, conferma } from './dialogo.js';
import { chiRisponde, currentGroupId, currentUser, escapeHtml, friendlyError, myGroups, nomeDi, nomeOccupante, offerCard, toast, todayISO } from './nucleo.js';
import { giornoBreve } from './passaggi.js';
import { bloccaSeSospeso } from './persone.js';
import { switchView } from './schede.js';
import { supabase } from './supabase.js';

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
// Sei tinte intorno al blu della palette, che cambiano di tinta prima che di
// luminosita': servono a distinguere sei persone, non a dire qualcosa, e per questo
// non diventano sei accenti in un'app che ne ha uno. L'arancio non e' fra loro di
// proposito — qui l'arancio vuol dire «tuo», e un avatar arancione direbbe che
// quella persona sei tu. Sono **scure** perche' sopra ci va il quasi-bianco: col
// candy blue di due palette fa erano chiare e sopra ci andava l'onyx, ed e' il verso
// che si e' ribaltato insieme all'accento. Un avatar e' un cerchio con due lettere
// dentro, cioe' e' testo, e vale la soglia del testo: le sei coppie le misura
// `tests/contrasto.mjs`.
const COLORI_AV = ['oklch(0.470 0.090 263)', 'oklch(0.440 0.070 226)', 'oklch(0.455 0.075 301)',
  'oklch(0.425 0.065 196)', 'oklch(0.480 0.085 281)', 'oklch(0.410 0.060 216)'];
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

export {
  DAY_FMT,
  comitivaChiusa,
  dataBreve,
  loadHistory,
  loadStats,
  regoleGruppo,
};
