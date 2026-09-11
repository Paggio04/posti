-- 035 — La RLS accesa di serie: l'unico pezzo di schema che viveva solo in produzione.
--
-- Voce W9 della roadmap del vault, e non e' un difetto di sicurezza: e' un difetto di
-- **ricostruibilita'**, che e' la promessa su cui poggia tutto il resto. Il confronto
-- del 26/07/2026 fra il database vivo e `supabase/migrations/` tornava su tutto — 16
-- tabelle, 9 trigger, 4 tabelle in realtime — con una sola eccezione: in produzione
-- esistono la funzione `rls_auto_enable()` e l'event trigger `ensure_rls`, che accendono
-- la Row Level Security su ogni tabella nuova di `public`. Nessuna migrazione li crea.
--
-- Cosa vuol dire, detto per intero: **un backend ricostruito da zero non ce li ha**. Non
-- si nota, perche' le migrazioni accendono comunque la RLS a mano riga per riga — quindi
-- il database di prova della CI e quello vero si comportano uguale finche' nessuno
-- dimentica quella riga. Il giorno che la dimentica, la produzione lo perdona e la copia
-- ricostruita no: due sistemi che divergono proprio nel caso che conta.
--
-- «O una migrazione li dichiara, o non ci sono piu'.» Li dichiara.
--
-- ── Il filtro sullo schema, e perche' non e' una precauzione teorica ───────
-- Il trigger scatta su **ogni** `create table` della sessione, e i file di
-- `supabase/test/` ne creano parecchie temporanee (`atteso_acl`, `trovato_acl`).
-- Accendere la RLS su una tabella temporanea di un controllo vorrebbe dire farlo fallire
-- per un motivo che non c'entra niente. Si guarda quindi lo schema, non il nome.
--
-- ── Perche' l'`if` invece di un `create event trigger` secco ───────────────
-- Due ragioni, e sono diverse fra loro:
--   * `create event trigger` non ha un `if not exists`, e ogni migrazione qui dev'essere
--     ripetibile: la CI le applica **due volte** di fila apposta;
--   * creare un event trigger vuole i permessi di superutente. Sul progetto vero
--     `ensure_rls` c'e' gia' — questa migrazione lo trova e non tocca niente — ma se un
--     giorno la si applicasse su un progetto dove non c'e' e il ruolo non basta, meglio
--     un avviso che dice cosa manca che una migrazione che muore a meta'.

create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.object_type = 'table' and cmd.schema_name = 'public' then
      execute format('alter table %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end; $$;

do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      create event trigger ensure_rls on ddl_command_end
        when tag in ('CREATE TABLE', 'CREATE TABLE AS')
        execute function public.rls_auto_enable();
    exception when insufficient_privilege then
      raise notice 'ensure_rls non creato: serve un ruolo superutente. La RLS resta quella accesa a mano dalle migrazioni.';
    end;
  end if;
end $$;

insert into public.schema_migrations (version) values ('035_rls_di_serie') on conflict do nothing;
