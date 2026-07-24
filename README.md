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

## Documentazione

- [SECURITY.md](SECURITY.md) — stato di sicurezza, affidabilità, testing per ogni area
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — diagramma, schema dati, contratto API
- [docs/adr/](docs/adr/) — decisioni architetturali
- CI: GitHub Actions su ogni push (lint bloccante, scan segreti)

## Sicurezza

La anon key è pubblica per design: ogni accesso ai dati passa dalle policy RLS.
Tutti gli utenti autenticati vedono passaggi e prenotazioni; ognuno prenota/lascia
solo il proprio posto (max 1 per macchina, vincolo unique), il guidatore gestisce
la propria macchina e può liberare i sedili.

## Strumenti di sviluppo (MCP)

`.mcp.json` registra il server MCP di [21st.dev](https://21st.dev) (transport HTTP)
utilizzabile da Claude Code. La chiave API **non** è committata nel repo: imposta la
variabile d'ambiente `TWENTYFIRST_API_KEY` prima di avviare `claude` e approva il
server al primo utilizzo.
