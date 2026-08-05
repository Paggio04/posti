-- 033 — Una comitiva che nasce, serve tre giorni e si chiude da sola.
--
-- Cantiere C38 di docs/ROADMAP.md. Un gruppo oggi e' permanente, e va bene per i
-- fuorisede che si portano all'universita' tutto l'anno. Un concerto, un matrimonio, un
-- weekend fuori sono un caso d'uso diverso — ed e' probabilmente quello che porta
-- persone nuove, perche' e' l'unico che comincia con qualcuno che non ha l'app.
--
-- ── Cosa vuol dire «si chiude» ─────────────────────────────────────────────
-- Due cose, e **non** una terza:
--   * dopo la data non ci si entra piu' col codice;
--   * dopo la data non si pubblicano piu' passaggi.
-- I dati **restano leggibili a chi c'era**. Non si cancella niente, non si toglie
-- nessuna policy: chi ha diviso una macchina per tre giorni deve poter ancora vedere
-- chi c'era e saldare quello che deve. Una comitiva scaduta e' un album, non un buco.
--
-- ── Il messaggio d'errore, e C24 ───────────────────────────────────────────
-- La roadmap avverte: «un codice che scade e' anche un codice in piu' che circola, e
-- C24 e' ancora aperto». C24 e' l'enumerabilita' dei codici **da autenticato**, e la
-- domanda giusta e': dire «questa comitiva e' chiusa» invece di «codice non valido»
-- regala qualcosa a chi prova i codici a caso?
--
-- Regala l'informazione che quel codice esiste — che pero' chi indovina un codice
-- **valido** ottiene gia' oggi, e in forma peggiore, perche' entra. La terza risposta
-- e' quindi meno invasiva della seconda, non piu'. Tacere costerebbe invece a chi ha in
-- mano un codice legittimo: «codice non valido» lo manderebbe a ricontrollare le
-- lettere di un codice giusto. C24 resta aperto e si chiude altrove — limitando i
-- tentativi, che e' il rimedio vero e non riguarda questa colonna.

alter table public.groups add column if not exists scade_il date;

-- ── Chi entra ──────────────────────────────────────────────────────────────
create or replace function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'Codice non valido'; end if;
  if g.scade_il is not null and g.scade_il < current_date then
    raise exception 'Questa comitiva è chiusa';
  end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end; $$;

-- ── Chi la crea ────────────────────────────────────────────────────────────
-- La vecchia `create_group(text)` si **cancella** invece di lasciarla accanto alla
-- nuova: con `create_group(text)` e `create_group(text, date default null)` insieme,
-- una chiamata con un argomento solo diventa ambigua e Postgres la rifiuta. Sarebbe un
-- «Crea gruppo» rotto per tutti, e nessun file lo direbbe.
drop function if exists public.create_group(text);

create or replace function public.create_group(p_name text, p_scade date default null)
returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if p_scade is not null and p_scade < current_date then
    raise exception 'Una comitiva non può chiudere prima di aprire.';
  end if;
  insert into groups (name, owner_id, scade_il) values (p_name, auth.uid(), p_scade) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end; $$;

revoke execute on function public.create_group(text, date) from public, anon;
grant  execute on function public.create_group(text, date) to authenticated;

-- ── E `blinda_funzioni()` nominava la vecchia firma ────────────────────────
-- La 020 richiude i permessi elencando le funzioni **per firma esatta**, e
-- `create_group(text)` adesso non esiste piu': la prima cosa che la chiama muore con
-- «function public.create_group(text) does not exist». Non e' un problema teorico —
-- l'ha alzato `verifica-permessi.sql`, che la richiama dopo aver aperto i permessi.
--
-- E' il costo di cambiare la firma di una funzione **nominata altrove**, e vale la
-- pena scriverlo: un `revoke` per firma e' un riferimento come un altro, ma non
-- assomiglia a un riferimento e non lo si va a cercare. Il corpo resta quello della
-- 020, con le due righe di `create_group` aggiornate.
create or replace function public.blinda_funzioni() returns void
language plpgsql security definer set search_path = public as $$
begin
  revoke execute on function public.bloccati_fra(uuid, uuid) from public, anon, authenticated;
  revoke execute on function public.sospeso(uuid) from public, anon, authenticated;

  revoke execute on function public.create_group(text, date) from public, anon;
  grant execute on function public.create_group(text, date) to authenticated;
  revoke execute on function public.join_group(text) from public, anon;
  grant execute on function public.join_group(text) to authenticated;
end; $$;
revoke execute on function public.blinda_funzioni() from public, anon, authenticated;

-- ── Chi pubblica ───────────────────────────────────────────────────────────
-- Il corpo resta quello della 030, con un `if` in piu' in testa. E' un controllo di
-- integrita' vero, non una regola di comitiva come quelle di C36: li' l'eccezione ha
-- senso («stasera pago io»), qui no — un passaggio dopo la fine di una comitiva a
-- tempo e' un passaggio dentro un gruppo che non esiste piu'.
create or replace function public.check_ride() returns trigger
language plpgsql as $$
declare chiusa date;
begin
  if new.ride_date < current_date then
    raise exception 'Non puoi pubblicare un viaggio in un giorno passato.';
  end if;
  select scade_il into chiusa from public.groups where id = new.group_id;
  if chiusa is not null and chiusa < current_date then
    raise exception 'Questa comitiva è chiusa dal %.', to_char(chiusa, 'DD/MM/YYYY');
  end if;
  -- Il passaggio **oltre** la fine si rifiuta anche se oggi la comitiva e' ancora
  -- aperta: pubblicare per dopo la chiusura sarebbe un'auto che nessuno potra' mai
  -- prenotare, perche' quel giorno il gruppo non c'e' piu'.
  if chiusa is not null and new.ride_date > chiusa then
    raise exception 'Questa comitiva chiude il %: non si pubblica oltre.', to_char(chiusa, 'DD/MM/YYYY');
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

-- Nessuna policy cambia, e va detto perche' e' la meta' che si dimentica: leggere i
-- passaggi, i conti e i profili di una comitiva scaduta continua a funzionare, perche'
-- `is_member()` guarda l'appartenenza e non la data. Chi c'era resta dentro.

insert into public.schema_migrations (version) values ('033_comitiva_a_tempo') on conflict do nothing;
