-- Verifica del cantiere C32 (029): tre grafie sono un posto solo.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il trigger `rides_registra_fermate`                    -> controllo 1
--   * `chiave_fermata` (o la sua `translate` degli accenti)  -> controllo 2
--   * l'indice unico su (group_id, chiave)                   -> controllo 2
--   * l'`on conflict ... do update` che incrementa `usi`     -> controllo 3
--   * la policy di lettura `is_member`                       -> controllo 5
--   * il `continue` sulle chiavi nulle                       -> controllo 6
--
-- **Il controllo 7 e' quello che conta di piu'**, e non prova cio' che la tabella fa:
-- prova cio' che **non** deve fare. Le coordinate di `rides` non devono finire qui da
-- sole, perche' il punto di «Parto da qui» e' dove si trovava una persona — quasi
-- sempre casa sua — e questa tabella la legge tutto il gruppo. E' C21 e C22 per la
-- terza volta, e l'unico modo di non rifarlo e' avere una riga che diventa rossa.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; g2 uuid;
  quante int; quanti_usi int;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c32.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c32.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c32.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C32')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  g2 := (public.create_group('Altra comitiva C32')).id;

  -- ===== 1. Pubblicare accende la rubrica =====
  -- Una rubrica da compilare prima di poterla usare resta vuota per sempre: il primo
  -- che pubblica non ha niente da scegliere, quindi scrive, quindi nemmeno il secondo.
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, ada, current_date + 1, '07:40', 'Piazza Dante', 'Universita''', 4);
  if not exists (select 1 from fermate where group_id = g and nome = 'Piazza Dante') then
    raise exception '1 ROTTO: pubblicare non mette la partenza in rubrica';
  end if;
  if not exists (select 1 from fermate where group_id = g and nome = 'Universita''') then
    raise exception '1 ROTTO: pubblicare non mette la destinazione in rubrica';
  end if;
  raise notice '1 ok: la rubrica si accende alla prima pubblicazione';

  -- ===== 2. «piazza dante» e «P.za  DANTE» non sono due posti nuovi =====
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, bruno, current_date + 1, '08:00', 'piazza dante', 'Universita', 4);
  select count(*) into quante from fermate where group_id = g and chiave = 'piazza dante';
  if quante <> 1 then
    raise exception '2 ROTTO: «piazza dante» ha creato una seconda riga (ce ne sono %)', quante;
  end if;
  -- E l'accento piegato: «Universita'» e «Universita» sono lo stesso posto.
  select count(*) into quante from fermate where group_id = g and chiave = 'universita';
  if quante <> 1 then
    raise exception '2 ROTTO: l''accento crea un posto nuovo (righe: %)', quante;
  end if;
  raise notice '2 ok: le grafie diverse restano lo stesso posto';

  -- ===== 3. E la seconda volta si conta, non si perde =====
  select usi into quanti_usi from fermate where group_id = g and chiave = 'piazza dante';
  if quanti_usi <> 2 then
    raise exception '3 ROTTO: la fermata e'' stata usata 2 volte ma ne conta %', quanti_usi;
  end if;
  raise notice '3 ok: le due grafie contano come lo stesso posto';

  -- ===== 4. Il nome che si legge e' il primo scritto, non l'ultimo =====
  -- Se l'ultima grafia sovrascrivesse la prima, l'elenco cambierebbe sotto gli occhi
  -- di chi lo guarda ogni volta che qualcuno scrive male.
  if (select nome from fermate where group_id = g and chiave = 'piazza dante') <> 'Piazza Dante' then
    raise exception '4 ROTTO: il nome in rubrica cambia a ogni grafia nuova';
  end if;
  raise notice '4 ok: in rubrica resta il nome scritto per primo';

  -- ===== 5. La rubrica di una comitiva non esce dalla comitiva =====
  set local role authenticated;
  perform set_config('test.uid', carla::text, true);
  select count(*) into quante from fermate;
  if quante <> 0 then
    raise exception '5 ROTTO: da fuori si leggono % fermate di un''altra comitiva', quante;
  end if;
  reset role;
  raise notice '5 ok: la rubrica resta dentro la comitiva';

  -- ===== 6. Un campo lasciato a meta' non e' una fermata =====
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats)
  values (g, carla, current_date + 2, '09:00', ' - ', 'Mare', 4);
  if exists (select 1 from fermate where group_id = g and chiave is null) then
    raise exception '6 ROTTO: un campo senza lettere e'' finito in rubrica';
  end if;
  raise notice '6 ok: due punti e un trattino non sono un posto';

  -- ===== 7. Le coordinate NON si raccolgono da sole =====
  insert into rides (group_id, driver_id, ride_date, depart_time, origin, destination, seats,
                     origin_lat, origin_lon)
  values (g, ada, current_date + 3, '07:00', 'Casa di Ada', 'Universita''', 4, 43.7711, 11.2486);
  if (select lat from fermate where group_id = g and chiave = 'casa di ada') is not null then
    raise exception
      '7 ROTTO: il punto di «Parto da qui» e'' finito in una tabella che legge tutto il gruppo. E'' C21, per la terza volta.';
  end if;
  raise notice '7 ok: il punto di partenza di una persona non entra nella rubrica del gruppo';

  -- ===== 8. Ma messo apposta ci sta, ed e' mezzo punto o niente =====
  update fermate set lat = 43.7711, lon = 11.2486 where group_id = g and chiave = 'piazza dante';
  if (select lon from fermate where group_id = g and chiave = 'piazza dante') is null then
    raise exception '8 ROTTO: un membro non riesce a segnare il punto di una fermata';
  end if;
  begin
    update fermate set lon = null where group_id = g and chiave = 'piazza dante';
    raise exception '8 ROTTO: una fermata puo'' avere mezza coordinata';
  exception when check_violation then
    null;
  end;
  raise notice '8 ok: il punto si segna apposta, e o c''e'' tutto o non c''e''';

  raise notice 'Fermate (C32): tutti i controlli passati.';
end $$;

reset role;
