# Schema del database

Lo schema vive in `migrations/`, un file numerato per volta. **Non si modifica lo schema
a mano dalla dashboard**: si aggiunge un file qui, e lo si applica.

## Applicare (Supabase, SQL editor)

In ordine crescente, dal primo non ancora applicato. Quali siano lo dice il database stesso:

```sql
select version, applied_at from public.schema_migrations order by version;
```

Ogni file si registra da solo in quella tabella. Se una migrazione non compare, non è stata
applicata: nessuna memoria da tenere a mente, nessun "mi pare di averlo già fatto".

## Ricreare il backend da zero

Progetto Supabase nuovo → applicare tutti i file di `migrations/` in ordine. Non serve altro.

## Regole per scrivere una migrazione nuova

1. **Numero progressivo** e nome che dice cosa fa: `010_luoghi.sql`.
2. **Ripetibile**: `create table if not exists`, `create or replace function`,
   `drop policy if exists` prima di ogni `create policy`, `drop trigger if exists` prima di
   ogni `create trigger`, `add column if not exists`. Rilanciarla non deve dare errore.
3. **Deve valere in tutti e due i mondi**: database vuoto e database di produzione già
   popolato. Per questo una colonna nuova compare sia nella `create table` sia come
   `add column if not exists`.
4. **Ultima riga**: la registrazione in `schema_migrations`.
5. **Mai modificare un file già applicato in produzione.** Si aggiunge il successivo.

## Notifiche (cantiere C13)

Lo schema c'e' ed e' verificato in CI (`017_notifiche.sql`, `test/verifica-notifiche.sql`):
i trigger accodano, la coda non e' leggibile dal client, e la stessa cosa non si accoda due
volte. **Quello che manca non e' codice, sono tre cose che vivono fuori dal repo**, e finche'
non ci sono l'unica conseguenza e' che la coda si riempie e nessuno la svuota — l'app
funziona lo stesso.

1. **Le due chiavi VAPID.** Si generano una volta sola, con `npx web-push generate-vapid-keys`.
   - la **pubblica** va in `config.js` (`VAPID_PUBLIC_KEY`): e' pubblica per definizione, e
     finche' quella riga e' vuota l'app non mostra nemmeno l'interruttore;
   - la **privata** va nei segreti della Edge Function, e **da nessuna altra parte**.
2. **Il deploy della funzione**, che questo repo non puo' fare (serve la CLI e un token):
   ```
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_SECRET=...
   supabase functions deploy notifiche
   ```
   Il codice sta in `supabase/functions/notifiche/index.ts`. **Non e' mai stato eseguito**:
   il primo giro va guardato nei log.
3. **`pg_cron` che la chiama**, ogni dieci minuti. Dal SQL editor, una volta:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('notifiche', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/notifiche',
       headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb
     )
   $$);
   ```
   La finestra delle partenze e' larga venti minuti proprio perche' il cron gira ogni dieci:
   un giro saltato non fa perdere l'avviso, e la chiave della coda impedisce il doppione.

Le notifiche sono **tre** e non di piu' (decisione D5): posto prenotato nella tua auto, sei
salito dalla lista d'attesa, la tua auto parte fra un'ora. Commenti e auto nuove no: sono la
maggior parte del traffico, e un'app che notifica troppo viene silenziata — e allora non
notifica piu' niente.

## Collaudare in locale (serve Postgres)

`test/stub-supabase.sql` ricrea le parti di Supabase che le migrazioni toccano — lo schema
`auth`, `auth.uid()`, i ruoli `authenticated`/`anon`/`service_role`, la pubblicazione del
realtime — così le migrazioni si possono provare su un Postgres qualsiasi.
Quel file **non va mai applicato su Supabase**: lì quelle cose esistono per davvero.

```
createdb prova
psql -d prova -v ON_ERROR_STOP=1 -f supabase/test/stub-supabase.sql
for f in supabase/migrations/*.sql; do psql -d prova -v ON_ERROR_STOP=1 -f "$f"; done
```

Nella CI questo gira a ogni push, due volte di fila, sul job `schema`: la prima passata
verifica che il backend si ricrei da zero, la seconda che le migrazioni siano ripetibili.

## Perché non un file solo

C'era, era `supabase-setup.sql`, e non funzionava: su un database vuoto si fermava a metà
(una policy su `ride_comments` prima che la tabella esistesse), e conteneva due volte lo
stesso blocco, quindi rilanciarlo dava errore. Il dettaglio sta in
`docs/adr/002-migrazioni-numerate.md`.

## In che ordine si pubblica, codice e schema

Non c'e' una risposta sola, e sbagliarla si vede subito sul sito vivo:

> Si applica per prima la meta' che l'altra non puo' ignorare. Una migrazione che **toglie** va
> **dopo** il codice che regge il vincolo; una migrazione che **aggiunge** va **prima** del codice
> che se ne serve.

Successo due volte, in due sensi opposti. La 011 chiudeva i profili: applicata prima della
pubblicazione avrebbe mandato in errore l'app vecchia, che leggeva `driver.display_name` senza
rete. Le 012-014 aggiungono colonne e tabelle che il codice nuovo interroga al primo caricamento
(`sospeso`, `user_blocks`, `visibilita`): pubblicare quel codice prima di applicarle vuol dire
un'app che non parte affatto.

Nel dubbio, la domanda giusta e' una sola: **quale delle due meta' sopravvive senza l'altra?**
Quella parte per prima.
