-- Verifica del cantiere C22: la zona di una persona non esce dal suo profilo.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: il test diventa rosso se si toglie una qualsiasi di queste cose.
--   * la chiamata a `blinda_profilo()` in 019                  -> controlli 2, 3 e 4
--   * il filtro `p.id = auth.uid()` in `mio_profilo()` (018)   -> controllo 6
--   * la revoca di execute su `blinda_profilo`                 -> controllo 7
--   * il grant di execute su `mio_profilo` ad authenticated    -> controllo 1
--
-- Va per ultimo nella CI, dopo `verifica-coordinate.sql`, per la stessa ragione per cui
-- quello va dopo gli altri: qui sotto si riaprono i permessi per poter preparare i dati,
-- e poi si richiude solo quello che questo file deve verificare.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

-- I grant qui sopra cancellano proprio la restrizione da verificare: la si rimette com'e'
-- in produzione, con la stessa funzione che usa la migrazione.
select public.blinda_profilo();
revoke execute on function public.blinda_profilo() from authenticated, anon;
revoke execute on function public.mio_profilo() from anon;
grant execute on function public.mio_profilo() to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid;
  g_ada uuid; g_carla uuid;
  aperto uuid;
  stato text; quante int; nome text; lat double precision;
  casa_lat constant double precision := 45.4642;
  casa_lon constant double precision := 9.1900;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c22.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c22.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c22.it', '{"display_name":"Carla"}') returning id into carla;

  perform set_config('test.uid', ada::text, true);
  g_ada := (public.create_group('Comitiva C22')).id;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group((select code from public.groups where id = g_ada));
  perform set_config('test.uid', carla::text, true);
  g_carla := (public.create_group('Altra comitiva C22')).id;

  -- Ada ha segnato la sua zona (cioe' casa sua) ed e' stata sospesa con un motivo scritto.
  -- Uid nullo: e' la strada del SQL editor, l'unica da cui `profiles_protect_sospeso`
  -- lascia passare un cambio di stato senza essere gia' amministratori (vedi 012).
  perform set_config('test.uid', '', true);
  update public.profiles
     set zona_lat = casa_lat, zona_lon = casa_lon, zona_nome = 'Casa',
         sospeso = true, sospeso_motivo = 'Segnalata due volte'
   where id = ada;

  -- Un passaggio pubblico: da 014 basta questo perche' il profilo di chi guida diventi
  -- leggibile anche a Carla, che non e' della comitiva. E' la strada piu' larga.
  insert into public.rides (driver_id, ride_date, destination, seats, group_id, origin, visibilita)
    values (ada, current_date, 'Mare', 4, g_ada, 'Milano', 'pubblico') returning id into aperto;

  set local role authenticated;

  -- ===== 1. Il proprio profilo si legge tutto, e da una funzione sola =====
  perform set_config('test.uid', ada::text, true);
  select zona_nome, zona_lat into nome, lat from public.mio_profilo();
  if nome is distinct from 'Casa' or lat is distinct from casa_lat then
    raise exception 'Ada non legge piu'' la propria zona: la restrizione ha preso troppo';
  end if;
  if (select sospeso_motivo from public.mio_profilo()) is null then
    raise exception 'Chi e'' sospeso non legge piu'' il perche'', e in pagina resta un banner muto';
  end if;

  -- ===== 2. Chi condivide la comitiva NON legge la zona =====
  perform set_config('test.uid', bruno::text, true);
  if (select display_name from public.profiles where id = ada) is null then
    raise exception 'Il test non prova niente: Bruno non vede nemmeno il nome di Ada';
  end if;
  stato := null;
  begin
    select zona_lat into lat from public.profiles where id = ada;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA GRAVE: zona_lat si legge lo stesso, il permesso per colonna non c''e''';
  end if;
  if stato <> '42501' then
    raise exception 'Fermata da % invece che dal permesso', stato;
  end if;

  -- ===== 3. `select *` sui profili non funziona piu', ed e' voluto =====
  -- E' il motivo per cui il client nomina le colonne anche qui: se questo controllo
  -- diventa verde, il payload e' tornato quello di prima e le coordinate ci sono dentro.
  stato := null;
  begin
    execute 'select * from public.profiles where id = $1' using ada;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: `select *` su profiles passa ancora, quindi la zona viaggia con la riga';
  end if;

  -- ===== 4. E nemmeno il motivo della sospensione, che e' cosa fra due persone =====
  stato := null;
  begin
    select sospeso_motivo into nome from public.profiles where id = ada;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: la comitiva legge il motivo della sospensione di Ada';
  end if;
  -- ...ma lo *stato* si', perche' l'amministratore lo mostra accanto alla segnalazione
  if (select sospeso from public.profiles where id = ada) is not true then
    raise exception 'Lo stato di sospensione non si legge piu'': la restrizione ha preso troppo';
  end if;

  -- ===== 5. L'estraneo che vede il passaggio pubblico: il nome si', la zona no =====
  perform set_config('test.uid', carla::text, true);
  if not exists (select 1 from public.rides where id = aperto) then
    raise exception 'Il test non prova niente: Carla non vede nemmeno il passaggio pubblico';
  end if;
  if (select display_name from public.profiles where id = ada) is null then
    raise exception 'Il test non prova niente: Carla non legge il nome di chi guida';
  end if;
  stato := null;
  begin
    select zona_lon into lat from public.profiles where id = ada;
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA GRAVE: chi vede un passaggio pubblico si prende le coordinate di casa di chi guida';
  end if;

  -- ===== 6. `mio_profilo()` sa rispondere di una persona sola =====
  -- Carla la chiama e riceve la propria riga, non quella di Ada: la funzione e' security
  -- definer, quindi il filtro dentro e' l'unica cosa che la tiene onesta.
  select count(*) into quante from public.mio_profilo();
  if quante <> 1 then
    raise exception 'mio_profilo() torna % righe invece di una', quante;
  end if;
  if (select display_name from public.mio_profilo()) <> 'Carla' then
    raise exception 'FALLA GRAVE: mio_profilo() torna il profilo di qualcun altro';
  end if;
  if (select zona_lat from public.mio_profilo()) is not null then
    raise exception 'FALLA GRAVE: mio_profilo() porta fuori la zona di un''altra persona';
  end if;

  -- ===== 7. La funzione che tocca i privilegi non e' roba da client =====
  stato := null;
  begin
    perform public.blinda_profilo();
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: blinda_profilo() e'' chiamabile con una chiave pubblica';
  end if;

  raise notice 'Zona riservata (C22): tutti i controlli passati.';
end $$;

reset role;
