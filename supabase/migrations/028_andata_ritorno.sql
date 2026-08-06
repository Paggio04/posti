-- 028 — «7:40 casa → universita', 13:30 universita' → casa» e' un viaggio, non due.
--
-- Cantiere C31 di docs/ROADMAP.md. Un passaggio e' di sola andata, e il viaggio vero
-- quasi sempre e' A/R: in `rides` non esiste **nessun legame fra due righe**, quindi chi
-- prende il posto all'andata non sa se ha anche il ritorno, e chi guida ripubblica tutto
-- da capo.
--
-- ── Due regole di 004 dicevano di no, e non era una svista ─────────────────
--
-- Scrivendo la colonna si scopre che il legame **da solo non basta**: due vincoli di
-- integrita' rendevano il caso impossibile, e sono nati giusti quando un passaggio era
-- di sola andata.
--
-- **1. `rides_one_per_day`** — un'auto per guidatore, per giorno, per comitiva. Un A/R
-- sono due righe nello stesso giorno dello stesso guidatore: l'indice le rifiuta. Non si
-- toglie, si **precisa**: al massimo un'andata e al massimo un ritorno. Il discriminante
-- e' `(ritorno_di is not null)`, cioe' la cosa che distingue davvero le due righe, e con
-- lui l'indice continua a fare il suo mestiere — pubblicare due andate resta impossibile.
--
-- **2. `check_claim`, «hai gia' un posto su un'altra auto per quel giorno»** — che e'
-- esattamente cio' che si vuole fare quando si prende andata **e** ritorno. Il divieto
-- resta per due auto qualsiasi e cade **solo** fra le due meta' di una coppia. Senza
-- questo, «prenotare l'una propone l'altra» sarebbe una proposta che il database
-- rifiuta: un invito a sbattere contro un errore.
--
-- ── Perche' il legame va dal ritorno all'andata, e non viceversa ───────────
-- Il ritorno non esiste senza l'andata, mentre l'andata da sola e' un passaggio
-- completo — e' il caso normale, ed e' quello che resta se la coppia si rompe. Con la
-- colonna sull'andata («qual e' il mio ritorno») ogni passaggio di sola andata avrebbe
-- portato in giro una colonna nulla per dire una cosa che gia' si sa.
-- `on delete set null`, non `cascade`: annullata l'andata, il ritorno **resta** — chi
-- torna a casa alle 13:30 ha ancora bisogno di tornare a casa.

alter table public.rides
  add column if not exists ritorno_di uuid references public.rides(id) on delete set null;

alter table public.rides drop constraint if exists rides_ritorno_non_se_stesso;
alter table public.rides add constraint rides_ritorno_non_se_stesso
  check (ritorno_di is null or ritorno_di <> id);

create index if not exists rides_ritorno_di_idx on public.rides (ritorno_di);

-- La regola della 025: una colonna in piu' su `rides` e' un cambiamento a due tabelle,
-- perche' la 010 archivia con `insert ... select *`.
do $$
begin
  if to_regclass('public.rides_archivio_senza_gruppo') is not null then
    alter table public.rides_archivio_senza_gruppo add column if not exists ritorno_di uuid;
  end if;
end $$;

-- ── 1. L'indice di 004, precisato ──────────────────────────────────────────
drop index if exists public.rides_one_per_day;
create unique index if not exists rides_one_per_day
  on public.rides (driver_id, ride_date,
                   coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid),
                   (ritorno_di is not null));

-- ── 2. `check_claim`, con l'unica eccezione che serve ──────────────────────
-- Si riscrive per intero perche' una funzione non si modifica a pezzi, e la base e'
-- **quella della 016, non quella della 004**: la 016 aveva dovuto togliere il
-- `select * into r` perche' un riferimento a riga intera pretende il privilegio su
-- tutta la tabella, e con le coordinate ristrette per colonna prenotare un posto
-- falliva con «permission denied for table rides» per chiunque e su ogni auto.
-- Ripartire dal file piu' vecchio riporta indietro quel difetto senza accorgersene,
-- ed e' successo scrivendo questa migrazione: l'ha ripreso `verifica-coordinate.sql`.
-- Le colonne si nominano, `ritorno_di` compresa.
create or replace function public.check_claim() returns trigger
language plpgsql as $$
declare
  r_id uuid;
  r_data date;
  r_ora time;
  r_posti int;
  r_driver uuid;
  r_gruppo uuid;
  r_ritorno_di uuid;
begin
  select id, ride_date, depart_time, seats, driver_id, group_id, ritorno_di
    into r_id, r_data, r_ora, r_posti, r_driver, r_gruppo, r_ritorno_di
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
      -- C31: l'altra auto puo' essere l'altra meta' di questo viaggio. Il divieto
      -- resta per due auto qualsiasi; qui e' andata e ritorno, cioe' un viaggio solo.
      and r2.id is distinct from r_ritorno_di
      and r_id is distinct from r2.ritorno_di
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno.';
  end if;
  return new;
end; $$;

-- ── E il permesso per colonna va ricalcolato, o la colonna nasce invisibile ──
-- La 016 non concede `select` sulla tabella: lo concede **colonna per colonna**, e
-- calcola l'elenco dal catalogo nel momento in cui gira. Una colonna aggiunta dopo di
-- lei non e' in quell'elenco, quindi il client la chiede e si prende un 42501 — cioe'
-- la Home in errore, per tutti, appena pubblicato.
--
-- Non e' teoria: senza questa riga, dopo **una** passata delle migrazioni
-- `has_column_privilege('authenticated', 'rides', 'ritardo_min', 'select')` risponde
-- `false`. In CI non si vedeva perche' le migrazioni girano due volte e la seconda
-- passata di 016 rimedia — ma una passata sola e' esattamente cio' che succede in
-- produzione. Ora c'e' anche un controllo apposta, subito dopo la prima passata.
select public.blinda_coordinate();

insert into public.schema_migrations (version) values ('028_andata_ritorno') on conflict do nothing;
