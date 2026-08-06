-- Verifica del cantiere C33 (030): l'auto ha un profilo, e resta di chi ce l'ha.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * l'`if new.auto_id is not null ...` in `check_ride`      -> controllo 2
--   * la policy di lettura con `condivide_gruppo`             -> controlli 3 e 4
--   * l'indice parziale `auto_una_predefinita`                -> controllo 5
--   * `on delete set null` su `rides.auto_id` (se fosse cascade) -> controllo 6
--   * il vincolo sul consumo                                  -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; panda uuid; suv uuid; auto_bruno uuid; passaggio uuid;
  quante int; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c33.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c33.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c33.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C33')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  -- Carla sta per conto suo: e' il metro della lettura.
  perform set_config('test.uid', carla::text, true);
  perform public.create_group('Comitiva di Carla');

  insert into auto (user_id, nome, posti, modello, colore, consumo_km_l, predefinita)
  values (ada, 'Panda', 4, 'Fiat Panda', 'blu', 15.0, true) returning id into panda;
  insert into auto (user_id, nome, posti, modello, colore)
  values (ada, 'Il SUV', 6, 'Kuga', 'grigio') returning id into suv;
  insert into auto (user_id, nome, posti) values (bruno, 'La mia', 3) returning id into auto_bruno;

  -- ===== 1. Pubblicare con la propria auto =====
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, auto_id)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Universita''', 4, panda) returning id into passaggio;
  raise notice '1 ok: si pubblica indicando la propria auto';

  -- ===== 2. Ma non con quella di un altro =====
  -- La policy di scrittura di `rides` nomina `driver_id` e non sa niente di `auto_id`:
  -- senza il controllo nel trigger si attaccherebbe al proprio passaggio l'auto di
  -- chiunque, e chi aspetta cercherebbe la macchina sbagliata.
  ok := false;
  begin
    insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, auto_id)
    values (g, bruno, current_date + 1, '08:30', 'Casa', 'Universita''', 3, panda);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception '2 ROTTO: si pubblica un passaggio con l''auto di un''altra persona';
  end if;
  raise notice '2 ok: non si pubblica con l''auto di un altro';

  -- ===== 3. Chi condivide la comitiva vede l'auto =====
  -- E' meta' del cantiere: senza la lettura, «chi aspetta sa che auto cercare» non
  -- succede, e resta un dato che vede solo chi gia' lo sapeva.
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  select count(*) into quante from auto where user_id = ada;
  if quante <> 2 then
    raise exception '3 ROTTO: chi e'' della comitiva vede % auto di Ada invece di 2', quante;
  end if;
  raise notice '3 ok: la comitiva vede le auto di chi guida';

  -- ===== 4. Chi non c'entra no =====
  perform set_config('test.uid', carla::text, true);
  select count(*) into quante from auto where user_id = ada;
  if quante <> 0 then
    raise exception '4 ROTTO: da fuori si vedono % auto di un''altra comitiva', quante;
  end if;
  reset role;
  raise notice '4 ok: le auto non escono dalla comitiva';

  -- ===== 5. Una predefinita per persona, non una per tabella =====
  -- Bruno ne ha una sua e deve poterla marcare: se l'indice fosse su tutta la
  -- tabella, la predefinita di Ada gli impedirebbe di averne una.
  update auto set predefinita = true where id = auto_bruno;
  ok := false;
  begin
    update auto set predefinita = true where id = suv;
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception '5 ROTTO: una persona puo'' avere due auto predefinite';
  end if;
  raise notice '5 ok: una predefinita per persona, e Bruno ha la sua';

  -- ===== 6. Togliere un'auto non porta via i passaggi gia' fatti =====
  -- Con la cascata se ne andrebbero anche i conti della benzina di quei passaggi:
  -- cancellare una riga dal proprio garage non deve riscrivere la storia del gruppo.
  delete from auto where id = panda;
  if not exists (select 1 from rides where id = passaggio) then
    raise exception '6 ROTTO: togliere l''auto ha portato via il passaggio';
  end if;
  if (select auto_id from rides where id = passaggio) is not null then
    raise exception '6 ROTTO: il passaggio punta a un''auto che non esiste piu''';
  end if;
  raise notice '6 ok: tolta l''auto, i passaggi restano';

  -- ===== 7. Un consumo impossibile non entra =====
  ok := false;
  begin
    update auto set consumo_km_l = 200 where id = suv;
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception '7 ROTTO: il database accetta un consumo fuori scala';
  end if;
  raise notice '7 ok: il consumo resta dentro una scala sensata';

  raise notice 'Auto (C33): tutti i controlli passati.';
end $$;

reset role;
