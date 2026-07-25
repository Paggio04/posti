-- 003 — Gruppi (comitive private con codice invito) e isolamento dei dati per gruppo.
--
-- I gruppi sono i confini fra comitive: un gruppo non e' nemmeno leggibile se non ne fai
-- parte, e il codice invito non e' enumerabile perche' si entra solo via RPC (ADR 001, punto 3).

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid references public.groups(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- security definer per spezzare la ricorsione: la policy di group_members
-- interrogherebbe group_members.
create or replace function public.is_member(g uuid) returns boolean
language sql security definer set search_path = public as
$$ select exists (select 1 from group_members where group_id = g and user_id = auth.uid()) $$;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "groups read member" on public.groups;
create policy "groups read member" on public.groups for select to authenticated using (public.is_member(id));
drop policy if exists "groups update owner" on public.groups;
create policy "groups update owner" on public.groups for update using (auth.uid() = owner_id);
drop policy if exists "groups delete owner" on public.groups;
create policy "groups delete owner" on public.groups for delete using (auth.uid() = owner_id);

drop policy if exists "members read" on public.group_members;
create policy "members read" on public.group_members for select to authenticated using (public.is_member(group_id));
drop policy if exists "members leave" on public.group_members;
create policy "members leave" on public.group_members for delete using (auth.uid() = user_id);
drop policy if exists "members removed by owner" on public.group_members;
create policy "members removed by owner" on public.group_members for delete
  using (exists (select 1 from public.groups g where g.id = group_id and g.owner_id = auth.uid()));

-- Creazione e ingresso passano da qui: sono security definer, quindi il codice
-- invito non si puo' scoprire con una select.
create or replace function public.create_group(p_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  insert into groups (name, owner_id) values (p_name, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end; $$;

create or replace function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'Codice non valido'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end; $$;

-- Un passaggio puo' appartenere a un gruppo.
alter table public.rides add column if not exists group_id uuid references public.groups(id) on delete cascade;

-- Lettura dei passaggi: quelli del proprio gruppo, piu' quelli senza gruppo.
-- Il ramo "group_id is null" li rende visibili a TUTTI gli iscritti: sparisce nel
-- cantiere C4 della roadmap, che rende il gruppo obbligatorio.
drop policy if exists "rides read" on public.rides;
create policy "rides read" on public.rides for select to authenticated
  using (group_id is null or public.is_member(group_id));

insert into public.schema_migrations (version) values ('003_gruppi') on conflict do nothing;
