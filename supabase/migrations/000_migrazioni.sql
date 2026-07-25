-- 000 — Registro delle migrazioni applicate.
-- Ogni file numerato si chiude registrando qui il proprio nome: cosi' guardando questa
-- tabella si sa quale schema e' davvero applicato, invece di andare a memoria.
-- Applicare i file in ordine crescente dal SQL editor di Supabase.

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Nessuno ci scrive dal client: la tabella e' fatta per essere letta dalla dashboard.
alter table public.schema_migrations enable row level security;

insert into public.schema_migrations (version) values ('000_migrazioni') on conflict do nothing;
