-- 019 — Le colonne della zona spariscono dal profilo servito agli altri.
--
-- Secondo file di C22. La 018 ha dato il modo di leggere il **proprio** profilo intero;
-- qui si toglie la strada vecchia, quella per cui le coordinate di casa uscivano dentro la
-- riga di chiunque potesse leggere quel profilo.
--
-- **Ordine di applicazione: dopo aver pubblicato il codice**, non prima. Questo file toglie
-- letture che il codice vecchio fa (`ensureProfile` chiede `zona_lat`, l'esportazione fa
-- `select('*')` sul proprio profilo): applicarlo prima vorrebbe dire un'app che non parte,
-- fino al deploy. Stessa regola della 011 e della 016 → supabase/README.md.
--
-- Cosa **non** entra nella restrizione, e perche':
--   * `display_name` e `avatar_url` sono il motivo per cui i profili si leggono;
--   * `is_admin` dice chi modera, e non e' un fatto privato di nessuno;
--   * `sospeso` resta leggibile perche' l'interfaccia dell'amministratore lo mostra
--     accanto alla segnalazione. E' lo stato, non la sua motivazione.

-- Il permesso si ricalcola invece di essere scritto a mano, come in `blinda_coordinate()`:
-- le colonne di `profiles` sono cambiate tre volte (avatar in 001, sospensione in 012,
-- zona in 014) e un elenco fisso qui dentro vorrebbe dire una colonna nuova che nasce
-- invisibile all'app senza che nessuno lo abbia deciso.
create or replace function public.blinda_profilo() returns void
language plpgsql security definer set search_path = public as $$
declare
  colonne text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into colonne
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name not in ('zona_lat', 'zona_lon', 'zona_nome', 'sospeso_motivo');

  -- Prima si toglie il privilegio sulla tabella intera: finche' c'e' quello, un permesso
  -- per colonna non restringe niente. Poi si ridanno le colonne una per una.
  revoke select on public.profiles from authenticated, anon;
  execute format('grant select (%s) on public.profiles to authenticated, anon', colonne);
end; $$;

-- Come la gemella di 016: e' una funzione che tocca i privilegi, non roba da client.
revoke execute on function public.blinda_profilo() from public, anon, authenticated;

select public.blinda_profilo();

-- Chi scrive resta chi scriveva: `update` non e' toccato, quindi "Sono qui" e "Togli la
-- zona" continuano a funzionare, e l'amministratore continua a poter scrivere il motivo
-- della sospensione. Si perde solo il diritto di **leggere** quelle quattro colonne dalla
-- riga di qualcun altro — e la propria si legge da `mio_profilo()` (018).

insert into public.schema_migrations (version) values ('019_zona_riservata') on conflict do nothing;
