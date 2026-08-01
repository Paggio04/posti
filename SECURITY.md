# Sicurezza e qualità — stato per area

Stack: sito statico (Netlify) + Supabase (Postgres, Auth, Realtime). Nessun server proprio:
molte responsabilità sono delegate per progetto ai managed service. Questo file dice, per
ogni area, cosa è implementato, dove, e cosa è delegato o non applicabile.

## Sicurezza

| Area | Stato | Dove / come |
|---|---|---|
| Input sanitization / injection | ✅ | Nessun `innerHTML` con input utente (solo `textContent`); query via supabase-js (parametrizzate, niente SQL concatenato); vincoli `check` su lunghezze e valori in ogni tabella; CSP blocca script esterni non autorizzati |
| Authentication | ✅ | Supabase Auth: email+password, conferma email obbligatoria, reset password. Token JWT gestiti da supabase-js |
| Authorization / ruoli | ⚠️ | Row Level Security su tutte le tabelle, comprese `user_reports` e `user_blocks`. Ruoli impliciti: guidatore (gestisce la propria auto e i suoi sedili), passeggero (solo il proprio posto), owner gruppo (update/delete gruppo), amministratore (legge le segnalazioni, sospende). Un account sospeso legge ma non scrive: il divieto sta nelle policy, non nell'interfaccia. Funzioni `security definer` solo dove servono a spezzare la ricorsione fra policy, o per create/join gruppo. **Il cantiere C23 chiude i permessi di quelle funzioni** (`020`): in Postgres `grant execute to public` è il default, e `bloccati_fra(a,b)` e `sospeso(u)` — che prendono gli id come parametri invece di ancorarsi ad `auth.uid()` — rispondono a chiunque su chiunque; `create_group`/`join_group` sono chiamabili senza account, e il loro errore dice se un codice invito esiste. Il file è verificato in CI da `verifica-permessi.sql`, che gira su un Postgres di prova con tutte le migrazioni applicate. **⚠️ Scritto ma non ancora applicato in produzione: la `020` è in PR #11, il database vivo non ce l'ha.** Prova, oggi: `node --no-warnings supabase/test/sonde-esterne.mjs` stampa `bloccati_fra 200`, `sospeso 200`, `join_group 400 P0001`. Applicata la `020`, le stesse tre righe stampano `42501`. **Quando succede: si toglie questa frase in grassetto e lo stato torna ✅.** |
| Session management / token expiry | ✅ (delegato) | JWT Supabase: access token 1h, refresh automatico via supabase-js, revoca al logout |
| Secrets management | ✅ | Nel repo c'è solo la publishable key (pubblica per design, la sicurezza è nelle RLS). La secret key non ha mai lasciato la dashboard. CI fallisce se compare `sb_secret`/`service_role` nel codice |
| HTTPS / TLS / certificati | ✅ (delegato) | Netlify: TLS automatico (Let's Encrypt), redirect HTTPS. HSTS 1 anno + `upgrade-insecure-requests` via `netlify.toml` |
| Rate limiting / abuse prevention | ✅ (delegato) + vincoli | Supabase Auth ha rate limit integrati (signup, login, email). Abusi sui dati limitati dai vincoli DB: unique su posti/auto/richieste, trigger che rifiutano operazioni non valide, una sola segnalazione aperta per coppia di persone (indice unico parziale) |
| Dependency scanning / patching | ✅ (minimale by design) | Zero dipendenze npm a runtime; l'unica è supabase-js v2 da CDN (major pinnata, patch automatiche). CSP limita le sorgenti script a jsdelivr. **È anche l'ultimo terzo che il browser di chi usa l'app contatta**, quindi sta dichiarato in `privacy.html` insieme a Supabase e Netlify: ospitarlo qui lo toglierebbe da tutte e tre le liste (CSP, informativa, C16) → idea 1 della revisione del 27/07 in `docs/ROADMAP.md` |
| Multi-tenancy / data isolation | ✅ | I gruppi sono i tenant: RLS `is_member()` isola membri e richieste per gruppo; nessuna riga puo' esistere fuori da un gruppo (`group_id` non nullo); scrivere in un gruppo richiede di esserne membro; si entra **solo** da `join_group()`, mai con un insert diretto in `group_members` — il che chiude la porta laterale, ma **non** rende i codici inenumerabili: quella parte ha una riga sua qui sotto, subito dopo questa. Dentro il gruppo, il blocco fra due persone e' un secondo confine. Un passaggio puo' essere aperto fuori dalla comitiva solo da chi lo pubblica, un pezzo per volta (`visibilita`), e aprirlo **non apre nient'altro**: gruppi, membri e richieste restano invisibili. Verificato in CI da `verifica-isolamento.sql`, `verifica-sicurezza.sql` e `verifica-zona.sql`. **Un confine in più dal cantiere C21**, perché una policy RLS è di riga e non di colonna: le coordinate esatte del ritrovo non viaggiano più dentro la riga: si chiedono a `coordinate_passaggi()`, che le dà solo a chi è della comitiva o ha un posto su quell'auto, e le quattro colonne non sono più leggibili da un client (`016`, `verifica-coordinate.sql`) |
| Codici invito / enumerazione | ⚠️ | **Quanto è grande lo spazio.** Il codice è `upper(substr(md5(random()::text), 1, 6))` (`003_gruppi.sql`): sei caratteri, ma di alfabeto **esadecimale**, quindi **16⁶ = 16 777 216** valori — non i due miliardi che «sei caratteri» lasciano immaginare (36⁶). Prova: `grep -n 'md5' supabase/migrations/003_gruppi.sql`. **Senza account, oggi la RPC risponde e distingue**: `join_group` alza `Codice non valido` (`P0001`, HTTP 400) solo quando il codice **non** esiste, quindi la risposta stessa dice se esiste. Prova: `node --no-warnings supabase/test/sonde-esterne.mjs`, riga `join_group`. **La `020` chiude questo pezzo** togliendo `execute` ad `anon`: applicata, la stessa sonda deve stampare `42501`. **Con** un account la strada resta aperta, e non è un semplice oracolo: un codice indovinato non si limita a rivelarsi, `join_group` fa **entrare** (`insert into group_members … on conflict do nothing`, poi `return g`), cioè dà accesso a passaggi, membri, richieste e commenti di una comitiva altrui. Lato database non c'è **nessun** limite di tentativi. **Cosa resta a difesa**: i rate limit di Supabase sull'API (delegati, **non misurati** — nessuno ha provato quante `join_group` al minuto passano) e la dimensione del bersaglio, ridicola finché le comitive sono poche. **Chiuderla è un cantiere non ancora aperto**: C24 in `docs/ROADMAP.md`, nell'ordine codice più lungo su alfabeto senza caratteri ambigui → errore uniforme → limite di tentativi |
| PII handling | ⚠️ | PII minima: email (solo in `auth.users`, mai esposta ad altri utenti) e nome visibile scelto dall'utente, leggibile **solo** da chi condivide una comitiva (policy `profiles read`, migrazioni 011 e 012). **Il cantiere C22 toglie la zona dal profilo servito agli altri**: `zona_lat`, `zona_lon`, `zona_nome` e `sospeso_motivo` smettono di essere leggibili da un client (`019`), e la propria riga si legge da `mio_profilo()` (`018`). Era lo stesso difetto di forma di C21 sull'altra tabella — una policy decide quali righe, non quali colonne — e più esposto, perché da C9 il profilo di chi guida un passaggio pubblico lo legge anche un estraneo. I file sono verificati in CI da `verifica-profilo.sql`, che gira su un Postgres di prova con tutte le migrazioni applicate. Chi subisce un blocco perde di vista il nome di chi l'ha bloccato; il contrario no, altrimenti non si potrebbe piu' sbloccare nessuno. Le segnalazioni le legge solo chi le scrive e l'amministratore: il segnalato non sa di esserlo. Nessun tracker/analytics di terze parti. **⚠️ Scritto ma non ancora applicato in produzione: `018` e `019` sono in PR #11, il database vivo non ce le ha — quindi oggi le colonne della zona escono ancora.** Prova, oggi: `node --no-warnings supabase/test/sonde-esterne.mjs` stampa `mio_profilo 404 PGRST202`, cioè la `018` non c'è; applicata, stamperà `42501` (esiste, ma solo per chi ha un account). Per la `019` la prova è un'altra e vuole un accesso vero: **da autenticato**, `select=*` su `profiles` dev'essere **rifiutato** — se torna la riga con le colonne della zona dentro, la `019` non è passata, e non basta rileggere il file. **Quando tutte e due le prove danno il risultato nuovo: si toglie questa frase in grassetto e lo stato torna ✅.** |
| Data retention / cancellazione | ✅ | L'utente elimina l'account da solo, dall'app (`elimina_account()`): tutto cascata via FK `on delete cascade` — profilo, auto, posti, richieste, commenti, segnalazioni, blocchi. I gruppi posseduti **non** vengono portati via: passano al membro piu' anziano, e spariscono solo se non e' rimasto nessuno. Verificato in CI da `supabase/test/verifica-cancellazione.sql` |
| Compliance (GDPR) | ✅ | Informativa completa (`privacy.html`): basi giuridiche, responsabili, tempi di conservazione, titolare con contatto, e la regione dei dati. **Rivista il 27/07/2026** perché tre trattamenti erano arrivati dopo di lei e non ci comparivano: la posizione (C9, consenso revocabile), l'indirizzo push del dispositivo con i servizi dei produttori come destinatari (C13), e jsDelivr. La regola che resta è quella dei caratteri di C15: *l'informativa si verifica sulle richieste di rete, non sulle intenzioni* — quindi si rilegge ogni volta che entra una funzione che parla con l'esterno. Accesso e portabilita': "Scarica i miei dati" produce un JSON completo. Cancellazione: `elimina_account()`, dall'app, definitiva, e passa la comitiva a un altro membro invece di portarla via a tutti. **I dati stanno a Londra** (`eu-west-2`), quindi fuori dall'Unione: il trasferimento sta sulla decisione di adeguatezza per il Regno Unito, rinnovata il 19/12/2025 e valida fino al 27/12/2031. Da riguardare a quella scadenza, non prima |
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
| CI con soglie bloccanti | ✅ | GitHub Actions (`.github/workflows/ci.yml`), tutto bloccante: sintassi JS, ESLint (`no-undef`, `no-unused-vars`, `no-eval`) su `app.js`, `config.js`, `sw.js` e `rete.js`, validazione HTML, scan segreti, migrazioni applicate da zero **e riapplicate** con gli otto file di test SQL (isolamento, sicurezza delle persone, notifiche, cancellazione, passaggi in zona, coordinate riservate, zona nel profilo, permessi delle funzioni) più l'aggiornamento dal vecchio schema, Playwright sull'anteprima prima del merge e sul sito vivo dopo. Fallisce ⇒ niente merge: `main` è protetta da un ruleset versionato (`.github/rulesets/`) |
| Integration / E2E testing | ✅ | Playwright sull'**anteprima** della PR, prima del merge: smoke su accesso/privacy sempre, e il flusso completo a due utenti (crea comitiva → pubblica auto → entra col codice → prenota il sedile → realtime) quando ci sono i segreti degli account di prova. Più i controlli sullo schema e sull'isolamento fra comitive nel job `schema`. Dalla Fase 4 lo smoke verifica anche cose che solo un browser vede: che la posizione **non sia spenta dagli header**, che l'app si apra senza rete e lo dica, che il manifest dichiari le PNG che servono a installarla, che `robots.txt` e `sitemap.xml` si parlino (ogni `<loc>` viene interrogato) e che il 404 risponda 404. Due di questi hanno trovato difetti veri prima del merge |
| Regression testing | ✅ (proporzionato) | Lint e validazione HTML bloccanti, migrazioni riapplicate da zero a ogni push, isolamento fra comitive verificato in CI, flusso completo a due utenti su anteprima. Nessun test unitario: a questa scala il valore sta nei percorsi interi |
| Load / stress / chaos testing | ➖ N/A | Carico atteso: decine di utenti. Postgres/Netlify reggono ordini di grandezza in più; test di carico non giustificato |
| Code review | ✅ (processo) | Sviluppo su `main` con commit atomici e messaggi descrittivi; per più contributor: branch + PR con CI verde obbligatoria |

## Accessibilità e documentazione

| Area | Stato | Dove / come |
|---|---|---|
| Accessibility | ✅ | Sedili navigabili da tastiera (tabindex + Enter/Spazio), `aria-label`/`title` su icone e SVG, `role="alert"`/`role="status"` sui messaggi, contrasti verificati in chiaro e scuro, `prefers-reduced-motion` rispettato, target touch ≥ 40px |
| Documentation | ✅ | `README.md` (setup), questo file, `docs/ARCHITECTURE.md` (diagramma + contratto API), `docs/adr/` (decisioni) |

## Come si riprovano queste righe da fuori

Una riga di questa tabella vale finché il comando che le sta accanto le dà ragione. Le righe che
parlano di **cosa risponde il database a chi non ha un account** si riprovano tutte con uno script
solo, che usa la sola chiave pubblica di `config.js`:

```
node --no-warnings supabase/test/sonde-esterne.mjs
```

Non gira in CI e non deve: punta al progetto Supabase vero, non a un Postgres di prova. Legge e
basta — `bloccati_fra` e `sospeso` sono `stable`, e `join_group` con un codice inesistente alza
prima di scrivere.

| Sonda | Cosa stampa oggi | Cosa deve stampare dopo la migrazione |
|---|---|---|
| `bloccati_fra(a, b)` | `200` — risponde a chiunque su due estranei | `42501` dopo la `020` |
| `sospeso(u)` | `200` — lo stato di moderazione di chiunque | `42501` dopo la `020` |
| `join_group('ZZZZZ9')` | `400` / `P0001` — e un codice che *esiste* darebbe un errore diverso | `42501` dopo la `020` |
| `mio_profilo()` | `404` / `PGRST202` — la funzione non c'è ancora | `42501` dopo la `018` (esiste, ma solo per chi ha un account) |

Misurate il 31/07/2026 sul progetto di produzione. Il giorno in cui una di queste stampa un valore
diverso, non è la sonda a essere rotta: è questa pagina a essere invecchiata, e la riga
corrispondente della tabella va riscritta. Lo script lo dice da solo nell'ultima riga.

Il resto dello stato di sicurezza si riprova invece **dentro** il database, con i file
`supabase/test/verifica-*.sql` che la CI esegue a ogni push (job `schema`).
