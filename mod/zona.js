// La zona, il garage, le auto di chi guida
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

import { ask, conferma } from './dialogo.js';
import { proponiQuota } from './gruppi.js';
import { currentUser, friendlyError, toast } from './nucleo.js';
import { loadRides } from './passaggi.js';
import { bloccaSeSospeso } from './persone.js';
import { supabase } from './supabase.js';

// --- Passaggi in zona (cantiere C9) ---
// Le coordinate arrivano solo da navigator.geolocation: niente servizio di geocodifica,
// che sarebbe un terzo a cui si dice dove vanno gli utenti (decisione D6). Il nome del
// luogo resta il testo libero che c'era gia'.

let partenza = null;   // { lat, lon } del passaggio che si sta pubblicando
// Lo azzera anche il modulo che pubblica un passaggio, e per la stessa ragione dei
// tredici setter del nucleo: a un `let` importato non si assegna.
function setPartenza(v) { partenza = v; }
let miaZona = null;    // { lat, lon, nome } dal profilo
// La mette l'accesso, leggendo il profilo: a un `let` importato non si assegna.
function setMiaZona(v) { miaZona = v; }

function posizione() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Questo browser non sa dire dove sei.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Non hai dato il permesso di leggere la posizione.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

document.getElementById('ride-qui').addEventListener('click', async () => {
  const esito = document.getElementById('ride-posizione');
  esito.textContent = 'Cerco…';
  try {
    partenza = await posizione();
    esito.textContent = 'Partenza segnata su questa posizione.';
  } catch (e) {
    partenza = null;
    esito.textContent = e.message;
  }
});

// ══════════════════════════════════════════════════════════════════════════
// C33 — Il garage.
//
// Le auto sono di una persona, non di una comitiva: la stessa Panda porta gente
// in due gruppi diversi. Stanno quindi nel Profilo e non nella Comitiva, e le
// legge chi condivide un gruppo — la regola dei profili (D2).
// ══════════════════════════════════════════════════════════════════════════
let mieAuto = [];

async function caricaAuto() {
  const { data, error } = await supabase
    .from('auto')
    .select('id, nome, posti, modello, colore, consumo_km_l, predefinita')
    .eq('user_id', currentUser.id)
    .order('predefinita', { ascending: false })
    .order('creata_il', { ascending: true });
  if (error) { console.error('auto:', error); }
  mieAuto = data ?? [];
  riempiSceltaAuto();
}

// Il menu nel modulo di pubblicazione. Scegliere un'auto porta con se' i posti:
// e' tutto il senso del cantiere, e farlo qui invece che a mano evita la
// combinazione senza senso «la Panda da 4, con 6 posti».
function riempiSceltaAuto() {
  const sel = document.getElementById('ride-auto');
  const lab = document.getElementById('ride-auto-label');
  lab.classList.toggle('hidden', mieAuto.length === 0);
  sel.innerHTML = '';
  if (!mieAuto.length) return;
  const vuota = document.createElement('option');
  vuota.value = '';
  vuota.textContent = 'Nessuna';
  sel.appendChild(vuota);
  for (const a of mieAuto) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.nome;
    if (a.predefinita) o.selected = true;
    sel.appendChild(o);
  }
  applicaAutoScelta();
}

function autoScelta() {
  const id = document.getElementById('ride-auto')?.value;
  return id ? mieAuto.find(a => a.id === id) ?? null : null;
}

function applicaAutoScelta() {
  const a = autoScelta();
  if (a) document.getElementById('ride-seats').value = String(a.posti);
  // Cambiare auto cambia i posti e puo' cambiare il consumo: la quota proposta
  // (C34) dipende da entrambi, e ricalcolarla qui e' l'unico modo perche' non
  // resti indietro di un'auto quando il menu si riempie da solo.
  proponiQuota();
}

document.getElementById('ride-auto').addEventListener('change', applicaAutoScelta);

function descriviAuto(a) {
  return [a.modello, a.colore].filter(Boolean).join(' ') || null;
}

function renderAuto() {
  const box = document.getElementById('auto-list');
  box.innerHTML = '';
  if (!mieAuto.length) {
    const p = document.createElement('p');
    p.className = 'form-hint';
    p.textContent = 'Nessuna auto salvata: pubblichi come prima, scrivendo i posti ogni volta.';
    box.appendChild(p);
    return;
  }
  for (const a of mieAuto) {
    const riga = document.createElement('div');
    riga.className = 'auto-riga';
    const testo = document.createElement('div');
    testo.className = 'auto-testo';
    const nome = document.createElement('b');
    nome.textContent = a.nome + (a.predefinita ? ' · predefinita' : '');
    testo.appendChild(nome);
    const sotto = document.createElement('small');
    sotto.textContent = [
      `${a.posti} ${a.posti === 1 ? 'posto' : 'posti'}`,
      descriviAuto(a),
      a.consumo_km_l ? `${a.consumo_km_l} km/l` : null,
    ].filter(Boolean).join(' · ');
    testo.appendChild(sotto);
    riga.appendChild(testo);

    if (!a.predefinita) {
      const pred = document.createElement('button');
      pred.className = 'btn btn-ghost btn-small';
      pred.textContent = 'Predefinita';
      pred.addEventListener('click', async () => {
        // Due passaggi e non uno: l'indice parziale ammette **una** predefinita per
        // persona, quindi accenderne una senza prima spegnere l'altra viene rifiutato.
        await supabase.from('auto').update({ predefinita: false })
          .eq('user_id', currentUser.id).eq('predefinita', true);
        const { error } = await supabase.from('auto').update({ predefinita: true }).eq('id', a.id);
        if (error) { toast(friendlyError(error)); return; }
        await caricaAuto();
        renderAuto();
      });
      riga.appendChild(pred);
    }

    const mod = document.createElement('button');
    mod.className = 'btn btn-ghost btn-small';
    mod.textContent = 'Modifica';
    mod.addEventListener('click', () => modificaAuto(a));
    riga.appendChild(mod);

    const via = document.createElement('button');
    via.className = 'btn btn-ghost btn-small btn-danger';
    via.textContent = 'Togli';
    via.addEventListener('click', async () => {
      if (!await conferma(`Togliere "${a.nome}" dal garage?`, {
        // `on delete set null` sulla colonna di `rides`: e' il motivo per cui questa
        // frase si puo' scrivere, e va detta perche' altrimenti nessuno la crede.
        testo: 'I passaggi già pubblicati con questa auto restano, e restano i conti della benzina. Sparisce solo dal menu quando pubblichi.',
        azione: 'Togli l\'auto',
        pericolo: true,
      })) return;
      const { error } = await supabase.from('auto').delete().eq('id', a.id);
      if (error) { toast(friendlyError(error)); return; }
      await caricaAuto();
      renderAuto();
    });
    riga.appendChild(via);
    box.appendChild(riga);
  }
}

// Una domanda per volta, con i dialoghi che l'app ha gia'. Un modulo intero per
// cinque campi facoltativi sarebbe una schermata in piu' da disegnare e mantenere
// per una cosa che si compila una volta nella vita dell'auto.
async function modificaAuto(a) {
  const nuova = !a;
  const nome = await ask(nuova ? 'Come la chiami?' : 'Nome dell\'auto', {
    text: 'Il nome che vedi tu nel menu quando pubblichi. «La mia», «Panda», «Quella di papà».',
    value: a?.nome ?? '', placeholder: 'Panda',
  });
  if (!nome) return;
  const posti = await ask('Quanti posti per i passeggeri?', {
    text: 'Senza contare il tuo. È il numero di sedili che si possono prenotare.',
    value: String(a?.posti ?? 4), type: 'number',
    scelte: [[3, '3'], [4, '4'], [5, '5']],
  });
  if (posti === null) return;
  const n = Number(posti);
  if (!(n >= 1 && n <= 6)) { toast('Da 1 a 6 posti.'); return; }
  const modello = await ask('Che modello è?', {
    text: 'Facoltativo, e serve a chi ti aspetta: è metà di «cerca la Panda blu».',
    value: a?.modello ?? '', placeholder: 'Fiat Panda',
  });
  if (modello === null) return;
  const colore = await ask('Di che colore?', {
    text: 'Facoltativo. È l\'altra metà, ed è quella che si vede da lontano.',
    value: a?.colore ?? '', placeholder: 'blu',
  });
  if (colore === null) return;
  const consumo = await ask('Quanti chilometri con un litro?', {
    text: 'Facoltativo. Serve solo a farti proporre il «€ a testa» invece di inventarlo ogni volta.',
    value: a?.consumo_km_l ? String(a.consumo_km_l) : '', placeholder: '15', type: 'number',
  });
  if (consumo === null) return;
  const km = consumo === '' ? null : Number(String(consumo).replace(',', '.'));
  if (km !== null && !(km >= 3 && km <= 40)) { toast('Un consumo fra 3 e 40 km/l.'); return; }

  const riga = {
    nome: nome.slice(0, 30),
    posti: n,
    modello: modello.trim().slice(0, 40) || null,
    colore: colore.trim().slice(0, 20) || null,
    consumo_km_l: km,
  };
  const { error } = nuova
    ? await supabase.from('auto').insert({
        ...riga, user_id: currentUser.id, predefinita: mieAuto.length === 0,
      })
    : await supabase.from('auto').update(riga).eq('id', a.id);
  if (error) { toast(friendlyError(error)); return; }
  toast(nuova ? `"${riga.nome}" è nel garage.` : 'Auto aggiornata.');
  await caricaAuto();
  renderAuto();
}

document.getElementById('auto-nuova').addEventListener('click', () => modificaAuto(null));

function renderZona() {
  const stato = document.getElementById('zona-stato');
  stato.textContent = miaZona
    ? `Impostata${miaZona.nome ? ` su ${miaZona.nome}` : ''}: vedi i passaggi che partono entro ${RAGGIO_ZONA_KM} km.`
    : 'Non impostata: non ricevi passaggi da fuori la tua comitiva, a parte quelli aperti a chiunque.';
  document.getElementById('zona-togli').classList.toggle('hidden', !miaZona);
}

const RAGGIO_ZONA_KM = 25; // deve restare uguale a raggio_zona_km() nella migrazione 014

document.getElementById('zona-imposta').addEventListener('click', async () => {
  if (bloccaSeSospeso('cambiare la tua zona')) return;
  const stato = document.getElementById('zona-stato');
  stato.textContent = 'Cerco…';
  let punto;
  try {
    punto = await posizione();
  } catch (e) { stato.textContent = e.message; return; }
  const nome = await ask('Come si chiama questa zona?', {
    text: 'Solo per te: serve a ricordarti quale punto hai segnato.',
    placeholder: 'Es. Sesto San Giovanni',
  });
  if (nome === null) { renderZona(); return; }
  const { error } = await supabase.from('profiles')
    .update({ zona_lat: punto.lat, zona_lon: punto.lon, zona_nome: nome || null })
    .eq('id', currentUser.id);
  if (error) { toast(friendlyError(error)); renderZona(); return; }
  miaZona = { ...punto, nome: nome || null };
  renderZona();
  toast('Zona impostata.');
  loadRides();
});

document.getElementById('zona-togli').addEventListener('click', async () => {
  const { error } = await supabase.from('profiles')
    .update({ zona_lat: null, zona_lon: null, zona_nome: null }).eq('id', currentUser.id);
  if (error) { toast(friendlyError(error)); return; }
  miaZona = null;
  renderZona();
  toast('Zona rimossa.');
  loadRides();
});

export {
  autoScelta,
  caricaAuto,
  descriviAuto,
  setMiaZona,
  partenza,
  posizione,
  renderAuto,
  renderZona,
  setPartenza,
};
