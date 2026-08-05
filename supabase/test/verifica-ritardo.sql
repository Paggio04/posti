-- Verifica del cantiere C30 (027): «sono in ritardo di cinque minuti».
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il trigger `rides_notifica_ritardo`                        -> controllo 1
--   * i minuti dentro la chiave della notifica                   -> controllo 2, che e' il
--     motivo per cui ci sono: senza, il secondo annuncio sparisce nell'indice unico
--   * il ramo `new.ritardo_min is not distinct from old`         -> controllo 3
--   * il ramo `new.ritardo_min is null -> return`                -> controllo 4
--   * il vincolo `rides_ritardo_sensato`                         -> controllo 5
--   * `for update of ritardo_min` al posto di `for update`       -> resta verde: e' un
--     restringimento di comodo, non una garanzia. Vale la pena saperlo.
--
-- Quello che questo file **non** verifica: che il ritardo si veda sulla scheda. Quella
-- meta' e' nel client e si guarda a video, come tutto il resto di C15.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; auto uuid;
  quante int; prima int; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c30.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c30.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c30.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C30')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));

  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Universita''', 3) returning id into auto;
  insert into seat_claims (ride_id, seat_index, passenger_id) values (auto, 1, bruno);

  -- ===== 1. Annunciato un ritardo, chi ha un posto lo riceve =====
  update rides set ritardo_min = 10 where id = auto;
  if not exists (select 1 from notifiche_coda
                 where destinatario = bruno and tipo = 'ritardo' and ride_id = auto) then
    raise exception '1 ROTTO: chi ha un posto non riceve l''annuncio del ritardo';
  end if;
  -- E l'ora vera sta scritta nel corpo: e' l'informazione, non il numero di minuti.
  if not exists (select 1 from notifiche_coda
                 where destinatario = bruno and tipo = 'ritardo' and corpo like '%07:50%') then
    raise exception '1 ROTTO: l''avviso non dice a che ora si parte davvero';
  end if;
  raise notice '1 ok: il ritardo arriva a chi ha un posto, con l''ora vera';

  -- ===== 2. «Dieci» e poi «venti» sono due fatti, e arrivano tutti e due =====
  -- E' il controllo che tiene ferma la scelta dei minuti dentro la chiave: con la
  -- chiave sul solo passaggio il secondo annuncio sarebbe sparito nell'indice unico,
  -- e chi aspetta avrebbe continuato a credere che fossero dieci.
  update rides set ritardo_min = 20 where id = auto;
  select count(*) into quante from notifiche_coda where destinatario = bruno and tipo = 'ritardo';
  if quante <> 2 then
    raise exception '2 ROTTO: dopo due annunci diversi in coda ci sono % avvisi invece di 2', quante;
  end if;
  raise notice '2 ok: cambiare il ritardo avvisa di nuovo';

  -- ===== 3. Ridire lo stesso ritardo non fa vibrare niente =====
  -- Il bottone si preme due volte per sbaglio; il numero cambia solo se qualcuno
  -- lo cambia.
  select count(*) into prima from notifiche_coda where destinatario = bruno and tipo = 'ritardo';
  update rides set ritardo_min = 20 where id = auto;
  if (select count(*) from notifiche_coda where destinatario = bruno and tipo = 'ritardo') <> prima then
    raise exception '3 ROTTO: ridire lo stesso ritardo manda un secondo avviso';
  end if;
  raise notice '3 ok: lo stesso ritardo non si riannuncia';

  -- ===== 4. Tornare in orario non e' un avviso =====
  -- Non e' pigrizia: e' l'unica notizia della serie che non cambia i piani di
  -- nessuno, e chi aspetta la vede comunque sulla scheda.
  select count(*) into prima from notifiche_coda where destinatario = bruno;
  update rides set ritardo_min = null where id = auto;
  if (select count(*) from notifiche_coda where destinatario = bruno) <> prima then
    raise exception '4 ROTTO: togliere il ritardo manda una notifica';
  end if;
  raise notice '4 ok: tornare in orario non fa vibrare nessuno';

  -- ===== 5. Un ritardo di tre giorni non e' un ritardo =====
  ok := false;
  begin
    update rides set ritardo_min = 5000 where id = auto;
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception '5 ROTTO: il database accetta un ritardo fuori scala';
  end if;
  raise notice '5 ok: il ritardo resta dentro una scala sensata';

  -- ===== 6. Chi non e' su quell'auto non riceve niente =====
  update rides set ritardo_min = 15 where id = auto;
  if exists (select 1 from notifiche_coda where destinatario = carla and tipo = 'ritardo') then
    raise exception '6 ROTTO: avvisata una persona che non e'' su quell''auto';
  end if;
  raise notice '6 ok: l''annuncio resta a chi e'' a bordo';

  -- ===== 7. Lo annuncia chi guida, non chi e' a bordo =====
  -- La policy di scrittura di `rides` e' quella di 002 e nomina `driver_id`: qui si
  -- verifica che aggiungere due colonne non l'abbia allargata per sbaglio.
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  update rides set ritardo_min = 45 where id = auto;
  if (select ritardo_min from rides where id = auto) = 45 then
    raise exception '7 ROTTO: un passeggero puo'' annunciare il ritardo di chi guida';
  end if;
  raise notice '7 ok: il ritardo lo annuncia chi guida';

  raise notice 'Ritardo (C30): tutti i controlli passati.';
end $$;

reset role;
