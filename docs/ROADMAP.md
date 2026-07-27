# Roadmap — da app della comitiva a prodotto aperto

Questo file è il piano di lavoro di WeTransport: cosa vogliamo che diventi, in che ordine, e
quando ogni pezzo si può dire finito. Nasce dall'intervista del 24/07/2026.

Regola d'uso: un cantiere alla volta, su un branch, con il suo collaudo. Si aggiorna man mano.
Il *perché* delle scelte architetturali sta in `docs/adr/`; qui sta il *cosa manca*.

---

## Obiettivo

Portare WeTransport da **app privata di una comitiva** (oggi: online, funzionante, usata da
nessuno) a **prodotto utilizzabile da chiunque**, senza mai lasciare l'app esposta nel frattempo.

Due traguardi distinti, in quest'ordine:

| | Traguardo | Vuol dire |
|---|---|---|
| **T1** | **Pronta per la comitiva** | I miei amici si registrano e la usano per i passaggi veri, senza che io spieghi niente. Niente dati visibili a chi non c'entra. Posso pubblicare senza paura di rompere. |
| **T2** | **Aperta a chiunque** | Chiunque si registra, crea o entra in una comitiva, e può trovare passaggi anche fuori dal proprio gruppo. Con gli strumenti che servono quando si sale in macchina con sconosciuti. |

Non c'è scadenza. C'è un vincolo: **T1 completo prima di iniziare T2**, perché T2 apre l'app a
persone che non conosco e ogni buco aperto in quel momento è un problema reale, non teorico.

---

## Decisioni prese (intervista 24/07/2026)

| # | Decisione | Scelta | Alternative scartate |
|---|---|---|---|
| **D1** | Passaggi senza gruppo | **Spariscono.** Ogni passaggio, richiesta e commento appartiene a una comitiva. La ricerca "fuori dal mio gruppo" torna dopo, come funzione progettata (C9), non come effetto collaterale. | Bacheca pubblica subito; schema nuovo da zero |
| **D2** | Visibilità profili | **Solo chi condivide almeno un gruppo con me.** Quando arriverà C9, si estende a "…o chi guida un passaggio che posso vedere" — senza quella estensione l'app mostrerebbe passaggi senza nome. | Solo stessa auto (rompe la lista membri); lasciare aperto |
| **D3** | Catena di deploy | **Anteprima + test bloccanti + migrazioni numerate.** `main` resta il deploy, ma ci arriva solo roba già verificata su un'anteprima. Lo schema smette di essere un file copiato a mano. | Lasciare com'è; secondo progetto Supabase di staging (rimandato a C9, quando i dati sono di sconosciuti) |
| **D4** | Dove vive il piano | **Questo file.** Approvato una volta, eseguito cantiere per cantiere. | Issue GitHub; nessun piano |

Il database **non** viene riscritto: l'isolamento fra comitive esiste già (`groups`,
`group_members`, `is_member()`). Quello che manca è togliere le righe orfane e stringere due
policy troppo larghe.

---

## Dove siamo (26/07/2026)

**Fasi 0-3 chiuse, e della Fase 4 mancano solo le notifiche.** `main` è al merge della PR #3.
Migrazioni 000-014 applicate in produzione, ramo protetto da un ruleset versionato, e il sito vivo
serve tutto quello che segue:

| Cantiere | Stato |
|---|---|
| C12 PWA | fatto nel codice, **da installare su un telefono vero** |
| C13 notifiche a scheda chiusa | **da fare**, e bloccato su cose che il repo non può fare: chiavi VAPID, deploy di una Edge Function, `pg_cron` |
| C14 servizi esterni | **chiuso** (Web Share, `.ics`, navigazione sul punto vero) |
| C15 estetica | fatto al secondo tentativo; il giudizio finale è di chi la usa |
| C18 standard dello Starter | **chiuso nei due versi**: il 27/07/2026 le lezioni sono tornate nello Starter del vault (`Permissions-Policy`, migrazioni numerate, ordine codice/schema, «provalo al contrario») |
| C21 coordinate nel payload | **fatto** (`015` + `016`), **da applicare in produzione nell'ordine giusto** |

**T1 è raggiunto sul piano tecnico.** Quello che manca per dire "pronta per la comitiva" non è
codice: è **gente vera che la usa**, e un collaudo a video che non è mai stato fatto. Sotto, cosa
esattamente.

### Il difetto peggiore della Fase 4, e perché nessun controllo lo vedeva

`Permissions-Policy: geolocation=()` teneva spenta la geolocalizzazione **anche per la pagina
stessa**. Quindi da quando C9 esiste, sul sito vivo: "Parto da qui" falliva sempre, nessun passaggio
poteva avere coordinate, `visibilita = 'zona'` era irraggiungibile perché il form la rifiuta senza
coordinate, e la zona sul profilo non si impostava. **Un cantiere intero, pubblicato e con i suoi
test verdi, inerte.** Lint, sintassi e test sullo schema non potevano trovarlo: un header non è né
codice né schema. Ora c'è uno smoke test che lo verifica in un browser.

### Cosa non è stato verificato da un essere umano

Tutto quello che segue è verificato **automaticamente** e da nessun altro. Serve un telefono e due
account veri in due comitive diverse:

- **C9:** "Parto da qui" con GPS vero; pubblicare in **zona**; un secondo account entro 25 km lo
  vede e uno fuori raggio no
- **C14:** il `.ics` si apre in Calendario **con l'ora giusta**; il link "Naviga al ritrovo" da
  dentro la comitiva e "Punto di ritrovo su Maps" da fuori (è la regola di `coordinateVisibili()`:
  il punto di partenza di una persona può essere casa sua)
- **C12:** installarla da iOS e da Android, avvio senza barra del browser, l'icona nella maschera
  circolare di Android (le PNG sono `purpose: "any"`, non `maskable`), modalità aereo
- **C15:** la prova del nove — coperti logo e nome, si capisce che è questa app?
- **Fase 3 intera:** segnalazione (il segnalato non deve saperlo), blocco nei due sensi,
  sospensione, esportazione, e **la cancellazione di un account che possiede una comitiva**, che è
  il controllo più importante perché un errore lì danneggia gli altri

### Le quattro cose che il repo non può fare da solo

| Cosa | Dove | Stato |
|---|---|---|
| Titolare del trattamento | `privacy.html` | **fatto** |
| Regione del progetto Supabase | Supabase → Settings → General | **fatto** — `eu-west-2`, cioè **Londra**: fuori dall'Unione, e l'informativa lo dice citando l'adeguatezza |
| Revocare il token Supabase del 24/07 | Supabase → Account → Access Tokens | **da fare** |
| Due account di prova + segreti `WT_TEST_*` | Supabase + GitHub Secrets | assenti |

### Tre lezioni pagate, che vale rispettare

1. **Le coordinate speculari si calcolano, non si scrivono.** Le ruote dell'auto erano fuori di 4px
   con quelle di sinistra tagliate dal bordo, le file non equidistanti, i tondi della navigazione
   posizionati a occhio. Ora c'è `specchia(x, w)` e le misure della barra sono variabili da cui si
   ricava tutto.
2. **Un controllo che misura la cosa sbagliata è peggio di nessun controllo**, perché autorizza a
   chiudere il caso. La mia misura del tondo diceva "centrato a 0.02px" ignorando un bordo da 4px;
   il difetto l'ha trovato l'occhio del proprietario. Lo stesso vale per uno `str.replace` muto: ha
   fatto credere per due commit che la versione della cache fosse salita.
3. **La CI ha avuto ragione tre volte di fila**, e due volte contro una mia diagnosi. Se un test è
   rosso e la spiegazione comoda è "il test è fragile", quasi sempre la spiegazione è sbagliata.

### L'ordine di pubblicazione, che alla 012-014 era l'opposto della 011 — *storia, e la regola che resta*

> Questa sezione descrive la pubblicazione della Fase 3, che è **già avvenuta** (male, vedi sotto).
> Le migrazioni 012-014 sono applicate dal 25/07/2026. Resta per la regola, non per le istruzioni.

**Andavano applicate prima del codice**, e non è andata così: il codice è stato pubblicato per
primo, quindi il sito è rimasto rotto — nome di tutti come prefisso dell'email, pubblicazione di
un'auto in errore — finché le tre migrazioni non sono state applicate a mano dal SQL editor. Danno
piccolo solo perché nessuno la stava usando.

Perché andavano prima: `profiles.sospeso`, `profiles.zona_lat`, `rides.visibilita` e la tabella
`user_reports` non esistevano, e il codice nuovo le legge al primo caricamento — `ensureProfile`
chiede `sospeso`, `loadBlocked` interroga `user_blocks`, la pubblicazione scrive `visibilita`.

Cosa succede davvero se si pubblica il codice prima (tracciato, non supposto): la pagina **si apre**
— supabase-js restituisce l'errore invece di sollevarlo — ma `ensureProfile` non trova il profilo,
ricade sul ripiego e **il nome di tutti torna a essere il prefisso dell'email**; soprattutto,
**pubblicare un'auto fallisce**, perche' l'insert contiene una colonna che non esiste. Non e' una
schermata bianca, e' di peggio: sembra funzionare e non fa la cosa per cui esiste.

Con la 011 la regola era il contrario, e non è una contraddizione: quella **restringeva** letture che
il codice vecchio non sapeva gestire, quindi andava dopo. Queste tre **aggiungono** cose che il
codice nuovo pretende, quindi vanno prima. La regola vera, che vale per entrambe:

> Si applica per prima la metà che l'altra non può ignorare. Una migrazione che toglie va dopo il
> codice che regge; una migrazione che aggiunge va prima del codice che se ne serve.

Applicarle mentre il sito vivo serve ancora l'app vecchia **non rompe niente**, ed è il motivo per
cui si può fare in quest'ordine: le colonne nuove hanno un default che conserva il comportamento di
oggi (`visibilita = 'gruppo'`), le tabelle nuove l'app vecchia non le guarda, e le restrizioni non
hanno su cosa mordere — nessun blocco, nessun sospeso, nessun passaggio aperto fuori dalla comitiva.

---

## Fase 0 — Rete di sicurezza (prima di toccare qualsiasi altra cosa)

Oggi ogni push su `main` è la pubblicazione, e gli smoke test girano **dopo**, contro il sito
vivo: se rompo qualcosa, lo rompo davanti a chi sta usando l'app. Tutto il resto della roadmap
tocca sicurezza e schema, cioè le cose dove sbagliare costa di più. Questa fase viene prima.

### C1 — Anteprima per ogni modifica, test che bloccano — *fatto e collaudato sulla PR #1*
- **Obiettivo:** poter provare una modifica a un indirizzo temporaneo prima che la vedano gli utenti.
- **Fatto:** il job `e2e-anteprima` aspetta lo stato di deploy che Netlify scrive sul commit della
  PR, ricava da lì l'indirizzo dell'anteprima e ci lancia Playwright; niente più `sleep 60` alla
  cieca. I test leggono l'indirizzo da `BASE_URL` (`playwright.config.js`) invece di averlo scritto
  dentro. Il vecchio job sul sito vivo resta come rete di sicurezza dopo la pubblicazione
  (`e2e-produzione`), ma non è più l'unica difesa.
- **I Deploy Preview su Netlify erano già attivi**: verificato sulla PR #1, che ne ha avuto uno.
- **Collaudato sulla PR #1** (24/07/2026): Netlify ha pubblicato l'anteprima, il job l'ha trovata
  dallo stato del commit in pochi secondi (non dal ripiego, che avrebbe atteso dieci minuti) e ha
  lanciato i tre smoke test contro `https://deploy-preview-1--wetransport.netlify.app`. Tutti verdi,
  **prima** di qualsiasi merge. Il job sul sito vivo è stato saltato, come previsto sulle PR.
- **Un difetto trovato dal primo giro di CI:** il workflow era fissato a Node 20, mentre
  html-validate 11 usa `fs.globSync`, che esiste da Node 22. In locale passava (Node 22), in CI no.
  Alzato a Node 24 e dichiarato `engines` in `package.json`.
- **Controlli obbligatori: fatti** (25/07/2026, ruleset `Claude`). `checks`, `schema` ed
  `e2e-anteprima` sono richiesti su `main`, insieme al divieto di cancellare il ramo e di
  riscriverne la storia; nessuna eccezione, nemmeno per il proprietario. La configurazione è
  copiata in `.github/rulesets/main.json` — vedi `.github/rulesets/README.md`. **C1 è chiuso.**
- Nota per la prossima volta: la PR #1 è stata pubblicata *prima* che la regola esistesse, quindi
  era verde per fortuna e non per costruzione. La rete di sicurezza va accesa prima di servirsene,
  non dopo.

### C2 — Migrazioni numerate al posto del file unico — *fatto e verificato*
- **Obiettivo:** sapere sempre quale schema è davvero applicato.
- **Fatto:** schema spezzato in 10 file in `supabase/migrations/`, ognuno ripetibile e registrato
  in `public.schema_migrations`. La CI (job `schema`) parte da un Postgres vuoto, applica tutto in
  ordine e poi riapplica tutto: se una delle due passate fallisce è rossa. Il perché in
  `docs/adr/002-migrazioni-numerate.md`.
- **Verificato su Postgres 16 vuoto:** le migrazioni ricreano il backend da zero e si possono
  rilanciare. Confronto con lo schema del vecchio file: 8 tabelle, 43 colonne, 9 funzioni, 5
  trigger, 14 indici **identici**, più una policy recuperata.
- **Due difetti trovati facendolo**, peggiori del doppione che cercavo:
  - `supabase-setup.sql` **non ricreava il backend da zero**, contrariamente a quanto dicevano
    README e ADR 001: alla riga 234 creava una policy su `ride_comments`, tabella definita alla
    riga 338. Su un database vuoto si fermava lì.
  - Conseguenza sulla ricostruzione da zero: la policy `admin all` su `ride_comments` non veniva
    mai creata. Ora c'è. (In produzione invece c'era: vedi la correzione qui sotto.)
- **Applicate in produzione il 24/07/2026**, tutte, in ordine. `schema_migrations` ne registra 11.
- **Una deduzione da correggere:** avevo scritto che l'amministratore non aveva mai potuto moderare
  i commenti. Falso sul database vivo: leggendo `pg_policies` prima di applicare, la policy
  `admin all` su `ride_comments` c'era già — era stata incollata a parte, dopo la creazione della
  tabella. Il difetto riguardava la ricostruzione da zero, non la produzione.

### C3 — Controlli locali accesi — *fatto*
- **Obiettivo:** `pre-volo.py` smette di saltare metà dei controlli.
- **Fatto:** `package.json` con ESLint e html-validate come dipendenze **di sviluppo** (il sito
  resta senza build: servono agli strumenti, non all'app). Le regole ESLint non sono più scritte
  dentro `ci.yml` e rigenerate a ogni build: stanno in `eslint.config.mjs`, versionate, stessa
  fonte in locale e in CI. Regole html-validate in `.htmlvalidate.json`.
- **`npm run check`** fa lint + validazione in un colpo; la CI ora chiama gli stessi comandi.
- **Validazione HTML ora bloccante** invece che informativa (`|| true`), perché è a zero errori.
  Le regole di puro stile sono spente (`void-style`, `no-inline-style`, `no-redundant-for`) e
  `no-implicit-button-type` resta come avviso: 20 bottoni senza `type` esplicito, roba da C7.
- **Tre difetti di accessibilità corretti** per arrivarci: la `<label>` della password teneva
  dentro anche il bottone dell'occhio (una etichetta per due controlli), il bottone del nome
  utente non aveva testo accessibile finché il JS non lo riempiva, il titolo del dialogo era un
  `<h3>` vuoto.
- **Collaudo fatto:** schermata di accesso resa in locale e confrontata pixel per pixel prima e
  dopo la modifica: **identica**. Alla prima passata non lo era — il campo password aveva perso il
  peso del carattere che ereditava dalla `<label>` — ed è stato sistemato.

---

## Fase 1 — Chiudere i due buchi (T1)

### C4 — Tutto dentro un gruppo *(decisione D1)* — *scritto e verificato sul database; resta il collaudo a video*
- **Obiettivo:** nessuna riga di dati senza una comitiva che la possiede.
- **Database** (`010_gruppo_obbligatorio.sql`): `group_id` obbligatorio su `rides` e
  `ride_requests`; policy e trigger senza i rami `is null` e senza i `coalesce(..., '000...')`;
  le righe orfane finiscono nelle tabelle `*_archivio_senza_gruppo` (RLS attiva, nessuna policy:
  restano nel database, invisibili dal client) e poi spariscono da quelle vive. **Niente si cancella
  senza essere prima copiato.**
- **Falla in più trovata e chiusa:** per pubblicare bastava dichiararsi guidatore. Chi conosceva
  l'id di un gruppo poteva pubblicarci dentro un'auto **senza esserne membro**. Ora la policy di
  scrittura richiede l'appartenenza — su auto, richieste, commenti e lista d'attesa.
- **App:** sparisce la pillola "Tutti"; al primo accesso o crei un gruppo o entri con un codice;
  la comitiva scelta si ricorda fra una sessione e l'altra; senza comitiva la Home mostra solo il
  benvenuto invece di una schermata vuota e inerte.
- **Incoerenza sanata:** con "Tutti" attivo, la Home mostrava solo i passaggi *senza gruppo*, mentre
  Storico e Statistiche mostravano *tutto il visibile*. Stessa pillola, tre significati diversi.
- **Verificato su Postgres 16** (`supabase/test/`, e ora in CI a ogni push):
  - Carla, che sta in un'altra comitiva, vede 0 auto, 0 prenotazioni e 1 solo gruppo (il suo);
  - Bruno, che è del gruppo, vede l'auto;
  - Carla **non riesce** a pubblicare nel gruppo di Ada;
  - un'auto senza comitiva **non si inserisce più**;
  - due persone sullo stesso sedile: ne passa una sola;
  - aggiornamento dal vecchio schema con dati orfani dentro: archivio pieno, dati del gruppo
    intatti, archivio invisibile al client.
- **Applicata in produzione il 24/07/2026.** Stato prima: 4 utenti, 1 gruppo con 0 membri, 1 auto
  senza comitiva. Dopo: quell'auto è nell'archivio, `group_id` è obbligatorio su `rides` e
  `ride_requests`, le policy nuove sono attive. Nessun dato perso.
- **Disallineamento chiuso il 25/07/2026**: la PR #1 è stata pubblicata (merge alle 02:01, CI verde
  su `main`, deploy Netlify andato, smoke sul sito vivo verdi). Fino a quel momento il database non
  accettava più passaggi senza comitiva mentre il sito serviva ancora l'app vecchia, quella con la
  pillola "Tutti": Home vuota e pubblicazione in errore. Con 0 membri nei gruppi non l'ha visto
  nessuno.
- **Collaudo a video: fatto da C8**, con due account veri in due comitive diverse. Restano da vedere
  da utente vero, non da test, le viste Storico e Statistiche.

### C5 — Profili chiusi *(decisione D2)* — *fatto, applicato in produzione*
- **Obiettivo:** smettere di mostrare nome e avatar di tutti a tutti.
- **Database** (`011_profili_chiusi.sql`): `profiles read using (true)` diventa "il mio profilo,
  più chi condivide con me almeno una comitiva, più l'amministratore". Il confronto passa da
  `condivide_gruppo()`, `security definer` per la stessa ragione di `is_member()`: senza, la policy
  su `profiles` interrogherebbe `group_members`, che ha le sue policy, e si andrebbe in ricorsione.
- **Un caso che prima non poteva esistere:** chi **lascia** una comitiva sparisce dai profili
  leggibili, ma le sue auto e le sue prenotazioni restano nello storico. L'app faceva
  `r.driver.display_name` in 14 punti senza rete: con il profilo nascosto l'incorporamento torna
  nullo e **la schermata andava in errore**. Ora tutti passano da `nomeDi()`, che mostra
  "Ex membro". Trovato leggendo il codice dopo aver scritto la policy, non da un test.
- **Verificato su Postgres 16** (nel test di isolamento, quindi anche in CI): chi sta in un'altra
  comitiva vede **un solo profilo, il proprio**; chi è nel gruppo vede sé, Ada e Dino, e **non**
  vede Carla; nessuno perde di vista il proprio profilo, che servirebbe all'app per sapere come ci
  si chiama.
- **Ordine di applicazione, importante:** la 011 va applicata in produzione **dopo** aver pubblicato
  questo ramo, non prima. Restringe letture che il codice vecchio non sa gestire: prima il codice
  che regge i profili nascosti, poi la regola che li nasconde.
- **Applicata in produzione**, nell'ordine giusto: il 25/07/2026 la funzione `condivide_gruppo`
  risponde sul progetto vivo, e la crea solo la 011. Con questa, `schema_migrations` registra tutte
  e 12 le migrazioni presenti nel repo. **Fase 1 chiusa.**
- **Collaudo a video:** account estraneo → home, storico, statistiche, commenti: nessun nome di
  gente fuori dalla propria comitiva, e nessun buco al posto di una persona.

---

## Fase 2 — Rinforzare quello che c'è (T1)

### C6 — Bug noti da chiudere — *fatto*
| Bug | Dove | Stato |
|---|---|---|
| Avatar Google bloccati dalla CSP | `netlify.toml`, `img-src 'self' data:` | **Chiuso.** Chi entrava con Google aveva un avatar che punta a `lh3.googleusercontent.com` e il browser lo bloccava: la funzione era scritta dal 21/07 e non si è mai vista. Aggiunto `https://*.googleusercontent.com` alla sola direttiva `img-src`. |
| `ride_waitlist` definita due volte | `supabase-setup.sql:260` e `:303` | **Chiuso da C2**: nelle migrazioni la lista d'attesa è definita una volta sola. |
| `meta description` mancante | `privacy.html` | **Chiusa.** |

**Collaudo della CSP, fatto col browser e non a occhio:** pagina servita in locale con
*esattamente* l'intestazione di `netlify.toml`, poi due immagini iniettate nel documento. Quella su
`lh3.googleusercontent.com` **non viene più bloccata**; quella su un dominio qualsiasi **continua a
esserlo**. La regola si è aperta quanto serviva e non un dito di più.

### C7 — Revisione integrale di `app.js` — *fatto*
- **Obiettivo:** trovare tutti i bug, non i primi che saltano fuori.
- **Fatto:** lettura riga per riga di tutte le 1334 righe in **una sola passata**, con tutte le
  classi di controllo insieme. Metodo imposto da `Regole.md`, e ha ripagato subito.

**La prima cosa trovata è stato un mio errore.** La passata di C5, fatta cercando i punti con
`grep`, ne aveva mancati **tre**: `Guida ${ride.driver.display_name}` sulla scheda dell'auto, il
testo di condivisione del singolo passaggio, e l'elenco "A bordo" del riepilogo di giornata. Tutti e
tre sarebbero andati in errore con un profilo nascosto — cioè proprio il caso che C5 introduceva.
È l'esempio di manuale del perché `Regole.md` vieta le passate incrementali.

**Difetti corretti**

| Cosa | Dove | Perché contava |
|---|---|---|
| Tre letture di profilo senza rete | scheda auto, condivisione, riepilogo | Errore in pagina con un profilo nascosto (regressione di C5) |
| `innerHTML` con l'indirizzo dell'avatar | `renderProfile` | `SECURITY.md` dichiara "nessun `innerHTML` con input utente": non era vero. L'indirizzo arriva dai metadati OAuth o dal profilo, modificabile via API; in una stringa HTML basta una virgoletta per uscire dall'attributo. Ora si costruisce col DOM |
| Sei operazioni che fallivano in silenzio | libera posto, annulla passaggio, esci dal gruppo, esci dalla lista, elimina commento | L'app diceva "fatto" anche quando il database rifiutava. Ora ognuna controlla l'errore e lo mostra |
| `clearMyRequest()` non attesa, due volte | pubblicazione auto, prenotazione posto | La cancellazione poteva arrivare **dopo** il ricaricamento: restavi fra chi "cerca un passaggio" pur essendo a bordo, fino al refresh dopo |
| Escape dei nomi solo su `<` | statistiche, "tocca a te guidare" | Una `&` nel nome rompeva il testo. Ora un solo `escapeHtml()` per entrambi |
| Codice morto di C4 | `renderWalkers`, `clearMyRequest`, riepilogo | Ramo "senza gruppo" irraggiungibile, e un ternario con i due rami identici |

**Trovati e lasciati stare, con motivo**
- La notifica "movimenti sui sedili" scatta anche per una propria azione, se la scheda è in
  secondo piano. Fastidio minimo, e la logica per distinguere costa più di quanto renda: se dà
  noia si risolve in C13, dove le notifiche vengono ripensate.
- Il conto alla rovescia "parte tra N minuti" è calcolato al disegno e non si aggiorna da solo.
  Un timer per tenerlo vivo è lavoro da C15, non un difetto di correttezza.
- La chiave `posti-howto-done` in `localStorage` porta ancora il vecchio nome del progetto.
  Rinominarla farebbe ricomparire il banner a chi l'aveva già chiuso: non vale il cambio.
- Il conteggio sul bottone dei commenti non si aggiorna dopo averne scritto uno, fino al
  ricaricamento successivo. Cosmetico.
- *(trovate durante C10, con un confronto fra le classi usate dal JS e quelle definite nel
  CSS)* Tre classi non esistono in `style.css`: `maps-link` sul link al ritrovo, che quindi
  resta un'ancora senza stile, e i due modificatori `fuel` e `waitlist-row`, che non
  cambiano niente rispetto alla classe di base. Nessuna rompe la pagina; darle uno stile e'
  lavoro di C15, dove l'aspetto si decide tutto insieme invece che un pezzo per volta.

**Collaudo:** lint e validazione verdi, schermata di accesso identica al riferimento pixel per
pixel. Le correzioni sui percorsi con utenti veri (posto liberato, passaggio annullato, uscita dal
gruppo) restano da vedere a video: sono esattamente i flussi che C8 deve coprire con i test.

### C8 — Test end-to-end sui flussi veri — *fatto*
- **Obiettivo:** gli smoke coprivano solo la schermata di accesso. Il cuore dell'app — pubblicare,
  prenotare, vedere l'aggiornamento in tempo reale — non era testato da niente.
- **Fatto:** `tests/flussi.spec.js`, un viaggio completo con **due utenti in due schede separate**:
  Ada crea la comitiva e pubblica l'auto → Bruno, che non è del gruppo, **non vede niente** →
  Bruno entra col codice e la vede → prenota un sedile → **Ada lo vede senza ricaricare** (realtime)
  → pulizia (passaggio annullato, entrambi escono dal gruppo). Zero errori in pagina, verificato.
- **Girato per davvero**, con due account veri sul Supabase di produzione, creati per l'occasione e
  **cancellati subito dopo**. È anche il collaudo a video che mancava a C4: l'isolamento fra comitive
  visto con due utenti, non solo dedotto dalle policy.
- **Ha trovato subito un bug vero, e non del test:** `render()` chiudeva con `switchView('home')`
  dopo una catena di attese (profilo, gruppi). **Chi tocca una scheda mentre l'app carica si vedeva
  annullare il tocco e riportare alla Home.** Su telefono lento quella finestra dura secondi. Ora la
  Home si impone solo se nessuna scheda è già aperta.
- **Verificata anche la verifica:** tolta la correzione, il test torna a fallire; rimessa, passa.
  Un test che non fallisce quando il bug c'è non serve a niente.
- **In CI** il flusso a due utenti gira sull'anteprima **solo se esistono i segreti**
  `WT_TEST_EMAIL_A`, `WT_TEST_EMAIL_B`, `WT_TEST_PASSWORD` (due account di prova già confermati).
  Senza, si salta e restano gli smoke: nessun falso rosso su chi clona il repo.
- **Resta da fare a mano:** creare i due account di prova stabili e metterne le credenziali nei
  segreti del repo, se si vuole quel test a ogni PR. Nell'ultima PR i tre segreti erano vuoti e il
  flusso a due utenti si è saltato: `1 skipped, 3 passed`. Il ripiego funziona come previsto, ma il
  cuore dell'app in CI resta scoperto.

---

## Fase 3 — Aprire al pubblico (T2)

Da qui in poi l'app la usano persone che non conosco. Nessuno di questi cantieri parte prima che
la Fase 1 sia chiusa.

### C9 — Passaggi in zona *(la D dell'intervista)* — *fatto, da collaudare a video*
- **Obiettivo:** trovare un passaggio da qualcuno che sta in zona ma non è della mia comitiva.
- **Fatto** (`014_passaggi_in_zona.sql` + interfaccia): campo `visibilita` sul passaggio
  (`gruppo` / `zona` / `pubblico`), coordinate di partenza e arrivo, zona sul profilo, e
  l'estensione di D2 — si legge il nome di chi guida un passaggio che si vede, e di chi ci è
  a bordo.
- **Il default non cambia niente.** Un passaggio nasce `gruppo`, cioè esattamente com'era prima:
  chi vuole uscire dalla comitiva lo deve dire. È l'unico modo di aggiungere un'apertura senza
  aprire retroattivamente quello che c'è già.
- **Tre scelte, nessuna obbligata:**
  - **Niente geocodifica di terzi.** D6 dice API native del browser: le coordinate vengono da
    `navigator.geolocation`, cioè dal telefono di chi pubblica, e il nome del luogo resta il testo
    libero di prima. Un geocoder sarebbe una voce in più nella CSP e un terzo che vede dove vanno
    gli utenti.
  - **La zona è un punto più un raggio (25 km)**, non un comune: i confini amministrativi non
    dicono niente su quanto è comodo un passaggio, e servirebbe un elenco da mantenere. Il raggio
    sta in `raggio_zona_km()`, una riga sola da cambiare.
  - **Il gruppo resta obbligatorio anche per i passaggi pubblici** (D1). Un passaggio pubblico è di
    una comitiva che si lascia guardare da fuori, non un passaggio senza padrone: archiviazione e
    regole di scrittura restano quelle. Si può aprire il proprio passaggio, non pubblicarne uno in
    casa d'altri.
- **La regola di visibilità sta in una funzione sola**, `passaggio_visibile()`, e non
  nell'espressione della policy: serve anche alla policy dei profili, che altrimenti dovrebbe
  riscriverla e prima o poi divergere. Le due sottoquery di `profiles read` leggono `rides` e
  `seat_claims` con le loro policy attive, quindi vedono esattamente il visibile: se la regola
  cambia, cambiano anche loro da sole.
- **Il blocco viene prima di tutto**, anche di `pubblico`: una persona bloccata non ricompare
  perché qualcuno ha aperto il proprio passaggio a chiunque.
- **Storico e Statistiche restano dentro la comitiva**, di proposito: servono a sapere di chi è il
  turno, e un passaggio preso fuori falserebbe la rotazione. Il sottotitolo di quelle viste lo dice
  già ("Gruppo: …").
- **Difetto trovato facendolo, e non era mio:** aggiungere una colonna a `rides` **rompeva la
  ripetibilità della 010**, che copia nell'archivio con `insert … select *`. Alla seconda passata
  l'insert trovava più colonne della destinazione e il job `schema` diventava rosso. Ora 014
  allinea anche l'archivio, e la regola è scritta lì: chi tocca `rides` tocca anche l'archivio.
- **Verificato:** `supabase/test/verifica-zona.sql`, in CI. Provato al contrario, sei mutazioni su
  sei fanno diventare rosso il test — compresa "raggio a 1000 km" e "il blocco non vince più su
  pubblico".
- **Fatto quando:** cerco un passaggio fuori dal mio gruppo, lo trovo, e continuo a non vedere
  niente dei gruppi a cui non appartengo. **Raggiunto**, ed è il controllo 6 del test.
- **Resta il collaudo a video:** due account veri in due comitive diverse, con la posizione vera del
  telefono. `navigator.geolocation` non si può collaudare da un test di database.

### C10 — Sicurezza delle persone — *fatto, da collaudare a video*
- **Obiettivo:** un'app dove sconosciuti salgono in macchina insieme e non c'è modo di segnalare
  nessuno non è pronta per il pubblico. Vale più di qualsiasi funzione.
- **Fatto** (`012_sicurezza_persone.sql` + interfaccia): tre cose distinte, che si confondono
  facilmente.
  - **Segnalazione**: motivo fra cinque, dettagli facoltativi, e la vedono solo chi la scrive e
    l'amministratore. Il segnalato **non sa di esserlo**: se lo sapesse, segnalare diventerebbe un
    modo per litigare invece che per farsi aiutare. Una sola aperta per coppia, altrimenti chi vuole
    molestare qualcuno lo fa riempiendo la coda dell'amministratore.
  - **Blocco**: decisione propria, immediata, senza passare da nessuno. Vale **nei due sensi** anche
    se lo decide uno solo: spariscono auto, commenti e richieste dell'altro, e non si sale in
    macchina insieme.
  - **Sospensione**: decisione dell'amministratore. Toglie la parola, non la vista — si legge tutto
    e si può ancora annullare quello che si era preso, perché liberare un posto toglie ingombro
    agli altri.
- **Due scelte non ovvie**, entrambe prese guardando cosa succede il giorno dopo:
  - **Il blocco non cancella niente.** L'auto di una persona bloccata sparisce *tranne* se ci sei
    già sopra: nasconderla lascerebbe una prenotazione invisibile e impossibile da annullare. Per la
    stessa ragione al contrario, i sedili occupati restano visibili — un posto preso che risultasse
    libero verrebbe prenotato e poi rifiutato dall'indice unico, con un errore senza spiegazione.
    Sparisce il nome, resta l'ingombro.
  - **Sul nome il blocco è asimmetrico.** Chi blocca continua a leggere il profilo di chi ha
    bloccato; chi subisce il blocco no. Senza, la lista dei bloccati sarebbe un elenco di
    sconosciuti e non si potrebbe più sbloccare nessuno. Resta dentro il vincolo di 011: fuori dalla
    comitiva condivisa non si legge comunque niente, quindi bloccare non è un modo per tenersi
    leggibile una persona.
- **Il punto meno ovvio è la lista d'attesa:** `promote_waitlist()` è `security definer`, quindi non
  passa da nessuna policy e avrebbe fatto salire un bloccato sull'auto di chi l'ha bloccato. La
  ferma un trigger che guarda **le righe**, non `auth.uid()`, perché lì chi scrive non è chi sale.
- **Difetto trovato scrivendo il test, ed è di C2/008:** *il primo amministratore non si poteva
  nominare.* L'update dal SQL editor lo rifiutava il trigger stesso — lì `auth.uid()` è nullo,
  quindi `is_admin()` è falso, quindi "non sei amministratore, non puoi nominarne uno". Non se n'era
  accorto nessuno perché un amministratore non è mai esistito: la coda delle segnalazioni sarebbe
  rimasta senza nessuno che la legge. Corretto in 012.
- **Verificato:** `supabase/test/verifica-sicurezza.sql`, in CI a ogni push, e **provato al
  contrario**: tolta una protezione alla volta, ogni mutazione fa diventare rosso il test. Le due
  che restano verdi sono cinture ridondanti, e nel file c'è scritto quali.
- **Fatto quando** *(criterio originale)*: posso segnalare, bloccare, e vedere le segnalazioni; un
  utente sospeso non entra più. **Con una precisazione presa qui:** sospeso *entra* ma non scrive.
  Il ban vero su `auth.users` richiederebbe una Edge Function con `service_role`, cioè una chiave
  che apre tutto messa in un servizio nuovo: superficie in più per una differenza che l'utente
  vede uguale.
- **Resta il collaudo a video**, che nessun test sostituisce: due account veri, segnalazione,
  blocco, e la coda vista da un amministratore.

### C11 — GDPR completo — *fatto, informativa compresa*
- **Obiettivo:** oggi `SECURITY.md` segna la conformità come parziale, e va bene finché siamo fra
  amici. Con iscritti sconosciuti diventa un obbligo.
- **Esportazione** — "Scarica i miei dati" nel Profilo: un JSON con profilo, comitive, auto, posti,
  richieste, commenti, liste d'attesa, segnalazioni fatte e persone bloccate. Si costruisce nel
  browser **con le query di tutti i giorni**: le policy decidono già cosa esce, quindi una funzione
  che deve solo restituire il visibile non ha bisogno di nessun permesso nuovo.
  - Le segnalazioni **ricevute** non ci sono, di proposito: contengono il racconto di un'altra
    persona, che non diventa esportabile perché parla di te.
- **Cancellazione** (`013_cancella_account.sql`) — "Elimina il mio account" chiama
  `elimina_account()`, `security definer`, **senza parametri**: sa cancellare una persona sola, chi
  la chiama. Dal client non si potrebbe fare altrimenti — l'API di amministrazione vuole la
  `service_role`, cioè la chiave che apre tutto, che nel browser non deve esistere. Questa funzione
  è l'opposto di dare quella chiave al client.
- **Il danno che si stava per fare agli altri:** `groups.owner_id` cascata su `profiles`, quindi la
  cancellazione avrebbe portato via **la comitiva intera**, con le auto e le prenotazioni di tutti
  gli altri membri. Ora il gruppo passa al membro più anziano rimasto; se non è rimasto nessuno, se
  ne va anche lui, perché un gruppo vuoto non è di nessuno. Verificato in
  `supabase/test/verifica-cancellazione.sql`, in CI, e provato al contrario: tolta l'eredità, il
  test diventa rosso su "DANNO AGLI ALTRI".
- **Informativa** riscritta: tabella dato → perché → base giuridica, chi vede cosa, responsabili
  (Supabase e Netlify), tempi di conservazione, i tre diritti che si esercitano da soli dall'app,
  reclamo al Garante, soglia dei 14 anni.
- **Le due cose che il codice non poteva mettere sono state messe**, e per un po' sono state
  riquadri rossi bene in vista invece che frasi plausibili inventate:
  - **il titolare del trattamento** — Elia Paggetti, a titolo personale, con un indirizzo di
    contatto dedicato: la casella personale non finisce su una pagina pubblica;
  - **la regione del progetto**, che l'API davvero non espone — provato, gli header danno solo
    `sb-project-ref`. Ed è la cosa che ha cambiato il paragrafo: `eu-west-2` è **Londra**, non
    Francoforte come dava per scontato l'esempio. I dati escono dall'Unione. È lecito senza nessuno
    strumento aggiuntivo perché il Regno Unito è un paese adeguato — decisione rinnovata il
    19/12/2025, valida fino al 27/12/2031 — ma tacerlo sarebbe stata l'omissione più grossa
    dell'informativa. Ora è scritto, con la fonte.
- **Fatto quando:** un utente esporta e cancella tutto da solo, e la cancellazione porta via anche
  auto, prenotazioni, richieste e commenti. **Raggiunto.** `SECURITY.md` segna la conformità GDPR
  come piena, e la prossima scadenza da guardare è il 27/12/2031, non prima.

---

## Fase 4 — Integrare

### C12 — PWA vera — *fatta nel codice, da installare su un telefono vero*
C'è `sw.js`, ci sono le icone PNG 192 e 512 (generate da `icon.svg`, senza aggiungere nessuna
libreria di conversione al progetto), e c'è `offline.html`.

**La decisione che conta è cosa resta fuori dalla cache**, e sta scritta anche in `sw.js`: tutto
quello che passa da Supabase, e tutto quello che non è `GET`. Sono dati di persone e token di
sessione — una copia in cache sarebbe una copia che nessuno ha chiesto, che "Scarica i miei dati"
non mostra e che "Elimina il mio account" non porta via. Sarebbe C11 al contrario. In cache va solo
il guscio: i file pubblici, identici per tutti.

Un dettaglio che si scopre solo provando: nella cache va messo anche **il modulo di Supabase preso
dal CDN**, perché è il primo `import` di `app.js`. Senza quello "si apre offline" è una promessa che
la prima riga smentisce, e l'app non parte affatto.

L'avviso di rete non è decorazione: da quando l'app si apre offline, una schermata che compare e non
si aggiorna **sembra rotta**. La barra rossa dice che è il segnale che manca, e al ritorno della rete
i passaggi si ricaricano da soli.

*Fatto quando:* installata dal telefono, si apre senza barra del browser e mostra qualcosa di utile
anche offline. **Il worker, la cache e la ricarica offline sono verificati in un browser vero**; la
parte che manca è l'installazione su un telefono, che da qui non si può fare: icona sulla home,
avvio senza barra, e come sta l'icona dentro la maschera di Android (le PNG sono `purpose: "any"`,
non `maskable`: una variante con i margini giusti è un lavoro di disegno, quindi C15).

### C13 — Notifiche a scheda chiusa
Oggi le notifiche esistono solo con la scheda aperta in secondo piano (`maybeNotify`).

**Deciso — tre eventi soli, quelli che cambiano i piani di chi li riceve:**

| Evento | A chi | Perché vale una vibrazione |
|---|---|---|
| Qualcuno prenota un posto nella tua auto | guidatore | Devi sapere chi carichi |
| Si libera un posto dove sei in lista d'attesa | in attesa | È l'unico modo per non perderlo |
| La tua auto parte fra un'ora | guidatore e passeggeri | Il promemoria che evita il buco |

**Esclusi di proposito**: commenti e auto pubblicate. Sono la maggior parte del traffico e
diventerebbero rumore: un'app che notifica troppo viene silenziata, e a quel punto non notifica
più niente. Se serviranno, saranno da attivare a mano, spente di default.

**Come:** Web Push standard (VAPID) sul service worker di C12, tabella delle iscrizioni, Edge
Function Supabase innescata dal database per i primi due eventi, `pg_cron` per il promemoria orario.
Nessun servizio di terzi. *Dipende da:* C12.

### C14 — Servizi esterni — *chiuso*
**Deciso — solo cose che il browser sa già fare, nessun SDK, nessuna voce nuova nella CSP:**

| Cosa | Come | Perché così | Stato |
|---|---|---|---|
| Invita al gruppo | Web Share API nativa (che sul telefono offre WhatsApp da sola) + copia del codice come ripiego | Zero dipendenze, funziona con tutte le app di messaggistica, non solo WhatsApp | **fatto**, `navigator.share` in tre punti di `app.js` |
| Passaggio nel calendario | File `.ics` generato dall'app | Nessun servizio esterno, funziona con Google, Apple e Outlook allo stesso modo | **fatto**, `testoIcs()` |
| Navigazione al ritrovo | Link Maps, con coordinate vere al posto del testo libero | Rimandato dentro C9, che è il cantiere dove nascono i luoghi veri | **fatto**, `linkRitrovo()` |

**Esclusi**: SDK di terzi, analytics, login social oltre a Google. Ogni SDK è codice altrui in
esecuzione dentro la mia pagina e una riga in più nella CSP.

**Navigazione al ritrovo — com'è finita.** C9 aveva creato `origin_lat`/`origin_lon` e lasciato il
link a cercare il testo libero, quindi il ritrovo poteva spostarsi di un chilometro: "piazza" trova
la piazza sbagliata. Ora il link apre il percorso (`maps/dir`) sul punto vero.

Non lo stesso link per tutti, però, e la ragione non è estetica: **la policy di 014 è di riga, non
di colonna.** Chi vede un passaggio `zona` o `pubblico` riceve la riga intera, coordinate comprese,
e il punto di partenza di una persona può essere casa sua al metro. Dentro la comitiva — o avendo un
posto su quell'auto — il punto esatto è quello che serve; da fuori resta la ricerca sul nome del
luogo, che dice la zona e non l'indirizzo. Vale anche per ogni passaggio pubblicato prima della 014,
che coordinate non ne ha.

Da C21 quella prudenza non è più solo del link: **il dato non arriva proprio**, e la decisione la
prende il database invece dell'interfaccia. `coordinateVisibili()` ora chiede una cosa sola — sono
arrivate le coordinate? — perché arrivare *è* il permesso.

**`dest_lat`/`dest_lon` restano colonne morte, e non per dimenticanza.** La 014 le ha create,
niente le scrive: le coordinate arrivano solo da `navigator.geolocation`, e alla destinazione non ci
sei. Riempirle vorrebbe dire un geocoder — che D6 esclude — o un selettore su mappa, cioè una
dipendenza nuova. Se un giorno servono, quella è la decisione da riaprire, non un bug da chiudere.

### C21 — Le coordinate esatte non devono uscire dalla comitiva — *fatto (27/07/2026)*
Sta qui perché è nato guardando C14, non perché appartenga a "Integrare": è un buco di 014, e come
tale viene prima delle cose nuove. Il buco vero che quel cantiere aveva solo smesso di offrire con
un click: `select('*')` su `rides` portava `origin_lat`/`origin_lon` a **chiunque** potesse vedere
il passaggio, compresi gli estranei che lo vedono perché è `pubblico`. Il link era prudente, il
payload no.

**Fatto in due migrazioni, e sono due perché tirano in direzioni opposte** — è la regola di
`supabase/README.md` applicata alla lettera, non una complicazione:

| | Cosa fa | Quando si applica |
|---|---|---|
| `015_coordinate_a_richiesta.sql` | aggiunge `coordinate_visibili()` e la funzione `coordinate_passaggi(ids)` | **prima** di pubblicare il codice, che la chiama |
| `016_coordinate_riservate.sql` | toglie il permesso di lettura su `origin_lat`, `origin_lon`, `dest_lat`, `dest_lon` | **dopo** la pubblicazione: rompe il `select('*')` del codice vecchio |

**Perché un permesso per colonna e non una vista.** Le due alternative sono state scartate per
motivi diversi. Un *campo calcolato* di PostgREST riceve la riga intera, e un riferimento a riga
intera in Postgres pretende il privilegio sulla tabella tutta: sarebbe incompatibile con la 016. Una
*vista* avrebbe funzionato, ma spostava tutte le query della Home su un oggetto nuovo — con
l'incorporamento di guidatore, sedili, commenti e lista d'attesa da riverificare in una volta sola,
su un sito che si pubblica facendo merge. Una funzione in più lascia intatto quello che già gira, e
se un giorno sparisse il link tornerebbe a cercare il nome del luogo: degrada, non rompe.

**Da qui in poi le colonne di `rides` si nominano** (`COLONNE_RIDE` in `app.js`): chi ne aggiunge
una la aggiunge anche lì, altrimenti nasce invisibile all'app. È lo stesso genere di vincolo che la
010 ha messo sull'archivio.

**Verificato** in `supabase/test/verifica-coordinate.sql`, in CI, e provato al contrario: togliendo
la chiamata a `blinda_coordinate()`, il controllo `is_member or ho_un_posto`, il primo
`passaggio_visibile` o la revoca dell'execute, il test diventa rosso — uno per ciascuno.

*Fatto quando:* un utente fuori comitiva che interroga l'API a mano riceve il passaggio senza le
coordinate. **Raggiunto**: da fuori `select *` viene rifiutato e `coordinate_passaggi` non torna
nessuna riga, mentre chi è dentro o ha un posto sull'auto continua ad avere il punto esatto.

---

## Fase 5 — Abbellire e ottimizzare

### C15 — Togliere l'aria di cosa generata — *impreziosita, non svuotata*

**Come è andata, perché vale più del risultato.** Il primo tentativo ha preso "sembra generata" e ha
risposto togliendo: via aurora, gradienti, ombre, schede, Inter, raggi grandi. Verdetto del
proprietario, giusto: *«fa schifo, sembra il sito di una casa di riposo, era meglio prima»*. Quel
commit è stato revertito (resta in `a94d1dc` se un giorno serve un pezzo). La lezione sta in una
riga: **la base era buona e andava impreziosita, non spogliata.** Togliere la decorazione senza
mettere niente al suo posto non dà carattere, dà povertà.

Secondo tentativo, in aggiunta. Vincoli dati: **navy resta il colore principale**, i **bordi restano
tondeggianti**, ricco ma sobrio.

1. **Il tondo della navigazione è di "dove sei", non della Home.** Era fisso sulla Home, rialzato,
   con un anello che pulsava. Ora è un elemento solo che **scivola** sulla colonna attiva, e l'icona
   di quella scheda sale dentro. La colonna la passa il codice al CSS leggendo l'ordine vero dei
   pulsanti, così l'elenco delle viste non vive in due posti che possono divergere. Verificato a
   390, 820 e 1440px: il centro del tondo cade sul centro della scheda entro 1px, in tutte e tre.
2. **Passare sopra anticipa il tocco.** Sulla scheda non attiva compare un tondo pallido dove
   arriverebbe quello pieno, e l'icona si alza di un soffio nella stessa direzione: non un bagliore,
   un'anteprima. Chiuso in `@media (hover: hover) and (pointer: fine)`, perché sul telefono `:hover`
   resta attaccato dopo il tocco e una scheda illuminata a vuoto sembra rotta. **Sul telefono basta
   l'animazione della tab attiva**, ed è esattamente quello che resta.
3. **Un secondo colore, l'ottone, e usato poco per scelta**: il tuo sedile, il tuo ruolo nello
   storico, il tuo codice del gruppo. Navy resta il colore dell'app; l'ottone è il colore di chi la
   sta usando. Prima "il mio sedile" era verde, cioè il colore di "va bene": ma quello non è una
   conferma, è l'unico posto che ti riguarda, e in un'auto da cinque deve trovarsi senza leggere le
   iniziali.
4. **L'auto è diventata un oggetto.** Lamiera con la luce che arriva dall'alto (un gradiente per
   ogni `--car-hue`, così funziona su qualsiasi tinta di guidatore), filo di luce sul bordo alto,
   riflesso di sbieco sul parabrezza, ombra a terra che la appoggia invece di lasciarla galleggiare,
   e una piega sul cuscino che fa leggere i sedili come imbottitura e non come tessere. Da
   `min(200px, 72%)` a `min(228px, 82%)`.
5. **Profondità vera invece di ombre grigie.** Due strati tinti del navy — una stretta che appoggia,
   una larga che stacca — più un filo di luce interno da 1px in cima alle superfici. È la differenza
   fra "pulito" e "curato", ed è un pixel.
6. **Finiture**: numeri tabellari su ore, posti e codici (una colonna di orari resta una colonna
   invece di ballare a ogni cifra), marchio con tracciatura strizzata, anello di focus disegnato.

**Fatto quando:** coperto il logo e il nome con un dito, si capisce che è questa app. Il pezzo che
risponde di più a quella prova è l'auto, che nessun altro ha. **Il giudizio finale resta tuo, su un
telefono in mano**: qui dentro il browser è girato per davvero, ma un'app che si usa di corsa in
piedi si valuta in piedi.

### C16 — Peso e velocità sul telefono
1200 righe di CSS e 1311 di JS senza build, più supabase-js da CDN. Misurare prima di ottimizzare:
tempo alla prima schermata utile su rete lenta, dimensione totale, quante query fa la home.
*Fatto quando:* c'è un numero di partenza e uno di arrivo, non un'impressione.

### C17 — Spezzare `app.js`
L'ADR 001 dice di rivedere la scelta "un file solo" oltre le 2-3k righe di JS: oggi siamo a 1311 e
le Fasi 3 e 4 aggiungono roba. Quando si supera la soglia: moduli ES separati (auth, gruppi,
passaggi, render), sempre senza build. **Non prima**: dividere presto costa e non rende.

---

## Fase 6 — Allineare al resto dello studio

### C18 — Standard dello Starter — *fatto nel repo; resta il ritorno verso lo Starter*
Portare qui quello che la base dei siti ha già e questo repo no. Fatti: `robots.txt`,
`sitemap.xml`, dati strutturati (JSON-LD `WebApplication` in `index.html`), `404.html`, più i
`canonical` e i campi Open Graph che non c'erano.

Tre cose scoperte facendo, che non erano nell'elenco:

- **L'informativa risponde a due indirizzi.** `/privacy` e `/privacy.html` danno **entrambe 200**
  — è la riscrittura di Netlify — quindi per un motore di ricerca sono due pagine identiche e
  sceglie lui quale contare. Ora il canonico è dichiarato, ed è uno solo: quello nel sitemap e
  quello che l'app usa nei link.
- **`offline.html` non va indicizzata.** Trovata da una ricerca sembrerebbe un'app rotta.
- **Open Graph serviva e non era nell'elenco.** Da C14 l'app si condivide da dentro — invito,
  passaggio, giornata — e senza quei campi il link incollato in chat arriva come indirizzo nudo.

**La pagina cookie non serve, e non è una dimenticanza:** non ci sono cookie di profilazione da
dichiarare. Nessuna analytics, nessun SDK di terzi (D6), e la sessione di Supabase non è
profilazione. Se un giorno entrasse un servizio che profila, quella pagina nasce con lui.
`eslint.config.mjs` era già versionato dalla Fase 0 — quella riga dell'elenco era vecchia.

Nel sitemap ogni indirizzo elencato viene interrogato dal test: un sitemap con un 404 dentro è
peggio che non averlo, perché dice al motore di ricerca una cosa falsa.

**Resta il verso opposto**, che è l'altra metà di questo cantiere e non si può fare da questo
repo: quello che WeTransport ha imparato e lo Starter non sa ancora — l'ordine fra migrazioni e
codice, le migrazioni numerate che si registrano da sole, i test provati al contrario, e la
Permissions-Policy che spegne una funzione se l'allowlist è vuota.

### C19 — Vault e codice allineati — *fatto il 27/07/2026*
Mappa Graphify rigenerata, memoria tecnica aggiornata con le decisioni di questo file, nota
progetto che punta qui invece di duplicare.

Fatto, ed è servito a scoprire quanto fosse scaduta: la nota del vault raccontava una Fase 3 «sul
ramo, da collaudare» mentre era pubblicata da un giorno, e il clone locale era **44 commit**
indietro. Ora la nota progetto rimanda qui invece di ripetere, la memoria tecnica ha una regola
nuova su **come si legge lo stato vero** (repo, sito servito, schema applicato) invece di
ricordarlo, e `audit-vault.py` è pulito. La lezione che resta: *le note invecchiano in silenzio, il
sistema vivo no* — quindi si guarda quello per primo.

### C20 — Un nome solo
Oggi sono tre: repo `posti`, cartella `C:\Progetti\posti`, dominio `wetransport.netlify.app`.
Cercare "wetransport" su GitHub non trova niente.

**Deciso:**
- **Repo rinominato in `wetransport`.** GitHub tiene attivi i vecchi indirizzi, ma vanno comunque
  aggiornati a mano: il collegamento Netlify, il remoto del clone locale, la nota del vault, i
  percorsi negli script di `Strumenti/`. Da fare in un momento in cui non c'è altro a metà.
- **Dominio proprio: sì, ma a T2.** Finché lo usa la comitiva, `.netlify.app` va benissimo. Quando
  si apre al pubblico serve un dominio vero: è anche il biglietto da visita dello studio, e un
  `.netlify.app` in vetrina dice "esperimento". Costo ~10-15 € l'anno.

---

## Decisioni prese dopo la prima stesura

| # | Punto | Scelta |
|---|---|---|
| **D5** | Notifiche (C13) | Tre eventi soli: posto prenotato nella tua auto, posto liberato in lista d'attesa, partenza fra un'ora. Commenti e nuove auto **no**: sarebbero rumore. Web Push standard, nessun servizio di terzi. |
| **D6** | Servizi esterni (C14) | Solo API native del browser: Web Share per l'invito, `.ics` per il calendario, link Maps con coordinate vere (dentro C9). Nessun SDK di terzi, nessuna analytics. |
| **D7** | Estetica (C15) | Il difetto è che sembra generata dall'AI, non che sia brutta. Si tolgono gli effetti generici, si sceglie una tipografia vera, l'auto SVG diventa protagonista. Prova del nove: coperto il logo, si riconosce lo stesso. |
| **D8** | Nome e dominio (C20) | Repo rinominato in `wetransport`; dominio proprio al momento dell'apertura al pubblico, non prima. |
