// Il tema, e perche' e' un file a parte di sei righe.
//
// L'app nasce chiara. Chi la gira una volta se la ritrova girata, e quella scelta
// va applicata **prima che il browser dipinga**, o si vede un lampo bianco e poi il
// buio — che e' peggio del buio e basta. Percio' questo non e' un modulo e non ha
// `defer`: sta in `<head>` e viene eseguito li', prima del `<body>`.
//
// Non e' scritto dentro `index.html` come `<script>` inline per una ragione sola:
// la Content-Security-Policy in `netlify.toml` dice `script-src 'self'`, senza
// `unsafe-inline`. Un inline qui verrebbe bloccato in produzione e non in locale,
// cioe' il genere di difetto che si scopre dal sito vivo.
//
// `app.js` legge e scrive la stessa chiave: qui c'e' solo la lettura, perche' e'
// l'unica cosa che deve succedere prima del disegno.
//
// **E l'app non nasce chiara: nasce come la vuole il browser.** Chi ha il sistema
// sul tema scuro apre una pagina scura, senza doverla girare ogni volta. La
// preferenza salvata, se c'e', vince comunque: e' una decisione presa a mano su
// questa app, e non si scavalca con un'impostazione generale.
// La distinzione fra «non ha scelto» e «ha scelto chiaro» c'e' perche' la chiave
// vale `'scuro'` **o** `'chiaro'`: senza il valore esplicito, chi gira l'app in
// chiaro con il sistema scuro se la ritroverebbe scura alla visita dopo.
(function () {
  var scelto = null;
  try {
    scelto = localStorage.getItem('wt_tema');
  } catch {
    // Navigazione privata con la memoria locale chiusa: nessuna scelta salvata,
    // quindi comanda il browser. Non e' un errore da raccontare a nessuno.
  }
  var scuro = scelto
    ? scelto === 'scuro'
    : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (scuro) document.documentElement.setAttribute('data-tema', 'scuro');
})();
