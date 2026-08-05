-- Verifica del cantiere C38 (033): una comitiva che si chiude da sola.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Meta' dei controlli riguarda cio' che NON deve chiudersi.** «Si chiude» vuol dire
-- due cose — non ci si entra piu' col codice, non si pubblica piu' — e non una terza:
-- chi ha diviso una macchina per tre giorni deve poter ancora vedere chi c'era e
-- saldare quello che deve. Una comitiva scaduta e' un album, non un buco, e i controlli
-- 4 e 5 sono li' perche' nessuno la trasformi in un buco per simmetria.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il controllo su `scade_il` in `join_group`         -> controllo 2
--   * il controllo «comitiva chiusa» in `check_ride`     -> controllo 3
--   * il controllo «non oltre la fine» in `check_ride`   -> controllo 6
--   * la data facoltativa in `create_group`              -> controllo 1
--   * il rifiuto di una scadenza gia' passata            -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; scaduta uuid; codice text; auto uuid;
  quante int; saldo numeric; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c38.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c38.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c38.it', '{"display_name":"Carla"}') returning id into carla;

  -- ===== 1. Si crea una comitiva con una data di fine =====
  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Weekend C38', current_date + 3)).id;
  if (select scade_il from groups where id = g) <> current_date + 3 then
    raise exception '1 ROTTO: la data di fine non e'' arrivata sulla comitiva';
  end if;
  -- E senza data si continua come sempre: e' il caso normale, e la firma nuova non
  -- deve costringere chi non ne ha bisogno.
  if (select scade_il from groups where id = (public.create_group('Comitiva di sempre')).id) is not null then
    raise exception '1 ROTTO: una comitiva senza data di fine ne ha una lo stesso';
  end if;
  raise notice '1 ok: la data di fine c''e'' quando la si mette, e non quando non la si mette';

  -- Bruno entra finche' e' aperta.
  select code into codice from groups where id = g;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group(codice);

  -- Ada guida, Bruno sale: 5 € che restano da saldare.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, fuel_per_person)
  values (g, ada, current_date + 1, '09:00', 'Casa', 'Concerto', 4, 5.00) returning id into auto;
  insert into seat_claims (ride_id, seat_index, passenger_id) values (auto, 1, bruno);

  -- Adesso la comitiva chiude: la data si sposta a ieri.
  update groups set scade_il = current_date - 1 where id = g;

  -- ===== 2. Col codice non ci si entra piu' =====
  perform set_config('test.uid', carla::text, true);
  ok := false;
  begin
    perform public.join_group(codice);
  exception when others then
    ok := true;
    if sqlerrm not like '%chiusa%' then
      raise exception '2 ROTTO: il codice di una comitiva chiusa risponde «%», che manda a ricontrollare un codice giusto', sqlerrm;
    end if;
  end;
  if not ok then raise exception '2 ROTTO: si entra in una comitiva gia'' chiusa'; end if;
  if exists (select 1 from group_members where group_id = g and user_id = carla) then
    raise exception '2 ROTTO: l''ingresso e'' stato registrato lo stesso';
  end if;
  raise notice '2 ok: col codice di una comitiva chiusa non si entra';

  -- ===== 3. E non si pubblica piu' =====
  perform set_config('test.uid', ada::text, true);
  ok := false;
  begin
    insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
    values (g, ada, current_date + 1, '10:00', 'Casa', 'Altrove', 4);
  exception when others then ok := true;
  end;
  if not ok then raise exception '3 ROTTO: si pubblica in una comitiva chiusa'; end if;
  raise notice '3 ok: in una comitiva chiusa non si pubblica';

  -- ===== 4. Ma i dati restano leggibili a chi c'era =====
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  select count(*) into quante from rides where group_id = g;
  if quante <> 1 then
    raise exception '4 ROTTO: chi c''era vede % passaggi della comitiva chiusa invece di 1', quante;
  end if;
  select count(*) into quante from profiles where id = ada;
  if quante <> 1 then
    raise exception '4 ROTTO: chi c''era non vede piu'' i profili della comitiva chiusa';
  end if;
  raise notice '4 ok: chi c''era continua a vedere cosa e'' successo';

  -- ===== 5. E i conti si saldano ancora =====
  -- E' la ragione pratica per cui una comitiva scaduta non si spegne: chiudere anche
  -- questo vorrebbe dire che chi deve cinque euro non ha piu' modo di registrarli.
  select public.saldo_con(ada) into saldo;
  if saldo <> -5.00 then
    raise exception '5 ROTTO: nella comitiva chiusa il saldo con Ada e'' % invece di -5,00', saldo;
  end if;
  insert into pagamenti (group_id, da_utente, a_utente, importo, registrato_da)
  values (g, bruno, ada, 5.00, bruno);
  if public.saldo_con(ada) <> 0 then
    raise exception '5 ROTTO: in una comitiva chiusa non si riesce a saldare';
  end if;
  reset role;
  raise notice '5 ok: in una comitiva chiusa i conti si chiudono';

  -- ===== 6. Non si pubblica oltre la fine, nemmeno da aperta =====
  -- Sarebbe un'auto che nessuno potra' mai prenotare, perche' quel giorno il gruppo
  -- non c'e' piu'.
  perform set_config('test.uid', ada::text, true);
  scaduta := (public.create_group('Matrimonio C38', current_date + 2)).id;
  ok := false;
  begin
    insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
    values (scaduta, ada, current_date + 5, '10:00', 'Casa', 'Altrove', 4);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '6 ROTTO: si pubblica per un giorno in cui la comitiva sara'' gia'' chiusa';
  end if;
  -- Ma dentro la finestra si', ovviamente.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (scaduta, ada, current_date + 2, '10:00', 'Casa', 'Chiesa', 4);
  raise notice '6 ok: si pubblica dentro la finestra e non oltre';

  -- ===== 7. Una comitiva non chiude prima di aprire =====
  ok := false;
  begin
    perform public.create_group('Gia'' finita', current_date - 1);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '7 ROTTO: si crea una comitiva gia'' scaduta, cioe'' inutilizzabile dal primo istante';
  end if;
  raise notice '7 ok: non si crea una comitiva gia'' chiusa';

  raise notice 'Comitiva a tempo (C38): tutti i controlli passati.';
end $$;

reset role;
