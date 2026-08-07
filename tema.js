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
(function () {
  try {
    if (localStorage.getItem('wt_tema') === 'scuro') {
      document.documentElement.setAttribute('data-tema', 'scuro');
    }
  } catch {
    // Navigazione privata con la memoria locale chiusa: si resta sul tema chiaro,
    // che e' quello predefinito. Non e' un errore da raccontare a nessuno.
  }
})();
