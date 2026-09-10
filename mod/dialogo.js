// Il dialogo dell'app al posto di prompt() e confirm()
// Cantiere C17: queste righe stavano in `app.js`, che ne aveva 4400. Sono le stesse,
// spostate; quello che si aggiunge sono le due liste, in testa e in fondo.

// --- Dialog custom (sostituisce prompt(): funziona anche nei browser in-app) ---
const appDialog = document.getElementById('app-dialog');
const dialogInput = document.getElementById('dialog-input');
let dialogResolve = null;

// Condividere: era scritto tre volte identico — invito al gruppo, giornata, singolo
// passaggio. Stessa scelta, stesso ripiego su WhatsApp, stesso `catch {}` per l'utente
// che chiude il foglio di sistema. Una funzione sola, e le tre chiamate diventano una
// riga ciascuna.
async function condividi(testo, url) {
  if (navigator.share) {
    try { await navigator.share({ title: 'WeTransport', text: testo, ...(url ? { url } : {}) }); } catch { /* chiuso */ }
    return;
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(testo), '_blank', 'noopener');
}

// **Una finestra sola per chiedere.** `ask()` usava questo dialogo disegnato, e le
// sette conferme usavano `confirm()` del browser: due vocabolari nella stessa app,
// e quello nativo e' il peggiore dei due. Non si puo' scrivere sopra, quindi il
// bottone dice «OK» dove servirebbe «Elimina l'account»; mostra l'indirizzo del sito
// in cima («wetransport.netlify.app dice…»), che dentro un'app installata sembra la
// finestra di un altro programma; e nel browser dentro Instagram o WhatsApp puo'
// arrivare soppresso, cioe' l'azione distruttiva parte o non parte senza che nessuno
// abbia risposto. Ora ce n'e' una, e il suo bottone dice cosa fa.
const dialogTesto = document.getElementById('dialog-text');
const dialogOk = document.getElementById('dialog-ok');

// `scelte` e' un elenco di [valore, etichetta]: le risposte che si danno quasi
// sempre diventano un tocco solo, e il campo resta li' sotto per tutte le altre.
// Serve dove la risposta si da' col telefono in mano e di fretta — annunciare un
// ritardo mentre si esce di casa in ritardo (C30) e' il caso limite.
function apriDialogo({ titolo, testo = '', campo = false, azione = 'Conferma', pericolo = false, placeholder = '', value = '', type = 'text', scelte = [] }) {
  document.getElementById('dialog-title').textContent = titolo;
  dialogTesto.textContent = testo;
  dialogTesto.style.display = testo ? '' : 'none';
  const boxScelte = document.getElementById('dialog-scelte');
  boxScelte.innerHTML = '';
  boxScelte.classList.toggle('hidden', scelte.length === 0);
  for (const [val, etichetta] of scelte) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'filtro';
    b.textContent = etichetta;
    b.addEventListener('click', () => chiudiDialogo(String(val)));
    boxScelte.appendChild(b);
  }
  dialogInput.classList.toggle('hidden', !campo);
  dialogInput.type = type;
  dialogInput.placeholder = placeholder;
  dialogInput.value = value;
  dialogOk.textContent = azione;
  // Un'azione che distrugge non ha lo stesso bottone di una che salva.
  dialogOk.classList.toggle('btn-primary', !pericolo);
  dialogOk.classList.toggle('btn-pericolo', pericolo);
  appDialog.showModal();
  // Il fuoco va sul campo se c'e', altrimenti su «Annulla»: su una conferma
  // distruttiva la prima cosa che si tocca a occhi chiusi dev'essere l'uscita.
  (campo ? dialogInput : document.getElementById('dialog-cancel')).focus();
  return new Promise((resolve) => { dialogResolve = resolve; });
}

function ask(title, { text = '', placeholder = '', value = '', type = 'text', scelte = [] } = {}) {
  return apriDialogo({ titolo: title, testo: text, campo: true, placeholder, value, type, scelte });
}

// Torna `true` solo se si e' scelto davvero: chiudere con Esc o toccare fuori vale no.
function conferma(titolo, { testo = '', azione = 'Conferma', pericolo = false } = {}) {
  return apriDialogo({ titolo, testo, campo: false, azione, pericolo });
}

function chiudiDialogo(esito) {
  appDialog.close();
  dialogResolve?.(esito);
  dialogResolve = null;
}

document.getElementById('dialog-form').addEventListener('submit', (e) => {
  e.preventDefault();
  chiudiDialogo(dialogInput.classList.contains('hidden') ? true : dialogInput.value.trim());
});
document.getElementById('dialog-cancel').addEventListener('click', () => {
  chiudiDialogo(dialogInput.classList.contains('hidden') ? false : null);
});
appDialog.addEventListener('cancel', () => {
  dialogResolve?.(dialogInput.classList.contains('hidden') ? false : null);
  dialogResolve = null;
});

export {
  ask,
  condividi,
  conferma,
};
