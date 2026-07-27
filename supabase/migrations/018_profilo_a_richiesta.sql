-- 018 — Il proprio profilo si chiede, invece di leggerlo dalla tabella.
--
-- Primo dei due file di C22, e nasce dallo stesso buco di forma della 015: **una policy
-- RLS e' di riga, non di colonna.** La policy `profiles read` decide *quali persone* si
-- leggono; decisa quella, la riga esce intera. Dentro `profiles` pero' ci sono tre colonne
-- che non sono "chi sei" ma "dove sei":
--
--   * `zona_lat` e `zona_lon` — il punto che il telefono ha misurato quando hai premuto
--     "Sono qui" sul profilo. Non e' un comune, e' una coppia di coordinate al metro, e
--     nella stragrande maggioranza dei casi e' casa tua;
--   * `zona_nome` — il nome che le hai dato, e che l'interfaccia dichiara «solo per te»;
--   * `sospeso_motivo` — quello che l'amministratore ha scritto sospendendo un account.
--     Lo deve leggere chi lo subisce, non la comitiva.
--
-- Chi condivide una comitiva le riceveva tutte con un `select=*` sull'API. Da C9 non serve
-- nemmeno la comitiva: la 014 apre la lettura del profilo anche a chi vede un passaggio
-- pubblico guidato (o occupato) da quella persona. Cioe' l'estraneo a cui C21 ha tolto le
-- coordinate del ritrovo poteva prendersi quelle di casa dal profilo di chi guida.
--
-- Questo file **aggiunge** e basta, quindi va applicato **prima** di pubblicare il codice
-- che se ne serve. Il file che toglie e' la 019, e va dopo → supabase/README.md.

-- Il proprio profilo, tutto, senza passare dalla tabella. `security definer` e senza
-- parametri per la stessa ragione di `elimina_account()`: sa rispondere di una persona
-- sola, chi la chiama. `setof public.profiles` invece di un elenco di colonne perche'
-- cosi' una colonna nuova entra da sola: un elenco qui dentro sarebbe la seconda copia
-- da tenere allineata, e prima o poi diverge.
create or replace function public.mio_profilo()
returns setof public.profiles
language sql security definer stable set search_path = public as $$
  select p.* from profiles p where p.id = auth.uid()
$$;

revoke all on function public.mio_profilo() from public, anon;
grant execute on function public.mio_profilo() to authenticated;

insert into public.schema_migrations (version) values ('018_profilo_a_richiesta') on conflict do nothing;
