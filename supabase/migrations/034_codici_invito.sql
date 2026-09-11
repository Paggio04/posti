-- 034 — C24: i codici invito non si indovinano piu'.
--
-- Cantiere C24 di docs/ROADMAP.md, l'ultima riga gialla vera di SECURITY.md. Aperto il
-- 31/07/2026 scrivendo quella riga, che prima prometteva una cosa non vera: la 020 ha
-- chiuso la strada a chi **non** ha un account, e ha lasciato aperta quella di chi ce
-- l'ha — che e' la piu' seria delle due, perche' li' un codice indovinato non si limita
-- a rivelarsi: fa entrare, e dentro ci sono passaggi, membri, richieste e commenti.
--
-- I tre rimedi della roadmap, tutti e tre, nell'ordine in cui li elencava.
--
-- ── 1. Lo spazio dei codici ────────────────────────────────────────────────
-- Il default della 003 era `upper(substr(md5(random()::text), 1, 6))`: sei caratteri di
-- **esadecimale**, cioe' un alfabeto di 16 simboli e 16.777.216 codici possibili. Sei
-- caratteri ne lasciano immaginare due miliardi (36^6): la distanza fra le due cifre e'
-- il difetto, e non si vede guardando la lunghezza.
--
-- Adesso: 31 simboli, 8 posizioni, cioe' **852.891.037.441** codici — cinquantamila
-- volte tanto. L'alfabeto e' quello di Crockford meno la `U`: niente `I`, `L`, `O`,
-- `0`, `1`, che sono le coppie che si sbagliano leggendo un codice a voce al telefono.
--
-- **I codici gia' distribuiti restano validi**, ed e' la ragione per cui questo rimedio
-- costa poco: cambia il `default` della colonna, non le righe gia' scritte. Chi ha il
-- suo codice in un messaggio di due settimane fa entra come prima.
--
-- Il caso viene da `gen_random_uuid()`, che nel core di Postgres attinge a
-- `pg_strong_random` — non da `random()`, che e' un generatore deterministico per
-- sessione. Il `% 31` su un byte introduce una preferenza minima per i primi otto
-- simboli (256 = 8*31 + 8): vale meno di un centesimo di bit su otto caratteri, e si
-- scrive qui perche' un numero storto taciuto e' peggio di un numero storto detto.
--
-- ── 2. L'errore uniforme, e cosa ribalta della 033 ─────────────────────────
-- `join_group` distingueva «Codice non valido» da «Questa comitiva e' chiusa». La 033 lo
-- aveva scelto apposta, con un argomento buono: tacere costerebbe a chi ha in mano un
-- codice **legittimo** ma scaduto, mandandolo a ricontrollare le lettere di un codice
-- giusto. Quell'argomento non si butta — si soddisfa in un modo che non distingue i due
-- casi: **una frase sola che li nomina tutti e due**. Chi ha un codice buono e scaduto
-- legge che puo' essere quello; chi tira a indovinare non impara che quel codice esiste.
-- E' la stessa mossa di C46 sulla registrazione: una schermata sola che regge i due casi.
--
-- ── 3. Il limite di tentativi, e perche' la funzione **torna null** ────────
-- Qui c'e' la trappola vera, e va scritta perche' e' invisibile: **un `raise exception`
-- annulla la transazione**, e con lei il contatore appena incrementato. Un limite di
-- tentativi scritto nel modo naturale — incrementa, poi solleva l'errore — conta zero
-- tentativi per sempre, resta verde a ogni prova a mano e non frena niente.
--
-- Percio' il fallimento non e' piu' un'eccezione: `join_group` **restituisce `null`**, la
-- transazione va a buon fine e il tentativo resta contato. Il che rende questa migrazione
-- una di quelle che **si applicano DOPO aver pubblicato il codice** (regola di
-- docs/adr/002-migrazioni-numerate.md, verso opposto rispetto alle 012-014): il codice
-- vecchio fa `data.id` su un `null` e muore in silenzio. Il codice nuovo regge tutti e
-- due gli schemi — legge il `null` e legge ancora le vecchie eccezioni — quindi l'ordine
-- e': pubblica, poi applica.
--
-- Dieci tentativi sbagliati l'ora per persona: chi sbaglia a copiare un codice ne ha in
-- abbondanza, chi ne prova 852 miliardi ci mette piu' della vita del sole. Il contatore
-- si azzera da solo quando la finestra scade, e si azzera all'ingresso riuscito.

-- ── Il generatore ──────────────────────────────────────────────────────────
create or replace function public.genera_codice_invito() returns text
language plpgsql as $$
declare
  alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 31 simboli: senza I L O 0 1
  sorgente bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');  -- 16 byte forti
  codice text := '';
  i int;
begin
  for i in 0..7 loop
    codice := codice || substr(alfabeto, (get_byte(sorgente, i) % 31) + 1, 1);
  end loop;
  return codice;
end; $$;

-- Chiamarla non rivela niente, ma la lezione della 020 e' che una funzione nasce
-- eseguibile da chiunque e nessuno lo vede scritto: si dichiara chi le serve, ed e'
-- nessuno. La usa il `default` della colonna, che gira coi permessi di `create_group` —
-- security definer, quindi quelli del proprietario.
revoke execute on function public.genera_codice_invito() from public, anon, authenticated;

alter table public.groups alter column code set default public.genera_codice_invito();

-- ── Il contatore dei tentativi ─────────────────────────────────────────────
-- RLS accesa e **nessuna policy**, come `notifiche_coda` della 017 e l'archivio della
-- 010: dal client non si legge e non si scrive, ci arriva solo `join_group`, che e'
-- security definer. La chiave esterna su `profiles` porta via la riga insieme
-- all'account, senza che `elimina_account()` debba nominarla.
create table if not exists public.tentativi_invito (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  tentativi   integer not null default 0,
  finestra_da timestamptz not null default now()
);

alter table public.tentativi_invito enable row level security;

-- ── Chi entra ──────────────────────────────────────────────────────────────
-- Il corpo resta quello della 033 con tre cose intorno: il conteggio prima, la
-- normalizzazione del codice, e i due esiti negativi che diventano uno.
create or replace function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  g public.groups;
  v_code text;
  v_tentativi integer;
  c_max constant integer := 10;
  c_finestra constant interval := interval '1 hour';
begin
  if auth.uid() is null then
    raise exception 'Serve un account autenticato.';
  end if;

  -- Finestra scorrevole di un'ora. L'`insert ... on conflict` fa nascere la riga e la
  -- incrementa in un colpo solo, cosi' due tentativi in parallelo non si perdono.
  insert into tentativi_invito (user_id, tentativi, finestra_da)
  values (auth.uid(), 1, now())
  on conflict (user_id) do update set
    tentativi = case
      when tentativi_invito.finestra_da < now() - c_finestra then 1
      else tentativi_invito.tentativi + 1 end,
    finestra_da = case
      when tentativi_invito.finestra_da < now() - c_finestra then now()
      else tentativi_invito.finestra_da end
  returning tentativi into v_tentativi;

  -- Questa **e'** un'eccezione, e va bene che lo sia: annullando la transazione il
  -- contatore resta al massimo invece di salire all'infinito, e il blocco dura quel che
  -- resta dell'ora. Non parla dei codici, parla di chi chiama: non rivela niente.
  if v_tentativi > c_max then
    raise exception 'Troppi tentativi con un codice sbagliato: riprova fra un''ora.';
  end if;

  -- Si accettano i trattini e gli spazi con cui la gente ricopia un codice a mano.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  select * into g from groups where code = v_code;

  -- I due esiti negativi rispondono uguale, ed e' il punto 2 qui sopra.
  if g.id is null or (g.scade_il is not null and g.scade_il < current_date) then
    return null;
  end if;

  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  update tentativi_invito set tentativi = 0, finestra_da = now() where user_id = auth.uid();
  return g;
end; $$;

revoke execute on function public.join_group(text) from public, anon;
grant  execute on function public.join_group(text) to authenticated;

insert into public.schema_migrations (version) values ('034_codici_invito') on conflict do nothing;
