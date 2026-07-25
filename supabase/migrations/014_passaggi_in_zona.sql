-- 014 — Passaggi in zona: trovare un passaggio da chi sta vicino ma non e' della comitiva.
--
-- Cantiere C9 di docs/ROADMAP.md, l'ultimo della Fase 3 e il piu' delicato: e' quello che
-- apre i dati fuori dal gruppo. Per questo il default non cambia niente — un passaggio
-- nasce `visibilita = 'gruppo'`, cioe' esattamente com'era prima — e chi vuole uscire dalla
-- comitiva lo deve dire.
--
-- Tre scelte, che vale la pena scrivere perche' nessuna era obbligata:
--
-- 1. **Niente geocodifica di terzi.** D6 dice API native del browser e nessun SDK: le
--    coordinate arrivano da `navigator.geolocation`, cioe' dal telefono di chi pubblica.
--    Il nome del luogo resta testo libero come oggi. Un servizio di geocodifica sarebbe
--    una voce in piu' nella CSP e un terzo che vede dove vanno gli utenti.
-- 2. **La zona e' un punto piu' un raggio**, non un comune: i confini amministrativi non
--    dicono niente su quanto e' comodo un passaggio, e servirebbe un elenco da qualche
--    parte. Il raggio sta in una funzione, cosi' si cambia in un posto solo.
-- 3. **Il gruppo resta obbligatorio anche per i passaggi pubblici** (D1). Un passaggio
--    pubblico e' un passaggio di una comitiva che si lascia vedere da fuori, non un
--    passaggio senza padrone: le regole di archiviazione e di scrittura restano quelle.

alter table public.rides add column if not exists visibilita text not null default 'gruppo';
alter table public.rides add column if not exists origin_lat double precision;
alter table public.rides add column if not exists origin_lon double precision;
alter table public.rides add column if not exists dest_lat double precision;
alter table public.rides add column if not exists dest_lon double precision;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rides_visibilita_valida') then
    alter table public.rides add constraint rides_visibilita_valida
      check (visibilita in ('gruppo', 'zona', 'pubblico'));
  end if;
  -- Una latitudine senza longitudine e' un punto che non esiste: o tutte e due o nessuna.
  if not exists (select 1 from pg_constraint where conname = 'rides_partenza_completa') then
    alter table public.rides add constraint rides_partenza_completa
      check ((origin_lat is null) = (origin_lon is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rides_arrivo_completo') then
    alter table public.rides add constraint rides_arrivo_completo
      check ((dest_lat is null) = (dest_lon is null));
  end if;
  -- "Visibile in zona" senza sapere da dove parte non vuol dire niente: sarebbe un
  -- passaggio che non compare a nessuno, cioe' un'impostazione che mente.
  if not exists (select 1 from pg_constraint where conname = 'rides_zona_ha_un_punto') then
    alter table public.rides add constraint rides_zona_ha_un_punto
      check (visibilita <> 'zona' or origin_lat is not null);
  end if;
end $$;

-- L'archivio di 010 nasce `like public.rides`, e 010 ci copia dentro con `select *`.
-- Aggiungere una colonna a `rides` senza aggiungerla anche qui **rompe la ripetibilita' di
-- 010**: alla seconda passata l'insert trova piu' colonne di quante ne ha la destinazione
-- e il job `schema` diventa rosso. Non e' teoria, e' successo scrivendo questo file.
-- Regola: chi tocca `rides` tocca anche l'archivio, sempre.
do $$ begin
  if to_regclass('public.rides_archivio_senza_gruppo') is not null then
    alter table public.rides_archivio_senza_gruppo add column if not exists visibilita text;
    alter table public.rides_archivio_senza_gruppo add column if not exists origin_lat double precision;
    alter table public.rides_archivio_senza_gruppo add column if not exists origin_lon double precision;
    alter table public.rides_archivio_senza_gruppo add column if not exists dest_lat double precision;
    alter table public.rides_archivio_senza_gruppo add column if not exists dest_lon double precision;
  end if;
end $$;

alter table public.profiles add column if not exists zona_lat double precision;
alter table public.profiles add column if not exists zona_lon double precision;
alter table public.profiles add column if not exists zona_nome text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_zona_completa') then
    alter table public.profiles add constraint profiles_zona_completa
      check ((zona_lat is null) = (zona_lon is null));
  end if;
end $$;

-- Quanto e' "in zona". In una funzione e non sparso nelle policy: cambiarlo e' una
-- decisione di prodotto, e deve essere una riga sola.
create or replace function public.raggio_zona_km() returns double precision
language sql immutable as $$ select 25.0 $$;

-- Distanza in linea d'aria (haversine). Niente PostGIS ne' earthdistance: a questa scala
-- una formula di quattro righe fa lo stesso lavoro e non aggiunge un'estensione da
-- installare a mano su ogni database.
create or replace function public.distanza_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

-- Tutta la regola di visibilita' di un passaggio, in un posto solo. Ci sono due ragioni
-- per cui e' una funzione e non un'espressione dentro la policy: la policy diventerebbe
-- illeggibile, e soprattutto **serve anche alla policy dei profili**, che senza questa
-- dovrebbe riscrivere la stessa regola e prima o poi divergere.
--
-- security definer perche' legge profiles (la zona di chi guarda) e lo fa dentro la policy
-- di rides: senza, la policy dei profili interrogherebbe rides che interrogherebbe
-- profiles, cioe' ricorsione.
create or replace function public.passaggio_visibile(auto uuid) returns boolean
language plpgsql security definer stable set search_path = public as $$
declare
  r rides%rowtype;
  mia_lat double precision;
  mia_lon double precision;
begin
  select * into r from rides where id = auto;
  if r.id is null then return false; end if;

  -- Il blocco viene prima di tutto: nemmeno "pubblico" fa ricomparire una persona
  -- bloccata. Unica eccezione, quella di 012: il posto gia' preso resta visibile.
  if public.bloccati_fra(auth.uid(), r.driver_id) then
    return public.ho_un_posto(auto);
  end if;

  if public.ho_un_posto(auto) then return true; end if;   -- ci sono sopra, comunque sia
  if public.is_member(r.group_id) then return true; end if;
  if r.visibilita = 'pubblico' then return true; end if;

  if r.visibilita = 'zona' then
    select p.zona_lat, p.zona_lon into mia_lat, mia_lon from profiles p where p.id = auth.uid();
    if mia_lat is null or r.origin_lat is null then return false; end if;
    return public.distanza_km(mia_lat, mia_lon, r.origin_lat, r.origin_lon)
           <= public.raggio_zona_km();
  end if;

  return false;
end; $$;

drop policy if exists "rides read" on public.rides;
create policy "rides read" on public.rides for select to authenticated
  using (public.passaggio_visibile(id));

-- Estensione della decisione D2, prevista fin dall'inizio: si legge il nome di chi guida
-- un passaggio che si vede, e di chi ci e' a bordo. Senza, l'app mostrerebbe passaggi
-- senza nome — e chi guida non saprebbe chi sta caricando.
--
-- Le due sottoquery NON ripetono la regola di visibilita': leggono rides e seat_claims,
-- che hanno gia' le loro policy, quindi vedono esattamente quello che si vede. Se un
-- domani la regola cambia, cambia anche qui da sola.
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or (
      not public.mi_ha_bloccato(id)
      and (
        public.condivide_gruppo(id)
        or exists (select 1 from public.rides r where r.driver_id = profiles.id)
        or exists (select 1 from public.seat_claims sc where sc.passenger_id = profiles.id)
      )
    )
  );

-- Pubblicare resta un fatto interno alla comitiva: si puo' aprire il proprio passaggio a
-- chi sta fuori, non pubblicarne uno in casa d'altri.
insert into public.schema_migrations (version) values ('014_passaggi_in_zona') on conflict do nothing;
