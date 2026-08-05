-- Ogni funzione di `public` dichiara chi puo' chiamarla.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **A cosa serve.** In Postgres una funzione nasce eseguibile da chiunque (`grant execute
-- to public` e' il default, e non lo si vede scritto da nessuna parte): e' il difetto di
-- C23, che era largo proprio perche' nessuno guardava lo **stato vero** dei permessi. Da
-- qui in poi la ventiduesima funzione — quella che arrivera' con la prossima migrazione —
-- non passa se nessuno ha scritto a chi serve.
--
-- **Cosa NON fa.** Non stringe niente e non e' una migrazione: registra l'intenzione com'e'
-- oggi. Restringere davvero le ventuno funzioni ancora aperte ad `anon` e' una decisione,
-- non un controllo.
--
-- **Dove va nella CI.** Subito dopo le migrazioni e **prima** degli altri file di verifica:
-- `verifica-sicurezza.sql`, `verifica-zona.sql`, `verifica-permessi.sql` e gli altri fanno
-- `grant all on all functions in schema public to authenticated` per poter lavorare. Messo
-- dopo di loro, questo controllo leggerebbe i permessi del test invece di quelli lasciati
-- dalle migrazioni. **Provato, e il modo di sbagliare non e' quello che sembra**: spostato
-- in fondo il controllo diventa ROSSO, non verde -- il `grant all` apre piu' di quanto le
-- migrazioni dichiarano, quindi il primo scarto e' `accoda_notifica(...): atteso nessuno,
-- trovato authenticated`. Un rosso che non parla di un difetto vero e' rumore, e insegna a
-- ignorare il controllo: e' per questo che la posizione conta.
--
-- **Perche' i permessi si leggono dal catalogo e non dai file.** Un controllo testuale
-- («dopo un `create function` deve venire un `revoke`») si aggira senza volerlo — un
-- `create or replace` su piu' righe, una funzione creata dentro un `do $$` — e direbbe una
-- cosa sul file invece che sul database.
--
-- **Perche' ventuno funzioni restano aperte ad `anon`, ed e' voluto.** Sono di due specie:
--   * funzioni di **trigger** (`check_claim`, `check_ride`, `controlla_persone`,
--     `controlla_sospeso`, `handle_new_user`, `notifica_posto_prenotato`,
--     `promote_waitlist`, `protect_admin_flag`, `protect_sospeso`): chiamate a mano
--     rispondono `0A000 "trigger functions can only be called as triggers"` e non fanno
--     niente;
--   * funzioni ancorate ad **`auth.uid()`** (`is_member`, `condivide_gruppo`,
--     `si_bloccano`, `mi_ha_bloccato`, `sono_sospeso`, `ho_un_posto`, `passaggio_visibile`,
--     `coordinate_visibili`, `is_admin`, `raggio_zona_km`, `distanza_km`,
--     `coordinate_passaggi`): con `anon` l'uid e' nullo e rispondono `false` o vuoto.
--     `coordinate_passaggi(ids)` compresa, perche' filtra per `coordinate_visibili(r.id)`,
--     che e' ancorata a sua volta. Sono anche dentro le policy, e una policy chiama la
--     funzione con i permessi di chi interroga: togliergliela spegnerebbe la lettura.
--
-- **Provato al contrario** (le prove stanno nel piano di questa fase, e si rifanno cosi'):
--   * `create function public.funzione_di_prova() returns int language sql as $$ select 1 $$;`
--     -> controllo 1, messaggio con `funzione_di_prova` e la parola «dichiara»;
--   * `grant execute on function public.sospeso(uuid) to anon;`
--     -> controllo 3, messaggio con atteso `nessuno` e trovato `anon`;
--   * togliendo una riga dall'elenco atteso -> controllo 1; aggiungendone una finta ->
--     controllo 2.

do $$
declare
  scarto record;
  n_dichiarate int;
  n_trovate int;
begin
  -- I due ruoli devono esistere: senza, `has_function_privilege` alzerebbe un errore
  -- oscuro e il controllo sembrerebbe rotto invece che mal preparato.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'Manca il ruolo `anon`: applica prima supabase/test/stub-supabase.sql';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'Manca il ruolo `authenticated`: applica prima supabase/test/stub-supabase.sql';
  end if;

  create temp table atteso_acl (nome text, argomenti text, chi text) on commit drop;

  -- L'elenco atteso. `chi` vale:
  --   nessuno       ne' `anon` ne' `authenticated` possono chiamarla
  --   authenticated solo chi ha fatto l'accesso
  --   anon          chiunque, cioe' il `public` di Postgres (e quindi anche authenticated)
  insert into atteso_acl (nome, argomenti, chi) values

  -- --- Nessuno: interne, oppure rispondono su persone scelte da chi chiama (020) ---
  ('crea_passaggi_ricorrenti',   'giorni_avanti integer', 'nessuno'),   -- 024, la chiama pg_cron
  ('registra_evento_ride',       '',                    'nessuno'),   -- 023, li chiamano i trigger
  ('registra_evento_posto',      '',                    'nessuno'),
  ('registra_evento_membro',     '',                    'nessuno'),
  ('registra_evento_pagamento',  '',                    'nessuno'),
  ('accoda_notifica',            'p_destinatario uuid, p_tipo text, p_ride uuid, p_titolo text, p_corpo text, p_chiave text', 'nessuno'),
  ('accoda_partenze_imminenti',  '',                    'nessuno'),
  ('notifica_annullamento',      '',                    'nessuno'),   -- 026, lo chiama il trigger
  ('notifica_ritardo',           '',                    'nessuno'),   -- 027, idem
  ('registra_fermate',           '',                    'nessuno'),   -- 029, idem
  ('blinda_coordinate',          '',                    'nessuno'),
  ('blinda_funzioni',            '',                    'nessuno'),
  ('blinda_profilo',             '',                    'nessuno'),
  ('bloccati_fra',               'a uuid, b uuid',      'nessuno'),
  ('sospeso',                    'u uuid',              'nessuno'),

  -- --- Solo da autenticato: servono al client, ma dopo l'accesso (018, 020) ---
  ('saldo_con',                  'altro uuid',          'authenticated'),   -- 022, ancorata ad auth.uid()
  ('create_group',               'p_name text',         'authenticated'),
  ('elimina_account',            '',                    'authenticated'),
  ('join_group',                 'p_code text',         'authenticated'),
  ('mio_profilo',                '',                    'authenticated'),

  -- --- Aperte a chiunque, e voluto: trigger e funzioni ancorate ad auth.uid() ---
  -- Il perche', funzione per funzione, sta nell'intestazione di questo file.
  ('check_claim',                '',                    'anon'),
  ('chiave_fermata',             'nome text',           'anon'),   -- 029, puro testo: non legge niente
  ('check_ride',                 '',                    'anon'),
  ('condivide_gruppo',           'altro uuid',          'anon'),
  ('controlla_persone',          '',                    'anon'),
  ('controlla_sospeso',          '',                    'anon'),
  ('coordinate_passaggi',        'ids uuid[]',          'anon'),
  ('coordinate_visibili',        'auto uuid',           'anon'),
  ('distanza_km',                'lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision', 'anon'),
  ('handle_new_user',            '',                    'anon'),
  ('ho_un_posto',                'auto uuid',           'anon'),
  ('is_admin',                   '',                    'anon'),
  ('is_member',                  'g uuid',              'anon'),
  ('mi_ha_bloccato',             'altro uuid',          'anon'),
  ('notifica_posto_prenotato',   '',                    'anon'),
  ('passaggio_visibile',         'auto uuid',           'anon'),
  ('promote_waitlist',           '',                    'anon'),
  ('protect_admin_flag',         '',                    'anon'),
  ('protect_sospeso',            '',                    'anon'),
  ('raggio_zona_km',             '',                    'anon'),
  ('si_bloccano',                'altro uuid',          'anon'),
  ('sono_sospeso',               '',                    'anon');

  -- La realta', letta dal catalogo. `solo anon` non e' un valore dichiarabile: se compare
  -- e' un permesso storto (dato ad `anon` e non ad `authenticated`) e il controllo 3 lo
  -- fa notare invece di lasciarlo passare.
  create temp table trovato_acl on commit drop as
  select p.proname::text                                as nome,
         pg_get_function_identity_arguments(p.oid)      as argomenti,
         case
           when has_function_privilege('anon', p.oid, 'execute')
            and has_function_privilege('authenticated', p.oid, 'execute') then 'anon'
           when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated'
           when has_function_privilege('anon', p.oid, 'execute')          then 'solo anon'
           else 'nessuno'
         end                                            as chi
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';

  -- ===== 1. Una funzione esiste e non e' nell'elenco =====
  -- E' il controllo che chiude R1: una migrazione ha aggiunto una funzione senza dire a
  -- chi serve.
  for scarto in
    select t.nome, t.argomenti, t.chi from trovato_acl t
    where not exists (
      select 1 from atteso_acl a where a.nome = t.nome and a.argomenti = t.argomenti
    )
    order by t.nome, t.argomenti
  loop
    raise exception
      'La migrazione che ha aggiunto `%(%)` non dichiara chi puo'' chiamarla (oggi: %). Aggiungi la riga in supabase/test/verifica-acl-funzioni.sql e il revoke/grant nella migrazione.',
      scarto.nome, scarto.argomenti, scarto.chi;
  end loop;

  -- ===== 2. Una funzione e' nell'elenco e non esiste piu' =====
  for scarto in
    select a.nome, a.argomenti from atteso_acl a
    where not exists (
      select 1 from trovato_acl t where t.nome = a.nome and t.argomenti = a.argomenti
    )
    order by a.nome, a.argomenti
  loop
    raise exception
      '`%(%)` e'' dichiarata nell''elenco atteso ma non esiste piu'' nel database: l''elenco di supabase/test/verifica-acl-funzioni.sql va ripulito.',
      scarto.nome, scarto.argomenti;
  end loop;

  -- ===== 3. I permessi non sono quelli dichiarati =====
  for scarto in
    select a.nome, a.argomenti, a.chi as atteso, t.chi as trovato
    from atteso_acl a
    join trovato_acl t on t.nome = a.nome and t.argomenti = a.argomenti
    where a.chi <> t.chi
    order by a.nome, a.argomenti
  loop
    raise exception
      'I permessi di `%(%)` non sono quelli dichiarati: atteso `%`, trovato `%`.',
      scarto.nome, scarto.argomenti, scarto.atteso, scarto.trovato;
  end loop;

  select count(*) into n_dichiarate from atteso_acl;
  select count(*) into n_trovate    from trovato_acl;
  raise notice 'Permessi delle funzioni: % dichiarate, % trovate, nessuno scarto.', n_dichiarate, n_trovate;
end $$;
