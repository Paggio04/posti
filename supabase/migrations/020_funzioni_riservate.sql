-- 020 — Le funzioni interne smettono di essere chiamabili da fuori.
--
-- In Postgres una funzione nasce **eseguibile da chiunque**: il `grant execute to public`
-- e' il default, e non lo si vede scritto da nessuna parte. Le migrazioni precedenti se ne
-- sono ricordate dove la cosa era evidente (`elimina_account`, `accoda_notifica`,
-- `blinda_coordinate`, `accoda_partenze_imminenti`), e non dove non lo era. Questo file
-- chiude i due casi rimasti, che sono veri buchi e non pignoleria.
--
-- 1. **`bloccati_fra(a, b)`** — `security definer`, e prende **due** id come parametri. Il
--    commento della 012 dice che queste funzioni «restano innocue perche' non accettano
--    scelte da chi chiama»: e' vero per `si_bloccano(altro)` e `mi_ha_bloccato(altro)`, che
--    sono ancorate ad `auth.uid()`, e falso proprio per questa. Un utente qualsiasi poteva
--    chiedere «X e Y si sono bloccati?» su due persone che non lo riguardano — e gli id si
--    leggono dal payload della Home (`driver_id`, `passenger_id`). Il blocco e' la cosa che
--    la 012 tiene nascosta anche a chi lo subisce: era la notizia da non dare, servita da
--    una funzione.
-- 2. **`sospeso(u)`** — stessa forma: dato un id, dice se quella persona e' sospesa. Lo
--    stato di moderazione di chiunque, a chiunque.
-- 3. **`create_group` / `join_group`** — sono `security definer` e nascono chiamabili anche
--    da `anon`, cioe' senza account. Entrare non ci si riesce (l'insert finisce con
--    `user_id` nullo e la chiave primaria lo rifiuta), ma il messaggio d'errore **cambia**:
--    "Codice non valido" se il codice non esiste, un errore di vincolo se esiste. E' un
--    oracolo per indovinare i codici invito da fuori, cioe' l'esatto contrario di quello
--    che `SECURITY.md` promette («i codici invito non sono enumerabili»).
--
-- Nessuna di queste e' chiamata dal client: `app.js` usa `create_group` e `join_group` da
-- autenticato, e le altre due non le nomina affatto. Le chiamano solo altre funzioni
-- `security definer` e i trigger, che girano con i permessi del proprietario e quindi non
-- passano da questi grant. **Questo file non ha un ordine di applicazione**: non toglie
-- niente che il codice pubblicato usi, quindi prima o dopo il deploy e' lo stesso.

-- In una funzione per la stessa ragione di `blinda_coordinate()`: la richiama il test dopo
-- aver aperto i permessi che servono al resto delle verifiche.
create or replace function public.blinda_funzioni() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Rispondono su persone scelte da chi chiama: da dentro il database, non da un browser.
  revoke execute on function public.bloccati_fra(uuid, uuid) from public, anon, authenticated;
  revoke execute on function public.sospeso(uuid) from public, anon, authenticated;

  -- Queste due invece servono al client, ma solo dopo l'accesso: si toglie il default
  -- (`public`, che comprende `anon`) e si ridanno a chi ha un account.
  revoke execute on function public.create_group(text) from public, anon;
  grant execute on function public.create_group(text) to authenticated;
  revoke execute on function public.join_group(text) from public, anon;
  grant execute on function public.join_group(text) to authenticated;
end; $$;

revoke execute on function public.blinda_funzioni() from public, anon, authenticated;

select public.blinda_funzioni();

-- Restano chiamabili da un client, ed e' voluto: `is_member`, `condivide_gruppo`,
-- `si_bloccano`, `mi_ha_bloccato`, `sono_sospeso`, `ho_un_posto`, `passaggio_visibile`,
-- `coordinate_visibili`, `is_admin`. Le prime sono dentro le policy — una policy chiama la
-- funzione con i permessi di chi interroga, quindi togliergliela vorrebbe dire spegnere la
-- lettura — e tutte rispondono su `auth.uid()`: dicono a una persona qualcosa di se stessa,
-- che e' esattamente quello che puo' gia' vedere.

insert into public.schema_migrations (version) values ('020_funzioni_riservate') on conflict do nothing;
