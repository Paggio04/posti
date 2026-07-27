-- Verifica della migrazione 020: le funzioni interne non si chiamano da un client.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- Provato al contrario: togliendo una qualsiasi delle righe di `blinda_funzioni()` il
-- controllo corrispondente diventa rosso.
--   * la revoca su `bloccati_fra`  -> controllo 1
--   * la revoca su `sospeso(uuid)` -> controllo 2
--   * la revoca su `join_group`    -> controllo 3
--   * il grant ad authenticated    -> controllo 4, che e' quello che tiene onesti gli altri
--     tre: chiudere e basta si fa in un attimo, chiudere senza rompere l'app no.
--
-- Va in fondo alla CI insieme agli altri due "richiudi e verifica": i test precedenti
-- aprono i permessi con `grant all on all functions`, e qui si rimettono con la stessa
-- funzione che usa la migrazione.

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

select public.blinda_funzioni();
revoke execute on function public.blinda_funzioni() from authenticated, anon;

do $$
declare
  ada uuid; bruno uuid;
  g uuid; codice text;
  stato text; esito boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@perm.it', '{"display_name":"Ada"}') returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@perm.it', '{"display_name":"Bruno"}') returning id into bruno;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva permessi')).id;
  select code into codice from public.groups where id = g;
  insert into public.user_blocks (blocker_id, blocked_id) values (ada, bruno);

  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);

  -- ===== 1. "Quelle due persone si sono bloccate?" non e' una domanda da client =====
  stato := null;
  begin
    esito := public.bloccati_fra(ada, bruno);
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: bloccati_fra() risponde a chiunque su due persone qualsiasi';
  end if;
  if stato <> '42501' then
    raise exception 'Fermata da % invece che dal permesso', stato;
  end if;

  -- ...ma la propria domanda resta: `si_bloccano` e' ancorata ad auth.uid() e serve alle
  -- policy. Se sparisse anche questa, la lettura dei commenti si spegnerebbe.
  if public.si_bloccano(ada) is not true then
    raise exception 'si_bloccano() non risponde piu'': la restrizione ha preso troppo';
  end if;

  -- ===== 2. Nemmeno "quella persona e' sospesa?" =====
  stato := null;
  begin
    esito := public.sospeso(ada);
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA: sospeso() dice a chiunque lo stato di moderazione di chiunque';
  end if;
  if public.sono_sospeso() is not false then
    raise exception 'sono_sospeso() non risponde piu'': le policy di scrittura si spengono';
  end if;

  -- ===== 3. Senza account non si prova nemmeno un codice invito =====
  -- E' il punto: entrare non ci riusciva comunque, ma il messaggio d'errore diceva se il
  -- codice esiste, e quello basta a cercarli uno per uno.
  set local role anon;
  stato := null;
  begin
    perform public.join_group(codice);
  exception when others then stato := sqlstate; end;
  if stato is null then
    raise exception 'FALLA GRAVE: join_group() si chiama senza account';
  end if;
  if stato <> '42501' then
    raise exception 'FALLA: senza account join_group() risponde % — cioe'' dice se il codice esiste', stato;
  end if;

  stato := null;
  begin
    perform public.create_group('Comitiva di nessuno');
  exception when others then stato := sqlstate; end;
  if stato <> '42501' then
    raise exception 'FALLA: create_group() si chiama senza account (stato %)', stato;
  end if;

  -- ===== 4. Con un account, invece, si entra come sempre =====
  set local role authenticated;
  perform set_config('test.uid', bruno::text, true);
  perform public.join_group(codice);
  if not exists (select 1 from public.group_members where group_id = g and user_id = bruno) then
    raise exception 'Bruno non e'' entrato: la restrizione ha rotto l''ingresso in comitiva';
  end if;
  if (public.create_group('Comitiva di Bruno')).id is null then
    raise exception 'Un utente autenticato non riesce piu'' a creare una comitiva';
  end if;

  raise notice 'Permessi delle funzioni (020): tutti i controlli passati.';
end $$;

reset role;
