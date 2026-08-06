-- 027 — «Sono in ritardo di cinque minuti».
--
-- Cantiere C30 di docs/ROADMAP.md. E' la cosa che nei passaggi veri si risolve con
-- dieci messaggi in chat, e che l'app non sapeva dire: chi aspetta al ritrovo non ha
-- modo di sapere se l'auto sta arrivando o se non arrivera' mai.
--
-- Due colonne e un trigger. **Non** una tabella di messaggi: un ritardo non e' una
-- conversazione, e' lo stato attuale di quel passaggio — c'e' un solo valore vero alla
-- volta, e sovrascriverlo e' esattamente il comportamento giusto.
--
-- ── Perche' la chiave della notifica contiene i minuti ─────────────────────
-- `notifiche_coda` e' unica per (destinatario, chiave), ed e' quello che impedisce a un
-- cron rilanciato di far vibrare due volte lo stesso telefono. Qui pero' il secondo
-- annuncio e' un fatto **nuovo**: «cinque» e poi «venti» sono due informazioni diverse,
-- e chi aspetta deve avere la seconda. Con la chiave ferma sul passaggio la seconda
-- sparirebbe in silenzio. Con i minuti dentro, cambiare il ritardo avvisa e **ridire lo
-- stesso ritardo no** — che e' la protezione che serviva davvero: il bottone si preme
-- due volte per sbaglio, il numero cambia solo se qualcuno lo cambia.

alter table public.rides
  add column if not exists ritardo_min  smallint,
  add column if not exists ritardo_alle timestamptz;

alter table public.rides drop constraint if exists rides_ritardo_sensato;
alter table public.rides add constraint rides_ritardo_sensato
  check (ritardo_min is null or ritardo_min between 1 and 180);

-- L'archivio della 010 si riempie con `insert ... select *`, quindi guadagna le stesse
-- colonne o al secondo giro delle migrazioni muore con «INSERT has more expressions than
-- target columns». La regola l'ha scritta la 025: **aggiungere una colonna a una tabella
-- archiviata con `select *` e' un cambiamento a due tabelle, non a una.**
do $$
begin
  if to_regclass('public.rides_archivio_senza_gruppo') is not null then
    alter table public.rides_archivio_senza_gruppo
      add column if not exists ritardo_min  smallint,
      add column if not exists ritardo_alle timestamptz;
  end if;
end $$;

-- Il tipo nuovo, riscrivendo il vincolo per intero: in Postgres un check non si estende.
alter table public.notifiche_coda drop constraint if exists notifiche_coda_tipo_check;
alter table public.notifiche_coda add constraint notifiche_coda_tipo_check
  check (tipo in ('posto_prenotato', 'posto_libero', 'partenza_vicina',
                  'passaggio_annullato', 'ritardo'));

create or replace function public.notifica_ritardo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
  corpo text;
begin
  -- Solo il passaggio da «niente» o da un altro numero a un numero: azzerare il ritardo
  -- («sono in orario dopotutto») non e' una cosa per cui valga la pena far vibrare un
  -- telefono, e chi aspetta lo vede sulla scheda.
  if new.ritardo_min is null or new.ritardo_min is not distinct from old.ritardo_min then
    return new;
  end if;

  corpo := 'Il passaggio per ' || coalesce(new.destination, 'il ritrovo')
    || ' parte con ' || new.ritardo_min || ' minuti di ritardo'
    || case when new.depart_time is null then '.'
            else ': verso le ' || to_char(new.depart_time + make_interval(mins => new.ritardo_min), 'HH24:MI') || '.' end;

  for p in select passenger_id from seat_claims where ride_id = new.id loop
    if p.passenger_id is null then continue; end if;
    perform public.accoda_notifica(
      p.passenger_id, 'ritardo', new.id,
      'Chi guida e'' in ritardo', corpo,
      'ritardo:' || new.id::text || ':' || p.passenger_id::text || ':' || new.ritardo_min::text
    );
  end loop;
  return new;
end; $$;

drop trigger if exists rides_notifica_ritardo on public.rides;
create trigger rides_notifica_ritardo after update of ritardo_min on public.rides
  for each row execute function public.notifica_ritardo();

revoke execute on function public.notifica_ritardo() from public, anon, authenticated;

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

insert into public.schema_migrations (version) values ('027_ritardo') on conflict do nothing;
