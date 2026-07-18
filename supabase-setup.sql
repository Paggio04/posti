-- Schema Posti (posti in macchina): profili, passaggi, prenotazioni sedili
drop table if exists public.posti;

-- Profili utente (nome visibile)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);

-- Auto-crea profilo alla registrazione
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Passaggi offerti dai guidatori
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  depart_time time,
  origin text check (char_length(origin) <= 60),
  destination text check (char_length(destination) <= 60),
  seats int not null default 4 check (seats between 1 and 6),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now()
);
alter table public.rides enable row level security;
create policy "rides read" on public.rides for select to authenticated using (true);
create policy "rides insert own" on public.rides for insert with check (auth.uid() = driver_id);
create policy "rides update own" on public.rides for update using (auth.uid() = driver_id);
create policy "rides delete own" on public.rides for delete using (auth.uid() = driver_id);

-- Prenotazioni sedili (seat_index 1..seats; 0 = guidatore, non prenotabile)
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
create policy "claims read" on public.seat_claims for select to authenticated using (true);
create policy "claims insert own" on public.seat_claims for insert with check (auth.uid() = passenger_id);
create policy "claims delete own or driver" on public.seat_claims for delete
  using (auth.uid() = passenger_id
     or exists (select 1 from public.rides r where r.id = ride_id and r.driver_id = auth.uid()));
