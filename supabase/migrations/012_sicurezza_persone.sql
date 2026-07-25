-- 012 — Sicurezza delle persone: segnalare, bloccare, sospendere.
--
-- Cantiere C10 di docs/ROADMAP.md. Un'app dove sconosciuti salgono in macchina insieme
-- e non c'e' modo di segnalare nessuno non e' pronta per il pubblico: questo file e' la
-- meta' che sta nel database, cioe' quella che vale davvero (ADR 001, punto 2).
--
-- Tre cose distinte, che si confondono facilmente:
--   segnalazione = lo dico all'amministratore, l'altro non se ne accorge;
--   blocco       = una decisione mia, immediata, che non passa da nessuno;
--   sospensione  = decisione dell'amministratore, toglie la parola a chi la subisce.

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete set null,
  motivo text not null check (motivo in ('guida-pericolosa', 'molestie', 'non-si-e-presentato', 'profilo-falso', 'altro')),
  dettagli text check (dettagli is null or char_length(dettagli) <= 1000),
  stato text not null default 'aperta' check (stato in ('aperta', 'presa-in-carico', 'chiusa')),
  esito text check (esito is null or char_length(esito) <= 1000),
  created_at timestamptz not null default now(),
  gestita_da uuid references public.profiles(id) on delete set null,
  gestita_il timestamptz,
  check (reporter_id <> reported_id)
);

-- Una segnalazione aperta per coppia: senza, chi vuole molestare qualcuno lo fa
-- riempiendo la coda dell'amministratore invece che il suo telefono.
create unique index if not exists user_reports_una_per_coppia
  on public.user_reports (reporter_id, reported_id) where stato <> 'chiusa';
create index if not exists user_reports_da_gestire
  on public.user_reports (stato, created_at) where stato <> 'chiusa';

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Il blocco vale nei due sensi, quindi si cerca anche al contrario: senza questo
-- indice meta' delle interrogazioni sarebbe una scansione completa.
create index if not exists user_blocks_al_contrario on public.user_blocks (blocked_id, blocker_id);

alter table public.profiles add column if not exists sospeso boolean not null default false;
alter table public.profiles add column if not exists sospeso_il timestamptz;
alter table public.profiles add column if not exists sospeso_motivo text;

-- ===== Funzioni =====
-- Tutte security definer per la stessa ragione di is_member(): sono chiamate DENTRO le
-- policy di tabelle che a loro volta hanno policy, e senza questo si andrebbe in
-- ricorsione. Restano innocue perche' non accettano scelte da chi chiama: rispondono
-- solo si'/no su una coppia di persone.

create or replace function public.bloccati_fra(a uuid, b uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from user_blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  )
$$;

-- Il blocco e' simmetrico negli effetti anche se lo decide uno solo: chi blocca non
-- vuole piu' vedere l'altro, e non ha senso che l'altro continui a vedere lui.
create or replace function public.si_bloccano(altro uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select public.bloccati_fra(auth.uid(), altro)
$$;

create or replace function public.sospeso(u uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select p.sospeso from profiles p where p.id = u), false)
$$;

create or replace function public.sono_sospeso() returns boolean
language sql security definer stable set search_path = public as $$
  select public.sospeso(auth.uid())
$$;

-- "Ho gia' un posto su quest'auto": serve alla policy di lettura dei passaggi, e deve
-- essere security definer perche' seat_claims si legge attraverso rides — leggerlo
-- dentro la policy di rides sarebbe ricorsione.
create or replace function public.ho_un_posto(auto uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from seat_claims where ride_id = auto and passenger_id = auth.uid())
$$;

-- ===== Chi puo' leggere le segnalazioni e i blocchi =====

alter table public.user_reports enable row level security;
alter table public.user_blocks enable row level security;

-- Chi segnala rivede la propria segnalazione; il segnalato non sa di esserlo, altrimenti
-- segnalare diventa un modo per litigare invece che per farsi aiutare.
drop policy if exists "reports read own" on public.user_reports;
create policy "reports read own" on public.user_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists "reports insert own" on public.user_reports;
create policy "reports insert own" on public.user_reports for insert to authenticated
  with check (reporter_id = auth.uid() and not public.sono_sospeso());
-- Lo stato lo cambia solo l'amministratore: chi segnala non archivia la propria
-- segnalazione, e il segnalato non la tocca affatto.
drop policy if exists "reports admin" on public.user_reports;
create policy "reports admin" on public.user_reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Il blocco lo vede solo chi lo ha messo. Se il bloccato potesse leggerlo, saprebbe
-- di essere stato bloccato e da chi: e' esattamente la notizia da non dare.
drop policy if exists "blocks read own" on public.user_blocks;
create policy "blocks read own" on public.user_blocks for select to authenticated
  using (blocker_id = auth.uid() or public.is_admin());
drop policy if exists "blocks insert own" on public.user_blocks;
create policy "blocks insert own" on public.user_blocks for insert to authenticated
  with check (blocker_id = auth.uid() and not public.sono_sospeso());
drop policy if exists "blocks delete own" on public.user_blocks;
create policy "blocks delete own" on public.user_blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- ===== Il blocco applicato a cio' che si vede =====

-- Un passaggio di una persona bloccata sparisce, TRANNE se ci sono gia' sopra: il posto
-- preso resta valido e lo si deve poter vedere per liberarlo. Nasconderlo lascerebbe una
-- prenotazione invisibile e impossibile da annullare.
drop policy if exists "rides read" on public.rides;
create policy "rides read" on public.rides for select to authenticated
  using (
    public.is_member(group_id)
    and (not public.si_bloccano(driver_id) or public.ho_un_posto(id))
  );

-- Il profilo di chi e' bloccato non si legge piu'. L'app lo regge: ogni lettura di nome
-- passa da nomeDi(), che ha il suo ripiego (era la lezione di C5).
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or (public.condivide_gruppo(id) and not public.si_bloccano(id))
  );

-- Commenti e richieste di chi e' bloccato: spariscono anche quando il passaggio resta
-- visibile perche' e' di un terzo.
drop policy if exists "comments read" on public.ride_comments;
create policy "comments read" on public.ride_comments for select to authenticated
  using (
    exists (select 1 from public.rides r where r.id = ride_id)
    and not public.si_bloccano(user_id)
  );

drop policy if exists "requests read" on public.ride_requests;
create policy "requests read" on public.ride_requests for select to authenticated
  using (public.is_member(group_id) and not public.si_bloccano(user_id));

-- I sedili occupati NON si nascondono, di proposito: un posto preso da una persona
-- bloccata che risultasse libero verrebbe prenotato e poi rifiutato dall'indice unico,
-- con un errore senza spiegazione. Sparisce il nome (il profilo non si legge), resta
-- l'ingombro. Stessa ragione per la lista d'attesa.

-- ===== Il blocco e la sospensione applicati a cio' che si scrive =====

-- Vale sulle righe, non su auth.uid(), perche' deve reggere anche quando a scrivere e'
-- una funzione security definer per conto di qualcun altro: promote_waitlist() fa
-- salire il primo della coda, e quel primo puo' essere bloccato o sospeso.
create or replace function public.controlla_persone() returns trigger
language plpgsql security definer set search_path = public as $$
declare guidatore uuid; chi uuid;
begin
  chi := (to_jsonb(new) ->> TG_ARGV[0])::uuid;
  if public.sospeso(chi) then
    raise exception 'Account sospeso: non puoi prenotare o metterti in lista.';
  end if;
  select driver_id into guidatore from rides where id = (to_jsonb(new) ->> 'ride_id')::uuid;
  if guidatore is not null and public.bloccati_fra(chi, guidatore) then
    raise exception 'Non si sale in macchina con una persona bloccata.';
  end if;
  return new;
end; $$;

-- Su seat_claims questo trigger e' l'unica difesa che esista, e si vede togliendolo: il
-- test diventa rosso sulla lista d'attesa. promote_waitlist() e' security definer, quindi
-- non passa da nessuna policy e nemmeno dal "viaggio inesistente" di 004, che li' vede
-- tutto. Non va toccata: cattura gia' l'eccezione di ogni candidato non idoneo e passa al
-- successivo, quindi questo trigger la fa scorrere da solo.
drop trigger if exists claims_persone on public.seat_claims;
create trigger claims_persone before insert on public.seat_claims
  for each row execute function public.controlla_persone('passenger_id');

-- Su ride_waitlist invece e' una cintura in piu': oggi nessuna strada arriva qui
-- scavalcando "waitlist insert own", che gia' pretende un passaggio visibile. Togliendolo
-- il test resta verde, ed e' vero. Resta perche' il giorno in cui quella policy si
-- allarga, questo continua a reggere senza che nessuno se ne debba ricordare.
drop trigger if exists waitlist_persone on public.ride_waitlist;
create trigger waitlist_persone before insert on public.ride_waitlist
  for each row execute function public.controlla_persone('user_id');

-- Sospeso non vuol dire cacciato: legge, e vede perche'. Ma non scrive piu' niente.
drop policy if exists "rides insert own" on public.rides;
create policy "rides insert own" on public.rides for insert to authenticated
  with check (auth.uid() = driver_id and public.is_member(group_id) and not public.sono_sospeso());
drop policy if exists "rides update own" on public.rides;
create policy "rides update own" on public.rides for update to authenticated
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id and public.is_member(group_id) and not public.sono_sospeso());
drop policy if exists "claims insert own" on public.seat_claims;
create policy "claims insert own" on public.seat_claims for insert to authenticated
  with check (auth.uid() = passenger_id and not public.sono_sospeso());
drop policy if exists "requests insert own" on public.ride_requests;
create policy "requests insert own" on public.ride_requests for insert to authenticated
  with check (auth.uid() = user_id and public.is_member(group_id) and not public.sono_sospeso());
drop policy if exists "comments insert own" on public.ride_comments;
create policy "comments insert own" on public.ride_comments for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.rides r where r.id = ride_id)
    and not public.sono_sospeso()
  );
drop policy if exists "waitlist insert own" on public.ride_waitlist;
create policy "waitlist insert own" on public.ride_waitlist for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.rides r where r.id = ride_id)
    and not public.sono_sospeso()
  );
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id and not public.sono_sospeso());

-- Cancellare resta permesso anche da sospesi: liberare un posto o ritirare la propria
-- auto toglie ingombro agli altri, vietarlo punirebbe loro.

-- create_group() e join_group() sono security definer, quindi la policy non le vede
-- passare: il divieto va messo sulle righe che scrivono.
create or replace function public.controlla_sospeso() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.sospeso((to_jsonb(new) ->> TG_ARGV[0])::uuid) then
    raise exception 'Account sospeso: non puoi creare comitive ne'' entrarci.';
  end if;
  return new;
end; $$;

-- Quello che porta il peso e' members_sospeso: nessuna comitiva nasce senza che chi la
-- crea ci entri dentro, quindi ferma sia create_group() sia join_group(). Quello su
-- groups e' la seconda cintura, e infatti togliendolo il test resta verde: serve a non
-- lasciare in giro una comitiva senza padrone se un domani le due scritture si separano.
drop trigger if exists groups_sospeso on public.groups;
create trigger groups_sospeso before insert on public.groups
  for each row execute function public.controlla_sospeso('owner_id');
drop trigger if exists members_sospeso on public.group_members;
create trigger members_sospeso before insert on public.group_members
  for each row execute function public.controlla_sospeso('user_id');

-- Nessuno si toglie la sospensione da solo. Senza questo, "profiles update own"
-- basterebbe: una chiamata all'API e il sospeso torna libero.
--
-- L'eccezione "auth.uid() is null" e' voluta: nessuna richiesta dal browser ha uid
-- nullo e insieme il permesso di scrivere qui, perche' "profiles update own" chiede
-- auth.uid() = id, che con uid nullo non e' mai vero. Uid nullo vuol dire percorsi che
-- le policy non attraversano affatto — il SQL editor, service_role — cioe' l'unico
-- posto da cui si puo' nominare qualcuno la prima volta.
create or replace function public.protect_sospeso() returns trigger
language plpgsql as $$
begin
  if (new.sospeso is distinct from old.sospeso
      or new.sospeso_motivo is distinct from old.sospeso_motivo)
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un amministratore puo'' sospendere o riabilitare un account.';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_sospeso on public.profiles;
create trigger profiles_protect_sospeso before update on public.profiles
  for each row execute function public.protect_sospeso();

-- Difetto trovato scrivendo il test di questo cantiere, ed e' di 008, non di qui:
-- **il primo amministratore non si poteva nominare.** 008 dice di farlo dal SQL editor
-- con un update, ma il suo stesso trigger lo rifiuta — li' auth.uid() e' nullo, quindi
-- is_admin() e' falso, quindi "non sei amministratore, non puoi nominarne uno". Nessuno
-- se n'era accorto perche' l'amministratore non e' mai stato nominato: la coda delle
-- segnalazioni di questo cantiere sarebbe rimasta senza nessuno che la legge.
-- Stessa eccezione di sopra, stessa ragione.
create or replace function public.protect_admin_flag() returns trigger
language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Non puoi modificare i permessi di amministratore.';
  end if;
  return new;
end; $$;

insert into public.schema_migrations (version) values ('012_sicurezza_persone') on conflict do nothing;
