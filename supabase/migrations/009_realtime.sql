-- 009 — Tabelle esposte al realtime.
--
-- Va per ultimo: aggiunge alla pubblicazione tabelle nate in file diversi.
-- "alter publication ... add table" non e' ripetibile (errore se la tabella c'e' gia'),
-- quindi ogni aggiunta e' protetta da un controllo: cosi' il file si puo' rilanciare.
-- Le policy valgono anche sugli eventi realtime: si ricevono solo le righe che si potrebbero leggere.

do $$
declare t text;
begin
  foreach t in array array['rides', 'seat_claims', 'ride_requests', 'ride_waitlist'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version) values ('009_realtime') on conflict do nothing;
