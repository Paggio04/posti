# Sicurezza e qualità — stato per area

Stack: sito statico (Netlify) + Supabase (Postgres, Auth, Realtime). Nessun server proprio:
molte responsabilità sono delegate per progetto ai managed service. Questo file dice, per
ogni area, cosa è implementato, dove, e cosa è delegato o non applicabile.

## Sicurezza

| Area | Stato | Dove / come |
|---|---|---|
| Input sanitization / injection | ✅ | Nessun `innerHTML` con input utente (solo `textContent`); query via supabase-js (parametrizzate, niente SQL concatenato); vincoli `check` su lunghezze e valori in ogni tabella; CSP blocca script esterni non autorizzati |
| Authentication | ✅ | Supabase Auth: email+password, conferma email obbligatoria, reset password. Token JWT gestiti da supabase-js |
| Authorization / ruoli | ✅ | Row Level Security su tutte le 6 tabelle. Ruoli impliciti: guidatore (gestisce la propria auto e i suoi sedili), passeggero (solo il proprio posto), owner gruppo (update/delete gruppo). Funzioni `security definer` solo per create/join gruppo |
| Session management / token expiry | ✅ (delegato) | JWT Supabase: access token 1h, refresh automatico via supabase-js, revoca al logout |
| Secrets management | ✅ | Nel repo c'è solo la publishable key (pubblica per design, la sicurezza è nelle RLS). La secret key non ha mai lasciato la dashboard. CI fallisce se compare `sb_secret`/`service_role` nel codice |
| HTTPS / TLS / certificati | ✅ (delegato) | Netlify: TLS automatico (Let's Encrypt), redirect HTTPS. HSTS 1 anno + `upgrade-insecure-requests` via `netlify.toml` |
| Rate limiting / abuse prevention | ✅ (delegato) + vincoli | Supabase Auth ha rate limit integrati (signup, login, email). Abusi sui dati limitati dai vincoli DB: unique su posti/auto/richieste, trigger che rifiutano operazioni non valide |
| Dependency scanning / patching | ✅ (minimale by design) | Zero dipendenze npm; unica dipendenza runtime è supabase-js v2 da CDN (major pinnata, patch automatiche). CSP limita le sorgenti script a jsdelivr |
| Multi-tenancy / data isolation | ✅ | I gruppi sono i tenant: RLS `is_member()` isola passaggi, membri e richieste per gruppo; i codici invito non sono enumerabili (join solo via RPC) |
| PII handling | ✅ | PII minima: email (solo in `auth.users`, mai esposta ad altri utenti) e nome visibile scelto dall'utente. Nessun tracker/analytics di terze parti |
| Data retention / cancellazione | ✅ | Eliminando l'account (`auth.users`) tutto cascata via FK `on delete cascade`: profilo, auto, posti, richieste, commenti, gruppi posseduti |
| Compliance (GDPR) | ⚠️ parziale | Dati EU-hostabili (regione progetto Supabase), diritto all'oblio via cascade. Mancano: privacy policy pubblicata e processo formale di export dati — da fare prima di uso oltre la cerchia di amici |
| Audit trail / log tamper-evident | ✅ (delegato) | Log auth e API nella dashboard Supabase (non modificabili dal client); ogni riga ha `created_at`; Postgres WAL. Nessun log applicativo custom: non necessario a questa scala |

## Affidabilità

| Area | Stato | Dove / come |
|---|---|---|
| Error handling | ✅ | Ogni chiamata Supabase controlla `error`; messaggi utente in italiano (`friendlyError` + trigger DB); stato UI ripulito in caso di errore |
| Retry / backoff / idempotency | ✅ | Retry con backoff su `loadRides` (vedi `app.js`); le scritture sono idempotenti per vincolo (unique su seat/ride/request ⇒ un retry duplicato fallisce in modo sicuro, gestito) |
| Circuit breaker / fallback | ✅ (proporzionato) | `loadToken` scarta risposte fuori ordine; realtime che cade ⇒ l'app resta funzionante con refresh manuale (fallback implicito); toast "connessione instabile" |
| Race condition / concorrenza | ✅ | Risolte nel DB, non nel client: unique `(ride_id, seat_index)` ⇒ due tap sullo stesso sedile, uno solo vince; trigger transazionali per i vincoli incrociati |
| Caching / invalidation | ✅ (semplice by design) | Nessuna cache applicativa: la verità è sempre il DB, invalidazione via realtime. Asset statici: cache CDN Netlify invalidata a ogni deploy |
| Disaster recovery | ✅ (delegato) | Codice: Git/GitHub. DB: backup giornalieri Supabase (piano free: 7 giorni). Schema ricreabile da zero con `supabase-setup.sql`. Hosting ricreabile in minuti (repo → Netlify) |

## Testing e processo

| Area | Stato | Dove / come |
|---|---|---|
| CI con soglie bloccanti | ✅ | GitHub Actions (`.github/workflows/ci.yml`): sintassi JS, ESLint (no-undef, no-unused-vars, no-eval bloccanti), scan segreti. Fallisce ⇒ niente merge sereno |
| Integration / E2E testing | ⚠️ manuale | Verifica manuale su sito live a ogni deploy (auth, prenotazione, realtime). E2E automatizzato (Playwright) è il prossimo investimento sensato se il progetto cresce |
| Regression testing | ⚠️ manuale | Coperto da lint + smoke test manuale; nessuna suite automatica (rapporto costo/beneficio a questa scala) |
| Load / stress / chaos testing | ➖ N/A | Carico atteso: decine di utenti. Postgres/Netlify reggono ordini di grandezza in più; test di carico non giustificato |
| Code review | ✅ (processo) | Sviluppo su `main` con commit atomici e messaggi descrittivi; per più contributor: branch + PR con CI verde obbligatoria |

## Accessibilità e documentazione

| Area | Stato | Dove / come |
|---|---|---|
| Accessibility | ✅ | Sedili navigabili da tastiera (tabindex + Enter/Spazio), `aria-label`/`title` su icone e SVG, `role="alert"`/`role="status"` sui messaggi, contrasti verificati in chiaro e scuro, `prefers-reduced-motion` rispettato, target touch ≥ 40px |
| Documentation | ✅ | `README.md` (setup), questo file, `docs/ARCHITECTURE.md` (diagramma + contratto API), `docs/adr/` (decisioni) |
