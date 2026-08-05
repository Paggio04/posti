-- Verifica del cantiere C35 (031): un sedile con un nome invece di un account.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Meta' di questo file non prova la funzione nuova: prova le cose che un `null` in
-- piu' rompeva in silenzio.** Rendere `passenger_id` facoltativo attraversa mezzo
-- schema, e tre punti diventavano falsi **senza errori** — che e' il modo peggiore,
-- perche' un test che guarda solo «l'ospite si siede» sarebbe stato verde lo stesso.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il vincolo `seat_claim_persona_o_ospite`             -> controllo 2
--   * il `coalesce` in `saldo_con`                         -> controllo 4
--   * il secondo argomento di `controlla_persone`          -> controllo 5 (sospeso)
--     e controllo 6 (bloccato)
--   * il `coalesce` in `registra_evento_posto`             -> controllo 7
--   * il ramo dell'ospite in `notifica_posto_prenotato`    -> controllo 8
--   * il controllo di appartenenza in `check_ospite`       -> controllo 9
--   * il controllo sui nomi doppi in `check_ospite`        -> controllo 10

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dino uuid;
  g uuid; auto uuid;
  saldo numeric; quante int; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c35.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c35.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c35.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dino@c35.it',  '{"display_name":"Dino"}')  returning id into dino;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C35')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', dino::text, true);
  perform public.create_group('Comitiva di Dino');

  -- Ada guida, 5 € a testa. Bruno sale e porta un amico che non ha l'app.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, fuel_per_person)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Universita''', 4, 5.00) returning id into auto;

  -- ===== 1. Un ospite si siede =====
  insert into seat_claims (ride_id, seat_index, passenger_id) values (auto, 1, bruno);
  insert into seat_claims (ride_id, seat_index, ospite_nome, invitato_da)
  values (auto, 2, 'Enrico', bruno);
  raise notice '1 ok: un ospite occupa un sedile';

  -- ===== 2. Ma non a meta' =====
  -- Un sedile con tutti e due i modi, o con nessuno, non vuol dire niente.
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, passenger_id, ospite_nome, invitato_da)
    values (auto, 3, carla, 'Franco', carla);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '2 ROTTO: un sedile puo'' essere di una persona E di un ospite'; end if;
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index) values (auto, 3);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '2 ROTTO: un sedile puo'' essere occupato da nessuno'; end if;
  raise notice '2 ok: o una persona o un ospite, mai tutti e due e mai nessuno';

  -- ===== 3. Il posto risulta occupato a tutti =====
  -- E' il difetto vero che C35 chiude: senza, l'auto mostra un posto libero che libero
  -- non e', e qualcuno prenota un sedile su cui poi si siede un altro.
  select count(*) into quante from seat_claims where ride_id = auto;
  if quante <> 2 then
    raise exception '3 ROTTO: sull''auto risultano % posti presi invece di 2', quante;
  end if;
  raise notice '3 ok: il posto dell''ospite e'' occupato come gli altri';

  -- ===== 4. La quota dell'ospite e' nel conto di chi lo ha portato =====
  -- Non in un conto suo, che non esiste. Senza il `coalesce` in `saldo_con` quel posto
  -- sparirebbe dai conti, cioe' Bruno avrebbe portato una persona in macchina gratis
  -- senza che nessuno lo avesse deciso.
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  select public.saldo_con(ada) into saldo;
  if saldo <> -10.00 then
    raise exception '4 ROTTO: Bruno deve % ad Ada invece di 10,00 (il suo posto piu'' quello del suo ospite)', -saldo;
  end if;
  reset role;
  raise notice '4 ok: la quota dell''ospite sta nel conto di chi lo ha portato';

  -- ===== 5. Un sospeso non riempie l'auto di ospiti =====
  -- `controlla_persone` legge la persona da UNA colonna: con `passenger_id` nullo la
  -- domanda «e' sospeso?» diventava una domanda su nessuno, e la risposta era no.
  -- La sospensione la mette un amministratore, o chi ha `auth.uid()` nullo — cioe' il
  -- SQL editor (012). Qui si passa dalla seconda porta, che e' quella che i test usano.
  perform set_config('test.uid', '', true);
  update public.profiles set sospeso = true, sospeso_motivo = 'prova' where id = carla;
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, ospite_nome, invitato_da)
    values (auto, 3, 'Gino', carla);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '5 ROTTO: un account sospeso puo'' portare ospiti';
  end if;
  update public.profiles set sospeso = false, sospeso_motivo = null where id = carla;
  raise notice '5 ok: la sospensione vale anche sugli ospiti';

  -- ===== 6. E nemmeno chi si e' bloccato con chi guida =====
  insert into public.user_blocks (blocker_id, blocked_id) values (ada, carla);
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, ospite_nome, invitato_da)
    values (auto, 3, 'Gino', carla);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '6 ROTTO: chi e'' bloccato dal guidatore sale lo stesso, sotto forma di ospite';
  end if;
  delete from public.user_blocks where blocker_id = ada and blocked_id = carla;
  raise notice '6 ok: il blocco vale anche sugli ospiti';

  -- ===== 7. L'evento ha un attore =====
  -- Un registro con una riga senza attore non racconta niente, e nessun errore lo dice.
  if not exists (select 1 from eventi where ride_id = auto and tipo = 'posto_preso' and attore = bruno) then
    raise exception '7 ROTTO: il posto dell''ospite non ha lasciato un evento con un attore';
  end if;
  select count(*) into quante from eventi where ride_id = auto and tipo = 'posto_preso' and attore is null;
  if quante > 0 then
    raise exception '7 ROTTO: % eventi «posto preso» senza attore', quante;
  end if;
  raise notice '7 ok: l''evento dell''ospite e'' attribuito a chi lo ha portato';

  -- ===== 8. Il guidatore sa chi sale, non «qualcuno» =====
  if not exists (select 1 from notifiche_coda
                 where destinatario = ada and tipo = 'posto_prenotato'
                   and corpo like 'Enrico (ospite di Bruno)%') then
    raise exception '8 ROTTO: il guidatore non sa chi e'' l''ospite che sale sulla sua auto';
  end if;
  raise notice '8 ok: la notifica nomina l''ospite e chi lo porta';

  -- ===== 9. Non si porta un ospite sull'auto di un'altra comitiva =====
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, ospite_nome, invitato_da)
    values (auto, 3, 'Ugo', dino);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '9 ROTTO: un estraneo alla comitiva ci mette dentro un ospite';
  end if;
  raise notice '9 ok: l''ospite lo porta chi e'' della comitiva';

  -- ===== 10. Due ospiti con lo stesso nome non si distinguono =====
  -- Un nome e' tutto cio' che un ospite ha: due «Enrico» sulla stessa auto sono due
  -- posti che nessuno sa a chi appartengano, e liberarne uno diventa un tiro a caso.
  ok := false;
  begin
    insert into seat_claims (ride_id, seat_index, ospite_nome, invitato_da)
    values (auto, 3, 'enrico', carla);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '10 ROTTO: due ospiti con lo stesso nome sulla stessa auto';
  end if;
  raise notice '10 ok: un nome per ospite, per auto';

  -- ===== 11. Chi ha portato l'ospite lo puo' togliere =====
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  delete from seat_claims where ride_id = auto and ospite_nome = 'Enrico';
  if exists (select 1 from seat_claims where ride_id = auto and ospite_nome = 'Enrico') then
    raise exception '11 ROTTO: chi ha portato l''ospite non riesce a liberarne il posto';
  end if;
  reset role;
  raise notice '11 ok: chi porta l''ospite ne libera il posto';

  raise notice 'Ospite (C35): tutti i controlli passati.';
end $$;

reset role;
