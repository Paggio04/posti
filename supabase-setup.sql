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

-- ===== Gruppi (comitive private con codice invito) =====
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- Evita ricorsione RLS: membership check con security definer
create or replace function public.is_member(g uuid) returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from group_members where group_id = g and user_id = auth.uid()) $$;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
create policy "groups read member" on public.groups for select to authenticated using (public.is_member(id));
create policy "groups update owner" on public.groups for update using (auth.uid() = owner_id);
create policy "groups delete owner" on public.groups for delete using (auth.uid() = owner_id);
create policy "members read" on public.group_members for select to authenticated using (public.is_member(group_id));
create policy "members leave" on public.group_members for delete using (auth.uid() = user_id);

-- Creazione e ingresso via RPC (security definer: il codice resta segreto)
create or replace function public.create_group(p_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  insert into groups (name, owner_id) values (p_name, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end; $$;

create or replace function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'Codice non valido'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end; $$;

-- I passaggi possono appartenere a un gruppo
alter table public.rides add column if not exists group_id uuid references public.groups(id) on delete cascade;
drop policy if exists "rides read" on public.rides;
create policy "rides read" on public.rides for select to authenticated
  using (group_id is null or public.is_member(group_id));

-- Le prenotazioni si vedono solo se si vede il passaggio
drop policy if exists "claims read" on public.seat_claims;
create policy "claims read" on public.seat_claims for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));

-- Realtime su passaggi e prenotazioni
alter publication supabase_realtime add table public.rides;
alter publication supabase_realtime add table public.seat_claims;

-- ===== Controlli di integrità =====
-- Un guidatore può pubblicare una sola auto per giorno (per gruppo)
create unique index if not exists rides_one_per_day
  on public.rides (driver_id, ride_date, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Controlli alla pubblicazione di un viaggio
create or replace function public.check_ride() returns trigger
language plpgsql as $$
begin
  if new.ride_date < current_date then
    raise exception 'Non puoi pubblicare un viaggio in un giorno passato.';
  end if;
  if exists (
    select 1 from public.seat_claims sc
    join public.rides r on r.id = sc.ride_id
    where sc.passenger_id = new.driver_id
      and r.ride_date = new.ride_date
      and coalesce(r.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(new.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno: prima scendi, poi pubblica la tua.';
  end if;
  return new;
end; $$;
drop trigger if exists rides_check on public.rides;
create trigger rides_check before insert on public.rides
  for each row execute function public.check_ride();

-- Controlli alla prenotazione di un posto
create or replace function public.check_claim() returns trigger
language plpgsql as $$
declare r public.rides%rowtype;
begin
  select * into r from public.rides where id = new.ride_id;
  if r.id is null then raise exception 'Viaggio inesistente.'; end if;
  if r.ride_date < current_date then
    raise exception 'Questo viaggio è già passato.';
  end if;
  if r.ride_date = (now() at time zone 'Europe/Rome')::date
     and r.depart_time is not null
     and r.depart_time <= (now() at time zone 'Europe/Rome')::time then
    raise exception 'Auto già partita: non si può più prenotare.';
  end if;
  if new.seat_index > r.seats then
    raise exception 'Posto non valido per questa auto.';
  end if;
  if new.passenger_id = r.driver_id then
    raise exception 'Guidi tu questa auto: sei già a bordo.';
  end if;
  if exists (
    select 1 from public.rides r2
    where r2.driver_id = new.passenger_id
      and r2.ride_date = r.ride_date
      and coalesce(r2.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(r.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Quel giorno guidi tu: non puoi prenotare un posto su un''altra auto.';
  end if;
  if exists (
    select 1 from public.seat_claims sc
    join public.rides r2 on r2.id = sc.ride_id
    where sc.passenger_id = new.passenger_id
      and sc.ride_id <> new.ride_id
      and r2.ride_date = r.ride_date
      and coalesce(r2.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(r.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno.';
  end if;
  return new;
end; $$;
drop trigger if exists claims_check on public.seat_claims;
create trigger claims_check before insert on public.seat_claims
  for each row execute function public.check_claim();

-- ===== Richieste di passaggio ("cerco un posto") =====
create table if not exists public.ride_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  group_id uuid references public.groups(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists ride_requests_uni
  on public.ride_requests (user_id, ride_date, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.ride_requests enable row level security;
create policy "requests read" on public.ride_requests for select to authenticated
  using (group_id is null or public.is_member(group_id));
create policy "requests insert own" on public.ride_requests for insert with check (auth.uid() = user_id);
create policy "requests delete own" on public.ride_requests for delete using (auth.uid() = user_id);
alter publication supabase_realtime add table public.ride_requests;

-- ===== Ruolo amministratore =====
alter table public.profiles add column if not exists is_admin boolean not null default false;
create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and is_admin) $$;
-- L'admin può tutto, su tutte le tabelle (policy permissive in OR con le altre)
create policy "admin all" on public.rides for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.seat_claims for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.ride_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.ride_comments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all" on public.group_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin update profiles" on public.profiles for update using (public.is_admin());
-- Nessuno può auto-promuoversi: il flag lo cambia solo un admin
create or replace function public.protect_admin_flag() returns trigger
language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    raise exception 'Non puoi modificare i permessi di amministratore.';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();
-- Nomina del primo admin (da SQL editor):
-- update public.profiles set is_admin = true where id = (select id from auth.users where email = 'TUA_EMAIL');

-- ===== Commenti per auto =====
create table if not exists public.ride_comments (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.ride_comments enable row level security;
create policy "comments read" on public.ride_comments for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));
create policy "comments insert own" on public.ride_comments for insert with check (auth.uid() = user_id);
create policy "comments delete own" on public.ride_comments for delete using (auth.uid() = user_id);
