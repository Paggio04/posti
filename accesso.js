// L'auto che si riempie, sulla schermata d'accesso.
//
// **Sta in un file suo, e non dentro app.js, per la stessa ragione di rete.js:
// non ha import.** `app.js` comincia con un `import` da un CDN — la libreria di
// Supabase — e se quella richiesta e' lenta, bloccata o storta il modulo intero
// non parte: e' successo, ed e' il motivo per cui l'avviso «sei senza rete» vive
// gia' fuori da li'. Questa e' la **prima** schermata che si vede, prima ancora
// di sapere cos'e' l'app: non puo' dipendere dal fatto che un dominio di terzi
// risponda. Senza JavaScript del tutto resta il fotogramma scritto nell'HTML —
// due posti presi, due liberi — che e' comunque un disegno finito.

// E' l'unica cosa che si muove sulla schermata d'accesso, e si muove per dire
// cos'e' questa app: i posti si occupano uno alla volta, la frase accanto conta
// quelli che restano, l'auto si riempie, resta piena un momento e riparte. Chi
// non l'ha mai aperta capisce il prodotto prima di entrarci, che e' l'unico
// argomento per cui una schermata d'accesso puo' permettersi un'animazione.
//
// Un contatore solo per due disegni: l'auto grande del cartello (da 768px) e la
// striscia dei quattro posti nella riga del marchio (a ogni larghezza). Se
// fossero due timer potrebbero mostrare due numeri diversi, ed e' il genere di
// bugia che nessuno nota e che rende tutto meno credibile.
//
// `prefers-reduced-motion` non spegne l'informazione, la ferma: due posti presi
// e due liberi, cioe' esattamente il fotogramma che c'e' scritto nell'HTML.
// PRODUCT.md lo chiede a lettere: un movimento che porta significato non si puo'
// togliere, si puo' solo rendere istantaneo.
const AUTH_INIZIALI = ['GI', 'SA', 'LU', 'EM'];
const AUTH_QUANTI = ['nessun posto', 'un posto', 'due posti', 'tre posti', 'quattro posti'];
const authPosti = document.getElementById('auth-posti');
const authFrase = document.getElementById('cartello-frase');
const authSedili = [...document.querySelectorAll('#auth-view .seat[data-posto]')]
  .sort((a, b) => Number(a.dataset.posto) - Number(b.dataset.posto));

// «Restano un posto» e' italiano sbagliato, e la frase cambia verbo a meta' della
// scala: si scrive tutta invece di incollare un numero dentro una frase fissa.
function fraseLiberi(liberi) {
  if (liberi === 0) return "L'auto è piena.";
  if (liberi === 1) return 'Resta un posto.';
  return `Restano ${AUTH_QUANTI[liberi]}.`;
}

function mostraPostiAuth(presi) {
  const frase = fraseLiberi(authSedili.length - presi);
  for (const [i, g] of authSedili.entries()) {
    const preso = i < presi;
    g.classList.toggle('seat-taken', preso);
    g.classList.toggle('seat-free', !preso);
    const t = g.querySelector('.seat-text');
    if (t) t.textContent = preso ? AUTH_INIZIALI[i] : '+';
  }
  if (authPosti) {
    for (const [i, el] of [...authPosti.children].entries()) el.classList.toggle('preso', i < presi);
    // Chi ascolta la pagina sente la frase, non quattro rettangoli.
    authPosti.setAttribute('aria-label', frase);
  }
  if (authFrase) authFrase.textContent = frase;
}

function avviaAutoAccesso() {
  if (!authSedili.length) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let presi = 0;
  let timer = 0;
  mostraPostiAuth(0);

  const passo = () => {
    // Entrati nell'app la schermata non c'e' piu': il giro si ferma invece di
    // continuare a disegnare qualcosa che nessuno guarda. Stessa cosa con la
    // scheda del browser in secondo piano, dove i timer restano ma il disegno no.
    if (document.getElementById('auth-view')?.classList.contains('hidden')) return;
    if (document.hidden) { timer = setTimeout(passo, 1000); return; }
    presi = presi >= authSedili.length ? 0 : presi + 1;
    mostraPostiAuth(presi);
    // Piena si guarda piu' a lungo: e' il fotogramma in cui la frase dice la cosa
    // che l'app esiste per dire.
    timer = setTimeout(passo, presi === authSedili.length ? 2400 : 1400);
  };

  timer = setTimeout(passo, 1100);
  // Tornando sulla scheda il giro riparte da dove si era fermato, senza
  // accumulare i tick persi.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !timer) timer = setTimeout(passo, 400);
  });
}


avviaAutoAccesso();
