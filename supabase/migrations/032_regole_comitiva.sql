-- 032 — Le regole che una comitiva si da' una volta, invece che ogni volta.
--
-- Cantiere C36 di docs/ROADMAP.md. Ogni passaggio e' deciso da capo: quanto si paga, se
-- chi guida partecipa, quanti si sta in macchina. Sono tre cose che una comitiva decide
-- **una volta** e poi da' per scontate — tanto che quando qualcuno le infrange nessuno
-- se ne accorge, perche' non sono scritte da nessuna parte.
--
-- ── Tre colonne su `groups`, non una tabella `regole` ──────────────────────
-- Una tabella a parte servirebbe se le regole fossero un elenco aperto. Sono tre, sono
-- le tre che la roadmap nomina, e ognuna e' un attributo della comitiva come il nome.
-- Una tabella chiave/valore le farebbe diventare testo da interpretare, e la prima cosa
-- che si perde e' il vincolo — «quota fissa» diventerebbe una stringa che puo' valere
-- «cinque euro» o «5» o «tanto».
--
-- ── **Il database non le fa rispettare, ed e' la decisione** ───────────────
-- Nessun trigger, nessun check che leghi `rides` a queste colonne: si puo' pubblicare
-- un'auto che le infrange, e la si vede infrangerle. La roadmap lo dice in cinque
-- parole — «le eccezioni si vedono perche' sono eccezioni» — e sono la specifica.
--
-- Il motivo per cui conta: una regola di comitiva non e' un vincolo di integrita'. «Chi
-- guida non paga» e' una convenzione fra amici, e la sera che qualcuno fa un'eccezione
-- deve poterla fare — altrimenti l'unica strada e' cambiare la regola del gruppo per
-- tutti, che e' un modo di mentire al database per fare una cosa normale. Un vincolo
-- che si aggira spegnendolo non e' un vincolo: e' un ostacolo che insegna a spegnere i
-- vincoli. Le regole di integrita' vere restano quelle di 004, e sono un'altra specie:
-- «due persone sullo stesso sedile» non e' un'eccezione, e' un errore.
--
-- Conseguenza pratica: l'avviso che dice «stai andando contro la regola» sta nel
-- client, ed e' un avviso — non un rifiuto.

alter table public.groups
  add column if not exists regola_quota          numeric(6,2),
  add column if not exists regola_guida_non_paga boolean not null default false,
  add column if not exists regola_max_posti      int;

alter table public.groups drop constraint if exists groups_regola_quota_sensata;
alter table public.groups add constraint groups_regola_quota_sensata
  check (regola_quota is null or (regola_quota >= 0 and regola_quota <= 100));

alter table public.groups drop constraint if exists groups_regola_posti_sensati;
alter table public.groups add constraint groups_regola_posti_sensati
  check (regola_max_posti is null or regola_max_posti between 1 and 6);

-- Chi le scrive: nessuna policy nuova. `groups update owner` (003) nomina gia'
-- `owner_id`, e le regole della comitiva sono di chi la possiede — la stessa persona
-- che puo' togliere un membro. Aggiungere colonne a una tabella con RLS non allarga la
-- scrittura, ed e' la nota che la 025 ha lasciato scritta perche' e' l'errore di C21 e
-- C22 al contrario: vale la pena ridirlo invece di lasciarlo dedurre.
--
-- Chi le legge: `groups read member`, cioe' la comitiva. Devono essere leggibili da
-- tutti quelli a cui si applicano, o non sono regole — sono le preferenze di uno.

insert into public.schema_migrations (version) values ('032_regole_comitiva') on conflict do nothing;
