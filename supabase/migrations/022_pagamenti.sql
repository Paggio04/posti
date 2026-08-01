-- 022 — I rimborsi della benzina si registrano, il debito si calcola.
--
-- `rides.fuel_per_person` esiste dalla 002, ma nessuno segnava chi avesse pagato:
-- la quota veniva calcolata e poi buttata. Qui si aggiunge **solo** il fatto
-- nuovo — il pagamento avvenuto — e il saldo resta una sottrazione:
--
--     dovuto  = somma delle quote dei passaggi su cui hai preso un posto
--     pagato  = somma dei pagamenti che hai registrato verso quella persona
--     saldo   = pagato - dovuto
--
-- Una tabella di **debiti** invece che di **pagamenti** andrebbe fuori sincrono
-- ogni volta che qualcuno disdice un posto o il guidatore corregge la quota.
-- Cosi' no: il dovuto si ricalcola sempre dallo stato vero dei sedili.
--
-- **Il confine, ed e' la stessa forma di C21 e C22.** Quanto Tizio deve a Caio e'
-- un fatto fra **due persone**, non della comitiva. La policy e' di riga e nomina
-- entrambe le parti; l'importo non finisce in nessuna colonna leggibile dal
-- gruppo. E la funzione del saldo e' ancorata ad `auth.uid()` invece di prendere
-- due id come parametri, che e' esattamente l'errore che la 020 ha dovuto
-- chiudere su `bloccati_fra`.

create table if not exists public.pagamenti (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  da_utente   uuid not null references auth.users(id) on delete cascade,
  a_utente    uuid not null references auth.users(id) on delete cascade,
  importo     numeric(8,2) not null check (importo > 0 and importo <= 10000),
  quando      date not null default current_date,
  nota        text check (nota is null or length(nota) <= 200),
  registrato_da uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- pagare se stessi non vuol dire niente, ed e' il modo piu' semplice di
  -- gonfiare un saldo senza che nessuno se ne accorga
  constraint pagamento_non_a_se_stessi check (da_utente <> a_utente)
);

create index if not exists pagamenti_da_idx on public.pagamenti (da_utente, a_utente);
create index if not exists pagamenti_a_idx  on public.pagamenti (a_utente, da_utente);

alter table public.pagamenti enable row level security;

-- Lettura: **solo le due parti**. Non l'amministratore, non il gruppo. Un
-- amministratore modera le persone (012), non i conti fra amici.
drop policy if exists "pagamenti read parti" on public.pagamenti;
create policy "pagamenti read parti" on public.pagamenti for select to authenticated
  using (da_utente = auth.uid() or a_utente = auth.uid());

-- Scrittura: la registra una delle due parti, e devono condividere il gruppo
-- indicato. Senza il controllo sul gruppo si potrebbe scrivere un pagamento
-- verso un estraneo e usarne l'esito per scoprire se un id esiste.
drop policy if exists "pagamenti insert parte" on public.pagamenti;
create policy "pagamenti insert parte" on public.pagamenti for insert to authenticated
  with check (
    registrato_da = auth.uid()
    and (da_utente = auth.uid() or a_utente = auth.uid())
    and public.is_member(group_id)
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = pagamenti.group_id
        and gm.user_id = case when da_utente = auth.uid() then a_utente else da_utente end
    )
  );

-- Correggere un importo sbagliato deve essere possibile, ma solo a chi l'ha
-- scritto: altrimenti chi riceve puo' alzarsi il credito da solo.
drop policy if exists "pagamenti delete autore" on public.pagamenti;
create policy "pagamenti delete autore" on public.pagamenti for delete to authenticated
  using (registrato_da = auth.uid());

-- ── Il saldo, ancorato a chi chiama ─────────────────────────────────────────
-- Non prende due id: prende **l'altro**, e la prima persona e' sempre
-- `auth.uid()`. Cosi' non c'e' modo di chiedere il saldo di due estranei.
create or replace function public.saldo_con(altro uuid)
returns numeric
language sql security definer stable set search_path = public as $$
  with dovuto_da_me as (
    select coalesce(sum(r.fuel_per_person), 0) as tot
    from seat_claims sc
    join rides r on r.id = sc.ride_id
    where sc.passenger_id = auth.uid() and r.driver_id = altro
      and r.fuel_per_person is not null
  ),
  dovuto_da_lui as (
    select coalesce(sum(r.fuel_per_person), 0) as tot
    from seat_claims sc
    join rides r on r.id = sc.ride_id
    where sc.passenger_id = altro and r.driver_id = auth.uid()
      and r.fuel_per_person is not null
  ),
  pagato_da_me as (
    select coalesce(sum(importo), 0) as tot from pagamenti
    where da_utente = auth.uid() and a_utente = altro
  ),
  pagato_da_lui as (
    select coalesce(sum(importo), 0) as tot from pagamenti
    where da_utente = altro and a_utente = auth.uid()
  )
  -- positivo = l'altro deve a me
  select round(
    (select tot from dovuto_da_lui) - (select tot from pagato_da_lui)
    - ((select tot from dovuto_da_me) - (select tot from pagato_da_me))
  , 2)
  where public.condivide_gruppo(altro);
$$;

-- In Postgres una funzione nasce eseguibile da chiunque: il `grant execute to
-- public` e' il default e non si vede scritto da nessuna parte. → 020, C23.
revoke execute on function public.saldo_con(uuid) from public, anon;
grant  execute on function public.saldo_con(uuid) to authenticated;

insert into public.schema_migrations (version) values ('022_pagamenti') on conflict do nothing;
