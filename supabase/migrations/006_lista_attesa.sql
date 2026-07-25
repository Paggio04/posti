-- 006 — Lista d'attesa: quando l'auto e' piena ci si mette in coda, e se un posto
-- si libera il primo idoneo ci sale da solo.

create table if not exists public.ride_waitlist (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (ride_id, user_id)
);

alter table public.ride_waitlist enable row level security;
drop policy if exists "waitlist read" on public.ride_waitlist;
create policy "waitlist read" on public.ride_waitlist for select to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id));
drop policy if exists "waitlist insert own" on public.ride_waitlist;
create policy "waitlist insert own" on public.ride_waitlist for insert with check (auth.uid() = user_id);
drop policy if exists "waitlist delete own" on public.ride_waitlist;
create policy "waitlist delete own" on public.ride_waitlist for delete using (auth.uid() = user_id);

-- Promozione automatica: si scorre la coda in ordine di arrivo e si prova a far salire
-- il primo. Chi non e' idoneo (per esempio ha gia' un posto altrove quel giorno) viene
-- rifiutato dai controlli di 004: si passa al successivo invece di fermarsi.
create or replace function public.promote_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  for w in
    select * from ride_waitlist where ride_id = old.ride_id order by created_at
  loop
    begin
      insert into seat_claims (ride_id, seat_index, passenger_id)
      values (old.ride_id, old.seat_index, w.user_id);
      delete from ride_waitlist where id = w.id;
      exit; -- promosso il primo idoneo, stop
    exception when others then
      continue;
    end;
  end loop;
  return old;
end; $$;

drop trigger if exists seat_freed_promote on public.seat_claims;
create trigger seat_freed_promote after delete on public.seat_claims
  for each row execute function public.promote_waitlist();

insert into public.schema_migrations (version) values ('006_lista_attesa') on conflict do nothing;
