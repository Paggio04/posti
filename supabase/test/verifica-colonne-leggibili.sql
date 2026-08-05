-- Ogni colonna di `rides` che non sia una coordinata resta leggibile dal client.
-- Gira su un Postgres di prova **dopo la prima passata delle migrazioni**, e prima di
-- qualsiasi altra verifica.
--
-- ── A cosa serve, e perche' la posizione e' tutto ───────────────────────────
--
-- Dalla 016 `rides` non concede piu' `select` sulla tabella: lo concede **colonna per
-- colonna**, con l'elenco calcolato dal catalogo nel momento in cui `blinda_coordinate()`
-- gira. Una migrazione successiva che aggiunge una colonna e non richiama quella funzione
-- lascia la colonna fuori dall'elenco: il client la chiede, si prende un `42501`, e la
-- Home va in errore **per tutti**, appena pubblicato.
--
-- **In CI non si vedeva**, ed e' il motivo per cui questo file esiste. Le migrazioni
-- girano due volte di fila per verificare che siano ripetibili, e la seconda passata di
-- 016 ricalcola l'elenco rimediando al difetto della prima. In produzione invece si
-- applica **una** volta. Il controllo che gira solo dopo due passate non stava misurando
-- lo stato che gli utenti avrebbero visto.
--
-- Trovato scrivendo la 027 (C30) e la 028 (C31), che aggiungono tre colonne a `rides`:
-- dopo una passata sola, `ritardo_min`, `ritardo_alle` e `ritorno_di` erano invisibili
-- ad `authenticated`. Le due migrazioni ora chiamano `blinda_coordinate()` in fondo.
--
-- **Va messo fra la prima e la seconda passata**, e non altrove: dopo la seconda e'
-- sempre verde, e dopo gli altri file di verifica lo e' ancora di piu' — quelli fanno
-- `grant all on all tables`, che concede il privilegio sulla tabella intera e rende vera
-- qualsiasi domanda sulle colonne.
--
-- Provato al contrario: togliendo `select public.blinda_coordinate();` dalla 027, questo
-- file diventa rosso nominando `ritardo_min`.

do $$
declare
  mancante text;
  quante int := 0;
begin
  for mancante in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      -- Le quattro coordinate sono fuori **di proposito**: e' esattamente cio' che la
      -- 016 toglie. Un elenco che le comprendesse trasformerebbe questo controllo nel
      -- contrario di se stesso.
      and column_name not in ('origin_lat', 'origin_lon', 'dest_lat', 'dest_lon')
      and not has_column_privilege('authenticated', 'public.rides', column_name, 'select')
    order by ordinal_position
  loop
    raise exception
      'La colonna `rides.%` non e'' leggibile da `authenticated`: la migrazione che l''ha aggiunta deve chiudere con `select public.blinda_coordinate();`, altrimenti il client si prende un 42501 e la Home va in errore.',
      mancante;
  end loop;

  -- E il contrario: le coordinate devono essere ancora chiuse. Se qualcuno "risolvesse"
  -- il problema con un `grant select on public.rides`, il controllo qui sopra
  -- diventerebbe verde e C21 sarebbe annullato in silenzio.
  select count(*) into quante
  from unnest(array['origin_lat', 'origin_lon', 'dest_lat', 'dest_lon']) as c
  where has_column_privilege('authenticated', 'public.rides', c, 'select');
  if quante > 0 then
    raise exception
      'FALLA: % delle quattro coordinate di `rides` sono tornate leggibili dal client. E'' C21, riaperto.', quante;
  end if;

  raise notice 'Colonne di `rides`: tutte leggibili tranne le coordinate, che restano chiuse.';
end $$;
