# 📍 Posti

Chi guida oggi? Chi sale? App per organizzare i passaggi in macchina della comitiva:
i guidatori pubblicano la macchina del giorno, gli altri prenotano il posto tappando sul sedile.

## Stack

- **Frontend:** HTML/CSS/JS vanilla (nessuna build, deploy statico)
- **Backend:** [Supabase](https://supabase.com) — autenticazione email/password + database Postgres con Row Level Security
- **Hosting:** [Netlify](https://netlify.com)

## Setup

1. Esegui `supabase-setup.sql` nel SQL Editor di Supabase (tabelle `profiles`, `rides`, `seat_claims` + RLS + trigger profilo).
2. In `config.js` inserisci URL e anon key del progetto (Dashboard → Settings → API).
3. Deploy: collega la repo a Netlify, nessun build command, publish directory = root.

## Sicurezza

La anon key è pubblica per design: ogni accesso ai dati passa dalle policy RLS.
Tutti gli utenti autenticati vedono passaggi e prenotazioni; ognuno prenota/lascia
solo il proprio posto (max 1 per macchina, vincolo unique), il guidatore gestisce
la propria macchina e può liberare i sedili.
