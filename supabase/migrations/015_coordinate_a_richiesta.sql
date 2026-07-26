-- 015 — Le coordinate di partenza si chiedono, non arrivano da sole.
--
-- Cantiere C21 di docs/ROADMAP.md, primo dei due file. Nasce da un buco della 014, e il
-- buco e' di forma: **una policy RLS e' di riga, non di colonna.** Chi vede un passaggio
-- perche' e' 'zona' o 'pubblico' riceve la riga intera, `origin_lat` e `origin_lon`
-- comprese — e il punto di partenza di una persona puo' essere casa sua al metro. C14
-- aveva smesso di *offrire* quell'indirizzo con un click; il dato pero' continuava a
-- uscire, e chi interroga l'API a mano non passa dall'interfaccia.
--
-- Perche' una funzione e non una vista o un campo calcolato:
--
--   * un **campo calcolato** di PostgREST riceve la riga intera (`partenza(rides)`), e un
--     riferimento a riga intera in Postgres pretende il privilegio sulla tabella tutta:
--     sarebbe incompatibile con il permesso per colonna che mette la 016;
--   * una **vista** avrebbe funzionato, ma avrebbe spostato tutte le query della Home su
--     un oggetto nuovo, con l'incorporamento (guidatore, sedili, commenti) da riverificare
--     in un colpo solo su un sito che si pubblica facendo merge. Una funzione in piu'
--     lascia intatto quello che gia' gira: se manca, il link torna a cercare il nome del
--     luogo — cioe' com'era prima di C14, non una schermata rotta.
--
-- Questo file **aggiunge** e basta, quindi va applicato **prima** di pubblicare il codice
-- che se ne serve. Il file che toglie e' la 016, e va dopo → supabase/README.md.

-- Chi puo' sapere da dove parte davvero un passaggio: chi e' della comitiva che lo ospita,
-- o chi ha un posto su quell'auto. Vederlo (perche' e' in zona o pubblico) non basta:
-- e' esattamente la differenza che C21 ripristina.
--
-- Il primo controllo e' `passaggio_visibile`, non una scorciatoia: senza, questa funzione
-- direbbe "no" a un estraneo ma "si'" a un membro di un passaggio che nel frattempo e'
-- diventato invisibile per un blocco. La regola di visibilita' resta in un posto solo.
create or replace function public.coordinate_visibili(auto uuid) returns boolean
language plpgsql security definer stable set search_path = public as $$
declare
  gruppo uuid;
begin
  if not public.passaggio_visibile(auto) then return false; end if;
  select group_id into gruppo from rides where id = auto;
  if gruppo is null then return false; end if;
  return public.is_member(gruppo) or public.ho_un_posto(auto);
end; $$;

-- Le coordinate dei passaggi che si stanno guardando, in una richiesta sola. Torna una
-- riga solo per quelli a cui si ha diritto: gli altri semplicemente non compaiono, invece
-- di comparire con due null che sembrerebbero "non l'ha segnata nessuno".
--
-- `ids[1:500]` non e' scaramanzia: l'elenco arriva dal client e questa funzione e'
-- security definer, quindi il tetto lo mette lei. Una giornata di passaggi sta in due
-- cifre; cinquecento e' gia' oltre ogni uso vero.
create or replace function public.coordinate_passaggi(ids uuid[])
returns table (ride_id uuid, origin_lat double precision, origin_lon double precision)
language sql security definer stable set search_path = public as $$
  select r.id, r.origin_lat, r.origin_lon
  from rides r
  where r.id = any (ids[1:500])
    and r.origin_lat is not null
    and public.coordinate_visibili(r.id)
$$;

insert into public.schema_migrations (version) values ('015_coordinate_a_richiesta') on conflict do nothing;
