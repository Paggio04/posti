-- 005 — "Cerco un passaggio": chi resta a piedi lo dichiara per un giorno.

create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  group_id uuid references public.groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Una richiesta per persona, per giorno, per gruppo.
create unique index if not exists ride_requests_uni
  on public.ride_requests (user_id, ride_date, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.ride_requests enable row level security;
drop policy if exists "requests read" on public.ride_requests;
create policy "requests read" on public.ride_requests for select to authenticated
  using (group_id is null or public.is_member(group_id));
drop policy if exists "requests insert own" on public.ride_requests;
create policy "requests insert own" on public.ride_requests for insert with check (auth.uid() = user_id);
drop policy if exists "requests delete own" on public.ride_requests;
create policy "requests delete own" on public.ride_requests for delete using (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('005_richieste_passaggio') on conflict do nothing;
