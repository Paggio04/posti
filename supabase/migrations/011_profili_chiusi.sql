-- 011 — I profili si vedono solo dentro la propria comitiva.
--
-- Perche': `profiles read using (true)` faceva vedere nome e foto di OGNI utente
-- registrato a OGNI altro utente registrato, anche fra persone che non si sono mai
-- incontrate. Fra dieci amici non si notava; con l'app aperta a chiunque e' un elenco
-- di nomi e facce servito a chiunque si iscriva.
-- Decisione D2, cantiere C5 di docs/ROADMAP.md.

-- security definer per la stessa ragione di is_member(): la policy su profiles
-- interroga group_members, che a sua volta ha le sue policy. Senza questo si
-- entrerebbe in ricorsione.
create or replace function public.condivide_gruppo(altro uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from group_members mio
    join group_members suo on suo.group_id = mio.group_id
    where mio.user_id = auth.uid()
      and suo.user_id = altro
  )
$$;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (
    id = auth.uid()                    -- il proprio, sempre
    or public.condivide_gruppo(id)     -- chi sta in almeno una comitiva con me
    or public.is_admin()               -- l'amministratore vede tutti
  );

-- Quando arrivera' C9 (passaggi in zona, gente fuori dalla propria comitiva) qui va
-- aggiunto "o guida un passaggio che posso vedere": senza, l'app mostrerebbe passaggi
-- di cui non si legge il nome di chi guida.

insert into public.schema_migrations (version) values ('011_profili_chiusi') on conflict do nothing;
