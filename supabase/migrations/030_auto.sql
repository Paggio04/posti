-- 030 — L'auto ha un profilo, e serve a riconoscerla sotto casa al buio.
--
-- Cantiere C33 di docs/ROADMAP.md. I posti si ridigitano a ogni pubblicazione, e
-- soprattutto **chi aspetta non sa che auto cercare**: sa un nome e un'ora, e guarda
-- passare le macchine. Un'auto salvata riduce la pubblicazione a scegliere l'auto e
-- l'ora, e da' a chi aspetta le due parole che servono — «la Panda blu».
--
-- ── Perche' modello e colore sono qui e non nella nota ─────────────────────
-- Nella nota ci sono gia' — quando qualcuno si ricorda di scriverli, e riscritti ogni
-- volta. Un campo che si compila una volta sola e' l'unica forma in cui
-- l'informazione c'e' **sempre**, ed e' il punto: serve nell'unico momento in cui non
-- si puo' chiedere, cioe' al buio sotto casa con l'auto che passa.
--
-- ── Chi le vede ────────────────────────────────────────────────────────────
-- Chi condivide una comitiva, cioe' la stessa regola dei profili (D2, 011). Non e' un
-- dato riservato — la macchina di una persona la si vede arrivare — ma non e' nemmeno
-- roba da mostrare a chi non c'entra niente, e `condivide_gruppo()` e' la risposta che
-- questa app da' gia' a questa domanda. Il consumo invece serve solo a chi guida per
-- far proporre la quota (C34): non e' un segreto, ma non lo si mette in vetrina.

create table if not exists public.auto (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  nome         text not null check (length(nome) between 1 and 30),
  posti        int  not null check (posti between 1 and 6),
  modello      text check (modello is null or length(modello) <= 40),
  colore       text check (colore  is null or length(colore)  <= 20),
  -- Chilometri per litro: e' il numero che sta sul cruscotto, non litri/100 km. Una
  -- comitiva parla di «fa quindici», non di «consuma 6,7».
  consumo_km_l numeric(4,1) check (consumo_km_l is null or (consumo_km_l >= 3 and consumo_km_l <= 40)),
  predefinita  boolean not null default false,
  creata_il    timestamptz not null default now()
);

create index if not exists auto_utente_idx on public.auto (user_id);
-- Una predefinita per persona, non una per tabella. L'indice parziale e' il modo di
-- dire «al massimo una fra quelle vere», che un `unique` normale non saprebbe dire
-- perche' i `false` sono tanti.
create unique index if not exists auto_una_predefinita
  on public.auto (user_id) where predefinita;

alter table public.auto enable row level security;

drop policy if exists "auto read comitiva" on public.auto;
create policy "auto read comitiva" on public.auto for select to authenticated
  using (user_id = auth.uid() or public.condivide_gruppo(user_id));

drop policy if exists "auto insert own" on public.auto;
create policy "auto insert own" on public.auto for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "auto update own" on public.auto;
create policy "auto update own" on public.auto for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "auto delete own" on public.auto;
create policy "auto delete own" on public.auto for delete to authenticated
  using (user_id = auth.uid());

-- ── Il passaggio dice con quale auto ───────────────────────────────────────
-- `set null` e non `cascade`: cancellare un'auto dal proprio garage non deve
-- cancellare i passaggi gia' fatti con quella — sono storia, e con loro se ne
-- andrebbero i conti della benzina.
alter table public.rides
  add column if not exists auto_id uuid references public.auto(id) on delete set null;

do $$
begin
  if to_regclass('public.rides_archivio_senza_gruppo') is not null then
    alter table public.rides_archivio_senza_gruppo add column if not exists auto_id uuid;
  end if;
end $$;

-- ── Non si pubblica con l'auto di un altro ─────────────────────────────────
-- La policy di scrittura di `rides` nomina `driver_id` e non sa niente di `auto_id`:
-- senza questo controllo si potrebbe attaccare al proprio passaggio l'id dell'auto di
-- chiunque, e chi aspetta cercherebbe la macchina sbagliata. Il corpo resta quello
-- della 010 parola per parola: si aggiunge un `if` in fondo.
create or replace function public.check_ride() returns trigger
language plpgsql as $$
begin
  if new.ride_date < current_date then
    raise exception 'Non puoi pubblicare un viaggio in un giorno passato.';
  end if;
  if exists (
    select 1 from public.seat_claims sc
    join public.rides r on r.id = sc.ride_id
    where sc.passenger_id = new.driver_id
      and r.ride_date = new.ride_date
      and r.group_id = new.group_id
  ) then
    raise exception 'Hai già un posto su un''altra auto per quel giorno: prima scendi, poi pubblica la tua.';
  end if;
  if new.auto_id is not null and not exists (
    select 1 from public.auto a where a.id = new.auto_id and a.user_id = new.driver_id
  ) then
    raise exception 'Quell''auto non è tua.';
  end if;
  return new;
end; $$;

-- Il trigger di 004 e' `before insert` soltanto: `auto_id` si sceglie pubblicando, e
-- un passaggio non si modifica dall'app se non per il ritardo (027). Aggiungere
-- `or update` qui vorrebbe dire far girare anche gli altri due controlli a ogni
-- annuncio di ritardo, e il primo di quelli rifiuterebbe un passaggio di ieri —
-- cioe' un ritardo annunciato dopo la mezzanotte non passerebbe piu'.

-- Il permesso per colonna di 016 va ricalcolato: `auto_id` e' nuova. Vedi 027.
select public.blinda_coordinate();

insert into public.schema_migrations (version) values ('030_auto') on conflict do nothing;
