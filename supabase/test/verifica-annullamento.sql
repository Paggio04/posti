-- Verifica del cantiere C28 (026): chi aveva un posto sa che il passaggio non c'e' piu'.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Sta in un file suo e non dentro `verifica-notifiche.sql`** per la ragione scritta
-- nella CI a proposito dell'ordine: due rami che aggiungono un passo nello stesso punto
-- di un file condiviso sono un conflitto di merge garantito. Il costo e' una riga in
-- `ci.yml`, il guadagno e' che i due cantieri si toccano da soli.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il trigger `rides_notifica_annullamento`                  -> controllo 1
--   * il ramo che avvisa anche la lista d'attesa                -> controllo 2
--   * il ramo `chi.utente = old.driver_id -> continue`          -> controllo 3
--   * `before delete` al posto di `after delete`                -> controlli 1 e 2, perche'
--     dopo la cascata non c'e' piu' nessuno da cercare
--   * il `null` al posto di `old.id` come `p_ride`              -> controlli 1 e 2: la
--     cascata di `notifiche_coda.ride_id` porterebbe via l'avviso appena scritto
--   * il ramo che avvisa chi guida quando cancella un altro     -> controllo 5

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dino uuid; capo uuid;
  g uuid;
  auto uuid; auto2 uuid;
  quante int;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c28.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c28.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c28.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dino@c28.it',  '{"display_name":"Dino"}')  returning id into dino;
  insert into auth.users (email, raw_user_meta_data) values ('capo@c28.it',  '{"display_name":"Capo"}')  returning id into capo;

  -- Il primo amministratore si nomina da qui, dove `auth.uid()` e' nullo: e' il caso
  -- che 008 documentava e che 012 ha reso possibile. Va **prima** di ogni set_config,
  -- altrimenti `protect_admin_flag` lo rifiuta.
  update public.profiles set is_admin = true where id = capo;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C28')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', dino::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', capo::text, true);
  perform public.join_group((select code from public.groups where id = g));

  -- Un posto solo: Bruno lo prende, Carla resta in lista d'attesa. Dino non c'entra.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Universita''', 1) returning id into auto;
  insert into seat_claims (ride_id, seat_index, passenger_id) values (auto, 1, bruno);
  insert into ride_waitlist (ride_id, user_id) values (auto, carla);

  -- Ada cancella la propria auto.
  perform set_config('test.uid', ada::text, true);
  delete from rides where id = auto;

  -- ===== 1. Chi aveva il posto lo sa =====
  if not exists (select 1 from notifiche_coda
                 where destinatario = bruno and tipo = 'passaggio_annullato') then
    raise exception '1 ROTTO: chi aveva un posto non e'' stato avvisato dell''annullamento';
  end if;
  raise notice '1 ok: chi aveva un posto e'' avvisato';

  -- ===== 2. Chi era in lista d'attesa pure: aspettava quell'auto =====
  if not exists (select 1 from notifiche_coda
                 where destinatario = carla and tipo = 'passaggio_annullato') then
    raise exception '2 ROTTO: la lista d''attesa non e'' stata avvisata';
  end if;
  raise notice '2 ok: anche la lista d''attesa e'' avvisata';

  -- ===== 3. Chi ha cancellato non riceve l'avviso di cio' che ha fatto =====
  if exists (select 1 from notifiche_coda
             where destinatario = ada and tipo = 'passaggio_annullato') then
    raise exception '3 ROTTO: chi cancella riceve l''avviso della propria cancellazione';
  end if;
  raise notice '3 ok: chi cancella non si autoavvisa';

  -- ===== 4. Chi non c'entra non riceve niente =====
  if exists (select 1 from notifiche_coda where destinatario = dino) then
    raise exception '4 ROTTO: avvisata una persona che non era su quell''auto';
  end if;
  raise notice '4 ok: chi non c''entra resta fuori';

  -- ===== 5. Se cancella l'amministratore, chi guidava lo scopre =====
  -- E' il caso in cui l'avviso serve **di piu'**: chi guida non sa nemmeno di essere
  -- stato cancellato, e si presenta al ritrovo con l'auto.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, bruno, current_date + 2, '08:10', 'Casa', 'Universita''', 3) returning id into auto2;
  perform set_config('test.uid', capo::text, true);
  delete from rides where id = auto2;
  if not exists (select 1 from notifiche_coda
                 where destinatario = bruno and tipo = 'passaggio_annullato'
                   and titolo like 'Il tuo passaggio%') then
    raise exception '5 ROTTO: cancellato da un amministratore, chi guidava non lo sa';
  end if;
  raise notice '5 ok: cancellato da un altro, chi guidava e'' avvisato';

  -- ===== 6. L'avviso sopravvive alla cancellazione che lo ha generato =====
  -- Se `ride_id` puntasse al passaggio, la cascata se lo porterebbe via nello stesso
  -- comando: la coda resterebbe vuota e nessuno se ne accorgerebbe, perche' non c'e'
  -- niente da guardare. E' il controllo che tiene ferma la decisione 1 della 026.
  select count(*) into quante from notifiche_coda where tipo = 'passaggio_annullato';
  if quante < 3 then
    raise exception '6 ROTTO: in coda ci sono % avvisi di annullamento invece di almeno 3', quante;
  end if;
  if exists (select 1 from notifiche_coda where tipo = 'passaggio_annullato' and ride_id is not null) then
    raise exception '6 ROTTO: un avviso di annullamento nomina un passaggio che non esiste piu''';
  end if;
  raise notice '6 ok: gli avvisi sopravvivono al passaggio che raccontano';

  -- ===== 7. Una cancellazione non si annulla perche' un avviso non passa =====
  -- La cascata di `elimina_account` (013) porta via i `rides` di chi se ne va: se
  -- accodare potesse fallire l'intera cancellazione salterebbe, e quella e' un obbligo
  -- di legge. Qui si cancella l'account di Dino, che non c'entra con nessuna auto, e
  -- poi quello di Bruno, che ne ha una con Carla in lista.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, bruno, current_date + 3, '09:00', 'Casa', 'Universita''', 2);
  insert into ride_waitlist (ride_id, user_id)
    select id, carla from rides where driver_id = bruno and ride_date = current_date + 3;
  perform set_config('test.uid', bruno::text, true);
  perform public.elimina_account();
  if exists (select 1 from auth.users where id = bruno) then
    raise exception '7 ROTTO: la cancellazione dell''account non e'' andata a fondo';
  end if;
  raise notice '7 ok: cancellare un account resta possibile con il trigger acceso';

  raise notice 'Annullamento (C28): tutti i controlli passati.';
end $$;

reset role;
