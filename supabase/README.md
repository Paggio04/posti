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
