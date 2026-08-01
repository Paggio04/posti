-- Verifica della 022: i conti restano fra le due parti.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Il difetto da non ripetere e' quello di C21 e C22: un dato che riguarda **due**
-- persone finito in una riga che vede tutto il gruppo. Qui e' denaro, quindi la
-- domanda non e' «chi vede la riga del gruppo» ma «chi vede *questa* riga».
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * `da_utente = auth.uid() or a_utente = auth.uid()` nella policy di lettura -> controllo 2
--   * il vincolo `registrato_da = auth.uid()` in insert                         -> controllo 3
--   * il controllo di appartenenza al gruppo in insert                          -> controllo 4
--   * `where public.condivide_gruppo(altro)` in `saldo_con`                     -> controllo 6
--   * la revoca di execute ad `anon` su `saldo_con`                             -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g_ab uuid; g_carla uuid;
  auto uuid; quante int; saldo numeric; ok boolean;
begin
  -- Tre persone: Ada e Bruno nella stessa comitiva, Carla in un'altra.
  insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid()||'@t.it') returning id into ada;
  insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid()||'@t.it') returning id into bruno;
  insert into auth.users (id, email) values (gen_random_uuid(), gen_random_uuid()||'@t.it') returning id into carla;

  insert into groups (name, owner_id) values ('AB', ada)    returning id into g_ab;
  insert into groups (name, owner_id) values ('C',  carla)  returning id into g_carla;
  insert into group_members (group_id, user_id) values (g_ab, ada), (g_ab, bruno), (g_carla, carla)
    on conflict do nothing;

  -- Ada guida, Bruno prende un posto: Bruno le deve 5,00.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, fuel_per_person)
  values (g_ab, ada, current_date + 1, '07:40', 'Casa', 'Uni', 4, 5.00) returning id into auto;
  insert into seat_claims (ride_id, passenger_id, seat_index) values (auto, bruno, 1);

  -- Da qui in poi si smette di essere superutente: la RLS non si applica a chi
  -- possiede la tabella, quindi un test che resta `postgres` verifica il nulla.
  set local role authenticated;

  -- 1. Bruno registra il pagamento verso Ada: deve riuscire.
  perform set_config('test.uid', bruno::text, true);
  insert into pagamenti (group_id, da_utente, a_utente, importo, registrato_da)
  values (g_ab, bruno, ada, 5.00, bruno);
  raise notice '1 ok: la parte che paga puo'' registrare il pagamento';

  -- 2. Carla, che non c'entra, non deve vedere quella riga.
  perform set_config('test.uid', carla::text, true);
  select count(*) into quante from pagamenti;
  if quante <> 0 then
    raise exception '2 ROTTO: un estraneo vede % pagamenti altrui', quante;
  end if;
  raise notice '2 ok: un estraneo non vede i conti di altri';

  -- 3. Carla non puo' inventare un pagamento a nome di Bruno.
  begin
    insert into pagamenti (group_id, da_utente, a_utente, importo, registrato_da)
    values (g_ab, bruno, ada, 99.00, bruno);
    raise exception '3 ROTTO: si e'' potuto scrivere un pagamento a nome di un altro';
  exception when insufficient_privilege or check_violation then
    raise notice '3 ok: non si scrive un pagamento a nome di un altro';
  end;

  -- 4. Carla non puo' registrare un pagamento verso qualcuno che non condivide il gruppo.
  begin
    insert into pagamenti (group_id, da_utente, a_utente, importo, registrato_da)
    values (g_carla, carla, ada, 1.00, carla);
    raise exception '4 ROTTO: pagamento verso chi non e'' della comitiva';
  exception when insufficient_privilege or check_violation then
    raise notice '4 ok: il destinatario deve essere della comitiva indicata';
  end;

  -- 5. Il saldo di Ada verso Bruno: dovuto 5,00, pagato 5,00 -> zero.
  perform set_config('test.uid', ada::text, true);
  select public.saldo_con(bruno) into saldo;
  if saldo is distinct from 0.00 then
    raise exception '5 ROTTO: saldo atteso 0.00, trovato %', saldo;
  end if;
  raise notice '5 ok: il saldo torna a zero quando il pagamento copre la quota';

  -- 6. Ada non deve poter chiedere il saldo di chi non condivide la comitiva.
  select public.saldo_con(carla) into saldo;
  if saldo is not null then
    raise exception '6 ROTTO: saldo su un estraneo, trovato %', saldo;
  end if;
  raise notice '6 ok: nessun saldo su chi non condivide la comitiva';

  reset role;
end $$;

-- 7. `saldo_con` non deve essere chiamabile senza account.
do $$
begin
  if has_function_privilege('anon', 'public.saldo_con(uuid)', 'execute') then
    raise exception '7 ROTTO: saldo_con e'' chiamabile da anon';
  end if;
  raise notice '7 ok: saldo_con non e'' chiamabile senza account';
end $$;
