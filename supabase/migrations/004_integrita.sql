-- 004 — Regole di integrita': cosa il database rifiuta a prescindere dal client.
--
-- Sono la traduzione delle regole della comitiva: una macchina per guidatore al giorno,
-- un posto solo per giorno, niente prenotazioni su auto gia' partite. Stanno qui e non
-- nel client perche' il client non e' fidato (ADR 001, punto 2).
-- I coalesce(..., '000...') servono a trattare "senza gruppo" come un gruppo a se':
-- spariranno con il cantiere C4, quando il gruppo diventera' obbligatorio.

create unique index if not exists rides_one_per_day
  on public.rides (driver_id, ride_date, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid));

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

insert into public.schema_migrations (version) values ('004_integrita') on conflict do nothing;
