-- Dopo la 010: le righe senza comitiva devono essere sparite dalle tabelle vive
-- e ritrovarsi tutte nell'archivio. Niente deve essersi perso per strada, e i dati
-- che avevano un gruppo devono essere ancora al loro posto.
-- Si applica dopo dati-prima-di-010.sql e la migrazione 010.

do $$
declare n int;
begin
  -- ===== Le righe orfane non esistono piu' fra i dati vivi =====
  select count(*) into n from public.rides where group_id is null;
  if n <> 0 then raise exception 'Restano % auto senza comitiva', n; end if;
  select count(*) into n from public.ride_requests where group_id is null;
  if n <> 0 then raise exception 'Restano % richieste senza comitiva', n; end if;

  -- ===== ...ma sono nell'archivio, con tutto quello che ci stava attaccato =====
  select count(*) into n from public.rides_archivio_senza_gruppo;
  if n <> 1 then raise exception 'Archivio auto: attesa 1 riga, trovate %', n; end if;
  select count(*) into n from public.seat_claims_archivio_senza_gruppo;
  if n <> 1 then raise exception 'Archivio prenotazioni: attesa 1 riga, trovate %', n; end if;
  select count(*) into n from public.ride_comments_archivio_senza_gruppo;
  if n <> 1 then raise exception 'Archivio commenti: attesa 1 riga, trovate %', n; end if;
  select count(*) into n from public.ride_waitlist_archivio_senza_gruppo;
  if n <> 1 then raise exception 'Archivio lista d''attesa: attesa 1 riga, trovate %', n; end if;
  select count(*) into n from public.ride_requests_archivio_senza_gruppo;
  if n <> 1 then raise exception 'Archivio richieste: attesa 1 riga, trovate %', n; end if;

  -- ===== I dati con un gruppo sono intatti =====
  select count(*) into n from public.rides;
  if n <> 1 then raise exception 'L''auto del gruppo doveva restare: trovate % auto', n; end if;

  -- ===== L'archivio non e' leggibile dal client =====
  -- Con RLS attiva e nessuna policy il client non prende un errore: prende zero righe.
  -- E' proprio quello che serve, ma va verificato cosi', non aspettandosi un rifiuto.
  set local role authenticated;
  select count(*) into n from public.rides_archivio_senza_gruppo;
  reset role;
  if n <> 0 then
    raise exception 'FALLA: un utente autenticato legge % righe dall''archivio', n;
  end if;

  raise notice 'Migrazione 010: niente perso, archivio pieno e chiuso.';
end $$;
