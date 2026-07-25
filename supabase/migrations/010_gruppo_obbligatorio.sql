-- 010 — Il gruppo diventa obbligatorio: sparisce la modalita' "senza comitiva".
--
-- Perche': un passaggio con group_id nullo era visibile a TUTTI gli utenti registrati.
-- Con l'app aperta a chiunque non e' una comodita', e' una falla. Dopo questo file ogni
-- passaggio e ogni richiesta appartengono a una comitiva, e si vedono solo dentro quella.
-- Decisione D1, cantiere C4 di docs/ROADMAP.md.
--
-- Nota: qui si cancellano righe. Vengono prima copiate nelle tabelle *_archivio_senza_gruppo,
-- che restano nel database e non sono leggibili dal client (RLS attiva, nessuna policy).

-- ===== 1. Archivio delle righe senza gruppo =====
create table if not exists public.rides_archivio_senza_gruppo (like public.rides including defaults);
create table if not exists public.seat_claims_archivio_senza_gruppo (like public.seat_claims including defaults);
create table if not exists public.ride_requests_archivio_senza_gruppo (like public.ride_requests including defaults);
create table if not exists public.ride_comments_archivio_senza_gruppo (like public.ride_comments including defaults);
create table if not exists public.ride_waitlist_archivio_senza_gruppo (like public.ride_waitlist including defaults);

alter table public.rides_archivio_senza_gruppo enable row level security;
alter table public.seat_claims_archivio_senza_gruppo enable row level security;
alter table public.ride_requests_archivio_senza_gruppo enable row level security;
alter table public.ride_comments_archivio_senza_gruppo enable row level security;
alter table public.ride_waitlist_archivio_senza_gruppo enable row level security;

-- Prima i figli, poi i padri: cancellare un passaggio porta via in cascata prenotazioni,
-- commenti e lista d'attesa, e a quel punto non ci sarebbe piu' niente da archiviare.
insert into public.seat_claims_archivio_senza_gruppo
  select sc.* from public.seat_claims sc
  join public.rides r on r.id = sc.ride_id where r.group_id is null;
insert into public.ride_comments_archivio_senza_gruppo
  select rc.* from public.ride_comments rc
  join public.rides r on r.id = rc.ride_id where r.group_id is null;
insert into public.ride_waitlist_archivio_senza_gruppo
  select rw.* from public.ride_waitlist rw
  join public.rides r on r.id = rw.ride_id where r.group_id is null;
insert into public.rides_archivio_senza_gruppo select * from public.rides where group_id is null;
insert into public.ride_requests_archivio_senza_gruppo select * from public.ride_requests where group_id is null;

delete from public.rides where group_id is null;
delete from public.ride_requests where group_id is null;

-- ===== 2. Il vincolo =====
alter table public.rides alter column group_id set not null;
alter table public.ride_requests alter column group_id set not null;

-- ===== 3. Indici senza il caso "senza gruppo" =====
drop index if exists public.rides_one_per_day;
create unique index if not exists rides_one_per_day
  on public.rides (driver_id, ride_date, group_id);
drop index if exists public.ride_requests_uni;
create unique index if not exists ride_requests_uni
  on public.ride_requests (user_id, ride_date, group_id);

-- ===== 4. Lettura: solo dentro la propria comitiva =====
drop policy if exists "rides read" on public.rides;
create policy "rides read" on public.rides for select to authenticated
  using (public.is_member(group_id));
drop policy if exists "requests read" on public.ride_requests;
create policy "requests read" on public.ride_requests for select to authenticated
  using (public.is_member(group_id));

-- ===== 5. Scrittura: solo dentro una comitiva di cui si fa parte =====
-- Prima bastava dire "sono io il guidatore": chi conosceva l'id di un gruppo poteva
-- pubblicarci dentro un'auto pur non essendone membro. Ora serve l'appartenenza.
drop policy if exists "rides insert own" on public.rides;
create policy "rides insert own" on public.rides for insert
  with check (auth.uid() = driver_id and public.is_member(group_id));
drop policy if exists "rides update own" on public.rides;
create policy "rides update own" on public.rides for update
  using (auth.uid() = driver_id) with check (auth.uid() = driver_id and public.is_member(group_id));
drop policy if exists "requests insert own" on public.ride_requests;
create policy "requests insert own" on public.ride_requests for insert
  with check (auth.uid() = user_id and public.is_member(group_id));

-- Commenti e lista d'attesa: si scrive solo su un passaggio che si potrebbe leggere.
-- La sottoquery su rides passa dalle policy di rides, quindi il filtro e' quello giusto.
drop policy if exists "comments insert own" on public.ride_comments;
create policy "comments insert own" on public.ride_comments for insert
  with check (auth.uid() = user_id and exists (select 1 from public.rides r where r.id = ride_id));
drop policy if exists "waitlist insert own" on public.ride_waitlist;
create policy "waitlist insert own" on public.ride_waitlist for insert
  with check (auth.uid() = user_id and exists (select 1 from public.rides r where r.id = ride_id));

-- ===== 6. Controlli di integrita' senza i coalesce =====
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
      and r.group_id = new.group_id
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno: prima scendi, poi pubblica la tua.';
  end if;
  return new;
end; $$;

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
      and r2.group_id = r.group_id
  ) then
    raise exception 'Quel giorno guidi tu: non puoi prenotare un posto su un''altra auto.';
  end if;
  if exists (
    select 1 from public.seat_claims sc
    join public.rides r2 on r2.id = sc.ride_id
    where sc.passenger_id = new.passenger_id
      and sc.ride_id <> new.ride_id
      and r2.ride_date = r.ride_date
      and r2.group_id = r.group_id
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno.';
  end if;
  return new;
end; $$;

insert into public.schema_migrations (version) values ('010_gruppo_obbligatorio') on conflict do nothing;
