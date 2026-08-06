-- Verifica del cantiere C31 (028): andata e ritorno sono un viaggio, non due.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Il grosso di questo file non prova la colonna nuova: prova le due regole vecchie
-- che dicevano di no.** Aggiungere `ritorno_di` e' stato il pezzo facile; il cantiere
-- esisteva perche' `rides_one_per_day` e `check_claim` rendevano il caso impossibile, e
-- allargarli senza allargare *anche* cio' che devono ancora vietare e' il modo in cui
-- una funzione in piu' diventa un buco.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * `(ritorno_di is not null)` nell'indice unico        -> controllo 3 (torna a passare
--     la seconda andata, che deve restare vietata)
--   * l'indice unico rifatto in 028                       -> controllo 1
--   * le due righe `is distinct from` in `check_claim`    -> controllo 4
--   * il resto della condizione in `check_claim`          -> controllo 5
--   * `on delete set null` al posto di `cascade`          -> controllo 6
--   * il vincolo `rides_ritorno_non_se_stesso`            -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; andata uuid; ritorno uuid; terza uuid;
  ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c31.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c31.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c31.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C31')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));

  -- ===== 1. Andata e ritorno lo stesso giorno, stesso guidatore =====
  -- Prima della 028 questo inserimento era rifiutato dall'indice unico di 004, e il
  -- cantiere finiva li'.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Universita''', 4) returning id into andata;
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, ritorno_di)
  values (g, ada, current_date + 1, '13:30', 'Universita''', 'Casa', 4, andata) returning id into ritorno;
  raise notice '1 ok: un guidatore pubblica andata e ritorno nello stesso giorno';

  -- ===== 2. Il legame si legge nei due versi =====
  if (select ritorno_di from rides where id = ritorno) <> andata then
    raise exception '2 ROTTO: il ritorno non e'' legato alla sua andata';
  end if;
  if not exists (select 1 from rides where ritorno_di = andata) then
    raise exception '2 ROTTO: dall''andata non si trova il ritorno';
  end if;
  raise notice '2 ok: le due meta'' si riconoscono';

  -- ===== 3. Due andate restano vietate =====
  -- E' la meta' del controllo che si perde per prima allargando l'indice a mano:
  -- «adesso ne passano due» e' facile, «adesso ne passano due **solo se** una e' il
  -- ritorno dell'altra» e' il punto.
  ok := false;
  begin
    insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
    values (g, ada, current_date + 1, '09:00', 'Casa', 'Lavoro', 4);
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception '3 ROTTO: un guidatore pubblica due andate nello stesso giorno';
  end if;
  raise notice '3 ok: due andate nello stesso giorno restano vietate';

  -- ===== 4. Un passeggero prende tutte e due le meta' =====
  insert into seat_claims (ride_id, seat_index, passenger_id) values (andata, 1, bruno);
  insert into seat_claims (ride_id, seat_index, passenger_id) values (ritorno, 1, bruno);
  raise notice '4 ok: si prende andata e ritorno dello stesso viaggio';

  -- ===== 5. Ma non due auto qualsiasi nello stesso giorno =====
  -- Il divieto di 004 doveva cadere **solo** fra le due meta' di una coppia. Se cade
  -- del tutto, uno tiene un posto su tre auto e ne lascia due vuote.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, carla, current_date + 1, '10:00', 'Casa', 'Mare', 4) returning id into terza;
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, passenger_id) values (terza, 1, bruno);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception '5 ROTTO: un posto su una terza auto dello stesso giorno e'' passato';
  end if;
  raise notice '5 ok: il divieto resta per due auto qualsiasi';

  -- ===== 6. Annullata l'andata, il ritorno resta =====
  -- `set null` e non `cascade`: chi torna a casa alle 13:30 ha ancora bisogno di
  -- tornare a casa. Con la cascata perderebbe il passaggio senza che nessuno lo
  -- abbia deciso.
  delete from rides where id = andata;
  if not exists (select 1 from rides where id = ritorno) then
    raise exception '6 ROTTO: annullata l''andata, il ritorno e'' sparito con lei';
  end if;
  if (select ritorno_di from rides where id = ritorno) is not null then
    raise exception '6 ROTTO: il ritorno punta a un''andata che non esiste piu''';
  end if;
  raise notice '6 ok: annullata l''andata, il ritorno resta e si slega';

  -- ===== 7. Un passaggio non e' il ritorno di se stesso =====
  ok := false;
  begin
    update rides set ritorno_di = id where id = ritorno;
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception '7 ROTTO: un passaggio puo'' essere il ritorno di se stesso';
  end if;
  raise notice '7 ok: nessun anello su se stesso';

  raise notice 'Andata e ritorno (C31): tutti i controlli passati.';
end $$;

reset role;
