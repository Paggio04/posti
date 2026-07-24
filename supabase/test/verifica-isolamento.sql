-- Verifica che le comitive siano davvero separate, e che il gruppo sia obbligatorio.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
-- Ogni controllo fallito ferma lo script con un messaggio: nessun esito verde per distrazione.
--
-- Le prove si fanno con il ruolo "authenticated" e con auth.uid() finto, cioe' esattamente
-- come ci arriva il client: quello che qui e' vietato, e' vietato anche dal browser.

-- Permessi che su Supabase ci sono gia' (qui le tabelle nascono dalle migrazioni).
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dino uuid;
  g1 uuid; g2 uuid;
  auto1 uuid;
  visti int;
begin
  -- ===== Personaggi =====
  insert into auth.users (email, raw_user_meta_data)
    values ('ada@esempio.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data)
    values ('bruno@esempio.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data)
    values ('carla@esempio.it', '{"display_name":"Carla"}') returning id into carla;

  if (select count(*) from public.profiles) <> 3 then
    raise exception 'Il trigger di creazione profilo non ha funzionato';
  end if;

  -- ===== Due comitive separate: Ada e Bruno insieme, Carla per conto suo =====
  perform set_config('test.uid', ada::text, true);
  g1 := (public.create_group('Comitiva del mare')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g1));
  perform set_config('test.uid', carla::text, true);
  g2 := (public.create_group('Quelli della palestra')).id;

  -- ===== Ada pubblica un'auto, Bruno prenota =====
  perform set_config('test.uid', ada::text, true);
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date, 'Mare', 4, g1) returning id into auto1;
  perform set_config('test.uid', bruno::text, true);
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto1, 1, bruno);

  -- ===== 1. Carla non deve vedere niente della comitiva di Ada =====
  set local role authenticated;
  perform set_config('test.uid', carla::text, true);
  select count(*) into visti from public.rides;
  if visti <> 0 then
    raise exception 'ISOLAMENTO ROTTO: Carla vede % auto di un gruppo di cui non fa parte', visti;
  end if;
  select count(*) into visti from public.seat_claims;
  if visti <> 0 then
    raise exception 'ISOLAMENTO ROTTO: Carla vede % prenotazioni altrui', visti;
  end if;
  select count(*) into visti from public.groups;
  if visti <> 1 then
    raise exception 'ISOLAMENTO ROTTO: Carla vede % gruppi invece del suo soltanto', visti;
  end if;
  reset role;

  -- ===== 2. Bruno, che e' del gruppo, vede l'auto =====
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  select count(*) into visti from public.rides;
  if visti <> 1 then
    raise exception 'Bruno dovrebbe vedere 1 auto del suo gruppo, ne vede %', visti;
  end if;
  reset role;

  -- ===== 3. Nessuno puo' pubblicare in un gruppo di cui non fa parte =====
  set local role authenticated;
  perform set_config('test.uid', carla::text, true);
  begin
    insert into public.rides (driver_id, ride_date, destination, seats, group_id)
      values (carla, current_date, 'Intruso', 4, g1);
    reset role;
    raise exception 'FALLA: Carla ha pubblicato un''auto nel gruppo di Ada';
  exception when insufficient_privilege then
    null; -- atteso: la policy di scrittura la ferma
  end;
  reset role;

  -- ===== 4. Il gruppo e' obbligatorio =====
  begin
    insert into public.rides (driver_id, ride_date, destination, seats, group_id)
      values (ada, current_date + 1, 'Senza gruppo', 4, null);
    raise exception 'FALLA: si e'' pubblicata un''auto senza comitiva';
  exception when not_null_violation then
    null; -- atteso
  end;

  -- ===== 5. Due persone sullo stesso sedile: ne passa una sola =====
  -- Dino e' del gruppo di Ada, quindi l'auto la vede: qui a fermarlo deve essere
  -- il vincolo unique sul sedile, non la visibilita'.
  insert into auth.users (email, raw_user_meta_data)
    values ('dino@esempio.it', '{"display_name":"Dino"}') returning id into dino;
  perform set_config('test.uid', dino::text, true);
  perform public.join_group((select code from public.groups where id = g1));
  if (select count(*) from public.rides) < 1 then
    raise exception 'Dino non vede l''auto del suo gruppo: la prova del sedile non direbbe niente';
  end if;
  begin
    insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto1, 1, dino);
    raise exception 'FALLA: due persone sullo stesso sedile';
  exception when unique_violation then
    null; -- atteso: unique (ride_id, seat_index)
  end;

  raise notice 'Isolamento fra comitive: tutti i controlli passati.';
end $$;
