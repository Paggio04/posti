-- Verifica del cantiere C24 (034): i codici invito non si indovinano piu'.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **I tre rimedi si verificano separatamente**, perche' si possono rompere uno alla
-- volta e il primo nasconde gli altri due: con 852 miliardi di codici un limite di
-- tentativi rotto non si vede da nessuna parte.
--
-- Il controllo 6 e' quello che tiene onesti gli altri: chiudere e' facile, chiudere
-- senza rompere l'ingresso in comitiva no — e' la stessa forma del quarto controllo di
-- `verifica-permessi.sql`.
--
-- Provato al contrario: il test diventa rosso se si toglie una di queste cose.
--   * il `default` nuovo sulla colonna `code`             -> controllo 1
--   * la normalizzazione di `p_code`                      -> controllo 3
--   * il ramo unico dei due esiti negativi                -> controllo 4
--   * il conteggio, o il `return null` che lo fa restare  -> controllo 5
--   * la RLS senza policy su `tentativi_invito`           -> controllo 7

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all functions in schema public to authenticated;

do $$
declare
  ada uuid; bruno uuid; carla uuid; dora uuid;
  g uuid; chiusa uuid; vecchio uuid;
  codice text; codice_chiusa text;
  quante int; i int; ok boolean;
begin
  insert into auth.users (email, raw_user_meta_data) values ('ada@c24.it',   '{"display_name":"Ada"}')   returning id into ada;
  insert into auth.users (email, raw_user_meta_data) values ('bruno@c24.it', '{"display_name":"Bruno"}') returning id into bruno;
  insert into auth.users (email, raw_user_meta_data) values ('carla@c24.it', '{"display_name":"Carla"}') returning id into carla;
  insert into auth.users (email, raw_user_meta_data) values ('dora@c24.it',  '{"display_name":"Dora"}')  returning id into dora;

  perform set_config('test.uid', ada::text, true);
  g := (public.create_group('Comitiva C24')).id;
  select code into codice from groups where id = g;

  -- ===== 1. Il codice nuovo ha il formato nuovo =====
  -- Otto caratteri sull'alfabeto di Crockford meno la U: quello che si legge a voce al
  -- telefono senza far sbagliare chi scrive.
  if codice !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception '1 ROTTO: il codice generato e'' «%», non otto caratteri dell''alfabeto senza I L O 0 1', codice;
  end if;
  -- E non e' uguale per tutti: un default costante passerebbe il controllo qui sopra.
  if codice = (select code from groups where id = (public.create_group('Comitiva C24 bis')).id) then
    raise exception '1 ROTTO: due comitive create di fila hanno lo stesso codice';
  end if;
  raise notice '1 ok: il codice e'' di otto caratteri, senza i simboli che si confondono, e cambia ogni volta';

  -- ===== 2. I codici gia' distribuiti restano validi =====
  -- E' la meta' che rende questo rimedio economico: cambia il default della colonna, non
  -- le righe gia' scritte. Chi ha il suo codice esadecimale in un messaggio di due
  -- settimane fa deve entrare come prima.
  insert into groups (name, code, owner_id) values ('Comitiva vecchia', 'A1B2C3', ada) returning id into vecchio;
  insert into group_members (group_id, user_id) values (vecchio, ada);
  perform set_config('test.uid', bruno::text, true);
  if public.join_group('A1B2C3') is null then
    raise exception '2 ROTTO: un codice del formato vecchio non fa piu'' entrare';
  end if;
  raise notice '2 ok: un codice del formato vecchio continua a valere';

  -- ===== 3. Si accetta il codice come lo ricopia una persona =====
  -- Minuscole, spazi e trattini: chi legge un codice a voce lo scrive spezzato.
  perform set_config('test.uid', carla::text, true);
  if public.join_group(lower(substr(codice, 1, 4)) || '-' || lower(substr(codice, 5, 4))) is null then
    raise exception '3 ROTTO: il codice scritto in minuscolo e col trattino non viene riconosciuto';
  end if;
  if not exists (select 1 from group_members where group_id = g and user_id = carla) then
    raise exception '3 ROTTO: l''ingresso non e'' stato registrato';
  end if;
  raise notice '3 ok: minuscole, spazi e trattini non fanno differenza';

  -- ===== 4. I due esiti negativi rispondono allo stesso modo =====
  -- E' il rimedio 2 di C24, ed e' l'unico che si misura confrontando **due** risposte:
  -- un codice che non esiste e un codice che esiste ma e' scaduto devono essere
  -- indistinguibili, altrimenti la differenza dice che quel codice esiste.
  perform set_config('test.uid', ada::text, true);
  chiusa := (public.create_group('Weekend finito', current_date + 1)).id;
  select code into codice_chiusa from groups where id = chiusa;
  update groups set scade_il = current_date - 1 where id = chiusa;

  perform set_config('test.uid', dora::text, true);
  if public.join_group(codice_chiusa) is not null then
    raise exception '4 ROTTO: si entra in una comitiva chiusa';
  end if;
  if public.join_group('ZZZZZZZZ') is not null then
    raise exception '4 ROTTO: un codice inesistente fa entrare da qualche parte';
  end if;
  if exists (select 1 from group_members where user_id = dora) then
    raise exception '4 ROTTO: un tentativo fallito ha registrato un ingresso';
  end if;
  raise notice '4 ok: codice inesistente e comitiva chiusa danno la stessa risposta vuota';

  -- ===== 5. Il limite di tentativi c'e', e conta davvero =====
  -- **Qui sta la trappola di C24, e il controllo esiste per lei.** Un `raise exception`
  -- annulla la transazione e con lei il contatore: un limite scritto nel modo naturale
  -- resta a zero per sempre e sembra funzionare a ogni prova a mano. Il conteggio si
  -- misura quindi guardando la riga, non l'errore.
  -- Dora ha gia' due tentativi falliti dal controllo 4: gliene restano otto.
  if (select tentativi from tentativi_invito where user_id = dora) <> 2 then
    raise exception '5 ROTTO: dopo due tentativi falliti il contatore segna % invece di 2',
      (select tentativi from tentativi_invito where user_id = dora);
  end if;
  for i in 3..10 loop
    if public.join_group('ZZZZZZZZ') is not null then
      raise exception '5 ROTTO: un codice inesistente ha fatto entrare al tentativo %', i;
    end if;
  end loop;
  ok := false;
  begin
    perform public.join_group('ZZZZZZZZ');
  exception when others then
    ok := true;
    if sqlerrm not like '%Troppi tentativi%' then
      raise exception '5 ROTTO: l''undicesimo tentativo risponde «%» invece di fermarsi', sqlerrm;
    end if;
  end;
  if not ok then
    raise exception '5 ROTTO: l''undicesimo tentativo sbagliato in un''ora passa lo stesso';
  end if;
  -- E il blocco vale anche per un codice **giusto**: e' un limite su chi chiama, non
  -- sul codice, altrimenti basterebbe indovinare per uscirne.
  ok := false;
  begin
    perform public.join_group(codice);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception '5 ROTTO: da bloccata si entra lo stesso, con un codice giusto';
  end if;
  raise notice '5 ok: dieci tentativi sbagliati l''ora, e l''undicesimo si ferma';

  -- ===== 6. La finestra scade, e un ingresso riuscito azzera il conto =====
  -- Il rovescio del 5, e senza di lui il limite sarebbe una porta chiusa a chiave: chi
  -- ha sbagliato dieci volte deve poter rientrare, e chi entra non si porta dietro i
  -- tentativi di prima. `now()` non si muove dentro una transazione, quindi la finestra
  -- si fa invecchiare a mano invece di aspettare un'ora.
  update tentativi_invito set finestra_da = now() - interval '2 hours' where user_id = dora;
  if public.join_group(codice) is null then
    raise exception '6 ROTTO: passata l''ora non si rientra';
  end if;
  if (select tentativi from tentativi_invito where user_id = dora) <> 0 then
    raise exception '6 ROTTO: dopo un ingresso riuscito il contatore segna % invece di 0',
      (select tentativi from tentativi_invito where user_id = dora);
  end if;
  raise notice '6 ok: la finestra scade da sola e l''ingresso riuscito azzera il conto';

  -- ===== 7. Il contatore non si legge dal client =====
  -- Sapere quanti tentativi ha fatto qualcun altro non serve a nessuno, e il modo di
  -- non dirlo e' quello dell'archivio della 010: RLS accesa e nessuna policy.
  set local role authenticated;
  perform set_config('test.uid', dora::text, true);
  select count(*) into quante from tentativi_invito;
  if quante <> 0 then
    raise exception '7 ROTTO: dal client si leggono % righe di tentativi_invito', quante;
  end if;
  reset role;
  raise notice '7 ok: la tabella dei tentativi non esce dal database';

  raise notice 'Codici invito (C24): tutti i controlli passati.';
end $$;

reset role;
