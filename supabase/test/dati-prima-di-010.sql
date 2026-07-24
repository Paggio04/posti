-- Dati com'erano prima della migrazione 010: passaggi e richieste SENZA comitiva,
-- cioe' esattamente il caso che la 010 deve archiviare invece di buttare via.
-- Si applica dopo la 009 e prima della 010. Serve solo ai collaudi.

do $$
declare ada uuid; bruno uuid; g1 uuid; orfana uuid; digruppo uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
    values ('ada@esempio.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data)
    values ('bruno@esempio.it', '{"display_name":"Bruno"}') returning id into bruno;

  perform set_config('test.uid', ada::text, true);
  g1 := (public.create_group('Comitiva del mare')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g1));

  -- Auto dentro la comitiva: deve sopravvivere alla migrazione.
  perform set_config('test.uid', ada::text, true);
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date, 'Mare', 4, g1) returning id into digruppo;

  -- Auto senza comitiva, con prenotazione, commento e lista d'attesa attaccati:
  -- tutta roba che la 010 deve archiviare.
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date + 1, 'Senza gruppo', 4, null) returning id into orfana;
  perform set_config('test.uid', bruno::text, true);
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (orfana, 1, bruno);
  insert into public.ride_comments (ride_id, user_id, body) values (orfana, bruno, 'Ci sono!');
  insert into public.ride_waitlist (ride_id, user_id) values (orfana, bruno);
  insert into public.ride_requests (user_id, ride_date, group_id)
    values (bruno, current_date + 2, null);

  raise notice 'Dati pre-010 inseriti: 1 auto nel gruppo, 1 auto orfana, 1 richiesta orfana.';
end $$;
