-- Verifica del cantiere C13 (D5): la coda delle notifiche si riempie quando deve, con
-- quello che deve, e una volta sola.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una qualsiasi di queste cose.
--   * il trigger `claims_notifica`                       -> controllo 1
--   * l'indice unico su (destinatario, chiave)           -> controlli 2 e 5
--   * la riga che accoda dentro `promote_waitlist`       -> controllo 3
--   * `accoda_partenze_imminenti`                        -> controllo 4
--   * il confronto sull'istante invece che sul giorno    -> controllo 4, ma solo se il test
--     gira dopo le 23:00 — ed e' proprio per questo che il giorno lo decide `fra_un_ora`
--     invece di essere scritto "oggi"
--   * la RLS senza policy su `notifiche_coda`            -> controllo 6
--
-- Resta verde comunque, ed e' una cintura ridondante: il ramo che esclude il guidatore da
-- "qualcuno sale sulla tua auto". Il database gia' vieta di prenotare un posto sulla
-- propria auto (004), quindi quel caso non si puo' costruire.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dino uuid;
  g uuid; g2 uuid;
  auto uuid; auto_piena uuid; auto_vicina uuid;
  quante int; tornate int; prima int;
  fra_un_ora timestamp := (now() at time zone 'Europe/Rome') + interval '60 minutes';
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c13.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c13.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c13.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dino@c13.it', '{"display_name":"Dino"}') returning id into dino;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C13')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));

  -- Una seconda comitiva per la prova sulle partenze: i vincoli "un'auto sola al giorno" e
  -- "un posto solo al giorno" sono per gruppo, quindi qui non inciampano in quelli sopra
  -- qualunque sia l'ora in cui gira il test.
  perform set_config('test.uid', dino::text, true);
  g2 := (public.create_group('Comitiva C13 bis')).id;
  perform set_config('test.uid', ada::text, true);
  perform public.join_group((select code from public.groups where id = g2));

  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date, 'Mare', 4, g) returning id into auto;

  -- ===== 1. Chi guida sa chi carica =====
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto, 1, bruno);

  select count(*) into quante from public.notifiche_coda
    where destinatario = ada and tipo = 'posto_prenotato' and ride_id = auto;
  if quante <> 1 then
    raise exception 'Il guidatore ha % notifiche invece di 1 quando qualcuno prenota', quante;
  end if;
  if (select corpo from public.notifiche_coda where destinatario = ada and ride_id = auto)
     not like 'Bruno%' then
    raise exception 'La notifica non dice chi e'' salito';
  end if;

  select count(*) into quante from public.notifiche_coda where destinatario = bruno;
  if quante <> 0 then
    raise exception 'Chi prenota riceve una notifica per il proprio gesto';
  end if;

  -- ===== 2. Lo stesso evento non vibra due volte =====
  delete from public.seat_claims where ride_id = auto and passenger_id = bruno;
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto, 2, bruno);
  select count(*) into quante from public.notifiche_coda
    where destinatario = ada and tipo = 'posto_prenotato' and ride_id = auto;
  if quante <> 1 then
    raise exception 'Scendere e risalire manda % notifiche invece di 1', quante;
  end if;

  -- ===== 3. Chi era in lista d'attesa scopre di essere salito =====
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (bruno, current_date + 1, 'Lago', 1, g) returning id into auto_piena;
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_piena, 1, ada);
  insert into public.ride_waitlist (ride_id, user_id) values (auto_piena, carla);

  delete from public.seat_claims where ride_id = auto_piena and passenger_id = ada;

  if not exists (select 1 from public.seat_claims where ride_id = auto_piena and passenger_id = carla) then
    raise exception 'La promozione dalla lista d''attesa non e'' avvenuta: il test non prova niente';
  end if;
  select count(*) into quante from public.notifiche_coda
    where destinatario = carla and tipo = 'posto_libero' and ride_id = auto_piena;
  if quante <> 1 then
    raise exception 'Chi sale dalla lista d''attesa riceve % notifiche invece di 1', quante;
  end if;

  -- ===== 4. Partenza fra un'ora: guidatore e passeggeri =====
  -- Il giorno lo decide `fra_un_ora`, non "oggi": se il test gira alle 23:40 la partenza
  -- cade domani, ed e' esattamente il caso che il confronto sull'istante deve reggere.
  insert into public.rides (driver_id, ride_date, depart_time, destination, seats, group_id)
    values (dino, fra_un_ora::date, fra_un_ora::time, 'Monti', 4, g2) returning id into auto_vicina;
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_vicina, 1, ada);

  select public.accoda_partenze_imminenti() into tornate;
  if tornate < 2 then
    raise exception 'Le partenze imminenti hanno accodato % notifiche invece di almeno 2', tornate;
  end if;
  if not exists (select 1 from public.notifiche_coda
                 where destinatario = dino and tipo = 'partenza_vicina' and ride_id = auto_vicina) then
    raise exception 'Chi guida non e'' avvisato della propria partenza';
  end if;
  if not exists (select 1 from public.notifiche_coda
                 where destinatario = ada and tipo = 'partenza_vicina' and ride_id = auto_vicina) then
    raise exception 'Chi ha un posto non e'' avvisato della partenza';
  end if;

  -- ...e un'auto che parte domani non c'entra niente
  if exists (select 1 from public.notifiche_coda
             where tipo = 'partenza_vicina' and ride_id = auto_piena) then
    raise exception 'FALLA: avvisata una partenza che non e'' imminente';
  end if;

  -- ===== 5. Il cron gira ogni dieci minuti: non deve rimandare le stesse =====
  select count(*) into prima from public.notifiche_coda where tipo = 'partenza_vicina';
  perform public.accoda_partenze_imminenti();
  perform public.accoda_partenze_imminenti();
  if (select count(*) from public.notifiche_coda where tipo = 'partenza_vicina') <> prima then
    raise exception 'Rilanciare il cron duplica le notifiche di partenza';
  end if;

  -- ===== 6. Dal client non si legge la coda, e le iscrizioni sono solo le proprie =====
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (ada, 'https://esempio/ada', 'chiave-ada', 'auth-ada'),
           (bruno, 'https://esempio/bruno', 'chiave-bruno', 'auth-bruno');

  set local role authenticated;
  perform set_config('test.uid', ada::text, true);

  select count(*) into quante from public.notifiche_coda;
  if quante <> 0 then
    raise exception 'FALLA: dal client si leggono % righe della coda notifiche', quante;
  end if;

  select count(*) into quante from public.push_subscriptions;
  if quante <> 1 then
    raise exception 'FALLA: si vedono % iscrizioni push invece della sola propria', quante;
  end if;

  raise notice 'Notifiche (C13): tutti i controlli passati.';
end $$;

reset role;
