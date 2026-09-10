// La scappatoia che permette ai test di entrare davvero su un'anteprima.
//
// `app.js` chiude l'accesso su qualunque indirizzo che non sia il sito vivo o
// `localhost`, perche' un'anteprima parla col database di produzione e il modo in cui
// quel difetto fa danno e' qualcuno che ci entra senza accorgersene. I test pero'
// devono poterci entrare — e' il loro mestiere — quindi dichiarano di sapere dove
// sono, prima che la pagina si carichi.
//
// **E' volutamente debole**, una riga di memoria locale: non deve resistere a
// nessuno, deve solo distinguere «un test» da «una persona distratta». Cio' che
// protegge i dati sono le policy RLS, e valgono uguali dai due lati di questa riga.
const CHIAVE = 'wt_anteprima_consapevole';

// Vale sia su una pagina sia su un contesto: `addInitScript` c'e' su entrambi, e gira
// prima degli script della pagina — cioe' prima che `app.js` decida se bloccare.
async function sbloccaAnteprima(dove) {
  await dove.addInitScript((k) => {
    try { localStorage.setItem(k, '1'); } catch { /* memoria chiusa: pazienza */ }
  }, CHIAVE);
}

module.exports = { sbloccaAnteprima, CHIAVE };
