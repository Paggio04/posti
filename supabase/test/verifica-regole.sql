-- Verifica del cantiere C36 (032): le regole della comitiva.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Questo file verifica soprattutto che il database NON le faccia rispettare**, e non
-- e' un paradosso. La roadmap chiede che «le eccezioni si vedano perche' sono
-- eccezioni», cioe' che pubblicare contro una regola resti possibile: una regola di
-- comitiva e' una convenzione fra amici, non un vincolo di integrita'. Se domani
-- qualcuno aggiungesse un trigger «per sicurezza», l'unico modo di fare un'eccezione
-- diventerebbe cambiare la regola per tutti — cioe' mentire al database per fare una
-- cosa normale. Il controllo 4 e' li' per accorgersene.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * i due vincoli sui valori sensati        -> controllo 2
--   * `groups update owner` (se si allargasse) -> controllo 3
--   * `groups read member`                     -> controllo 5

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; quante int; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c36.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c36.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c36.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C36')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.create_group('Comitiva di Carla');

  -- ===== 1. Una comitiva nasce senza regole =====
  -- Il default deve essere «come prima»: un gruppo che nasce con una quota fissa
  -- imporrebbe una decisione che nessuno ha preso.
  if (select regola_quota from groups where id = g) is not null
     or (select regola_guida_non_paga from groups where id = g)
     or (select regola_max_posti from groups where id = g) is not null then
    raise exception '1 ROTTO: una comitiva nuova nasce con delle regole addosso';
  end if;
  raise notice '1 ok: una comitiva nasce senza regole';

  -- ===== 2. I valori restano sensati =====
  update groups set regola_quota = 5.00, regola_guida_non_paga = true, regola_max_posti = 4 where id = g;
  ok := false;
  begin
    update groups set regola_quota = 500 where id = g;
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '2 ROTTO: una quota fissa di 500 € passa'; end if;
  ok := false;
  begin
    update groups set regola_max_posti = 40 where id = g;
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception '2 ROTTO: un massimo di 40 passeggeri passa'; end if;
  raise notice '2 ok: quota e posti restano dentro una scala sensata';

  -- ===== 3. Le scrive chi possiede la comitiva, non un membro qualsiasi =====
  -- Nessuna policy nuova: `groups update owner` (003) nomina gia' `owner_id`. Il
  -- controllo serve a dire che aggiungere colonne non l'ha allargata — e' l'errore di
  -- C21 e C22 al contrario, e vale la pena avere una riga che lo misura.
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  update groups set regola_quota = 999 where id = g;
  if (select regola_quota from groups where id = g) = 999 then
    raise exception '3 ROTTO: un membro qualsiasi cambia le regole della comitiva';
  end if;
  raise notice '3 ok: le regole le scrive chi possiede la comitiva';

  -- ===== 4. Ma il database NON le fa rispettare =====
  -- La regola dice massimo 4 e quota 5,00. Questo passaggio ne offre 6 e non chiede
  -- niente: deve entrare. L'avviso sta nel client ed e' un avviso, non un rifiuto.
  reset role;
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats, fuel_per_person)
  values (g, ada, current_date + 1, '07:40', 'Casa', 'Mare', 6, null);
  if not exists (select 1 from rides where group_id = g and seats = 6) then
    raise exception
      '4 ROTTO: il database rifiuta un passaggio che va contro le regole della comitiva. Le eccezioni devono restare possibili: vedi l''intestazione della 032.';
  end if;
  raise notice '4 ok: un''eccezione resta possibile, e si vede';

  -- ===== 5. Le regole le legge chi ci sta dentro, e nessun altro =====
  -- Devono essere leggibili da tutti quelli a cui si applicano, o non sono regole:
  -- sono le preferenze di uno.
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  if (select regola_max_posti from groups where id = g) is null then
    raise exception '5 ROTTO: un membro non legge le regole che lo riguardano';
  end if;
  perform set_config('test.uid', carla::text, true);
  select count(*) into quante from groups where id = g;
  if quante <> 0 then
    raise exception '5 ROTTO: da fuori si leggono le regole di un''altra comitiva';
  end if;
  reset role;
  raise notice '5 ok: le regole si leggono da dentro la comitiva';

  raise notice 'Regole (C36): tutti i controlli passati.';
end $$;

reset role;
