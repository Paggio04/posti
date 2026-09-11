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
      .order('quando', { ascending: false }).limit(20),
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

  // ── Un giro solo sui passaggi, per le somme che non dipendono dal periodo ──
  const perGiorno = new Map();    // giorno ISO -> i passaggi di quel giorno
  const perMese = new Map();      // mese '2026-08' -> {tot, n} di carburante diviso
  const nomePer = new Map();      // id -> nome, per ogni persona che compare qui
  for (const r of passaggi) {
    nomePer.set(r.driver_id, nomeDi(r.driver));
    const delGiorno = perGiorno.get(r.ride_date);
    if (delGiorno) delGiorno.push(r); else perGiorno.set(r.ride_date, [r]);

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
    for (const c of r.seat_claims) if (c.passenger_id) nomePer.set(c.passenger_id, nomeDi(c.passenger));
  }

  // ── I conti, **sempre per intero** ───────────────────────────────────────
  // Il selettore del periodo in cima non li tocca, e non e' una dimenticanza: un
  // saldo e' quello che devi, non quello che hai maturato negli ultimi trenta
  // giorni. Ristretto a una finestra direbbe «in pari» a chi ha un debito di due
  // mesi fa, che e' l'unica cosa che questo riquadro non puo' permettersi di
  // dire. Il periodo governa i conteggi; i soldi no.
  const { partite, saldo, quantiCon, primaCon, vociCon } = faiIConti(passaggi, pagamenti);

  // ── Quel che resta da qui in avanti ──────────────────────────────────────
  const futuri = passaggi
    .filter(r => r.ride_date >= oggi)
    .sort((a, b) => (a.ride_date + (a.depart_time || '')).localeCompare(b.ride_date + (b.depart_time || '')));
  const liberiTot = futuri.reduce((s, r) => s + Math.max(0, (r.seats || 0) - r.seat_claims.length), 0);

  // ── Il carburante degli ultimi sei mesi ──────────────────────────────────
  const mesiFinestra = ultimiMesi(oggi, 6);
  const serieCarb = mesiFinestra.map(m => perMese.get(m)?.tot ?? 0);
  const meseCorr = perMese.get(oggi.slice(0, 7)) ?? { tot: 0, n: 0 };
  const mesePrec = perMese.get(mesiFinestra[mesiFinestra.length - 2]) ?? { tot: 0, n: 0 };
  const delta = mesePrec.tot > 0 ? Math.round(((meseCorr.tot - mesePrec.tot) / mesePrec.tot) * 100) : null;

  // ── Da qui in giu' si scrive, non si calcola piu' ────────────────────────
  const mio = (id) => id === currentUser.id;
  const nomeCorto = (id) => mio(id) ? 'Tu' : (nomePer.get(id) || 'Qualcuno');
  // Il colore di una persona e' lo stesso in tutti i riquadri — tondo, fetta
  // della ciambella, pallino della legenda — perche' esce dal suo id. Il tuo e'
  // l'arancio, che in questa app vuol dire «tuo» e non e' fra i sei.
  const tinta = (id) => mio(id) ? 'var(--tuo)' : coloreDi(id);

  // Sette giorni: in avanti (quello che viene) o all'indietro (com'e' andata).
  const sette = (avanti) => Array.from({ length: 7 }, (_, i) => {
    const giorno = todayISO(avanti ? i : i - 6);
    const rides = perGiorno.get(giorno) ?? [];
    return {
      giorno, rides,
      posti: rides.reduce((s, r) => s + (r.seats || 0), 0),
      presi: rides.reduce((s, r) => s + r.seat_claims.length, 0),
    };
  });
  // I giorni scoperti sono sempre quelli **che vengono**, qualunque cosa dica il
  // selettore della settimana: un giorno passato senza nessuno alla guida non e'
  // un buco da riempire, e' un giorno andato.
  const inArrivo = sette(true);
  const scoperti = inArrivo.filter(g => !g.rides.length).length;
  const primoScoperto = inArrivo.find(g => !g.rides.length);

  // ── Lo stato dei tre controlli, e un disegno solo ────────────────────────
  // Ogni controllo scrive qui e richiama `disegna()`: non ci sono tre funzioni
  // che ridisegnano tre pezzi, quindi non esiste il caso in cui una tessera e'
  // del periodo nuovo e la ciambella di quello vecchio. E **nessuno dei tre
  // chiede niente al database**: i passaggi sono gia' tutti qui, cambiare
  // periodo e' ricontare.
  const stato = { periodo: '30', finestra: '30', avanti: true, conto: null };

  disegna();
  // Le righe che entrano in una scheda cambiano a 1280px: attraversare quella
  // soglia vuole un disegno nuovo, o il piede conta righe che adesso ci stanno.
  ridisegnaRiepilogo = () => { if (box.isConnected) disegna(); };

  // ══ IL DISEGNO ═══════════════════════════════════════════════════════════
  function disegna() {
    // Quante righe entrano lo dice il foglio, non questa funzione: le righe in
    // piu' diventano una riga di piede che le conta. Un elenco che scorre dentro
    // una scheda sarebbe uno scorrimento in piu', cioe' la cosa che questa vista
    // non deve avere.
    const quante = Number(window.getComputedStyle(document.querySelector('.app-lynk') || document.body)
      .getPropertyValue('--righe-scheda')) || 3;

    box.innerHTML = `<div class="vista-dash">
      ${testaVista()}
      <div class="numeri">${tessere()}</div>
      <div class="fila-due">${schedaSettimana()}${schedaTurni()}</div>
      <div class="fila-tre">${schedaConti(quante)}${schedaAttivita(quante)}${schedaProssimi(quante)}</div>
      ${azioni()}
    </div>`;

    disegnaGrafico(box.querySelector('#grafico-settimana'));
    collega();
  }

  // ── La testata: il titolo, il giorno, e il periodo ──────────────────────
  function testaVista() {
    const scelte = [['7', 'Ultimi 7 giorni'], ['30', 'Ultimi 30 giorni'],
      ['mese', 'Questo mese'], ['90', 'Ultimi 90 giorni']];
    return `<div class="testa-vista">
      <div>
        <h1>Riepilogo</h1>
        <p>${escapeHtml(oggiInLettere())} · ${escapeHtml(nomeComitiva())}</p>
      </div>
      <label class="periodo">
        <select id="dash-periodo" aria-label="Periodo dei conteggi">${scelte
    .map(([v, t]) => `<option value="${v}"${stato.periodo === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>${GIU}
      </label>
    </div>`;
  }

  // ── Le cinque tessere ───────────────────────────────────────────────────
  // Nessuno di questi numeri e' ripetuto piu' in basso, ed e' la regola di C41:
  // tre copie dello stesso conto non sono tre informazioni, sono una che ruba il
  // posto a quelle che mancano.
  function tessere() {
    const giorni = giorniDelPeriodo(stato.periodo, oggi);
    const da = isoMeno(oggi, giorni - 1);
    const nelPeriodo = passaggi.filter(r => r.ride_date >= da && r.ride_date <= oggi);
    const guide = new Set(nelPeriodo.map(r => r.driver_id));

    // Al piu' dodici secchi sul periodo: la linea dice l'andamento, non i singoli
    // giorni, e dodici punti bastano a farlo su trenta come su novanta. Su sette
    // giorni i secchi sono sette: dodici su sette vorrebbe dire spezzare un
    // giorno in due, e mezza giornata non esiste.
    // Prima i due estremi di ogni secchio si ricavavano da `isoMeno` con due
    // arrotondamenti diversi, e sui periodi corti il secondo cadeva **prima** del
    // primo: l'intervallo era a rovescio e il secchio tornava zero. Si contano i
    // giorni una volta e si tagliano a fette, che non puo' sbagliare.
    const alGiorno = Array.from({ length: giorni }, (_, i) =>
      (perGiorno.get(isoMeno(oggi, giorni - 1 - i)) ?? []).length);
    const quanti = Math.min(12, giorni);
    const secchi = Array.from({ length: quanti }, (_, k) => alGiorno
      .slice(Math.floor((k * giorni) / quanti), Math.floor(((k + 1) * giorni) / quanti))
      .reduce((s, n) => s + n, 0));

    return [
      tessera('', 'car', 'Passaggi in programma', String(futuri.length),
        plurale(liberiTot, 'posto libero', 'posti liberi'),
        inArrivo.map(g => g.rides.length)),
      tessera('tinta-2', 'calendar',
        stato.periodo === 'mese' ? 'Passaggi questo mese' : `Passaggi in ${giorni} giorni`,
        String(nelPeriodo.length),
        plurale(guide.size, 'persona alla guida', 'persone alla guida'),
        secchi),
      tessera('mio', 'euro', 'Il tuo saldo', firma(saldo),
        partite.length ? plurale(partite.length, 'conto in sospeso', 'conti in sospeso') : 'nessun conto in sospeso',
        serieDelSaldo(vociCon, oggi)),
      tessera(scoperti ? 'allerta' : '', 'info', 'Giorni scoperti', String(scoperti),
        scoperti ? `il primo: ${dataBreve(primoScoperto.giorno)}` : 'sette giorni tutti coperti',
        inArrivo.map(g => (g.rides.length ? 0 : 1))),
      tessera('', 'fuel', 'Carburante', eur(meseCorr.tot),
        'questo mese'
          + (delta === null ? '' : ` · ${delta >= 0 ? '+' : '−'}${Math.abs(delta)}% sul precedente`)
          + (meseCorr.n ? ` · ${eur(meseCorr.tot / meseCorr.n)} a passaggio` : ''),
        serieCarb),
    ].join('');
  }

  // ── L'occupazione della settimana ───────────────────────────────────────
  function schedaSettimana() {
    const g = sette(stato.avanti);
    const posti = g.reduce((s, x) => s + x.posti, 0);
    const presi = g.reduce((s, x) => s + x.presi, 0);
    return `<section class="scheda">
      <div class="scheda-testa">
        <div><h2>Occupazione settimanale</h2>
        <p>Posti presi sui posti offerti · ${presi}/${posti} nei sette giorni</p></div>
        <label class="scelta"><select id="dash-settimana" aria-label="Quali sette giorni">
          <option value="avanti"${stato.avanti ? ' selected' : ''}>Prossimi 7 giorni</option>
          <option value="dietro"${stato.avanti ? '' : ' selected'}>Ultimi 7 giorni</option>
        </select>${GIU}</label>
      </div>
      <div class="scheda-corpo grafico" id="grafico-settimana"></div>
      <div class="giorni">${g.map(x => `<span>${escapeHtml(giornoBreve(x.giorno))}</span>`).join('')}</div>
    </section>`;
  }

  // Il grafico si disegna dopo il montaggio perche' le sonde e il suggerimento si
  // appendono a lui. Due cose lo tengono onesto: **le sonde sono sette bottoni
  // veri**, non un ascolto del movimento del mouse, quindi il dato si raggiunge
  // col tasto di tabulazione e la percentuale sta nel nome accessibile; e **il
  // suggerimento e' sfilato dal flusso**, quindi non puo' allungare la scheda.
  function disegnaGrafico(root) {
    if (!root) return;
    const g = sette(stato.avanti);
    const W = 640, H = 200, P = { l: 26, r: 6, t: 8, b: 22 };
    const max = Math.max(...g.map(x => x.posti), 1);
    const x = (i) => P.l + (i / (g.length - 1)) * (W - P.l - P.r);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const cur = (get) => curva(g.map((r, i) => [x(i), y(get(r))]));
    const presi = cur(r => r.presi);
    const chiudi = (d) => `${d} L ${x(g.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;
    const pct = (r) => (r.posti ? Math.round((r.presi / r.posti) * 100) : null);

    // Due aree: i posti **offerti** sono il velo largo, i posti **presi** quello
    // pieno. La distanza fra le due e' il posto che nessuno ha preso, ed e' il
    // dato per cui questa scheda esiste.
    root.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="area" role="img"
        aria-label="Posti presi sui posti offerti, giorno per giorno">
      ${[0, 1, 2, 3, 4].map(n => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(n * max / 4)}" y2="${y(n * max / 4)}" class="griglia"/>`).join('')}
      <path d="${chiudi(cur(r => r.posti))}" class="area-offerti"/>
      <path d="${chiudi(presi)}" class="area-velo"/>
      <path d="${presi}" class="area-tratto"/>
      ${g.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.presi)}" r="4" class="punto"/>`).join('')}
    </svg>`;

    const fx = (i) => x(i) / W;
    const mezza = (W - P.l - P.r) / (g.length - 1) / 2 / W;
    const dice = (r) => (r.posti
      ? `${dataBreve(r.giorno)}: ${plurale(r.presi, 'posto preso', 'posti presi')} su ${r.posti} offerti, ${pct(r)}%`
      : `${dataBreve(r.giorno)}: nessun passaggio`);
    root.insertAdjacentHTML('beforeend',
      `<div class="bolla" hidden></div><div class="sonde">${g.map((r, i) => {
        const a = Math.max(0, fx(i) - mezza), b = Math.min(1, fx(i) + mezza);
        return `<button type="button" class="sonda" data-g="${i}"
          style="left:${(a * 100).toFixed(3)}%;width:${((b - a) * 100).toFixed(3)}%"
          aria-label="${escapeHtml(dice(r))}"></button>`;
      }).join('')}</div>`);

    const bolla = root.querySelector('.bolla');
    const punti = root.querySelectorAll('.punto');
    const mostra = (i) => {
      const r = g[i];
      bolla.innerHTML = `${escapeHtml(dataBreve(r.giorno))} · <b>${pct(r) === null ? '—' : pct(r) + '%'}</b><br>`
        + (r.posti ? `${r.presi} su ${r.posti} posti` : 'nessun passaggio');
      bolla.style.left = (fx(i) * 100).toFixed(3) + '%';
      bolla.style.top = ((y(r.presi) / H) * 100).toFixed(3) + '%';
      // Ai due estremi il riquadro non si centra: la scheda ha `overflow: hidden`
      // e la meta' che sborda verrebbe tagliata, non mostrata piu' in la'.
      bolla.classList.toggle('al-margine-sx', i === 0);
      bolla.classList.toggle('al-margine-dx', i === g.length - 1);
      bolla.hidden = false;
      punti.forEach((c, n) => c.classList.toggle('acceso', n === i));
    };
    const nascondi = () => {
      bolla.hidden = true;
      punti.forEach(c => c.classList.remove('acceso'));
    };
    for (const s of root.querySelectorAll('.sonda')) {
      const i = Number(s.dataset.g);
      s.addEventListener('pointerenter', () => mostra(i));
      s.addEventListener('focus', () => mostra(i));
      s.addEventListener('blur', nascondi);
    }
    root.querySelector('.sonde').addEventListener('pointerleave', nascondi);
  }

  // ── La ciambella dei turni ──────────────────────────────────────────────
  // Ha una finestra sua, piu' larga di quella in cima: «chi guida di solito» e'
  // una domanda diversa da «com'e' andato questo mese», e restringerle insieme
  // farebbe sparire chi guida poco.
  function schedaTurni() {
    const da = isoMeno(oggi, giorniDelPeriodo(stato.finestra, oggi) - 1);
    const conteggio = new Map();
    for (const r of passaggi) {
      if (r.ride_date < da || r.ride_date > oggi) continue;
      conteggio.set(r.driver_id, (conteggio.get(r.driver_id) || 0) + 1);
    }
    const turni = [...conteggio.entries()].sort((a, b) => b[1] - a[1]);
    const tot = turni.reduce((s, [, n]) => s + n, 0);
    const miei = conteggio.get(currentUser.id) ?? 0;

    const corpo = tot ? `<div class="scheda-corpo ciambella-riga">
        <div class="ciambella">${ciambellaSvg(turni.map(([id, n]) => [tinta(id), n]), tot)}</div>
        <ul class="legenda">${turni.slice(0, 5).map(([id, n]) => `<li>
          <span class="pt" style="background:${tinta(id)}"></span>
          <span class="lg-n">${escapeHtml(nomeCorto(id))}</span>
          <span class="lg-v">${n} <small>(${Math.round((n / tot) * 100)}%)</small></span></li>`).join('')}</ul>
      </div>`
      : '<div class="scheda-corpo senza-righe"><p class="riga-vuota">In questa finestra non ha guidato nessuno.</p></div>';

    return `<section class="scheda">
      <div class="scheda-testa"><div><h2>Distribuzione turni</h2></div>
        <label class="scelta"><select id="dash-finestra" aria-label="Finestra dei turni">
          <option value="30"${stato.finestra === '30' ? ' selected' : ''}>30 giorni</option>
          <option value="90"${stato.finestra === '90' ? ' selected' : ''}>90 giorni</option>
        </select>${GIU}</label>
      </div>
      ${corpo}
      <div class="scheda-piede">${tot
    ? `<b class="tuo">${Math.round((miei / tot) * 100)}%</b> dei turni a tuo carico`
    : 'Il registro dei turni parte dal primo passaggio pubblicato.'}</div>
    </section>`;
  }

  // ── I conti in sospeso ──────────────────────────────────────────────────
  // La barra sotto un nome dice **quanto pesa** quel conto rispetto al piu'
  // grosso in elenco: sette euro non si sa se sono molti finche' non si sa qual
  // e' il massimo.
  function schedaConti(quante) {
    // C26 — da cosa nasce il conto. Le voci sono state contate nello stesso giro
    // che ha prodotto il totale e stanno gia' qui: aprirle non chiede niente a
    // nessuno. Non si aprono **sotto** la riga — la scheda non scorre e quel che
    // sborda verrebbe tagliato — ma al posto dell'elenco, con la strada del
    // ritorno nella testa.
    if (stato.conto) {
      const voci = [...(vociCon.get(stato.conto) ?? [])]
        .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
      const netto = partite.find(p => p.id === stato.conto)?.v ?? 0;
      return `<section class="scheda" id="dash-conti">
        <div class="scheda-testa"><div><h2>${escapeHtml(nomePer.get(stato.conto) || 'Qualcuno')}</h2>
          <p>Da cosa nasce il conto</p></div>
          <button type="button" class="btn-tenue" id="conto-indietro">← Conti</button>
        </div>
        <div class="scheda-corpo righe">${voci.slice(0, quante).map(v => `<div class="riga">
          <span class="riga-chi"><b>${escapeHtml(v.testo)}</b><small>${escapeHtml(dataBreve(v.quando))}</small></span>
          <span class="riga-imp ${versoDi(v.importo)}">${escapeHtml(firma(v.importo))}</span>
        </div>`).join('')}</div>
        <div class="scheda-piede">${voci.length > quante
    ? `${plurale(voci.length - quante, 'altra voce', 'altre voci')} · ` : ''}Totale ${escapeHtml(firma(netto))}</div>
      </section>`;
    }

    const grosso = Math.max(...partite.map(p => Math.abs(p.v)), 1);
    const corpo = partite.length
      ? `<div class="scheda-corpo righe">${partite.slice(0, quante).map(p => {
        const n = quantiCon.get(p.id) || 0;
        const da = primaCon.get(p.id);
        return `<div class="riga">
          <span class="av" style="background:${coloreDi(p.id)}">${escapeHtml(iniziale(nomePer.get(p.id)))}</span>
          <button type="button" class="riga-chi chi" data-dettaglio="${p.id}"
                  title="Da cosa nasce questo conto">
            <b>${escapeHtml(nomePer.get(p.id) || 'Qualcuno')}</b>
            <small title="${escapeHtml(plurale(n, 'passaggio', 'passaggi'))}${da ? ` · dal ${escapeHtml(dataSenzaGiorno(da))}` : ''}">${escapeHtml(plurale(n, 'passaggio', 'passaggi'))}${da ? ` · dal ${escapeHtml(dataSenzaGiorno(da))}` : ''}</small>
            <span class="barra ${versoDi(p.v)}"><i style="width:${(Math.abs(p.v) / grosso * 100).toFixed(1)}%"></i></span>
          </button>
          <span class="riga-imp ${versoDi(p.v)}">${escapeHtml(firma(p.v))}</span>
          <button type="button" class="btn-riga" data-salda="${p.id}" data-verso="${p.v >= 0 ? 'ricevuto' : 'pagato'}"
                  data-quanto="${Math.abs(p.v).toFixed(2)}"
                  title="${p.v >= 0 ? 'Segna che ti ha pagato' : 'Segna che l\'hai pagato'}">${p.v >= 0 ? 'Ricevuto' : 'Pagato'}</button>
        </div>`;
      }).join('')}</div>`
      : `<div class="scheda-corpo senza-righe"><p class="riga-vuota">Nessun conto in sospeso. Compaiono qui quando
        chi guida indica un «€ a testa».</p></div>`;

    return `<section class="scheda" id="dash-conti">
      <div class="scheda-testa"><div><h2>Conti in sospeso</h2></div>
        ${partite.length ? `<button type="button" class="btn-tenue" id="salda-tutto">Salda tutto (${partite.length})</button>` : ''}
      </div>
      ${corpo}
      <div class="scheda-piede">${partite.length > quante
    ? `${plurale(partite.length - quante, 'altro conto aperto', 'altri conti aperti')} · ` : ''}Gli importi li vedete solo tu e la persona interessata</div>
    </section>`;
  }

  // ── Attivita' recente ───────────────────────────────────────────────────
  function schedaAttivita(quante) {
    const corpo = eventi.length
      ? `<div class="scheda-corpo righe">${eventi.slice(0, quante).map(e => {
        const chi = nomeCorto(e.attore);
        return `<div class="riga">
          <span class="av" style="background:${tinta(e.attore)}">${escapeHtml(iniziale(chi))}</span>
          <span class="riga-chi"><span class="l1"><b>${escapeHtml(chi)}</b> ${ETICHETTA_EVENTO[e.tipo] || escapeHtml(e.tipo)}</span></span>
          <span class="riga-quando">${escapeHtml(quandoBreve(e.quando))} fa</span>
        </div>`;
      }).join('')}</div>`
      : `<div class="scheda-corpo senza-righe"><p class="riga-vuota">Il registro parte da quando è stato acceso:
        qui comparirà quello che succede da adesso in poi.</p></div>`;

    return `<section class="scheda">
      <div class="scheda-testa"><div><h2>Attività recente</h2></div>
        <button type="button" class="btn-tenue" data-vai="history">Storico</button>
      </div>
      ${corpo}
      <div class="scheda-piede">${eventi.length > quante
    ? `${plurale(eventi.length - quante, 'altra voce', 'altre voci')} · ` : ''}Dal giorno in cui è stato acceso</div>
    </section>`;
  }

  // ── I prossimi passaggi ─────────────────────────────────────────────────
  // Era un riquadro su un passaggio solo, ed e' un elenco: il secondo e il terzo
  // erano gia' scaricati, e «chi guida domani» non si ferma al primo.
  function schedaProssimi(quante) {
    const corpo = futuri.length
      ? `<div class="scheda-corpo righe">${futuri.slice(0, quante).map(r => {
        const liberi = Math.max(0, (r.seats || 0) - r.seat_claims.length);
        const facce = r.seat_claims.slice(0, 3);
        const piu = r.seat_claims.length - facce.length;
        const qualifica = `${(r.depart_time || '').slice(0, 5)} · `
          + (mio(r.driver_id) ? 'guidi tu' : `guida ${nomeCorto(r.driver_id)}`)
          + ` · ${plurale(liberi, 'posto libero', 'posti liberi')}`;
        return `<div class="riga">
          <span class="data"><b>${Number(r.ride_date.slice(8, 10))}</b><small>${escapeHtml(meseCorto(r.ride_date))}</small></span>
          <span class="riga-chi">
            <b>${escapeHtml(r.origin || '—')} → ${escapeHtml(r.destination || '')}</b>
            <small title="${escapeHtml(qualifica)}">${escapeHtml(qualifica)}</small>
          </span>
          <span class="facce">${facce.map(c => {
    const id = c.passenger_id;
    const nome = id ? nomeCorto(id) : nomeOccupante(c);
    return `<i class="av av-piccolo" style="background:${id ? tinta(id) : 'var(--ink-soft)'}" title="${escapeHtml(nome)}${id ? '' : ' (ospite)'}">${escapeHtml(iniziale(nome))}</i>`;
  }).join('')}${piu ? `<i class="av av-piccolo av-piu">+${piu}</i>` : ''}</span>
        </div>`;
      }).join('')}</div>`
      : `<div class="scheda-corpo senza-righe"><p class="riga-vuota">Nessun passaggio in programma.
        Guidi tu? Pubblicalo dalla vista Passaggi.</p></div>`;

    return `<section class="scheda">
      <div class="scheda-testa"><div><h2>Prossimi passaggi</h2></div>
        <button type="button" class="btn-tenue" data-vai="home">Passaggi</button>
      </div>
      ${corpo}
      <div class="scheda-piede">${futuri.length > quante
    ? `${plurale(futuri.length - quante, 'altro passaggio', 'altri passaggi')} · ` : ''}${plurale(liberiTot, 'posto libero in tutto', 'posti liberi in tutto')}</div>
    </section>`;
  }

  // Le cose che si **fanno** dal riepilogo e che da qui non si potrebbero fare
  // altrimenti. Sono flex, quindi quattro riempiono la riga come tre.
  function azioni() {
    return `<div class="azioni">${AZIONI_RIEPILOGO.map(([icona, testo, azione]) =>
      `<button type="button" class="az" data-azione="${azione}"><span class="o">${iconaSvg(icona)}</span><span class="t">${escapeHtml(testo)}</span></button>`).join('')}</div>`;
  }

  // ══ I FILI ═══════════════════════════════════════════════════════════════
  function collega() {
    // I tre controlli scrivono nello stato e fanno ridisegnare tutto.
    const lega = (id, chiave, leggi) => box.querySelector('#' + id)?.addEventListener('change', (e) => {
      stato[chiave] = leggi(e.target.value);
      disegna();
    });
    lega('dash-periodo', 'periodo', v => v);
    lega('dash-finestra', 'finestra', v => v);
    lega('dash-settimana', 'avanti', v => v === 'avanti');

    // I riquadri portano da qualche parte: nessun bottone qui sopra e' finto.
    box.querySelectorAll('[data-vai]').forEach(b =>
      b.addEventListener('click', () => switchView(b.dataset.vai)));

    box.querySelectorAll('[data-dettaglio]').forEach(b =>
      b.addEventListener('click', () => { stato.conto = b.dataset.dettaglio; disegna(); }));
    box.querySelector('#conto-indietro')?.addEventListener('click', () => { stato.conto = null; disegna(); });

    // ── Segnare un pagamento ──────────────────────────────────────────────
    // La tabella `pagamenti` esiste dalla 022 e il saldo la sottrae gia': mancava
    // solo il gesto, e senza quello il numero poteva solo crescere. L'importo
    // arriva precompilato con quanto resta, perche' nove volte su dieci si salda
    // tutto.
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

    // ── C25: saldare tutto in un colpo ────────────────────────────────────
    // N righe in `pagamenti`, **un solo insert**: o passano tutte o non passa
    // nessuna. Con una riga per volta un rifiuto a meta' strada lascerebbe il
    // saldo per aria, cioe' esattamente lo stato che questo bottone deve chiudere.
    box.querySelector('#salda-tutto')?.addEventListener('click', async () => {
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
      // Il conto del mese: i numeri ci sono gia' tutti, mancava il modo di
      // mandarli. Stava nel piede dei conti, dove la riga e' una frase sola e un
      // bottone in piu' la troncava.
      if (a === 'conto') {
        const righe = [`WeTransport · ${nomeComitiva()} · ${meseInLettere(oggi)}`,
          `Carburante diviso questo mese: ${eur(meseCorr.tot)}`,
          `Il mio saldo: ${firma(saldo)}`, ''];
        for (const p of partite) {
          righe.push(p.v >= 0
            ? `${nomePer.get(p.id) || 'Qualcuno'} mi deve ${eur(p.v)}`
            : `Devo ${eur(-p.v)} a ${nomePer.get(p.id) || 'qualcuno'}`);
        }
        condividi(righe.join('\n'));
      }
    }));
  }
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

// Le cose che si **fanno** dal riepilogo e che da qui non si potrebbero fare
// altrimenti: icona, etichetta, azione.
// Le etichette non hanno piu' un `<br>` in mezzo: dove i bottoni stanno in riga
// andrebbe tolto, dove stanno in colonna il testo va a capo da solo.
// «Conto del mese» e' arrivata qui dal piede dei conti: quel piede e' una frase
// sola su una riga sola, e un bottone in mezzo la troncava.
const AZIONI_RIEPILOGO = [
  ['plus', 'Pubblica un passaggio', 'offerta'],
  ['walk', 'Cerco un passaggio', 'richiesta'],
  ['users', 'Invita un membro', 'invita'],
  ['share', 'Conto del mese', 'conto'],
];

// La freccia delle tendine. Non sta nel foglio degli oggetti (`#i-…`) perche' non
// e' un'icona del vocabolario dell'app: e' un pezzo del controllo, e sta dove
// stanno le altre parti dei controlli.
const GIU = '<svg class="giu" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.8" stroke-linecap="round"><path d="M5.5 8 10 12.5 14.5 8"/></svg>';

// Le righe che entrano in una scheda cambiano a 1280px, e quando si attraversa
// quella soglia il riquadro va ridisegnato o il piede conta righe che adesso ci
// stanno. Il filo si attacca **una volta sola**, qui: dentro `disegnaRiepilogo`
// se ne attaccherebbe uno nuovo a ogni apertura della vista, e dopo dieci giri
// il ridisegno girerebbe dieci volte. `matchMedia` e non `resize`, perche'
// l'unica cosa che cambia e' la soglia: cosi' non si ridisegna a ogni pixel.
let ridisegnaRiepilogo = null;
window.matchMedia('(max-width: 1279px)').addEventListener('change', () => ridisegnaRiepilogo?.());

// Quanti giorni vale un periodo scelto. «Questo mese» non e' «ultimi 30 giorni» e
// non va confuso con lui: il 10 del mese sono dieci giorni, non trenta.
function giorniDelPeriodo(scelta, iso) {
  return scelta === 'mese' ? Number(iso.slice(8, 10)) : Number(scelta);
}

// ── I conti fra me e gli altri, con l'aritmetica di saldo_con() ─────────────
// Un giro solo: il netto con ognuno, quanti passaggi lo compongono, da quando, e
// le voci che lo spiegano. Il segno e' sempre dal mio punto di vista: positivo =
// quella riga fa salire il mio credito. Cosi' la somma delle voci **e'** il
// netto, per costruzione, e non un secondo conto che puo' divergere dal primo.
function faiIConti(passaggi, pagamenti) {
  const dovutoDaMe = new Map();   // guidatore -> quanto gli devo
  const dovutoAMe = new Map();    // passeggero -> quanto mi deve
  const quantiCon = new Map();    // altra persona -> quanti passaggi in ballo
  const primaCon = new Map();     // altra persona -> il piu' vecchio dei passaggi
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

  for (const r of passaggi) {
    const quota = Number(r.fuel_per_person) || 0;
    if (!quota) continue;
    for (const c of r.seat_claims) {
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
  return { partite, saldo, quantiCon, primaCon, vociCon };
}

// La linea del saldo, giorno per giorno sugli ultimi trenta. E' **cumulativa**,
// perche' un saldo lo e': il valore di quindici giorni fa e' quello che era
// dovuto allora, non quanto si e' mosso quel giorno.
// Le voci arrivano da `faiIConti`, non da un secondo giro sui passaggi: portano
// gia' il segno dal punto di vista di chi guarda e la loro data, quindi questa
// linea e il numero sopra di lei non possono divergere.
function serieDelSaldo(vociCon, iso) {
  const delta = new Map();
  for (const voci of vociCon.values()) {
    for (const v of voci) {
      const g = String(v.quando).slice(0, 10);
      delta.set(g, (delta.get(g) || 0) + v.importo);
    }
  }
  // Quel che e' successo prima della finestra non si disegna, ma si somma: la
  // linea parte da dove il saldo era, non da zero.
  const inizio = isoMeno(iso, 29);
  let corsa = 0;
  for (const [g, v] of delta) if (g < inizio) corsa += v;
  return Array.from({ length: 30 }, (_, i) => {
    corsa += delta.get(todayISO(-29 + i)) ?? 0;
    return Math.round(corsa * 100) / 100;
  });
}

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

// Uno dei quattro numeri in cima: icona, etichetta, valore, la riga che lo
// qualifica, e — quando esiste davvero — la linea che ne dice l'andamento.
// `serie` e' l'ultimo argomento e non il primo perche' e' l'unico che puo'
// mancare: una tessera senza linea e' una tessera, una tessera con una linea
// inventata e' una bugia piccola che si legge come un dato.
function tessera(cls, icona, etichetta, valore, nota, serie = null) {
  // **Una linea piatta non e' una linea.** La condizione era «c'e' almeno un
  // valore diverso da zero», e su una comitiva senza passaggi i sette giorni
  // scoperti valgono tutti 1: veniva fuori un trattino dritto in fondo alla
  // tessera, rosso, che sembrava un difetto di disegno e non diceva niente.
  // Serve **una differenza**, non un valore: due punti diversi o niente.
  const disegnabile = serie && new Set(serie).size > 1;
  // Senza linea la tessera non le tiene il posto: la riga `1fr` in fondo restava
  // vuota e lasciava un buco alto quanto la linea che non c'e'.
  return `<article class="k${cls ? ' ' + cls : ''}${disegnabile ? '' : ' senza-linea'}">
    <div class="k-alto"><span class="k-ico">${iconaSvg(icona, 18)}</span>
      <span class="k-lab" title="${escapeHtml(etichetta)}">${escapeHtml(etichetta)}</span></div>
    <div class="k-val">${escapeHtml(valore)}</div>
    <div class="k-nota" title="${escapeHtml(nota)}">${escapeHtml(nota)}</div>
    ${disegnabile ? lineaTessera(serie) : ''}
  </article>`;
}

// La linea di una tessera. Il minimo scende sotto lo zero solo se un valore ci
// va davvero: per una serie di conteggi la base resta lo zero, per il saldo
// cumulativo — che puo' essere in rosso — no.
function lineaTessera(vals, w = 210, h = 40) {
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const x = (i) => (i / Math.max(1, vals.length - 1)) * w;
  const y = (v) => h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
  const d = curva(vals.map((v, i) => [x(i), y(v)]));
  return `<svg class="linea" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d} L ${w} ${h} L 0 ${h} Z" class="linea-velo"/><path d="${d}" class="linea-tratto"/></svg>`;
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

// Curve di Bézier con i punti di controllo sulla verticale di mezzo fra due
// punti: e' la curva morbida piu' semplice che non puo' oltrepassare i valori
// veri, quindi non racconta un massimo che non c'e'. La usano le linee delle
// tessere e le due aree del grafico settimanale: erano due copie della stessa
// formula, e si erano gia' scostate di un arrotondamento.
function curva(punti) {
  let d = `M ${punti[0][0].toFixed(2)} ${punti[0][1].toFixed(2)}`;
  for (let i = 1; i < punti.length; i++) {
    const [x0, y0] = punti[i - 1], [x1, y1] = punti[i];
    const xm = ((x0 + x1) / 2).toFixed(2);
    d += ` C ${xm} ${y0.toFixed(2)} ${xm} ${y1.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return d;
}

// La ciambella dei turni. Ogni fetta e' un arco di tratteggio su un cerchio solo:
// niente archi calcolati a mano, e il distacco fra due fette sono tre unita' di
// vuoto tolte alla lunghezza, non un secondo cerchio messo sopra.
function ciambellaSvg(fette, tot) {
  const R = 54, C = 2 * Math.PI * R;
  let off = 0;
  const archi = fette.map(([colore, n]) => {
    const len = (n / tot) * C;
    const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${colore}" stroke-width="22"
      stroke-dasharray="${(len - 3).toFixed(2)} ${(C - len + 3).toFixed(2)}"
      stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"/>`;
    off += len;
    return s;
  }).join('');
  return `<svg viewBox="0 0 140 140" role="img" aria-label="Turni di guida per persona">
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="22"/>
    ${archi}
    <text x="70" y="68" class="ciambella-n" text-anchor="middle">${tot}</text>
    <text x="70" y="84" class="ciambella-lab" text-anchor="middle">passaggi</text>
  </svg>`;
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

// Il mese in tre lettere, per il quadratino della data dei prossimi passaggi.
const MESI_CORTI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const meseCorto = (iso) => MESI_CORTI[Number(iso.slice(5, 7)) - 1] || '';

// Data senza il giorno della settimana: «7 ago». Serve a «dal …» nei conti, e
// la differenza non e' di gusto: «dal dom 23 ago» non entra nella riga nemmeno a
// 1600px di finestra, e il giorno della settimana di quando e' nato un conto non
// lo usa nessuno — «da quando» e' un mese e un numero. Dove il giorno serve
// davvero, come «il primo: lun 14 set» dei giorni scoperti, resta `dataBreve`.
function dataSenzaGiorno(iso) {
  if (!iso) return '—';
  return new Date(String(iso).slice(0, 10) + 'T00:00:00')
    .toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

// Data breve, per i riquadri: «gio 7 ago».
// Il taglio a dieci caratteri non e' una precauzione: `pagamenti.quando` e' un
// istante completo, e `'2026-09-02T10:14:00+00:00' + 'T00:00:00'` non e' una
// data — il dettaglio di un conto scriveva «Invalid Date» su ogni riga di
// pagamento. Chi passa un giorno secco non se ne accorge.
function dataBreve(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
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
