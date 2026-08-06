-- 029 — «Piazza Dante», «piazza dante» e «P.za Dante» sono lo stesso posto.
--
-- Cantiere C32 di docs/ROADMAP.md. Origine e destinazione sono testo libero ridigitato
-- ogni volta: tre grafie diventano tre posti diversi, e qualsiasi conto che li guardi li
-- conta separati. Serve una rubrica del gruppo, da **scegliere** invece che da scrivere.
--
-- ── La rubrica si riempie da sola, e non e' pigrizia ───────────────────────
-- La riempie un trigger sulla pubblicazione, non il client. Una rubrica da compilare a
-- mano prima di poterla usare resta vuota per sempre: il primo che pubblica non ha
-- niente da scegliere, quindi scrive, quindi il secondo non ha ancora niente da
-- scegliere. Cosi' invece la prima pubblicazione la accende, e dalla seconda in poi c'e'
-- qualcosa da toccare. La stessa ragione per cui la scrive il database e non
-- l'applicazione vale per `eventi` (023): un elenco che il client puo' riempire racconta
-- cio' che il client crede.
--
-- ── **Niente coordinate raccolte di nascosto** ─────────────────────────────
-- La tentazione ovvia e' copiare qui `rides.origin_lat/origin_lon` — il punto di «Parto
-- da qui» — cosi' le fermate nascono gia' georeferenziate e C34 ha i numeri per
-- calcolare la quota. **E' esattamente C21 e C22 da capo**, per la terza volta e su una
-- terza tabella: quel punto e' dove si trovava una persona quando ha pubblicato, cioe'
-- quasi sempre casa sua al metro, e questa tabella la legge tutta la comitiva.
--
-- Le coordinate di una fermata quindi esistono, ma **solo se qualcuno le mette
-- apposta**, con un gesto che dice cosa sta facendo. Un punto di ritrovo del gruppo e'
-- un'informazione pubblica per il gruppo; il posto da cui parte una persona no. Sono due
-- cose diverse anche quando il puntino sulla mappa e' lo stesso.

-- ── La chiave: cosa rende «lo stesso posto» lo stesso posto ────────────────
-- Minuscole, accenti piegati, tutto cio' che non e' lettera o cifra ridotto a uno
-- spazio, spazi ai bordi via. Gli accenti si piegano con `translate` e non con
-- `unaccent`: quella e' un'estensione, e una migrazione che pretende un'estensione e'
-- una migrazione che su un Postgres nudo non gira — la CI parte da uno nudo apposta.
-- Copre le vocali accentate italiane, che sono il caso vero.
create or replace function public.chiave_fermata(nome text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
    lower(translate(coalesce(nome, ''), 'àáâäèéêëìíîïòóôöùúûüç', 'aaaaeeeeiiiioooouuuuc')),
    '[^a-z0-9]+', ' ', 'g')), '')
$$;

create table if not exists public.fermate (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  -- Il nome come e' stato scritto la prima volta: e' quello che si legge nell'elenco.
  nome       text not null check (length(nome) between 2 and 60),
  -- La forma normalizzata, calcolata dal database. Generata e non scritta dal client,
  -- perche' l'unicita' si appoggia su di lei: se la calcolasse il client, due client
  -- diversi (o due versioni dello stesso) potrebbero non essere d'accordo.
  chiave     text generated always as (public.chiave_fermata(nome)) stored,
  lat        double precision,
  lon        double precision,
  usi        int not null default 0,
  usata_il   date,
  creata_il  timestamptz not null default now(),
  constraint fermata_punto_intero check ((lat is null) = (lon is null))
);

-- E' questo indice a rendere vero «due passaggi dallo stesso posto contano come lo
-- stesso posto»: la terza grafia non crea la terza riga, incrementa la prima.
create unique index if not exists fermate_chiave_unica on public.fermate (group_id, chiave);
create index if not exists fermate_gruppo_idx on public.fermate (group_id, usi desc);

alter table public.fermate enable row level security;

-- La legge il gruppo: e' la rubrica della comitiva, e serve a tutti quando pubblicano.
drop policy if exists "fermate read gruppo" on public.fermate;
create policy "fermate read gruppo" on public.fermate for select to authenticated
  using (public.is_member(group_id));

-- Scrivere il **punto** di una fermata e' un gesto esplicito, e lo puo' fare un membro:
-- e' l'unico modo perche' i punti di ritrovo abbiano una posizione senza raccoglierla di
-- nascosto. Il nome no: quello lo crea il trigger, perche' una rubrica che si puo'
-- riempire a mano si riempie di roba che non e' mai stata un ritrovo.
drop policy if exists "fermate update membro" on public.fermate;
create policy "fermate update membro" on public.fermate for update to authenticated
  using (public.is_member(group_id)) with check (public.is_member(group_id));

-- Toglierne una che non si usa piu' resta possibile a chi possiede la comitiva: senza,
-- un errore di battitura resta nell'elenco per sempre.
drop policy if exists "fermate delete proprietario" on public.fermate;
create policy "fermate delete proprietario" on public.fermate for delete to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid()));

-- ── Il trigger che tiene viva la rubrica ───────────────────────────────────
create or replace function public.registra_fermate() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  posto text;
begin
  if new.group_id is null then return new; end if;
  foreach posto in array array[new.origin, new.destination] loop
    -- Una chiave nulla vuol dire «non c'era niente di scrivibile»: due punti, uno
    -- spazio, un trattino. Non e' una fermata, e' un campo lasciato a meta'.
    if public.chiave_fermata(posto) is null or length(trim(posto)) < 2 then
      continue;
    end if;
    insert into fermate (group_id, nome, usi, usata_il)
    values (new.group_id, left(trim(posto), 60), 1, new.ride_date)
    on conflict (group_id, chiave) do update
      set usi = fermate.usi + 1,
          -- La data piu' avanti fra le due: pubblicando per la settimana prossima non
          -- si deve far sembrare vecchia una fermata usata ieri, ne' viceversa.
          usata_il = greatest(coalesce(fermate.usata_il, new.ride_date), new.ride_date);
  end loop;
  return new;
end; $$;

drop trigger if exists rides_registra_fermate on public.rides;
create trigger rides_registra_fermate after insert on public.rides
  for each row execute function public.registra_fermate();

revoke execute on function public.registra_fermate() from public, anon, authenticated;
-- `chiave_fermata` invece resta aperta: e' una funzione di puro testo, non tocca
-- nessuna tabella e non sa chi la chiama. Serve anche dentro la colonna generata, e
-- una colonna generata la calcola chiunque scriva la riga.

insert into public.schema_migrations (version) values ('029_fermate') on conflict do nothing;
