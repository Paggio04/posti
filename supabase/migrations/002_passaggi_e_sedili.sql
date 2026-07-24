-- 002 — Passaggi pubblicati dai guidatori e prenotazioni dei sedili.
--
-- fuel_per_person (contributo benzina a testa) e' nata dopo: sta nella create table
-- per i database nuovi e come add column if not exists per quello esistente.
-- La policy di lettura dei passaggi non sta qui ma in 003: dipende dai gruppi.

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  depart_time time,
  origin text check (char_length(origin) <= 60),
  destination text check (char_length(destination) <= 60),
  seats int not null default 4 check (seats between 1 and 6),
  note text check (char_length(note) <= 200),
  fuel_per_person numeric check (fuel_per_person >= 0 and fuel_per_person <= 100),
  created_at timestamptz not null default now()
);
alter table public.rides add column if not exists fuel_per_person numeric
  check (fuel_per_person >= 0 and fuel_per_person <= 100);

alter table public.rides enable row level security;
drop policy if exists "rides insert own" on public.rides;
create policy "rides insert own" on public.rides for insert with check (auth.uid() = driver_id);
drop policy if exists "rides update own" on public.rides;
create policy "rides update own" on public.rides for update using (auth.uid() = driver_id);
drop policy if exists "rides delete own" on public.rides;
create policy "rides delete own" on public.rides for delete using (auth.uid() = driver_id);

-- Prenotazioni sedili. seat_index 1..seats; lo 0 e' il guidatore e non si prenota.
-- I due unique sono la difesa contro le corse critiche: due tap sullo stesso sedile,
-- uno solo vince, senza bisogno di lock nel client (ADR 001, punto 4).
create table if not exists public.seat_claims (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  seat_index int not null check (seat_index between 1 and 6),
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ride_id, seat_index),
  unique (ride_id, passenger_id)
);
alter table public.seat_claims enable row level security;

-- Vedi le prenotazioni solo dei passaggi che gia' puoi vedere: la sottoquery su rides
-- passa a sua volta dalle policy di rides.
drop policy if exists "claims read" on public.seat_claims;
create policy "claims read" on public.seat_claims for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));
drop policy if exists "claims insert own" on public.seat_claims;
create policy "claims insert own" on public.seat_claims for insert with check (auth.uid() = passenger_id);
drop policy if exists "claims delete own or driver" on public.seat_claims;
create policy "claims delete own or driver" on public.seat_claims for delete
  using (auth.uid() = passenger_id
     or exists (select 1 from public.rides r where r.id = ride_id and r.driver_id = auth.uid()));

insert into public.schema_migrations (version) values ('002_passaggi_e_sedili') on conflict do nothing;
