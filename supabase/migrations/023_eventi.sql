-- 023 — Un registro di cio' che succede, scritto dai trigger.
--
-- Serve a due cose insieme, ed e' il motivo per cui e' **una** tabella e non due:
--
-- 1. **L'attivita' della comitiva** — oggi non esiste: per sapere «chi ha
--    prenotato cosa» bisogna guardare i `created_at` di tre tabelle diverse e
--    incollarli a mano.
-- 2. **Le disdette** — oggi spariscono senza lasciare traccia: una
--    `seat_claims` cancellata non e' piu' da nessuna parte, quindi non si puo'
--    dire quante volte una persona ha mollato un posto all'ultimo.
--
-- Lo scrivono i trigger, non il client: un registro che l'applicazione puo'
-- riempire a mano racconta cio' che il client crede, non cio' che e' successo.

-- **Nessuna chiave esterna, ed e' una decisione, non una dimenticanza.** Un
-- registro storico racconta cose gia' successe: se il passaggio, la persona o la
-- comitiva spariscono, l'evento resta vero. E soprattutto: una chiave esterna qui
-- rende **impossibile cancellare** proprio quelle cose. La cancellazione di un
-- posto fa scattare `promote_waitlist` (006), che ne inserisce un altro, che fa
-- scattare questo trigger su righe che stanno sparendo nello stesso comando —
-- l'inserimento viene rifiutato e la cancellazione si annulla. Ci sarebbe andata
-- di mezzo la cancellazione dell'account (013), che e' un obbligo di legge.
-- Trovato da verifica-cancellazione e verifica-sicurezza, non a tavolino.
--
-- Conseguenza accettata: gli eventi di una comitiva cancellata restano nella
-- tabella, invisibili a tutti perche' `is_member()` non li fa passare.
create table if not exists public.eventi (
  id         bigserial primary key,
  group_id   uuid not null,
  tipo       text not null check (tipo in (
               'passaggio_pubblicato','passaggio_annullato',
               'posto_preso','posto_liberato',
               'membro_entrato','pagamento_registrato')),
  attore     uuid,
  ride_id    uuid,
  quando     timestamptz not null default now()
);

-- Per chi avesse gia' la tabella con le chiavi esterne della prima stesura.
alter table public.eventi drop constraint if exists eventi_ride_id_fkey;
alter table public.eventi drop constraint if exists eventi_attore_fkey;
alter table public.eventi drop constraint if exists eventi_group_id_fkey;

create index if not exists eventi_gruppo_idx on public.eventi (group_id, quando desc);

alter table public.eventi enable row level security;

-- Si legge se si e' del gruppo. Nessun `insert` per l'utente: scrivono solo i
-- trigger, che girano `security definer`.
drop policy if exists "eventi read gruppo" on public.eventi;
create policy "eventi read gruppo" on public.eventi for select to authenticated
  using (public.is_member(group_id));

-- ── I trigger ───────────────────────────────────────────────────────────────
create or replace function public.registra_evento_ride()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Prima della 010 un passaggio poteva non avere comitiva, e nel repo c'e' un
  -- test che riproduce proprio quello stato (`dati-prima-di-010.sql`). Un evento
  -- senza gruppo non lo leggerebbe nessuno — la policy e' `is_member()` — quindi
  -- non si scrive, invece di far fallire l'inserimento del passaggio.
  if coalesce(new.group_id, old.group_id) is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    insert into eventi (group_id, tipo, attore, ride_id)
    values (new.group_id, 'passaggio_pubblicato', new.driver_id, new.id);
    return new;
  else
    insert into eventi (group_id, tipo, attore, ride_id)
    values (old.group_id, 'passaggio_annullato', old.driver_id, old.id);
    return old;
  end if;
end; $$;

drop trigger if exists eventi_rides on public.rides;
create trigger eventi_rides after insert or delete on public.rides
  for each row execute function public.registra_evento_ride();

create or replace function public.registra_evento_posto()
returns trigger language plpgsql security definer set search_path = public as $$
declare g uuid; r uuid;
begin
  r := coalesce(new.ride_id, old.ride_id);
  select group_id into g from rides where id = r;
  if g is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into eventi (group_id, tipo, attore, ride_id)
    values (g, 'posto_preso', new.passenger_id, r);
    return new;
  else
    insert into eventi (group_id, tipo, attore, ride_id)
    values (g, 'posto_liberato', old.passenger_id, r);
    return old;
  end if;
end; $$;

drop trigger if exists eventi_seat_claims on public.seat_claims;
create trigger eventi_seat_claims after insert or delete on public.seat_claims
  for each row execute function public.registra_evento_posto();

create or replace function public.registra_evento_membro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into eventi (group_id, tipo, attore)
  values (new.group_id, 'membro_entrato', new.user_id);
  return new;
end; $$;

drop trigger if exists eventi_membri on public.group_members;
create trigger eventi_membri after insert on public.group_members
  for each row execute function public.registra_evento_membro();

create or replace function public.registra_evento_pagamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Si registra che un pagamento **c'e' stato**, mai quanto: l'importo resta
  -- fra le due parti, e questa riga la legge tutto il gruppo. → 022
  insert into eventi (group_id, tipo, attore)
  values (new.group_id, 'pagamento_registrato', new.registrato_da);
  return new;
end; $$;

drop trigger if exists eventi_pagamenti on public.pagamenti;
create trigger eventi_pagamenti after insert on public.pagamenti
  for each row execute function public.registra_evento_pagamento();

-- Le scrivono i trigger, non un browser.
revoke execute on function public.registra_evento_ride()      from public, anon, authenticated;
revoke execute on function public.registra_evento_posto()     from public, anon, authenticated;
revoke execute on function public.registra_evento_membro()    from public, anon, authenticated;
revoke execute on function public.registra_evento_pagamento() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('023_eventi') on conflict do nothing;
