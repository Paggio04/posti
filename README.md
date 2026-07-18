# 📍 Posti

App web per salvare i tuoi luoghi preferiti e condividerli con la community.

## Stack

- **Frontend:** HTML/CSS/JS vanilla (nessuna build, deploy statico)
- **Backend:** [Supabase](https://supabase.com) — autenticazione email/password + database Postgres con Row Level Security
- **Hosting:** [Netlify](https://netlify.com)

## Setup

1. Esegui `supabase-setup.sql` nel SQL Editor di Supabase (crea tabella `posti` + policy RLS).
2. In `config.js` inserisci URL e anon key del progetto (Dashboard → Settings → API).
3. Deploy: collega la repo a Netlify, nessun build command, publish directory = root.

## Sicurezza

La anon key è pubblica per design: ogni accesso ai dati passa dalle policy RLS
(ognuno legge i propri posti + quelli pubblici, scrive solo i propri).
