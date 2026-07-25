-- Verifica del cantiere C9: i passaggi in zona e pubblici si vedono da fuori la comitiva,
-- e **niente altro** esce insieme a loro.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; lontano uuid;
  g_ada uuid; g_altro uuid;
  chiuso uuid; in_zona uuid; pubblico uuid; privato_altrui uuid;
  visti int; stato text;
  -- Piazza del Duomo, Milano; Sesto San Giovanni (~7 km); Bologna (~200 km)
  milano_lat constant double precision := 45.4642;
  milano_lon constant double precision := 9.1900;
  sesto_lat  constant double precision := 45.5350;
  sesto_lon  constant double precision := 9.2260;
  bologna_lat constant double precision := 44.4949;
  bologna_lon constant double precision := 11.3426;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c9.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c9.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c9.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('lontano@c9.it', '{"display_name":"Dario"}') returning id into lontano;

  -- Ada e Bruno in una comitiva; Carla e Dario in un'altra, cioe' estranei ad Ada.
  perform set_config('test.uid', ada::text, true);
  g_ada := (public.create_group('Comitiva di Ada')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g_ada));
  perform set_config('test.uid', carla::text, true);
  g_altro := (public.create_group('Altra comitiva')).id;
  perform set_config('test.uid', lontano::text, true);
  perform public.join_group((select code from public.groups where id = g_altro));

  -- Carla abita vicino a dove parte Ada; Dario sta a Bologna.
  update public.profiles set zona_lat = sesto_lat, zona_lon = sesto_lon, zona_nome = 'Sesto San Giovanni' where id = carla;
  update public.profiles set zona_lat = bologna_lat, zona_lon = bologna_lon, zona_nome = 'Bologna' where id = lontano;

  -- Tre passaggi di Ada, uno per livello di visibilita', tutti in partenza da Milano.
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date, 'Mare', 4, g_ada, 'Milano', milano_lat, milano_lon, 'gruppo') returning id into chiuso;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date + 1, 'Lago', 4, g_ada, 'Milano', milano_lat, milano_lon, 'zona') returning id into in_zona;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date + 2, 'Monti', 4, g_ada, 'Milano', milano_lat, milano_lon, 'pubblico') returning id into pubblico;
  -- E uno della comitiva di Carla, che deve restare invisibile ad Ada.
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (carla, current_date, 'Riunione', 4, g_altro) returning id into privato_altrui;

  set local role authenticated;

  -- ===== 1. Il default non cambia niente =====
  if (select count(*) from public.rides where visibilita <> 'gruppo' and id = chiuso) <> 0 then
    raise exception 'Un passaggio non nasce piu'' chiuso alla comitiva';
  end if;

  -- ===== 2. Chi e' del gruppo vede tutto, come prima =====
  perform set_config('test.uid', bruno::text, true);
  select count(*) into visti from public.rides where driver_id = ada;
  if visti <> 3 then
    raise exception 'Bruno, che e'' della comitiva, vede % auto di Ada invece di 3', visti;
  end if;

  -- ===== 3. Carla, vicina ma di un'altra comitiva: vede zona e pubblico, non il chiuso =====
  perform set_config('test.uid', carla::text, true);
  if exists (select 1 from public.rides where id = chiuso) then
    raise exception 'FALLA: un passaggio riservato alla comitiva si vede da fuori';
  end if;
  if not exists (select 1 from public.rides where id = in_zona) then
    raise exception 'Carla abita a % km e non vede il passaggio in zona',
      round(public.distanza_km(sesto_lat, sesto_lon, milano_lat, milano_lon)::numeric, 1);
  end if;
  if not exists (select 1 from public.rides where id = pubblico) then
    raise exception 'Carla non vede il passaggio pubblico';
  end if;

  -- ===== 4. Dario, lontano: solo il pubblico =====
  perform set_config('test.uid', lontano::text, true);
  if exists (select 1 from public.rides where id = in_zona) then
    raise exception 'FALLA: il passaggio in zona si vede da % km',
      round(public.distanza_km(bologna_lat, bologna_lon, milano_lat, milano_lon)::numeric, 0);
  end if;
  if not exists (select 1 from public.rides where id = pubblico) then
    raise exception 'Dario non vede il passaggio pubblico';
  end if;

  -- ===== 5. Chi non ha detto dove abita non riceve niente in zona =====
  perform set_config('test.uid', bruno::text, true);
  update public.profiles set zona_lat = null, zona_lon = null where id = bruno;
  -- (Bruno resta del gruppo, quindi li vede lo stesso: la prova va fatta su un estraneo)
  perform set_config('test.uid', carla::text, true);
  update public.profiles set zona_lat = null, zona_lon = null, zona_nome = null where id = carla;
  if exists (select 1 from public.rides where id = in_zona) then
    raise exception 'FALLA: il passaggio in zona si vede anche senza aver detto dove si abita';
  end if;
  update public.profiles set zona_lat = sesto_lat, zona_lon = sesto_lon where id = carla;

  -- ===== 6. Aprire un proprio passaggio non apre la comitiva =====
  -- E' il criterio di "fatto" del cantiere: trovo passaggi fuori dal mio gruppo e continuo
  -- a non vedere niente dei gruppi a cui non appartengo.
  perform set_config('test.uid', carla::text, true);
  select count(*) into visti from public.groups;
  if visti <> 1 then
    raise exception 'FALLA: Carla vede % comitive invece della sola sua', visti;
  end if;
  select count(*) into visti from public.group_members;
  if visti <> 2 then
    raise exception 'FALLA: Carla vede % appartenenze invece delle 2 della sua comitiva', visti;
  end if;
  select count(*) into visti from public.ride_requests;
  if visti <> 0 then
    raise exception 'FALLA: Carla vede % richieste di passaggio altrui', visti;
  end if;
  perform set_config('test.uid', ada::text, true);
  if exists (select 1 from public.rides where id = privato_altrui) then
    raise exception 'FALLA: Ada vede il passaggio riservato dell''altra comitiva';
  end if;

  -- ===== 7. Il nome di chi guida un passaggio che vedo si legge (estensione di D2) =====
  perform set_config('test.uid', lontano::text, true);
  if not exists (select 1 from public.profiles where id = ada) then
    raise exception 'Dario vede il passaggio pubblico di Ada ma non il suo nome: passaggio senza guidatore';
  end if;
  -- ...ma non quello di chi non c'entra niente
  if exists (select 1 from public.profiles where id = bruno) then
    raise exception 'FALLA: si legge il profilo di un estraneo che non guida niente di visibile';
  end if;

  -- ===== 8. Un estraneo puo' salire su un passaggio pubblico, e allora lo si vede =====
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (pubblico, 1, lontano);
  perform set_config('test.uid', ada::text, true);
  if not exists (select 1 from public.profiles where id = lontano) then
    raise exception 'Ada non legge il nome di chi e'' salito sulla sua auto';
  end if;

  -- ...e su un passaggio riservato invece no
  perform set_config('test.uid', lontano::text, true);
  stato := null;
  begin
    insert into public.seat_claims (ride_id, seat_index, passenger_id) values (chiuso, 1, lontano);
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA GRAVE: un estraneo prenota un posto su un passaggio riservato alla comitiva';
  end if;

  -- ===== 9. Il blocco vince anche su "pubblico" =====
  perform set_config('test.uid', ada::text, true);
  insert into public.user_blocks (blocker_id, blocked_id) values (ada, carla);
  perform set_config('test.uid', carla::text, true);
  if exists (select 1 from public.rides where id = pubblico) then
    raise exception 'FALLA: una persona bloccata vede lo stesso il passaggio pubblico di chi l''ha bloccata';
  end if;
  perform set_config('test.uid', ada::text, true);
  delete from public.user_blocks where blocker_id = ada;

  -- ...e il nome non rientra dalla porta aperta qui sopra. Dario ha un posto sull'auto di
  -- Ada, quindi continua a vederla anche da bloccato (regola di 012), e l'estensione D2
  -- direbbe "chi guida un passaggio che vedi lo puoi leggere". Il blocco viene prima.
  insert into public.user_blocks (blocker_id, blocked_id) values (ada, lontano);
  perform set_config('test.uid', lontano::text, true);
  if not exists (select 1 from public.rides where id = pubblico) then
    raise exception 'Dario ha un posto su quell''auto e non la vede piu''';
  end if;
  if exists (select 1 from public.profiles where id = ada) then
    raise exception 'FALLA: il nome rientra dall''estensione D2 nonostante il blocco';
  end if;
  perform set_config('test.uid', ada::text, true);
  delete from public.user_blocks where blocker_id = ada;

  -- ===== 10. "In zona" senza sapere da dove si parte non si scrive =====
  stato := null;
  begin
    insert into public.rides (driver_id, ride_date, destination, seats, group_id, visibilita)
      values (ada, current_date + 3, 'Chissa'' dove', 4, g_ada, 'zona');
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: si pubblica "in zona" senza un punto di partenza, cioe'' invisibile a tutti';
  end if;
  if stato <> '23514' then
    raise exception 'Fermato da % invece che dal check', stato;
  end if;

  raise notice 'Passaggi in zona (C9): tutti i controlli passati.';
end $$;

reset role;
