-- Verifica del cantiere C10: segnalazione, blocco, sospensione.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
-- Ogni controllo fallito ferma lo script: nessun esito verde per distrazione.
--
-- Come in verifica-isolamento.sql, si prova con il ruolo "authenticated" e auth.uid()
-- finto: quello che qui e' vietato, e' vietato anche dal browser.
--
-- Le azioni vietate NON si provano con "begin ... raise 'FALLA' ... exception when
-- raise_exception", perche' quel FALLA finirebbe nel gestore del blocco stesso e il test
-- passerebbe proprio quando il divieto non scatta. Si registra invece lo SQLSTATE in una
-- variabile e si giudica fuori dal blocco: cosi' si vede sia se il divieto e' scattato,
-- sia se e' scattato per il motivo giusto.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dino uuid; capo uuid;
  g uuid;
  auto_ada uuid; auto_carla uuid; auto_bruno uuid;
  visti int; stato text;
  -- 42501 = policy RLS, P0001 = raise di un trigger, 23514 = check, 23505 = unique
begin
  -- ===== Personaggi: quattro nella stessa comitiva, piu' un amministratore =====
  insert into auth.users (email, raw_user_meta_data) values ('ada@c10.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c10.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c10.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dino@c10.it', '{"display_name":"Dino"}') returning id into dino;
  insert into auth.users (email, raw_user_meta_data) values ('capo@c10.it', '{"display_name":"Capo"}') returning id into capo;

  -- Il primo amministratore si nomina da qui, dove auth.uid() e' nullo: e' il caso che
  -- 008 documentava e che il suo trigger rifiutava. Se questa riga fallisce, la
  -- correzione in 012 e' stata persa.
  update public.profiles set is_admin = true where id = capo;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C10')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', dino::text, true);
  perform public.join_group((select code from public.groups where id = g));

  -- Un'auto a testa: senza quella di Bruno il blocco non si potrebbe verificare nei due
  -- sensi, perche' ad Ada non sparirebbe niente.
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (carla, current_date, 'Lago', 4, g) returning id into auto_carla;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date, 'Mare', 4, g) returning id into auto_ada;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (bruno, current_date + 1, 'Montagna', 4, g) returning id into auto_bruno;

  -- Ada si mette in lista d'attesa sull'auto di Bruno PRIMA che lui la blocchi: e' la
  -- premessa del controllo 6-bis, il solo che isola il trigger claims_persone.
  set local role authenticated;
  perform set_config('test.uid', ada::text, true);
  insert into public.ride_waitlist (ride_id, user_id) values (auto_bruno, ada);

  -- ===== 1. Segnalazione: Bruno segnala Ada =====
  perform set_config('test.uid', bruno::text, true);
  insert into public.user_reports (reporter_id, reported_id, motivo, dettagli)
    values (bruno, ada, 'guida-pericolosa', 'Ha fatto tre sorpassi in curva.');

  stato := null;
  begin
    insert into public.user_reports (reporter_id, reported_id, motivo) values (carla, ada, 'altro');
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: si puo'' segnalare a nome di un altro utente'; end if;
  if stato <> '42501' then raise exception 'Segnalazione per conto terzi fermata da % invece che dalla policy', stato; end if;

  stato := null;
  begin
    insert into public.user_reports (reporter_id, reported_id, motivo) values (bruno, bruno, 'altro');
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: ci si puo'' segnalare da soli'; end if;
  if stato <> '23514' then raise exception 'Autosegnalazione fermata da % invece che dal check', stato; end if;

  stato := null;
  begin
    insert into public.user_reports (reporter_id, reported_id, motivo) values (bruno, ada, 'altro');
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: si riempie la coda di segnalazioni sulla stessa persona'; end if;
  if stato <> '23505' then raise exception 'Doppia segnalazione fermata da % invece che dall''indice unico', stato; end if;

  -- ===== 2. Ada non deve accorgersi di essere stata segnalata =====
  perform set_config('test.uid', ada::text, true);
  select count(*) into visti from public.user_reports;
  if visti <> 0 then raise exception 'FALLA: il segnalato vede % segnalazioni che lo riguardano', visti; end if;

  -- ===== 3. L'amministratore le vede e le gestisce =====
  perform set_config('test.uid', capo::text, true);
  select count(*) into visti from public.user_reports;
  if visti <> 1 then raise exception 'L''amministratore vede % segnalazioni invece di 1', visti; end if;
  update public.user_reports set stato = 'chiusa', esito = 'Parlato con Ada.', gestita_da = capo, gestita_il = now();

  -- ...mentre chi ha segnalato non la riapre: la riga c'e', ma la policy non fa passare
  -- l'update, quindi resta chiusa senza errore.
  perform set_config('test.uid', bruno::text, true);
  update public.user_reports set stato = 'aperta' where reporter_id = bruno;
  select ur.stato into stato from public.user_reports ur where ur.reporter_id = bruno;
  if stato <> 'chiusa' then raise exception 'FALLA: chi segnala puo'' riaprire la propria segnalazione'; end if;

  -- ===== 4. Blocco: Bruno blocca Ada =====
  insert into public.user_blocks (blocker_id, blocked_id) values (bruno, ada);

  if exists (select 1 from public.rides where id = auto_ada) then
    raise exception 'BLOCCO ROTTO: Bruno vede ancora l''auto della persona che ha bloccato';
  end if;
  select count(*) into visti from public.rides;
  if visti <> 2 then
    raise exception 'Bruno vede % auto invece delle 2 che gli restano (la sua e quella di Carla)', visti;
  end if;
  -- Il nome di chi si blocca resta leggibile a CHI blocca, e deve: senza, la lista dei
  -- bloccati sarebbe un elenco di sconosciuti e non si potrebbe piu' sbloccare nessuno.
  if not exists (select 1 from public.profiles where id = ada) then
    raise exception 'Bruno non legge piu'' il nome di chi ha bloccato: non potra'' sbloccarla';
  end if;
  if not exists (select 1 from public.profiles where id = bruno) then
    raise exception 'Bruno ha perso di vista il proprio profilo';
  end if;

  -- ===== 5. Il blocco vale nei due sensi, anche se l'ha deciso Bruno =====
  -- Sul nome invece e' asimmetrico: Ada, che ha subito il blocco, perde di vista Bruno.
  perform set_config('test.uid', ada::text, true);
  if exists (select 1 from public.profiles where id = bruno) then
    raise exception 'BLOCCO ROTTO: Ada legge ancora il profilo di chi l''ha bloccata';
  end if;
  if exists (select 1 from public.rides where id = auto_bruno) then
    raise exception 'BLOCCO ROTTO: Ada vede ancora l''auto di chi l''ha bloccata';
  end if;
  select count(*) into visti from public.rides;
  if visti <> 2 then
    raise exception 'Ada vede % auto invece delle 2 che le restano (la sua e quella di Carla)', visti;
  end if;
  select count(*) into visti from public.user_blocks;
  if visti <> 0 then
    raise exception 'FALLA: il bloccato vede % righe di blocco, quindi sa di esserlo', visti;
  end if;

  -- ===== 6. Bloccati non si sale in macchina insieme =====
  perform set_config('test.uid', bruno::text, true);
  stato := null;
  begin
    insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_ada, 1, bruno);
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: si prenota un posto sull''auto di una persona bloccata'; end if;

  stato := null;
  begin
    insert into public.ride_waitlist (ride_id, user_id) values (auto_ada, bruno);
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: ci si mette in lista d''attesa da una persona bloccata'; end if;

  -- ===== 6-bis. La lista d'attesa non aggira il blocco =====
  -- Ada era in coda sull'auto di Bruno da prima del blocco. Quando un posto si libera,
  -- promote_waitlist() la farebbe salire: e' security definer, quindi non passa da
  -- nessuna policy. Qui l'unica difesa e' il trigger claims_persone, e questo e' il solo
  -- controllo che lo mette alla prova da solo.
  perform set_config('test.uid', dino::text, true);
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_bruno, 1, dino);
  delete from public.seat_claims where ride_id = auto_bruno and passenger_id = dino;

  reset role;
  if exists (select 1 from public.seat_claims where ride_id = auto_bruno and passenger_id = ada) then
    raise exception 'BLOCCO AGGIRATO: la lista d''attesa ha fatto salire Ada sull''auto di chi l''ha bloccata';
  end if;
  if not exists (select 1 from public.ride_waitlist where ride_id = auto_bruno and user_id = ada) then
    raise exception 'Ada e'' sparita dalla lista d''attesa senza essere salita da nessuna parte';
  end if;
  set local role authenticated;

  -- ===== 7. Il posto gia' preso resta, e resta annullabile =====
  -- Dino sale sull'auto di Ada e SOLO DOPO la blocca: e' il caso che decide se il blocco
  -- lascia in giro prenotazioni fantasma. Serve lui e non Carla, che quel giorno guida e
  -- quindi non puo' prenotare (regola di 004).
  perform set_config('test.uid', dino::text, true);
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_ada, 1, dino);
  insert into public.user_blocks (blocker_id, blocked_id) values (dino, ada);

  if not exists (select 1 from public.rides where id = auto_ada) then
    raise exception 'PRENOTAZIONE FANTASMA: Dino ha un posto su un''auto che non vede piu''';
  end if;
  delete from public.seat_claims where ride_id = auto_ada and passenger_id = dino;
  if exists (select 1 from public.seat_claims where ride_id = auto_ada and passenger_id = dino) then
    raise exception 'Dino non riesce a liberare il proprio posto';
  end if;
  if exists (select 1 from public.rides where id = auto_ada) then
    raise exception 'BLOCCO ROTTO: senza piu'' il posto, l''auto della persona bloccata resta visibile';
  end if;
  -- ===== 7-bis. Bloccare non e' un modo per tenersi leggibile una persona =====
  -- Il nome di chi si blocca resta visibile, ma resta dentro il vincolo di 011: uscito
  -- dalla comitiva, Dino non deve leggere piu' niente di Ada. Il blocco su Ada e' ancora
  -- quello messo qui sopra.
  delete from public.group_members where user_id = dino;
  if exists (select 1 from public.profiles where id = ada) then
    raise exception 'FALLA: bloccare qualcuno lo rende leggibile anche fuori dalla comitiva';
  end if;
  reset role;
  perform public.join_group((select code from public.groups where id = g));
  set local role authenticated;
  delete from public.user_blocks where blocker_id = dino;

  -- ===== 8. Un commento di una persona bloccata sparisce =====
  perform set_config('test.uid', ada::text, true);
  insert into public.ride_comments (ride_id, user_id, body) values (auto_carla, ada, 'Passo io a prendervi');
  perform set_config('test.uid', bruno::text, true);
  select count(*) into visti from public.ride_comments where ride_id = auto_carla;
  if visti <> 0 then
    raise exception 'BLOCCO ROTTO: Bruno legge % commenti di una persona bloccata', visti;
  end if;
  perform set_config('test.uid', carla::text, true);
  select count(*) into visti from public.ride_comments where ride_id = auto_carla;
  if visti <> 1 then
    raise exception 'Carla, che non ha bloccato nessuno, non vede il commento di Ada';
  end if;

  -- ===== 9. Sospensione: Ada viene sospesa =====
  perform set_config('test.uid', capo::text, true);
  update public.profiles set sospeso = true, sospeso_il = now(), sospeso_motivo = 'Segnalazioni ripetute' where id = ada;

  perform set_config('test.uid', ada::text, true);

  stato := null;
  begin
    insert into public.rides (driver_id, ride_date, destination, seats, group_id)
      values (ada, current_date + 2, 'Montagna', 4, g);
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: un account sospeso pubblica ancora auto'; end if;
  if stato <> '42501' then raise exception 'Pubblicazione da sospeso fermata da % invece che dalla policy', stato; end if;

  stato := null;
  begin
    insert into public.ride_comments (ride_id, user_id, body) values (auto_carla, ada, 'ci sono');
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: un account sospeso commenta ancora'; end if;

  stato := null;
  begin
    insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_carla, 2, ada);
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: un account sospeso prenota ancora posti'; end if;

  stato := null;
  begin
    perform public.create_group('Comitiva di riserva');
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: un account sospeso crea ancora comitive'; end if;

  stato := null;
  begin
    update public.profiles set sospeso = false where id = ada;
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA GRAVE: un account sospeso si riabilita da solo'; end if;
  if public.sospeso(ada) is not true then
    raise exception 'FALLA GRAVE: la sospensione di Ada e'' sparita';
  end if;

  -- ...ma puo' ancora ritirare la propria auto, che toglie ingombro agli altri
  delete from public.rides where id = auto_ada;
  if exists (select 1 from public.rides where id = auto_ada) then
    raise exception 'Un account sospeso non riesce a ritirare la propria auto';
  end if;

  -- ===== 9-bis. Nessuno tocca il proprio stato di sospensione, nemmeno per peggiorarlo =====
  -- Su un utente normale la policy "profiles update own" lascia passare l'update: qui
  -- l'unica difesa e' il trigger profiles_protect_sospeso, e questo lo isola.
  perform set_config('test.uid', carla::text, true);
  stato := null;
  begin
    update public.profiles set sospeso = true where id = carla;
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA: un utente si mette da solo lo stato di sospensione'; end if;
  if stato <> 'P0001' then raise exception 'Automodifica della sospensione fermata da % invece che dal trigger', stato; end if;
  if public.sospeso(carla) then raise exception 'FALLA: Carla si e'' sospesa da sola'; end if;

  -- ===== 10. Nessuno si promuove amministratore =====
  perform set_config('test.uid', bruno::text, true);
  stato := null;
  begin
    update public.profiles set is_admin = true where id = bruno;
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA GRAVE: ci si promuove amministratore da soli'; end if;
  if (select p.is_admin from public.profiles p where p.id = bruno) then
    raise exception 'FALLA GRAVE: Bruno e'' diventato amministratore';
  end if;

  -- ===== 11. L'amministratore riabilita =====
  perform set_config('test.uid', capo::text, true);
  update public.profiles set sospeso = false, sospeso_il = null, sospeso_motivo = null where id = ada;
  if public.sospeso(ada) then
    raise exception 'L''amministratore non riesce a riabilitare un account';
  end if;

  raise notice 'Sicurezza delle persone (C10): tutti i controlli passati.';
end $$;

reset role;
