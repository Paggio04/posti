-- 007 — Commenti sotto ogni auto (dove ci si trova, a che ora, chi porta cosa).

create table if not exists public.ride_comments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

alter table public.ride_comments enable row level security;
-- Un commento si vede se si vede l'auto: la visibilita' segue quella del passaggio.
drop policy if exists "comments read" on public.ride_comments;
create policy "comments read" on public.ride_comments for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));
drop policy if exists "comments insert own" on public.ride_comments;
create policy "comments insert own" on public.ride_comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments delete own" on public.ride_comments;
create policy "comments delete own" on public.ride_comments for delete using (auth.uid() = user_id);

insert into public.schema_migrations (version) values ('007_commenti') on conflict do nothing;
