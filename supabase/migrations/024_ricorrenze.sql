-- 024 — «Ogni lunedi' alle 7:40, Casa → Universita'».
--
-- Oggi un passaggio che si ripete si ripubblica a mano ogni volta. Qui si
-- descrive **la regola**, e i passaggi veri restano in `rides`: la ricorrenza
-- non e' un passaggio, e' cio' che ne genera uno.
--
-- La materializzazione la fa `crea_passaggi_ricorrenti()`, chiamata da `pg_cron`
-- con la chiave di servizio — lo stesso meccanismo che serve gia' alle notifiche
-- della 017, quindi si accende una volta e si usa per due cose.

create table if not exists public.ricorrenze (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups(id) on delete cascade,
  driver_id     uuid not null references auth.users(id) on delete cascade,
  -- 1 = lunedi' … 7 = domenica, come `isodow` di Postgres
  giorno        smallint not null check (giorno between 1 and 7),
  depart_time   time not null,
  origin        text not null check (length(origin) between 1 and 80),
  destination   text not null check (length(destination) between 1 and 80),
  seats         int not null check (seats between 1 and 8),
  fuel_per_person numeric(6,2) check (fuel_per_person is null or fuel_per_person >= 0),
  attiva        boolean not null default true,
  valida_da     date not null default current_date,
  valida_a      date,
  created_at    timestamptz not null default now(),
  constraint ricorrenza_finestra_valida check (valida_a is null or valida_a >= valida_da)
);

create index if not exists ricorrenze_gruppo_idx on public.ricorrenze (group_id, attiva);

alter table public.ricorrenze enable row level security;

-- La vede il gruppo: sapere che il lunedi' c'e' un'auto e' informazione utile a
-- tutti. La modifica solo chi guida.
drop policy if exists "ricorrenze read gruppo" on public.ricorrenze;
create policy "ricorrenze read gruppo" on public.ricorrenze for select to authenticated
  using (public.is_member(group_id));

drop policy if exists "ricorrenze insert guidatore" on public.ricorrenze;
create policy "ricorrenze insert guidatore" on public.ricorrenze for insert to authenticated
  with check (driver_id = auth.uid() and public.is_member(group_id));

drop policy if exists "ricorrenze update guidatore" on public.ricorrenze;
create policy "ricorrenze update guidatore" on public.ricorrenze for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

drop policy if exists "ricorrenze delete guidatore" on public.ricorrenze;
create policy "ricorrenze delete guidatore" on public.ricorrenze for delete to authenticated
  using (driver_id = auth.uid());

-- ── La materializzazione ────────────────────────────────────────────────────
-- Crea i passaggi dei prossimi `giorni_avanti` giorni, saltando quelli che
-- esistono gia'. E' **ripetibile**: rilanciarla non duplica niente.
create or replace function public.crea_passaggi_ricorrenti(giorni_avanti int default 14)
returns int
language plpgsql security definer set search_path = public as $$
declare creati int := 0;
begin
  insert into rides (group_id, driver_id, ride_date, depart_time,
                     origin, destination, seats, fuel_per_person)
  select r.group_id, r.driver_id, d::date, r.depart_time,
         r.origin, r.destination, r.seats, r.fuel_per_person
  from ricorrenze r
  cross join generate_series(current_date,
                             current_date + make_interval(days => giorni_avanti),
                             interval '1 day') as d
  where r.attiva
    and extract(isodow from d) = r.giorno
    and d::date >= r.valida_da
    and (r.valida_a is null or d::date <= r.valida_a)
    and not exists (
      select 1 from rides x
      where x.driver_id = r.driver_id
        and x.ride_date = d::date
        and x.depart_time = r.depart_time
        and x.group_id = r.group_id
    );
  get diagnostics creati = row_count;
  return creati;
end; $$;

-- La chiama il cron con la chiave di servizio, non un browser.
revoke execute on function public.crea_passaggi_ricorrenti(int) from public, anon, authenticated;

insert into public.schema_migrations (version) values ('024_ricorrenze') on conflict do nothing;
