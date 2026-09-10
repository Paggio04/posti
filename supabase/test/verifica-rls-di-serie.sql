-- Verifica della 035: una tabella nuova di `public` nasce con la RLS accesa.
-- Gira su un Postgres di prova, dopo stub-supabase.sql e tutte le migrazioni.
--
-- **Esiste perche' senza di lui la 035 sarebbe dichiarata e mai eseguita.** Dopo la 035
-- nessuna migrazione crea piu' tabelle, quindi `rls_auto_enable()` non scatta mai in
-- CI: un corpo sbagliato — il filtro sullo schema storto, il `format` senza virgolette,
-- il tag mancante — passerebbe verde. E' la lezione di C45 nella sua forma piu' secca:
-- un controllo che compila non e' un controllo che misura.
--
-- Provato al contrario: togliendo l'event trigger dalla 035 il controllo 1 diventa
-- rosso; togliendo il filtro `schema_name = 'public'` diventa rosso il 2.

do $$
declare
  accesa boolean;
begin
  -- ===== 1. Una tabella di `public` nasce protetta =====
  create table public.prova_rls_di_serie (id int);
  select relrowsecurity into accesa from pg_class
   where oid = 'public.prova_rls_di_serie'::regclass;
  drop table public.prova_rls_di_serie;
  if not accesa then
    raise exception '1 ROTTO: una tabella nuova di public nasce senza RLS: `ensure_rls` non c''e'' o non fa il suo mestiere';
  end if;
  raise notice '1 ok: una tabella nuova di public nasce con la RLS accesa';

  -- ===== 2. Una temporanea resta fuori =====
  -- Meta' dei file di supabase/test/ ne crea: accendere la RLS su una tabella di
  -- servizio farebbe fallire un controllo per un motivo che non c'entra niente.
  create temp table prova_rls_temporanea (id int);
  select relrowsecurity into accesa from pg_class
   where relname = 'prova_rls_temporanea' and relpersistence = 't';
  drop table prova_rls_temporanea;
  if accesa then
    raise exception '2 ROTTO: la RLS si accende anche sulle tabelle temporanee dei controlli';
  end if;
  raise notice '2 ok: le tabelle temporanee restano fuori';

  raise notice 'RLS di serie (035): tutti i controlli passati.';
end $$;
