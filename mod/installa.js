// L'invito a installare l'app
//
// C12 ha reso l'app installabile — manifest, service worker, guscio offline — e poi
// **non l'ha mai proposto a nessuno**: in tutta l'interfaccia non c'era una riga che
// dicesse che si puo' fare. Chi non conosce il menu del browser non lo scopre.
//
// Il riquadro nella colonna e' il posto che gli e' stato dato (C51, al posto
// dell'«Upgrade to Pro» della schermata di riferimento), e questa e' la sua logica.
//
// **Tre strade, non una.** I browser non sono d'accordo su come si installa una PWA:
//
// 1. Chrome e i suoi mandano `beforeinstallprompt`, e allora c'e' un vero dialogo da
//    aprire. Va **catturato appena parte**, perche' l'evento arriva una volta sola e
//    non aspetta che qualcuno sia pronto ad ascoltarlo: per questo la cattura sta in
//    testa al modulo e non dentro `collegaPromo`.
// 2. Safari, su iPhone e su Mac, non lo manda **mai**. Non e' un errore e non e' una
//    mancanza da nascondere: li' si installa a mano, e l'unica cosa utile che si puo'
//    fare e' dire quali due tocchi servono. Una PWA che su iOS non dice niente e'
//    una PWA che su iOS non si installa.
// 3. Chi ce l'ha gia' installata non deve vedere niente. La prova non e' una
//    bandierina salvata da noi — si cancella, e mentirebbe — ma come la pagina e'
//    aperta adesso: `display-mode: standalone`, cioe' senza la barra del browser.
let dialogo = null;
window.addEventListener('beforeinstallprompt', (e) => {
  // Senza questo, Chrome mostra la sua barretta quando decide lui, e il riquadro
  // nella colonna diventa il secondo invito a fare la stessa cosa.
  e.preventDefault();
  dialogo = e;
});

// Aperta come app: niente barra del browser. `navigator.standalone` e' la versione
// di Safari su iPhone, che `display-mode` non copre nelle versioni piu' vecchie.
function giaInstallata() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || navigator.standalone === true;
}

// Le due istruzioni che servono dove il dialogo non esiste. Sono poche di proposito:
// dire «apri il menu del browser» non aiuta nessuno, dire quale voce cercare si'.
function aMano() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'Tocca Condividi in basso, poi «Aggiungi alla schermata Home».';
  }
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    return 'Dal menu Archivio scegli «Aggiungi al Dock».';
  }
  return 'Dal menu del browser scegli «Installa app» o «Aggiungi alla schermata Home».';
}

// `sezione` si nasconde intera quando non c'e' niente da proporre: un riquadro che
// resta li' a dire «installa» dentro un'app gia' installata e' rumore, e nella
// colonna quello spazio lo prendono le voci.
function collegaPromo(sezione, bottone, dove = bottone.parentElement) {
  if (!sezione || !bottone) return;
  if (giaInstallata()) { sezione.hidden = true; return; }

  bottone.addEventListener('click', async () => {
    if (dialogo) {
      const atteso = dialogo;
      // Un `beforeinstallprompt` si spende una volta sola: se si tenesse e si
      // riprovasse, il secondo `prompt()` solleverebbe e il bottone sembrerebbe
      // rotto. Si azzera prima di chiedere, non dopo.
      dialogo = null;
      atteso.prompt();
      const { outcome } = await atteso.userChoice;
      // Se ha detto no, il riquadro sparisce invece di restare a chiedere: il
      // browser il suo invito lo rifara' da solo quando gli pare.
      if (outcome === 'accepted' || outcome === 'dismissed') sezione.hidden = true;
      return;
    }
    // Niente dialogo: si dice come si fa, e il bottone smette di essere un bottone
    // che non fa niente.
    bottone.hidden = true;
    const riga = document.createElement('p');
    riga.className = 'promo-mano';
    riga.textContent = aMano();
    dove.appendChild(riga);
  });
}

export { collegaPromo };
