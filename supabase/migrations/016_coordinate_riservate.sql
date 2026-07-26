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

insert into public.schema_migrations (version) values ('016_coordinate_riservate') on conflict do nothing;
