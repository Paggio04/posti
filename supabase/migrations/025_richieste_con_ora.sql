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

insert into public.schema_migrations (version) values ('025_richieste_con_ora') on conflict do nothing;
