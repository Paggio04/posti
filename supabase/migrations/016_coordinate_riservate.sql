-- 016 — Le colonne delle coordinate spariscono dal payload.
--
-- Cantiere C21, secondo file. La 015 ha dato il modo di chiedere le coordinate a chi ne ha
-- diritto; qui si toglie la strada vecchia, quella che le faceva uscire da sole dentro la
-- riga. Da qui in poi `select *` su `rides` **non funziona piu'** per un client: e' voluto,
-- ed e' l'unico modo perche' il permesso per colonna faccia il suo mestiere.
--
-- **Ordine di applicazione: dopo aver pubblicato il codice**, non prima. Questo file
-- toglie una lettura che il codice vecchio fa (`select('*')` nella Home e
-- nell'esportazione): applicarlo prima vorrebbe dire una Home in errore fino al deploy.
-- E' la stessa regola della 011, all'incontrario delle 012-014 → supabase/README.md.

-- Il permesso si ricalcola invece di essere scritto a mano: le colonne di `rides` cambiano
-- (ne sono state aggiunte in 010 e in 014), e un elenco fisso qui dentro sarebbe una
-- colonna nuova che nasce invisibile all'app senza che nessuno lo abbia deciso.
--
-- Sta in una funzione e non in un `do` per due ragioni: la chiama la 016 stessa, e la
-- richiama il test dopo aver dato i permessi larghi che servono al resto delle verifiche.
create or replace function public.blinda_coordinate() returns void
language plpgsql security definer set search_path = public as $$
declare
  colonne text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into colonne
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rides'
    and column_name not in ('origin_lat', 'origin_lon', 'dest_lat', 'dest_lon');

  -- Prima si toglie il privilegio sulla tabella intera: finche' c'e' quello, un permesso
  -- per colonna non restringe niente. Poi si ridanno le colonne una per una.
  revoke select on public.rides from authenticated, anon;
  execute format('grant select (%s) on public.rides to authenticated, anon', colonne);
end; $$;

-- Non e' roba da client: e' una funzione che tocca i privilegi. Che tocchi solo questi non
-- e' un buon motivo per lasciarla chiamabile da chiunque abbia una anon key.
revoke execute on function public.blinda_coordinate() from public, anon, authenticated;

select public.blinda_coordinate();

-- `dest_lat` e `dest_lon` sono colonne morte — niente le scrive, perche' alla destinazione
-- non ci sei e un geocoder e' escluso da D6 — ma entrano lo stesso nella restrizione: il
-- giorno che qualcosa le riempira', saranno gia' dalla parte giusta.

-- ===== Il trigger che questa migrazione avrebbe rotto =====
--
-- `check_claim` faceva `select * into r from rides`, cioe' leggeva la **riga intera**, e in
-- Postgres un riferimento a riga intera pretende il privilegio sulla tabella tutta: non
-- basta avere quasi tutte le colonne. Il trigger non e' `security definer` — giustamente,
-- controlla l'integrita' con i permessi di chi scrive — quindi da questa migrazione in poi
-- **prenotare un posto sarebbe fallito** con "permission denied for table rides", per
-- chiunque e su ogni auto.
--
-- Non e' una supposizione: e' successo, e l'ha trovato `verifica-coordinate.sql` alla prima
-- passata in CI, prima che questa roba vedesse un utente vero. Qui il trigger viene
-- riscritto con le colonne nominate, che e' esattamente quello che si chiede al client.
-- Il corpo e le frasi degli errori restano quelli della 010: cambia solo come si legge.
create or replace function public.check_claim() returns trigger
language plpgsql as $$
declare
  r_id uuid;
  r_data date;
  r_ora time;
  r_posti int;
  r_driver uuid;
  r_gruppo uuid;
begin
  select id, ride_date, depart_time, seats, driver_id, group_id
    into r_id, r_data, r_ora, r_posti, r_driver, r_gruppo
  from public.rides where id = new.ride_id;

  if r_id is null then raise exception 'Viaggio inesistente.'; end if;
  if r_data < current_date then
    raise exception 'Questo viaggio è già passato.';
  end if;
  if r_data = (now() at time zone 'Europe/Rome')::date
     and r_ora is not null
     and r_ora <= (now() at time zone 'Europe/Rome')::time then
    raise exception 'Auto già partita: non si può più prenotare.';
  end if;
  if new.seat_index > r_posti then
    raise exception 'Posto non valido per questa auto.';
  end if;
  if new.passenger_id = r_driver then
    raise exception 'Guidi tu questa auto: sei già a bordo.';
  end if;
  if exists (
    select 1 from public.rides r2
    where r2.driver_id = new.passenger_id
      and r2.ride_date = r_data
      and r2.group_id = r_gruppo
  ) then
    raise exception 'Quel giorno guidi tu: non puoi prenotare un posto su un''altra auto.';
  end if;
  if exists (
    select 1 from public.seat_claims sc
    join public.rides r2 on r2.id = sc.ride_id
    where sc.passenger_id = new.passenger_id
      and sc.ride_id <> new.ride_id
      and r2.ride_date = r_data
      and r2.group_id = r_gruppo
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno.';
  end if;
  return new;
end; $$;

insert into public.schema_migrations (version) values ('016_coordinate_riservate') on conflict do nothing;
