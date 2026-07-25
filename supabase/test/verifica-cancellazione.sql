-- Verifica del cantiere C11: cancellare il proprio account porta via i propri dati e
-- **non** quelli degli altri.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g uuid; g_solo uuid;
  auto_ada uuid; auto_bruno uuid;
  visti int; stato text;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c11.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c11.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c11.it', '{"display_name":"Carla"}') returning id into carla;

  -- Ada possiede una comitiva con Bruno e Carla dentro, e una tutta sua.
  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva di Ada')).id;
  g_solo := (public.create_group('Solo io')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g));
  perform set_config('test.uid', carla::text, true);
  perform public.join_group((select code from public.groups where id = g));

  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (ada, current_date, 'Mare', 4, g) returning id into auto_ada;
  insert into public.rides (driver_id, ride_date, destination, seats, group_id)
    values (bruno, current_date + 1, 'Monti', 4, g) returning id into auto_bruno;
  insert into public.seat_claims (ride_id, seat_index, passenger_id) values (auto_ada, 1, carla);
  insert into public.ride_comments (ride_id, user_id, body) values (auto_bruno, ada, 'Ci sono anche io');

  -- ===== 1. Senza autenticazione non si cancella niente =====
  set local role authenticated;
  perform set_config('test.uid', '', true);
  stato := null;
  begin
    perform public.elimina_account();
  exception when others then stato := sqlstate; end;
  if stato is null then raise exception 'FALLA GRAVE: elimina_account() funziona senza un utente autenticato'; end if;

  -- ===== 2. Ada si cancella =====
  perform set_config('test.uid', ada::text, true);
  perform public.elimina_account();

  reset role;
  if exists (select 1 from auth.users where id = ada) then
    raise exception 'L''account di Ada e'' ancora li'''; end if;
  if exists (select 1 from public.profiles where id = ada) then
    raise exception 'Il profilo di Ada e'' sopravvissuto all''account';
  end if;
  if exists (select 1 from public.rides where id = auto_ada) then
    raise exception 'L''auto di Ada e'' sopravvissuta all''account';
  end if;
  if exists (select 1 from public.seat_claims where ride_id = auto_ada) then
    raise exception 'Le prenotazioni sull''auto di Ada sono sopravvissute';
  end if;
  if exists (select 1 from public.ride_comments where user_id = ada) then
    raise exception 'I commenti di Ada sono sopravvissuti';
  end if;

  -- ===== 3. La comitiva NON muore con chi la possedeva =====
  if not exists (select 1 from public.groups where id = g) then
    raise exception 'DANNO AGLI ALTRI: cancellando Ada e'' sparita la comitiva di tutti';
  end if;
  if (select owner_id from public.groups where id = g) not in (bruno, carla) then
    raise exception 'La comitiva non e'' passata a un membro rimasto';
  end if;
  select count(*) into visti from public.group_members where group_id = g;
  if visti <> 2 then
    raise exception 'Nella comitiva restano % membri invece di 2', visti;
  end if;
  if not exists (select 1 from public.rides where id = auto_bruno) then
    raise exception 'DANNO AGLI ALTRI: cancellando Ada e'' sparita l''auto di Bruno';
  end if;

  -- ===== 4. La comitiva senza nessun altro dentro se ne va =====
  if exists (select 1 from public.groups where id = g_solo) then
    raise exception 'La comitiva rimasta senza membri e'' sopravvissuta al suo unico proprietario';
  end if;

  raise notice 'Cancellazione dell''account (C11): tutti i controlli passati.';
end $$;

reset role;
