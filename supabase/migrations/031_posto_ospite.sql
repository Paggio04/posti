-- 031 — Il posto per un ospite: un sedile con un nome invece di un account.
--
-- Cantiere C35 di docs/ROADMAP.md. Un sedile e' un utente registrato, quindi prenotare
-- due posti perche' porti un amico che non ha l'app **non si puo' fare** — e nella vita
-- succede di continuo. Il risultato oggi e' che l'auto risulta con un posto libero che
-- libero non e', e qualcuno prenota un sedile su cui poi si siede un altro.
--
-- ── Un sedile, due modi di essere occupato ─────────────────────────────────
-- `passenger_id` diventa facoltativo e nascono `ospite_nome` e `invitato_da`. Il
-- vincolo dice che **esattamente uno** dei due modi vale: o e' di una persona con un
-- account, o e' di un ospite con un nome e qualcuno che risponde per lui. Un sedile con
-- tutti e due, o con nessuno dei due, non vuol dire niente e il database lo rifiuta.
--
-- ── Il conto dell'ospite e' di chi lo ha portato ───────────────────────────
-- «La quota di quell'ospite va nel conto di chi lo ha portato — non in un conto suo,
-- che non esiste». Nel `saldo_con` si traduce in una riga: il dovuto guarda
-- `coalesce(passenger_id, invitato_da)` invece di `passenger_id`. Con la sola colonna
-- vecchia i posti degli ospiti sarebbero spariti dai conti, cioe' qualcuno avrebbe
-- portato gente in macchina gratis senza che nessuno lo avesse deciso.
--
-- ── Le tre cose che si rompevano in silenzio, e non erano ovvie ────────────
-- Un `null` in piu' in una colonna che nessuno si aspettava nulla attraversa mezzo
-- schema. Tre punti diventavano falsi **senza errori**, che e' il modo peggiore:
--
-- 1. **`controlla_persone` (012)** legge la persona da una colonna sola. Con
--    `passenger_id` nullo la domanda «e' sospeso?» e «si sono bloccati?» diventano
--    domande su nessuno, cioe' rispondono di no: un account sospeso avrebbe potuto
--    riempire un'auto di ospiti, e chi ha bloccato qualcuno se lo sarebbe trovato in
--    macchina sotto forma di suo invitato.
-- 2. **`registra_evento_posto` (023)** avrebbe scritto un evento senza attore.
-- 3. **`notifica_posto_prenotato` (017)** cercava il nome in `profiles` con un id nullo
--    e avvisava «Qualcuno sale sulla tua auto» — vero, ma il guidatore ha appena perso
--    l'unica informazione che gli serve, cioe' chi.

alter table public.seat_claims
  add column if not exists ospite_nome text,
  add column if not exists invitato_da uuid references auth.users(id) on delete cascade;

alter table public.seat_claims alter column passenger_id drop not null;

alter table public.seat_claims drop constraint if exists seat_claim_persona_o_ospite;
alter table public.seat_claims add constraint seat_claim_persona_o_ospite check (
  (passenger_id is not null and ospite_nome is null and invitato_da is null)
  or
  (passenger_id is null and invitato_da is not null
   and ospite_nome is not null and length(trim(ospite_nome)) between 1 and 40)
);

create index if not exists seat_claims_invitato_da_idx on public.seat_claims (invitato_da);

-- L'archivio della 010 si riempie con `select *`: stesse colonne, e **stessa
-- facoltativita'** su `passenger_id`, o archiviare un ospite fallirebbe sul `not null`
-- di una tabella che nessuno guarda mai.
do $$
begin
  if to_regclass('public.seat_claims_archivio_senza_gruppo') is not null then
    alter table public.seat_claims_archivio_senza_gruppo
      add column if not exists ospite_nome text,
      add column if not exists invitato_da uuid;
    alter table public.seat_claims_archivio_senza_gruppo alter column passenger_id drop not null;
  end if;
end $$;

-- ── Le policy: chi puo' mettere e togliere un ospite ───────────────────────
-- Metterlo: chi ha un account, per se' come prima, oppure per un ospite di cui e' lui
-- a rispondere. `invitato_da = auth.uid()` e non «un membro qualsiasi»: un ospite messo
-- a nome di un altro sarebbe un posto occupato che nessuno sa di aver preso.
drop policy if exists "claims insert own" on public.seat_claims;
create policy "claims insert own" on public.seat_claims for insert to authenticated
  with check (
    not public.sono_sospeso()
    and (auth.uid() = passenger_id
         or (passenger_id is null and auth.uid() = invitato_da))
  );

-- Toglierlo: chi lo ha portato, oltre a chi guida. Senza il primo ramo un ospite
-- messo per sbaglio resterebbe li' fino a che il guidatore non se ne accorge.
drop policy if exists "claims delete own or driver" on public.seat_claims;
create policy "claims delete own or driver" on public.seat_claims for delete
  using (auth.uid() = passenger_id
     or auth.uid() = invitato_da
     or exists (select 1 from public.rides r where r.id = ride_id and r.driver_id = auth.uid()));

-- ── 1. Blocco e sospensione guardano chi risponde del posto ────────────────
-- La funzione resta generica: si aggiunge un secondo argomento facoltativo, e la
-- persona e' la prima delle due colonne che c'e'. Su `ride_waitlist`, che
-- `invitato_da` non ce l'ha, il trigger continua a passare un argomento solo.
create or replace function public.controlla_persone() returns trigger
language plpgsql security definer set search_path = public as $$
declare guidatore uuid; chi uuid;
begin
  chi := (to_jsonb(new) ->> TG_ARGV[0])::uuid;
  if chi is null and TG_NARGS > 1 then
    chi := (to_jsonb(new) ->> TG_ARGV[1])::uuid;
  end if;
  if public.sospeso(chi) then
    raise exception 'Account sospeso: non puoi prenotare o metterti in lista.';
  end if;
  select driver_id into guidatore from rides where id = (to_jsonb(new) ->> 'ride_id')::uuid;
  if guidatore is not null and public.bloccati_fra(chi, guidatore) then
    raise exception 'Non si sale in macchina con una persona bloccata.';
  end if;
  return new;
end; $$;

drop trigger if exists claims_persone on public.seat_claims;
create trigger claims_persone before insert on public.seat_claims
  for each row execute function public.controlla_persone('passenger_id', 'invitato_da');

-- ── 2. L'evento ha un attore ───────────────────────────────────────────────
-- Chi ha fatto il gesto e' chi ha portato l'ospite: l'ospite non esiste come persona
-- in questa applicazione, e un registro con una riga senza attore non racconta niente.
create or replace function public.registra_evento_posto()
returns trigger language plpgsql security definer set search_path = public as $$
declare g uuid; r uuid;
begin
  r := coalesce(new.ride_id, old.ride_id);
  select group_id into g from rides where id = r;
  if g is null then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    insert into eventi (group_id, tipo, attore, ride_id)
    values (g, 'posto_preso', coalesce(new.passenger_id, new.invitato_da), r);
    return new;
  else
    insert into eventi (group_id, tipo, attore, ride_id)
    values (g, 'posto_liberato', coalesce(old.passenger_id, old.invitato_da), r);
    return old;
  end if;
end; $$;
revoke execute on function public.registra_evento_posto() from public, anon, authenticated;

-- ── 3. La notifica dice chi sale ───────────────────────────────────────────
create or replace function public.notifica_posto_prenotato() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  guida uuid;
  chi text;
  chiave text;
begin
  select driver_id into guida from rides where id = new.ride_id;
  if guida is null then return new; end if;
  if new.passenger_id is not null then
    if guida = new.passenger_id then return new; end if;
    select coalesce(display_name, 'Qualcuno') into chi from profiles where id = new.passenger_id;
    chi := coalesce(chi, 'Qualcuno');
    chiave := 'posto_prenotato:' || new.ride_id::text || ':' || new.passenger_id::text;
  else
    -- Il nome dell'ospite piu' quello di chi lo porta: al guidatore serve sapere
    -- chi sale **e** con chi ha a che fare, perche' l'ospite non ha un account a cui
    -- scrivere. La chiave prende il numero del sedile: due ospiti diversi portati
    -- dalla stessa persona sono due notizie, non una ripetuta.
    select coalesce(display_name, 'Qualcuno') into chi from profiles where id = new.invitato_da;
    chi := trim(new.ospite_nome) || ' (ospite di ' || coalesce(chi, 'qualcuno') || ')';
    chiave := 'posto_prenotato:' || new.ride_id::text || ':ospite:' || new.seat_index::text;
  end if;

  perform public.accoda_notifica(
    guida, 'posto_prenotato', new.ride_id,
    'Un posto in meno', chi || ' sale sulla tua auto.', chiave
  );
  return new;
end; $$;

-- ── Il conto dell'ospite va a chi lo ha portato ────────────────────────────
-- Unica differenza rispetto alla 022: due `coalesce(sc.passenger_id, sc.invitato_da)`
-- al posto di `sc.passenger_id`. Il resto e' identico, `condivide_gruppo` compreso.
create or replace function public.saldo_con(altro uuid)
returns numeric
language sql security definer stable set search_path = public as $$
  with dovuto_da_me as (
    select coalesce(sum(r.fuel_per_person), 0) as tot
    from seat_claims sc
    join rides r on r.id = sc.ride_id
    where coalesce(sc.passenger_id, sc.invitato_da) = auth.uid() and r.driver_id = altro
      and r.fuel_per_person is not null
  ),
  dovuto_da_lui as (
    select coalesce(sum(r.fuel_per_person), 0) as tot
    from seat_claims sc
    join rides r on r.id = sc.ride_id
    where coalesce(sc.passenger_id, sc.invitato_da) = altro and r.driver_id = auth.uid()
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
  select round(
    (select tot from dovuto_da_lui) - (select tot from pagato_da_lui)
    - ((select tot from dovuto_da_me) - (select tot from pagato_da_me))
  , 2)
  where public.condivide_gruppo(altro);
$$;
revoke execute on function public.saldo_con(uuid) from public, anon;
grant  execute on function public.saldo_con(uuid) to authenticated;

-- ── Chi porta l'ospite dev'essere della comitiva ───────────────────────────
-- `check_claim` (028) verifica cose che riguardano `passenger_id`, e con un ospite
-- quelle condizioni si saltano da sole perche' il confronto con `null` non e' mai
-- vero. Restano due domande che nessuno faceva: che chi invita sia del gruppo, e che
-- non ci siano due ospite con lo stesso nome sulla stessa auto — il secondo non e'
-- pignoleria, e' l'unico modo di distinguerli, visto che un nome e' tutto cio' che
-- hanno.
create or replace function public.check_ospite() returns trigger
language plpgsql security definer set search_path = public as $$
declare gruppo uuid;
begin
  if new.passenger_id is not null then return new; end if;
  -- Un sedile senza ne' persona ne' invitante non e' un ospite mal messo: e' una riga
  -- che non vuol dire niente, e a dirlo dev'essere `seat_claim_persona_o_ospite`. I
  -- trigger `before` girano **prima** dei vincoli, quindi senza questa uscita il
  -- messaggio che si legge sarebbe «puoi portare un ospite solo nella tua comitiva» —
  -- una spiegazione sbagliata di un problema diverso, che e' peggio di nessuna.
  if new.invitato_da is null then return new; end if;
  select group_id into gruppo from rides where id = new.ride_id;
  if gruppo is not null and not exists (
    select 1 from group_members gm where gm.group_id = gruppo and gm.user_id = new.invitato_da
  ) then
    raise exception 'Puoi portare un ospite solo su un''auto della tua comitiva.';
  end if;
  if exists (
    select 1 from seat_claims sc
    where sc.ride_id = new.ride_id and sc.id is distinct from new.id
      and lower(trim(sc.ospite_nome)) = lower(trim(new.ospite_nome))
  ) then
    raise exception 'C''è già un ospite con questo nome su questa auto.';
  end if;
  return new;
end; $$;

drop trigger if exists claims_ospite on public.seat_claims;
create trigger claims_ospite before insert on public.seat_claims
  for each row execute function public.check_ospite();

revoke execute on function public.check_ospite() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('031_posto_ospite') on conflict do nothing;
