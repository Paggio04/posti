# 📍 WeTransport

Chi guida oggi? Chi sale? App per organizzare i passaggi in macchina della comitiva:
i guidatori pubblicano la macchina del giorno, gli altri prenotano il posto tappando sul sedile.

## Stack

- **Frontend:** HTML/CSS/JS vanilla (nessuna build, deploy statico)
- **Backend:** [Supabase](https://supabase.com) — autenticazione email/password + database Postgres con Row Level Security
- **Hosting:** [Netlify](https://netlify.com)

L'app è **installabile** (PWA): si aggiunge alla schermata home e si apre anche senza rete,
mostrando l'ultimo guscio salvato e dicendo chiaramente che la linea manca. In cache va solo
il guscio — i file pubblici — e **niente** che passi da Supabase: dati e sessioni non si
copiano da nessuna parte. Il perché sta scritto in `sw.js`.

## Setup

1. Applica le migrazioni di `supabase/migrations/` in ordine crescente nel SQL Editor di Supabase (tabelle, RLS, trigger). Istruzioni: [supabase/README.md](supabase/README.md).
2. In `config.js` inserisci URL e anon key del progetto (Dashboard → Settings → API).
3. **Nomina il primo amministratore a mano**, altrimenti la coda delle segnalazioni non ha
   nessuno che la legge: `update public.profiles set is_admin = true where id = (select id from
   auth.users where email = 'TUA_EMAIL');` — va fatto **dopo** la migrazione `012`, che è quella
   che rende possibile quell'update.
4. Deploy: collega la repo a Netlify, nessun build command, publish directory = root.

### Provarla in locale

Serve un **server**, non `file://`: `app.js` è un modulo ES e da `file://` il browser lo blocca.

```bash
npm ci
npx serve .        # oppure: python3 -m http.server 8000
```

Da `localhost` funziona l'accesso con email e password; **non** "Continua con Google", perché
`localhost` non è fra gli indirizzi di reindirizzo autorizzati sul progetto Supabase.

## Documentazione

- [SECURITY.md](SECURITY.md) — stato di sicurezza, affidabilità, testing per ogni area
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagramma, schema dati, contratto API
- [docs/ROADMAP.md](docs/ROADMAP.md) — cosa manca, in che ordine, e quando un pezzo è finito
- [docs/adr/](docs/adr/) — decisioni architetturali
- CI (`.github/workflows/ci.yml`), tutta bloccante: sintassi JS, ESLint, validazione HTML,
  scansione segreti, migrazioni applicate da zero **e riapplicate** (devono essere ripetibili)
  con i test SQL su isolamento, sicurezza, cancellazione, passaggi in zona e coordinate
  riservate, più Playwright
  sull'**anteprima** della PR prima del merge e sul sito vivo dopo

## Sicurezza

La anon key è pubblica per design: ogni accesso ai dati passa dalle policy RLS.

**Non** tutti vedono tutto, e questa riga diceva il contrario fino alla Fase 3: un passaggio
lo vedi se sei nella comitiva che lo ospita, se hai un posto su quell'auto, se è aperto alla
tua zona (25 km dal punto di partenza) oppure se è pubblico. I profili si leggono solo di chi
condivide una comitiva con te, o di chi guida un passaggio che puoi vedere. Chi blocca una
persona smette di vederla, nei due sensi.

Ognuno prenota e lascia solo il proprio posto (uno per auto, vincolo unique); il guidatore
gestisce la propria auto e può liberare i sedili. Un amministratore legge la coda delle
segnalazioni e può sospendere un account, e nessuno può promuoversi da solo.
