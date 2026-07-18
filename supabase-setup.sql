-- Schema per Posti: tabella + Row Level Security
create table if not exists public.posti (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  city text check (char_length(city) <= 60),
  category text not null default 'altro'
    check (category in ('ristorante','bar','natura','cultura','mare','altro')),
  notes text check (char_length(notes) <= 500),
  rating int not null default 5 check (rating between 1 and 5),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.posti enable row level security;

-- Lettura: i propri posti + quelli pubblici
create policy "read own or public" on public.posti
  for select using (auth.uid() = user_id or is_public = true);

-- Scrittura: solo i propri
create policy "insert own" on public.posti
  for insert with check (auth.uid() = user_id);

create policy "update own" on public.posti
  for update using (auth.uid() = user_id);

create policy "delete own" on public.posti
  for delete using (auth.uid() = user_id);
