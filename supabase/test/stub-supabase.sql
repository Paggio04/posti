-- Finto Supabase per collaudare le migrazioni su un Postgres vuoto.
-- NON va mai applicato su Supabase: la' queste cose esistono gia' per davvero.
-- Serve solo a rispondere alla domanda "le migrazioni ricreano il backend da zero?".
-- Uso: vedi supabase/README.md.

-- Ruoli usati dalle policy ("to authenticated").
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- Schema auth: qui c'e' solo cio' che le migrazioni toccano davvero.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid(): su Supabase legge l'utente dal JWT. Qui lo legge da una variabile di
-- sessione, cosi' nei test si puo' "diventare" un utente con
--   select set_config('test.uid', '<uuid>', false);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- Pubblicazione del realtime.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
