-- 008 — Ruolo amministratore.
--
-- Va per ultimo perche' tocca TUTTE le tabelle: nel vecchio supabase-setup.sql questo
-- blocco stava a meta' file e dava una policy su ride_comments prima che la tabella
-- esistesse, quindi su un database vuoto il file si fermava li'.
-- La colonna is_admin sta in 001, insieme al resto del profilo.

create or replace function public.is_admin() returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and is_admin) $$;

-- Policy permissive: si sommano in OR a quelle normali, non le sostituiscono.
drop policy if exists "admin all" on public.rides;
create policy "admin all" on public.rides for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.seat_claims;
create policy "admin all" on public.seat_claims for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.ride_requests;
create policy "admin all" on public.ride_requests for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.ride_comments;
create policy "admin all" on public.ride_comments for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.groups;
create policy "admin all" on public.groups for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.group_members;
create policy "admin all" on public.group_members for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin update profiles" on public.profiles;
create policy "admin update profiles" on public.profiles for update using (public.is_admin());

-- Nessuno si auto-promuove: il flag lo cambia solo chi e' gia' amministratore.
create or replace function public.protect_admin_flag() returns trigger
language plpgsql as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_admin() then
    raise exception 'Non puoi modificare i permessi di amministratore.';
  end if;
  return new;
end; $$;
drop trigger if exists profiles_protect_admin on public.profiles;
create trigger profiles_protect_admin before update on public.profiles
  for each row execute function public.protect_admin_flag();

-- Il primo amministratore si nomina a mano dal SQL editor:
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'TUA_EMAIL');

insert into public.schema_migrations (version) values ('008_amministratore') on conflict do nothing;
