# ADR 002 — Migrazioni numerate al posto del file unico

Stato: accettata. Data: 24 luglio 2026. Sostituisce la seconda metà dell'[ADR 001, punto 5](001-decisioni-architetturali.md).

## Contesto

L'ADR 001 diceva: lo schema vive in `supabase-setup.sql`, «un solo file ricrea il backend da
zero», applicato a mano dal SQL editor. Alla verifica, il file non faceva né l'una né l'altra cosa.

Provato su un Postgres 16 vuoto, con le parti di Supabase simulate:

1. **Non ricreava niente da zero.** Alla riga 234 creava una policy su `public.ride_comments`,
   tabella definita alla riga 338: `ERROR: relation "public.ride_comments" does not exist`, e il
   file si fermava lì. La frase nel README era falsa da mesi e nessuno se n'era accorto, perché
   in produzione lo schema è cresciuto per pezzi, mai riapplicato tutto insieme.
2. **Non era ripetibile.** Il blocco `ride_waitlist` (tabella, policy, trigger di promozione)
   compariva due volte, righe 260 e 303. `create policy` non ha `if not exists`: la seconda
   copia dà errore su un database già inizializzato.
3. **Nessuno sapeva cosa fosse applicato.** Il file cresceva in fondo, l'applicazione era
   manuale e non lasciava traccia. Codice pubblicato e schema attivo potevano divergere in
   silenzio — e con il push su `main` che pubblica da solo, la divergenza si scopre dagli utenti.

## Decisione

Lo schema si spezza in file numerati in `supabase/migrations/`, applicati in ordine crescente.

- **Ogni file è ripetibile**: `if not exists`, `create or replace`, `drop policy if exists`
  prima di ogni `create policy`. Rilanciarlo non dà errore.
- **Ogni file converge da due punti di partenza**: database vuoto e database di produzione già
  popolato devono arrivare allo stesso risultato. Per questo una colonna aggiunta in corsa
  compare sia nella `create table` sia come `add column if not exists`.
- **Ogni file si registra** in `public.schema_migrations`: quale schema sia applicato lo dice il
  database, non la memoria.
- **Un file già applicato in produzione non si modifica più**: si aggiunge il successivo.
- **La CI lo verifica** a ogni push (job `schema`): parte da un Postgres vuoto, applica tutto in
  ordine, poi riapplica tutto una seconda volta. Se una delle due passate fallisce, la CI è rossa.
  `supabase/test/stub-supabase.sql` simula quello che le migrazioni si aspettano da Supabase:
  schema `auth`, `auth.uid()`, i ruoli, la pubblicazione del realtime.

## Conseguenze

- Il backend si ricrea davvero da zero, e adesso è una cosa che una macchina controlla a ogni
  push invece di una frase in un README.
- Lo schema ricostruito dalle migrazioni è stato confrontato riga per riga con quello prodotto
  dal vecchio file: 8 tabelle, 43 colonne, 9 funzioni, 5 trigger, 14 indici identici, e **una
  policy in più** — `admin all` su `ride_comments`, quella che il vecchio file non riusciva mai
  a creare. Cioè: un amministratore non ha mai potuto moderare i commenti.
- L'applicazione resta manuale, dal SQL editor: nessun automatismo che tocchi il database di
  produzione senza che qualcuno prema un tasto. Automatizzarla è una decisione successiva, da
  prendere solo con un ambiente di prova davanti (roadmap, cantiere C9).
- `supabase-setup.sql` resta come segnaposto che rimanda qui, così i link e le note già scritte
  altrove non si rompono.
