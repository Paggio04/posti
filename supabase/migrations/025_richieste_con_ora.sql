-- 025 — «Cerco un passaggio» dice anche a che ora.
--
-- `ride_requests` (005) e' una bandierina: persona + giorno. Dice **che** qualcuno e'
-- a piedi, non **quando** gli serve — e senza l'ora chi guida non sa se il passaggio
-- che sta per pubblicare gli serve davvero. Due colonne, entrambe facoltative: una
-- richiesta senza ora resta valida ed e' quella di oggi.
--
-- Nessuna policy nuova. Le tre della 005 sono di riga e nominano `user_id`: chi puo'
-- scrivere la riga puo' scrivere le sue colonne, e chi la legge era gia' il gruppo.
-- Aggiungere colonne a una tabella con RLS non allarga la lettura — ma vale la pena
-- dirlo, perche' e' l'errore di C21 e C22 al contrario.

alter table public.ride_requests
  add column if not exists ora time,
  add column if not exists nota text;

-- La nota la legge tutta la comitiva: e' un messaggio, non un dato personale, e piu'
-- corta e' meno diventa un posto dove scrivere cose che non c'entrano.
alter table public.ride_requests drop constraint if exists ride_requests_nota_corta;
alter table public.ride_requests
  add constraint ride_requests_nota_corta check (nota is null or length(nota) <= 120);

-- ── E l'archivio della 010 va tenuto della stessa forma ─────────────────────
--
-- La 010 archivia le richieste senza comitiva cosi':
--
--     create table if not exists ..._archivio_senza_gruppo (like public.ride_requests ...)
--     insert into ..._archivio_senza_gruppo select * from public.ride_requests ...
--
-- che e' corretto **finche' `ride_requests` non guadagna colonne**. Al secondo giro
-- delle migrazioni — che la CI fa apposta, perche' devono essere ripetibili — la
-- tabella esiste gia' con le colonne di prima, mentre `select *` adesso ne produce
-- due in piu': `INSERT has more expressions than target columns`, e la 010 muore.
--
-- La riparazione sta qui e non nella 010 perche' **una migrazione applicata non si
-- tocca**: la 010 e' in produzione da settimane, e cambiarla vorrebbe dire che il file
-- nel repo non e' piu' quello che il database ha eseguito. Qui invece si aggiunge, e
-- l'ordine funziona: al primo giro la 010 crea l'archivio e poi questa riga lo allinea,
-- al secondo giro le due tabelle hanno gia' la stessa forma e `select *` torna.
--
-- Regola generale, che vale per le prossime: **aggiungere una colonna a una tabella
-- archiviata con `select *` e' un cambiamento a due tabelle, non a una.**
do $$
begin
  if to_regclass('public.ride_requests_archivio_senza_gruppo') is not null then
    alter table public.ride_requests_archivio_senza_gruppo
      add column if not exists ora time,
      add column if not exists nota text;
  end if;
end $$;

insert into public.schema_migrations (version) values ('025_richieste_con_ora') on conflict do nothing;
