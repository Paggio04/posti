-- Verifica del cantiere C21: le coordinate di partenza non escono dalla comitiva.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una qualsiasi di queste cose.
--   * la chiamata a `blinda_coordinate()` in 016            -> controlli 3, 4 e 5
--   * il controllo `is_member or ho_un_posto` in 015        -> controllo 2
--   * il primo `passaggio_visibile` di `coordinate_visibili`-> controllo 6
--   * la revoca di execute su `blinda_coordinate`           -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

-- I due grant qui sopra servono al resto dei test e cancellano proprio la restrizione che
-- questo file deve verificare: la si rimette com'e' in produzione, con la stessa funzione
-- che usa la migrazione. Se un domani 016 smette di funzionare, questa riga non basta piu'
-- a farlo sembrare a posto.
select public.blinda_coordinate();
revoke execute on function public.blinda_coordinate() from authenticated, anon;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dario uuid;
  g_ada uuid; g_altro uuid;
  chiuso uuid; in_zona uuid; pubblico uuid; altrui uuid;
  quante int; stato text; lat double precision;
  milano_lat constant double precision := 45.4642;
  milano_lon constant double precision := 9.1900;
  sesto_lat  constant double precision := 45.5350;
  sesto_lon  constant double precision := 9.2260;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c21.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c21.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c21.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dario@c21.it', '{"display_name":"Dario"}') returning id into dario;

  perform set_config('test.uid', ada::text, true);
  g_ada := (public.create_group('Comitiva C21')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g_ada));
  perform set_config('test.uid', carla::text, true);
  g_altro := (public.create_group('Altra comitiva C21')).id;
  perform set_config('test.uid', dario::text, true);
  perform public.join_group((select code from public.groups where id = g_altro));

  -- Carla e Dario abitano a Sesto: vedono quello "in zona" e quello pubblico di Ada.
  update public.profiles set zona_lat = sesto_lat, zona_lon = sesto_lon where id in (carla, dario);

  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date, 'Mare', 4, g_ada, 'Milano', milano_lat, milano_lon, 'gruppo') returning id into chiuso;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date + 1, 'Lago', 4, g_ada, 'Milano', milano_lat, milano_lon, 'zona') returning id into in_zona;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon, visibilita)
    values (ada, current_date + 2, 'Monti', 4, g_ada, 'Milano', milano_lat, milano_lon, 'pubblico') returning id into pubblico;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, origin_lat, origin_lon)
    values (carla, current_date, 'Riunione', 4, g_altro, 'Sesto', sesto_lat, sesto_lon) returning id into altrui;

  set local role authenticated;

  -- ===== 1. Chi e' della comitiva le ha, come prima =====
  perform set_config('test.uid', bruno::text, true);
  select count(*) into quante from public.coordinate_passaggi(array[chiuso, in_zona, pubblico]);
  if quante <> 3 then
    raise exception 'Bruno e'' della comitiva e riceve % coordinate su 3', quante;
  end if;
  select origin_lat into lat from public.coordinate_passaggi(array[in_zona]);
  if lat is distinct from milano_lat then
    raise exception 'La coordinata tornata (%) non e'' quella scritta', lat;
  end if;

  -- ===== 2. Chi lo vede da fuori, no =====
  -- Carla vede il passaggio "in zona" (regola di C9) e quello pubblico: e' il punto del
  -- cantiere, vedere un passaggio non vuol dire sapere l'indirizzo di chi guida.
  perform set_config('test.uid', carla::text, true);
  if not exists (select 1 from public.rides where id = in_zona) then
    raise exception 'Il test non prova niente: Carla non vede nemmeno il passaggio in zona';
  end if;
  select count(*) into quante from public.coordinate_passaggi(array[in_zona, pubblico]);
  if quante <> 0 then
    raise exception 'FALLA: chi vede il passaggio da fuori riceve anche % coordinate', quante;
  end if;

  -- ===== 3. E non se le prende nemmeno dalla tabella =====
  stato := null;
  begin
    select origin_lat into lat from public.rides where id = in_zona;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA GRAVE: la colonna origin_lat si legge lo stesso, il permesso per colonna non c''e''';
  end if;
  if stato <> '42501' then
    raise exception 'Fermata da % invece che dal permesso', stato;
  end if;

  -- ===== 4. `select *` non funziona piu', ed e' voluto =====
  -- E' il motivo per cui il client nomina le colonne: se questo controllo diventa verde,
  -- vuol dire che la restrizione e' saltata e il payload e' tornato come prima.
  stato := null;
  begin
    execute 'select * from public.rides where id = $1' using in_zona;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: `select *` su rides passa ancora, quindi le coordinate viaggiano con la riga';
  end if;

  -- ...ma il resto della riga si legge come sempre: la restrizione e' di quattro colonne,
  -- non un muro sulla tabella.
  if (select destination from public.rides where id = in_zona) is null then
    raise exception 'Carla non legge piu'' nemmeno la destinazione: la restrizione ha preso troppo';
  end if;

  -- ===== 5. Chi ha un posto sull'auto le ha, anche da fuori comitiva =====
  -- Ci deve salire davvero: serve a chi e'' a bordo per arrivare al ritrovo.
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (pubblico, 1, carla);
  select count(*) into quante from public.coordinate_passaggi(array[pubblico]);
  if quante <> 1 then
    raise exception 'Chi ha un posto su quell''auto non riceve il punto di ritrovo';
  end if;
  -- e continua a non avere quelle degli altri passaggi della stessa comitiva
  select count(*) into quante from public.coordinate_passaggi(array[in_zona]);
  if quante <> 0 then
    raise exception 'FALLA: un posto su un''auto apre le coordinate di tutte le altre';
  end if;

  -- ===== 6. Il blocco viene prima anche qui =====
  -- Dario e' di un'altra comitiva e vede il passaggio pubblico; se Ada lo blocca, quel
  -- passaggio smette di essere visibile — e con lui deve sparire ogni coordinata.
  perform set_config('test.uid', ada::text, true);
  insert into public.user_blocks (blocker_id, blocked_id) values (ada, dario);
  perform set_config('test.uid', dario::text, true);
  select count(*) into quante from public.coordinate_passaggi(array[pubblico, in_zona, chiuso]);
  if quante <> 0 then
    raise exception 'FALLA: una persona bloccata riceve % coordinate', quante;
  end if;
  perform set_config('test.uid', ada::text, true);
  delete from public.user_blocks where blocker_id = ada;

  -- ...e nemmeno un passaggio di una comitiva a cui non si appartiene, bloccati o no
  select count(*) into quante from public.coordinate_passaggi(array[altrui]);
  if quante <> 0 then
    raise exception 'FALLA: si leggono le coordinate di un passaggio di un''altra comitiva';
  end if;

  -- ===== 7. La funzione che tocca i privilegi non e' roba da client =====
  stato := null;
  begin
    perform public.blinda_coordinate();
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: blinda_coordinate() e'' chiamabile con una chiave pubblica';
  end if;

  -- ===== 8. Chi guida le sue le vede, altrimenti non saprebbe dove ha detto di partire ==
  perform set_config('test.uid', ada::text, true);
  select count(*) into quante from public.coordinate_passaggi(array[chiuso, in_zona, pubblico]);
  if quante <> 3 then
    raise exception 'Ada guida quelle auto e riceve % coordinate su 3', quante;
  end if;

  raise notice 'Coordinate riservate (C21): tutti i controlli passati.';
end $$;

reset role;
