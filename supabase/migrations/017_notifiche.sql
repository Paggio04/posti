-- 017 — Notifiche a scheda chiusa: la meta' che vive nel database.
--
-- Cantiere C13 di docs/ROADMAP.md, decisione D5. Tre eventi soli, quelli che cambiano i
-- piani di chi li riceve; commenti e auto nuove restano fuori di proposito, perche' sono
-- la maggior parte del traffico e un'app che notifica troppo viene silenziata — e allora
-- non notifica piu' niente.
--
-- **Il database non spedisce niente.** Non puo': mandare una notifica push vuole le chiavi
-- VAPID e una richiesta HTTP verso un servizio di terzi, cioe' un segreto dentro Postgres e
-- una dipendenza di rete dentro una transazione. Qui si **accoda** e basta; a spedire e' una
-- Edge Function, che legge la coda con la sua chiave e la svuota. Il vantaggio non e'
-- teorico: se la spedizione e' rotta o non e' ancora stata messa in piedi, prenotare un
-- posto continua a funzionare — l'evento resta in coda e nessuno se ne accorge.
--
-- Quello che manca perche' arrivi davvero una notifica sul telefono e' fuori dal repo:
-- le chiavi VAPID, il deploy della funzione, e `pg_cron` che la chiama. Vedi
-- supabase/README.md, sezione «Notifiche».

-- ===== Le iscrizioni: un'iscrizione e' un dispositivo, non una persona =====
-- Chi apre l'app dal telefono e dal portatile ha due righe qui, ed e' giusto: la
-- disiscrizione da uno non deve zittire l'altro.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  creata_il timestamptz not null default now()
);

create index if not exists push_subscriptions_utente on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Le proprie e nient'altro: un endpoint push e' un indirizzo a cui si puo' scrivere.
drop policy if exists "push read own" on public.push_subscriptions;
create policy "push read own" on public.push_subscriptions for select to authenticated
  using (auth.uid() = user_id);
drop policy if exists "push insert own" on public.push_subscriptions;
create policy "push insert own" on public.push_subscriptions for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "push delete own" on public.push_subscriptions;
create policy "push delete own" on public.push_subscriptions for delete to authenticated
  using (auth.uid() = user_id);

-- ===== La coda =====
-- RLS accesa e **nessuna policy**, come le tabelle di archivio della 010: le righe esistono,
-- dal client non si vedono. Le legge solo chi ha la service_role, cioe' la Edge Function.
create table if not exists public.notifiche_coda (
  id bigint generated always as identity primary key,
  destinatario uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('posto_prenotato', 'posto_libero', 'partenza_vicina')),
  ride_id uuid references public.rides (id) on delete cascade,
  titolo text not null,
  corpo text not null,
  -- Chi genera l'evento decide cosa lo rende "lo stesso evento". Senza, un ricaricamento
  -- del cron o una prenotazione rifatta manderebbero due vibrazioni per la stessa cosa.
  chiave text not null,
  creata_il timestamptz not null default now(),
  inviata_il timestamptz,
  errore text
);

create unique index if not exists notifiche_coda_unica
  on public.notifiche_coda (destinatario, chiave);
create index if not exists notifiche_coda_da_inviare
  on public.notifiche_coda (creata_il) where inviata_il is null;

alter table public.notifiche_coda enable row level security;

-- Accodare e' un gesto interno: lo fanno i trigger, mai il client. `security definer` per
-- questo, e con la chiave che rende l'operazione ripetibile senza doppioni.
create or replace function public.accoda_notifica(
  p_destinatario uuid, p_tipo text, p_ride uuid, p_titolo text, p_corpo text, p_chiave text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_destinatario is null then return; end if;
  insert into notifiche_coda (destinatario, tipo, ride_id, titolo, corpo, chiave)
  values (p_destinatario, p_tipo, p_ride, p_titolo, p_corpo, p_chiave)
  on conflict (destinatario, chiave) do nothing;
end; $$;

revoke execute on function
  public.accoda_notifica(uuid, text, uuid, text, text, text) from public, anon, authenticated;

-- ===== Evento 1: qualcuno prenota un posto nella tua auto =====
-- Va al guidatore, che deve sapere chi carica. Il nome di chi sale si legge qui dentro
-- (security definer) e non dal client: chi riceve la notifica e' comunque della comitiva.
create or replace function public.notifica_posto_prenotato() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  guida uuid;
  chi text;
begin
  select driver_id into guida from rides where id = new.ride_id;
  if guida is null or guida = new.passenger_id then return new; end if;

  select coalesce(display_name, 'Qualcuno') into chi from profiles where id = new.passenger_id;

  perform public.accoda_notifica(
    guida, 'posto_prenotato', new.ride_id,
    'Un posto in meno',
    coalesce(chi, 'Qualcuno') || ' sale sulla tua auto.',
    'posto_prenotato:' || new.ride_id::text || ':' || new.passenger_id::text
  );
  return new;
end; $$;

drop trigger if exists claims_notifica on public.seat_claims;
create trigger claims_notifica after insert on public.seat_claims
  for each row execute function public.notifica_posto_prenotato();

-- ===== Evento 2: si e' liberato un posto dove eri in lista d'attesa =====
-- Con la promozione automatica di 006, "si e' liberato un posto" e "sei salito" sono lo
-- stesso istante: la notifica dice la seconda cosa, che e' quella che serve sapere.
-- Il corpo di `promote_waitlist` resta identico a quello della 006: cambia solo la riga
-- che accoda, subito dopo la promozione riuscita.
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
      perform public.accoda_notifica(
        w.user_id, 'posto_libero', old.ride_id,
        'Sei a bordo',
        'Si e'' liberato un posto e sei salito: eri il primo in lista d''attesa.',
        'posto_libero:' || old.ride_id::text || ':' || w.user_id::text
      );
      exit; -- promosso il primo idoneo, stop
    exception when others then
      continue;
    end;
  end loop;
  return old;
end; $$;

-- ===== Evento 3: la tua auto parte fra un'ora =====
-- Non c'e' nessun trigger che possa accorgersene: e' il passare del tempo. La chiama
-- `pg_cron` ogni dieci minuti, e la finestra e' larga il doppio dell'intervallo per non
-- perdere un giro; a non mandare due volte la stessa cosa ci pensa la chiave.
create or replace function public.accoda_partenze_imminenti() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  p record;
  quante int := 0;
  adesso timestamp := (now() at time zone 'Europe/Rome');
begin
  for r in
    select id, driver_id, ride_date, depart_time, destination
    from rides
    where depart_time is not null
      -- Il confronto e' sull'istante di partenza, **non** sul giorno: un'auto che parte
      -- alle 00:20 va avvisata alle 23:20 del giorno prima, e filtrare per `ride_date =
      -- oggi` la escluderebbe proprio in quel momento. Il giorno resta solo come
      -- restringimento largo, per non leggere tutto lo storico.
      and ride_date between adesso::date - 1 and adesso::date + 1
      and (ride_date + depart_time) between adesso + interval '50 minutes'
                                        and adesso + interval '70 minutes'
  loop
    perform public.accoda_notifica(
      r.driver_id, 'partenza_vicina', r.id,
      'Si parte fra poco',
      'La tua auto per ' || coalesce(r.destination, 'il ritrovo') || ' parte alle '
        || to_char(r.depart_time, 'HH24:MI') || '.',
      'partenza_vicina:' || r.id::text || ':' || r.driver_id::text
    );
    quante := quante + 1;

    for p in select passenger_id from seat_claims where ride_id = r.id loop
      perform public.accoda_notifica(
        p.passenger_id, 'partenza_vicina', r.id,
        'Si parte fra poco',
        'Il passaggio per ' || coalesce(r.destination, 'il ritrovo') || ' parte alle '
          || to_char(r.depart_time, 'HH24:MI') || '.',
        'partenza_vicina:' || r.id::text || ':' || p.passenger_id::text
      );
      quante := quante + 1;
    end loop;
  end loop;
  return quante;
end; $$;

-- La chiama il cron con la chiave di servizio, non un browser.
revoke execute on function public.accoda_partenze_imminenti() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('017_notifiche') on conflict do nothing;
