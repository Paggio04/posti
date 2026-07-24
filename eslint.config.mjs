// Regole ESLint del progetto. Prima erano scritte dentro .github/workflows/ci.yml e
// generate al volo a ogni build: in locale non esistevano, quindi pre-volo.py saltava
// il controllo e la CI era l'unico posto dove si scopriva un errore. Ora la fonte e' una sola,
// versionata: stesse regole in locale (npm run lint) e in CI.
export default [
  {
    files: ['app.js', 'config.js'],
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
];
