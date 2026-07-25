-- 013 — Cancellare il proprio account dall'app, non dalla dashboard.
--
-- Cantiere C11 di docs/ROADMAP.md. Finche' eravamo fra amici bastava chiedermelo; con
-- iscritti che non conosco, "scrivi all'amministratore" non e' il diritto alla
-- cancellazione, e' un favore.
--
-- Dal client non si puo' cancellare il proprio utente: l'API di amministrazione vuole la
-- service_role, cioe' la chiave che apre tutto, che nel browser non deve esistere. Ci
-- pensa questa funzione, security definer, che non prende parametri e sa cancellare una
-- persona sola: chi la chiama. E' l'opposto di dare la chiave al client.

create or replace function public.elimina_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  io uuid := auth.uid();
  g record;
  erede uuid;
begin
  if io is null then
    raise exception 'Serve un account autenticato per cancellarlo.';
  end if;

  -- Le comitive che possiedo NON devono morire con me: groups.owner_id cascata su
  -- profiles, quindi senza questo passaggio cancellare il proprio account porterebbe via
  -- il gruppo e, con lui, auto e prenotazioni di tutti gli altri. Nessuno se lo aspetta.
  -- Passa al membro piu' anziano; se non e' rimasto nessuno, il gruppo se ne va davvero,
  -- perche' un gruppo vuoto non e' di nessuno.
  for g in select id from groups where owner_id = io loop
    select gm.user_id into erede
      from group_members gm
      where gm.group_id = g.id and gm.user_id <> io
      order by gm.created_at, gm.user_id
      limit 1;
    if erede is null then
      delete from groups where id = g.id;
    else
      update groups set owner_id = erede where id = g.id;
    end if;
  end loop;

  -- Tutto il resto va via da solo: ogni tabella riferisce profiles (o auth.users) con
  -- on delete cascade. Vale anche per le segnalazioni fatte e ricevute.
  delete from auth.users where id = io;
end; $$;

revoke all on function public.elimina_account() from public, anon;
grant execute on function public.elimina_account() to authenticated;

insert into public.schema_migrations (version) values ('013_cancella_account') on conflict do nothing;
