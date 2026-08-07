// Regole ESLint del progetto. Prima erano scritte dentro .github/workflows/ci.yml e
// generate al volo a ogni build: in locale non esistevano, quindi pre-volo.py saltava
// il controllo e la CI era l'unico posto dove si scopriva un errore. Ora la fonte e' una sola,
// versionata: stesse regole in locale (npm run lint) e in CI.
export default [
  {
    files: ['app.js', 'config.js', 'rete.js', 'accesso.js', 'tema.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        Notification: 'readonly',
        Intl: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        alert: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        Event: 'readonly',
        // Servono all'esportazione dei propri dati (C11): il file si costruisce e si
        // scarica nel browser, senza passare da nessun server.
        Blob: 'readonly',
        URL: 'readonly',
        location: 'readonly',
        // Serve a rete.js: la sonda che prova se la linea c'e' davvero, invece di
        // fidarsi di navigator.onLine, che dice un'altra cosa.
        fetch: 'readonly',
        // C13: la chiave VAPID arriva in base64url e il browser la vuole in byte.
        atob: 'readonly',
        Uint8Array: 'readonly',
        // Il quaderno del riepilogo: quante schermate ci sono lo si sa solo dopo che
        // il browser ha impaginato, e cambia anche quando cambia il riquadro senza
        // che cambi la finestra (la fascia in alto che compare a 768px). `resize`
        // quel caso non lo vede.
        ResizeObserver: 'readonly',
      },
    },
    rules: {
      // Bloccanti: un nome sbagliato o una variabile morta sono bug o resti di refactor.
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-eval': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Il service worker (C12) vive in un altro mondo: niente document, niente window, e
    // `self` al posto loro. Senza queste regole restava fuori dal lint, ed e' proprio il
    // file che sbaglia in silenzio: se non si registra, l'app funziona e nessuno lo scopre.
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-eval': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
