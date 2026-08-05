-- 026 — «Il passaggio delle 7:40 e' stato annullato».
--
-- Cantiere C28 di docs/ROADMAP.md. E' l'unico difetto vero della Fase 7, non un
-- miglioramento: se chi guida cancella, oggi il passaggio sparisce e basta. Chi
-- aveva un posto lo scopre restando sul portone alle 7:40, che e' la conseguenza
-- piu' concreta di qualsiasi evento dell'app — piu' di un posto prenotato, piu'
-- di una partenza imminente, che sono i due che gia' notificano.
--
-- `eventi` (023) registra gia' `passaggio_annullato`, ma quel registro si legge
-- aprendo il riepilogo: e' la cronaca, non l'avviso.
--
-- ── Tre decisioni, e nessuna e' di gusto ───────────────────────────────────
--
-- **1. `ride_id` resta nullo, di proposito.** `notifiche_coda.ride_id` riferisce
-- `rides` con `on delete cascade`: una notifica che nomina il passaggio appena
-- cancellato verrebbe portata via dalla stessa cascata che l'ha generata, cioe'
-- non arriverebbe mai. E' lo stesso inciampo di 023 — un registro storico non
-- puo' avere chiavi esterne verso cio' che racconta — visto da un'altra
-- angolazione. Quello che serve sapere sta nel testo: giorno, ora, destinazione.
--
-- **2. Il trigger e' `before delete`.** Dopo, `seat_claims` e `ride_waitlist`
-- sono gia' sparite nella cascata e non ci sarebbe piu' nessuno da avvisare.
--
-- **3. Accodare non puo' far fallire una cancellazione.** Ogni chiamata sta
-- dentro il suo `begin/exception`, e un errore la salta invece di annullare
-- tutto. La ragione e' la lezione pagata in 023: cancellare l'account (013) e i
-- gruppi passa per una cascata che porta via anche i `rides`, e un inserimento
-- rifiutato li' dentro non manda a monte una notifica — manda a monte un
-- obbligo di legge. Una notifica persa e' un fastidio; una cancellazione
-- bloccata e' un difetto.

-- Il tipo nuovo. Il vincolo si riscrive per intero perche' in Postgres un check
-- non si estende: si toglie e si rimette, e questo file deve poter girare due
-- volte di fila (ADR 002).
alter table public.notifiche_coda drop constraint if exists notifiche_coda_tipo_check;
alter table public.notifiche_coda add constraint notifiche_coda_tipo_check
  check (tipo in ('posto_prenotato', 'posto_libero', 'partenza_vicina', 'passaggio_annullato'));

create or replace function public.notifica_annullamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  chi record;
  quando text;
  dove text;
  corpo text;
begin
  -- Un passaggio senza comitiva non esiste piu' da 010, ma i test ne ricostruiscono
  -- uno (`dati-prima-di-010.sql`): senza questa uscita il trigger girerebbe su una
  -- riga che nessuna comitiva possiede.
  if old.group_id is null then return old; end if;

  quando := to_char(old.ride_date, 'DD/MM')
    || case when old.depart_time is null then '' else ' alle ' || to_char(old.depart_time, 'HH24:MI') end;
  dove := coalesce(old.destination, 'il ritrovo');
  corpo := 'Il passaggio per ' || dove || ' del ' || quando || ' non c''e'' piu''.';

  -- Chi aveva un posto, e chi era in lista d'attesa: entrambi avevano fatto un
  -- piano su quell'auto. Chi era in lista lo sa anche perche' adesso non ha piu'
  -- senso aspettare.
  for chi in
    select passenger_id as utente from seat_claims where ride_id = old.id
    union
    select user_id      as utente from ride_waitlist where ride_id = old.id
  loop
    if chi.utente is null or chi.utente = old.driver_id then continue; end if;
    begin
      perform public.accoda_notifica(
        chi.utente, 'passaggio_annullato', null,
        'Passaggio annullato', corpo,
        'passaggio_annullato:' || old.id::text || ':' || chi.utente::text
      );
    exception when others then
      -- Vedi la decisione 3 in testa al file: si perde l'avviso, non la cancellazione.
      null;
    end;
  end loop;

  -- L'amministratore puo' cancellare l'auto di un altro (012). In quel caso chi
  -- guida e' fra le persone che scoprono la cosa restando sul portone, esattamente
  -- come i passeggeri. Se invece ha cancellato lui, sa gia' tutto.
  if auth.uid() is distinct from old.driver_id then
    begin
      perform public.accoda_notifica(
        old.driver_id, 'passaggio_annullato', null,
        'Il tuo passaggio e'' stato annullato', corpo,
        'passaggio_annullato:' || old.id::text || ':' || old.driver_id::text
      );
    exception when others then
      null;
    end;
  end if;

  return old;
end; $$;

drop trigger if exists rides_notifica_annullamento on public.rides;
create trigger rides_notifica_annullamento before delete on public.rides
  for each row execute function public.notifica_annullamento();

-- Un trigger, non una chiamata: come tutti gli altri di 017 e 023.
revoke execute on function public.notifica_annullamento() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('026_notifica_annullamento') on conflict do nothing;
