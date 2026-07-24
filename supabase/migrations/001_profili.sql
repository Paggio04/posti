-- 001 — Profili utente e creazione automatica alla registrazione.
--
-- Le colonne avatar_url e is_admin sono nate dopo, come ALTER: qui stanno sia nella
-- create table (database nuovo) sia come add column if not exists (database gia' esistente).
-- Ogni file di questa cartella e' scritto per portare allo stesso risultato in tutti e due i casi.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists is_admin boolean not null default false;

alter table public.profiles enable row level security;

-- Lettura aperta a tutti gli autenticati: verra' stretta ai soli membri dei propri
-- gruppi nel cantiere C5 della roadmap. Vedi docs/ROADMAP.md.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);

-- Profilo creato automaticamente alla registrazione, con nome e foto presi dai
-- metadati dell'identita' (email/password, Google) quando ci sono.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.schema_migrations (version) values ('001_profili') on conflict do nothing;
