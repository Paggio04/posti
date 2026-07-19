# ADR 001 — Decisioni architetturali fondanti

Stato: accettate. Data: luglio 2026.

## 1. Vanilla HTML/CSS/JS, nessun framework e nessuna build
Contesto: ambiente di sviluppo senza Node; app piccola; deploy statico.
Decisione: niente React/Vite; ES modules nativi, supabase-js da CDN.
Conseguenze: zero supply chain npm, deploy istantaneo; in cambio niente typing né componenti riusabili. Rivedere se l'app supera ~2–3k righe di JS.

## 2. Sicurezza nel database (RLS + trigger), client non fidato
Decisione: ogni regola di accesso e integrità (un posto per giorno, no auto doppie, no viaggi passati) è policy RLS o trigger Postgres; il client fa solo UX.
Conseguenze: la anon key può essere pubblica; qualunque client alternativo resta vincolato. I messaggi d'errore dei trigger sono in italiano e mostrati direttamente.

## 3. Gruppi come tenant, ingresso solo via RPC
Decisione: `groups` non è leggibile se non sei membro; `join_group(code)` è `security definer` così il codice invito non è enumerabile via select.
Conseguenze: isolamento dati tra comitive; il codice è l'unico segreto condiviso, ruotabile ricreando il gruppo.

## 4. Concorrenza risolta con vincoli unique, non con lock applicativi
Decisione: due utenti che tappano lo stesso sedile ⇒ unique `(ride_id, seat_index)`; il perdente riceve 23505 e un messaggio chiaro.
Conseguenze: nessuna race possibile indipendentemente dal client; retry sicuri (idempotenza per vincolo).

## 5. Hosting Netlify da GitHub, migrazioni SQL manuali versionate
Decisione: deploy automatico su push a `main`; lo schema DB vive in `supabase-setup.sql` (idempotente dove possibile) applicato via SQL editor.
Conseguenze: un solo file ricrea il backend da zero; il file è la fonte di verità dello schema.
