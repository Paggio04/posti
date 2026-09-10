# 📍 WeTransport

Chi guida oggi? Chi sale? App per organizzare i passaggi in macchina della comitiva:
i guidatori pubblicano la macchina del giorno, gli altri prenotano il posto tappando sul sedile.

> **Il repository si chiama ancora `posti`** — è l'unico pezzo del nome vecchio rimasto, e non
> si rinomina da qui: si fa dalle impostazioni di GitHub, insieme al collegamento Netlify e al
> remoto dei cloni. È l'ultima riga aperta di C20 in [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- **Frontend:** HTML/CSS/JS vanilla (nessuna build, deploy statico). **Nessun dominio di terzi:** caratteri e libreria di Supabase stanno nel repo — `fonts/README.md` e `vendor/README.md` dicono perché e come si aggiornano
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

I controlli end-to-end girano anche qui, non solo in CI: `BASE_URL=http://localhost:3000 npm run
test:e2e`. Uno solo ha bisogno che il browser raggiunga davvero Supabase — quello che verifica il
messaggio di password sbagliata — e su una rete che non ci arriva fallisce da solo, senza portarsi
dietro gli altri. Fino al 10/09/2026 ne fallivano sei, perché `app.js` prendeva la libreria da un
CDN: adesso sta in `vendor/`.

Da `localhost` funziona l'accesso con email e password; **non** "Continua con Google", perché
`localhost` non è fra gli indirizzi di reindirizzo autorizzati sul progetto Supabase.

## Cosa si imposta a mano

Il repo non può farle da solo, e ognuna è una voce della checklist pre-lancio che **resta
aperta finché qualcuno non la fa**. In ordine di quanto costa lasciarla com'è.

| Cosa | Dove | Perché |
|---|---|---|
| Un **secondo progetto Supabase** per le anteprime, e la password sulle anteprime Netlify | Supabase → New project; Netlify → Site settings → Access control | Oggi ogni `deploy-preview-N--wetransport.netlify.app` è l'app **con i dati veri dentro**, a un indirizzo pubblico. Il cartello che `rete.js` mette in pagina avvisa, non separa. Peggiora nel momento in cui esistono i segreti `WT_TEST_*`, perché i test dei flussi scriverebbero comitive vere |
| **Ripristinare un backup**, una volta, per prova | Supabase → Database → Backups, su un progetto usa-e-getta | Un backup mai ripristinato non è un backup. Mezz'ora, una volta sola, e la riga di `SECURITY.md` smette di essere una speranza |
| **Minimo password e password rubate** | Supabase → Authentication → Policies | `PASSWORD_MINIMO` in `app.js` è il controllo del browser, e un browser si salta. Il minimo che vale è quello della dashboard: portalo a 10 e accendi il confronto con gli elenchi di password compromesse (è gratis e di default è spento) |
| **Error tracking** (Sentry o equivalente) | account presso il fornitore, poi il DSN nel codice | I log di Supabase coprono database e autenticazione. Un errore JavaScript nel browser di chi usa l'app oggi non lo vede nessuno |
| **Dominio proprio, e le email da lì** | registrar + Netlify + un servizio transazionale (Resend, Postmark) | Conferma dell'account e reset password passano dal mittente predefinito di Supabase: dominio condiviso, poche email l'ora, nessun SPF/DKIM/DMARC di questo progetto. Sono le due email da cui dipende l'accesso. Si fa insieme al dominio (C20), non prima |
| **Nominare il primo amministratore** | SQL Editor | Vedi il punto 3 del setup qui sopra |

Il battito (`.github/workflows/battito.yml`) controlla ogni mezz'ora che il sito **e il
database** rispondano, e apre una segnalazione quando non è così. Non sostituisce un
monitoraggio esterno: GitHub non garantisce il minuto di una corsa programmata.

## Documentazione

- [SECURITY.md](SECURITY.md) — stato di sicurezza, affidabilità, testing per ogni area
- [privacy.html](privacy.html) e [termini.html](termini.html) — le due pagine scritte, servite dal sito
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
