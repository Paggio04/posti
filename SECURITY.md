# Sicurezza e qualità — stato per area

Stack: sito statico (Netlify) + Supabase (Postgres, Auth, Realtime). Nessun server proprio:
molte responsabilità sono delegate per progetto ai managed service. Questo file dice, per
ogni area, cosa è implementato, dove, e cosa è delegato o non applicabile.

## Sicurezza

| Area | Stato | Dove / come |
|---|---|---|
| Input sanitization / injection | ✅ | Nessun `innerHTML` con input utente (solo `textContent`); query via supabase-js (parametrizzate, niente SQL concatenato); vincoli `check` su lunghezze e valori in ogni tabella; CSP blocca script esterni non autorizzati |
| Authentication | ✅ | Supabase Auth: email+password, conferma email obbligatoria, reset password. Token JWT gestiti da supabase-js |
| Authorization / ruoli | ✅ | Row Level Security su tutte le tabelle, comprese `user_reports` e `user_blocks`. Ruoli impliciti: guidatore (gestisce la propria auto e i suoi sedili), passeggero (solo il proprio posto), owner gruppo (update/delete gruppo), amministratore (legge le segnalazioni, sospende). Un account sospeso legge ma non scrive: il divieto sta nelle policy, non nell'interfaccia. Funzioni `security definer` solo dove servono a spezzare la ricorsione fra policy, o per create/join gruppo |
| Session management / token expiry | ✅ (delegato) | JWT Supabase: access token 1h, refresh automatico via supabase-js, revoca al logout |
| Secrets management | ✅ | Nel repo c'è solo la publishable key (pubblica per design, la sicurezza è nelle RLS). La secret key non ha mai lasciato la dashboard. CI fallisce se compare `sb_secret`/`service_role` nel codice |
| HTTPS / TLS / certificati | ✅ (delegato) | Netlify: TLS automatico (Let's Encrypt), redirect HTTPS. HSTS 1 anno + `upgrade-insecure-requests` via `netlify.toml` |
| Rate limiting / abuse prevention | ✅ (delegato) + vincoli | Supabase Auth ha rate limit integrati (signup, login, email). Abusi sui dati limitati dai vincoli DB: unique su posti/auto/richieste, trigger che rifiutano operazioni non valide, una sola segnalazione aperta per coppia di persone (indice unico parziale) |
| Dependency scanning / patching | ✅ (minimale by design) | Zero dipendenze npm; unica dipendenza runtime è supabase-js v2 da CDN (major pinnata, patch automatiche). CSP limita le sorgenti script a jsdelivr |
| Multi-tenancy / data isolation | ✅ | I gruppi sono i tenant: RLS `is_member()` isola membri e richieste per gruppo; nessuna riga puo' esistere fuori da un gruppo (`group_id` non nullo); scrivere in un gruppo richiede di esserne membro; i codici invito non sono enumerabili (join solo via RPC). Dentro il gruppo, il blocco fra due persone e' un secondo confine. Un passaggio puo' essere aperto fuori dalla comitiva solo da chi lo pubblica, un pezzo per volta (`visibilita`), e aprirlo **non apre nient'altro**: gruppi, membri e richieste restano invisibili. Verificato in CI da `verifica-isolamento.sql`, `verifica-sicurezza.sql` e `verifica-zona.sql`. **Un confine in più dal cantiere C21**, perché una policy RLS è di riga e non di colonna: le coordinate esatte del ritrovo non viaggiano più dentro la riga: si chiedono a `coordinate_passaggi()`, che le dà solo a chi è della comitiva o ha un posto su quell'auto, e le quattro colonne non sono più leggibili da un client (`016`, `verifica-coordinate.sql`) |
| PII handling | ✅ | PII minima: email (solo in `auth.users`, mai esposta ad altri utenti) e nome visibile scelto dall'utente, leggibile **solo** da chi condivide una comitiva (policy `profiles read`, migrazioni 011 e 012). Chi subisce un blocco perde di vista il nome di chi l'ha bloccato; il contrario no, altrimenti non si potrebbe piu' sbloccare nessuno. Le segnalazioni le legge solo chi le scrive e l'amministratore: il segnalato non sa di esserlo. Nessun tracker/analytics di terze parti |
| Data retention / cancellazione | ✅ | L'utente elimina l'account da solo, dall'app (`elimina_account()`): tutto cascata via FK `on delete cascade` — profilo, auto, posti, richieste, commenti, segnalazioni, blocchi. I gruppi posseduti **non** vengono portati via: passano al membro piu' anziano, e spariscono solo se non e' rimasto nessuno. Verificato in CI da `supabase/test/verifica-cancellazione.sql` |
| Compliance (GDPR) | ✅ | Informativa completa (`privacy.html`): basi giuridiche, responsabili, tempi di conservazione, titolare con contatto, e la regione dei dati. Accesso e portabilita': "Scarica i miei dati" produce un JSON completo. Cancellazione: `elimina_account()`, dall'app, definitiva, e passa la comitiva a un altro membro invece di portarla via a tutti. **I dati stanno a Londra** (`eu-west-2`), quindi fuori dall'Unione: il trasferimento sta sulla decisione di adeguatezza per il Regno Unito, rinnovata il 19/12/2025 e valida fino al 27/12/2031. Da riguardare a quella scadenza, non prima |
| Header di sicurezza del browser | ✅, ma imparato a spese nostre | `netlify.toml`: CSP (`default-src 'self'`, script solo da self e jsdelivr, `worker-src 'self'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy. **La lezione:** `Permissions-Policy` diceva `geolocation=()`, e un'allowlist vuota spegne la funzione *anche per la pagina stessa* — quindi tutto il cantiere C9 (passaggi in zona) era **inerte in produzione** da quando esiste, con lint, sintassi e test sullo schema tutti verdi. Un header non è né codice né schema: nessun controllo lo guardava. Ora `geolocation=(self)` e c'è uno smoke test che lo verifica in un browser, provato al contrario |
| Audit trail / log tamper-evident | ✅ (delegato) | Log auth e API nella dashboard Supabase (non modificabili dal client); ogni riga ha `created_at`; Postgres WAL. Nessun log applicativo custom: non necessario a questa scala |

## Affidabilità

| Area | Stato | Dove / come |
|---|---|---|
| Error handling | ✅ | Ogni chiamata Supabase controlla `error`; messaggi utente in italiano (`friendlyError` + trigger DB); stato UI ripulito in caso di errore |
| Retry / backoff / idempotency | ✅ | Retry con backoff su `loadRides` (vedi `app.js`); le scritture sono idempotenti per vincolo (unique su seat/ride/request ⇒ un retry duplicato fallisce in modo sicuro, gestito) |
| Circuit breaker / fallback | ✅ (proporzionato) | `loadToken` scarta risposte fuori ordine; realtime che cade ⇒ l'app resta funzionante con refresh manuale (fallback implicito); toast "connessione instabile" |
| Race condition / concorrenza | ✅ | Risolte nel DB, non nel client: unique `(ride_id, seat_index)` ⇒ due tap sullo stesso sedile, uno solo vince; trigger transazionali per i vincoli incrociati |
| Caching / invalidation | ✅ | **C'è una cache, ed è il service worker** (`sw.js`): questa riga diceva "nessuna cache applicativa" e dalla Fase 4 non è più vero. In cache va **solo il guscio** — i file pubblici, identici per tutti — e mai niente che passi da Supabase, né richieste che non siano `GET`: una copia di dati o token sarebbe una copia che nessuno ha chiesto, che "Scarica i miei dati" non mostra e che "Elimina il mio account" non porta via. Il nome della cache sale di versione quando il guscio cambia. Per i dati la verità resta il DB, invalidazione via realtime. Asset statici: cache CDN Netlify invalidata a ogni deploy |
| Disaster recovery | ✅ (delegato) | Codice: Git/GitHub. DB: backup giornalieri Supabase (piano free: 7 giorni). Schema ricreabile da zero applicando `supabase/migrations/` in ordine (verificato dalla CI a ogni push, job `schema`). Hosting ricreabile in minuti (repo → Netlify) |

## Testing e processo

| Area | Stato | Dove / come |
|---|---|---|
| CI con soglie bloccanti | ✅ | GitHub Actions (`.github/workflows/ci.yml`), tutto bloccante: sintassi JS, ESLint (`no-undef`, `no-unused-vars`, `no-eval`) su `app.js`, `config.js`, `sw.js` e `rete.js`, validazione HTML, scan segreti, migrazioni applicate da zero **e riapplicate** con i cinque file di test SQL (isolamento, sicurezza delle persone, cancellazione, passaggi in zona, coordinate riservate), Playwright sull'anteprima prima del merge e sul sito vivo dopo. Fallisce ⇒ niente merge: `main` è protetta da un ruleset versionato (`.github/rulesets/`) |
| Integration / E2E testing | ✅ | Playwright sull'**anteprima** della PR, prima del merge: smoke su accesso/privacy sempre, e il flusso completo a due utenti (crea comitiva → pubblica auto → entra col codice → prenota il sedile → realtime) quando ci sono i segreti degli account di prova. Più i controlli sullo schema e sull'isolamento fra comitive nel job `schema`. Dalla Fase 4 lo smoke verifica anche cose che solo un browser vede: che la posizione **non sia spenta dagli header**, che l'app si apra senza rete e lo dica, che il manifest dichiari le PNG che servono a installarla, che `robots.txt` e `sitemap.xml` si parlino (ogni `<loc>` viene interrogato) e che il 404 risponda 404. Due di questi hanno trovato difetti veri prima del merge |
| Regression testing | ✅ (proporzionato) | Lint e validazione HTML bloccanti, migrazioni riapplicate da zero a ogni push, isolamento fra comitive verificato in CI, flusso completo a due utenti su anteprima. Nessun test unitario: a questa scala il valore sta nei percorsi interi |
| Load / stress / chaos testing | ➖ N/A | Carico atteso: decine di utenti. Postgres/Netlify reggono ordini di grandezza in più; test di carico non giustificato |
| Code review | ✅ (processo) | Sviluppo su `main` con commit atomici e messaggi descrittivi; per più contributor: branch + PR con CI verde obbligatoria |

## Accessibilità e documentazione

| Area | Stato | Dove / come |
|---|---|---|
| Accessibility | ✅ | Sedili navigabili da tastiera (tabindex + Enter/Spazio), `aria-label`/`title` su icone e SVG, `role="alert"`/`role="status"` sui messaggi, contrasti verificati in chiaro e scuro, `prefers-reduced-motion` rispettato, target touch ≥ 40px |
| Documentation | ✅ | `README.md` (setup), questo file, `docs/ARCHITECTURE.md` (diagramma + contratto API), `docs/adr/` (decisioni) |
